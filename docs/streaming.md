# Streaming

Maps to `LanguageModelSession.streamResponse(...)` / `ResponseStream`.

```ts
const stream = session.stream('Write a short story about a lighthouse');

for await (const chunk of stream) {
  // chunk.text     full text generated so far (Apple snapshots are cumulative)
  // chunk.delta    new text since the previous chunk, or null when the model revised earlier text
  // chunk.replaced true when earlier text was rewritten: replace your UI text, don't append
  // chunk.isFinal  true for the last chunk
  setText(chunk.text);
}

const response = await stream.result; // same shape as respond(): { text, usage, transcriptEntries, rawContent }
```

Rendering `chunk.text` is always correct. Only use `delta` for append-only sinks (e.g. text-to-speech), and
handle `replaced`.

You can skip the loop and only `await stream.result`.

## Cancellation

Any of these cancel generation:

```ts
stream.cancel();

const controller = new AbortController();
session.stream(prompt, { signal: controller.signal });
controller.abort();

for await (const chunk of stream) { if (enough(chunk)) break; } // breaking out cancels
```

The iterator and `stream.result` reject with `AppleFoundationModelsError` code `CANCELLED` right away.
Apple may keep finishing the generation internally. The next queued request on the same session starts after
that, so create a new session if the next request has to start instantly.

## Streaming structured output

```ts
const Recipe = z.object({ title: z.string(), steps: z.array(z.string()) });

const stream = session.streamObject({ prompt: 'A pancake recipe', schema: Recipe });
for await (const chunk of stream) {
  render(chunk.partial); // DeepPartial<Recipe>: fields appear as they're generated, in schema order
}
const { object } = await stream.result; // fully validated
```

Partial objects come from Apple's partially generated `GeneratedContent`. Nothing is lost by converting to plain tokens.
Order properties so that the ones the UI needs first come first.

## React

`useChat` wraps streaming for chat UIs:

```tsx
const { messages, send, stop, isResponding } = useChat({ instructions: 'Be brief.' });
```
