# Foundation Models Lab (example app)

Expo development-build app that exercises every feature of `@fourlyn/apple-foundation-models`. It doubles as the
manual QA environment.

Screens: Availability · Chat (streaming, `useChat`) · Structured Output · Tool Calling · Image Understanding ·
Dynamic Profiles · Transcript · Model Information · Diagnostics · **Self-Test**.

## Run

```sh
npm install            # in the repo root (builds the package)
cd example && npm install
npx expo run:ios       # builds the native app and starts Metro
```

Use a device with Apple Intelligence, or the iOS Simulator on an Apple Intelligence–enabled Mac.

## Self-Test

The Self-Test screen runs end-to-end checks against the real model and logs `[selftest] PASS|FAIL|SKIP ...` lines.
To run it automatically at launch:

```sh
EXPO_PUBLIC_SELF_TEST=1 npx expo start --clear
```

The run covers the newer APIs too: `session.transcript` / `contextSize`, `respondAdvanced`, `streamAdvanced`,
`messages`, the `historyTransform` callback and a Private Cloud Compute request. The full manual checklist is in [docs/testing.md](../docs/testing.md).

Known Simulator limitations: tool-calling model assets may be missing (`MODEL_NOT_READY`) and Apple's Vision tools
are device-only (`UNSUPPORTED_PLATFORM`).

## iOS 27 scene life cycle

iOS 27 requires the UIScene life cycle. `plugins/withSceneLifecycle.js` switches the Expo SDK 57 template to
`ExpoAppSceneDelegate`. Copy it into your own app if it crashes at launch on iOS 27 with
`UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption`.
