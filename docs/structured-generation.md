# Structured generation

Apple's guided generation constrains decoding to a schema, so the output is **always** valid for the schema, not
"usually valid JSON". Swift uses `@Generable` macros; from JavaScript you pass a runtime schema, which this package converts to
`DynamicGenerationSchema` → `GenerationSchema`.

## With Zod (or any Standard JSON Schema library)

```ts
import { z } from 'zod';

const Person = z.object({
  name: z.string().describe('Full name'),
  age: z.number().int().min(0).max(130),
  role: z.enum(['engineer', 'designer', 'manager']),
  skills: z.array(z.string()).max(5),
  nickname: z.string().optional(),
});

const person = await session.generateObject({ prompt: 'Extract: Priya, 31, a designer who knows Figma', schema: Person });
// person is typed as z.infer<typeof Person> and validated by Zod
```

Zod is **not** a dependency. Zod ≥ 4.2 implements [Standard JSON Schema](https://standardschema.dev) (`~standard.jsonSchema`),
which this package reads directly. Other libraries implementing it work the same way.

## With JSON Schema

```ts
import { jsonSchema } from '@fourlyn/apple-foundation-models';

const Sentiment = jsonSchema<{ label: 'positive' | 'neutral' | 'negative'; confidence: number }>({
  type: 'object',
  properties: {
    label: { type: 'string', enum: ['positive', 'neutral', 'negative'] },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
  required: ['label', 'confidence'],
});

const result = await session.generateObject({ prompt: 'I love it!', schema: Sentiment });
```

A plain JSON Schema object also works (the result is typed `unknown`).

## Full response

```ts
const { object, usage, transcriptEntries, rawContent, isComplete } = await session.respondWithSchema({ prompt, schema });
```

`rawContent` is Apple's `GeneratedContent` as JSON, before validation.

## Options

`generateObject` / `respondWithSchema` / `streamObject` accept every [respond option](./sessions.md#options-generationoptions--contextoptions) plus:

| Option | Default | |
| --- | --- | --- |
| `schemaName` | `'Response'` | Root schema name (appears in transcripts). |
| `includeSchemaInPrompt` | `true` | Also describe the schema in the prompt. Set `false` if instructions already explain the format (saves tokens). |
| `validate` | `true` | Run the Standard Schema validator (e.g. Zod refinements, transforms). Fails with `SCHEMA_VALIDATION_FAILED`. |

## Supported JSON Schema

| Keyword | Maps to |
| --- | --- |
| `type: 'object'`, `properties`, `required` | `DynamicGenerationSchema(name:properties:)`; non-required ⇒ `isOptional: true` |
| `type: 'array'`, `items`, `minItems`, `maxItems` | `DynamicGenerationSchema(arrayOf:minimumElements:maximumElements:)` |
| `type: 'string'`, `pattern` | `String` + `GenerationGuide.pattern(Regex)` |
| `enum` / `const` (strings) | `DynamicGenerationSchema(name:anyOf: [String])` |
| `type: 'integer'`, `minimum`, `maximum` | `Int` + `.minimum` / `.maximum` / `.range` |
| `type: 'number'`, `minimum`, `maximum` | `Double` + guides |
| `type: 'boolean'` | `Bool` |
| `type: 'null'` (standalone) | `DynamicGenerationSchema.null` (iOS 26.4) |
| `['string', 'null']`, `anyOf: [X, {type:'null'}]` | optional property |
| `anyOf` / `oneOf` (several schemas) | `DynamicGenerationSchema(name:anyOf: [DynamicGenerationSchema])` |
| `$ref: '#/$defs/Name'`, `$defs`, `definitions` | `DynamicGenerationSchema(referenceTo:)` + dependencies (recursive types OK) |
| `description`, `title` | property / type descriptions and names |

Ignored: `additionalProperties`, `$schema`, `format`, `default`, `examples`. Rejected with `INVALID_SCHEMA`:
non-string enums, empty enums, invalid regex, unresolvable `$ref`.

## Tips for good results

- **Property order matters.** The model generates fields in declaration order (preserved by this package). Put
  "reasoning" or "summary" fields before the fields that depend on them.
- Use `description` generously. It is the model's main hint.
- Prefer enums over free text for classification.
- Keep schemas small: they consume context tokens (`tokenCount({ schema })` measures it on iOS 26.4+).
- For tagging and classification use `systemModel({ useCase: 'contentTagging' })`.
