/** A piece of content inside a transcript entry. Maps to `Transcript.Segment`. */
export type TranscriptSegment =
  | { id: string; type: 'text'; text: string }
  | { id: string; type: 'structure'; schemaName: string; content: unknown }
  | { id: string; type: 'attachment'; kind: 'image' | 'unknown'; label: string | null; uri: string | null }
  | { id: string; type: 'unknown'; description: string };

/** Maps to `Transcript.Entry`. Tool calls and outputs are never dropped. */
export type TranscriptEntry =
  | { id: string; type: 'instructions'; segments: TranscriptSegment[]; toolDefinitions: { name: string; description: string }[] }
  | {
      id: string;
      type: 'prompt';
      segments: TranscriptSegment[];
      options: { temperature: number | null; maximumResponseTokens: number | null };
      responseFormat: { name: string } | null;
      reasoningLevel?: unknown;
    }
  | { id: string; type: 'toolCalls'; calls: { id: string; toolName: string; arguments: unknown }[] }
  | { id: string; type: 'toolOutput'; toolName: string; segments: TranscriptSegment[] }
  | { id: string; type: 'response'; segments: TranscriptSegment[] }
  | { id: string; type: 'reasoning'; segments: TranscriptSegment[] }
  | { id: string; type: 'unknown'; description: string };

/**
 * A session transcript.
 *
 * - `entries` is a typed, read-only view for UI and inspection.
 * - `json` is Apple's lossless `Codable` encoding: persist it and pass it (or the whole
 *   object) to `createSession({ transcript })` to restore the conversation.
 */
export type Transcript = {
  entries: TranscriptEntry[];
  json: string;
};

function parseJSON(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export function convertSegment(raw: Record<string, unknown>): TranscriptSegment {
  if (raw.type === 'structure') {
    const { contentJSON, ...rest } = raw;
    return { ...(rest as { id: string; schemaName: string }), type: 'structure', content: parseJSON(contentJSON) };
  }
  return raw as TranscriptSegment;
}

export function convertEntry(raw: Record<string, unknown>): TranscriptEntry {
  const segments = Array.isArray(raw.segments) ? (raw.segments as Record<string, unknown>[]).map(convertSegment) : undefined;
  if (raw.type === 'toolCalls') {
    const calls = (raw.calls as Record<string, unknown>[]).map(({ argumentsJSON, ...call }) => ({
      ...(call as { id: string; toolName: string }),
      arguments: parseJSON(argumentsJSON),
    }));
    return { id: raw.id as string, type: 'toolCalls', calls };
  }
  return (segments ? { ...raw, segments } : raw) as TranscriptEntry;
}

export function convertEntries(raw: Record<string, unknown>[] | undefined): TranscriptEntry[] {
  return (raw ?? []).map(convertEntry);
}

/** Concatenated text of an entry's text segments (structured segments are JSON-stringified). */
export function entryText(entry: TranscriptEntry): string {
  if (!('segments' in entry)) return '';
  return entry.segments
    .map((segment) => (segment.type === 'text' ? segment.text : segment.type === 'structure' ? JSON.stringify(segment.content) : ''))
    .join('');
}

export function transcriptJSON(transcript: Transcript | string): string {
  return typeof transcript === 'string' ? transcript : transcript.json;
}
