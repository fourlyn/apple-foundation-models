# Tool calling

Tools let the model call your JavaScript code (a database, an API, device data) while it answers.
Maps to Apple's `Tool` protocol.

```ts
import { createSession, defineTool } from '@fourlyn/apple-foundation-models';
import { z } from 'zod';

const getExpenses = defineTool({
  name: 'getExpenses',
  description: "Retrieve expenses from the user's database for a month (YYYY-MM).",
  parameters: z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) }),
  execute: async ({ month }, { signal, callId, requestId }) => database.getExpenses(month, { signal }),
});

const session = await createSession({
  instructions: 'You are a personal finance assistant. Always use tools for financial data.',
  tools: [getExpenses],
});

const { text } = await session.respond('How much did I spend this month?');
```

## Lifecycle

```
JS respond() → Swift → Apple model → tool call → Swift emits event → JS execute() → result → Swift → model → final answer
```

- **Parallel calls run in parallel.** When the model requests several tool calls at once, every `execute` starts
  immediately (each call has its own native continuation). Nothing is serialized.
- `execute` may return a **string** (passed verbatim) or any **JSON-serializable** value (passed as structured
  `GeneratedContent`). `undefined` becomes `null`.
- If `execute` **throws**, the error message goes back to Apple as a tool failure; the request then typically rejects
  with `TOOL_CALL_FAILED` (`details.toolName`, `details.underlyingMessage`).
- Arguments are **validated** with Zod/Standard schemas before `execute` (`validateArguments: false` to disable).
- Cancelling the request aborts `context.signal`.

## Events

```ts
session.on('toolCall', ({ toolName, arguments: args, callId }) => {});
session.on('toolResult', ({ toolName, result, durationMs }) => {});
session.on('toolError', ({ toolName, error }) => {});
```

Each returns an unsubscribe function. With dynamic profiles, `profile` events also report `toolCall` / `toolOutput`
from Apple's own observers.

## Tool calling modes (iOS 27)

```ts
await session.respond(prompt, { toolCallingMode: 'required' });   // must call at least one tool
await session.respond(prompt, { toolCallingMode: 'disallowed' });  // answer without tools
```

Maps to `GenerationOptions.ToolCallingMode`.

> ⚠️ **`required` needs an exit strategy.** Apple: "you must define an exit condition by either throwing an error
> from a tool's call method or by changing the mode dynamically using a DynamicProfile; otherwise, the model continues
> to call the tool." This package implements the dynamic option for you: use a profile with `requiredToolCalls`:

```ts
createSession({
  tools: [search],
  profiles: { research: { requiredToolCalls: 1 } }, // required until 1 call per turn, then allowed
});
```

## Native Apple tools (iOS 27)

```ts
import { OCRTool, BarcodeReaderTool } from '@fourlyn/apple-foundation-models';

createSession({ tools: [OCRTool(), BarcodeReaderTool({ description: 'Read QR codes on tickets' })] });
```

These run entirely in native code (Vision framework) on images attached to the prompt. Apple ships them in the
**device SDK only**. In the Simulator they fail with `UNSUPPORTED_PLATFORM` (`details.reason: 'SIMULATOR'`).

## Schema rules

`parameters` must be an **object** schema. See the supported subset in
[structured-generation.md](./structured-generation.md#supported-json-schema). Tool names: letters, digits, `_`, `-`;
unique per session.

`includesSchemaInInstructions` (default `true`, maps to `Tool.includesSchemaInInstructions`) controls whether the
argument schema is also described in the instructions.

## Token cost

Tool definitions consume context. Measure with `AppleFoundationModels.tokenCount({ tools })` (iOS 26.4+). Keep
descriptions short and only give a session the tools it needs (profiles can restrict tools per mode).
