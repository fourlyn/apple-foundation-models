import ExpoModulesCore
import Foundation
#if canImport(FoundationModels)
import FoundationModels
#endif

/// Native side of a JavaScript `Session`. One instance wraps one `LanguageModelSession`.
///
/// Lifecycle: created by `createSession`, released when JavaScript calls `dispose()`
/// (or when the JS object is garbage collected). Releasing cancels in-flight requests
/// and pending tool calls.
final class FMSessionObject: SharedObject {
  let sessionId = UUID().uuidString
  let broker: FMToolCallBroker
  let emitStream: ([String: Any]) -> Void
  let emitProfile: ([String: Any]) -> Void

  /// `LanguageModelSession` (typed as `AnyObject` so the class compiles on older SDKs).
  var nativeSession: AnyObject?
  var resolvedModelKind = "system"
  var profileNames: [String] = []

  private let lock = NSLock()
  private var tasks: [String: Task<Void, Never>] = [:]
  private var runningRequestId: String?

  init(broker: FMToolCallBroker, emitStream: @escaping ([String: Any]) -> Void, emitProfile: @escaping ([String: Any]) -> Void) {
    self.broker = broker
    self.emitStream = emitStream
    self.emitProfile = emitProfile
    super.init()
  }

  var currentRequestId: String? {
    lock.lock(); defer { lock.unlock() }
    return runningRequestId
  }

  private func setRunning(_ requestId: String?) {
    lock.lock(); runningRequestId = requestId; lock.unlock()
  }

  private func register(_ requestId: String, _ task: Task<Void, Never>) {
    lock.lock(); tasks[requestId] = task; lock.unlock()
  }

  private func unregister(_ requestId: String) {
    lock.lock(); tasks.removeValue(forKey: requestId); lock.unlock()
  }

  func cancel(requestId: String) {
    lock.lock(); let task = tasks.removeValue(forKey: requestId); lock.unlock()
    task?.cancel()
  }

  func dispose() {
    lock.lock()
    let all = tasks
    tasks.removeAll()
    lock.unlock()
    all.values.forEach { $0.cancel() }
    nativeSession = nil
  }

  override func sharedObjectWillRelease() {
    dispose()
    super.sharedObjectWillRelease()
  }

  /// Runs `body` in a cancellable task registered under `requestId`.
  func runCancellable(requestId: String, _ body: @escaping () async throws -> [String: Any]) async -> [String: Any] {
    var result: [String: Any] = FMEnvelope.failure(CancellationError())
    let task = Task<Void, Never> {
      result = await FMEnvelope.run { try await body() }
    }
    register(requestId, task)
    await task.value
    unregister(requestId)
    return result
  }

  func startStream(requestId: String, _ body: @escaping () async throws -> Void) {
    let task = Task<Void, Never> { [weak self] in
      do {
        try await body()
      } catch {
        self?.emitStream(["requestId": requestId, "type": "error", "error": FMErrorMapper.map(error)])
      }
      self?.unregister(requestId)
    }
    register(requestId, task)
  }

  #if canImport(FoundationModels)
  @available(iOS 26.0, *)
  func requireSession() throws -> LanguageModelSession {
    guard let session = nativeSession as? LanguageModelSession else {
      throw FMBridgeError.sessionDisposed
    }
    return session
  }

  // MARK: - Creation

  @available(iOS 26.0, *)
  func configure(_ config: [String: Any]) throws {
    let spec = try FMModelSpec.parse(config["model"])
    let model = try FMModelResolver.resolve(spec)
    resolvedModelKind = model.kindName

    let descriptors = try (config.array("tools") ?? []).map(FMToolDescriptor.parse)
    let (tools, jsTools) = try FMToolFactory.makeTools(descriptors, sessionId: sessionId, broker: broker)
    for tool in jsTools {
      tool.currentRequestId = { [weak self] in self?.currentRequestId }
    }

    var transcript: Transcript?
    if let json = config.string("transcriptJSON") {
      transcript = try FMTranscriptConverter.decode(json)
    }

    if let profiles = config.object("profiles"), !profiles.isEmpty {
      #if compiler(>=6.4)
      if #available(iOS 27.0, *) {
        let session = try FMProfiles.makeSession(
          profiles: profiles,
          initialProfile: config.string("initialProfile"),
          sessionInstructions: config.string("instructions"),
          defaultModel: model,
          modelSpec: spec,
          allTools: tools,
          history: transcript.map { Array($0) } ?? [],
          sessionId: sessionId,
          emit: emitProfile
        )
        profileNames = profiles.keys.sorted()
        nativeSession = session
        try applySessionPolicies(config, session)
        return
      }
      throw FMBridgeError.unsupportedOS("Dynamic profiles", minimum: "27.0")
      #else
      throw FMBridgeError.unsupportedSDK("Dynamic profiles", sdk: "iOS 27")
      #endif
    }

    let instructions = config.string("instructions").map { Instructions($0) }
    let session: LanguageModelSession
    switch model {
    case .system(let systemModel):
      if let transcript {
        session = LanguageModelSession(model: systemModel, tools: tools, transcript: transcript)
      } else {
        session = LanguageModelSession(model: systemModel, tools: tools, instructions: instructions)
      }
    case .privateCloudCompute(let object):
      #if compiler(>=6.4)
      guard #available(iOS 27.0, *), let pcc = object as? PrivateCloudComputeLanguageModel else {
        throw FMBridgeError.unsupportedOS("Private Cloud Compute", minimum: "27.0")
      }
      if let transcript {
        session = LanguageModelSession(model: pcc, tools: tools, transcript: transcript)
      } else {
        session = LanguageModelSession(model: pcc, tools: tools, instructions: instructions)
      }
      #else
      _ = object
      throw FMBridgeError.unsupportedSDK("Private Cloud Compute", sdk: "iOS 27")
      #endif
    }
    nativeSession = session
    try applySessionPolicies(config, session)
  }

  @available(iOS 26.0, *)
  private func applySessionPolicies(_ config: [String: Any], _ session: LanguageModelSession) throws {
    guard let policy = config.string("transcriptErrorHandling") else { return }
    #if compiler(>=6.4)
    if #available(iOS 27.0, *) {
      switch policy {
      case "revert": session.transcriptErrorHandlingPolicy = .revertTranscript
      case "preserve": session.transcriptErrorHandlingPolicy = .preserveTranscript
      default: throw FMBridgeError.invalidArgument("Unknown transcriptErrorHandling '\(policy)'. Use 'revert' or 'preserve'.")
      }
      return
    }
    throw FMBridgeError.unsupportedOS("transcriptErrorHandling", minimum: "27.0")
    #else
    throw FMBridgeError.unsupportedSDK("transcriptErrorHandling", sdk: "iOS 27")
    #endif
  }

  // MARK: - Requests

  @available(iOS 26.0, *)
  func respond(requestId: String, request: FMRequest) async throws -> [String: Any] {
    let session = try requireSession()
    setRunning(requestId)
    defer { setRunning(nil) }
    let prompt = try request.prompt()

    if let schema = request.schema {
      let response: LanguageModelSession.Response<GeneratedContent>
      #if compiler(>=6.4)
      if #available(iOS 27.0, *) {
        response = try await session.respond(
          to: prompt,
          schema: schema,
          options: request.options,
          contextOptions: try request.contextOptions(),
          metadata: try request.metadata()
        )
      } else {
        response = try await session.respond(to: prompt, schema: schema, includeSchemaInPrompt: request.includeSchemaInPrompt ?? true, options: request.options)
      }
      #else
      response = try await session.respond(to: prompt, schema: schema, includeSchemaInPrompt: request.includeSchemaInPrompt ?? true, options: request.options)
      #endif
      var result = FMSessionObject.baseResult(entries: Array(response.transcriptEntries))
      result["json"] = response.content.jsonString
      result["rawContentJSON"] = response.rawContent.jsonString
      result["isComplete"] = response.rawContent.isComplete
      result["usage"] = FMSessionObject.usage(of: response)
      return result
    }

    let response: LanguageModelSession.Response<String>
    #if compiler(>=6.4)
    if #available(iOS 27.0, *), request.needsIOS27Overload {
      response = try await session.respond(
        to: prompt,
        options: request.options,
        contextOptions: try request.contextOptions(),
        metadata: try request.metadata()
      )
    } else {
      response = try await session.respond(to: prompt, options: request.options)
    }
    #else
    response = try await session.respond(to: prompt, options: request.options)
    #endif
    var result = FMSessionObject.baseResult(entries: Array(response.transcriptEntries))
    result["text"] = response.content
    result["rawContentJSON"] = response.rawContent.jsonString
    result["usage"] = FMSessionObject.usage(of: response)
    return result
  }

  @available(iOS 26.0, *)
  func stream(requestId: String, request: FMRequest) async throws {
    let session = try requireSession()
    setRunning(requestId)
    defer { setRunning(nil) }
    let prompt = try request.prompt()
    let entryCountBefore = session.transcript.count

    if let schema = request.schema {
      let stream: LanguageModelSession.ResponseStream<GeneratedContent>
      #if compiler(>=6.4)
      if #available(iOS 27.0, *) {
        stream = session.streamResponse(
          to: prompt,
          schema: schema,
          options: request.options,
          contextOptions: try request.contextOptions(),
          metadata: try request.metadata()
        )
      } else {
        stream = session.streamResponse(to: prompt, schema: schema, includeSchemaInPrompt: request.includeSchemaInPrompt ?? true, options: request.options)
      }
      #else
      stream = session.streamResponse(to: prompt, schema: schema, includeSchemaInPrompt: request.includeSchemaInPrompt ?? true, options: request.options)
      #endif
      var lastJSON = "null"
      var lastUsage: Any = NSNull()
      for try await snapshot in stream {
        try Task.checkCancellation()
        lastJSON = snapshot.content.jsonString
        lastUsage = FMSessionObject.usage(of: snapshot)
        emitStream([
          "requestId": requestId,
          "type": "snapshot",
          "json": lastJSON,
          "isComplete": snapshot.rawContent.isComplete,
        ])
      }
      var result = FMSessionObject.baseResult(entries: Array(session.transcript.dropFirst(entryCountBefore)))
      result["json"] = lastJSON
      result["rawContentJSON"] = lastJSON
      result["isComplete"] = true
      result["usage"] = lastUsage
      emitStream(["requestId": requestId, "type": "done", "result": result])
      return
    }

    let stream: LanguageModelSession.ResponseStream<String>
    #if compiler(>=6.4)
    if #available(iOS 27.0, *), request.needsIOS27Overload {
      stream = session.streamResponse(
        to: prompt,
        options: request.options,
        contextOptions: try request.contextOptions(),
        metadata: try request.metadata()
      )
    } else {
      stream = session.streamResponse(to: prompt, options: request.options)
    }
    #else
    stream = session.streamResponse(to: prompt, options: request.options)
    #endif
    var text = ""
    var lastUsage: Any = NSNull()
    for try await snapshot in stream {
      try Task.checkCancellation()
      let next = snapshot.content
      var event: [String: Any] = ["requestId": requestId, "type": "snapshot", "text": next]
      if next.hasPrefix(text) {
        event["delta"] = String(next.dropFirst(text.count))
      } else {
        // The model revised earlier output; the consumer should replace, not append.
        event["delta"] = NSNull()
        event["replaced"] = true
      }
      text = next
      lastUsage = FMSessionObject.usage(of: snapshot)
      emitStream(event)
    }
    var result = FMSessionObject.baseResult(entries: Array(session.transcript.dropFirst(entryCountBefore)))
    result["text"] = text
    result["usage"] = lastUsage
    emitStream(["requestId": requestId, "type": "done", "result": result])
  }

  // MARK: - Helpers

  @available(iOS 26.0, *)
  static func baseResult(entries: [Transcript.Entry]) -> [String: Any] {
    ["transcriptEntries": FMTranscriptConverter.entries(entries)]
  }

  @available(iOS 26.0, *)
  static func usage<C>(of response: LanguageModelSession.Response<C>) -> Any {
    #if compiler(>=6.4)
    if #available(iOS 27.0, *) {
      return usageDict(response.usage)
    }
    #endif
    return NSNull()
  }

  @available(iOS 26.0, *)
  static func usage<C>(of snapshot: LanguageModelSession.ResponseStream<C>.Snapshot) -> Any {
    #if compiler(>=6.4)
    if #available(iOS 27.0, *) {
      return usageDict(snapshot.usage)
    }
    #endif
    return NSNull()
  }

  #if compiler(>=6.4)
  @available(iOS 27.0, *)
  static func usageDict(_ usage: LanguageModelSession.Usage) -> [String: Any] {
    [
      "inputTokens": usage.input.totalTokenCount,
      "cachedInputTokens": usage.input.cachedTokenCount,
      "outputTokens": usage.output.totalTokenCount,
      "reasoningTokens": usage.output.reasoningTokenCount,
      "totalTokens": usage.totalTokenCount,
    ]
  }
  #endif

  @available(iOS 26.0, *)
  func state() throws -> [String: Any] {
    let session = try requireSession()
    var state: [String: Any] = [
      "isResponding": session.isResponding,
      "model": resolvedModelKind,
      "usage": NSNull(),
      "profiles": profileNames,
    ]
    #if compiler(>=6.4)
    if #available(iOS 27.0, *) {
      state["usage"] = FMSessionObject.usageDict(session.usage)
      if !profileNames.isEmpty {
        state["activeProfile"] = FMProfiles.activeProfile(of: session)
      }
    }
    #endif
    return state
  }

  @available(iOS 26.0, *)
  func feedback(_ payload: [String: Any]) throws -> Data {
    let session = try requireSession()
    let sentiment: LanguageModelFeedback.Sentiment?
    switch payload.string("sentiment") {
    case "positive": sentiment = .positive
    case "negative": sentiment = .negative
    case "neutral": sentiment = .neutral
    case nil: sentiment = nil
    case let other?: throw FMBridgeError.invalidArgument("Unknown sentiment '\(other)'.")
    }
    let issues = try (payload.array("issues") ?? []).map { value -> LanguageModelFeedback.Issue in
      guard let issue = value as? [String: Any], let categoryName = issue.string("category") else {
        throw FMBridgeError.invalidArgument("Each issue needs a `category`.")
      }
      guard let category = LanguageModelFeedback.Issue.Category.allCases.first(where: { String(describing: $0) == categoryName }) else {
        throw FMBridgeError.invalidArgument("Unknown issue category '\(categoryName)'.")
      }
      return LanguageModelFeedback.Issue(category: category, explanation: issue.string("explanation"))
    }
    return session.logFeedbackAttachment(sentiment: sentiment, issues: issues, desiredResponseText: payload.string("desiredResponse"))
  }
  #endif
}
