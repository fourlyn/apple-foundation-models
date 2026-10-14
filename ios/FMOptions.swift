import Foundation
#if canImport(FoundationModels)
import FoundationModels

/// Parsed request payload shared by `respond` and `stream`.
@available(iOS 26.0, *)
struct FMRequest {
  var promptText: String
  var images: [[String: Any]]
  var options: GenerationOptions
  var schema: GenerationSchema?
  var includeSchemaInPrompt: Bool?
  var reasoningLevel: String?
  var customReasoningLevel: String?
  var metadataJSON: [String: String]

  var needsIOS27Overload: Bool {
    reasoningLevel != nil || !metadataJSON.isEmpty || !images.isEmpty
  }

  static func parse(_ json: String) throws -> FMRequest {
    let payload = try FMJSON.parseObject(json)
    guard let prompt = payload.string("prompt") else {
      throw FMBridgeError(code: "INVALID_PROMPT", message: "`prompt` must be a string.")
    }
    let images = (payload.array("images") ?? []).compactMap { $0 as? [String: Any] }
    let options = try FMOptionsParser.generationOptions(payload.object("options") ?? [:])
    var schema: GenerationSchema?
    if let schemaObject = payload.object("schema") {
      schema = try FMSchemaConverter.generationSchema(from: schemaObject, defaultName: payload.string("schemaName") ?? "Response")
    }
    let context = payload.object("options") ?? [:]
    var metadata: [String: String] = [:]
    for (key, value) in payload.object("metadata") ?? [:] {
      metadata[key] = FMJSON.stringify(value)
    }
    var reasoningLevel: String?
    var customReasoning: String?
    if let level = context.string("reasoningLevel") {
      reasoningLevel = level
    } else if let custom = context.object("reasoningLevel")?.string("custom") {
      reasoningLevel = "custom"
      customReasoning = custom
    }
    return FMRequest(
      promptText: prompt,
      images: images,
      options: options,
      schema: schema,
      includeSchemaInPrompt: context.bool("includeSchemaInPrompt"),
      reasoningLevel: reasoningLevel,
      customReasoningLevel: customReasoning,
      metadataJSON: metadata
    )
  }

  func prompt() throws -> Prompt {
    guard !images.isEmpty else {
      return Prompt(promptText)
    }
    #if compiler(>=6.4)
    if #available(iOS 27.0, *) {
      let attachments = try images.map(FMImages.attachment)
      let text = promptText
      return Prompt {
        text
        attachments
      }
    }
    throw FMBridgeError.unsupportedOS("Image prompts", minimum: "27.0")
    #else
    throw FMBridgeError.unsupportedSDK("Image prompts", sdk: "iOS 27")
    #endif
  }

  #if compiler(>=6.4)
  @available(iOS 27.0, *)
  func contextOptions() throws -> ContextOptions {
    ContextOptions(
      includeSchemaInPrompt: includeSchemaInPrompt ?? (schema != nil ? true : nil),
      reasoningLevel: try FMOptionsParser.reasoningLevel(reasoningLevel, custom: customReasoningLevel)
    )
  }

  @available(iOS 27.0, *)
  func metadata() throws -> [String: any ConvertibleToGeneratedContent] {
    var result: [String: any ConvertibleToGeneratedContent] = [:]
    for (key, json) in metadataJSON {
      result[key] = try GeneratedContent(json: json)
    }
    return result
  }
  #endif
}

enum FMOptionsParser {
  @available(iOS 26.0, *)
  static func generationOptions(_ object: [String: Any]) throws -> GenerationOptions {
    // Xcode 27 SDK renamed `sampling:` to `samplingMode:` (the old label is deprecated there, the new one is missing before).
    #if compiler(>=6.4)
    var options = GenerationOptions(
      samplingMode: try samplingMode(object.object("samplingMode")),
      temperature: object.double("temperature"),
      maximumResponseTokens: object.int("maximumResponseTokens")
    )
    #else
    var options = GenerationOptions(
      sampling: try samplingMode(object.object("samplingMode")),
      temperature: object.double("temperature"),
      maximumResponseTokens: object.int("maximumResponseTokens")
    )
    #endif
    if let mode = object.string("toolCallingMode") {
      #if compiler(>=6.4)
      if #available(iOS 27.0, *) {
        switch mode {
        case "allowed": options.toolCallingMode = .allowed
        case "required": options.toolCallingMode = .required
        case "disallowed": options.toolCallingMode = .disallowed
        default: throw FMBridgeError.invalidArgument("Unknown toolCallingMode '\(mode)'.")
        }
      } else {
        throw FMBridgeError.unsupportedOS("toolCallingMode", minimum: "27.0")
      }
      #else
      throw FMBridgeError.unsupportedSDK("toolCallingMode", sdk: "iOS 27")
      #endif
    }
    return options
  }

  @available(iOS 26.0, *)
  static func samplingMode(_ object: [String: Any]?) throws -> GenerationOptions.SamplingMode? {
    guard let object else { return nil }
    let seed = (object["seed"] as? NSNumber).map { $0.uint64Value }
    switch object.string("type") {
    case "greedy":
      return .greedy
    case "topK":
      guard let k = object.int("k") else { throw FMBridgeError.invalidArgument("samplingMode 'topK' requires `k`.") }
      return .random(top: k, seed: seed)
    case "probabilityThreshold", "topP":
      guard let threshold = object.double("probabilityThreshold") ?? object.double("p") else {
        throw FMBridgeError.invalidArgument("samplingMode 'probabilityThreshold' requires `probabilityThreshold`.")
      }
      return .random(probabilityThreshold: threshold, seed: seed)
    default:
      throw FMBridgeError.invalidArgument("Unknown samplingMode type '\(object.string("type") ?? "")'. Use 'greedy', 'topK' or 'probabilityThreshold'.")
    }
  }

  #if compiler(>=6.4)
  @available(iOS 27.0, *)
  static func reasoningLevel(_ name: String?, custom: String?) throws -> ContextOptions.ReasoningLevel? {
    guard let name else { return nil }
    switch name {
    case "light": return .light
    case "moderate": return .moderate
    case "deep": return .deep
    case "custom":
      guard let custom else { throw FMBridgeError.invalidArgument("Custom reasoning level requires a value.") }
      return .custom(custom)
    default:
      throw FMBridgeError.invalidArgument("Unknown reasoningLevel '\(name)'. Use 'light', 'moderate', 'deep' or { custom: string }.")
    }
  }

  @available(iOS 27.0, *)
  static func reasoningLevelName(_ level: ContextOptions.ReasoningLevel?) -> Any? {
    guard let level else { return nil }
    switch level {
    case .light: return "light"
    case .moderate: return "moderate"
    case .deep: return "deep"
    case .custom(let value): return ["custom": value]
    @unknown default: return "unknown"
    }
  }
  #endif
}

enum FMImages {
  /// Resolves an image descriptor (`{ uri }` or `{ base64 }`) to a file URL.
  /// Base64 images are written to a temporary file so large images never cross the bridge twice.
  static func fileURL(_ image: [String: Any]) throws -> URL {
    if let uri = image.string("uri") {
      if let url = URL(string: uri), url.scheme != nil {
        guard url.isFileURL else {
          throw FMBridgeError.invalidArgument("Only local file URIs are supported for images (got '\(url.scheme ?? "")'). Download remote images first.")
        }
        return url
      }
      return URL(fileURLWithPath: uri)
    }
    if let base64 = image.string("base64") {
      let cleaned = base64.components(separatedBy: ",").last ?? base64
      guard let data = Data(base64Encoded: cleaned, options: .ignoreUnknownCharacters) else {
        throw FMBridgeError.invalidArgument("Image `base64` is not valid base64 data.")
      }
      let url = FileManager.default.temporaryDirectory
        .appendingPathComponent("fourlyn-fm-\(UUID().uuidString)")
        .appendingPathExtension(image.string("fileExtension") ?? "jpg")
      try data.write(to: url, options: .atomic)
      return url
    }
    throw FMBridgeError.invalidArgument("Each image needs a `uri` or `base64`.")
  }

  #if compiler(>=6.4)
  @available(iOS 27.0, *)
  static func attachment(_ image: [String: Any]) throws -> Attachment<ImageAttachmentContent> {
    let attachment = Attachment(imageURL: try fileURL(image))
    if let label = image.string("label") {
      return attachment.label(label)
    }
    return attachment
  }
  #endif
}
#endif
