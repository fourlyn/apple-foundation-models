/**
 * The subset of JSON Schema understood by the native converter
 * (see `ios/FMSchema.swift` and `docs/structured-generation.md`).
 */
export type JSONSchema = {
  type?: JSONSchemaType | JSONSchemaType[];
  title?: string;
  description?: string;
  properties?: Record<string, JSONSchema>;
  required?: readonly string[];
  items?: JSONSchema;
  minItems?: number;
  maxItems?: number;
  enum?: readonly string[];
  const?: string;
  pattern?: string;
  minimum?: number;
  maximum?: number;
  anyOf?: JSONSchema[];
  oneOf?: JSONSchema[];
  $ref?: string;
  $defs?: Record<string, JSONSchema>;
  definitions?: Record<string, JSONSchema>;
  [key: string]: unknown;
};

export type JSONSchemaType = 'object' | 'array' | 'string' | 'integer' | 'number' | 'boolean' | 'null';

/**
 * Standard Schema v1 with the Standard JSON Schema extension
 * (https://standardschema.dev). Implemented by Zod 4.2+, and others.
 * Declared structurally so no schema library is a dependency.
 */
export type StandardJSONSchemaLike<T = unknown> = {
  readonly '~standard': {
    readonly version: 1;
    readonly vendor: string;
    readonly validate?: (value: unknown) => StandardResult<T> | Promise<StandardResult<T>>;
    readonly jsonSchema?: {
      readonly input: (options: { target: string }) => Record<string, unknown>;
      readonly output: (options: { target: string }) => Record<string, unknown>;
    };
    readonly types?: { readonly input: unknown; readonly output: T };
  };
};

type StandardResult<T> =
  | { readonly value: T; readonly issues?: undefined }
  | { readonly issues: readonly { readonly message: string; readonly path?: readonly unknown[] }[] };

/** Wraps a JSON Schema with a static type (and optional validator). See `jsonSchema()`. */
export type TypedJSONSchema<T> = {
  readonly __fourlynSchema: true;
  readonly jsonSchema: JSONSchema;
  readonly validate?: (value: unknown) => T;
  /** Phantom type carrier. */
  readonly _type?: T;
};

/** Anything accepted where a schema is expected. */
export type SchemaInput<T = unknown> = JSONSchema | StandardJSONSchemaLike<T> | TypedJSONSchema<T>;

/** Infers the TypeScript type described by a schema input. Plain JSON Schema infers `unknown`. */
export type InferSchema<S> =
  S extends TypedJSONSchema<infer T>
    ? T
    : S extends { readonly '~standard': { readonly types?: { readonly output: infer T } } }
      ? T
      : unknown;
