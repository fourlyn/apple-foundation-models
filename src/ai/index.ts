/**
 * Optional Vercel AI SDK provider (`ai` v7, language model specification v4).
 *
 * ```ts
 * import { apple } from '@fourlyn/apple-foundation-models/ai';
 * import { generateText } from 'ai';
 *
 * const { text } = await generateText({ model: apple(), prompt: 'Explain this' });
 * ```
 *
 * Only types are imported from `@ai-sdk/provider`, so the main package never depends on the AI SDK.
 * See `docs/ai-sdk.md`.
 */
import type {
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4Content,
  LanguageModelV4FinishReason,
  LanguageModelV4GenerateResult,
  LanguageModelV4Prompt,
  LanguageModelV4StreamPart,
  LanguageModelV4StreamResult,
  LanguageModelV4ToolResultOutput,
  LanguageModelV4Usage,
  SharedV4Warning,
} from '@ai-sdk/provider';

import { AppleFoundationModelsError, isAppleFoundationModelsError } from '../errors';
import { jsonSchema } from '../schema/normalize';
import type { JSONSchema, SchemaInput } from '../schema/types';
import { createSession, type Session } from '../session';
import type {
  FunctionTool,
  GenerationOptions,
  ImageInput,
  ModelSelector,
  ReasoningLevel,
  RespondOptions,
  SamplingMode,
  SessionMessage,
  SystemModelGuardrails,
  SystemModelUseCase,
  Tool,
  ToolCallingMode,
  Usage,
} from '../types';

export type AppleModelId = 'system' | 'privateCloudCompute' | 'auto';

/**
 * The shape of an AI SDK `tool({ description, inputSchema, execute })`, declared loosely so
 * tools from any AI SDK version are accepted.
 */
export type AISDKToolLike = {
  description?: string | ((options: any) => string);
  inputSchema: unknown;
  execute?: (input: any, options: any) => unknown;
};

export type AppleModelSettings = {
  useCase?: SystemModelUseCase;
  guardrails?: SystemModelGuardrails;
  /**
   * Tools the model may call. Apple runs the whole tool loop inside the session, so tools are
   * executed by this provider: register them here (they need an `execute` function), either as
   * this package's tools (`defineTool`) or as a record of AI SDK tools.
   */
  tools?: Tool[] | Record<string, AISDKToolLike>;
};

/** Per-call options: `providerOptions: { apple: { ... } }`. */
export type AppleProviderOptions = {
  reasoningLevel?: ReasoningLevel;
  toolCallingMode?: ToolCallingMode;
  samplingMode?: SamplingMode;
  includeSchemaInPrompt?: boolean;
};

export interface AppleProvider {
  (modelId?: AppleModelId, settings?: AppleModelSettings): LanguageModelV4;
  languageModel(modelId?: AppleModelId, settings?: AppleModelSettings): LanguageModelV4;
}

/** Creates a provider whose models share default settings (e.g. tools). */
export function createAppleProvider(defaults: AppleModelSettings = {}): AppleProvider {
  const languageModel = (modelId: AppleModelId = 'system', settings: AppleModelSettings = {}) =>
    new AppleLanguageModel(modelId, { ...defaults, ...settings });
  return Object.assign(languageModel, { languageModel });
}

/** The default provider: `apple()` is the on-device model, `apple('privateCloudCompute')`, `apple('auto')`. */
export const apple = createAppleProvider();

// ---------------------------------------------------------------------------
// Conversion helpers
// ---------------------------------------------------------------------------

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function bytesToBase64(bytes: Uint8Array): string {
  let output = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    output += BASE64[a >> 2] + BASE64[((a & 3) << 4) | ((b ?? 0) >> 4)];
    output += b === undefined ? '=' : BASE64[((b & 15) << 2) | ((c ?? 0) >> 6)];
    output += c === undefined ? '=' : BASE64[c & 63];
  }
  return output;
}

function invalidPrompt(message: string): AppleFoundationModelsError {
  return new AppleFoundationModelsError({ code: 'INVALID_PROMPT', message });
}

/** Converts an AI SDK input schema (Zod, Standard Schema, `jsonSchema()` or lazy) to one this package accepts. */
function toSchemaInput(schema: unknown, toolName: string): SchemaInput<unknown> {
  const resolved = typeof schema === 'function' ? (schema as () => unknown)() : schema;
  if (typeof resolved === 'object' && resolved !== null) {
    if ('~standard' in resolved) return resolved as SchemaInput<unknown>;
    const json = (resolved as { jsonSchema?: unknown }).jsonSchema;
    if (typeof json === 'object' && json !== null && typeof (json as PromiseLike<unknown>).then !== 'function') {
      return json as JSONSchema;
    }
  }
  throw new AppleFoundationModelsError({
    code: 'INVALID_SCHEMA',
    message: `Tool "${toolName}": inputSchema must be a Zod / Standard Schema or an AI SDK jsonSchema() with a synchronous JSON Schema.`,
  });
}

/** Normalizes registered tools to this package's tools. AI SDK tools without `execute` are skipped. */
function toFunctionTools(tools: AppleModelSettings['tools'], messages: unknown[]): Tool[] {
  if (!tools) return [];
  if (Array.isArray(tools)) return tools;
  const result: Tool[] = [];
  for (const [name, tool] of Object.entries(tools)) {
    const execute = tool.execute;
    if (typeof execute !== 'function') continue;
    const description = typeof tool.description === 'function' ? tool.description({ context: undefined }) : tool.description;
    const functionTool: FunctionTool = {
      name,
      description: description ?? '',
      parameters: toSchemaInput(tool.inputSchema, name),
      execute: async (args, context) => {
        const output = await execute(args, { toolCallId: context.callId, messages, abortSignal: context.signal, context: undefined });
        if (output && typeof (output as AsyncIterable<unknown>)[Symbol.asyncIterator] === 'function') {
          // Streaming tools yield preliminary results; the model gets the final one.
          let last: unknown;
          for await (const value of output as AsyncIterable<unknown>) last = value;
          return last;
        }
        return output;
      },
    };
    result.push(functionTool);
  }
  return result;
}

function toolName(tool: Tool): string {
  return 'nativeTool' in tool ? (tool.name ?? tool.nativeTool) : tool.name;
}

function toolOutputText(output: LanguageModelV4ToolResultOutput): string {
  switch (output.type) {
    case 'text':
    case 'error-text':
      return output.value;
    case 'json':
    case 'error-json':
      return JSON.stringify(output.value);
    case 'execution-denied':
      return output.reason ?? 'Tool execution was denied.';
    case 'content':
      return output.value.map((part) => (part.type === 'text' ? part.text : '')).join('');
    default:
      return '';
  }
}

type Prepared = {
  instructions: string | undefined;
  messages: SessionMessage[];
  prompt: { prompt: string; images?: ImageInput[] };
};

/** Splits an AI SDK prompt into instructions, earlier conversation and the prompt to answer. */
function preparePrompt(prompt: LanguageModelV4Prompt, warnings: SharedV4Warning[]): Prepared {
  const system: string[] = [];
  const messages: SessionMessage[] = [];
  const last = prompt[prompt.length - 1];
  if (!last || last.role !== 'user') {
    throw invalidPrompt('The Apple provider needs the conversation to end with a user message.');
  }

  for (const message of prompt.slice(0, -1)) {
    switch (message.role) {
      case 'system':
        system.push(message.content);
        break;
      case 'user': {
        if (message.content.some((part) => part.type === 'file')) {
          warnings.push({ type: 'unsupported', feature: 'files in earlier messages', details: 'Only images in the last user message are sent to the model.' });
        }
        messages.push({ role: 'user', content: message.content.map((part) => (part.type === 'text' ? part.text : '')).join('') });
        break;
      }
      case 'assistant': {
        const calls: { id: string; toolName: string; arguments: unknown }[] = [];
        const outputs: SessionMessage[] = [];
        let text = '';
        for (const part of message.content) {
          if (part.type === 'text') text += part.text;
          else if (part.type === 'tool-call') calls.push({ id: part.toolCallId, toolName: part.toolName, arguments: part.input });
          else if (part.type === 'tool-result') {
            outputs.push({ role: 'toolOutput', id: part.toolCallId, toolName: part.toolName, content: toolOutputText(part.output) });
          }
        }
        if (calls.length > 0) messages.push({ role: 'toolCalls', calls });
        messages.push(...outputs);
        if (text) messages.push({ role: 'assistant', content: text });
        break;
      }
      case 'tool':
        for (const part of message.content) {
          if (part.type === 'tool-result') {
            messages.push({ role: 'toolOutput', id: part.toolCallId, toolName: part.toolName, content: toolOutputText(part.output) });
          }
        }
        break;
    }
  }

  let text = '';
  const images: ImageInput[] = [];
  for (const part of last.content) {
    if (part.type === 'text') {
      text += part.text;
      continue;
    }
    if (!part.mediaType.startsWith('image')) {
      warnings.push({ type: 'unsupported', feature: `file input (${part.mediaType})`, details: 'Apple models accept images only.' });
      continue;
    }
    const extension = part.mediaType.split('/')[1]?.replace('jpeg', 'jpg').replace('*', '');
    if (part.data.type === 'data') {
      const base64 = typeof part.data.data === 'string' ? part.data.data : bytesToBase64(part.data.data);
      images.push({ base64, fileExtension: extension || undefined });
    } else if (part.data.type === 'url' && part.data.url.protocol === 'file:') {
      images.push({ uri: part.data.originalUrl ?? part.data.url.href });
    } else {
      warnings.push({ type: 'unsupported', feature: 'image reference', details: 'Pass images as data or as a local file:// URL.' });
    }
  }

  return {
    instructions: system.length > 0 ? system.join('\n\n') : undefined,
    messages,
    prompt: images.length > 0 ? { prompt: text, images } : { prompt: text },
  };
}

const REASONING: Record<string, ReasoningLevel | undefined> = {
  minimal: 'light',
  low: 'light',
  medium: 'moderate',
  high: 'deep',
  xhigh: 'deep',
};

function prepareOptions(options: LanguageModelV4CallOptions, warnings: SharedV4Warning[]): RespondOptions {
  const result: GenerationOptions = {};
  if (options.temperature !== undefined) result.temperature = options.temperature;
  if (options.maxOutputTokens !== undefined) result.maximumResponseTokens = options.maxOutputTokens;

  if (options.topK !== undefined) {
    result.samplingMode = { type: 'topK', k: options.topK, seed: options.seed };
    if (options.topP !== undefined) warnings.push({ type: 'unsupported', feature: 'topP', details: 'Apple samples by topK or topP, not both; topK is used.' });
  } else if (options.topP !== undefined) {
    result.samplingMode = { type: 'probabilityThreshold', probabilityThreshold: options.topP, seed: options.seed };
  } else if (options.seed !== undefined) {
    warnings.push({ type: 'unsupported', feature: 'seed', details: 'A seed only applies together with topK or topP.' });
  }

  for (const feature of ['stopSequences', 'presencePenalty', 'frequencyPenalty'] as const) {
    const value = options[feature];
    if (value !== undefined && !(Array.isArray(value) && value.length === 0)) warnings.push({ type: 'unsupported', feature });
  }

  switch (options.toolChoice?.type) {
    case 'none':
      result.toolCallingMode = 'disallowed';
      break;
    case 'required':
      result.toolCallingMode = 'required';
      warnings.push({
        type: 'compatibility',
        feature: 'toolChoice: required',
        details: 'Apple keeps calling tools until one throws; make sure a tool ends the loop.',
      });
      break;
    case 'tool':
      warnings.push({ type: 'unsupported', feature: 'toolChoice: tool', details: 'Apple cannot force a specific tool.' });
      break;
  }

  if (options.reasoning === 'none') {
    warnings.push({ type: 'unsupported', feature: 'reasoning: none', details: 'Reasoning cannot be turned off; the model default is used.' });
  } else if (options.reasoning) {
    result.reasoningLevel = REASONING[options.reasoning];
  }

  const overrides = (options.providerOptions?.apple ?? {}) as AppleProviderOptions;
  if (overrides.reasoningLevel !== undefined) result.reasoningLevel = overrides.reasoningLevel;
  if (overrides.toolCallingMode !== undefined) result.toolCallingMode = overrides.toolCallingMode;
  if (overrides.samplingMode !== undefined) result.samplingMode = overrides.samplingMode;
  if (overrides.includeSchemaInPrompt !== undefined) result.includeSchemaInPrompt = overrides.includeSchemaInPrompt;

  return { ...result, signal: options.abortSignal };
}

function toUsage(usage: Usage | null): LanguageModelV4Usage {
  if (!usage) {
    return {
      inputTokens: { total: undefined, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: undefined, text: undefined, reasoning: undefined },
    };
  }
  return {
    inputTokens: {
      total: usage.inputTokens,
      noCache: usage.inputTokens - usage.cachedInputTokens,
      cacheRead: usage.cachedInputTokens,
      cacheWrite: undefined,
    },
    outputTokens: { total: usage.outputTokens, text: usage.outputTokens - usage.reasoningTokens, reasoning: usage.reasoningTokens },
    raw: { ...usage },
  };
}

const STOP: LanguageModelV4FinishReason = { unified: 'stop', raw: undefined };

/** Apple reports safety blocks as errors; the AI SDK models them as a finish reason. */
function contentFilter(error: unknown): LanguageModelV4FinishReason | null {
  if (isAppleFoundationModelsError(error, 'GUARDRAIL_VIOLATION') || isAppleFoundationModelsError(error, 'REFUSAL')) {
    return { unified: 'content-filter', raw: error.code };
  }
  return null;
}

/** A value the AI SDK accepts as a tool result (JSON, never `null`). */
function toolResultValue(value: unknown): NonNullable<import('@ai-sdk/provider').JSONValue> {
  if (value === undefined || value === null) return '';
  return JSON.parse(JSON.stringify(value)) ?? '';
}

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

type Call = {
  session: Session;
  warnings: SharedV4Warning[];
  prompt: Prepared['prompt'];
  options: RespondOptions;
  schema: SchemaInput<unknown> | undefined;
  schemaName: string | undefined;
  /** Subscribes to tool activity as AI SDK content parts. */
  onToolContent(listener: (part: LanguageModelV4Content) => void): void;
};

class AppleLanguageModel implements LanguageModelV4 {
  readonly specificationVersion = 'v4' as const;
  readonly provider = 'apple';
  /** Local image files are read natively; the AI SDK does not need to load them. */
  readonly supportedUrls = { 'image/*': [/^file:\/\//] };

  constructor(
    readonly modelId: AppleModelId,
    private readonly settings: AppleModelSettings,
  ) {}

  private selector(): ModelSelector {
    const { useCase, guardrails } = this.settings;
    if (this.modelId === 'privateCloudCompute') return 'privateCloudCompute';
    if (useCase === undefined && guardrails === undefined) return this.modelId;
    return { type: this.modelId, useCase, guardrails };
  }

  private async prepare(options: LanguageModelV4CallOptions): Promise<Call> {
    const warnings: SharedV4Warning[] = [];
    const prepared = preparePrompt(options.prompt, warnings);
    const respondOptions = prepareOptions(options, warnings);

    const registered = toFunctionTools(this.settings.tools, options.prompt);
    const registeredNames = new Set(registered.map(toolName));
    const requested = new Set<string>();
    for (const tool of options.tools ?? []) {
      if (tool.type === 'function' && registeredNames.has(tool.name)) {
        requested.add(tool.name);
        continue;
      }
      warnings.push({
        type: 'unsupported',
        feature: `tool "${tool.name}"`,
        details:
          tool.type === 'function'
            ? 'Apple runs tools inside the session. Register the tool with the provider: apple(modelId, { tools }).'
            : 'Provider-defined tools are not supported.',
      });
    }
    // When the call names tools, only those are offered (this is how `activeTools` reaches the model).
    const tools = requested.size > 0 ? registered.filter((tool) => requested.has(toolName(tool))) : registered;

    let schema: SchemaInput<unknown> | undefined;
    let schemaName: string | undefined;
    if (options.responseFormat?.type === 'json') {
      if (options.responseFormat.schema) {
        schema = jsonSchema(options.responseFormat.schema as JSONSchema);
        schemaName = options.responseFormat.name;
      } else {
        warnings.push({ type: 'unsupported', feature: 'responseFormat: json without a schema', details: 'Apple needs a schema for structured output.' });
      }
    }

    const session = await createSession({
      model: this.selector(),
      instructions: prepared.instructions,
      tools,
      messages: prepared.messages.length > 0 ? prepared.messages : undefined,
    });

    return {
      session,
      warnings,
      prompt: prepared.prompt,
      options: respondOptions,
      schema,
      schemaName,
      onToolContent(listener) {
        const call = (event: { callId: string; toolName: string; arguments: unknown }) =>
          listener({
            type: 'tool-call',
            toolCallId: event.callId,
            toolName: event.toolName,
            input: JSON.stringify(event.arguments ?? {}),
            providerExecuted: true,
            // Tools the AI SDK call does not know about must be marked dynamic to be accepted.
            dynamic: requested.has(event.toolName) ? undefined : true,
          });
        const result = (event: { callId: string; toolName: string }, value: unknown, isError: boolean) =>
          listener({
            type: 'tool-result',
            toolCallId: event.callId,
            toolName: event.toolName,
            result: toolResultValue(value),
            isError: isError || undefined,
            dynamic: requested.has(event.toolName) ? undefined : true,
          });
        session.on('toolCall', call);
        session.on('toolResult', (event) => result(event, event.result, false));
        session.on('toolError', (event) => result(event, event.error.message, true));
      },
    };
  }

  async doGenerate(options: LanguageModelV4CallOptions): Promise<LanguageModelV4GenerateResult> {
    const call = await this.prepare(options);
    const { session } = call;
    const content: LanguageModelV4Content[] = [];
    call.onToolContent((part) => content.push(part));
    const response = { modelId: session.model, timestamp: new Date() };
    const providerMetadata = { apple: { model: session.model } };
    try {
      let text: string;
      let usage: Usage | null;
      if (call.schema) {
        const result = await session.respondWithSchema({ ...call.options, prompt: call.prompt, schema: call.schema, schemaName: call.schemaName, validate: false });
        text = JSON.stringify(result.object);
        usage = result.usage;
      } else {
        const result = await session.respond(call.prompt, call.options);
        text = result.text;
        usage = result.usage;
      }
      content.push({ type: 'text', text });
      return { content, finishReason: STOP, usage: toUsage(usage), warnings: call.warnings, response, providerMetadata };
    } catch (error) {
      const blocked = contentFilter(error);
      if (blocked) return { content, finishReason: blocked, usage: toUsage(null), warnings: call.warnings, response, providerMetadata };
      if (isAppleFoundationModelsError(error, 'CANCELLED') && options.abortSignal?.aborted) throw options.abortSignal.reason ?? error;
      throw error;
    } finally {
      session.dispose();
    }
  }

  async doStream(options: LanguageModelV4CallOptions): Promise<LanguageModelV4StreamResult> {
    const call = await this.prepare(options);
    const { session } = call;
    let cancel = () => session.dispose();

    const stream = new ReadableStream<LanguageModelV4StreamPart>({
      start: async (controller) => {
        controller.enqueue({ type: 'stream-start', warnings: call.warnings });
        controller.enqueue({ type: 'response-metadata', modelId: session.model, timestamp: new Date() });
        call.onToolContent((part) => controller.enqueue(part as LanguageModelV4StreamPart));
        const providerMetadata = { apple: { model: session.model } };
        let block = 0;
        let open = false;
        const openBlock = () => {
          controller.enqueue({ type: 'text-start', id: `text-${block}` });
          open = true;
        };
        const closeBlock = () => {
          if (!open) return;
          controller.enqueue({ type: 'text-end', id: `text-${block}` });
          open = false;
          block += 1;
        };
        const write = (delta: string) => {
          if (!delta) return;
          if (!open) openBlock();
          controller.enqueue({ type: 'text-delta', id: `text-${block}`, delta });
        };

        try {
          let usage: Usage | null;
          if (call.schema) {
            // Partial objects are not valid JSON prefixes of the final object, so the JSON is sent once, complete.
            const response = await session.respondWithSchema({ ...call.options, prompt: call.prompt, schema: call.schema, schemaName: call.schemaName, validate: false });
            write(JSON.stringify(response.object));
            usage = response.usage;
          } else {
            const source = session.stream(call.prompt, call.options);
            cancel = () => {
              source.cancel();
              session.dispose();
            };
            for await (const chunk of source) {
              if (chunk.isFinal) continue;
              if (chunk.replaced) {
                // The model rewrote earlier text, and text already sent cannot be taken back:
                // the new full text goes out as a separate block.
                closeBlock();
                write(chunk.text);
              } else {
                write(chunk.delta ?? '');
              }
            }
            usage = (await source.result).usage;
          }
          closeBlock();
          controller.enqueue({ type: 'finish', finishReason: STOP, usage: toUsage(usage), providerMetadata });
          controller.close();
        } catch (error) {
          closeBlock();
          const blocked = contentFilter(error);
          if (blocked) {
            controller.enqueue({ type: 'finish', finishReason: blocked, usage: toUsage(null), providerMetadata });
            controller.close();
          } else if (isAppleFoundationModelsError(error, 'CANCELLED') && options.abortSignal?.aborted) {
            controller.error(options.abortSignal.reason ?? error);
          } else {
            controller.enqueue({ type: 'error', error });
            controller.close();
          }
        } finally {
          session.dispose();
        }
      },
      cancel: () => cancel(),
    });

    return { stream };
  }
}
