import { getNativeModule, type NativeProfileEvent, type NativeStreamEvent, type NativeToolCallEvent } from '../native';

type SessionListener = {
  onToolCall(event: NativeToolCallEvent): void;
  onProfileEvent(event: NativeProfileEvent): void;
};

const sessions = new Map<string, SessionListener>();
const streams = new Map<string, (event: NativeStreamEvent) => void>();
let subscribed = false;

/**
 * One native listener per event type, dispatching to sessions / streams by ID.
 * Subscribed lazily on first use so importing the package has no side effects.
 */
function ensureSubscribed(): void {
  if (subscribed) return;
  const native = getNativeModule();
  if (!native) return;
  subscribed = true;
  native.addListener('onToolCall', (event) => {
    const session = sessions.get(event.sessionId);
    if (session) {
      session.onToolCall(event);
    } else {
      // Unknown session (disposed): fail the call so the native side does not wait forever.
      native.resolveToolCall(event.callId, null, 'The session was disposed.');
    }
  });
  native.addListener('onStreamEvent', (event) => streams.get(event.requestId)?.(event));
  native.addListener('onProfileEvent', (event) => sessions.get(event.sessionId)?.onProfileEvent(event));
}

export function registerSession(sessionId: string, listener: SessionListener): () => void {
  ensureSubscribed();
  sessions.set(sessionId, listener);
  return () => sessions.delete(sessionId);
}

export function registerStream(requestId: string, handler: (event: NativeStreamEvent) => void): () => void {
  ensureSubscribed();
  streams.set(requestId, handler);
  return () => streams.delete(requestId);
}

let counter = 0;
export function nextRequestId(): string {
  counter += 1;
  return `req_${Date.now().toString(36)}_${counter.toString(36)}`;
}
