# Apple API compatibility matrix

Source of truth: `FoundationModels.swiftinterface` and `_Vision_FoundationModels.swiftinterface` from the
**iOS 27.0 SDK** (Xcode 27A266a). "Tests" refers to the example app's Self-Test screen (`example/src/selfTest.tsx`,
run against the real model), JS unit tests (`src/__tests__`) and/or Swift unit tests (`ios/Tests`).

Legend: ✅ supported · 🟡 partial · ⛔ not exposed (with reason).

## Models & availability

| Apple API | Min OS | JS equivalent | Status | Limitations | Tests |
| --- | --- | --- | --- | --- | --- |
| `SystemLanguageModel.default` | 26.0 | `model: 'system'`, `systemModel()` | ✅ | | self-test |
| `SystemLanguageModel(useCase:guardrails:)` | 26.0 | `systemModel({ useCase, guardrails })`, `model: { type: 'system', ... }` | ✅ | | |
| `SystemLanguageModel.UseCase.general / .contentTagging` | 26.0 | `useCase: 'general' \| 'contentTagging'` | ✅ | | |
| `SystemLanguageModel.Guardrails.default / .permissiveContentTransformations` | 26.0 | `guardrails` | ✅ | | |
| `SystemLanguageModel.availability`, `.isAvailable` | 26.0 | `getAvailability()`, `model.isAvailable()` | ✅ | | self-test, unit |
| `Availability.UnavailableReason` (`deviceNotEligible`, `appleIntelligenceNotEnabled`, `modelNotReady`) | 26.0 | `availability.reason` | ✅ | future reasons → `unknown` | |
| `SystemLanguageModel.supportedLanguages` | 26.0 | `getModelInfo().supportedLanguages`, `model.getSupportedLanguages()` | ✅ | BCP-47 minimal identifiers | |
| `SystemLanguageModel.supportsLocale(_:)` | 26.0 | `supportsLocale(locale?)` | ✅ | | |
| `SystemLanguageModel.contextSize` | 26.0 (back-deployed) | `getModelInfo().contextSize`, `session.contextSize` | ✅ | | self-test |
| `SystemLanguageModel.tokenCount(for:)` (prompt, instructions, tools, schema, transcript entries) | 26.4 | `tokenCount(input)` | ✅ | returns the sum of the provided parts | self-test |
| `SystemLanguageModel.variant` (`core3`, `coreAdvanced3`, `displayName`) | 27.0 | `getModelInfo().variant` | ✅ | | |
| `LanguageModel.capabilities` (`vision`, `guidedGeneration`, `reasoning`, `toolCalling`) | 27.0 | `getModelInfo().capabilities` | ✅ | | |
| `SystemLanguageModel.Adapter` | 26.0 | — | ⛔ | Deprecated in 26.4, obsoleted in 27.0 by Apple. | |
| `PrivateCloudComputeLanguageModel()` | 27.0 | `model: 'privateCloudCompute'`, `privateCloudComputeModel()` | ✅ | needs Apple's managed entitlement | |
| `PrivateCloudComputeLanguageModel.availability` (`deviceNotEligible`, `systemNotReady`) | 27.0 | `getAvailability('privateCloudCompute')` | ✅ | | self-test |
| `PrivateCloudComputeLanguageModel.quotaUsage` (`status`, `isLimitReached`, `isApproachingLimit`, `resetDate`, `limitIncreaseSuggestion`) | 27.0 | `getPrivateCloudComputeInfo().quota` | 🟡 | `LimitIncreaseSuggestion.show()` not yet exposed (flag `canRequestLimitIncrease` only) | |
| `PrivateCloudComputeLanguageModel.contextSize / supportedLanguages / supportsLocale` | 27.0 | `getModelInfo('privateCloudCompute')`, `supportsLocale(l, 'privateCloudCompute')` | ✅ | | |
| `LanguageModel` protocol / `LanguageModelExecutor` (custom models) | 27.0 | — | ⛔ | Custom model providers are P3 (see roadmap). | |

## Sessions

| Apple API | Min OS | JS equivalent | Status | Limitations | Tests |
| --- | --- | --- | --- | --- | --- |
| `LanguageModelSession(model:tools:instructions:)` | 26.0 / 27.0 (any `LanguageModel`) | `createSession({ model, tools, instructions })` | ✅ | | self-test, unit |
| `LanguageModelSession(model:tools:transcript:)` | 26.0 | `createSession({ transcript })` | ✅ | | self-test |
| `LanguageModelSession(profile:history:)` | 27.0 | `createSession({ profiles })` | ✅ | | self-test |
| `LanguageModelSession(model:dynamicInstructions:history:)` | 27.0 | — | ⛔ | Covered by profiles. | |
| `respond(to:options:)` → `Response<String>` | 26.0 | `session.respond(prompt, options)` | ✅ | | self-test, unit |
| `respond(to:schema:includeSchemaInPrompt:options:)` | 26.0 | `generateObject`, `respondWithSchema` | ✅ | | self-test, unit |
| `respond(to:options:contextOptions:metadata:)` | 27.0 | `respond(prompt, { reasoningLevel, metadata, includeSchemaInPrompt })`, `respondAdvanced({ options, contextOptions, metadata })` | ✅ | | self-test, unit |
| `streamResponse(to:schema:options:contextOptions:metadata:)` | 27.0 | `streamAdvanced(request)` | ✅ | | self-test, unit |
| `Transcript(entries:)` built from `Transcript.Prompt / ToolCalls / ToolOutput / Response` | 26.0 | `createSession({ messages })` | ✅ | text content only | self-test, unit, swift |
| `respond(generating: T.self)` (`@Generable` types) | 26.0 | — | ⛔ | Swift macros can't be created from JS; runtime schemas are used instead. | |
| `streamResponse(...)` / `ResponseStream` / `Snapshot` | 26.0 | `session.stream()`, `session.streamObject()` | ✅ | | self-test, unit |
| `ResponseStream.collect()` | 26.0 | `stream.result` | ✅ | | |
| `Response.content / rawContent / transcriptEntries` | 26.0 | `text` / `object`, `rawContent`, `transcriptEntries` | ✅ | | |
| `Response.usage`, `Snapshot.usage`, `LanguageModelSession.usage` (`input.totalTokenCount`, `cachedTokenCount`, `output.totalTokenCount`, `reasoningTokenCount`) | 27.0 | `response.usage`, `session.usage` | ✅ | `Usage.metadata` not exposed | self-test |
| `LanguageModelSession.isResponding` | 26.0 | `session.isResponding` | ✅ | | |
| `LanguageModelSession.transcript` | 26.0 | `session.transcript` (sync), `session.getTranscript()` | ✅ | | self-test, unit |
| `LanguageModelSession.transcript` setter (`_modify`) | 27.0 | — | ⛔ | Use profiles `history` or restore a new session. | |
| `LanguageModelSession.transcriptErrorHandlingPolicy` (`revertTranscript`, `preserveTranscript`) | 27.0 | `transcriptErrorHandling: 'revert' \| 'preserve'` | ✅ | | |
| `prewarm(promptPrefix:)` | 26.0 | `session.prewarm({ promptPrefix })`, `createSession({ prewarm })` | ✅ | | self-test |
| `logFeedbackAttachment(sentiment:issues:desiredResponseText:)` | 26.0 | `session.createFeedbackAttachment()` | ✅ | `desiredOutput`/`desiredResponseContent` variants map to `desiredResponse` text | self-test |
| `LanguageModelFeedback.Sentiment` / `Issue.Category` | 26.0 | `sentiment`, `issues[].category` | ✅ | | |
| `LanguageModelSession.properties` / `SessionProperty` / `SessionPropertyValues.history` | 27.0 | internal (profiles) | 🟡 | Used internally; custom JS session properties not exposed. | |

## Generation options

| Apple API | Min OS | JS equivalent | Status |
| --- | --- | --- | --- |
| `GenerationOptions.temperature` | 26.0 | `temperature` | ✅ |
| `GenerationOptions.maximumResponseTokens` | 26.0 | `maximumResponseTokens` | ✅ |
| `GenerationOptions.SamplingMode.greedy` | 26.0 | `samplingMode: { type: 'greedy' }` | ✅ |
| `.random(top:seed:)` | 26.0 | `{ type: 'topK', k, seed }` | ✅ |
| `.random(probabilityThreshold:seed:)` | 26.0 | `{ type: 'probabilityThreshold', probabilityThreshold, seed }` | ✅ |
| `GenerationOptions.ToolCallingMode` (`allowed`, `required`, `disallowed`) | 27.0 | `toolCallingMode` | ✅ |
| `ContextOptions.includeSchemaInPrompt` | 27.0 (26.0 as `includeSchemaInPrompt:`) | `includeSchemaInPrompt` | ✅ |
| `ContextOptions.ReasoningLevel` (`light`, `moderate`, `deep`, `custom`) | 27.0 | `reasoningLevel` | ✅ |

## Structured generation

| Apple API | Min OS | JS equivalent | Status | Limitations |
| --- | --- | --- | --- | --- |
| `DynamicGenerationSchema(name:description:properties:)` | 26.0 | JSON Schema `object` | ✅ | |
| `DynamicGenerationSchema(arrayOf:minimumElements:maximumElements:)` | 26.0 | `array`, `minItems`, `maxItems` | ✅ | |
| `DynamicGenerationSchema(name:anyOf: [String])` | 26.0 | string `enum`, `const` | ✅ | |
| `DynamicGenerationSchema(name:anyOf: [DynamicGenerationSchema])` | 26.0 | `anyOf` / `oneOf` | ✅ | |
| `DynamicGenerationSchema(referenceTo:)` + `GenerationSchema(root:dependencies:)` | 26.0 | `$ref` + `$defs` | ✅ | local refs only |
| `DynamicGenerationSchema(type:guides:)` | 26.0 | `string`/`integer`/`number`/`boolean` | ✅ | |
| `DynamicGenerationSchema.null` | 26.4 | `type: 'null'` | ✅ | |
| `DynamicGenerationSchema.Property(isOptional:)` | 26.0 | not in `required` / nullable | ✅ | |
| `GenerationGuide.pattern(Regex)` | 26.0 | `pattern` | ✅ | Swift Regex syntax (mostly compatible with JS) |
| `GenerationGuide.minimum / maximum / range` (Int, Double) | 26.0 | `minimum`, `maximum` | ✅ | `exclusiveMinimum`/`Maximum` ignored |
| `GenerationGuide.count / minimumCount / maximumCount` | 26.0 | `minItems`, `maxItems` | ✅ | exact `count` via equal min/max |
| `GenerationGuide.constant / anyOf` (String) | 26.0 | `const`, `enum` | ✅ | |
| `GeneratedContent` (`jsonString`, `kind`, `isComplete`) | 26.0 | `rawContent`, `isComplete`, partial objects | ✅ | |
| `@Generable`, `@Guide` macros | 26.0 | — | ⛔ | compile-time Swift only |
| `ImageReference` (Generable) | 27.0 | — | ⛔ | planned |

## Tools

| Apple API | Min OS | JS equivalent | Status | Tests |
| --- | --- | --- | --- | --- |
| `Tool` protocol (`name`, `description`, `parameters`, `includesSchemaInInstructions`, `call(arguments:)`) | 26.0 | `defineTool` / tool objects with `execute` | ✅ | unit (parallel, errors, validation) |
| Parallel tool calls | 26.0 | concurrent `execute` | ✅ | unit |
| `LanguageModelSession.ToolCallError` | 26.0 | `TOOL_CALL_FAILED` | ✅ | |
| `OCRTool(name:description:)` (Vision) | 27.0, device | `OCRTool()` | ✅ | self-test (Simulator: `UNSUPPORTED_PLATFORM`) |
| `BarcodeReaderTool(name:description:)` (Vision) | 27.0, device | `BarcodeReaderTool()` | ✅ | |
| `SpotlightSearchTool` (CoreSpotlight) | 27.0 | — | ⛔ | planned |

## Multimodal

| Apple API | Min OS | JS equivalent | Status |
| --- | --- | --- | --- |
| `Attachment(imageURL:orientation:)` + `.label(_:)` | 27.0 | `images: [{ uri, label }]` | ✅ |
| `Attachment(CGImage / CIImage / CVPixelBuffer / UIImage)` | 27.0 | `images: [{ base64 }]` (written to a temp file) | 🟡 |
| `Transcript.AttachmentSegment` / `ImageAttachment` | 27.0 | transcript segment `{ type: 'attachment', uri, label }` | ✅ |

## Dynamic profiles

| Apple API | Min OS | JS equivalent | Status |
| --- | --- | --- | --- |
| `DynamicProfile`, `Profile`, `ConditionalDynamicProfile` | 27.0 | `profiles` + `setProfile()` | ✅ |
| `.model`, `.temperature`, `.samplingMode`, `.maximumResponseTokens`, `.reasoningLevel`, `.toolCallingMode` | 27.0 | profile options | ✅ |
| `.historyTransform` | 27.0 | `history` strategies (native), `historyTransform` callback (JS) | ✅ the callback can filter entries, not create or reorder them |
| `.transcriptErrorHandlingPolicy` modifier | 27.0 | — (session-level `transcriptErrorHandling`) | 🟡 |
| `.onActivate/.onDeactivate/.onPrompt/.onReasoning/.onResponse/.onToolCall/.onToolOutput` | 27.0 | `session.on('profile', ...)` | ✅ |
| `DynamicInstructions`, `DynamicInstructionsBuilder`, `ForEach` | 27.0 | — | ⛔ covered by per-profile instructions |
| `DynamicProfileModifier` | 27.0 | — | ⛔ |

## Transcript

| Apple API | Min OS | JS equivalent | Status |
| --- | --- | --- | --- |
| `Transcript` (Codable) | 26.0 | `transcript.json` | ✅ |
| `Transcript.Entry` (`instructions`, `prompt`, `toolCalls`, `toolOutput`, `response`, `reasoning`) | 26.0 / 27.0 | typed `TranscriptEntry` | ✅ |
| `Transcript.Segment` (`text`, `structure`, `attachment`) | 26.0 / 27.0 | typed `TranscriptSegment` | ✅ |
| `Transcript.ToolDefinition`, `ResponseFormat`, `Prompt.options` | 26.0 | on entries | ✅ |
| `Transcript.Reasoning.signature`, entry `metadata` | 27.0 | — | ⛔ |

## Errors

| Apple API | Min OS | JS code |
| --- | --- | --- |
| `LanguageModelError` (all 9 cases) | 27.0 | see [errors.md](./errors.md) |
| `LanguageModelSession.GenerationError` (deprecated in 27) | 26.0 | ✅ mapped |
| `LanguageModelSession.Error` (`concurrentRequests`, `transcriptMutationWhileResponding`) | 27.0 | ✅ |
| `SystemLanguageModel.Error.assetsUnavailable` | 27.0 | `MODEL_NOT_READY` |
| `PrivateCloudComputeLanguageModel.Error` (`networkFailure`, `quotaLimitReached`, `serviceUnavailable`) | 27.0 | ✅ |
| Missing PCC entitlement (no dedicated Apple error) | 27.0 | 🟡 `ENTITLEMENT_REQUIRED`, recognised from the error text |
| `GenerationSchema.SchemaError`, `GeneratedContent.ParsingError` | 26.0 / 27.0 | `INVALID_SCHEMA`, `DECODING_FAILED` |
| `Refusal.explanation` / `explanationStream` | 26.0 / 27.0 | ⛔ planned (`REFUSAL` details) |

## Roadmap (not yet exposed)

`ImageReference`, `SpotlightSearchTool`, `LimitIncreaseSuggestion.show()`, refusal explanations, custom
`LanguageModel` executors, JS-defined session properties.

The Vercel AI SDK provider is not an Apple API; see [ai-sdk.md](./ai-sdk.md).
