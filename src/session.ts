import { AppleFoundationModelsError, cancelledError } from './errors';
import { Channel } from './internal/channel';
import { nextRequestId, registerSession, registerStream } from './internal/events';
import { requireNative, unwrap, type NativeAppleFoundationModels, type NativeResult, type NativeSessionHandle, type NativeToolCallEvent, type NativeProfileEvent } from './native';
import { resolveSchema, type ResolvedSchema } from './schema/normalize';
import type { InferSchema, SchemaInput } from './schema/types';
import { prepareTools, type PreparedTool } from './tools';
import { convertEntries, convertEntry, transcriptJSON, type Transcript } from './transcript';
import type {
  DeepPartial,
  FeedbackInput,
  FunctionTool,
  GenerationOptions,
  ObjectResponse,
  ObjectStreamChunk,
  ProfileEvent,
  PromptInput,
  ResolvedModelKind,
  Response,
  RespondOptions,
  SessionOptions,
  SessionState,
  StreamChunk,
  ToolCallEvent,
  ToolErrorEvent,
  ToolResultEvent,
  Usage,
} from './types';

/**
 * A streaming response. Iterate it with `for await`, and/or await `result` for the final response.
 * Breaking out of the loop or calling `cancel()` cancels generation.
 */
export type ResponseStream<Chunk, Result> = AsyncIterable<Chunk> & {
  readonly requestId: string;
  /** Resolves with the final response once generation completes. */
  readonly result: Promise<Result>;
  cancel(): void;
};

type SessionEvents = {
  toolCall: ToolCallEvent;
  toolResult: ToolResultEvent;
  toolError: ToolErrorEvent;
  profile: ProfileEvent;
};

type ObjectRequest<S> = RespondOptions & {
  prompt: PromptInput;
  schema: S;
  schemaName?: string;
  validate?: boolean;
};

const GENERATION_KEYS: (keyof GenerationOptions)[] = [
  'temperature',
  'maximumResponseTokens',
  'samplingMode',
  'toolCallingMode',
  'reasoningLevel',
  'includeSchemaInPrompt',
];

function pickGenerationOptions(options: object | undefined): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (!options) return result;
  for (const key of GENERATION_KEYS) {
    const value = (options as Record<string, unknown>)[key];
    if (value !== undefined) result[key] = value;
  }
  return result;
}

function parseJSON(value: string | undefined): unknown {
  if (value === undefined) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function buildPayload(prompt: PromptInput, options: RespondOptions | undefined, schema?: ResolvedSchema<unknown>, schemaName?: string): string {
  const text = typeof prompt === 'string' ? prompt : prompt?.prompt;
  if (typeof text !== 'string') {
    throw new AppleFoundationModelsError({ code: 'INVALID_PROMPT', message: 'The prompt must be a string or { prompt: string, images? }.' });
  }
  const images = typeof prompt === 'string' ? undefined : prompt.images;
  return JSON.stringify({
    prompt: text,
    images,
    options: pickGenerationOptions(options),
    schema: schema?.jsonSchema,
    schemaName,
    metadata: options?.metadata,
  });
}

/**
 * A conversation with an Apple model. Wraps `LanguageModelSession`.
 * Create with `createSession()`; call `dispose()` when done.
 */
export class Session {
  /** Unique native session identifier. */
  readonly id: string;
  /** The model actually used (relevant for `model: 'auto'`). */
  readonly model: ResolvedModelKind;

  private handle: NativeSessionHandle | null;
  private readonly native: NativeAppleFoundationModels;
  private readonly tools = new Map<string, NonNullable<PreparedTool['js']>>();
  private readonly listeners: { [K in keyof SessionEvents]: Set<(event: SessionEvents[K]) => void> } = {
    toolCall: new Set(),
    toolResult: new Set(),
    toolError: new Set(),
    profile: new Set(),
  };
  private readonly requestControllers = new Map<string, AbortController>();
  private readonly queueRequests: boolean;
  private queue: Promise<unknown> = Promise.resolve();
  private unregister: () => void;

  /** @internal Use `createSession()`. */
  constructor(internal: { native: NativeAppleFoundationModels; handle: NativeSessionHandle; id: string; model: ResolvedModelKind; tools: PreparedTool[]; queueRequests: boolean }) {
    this.native = internal.native;
    this.handle = internal.handle;
    this.id = internal.id;
    this.model = internal.model;
    this.queueRequests = internal.queueRequests;
    for (const prepared of internal.tools) {
      if (prepared.js) this.tools.set(prepared.js.tool.name, prepared.js);
    }
    this.unregister = registerSession(this.id, {
      onToolCall: (event) => void this.handleToolCall(event),
      onProfileEvent: (event) => this.handleProfileEvent(event),
    });
  }

  /** @internal */
  static async create(options: SessionOptions = {}): Promise<Session> {
    const native = requireNative();
    const tools = prepareTools(options.tools);
    const config = {
      instructions: options.instructions,
      model: options.model,
      tools: tools.map((tool) => tool.descriptor),
      transcriptJSON: options.transcript ? transcriptJSON(options.transcript) : undefined,
      profiles: options.profiles
        ? Object.fromEntries(
            Object.entries(options.profiles).map(([name, profile]) => [
              name,
              { ...profile, toolCallingMode: profile.requiredToolCalls !== undefined ? 'required' : profile.toolCallingMode },
            ]),
          )
        : undefined,
      initialProfile: options.initialProfile,
      transcriptErrorHandling: options.transcriptErrorHandling,
    };
    const handle = native.createNativeSession();
    let configured: { sessionId: string; model: ResolvedModelKind };
    try {
      configured = unwrap(await native.configureSession(handle, JSON.stringify(config)));
    } catch (error) {
      handle.release();
      throw error;
    }
    const session = new Session({
      native,
      handle,
      id: configured.sessionId,
      model: configured.model,
      tools,
      queueRequests: options.queueRequests ?? true,
    });
    if (options.prewarm) {
      await session.prewarm(typeof options.prewarm === 'object' ? options.prewarm : undefined);
    }
    return session;
  }

  // ---------------------------------------------------------------------------
  // Text generation
  // ---------------------------------------------------------------------------

  /**
   * Generates a response. Maps to `LanguageModelSession.respond(to:options:)`.
   *
   * ```ts
   * const { text } = await session.respond('Summarize this: ...', { temperature: 0.2 });
   * ```
   */
  async respond(prompt: PromptInput, options?: RespondOptions): Promise<Response> {
    const raw = await this.run(prompt, options);
    return {
      text: raw.text ?? '',
      usage: (raw.usage as Usage | null) ?? null,
      transcriptEntries: convertEntries(raw.transcriptEntries),
      rawContent: parseJSON(raw.rawContentJSON),
    };
  }

  /**
   * Streams a response. Maps to `LanguageModelSession.streamResponse(to:options:)`.
   *
   * ```ts
   * for await (const chunk of session.stream('Write a haiku')) setText(chunk.text);
   * ```
   */
  stream(prompt: PromptInput, options?: RespondOptions): ResponseStream<StreamChunk, Response> {
    return this.startStream<StreamChunk, Response>(prompt, options, undefined, undefined, (event) => ({
      text: event.text ?? '',
      delta: event.delta ?? null,
      replaced: event.replaced === true,
      isFinal: false,
    }), async (raw) => ({
      text: raw.text ?? '',
      usage: (raw.usage as Usage | null) ?? null,
      transcriptEntries: convertEntries(raw.transcriptEntries),
      rawContent: raw.text ?? '',
    }), (final) => ({ text: final.text, delta: '', replaced: false, isFinal: true }));
  }

  // ---------------------------------------------------------------------------
  // Structured generation
  // ---------------------------------------------------------------------------

  /**
   * Generates an object matching a schema (JSON Schema, Zod, or any Standard JSON Schema).
   * Returns the full response; use `generateObject()` to get just the object.
   * Maps to `respond(to:schema:options:)` with a `DynamicGenerationSchema`.
   */
  async respondWithSchema<S extends SchemaInput<any>>(request: ObjectRequest<S>): Promise<ObjectResponse<InferSchema<S>>> {
    const schema = resolveSchema(request.schema) as ResolvedSchema<InferSchema<S>>;
    const raw = await this.run(request.prompt, request, schema, request.schemaName);
    return this.toObjectResponse(raw, schema, request.validate ?? true);
  }

  /**
   * Generates an object matching a schema and returns it.
   *
   * ```ts
   * const person = await session.generateObject({
   *   prompt: 'Extract: John is 42',
   *   schema: z.object({ name: z.string(), age: z.number() }),
   * }); // { name: 'John', age: 42 }
   * ```
   */
  async generateObject<S extends SchemaInput<any>>(request: ObjectRequest<S>): Promise<InferSchema<S>> {
    return (await this.respondWithSchema(request)).object;
  }

  /**
   * Streams a structured object; each chunk contains the partially generated object.
   * Maps to `streamResponse(to:schema:)`.
   */
  streamObject<S extends SchemaInput<any>>(request: ObjectRequest<S>): ResponseStream<ObjectStreamChunk<InferSchema<S>>, ObjectResponse<InferSchema<S>>> {
    const schema = resolveSchema(request.schema) as ResolvedSchema<InferSchema<S>>;
    return this.startStream<ObjectStreamChunk<InferSchema<S>>, ObjectResponse<InferSchema<S>>>(
      request.prompt,
      request,
      schema,
      request.schemaName,
      (event) => ({
        partial: (parseJSON(event.json) ?? {}) as DeepPartial<InferSchema<S>>,
        isComplete: event.isComplete === true,
        isFinal: false,
      }),
      (raw) => this.toObjectResponse(raw, schema, request.validate ?? true),
      (final) => ({ partial: final.object as DeepPartial<InferSchema<S>>, isComplete: true, isFinal: true }),
    );
  }

  // ---------------------------------------------------------------------------
  // Session management
  // ---------------------------------------------------------------------------

  /**
   * Loads model resources ahead of the first request to reduce latency. Optionally caches
   * a known prompt prefix. Maps to `LanguageModelSession.prewarm(promptPrefix:)`.
   * Only useful when you expect a request soon (e.g. when the user focuses a text field).
   */
  async prewarm(options?: { promptPrefix?: string }): Promise<void> {
    unwrap(await this.native.prewarm(this.requireHandle(), options?.promptPrefix ?? null));
  }

  /** Current transcript. Persist `transcript.json` to restore with `createSession({ transcript })`. */
  async getTranscript(): Promise<Transcript> {
    const raw = unwrap(await this.native.getTranscript(this.requireHandle()));
    return { entries: convertEntries(raw.entries), json: raw.json ?? '' };
  }

  /** Synchronous snapshot of the session state. */
  getState(): SessionState {
    const raw = unwrap(this.native.getSessionState(this.requireHandle())) as SessionState;
    return { ...raw, usage: raw.usage ?? null };
  }

  /** Maps to `LanguageModelSession.isResponding`. */
  get isResponding(): boolean {
    return this.getState().isResponding;
  }

  /** Cumulative session usage (iOS 27+), otherwise `null`. Maps to `LanguageModelSession.usage`. */
  get usage(): Usage | null {
    return this.getState().usage;
  }

  /** Same as `usage`, as a promise (PRD compatibility). */
  async getUsage(): Promise<Usage | null> {
    return this.usage;
  }

  /** Switches the active dynamic profile (iOS 27+). Takes effect on the next request. */
  setProfile(name: string): void {
    unwrap(this.native.setActiveProfile(this.requireHandle(), name));
  }

  /** Name of the active profile, if the session uses profiles. */
  get activeProfile(): string | undefined {
    return this.getState().activeProfile;
  }

  /**
   * Creates a feedback attachment (the transcript plus your feedback) for Apple's Feedback Assistant.
   * Maps to `LanguageModelSession.logFeedbackAttachment(...)`. Nothing is sent anywhere by this package.
   */
  async createFeedbackAttachment(feedback: FeedbackInput = {}): Promise<Uint8Array> {
    const base64 = unwrap(await this.native.createFeedbackAttachment(this.requireHandle(), JSON.stringify(feedback)));
    return base64ToBytes(base64);
  }

  /** Subscribes to session events. Returns an unsubscribe function. */
  on<K extends keyof SessionEvents>(event: K, handler: (event: SessionEvents[K]) => void): () => void {
    this.listeners[event].add(handler);
    return () => this.listeners[event].delete(handler);
  }

  get isDisposed(): boolean {
    return this.handle === null;
  }

  /** Cancels in-flight requests and frees native resources. Safe to call twice. */
  dispose(): void {
    const handle = this.handle;
    if (!handle) return;
    this.handle = null;
    for (const controller of this.requestControllers.values()) controller.abort();
    this.requestControllers.clear();
    this.native.disposeSession(handle);
    this.unregister();
    handle.release();
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private requireHandle(): NativeSessionHandle {
    if (!this.handle) {
      throw new AppleFoundationModelsError({ code: 'SESSION_DISPOSED', message: 'The session has been disposed.' });
    }
    return this.handle;
  }

  /** Runs `task` after previous requests when queuing is enabled. */
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    if (!this.queueRequests) return task();
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private run(prompt: PromptInput, options: RespondOptions | undefined, schema?: ResolvedSchema<unknown>, schemaName?: string): Promise<NativeResult> {
    const payload = buildPayload(prompt, options, schema, schemaName);
    const signal = options?.signal;
    if (signal?.aborted) return Promise.reject(cancelledError());
    return this.enqueue(async () => {
      if (signal?.aborted) throw cancelledError();
      const handle = this.requireHandle();
      const requestId = nextRequestId();
      const controller = new AbortController();
      this.requestControllers.set(requestId, controller);
      const onAbort = () => {
        controller.abort();
        if (this.handle) this.native.cancelRequest(this.handle, requestId);
      };
      signal?.addEventListener('abort', onAbort);
      try {
        return unwrap(await this.native.respond(handle, requestId, payload));
      } finally {
        signal?.removeEventListener('abort', onAbort);
        this.requestControllers.delete(requestId);
      }
    });
  }

  private startStream<Chunk, Result>(
    prompt: PromptInput,
    options: RespondOptions | undefined,
    schema: ResolvedSchema<unknown> | undefined,
    schemaName: string | undefined,
    toChunk: (event: { text?: string; delta?: string | null; replaced?: boolean; json?: string; isComplete?: boolean }) => Chunk,
    toResult: (raw: NativeResult) => Promise<Result>,
    finalChunk: (result: Result) => Chunk,
  ): ResponseStream<Chunk, Result> {
    const requestId = nextRequestId();
    const payload = buildPayload(prompt, options, schema, schemaName);
    const signal = options?.signal;
    let cancelled = false;
    let started = false;

    const cancel = () => {
      if (cancelled) return;
      cancelled = true;
      this.requestControllers.get(requestId)?.abort();
      if (started && this.handle) this.native.cancelRequest(this.handle, requestId);
      if (!started) channel.fail(cancelledError());
    };

    const channel = new Channel<Chunk>(cancel);
    let resolveResult!: (value: Result) => void;
    let rejectResult!: (error: unknown) => void;
    const result = new Promise<Result>((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });
    // Consumers may only iterate; avoid unhandled rejections on `result`.
    result.catch(() => undefined);

    const fail = (error: unknown) => {
      channel.fail(error);
      rejectResult(error);
    };

    if (signal?.aborted) {
      fail(cancelledError());
    } else {
      signal?.addEventListener('abort', cancel);
      this.enqueue(
        () =>
          new Promise<void>((settled) => {
            const finish = () => {
              unsubscribe();
              signal?.removeEventListener('abort', cancel);
              this.requestControllers.delete(requestId);
              settled();
            };
            const unsubscribe = registerStream(requestId, (event) => {
              if (event.type === 'snapshot') {
                channel.push(toChunk(event));
              } else if (event.type === 'done') {
                toResult(event.result).then(
                  (final) => {
                    channel.push(finalChunk(final));
                    channel.close();
                    resolveResult(final);
                    finish();
                  },
                  (error) => {
                    fail(error);
                    finish();
                  },
                );
              } else {
                fail(AppleFoundationModelsError.fromNative(event.error));
                finish();
              }
            });
            if (cancelled) {
              fail(cancelledError());
              finish();
              return;
            }
            try {
              const handle = this.requireHandle();
              this.requestControllers.set(requestId, new AbortController());
              started = true;
              unwrap(this.native.startStream(handle, requestId, payload));
            } catch (error) {
              fail(error);
              finish();
            }
          }),
      );
    }

    const stream = {
      requestId,
      result,
      cancel,
      [Symbol.asyncIterator]: () => channel[Symbol.asyncIterator](),
    };
    return stream;
  }

  private async toObjectResponse<T>(raw: NativeResult, schema: ResolvedSchema<T>, validate: boolean): Promise<ObjectResponse<T>> {
    const rawContent = parseJSON(raw.json);
    const object = validate && schema.validate ? await schema.validate(rawContent) : (rawContent as T);
    return {
      object,
      usage: (raw.usage as Usage | null) ?? null,
      transcriptEntries: convertEntries(raw.transcriptEntries),
      rawContent: parseJSON(raw.rawContentJSON) ?? rawContent,
      isComplete: raw.isComplete ?? true,
    };
  }

  private emit<K extends keyof SessionEvents>(event: K, payload: SessionEvents[K]): void {
    for (const handler of this.listeners[event]) {
      try {
        (handler as (event: SessionEvents[K]) => void)(payload);
      } catch (error) {
        console.error(`[apple-foundation-models] "${event}" listener threw`, error);
      }
    }
  }

  private async handleToolCall(event: NativeToolCallEvent): Promise<void> {
    const started = Date.now();
    const entry = this.tools.get(event.toolName);
    let args: unknown = parseJSON(event.argumentsJSON);
    const base: ToolCallEvent = { callId: event.callId, requestId: event.requestId, toolName: event.toolName, arguments: args };
    if (!entry) {
      this.native.resolveToolCall(event.callId, null, `Unknown tool "${event.toolName}".`);
      return;
    }
    this.emit('toolCall', base);
    const controller = (event.requestId && this.requestControllers.get(event.requestId)) || new AbortController();
    try {
      const tool: FunctionTool = entry.tool;
      if ((tool.validateArguments ?? true) && entry.schema.validate) {
        args = await entry.schema.validate(args);
      }
      const result = await tool.execute(args, { callId: event.callId, requestId: event.requestId, signal: controller.signal });
      const json = JSON.stringify(result === undefined ? null : result);
      this.native.resolveToolCall(event.callId, json, null);
      this.emit('toolResult', { ...base, arguments: args, result, durationMs: Date.now() - started });
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      this.native.resolveToolCall(event.callId, null, error.message || 'Tool execution failed.');
      this.emit('toolError', { ...base, error, durationMs: Date.now() - started });
    }
  }

  private handleProfileEvent(event: NativeProfileEvent): void {
    this.emit('profile', {
      profile: event.profile,
      event: event.event as ProfileEvent['event'],
      entry: event.entry ? convertEntry(event.entry) : undefined,
      toolName: event.toolName,
      callId: event.callId,
      arguments: event.argumentsJSON !== undefined ? parseJSON(event.argumentsJSON) : undefined,
    });
  }
}

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function base64ToBytes(base64: string): Uint8Array {
  const clean = base64.replace(/[^A-Za-z0-9+/]/g, '');
  const bytes = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let buffer = 0;
  let bits = 0;
  let index = 0;
  for (const char of clean) {
    buffer = (buffer << 6) | BASE64.indexOf(char);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[index++] = (buffer >> bits) & 0xff;
    }
  }
  return bytes.subarray(0, index);
}

/** Creates a session. See `SessionOptions`. */
export function createSession(options?: SessionOptions): Promise<Session> {
  return Session.create(options);
}
