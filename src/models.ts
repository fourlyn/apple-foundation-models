import { Platform } from 'react-native';

import { getNativeModule, requireNative, unwrap } from './native';
import { resolveSchema } from './schema/normalize';
import { createSession, type Session } from './session';
import { prepareTools } from './tools';
import { transcriptJSON } from './transcript';
import type {
  Availability,
  Diagnostics,
  ModelInfo,
  ModelSelector,
  SessionOptions,
  SystemModelGuardrails,
  SystemModelUseCase,
  TokenCountInput,
} from './types';

export const PACKAGE_VERSION = '0.1.1';

function modelJSON(model: ModelSelector | undefined): string | null {
  return model === undefined ? null : JSON.stringify(model);
}

const UNSUPPORTED: Availability = { status: 'unavailable', available: false, reason: 'unsupported' };

/**
 * Checks whether a model can be used right now. Never throws.
 * Maps to `SystemLanguageModel.availability` / `PrivateCloudComputeLanguageModel.availability`.
 */
export async function getAvailability(model?: ModelSelector): Promise<Availability> {
  const native = getNativeModule();
  if (!native) return UNSUPPORTED;
  try {
    return unwrap(await native.getAvailability(modelJSON(model))) as Availability;
  } catch {
    return { status: 'unavailable', available: false, reason: 'unknown' };
  }
}

/** Model information: availability, context size, languages, variant and capabilities. */
export async function getModelInfo(model?: ModelSelector): Promise<ModelInfo> {
  return unwrap(await requireNative().getModelInfo(modelJSON(model))) as ModelInfo;
}

/** Private Cloud Compute availability, quota, context size and languages (iOS 27+). Never throws. */
export async function getPrivateCloudComputeInfo(): Promise<ModelInfo> {
  const native = getNativeModule();
  if (!native) {
    return { model: 'privateCloudCompute', availability: UNSUPPORTED, isAvailable: false, contextSize: null, supportedLanguages: null, capabilities: null };
  }
  try {
    return unwrap(await native.getModelInfo(JSON.stringify('privateCloudCompute'))) as ModelInfo;
  } catch {
    return { model: 'privateCloudCompute', availability: UNSUPPORTED, isAvailable: false, contextSize: null, supportedLanguages: null, capabilities: null };
  }
}

/**
 * Counts tokens for a prompt, instructions, schema, tools and/or a transcript (iOS 26.4+).
 * Maps to `SystemLanguageModel.tokenCount(for:)`. The total of all provided parts is returned.
 */
export async function tokenCount(input: TokenCountInput, model?: ModelSelector): Promise<number> {
  const payload =
    typeof input === 'string'
      ? { prompt: input }
      : {
          prompt: input.prompt,
          instructions: input.instructions,
          schema: input.schema ? resolveSchema(input.schema).jsonSchema : undefined,
          tools: input.tools ? prepareTools(input.tools).map((tool) => tool.descriptor) : undefined,
          transcriptJSON: input.transcript ? transcriptJSON(input.transcript) : undefined,
        };
  return unwrap(await requireNative().tokenCount(modelJSON(model), JSON.stringify(payload)));
}

/** Whether the model supports a locale (default: the device locale). */
export async function supportsLocale(locale?: string, model?: ModelSelector): Promise<boolean> {
  const native = getNativeModule();
  if (!native) return false;
  return unwrap(await native.supportsLocale(modelJSON(model), locale ?? null));
}

/** Everything useful for debugging device-specific issues. Never throws. */
export async function getDiagnostics(): Promise<Diagnostics> {
  const native = getNativeModule();
  if (!native) {
    return {
      platform: Platform.OS,
      osVersion: String(Platform.Version ?? '') || null,
      packageVersion: PACKAGE_VERSION,
      build: null,
      foundationModelsSupported: false,
      systemModel: null,
      privateCloudCompute: null,
      features: {},
    };
  }
  const raw = unwrap(await native.getDiagnostics()) as Omit<Diagnostics, 'packageVersion'>;
  return { ...raw, packageVersion: PACKAGE_VERSION };
}

/**
 * A handle to an Apple model with convenience methods. Creating it is free;
 * nothing is loaded until you create a session or query it.
 */
export class AppleModel {
  constructor(readonly selector: ModelSelector) {}

  getAvailability(): Promise<Availability> {
    return getAvailability(this.selector);
  }

  async isAvailable(): Promise<boolean> {
    return (await this.getAvailability()).available;
  }

  getInfo(): Promise<ModelInfo> {
    return getModelInfo(this.selector);
  }

  async getContextSize(): Promise<number | null> {
    return (await this.getInfo()).contextSize;
  }

  async getSupportedLanguages(): Promise<string[] | null> {
    return (await this.getInfo()).supportedLanguages;
  }

  supportsLocale(locale?: string): Promise<boolean> {
    return supportsLocale(locale, this.selector);
  }

  /** Token counting uses the on-device model's tokenizer. */
  tokenCount(input: TokenCountInput): Promise<number> {
    return tokenCount(input, this.selector);
  }

  createSession(options: Omit<SessionOptions, 'model'> = {}): Promise<Session> {
    return createSession({ ...options, model: this.selector });
  }
}

/** The on-device system model. Maps to `SystemLanguageModel(useCase:guardrails:)`. */
export function systemModel(options: { useCase?: SystemModelUseCase; guardrails?: SystemModelGuardrails } = {}): AppleModel {
  return new AppleModel({ type: 'system', ...options });
}

/** Apple's Private Cloud Compute model (iOS 27+, requires Apple's managed entitlement). */
export function privateCloudComputeModel(): AppleModel {
  return new AppleModel('privateCloudCompute');
}

/** Whether the native module is present (iOS dev build / bare app). Does not check model availability. */
export function isNativeModuleAvailable(): boolean {
  return getNativeModule() !== null;
}

/** Namespace-style API. Every function is also exported individually. */
export const AppleFoundationModels = {
  getAvailability,
  getPrivateCloudAvailability: getPrivateCloudComputeInfo,
  getPrivateCloudComputeInfo,
  getModelInfo,
  tokenCount,
  supportsLocale,
  getDiagnostics,
  systemModel,
  privateCloudComputeModel,
  createSession,
  isNativeModuleAvailable,
  version: PACKAGE_VERSION,
};
