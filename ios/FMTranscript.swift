import Foundation
#if canImport(FoundationModels)
import FoundationModels

/// Converts Apple's `Transcript` into typed JavaScript entries and to/from its lossless
/// Codable JSON representation (used for session persistence and restoration).
@available(iOS 26.0, *)
enum FMTranscriptConverter {
  static func encode(_ transcript: Transcript) throws -> String {
    let data = try JSONEncoder().encode(transcript)
    return String(decoding: data, as: UTF8.self)
  }

  static func decode(_ json: String) throws -> Transcript {
    do {
      return try JSONDecoder().decode(Transcript.self, from: Data(json.utf8))
    } catch {
      throw FMBridgeError(
        code: "INVALID_TRANSCRIPT",
        message: "Could not restore the transcript: \(error.localizedDescription)",
        details: ["debugDescription": String(describing: error)]
      )
    }
  }

  static func toJS(_ transcript: Transcript) -> [String: Any] {
    [
      "entries": transcript.map(entry),
      "json": (try? encode(transcript)) ?? NSNull(),
    ]
  }

  static func entries<S: Sequence>(_ entries: S) -> [[String: Any]] where S.Element == Transcript.Entry {
    entries.map(entry)
  }

  static func entry(_ entry: Transcript.Entry) -> [String: Any] {
    switch entry {
    case .instructions(let instructions):
      return [
        "id": instructions.id,
        "type": "instructions",
        "segments": instructions.segments.map(segment),
        "toolDefinitions": instructions.toolDefinitions.map { ["name": $0.name, "description": $0.description] },
      ]
    case .prompt(let prompt):
      var result: [String: Any] = [
        "id": prompt.id,
        "type": "prompt",
        "segments": prompt.segments.map(segment),
        "options": options(prompt.options),
        "responseFormat": prompt.responseFormat.map { ["name": $0.name] } ?? NSNull(),
      ]
      #if compiler(>=6.4)
      if #available(iOS 27.0, *) {
        result["reasoningLevel"] = FMOptionsParser.reasoningLevelName(prompt.contextOptions.reasoningLevel) ?? NSNull()
      }
      #endif
      return result
    case .toolCalls(let calls):
      return [
        "id": calls.id,
        "type": "toolCalls",
        "calls": calls.map { call in
          [
            "id": call.id,
            "toolName": call.toolName,
            "argumentsJSON": call.arguments.jsonString,
          ] as [String: Any]
        },
      ]
    case .toolOutput(let output):
      return [
        "id": output.id,
        "type": "toolOutput",
        "toolName": output.toolName,
        "segments": output.segments.map(segment),
      ]
    case .response(let response):
      return [
        "id": response.id,
        "type": "response",
        "segments": response.segments.map(segment),
      ]
    default:
      #if compiler(>=6.4)
      if #available(iOS 27.0, *), case .reasoning(let reasoning) = entry {
        return [
          "id": reasoning.id,
          "type": "reasoning",
          "segments": reasoning.segments.map(segment),
        ]
      }
      #endif
      return ["id": entry.id, "type": "unknown", "description": entry.description]
    }
  }

  static func segment(_ segment: Transcript.Segment) -> [String: Any] {
    switch segment {
    case .text(let text):
      return ["id": text.id, "type": "text", "text": text.content]
    case .structure(let structure):
      // Xcode 27 SDK renamed `source` to `schemaName`.
      #if compiler(>=6.4)
      let schemaName = structure.schemaName
      #else
      let schemaName = structure.source
      #endif
      return [
        "id": structure.id,
        "type": "structure",
        "schemaName": schemaName,
        "contentJSON": structure.content.jsonString,
      ]
    default:
      #if compiler(>=6.4)
      if #available(iOS 27.0, *), case .attachment(let attachment) = segment {
        var result: [String: Any] = [
          "id": attachment.id,
          "type": "attachment",
          "label": attachment.label ?? NSNull(),
        ]
        switch attachment.content {
        case .image(let image):
          result["kind"] = "image"
          result["uri"] = image.url?.absoluteString ?? NSNull()
        @unknown default:
          result["kind"] = "unknown"
        }
        return result
      }
      #endif
      return ["id": segment.id, "type": "unknown", "description": segment.description]
    }
  }

  static func options(_ options: GenerationOptions) -> [String: Any] {
    [
      "temperature": options.temperature ?? NSNull(),
      "maximumResponseTokens": options.maximumResponseTokens ?? NSNull(),
    ]
  }

  // MARK: - Building a transcript from plain messages

  /// Builds transcript entries from plain messages, for conversations that did not come from
  /// a saved Apple transcript (e.g. chat history kept by another library):
  /// `{ role: "user" | "assistant", content }`,
  /// `{ role: "toolCalls", calls: [{ id, toolName, argumentsJSON }] }`,
  /// `{ role: "toolOutput", id, toolName, content }`.
  static func entries(fromMessages messages: [Any]) throws -> [Transcript.Entry] {
    try messages.map { value in
      guard let message = value as? [String: Any], let role = message.string("role") else {
        throw FMBridgeError.invalidArgument("Each message must be an object with a `role`.")
      }
      let text: () throws -> [Transcript.Segment] = {
        guard let content = message.string("content") else {
          throw FMBridgeError.invalidArgument("A '\(role)' message needs a string `content`.")
        }
        return [.text(Transcript.TextSegment(content: content))]
      }
      switch role {
      case "user":
        return .prompt(Transcript.Prompt(segments: try text(), options: GenerationOptions(), responseFormat: nil))
      case "assistant":
        return .response(Transcript.Response(assetIDs: [], segments: try text()))
      case "toolCalls":
        let calls = try (message.array("calls") ?? []).map { value -> Transcript.ToolCall in
          guard let call = value as? [String: Any], let id = call.string("id"), let toolName = call.string("toolName") else {
            throw FMBridgeError.invalidArgument("Each tool call needs an `id` and a `toolName`.")
          }
          return Transcript.ToolCall(id: id, toolName: toolName, arguments: try GeneratedContent(json: call.string("argumentsJSON") ?? "{}"))
        }
        return .toolCalls(Transcript.ToolCalls(calls))
      case "toolOutput":
        guard let id = message.string("id"), let toolName = message.string("toolName") else {
          throw FMBridgeError.invalidArgument("A 'toolOutput' message needs an `id` and a `toolName`.")
        }
        return .toolOutput(Transcript.ToolOutput(id: id, toolName: toolName, segments: try text()))
      default:
        throw FMBridgeError.invalidArgument("Unknown message role '\(role)'. Use 'user', 'assistant', 'toolCalls' or 'toolOutput'.")
      }
    }
  }

  /// The instructions entry a session would have created itself, so a transcript built from
  /// plain messages still carries the instructions and tool definitions.
  static func instructionsEntry(_ instructions: String?, tools: [any Tool]) -> Transcript.Entry? {
    guard instructions != nil || !tools.isEmpty else { return nil }
    return .instructions(Transcript.Instructions(
      segments: instructions.map { [.text(Transcript.TextSegment(content: $0))] } ?? [],
      toolDefinitions: tools.map { Transcript.ToolDefinition(name: $0.name, description: $0.description, parameters: $0.parameters) }
    ))
  }

  /// Plain text of the segments (text segments only, structured segments as JSON).
  static func text(of segments: [Transcript.Segment]) -> String {
    segments.compactMap { segment -> String? in
      switch segment {
      case .text(let text): return text.content
      case .structure(let structure): return structure.content.jsonString
      default: return nil
      }
    }.joined()
  }
}
#endif
