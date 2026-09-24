/**
 * Every error thrown by this package is an `AppleFoundationModelsError` with one of these codes.
 * Native errors are mapped in `ios/FMErrors.swift`; see `docs/errors.md` for the full table.
 */
export const ErrorCodes = {
  /** Not running on an Apple platform with this native module (Android, web, Expo Go). */
  UNSUPPORTED_PLATFORM: 'UNSUPPORTED_PLATFORM',
  /** The OS (or the SDK the app was built with) is too old for this feature. `details.reason`: `OS_VERSION` | `SDK_VERSION`. */
  UNSUPPORTED_OS_VERSION: 'UNSUPPORTED_OS_VERSION',
  DEVICE_NOT_ELIGIBLE: 'DEVICE_NOT_ELIGIBLE',
  APPLE_INTELLIGENCE_DISABLED: 'APPLE_INTELLIGENCE_DISABLED',
  /** Model assets are still downloading / not ready. Retry later. */
  MODEL_NOT_READY: 'MODEL_NOT_READY',
  /** No usable model (e.g. `model: 'auto'` found none). */
  MODEL_UNAVAILABLE: 'MODEL_UNAVAILABLE',
  /** `details.contextSize` and `details.tokenCount` on iOS 27+. */
  CONTEXT_SIZE_EXCEEDED: 'CONTEXT_SIZE_EXCEEDED',
  /** `details.resetDate` when known. Common when the app is in the background. */
  RATE_LIMITED: 'RATE_LIMITED',
  GUARDRAIL_VIOLATION: 'GUARDRAIL_VIOLATION',
  /** The model refused to answer. */
  REFUSAL: 'REFUSAL',
  UNSUPPORTED_LANGUAGE_OR_LOCALE: 'UNSUPPORTED_LANGUAGE_OR_LOCALE',
  /** The model lacks a capability (e.g. images on a text-only model). `details.capability`. */
  UNSUPPORTED_CAPABILITY: 'UNSUPPORTED_CAPABILITY',
  UNSUPPORTED_TRANSCRIPT_CONTENT: 'UNSUPPORTED_TRANSCRIPT_CONTENT',
  TIMEOUT: 'TIMEOUT',
  /** Another request is running on the same session (only when `queueRequests: false`). */
  CONCURRENT_REQUESTS: 'CONCURRENT_REQUESTS',
  TRANSCRIPT_MUTATION_WHILE_RESPONDING: 'TRANSCRIPT_MUTATION_WHILE_RESPONDING',
  GENERATION_FAILED: 'GENERATION_FAILED',
  /** Generated content could not be decoded. `details.rawContent` on iOS 27+. */
  DECODING_FAILED: 'DECODING_FAILED',
  /** A tool's `execute` threw or the tool could not run. `details.toolName`. */
  TOOL_CALL_FAILED: 'TOOL_CALL_FAILED',
  /** The schema could not be converted to Apple's `GenerationSchema`. */
  INVALID_SCHEMA: 'INVALID_SCHEMA',
  /** The generated object failed Standard Schema (e.g. Zod) validation. `details.issues`. */
  SCHEMA_VALIDATION_FAILED: 'SCHEMA_VALIDATION_FAILED',
  INVALID_PROMPT: 'INVALID_PROMPT',
  INVALID_ARGUMENT: 'INVALID_ARGUMENT',
  INVALID_TRANSCRIPT: 'INVALID_TRANSCRIPT',
  /** `details.reason`: `DEVICE_NOT_ELIGIBLE` | `SYSTEM_NOT_READY` | `SERVICE_UNAVAILABLE` | `ENTITLEMENT_REQUIRED`. */
  PRIVATE_CLOUD_COMPUTE_UNAVAILABLE: 'PRIVATE_CLOUD_COMPUTE_UNAVAILABLE',
  /** The app lacks Apple's managed PCC entitlement. */
  ENTITLEMENT_REQUIRED: 'ENTITLEMENT_REQUIRED',
  /** PCC quota reached. `details.resetDate`, `details.canRequestLimitIncrease`. */
  QUOTA_LIMIT_REACHED: 'QUOTA_LIMIT_REACHED',
  NETWORK_FAILURE: 'NETWORK_FAILURE',
  SESSION_DISPOSED: 'SESSION_DISPOSED',
  CANCELLED: 'CANCELLED',
  UNKNOWN: 'UNKNOWN',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

export type NativeErrorPayload = {
  code: string;
  message: string;
  nativeType?: string;
  details?: Record<string, unknown>;
};

export class AppleFoundationModelsError extends Error {
  readonly code: ErrorCode;
  /** Swift type of the underlying error (e.g. `LanguageModelError`), when it came from native code. */
  readonly nativeType?: string;
  /** Structured, code-specific information (reset dates, token counts, tool names...). */
  readonly details: Record<string, unknown>;

  constructor(payload: { code: ErrorCode | string; message: string; nativeType?: string; details?: Record<string, unknown>; cause?: unknown }) {
    super(payload.message);
    this.name = 'AppleFoundationModelsError';
    this.code = (Object.values(ErrorCodes) as string[]).includes(payload.code) ? (payload.code as ErrorCode) : 'UNKNOWN';
    this.nativeType = payload.nativeType;
    this.details = payload.details ?? {};
    if (payload.code !== this.code) this.details = { ...this.details, originalCode: payload.code };
    if (payload.cause !== undefined) (this as { cause?: unknown }).cause = payload.cause;
  }

  static fromNative(payload: NativeErrorPayload): AppleFoundationModelsError {
    return new AppleFoundationModelsError(payload);
  }
}

export function isAppleFoundationModelsError(error: unknown, code?: ErrorCode): error is AppleFoundationModelsError {
  return error instanceof AppleFoundationModelsError && (code === undefined || error.code === code);
}

export function unsupportedPlatformError(): AppleFoundationModelsError {
  return new AppleFoundationModelsError({
    code: 'UNSUPPORTED_PLATFORM',
    message:
      'Apple Foundation Models are not available on this platform. They require iOS 26+ on an Apple Intelligence device, ' +
      'in a development build or bare React Native app (not Expo Go).',
  });
}

export function cancelledError(): AppleFoundationModelsError {
  return new AppleFoundationModelsError({ code: 'CANCELLED', message: 'The operation was cancelled.' });
}
