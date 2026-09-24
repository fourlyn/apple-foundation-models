import { AppleFoundationModelsError } from '../errors';
import type { JSONSchema, SchemaInput, StandardJSONSchemaLike, TypedJSONSchema } from './types';

export type ResolvedSchema<T> = {
  jsonSchema: JSONSchema;
  /** Validates (and possibly transforms) a generated value. */
  validate?: (value: unknown) => Promise<T>;
};

/** Marker key added to object schemas so the native side keeps the declared property order. */
export const ORDER_KEY = 'x-fourlyn-order';

const MAX_SAFE = Number.MAX_SAFE_INTEGER;
const MIN_SAFE = Number.MIN_SAFE_INTEGER;

/**
 * Attaches a static type to a plain JSON Schema.
 *
 * ```ts
 * const Person = jsonSchema<{ name: string; age: number }>({
 *   type: 'object',
 *   properties: { name: { type: 'string' }, age: { type: 'integer' } },
 *   required: ['name', 'age'],
 * });
 * const { object } = await session.respond('...', { schema: Person }); // object: { name; age }
 * ```
 */
export function jsonSchema<T>(schema: JSONSchema, options?: { validate?: (value: unknown) => T }): TypedJSONSchema<T> {
  return { __fourlynSchema: true, jsonSchema: schema, validate: options?.validate };
}

function isStandard(input: unknown): input is StandardJSONSchemaLike {
  return typeof input === 'object' && input !== null && '~standard' in input;
}

function isTyped(input: unknown): input is TypedJSONSchema<unknown> {
  return typeof input === 'object' && input !== null && (input as TypedJSONSchema<unknown>).__fourlynSchema === true;
}

export function resolveSchema<T>(input: SchemaInput<T>): ResolvedSchema<T> {
  if (isTyped(input)) {
    const validate = input.validate;
    return {
      jsonSchema: normalizeJSONSchema(input.jsonSchema),
      validate: validate ? async (value) => validate(value) as T : undefined,
    };
  }

  if (isStandard(input)) {
    const standard = input['~standard'];
    if (!standard.jsonSchema) {
      throw new AppleFoundationModelsError({
        code: 'INVALID_SCHEMA',
        message:
          `The "${standard.vendor}" schema does not implement Standard JSON Schema (~standard.jsonSchema). ` +
          'Upgrade the library (Zod >= 4.2) or pass a plain JSON Schema.',
      });
    }
    let raw: Record<string, unknown>;
    try {
      raw = standard.jsonSchema.output({ target: 'draft-2020-12' });
    } catch (cause) {
      throw new AppleFoundationModelsError({
        code: 'INVALID_SCHEMA',
        message: `Could not convert the "${standard.vendor}" schema to JSON Schema: ${String((cause as Error)?.message ?? cause)}`,
      });
    }
    const validate = standard.validate;
    return {
      jsonSchema: normalizeJSONSchema(raw as JSONSchema),
      validate: validate
        ? async (value) => {
            const result = await validate(value);
            if (result.issues) {
              throw new AppleFoundationModelsError({
                code: 'SCHEMA_VALIDATION_FAILED',
                message: `Generated content did not match the schema: ${result.issues
                  .map((issue) => `${issue.path?.map((p) => (typeof p === 'object' && p && 'key' in p ? String((p as { key: unknown }).key) : String(p))).join('.') || '(root)'}: ${issue.message}`)
                  .join('; ')}`,
                details: { issues: result.issues, value },
              });
            }
            return result.value as T;
          }
        : undefined,
    };
  }

  if (typeof input !== 'object' || input === null) {
    throw new AppleFoundationModelsError({ code: 'INVALID_SCHEMA', message: 'Schema must be a JSON Schema object or a Standard Schema.' });
  }
  return { jsonSchema: normalizeJSONSchema(input as JSONSchema) };
}

/**
 * Prepares a JSON Schema for the native converter:
 * - records property order (`x-fourlyn-order`), which JSON parsing on the native side loses;
 * - drops `$schema` and the ±MAX_SAFE_INTEGER bounds Zod adds to integers;
 * - recurses into every sub-schema.
 */
export function normalizeJSONSchema(schema: JSONSchema): JSONSchema {
  const visit = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(visit);
    if (typeof node !== 'object' || node === null) return node;
    const input = node as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
      if (key === '$schema' || key === 'additionalProperties') continue;
      if (key === 'maximum' && value === MAX_SAFE) continue;
      if (key === 'minimum' && value === MIN_SAFE) continue;
      if (key === 'properties' && typeof value === 'object' && value !== null) {
        const properties: Record<string, unknown> = {};
        for (const [name, child] of Object.entries(value)) properties[name] = visit(child);
        output.properties = properties;
        output[ORDER_KEY] = Object.keys(value);
        continue;
      }
      if (key === '$defs' || key === 'definitions') {
        const defs: Record<string, unknown> = {};
        for (const [name, child] of Object.entries(value as Record<string, unknown>)) defs[name] = visit(child);
        output[key] = defs;
        continue;
      }
      output[key] = typeof value === 'object' ? visit(value) : value;
    }
    return output;
  };
  return visit(schema) as JSONSchema;
}
