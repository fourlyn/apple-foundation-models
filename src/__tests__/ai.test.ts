import { generateText, jsonSchema as aiJsonSchema, Output, streamText, tool } from 'ai';
import { z } from 'zod';

import { apple, createAppleProvider } from '../ai';
import { defineTool } from '../index';
import { __resetEventsForTesting } from '../internal/events';
import { __setNativeModuleForTesting } from '../native';
import { FakeNative } from './fakeNative';

// The provider's warnings are asserted on the results; keep them out of the test output.
(globalThis as { AI_SDK_LOG_WARNINGS?: boolean }).AI_SDK_LOG_WARNINGS = false;

let fake: FakeNative;

beforeEach(() => {
  fake = new FakeNative();
  __resetEventsForTesting();
  __setNativeModuleForTesting(fake.module());
});

afterAll(() => __setNativeModuleForTesting(undefined));

const usage = { inputTokens: 10, cachedInputTokens: 4, outputTokens: 6, reasoningTokens: 1, totalTokens: 16 };

/** Makes the fake model stream the given text snapshots, then finish. */
function streamSnapshots(snapshots: string[]) {
  fake.streamImpl = (requestId) => {
    let previous = '';
    for (const text of snapshots) {
      fake.stream({ requestId, type: 'snapshot', text, delta: text.slice(previous.length) });
      previous = text;
    }
    fake.stream({ requestId, type: 'done', result: { text: previous, usage, transcriptEntries: [] } });
  };
}

describe('generateText', () => {
  it('returns the text, usage and model through the AI SDK', async () => {
    fake.respondImpl = async (_id, payload) => ({ text: `echo: ${payload.prompt}`, usage, transcriptEntries: [] });
    const result = await generateText({ model: apple(), system: 'Be brief.', prompt: 'Hello', temperature: 0.3, maxOutputTokens: 50 });

    expect(result.text).toBe('echo: Hello');
    expect(result.finishReason).toBe('stop');
    expect(result.usage).toMatchObject({ inputTokens: 10, outputTokens: 6 });
    expect(result.providerMetadata).toEqual({ apple: { model: 'system' } });
    expect(fake.configs[0]).toMatchObject({ model: 'system', instructions: 'Be brief.' });
    expect(fake.payloads[0]).toMatchObject({ prompt: 'Hello', options: { temperature: 0.3, maximumResponseTokens: 50 } });
  });

  it('creates one session per call and disposes it', async () => {
    await generateText({ model: apple(), prompt: 'one' });
    await generateText({ model: apple(), prompt: 'two' });
    expect(fake.configs).toHaveLength(2);
    expect(fake.disposed).toBe(2);
  });

  it('selects the model and use case from the model id and settings', async () => {
    await generateText({ model: apple('auto'), prompt: 'x' });
    await generateText({ model: apple('privateCloudCompute'), prompt: 'x' });
    await generateText({ model: apple('system', { useCase: 'contentTagging' }), prompt: 'x' });
    expect(fake.configs.map((config) => config.model)).toEqual(['auto', 'privateCloudCompute', { type: 'system', useCase: 'contentTagging' }]);
  });

  it('sends earlier turns as session messages and the last user message as the prompt', async () => {
    await generateText({
      model: apple(),
      messages: [
        { role: 'user', content: 'My favourite colour is teal.' },
        { role: 'assistant', content: 'Noted.' },
        { role: 'user', content: 'What is my favourite colour?' },
      ],
    });
    expect(fake.configs[0].messages).toEqual([
      { role: 'user', content: 'My favourite colour is teal.' },
      { role: 'assistant', content: 'Noted.' },
    ]);
    expect(fake.payloads[0].prompt).toBe('What is my favourite colour?');
  });

  it('rejects a conversation that does not end with a user message', async () => {
    await expect(
      generateText({ model: apple(), messages: [{ role: 'user', content: 'Hi' }, { role: 'assistant', content: 'Hello' }] }),
    ).rejects.toMatchObject({ code: 'INVALID_PROMPT' });
  });

  it('maps sampling settings and warns about unsupported ones', async () => {
    const result = await generateText({ model: apple(), prompt: 'x', topK: 40, seed: 7, presencePenalty: 0.5, stopSequences: ['END'] });
    expect(fake.payloads[0].options.samplingMode).toEqual({ type: 'topK', k: 40, seed: 7 });
    expect(result.warnings?.map((warning) => (warning as { feature: string }).feature).sort()).toEqual(['presencePenalty', 'stopSequences']);
  });

  it('passes provider options through', async () => {
    await generateText({ model: apple(), prompt: 'x', providerOptions: { apple: { reasoningLevel: 'deep', toolCallingMode: 'disallowed' } } });
    expect(fake.payloads[0].options).toMatchObject({ reasoningLevel: 'deep', toolCallingMode: 'disallowed' });
  });

  it('sends image parts of the last user message as images', async () => {
    await generateText({
      model: apple(),
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Describe this' },
            { type: 'file', data: new Uint8Array([104, 105]), mediaType: 'image/png' },
          ],
        },
      ],
    });
    expect(fake.payloads[0]).toMatchObject({ prompt: 'Describe this', images: [{ base64: 'aGk=', fileExtension: 'png' }] });
  });

  it('reports a guardrail block as a content-filter finish, not an exception', async () => {
    fake.respondImpl = async () => {
      throw Object.assign(new Error('blocked'), { code: 'GUARDRAIL_VIOLATION' });
    };
    const result = await generateText({ model: apple(), prompt: 'x' });
    expect(result.finishReason).toBe('content-filter');
    expect(result.text).toBe('');
  });

  it('propagates other errors with their code', async () => {
    fake.respondImpl = async () => {
      throw Object.assign(new Error('too long'), { code: 'CONTEXT_SIZE_EXCEEDED' });
    };
    await expect(generateText({ model: apple(), prompt: 'x', maxRetries: 0 })).rejects.toMatchObject({ code: 'CONTEXT_SIZE_EXCEEDED' });
    expect(fake.disposed).toBe(1);
  });
});

describe('structured output', () => {
  it('generates an object from a Zod schema', async () => {
    fake.respondImpl = async () => ({ json: '{"name":"Ada","age":36}', usage: null, transcriptEntries: [] });
    const result = await generateText({
      model: apple(),
      prompt: 'Extract: Ada, 36',
      output: Output.object({ schema: z.object({ name: z.string(), age: z.number() }) }),
    });
    expect(result.output).toEqual({ name: 'Ada', age: 36 });
    expect(fake.payloads[0].schema).toMatchObject({ type: 'object', required: ['name', 'age'] });
  });
});

describe('tools', () => {
  const weatherTool = () =>
    tool({
      description: 'Get the weather for a city',
      inputSchema: z.object({ city: z.string() }),
      execute: async ({ city }) => ({ city, temperature: 31 }),
    });

  it('runs registered AI SDK tools inside the session and reports calls and results', async () => {
    fake.respondImpl = async (requestId) => {
      const answer = await fake.callTool('weather', { city: 'Delhi' }, requestId);
      return { text: `It is ${JSON.parse(answer.resultJSON!).temperature} degrees.`, usage: null, transcriptEntries: [] };
    };
    const tools = { weather: weatherTool() };
    const result = await generateText({ model: apple('system', { tools }), tools, prompt: 'Weather in Delhi?' });

    expect(result.text).toBe('It is 31 degrees.');
    expect(fake.configs[0].tools.map((descriptor: { name: string }) => descriptor.name)).toEqual(['weather']);
    expect(result.toolCalls).toMatchObject([{ toolName: 'weather', input: { city: 'Delhi' }, providerExecuted: true }]);
    expect(result.toolResults).toMatchObject([{ toolName: 'weather', output: { city: 'Delhi', temperature: 31 } }]);
    // Apple finished the loop itself: the AI SDK must not run a second step.
    expect(result.steps).toHaveLength(1);
    expect(fake.payloads).toHaveLength(1);
  });

  it('accepts tools from this package and marks them dynamic when the call does not list them', async () => {
    const lookup = defineTool({
      name: 'lookup',
      description: 'Look up a fact',
      parameters: z.object({ query: z.string() }),
      execute: async ({ query }) => `fact about ${query}`,
    });
    fake.respondImpl = async (requestId) => {
      const answer = await fake.callTool('lookup', { query: 'teal' }, requestId);
      return { text: JSON.parse(answer.resultJSON!), usage: null, transcriptEntries: [] };
    };
    const provider = createAppleProvider({ tools: [lookup] });
    const result = await generateText({ model: provider(), prompt: 'Tell me about teal' });

    expect(result.text).toBe('fact about teal');
    expect(result.toolCalls).toMatchObject([{ toolName: 'lookup', dynamic: true }]);
  });

  it('accepts AI SDK jsonSchema() tool inputs', async () => {
    const tools = {
      add: tool({
        description: 'Add two numbers',
        inputSchema: aiJsonSchema<{ a: number; b: number }>({
          type: 'object',
          properties: { a: { type: 'number' }, b: { type: 'number' } },
          required: ['a', 'b'],
        }),
        execute: async ({ a, b }) => a + b,
      }),
    };
    await generateText({ model: apple('system', { tools }), tools, prompt: '2+2?' });
    expect(fake.configs[0].tools[0].parameters).toMatchObject({ type: 'object', required: ['a', 'b'] });
  });

  it('warns about tools that are not registered with the provider', async () => {
    const result = await generateText({ model: apple(), tools: { weather: weatherTool() }, prompt: 'Weather?' });
    expect(fake.configs[0].tools).toEqual([]);
    expect(result.warnings).toMatchObject([{ type: 'unsupported', feature: 'tool "weather"' }]);
  });

  it('reports a failing tool as an error result', async () => {
    const tools = {
      weather: tool({
        description: 'Get the weather',
        inputSchema: z.object({ city: z.string() }),
        execute: async (): Promise<string> => {
          throw new Error('service offline');
        },
      }),
    };
    fake.respondImpl = async (requestId) => {
      const answer = await fake.callTool('weather', { city: 'Delhi' }, requestId);
      return { text: `failed: ${answer.errorMessage}`, usage: null, transcriptEntries: [] };
    };
    const result = await generateText({ model: apple('system', { tools }), tools, prompt: 'Weather?' });
    expect(result.text).toBe('failed: service offline');
    expect(result.content.find((part) => part.type === 'tool-error')).toMatchObject({ toolName: 'weather' });
  });

  it('replays earlier tool calls and results as session messages', async () => {
    await generateText({
      model: apple(),
      messages: [
        { role: 'user', content: 'Weather in Delhi?' },
        { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'c1', toolName: 'weather', input: { city: 'Delhi' } }] },
        { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'c1', toolName: 'weather', output: { type: 'json', value: { temperature: 31 } } }] },
        { role: 'assistant', content: '31 degrees.' },
        { role: 'user', content: 'And Mumbai?' },
      ],
    });
    expect(fake.configs[0].messages).toEqual([
      { role: 'user', content: 'Weather in Delhi?' },
      { role: 'toolCalls', calls: [{ id: 'c1', toolName: 'weather', argumentsJSON: '{"city":"Delhi"}' }] },
      { role: 'toolOutput', id: 'c1', toolName: 'weather', content: '{"temperature":31}' },
      { role: 'assistant', content: '31 degrees.' },
    ]);
  });
});

describe('streamText', () => {
  it('streams text deltas and finishes with usage', async () => {
    streamSnapshots(['Hel', 'Hello', 'Hello world']);
    const result = streamText({ model: apple(), prompt: 'Say hello' });
    const deltas: string[] = [];
    for await (const delta of result.textStream) deltas.push(delta);

    expect(deltas).toEqual(['Hel', 'lo', ' world']);
    expect(await result.text).toBe('Hello world');
    expect(await result.finishReason).toBe('stop');
    expect(await result.usage).toMatchObject({ inputTokens: 10, outputTokens: 6 });
    expect(fake.disposed).toBe(1);
  });

  it('surfaces stream errors to the AI SDK', async () => {
    fake.streamImpl = (requestId) => fake.stream({ requestId, type: 'error', error: { code: 'RATE_LIMITED', message: 'slow down' } });
    const errors: unknown[] = [];
    const result = streamText({ model: apple(), prompt: 'x', onError: ({ error }) => void errors.push(error) });
    for await (const _ of result.textStream) {
      /* drain */
    }
    expect(errors).toMatchObject([{ code: 'RATE_LIMITED' }]);
    expect(fake.disposed).toBe(1);
  });

  it('cancels generation when the AI SDK call is aborted', async () => {
    const controller = new AbortController();
    fake.streamImpl = (requestId) => {
      fake.stream({ requestId, type: 'snapshot', text: 'Hel', delta: 'Hel' });
      controller.abort();
    };
    const result = streamText({ model: apple(), prompt: 'x', abortSignal: controller.signal, onError: () => {} });
    const deltas: string[] = [];
    try {
      for await (const delta of result.textStream) deltas.push(delta);
    } catch {
      /* the AI SDK may surface the abort as a rejection */
    }
    expect(fake.cancelled).toHaveLength(1);
    expect(fake.disposed).toBe(1);
  });
});
