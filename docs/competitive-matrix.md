# Competitive matrix

**Method.** On 2026-09-25 we downloaded the latest published npm version of each package and inspected its shipped
TypeScript declarations and Swift sources for the corresponding Apple API calls. ✓ = implemented, ◐ = partial (see
notes), ✗ = not found. The "Apple" column is verified against the iOS 27.0 SDK (`FoundationModels.swiftinterface`,
Xcode 27A266a). The comparison covers Apple Foundation Models features only; some packages also offer other things
(noted at the end). Corrections are welcome.

| Package | Version | Last publish |
| --- | --- | --- |
| **@fourlyn/apple-foundation-models** (this) | 0.1.0 | — |
| [@react-native-ai/apple](https://www.npmjs.com/package/@react-native-ai/apple) (Callstack) | 0.12.0 | 2026-02-11 |
| [react-native-apple-llm](https://www.npmjs.com/package/react-native-apple-llm) | 1.0.16 | 2026-01-17 |
| [@ratley/react-native-apple-foundation-models](https://www.npmjs.com/package/@ratley/react-native-apple-foundation-models) | 0.1.1 | 2025-09-28 |
| [expo-apple-foundation-models](https://www.npmjs.com/package/expo-apple-foundation-models) | 1.2.0 | — |
| [expo-ai-kit](https://www.npmjs.com/package/expo-ai-kit) | 0.18.2 | 2026-09-17 |

| Feature | Apple | **Fourlyn** | RN AI (Callstack) | apple-llm | ratley | expo-apple-fm | expo-ai-kit |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Text generation | ✓ | **✓** | ✓ | ✓ | ✓ | ✓ | ✓ |
| Streaming | ✓ | **✓** (with revision detection) | ✓ | ✓ | ✗ | ✓ | ✓ |
| Structured generation (guided) | ✓ | **✓** Zod/Standard + JSON Schema, `$ref`, `anyOf`, patterns | ✓ | ✓ | ◐ prompt-based JSON, not guided | ✓ | ◐ |
| Partial object streaming | ✓ | **✓** | ✗ | ✗ | ✗ | ✗ | ✗ |
| Tool calling | ✓ | **✓** typed, validated | ✓ | ✓ | ✗ | ✓ | ✓ |
| Parallel tool calls | ✓ | **✓** | ◐ | ◐ | ✗ | ◐ | ◐ |
| Tool calling modes | ✓ (27) | **✓** + `requiredToolCalls` exit strategy | ✗ | ✗ | ✗ | ✗ | ✗ |
| Multimodal (images) | ✓ (27) | **✓** | ✗ | ✗ | ✗ | ✗ | ✗ |
| Vision tools (OCR/barcode) | ✓ (27) | **✓** | ✗ | ✗ | ✗ | ✗ | ✗ |
| Private Cloud Compute | ✓ (27) | **✓** + quota, `auto` | ✗ | ✗ | ✗ | ✗ | ✗ |
| Dynamic profiles | ✓ (27) | **✓** | ✗ | ✗ | ✗ | ✗ | ✗ |
| Dynamic history (`historyTransform`) | ✓ (27) | **✓** native strategies + JS callback | ✗ | ✗ | ✗ | ✗ | ✗ |
| Reasoning level | ✓ (27) | **✓** | ✗ | ✗ | ✗ | ✗ | ✗ |
| Context size | ✓ | **✓** | ✗ | ✗ | ✗ | ✗ | ✗ |
| Token counting | ✓ (26.4) | **✓** prompt/instructions/schema/tools/transcript | ✗ | ✗ | ✗ | ✗ | ✗ |
| Usage | ✓ (27) | **✓** per response & session | ◐ | ✗ | ✗ | ✗ | ✗ |
| Transcript (typed) | ✓ | **✓** incl. tool calls, reasoning, images | ◐ | ✗ | ✗ | ◐ strings | ◐ |
| Session restore | ✓ | **✓** lossless (Codable) | ◐ | ✗ | ✗ | ✗ | ✗ |
| Prewarm | ✓ | **✓** incl. `promptPrefix` | ✗ | ✗ | ✗ | ✗ | ✗ |
| Feedback attachments | ✓ | **✓** | ✗ | ✗ | ✗ | ✗ | ✗ |
| Model variants | ✓ (27) | **✓** | ✗ | ✗ | ✗ | ✗ | ✗ |
| Supported languages | ✓ | **✓** | ◐ locale | ✗ | ✗ | ✗ | ✗ |
| Locale support check | ✓ | **✓** | ✗ | ✗ | ✗ | ✗ | ✗ |
| Guardrails configuration | ✓ | **✓** | ✗ | ✗ | ✗ | ✗ | ✗ |
| Content tagging use case | ✓ | **✓** | ✗ | ✗ | ✗ | ✗ | ✗ |
| Sampling modes | ✓ | **✓** greedy / top-k / threshold + seed | ◐ | ◐ | ✗ | ◐ | ◐ |
| Temperature | ✓ | **✓** | ✓ | ✓ | ✓ | ✓ | ✓ |
| Cancellation (AbortSignal) | ✓ | **✓** requests & streams | ◐ | ✗ | ✗ | ✗ | ◐ |
| Detailed availability reasons | ✓ | **✓** + diagnostics | ◐ boolean | ✓ | ✓ | ✓ | ◐ |
| Typed error codes with native details | — | **✓** 30 codes | ◐ | ✗ | ◐ | ✗ | ◐ |
| Multiple concurrent sessions | ✓ | **✓** SharedObject lifecycle, per-session queue | ◐ | ✗ single session | ✓ | ✗ | ✓ |
| React hooks | — | **✓** | ✗ (AI SDK hooks) | ✗ | ✗ | ✗ | ✓ |
| Agent integration guide (`AGENTS.md`) | — | **✓** | ✗ | ✗ | ✗ | ✗ | ✗ |
| Vercel AI SDK provider | — | **✓** (`/ai`, AI SDK 7) | **✓** | ✗ | ✗ | ✗ | ✗ |

Notes:

- ◐ for parallel tool calls: the package calls tools but routes results through a single pending slot or
  serializes them, or we could not confirm concurrent execution from source.
- `expo-ai-kit` is broader than Apple Foundation Models: it also runs downloadable open models, embeddings, speech and
  Vision utilities. `@react-native-ai/apple` also provides embeddings, transcription and speech through the Vercel
  AI SDK. This package focuses on complete, faithful coverage of Apple's Foundation Models framework.
- None of the compared packages reference any iOS 26.4 / iOS 27 Foundation Models API (token counting, usage, PCC,
  profiles, images, reasoning, tool calling modes) in their published sources at the time of writing.
