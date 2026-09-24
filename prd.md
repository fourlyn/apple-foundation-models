# PRD: @fourlyn/apple-foundation-models

## 1. Product Overview

### Package Name

`@fourlyn/apple-foundation-models`

### Package Description

A production-ready, TypeScript-first React Native and Expo SDK that provides access to Apple's Foundation Models framework.

The package should expose Apple's native Foundation Models capabilities through an ergonomic JavaScript/TypeScript API while preserving as much of Apple's native functionality as possible.

The goal is **not** to create another simple LLM wrapper.

The goal is:

> Build the most complete React Native/Expo TypeScript bridge to Apple's Foundation Models framework.

The package should support both simple use cases such as:

```ts
const response = await session.respond("Summarize this");
```

and advanced agentic applications involving:

* structured generation
* streaming
* tool calling
* dynamic profiles
* multimodal prompts
* model selection
* Private Cloud Compute
* transcripts
* token/context inspection
* usage information
* availability/capability detection
* feedback
* prewarming

---

# 2. Problem

Apple provides powerful on-device and server-assisted Foundation Models APIs through Swift.

React Native developers currently need to write Swift/native code themselves or rely on third-party packages that expose only subsets of Apple's API.

Existing ecosystem examples include:

* `@react-native-ai/apple`
* `react-native-apple-llm`
* `@ratley/react-native-apple-foundation-models`
* several Expo Apple Intelligence wrappers

`@react-native-ai/apple` already provides Foundation Models integration with Vercel AI SDK compatibility, including text generation, structured outputs, tool calling and streaming.

Therefore, simply exposing those same four features is insufficient.

The opportunity is to create a **complete native API bridge** that tracks Apple's evolving Foundation Models API more closely.

---

# 3. Goals

## Primary Goals

1. Support React Native New Architecture.
2. Support Expo through Expo Modules.
3. Provide a TypeScript-first API.
4. Expose Apple's Foundation Models functionality rather than hiding important native capabilities.
5. Support iOS/iPadOS/macOS where technically applicable, while initially prioritizing iOS.
6. Provide excellent availability/error handling.
7. Support streaming.
8. Support structured generation.
9. Support tool calling.
10. Support multimodal input.
11. Support Private Cloud Compute where Apple's entitlement/access requirements allow it.
12. Support dynamic profiles.
13. Provide a clean abstraction over Apple model selection.
14. Keep the package extensible as Apple adds APIs.
15. Provide comprehensive documentation and examples.
16. Provide an optional integration path with Vercel AI SDK.

---

# 4. Non-Goals

The initial package should NOT:

* implement its own LLM
* download or bundle an LLM
* replace Apple's Foundation Models
* implement Android support
* implement arbitrary third-party remote AI providers
* implement Core AI in the same package
* implement App Intents/Siri in the first version
* bypass Apple's entitlements
* bypass Apple Intelligence availability restrictions
* fake Foundation Models functionality on unsupported devices

Future packages may handle:

```text
@fourlyn/core-ai
@fourlyn/apple-intents
```

---

# 5. Technical Foundation

The native implementation should use:

```text
Swift
+
FoundationModels.framework
+
Expo Modules API
```

The JS layer should be:

```text
TypeScript
```

Architecture:

```text
React Native / Expo App
        │
        ▼
@fourlyn/apple-foundation-models
        │
        ▼
Expo Modules API
        │
        ▼
Swift Native Module
        │
        ▼
FoundationModels.framework
        │
        ├── SystemLanguageModel
        ├── PrivateCloudComputeLanguageModel
        ├── LanguageModelSession
        ├── DynamicProfile
        ├── Tool
        ├── GenerationSchema
        ├── GeneratedContent
        └── Transcript
```

Use Apple's native API as the source of truth.

Do not recreate model functionality in JavaScript.

---

# 6. Supported Platform Strategy

Initial target:

```text
iOS
iPadOS
```

Minimum deployment target should be determined from the current Foundation Models API requirements.

The implementation must compile conditionally when Foundation Models APIs are unavailable.

The package should never crash merely because it is imported on an unsupported platform.

Example:

```ts
const availability = await AppleFoundationModels.getAvailability();
```

should return an explicit unsupported state.

---

# 7. API Design Principles

## Principle 1 — TypeScript first

Developers should not need to understand Swift.

Bad:

```ts
respond({
  nativePromptObject: ...
});
```

Good:

```ts
session.respond("Summarize this document");
```

---

## Principle 2 — Do not hide Apple capabilities

If Apple exposes a useful native capability, the package should provide a corresponding JS API.

---

## Principle 3 — Native semantics should remain discoverable

Do not excessively simplify APIs if doing so prevents access to advanced Apple features.

---

## Principle 4 — Async-first

Most model operations should use:

```ts
Promise
AsyncIterable
```

where appropriate.

---

# 8. Core API

## 8.1 Availability

Expose:

```ts
AppleFoundationModels.getAvailability()
```

Example:

```ts
const availability =
  await AppleFoundationModels.getAvailability();
```

Possible result:

```ts
{
  status: "available"
}
```

or:

```ts
{
  status: "unavailable",
  reason: "deviceNotEligible"
}
```

Possible availability reasons should map Apple's native availability states rather than inventing generic errors.

At minimum support:

```text
available
deviceNotEligible
appleIntelligenceNotEnabled
modelNotReady
unsupported
unknown
```

The native implementation should preserve additional Apple states if introduced.

---

# 9. System Language Model

Expose the default system model.

```ts
const model =
  AppleFoundationModels.systemModel();
```

Support model/use-case configuration where Apple's API allows it.

Example:

```ts
const model =
  AppleFoundationModels.systemModel({
    useCase: "contentTagging"
  });
```

Do not hard-code only the default model.

---

# 10. Model Capabilities

Expose:

```ts
await AppleFoundationModels.getModelInfo();
```

Return information including where available:

```ts
{
  isAvailable: boolean,
  contextSize: number,
  supportedLanguages: string[],
  variant: string
}
```

Also expose:

```ts
model.isAvailable
model.availability
model.contextSize
model.supportedLanguages
model.supportsLocale(locale)
```

Apple currently exposes context size, supported languages, locale support and model variant through `SystemLanguageModel`.

---

# 11. Token Counting

Expose Apple's token counting APIs.

Example:

```ts
const count =
  await model.tokenCount("This is some text");
```

Also support counting instructions/prompts where Apple's native API supports it.

API:

```ts
model.tokenCount(input)
```

Return:

```ts
number
```

This is important for developers managing context windows.

---

# 12. Sessions

Expose:

```ts
const session =
  await AppleFoundationModels.createSession();
```

Support:

```ts
createSession({
  instructions?: string,
  model?: Model,
  tools?: Tool[],
  transcript?: Transcript
});
```

A session maintains conversation context.

Example:

```ts
const session = await createSession({
  instructions:
    "You are a concise financial assistant."
});

await session.respond(
  "What is compound interest?"
);

await session.respond(
  "Give me an example."
);
```

---

# 13. Response

Basic API:

```ts
const response =
  await session.respond(prompt);
```

Return an object rather than only a string.

Example:

```ts
{
  text: string,
  usage?: Usage,
  transcriptEntries?: TranscriptEntry[]
}
```

Developers should be able to access the raw text easily:

```ts
response.text
```

---

# 14. Generation Options

Expose Apple's `GenerationOptions`.

Support:

```ts
{
  temperature?: number,
  maximumResponseTokens?: number,
  samplingMode?: SamplingMode,
  toolCallingMode?: ToolCallingMode
}
```

Example:

```ts
await session.respond("Explain this", {
  temperature: 0.2,
  maximumResponseTokens: 300
});
```

Tool calling modes:

```text
allowed
required
disallowed
```

These must map directly to Apple's native semantics.

---

# 15. Streaming

Expose Apple's `ResponseStream`.

Preferred JS API:

```ts
const stream =
  session.stream("Write a short story");

for await (const chunk of stream) {
  console.log(chunk);
}
```

Each chunk should expose useful state.

Possible structure:

```ts
{
  text: string,
  delta?: string,
  isFinal: boolean
}
```

Do not unnecessarily convert Apple's partial-generation behavior into only token strings if that would lose structured-generation information.

Streaming must also support structured generation.

---

# 16. Structured Generation

This is a major feature.

Apple supports:

```text
@Generable
@Guide
GenerationSchema
DynamicGenerationSchema
GeneratedContent
```

The JS API cannot use Swift macros directly.

Therefore provide runtime schema support.

Example:

```ts
const result =
  await session.generateObject({
    prompt: "Extract the person's details",
    schema: {
      type: "object",
      properties: {
        name: {
          type: "string"
        },
        age: {
          type: "number"
        }
      },
      required: [
        "name",
        "age"
      ]
    }
  });
```

Return:

```ts
{
  name: string,
  age: number
}
```

---

# 17. Schema Support

The package should support a standard JSON Schema representation.

Additionally provide optional adapters for:

```text
Zod
```

Example:

```ts
const PersonSchema = z.object({
  name: z.string(),
  age: z.number()
});

const person =
  await session.generateObject({
    prompt,
    schema: PersonSchema
  });
```

The Zod adapter should be optional and must not make Zod a mandatory dependency.

Internally convert the schema into Apple's `GenerationSchema` / `DynamicGenerationSchema`.

---

# 18. Generated Content

Expose Apple's `GeneratedContent` concepts where needed.

Advanced users should be able to access:

```ts
response.rawContent
```

or equivalent.

Do not force every structured response through JSON serialization if doing so loses information.

---

# 19. Tool Calling

Tool calling is a first-class feature.

Example:

```ts
const session = await createSession({
  tools: [
    {
      name: "getWeather",
      description:
        "Get the current weather for a city",

      parameters: {
        type: "object",
        properties: {
          city: {
            type: "string"
          }
        },
        required: [
          "city"
        ]
      },

      execute: async ({ city }) => {
        return getWeather(city);
      }
    }
  ]
});
```

The JS function must execute when Apple requests the tool.

The result must be returned to the native session.

---

# 20. Tool Calling Lifecycle

The bridge must handle:

```text
JS → Swift
Swift → Apple Model
Apple Model → Tool Call
Swift → JS
JS → Tool Result
Swift → Apple Model
Apple Model → Final Response
```

Tool events should be exposed.

Example:

```ts
session.on("toolCall", handler);

session.on("toolResult", handler);
```

Events:

```ts
{
  toolName: string,
  arguments: unknown
}
```

and:

```ts
{
  toolName: string,
  result: unknown
}
```

---

# 21. Tool Calling Modes

Expose:

```ts
toolCallingMode: "allowed"
                  | "required"
                  | "disallowed"
```

Map directly to:

```text
GenerationOptions.ToolCallingMode
```

Important:

When `required` is used, developers must have an exit strategy because Apple can continue requesting tools.

The package documentation must explain this clearly.

---

# 22. Parallel Tool Calls

Apple can call multiple tools in parallel.

The bridge must not serialize tool calls unnecessarily.

Example:

```text
Model
 ├── getWeather(Delhi)
 ├── getWeather(Mumbai)
 └── getWeather(Bangalore)

              ↓

        JS Promise.all()
```

The implementation should preserve Apple's parallel behavior where possible.

---

# 23. Multimodal Prompts

Support image input.

Example:

```ts
await session.respond({
  prompt: "Describe this image",
  images: [
    {
      uri: imageUri
    }
  ]
});
```

Support:

```text
local file URI
base64 where appropriate
native image representation
```

Do not load unnecessarily large images into JS memory.

Prefer passing native file references through the bridge.

---

# 24. Vision Tool Integration

Apple's current Foundation Models updates describe using Vision framework tools such as:

```text
OCRTool
BarcodeReaderTool
```

for image analysis.

The architecture should allow these native tools to be exposed.

Potential API:

```ts
import {
  OCRTool,
  BarcodeReaderTool
} from "@fourlyn/apple-foundation-models";
```

Example:

```ts
createSession({
  tools: [
    new OCRTool(),
    new BarcodeReaderTool()
  ]
});
```

If Apple's API changes, keep these as optional native capabilities rather than making them mandatory.

---

# 25. Private Cloud Compute

Support Apple's:

```text
PrivateCloudComputeLanguageModel
```

Example:

```ts
const session = await createSession({
  model: "privateCloudCompute"
});
```

Also expose:

```ts
const availability =
  await AppleFoundationModels.getPrivateCloudAvailability();
```

Return quota information where available:

```ts
{
  available: boolean,
  quota?: {
    ...
  },
  contextSize?: number,
  supportedLanguages?: string[]
}
```

Expose Apple's quota information where technically possible.

---

# 26. Automatic Model Selection

Provide:

```ts
model: "system"
model: "privateCloudCompute"
model: "auto"
```

`auto` is a Fourlyn abstraction.

Example:

```ts
createSession({
  model: "auto"
});
```

The package may select an appropriate Apple model based on availability.

The package must document that `auto` is an abstraction created by Fourlyn and not an Apple API.

---

# 27. Private Cloud Compute Entitlements

The package must not attempt to bypass Apple's PCC entitlement system.

If PCC is unavailable because the application lacks required entitlement/access, return a structured error.

Example:

```ts
{
  code: "PRIVATE_CLOUD_COMPUTE_UNAVAILABLE",
  reason: "ENTITLEMENT_REQUIRED"
}
```

Do not silently fall back unless the developer explicitly requested:

```ts
model: "auto"
```

---

# 28. Prewarming

Expose:

```ts
await session.prewarm();
```

Also support Apple's:

```text
prewarm(promptPrefix:)
```

where practical:

```ts
await session.prewarm({
  promptPrefix: "You are a financial assistant."
});
```

This should be documented as a performance optimization.

---

# 29. Session State

Expose:

```ts
session.isResponding
```

and:

```ts
session.transcript
```

Developers should be able to inspect the current session.

---

# 30. Transcript

Expose transcript retrieval:

```ts
const transcript =
  session.getTranscript();
```

Transcript should contain typed entries.

Example:

```ts
[
  {
    type: "instructions",
    ...
  },
  {
    type: "prompt",
    ...
  },
  {
    type: "response",
    ...
  },
  {
    type: "toolCall",
    ...
  }
]
```

Do not discard tool-call information.

---

# 31. Session Restoration

Support Apple's transcript-based session creation.

Example:

```ts
const transcript =
  await session.getTranscript();

const restored =
  await createSession({
    transcript
  });
```

This allows apps to persist conversations.

---

# 32. Context Management

Expose context size:

```ts
session.contextSize
```

or:

```ts
model.contextSize
```

depending on Apple's native semantics.

Provide a helper:

```ts
const usage =
  await session.getUsage();
```

Possible result:

```ts
{
  inputTokens: number,
  outputTokens: number,
  totalTokens: number
}
```

Use Apple's actual usage fields where available.

Do not invent token accounting if Apple doesn't expose a specific metric.

---

# 33. Usage

Apple exposes session/response usage information.

Expose:

```ts
session.usage
response.usage
```

Example:

```ts
{
  inputTokens: number,
  outputTokens: number
}
```

If Apple exposes additional usage metrics, preserve them.

---

# 34. Dynamic Profiles

This should be a major differentiator.

Apple now exposes:

```text
LanguageModelSession.DynamicProfile
DynamicInstructions
Profile
ConditionalDynamicProfile
DynamicProfileModifier
SessionProperty
```

Dynamic profiles allow the model configuration to change based on application state.

Example JS API:

```ts
const session = await createSession({
  profile: {
    condition: "editingImage",

    instructions:
      "Help the user edit images",

    tools: [
      imageTools
    ]
  }
});
```

More advanced API:

```ts
session.setProfile({
  instructions,
  tools,
  model,
  temperature,
  reasoningLevel,
  maximumResponseTokens
});
```

Support profile lifecycle events:

```text
onActivate
onDeactivate
onPrompt
onReasoning
onResponse
onToolCall
onToolOutput
```

where the underlying Apple API makes these observable.

---

# 35. History Transformation

Expose Apple's dynamic profile history transformation capability.

Example:

```ts
profile.historyTransform(
  history => history.slice(-20)
);
```

For JavaScript:

```ts
createProfile({
  history: {
    strategy: "last",
    count: 20
  }
});
```

Also provide a low-level callback if feasible.

This allows applications to reduce context consumption without destroying the global transcript.

---

# 36. Reasoning Level

Where Apple's current API exposes:

```text
ContextOptions.ReasoningLevel
```

provide:

```ts
reasoningLevel:
  "low" |
  "medium" |
  "high"
```

Do not hard-code values until confirmed against the installed SDK version.

Use capability detection where necessary.

---

# 37. Temperature

Expose:

```ts
temperature?: number
```

Map directly to Apple's generation options.

---

# 38. Sampling Mode

Expose Apple's sampling modes.

Avoid converting this into arbitrary custom behavior.

Example:

```ts
samplingMode: {
  type: "greedy"
}
```

or whatever values are supported by the target SDK.

---

# 39. Feedback

Apple exposes:

```text
LanguageModelFeedback
logFeedbackAttachment()
```

Provide:

```ts
session.createFeedbackAttachment({
  sentiment,
  issues,
  desiredResponse
});
```

Return:

```ts
Uint8Array
```

or a file/Blob abstraction appropriate for React Native.

The package should document that this is intended for Apple's feedback/debugging workflows.

---

# 40. Error Model

Create a strongly typed error hierarchy.

Example:

```ts
AppleFoundationModelsError
```

with codes such as:

```text
UNSUPPORTED_PLATFORM
DEVICE_NOT_ELIGIBLE
APPLE_INTELLIGENCE_DISABLED
MODEL_NOT_READY
MODEL_UNAVAILABLE
CONTEXT_SIZE_EXCEEDED
RATE_LIMITED
GENERATION_FAILED
TOOL_CALL_FAILED
INVALID_SCHEMA
INVALID_PROMPT
PRIVATE_CLOUD_COMPUTE_UNAVAILABLE
ENTITLEMENT_REQUIRED
CANCELLED
UNKNOWN
```

Preserve Apple's underlying error information whenever possible.

---

# 41. Cancellation

Every long-running operation should support cancellation.

Example:

```ts
const controller =
  new AbortController();

const response =
  await session.respond(prompt, {
    signal: controller.signal
  });

controller.abort();
```

Streaming must also support cancellation.

---

# 42. Concurrency

The native implementation must safely handle:

* multiple sessions
* simultaneous tool calls
* cancellation
* concurrent requests
* React Native JS/native thread boundaries

Do not assume only one global session.

Each session should have a unique native identifier.

---

# 43. Memory Management

Native sessions must be released correctly.

Avoid:

```text
global Swift session dictionary
```

with no lifecycle management.

Preferred:

```text
JS Session Object
       ↓
Native Session ID
       ↓
Native Session Registry
       ↓
cleanup on dispose
```

Expose:

```ts
session.dispose();
```

where appropriate.

---

# 44. Expo Integration

The package must be implemented using Expo Modules.

Support:

```text
Expo development builds
Expo prebuild
Expo config plugins
Bare React Native
```

It must NOT require users to manually edit Swift files for standard installation.

---

# 45. Expo Go

Foundation Models functionality should be documented as unavailable in standard Expo Go if custom native code is required.

Users should use:

```text
Expo Development Build
```

or:

```text
Bare React Native
```

---

# 46. New Architecture

The package must support React Native's New Architecture.

Avoid legacy bridge assumptions.

Primary target:

```text
TurboModule / Expo Modules
```

---

# 47. Vercel AI SDK Compatibility

Provide an optional integration layer.

Do not make Vercel AI SDK a required dependency.

Possible package structure:

```text
@fourlyn/apple-foundation-models
@fourlyn/apple-foundation-models/ai
```

Example:

```ts
import { apple } from
  "@fourlyn/apple-foundation-models/ai";

generateText({
  model: apple(),
  prompt: "Explain this"
});
```

This should be implemented only after the native API is complete.

The native package remains the primary API.

---

# 48. TypeScript API Structure

Suggested structure:

```text
src/
  index.ts
  types.ts

  model/
    AppleModel.ts
    SystemModel.ts
    PrivateCloudModel.ts

  session/
    Session.ts

  tools/
    Tool.ts

  schema/
    schema.ts
    zod.ts

  transcript/
    Transcript.ts

  errors/
    errors.ts

  ai/
    provider.ts
```

Native:

```text
ios/
  AppleFoundationModelsModule.swift
  AppleFoundationModelsSession.swift
  AppleFoundationModelsTool.swift
  AppleFoundationModelsSchema.swift
  AppleFoundationModelsTranscript.swift
  AppleFoundationModelsErrors.swift
```

---

# 49. Package API Example

The final developer experience should look approximately like:

```ts
import {
  AppleFoundationModels,
  createSession
} from "@fourlyn/apple-foundation-models";

const availability =
  await AppleFoundationModels.getAvailability();

if (!availability.available) {
  return;
}

const session = await createSession({
  instructions:
    "You are a helpful assistant."
});

const response =
  await session.respond(
    "Explain quantum computing simply."
  );

console.log(response.text);
```

---

# 50. Advanced Agent Example

```ts
const session = await createSession({
  model: "auto",

  instructions: `
    You are a personal finance assistant.
    Always use available tools for current financial data.
  `,

  tools: [
    {
      name: "getExpenses",
      description:
        "Retrieve expenses from the user's database",

      parameters: {
        type: "object",
        properties: {
          month: {
            type: "string"
          }
        },
        required: ["month"]
      },

      execute: async ({ month }) => {
        return database.getExpenses(month);
      }
    }
  ]
});

const response =
  await session.respond(
    "How much did I spend this month?"
  );
```

---

# 51. Competitive Differentiation

The package must explicitly aim to differentiate from:

### `@react-native-ai/apple`

This package already provides:

* Foundation Models
* text generation
* structured output
* tool calling
* streaming
* Vercel AI SDK compatibility

Therefore we must not compete merely on those features.

Our differentiation should be:

```text
Full Apple API coverage
+
Native-first API
+
Dynamic Profiles
+
PCC
+
Multimodal
+
Transcript management
+
Context/token inspection
+
Model capabilities
+
Prewarming
+
Feedback
+
Advanced generation controls
+
Strong Expo integration
+
Version-aware API
```

Callstack's implementation is a major reference implementation and should be studied, not copied.

---

# 52. Competitive Research Requirement

Before implementation is considered complete, the agent must inspect:

```text
@react-native-ai/apple
react-native-apple-llm
@ratley/react-native-apple-foundation-models
expo-ai-kit
other active Expo Apple Intelligence packages
```

The agent must produce:

```text
docs/COMPETITIVE_MATRIX.md
```

containing:

| Feature               | Apple | Fourlyn | Competitor 1 | Competitor 2 |
| --------------------- | ----- | ------- | ------------ | ------------ |
| Text generation       | ✓     |         |              |              |
| Streaming             | ✓     |         |              |              |
| Structured generation | ✓     |         |              |              |
| Tool calling          | ✓     |         |              |              |
| Tool calling modes    | ✓     |         |              |              |
| Multimodal            | ✓     |         |              |              |
| PCC                   | ✓     |         |              |              |
| Dynamic Profiles      | ✓     |         |              |              |
| Context size          | ✓     |         |              |              |
| Token counting        | ✓     |         |              |              |
| Usage                 | ✓     |         |              |              |
| Transcript            | ✓     |         |              |              |
| Session restore       | ✓     |         |              |              |
| Prewarm               | ✓     |         |              |              |
| Feedback              | ✓     |         |              |              |
| Model variants        | ✓     |         |              |              |
| Supported languages   | ✓     |         |              |              |
| Locale support        | ✓     |         |              |              |
| Guardrails            | ✓     |         |              |              |
| Content tagging       | ✓     |         |              |              |
| Vision tools          | ✓     |         |              |              |
| Sampling              | ✓     |         |              |              |
| Temperature           | ✓     |         |              |              |
| Reasoning level       | ✓     |         |              |              |
| Dynamic history       | ✓     |         |              |              |

The agent must verify the matrix against Apple's current SDK documentation instead of assuming capabilities.

---

# 53. Apple API Compatibility Matrix

Create:

```text
docs/APPLE_API_MATRIX.md
```

Each Apple API must have:

```text
Apple API
Availability
Minimum OS
Swift signature
JS equivalent
Supported
Limitations
Tests
```

Example:

```text
Apple:
LanguageModelSession.respond(to:)

JS:
session.respond(prompt)

Status:
Supported
```

---

# 54. Version Strategy

Apple changes Foundation Models APIs between OS releases.

The package must use conditional availability.

For example:

```swift
if #available(iOS 27.0, *) {
   ...
}
```

New APIs should not break older supported iOS versions.

Where functionality is unavailable:

```ts
{
  supported: false,
  reason: "OS_VERSION"
}
```

rather than throwing during package initialization.

---

# 55. Model Version Awareness

Apple updates the system model with OS updates.

The package should expose:

```ts
model.variant
```

and document that model behavior can change across OS releases.

Do not promise identical output across iOS versions.

Apple explicitly notes that model versions align with OS releases and recommends testing prompts against updated models.

---

# 56. Testing Requirements

Create a native iOS test application.

Test on at least:

```text
Supported Apple Intelligence device
Unsupported device
Apple Intelligence disabled
Model downloading/not ready
Compatible iOS version
Older unsupported iOS version
```

Tests:

### Availability

* available
* unavailable
* device ineligible
* model not ready

### Sessions

* create
* respond
* multiple turns
* dispose
* restore transcript

### Streaming

* receive chunks
* final response
* cancellation

### Structured generation

* simple object
* nested object
* arrays
* enums
* invalid schema

### Tools

* one tool
* multiple tools
* parallel tools
* required tool
* disallowed tool
* tool failure

### PCC

* unavailable
* entitlement failure
* available
* quota

### Dynamic profiles

* profile selection
* profile switching
* tool changes
* instruction changes
* history transformation

### Errors

Every native error must map to a documented JS error.

---

# 57. Security Requirements

The package must not:

* send prompts to Fourlyn servers
* collect user prompts
* collect model outputs
* collect tool arguments
* collect transcripts
* upload analytics

The package is a native SDK.

By default:

```text
User Data
   ↓
Apple Foundation Models
```

not:

```text
User Data
   ↓
Fourlyn
   ↓
Apple
```

No Fourlyn backend should be required.

---

# 58. Privacy

Documentation must clearly explain:

* on-device processing
* Private Cloud Compute behavior
* Apple Intelligence availability
* app permissions
* what the package itself does and does not collect

Do not claim that all requests are always on-device because PCC is an available Apple model option.

---

# 59. Documentation

Create:

```text
README.md
docs/getting-started.md
docs/availability.md
docs/sessions.md
docs/streaming.md
docs/structured-generation.md
docs/tools.md
docs/multimodal.md
docs/private-cloud-compute.md
docs/dynamic-profiles.md
docs/transcripts.md
docs/errors.md
docs/expo.md
docs/react-native.md
docs/advanced.md
docs/competitive-matrix.md
docs/apple-api-matrix.md
```

---

# 60. Example Application

Create:

```text
example/
```

with an Expo development-build application.

Screens:

```text
Home
 ├── Availability
 ├── Basic Chat
 ├── Streaming
 ├── Structured Output
 ├── Tool Calling
 ├── Image Understanding
 ├── Dynamic Profiles
 ├── Transcript
 ├── Model Information
 └── Diagnostics
```

The example app is important because it becomes the manual QA environment.

---

# 61. Diagnostics

Provide:

```ts
AppleFoundationModels.getDiagnostics()
```

Example:

```ts
{
  platform: "ios",
  osVersion: "27.0",
  foundationModelsSupported: true,
  systemModelAvailable: true,
  privateCloudComputeAvailable: false,
  contextSize: 4096,
  supportedLanguages: [...]
}
```

This is especially useful for developers debugging device-specific issues.

---

# 62. API Surface Priority

## P0 — MVP

Must implement:

```text
Availability
SystemLanguageModel
Sessions
Instructions
Text generation
Streaming
GenerationOptions
Structured generation
Runtime schemas
Tool calling
Tool calling modes
Errors
Cancellation
Expo integration
New Architecture
```

## P1

Implement:

```text
Multimodal prompts
PCC
Transcript
Session restoration
Token counting
Context size
Usage
Prewarming
Model information
Supported languages
Locale support
```

## P2

Implement:

```text
Dynamic Profiles
Dynamic Instructions
History transformations
Reasoning level
Feedback attachments
Vision tools
Advanced metadata/context options
```

## P3

Investigate:

```text
Custom LanguageModel providers
Core AI integration
MLX integration
Custom adapters
App Intents
Siri
Vercel AI SDK provider
```

---

# 63. Important Implementation Rule

Do NOT expose only the simplified APIs.

The package should have two layers:

### High-level API

```ts
session.respond(...)
session.generateObject(...)
session.stream(...)
```

### Advanced API

```ts
session.respondAdvanced(...)
session.streamAdvanced(...)
GenerationSchema
GeneratedContent
ContextOptions
DynamicProfile
```

This allows normal developers to use a simple API while advanced developers can access Apple's full functionality.

---

# 64. Recommended Repository

Repository:

```text
fourlyn/apple-foundation-models
```

Package:

```text
@fourlyn/apple-foundation-models
```

License:

```text
MIT
```

unless Fourlyn chooses another license.

---

# 65. Release Strategy

### v0.1.0

Experimental developer release.

Support:

```text
availability
sessions
text generation
streaming
structured generation
tools
```

### v0.2.0

Add:

```text
multimodal
transcripts
PCC
usage
token/context APIs
prewarm
```

### v0.3.0

Add:

```text
dynamic profiles
advanced generation
feedback
vision tools
```

### v1.0.0

Requirements:

* stable API
* comprehensive tests
* Expo support
* RN New Architecture support
* documentation
* competitive matrix
* Apple API compatibility matrix
* example application
* CI
* release automation
* semantic versioning

---

# 66. Definition of Done

The project is NOT complete when:

```text
npm install works
```

It is complete when a React Native developer can:

1. Install the package.
2. Build an Expo development build.
3. Detect Foundation Models availability.
4. Start a session.
5. Generate text.
6. Stream text.
7. Generate structured data.
8. Define JavaScript tools.
9. Receive and execute tool calls.
10. Use multiple tools.
11. Pass images.
12. Inspect model capabilities.
13. Inspect token/context usage.
14. Persist and restore transcripts.
15. Prewarm the model.
16. Use PCC when entitled/available.
17. Use dynamic profiles.
18. Handle every important unavailable-device scenario.
19. Receive strongly typed errors.
20. Understand all limitations from the documentation.

---

# 67. Critical Research Finding

Apple's current Foundation Models framework exposes considerably more than basic text generation.

The current API includes:

```text
LanguageModel
SystemLanguageModel
PrivateCloudComputeLanguageModel
LanguageModelSession
DynamicProfile
DynamicInstructions
Profile
GenerationOptions
ContextOptions
Tool
GenerationSchema
DynamicGenerationSchema
GeneratedContent
Generable
Guide
Transcript
Response
ResponseStream
Usage
SessionProperty
LanguageModelFeedback
```

Apple also exposes model capabilities such as:

```text
availability
context size
supported languages
locale support
model variant
token counting
```

and newer APIs around:

```text
dynamic profiles
reasoning
tool-calling modes
multimodal prompts
Vision tools
Private Cloud Compute
```

These APIs should be treated as the source of truth for implementation.

---

# 68. Competitive Positioning

The package should NOT position itself as:

> "Another React Native Apple LLM wrapper."

Position it as:

> **The complete TypeScript/Expo SDK for Apple Foundation Models.**

The core differentiator is:

```text
Apple Native API
       ↓
Complete TypeScript abstraction
       ↓
React Native
       ↓
Expo
```

while preserving advanced Apple functionality.

Existing packages already prove demand for Apple Foundation Models in React Native. For example, `@react-native-ai/apple` already supports text generation, structured output, tool calling and streaming.

The Fourlyn package therefore needs to win on **breadth, native fidelity, API completeness, Expo experience, documentation, diagnostics, and fast adoption of new Apple APIs**, rather than simply duplicating those basic features.

---

# 69. Agent Instructions

The coding agent should follow this sequence:

### Phase 1 — Research

Before coding:

1. Read Apple's current Foundation Models documentation.
2. Enumerate every public API currently available.
3. Inspect Apple's Swift signatures.
4. Inspect minimum OS requirements.
5. Inspect current Xcode SDK availability.
6. Inspect existing React Native packages.
7. Inspect `@react-native-ai/apple`.
8. Produce `docs/APPLE_API_MATRIX.md`.
9. Produce `docs/COMPETITIVE_MATRIX.md`.

Do not start implementation until this research is complete.

### Phase 2 — Architecture

Design:

```text
TypeScript API
Expo Module
Swift bridge
Native session manager
Native tool manager
Schema conversion layer
Transcript conversion layer
Error conversion layer
Streaming/event layer
```

### Phase 3 — P0 Implementation

Implement:

```text
availability
sessions
instructions
text generation
streaming
structured generation
tools
tool calling modes
errors
cancellation
```

### Phase 4 — P1

Implement:

```text
multimodal
PCC
transcripts
usage
token counting
context size
prewarming
diagnostics
```

### Phase 5 — P2

Implement:

```text
dynamic profiles
reasoning
feedback
Vision tools
advanced context options
```

### Phase 6 — Testing

Build a real Expo example application and automated native/JS tests.

### Phase 7 — Documentation

Document every API with:

```text
Purpose
TypeScript example
Native mapping
Availability
OS requirements
Errors
Limitations
```

### Phase 8 — Release

Prepare:

```text
npm package
GitHub repository
CHANGELOG
README
API documentation
Example app
CI
semantic versioning
```

---

# 70. Final Product Vision

The long-term vision is:

```text
                    @fourlyn/apple-foundation-models

                               │
        ┌──────────────────────┼──────────────────────┐
        │                      │                      │
        ▼                      ▼                      ▼
   System Model              PCC                 Custom Models
        │                      │                      │
        └──────────────────────┼──────────────────────┘
                               │
                         Session Engine
                               │
       ┌──────────────┬────────┼──────────┬──────────────┐
       │              │        │          │              │
       ▼              ▼        ▼          ▼              ▼
    Text          Structured  Tools     Images       Streaming
       │              │        │          │              │
       └──────────────┴────────┴──────────┴──────────────┘
                               │
                       Dynamic Profiles
                               │
                         React Native
                               │
                             Expo
```

The package should become the **native Apple AI foundation layer for React Native developers**, rather than merely another wrapper around `respond()`.
