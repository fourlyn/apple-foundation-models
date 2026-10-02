# Changelog

All notable changes to this project are documented here. This project follows [Semantic Versioning](https://semver.org).

## 0.1.0 — Unreleased

First developer preview.

### Added
- Availability (`getAvailability`, exact Apple reasons), model info (context size, languages, locale support,
  variant, capabilities), `getDiagnostics()`.
- Sessions with instructions, request queuing, prewarm, `dispose()` (native SharedObject lifecycle).
- Text generation and streaming (`respond`, `stream`) with `AbortSignal` cancellation.
- Structured generation from Zod / Standard JSON Schema / JSON Schema (`generateObject`, `respondWithSchema`,
  `streamObject` with partial objects), converted to Apple's `DynamicGenerationSchema`.
- JavaScript tools with typed/validated arguments, parallel execution and events; native `OCRTool` /
  `BarcodeReaderTool` (iOS 27, device).
- Generation options: temperature, maximum tokens, sampling modes, tool calling modes (iOS 27), reasoning
  level (iOS 27), metadata (iOS 27).
- Transcripts (typed entries + lossless JSON) and session restoration; `transcriptErrorHandling` (iOS 27).
- Token counting (iOS 26.4) and usage (iOS 27).
- Private Cloud Compute (iOS 27): availability, quota, `model: 'privateCloudCompute' | 'auto'`.
- Dynamic profiles (iOS 27): per-profile instructions, tools, model, options, history strategies,
  `requiredToolCalls`, lifecycle events.
- Image prompts (iOS 27).
- Feedback attachments.
- React hooks: `useAvailability`, `useSession`, `useChat`.
- Optional config plugin for entitlements.
- `AGENTS.md` integration guide for AI coding agents; full docs; example app with a Self-Test screen.
- `session.transcript` (synchronous) and `session.contextSize`.
- `session.respondAdvanced()` / `session.streamAdvanced()`: one request object mirroring Apple's
  `respond(to:schema:options:contextOptions:metadata:)`, returning the full response.
- `createSession({ messages })`: start a session from plain user / assistant / tool messages.
- Dynamic profiles: `historyTransform` JavaScript callback to filter what the model sees.
- `ENTITLEMENT_REQUIRED`: reported when Apple's error says an entitlement is missing (code, or
  `details.reason` on `PRIVATE_CLOUD_COMPUTE_UNAVAILABLE`).
- Optional Vercel AI SDK provider: `@fourlyn/apple-foundation-models/ai` (`ai` 7.x).
- Swift unit tests (`ios/Tests`, run through `Package.swift`), CI job for them, and a tag-triggered release workflow.
