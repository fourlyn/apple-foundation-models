import type { JSONSchema, SchemaInput } from './schema/types';
import type { TranscriptEntry, Transcript } from './transcript';

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

/**
 * Use case of the on-device system model. Maps to `SystemLanguageModel.UseCase`.
 * - `general`: default assistant-style generation.
 * - `contentTagging`: specialized for tagging / classification / extraction of topics.
 */
export type SystemModelUseCase = 'general' | 'contentTagging';

/**
 * Guardrail configuration. Maps to `SystemLanguageModel.Guardrails`.
 * - `default`: Apple's standard guardrails.
 * - `permissiveContentTransformations`: relaxes guardrails for transforming user-provided
 *   content (e.g. summarizing or rewriting text that itself contains sensitive material).
 */
export type SystemModelGuardrails = 'default' | 'permissiveContentTransformations';

/**
 * Model selector.
 * - `"system"`: Apple's on-device model (`SystemLanguageModel.default`).
 * - `"privateCloudCompute"`: Apple's server model on Private Cloud Compute (iOS 27+, entitlement required).
 * - `"auto"`: **Fourlyn abstraction, not an Apple API.** Uses the on-device model when available,
 *   otherwise Private Cloud Compute when available, otherwise fails with `MODEL_UNAVAILABLE`.
 */
export type ModelSelector =
  | 'system'
  | 'privateCloudCompute'
  | 'auto'
  | { type: 'system'; useCase?: SystemModelUseCase; guardrails?: SystemModelGuardrails }
  | { type: 'privateCloudCompute' }
  | { type: 'auto'; useCase?: SystemModelUseCase; guardrails?: SystemModelGuardrails };

export type ResolvedModelKind = 'system' | 'privateCloudCompute';

/** Native reasons (mirrors Apple's `UnavailableReason` enums) plus `unsupported` for non-Apple platforms / old OS. */
export type UnavailableReason =
  | 'deviceNotEligible'
  | 'appleIntelligenceNotEnabled'
  | 'modelNotReady'
  | 'systemNotReady'
  | 'unsupported'
  | 'unknown';

export type Availability =
  | { status: 'available'; available: true; model?: ResolvedModelKind }
  | {
      status: 'unavailable';
      available: false;
      reason: UnavailableReason;
      /** Apple's raw enum description, when available. */
      nativeReason?: string;
      model?: ResolvedModelKind;
    };

export type ModelCapabilities = {
  vision: boolean;
  guidedGeneration: boolean;
  reasoning: boolean;
  toolCalling: boolean;
};

export type ModelVariant = {
  /** `core3` (AFM 3 Core) or `coreAdvanced3` (AFM 3 Core Advanced), `unknown` for future variants. */
  id: 'core3' | 'coreAdvanced3' | 'unknown';
  displayName: string;
};

export type PrivateCloudComputeQuota = {
  status: 'belowLimit' | 'limitReached' | 'unknown';
  isLimitReached: boolean;
  isApproachingLimit: boolean;
  /** ISO-8601 date when the quota resets, if known. */
  resetDate: string | null;
  /** Whether Apple offers the user a way to increase their limit. */
  canRequestLimitIncrease: boolean;
};

export type ModelInfo = {
  model: ResolvedModelKind;
  availability: Availability;
  isAvailable: boolean;
  /** Context window in tokens. `null` when it cannot be determined. */
  contextSize: number | null;
  /** BCP-47 language identifiers, e.g. `["de", "en", "fr"]`. `null` when unknown. */
  supportedLanguages: string[] | null;
  /** iOS 27+. `null` on older systems. */
  variant?: ModelVariant | null;
  /** iOS 27+. `null` on older systems. */
  capabilities: ModelCapabilities | null;
  useCase?: SystemModelUseCase;
  guardrails?: SystemModelGuardrails;
  /** Private Cloud Compute only. */
  quota?: PrivateCloudComputeQuota;
};

// ---------------------------------------------------------------------------
// Generation options
// ---------------------------------------------------------------------------

/** Maps to `GenerationOptions.SamplingMode`. */
export type SamplingMode =
  | { type: 'greedy' }
  | { type: 'topK'; k: number; seed?: number }
  | { type: 'probabilityThreshold'; probabilityThreshold: number; seed?: number };

/**
 * Maps to `GenerationOptions.ToolCallingMode` (iOS 27+).
 * - `allowed` (default): the model may call tools.
 * - `required`: the model must call a tool before responding. **You need an exit strategy**:
 *   throw from a tool, or use a profile with `requiredToolCalls`. Otherwise the model keeps calling tools.
 * - `disallowed`: the model answers from its own knowledge only.
 */
export type ToolCallingMode = 'allowed' | 'required' | 'disallowed';

/** Maps to `ContextOptions.ReasoningLevel` (iOS 27+, models with the `reasoning` capability). */
export type ReasoningLevel = 'light' | 'moderate' | 'deep' | { custom: string };

export type GenerationOptions = {
  /** 0 = deterministic-ish, higher = more varied. Maps to `GenerationOptions.temperature`. */
  temperature?: number;
  /** Hard cap on response tokens. Maps to `GenerationOptions.maximumResponseTokens`. */
  maximumResponseTokens?: number;
  samplingMode?: SamplingMode;
  /** iOS 27+. */
  toolCallingMode?: ToolCallingMode;
  /** iOS 27+. Maps to `ContextOptions.reasoningLevel`. */
  reasoningLevel?: ReasoningLevel;
  /**
   * Whether the schema is also described in the prompt for structured generation.
   * Apple's default is `true`. Set to `false` when your instructions already describe
   * the format, to save tokens.
   */
  includeSchemaInPrompt?: boolean;
};

export type ImageInput =
  | { uri: string; label?: string }
  | { base64: string; label?: string; fileExtension?: string };

/** A prompt: either a string or an object with images (iOS 27+). */
export type PromptInput =
  | string
  | {
      prompt: string;
      /** iOS 27+. Local file URIs are preferred: large images never cross the JS bridge. */
      images?: ImageInput[];
    };

export type RespondOptions = GenerationOptions & {
  /** Cancels the request. Rejects with `AppleFoundationModelsError` code `CANCELLED`. */
  signal?: AbortSignal;
  /** iOS 27+. Arbitrary JSON metadata attached to the prompt transcript entry. */
  metadata?: Record<string, unknown>;
};

export type ObjectRespondOptions<T> = RespondOptions & {
  schema: SchemaInput<T>;
  /** Name used for the root schema (appears in transcripts). Default `"Response"`. */
  schemaName?: string;
  /**
   * Validate the result with the schema's Standard Schema validator (e.g. Zod) when available.
   * Default `true`.
   */
  validate?: boolean;
};

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

/**
 * Token usage. Maps to `LanguageModelSession.Usage` (iOS 27+). Only Apple's real numbers are exposed.
 */
export type Usage = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
};

export type Response = {
  text: string;
  /** Usage for this response (iOS 27+), otherwise `null`. */
  usage: Usage | null;
  /** Transcript entries produced by this request (prompt, tool calls, tool outputs, response...). */
  transcriptEntries: TranscriptEntry[];
  /** Apple's `GeneratedContent` for the response, as JSON. */
  rawContent: unknown;
};

export type ObjectResponse<T> = {
  object: T;
  usage: Usage | null;
  transcriptEntries: TranscriptEntry[];
  /** Apple's `GeneratedContent`, parsed from JSON (identical to `object` before validation). */
  rawContent: unknown;
  /** Apple's `GeneratedContent.isComplete`. */
  isComplete: boolean;
};

export type StreamChunk = {
  /** The full text generated so far. */
  text: string;
  /** Text appended since the previous chunk. `null` when the model revised earlier text (`replaced: true`). */
  delta: string | null;
  /** `true` when the model rewrote earlier output: replace your UI text instead of appending. */
  replaced: boolean;
  isFinal: boolean;
};

export type ObjectStreamChunk<T> = {
  /** The partially generated object so far. Fields appear as they are generated. */
  partial: DeepPartial<T>;
  isComplete: boolean;
  isFinal: boolean;
};

export type DeepPartial<T> = T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T;

// ---------------------------------------------------------------------------
// Advanced API
// ---------------------------------------------------------------------------

/** Maps to Apple's `ContextOptions` (iOS 27+). */
export type ContextOptions = {
  reasoningLevel?: ReasoningLevel;
  /** Whether the schema is also described in the prompt. Apple's default is `true`. */
  includeSchemaInPrompt?: boolean;
};

/**
 * One request object mirroring the arguments of Apple's
 * `respond(to:schema:options:contextOptions:metadata:)`. Used by `session.respondAdvanced()`
 * and `session.streamAdvanced()`.
 */
export type AdvancedRequest<S = undefined> = {
  prompt: string;
  /** iOS 27+. */
  images?: ImageInput[];
  /** Maps to `GenerationSchema`. Omit for plain text. */
  schema?: S;
  /** Name of the root schema. Default `"Response"`. */
  schemaName?: string;
  /** Validate the object with the schema's validator (e.g. Zod). Default `true`. */
  validate?: boolean;
  /** Maps to `GenerationOptions`. */
  options?: Pick<GenerationOptions, 'temperature' | 'maximumResponseTokens' | 'samplingMode' | 'toolCallingMode'>;
  /** Maps to `ContextOptions` (iOS 27+). */
  contextOptions?: ContextOptions;
  /** iOS 27+. JSON metadata attached to the prompt transcript entry. */
  metadata?: Record<string, unknown>;
  signal?: AbortSignal;
};

/** Everything Apple returns for a request, plus timing. `T` is `undefined` for plain text. */
export type AdvancedResponse<T> = {
  /** The response text. For structured requests, the generated object as JSON. */
  text: string;
  /** The generated object (structured requests only). */
  object: T;
  /** Apple's `GeneratedContent`, before schema validation. */
  rawContent: unknown;
  /** Apple's `GeneratedContent.isComplete`. */
  isComplete: boolean;
  usage: Usage | null;
  transcriptEntries: TranscriptEntry[];
  /** The model that produced the response. */
  model: ResolvedModelKind;
  /** Wall-clock time from the call to the response, including time spent queued. */
  durationMs: number;
};

export type AdvancedStreamChunk<T> = {
  /** The full text so far. For structured requests, the partial object as JSON. */
  text: string;
  /** Text appended since the previous chunk. `null` for structured requests and when `replaced` is `true`. */
  delta: string | null;
  replaced: boolean;
  /** The partially generated object (structured requests only). */
  partial: DeepPartial<T> | undefined;
  /** Apple's `GeneratedContent` snapshot. */
  rawContent: unknown;
  isComplete: boolean;
  isFinal: boolean;
};

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

export type ToolExecutionContext = {
  /** Unique ID of this tool call. */
  callId: string;
  /** The request that triggered the call, if known. */
  requestId: string | null;
  /** Aborted when the triggering request is cancelled. */
  signal: AbortSignal;
};

/** A tool implemented in JavaScript. */
export type FunctionTool<Args = any> = {
  name: string;
  description: string;
  /** JSON Schema (or a Standard Schema such as Zod) describing the arguments object. */
  parameters: SchemaInput<Args>;
  /**
   * Returns the tool output given to the model. Strings are passed verbatim;
   * other values are serialized as structured content.
   */
  execute: (args: Args, context: ToolExecutionContext) => unknown | Promise<unknown>;
  /** Whether the argument schema is included in the instructions. Apple default: `true`. */
  includesSchemaInInstructions?: boolean;
  /** Validate arguments with the Standard Schema validator (if any) before `execute`. Default `true`. */
  validateArguments?: boolean;
};

/** A tool implemented natively by Apple (see `OCRTool`, `BarcodeReaderTool`). */
export type NativeTool = {
  nativeTool: 'vision.ocr' | 'vision.barcodeReader';
  name?: string;
  description?: string;
};

export type Tool = FunctionTool | NativeTool;

export type ToolCallEvent = {
  callId: string;
  requestId: string | null;
  toolName: string;
  arguments: unknown;
};

export type ToolResultEvent = ToolCallEvent & { result: unknown; durationMs: number };
export type ToolErrorEvent = ToolCallEvent & { error: Error; durationMs: number };

// ---------------------------------------------------------------------------
// Dynamic profiles (iOS 27+)
// ---------------------------------------------------------------------------

/**
 * Declarative history transform applied to what the model sees (the global transcript is untouched).
 * Maps to `DynamicProfile.historyTransform`.
 */
export type HistoryStrategy = {
  /**
   * The current turn (latest prompt and its tool calls so far) is always kept.
   * - `all` (default): full history.
   * - `none`: instructions + the current turn only.
   * - `last`: the last `count` entries.
   * - `lastTurns`: the last `count` turns, including the current one (keeps tool calls with their turn).
   */
  strategy: 'all' | 'none' | 'last' | 'lastTurns';
  count?: number;
  dropToolCalls?: boolean;
  dropReasoning?: boolean;
};

/**
 * Low-level history callback. Maps to `DynamicProfile.historyTransform`.
 *
 * Receives the entries the model is about to see (after the profile's `history` strategy)
 * and returns the ones to keep. It can only **filter**: entries are matched by `id`, keep
 * their original order, and new entries are ignored. The instructions and the in-flight
 * turn (the latest prompt and its tool calls) are always kept.
 *
 * Native code waits for the answer, so return quickly (within 2 seconds): if the callback
 * is slower or throws, the `history` strategy result is used unchanged.
 */
export type HistoryTransform = (
  entries: TranscriptEntry[],
  context: { profile: string },
) => TranscriptEntry[] | Promise<TranscriptEntry[]>;

export type ProfileConfig = GenerationOptions & {
  /** Instructions for this profile. Defaults to the session's `instructions`. */
  instructions?: string;
  /** Names of session tools available in this profile. Default: all session tools. */
  tools?: string[];
  model?: ModelSelector;
  history?: HistoryStrategy;
  /** Custom filter over the history, run after `history`. See `HistoryTransform`. */
  historyTransform?: HistoryTransform;
  /**
   * Exit strategy for `toolCallingMode: 'required'`: after this many tool calls in a turn,
   * the mode switches to `allowed` so the model can answer. Setting it implies `required`.
   */
  requiredToolCalls?: number;
};

export type ProfileEvent = {
  profile: string;
  event: 'activate' | 'deactivate' | 'prompt' | 'reasoning' | 'response' | 'toolCall' | 'toolOutput';
  entry?: TranscriptEntry;
  toolName?: string;
  callId?: string;
  arguments?: unknown;
};

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

/**
 * A plain message used to seed a session with a conversation that did not come from a saved
 * Apple transcript (e.g. chat history kept by another library). See `SessionOptions.messages`.
 */
export type SessionMessage =
  | { role: 'user' | 'assistant'; content: string }
  | { role: 'toolCalls'; calls: { id: string; toolName: string; arguments: unknown }[] }
  | { role: 'toolOutput'; id: string; toolName: string; content: string };

export type SessionOptions = {
  instructions?: string;
  model?: ModelSelector;
  tools?: Tool[];
  /** Restore a conversation saved with `session.getTranscript()`. */
  transcript?: Transcript | string;
  /**
   * Start from an existing conversation given as plain messages. Prefer `transcript` when you
   * have one: it is lossless. Cannot be combined with `transcript`.
   */
  messages?: SessionMessage[];
  /** iOS 27+. Named profiles; switch with `session.setProfile(name)`. */
  profiles?: Record<string, ProfileConfig>;
  /** Profile active at start. Default: the first declared profile. */
  initialProfile?: string;
  /**
   * iOS 27+. What happens to the transcript when a request fails.
   * `revert` removes the failed entries, `preserve` keeps them. Apple default applies when omitted.
   */
  transcriptErrorHandling?: 'revert' | 'preserve';
  /**
   * Apple sessions reject concurrent requests. When `true` (default) requests on this
   * session are queued automatically; when `false` a concurrent call rejects with `CONCURRENT_REQUESTS`.
   */
  queueRequests?: boolean;
  /** Call `prewarm()` right after creation. Default `false`. */
  prewarm?: boolean | { promptPrefix?: string };
};

export type SessionState = {
  isResponding: boolean;
  model: ResolvedModelKind;
  /** Cumulative usage for the session (iOS 27+), otherwise `null`. */
  usage: Usage | null;
  profiles: string[];
  activeProfile?: string;
};

export type FeedbackIssueCategory =
  | 'unhelpful'
  | 'tooVerbose'
  | 'didNotFollowInstructions'
  | 'incorrect'
  | 'stereotypeOrBias'
  | 'suggestiveOrSexual'
  | 'vulgarOrOffensive'
  | 'triggeredGuardrailUnexpectedly';

export type FeedbackInput = {
  sentiment?: 'positive' | 'negative' | 'neutral';
  issues?: { category: FeedbackIssueCategory; explanation?: string }[];
  /** What the response should have been. */
  desiredResponse?: string;
};

// ---------------------------------------------------------------------------
// Token counting & diagnostics
// ---------------------------------------------------------------------------

export type TokenCountInput =
  | string
  | {
      prompt?: string;
      instructions?: string;
      schema?: SchemaInput<unknown>;
      tools?: Tool[];
      transcript?: Transcript | string;
    };

export type FeatureSupport = {
  sessions: boolean;
  streaming: boolean;
  structuredGeneration: boolean;
  tools: boolean;
  prewarm: boolean;
  feedback: boolean;
  transcripts: boolean;
  tokenCounting: boolean;
  usage: boolean;
  toolCallingMode: boolean;
  reasoningLevel: boolean;
  images: boolean;
  privateCloudCompute: boolean;
  dynamicProfiles: boolean;
  visionTools: boolean;
};

export type Diagnostics = {
  platform: string;
  osVersion: string | null;
  deviceModel?: string;
  /** `true` in the iOS Simulator, where some model assets (tool calling, vision) may be unavailable. */
  isSimulator?: boolean;
  packageVersion: string;
  build: { foundationModelsSDK: boolean; ios26_4SDK: boolean; ios27SDK: boolean } | null;
  foundationModelsSupported: boolean;
  systemModel: ModelInfo | null;
  privateCloudCompute: ModelInfo | null;
  features: Partial<FeatureSupport>;
};

export type { JSONSchema, SchemaInput };
