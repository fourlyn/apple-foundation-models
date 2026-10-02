import Foundation
#if canImport(FoundationModels)
import FoundationModels
#endif

/// Converts any error raised by Foundation Models (or the bridge) into a JS-friendly dictionary:
/// `{ code, message, nativeType, details }`.
///
/// Every code produced here must be listed in `src/errors.ts` and `docs/errors.md`.
enum FMErrorMapper {
  static func map(_ error: Error) -> [String: Any] {
    if let bridge = error as? FMBridgeError {
      return make(bridge.code, bridge.message, "FMBridgeError", bridge.details)
    }
    if error is CancellationError {
      return make("CANCELLED", "The operation was cancelled.", "CancellationError")
    }
    if let toolError = error as? FMToolExecutionError {
      return make("TOOL_CALL_FAILED", toolError.message, "ToolExecutionError", ["toolName": toolError.toolName])
    }

    #if canImport(FoundationModels)
    if #available(iOS 26.0, *) {
      if let mapped = mapFoundationModels(error) {
        return mapped
      }
    }
    #endif

    let nsError = error as NSError
    var details: [String: Any] = [
      "domain": nsError.domain,
      "nativeCode": nsError.code,
      "debugDescription": String(describing: error),
    ]
    if !nsError.userInfo.isEmpty {
      details["userInfo"] = nsError.userInfo.mapValues { String(describing: $0) }
    }
    var underlying: [NSError] = []
    if let single = nsError.userInfo[NSUnderlyingErrorKey] as? NSError { underlying.append(single) }
    if let multiple = nsError.userInfo[NSMultipleUnderlyingErrorsKey] as? [NSError] { underlying.append(contentsOf: multiple) }
    if !underlying.isEmpty {
      details["underlyingErrors"] = underlying.map { ["domain": $0.domain, "code": $0.code, "description": $0.localizedDescription] }
    }
    // Model assets missing or still downloading (e.g. tool-calling or vision assets on some simulators).
    let isAssetError: (NSError) -> Bool = { $0.domain.contains("ModelManager") || $0.domain.contains("UnifiedAssetFramework") }
    if isAssetError(nsError) || underlying.contains(where: isAssetError) {
      return make("MODEL_NOT_READY", error.localizedDescription, nsError.domain, details)
    }
    // Apple has no dedicated "missing entitlement" error; recognise it from the error text.
    if mentionsEntitlement(error.localizedDescription, String(describing: error), nsError.domain) {
      details["reason"] = "ENTITLEMENT_REQUIRED"
      return make("ENTITLEMENT_REQUIRED", error.localizedDescription, nsError.domain, details)
    }
    // Framework errors that arrive bridged as NSError (not castable to the Swift enum).
    if nsError.domain.hasPrefix("FoundationModels") {
      return make("GENERATION_FAILED", error.localizedDescription, nsError.domain, details)
    }
    return make("UNKNOWN", error.localizedDescription, String(describing: type(of: error)), details)
  }

  static func make(_ code: String, _ message: String, _ nativeType: String, _ details: [String: Any] = [:]) -> [String: Any] {
    ["code": code, "message": message, "nativeType": nativeType, "details": details]
  }

  /// Whether any of the texts says an entitlement is missing. Apple reports a missing
  /// Private Cloud Compute entitlement only through error descriptions, so this is a heuristic.
  static func mentionsEntitlement(_ texts: String...) -> Bool {
    texts.contains { $0.range(of: "entitle", options: .caseInsensitive) != nil }
  }

  #if canImport(FoundationModels)
  @available(iOS 26.0, *)
  private static func mapFoundationModels(_ error: Error) -> [String: Any]? {
    if let toolCallError = error as? LanguageModelSession.ToolCallError {
      var details: [String: Any] = ["toolName": toolCallError.tool.name]
      if let inner = toolCallError.underlyingError as? FMToolExecutionError {
        details["underlyingMessage"] = inner.message
      } else {
        details["underlyingMessage"] = toolCallError.underlyingError.localizedDescription
      }
      return make("TOOL_CALL_FAILED", toolCallError.localizedDescription, "LanguageModelSession.ToolCallError", details)
    }

    if let schemaError = error as? GenerationSchema.SchemaError {
      return make("INVALID_SCHEMA", schemaError.localizedDescription, "GenerationSchema.SchemaError", ["debugDescription": String(describing: schemaError)])
    }

    #if compiler(>=6.4)
    if #available(iOS 27.0, *) {
      if let mapped = mapIOS27(error) {
        return mapped
      }
    }
    #endif

    if let generationError = error as? LanguageModelSession.GenerationError {
      return mapGenerationError(generationError)
    }
    return nil
  }

  @available(iOS 26.0, *)
  private static func mapGenerationError(_ error: LanguageModelSession.GenerationError) -> [String: Any] {
    let type = "LanguageModelSession.GenerationError"
    let message = error.localizedDescription
    switch error {
    case .exceededContextWindowSize(let context):
      return make("CONTEXT_SIZE_EXCEEDED", message, type, ["debugDescription": context.debugDescription])
    case .assetsUnavailable(let context):
      return make("MODEL_NOT_READY", message, type, ["debugDescription": context.debugDescription])
    case .guardrailViolation(let context):
      return make("GUARDRAIL_VIOLATION", message, type, ["debugDescription": context.debugDescription])
    case .unsupportedGuide(let context):
      return make("INVALID_SCHEMA", message, type, ["debugDescription": context.debugDescription])
    case .unsupportedLanguageOrLocale(let context):
      return make("UNSUPPORTED_LANGUAGE_OR_LOCALE", message, type, ["debugDescription": context.debugDescription])
    case .decodingFailure(let context):
      return make("DECODING_FAILED", message, type, ["debugDescription": context.debugDescription])
    case .rateLimited(let context):
      return make("RATE_LIMITED", message, type, ["debugDescription": context.debugDescription])
    case .concurrentRequests(let context):
      return make("CONCURRENT_REQUESTS", message, type, ["debugDescription": context.debugDescription])
    case .refusal(_, let context):
      return make("REFUSAL", message, type, ["debugDescription": context.debugDescription])
    @unknown default:
      return make("GENERATION_FAILED", message, type, ["debugDescription": String(describing: error)])
    }
  }

  #if compiler(>=6.4)
  @available(iOS 27.0, *)
  private static func mapIOS27(_ error: Error) -> [String: Any]? {
    if let error = error as? LanguageModelError {
      let type = "LanguageModelError"
      let message = error.localizedDescription
      switch error {
      case .contextSizeExceeded(let info):
        return make("CONTEXT_SIZE_EXCEEDED", message, type, [
          "contextSize": info.contextSize,
          "tokenCount": info.tokenCount,
          "debugDescription": info.debugDescription,
        ])
      case .rateLimited(let info):
        return make("RATE_LIMITED", message, type, ["resetDate": fmISODate(info.resetDate), "debugDescription": info.debugDescription])
      case .guardrailViolation(let info):
        return make("GUARDRAIL_VIOLATION", message, type, ["debugDescription": info.debugDescription])
      case .refusal(let info):
        return make("REFUSAL", message, type, ["debugDescription": info.debugDescription])
      case .unsupportedCapability(let info):
        return make("UNSUPPORTED_CAPABILITY", message, type, [
          "capability": FMModelInfo.capabilityName(info.capability),
          "debugDescription": info.debugDescription,
        ])
      case .unsupportedTranscriptContent(let info):
        return make("UNSUPPORTED_TRANSCRIPT_CONTENT", message, type, [
          "entryCount": info.unsupportedContent.count,
          "debugDescription": info.debugDescription,
        ])
      case .unsupportedGenerationGuide(let info):
        return make("INVALID_SCHEMA", message, type, ["schemaName": info.schemaName ?? NSNull(), "debugDescription": info.debugDescription])
      case .unsupportedLanguageOrLocale(let info):
        return make("UNSUPPORTED_LANGUAGE_OR_LOCALE", message, type, [
          "languageCode": info.languageCode.identifier,
          "debugDescription": info.debugDescription,
        ])
      case .timeout(let info):
        return make("TIMEOUT", message, type, ["debugDescription": info.debugDescription])
      @unknown default:
        return make("GENERATION_FAILED", message, type, ["debugDescription": String(describing: error)])
      }
    }

    if let error = error as? LanguageModelSession.Error {
      switch error {
      case .concurrentRequests:
        return make("CONCURRENT_REQUESTS", error.localizedDescription, "LanguageModelSession.Error")
      case .transcriptMutationWhileResponding:
        return make("TRANSCRIPT_MUTATION_WHILE_RESPONDING", error.localizedDescription, "LanguageModelSession.Error")
      @unknown default:
        return make("GENERATION_FAILED", error.localizedDescription, "LanguageModelSession.Error")
      }
    }

    if let error = error as? SystemLanguageModel.Error {
      switch error {
      case .assetsUnavailable(let info):
        return make("MODEL_NOT_READY", error.localizedDescription, "SystemLanguageModel.Error", ["debugDescription": info.debugDescription])
      @unknown default:
        return make("MODEL_UNAVAILABLE", error.localizedDescription, "SystemLanguageModel.Error")
      }
    }

    if let error = error as? PrivateCloudComputeLanguageModel.Error {
      let type = "PrivateCloudComputeLanguageModel.Error"
      switch error {
      case .networkFailure(let info):
        return make("NETWORK_FAILURE", error.localizedDescription, type, ["debugDescription": info.debugDescription])
      case .quotaLimitReached(let info):
        return make("QUOTA_LIMIT_REACHED", error.localizedDescription, type, [
          "resetDate": fmISODate(info.resetDate),
          "canRequestLimitIncrease": info.limitIncreaseSuggestion != nil,
          "debugDescription": info.debugDescription,
        ])
      case .serviceUnavailable(let info):
        let entitlement = mentionsEntitlement(info.debugDescription, error.localizedDescription)
        return make("PRIVATE_CLOUD_COMPUTE_UNAVAILABLE", error.localizedDescription, type, [
          "reason": entitlement ? "ENTITLEMENT_REQUIRED" : "SERVICE_UNAVAILABLE",
          "debugDescription": info.debugDescription,
        ])
      @unknown default:
        let description = String(describing: error)
        return make("PRIVATE_CLOUD_COMPUTE_UNAVAILABLE", error.localizedDescription, type, [
          "reason": mentionsEntitlement(description, error.localizedDescription) ? "ENTITLEMENT_REQUIRED" : "UNKNOWN",
          "debugDescription": description,
        ])
      }
    }

    if let error = error as? GeneratedContent.ParsingError {
      return make("DECODING_FAILED", error.localizedDescription, "GeneratedContent.ParsingError", [
        "rawContent": error.rawContent,
        "debugDescription": error.debugDescription,
      ])
    }
    return nil
  }
  #endif
  #endif
}

/// Error raised when a JavaScript tool's `execute` throws.
struct FMToolExecutionError: Error, LocalizedError {
  let toolName: String
  let message: String
  var errorDescription: String? { "Tool '\(toolName)' failed: \(message)" }
}
