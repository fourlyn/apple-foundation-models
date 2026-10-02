import { z } from 'zod';

import { createSession, getAvailability, isAppleFoundationModelsError } from '../index';
import { __resetEventsForTesting } from '../internal/events';
import { __setNativeModuleForTesting } from '../native';
import { FakeNative } from './fakeNative';

let fake: FakeNative;

beforeEach(() => {
  fake = new FakeNative();
  __resetEventsForTesting();
  __setNativeModuleForTesting(fake.module());
});

afterAll(() => __setNativeModuleForTesting(undefined));

describe('unsupported platforms', () => {
  beforeEach(() => __setNativeModuleForTesting(null));

  it('getAvailability reports unsupported instead of throwing', async () => {
    await expect(getAvailability()).resolves.toEqual({ status: 'unavailable', available: false, reason: 'unsupported' });
  });

  it('createSession throws UNSUPPORTED_PLATFORM', async () => {
    await expect(createSession()).rejects.toMatchObject({ code: 'UNSUPPORTED_PLATFORM' });
  });
});

describe('respond', () => {
  it('sends the prompt and generation options', async () => {
    const session = await createSession({ instructions: 'Be brief.' });
    const response = await session.respond('Hi', { temperature: 0.3, maximumResponseTokens: 20, toolCallingMode: 'disallowed' });
    expect(response.text).toBe('echo: Hi');
    expect(fake.configs[0].instructions).toBe('Be brief.');
    expect(fake.payloads[0]).toMatchObject({
      prompt: 'Hi',
      options: { temperature: 0.3, maximumResponseTokens: 20, toolCallingMode: 'disallowed' },
    });
  });

  it('maps native errors to AppleFoundationModelsError', async () => {
    fake.respondImpl = async () => {
      throw Object.assign(new Error('too long'), { code: 'CONTEXT_SIZE_EXCEEDED' });
    };
    const session = await createSession();
    const error = await session.respond('x').catch((e) => e);
    expect(isAppleFoundationModelsError(error, 'CONTEXT_SIZE_EXCEEDED')).toBe(true);
  });

  it('queues concurrent requests on one session', async () => {
    const order: string[] = [];
    fake.respondImpl = async (_id, payload) => {
      order.push(`start ${payload.prompt}`);
      await new Promise((resolve) => setTimeout(resolve, 5));
      order.push(`end ${payload.prompt}`);
      return { text: payload.prompt, usage: null, transcriptEntries: [] };
    };
    const session = await createSession();
    await Promise.all([session.respond('a'), session.respond('b')]);
    expect(order).toEqual(['start a', 'end a', 'start b', 'end b']);
  });

  it('cancels via AbortSignal', async () => {
    let requestId = '';
    fake.respondImpl = (id) =>
      new Promise((_, reject) => {
        requestId = id;
        setTimeout(() => reject(Object.assign(new Error('cancelled'), { code: 'CANCELLED' })), 10);
      });
    const session = await createSession();
    const controller = new AbortController();
    const pending = session.respond('x', { signal: controller.signal });
    await new Promise((resolve) => setTimeout(resolve, 1));
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(fake.cancelled).toContain(requestId);
  });

  it('rejects immediately when the signal is already aborted', async () => {
    const session = await createSession();
    const controller = new AbortController();
    controller.abort();
    await expect(session.respond('x', { signal: controller.signal })).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(fake.payloads).toHaveLength(0);
  });
});

describe('structured generation', () => {
  it('converts Zod schemas, keeps property order and validates the result', async () => {
    fake.respondImpl = async () => ({ json: '{"name":"Ada","age":36}', usage: null, transcriptEntries: [] });
    const session = await createSession();
    const person = await session.generateObject({
      prompt: 'Extract',
      schema: z.object({ name: z.string(), age: z.number().int() }),
    });
    expect(person).toEqual({ name: 'Ada', age: 36 });
    const schema = fake.payloads[0].schema;
    expect(schema['x-fourlyn-order']).toEqual(['name', 'age']);
    expect(schema.properties.age.maximum).toBeUndefined();
  });

  it('fails with SCHEMA_VALIDATION_FAILED when the output does not match', async () => {
    fake.respondImpl = async () => ({ json: '{"name":42}', usage: null, transcriptEntries: [] });
    const session = await createSession();
    await expect(
      session.generateObject({ prompt: 'x', schema: z.object({ name: z.string() }) }),
    ).rejects.toMatchObject({ code: 'SCHEMA_VALIDATION_FAILED' });
  });
});

describe('tools', () => {
  it('executes JS tools, including parallel calls, and reports events', async () => {
    const calls: string[] = [];
    const session = await createSession({
      tools: [
        {
          name: 'getWeather',
          description: 'Weather for a city',
          parameters: z.object({ city: z.string() }),
          execute: async ({ city }: { city: string }) => {
            calls.push(`start ${city}`);
            await new Promise((resolve) => setTimeout(resolve, 10));
            calls.push(`end ${city}`);
            return { city, temperature: 21 };
          },
        },
      ],
    });
    const events: string[] = [];
    session.on('toolCall', (e) => events.push(`call ${e.toolName}`));
    session.on('toolResult', (e) => events.push(`result ${e.toolName}`));

    const [a, b] = await Promise.all([fake.callTool('getWeather', { city: 'Delhi' }), fake.callTool('getWeather', { city: 'Mumbai' })]);
    expect(JSON.parse(a.resultJSON!)).toEqual({ city: 'Delhi', temperature: 21 });
    expect(JSON.parse(b.resultJSON!)).toEqual({ city: 'Mumbai', temperature: 21 });
    // Both started before either finished: calls are not serialized.
    expect(calls.slice(0, 2)).toEqual(['start Delhi', 'start Mumbai']);
    expect(events.filter((e) => e.startsWith('result'))).toHaveLength(2);
    expect(fake.configs[0].tools[0].parameters['x-fourlyn-order']).toEqual(['city']);
  });

  it('returns tool errors to the model instead of crashing', async () => {
    const session = await createSession({
      tools: [{ name: 'boom', description: 'fails', parameters: { type: 'object', properties: {} }, execute: () => { throw new Error('nope'); } }],
    });
    const errors: string[] = [];
    session.on('toolError', (e) => errors.push(e.error.message));
    const result = await fake.callTool('boom', {});
    expect(result).toEqual({ resultJSON: null, errorMessage: 'nope' });
    expect(errors).toEqual(['nope']);
  });

  it('rejects invalid tool arguments using the schema validator', async () => {
    const execute = jest.fn();
    await createSession({
      tools: [{ name: 'add', description: 'adds', parameters: z.object({ a: z.number() }), execute }],
    });
    const result = await fake.callTool('add', { a: 'not a number' });
    expect(result.errorMessage).toMatch(/did not match/);
    expect(execute).not.toHaveBeenCalled();
  });

  it('rejects duplicate tool names', async () => {
    const tool = { name: 't', description: '', parameters: { type: 'object' as const }, execute: () => 1 };
    await expect(createSession({ tools: [tool, tool] })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });
});

describe('streaming', () => {
  it('yields chunks and resolves the final result', async () => {
    fake.streamImpl = (requestId) => {
      fake.stream({ requestId, type: 'snapshot', text: 'Hel', delta: 'Hel' });
      fake.stream({ requestId, type: 'snapshot', text: 'Hello', delta: 'lo' });
      fake.stream({ requestId, type: 'done', result: { text: 'Hello', usage: null, transcriptEntries: [] } });
    };
    const session = await createSession();
    const stream = session.stream('Say hello');
    const deltas: (string | null)[] = [];
    for await (const chunk of stream) deltas.push(chunk.delta);
    expect(deltas).toEqual(['Hel', 'lo', '']);
    await expect(stream.result).resolves.toMatchObject({ text: 'Hello' });
  });

  it('streams partial objects', async () => {
    fake.streamImpl = (requestId) => {
      fake.stream({ requestId, type: 'snapshot', json: '{"name":"A"}' });
      fake.stream({ requestId, type: 'done', result: { json: '{"name":"Ada"}', usage: null, transcriptEntries: [] } });
    };
    const session = await createSession();
    const partials: unknown[] = [];
    for await (const chunk of session.streamObject({ prompt: 'x', schema: z.object({ name: z.string() }) })) partials.push(chunk.partial);
    expect(partials).toEqual([{ name: 'A' }, { name: 'Ada' }]);
  });

  it('cancels when the consumer breaks out of the loop', async () => {
    fake.streamImpl = (requestId) => fake.stream({ requestId, type: 'snapshot', text: 'a', delta: 'a' });
    const session = await createSession();
    const stream = session.stream('x');
    for await (const _ of stream) break;
    expect(fake.cancelled).toContain(stream.requestId);
  });

  it('surfaces native stream errors', async () => {
    fake.streamImpl = (requestId) => fake.stream({ requestId, type: 'error', error: { code: 'GUARDRAIL_VIOLATION', message: 'blocked' } });
    const session = await createSession();
    const stream = session.stream('x');
    await expect((async () => { for await (const _ of stream) { /* drain */ } })()).rejects.toMatchObject({ code: 'GUARDRAIL_VIOLATION' });
    await expect(stream.result).rejects.toMatchObject({ code: 'GUARDRAIL_VIOLATION' });
  });
});

describe('lifecycle', () => {
  it('dispose releases the native object and blocks further use', async () => {
    const session = await createSession();
    session.dispose();
    session.dispose();
    expect(fake.disposed).toBe(1);
    expect(fake.released).toBe(1);
    await expect(session.respond('x')).rejects.toMatchObject({ code: 'SESSION_DISPOSED' });
  });

  it('decodes feedback attachments to bytes', async () => {
    const session = await createSession();
    const bytes = await session.createFeedbackAttachment({ sentiment: 'positive' });
    expect(new TextDecoder().decode(bytes)).toBe('hello');
  });

  it('passes profiles with requiredToolCalls as required tool calling', async () => {
    await createSession({ profiles: { research: { requiredToolCalls: 1 }, chat: {} }, initialProfile: 'chat' });
    expect(fake.configs[0].profiles.research.toolCallingMode).toBe('required');
    expect(fake.configs[0].initialProfile).toBe('chat');
  });
});

describe('session state', () => {
  it('exposes the context size of the session model', async () => {
    const session = await createSession();
    expect(session.contextSize).toBe(4096);
  });

  it('reads the transcript synchronously', async () => {
    fake.transcript = {
      entries: [{ id: 'e1', type: 'toolCalls', calls: [{ id: 'c1', toolName: 'lookup', argumentsJSON: '{"query":"teal"}' }] }],
      json: '{"entries":[1]}',
    };
    const session = await createSession();
    expect(session.transcript).toEqual({
      entries: [{ id: 'e1', type: 'toolCalls', calls: [{ id: 'c1', toolName: 'lookup', arguments: { query: 'teal' } }] }],
      json: '{"entries":[1]}',
    });
    session.dispose();
    expect(() => session.transcript).toThrow(expect.objectContaining({ code: 'SESSION_DISPOSED' }));
  });

  it('seeds a session from plain messages', async () => {
    await createSession({
      instructions: 'Be brief.',
      messages: [
        { role: 'user', content: 'Weather in Delhi?' },
        { role: 'toolCalls', calls: [{ id: 'c1', toolName: 'getWeather', arguments: { city: 'Delhi' } }] },
        { role: 'toolOutput', id: 'c1', toolName: 'getWeather', content: '31 degrees' },
        { role: 'assistant', content: 'It is 31 degrees.' },
      ],
    });
    expect(fake.configs[0].messages).toEqual([
      { role: 'user', content: 'Weather in Delhi?' },
      { role: 'toolCalls', calls: [{ id: 'c1', toolName: 'getWeather', argumentsJSON: '{"city":"Delhi"}' }] },
      { role: 'toolOutput', id: 'c1', toolName: 'getWeather', content: '31 degrees' },
      { role: 'assistant', content: 'It is 31 degrees.' },
    ]);
  });

  it('rejects transcript and messages together', async () => {
    await expect(createSession({ transcript: '{}', messages: [{ role: 'user', content: 'x' }] })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(fake.configs).toHaveLength(0);
  });
});

describe('advanced API', () => {
  it('respondAdvanced maps options and context options and returns the full response', async () => {
    fake.respondImpl = async () => ({
      text: 'Paris',
      rawContentJSON: '"Paris"',
      usage: { inputTokens: 5, cachedInputTokens: 0, outputTokens: 1, reasoningTokens: 0, totalTokens: 6 },
      transcriptEntries: [{ id: 'r1', type: 'response', segments: [{ id: 's1', type: 'text', text: 'Paris' }] }],
    });
    const session = await createSession();
    const response = await session.respondAdvanced({
      prompt: 'Capital of France?',
      options: { temperature: 0, samplingMode: { type: 'greedy' }, toolCallingMode: 'disallowed' },
      contextOptions: { reasoningLevel: 'deep' },
      metadata: { screen: 'quiz' },
    });

    expect(fake.payloads[0]).toMatchObject({
      prompt: 'Capital of France?',
      options: { temperature: 0, samplingMode: { type: 'greedy' }, toolCallingMode: 'disallowed', reasoningLevel: 'deep' },
      metadata: { screen: 'quiz' },
    });
    expect(response).toMatchObject({ text: 'Paris', object: undefined, rawContent: 'Paris', isComplete: true, model: 'system', usage: { totalTokens: 6 } });
    expect(response.transcriptEntries.map((entry) => entry.type)).toEqual(['response']);
    expect(response.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('respondAdvanced returns a validated object when a schema is given', async () => {
    fake.respondImpl = async () => ({ json: '{"name":"Ada","age":36}', isComplete: true, usage: null, transcriptEntries: [] });
    const session = await createSession();
    const response = await session.respondAdvanced({
      prompt: 'Extract: Ada, 36',
      schema: z.object({ name: z.string(), age: z.number().int() }),
      schemaName: 'Person',
      contextOptions: { includeSchemaInPrompt: false },
    });

    expect(response.object).toEqual({ name: 'Ada', age: 36 });
    expect(response.text).toBe('{"name":"Ada","age":36}');
    expect(fake.payloads[0]).toMatchObject({ schemaName: 'Person', options: { includeSchemaInPrompt: false } });
  });

  it('respondAdvanced fails validation unless validate is false', async () => {
    fake.respondImpl = async () => ({ json: '{"name":"Ada","age":"old"}', usage: null, transcriptEntries: [] });
    const session = await createSession();
    const schema = z.object({ name: z.string(), age: z.number() });
    await expect(session.respondAdvanced({ prompt: 'x', schema })).rejects.toMatchObject({ code: 'SCHEMA_VALIDATION_FAILED' });
    await expect(session.respondAdvanced({ prompt: 'x', schema, validate: false })).resolves.toMatchObject({ object: { name: 'Ada', age: 'old' } });
  });

  it('streamAdvanced streams text chunks', async () => {
    fake.streamImpl = (requestId) => {
      fake.stream({ requestId, type: 'snapshot', text: 'Hel', delta: 'Hel' });
      fake.stream({ requestId, type: 'snapshot', text: 'Hello', delta: 'lo' });
      fake.stream({ requestId, type: 'done', result: { text: 'Hello', usage: null, transcriptEntries: [] } });
    };
    const session = await createSession();
    const chunks = [];
    const stream = session.streamAdvanced({ prompt: 'Say hello', options: { temperature: 0.5 } });
    for await (const chunk of stream) chunks.push(chunk);

    expect(chunks.map((chunk) => chunk.delta)).toEqual(['Hel', 'lo', '']);
    expect(chunks[2]).toMatchObject({ text: 'Hello', partial: undefined, isFinal: true, isComplete: true });
    await expect(stream.result).resolves.toMatchObject({ text: 'Hello', object: undefined });
  });

  it('streamAdvanced streams partial objects', async () => {
    fake.streamImpl = (requestId) => {
      fake.stream({ requestId, type: 'snapshot', json: '{"name":"Ad"}', isComplete: false });
      fake.stream({ requestId, type: 'done', result: { json: '{"name":"Ada"}', isComplete: true, usage: null, transcriptEntries: [] } });
    };
    const session = await createSession();
    const chunks = [];
    for await (const chunk of session.streamAdvanced({ prompt: 'x', schema: z.object({ name: z.string() }) })) chunks.push(chunk);

    expect(chunks[0]).toMatchObject({ partial: { name: 'Ad' }, delta: null, isFinal: false });
    expect(chunks[1]).toMatchObject({ partial: { name: 'Ada' }, text: '{"name":"Ada"}', isFinal: true });
  });
});

describe('historyTransform', () => {
  const entries = [
    { id: 'p1', type: 'prompt', segments: [] },
    { id: 'r1', type: 'response', segments: [] },
    { id: 'p2', type: 'prompt', segments: [] },
  ];

  it('tells native which profiles have a callback, without sending the function', async () => {
    await createSession({ profiles: { chat: { historyTransform: (all) => all }, plain: {} } });
    expect(fake.configs[0].profiles.chat.historyTransform).toBe(true);
    expect(fake.configs[0].profiles.plain.historyTransform).toBe(false);
  });

  it('answers with the ids of the entries the callback kept', async () => {
    const seen: string[] = [];
    await createSession({
      profiles: {
        chat: {
          historyTransform: (all, context) => {
            seen.push(context.profile, ...all.map((entry) => entry.type));
            return all.slice(-1);
          },
        },
      },
    });
    await expect(fake.transformHistory('chat', entries)).resolves.toBe('["p2"]');
    expect(seen).toEqual(['chat', 'prompt', 'response', 'prompt']);
  });

  it('accepts an async callback', async () => {
    await createSession({ profiles: { chat: { historyTransform: async (all) => all.filter((entry) => entry.type === 'prompt') } } });
    await expect(fake.transformHistory('chat', entries)).resolves.toBe('["p1","p2"]');
  });

  it('releases native with no selection when the callback throws or returns garbage', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    await createSession({
      profiles: {
        throws: {
          historyTransform: () => {
            throw new Error('boom');
          },
        },
        garbage: { historyTransform: (() => 'nope') as never },
      },
    });
    await expect(fake.transformHistory('throws', entries)).resolves.toBeNull();
    await expect(fake.transformHistory('garbage', entries)).resolves.toBeNull();
    expect(error).toHaveBeenCalledTimes(2);
    error.mockRestore();
  });

  it('releases native when the session is gone', async () => {
    const session = await createSession({ profiles: { chat: { historyTransform: (all) => all } } });
    session.dispose();
    await expect(fake.transformHistory('chat', entries)).resolves.toBeNull();
  });

  it('rejects a historyTransform that is not a function', async () => {
    await expect(createSession({ profiles: { chat: { historyTransform: 'last' as never } } })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });
});
