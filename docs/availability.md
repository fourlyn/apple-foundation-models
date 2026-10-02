# Availability, model info & diagnostics

## `getAvailability(model?)`

```ts
const availability = await AppleFoundationModels.getAvailability();              // system model
await AppleFoundationModels.getAvailability('privateCloudCompute');             // iOS 27
await AppleFoundationModels.getAvailability('auto');                            // which model `auto` would use
```

Never throws. Returns:

```ts
{ status: 'available', available: true, model: 'system' }
{ status: 'unavailable', available: false, reason: 'appleIntelligenceNotEnabled', nativeReason: '...' }
```

| `reason` | Apple source | What to do |
| --- | --- | --- |
| `deviceNotEligible` | `SystemLanguageModel.Availability.UnavailableReason.deviceNotEligible` (also PCC) | Hide the feature permanently. |
| `appleIntelligenceNotEnabled` | `.appleIntelligenceNotEnabled` | Ask the user to enable Apple Intelligence. |
| `modelNotReady` | `.modelNotReady` | Assets downloading; check again later. |
| `systemNotReady` | `PrivateCloudComputeLanguageModel...UnavailableReason.systemNotReady` | PCC not ready; retry later. |
| `unsupported` | *(Fourlyn)* | Not iOS, iOS < 26, or no native module (Expo Go). |
| `unknown` | *(Fourlyn)* | A reason added by a newer OS; treat as unavailable. |

Availability can change while the app runs (the user can disable Apple Intelligence, assets can be deleted).
Re-check when the app returns to the foreground (`useAvailability().refresh`).

**Native mapping:** `SystemLanguageModel.availability`, `PrivateCloudComputeLanguageModel.availability`.

## Model handles

```ts
const model = AppleFoundationModels.systemModel({ useCase: 'contentTagging', guardrails: 'default' });
await model.isAvailable();
await model.getContextSize();          // e.g. 4096
await model.getSupportedLanguages();   // ['de', 'en', 'es', ...]
await model.supportsLocale('fr-FR');
await model.tokenCount('Hello');       // iOS 26.4+
const session = await model.createSession({ instructions: '...' });
```

`useCase` maps to `SystemLanguageModel.UseCase` (`general`, `contentTagging`). `guardrails` maps to
`SystemLanguageModel.Guardrails` (`default`, `permissiveContentTransformations`: use the latter only for
transforming user-provided text, e.g. summarizing content that itself discusses sensitive topics).

## `getModelInfo(model?)`

```ts
{
  model: 'system',
  availability: { status: 'available', available: true },
  isAvailable: true,
  contextSize: 4096,
  supportedLanguages: ['de', 'en', ...],
  variant: { id: 'core3', displayName: '...' } | null,   // iOS 27: 'core3' | 'coreAdvanced3'
  capabilities: { vision, guidedGeneration, reasoning, toolCalling } | null,  // iOS 27
}
```

Apple updates the model with OS releases (`variant`). **Outputs can change between iOS versions**: test prompts on
each new OS and never assert exact model output.

## `getDiagnostics()`

One call with everything relevant for a bug report: OS version, device model identifier, which SDK the app was
compiled with, system/PCC model info, and a `features` map (`tokenCounting`, `usage`, `images`, `dynamicProfiles`,
`privateCloudCompute`, `visionTools`, ...). Use `features` to branch UI by capability instead of parsing OS versions.
