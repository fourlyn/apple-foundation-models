# Dynamic profiles (iOS 27)

Apple's `LanguageModelSession.DynamicProfile` lets **one session** change its configuration (instructions, tools,
model, generation options, how much history the model sees) as your app state changes, while keeping a single
conversation transcript.

In Swift, profiles are result-builder types. From JavaScript you declare **named profiles** and switch between
them; the package builds one native `DynamicProfile` whose body picks the active configuration through a
`SessionProperty`, so Apple re-evaluates it on every change.

```ts
const session = await createSession({
  instructions: 'You are the assistant inside a photo editing app.',
  tools: [applyFilter, searchPhotos],
  profiles: {
    browsing: {
      tools: ['searchPhotos'],
      temperature: 0.7,
    },
    editingImage: {
      instructions: 'Help the user edit the current image. Be precise and brief.',
      tools: ['applyFilter'],
      temperature: 0.2,
      history: { strategy: 'lastTurns', count: 3 },
    },
    deepAnswer: {
      model: 'privateCloudCompute',
      reasoningLevel: 'deep',
      maximumResponseTokens: 800,
    },
  },
  initialProfile: 'browsing',
});

// App state changed: the user opened the editor
session.setProfile('editingImage');
await session.respond('Make it warmer');
session.activeProfile; // 'editingImage'
```

## Profile options

| Option | Apple modifier / API |
| --- | --- |
| `instructions` (defaults to the session's) | `Profile { Instructions(...) }` |
| `tools: string[]` (names of session tools; default all) | tools inside `Profile { }` |
| `model` | `.model(_:)` |
| `temperature` | `.temperature(_:)` |
| `samplingMode` | `.samplingMode(_:)` |
| `maximumResponseTokens` | `.maximumResponseTokens(_:)` |
| `reasoningLevel` | `.reasoningLevel(_:)` |
| `toolCallingMode` | `.toolCallingMode(_:)` |
| `requiredToolCalls: n` | `.toolCallingMode(count < n ? .required : .allowed)` + `.onToolCall` counter (Apple's recommended exit strategy) |
| `history` | `.historyTransform(_:)`, native strategies |
| `historyTransform` | `.historyTransform(_:)`, your JavaScript callback |

Per-request options passed to `respond()` still apply on top.

## History strategies

`historyTransform` changes **what the model sees** for requests in that profile, **without** changing the stored
transcript (so switching back restores full context).

| `history` | Effect |
| --- | --- |
| `{ strategy: 'all' }` (default) | Everything. |
| `{ strategy: 'none' }` | Instructions + the current turn: every request starts fresh. |
| `{ strategy: 'last', count: 20 }` | Instructions + the last 20 entries (never starting with an orphan tool output). |
| `{ strategy: 'lastTurns', count: 3 }` | Instructions + the last 3 turns **including the current one**, with their tool calls. |
| `dropToolCalls: true` | Also remove tool calls/outputs of earlier turns. |
| `dropReasoning: true` | Also remove reasoning entries of earlier turns. |

The current turn (the latest prompt plus tool calls/outputs made so far while answering it) is always kept intact,
because Apple requires the history sent to the model to end with a prompt or a tool output.

The strategies run natively and cost nothing extra. Use them when they fit.

## Custom history callback

For rules the strategies cannot express, give the profile a `historyTransform` function:

```ts
const session = await createSession({
  profiles: {
    support: {
      history: { strategy: 'lastTurns', count: 10 },   // optional, runs first
      historyTransform: (entries, { profile }) =>
        // keep the conversation, but hide earlier tool traffic for a specific tool
        entries.filter((entry) => !(entry.type === 'toolOutput' && entry.toolName === 'searchOrders')),
    },
  },
});
```

It receives the typed entries the model is about to see (the result of `history`, if set) and returns the ones to
keep. The stored transcript is never changed.

Rules, because Apple calls its transform synchronously and native code has to wait for JavaScript:

- **It can only filter.** Entries are matched by `id` and keep their original order. Entries you create or edit
  are ignored.
- **Instructions and the current turn are always kept**, whatever you return, so the model always gets a prompt it
  can answer. A tool output left without its tool call at the start of the window is dropped.
- **Answer within 2 seconds.** The callback may be `async`, but if it takes longer, throws, or returns something
  that is not an array, the `history` strategy result is used unchanged (an error is logged for throws).
- **It runs on every request** in that profile, and again after each tool call in a turn. Keep it cheap and free
  of side effects.
- The generation thread is blocked while the callback runs. Do not call back into the same session from it.

## Lifecycle events

```ts
session.on('profile', (event) => {
  // event.profile: profile name
  // event.event: 'activate' | 'deactivate' | 'prompt' | 'reasoning' | 'response' | 'toolCall' | 'toolOutput'
  // event.entry: typed transcript entry (prompt/response/reasoning/toolOutput)
});
```

These map to `.onActivate`, `.onDeactivate`, `.onPrompt`, `.onReasoning`, `.onResponse`, `.onToolCall`, `.onToolOutput`.
They are observations and cannot modify the request.

## Notes

- `setProfile` takes effect on the **next** request. Don't switch profiles while a request is running.
- Unknown profile names throw `INVALID_ARGUMENT`. On iOS 26, creating a session with `profiles` throws `UNSUPPORTED_OS_VERSION`.
- Profiles + `transcript` restore works: the restored entries become the profile session's history.
