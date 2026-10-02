# Transcripts

A session's transcript is the full conversation: instructions, prompts, tool calls, tool outputs, reasoning and
responses. Maps to Apple's `Transcript`.

```ts
const transcript = await session.getTranscript();
transcript.entries; // typed, for UI and inspection
transcript.json;    // Apple's lossless Codable encoding, for persistence

session.transcript; // the same snapshot, synchronously (maps to LanguageModelSession.transcript)
```

`session.transcript` encodes the whole conversation on the JS thread every time it is read. Read it once into a
variable; prefer `getTranscript()` for long conversations or inside render functions.

## Entry types

```ts
type TranscriptEntry =
  | { type: 'instructions'; segments; toolDefinitions: { name; description }[] }
  | { type: 'prompt'; segments; options: { temperature; maximumResponseTokens }; responseFormat: { name } | null; reasoningLevel? }
  | { type: 'toolCalls'; calls: { id; toolName; arguments }[] }
  | { type: 'toolOutput'; toolName; segments }
  | { type: 'response'; segments }
  | { type: 'reasoning'; segments }          // iOS 27
  | { type: 'unknown'; description };        // future Apple entry types

type TranscriptSegment =
  | { type: 'text'; text }
  | { type: 'structure'; schemaName; content } // structured output (parsed)
  | { type: 'attachment'; kind: 'image'; label; uri } // iOS 27
```

Tool calls are never dropped. `entryText(entry)` returns the plain text of an entry.

Each `respond()` result also includes `transcriptEntries`: just the entries that request added.

## Persist & restore

```ts
// save
const { json } = await session.getTranscript();
await AsyncStorage.setItem(`chat:${id}`, json);

// later
const saved = await AsyncStorage.getItem(`chat:${id}`);
const session = await createSession({ transcript: saved!, tools: sameTools });
await session.respond('Where were we?');
```

Maps to `LanguageModelSession(model:tools:transcript:)`. The transcript already contains the instructions, so don't
pass `instructions` again. Pass the same `tools` so the model can keep calling them.

`transcript` accepts the `Transcript` object or its `json` string. Invalid JSON → `INVALID_TRANSCRIPT`.

## Starting from plain messages

When the conversation was not produced by this package (history stored by another library, an imported chat),
there is no Apple transcript to restore. Pass plain messages instead:

```ts
const session = await createSession({
  instructions: 'Be brief.',
  tools: [getWeather],
  messages: [
    { role: 'user', content: 'Weather in Delhi?' },
    { role: 'toolCalls', calls: [{ id: 'call-1', toolName: 'getWeather', arguments: { city: 'Delhi' } }] },
    { role: 'toolOutput', id: 'call-1', toolName: 'getWeather', content: '31°C' },
    { role: 'assistant', content: 'It is 31°C in Delhi.' },
  ],
});
await session.respond('And tomorrow?');
```

The package builds a `Transcript` from them (`Transcript.Prompt`, `.ToolCalls`, `.ToolOutput`, `.Response`) and adds
the instructions entry itself, so here you **do** pass `instructions`. `messages` and `transcript` cannot be
combined (`INVALID_ARGUMENT`). Prefer `transcript` whenever you have one: plain messages carry text only, so
images, structured segments, reasoning and per-prompt options are lost.

## Keeping transcripts within the context window

The on-device context is small (see `getModelInfo().contextSize`). Options:

1. Measure: `await AppleFoundationModels.tokenCount({ transcript })` (iOS 26.4+).
2. Start a new session with a summary: ask the model to summarize, then `createSession({ instructions: summary })`.
3. iOS 27: use a [profile `history` strategy](./dynamic-profiles.md#history-strategies) to limit what the model
   sees without losing the stored transcript.
4. iOS 27: `transcriptErrorHandling: 'revert'` keeps failed turns out of the transcript.

## Privacy

Transcripts contain user content. Store them like any other user data (e.g. encrypted storage for sensitive apps).
