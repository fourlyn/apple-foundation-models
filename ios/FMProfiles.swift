import Foundation
#if canImport(FoundationModels) && compiler(>=6.4)
import FoundationModels

@available(iOS 27.0, *)
extension SessionPropertyValues {
  /// Name of the active Fourlyn profile. Empty means "use the initial profile".
  @SessionPropertyEntry var fourlynActiveProfile: String = ""
  /// Tool calls made since the last prompt (drives `requiredToolCalls`).
  @SessionPropertyEntry var fourlynToolCallCount: Int = 0
}

/// Declarative history strategies, implemented natively so they cost no bridge round trip.
/// A JavaScript `historyTransform` callback runs after them (see `FMHistoryTransformBroker`).
@available(iOS 27.0, *)
struct FMHistoryStrategy {
  enum Kind { case all, none, lastEntries(Int), lastTurns(Int) }
  var kind: Kind = .all
  var dropToolCalls = false
  var dropReasoning = false

  static func parse(_ object: [String: Any]?) throws -> FMHistoryStrategy {
    guard let object else { return FMHistoryStrategy() }
    var strategy = FMHistoryStrategy()
    switch object.string("strategy") ?? "all" {
    case "all": strategy.kind = .all
    case "none": strategy.kind = .none
    case "last", "lastEntries":
      guard let count = object.int("count"), count >= 0 else { throw FMBridgeError.invalidArgument("history strategy 'last' requires a non-negative `count`.") }
      strategy.kind = .lastEntries(count)
    case "lastTurns":
      guard let count = object.int("count"), count >= 0 else { throw FMBridgeError.invalidArgument("history strategy 'lastTurns' requires a non-negative `count`.") }
      strategy.kind = .lastTurns(count)
    case let other:
      throw FMBridgeError.invalidArgument("Unknown history strategy '\(other)'. Use 'all', 'none', 'last' or 'lastTurns'.")
    }
    strategy.dropToolCalls = object.bool("dropToolCalls") ?? false
    strategy.dropReasoning = object.bool("dropReasoning") ?? false
    return strategy
  }

  var isIdentity: Bool {
    if case .all = kind, !dropToolCalls, !dropReasoning { return true }
    return false
  }

  func apply(_ entries: [Transcript.Entry]) -> [Transcript.Entry] {
    let isInstructions: (Transcript.Entry) -> Bool = {
      if case .instructions = $0 { return true }
      return false
    }
    let instructions = entries.filter(isInstructions)
    let all = entries.filter { !isInstructions($0) }

    // Apple passes the in-flight turn (the latest prompt, plus any tool calls/outputs so far) at the end
    // of the history, and the transcript must end with a prompt or tool output. It is always kept intact.
    let split = all.lastIndex(where: {
      if case .prompt = $0 { return true }
      return false
    }) ?? all.count
    var earlier = Array(all[..<split])
    if dropToolCalls || dropReasoning {
      earlier = earlier.filter { entry in
        switch entry {
        case .toolCalls, .toolOutput: return !dropToolCalls
        case .reasoning: return !dropReasoning
        default: return true
        }
      }
    }
    var rest = earlier + all[split...]
    let currentTurnStart = earlier.count

    switch kind {
    case .all:
      break
    case .none:
      rest = Array(rest[currentTurnStart...])
    case .lastEntries(let count):
      let keep = max(count, rest.count - currentTurnStart)
      rest = Array(rest.suffix(keep))
      // Never start the window with a dangling tool output.
      while let first = rest.first, case .toolOutput = first { rest.removeFirst() }
    case .lastTurns(let count):
      // `count` includes the current turn.
      let promptIndices = rest.indices.filter {
        if case .prompt = rest[$0] { return true }
        return false
      }
      let turns = max(count, 1)
      if promptIndices.count > turns {
        rest = Array(rest[promptIndices[promptIndices.count - turns]...])
      }
    }
    return instructions + rest
  }
}

@available(iOS 27.0, *)
final class FMProfileRegistry: @unchecked Sendable {
  struct Config {
    var instructions: String
    var tools: [any Tool]
    var model: any LanguageModel
    var temperature: Double?
    var samplingMode: GenerationOptions.SamplingMode?
    var maximumResponseTokens: Int?
    var reasoningLevel: ContextOptions.ReasoningLevel?
    var toolCallingMode: GenerationOptions.ToolCallingMode?
    /// Exit strategy for `required` tool calling: after this many tool calls in one turn,
    /// the mode switches to `allowed` so the model can produce a final answer.
    var requiredToolCalls: Int?
    var history: FMHistoryStrategy
    /// Whether JavaScript registered a `historyTransform` callback for this profile.
    var customHistory = false
  }

  let configs: [String: Config]
  let initial: String
  let sessionId: String
  let emit: ([String: Any]) -> Void
  weak var historyBroker: FMHistoryTransformBroker?

  init(configs: [String: Config], initial: String, sessionId: String, emit: @escaping ([String: Any]) -> Void, historyBroker: FMHistoryTransformBroker?) {
    self.configs = configs
    self.initial = initial
    self.sessionId = sessionId
    self.emit = emit
    self.historyBroker = historyBroker
  }

  /// Runs the profile's history strategy, then its JavaScript `historyTransform` (if any).
  /// If JavaScript does not answer in time, the strategy result is used.
  func history(for name: String, _ entries: [Transcript.Entry]) -> [Transcript.Entry] {
    let config = config(name)
    let base = config.history.apply(entries)
    guard config.customHistory,
          let ids = historyBroker?.request(sessionId: sessionId, profile: name, entries: FMTranscriptConverter.entries(base)) else {
      return base
    }
    return FMHistorySelection.select(base, keeping: ids)
  }

  func resolveName(_ active: String) -> String {
    active.isEmpty || configs[active] == nil ? initial : active
  }

  func config(_ name: String) -> Config {
    configs[name] ?? configs[initial]!
  }

  func send(_ profile: String, _ event: String, _ extra: [String: Any] = [:]) {
    var payload: [String: Any] = ["sessionId": sessionId, "profile": profile, "event": event]
    payload.merge(extra) { _, new in new }
    emit(payload)
  }
}

/// A single native `DynamicProfile` whose configuration is chosen at runtime from the
/// profiles declared in JavaScript. Switching profiles sets a `SessionProperty`,
/// which makes the framework re-evaluate `body`.
@available(iOS 27.0, *)
struct FMDynamicProfile: LanguageModelSession.DynamicProfile {
  let registry: FMProfileRegistry
  @SessionProperty(\.fourlynActiveProfile) var activeProfile: String
  @SessionProperty(\.fourlynToolCallCount) var toolCallCount: Int

  var body: some DynamicProfile {
    let registry = self.registry
    let name = registry.resolveName(activeProfile)
    let config = registry.config(name)
    let toolCallingMode: GenerationOptions.ToolCallingMode? = config.requiredToolCalls.map {
      toolCallCount < $0 ? .required : .allowed
    } ?? config.toolCallingMode
    let counter = _toolCallCount
    Profile {
      Instructions(config.instructions)
      config.tools
    }
    .model(config.model)
    .temperature(config.temperature)
    .samplingMode(config.samplingMode)
    .maximumResponseTokens(config.maximumResponseTokens)
    .reasoningLevel(config.reasoningLevel)
    .toolCallingMode(toolCallingMode)
    .historyTransform { entries in registry.history(for: name, entries) }
    .onActivate { registry.send(name, "activate") }
    .onDeactivate { registry.send(name, "deactivate") }
    .onPrompt { prompt in
      counter.wrappedValue = 0
      registry.send(name, "prompt", ["entry": FMTranscriptConverter.entry(.prompt(prompt))]) }
    .onReasoning { reasoning in registry.send(name, "reasoning", ["entry": FMTranscriptConverter.entry(.reasoning(reasoning))]) }
    .onResponse { response in registry.send(name, "response", ["entry": FMTranscriptConverter.entry(.response(response))]) }
    .onToolCall { call in
      counter.wrappedValue += 1
      registry.send(name, "toolCall", ["toolName": call.toolName, "callId": call.id, "argumentsJSON": call.arguments.jsonString])
    }
    .onToolOutput { call, output in
      registry.send(name, "toolOutput", ["toolName": call.toolName, "callId": call.id, "entry": FMTranscriptConverter.entry(.toolOutput(output))])
    }
  }
}

@available(iOS 27.0, *)
enum FMProfiles {
  static func makeSession(
    profiles: [String: Any],
    initialProfile: String?,
    sessionInstructions: String?,
    defaultModel: FMResolvedModel,
    modelSpec: FMModelSpec,
    allTools: [any Tool],
    history: [Transcript.Entry],
    sessionId: String,
    emit: @escaping ([String: Any]) -> Void,
    historyBroker: FMHistoryTransformBroker?
  ) throws -> LanguageModelSession {
    var configs: [String: FMProfileRegistry.Config] = [:]
    for (name, value) in profiles {
      guard let object = value as? [String: Any] else {
        throw FMBridgeError.invalidArgument("Profile '\(name)' must be an object.")
      }
      let tools: [any Tool]
      if let names = object["tools"] as? [String] {
        let unknown = names.filter { toolName in !allTools.contains { $0.name == toolName } }
        guard unknown.isEmpty else {
          throw FMBridgeError.invalidArgument("Profile '\(name)' references unknown tools: \(unknown.joined(separator: ", ")). Declare them in createSession({ tools }).")
        }
        tools = allTools.filter { names.contains($0.name) }
      } else {
        tools = allTools
      }
      let options = try FMOptionsParser.generationOptions(object)
      let reasoningName = object.string("reasoningLevel") ?? (object.object("reasoningLevel") != nil ? "custom" : nil)
      configs[name] = FMProfileRegistry.Config(
        instructions: object.string("instructions") ?? sessionInstructions ?? "",
        tools: tools,
        model: try model(object["model"], fallback: defaultModel, fallbackSpec: modelSpec),
        temperature: options.temperature,
        samplingMode: options.samplingMode,
        maximumResponseTokens: options.maximumResponseTokens,
        reasoningLevel: try FMOptionsParser.reasoningLevel(reasoningName, custom: object.object("reasoningLevel")?.string("custom")),
        toolCallingMode: options.toolCallingMode,
        requiredToolCalls: object.int("requiredToolCalls"),
        history: try FMHistoryStrategy.parse(object.object("history")),
        customHistory: object.bool("historyTransform") ?? false
      )
    }
    let initial = initialProfile ?? profiles.keys.sorted().first!
    guard configs[initial] != nil else {
      throw FMBridgeError.invalidArgument("initialProfile '\(initial)' is not one of the declared profiles.")
    }
    let registry = FMProfileRegistry(configs: configs, initial: initial, sessionId: sessionId, emit: emit, historyBroker: historyBroker)
    let session = LanguageModelSession(profile: FMDynamicProfile(registry: registry), history: history)
    session.properties.fourlynActiveProfile = initial
    return session
  }

  static func setActiveProfile(_ name: String, on session: LanguageModelSession, known: [String]) throws {
    guard known.contains(name) else {
      throw FMBridgeError.invalidArgument("Unknown profile '\(name)'. Declared profiles: \(known.joined(separator: ", ")).")
    }
    session.properties.fourlynActiveProfile = name
  }

  static func activeProfile(of session: LanguageModelSession) -> String {
    session.properties.fourlynActiveProfile
  }

  private static func model(_ value: Any?, fallback: FMResolvedModel, fallbackSpec: FMModelSpec) throws -> any LanguageModel {
    let resolved = value == nil ? fallback : try FMModelResolver.resolve(try FMModelSpec.parse(value))
    switch resolved {
    case .system(let system):
      return system
    case .privateCloudCompute(let object):
      guard let pcc = object as? PrivateCloudComputeLanguageModel else {
        throw FMBridgeError.unsupportedOS("Private Cloud Compute", minimum: "27.0")
      }
      return pcc
    }
  }
}
#endif
