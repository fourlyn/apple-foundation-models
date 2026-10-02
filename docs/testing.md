# Testing

Three automated suites cover the logic that needs no Apple model. Everything that depends on the real model, a
physical device, an entitlement or an external service is covered by the example app's Self-Test and the manual
checklist below.

## 1. Automated suites

Run all three before every release.

| Suite | Command | Covers | Expected |
| --- | --- | --- | --- |
| Types | `npm run typecheck` | The whole `src/` tree, including tests | No output |
| JS unit tests | `npm test` | Session API against a fake native module; the AI SDK provider driven by the real `ai` package | `Tests: 63 passed`, 3 suites |
| Swift unit tests | `xcodebuild test -scheme AppleFoundationModelsBridge-Package -destination 'platform=iOS Simulator,name=iPhone 18 Pro'` (repo root) | Error mapping, option / schema / transcript conversion, history strategies and selection, the tool and history brokers | `Executed 41 tests, with 0 failures`, `** TEST SUCCEEDED **` |
| Example build | `cd example/ios && pod install && xcodebuild -workspace FoundationModelsLab.xcworkspace -scheme FoundationModelsLab -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build` | The Expo module compiles and links | `** BUILD SUCCEEDED **` |

Notes:

- Use any installed iPhone simulator name. The Swift tests need no Apple Intelligence; on a simulator older than
  iOS 27 the profile and Private Cloud Compute tests report as skipped.
- Run `pod install` again whenever a Swift file is added or removed.
- CI (`.github/workflows/ci.yml`) runs all four on pushes to `main` and on pull requests.

## 2. Self-Test against the real model

```sh
cd example && npm install
npx expo run:ios --device                      # first time, or after native changes
EXPO_PUBLIC_SELF_TEST=1 npx expo start --clear # runs the Self-Test at launch
```

Or open the app and tap **Self-Test → Run self-test**. Each check logs `[selftest] PASS|FAIL|SKIP <name>`.

**Expected on an Apple Intelligence device (iOS 27):** every line is `PASS`, and nothing is `FAIL`.

**Expected on the iOS Simulator:** the same, except these report `SKIP … Simulator limitation`:
`tools (parallel)`, `native Apple tool (OCRTool)`, `tool error is reported to the model`,
`image prompt (real image)`, `private cloud compute request`. They can only be verified on a device.

**Expected on iOS 26:** `profiles`, `images`, and `private cloud compute request` pass by confirming
`UNSUPPORTED_OS_VERSION`; `historyTransform` is skipped; `usage` reports `null`.

Model answers vary between runs. A check that fails once and passes on a re-run is usually the model's wording,
not the bridge; a check that fails every time is a bug.

## 3. Manual checklist

Each row says what to do and what must happen. Snippets assume
`import { AppleFoundationModels, createSession, isAppleFoundationModelsError } from '@fourlyn/apple-foundation-models'`
and can be pasted into any screen of the example app.

### A. Session accessors

| # | Test | How | Expected |
| --- | --- | --- | --- |
| A1 | `session.transcript` | Create a session with instructions, `respond()` twice, then read `session.transcript` | `entries` types are `instructions, prompt, response, prompt, response`; `json` is a non-empty string; same content as `await session.getTranscript()` |
| A2 | Restore from the sync snapshot | `createSession({ transcript: session.transcript })`, then ask about the first turn | The new session remembers the first turn |
| A3 | After dispose | `session.dispose(); session.transcript` | Throws `SESSION_DISPOSED` |
| A4 | `session.contextSize` | Read it right after `createSession()` | A positive number (4096 on current devices), equal to `(await AppleFoundationModels.getModelInfo()).contextSize` |
| A5 | Context size for PCC | `createSession({ model: 'privateCloudCompute' })` on an entitled device | The PCC context size (larger than on-device), or `null` if Apple cannot report it |

### B. `respondAdvanced` / `streamAdvanced`

| # | Test | How | Expected |
| --- | --- | --- | --- |
| B1 | Text | `respondAdvanced({ prompt: 'Capital of Italy? One word.', options: { temperature: 0 } })` | `text` contains "Rome"; `object` is `undefined`; `model` is `'system'`; `durationMs > 0`; `transcriptEntries` is non-empty |
| B2 | Structured | Same with `schema: z.object({ name: z.string(), age: z.number().int() })` and a prompt naming a person and age | `object` matches the prompt; `text` is the same object as JSON; `isComplete` is `true` |
| B3 | Options reach Apple | `options: { maximumResponseTokens: 5 }` with a prompt asking for a long story | A response of only a few words |
| B4 | Context options on iOS 27 | `contextOptions: { reasoningLevel: 'deep' }` | Either a normal response, or `UNSUPPORTED_CAPABILITY` if the model has no reasoning capability. Never a crash. |
| B5 | Context options on iOS 26 | Same on an iOS 26 device | Throws `UNSUPPORTED_OS_VERSION` |
| B6 | Streaming text | `for await (const c of session.streamAdvanced({ prompt: 'Count 1 to 10' }))` | Several chunks; `delta` values join to the final `text`; `partial` is `undefined`; the last chunk has `isFinal: true` |
| B7 | Streaming object | `streamAdvanced({ prompt, schema })` | `partial` fills in field by field; `delta` is `null`; `(await stream.result).object` is complete |
| B8 | Cancel | Pass `signal`, abort after the third chunk | The loop throws `CANCELLED`; a following `respond()` on the same session works |

### C. `createSession({ messages })`

| # | Test | How | Expected |
| --- | --- | --- | --- |
| C1 | Recall | `messages: [{ role: 'user', content: 'My favourite colour is teal. Just say OK.' }, { role: 'assistant', content: 'OK.' }]`, then ask "What is my favourite colour?" | The answer mentions teal |
| C2 | Transcript shape | Read `session.transcript` after C1 | `instructions, prompt, response, prompt, response` |
| C3 | With tool history (**device**) | Add a `toolCalls` and matching `toolOutput` message for a registered tool, then ask a follow-up about the tool's result | The answer uses the tool output; no error |
| C4 | Both sources | Pass `transcript` and `messages` | Rejects with `INVALID_ARGUMENT`; no native session is created |
| C5 | Bad message | `messages: [{ role: 'system', content: 'x' } as any]` | Rejects with `INVALID_ARGUMENT` naming the role |
| C6 | With profiles (iOS 27) | `messages` plus `profiles` | Session is created; the model recalls the seeded turns |

### D. `historyTransform` callback (iOS 27)

| # | Test | How | Expected |
| --- | --- | --- | --- |
| D1 | Filter everything | Profile with `historyTransform: () => []`; say "My favourite colour is teal", then ask for it | The model does **not** know the colour |
| D2 | Stored transcript untouched | Read `session.transcript` after D1 | Still contains the "teal" prompt and both responses |
| D3 | What the callback receives | Log `entries.map(e => e.type)` in the callback | First request: `instructions, prompt`. Second: `instructions, prompt, response, prompt` |
| D4 | Runs after `history` | Add `history: { strategy: 'lastTurns', count: 1 }` and log `entries.length` | The callback sees only the instructions and the current prompt |
| D5 | Callback throws | `historyTransform: () => { throw new Error('boom') }` | An error is logged; the request still succeeds; the model remembers earlier turns |
| D6 | Callback too slow | `historyTransform: async (e) => { await new Promise(r => setTimeout(r, 4000)); return []; }` | The request is delayed by about 2 seconds, then succeeds with the **unfiltered** history (the model remembers) |
| D7 | UI stays responsive | Scroll a list while D6 runs | Scrolling does not freeze |
| D8 | With tools (**device**) | Profile with a tool and a logging callback; ask something that calls the tool | The callback runs again after the tool call and its input ends with `prompt, toolCalls, toolOutput`; the answer uses the tool result |
| D9 | iOS 26 | Create the session on iOS 26 | Throws `UNSUPPORTED_OS_VERSION` |

### E. Private Cloud Compute and the entitlement error

These need a physical iOS 27 device. Apple has no dedicated "missing entitlement" error, so E1 is the check that
tells us whether the text-based detection matches what Apple really returns.

| # | Test | How | Expected |
| --- | --- | --- | --- |
| E1 | **No entitlement** | Build without the PCC entitlement; run the Self-Test and read the `private cloud compute request` line (or call `createSession({ model: 'privateCloudCompute' })` then `respond()`) | `PRIVATE_CLOUD_COMPUTE_UNAVAILABLE` with `details.reason` of `ENTITLEMENT_REQUIRED`, or code `ENTITLEMENT_REQUIRED`. If you get `UNKNOWN`, `GENERATION_FAILED` or a different reason, note `error.message`, `error.nativeType` and `error.details`: the detection in `ios/FMErrors.swift` needs that wording. |
| E2 | Availability without entitlement | `await AppleFoundationModels.getPrivateCloudComputeInfo()` | Never throws; `availability` and `quota` are populated |
| E3 | With entitlement | Add the key via the config plugin, rebuild, repeat E1 | A normal response; `session.model` is `'privateCloudCompute'` |
| E4 | No silent fallback | `model: 'privateCloudCompute'` when PCC is unavailable | Rejects; never answers from the on-device model |
| E5 | `auto` | `createSession({ model: 'auto' })` | `session.model` is `'system'` when the on-device model is available |

### F. Vercel AI SDK provider

Needs a test app with `ai` 7.x installed and the AI SDK's React Native polyfills (see [ai-sdk.md](./ai-sdk.md)).
The example app does not include the AI SDK.

| # | Test | How | Expected |
| --- | --- | --- | --- |
| F1 | Bundling | Import `@fourlyn/apple-foundation-models/ai` and start Metro | The bundle builds; no "unable to resolve" for `@ai-sdk/provider` |
| F2 | `generateText` | `generateText({ model: apple(), system: 'Be brief.', prompt: 'Capital of France?' })` | `text` mentions Paris; `finishReason` is `'stop'`; `usage` has numbers on iOS 27 |
| F3 | `streamText` | Iterate `result.textStream` | Text arrives in several pieces that join to the full answer |
| F4 | Structured | `output: Output.object({ schema })` | `result.output` matches the schema |
| F5 | Multi-turn | `messages` with an earlier user/assistant exchange and a new user question about it | The answer uses the earlier exchange |
| F6 | Tools (**device**) | `apple('system', { tools })` with an AI SDK `tool()` and a prompt that needs it | `execute` runs once; `result.toolCalls[0].providerExecuted` is `true`; `result.steps.length` is 1; the text uses the tool result |
| F7 | Unregistered tool | Pass `tools` to `generateText` only | The model answers without the tool; `result.warnings` names it as unsupported |
| F8 | Abort | Pass `abortSignal` and abort mid-stream | The stream stops; no further text arrives |
| F9 | Guardrail | A prompt Apple's guardrails block | `finishReason` is `'content-filter'`, `text` is empty, no exception |
| F10 | `useChat` | Wire the provider into the AI SDK's chat hook | A three-message conversation keeps context |

### G. Release automation

| # | Test | How | Expected |
| --- | --- | --- | --- |
| G1 | Package contents | `npm pack --dry-run` | Lists `build/ai/index.js`, `src/ai/index.ts` and `docs/`; does **not** list `ios/Tests`, `Package.swift` or `__tests__` |
| G2 | Version guard | Push a tag that does not match `package.json` (use a fork or a throwaway branch) | The workflow fails at "Check that the tag matches package.json"; nothing is published |
| G3 | Pre-release | Tag `v0.1.0-beta.1` with matching versions and `NPM_TOKEN` set | Published under npm tag `next`; GitHub release marked pre-release with the changelog section as notes |
| G4 | CI | Open a pull request | Jobs `js`, `swift-tests` and `ios` are green |

## What has been verified

On 2026-10-02, with Xcode 27.0 and the iPhone 18 Pro simulator (iOS 27.0):

- All four automated suites pass.
- Self-Test: every check passes except the five simulator-only skips listed above. That includes A1, A4, B1, B2,
  B7, C1, C2, D1, D2 and D3 against the real model.
- G1.

Not yet verified anywhere: everything marked **device**, section E, section F inside a React Native app, and
G2–G4 (they need GitHub and npm).
