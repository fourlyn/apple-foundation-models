# @fourlyn/apple-foundation-models

**The complete TypeScript / Expo SDK for Apple Foundation Models.**

Use Apple Intelligence's language models from React Native: on-device, private, free, with no API keys.
This package bridges Apple's `FoundationModels` framework as faithfully as possible, covering the basics
(text, streaming, structured output, tools) and the newer APIs too: **dynamic profiles, Private Cloud Compute, image
prompts, Vision tools, transcripts, token counting, usage, reasoning levels, prewarming and feedback**.

```ts
import { AppleFoundationModels, createSession } from '@fourlyn/apple-foundation-models';

if ((await AppleFoundationModels.getAvailability()).available) {
  const session = await createSession({ instructions: 'You are a helpful assistant.' });
  const { text } = await session.respond('Explain quantum computing simply.');
}
```

> 🤖 **Using an AI coding agent?** Point it at [`AGENTS.md`](./AGENTS.md). It's a single-file integration guide.

## Features

| | |
| --- | --- |
| ✅ Availability & diagnostics | Maps Apple's exact unavailability reasons; `getDiagnostics()` for bug reports |
| ✅ Sessions & instructions | Multi-turn conversations, multiple concurrent sessions, automatic request queuing |
| ✅ Streaming | `for await` over chunks, with `delta` and revision (`replaced`) handling |
| ✅ Structured output | Zod (or any Standard JSON Schema) / JSON Schema → Apple `GenerationSchema`, typed results, partial-object streaming |
| ✅ Tool calling | JS tools with typed args, **parallel** execution, events, `toolCallingMode` |
| ✅ Cancellation | `AbortSignal` everywhere |
| ✅ Transcripts | Typed entries + lossless JSON for persistence and session restore |
| ✅ Token counting & usage | `tokenCount()`, per-response and per-session `usage` |
| ✅ Model info | Context size, supported languages, locale support, model variant, capabilities |
| ✅ Private Cloud Compute | Availability, quota, `model: 'privateCloudCompute' \| 'auto'` |
| ✅ Dynamic profiles | Switch instructions/tools/model/options mid-session, history strategies and callbacks, lifecycle events |
| ✅ Images & Vision tools | Image prompts, `OCRTool`, `BarcodeReaderTool` |
| ✅ React hooks | `useAvailability`, `useSession`, `useChat` |
| ✅ Vercel AI SDK | Optional provider: `generateText({ model: apple() })` |
| ✅ Safe everywhere | Importing on Android/web/Expo Go never crashes; unsupported states are explicit |

## Requirements

- iOS / iPadOS **26+** on an [Apple Intelligence](https://www.apple.com/apple-intelligence/)–capable device with Apple Intelligence enabled. iOS 27 unlocks more features ([matrix](./docs/apple-api-matrix.md)).
- Xcode **26+** (Xcode **27** to compile iOS 27 features).
- Expo SDK **55+** with a [development build](https://docs.expo.dev/develop/development-builds/introduction/), or bare React Native with [Expo Modules](./docs/react-native.md). **Expo Go is not supported** (no custom native code).
- React Native New Architecture (the default).

## Install

```sh
npx expo install @fourlyn/apple-foundation-models
npx expo run:ios
```

Bare React Native: `npx install-expo-modules@latest`, then `npm i @fourlyn/apple-foundation-models && cd ios && pod install`.

## Quick tour

```ts
import { createSession, defineTool } from '@fourlyn/apple-foundation-models';
import { z } from 'zod';

const session = await createSession({
  instructions: 'You are a travel assistant.',
  tools: [
    defineTool({
      name: 'getWeather',
      description: 'Current weather for a city',
      parameters: z.object({ city: z.string() }),
      execute: async ({ city }) => ({ city, temperatureCelsius: 31 }),
    }),
  ],
});

// Stream text
for await (const chunk of session.stream('Plan a day in Jaipur')) console.log(chunk.text);

// Structured output
const plan = await session.generateObject({
  prompt: 'Summarize the plan',
  schema: z.object({ title: z.string(), stops: z.array(z.string()).max(5) }),
});

// Persist & restore
const transcript = await session.getTranscript();
const restored = await createSession({ transcript: transcript.json });
```

## Documentation

| Guide | |
| --- | --- |
| [Getting started](./docs/getting-started.md) | Install, first request, availability UX |
| [Availability](./docs/availability.md) | Reasons, diagnostics, model info |
| [Sessions](./docs/sessions.md) | Instructions, options, queuing, prewarm, lifecycle |
| [Streaming](./docs/streaming.md) | Chunks, cancellation, partial objects |
| [Structured generation](./docs/structured-generation.md) | Zod, JSON Schema subset, typing |
| [Tools](./docs/tools.md) | JS tools, parallelism, modes, Vision tools |
| [Multimodal](./docs/multimodal.md) | Images |
| [Private Cloud Compute](./docs/private-cloud-compute.md) | Entitlement, quota, `auto` |
| [Dynamic profiles](./docs/dynamic-profiles.md) | Profiles, history strategies, events |
| [Transcripts](./docs/transcripts.md) | Inspect, persist, restore |
| [Errors](./docs/errors.md) | Every error code |
| [Expo](./docs/expo.md) · [React Native](./docs/react-native.md) | Platform setup |
| [Advanced](./docs/advanced.md) | Token budgeting, reasoning, sampling, feedback, performance |
| [Vercel AI SDK](./docs/ai-sdk.md) | `apple()` provider for `generateText` / `streamText` |
| [Testing](./docs/testing.md) · [Releasing](./docs/releasing.md) | Automated suites, manual QA checklist, publishing |
| [Apple API matrix](./docs/apple-api-matrix.md) | Every Apple API → JS equivalent |
| [Competitive matrix](./docs/competitive-matrix.md) | How this compares |
| [AGENTS.md](./AGENTS.md) | One-file guide for AI agents |

## Privacy

This package has no backend and collects nothing. With the default `system` model, prompts are processed
**on device**. If you choose `privateCloudCompute` (or `auto` falls back to it), requests go to Apple's
[Private Cloud Compute](https://security.apple.com/blog/private-cloud-compute/). See [privacy notes](./docs/private-cloud-compute.md#privacy).

## Example app

[`example/`](./example) is an Expo development build with screens for every feature and a **Self-Test** screen that
runs end-to-end checks against the real model. See [example/README.md](./example/README.md).

## License

MIT © Fourlyn
