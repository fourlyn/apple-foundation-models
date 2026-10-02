# Vercel AI SDK provider

`@fourlyn/apple-foundation-models/ai` lets the [AI SDK](https://ai-sdk.dev) (`generateText`, `streamText`,
structured output, `useChat`) run on Apple's models. It is optional: the main package does not depend on the AI SDK.

The native API (`createSession`) remains the primary one and exposes more of Apple's framework. Use the provider
when your app already speaks the AI SDK, or when you want to swap between Apple and other providers.

## Requirements

| | |
| --- | --- |
| AI SDK | `ai` **7.x** (language model specification v4) |
| Platform | Same as the rest of the package: iOS 26+ development build |
| Polyfills | The AI SDK needs `ReadableStream` and `structuredClone` in React Native. Follow the AI SDK's Expo guide. |

```sh
npx expo install @fourlyn/apple-foundation-models ai
```

## Usage

```ts
import { apple } from '@fourlyn/apple-foundation-models/ai';
import { generateText, streamText, Output } from 'ai';
import { z } from 'zod';

// Text
const { text } = await generateText({ model: apple(), system: 'Be brief.', prompt: 'Explain quantum computing.' });

// Streaming
const result = streamText({ model: apple(), prompt: 'Write a haiku about the sea.' });
for await (const delta of result.textStream) append(delta);

// Structured output
const { output } = await generateText({
  model: apple(),
  prompt: 'Extract: Ada, 36',
  output: Output.object({ schema: z.object({ name: z.string(), age: z.number() }) }),
});
```

Always check availability first; the provider does not do it for you:

```ts
import { AppleFoundationModels } from '@fourlyn/apple-foundation-models';
if (!(await AppleFoundationModels.getAvailability()).available) return useAnotherProvider();
```

## Models

| Call | Model |
| --- | --- |
| `apple()` or `apple('system')` | On-device `SystemLanguageModel` |
| `apple('privateCloudCompute')` | Private Cloud Compute (iOS 27, entitlement required). Never falls back. |
| `apple('auto')` | On-device if available, otherwise Private Cloud Compute (a Fourlyn convenience) |
| `apple('system', { useCase: 'contentTagging', guardrails: 'permissiveContentTransformations' })` | System model variants |

## Tools

Apple runs the whole tool loop inside the session: the model calls a tool, waits for its output and continues, all
within one request. The provider therefore **executes tools itself**, and needs their `execute` functions.
**Register tools with the provider**; passing them only to `generateText` is not enough.

```ts
import { tool } from 'ai';

const tools = {
  weather: tool({
    description: 'Get the weather for a city',
    inputSchema: z.object({ city: z.string() }),
    execute: async ({ city }) => fetchWeather(city),
  }),
};

const result = await generateText({
  model: apple('system', { tools }), // the provider runs these
  tools,                             // optional: gives the AI SDK typed toolCalls / toolResults
  prompt: 'Weather in Delhi?',
});
result.toolCalls;   // [{ toolName: 'weather', input: { city: 'Delhi' }, providerExecuted: true }]
result.toolResults; // [{ toolName: 'weather', output: { ... } }]
```

- Tools made with this package's `defineTool` work too: `apple('system', { tools: [getWeather] })`.
- `createAppleProvider({ tools })` sets tools once for every model it creates.
- A tool passed to `generateText` but not registered with the provider is **not offered to the model**; the call
  returns an `unsupported` warning naming it.
- The AI SDK sees one step. `stopWhen`, `prepareStep` and client-side tool approval do not apply, because the loop
  never returns to the AI SDK between tool calls.
- Tool calling needs model assets that the iOS Simulator may lack (`MODEL_NOT_READY`). Test on a device.

## Settings mapping

| AI SDK | Apple |
| --- | --- |
| `system` | Session instructions |
| Earlier `messages` | Transcript entries (text, tool calls and tool results) |
| Last user message | The prompt. Image parts become image attachments (iOS 27). |
| `temperature`, `maxOutputTokens` | `GenerationOptions.temperature`, `maximumResponseTokens` |
| `topK` (+ `seed`) | `samplingMode: .random(top:seed:)` |
| `topP` (+ `seed`) | `samplingMode: .random(probabilityThreshold:seed:)` |
| `toolChoice: 'none'` / `'required'` | `toolCallingMode: disallowed` / `required` (iOS 27) |
| `reasoning: 'minimal' \| 'low'` / `'medium'` / `'high' \| 'xhigh'` | `reasoningLevel: light` / `moderate` / `deep` (iOS 27) |
| `output: Output.object({ schema })` | `respond(to:schema:)` with a `DynamicGenerationSchema` |
| `abortSignal` | Cancels the request |
| `usage` | Apple's token counts on iOS 27; `undefined` on iOS 26 |

Apple-specific options go through `providerOptions`:

```ts
await generateText({
  model: apple(),
  prompt,
  providerOptions: { apple: { reasoningLevel: { custom: 'extended' }, samplingMode: { type: 'greedy' }, includeSchemaInPrompt: false } },
});
```

Not supported (each produces an AI SDK warning, the call still runs): `stopSequences`, `presencePenalty`,
`frequencyPenalty`, `seed` without `topK`/`topP`, `toolChoice: { type: 'tool' }`, `reasoning: 'none'`, JSON output
without a schema, non-image files, and images in earlier messages.

## Behaviour to know

- **One session per call.** The AI SDK is stateless: every call sends the whole conversation, so the provider
  creates a session, replays the earlier messages into it, answers, and disposes it. For long chats the native
  `Session` is cheaper because it keeps the model's cache between turns.
- **The conversation must end with a user message.** Otherwise the call rejects with `INVALID_PROMPT`.
- **Structured output is not streamed incrementally.** With `streamText` + `Output.object`, the JSON arrives in one
  delta at the end. For partial objects use `session.streamObject()`.
- **Guardrails.** `GUARDRAIL_VIOLATION` and `REFUSAL` are reported as `finishReason: 'content-filter'` with empty
  text, not as exceptions.
- **Errors** are `AppleFoundationModelsError` (see [errors.md](./errors.md)): `CONTEXT_SIZE_EXCEEDED`,
  `MODEL_NOT_READY`, `RATE_LIMITED`, and so on. Set `maxRetries: 0` if you do not want the AI SDK to retry them.
- **The context window is small** (about 4096 tokens on device). Long `messages` arrays fail with
  `CONTEXT_SIZE_EXCEEDED`; trim them before calling.
- **Privacy.** `apple()` stays on device. `apple('privateCloudCompute')` and `apple('auto')` can send the
  conversation to Apple's Private Cloud Compute.

## What is verified

The provider is tested against the real `ai` package with a simulated native module (`src/__tests__/ai.test.ts`).
It has not yet been exercised inside a React Native app with the AI SDK's polyfills; see
[testing.md](./testing.md) for the manual check.
