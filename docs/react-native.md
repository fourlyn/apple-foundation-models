# Bare React Native

The package is an [Expo Module](https://docs.expo.dev/modules/overview/) (the best way to write Swift-first native
modules; Apple's Foundation Models API is Swift-only). Bare React Native apps can use it after a one-time setup.

## Setup

```sh
npx install-expo-modules@latest     # adds the `expo` package and wires up autolinking (once per app)
npm install @fourlyn/apple-foundation-models
cd ios && pod install
```

Then rebuild the app in Xcode or with `npx react-native run-ios`.

`install-expo-modules` adds `expo` as a dependency and modifies `AppDelegate` / `Podfile`. It does **not** turn your
app into a managed Expo app; you keep full control of native code.

## Requirements

- React Native New Architecture.
- Xcode 26+ (27 for iOS 27 features).

## Entitlements

For Private Cloud Compute, add Apple's managed entitlement in Xcode → Signing & Capabilities (see
[private-cloud-compute.md](./private-cloud-compute.md)).

## Usage

Identical to Expo apps. See [getting-started.md](./getting-started.md).
