# Sessions

A `Session` wraps Apple's `LanguageModelSession`: it keeps the conversation (transcript) and runs requests.

```ts
const session = await createSession({
  instructions: 'You are a concise financial assistant.',
  model: 'system',                 // default
  tools: [],                       // see tools.md
  transcript: undefined,           // restore (transcripts.md)
  messages: undefined,             // or start from plain messages (transcripts.md)
  profiles: undefined,             // iOS 27 (dynamic-profiles.md)
  transcriptErrorHandling: undefined, // iOS 27: 'revert' | 'preserve'
  queueRequests: true,
  prewarm: false,
});

await session.respond('What is compound interest?');
await session.respond('Give me an example.'); // remembers the previous turn
```

## `respond(prompt, options?)`

`prompt` is a string or `{ prompt, images }` ([multimodal.md](./multimodal.md)). Returns:

```ts
{
  text: string;
  usage: { inputTokens, cachedInputTokens, outputTokens, reasoningTokens, totalTokens } | null; // iOS 27
  transcriptEntries: TranscriptEntry[]; // what this request added: prompt, tool calls, tool outputs, response
  rawContent: unknown;                  // Apple GeneratedContent
}
```

### Options (`GenerationOptions` + `ContextOptions`)

| Option | Apple API | Min iOS |
| --- | --- | --- |
| `temperature` | `GenerationOptions.temperature` | 26 |
| `maximumResponseTokens` | `GenerationOptions.maximumResponseTokens` | 26 |
| `samplingMode: { type: 'greedy' }` | `.greedy` | 26 |
| `samplingMode: { type: 'topK', k, seed? }` | `.random(top:seed:)` | 26 |
| `samplingMode: { type: 'probabilityThreshold', probabilityThreshold, seed? }` | `.random(probabilityThreshold:seed:)` | 26 |
| `toolCallingMode: 'allowed' \| 'required' \| 'disallowed'` | `GenerationOptions.ToolCallingMode` | 27 |
| `reasoningLevel: 'light' \| 'moderate' \| 'deep' \| { custom }` | `ContextOptions.ReasoningLevel` | 27 |
| `includeSchemaInPrompt` | `ContextOptions.includeSchemaInPrompt` / `includeSchemaInPrompt:` | 26 |
| `metadata` | prompt `metadata:` | 27 |
| `signal` | task cancellation | 26 |

Use `greedy` sampling (optionally with a fixed prompt) for the most repeatable output. Output is still not guaranteed
identical across OS versions.

## Advanced requests: `respondAdvanced` / `streamAdvanced`

`respond()` takes Apple's options as one flat object. The advanced methods mirror Apple's signature
`respond(to:schema:options:contextOptions:metadata:)` instead: one request object with `options`
(`GenerationOptions`) and `contextOptions` (`ContextOptions`) kept separate, an optional `schema`, and a response
that carries everything Apple returns.

```ts
const response = await session.respondAdvanced({
  prompt: 'Extract: Ada, 36',
  images: undefined,                                   // iOS 27
  schema: Person,                                      // optional: Zod, Standard JSON Schema or JSON Schema
  schemaName: 'Person',
  options: { temperature: 0, samplingMode: { type: 'greedy' }, maximumResponseTokens: 200, toolCallingMode: 'allowed' },
  contextOptions: { reasoningLevel: 'deep', includeSchemaInPrompt: false }, // iOS 27
  metadata: { screen: 'import' },                      // iOS 27
  signal,
});

response.text;              // the text, or the object as JSON when a schema was given
response.object;            // typed by the schema; undefined without one
response.rawContent;        // Apple's GeneratedContent, before validation
response.isComplete;
response.usage;             // iOS 27, else null
response.transcriptEntries;
response.model;             // 'system' | 'privateCloudCompute'
response.durationMs;        // includes time spent queued behind other requests
```

`streamAdvanced(request)` takes the same request and yields
`{ text, delta, replaced, partial, rawContent, isComplete, isFinal }`; `stream.result` resolves to the same response
object. Without a schema `partial` is `undefined`; with one, `delta` is `null` and `text` is the partial object as JSON.

Use these when one code path must handle both text and structured requests, or when you want Apple's option
grouping. They run through the same queue and cancellation as `respond()` and `stream()`.

## Concurrency

Apple sessions handle **one request at a time**. With `queueRequests: true` (default) calls on the same session run
in order. With `false`, a second concurrent call rejects with `CONCURRENT_REQUESTS`. Multiple sessions run
independently; each has its own native identifier.

## State

```ts
session.isResponding;      // LanguageModelSession.isResponding
session.transcript;        // LanguageModelSession.transcript, synchronous snapshot (transcripts.md)
session.contextSize;       // context window of the session's model in tokens, or null if unknown
session.usage;             // cumulative usage (iOS 27) or null
session.getState();        // { isResponding, model, usage, profiles, activeProfile }
session.model;             // 'system' | 'privateCloudCompute' (what `auto` resolved to)
await session.getUsage();  // same as session.usage
```

## Prewarming

```ts
await session.prewarm();                                   // load resources
await session.prewarm({ promptPrefix: 'Summarize this:' }); // also cache a known prefix
```

Maps to `LanguageModelSession.prewarm(promptPrefix:)`. Call it when a request is likely soon (e.g. the user
focuses the input). It is a hint, not a guarantee: don't prewarm speculatively on every screen.

## Lifecycle

```ts
session.dispose();   // cancels in-flight requests & pending tool calls, frees native memory
session.isDisposed;
```

Native sessions are Expo `SharedObject`s: forgotten sessions are also released when garbage collected,
but call `dispose()` for deterministic cleanup. Using a disposed session throws `SESSION_DISPOSED`.

## Feedback attachments

```ts
const bytes: Uint8Array = await session.createFeedbackAttachment({
  sentiment: 'negative',
  issues: [{ category: 'incorrect', explanation: 'Wrong year' }],
  desiredResponse: 'It was 1969.',
});
```

Maps to `LanguageModelSession.logFeedbackAttachment(...)`. Returns the attachment data (includes the transcript)
for Apple's Feedback Assistant. Save it to a file and attach it to a Feedback Assistant report. Nothing is sent automatically.
