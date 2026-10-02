# Expo

## Install

```sh
npx expo install @fourlyn/apple-foundation-models
npx expo run:ios            # local development build
# or
eas build --profile development --platform ios
```

- **Expo Go is not supported.** It cannot load custom native modules. Importing the package in Expo Go is safe:
  `getAvailability()` returns `unsupported`.
- Works with Continuous Native Generation (`prebuild`) and with committed `ios/` folders.
- Android & web: the package is a safe no-op (`unsupported`), so cross-platform apps need no special imports.

## Config plugin (optional)

```json
{
  "expo": {
    "plugins": [
      ["@fourlyn/apple-foundation-models", { "entitlements": { "<PCC entitlement key from Apple>": true } }]
    ]
  }
}
```

Only needed to add Apple's Private Cloud Compute entitlement. On-device use needs no configuration, no Info.plist
keys and no permissions.

## Deployment target

The pod supports iOS 16.4+ so it can be added to existing apps. `FoundationModels` is weak-linked and every call is
availability-checked, so the app still launches on older iOS. The features simply report `unsupported`.

## iOS 27 launch crash (not caused by this package)

iOS 27 requires the UIScene life cycle. Apps whose `AppDelegate` creates the window themselves crash at launch with
`UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption`. Expo SDK 57 ships `ExpoAppSceneDelegate`; the
example app enables it with a small config plugin, [`example/plugins/withSceneLifecycle.js`](../example/plugins/withSceneLifecycle.js),
which you can copy.

## Versions

| This package | Expo SDK | React Native | Xcode |
| --- | --- | --- | --- |
| 0.1.x | 55+ (developed & tested on 57) | New Architecture | 26+ (27 for iOS 27 features) |
