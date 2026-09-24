import { useCallback, useEffect, useRef, useState } from 'react';

import { getAvailability } from '../models';
import { createSession, type Session } from '../session';
import type { Availability, ModelSelector, PromptInput, RespondOptions, SessionOptions } from '../types';

/**
 * Availability of a model; re-checked when the app returns to the foreground is up to you
 * (call `refresh`). `null` while loading.
 */
export function useAvailability(model?: ModelSelector): { availability: Availability | null; refresh: () => Promise<void> } {
  const [availability, setAvailability] = useState<Availability | null>(null);
  const key = JSON.stringify(model ?? null);
  const refresh = useCallback(async () => {
    setAvailability(await getAvailability(model));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return { availability, refresh };
}

/**
 * Creates a session for the component's lifetime and disposes it on unmount.
 * The session is recreated when `deps` change (options are read on creation only).
 */
export function useSession(options: SessionOptions = {}, deps: unknown[] = []): { session: Session | null; error: Error | null } {
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    let created: Session | null = null;
    let cancelled = false;
    setSession(null);
    setError(null);
    createSession(optionsRef.current).then(
      (value) => {
        if (cancelled) value.dispose();
        else {
          created = value;
          setSession(value);
        }
      },
      (reason) => !cancelled && setError(reason instanceof Error ? reason : new Error(String(reason))),
    );
    return () => {
      cancelled = true;
      created?.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { session, error };
}

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  /** `true` while the assistant message is streaming. */
  pending?: boolean;
  error?: Error;
};

/**
 * A minimal streaming chat on top of a session.
 *
 * ```tsx
 * const { messages, send, isResponding, stop } = useChat({ instructions: 'Be brief.' });
 * ```
 */
export function useChat(options: SessionOptions & { generation?: Omit<RespondOptions, 'signal'> } = {}, deps: unknown[] = []) {
  const { session, error: sessionError } = useSession(options, deps);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isResponding, setIsResponding] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const generation = useRef(options.generation);
  generation.current = options.generation;

  useEffect(() => setMessages([]), [session]);

  const send = useCallback(
    async (prompt: PromptInput) => {
      if (!session) return;
      const text = typeof prompt === 'string' ? prompt : prompt.prompt;
      const stamp = `${Date.now()}`;
      const assistantId = `a_${stamp}`;
      setError(null);
      setMessages((previous) => [
        ...previous,
        { id: `u_${stamp}`, role: 'user', text },
        { id: assistantId, role: 'assistant', text: '', pending: true },
      ]);
      setIsResponding(true);
      const stream = session.stream(prompt, generation.current);
      stopRef.current = stream.cancel;
      const update = (patch: Partial<ChatMessage>) =>
        setMessages((previous) => previous.map((message) => (message.id === assistantId ? { ...message, ...patch } : message)));
      try {
        for await (const chunk of stream) update({ text: chunk.text });
        update({ pending: false });
      } catch (reason) {
        const failure = reason instanceof Error ? reason : new Error(String(reason));
        update({ pending: false, error: failure });
        setError(failure);
      } finally {
        stopRef.current = null;
        setIsResponding(false);
      }
    },
    [session],
  );

  const stop = useCallback(() => stopRef.current?.(), []);

  return { session, messages, send, stop, isResponding, error: error ?? sessionError, isReady: session !== null };
}
