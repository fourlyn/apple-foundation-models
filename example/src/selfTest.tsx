import {
  AppleFoundationModels,
  OCRTool,
  createSession,
  isAppleFoundationModelsError,
  type Session,
} from '@fourlyn/apple-foundation-models';
import { Asset } from 'expo-asset';
import { useEffect, useState } from 'react';
import { z } from 'zod';

import { Body, Button, Card, Screen } from './ui';

type Result = { name: string; status: 'PASS' | 'FAIL' | 'SKIP'; detail: string; ms: number };

const ms = (start: number) => Date.now() - start;

/**
 * End-to-end checks against the real framework. Results are logged with a `[selftest]`
 * prefix so they can be read from Metro logs in CI / automation.
 */
async function runSelfTest(onResult: (result: Result) => void): Promise<void> {
  const diagnostics = await AppleFoundationModels.getDiagnostics();
  const features = diagnostics.features;
  const available = diagnostics.systemModel?.isAvailable === true;

  const test = async (name: string, body: () => Promise<string>, options: { skip?: string } = {}) => {
    const start = Date.now();
    if (options.skip) {
      onResult({ name, status: 'SKIP', detail: options.skip, ms: 0 });
      return;
    }
    try {
      onResult({ name, status: 'PASS', detail: await body(), ms: ms(start) });
    } catch (error: any) {
      const simulatorGap =
        diagnostics.isSimulator &&
        (error?.code === 'MODEL_NOT_READY' || (error?.code === 'UNSUPPORTED_PLATFORM' && error?.details?.reason === 'SIMULATOR'));
      if (simulatorGap) {
        onResult({ name, status: 'SKIP', detail: `Simulator limitation (${error.code}); verify on a device`, ms: ms(start) });
        return;
      }
      const extra = error?.nativeType ? ` [${error.nativeType}] ${JSON.stringify(error.details)}` : '';
      onResult({ name, status: 'FAIL', detail: `${error?.code ?? ''} ${error?.message ?? String(error)}${extra}`, ms: ms(start) });
    }
  };
  const expect = (condition: unknown, message: string) => {
    if (!condition) throw new Error(message);
  };
  const expectCode = async (promise: Promise<unknown>, code: string) => {
    try {
      await promise;
    } catch (error) {
      if (isAppleFoundationModelsError(error) && error.code === code) return `threw ${code} as expected`;
      throw error;
    }
    throw new Error(`expected ${code}, but it succeeded`);
  };
  const noModel = available ? undefined : 'system model unavailable';

  await test('diagnostics', async () =>
    `os ${diagnostics.osVersion}, device ${diagnostics.deviceModel}, model ${JSON.stringify(diagnostics.systemModel?.availability)}, ctx ${diagnostics.systemModel?.contextSize}`,
  );
  await test('availability', async () => JSON.stringify(await AppleFoundationModels.getAvailability()));

  let session: Session | null = null;
  await test('respond', async () => {
    session = await createSession({ instructions: 'Answer in at most one sentence.' });
    const response = await session.respond('What is the capital of France?', { temperature: 0 });
    expect(/paris/i.test(response.text), `unexpected answer: ${response.text}`);
    return `${response.text} | entries: ${response.transcriptEntries.map((e) => e.type).join(',')}`;
  }, { skip: noModel });

  await test('multi-turn memory', async () => {
    const s = await createSession({ instructions: 'Be brief.' });
    await s.respond('My favourite colour is teal. Just say OK.');
    const { text } = await s.respond('What is my favourite colour?');
    s.dispose();
    expect(/teal/i.test(text), `did not remember: ${text}`);
    return text;
  }, { skip: noModel });

  await test('stream', async () => {
    const stream = session!.stream('Count from 1 to 10 separated by spaces.');
    let chunks = 0;
    let last = '';
    for await (const chunk of stream) {
      chunks += 1;
      last = chunk.text;
    }
    const final = await stream.result;
    expect(chunks > 1, 'expected multiple chunks');
    expect(final.text === last, 'final text mismatch');
    return `${chunks} chunks: ${last}`;
  }, { skip: noModel });

  const Person = z.object({ name: z.string(), age: z.number().int(), hobbies: z.array(z.string()).max(3) });
  await test('generateObject (zod)', async () => {
    const person = await session!.generateObject({ prompt: 'Maria is 34 and loves chess and hiking.', schema: Person });
    expect(person.age === 34, `bad age ${person.age}`);
    return JSON.stringify(person);
  }, { skip: noModel });

  await test('streamObject', async () => {
    const stream = session!.streamObject({ prompt: 'Invent a person who likes painting.', schema: Person });
    let partials = 0;
    for await (const _ of stream) partials += 1;
    const { object } = await stream.result;
    return `${partials} partials -> ${JSON.stringify(object)}`;
  }, { skip: noModel });

  await test('enum + nested schema', async () => {
    const result = await session!.generateObject({
      prompt: 'Classify the sentiment of: "I absolutely love this phone!"',
      schema: {
        type: 'object',
        properties: {
          sentiment: { type: 'string', enum: ['positive', 'neutral', 'negative'] },
          scores: { type: 'object', properties: { confidence: { type: 'number', minimum: 0, maximum: 1 } }, required: ['confidence'] },
        },
        required: ['sentiment', 'scores'],
      },
    });
    return JSON.stringify(result);
  }, { skip: noModel });

  await test('tools (parallel)', async () => {
    const started: string[] = [];
    const s = await createSession({
      instructions: 'Always use the getWeather tool for weather questions.',
      tools: [
        {
          name: 'getWeather',
          description: 'Get the current weather for a city',
          parameters: z.object({ city: z.string() }),
          execute: async ({ city }: { city: string }) => {
            started.push(city);
            await new Promise((resolve) => setTimeout(resolve, 200));
            return { city, temperatureCelsius: 30 };
          },
        },
      ],
    });
    const { text, transcriptEntries } = await s.respond('What is the weather in Delhi and in Mumbai?');
    s.dispose();
    expect(started.length > 0, 'tool was never called');
    return `calls: ${started.join(', ')} | entries: ${transcriptEntries.map((e) => e.type).join(',')} | ${text}`;
  }, { skip: noModel });

  await test('native Apple tool (OCRTool)', async () => {
    const s = await createSession({ tools: [OCRTool()] });
    try {
      return (await s.respond('Say hello.')).text;
    } finally {
      s.dispose();
    }
  }, { skip: features.visionTools ? noModel : 'requires iOS 27' });

  await test('tool error is reported to the model', async () => {
    const s = await createSession({
      instructions: 'Use the lookup tool to answer.',
      tools: [{ name: 'lookup', description: 'Look up a fact', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }, execute: () => { throw new Error('database offline'); } }],
    });
    try {
      const { text } = await s.respond('Look up the population of Paris.');
      return `model answered: ${text}`;
    } catch (error: any) {
      if (error.code !== 'TOOL_CALL_FAILED') throw error;
      return `TOOL_CALL_FAILED: ${JSON.stringify(error.details)}`;
    } finally {
      s.dispose();
    }
  }, { skip: noModel });

  await test('cancellation', async () => {
    const controller = new AbortController();
    const stream = session!.stream('Write a very long story about the sea.', { signal: controller.signal });
    let chunks = 0;
    try {
      for await (const _ of stream) {
        chunks += 1;
        if (chunks === 3) controller.abort();
      }
      throw new Error('stream was not cancelled');
    } catch (error) {
      expect(isAppleFoundationModelsError(error, 'CANCELLED'), `unexpected error: ${String(error)}`);
    }
    const after = await session!.respond('Say OK.');
    return `cancelled after ${chunks} chunks; session still usable: "${after.text}"`;
  }, { skip: noModel });

  await test('transcript restore', async () => {
    const transcript = await session!.getTranscript();
    const restored = await createSession({ transcript });
    const { text } = await restored.respond('What was the first question I asked you?');
    restored.dispose();
    return `${transcript.entries.length} entries restored -> ${text}`;
  }, { skip: noModel });

  await test('prewarm', async () => {
    await session!.prewarm({ promptPrefix: 'Summarize' });
    return 'ok';
  }, { skip: noModel });

  await test('token count', async () => {
    const count = await AppleFoundationModels.tokenCount({ prompt: 'Hello world', instructions: 'Be brief.' });
    return `${count} tokens`;
  }, { skip: features.tokenCounting ? noModel : 'requires iOS 26.4' });

  await test('usage', async () => {
    const usage = session!.usage;
    if (!features.usage) {
      expect(usage === null, 'usage should be null before iOS 27');
      return 'null (pre-iOS 27, as documented)';
    }
    return JSON.stringify(usage);
  }, { skip: noModel });

  await test('feedback attachment', async () => {
    const bytes = await session!.createFeedbackAttachment({ sentiment: 'positive', issues: [{ category: 'tooVerbose' }] });
    expect(bytes.length > 0, 'empty attachment');
    return `${bytes.length} bytes`;
  }, { skip: noModel });

  await test('invalid schema', async () =>
    expectCode(session!.generateObject({ prompt: 'x', schema: { type: 'object', properties: { a: { type: 'string', enum: [] } } } }), 'INVALID_SCHEMA'),
  { skip: noModel });

  await test('profiles', async () => {
    const promise = createSession({
      profiles: {
        a: { instructions: 'You only ever reply with the single word ALPHA.' },
        b: { instructions: 'You only ever reply with the single word BETA.', history: { strategy: 'none' } },
      },
      initialProfile: 'a',
    });
    if (!features.dynamicProfiles) return expectCode(promise, 'UNSUPPORTED_OS_VERSION');
    const s = await promise;
    const first = (await s.respond('Reply now.')).text;
    s.setProfile('b');
    expect(s.activeProfile === 'b', `activeProfile is ${s.activeProfile}`);
    const second = (await s.respond('Reply now.')).text;
    s.dispose();
    expect(/alpha/i.test(first) && /beta/i.test(second), `unexpected replies: ${first} -> ${second}`);
    return `${first} -> ${second}`;
  }, { skip: noModel });

  await test('session.transcript + contextSize', async () => {
    const snapshot = session!.transcript;
    const viaPromise = await session!.getTranscript();
    expect(snapshot.entries.length === viaPromise.entries.length, 'sync and async transcripts differ');
    expect(snapshot.json.length > 0, 'empty transcript json');
    const { contextSize } = await AppleFoundationModels.getModelInfo();
    expect(session!.contextSize === contextSize, `session.contextSize is ${session!.contextSize}, getModelInfo() says ${contextSize}`);
    return `${snapshot.entries.length} entries, context ${session!.contextSize} tokens`;
  }, { skip: noModel });

  await test('respondAdvanced', async () => {
    const text = await session!.respondAdvanced({ prompt: 'What is the capital of Italy? One word.', options: { temperature: 0 } });
    expect(/rome/i.test(text.text) && text.object === undefined, `unexpected text response: ${text.text}`);
    const structured = await session!.respondAdvanced({
      prompt: 'Maria is 34 and loves chess.',
      schema: Person,
      schemaName: 'Person',
      options: { samplingMode: { type: 'greedy' } },
    });
    expect(structured.object.age === 34, `bad age ${structured.object.age}`);
    expect(structured.transcriptEntries.length > 0 && structured.isComplete, 'missing transcript entries');
    return `${text.text} (${text.durationMs}ms) | ${structured.text} | model ${structured.model}`;
  }, { skip: noModel });

  await test('streamAdvanced', async () => {
    const stream = session!.streamAdvanced({ prompt: 'Invent a person who likes sailing.', schema: Person });
    let partials = 0;
    for await (const chunk of stream) if (!chunk.isFinal) partials += 1;
    const final = await stream.result;
    expect(typeof final.object.name === 'string', 'no object');
    return `${partials} partials -> ${final.text}`;
  }, { skip: noModel });

  await test('messages (plain history)', async () => {
    const s = await createSession({
      instructions: 'Be brief.',
      messages: [
        { role: 'user', content: 'My favourite colour is teal. Just say OK.' },
        { role: 'assistant', content: 'OK.' },
      ],
    });
    try {
      // Greedy sampling: this checks that the history reaches the model, not how creative it is.
      const { text } = await s.respond('What is my favourite colour?', { samplingMode: { type: 'greedy' } });
      expect(/teal/i.test(text), `did not use the seeded history: ${text}`);
      return `${s.transcript.entries.map((e) => e.type).join(',')} -> ${text}`;
    } finally {
      s.dispose();
    }
  }, { skip: noModel });

  await test('historyTransform (JS callback)', async () => {
    const seen: number[] = [];
    const s = await createSession({
      instructions: 'Be brief.',
      profiles: {
        // Forgets everything before the current prompt.
        forgetful: { historyTransform: (entries) => (seen.push(entries.length), []) },
      },
    });
    try {
      await s.respond('My favourite colour is teal. Just say OK.');
      const { text } = await s.respond('What is my favourite colour? If you do not know, say UNKNOWN.');
      expect(seen.length >= 2, `callback ran ${seen.length} times`);
      expect(!/teal/i.test(text), `history was not filtered: ${text}`);
      expect(s.transcript.entries.some((e) => e.type === 'prompt' && JSON.stringify(e).includes('teal')), 'the global transcript must stay intact');
      return `callback saw ${seen.join(',')} entries -> ${text}`;
    } finally {
      s.dispose();
    }
  }, { skip: features.dynamicProfiles ? noModel : 'requires iOS 27' });

  await test('images', async () => {
    const promise = session!.respond({ prompt: 'Describe', images: [{ base64: 'iVBORw0KGgo=' }] });
    if (!features.images) return expectCode(promise, 'UNSUPPORTED_OS_VERSION');
    // An invalid 1-byte PNG: the request must fail with a structured error, not crash.
    const error: any = await promise.then(() => null, (e) => e);
    return error ? `rejected invalid image with ${error.code}` : 'accepted';
  }, { skip: noModel });

  await test('image prompt (real image)', async () => {
    const [asset] = await Asset.loadAsync(require('../assets/icon.png'));
    const s = await createSession();
    try {
      const { text } = await s.respond({ prompt: 'Describe this image in one sentence.', images: [{ uri: asset.localUri!, label: 'icon' }] });
      return text;
    } finally {
      s.dispose();
    }
  }, { skip: features.images ? noModel : 'requires iOS 27' });

  await test('private cloud compute', async () => {
    const info = await AppleFoundationModels.getPrivateCloudComputeInfo();
    return JSON.stringify(info.availability);
  });

  await test('private cloud compute request', async () => {
    const promise = createSession({ model: 'privateCloudCompute' }).then(async (s) => {
      try {
        return (await s.respond('Say OK.')).text;
      } finally {
        s.dispose();
      }
    });
    if (!features.privateCloudCompute) return expectCode(promise, 'UNSUPPORTED_OS_VERSION');
    try {
      return `answered: ${await promise}`;
    } catch (error: any) {
      // Without Apple's entitlement, quota or network, the failure must still be one of the documented PCC codes.
      const documented = ['PRIVATE_CLOUD_COMPUTE_UNAVAILABLE', 'ENTITLEMENT_REQUIRED', 'QUOTA_LIMIT_REACHED', 'NETWORK_FAILURE'];
      if (!documented.includes(error?.code)) throw error;
      return `${error.code} (reason: ${error.details?.reason ?? 'none'}) [${error.nativeType}] ${error.message}`;
    }
  });

  await test('dispose', async () => {
    const s = session ?? (await createSession());
    s.dispose();
    return expectCode(s.respond('x'), 'SESSION_DISPOSED');
  }, { skip: noModel });
}

export const AUTO_SELF_TEST = process.env.EXPO_PUBLIC_SELF_TEST === '1';

export function SelfTestScreen() {
  const [results, setResults] = useState<Result[]>([]);
  const [running, setRunning] = useState(false);

  const start = () => {
    setResults([]);
    setRunning(true);
    console.log('[selftest] START');
    runSelfTest((result) => {
      console.log(`[selftest] ${result.status} ${result.name} (${result.ms}ms): ${result.detail}`);
      setResults((previous) => [...previous, result]);
    })
      .catch((error) => console.log(`[selftest] CRASH ${String(error)}`))
      .finally(() => {
        console.log('[selftest] END');
        setRunning(false);
      });
  };

  useEffect(() => {
    if (AUTO_SELF_TEST) start();
  }, []);

  return (
    <Screen>
      <Button title={running ? 'Running…' : 'Run self-test'} disabled={running} onPress={start} />
      {results.map((result) => (
        <Card key={result.name} title={`${result.status === 'PASS' ? '✅' : result.status === 'SKIP' ? '⏭️' : '❌'} ${result.name}`}>
          <Body muted>{`${result.ms}ms — ${result.detail}`}</Body>
        </Card>
      ))}
    </Screen>
  );
}
