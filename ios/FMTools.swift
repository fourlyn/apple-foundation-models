import Foundation
#if canImport(FoundationModels)
import FoundationModels
#endif
#if canImport(_Vision_FoundationModels)
// Cross-import overlay that provides Vision's `OCRTool` and `BarcodeReaderTool` (iOS 27 SDK).
import Vision
import _Vision_FoundationModels
#endif

/// The result of a JavaScript tool execution, sent back via `resolveToolCall`.
struct FMToolResult {
  /// JSON-encoded tool output (any JSON value). Strings are passed to the model verbatim.
  let json: String?
  /// Present when the JavaScript `execute` function threw.
  let errorMessage: String?
}

/// Routes tool invocations from Swift to JavaScript and waits for their results.
///
/// Every call gets its own continuation keyed by a unique call ID, so parallel
/// tool calls requested by the model run concurrently in JavaScript.
final class FMToolCallBroker: @unchecked Sendable {
  private let lock = NSLock()
  private var pending: [String: CheckedContinuation<FMToolResult, Error>] = [:]
  private var cancelledBeforeRegistration: Set<String> = []

  /// Sends the `onToolCall` event to JavaScript. Set by the module.
  var emit: (([String: Any]) -> Void)?

  func invoke(sessionId: String, requestId: String?, toolName: String, argumentsJSON: String) async throws -> FMToolResult {
    let callId = UUID().uuidString
    return try await withTaskCancellationHandler {
      try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<FMToolResult, Error>) in
        lock.lock()
        if cancelledBeforeRegistration.remove(callId) != nil {
          lock.unlock()
          continuation.resume(throwing: CancellationError())
          return
        }
        pending[callId] = continuation
        lock.unlock()
        emit?([
          "sessionId": sessionId,
          "requestId": requestId ?? NSNull(),
          "callId": callId,
          "toolName": toolName,
          "argumentsJSON": argumentsJSON,
        ])
      }
    } onCancel: {
      self.lock.lock()
      let continuation = self.pending.removeValue(forKey: callId)
      if continuation == nil {
        self.cancelledBeforeRegistration.insert(callId)
      }
      self.lock.unlock()
      continuation?.resume(throwing: CancellationError())
    }
  }

  /// Returns `false` if the call ID is unknown (already resolved or cancelled).
  @discardableResult
  func resolve(callId: String, result: FMToolResult) -> Bool {
    lock.lock()
    let continuation = pending.removeValue(forKey: callId)
    lock.unlock()
    guard let continuation else { return false }
    continuation.resume(returning: result)
    return true
  }

  func cancelAll() {
    lock.lock()
    let all = pending
    pending.removeAll()
    lock.unlock()
    for continuation in all.values {
      continuation.resume(throwing: CancellationError())
    }
  }
}

/// Parsed tool definition coming from JavaScript.
struct FMToolDescriptor {
  enum Kind {
    /// A JavaScript function tool.
    case javascript(parametersJSON: [String: Any], includesSchemaInInstructions: Bool)
    /// A tool implemented natively by Apple (e.g. Vision's `OCRTool`).
    case native(identifier: String)
  }

  let name: String
  let description: String
  let kind: Kind

  static func parse(_ value: Any) throws -> FMToolDescriptor {
    guard let object = value as? [String: Any] else {
      throw FMBridgeError.invalidArgument("Each tool must be an object.")
    }
    if let nativeId = object.string("nativeTool") {
      return FMToolDescriptor(
        name: object.string("name") ?? nativeId,
        description: object.string("description") ?? "",
        kind: .native(identifier: nativeId)
      )
    }
    guard let name = object.string("name"), !name.isEmpty else {
      throw FMBridgeError.invalidArgument("Tool is missing a `name`.")
    }
    return FMToolDescriptor(
      name: name,
      description: object.string("description") ?? "",
      kind: .javascript(
        parametersJSON: object.object("parameters") ?? ["type": "object", "properties": [String: Any]()],
        includesSchemaInInstructions: object.bool("includesSchemaInInstructions") ?? true
      )
    )
  }
}

#if canImport(FoundationModels)
/// A Foundation Models `Tool` whose implementation lives in JavaScript.
@available(iOS 26.0, *)
final class FMJavaScriptTool: Tool, @unchecked Sendable {
  typealias Arguments = GeneratedContent
  typealias Output = Prompt

  let name: String
  let description: String
  let parameters: GenerationSchema
  let includesSchemaInInstructions: Bool

  private let sessionId: String
  private weak var broker: FMToolCallBroker?
  /// The request that is currently running; used to attribute tool calls in events.
  var currentRequestId: (() -> String?)?

  init(descriptor: FMToolDescriptor, parametersJSON: [String: Any], includesSchemaInInstructions: Bool, sessionId: String, broker: FMToolCallBroker) throws {
    self.name = descriptor.name
    self.description = descriptor.description
    self.includesSchemaInInstructions = includesSchemaInInstructions
    self.parameters = try FMSchemaConverter.generationSchema(from: parametersJSON, defaultName: "\(descriptor.name)Arguments")
    self.sessionId = sessionId
    self.broker = broker
  }

  func call(arguments: GeneratedContent) async throws -> Prompt {
    guard let broker else {
      throw FMToolExecutionError(toolName: name, message: "The session was disposed before the tool could run.")
    }
    let result = try await broker.invoke(
      sessionId: sessionId,
      requestId: currentRequestId?(),
      toolName: name,
      argumentsJSON: arguments.jsonString
    )
    if let message = result.errorMessage {
      throw FMToolExecutionError(toolName: name, message: message)
    }
    guard let json = result.json else {
      return Prompt("")
    }
    // Plain strings go to the model verbatim; any other JSON value is passed as structured content.
    if let value = try? FMJSON.parse(json), let string = value as? String {
      return Prompt(string)
    }
    return Prompt(try GeneratedContent(json: json))
  }
}

enum FMToolFactory {
  /// Identifiers of native tools that can be requested from JavaScript.
  static let nativeToolIdentifiers = ["vision.ocr", "vision.barcodeReader"]

  @available(iOS 26.0, *)
  static func makeTools(_ descriptors: [FMToolDescriptor], sessionId: String, broker: FMToolCallBroker) throws -> (tools: [any Tool], jsTools: [FMJavaScriptTool]) {
    var tools: [any Tool] = []
    var jsTools: [FMJavaScriptTool] = []
    for descriptor in descriptors {
      switch descriptor.kind {
      case .javascript(let parametersJSON, let includesSchema):
        let tool = try FMJavaScriptTool(
          descriptor: descriptor,
          parametersJSON: parametersJSON,
          includesSchemaInInstructions: includesSchema,
          sessionId: sessionId,
          broker: broker
        )
        tools.append(tool)
        jsTools.append(tool)
      case .native(let identifier):
        tools.append(try makeNativeTool(identifier, name: descriptor.name, description: descriptor.description))
      }
    }
    return (tools, jsTools)
  }

  @available(iOS 26.0, *)
  private static func makeNativeTool(_ identifier: String, name: String?, description: String?) throws -> any Tool {
    let customName = (name?.isEmpty == false && name != identifier) ? name : nil
    let customDescription = (description?.isEmpty == false) ? description : nil
    #if compiler(>=6.4) && canImport(_Vision_FoundationModels)
    if #available(iOS 27.0, *) {
      switch identifier {
      case "vision.ocr":
        return OCRTool(name: customName, description: customDescription)
      case "vision.barcodeReader":
        return BarcodeReaderTool(name: customName, description: customDescription)
      default:
        break
      }
    } else {
      throw FMBridgeError.unsupportedOS("Native tool '\(identifier)'", minimum: "27.0")
    }
    #else
    if nativeToolIdentifiers.contains(identifier) {
      #if targetEnvironment(simulator)
      // Apple ships the Vision tools in the device SDK only.
      throw FMBridgeError(
        code: "UNSUPPORTED_PLATFORM",
        message: "Native tool '\(identifier)' is not available in the iOS Simulator. Run on a device.",
        details: ["feature": identifier, "reason": "SIMULATOR"]
      )
      #else
      throw FMBridgeError.unsupportedSDK("Native tool '\(identifier)'", sdk: "iOS 27")
      #endif
    }
    #endif
    throw FMBridgeError.invalidArgument("Unknown native tool '\(identifier)'. Available: \(nativeToolIdentifiers.joined(separator: ", ")).")
  }
}
#endif
