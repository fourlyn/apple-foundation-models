import Foundation
#if canImport(FoundationModels)
import FoundationModels
#endif

/// JavaScript model selector, parsed from:
/// `"system" | "privateCloudCompute" | "auto" | { type: "system", useCase?, guardrails? } | { type: "privateCloudCompute" }`
struct FMModelSpec {
  enum Kind: String {
    case system
    case privateCloudCompute
    case auto
  }

  var kind: Kind = .system
  var useCase: String = "general"
  var guardrails: String = "default"

  static func parse(_ value: Any?) throws -> FMModelSpec {
    guard let value, !(value is NSNull) else { return FMModelSpec() }
    if let string = value as? String {
      guard let kind = Kind(rawValue: string) else {
        throw FMBridgeError.invalidArgument("Unknown model '\(string)'. Use 'system', 'privateCloudCompute' or 'auto'.")
      }
      return FMModelSpec(kind: kind)
    }
    guard let object = value as? [String: Any] else {
      throw FMBridgeError.invalidArgument("`model` must be a string or an object.")
    }
    var spec = FMModelSpec()
    if let type = object.string("type") {
      guard let kind = Kind(rawValue: type) else {
        throw FMBridgeError.invalidArgument("Unknown model type '\(type)'.")
      }
      spec.kind = kind
    }
    spec.useCase = object.string("useCase") ?? "general"
    spec.guardrails = object.string("guardrails") ?? "default"
    return spec
  }
}

#if canImport(FoundationModels)
/// A resolved Apple model. Stored as `Any` for PCC so this type can exist on the iOS 26 SDK.
@available(iOS 26.0, *)
enum FMResolvedModel {
  case system(SystemLanguageModel)
  /// Holds a `PrivateCloudComputeLanguageModel` (iOS 27+).
  case privateCloudCompute(AnyObject)

  var kindName: String {
    switch self {
    case .system: return "system"
    case .privateCloudCompute: return "privateCloudCompute"
    }
  }
}

@available(iOS 26.0, *)
enum FMModelResolver {
  static func systemModel(_ spec: FMModelSpec) throws -> SystemLanguageModel {
    let useCase: SystemLanguageModel.UseCase
    switch spec.useCase {
    case "general": useCase = .general
    case "contentTagging": useCase = .contentTagging
    default: throw FMBridgeError.invalidArgument("Unknown useCase '\(spec.useCase)'. Use 'general' or 'contentTagging'.")
    }
    let guardrails: SystemLanguageModel.Guardrails
    switch spec.guardrails {
    case "default": guardrails = .default
    case "permissiveContentTransformations": guardrails = .permissiveContentTransformations
    default: throw FMBridgeError.invalidArgument("Unknown guardrails '\(spec.guardrails)'. Use 'default' or 'permissiveContentTransformations'.")
    }
    if spec.useCase == "general" && spec.guardrails == "default" {
      return .default
    }
    return SystemLanguageModel(useCase: useCase, guardrails: guardrails)
  }

  /// Resolves a model spec. `auto` is a Fourlyn abstraction: it prefers the on-device
  /// system model and falls back to Private Cloud Compute only when the system model
  /// is unavailable and PCC is available.
  static func resolve(_ spec: FMModelSpec) throws -> FMResolvedModel {
    switch spec.kind {
    case .system:
      return .system(try systemModel(spec))
    case .privateCloudCompute:
      return .privateCloudCompute(try privateCloudComputeModel(requireAvailable: true))
    case .auto:
      let system = try systemModel(spec)
      if system.isAvailable {
        return .system(system)
      }
      if let pcc = try? privateCloudComputeModel(requireAvailable: true) {
        return .privateCloudCompute(pcc)
      }
      let availability = FMAvailability.system(system)
      throw FMBridgeError(
        code: "MODEL_UNAVAILABLE",
        message: "No Apple model is available (model: 'auto').",
        details: ["systemAvailability": availability]
      )
    }
  }

  static func privateCloudComputeModel(requireAvailable: Bool) throws -> AnyObject {
    #if compiler(>=6.4)
    if #available(iOS 27.0, *) {
      let model = PrivateCloudComputeLanguageModel()
      if requireAvailable, case .unavailable(let reason) = model.availability {
        throw FMBridgeError(
          code: "PRIVATE_CLOUD_COMPUTE_UNAVAILABLE",
          message: "Private Cloud Compute is unavailable (\(FMAvailability.pccReasonName(reason))).",
          details: ["reason": FMAvailability.pccReasonCode(reason)]
        )
      }
      return model
    }
    throw FMBridgeError.unsupportedOS("Private Cloud Compute", minimum: "27.0")
    #else
    throw FMBridgeError.unsupportedSDK("Private Cloud Compute", sdk: "iOS 27")
    #endif
  }
}

enum FMAvailability {
  @available(iOS 26.0, *)
  static func system(_ model: SystemLanguageModel) -> [String: Any] {
    switch model.availability {
    case .available:
      return ["status": "available", "available": true]
    case .unavailable(let reason):
      let name: String
      switch reason {
      case .deviceNotEligible: name = "deviceNotEligible"
      case .appleIntelligenceNotEnabled: name = "appleIntelligenceNotEnabled"
      case .modelNotReady: name = "modelNotReady"
      @unknown default: name = "unknown"
      }
      return ["status": "unavailable", "available": false, "reason": name, "nativeReason": String(describing: reason)]
    }
  }

  #if compiler(>=6.4)
  @available(iOS 27.0, *)
  static func pccReasonName(_ reason: PrivateCloudComputeLanguageModel.Availability.UnavailableReason) -> String {
    switch reason {
    case .deviceNotEligible: return "deviceNotEligible"
    case .systemNotReady: return "systemNotReady"
    @unknown default: return "unknown"
    }
  }

  @available(iOS 27.0, *)
  static func pccReasonCode(_ reason: PrivateCloudComputeLanguageModel.Availability.UnavailableReason) -> String {
    switch reason {
    case .deviceNotEligible: return "DEVICE_NOT_ELIGIBLE"
    case .systemNotReady: return "SYSTEM_NOT_READY"
    @unknown default: return "UNKNOWN"
    }
  }

  @available(iOS 27.0, *)
  static func pcc(_ model: PrivateCloudComputeLanguageModel) -> [String: Any] {
    switch model.availability {
    case .available:
      return ["status": "available", "available": true]
    case .unavailable(let reason):
      return ["status": "unavailable", "available": false, "reason": pccReasonName(reason), "nativeReason": String(describing: reason)]
    }
  }
  #endif

  static func unsupported(_ reason: String = "unsupported") -> [String: Any] {
    ["status": "unavailable", "available": false, "reason": reason]
  }
}

enum FMModelInfo {
  static func languageIdentifiers(_ languages: Set<Locale.Language>) -> [String] {
    languages.map { $0.minimalIdentifier }.sorted()
  }

  #if compiler(>=6.4)
  @available(iOS 27.0, *)
  static func capabilityName(_ capability: LanguageModelCapabilities.Capability) -> String {
    if capability == .vision { return "vision" }
    if capability == .guidedGeneration { return "guidedGeneration" }
    if capability == .reasoning { return "reasoning" }
    if capability == .toolCalling { return "toolCalling" }
    return String(describing: capability)
  }

  @available(iOS 27.0, *)
  static func capabilities(_ capabilities: LanguageModelCapabilities) -> [String: Bool] {
    [
      "vision": capabilities.contains(.vision),
      "guidedGeneration": capabilities.contains(.guidedGeneration),
      "reasoning": capabilities.contains(.reasoning),
      "toolCalling": capabilities.contains(.toolCalling),
    ]
  }

  @available(iOS 27.0, *)
  static func variant(_ variant: SystemLanguageModel.Variant) -> [String: Any] {
    var id = "unknown"
    if variant == .core3 { id = "core3" }
    if variant == .coreAdvanced3 { id = "coreAdvanced3" }
    return ["id": id, "displayName": variant.displayName]
  }
  #endif

  @available(iOS 26.0, *)
  static func system(_ model: SystemLanguageModel, spec: FMModelSpec) -> [String: Any] {
    var info: [String: Any] = [
      "model": "system",
      "useCase": spec.useCase,
      "guardrails": spec.guardrails,
      "availability": FMAvailability.system(model),
      "isAvailable": model.isAvailable,
      "supportedLanguages": languageIdentifiers(model.supportedLanguages),
      "contextSize": model.contextSize,
      "variant": NSNull(),
      "capabilities": NSNull(),
    ]
    #if compiler(>=6.4)
    if #available(iOS 27.0, *) {
      info["variant"] = variant(model.variant)
      info["capabilities"] = capabilities(model.capabilities)
    }
    #endif
    return info
  }

  #if compiler(>=6.4)
  @available(iOS 27.0, *)
  static func quota(_ usage: PrivateCloudComputeLanguageModel.QuotaUsage) -> [String: Any] {
    var status = "belowLimit"
    var approaching = false
    switch usage.status {
    case .belowLimit(let info):
      approaching = info.isApproachingLimit
    case .limitReached:
      status = "limitReached"
    @unknown default:
      status = "unknown"
    }
    return [
      "status": status,
      "isLimitReached": usage.isLimitReached,
      "isApproachingLimit": approaching,
      "resetDate": fmISODate(usage.resetDate),
      "canRequestLimitIncrease": usage.limitIncreaseSuggestion != nil,
    ]
  }

  @available(iOS 27.0, *)
  static func pcc(_ model: PrivateCloudComputeLanguageModel) async -> [String: Any] {
    var info: [String: Any] = [
      "model": "privateCloudCompute",
      "availability": FMAvailability.pcc(model),
      "isAvailable": model.isAvailable,
      "quota": quota(model.quotaUsage),
      "capabilities": capabilities(model.capabilities),
      "contextSize": NSNull(),
      "supportedLanguages": NSNull(),
    ]
    if model.isAvailable {
      if let size = try? await model.contextSize { info["contextSize"] = size }
      if let languages = try? await model.supportedLanguages { info["supportedLanguages"] = languageIdentifiers(languages) }
    }
    return info
  }
  #endif
}
#endif
