import { requireOptionalNativeModule } from 'expo';

import { AppleFoundationModelsError, unsupportedPlatformError, type NativeErrorPayload } from './errors';

export type Envelope<T> = { ok: true; value: T } | { ok: false; error: NativeErrorPayload };

/** Opaque handle to the native `FMSessionObject` (an Expo SharedObject). */
export type NativeSessionHandle = { release(): void };

export type NativeToolCallEvent = {
  sessionId: string;
  requestId: string | null;
  callId: string;
  toolName: string;
  argumentsJSON: string;
};

export type NativeStreamEvent =
  | { requestId: string; type: 'snapshot'; text?: string; delta?: string | null; replaced?: boolean; json?: string; isComplete?: boolean }
  | { requestId: string; type: 'done'; result: NativeResult }
  | { requestId: string; type: 'error'; error: NativeErrorPayload };

export type NativeProfileEvent = {
  sessionId: string;
  profile: string;
  event: string;
  entry?: Record<string, unknown>;
  toolName?: string;
  callId?: string;
  argumentsJSON?: string;
};

export type NativeResult = {
  text?: string;
  json?: string;
  rawContentJSON?: string;
  isComplete?: boolean;
  usage: Record<string, number> | null;
  transcriptEntries: Record<string, unknown>[];
};

type Subscription = { remove(): void };

export interface NativeAppleFoundationModels {
  getBuildInfo(): { foundationModelsSDK: boolean; ios26_4SDK: boolean; ios27SDK: boolean; osVersion: string; platform: string };
  getAvailability(modelJSON: string | null): Promise<Envelope<Record<string, unknown>>>;
  getModelInfo(modelJSON: string | null): Promise<Envelope<Record<string, unknown>>>;
  supportsLocale(modelJSON: string | null, locale: string | null): Promise<Envelope<boolean>>;
  tokenCount(modelJSON: string | null, inputJSON: string): Promise<Envelope<number>>;
  getDiagnostics(): Promise<Envelope<Record<string, unknown>>>;
  resolveToolCall(callId: string, resultJSON: string | null, errorMessage: string | null): boolean;
  createNativeSession(): NativeSessionHandle;
  configureSession(session: NativeSessionHandle, configJSON: string): Promise<Envelope<{ sessionId: string; model: 'system' | 'privateCloudCompute' }>>;
  respond(session: NativeSessionHandle, requestId: string, payloadJSON: string): Promise<Envelope<NativeResult>>;
  startStream(session: NativeSessionHandle, requestId: string, payloadJSON: string): Envelope<string>;
  cancelRequest(session: NativeSessionHandle, requestId: string): void;
  prewarm(session: NativeSessionHandle, promptPrefix: string | null): Promise<Envelope<boolean>>;
  getSessionState(session: NativeSessionHandle): Envelope<Record<string, unknown>>;
  getTranscript(session: NativeSessionHandle): Promise<Envelope<{ entries: Record<string, unknown>[]; json: string | null }>>;
  setActiveProfile(session: NativeSessionHandle, name: string): Envelope<string>;
  createFeedbackAttachment(session: NativeSessionHandle, payloadJSON: string): Promise<Envelope<string>>;
  disposeSession(session: NativeSessionHandle): void;
  addListener(event: 'onToolCall', listener: (event: NativeToolCallEvent) => void): Subscription;
  addListener(event: 'onStreamEvent', listener: (event: NativeStreamEvent) => void): Subscription;
  addListener(event: 'onProfileEvent', listener: (event: NativeProfileEvent) => void): Subscription;
}

let cached: NativeAppleFoundationModels | null | undefined;

/**
 * The native module, or `null` on platforms without it (Android, web, Expo Go).
 * Never throws: importing this package is always safe.
 */
export function getNativeModule(): NativeAppleFoundationModels | null {
  if (cached === undefined) {
    try {
      cached = requireOptionalNativeModule<NativeAppleFoundationModels>('AppleFoundationModels');
    } catch {
      cached = null;
    }
  }
  return cached;
}

export function requireNative(): NativeAppleFoundationModels {
  const native = getNativeModule();
  if (!native) throw unsupportedPlatformError();
  return native;
}

export function unwrap<T>(envelope: Envelope<T>): T {
  if (envelope.ok) return envelope.value;
  throw AppleFoundationModelsError.fromNative(envelope.error);
}

/** Test hook: replaces the native module (use `null` to simulate an unsupported platform). */
export function __setNativeModuleForTesting(module: NativeAppleFoundationModels | null | undefined): void {
  cached = module;
}
