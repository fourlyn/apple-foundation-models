# @fourlyn/apple-foundation-models — Integration guide for AI agents

> Read this file instead of the full docs. It is self-contained and every snippet is valid TypeScript
> for the current API. Full docs: `docs/` (links at the end).

## What it is

React Native / Expo bridge to Apple's **Foundation Models** framework (Apple Intelligence LLMs):
on-device `SystemLanguageModel` and server-side `PrivateCloudComputeLanguageModel`.
No API keys, no network (on-device), no Fourlyn servers.

## Hard requirements (check before integrating)

| Requirement | Detail |
| --- | --- |
| Platform | iOS / iPadOS only. Android, web and Expo Go: package imports safely, `getAvailability()` returns `{ available: false, reason: 'unsupported' }`, `createSession()` throws `UNSUPPORTED_PLATFORM`. |
| Runtime OS | iOS **26.0+** on an Apple Intelligence device with Apple Intelligence enabled. Many features need **iOS 27** (table below). |
| Build tooling | Xcode **26+** (Xcode **27** to compile iOS 27 features). App deployment target can stay lower (min 16.4); calls are guarded at runtime. |
| Expo | Expo SDK 55+ **development build** (`npx expo run:ios` or EAS). **Not Expo Go.** |
| Bare RN | Run `npx install-expo-modules@latest` once, then `cd ios && pod install`. |

## Install

```sh
npx expo install @fourlyn/apple-foundation-models
npx expo prebuild -p ios   # only if the project uses CNG and has no ios/ folder yet
npx expo run:ios           # rebuild the native app (required after adding the package)
```

No config plugin is required for on-device use. Adding it is harmless:
`"plugins": ["@fourlyn/apple-foundation-models"]`.

## Minimal working integration

```ts
import { AppleFoundationModels, createSession } from '@fourlyn/apple-foundation-models';

const availability = await AppleFoundationModels.getAvailability();
if (!availability.available) {
  // availability.reason: 'deviceNotEligible' | 'appleIntelligenceNotEnabled' | 'modelNotReady' | 'unsupported' | ...
  return showFallbackUI(availability.reason);
}

const session = await createSession({ instructions: 'You are a concise assistant.' });
const { text } = await session.respond('Explain quantum computing simply.');
session.dispose(); // when the conversation is over
```

**Always gate features on `getAvailability()`.** Never assume the model exists. Handle `modelNotReady`
(assets downloading: retry later) differently from `deviceNotEligible` (never available).

## API cheat sheet

```ts
import {
  AppleFoundationModels, createSession, defineTool, jsonSchema,
  OCRTool, BarcodeReaderTool, AppleFoundationModelsError, isAppleFoundationModelsError,
} from '@fourlyn/apple-foundation-models';
import { useAvailability, useSession, useChat } from '@fourlyn/apple-foundation-models/react';
import { z } from 'zod'; // optional; any Standard JSON Schema library or plain JSON Schema works

// Model queries (never throw on unsupported platforms except getModelInfo/tokenCount)
await AppleFoundationModels.getAvailability();                       // system model
await AppleFoundationModels.getAvailability('privateCloudCompute');  // iOS 27
await AppleFoundationModels.getModelInfo();        // { contextSize, supportedLanguages, variant, capabilities, ... }
await AppleFoundationModels.tokenCount('text');    // iOS 26.4+
await AppleFoundationModels.getDiagnostics();      // device/OS/SDK/feature flags; attach to bug reports
const tagger = AppleFoundationModels.systemModel({ useCase: 'contentTagging' });

// Session
const session = await createSession({
  instructions: '...',
  model: 'system',               // 'system' | 'privateCloudCompute' | 'auto' | { type: 'system', useCase, guardrails }
  tools: [/* see Tools */],
  transcript: savedTranscript,   // restore a conversation
  prewarm: true,                 // optional latency optimization
});

// Text
const r = await session.respond('prompt', { temperature: 0.2, maximumResponseTokens: 300 });
r.text; r.usage /* iOS 27, else null */; r.transcriptEntries;

// Streaming (chunk.text is the FULL text so far; chunk.delta is the new part)
const stream = session.stream('Write a story');
for await (const chunk of stream) setText(chunk.text);
const final = await stream.result;
stream.cancel(); // or pass { signal } / break out of the loop

// Structured output (Zod, Standard JSON Schema, or JSON Schema)
const Person = z.object({ name: z.string(), age: z.number().int() });
const person = await session.generateObject({ prompt: 'Extract: Ada, 36', schema: Person }); // typed
const full = await session.respondWithSchema({ prompt, schema: Person }); // { object, usage, rawContent, ... }
for await (const c of session.streamObject({ prompt, schema: Person })) render(c.partial);

// Images (iOS 27) — pass local file URIs (file://...), not remote URLs
await session.respond({ prompt: 'Describe this', images: [{ uri: localFileUri }] });

// Conversation persistence
const transcript = await session.getTranscript(); // { entries (typed), json (lossless) }
await storage.set('chat', transcript.json);
const restored = await createSession({ transcript: await storage.get('chat') });
session.transcript;  // same snapshot, synchronous (encodes the whole conversation on each read)
session.contextSize; // context window of the session's model, or null
// No Apple transcript (history from another library)? Seed with plain messages instead:
await createSession({ instructions: '...', messages: [{ role: 'user', content: 'Hi' }, { role: 'assistant', content: 'Hello!' }] });

// Advanced: one request object shaped like Apple's respond(to:schema:options:contextOptions:metadata:)
const r = await session.respondAdvanced({
  prompt, schema: Person /* optional */,
  options: { temperature: 0, samplingMode: { type: 'greedy' } },   // GenerationOptions
  contextOptions: { reasoningLevel: 'deep' },                        // ContextOptions (iOS 27)
});
r.text; r.object; r.rawContent; r.usage; r.transcriptEntries; r.model; r.durationMs;
for await (const c of session.streamAdvanced({ prompt, schema: Person })) render(c.partial ?? c.text);

// Cancellation
const controller = new AbortController();
session.respond('...', { signal: controller.signal }); controller.abort(); // rejects with code CANCELLED
```

## Tools (function calling)

```ts
const getWeather = defineTool({
  name: 'getWeather',                                   // letters, digits, _ or -
  description: 'Get the current weather for a city',
  parameters: z.object({ city: z.string() }),           // must be an object schema
  execute: async ({ city }, { signal }) => fetchWeather(city, { signal }),
  // returns: string (sent verbatim) or any JSON-serializable value
});

const session = await createSession({ tools: [getWeather] });
session.on('toolCall', (e) => log(e.toolName, e.arguments));
session.on('toolResult', (e) => log(e.result, e.durationMs));
await session.respond('Weather in Delhi and Mumbai?'); // parallel tool calls run concurrently
```

- If `execute` throws, the model receives the failure (request may then fail with `TOOL_CALL_FAILED`).
- Arguments are validated against Zod/Standard schemas before `execute` (`validateArguments: false` to skip).
- Native Apple tools (iOS 27, **device only, not in the Simulator**): `tools: [OCRTool(), BarcodeReaderTool()]`.

## Feature / OS matrix

| Feature | Min iOS | Notes |
| --- | --- | --- |
| Sessions, respond, stream, structured output, tools, prewarm, transcripts, feedback | 26.0 | |
| `tokenCount` | 26.4 | |
| `usage`, `toolCallingMode`, `reasoningLevel`, images, `privateCloudCompute`, dynamic `profiles`, Vision tools, `transcriptErrorHandling`, model `variant`/`capabilities` | 27.0 | App must be built with Xcode 27. |

Unsupported feature ⇒ throws `AppleFoundationModelsError` with code `UNSUPPORTED_OS_VERSION`
(`details.reason`: `OS_VERSION` or `SDK_VERSION`). Check `(await getDiagnostics()).features.<name>` to branch.

## Dynamic profiles (iOS 27)

```ts
const session = await createSession({
  instructions: 'You are a helpful assistant.',
  tools: [searchTool, editTool],
  profiles: {
    chat:   { temperature: 0.7, tools: [] },
    editor: { instructions: 'Help the user edit images.', tools: ['editTool'], history: { strategy: 'lastTurns', count: 4 } },
    research: { tools: ['searchTool'], requiredToolCalls: 1 }, // must call a tool, then may answer
    // Custom history filter (runs after `history`). Filter only; must answer within 2 s or it is skipped.
    support: { historyTransform: (entries) => entries.filter((e) => e.type !== 'toolOutput') },
  },
  initialProfile: 'chat',
});
session.setProfile('editor'); // applies to the next request
session.on('profile', (e) => log(e.profile, e.event)); // activate | deactivate | prompt | response | toolCall | toolOutput | reasoning
```

## Vercel AI SDK (optional, `ai` 7.x)

```ts
import { apple } from '@fourlyn/apple-foundation-models/ai'; // apple() | apple('privateCloudCompute') | apple('auto')
import { generateText, streamText, tool } from 'ai';

const { text } = await generateText({ model: apple(), system: 'Be brief.', prompt: 'Hello' });

// Tools run inside the Apple session, so register them WITH THE PROVIDER (they need `execute`):
const tools = { weather: tool({ description: '...', inputSchema: z.object({ city: z.string() }), execute: getWeather }) };
await generateText({ model: apple('system', { tools }), tools, prompt: 'Weather in Delhi?' });
```

- Tools passed only to `generateText` are ignored (an `unsupported` warning is returned).
- The conversation must end with a user message (`INVALID_PROMPT` otherwise).
- A new session is created per call; guardrail/refusal becomes `finishReason: 'content-filter'`.
- Needs the AI SDK's React Native polyfills (`ReadableStream`, `structuredClone`). Details: `docs/ai-sdk.md`.

## Pitfalls (read these)

1. **One request at a time per session.** Apple rejects concurrent requests; this package queues them by default
   (`queueRequests: true`). Use separate sessions for truly parallel work.
2. **`toolCallingMode: 'required'` needs an exit strategy**, otherwise the model keeps calling tools. Use a profile
   with `requiredToolCalls: N`, or throw from the tool.
3. **Context window is small** (~4096 tokens on-device). Long chats hit `CONTEXT_SIZE_EXCEEDED`: start a new session,
   or use a profile `history` strategy, or summarize and restore.
4. **Background apps get `RATE_LIMITED`.** Run generation while the app is in the foreground.
5. **Model output changes across iOS releases** (`variant` changes). Don't snapshot-test exact text.
6. **Cancellation** stops delivery immediately; Apple may keep finishing the generation internally, so the *next*
   request on the same session can start a little later. Create a new session if you need it instantly.
7. **Images**: local `file://` URIs (e.g. from `expo-image-picker` / `expo-file-system`) or `{ base64 }`. Remote URLs are rejected.
8. **`model: 'auto'`** is a Fourlyn convenience (on-device first, then Private Cloud Compute), not an Apple API.
   `model: 'privateCloudCompute'` never silently falls back.
9. **Private Cloud Compute** needs Apple's managed entitlement. Add the key Apple gives you via the config plugin:
   `["@fourlyn/apple-foundation-models", { "entitlements": { "<key>": true } }]`.
10. **iOS 27 app launch crash** `UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption` is not caused by this
    package: iOS 27 requires the UIScene life cycle. Expo apps: use `ExpoAppSceneDelegate`
    (see `example/plugins/withSceneLifecycle.js`).
11. Always `session.dispose()` sessions you create outside React hooks (hooks dispose automatically).

## Errors

All errors are `AppleFoundationModelsError { code, message, details, nativeType }`.

```ts
try { await session.respond(prompt); }
catch (e) {
  if (isAppleFoundationModelsError(e, 'CONTEXT_SIZE_EXCEEDED')) startNewSession();
  else if (isAppleFoundationModelsError(e, 'GUARDRAIL_VIOLATION') || isAppleFoundationModelsError(e, 'REFUSAL')) showSafeMessage();
  else if (isAppleFoundationModelsError(e, 'CANCELLED')) {/* user stopped */}
  else throw e;
}
```

| Code | Meaning / action |
| --- | --- |
| `UNSUPPORTED_PLATFORM` | Not iOS, Expo Go, or feature missing in the Simulator. Hide the feature. |
| `UNSUPPORTED_OS_VERSION` | Feature needs newer iOS (`OS_VERSION`) or a newer Xcode build (`SDK_VERSION`). |
| `MODEL_NOT_READY` | Model assets downloading/missing. Retry later. |
| `MODEL_UNAVAILABLE` | `auto` found no usable model. |
| `CONTEXT_SIZE_EXCEEDED` | Too many tokens. `details.contextSize`, `details.tokenCount` (iOS 27). |
| `RATE_LIMITED` | Throttled (often background). `details.resetDate`. |
| `GUARDRAIL_VIOLATION` / `REFUSAL` | Safety system blocked or model declined. |
| `UNSUPPORTED_LANGUAGE_OR_LOCALE` | Language not supported. Check `supportsLocale()`. |
| `UNSUPPORTED_TRANSCRIPT_CONTENT` / `UNSUPPORTED_CAPABILITY` | Content (e.g. an image) the model can't handle. |
| `TOOL_CALL_FAILED` | A tool threw. `details.toolName`. |
| `INVALID_SCHEMA` / `SCHEMA_VALIDATION_FAILED` | Schema not convertible / output failed Zod validation. |
| `CONCURRENT_REQUESTS` | Only with `queueRequests: false`. |
| `PRIVATE_CLOUD_COMPUTE_UNAVAILABLE` / `QUOTA_LIMIT_REACHED` / `NETWORK_FAILURE` | PCC issues. `details.reason` may be `ENTITLEMENT_REQUIRED`. |
| `ENTITLEMENT_REQUIRED` | Apple's error says an entitlement is missing (detected from its text; treat as a hint). |
| `CANCELLED` / `SESSION_DISPOSED` / `TIMEOUT` / `DECODING_FAILED` / `GENERATION_FAILED` / `UNKNOWN` | As named. |

## JSON Schema subset supported for structured output / tool parameters

`type` (object, array, string, integer, number, boolean, nullable via `["string","null"]`), `properties`, `required`
(non-required ⇒ optional), `items`, `minItems`, `maxItems`, string `enum` / `const`, `pattern`, `minimum`, `maximum`,
`anyOf`/`oneOf`, `$ref` to local `$defs`, `description`. Property order is preserved (put reasoning fields first).
Not supported: `additionalProperties` (ignored), non-string enums, `format`, conditional keywords.

## React hooks

```tsx
const { availability } = useAvailability();
const { session, error } = useSession({ instructions: '...' }); // disposed on unmount
const { messages, send, stop, isResponding } = useChat({ instructions: 'Be brief.' }); // streaming chat state
```

## Privacy

On-device requests never leave the device. `privateCloudCompute`/`auto` may send data to Apple's Private Cloud
Compute. The package itself collects and sends nothing.

## More

`docs/getting-started.md` · `docs/sessions.md` · `docs/streaming.md` · `docs/structured-generation.md` ·
`docs/tools.md` · `docs/multimodal.md` · `docs/private-cloud-compute.md` · `docs/dynamic-profiles.md` ·
`docs/transcripts.md` · `docs/errors.md` · `docs/expo.md` · `docs/react-native.md` · `docs/advanced.md` ·
`docs/ai-sdk.md` · `docs/testing.md` · `docs/apple-api-matrix.md` · `docs/competitive-matrix.md` · example app: `example/`.
