import type { NativeAppleFoundationModels, NativeResult, NativeStreamEvent, NativeToolCallEvent } from '../native';

type Listener = (event: any) => void;

/**
 * In-memory stand-in for the Swift module. Tests script its behaviour through
 * `respondImpl` / `streamImpl` and can trigger tool calls like the model would.
 */
export class FakeNative {
  listeners: Record<string, Set<Listener>> = { onToolCall: new Set(), onStreamEvent: new Set(), onProfileEvent: new Set() };
  toolResults = new Map<string, { resultJSON: string | null; errorMessage: string | null }>();
  toolWaiters = new Map<string, (value: { resultJSON: string | null; errorMessage: string | null }) => void>();
  cancelled: string[] = [];
  configs: any[] = [];
  payloads: any[] = [];
  disposed = 0;
  released = 0;
  respondImpl: (requestId: string, payload: any) => Promise<NativeResult> = async (_id, payload) => ({
    text: `echo: ${payload.prompt}`,
    usage: null,
    transcriptEntries: [],
  });
  streamImpl: (requestId: string, payload: any) => void = () => {};

  emit(event: string, payload: any) {
    for (const listener of this.listeners[event]) listener(payload);
  }

  /** Simulates the model calling a JS tool; resolves with what JS sent back. */
  callTool(toolName: string, args: unknown, requestId: string | null = null, sessionId = 'session-1') {
    const callId = `call_${Math.random().toString(36).slice(2)}`;
    const result = new Promise<{ resultJSON: string | null; errorMessage: string | null }>((resolve) => this.toolWaiters.set(callId, resolve));
    const event: NativeToolCallEvent = { sessionId, requestId, callId, toolName, argumentsJSON: JSON.stringify(args) };
    this.emit('onToolCall', event);
    return result;
  }

  stream(event: NativeStreamEvent) {
    this.emit('onStreamEvent', event);
  }

  module(): NativeAppleFoundationModels {
    const self = this;
    return {
      getBuildInfo: () => ({ foundationModelsSDK: true, ios26_4SDK: true, ios27SDK: true, osVersion: '27.0', platform: 'ios' }),
      getAvailability: async () => ({ ok: true, value: { status: 'available', available: true, model: 'system' } }),
      getModelInfo: async () => ({ ok: true, value: { model: 'system', contextSize: 4096 } }),
      supportsLocale: async () => ({ ok: true, value: true }),
      tokenCount: async (_model, input) => ({ ok: true, value: JSON.parse(input).prompt?.length ?? 0 }),
      getDiagnostics: async () => ({ ok: true, value: { platform: 'ios', foundationModelsSupported: true } }),
      resolveToolCall(callId, resultJSON, errorMessage) {
        self.toolResults.set(callId, { resultJSON, errorMessage });
        self.toolWaiters.get(callId)?.({ resultJSON, errorMessage });
        return true;
      },
      createNativeSession: () => ({ release: () => void (self.released += 1) }),
      configureSession: async (_handle, config) => {
        self.configs.push(JSON.parse(config));
        return { ok: true, value: { sessionId: 'session-1', model: 'system' } };
      },
      respond: async (_handle, requestId, payload) => {
        const parsed = JSON.parse(payload);
        self.payloads.push(parsed);
        try {
          return { ok: true, value: await self.respondImpl(requestId, parsed) };
        } catch (error: any) {
          return { ok: false, error: { code: error.code ?? 'UNKNOWN', message: error.message } };
        }
      },
      startStream: (_handle, requestId, payload) => {
        const parsed = JSON.parse(payload);
        self.payloads.push(parsed);
        queueMicrotask(() => self.streamImpl(requestId, parsed));
        return { ok: true, value: requestId };
      },
      cancelRequest: (_handle, requestId) => {
        self.cancelled.push(requestId);
      },
      prewarm: async () => ({ ok: true, value: true }),
      getSessionState: () => ({ ok: true, value: { isResponding: false, model: 'system', usage: null, profiles: [] } }),
      getTranscript: async () => ({ ok: true, value: { entries: [], json: '{"entries":[]}' } }),
      setActiveProfile: (_handle, name) => ({ ok: true, value: name }),
      createFeedbackAttachment: async () => ({ ok: true, value: 'aGVsbG8=' }),
      disposeSession: () => void (self.disposed += 1),
      addListener(event: string, listener: Listener) {
        self.listeners[event].add(listener);
        return { remove: () => self.listeners[event].delete(listener) };
      },
    } as NativeAppleFoundationModels;
  }
}
