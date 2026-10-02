# Private Cloud Compute (iOS 27)

`PrivateCloudComputeLanguageModel` is Apple's larger, server-based model running on
[Private Cloud Compute](https://security.apple.com/blog/private-cloud-compute/) (PCC). It supports longer contexts
and more capabilities than the on-device model, with Apple's PCC privacy guarantees.

## Entitlement

Apple: *"To develop with PCC you must meet certain eligibility requirements. To learn more and request access to the
managed entitlement, see [Accessing Private Cloud Compute](https://developer.apple.com/private-cloud-compute/)."*

This package never bypasses or fakes the entitlement. Once Apple grants it, add it with the config plugin using the
**exact key Apple provides** (the package intentionally does not hard-code it):

```json
{
  "expo": {
    "plugins": [["@fourlyn/apple-foundation-models", { "entitlements": { "<entitlement key from Apple>": true } }]]
  }
}
```

Bare React Native: add it in Xcode → Signing & Capabilities.

## Usage

```ts
const info = await AppleFoundationModels.getPrivateCloudComputeInfo(); // never throws
// { availability, isAvailable, quota, contextSize, supportedLanguages, capabilities }

const session = await createSession({ model: 'privateCloudCompute' });
```

`model: 'privateCloudCompute'` **never falls back**. If PCC is unavailable, `createSession` rejects with
`PRIVATE_CLOUD_COMPUTE_UNAVAILABLE` (`details.reason`: `DEVICE_NOT_ELIGIBLE` | `SYSTEM_NOT_READY`).

## Quota

```ts
info.quota = {
  status: 'belowLimit' | 'limitReached',
  isLimitReached: boolean,
  isApproachingLimit: boolean,
  resetDate: string | null,           // ISO-8601
  canRequestLimitIncrease: boolean,   // Apple offers the user a way to raise their limit
};
```

Requests over quota fail with `QUOTA_LIMIT_REACHED` (`details.resetDate`, `details.canRequestLimitIncrease`).
Other PCC errors: `NETWORK_FAILURE`, `PRIVATE_CLOUD_COMPUTE_UNAVAILABLE` (`SERVICE_UNAVAILABLE`).

## Missing entitlement

```ts
try {
  await session.respond(prompt);
} catch (error) {
  const missingEntitlement =
    isAppleFoundationModelsError(error, 'ENTITLEMENT_REQUIRED') ||
    (isAppleFoundationModelsError(error, 'PRIVATE_CLOUD_COMPUTE_UNAVAILABLE') && error.details.reason === 'ENTITLEMENT_REQUIRED');
  if (missingEntitlement) showSetupHint();
}
```

Apple's SDK has **no dedicated error or availability reason** for a missing entitlement. The package recognises it
from the text of Apple's error (a description mentioning an entitlement):

- on a `PrivateCloudComputeLanguageModel.Error`, the code stays `PRIVATE_CLOUD_COMPUTE_UNAVAILABLE` and
  `details.reason` becomes `ENTITLEMENT_REQUIRED`;
- on any other error, the code is `ENTITLEMENT_REQUIRED`.

Because this depends on Apple's wording, treat it as a hint. The original description is always in `error.message`
and `error.details.debugDescription`. It is also possible for an app without the entitlement to simply see PCC as
unavailable (`SYSTEM_NOT_READY` / `DEVICE_NOT_ELIGIBLE`); this has not been verified on an entitled or
unentitled device yet.

## `model: 'auto'` (Fourlyn abstraction, not an Apple API)

```ts
const session = await createSession({ model: 'auto' });
session.model; // 'system' or 'privateCloudCompute'
```

Resolution order: on-device system model if available → PCC if available → `MODEL_UNAVAILABLE`.
It is resolved once, at session creation.

## Privacy

- `system` model: prompts, images and outputs are processed **on device**.
- `privateCloudCompute`, or `auto` when it resolves to PCC: requests are sent to Apple's Private Cloud Compute servers.
  Tell users when a feature may use server processing.
- This package sends nothing anywhere, collects no analytics, and has no backend.
