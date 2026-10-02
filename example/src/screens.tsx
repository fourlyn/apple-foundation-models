import {
  AppleFoundationModels,
  OCRTool,
  createSession,
  defineTool,
  entryText,
  type Diagnostics,
  type ModelInfo,
  type Session,
  type Transcript,
} from '@fourlyn/apple-foundation-models';
import { useAvailability, useChat, useSession } from '@fourlyn/apple-foundation-models/react';
import { Asset } from 'expo-asset';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { z } from 'zod';

import { Body, Button, Card, ErrorText, Input, Json, Loading, Screen, useAction } from './ui';

// ---------------------------------------------------------------------------

export function AvailabilityScreen() {
  const system = useAvailability('system');
  const pcc = useAvailability('privateCloudCompute');
  const auto = useAvailability('auto');
  return (
    <Screen>
      <Card title="System model (on-device)">
        <Json value={system.availability ?? 'Checking…'} />
      </Card>
      <Card title="Private Cloud Compute">
        <Json value={pcc.availability ?? 'Checking…'} />
      </Card>
      <Card title="auto (Fourlyn)">
        <Json value={auto.availability ?? 'Checking…'} />
      </Card>
      <Button
        title="Refresh"
        onPress={() => {
          void system.refresh();
          void pcc.refresh();
          void auto.refresh();
        }}
      />
    </Screen>
  );
}

// ---------------------------------------------------------------------------

export function ChatScreen() {
  const [input, setInput] = useState('');
  const { messages, send, stop, isResponding, error, isReady } = useChat({
    instructions: 'You are a friendly, concise assistant.',
    prewarm: true,
  });
  return (
    <Screen>
      {messages.map((message) => (
        <Card key={message.id} title={message.role === 'user' ? 'You' : 'Assistant'}>
          <Body>{message.text || (message.pending ? '…' : '')}</Body>
          <ErrorText error={message.error} />
        </Card>
      ))}
      <ErrorText error={error} />
      <Input value={input} onChangeText={setInput} placeholder="Ask anything" multiline />
      {isResponding ? (
        <Button title="Stop" onPress={stop} />
      ) : (
        <Button
          title={isReady ? 'Send (streaming)' : 'Creating session…'}
          disabled={!isReady || !input.trim()}
          onPress={() => {
            void send(input.trim());
            setInput('');
          }}
        />
      )}
    </Screen>
  );
}

// ---------------------------------------------------------------------------

const Recipe = z.object({
  title: z.string().describe('Short recipe name'),
  cuisine: z.enum(['italian', 'indian', 'japanese', 'mexican', 'other']),
  servings: z.number().int().min(1).max(12),
  ingredients: z.array(z.object({ name: z.string(), quantity: z.string() })).max(10),
  steps: z.array(z.string()).max(8),
});

export function StructuredScreen() {
  const { session, error: sessionError } = useSession({ instructions: 'You write practical home-cooking recipes.' });
  const [prompt, setPrompt] = useState('A quick vegetarian dinner with chickpeas');
  const [partial, setPartial] = useState<unknown>(null);
  const action = useAction<unknown>();

  const streamRecipe = () =>
    action.run(async () => {
      const stream = session!.streamObject({ prompt, schema: Recipe });
      for await (const chunk of stream) setPartial(chunk.partial);
      return (await stream.result).object;
    });

  return (
    <Screen>
      <Card title="Schema">
        <Body muted>Zod: title, cuisine (enum), servings (1–12), ingredients[], steps[]</Body>
      </Card>
      <Input value={prompt} onChangeText={setPrompt} multiline />
      <Button title="Stream object" disabled={!session || action.loading} onPress={streamRecipe} />
      <Button
        title="Generate object"
        disabled={!session || action.loading}
        onPress={() => action.run(() => session!.generateObject({ prompt, schema: Recipe }))}
      />
      <Loading visible={action.loading && !partial} />
      <ErrorText error={action.error ?? sessionError} />
      {(action.result ?? partial) ? (
        <Card title={action.result ? 'Result (validated by Zod)' : 'Partial'}>
          <Json value={action.result ?? partial} />
        </Card>
      ) : null}
    </Screen>
  );
}

// ---------------------------------------------------------------------------

const getWeather = defineTool({
  name: 'getWeather',
  description: 'Get the current weather for a city.',
  parameters: z.object({ city: z.string().describe('City name') }),
  execute: async ({ city }) => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    const temperature = 18 + (city.length % 15);
    return { city, temperatureCelsius: temperature, condition: temperature > 25 ? 'sunny' : 'cloudy' };
  },
});

const convertCurrency = defineTool({
  name: 'convertCurrency',
  description: 'Convert an amount between currencies.',
  parameters: z.object({ amount: z.number(), from: z.string(), to: z.string() }),
  execute: ({ amount, from, to }) => `${amount} ${from} = ${(amount * 1.1).toFixed(2)} ${to} (demo rate)`,
});

export function ToolsScreen() {
  const { session } = useSession({ instructions: 'Use tools for weather and currency questions.', tools: [getWeather, convertCurrency] });
  const [prompt, setPrompt] = useState('What is the weather in Delhi, Mumbai and Bangalore?');
  const [log, setLog] = useState<string[]>([]);
  const action = useAction<string>();

  useEffect(() => {
    if (!session) return;
    const offs = [
      session.on('toolCall', (e) => setLog((l) => [...l, `→ ${e.toolName}(${JSON.stringify(e.arguments)})`])),
      session.on('toolResult', (e) => setLog((l) => [...l, `← ${e.toolName} ${JSON.stringify(e.result)} (${e.durationMs}ms)`])),
      session.on('toolError', (e) => setLog((l) => [...l, `✕ ${e.toolName}: ${e.error.message}`])),
    ];
    return () => offs.forEach((off) => off());
  }, [session]);

  return (
    <Screen>
      <Input value={prompt} onChangeText={setPrompt} multiline />
      <Button
        title="Ask"
        disabled={!session || action.loading}
        onPress={() => {
          setLog([]);
          void action.run(async () => (await session!.respond(prompt)).text);
        }}
      />
      <Loading visible={action.loading} />
      <Card title="Tool events">
        <Body mono>{log.join('\n') || 'No tool calls yet'}</Body>
      </Card>
      <ErrorText error={action.error} />
      {action.result ? (
        <Card title="Answer">
          <Body>{action.result}</Body>
        </Card>
      ) : null}
    </Screen>
  );
}

// ---------------------------------------------------------------------------

export function ImageScreen() {
  const action = useAction<string>();
  return (
    <Screen>
      <Card title="Image understanding (iOS 27+)">
        <Body muted>Sends the app icon as a local file URI with OCRTool available.</Body>
      </Card>
      <Button
        title="Describe the app icon"
        disabled={action.loading}
        onPress={() =>
          action.run(async () => {
            const [asset] = await Asset.loadAsync(require('../assets/icon.png'));
            const session = await createSession({ tools: [OCRTool()] });
            try {
              const { text } = await session.respond({
                prompt: 'Describe this image in two sentences.',
                images: [{ uri: asset.localUri!, label: 'icon' }],
              });
              return text;
            } finally {
              session.dispose();
            }
          })
        }
      />
      <Loading visible={action.loading} />
      <ErrorText error={action.error} />
      {action.result ? (
        <Card title="Answer">
          <Body>{action.result}</Body>
        </Card>
      ) : null}
    </Screen>
  );
}

// ---------------------------------------------------------------------------

export function ProfilesScreen() {
  const { session, error } = useSession({
    instructions: 'You are a helpful assistant.',
    profiles: {
      concise: { instructions: 'Answer in one short sentence.', temperature: 0.2 },
      pirate: { instructions: 'Answer like a pirate, in two sentences.', temperature: 0.9, history: { strategy: 'lastTurns', count: 2 } },
    },
    initialProfile: 'concise',
  });
  const [active, setActive] = useState('concise');
  const [events, setEvents] = useState<string[]>([]);
  const action = useAction<string>();

  useEffect(() => session?.on('profile', (e) => setEvents((l) => [...l.slice(-8), `${e.profile}: ${e.event}`])), [session]);

  return (
    <Screen>
      <ErrorText error={error} />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {['concise', 'pirate'].map((name) => (
          <View key={name} style={{ flex: 1 }}>
            <Button
              title={name === active ? `● ${name}` : name}
              disabled={!session}
              onPress={() => {
                session!.setProfile(name);
                setActive(name);
              }}
            />
          </View>
        ))}
      </View>
      <Button
        title="Ask: what is the ocean?"
        disabled={!session || action.loading}
        onPress={() => action.run(async () => (await session!.respond('What is the ocean?')).text)}
      />
      <Loading visible={action.loading} />
      <ErrorText error={action.error} />
      {action.result ? (
        <Card title={`Answer (${active})`}>
          <Body>{action.result}</Body>
        </Card>
      ) : null}
      <Card title="Profile events">
        <Body mono>{events.join('\n') || 'None yet'}</Body>
      </Card>
    </Screen>
  );
}

// ---------------------------------------------------------------------------

export function TranscriptScreen() {
  const sessionRef = useRef<Session | null>(null);
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const action = useAction<string>();

  useEffect(() => () => sessionRef.current?.dispose(), []);

  return (
    <Screen>
      <Button
        title="Start conversation (2 turns)"
        disabled={action.loading}
        onPress={() =>
          action.run(async () => {
            sessionRef.current?.dispose();
            const session = await createSession({ instructions: 'Be brief.' });
            sessionRef.current = session;
            await session.respond('My name is Ada. Remember it.');
            await session.respond('Name three planets.');
            const t = await session.getTranscript();
            setTranscript(t);
            return `Saved transcript: ${t.json.length} bytes, ${t.entries.length} entries`;
          })
        }
      />
      <Button
        title="Restore into a new session and ask"
        disabled={!transcript || action.loading}
        onPress={() =>
          action.run(async () => {
            const restored = await createSession({ transcript: transcript! });
            try {
              return `Restored session says: ${(await restored.respond('What is my name?')).text}`;
            } finally {
              restored.dispose();
            }
          })
        }
      />
      <Loading visible={action.loading} />
      <ErrorText error={action.error} />
      {action.result ? <Body>{action.result}</Body> : null}
      {transcript?.entries.map((entry) => (
        <Card key={entry.id} title={entry.type}>
          <Body>{entryText(entry) || JSON.stringify(entry)}</Body>
        </Card>
      ))}
    </Screen>
  );
}

// ---------------------------------------------------------------------------

export function ModelInfoScreen() {
  const action = useAction<{ info: ModelInfo; tokens: number | string; locale: boolean }>();
  return (
    <Screen>
      <Button
        title="Load model info"
        disabled={action.loading}
        onPress={() =>
          action.run(async () => {
            const model = AppleFoundationModels.systemModel();
            const info = await model.getInfo();
            const tokens = await model.tokenCount('The quick brown fox jumps over the lazy dog.').catch((e) => `${e.code}: ${e.message}`);
            return { info, tokens, locale: await model.supportsLocale() };
          })
        }
      />
      <Loading visible={action.loading} />
      <ErrorText error={action.error} />
      {action.result ? (
        <>
          <Card title="Token count (“The quick brown fox…”)">
            <Body>{String(action.result.tokens)}</Body>
          </Card>
          <Card title="Supports current locale">
            <Body>{String(action.result.locale)}</Body>
          </Card>
          <Card title="Model info">
            <Json value={action.result.info} />
          </Card>
        </>
      ) : null}
    </Screen>
  );
}

// ---------------------------------------------------------------------------

export function DiagnosticsScreen() {
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  useEffect(() => {
    void AppleFoundationModels.getDiagnostics().then(setDiagnostics);
  }, []);
  return (
    <Screen>
      <Card title="getDiagnostics()">
        <Json value={diagnostics ?? 'Loading…'} />
      </Card>
    </Screen>
  );
}
