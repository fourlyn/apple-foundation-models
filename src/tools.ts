import { resolveSchema, type ResolvedSchema } from './schema/normalize';
import type { InferSchema, SchemaInput } from './schema/types';
import type { FunctionTool, NativeTool, Tool, ToolExecutionContext } from './types';
import { AppleFoundationModelsError } from './errors';

/**
 * Defines a JavaScript tool with argument types inferred from its schema (Zod or `jsonSchema<T>()`).
 *
 * ```ts
 * const getWeather = defineTool({
 *   name: 'getWeather',
 *   description: 'Get the current weather for a city',
 *   parameters: z.object({ city: z.string() }),
 *   execute: async ({ city }) => fetchWeather(city),
 * });
 * ```
 */
export function defineTool<S extends SchemaInput<any>>(tool: {
  name: string;
  description: string;
  parameters: S;
  execute: (args: unknown extends InferSchema<S> ? any : InferSchema<S>, context: ToolExecutionContext) => unknown | Promise<unknown>;
  includesSchemaInInstructions?: boolean;
  validateArguments?: boolean;
}): FunctionTool<InferSchema<S>> {
  return tool as FunctionTool<InferSchema<S>>;
}

/**
 * Apple's Vision OCR tool (`OCRTool`, iOS 27+). Lets the model read text in images attached to the prompt.
 * Runs natively; nothing crosses the JS bridge.
 */
export function OCRTool(options: { name?: string; description?: string } = {}): NativeTool {
  return { nativeTool: 'vision.ocr', ...options };
}

/** Apple's Vision barcode/QR reader tool (`BarcodeReaderTool`, iOS 27+). Runs natively. */
export function BarcodeReaderTool(options: { name?: string; description?: string } = {}): NativeTool {
  return { nativeTool: 'vision.barcodeReader', ...options };
}

export function isNativeTool(tool: Tool): tool is NativeTool {
  return 'nativeTool' in tool;
}

export type PreparedTool = {
  descriptor: Record<string, unknown>;
  js?: { tool: FunctionTool; schema: ResolvedSchema<unknown> };
};

const TOOL_NAME = /^[A-Za-z_][A-Za-z0-9_-]*$/;

/** Validates tools and converts them to the payload sent to native code. */
export function prepareTools(tools: Tool[] | undefined): PreparedTool[] {
  const seen = new Set<string>();
  return (tools ?? []).map((tool) => {
    if (isNativeTool(tool)) {
      const name = tool.name ?? tool.nativeTool;
      if (seen.has(name)) throw duplicate(name);
      seen.add(name);
      return { descriptor: { nativeTool: tool.nativeTool, name: tool.name, description: tool.description } };
    }
    if (!tool.name || !TOOL_NAME.test(tool.name)) {
      throw new AppleFoundationModelsError({
        code: 'INVALID_ARGUMENT',
        message: `Invalid tool name "${tool.name}". Use letters, digits, "_" or "-", starting with a letter or "_".`,
      });
    }
    if (typeof tool.execute !== 'function') {
      throw new AppleFoundationModelsError({ code: 'INVALID_ARGUMENT', message: `Tool "${tool.name}" is missing an execute function.` });
    }
    if (seen.has(tool.name)) throw duplicate(tool.name);
    seen.add(tool.name);
    const schema = resolveSchema(tool.parameters);
    const root = schema.jsonSchema;
    if (root.type !== undefined && root.type !== 'object') {
      throw new AppleFoundationModelsError({ code: 'INVALID_SCHEMA', message: `Tool "${tool.name}" parameters must be an object schema.` });
    }
    return {
      descriptor: {
        name: tool.name,
        description: tool.description ?? '',
        parameters: { ...root, title: root.title ?? `${tool.name}Arguments` },
        includesSchemaInInstructions: tool.includesSchemaInInstructions ?? true,
      },
      js: { tool, schema },
    };
  });
}

function duplicate(name: string) {
  return new AppleFoundationModelsError({ code: 'INVALID_ARGUMENT', message: `Duplicate tool name "${name}".` });
}
