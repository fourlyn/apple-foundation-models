# Errors

Every error thrown by the package is an `AppleFoundationModelsError`:

```ts
class AppleFoundationModelsError extends Error {
  code: ErrorCode;                  // stable, documented below
  message: string;                  // Apple's localized description when available
  details: Record<string, unknown>; // code-specific data
  nativeType?: string;              // Swift type, e.g. 'LanguageModelError'
}
```

```ts
import { isAppleFoundationModelsError } from '@fourlyn/apple-foundation-models';

try {
  await session.respond(prompt);
} catch (error) {
  if (isAppleFoundationModelsError(error, 'CONTEXT_SIZE_EXCEEDED')) { /* start a new session */ }
  else if (isAppleFoundationModelsError(error)) { console.warn(error.code, error.details); }
  else throw error;
}
```

Availability queries (`getAvailability`, `getPrivateCloudComputeInfo`, `getDiagnostics`, `supportsLocale`) never
throw: they report unavailability as data.

## Codes

| Code | Source (Swift) | `details` | Typical handling |
| --- | --- | --- | --- |
| `UNSUPPORTED_PLATFORM` | no native module (Android, web, Expo Go); Vision tools in the Simulator | `reason?` | Hide the feature. |
| `UNSUPPORTED_OS_VERSION` | feature newer than the OS or than the SDK the app was built with | `feature`, `reason: 'OS_VERSION' \| 'SDK_VERSION'`, `minimumOS` / `minimumSDK` | Hide or degrade. |
| `DEVICE_NOT_ELIGIBLE`, `APPLE_INTELLIGENCE_DISABLED` | reserved; availability reports these as `reason` | | Use `getAvailability()`. |
| `MODEL_NOT_READY` | `SystemLanguageModel.Error.assetsUnavailable`, `GenerationError.assetsUnavailable`, model-asset errors (`ModelManagerServices`, `UnifiedAssetFramework`, also when nested as underlying errors) | `debugDescription`, `underlyingErrors` | Retry later. In the Simulator, some assets (tools, vision) may never arrive: test on device. |
| `MODEL_UNAVAILABLE` | `model: 'auto'` found no model | `systemAvailability` | Show fallback. |
| `CONTEXT_SIZE_EXCEEDED` | `LanguageModelError.contextSizeExceeded`, `GenerationError.exceededContextWindowSize` | `contextSize`, `tokenCount` (iOS 27) | New session / trim history. |
| `RATE_LIMITED` | `LanguageModelError.rateLimited`, `GenerationError.rateLimited` | `resetDate` (iOS 27) | Retry later; stay in foreground. |
| `GUARDRAIL_VIOLATION` | `.guardrailViolation` | | Rephrase / explain. |
| `REFUSAL` | `.refusal` | | Model declined. |
| `UNSUPPORTED_LANGUAGE_OR_LOCALE` | `.unsupportedLanguageOrLocale` | `languageCode` (iOS 27) | Check `supportsLocale()`. |
| `UNSUPPORTED_CAPABILITY` | `LanguageModelError.unsupportedCapability` | `capability` | e.g. images on a text-only model. |
| `UNSUPPORTED_TRANSCRIPT_CONTENT` | `LanguageModelError.unsupportedTranscriptContent` | `entryCount` | e.g. unreadable image. |
| `TIMEOUT` | `LanguageModelError.timeout` | | Retry. |
| `CONCURRENT_REQUESTS` | `LanguageModelSession.Error.concurrentRequests` | | Only with `queueRequests: false`. |
| `TRANSCRIPT_MUTATION_WHILE_RESPONDING` | `LanguageModelSession.Error.transcriptMutationWhileResponding` | | |
| `DECODING_FAILED` | `GeneratedContent.ParsingError`, `GenerationError.decodingFailure` | `rawContent` (iOS 27) | |
| `GENERATION_FAILED` | other framework errors (incl. bridged `NSError`s from FoundationModels) | `domain`, `nativeCode`, `userInfo` | Report with `getDiagnostics()`. |
| `TOOL_CALL_FAILED` | `LanguageModelSession.ToolCallError` / JS `execute` threw | `toolName`, `underlyingMessage` | |
| `INVALID_SCHEMA` | `GenerationSchema.SchemaError`, unsupported guides, schema conversion | `debugDescription`, `schemaName` | Fix the schema. |
| `SCHEMA_VALIDATION_FAILED` | Zod / Standard Schema validation (JS) | `issues`, `value` | Loosen the schema or retry. |
| `INVALID_PROMPT`, `INVALID_ARGUMENT`, `INVALID_TRANSCRIPT` | bridge input validation | | Fix the call. |
| `PRIVATE_CLOUD_COMPUTE_UNAVAILABLE` | PCC unavailable / `.serviceUnavailable` | `reason`: `DEVICE_NOT_ELIGIBLE` \| `SYSTEM_NOT_READY` \| `SERVICE_UNAVAILABLE` \| `ENTITLEMENT_REQUIRED` | Check `reason`. |
| `QUOTA_LIMIT_REACHED` | `PrivateCloudComputeLanguageModel.Error.quotaLimitReached` | `resetDate`, `canRequestLimitIncrease` | |
| `NETWORK_FAILURE` | `PrivateCloudComputeLanguageModel.Error.networkFailure` | | Retry. |
| `ENTITLEMENT_REQUIRED` | any other error whose description says an entitlement is missing | `reason: 'ENTITLEMENT_REQUIRED'`, `domain`, `nativeCode` | Add Apple's entitlement. See [PCC](./private-cloud-compute.md#missing-entitlement). |
| `SESSION_DISPOSED` | session used after `dispose()` | | |
| `CANCELLED` | `CancellationError`, aborted signal, `stream.cancel()` | | Usually ignore. |
| `UNKNOWN` | anything else | `domain`, `nativeCode`, `debugDescription`, `userInfo` | Report it. |

The mapping lives in `ios/FMErrors.swift` (native) and `src/errors.ts` (codes). iOS 27 errors
(`LanguageModelError`) carry more structured details than iOS 26 (`GenerationError`), whose cases Apple deprecated in iOS 27.
