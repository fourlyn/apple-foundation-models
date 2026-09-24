import Foundation

// Compile-time feature flags.
//
// `canImport(FoundationModels)` is false on SDKs older than Xcode 26.
// `compiler(>=6.3)` ~ Xcode 26.4 SDK (token counting, `DynamicGenerationSchema.null`).
// `compiler(>=6.4)` ~ Xcode 27 SDK (PCC, dynamic profiles, multimodal, usage, reasoning, ...).
//
// Runtime availability is always checked separately with `#available`.
enum FMBuildInfo {
  static var hasFoundationModelsSDK: Bool {
    #if canImport(FoundationModels)
    return true
    #else
    return false
    #endif
  }

  static var hasIOS26_4SDK: Bool {
    #if canImport(FoundationModels) && compiler(>=6.3)
    return true
    #else
    return false
    #endif
  }

  static var hasIOS27SDK: Bool {
    #if canImport(FoundationModels) && compiler(>=6.4)
    return true
    #else
    return false
    #endif
  }
}

/// Error thrown by the bridge itself (not by Apple's framework).
struct FMBridgeError: Error {
  let code: String
  let message: String
  var details: [String: Any] = [:]

  static func unsupportedOS(_ feature: String, minimum: String) -> FMBridgeError {
    FMBridgeError(
      code: "UNSUPPORTED_OS_VERSION",
      message: "\(feature) requires iOS \(minimum) or later.",
      details: ["feature": feature, "minimumOS": minimum, "reason": "OS_VERSION"]
    )
  }

  static func unsupportedSDK(_ feature: String, sdk: String) -> FMBridgeError {
    FMBridgeError(
      code: "UNSUPPORTED_OS_VERSION",
      message: "\(feature) is unavailable because the app was built with an SDK older than \(sdk). Rebuild with a newer Xcode.",
      details: ["feature": feature, "minimumSDK": sdk, "reason": "SDK_VERSION"]
    )
  }

  static func invalidArgument(_ message: String) -> FMBridgeError {
    FMBridgeError(code: "INVALID_ARGUMENT", message: message)
  }

  static var sessionDisposed: FMBridgeError {
    FMBridgeError(code: "SESSION_DISPOSED", message: "The session has been disposed.")
  }
}

enum FMJSON {
  static func parse(_ string: String) throws -> Any {
    guard let data = string.data(using: .utf8) else {
      throw FMBridgeError.invalidArgument("Payload is not valid UTF-8.")
    }
    do {
      return try JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])
    } catch {
      throw FMBridgeError.invalidArgument("Payload is not valid JSON: \(error.localizedDescription)")
    }
  }

  static func parseObject(_ string: String) throws -> [String: Any] {
    guard let object = try parse(string) as? [String: Any] else {
      throw FMBridgeError.invalidArgument("Expected a JSON object.")
    }
    return object
  }

  static func stringify(_ value: Any) -> String {
    guard JSONSerialization.isValidJSONObject(value) || value is String || value is NSNumber || value is NSNull,
          let data = try? JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed]),
          let string = String(data: data, encoding: .utf8) else {
      return "null"
    }
    return string
  }
}

extension Dictionary where Key == String, Value == Any {
  func string(_ key: String) -> String? { self[key] as? String }
  func bool(_ key: String) -> Bool? { self[key] as? Bool }
  func int(_ key: String) -> Int? { (self[key] as? NSNumber)?.intValue }
  func double(_ key: String) -> Double? { (self[key] as? NSNumber)?.doubleValue }
  func object(_ key: String) -> [String: Any]? { self[key] as? [String: Any] }
  func array(_ key: String) -> [Any]? { self[key] as? [Any] }
}

func fmISODate(_ date: Date?) -> Any {
  guard let date else { return NSNull() }
  return ISO8601DateFormatter().string(from: date)
}

/// Result envelope returned to JavaScript. Errors are passed as data rather than thrown
/// so that structured details (reset dates, token counts, ...) survive the bridge.
enum FMEnvelope {
  static func ok(_ value: Any) -> [String: Any] {
    ["ok": true, "value": value]
  }

  static func failure(_ error: Error) -> [String: Any] {
    ["ok": false, "error": FMErrorMapper.map(error)]
  }

  static func run(_ body: () async throws -> Any) async -> [String: Any] {
    do {
      return ok(try await body())
    } catch {
      return failure(error)
    }
  }
}
