import ExpoModulesCore
import Foundation
#if canImport(FoundationModels)
import FoundationModels
#endif

/// Expo module bridging Apple's Foundation Models framework.
///
/// Conventions:
/// - Complex inputs are JSON strings (keeps JSON Schema property order intact).
/// - Fallible operations return an envelope `{ ok: true, value } | { ok: false, error }`
///   so structured error details survive the bridge. `src/native.ts` unwraps it.
public final class AppleFoundationModelsModule: Module {
  private let broker = FMToolCallBroker()
  private let historyBroker = FMHistoryTransformBroker()

  public func definition() -> ModuleDefinition {
    Name("AppleFoundationModels")

    Events("onToolCall", "onStreamEvent", "onProfileEvent", "onHistoryTransform")

    OnCreate {
      self.broker.emit = self.emitter("onToolCall")
      self.historyBroker.emit = self.emitter("onHistoryTransform")
    }

    OnDestroy {
      self.broker.cancelAll()
      self.historyBroker.cancelAll()
    }

    Function("getBuildInfo") { () -> [String: Any] in
      [
        "foundationModelsSDK": FMBuildInfo.hasFoundationModelsSDK,
        "ios26_4SDK": FMBuildInfo.hasIOS26_4SDK,
        "ios27SDK": FMBuildInfo.hasIOS27SDK,
        "osVersion": Self.osVersion,
        "platform": "ios",
      ]
    }

    AsyncFunction("getAvailability") { (modelJSON: String?) async -> [String: Any] in
      await FMEnvelope.run {
        try await Self.availability(modelJSON: modelJSON)
      }
    }

    AsyncFunction("getModelInfo") { (modelJSON: String?) async -> [String: Any] in
      await FMEnvelope.run {
        try await Self.modelInfo(modelJSON: modelJSON)
      }
    }

    AsyncFunction("supportsLocale") { (modelJSON: String?, locale: String?) async -> [String: Any] in
      await FMEnvelope.run {
        try await Self.supportsLocale(modelJSON: modelJSON, locale: locale)
      }
    }

    AsyncFunction("tokenCount") { (modelJSON: String?, inputJSON: String) async -> [String: Any] in
      await FMEnvelope.run {
        try await self.tokenCount(modelJSON: modelJSON, inputJSON: inputJSON)
      }
    }

    AsyncFunction("getDiagnostics") { () async -> [String: Any] in
      await FMEnvelope.run {
        await Self.diagnostics()
      }
    }

    Function("resolveToolCall") { (callId: String, resultJSON: String?, errorMessage: String?) -> Bool in
      self.broker.resolve(callId: callId, result: FMToolResult(json: resultJSON, errorMessage: errorMessage))
    }

    Function("resolveHistoryTransform") { (transformId: String, idsJSON: String?) -> Bool in
      self.historyBroker.resolve(id: transformId, idsJSON: idsJSON)
    }

    Function("createNativeSession") { () -> FMSessionObject in
      // Synchronous functions run on the JavaScript thread; remember it so a history
      // transform never waits for JavaScript on the thread JavaScript runs on.
      FMHistoryTransformBroker.markJavaScriptThread()
      return FMSessionObject(
        broker: self.broker,
        historyBroker: self.historyBroker,
        emitStream: self.emitter("onStreamEvent"),
        emitProfile: self.emitter("onProfileEvent")
      )
    }

    AsyncFunction("configureSession") { (session: FMSessionObject, configJSON: String) async -> [String: Any] in
      await FMEnvelope.run {
        #if canImport(FoundationModels)
        guard #available(iOS 26.0, *) else { throw FMBridgeError.unsupportedOS("Foundation Models", minimum: "26.0") }
        try session.configure(try FMJSON.parseObject(configJSON))
        return [
          "sessionId": session.sessionId,
          "model": session.resolvedModelKind,
          "contextSize": await session.contextSize(),
        ]
        #else
        throw FMBridgeError.unsupportedSDK("Foundation Models", sdk: "iOS 26")
        #endif
      }
    }

    AsyncFunction("respond") { (session: FMSessionObject, requestId: String, payloadJSON: String) async -> [String: Any] in
      await session.runCancellable(requestId: requestId) {
        #if canImport(FoundationModels)
        guard #available(iOS 26.0, *) else { throw FMBridgeError.unsupportedOS("Foundation Models", minimum: "26.0") }
        return try await session.respond(requestId: requestId, request: try FMRequest.parse(payloadJSON))
        #else
        throw FMBridgeError.unsupportedSDK("Foundation Models", sdk: "iOS 26")
        #endif
      }
    }

    Function("startStream") { (session: FMSessionObject, requestId: String, payloadJSON: String) -> [String: Any] in
      #if canImport(FoundationModels)
      guard #available(iOS 26.0, *) else {
        return FMEnvelope.failure(FMBridgeError.unsupportedOS("Foundation Models", minimum: "26.0"))
      }
      do {
        let request = try FMRequest.parse(payloadJSON)
        _ = try session.requireSession()
        session.startStream(requestId: requestId) {
          try await session.stream(requestId: requestId, request: request)
        }
        return FMEnvelope.ok(requestId)
      } catch {
        return FMEnvelope.failure(error)
      }
      #else
      return FMEnvelope.failure(FMBridgeError.unsupportedSDK("Foundation Models", sdk: "iOS 26"))
      #endif
    }

    Function("cancelRequest") { (session: FMSessionObject, requestId: String) in
      session.cancel(requestId: requestId)
    }

    AsyncFunction("prewarm") { (session: FMSessionObject, promptPrefix: String?) async -> [String: Any] in
      await FMEnvelope.run {
        #if canImport(FoundationModels)
        guard #available(iOS 26.0, *) else { throw FMBridgeError.unsupportedOS("Foundation Models", minimum: "26.0") }
        let native = try session.requireSession()
        native.prewarm(promptPrefix: promptPrefix.map { Prompt($0) })
        return true
        #else
        throw FMBridgeError.unsupportedSDK("Foundation Models", sdk: "iOS 26")
        #endif
      }
    }

    Function("getSessionState") { (session: FMSessionObject) -> [String: Any] in
      #if canImport(FoundationModels)
      guard #available(iOS 26.0, *) else {
        return FMEnvelope.failure(FMBridgeError.unsupportedOS("Foundation Models", minimum: "26.0"))
      }
      do { return FMEnvelope.ok(try session.state()) } catch { return FMEnvelope.failure(error) }
      #else
      return FMEnvelope.failure(FMBridgeError.unsupportedSDK("Foundation Models", sdk: "iOS 26"))
      #endif
    }

    AsyncFunction("getTranscript") { (session: FMSessionObject) async -> [String: Any] in
      await FMEnvelope.run {
        #if canImport(FoundationModels)
        guard #available(iOS 26.0, *) else { throw FMBridgeError.unsupportedOS("Foundation Models", minimum: "26.0") }
        return FMTranscriptConverter.toJS(try session.requireSession().transcript)
        #else
        throw FMBridgeError.unsupportedSDK("Foundation Models", sdk: "iOS 26")
        #endif
      }
    }

    Function("getTranscriptSync") { (session: FMSessionObject) -> [String: Any] in
      #if canImport(FoundationModels)
      guard #available(iOS 26.0, *) else {
        return FMEnvelope.failure(FMBridgeError.unsupportedOS("Foundation Models", minimum: "26.0"))
      }
      do { return FMEnvelope.ok(FMTranscriptConverter.toJS(try session.requireSession().transcript)) } catch { return FMEnvelope.failure(error) }
      #else
      return FMEnvelope.failure(FMBridgeError.unsupportedSDK("Foundation Models", sdk: "iOS 26"))
      #endif
    }

    Function("setActiveProfile") { (session: FMSessionObject, name: String) -> [String: Any] in
      #if canImport(FoundationModels) && compiler(>=6.4)
      guard #available(iOS 27.0, *) else {
        return FMEnvelope.failure(FMBridgeError.unsupportedOS("Dynamic profiles", minimum: "27.0"))
      }
      do {
        guard !session.profileNames.isEmpty else {
          throw FMBridgeError.invalidArgument("This session was not created with `profiles`.")
        }
        try FMProfiles.setActiveProfile(name, on: try session.requireSession(), known: session.profileNames)
        return FMEnvelope.ok(name)
      } catch {
        return FMEnvelope.failure(error)
      }
      #else
      return FMEnvelope.failure(FMBridgeError.unsupportedSDK("Dynamic profiles", sdk: "iOS 27"))
      #endif
    }

    AsyncFunction("createFeedbackAttachment") { (session: FMSessionObject, payloadJSON: String) async -> [String: Any] in
      await FMEnvelope.run {
        #if canImport(FoundationModels)
        guard #available(iOS 26.0, *) else { throw FMBridgeError.unsupportedOS("Foundation Models", minimum: "26.0") }
        return try session.feedback(try FMJSON.parseObject(payloadJSON)).base64EncodedString()
        #else
        throw FMBridgeError.unsupportedSDK("Foundation Models", sdk: "iOS 26")
        #endif
      }
    }

    Function("disposeSession") { (session: FMSessionObject) in
      session.dispose()
    }

    Class("NativeSession", FMSessionObject.self) {}
  }

  private func emitter(_ event: String) -> ([String: Any]) -> Void {
    { [weak self] payload in self?.sendEvent(event, payload) }
  }

  private static var isSimulator: Bool {
    #if targetEnvironment(simulator)
    return true
    #else
    return false
    #endif
  }

  private static var osVersion: String {
    let version = ProcessInfo.processInfo.operatingSystemVersion
    return "\(version.majorVersion).\(version.minorVersion).\(version.patchVersion)"
  }

  /// Hardware identifier such as `iPhone17,1` (the simulator reports the simulated model).
  private static var deviceModel: String {
    if let simulated = ProcessInfo.processInfo.environment["SIMULATOR_MODEL_IDENTIFIER"] {
      return simulated
    }
    var info = utsname()
    uname(&info)
    return withUnsafeBytes(of: &info.machine) { buffer in
      String(decoding: buffer.prefix(while: { $0 != 0 }), as: UTF8.self)
    }
  }

  // MARK: - Model-level operations

  private static func availability(modelJSON: String?) async throws -> [String: Any] {
    #if canImport(FoundationModels)
    guard #available(iOS 26.0, *) else { return FMAvailability.unsupported("unsupported") }
    let spec = try FMModelSpec.parse(try modelJSON.map(FMJSON.parse))
    switch spec.kind {
    case .system, .auto:
      let system = try FMModelResolver.systemModel(spec)
      if spec.kind == .auto && !system.isAvailable {
        #if compiler(>=6.4)
        if #available(iOS 27.0, *) {
          let pcc = PrivateCloudComputeLanguageModel()
          if pcc.isAvailable {
            var result = FMAvailability.pcc(pcc)
            result["model"] = "privateCloudCompute"
            return result
          }
        }
        #endif
      }
      var result = FMAvailability.system(system)
      result["model"] = "system"
      return result
    case .privateCloudCompute:
      #if compiler(>=6.4)
      if #available(iOS 27.0, *) {
        var result = FMAvailability.pcc(PrivateCloudComputeLanguageModel())
        result["model"] = "privateCloudCompute"
        return result
      }
      #endif
      var result = FMAvailability.unsupported("unsupported")
      result["model"] = "privateCloudCompute"
      return result
    }
    #else
    return FMAvailability.unsupported("unsupported")
    #endif
  }

  private static func modelInfo(modelJSON: String?) async throws -> [String: Any] {
    #if canImport(FoundationModels)
    guard #available(iOS 26.0, *) else { throw FMBridgeError.unsupportedOS("Foundation Models", minimum: "26.0") }
    let spec = try FMModelSpec.parse(try modelJSON.map(FMJSON.parse))
    if spec.kind == .privateCloudCompute {
      #if compiler(>=6.4)
      if #available(iOS 27.0, *) {
        return await FMModelInfo.pcc(PrivateCloudComputeLanguageModel())
      }
      #endif
      throw FMBridgeError.unsupportedOS("Private Cloud Compute", minimum: "27.0")
    }
    return FMModelInfo.system(try FMModelResolver.systemModel(spec), spec: spec)
    #else
    throw FMBridgeError.unsupportedSDK("Foundation Models", sdk: "iOS 26")
    #endif
  }

  private static func supportsLocale(modelJSON: String?, locale: String?) async throws -> Bool {
    #if canImport(FoundationModels)
    guard #available(iOS 26.0, *) else { return false }
    let spec = try FMModelSpec.parse(try modelJSON.map(FMJSON.parse))
    let target = locale.map { Locale(identifier: $0) } ?? Locale.current
    if spec.kind == .privateCloudCompute {
      #if compiler(>=6.4)
      if #available(iOS 27.0, *) {
        return try await PrivateCloudComputeLanguageModel().supportsLocale(target)
      }
      #endif
      return false
    }
    return try FMModelResolver.systemModel(spec).supportsLocale(target)
    #else
    return false
    #endif
  }

  private func tokenCount(modelJSON: String?, inputJSON: String) async throws -> Int {
    #if canImport(FoundationModels) && compiler(>=6.3)
    guard #available(iOS 26.4, *) else { throw FMBridgeError.unsupportedOS("Token counting", minimum: "26.4") }
    let spec = try FMModelSpec.parse(try modelJSON.map(FMJSON.parse))
    let model = try FMModelResolver.systemModel(spec)
    let input = try FMJSON.parseObject(inputJSON)
    var total = 0
    var counted = false
    if let prompt = input.string("prompt") {
      total += try await model.tokenCount(for: Prompt(prompt))
      counted = true
    }
    if let instructions = input.string("instructions") {
      total += try await model.tokenCount(for: Instructions(instructions))
      counted = true
    }
    if let schema = input.object("schema") {
      total += try await model.tokenCount(for: try FMSchemaConverter.generationSchema(from: schema))
      counted = true
    }
    if let tools = input.array("tools"), !tools.isEmpty {
      let descriptors = try tools.map(FMToolDescriptor.parse)
      let made = try FMToolFactory.makeTools(descriptors, sessionId: "token-count", broker: broker)
      total += try await model.tokenCount(for: made.tools)
      counted = true
    }
    if let transcriptJSON = input.string("transcriptJSON") {
      let transcript = try FMTranscriptConverter.decode(transcriptJSON)
      total += try await model.tokenCount(for: Array(transcript))
      counted = true
    }
    guard counted else {
      throw FMBridgeError.invalidArgument("tokenCount needs at least one of: prompt, instructions, schema, tools, transcript.")
    }
    return total
    #else
    throw FMBridgeError.unsupportedSDK("Token counting", sdk: "iOS 26.4")
    #endif
  }

  private static func diagnostics() async -> [String: Any] {
    var result: [String: Any] = [
      "platform": "ios",
      "osVersion": Self.osVersion,
      "deviceModel": Self.deviceModel,
      "isSimulator": Self.isSimulator,
      "build": [
        "foundationModelsSDK": FMBuildInfo.hasFoundationModelsSDK,
        "ios26_4SDK": FMBuildInfo.hasIOS26_4SDK,
        "ios27SDK": FMBuildInfo.hasIOS27SDK,
      ],
      "foundationModelsSupported": false,
      "systemModel": NSNull(),
      "privateCloudCompute": NSNull(),
      "features": [String: Bool](),
    ]
    #if canImport(FoundationModels)
    if #available(iOS 26.0, *) {
      result["foundationModelsSupported"] = true
      result["systemModel"] = FMModelInfo.system(.default, spec: FMModelSpec())
      var features: [String: Bool] = [
        "sessions": true,
        "streaming": true,
        "structuredGeneration": true,
        "tools": true,
        "prewarm": true,
        "feedback": true,
        "transcripts": true,
        "tokenCounting": false,
        "usage": false,
        "toolCallingMode": false,
        "reasoningLevel": false,
        "images": false,
        "privateCloudCompute": false,
        "dynamicProfiles": false,
        "visionTools": false,
      ]
      #if compiler(>=6.3)
      if #available(iOS 26.4, *) { features["tokenCounting"] = true }
      #endif
      #if compiler(>=6.4)
      if #available(iOS 27.0, *) {
        for key in ["usage", "toolCallingMode", "reasoningLevel", "images", "privateCloudCompute", "dynamicProfiles", "visionTools"] {
          features[key] = true
        }
        result["privateCloudCompute"] = await FMModelInfo.pcc(PrivateCloudComputeLanguageModel())
      }
      #endif
      result["features"] = features
    }
    #endif
    return result
  }
}
