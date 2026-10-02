# Advanced

## Two API layers

- **High level:** `respond`, `stream`, `generateObject`, `streamObject`, React hooks. Enough for most apps.
- **Advanced:** `respondAdvanced` and `streamAdvanced` take one request object shaped like Apple's
  `respond(to:schema:options:contextOptions:metadata:)` and return everything Apple returns
  ([sessions.md](./sessions.md#advanced-requests-respondadvanced--streamadvanced)). Profiles expose Apple's
  `DynamicProfile` modifiers, including a JavaScript `historyTransform`.

The high-level calls are not a weaker API: they accept the same options (`samplingMode`, `toolCallingMode`,
`reasoningLevel`, `includeSchemaInPrompt`, `metadata`) and return the raw pieces too (`rawContent`,
`transcriptEntries`, `usage`).

## Budgeting the context window

```ts
const { contextSize } = await AppleFoundationModels.getModelInfo();            // e.g. 4096
const used = await AppleFoundationModels.tokenCount({                            // iOS 26.4+
  instructions, tools, schema, transcript: await session.getTranscript(),
});
if (used > contextSize * 0.8) {
  const summary = await session.respond('Summarize our conversation in 5 bullet points.');
  session.dispose();
  session = await createSession({ instructions: `${instructions}\n\nConversation so far:\n${summary.text}` });
}
```

On iOS 27, `CONTEXT_SIZE_EXCEEDED` errors include `details.contextSize` and `details.tokenCount`.

## Reasoning (iOS 27)

Models with the `reasoning` capability accept `reasoningLevel: 'light' | 'moderate' | 'deep' | { custom }`.
Reasoning tokens are reported in `usage.reasoningTokens` and reasoning entries appear in the transcript. Deeper
reasoning costs latency and tokens; use it per request or per profile.

## Deterministic-ish output

```ts
await session.respond(prompt, { samplingMode: { type: 'greedy' } });
await session.respond(prompt, { samplingMode: { type: 'topK', k: 20, seed: 42 } });
```

Seeds make sampling repeatable **for the same model version**. Apple updates the model with OS releases, so expect
changes across iOS versions.

## Performance

- `prewarm()` when a request is likely imminent (e.g. on input focus). Include a `promptPrefix` if you know it.
- Keep instructions and tool descriptions short: they are processed on every request (`cachedInputTokens` in
  `usage` shows how much was reused).
- Stream long answers; perceived latency matters more than total time.
- Reuse sessions for follow-ups (history is cached); create new sessions for unrelated tasks.
- Use `useCase: 'contentTagging'` for tagging and extraction workloads.

## Concurrency model

- Each `Session` owns one native `LanguageModelSession` (an Expo `SharedObject` with a unique ID). There is no global session.
- Requests on a session are queued (`queueRequests`). Different sessions run concurrently.
- Tool calls are dispatched to JS as events with unique call IDs and resolved individually, so parallel calls stay parallel.
- `dispose()` cancels running tasks and fails pending tool calls; the native object is released.

## Refusals and guardrails

`GUARDRAIL_VIOLATION` means Apple's safety system blocked input or output; `REFUSAL` means the model declined.
For legitimate "transform the user's own text" features (summarize, rewrite), consider
`systemModel({ guardrails: 'permissiveContentTransformations' })`.

## Feedback to Apple

`session.createFeedbackAttachment({ sentiment, issues, desiredResponse })` returns data for Apple's Feedback
Assistant (includes the transcript, including rolled-back entries). Only submit with the user's consent.

## Testing

- JS unit tests (`npm test`): mock the native module (see `src/__tests__/fakeNative.ts` for a complete fake).
- Swift unit tests (`ios/Tests`): the bridge logic that needs no model, run on a simulator. See [testing.md](./testing.md).
- End-to-end: the example app's Self-Test screen. Set `EXPO_PUBLIC_SELF_TEST=1` when starting Metro to run it
  automatically at launch; results are logged with a `[selftest]` prefix.
- The iOS Simulator runs the real model on Apple Intelligence–enabled Macs, but some assets (tool calling on some
  hosts, Vision tools) are device-only. Test on a device before shipping.

## Version awareness

`getDiagnostics().build` shows which SDK the app was compiled with (`ios27SDK`), and `features` shows what is
usable at runtime. An app built with Xcode 26 running on iOS 27 won't have iOS 27 features (`SDK_VERSION`).
