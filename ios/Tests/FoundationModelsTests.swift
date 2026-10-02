import XCTest
@testable import AppleFoundationModelsBridge
#if canImport(FoundationModels)
import FoundationModels

/// Conversions to and from Apple's Foundation Models types. No model is loaded, so these
/// run on any iOS 26+ simulator, with or without Apple Intelligence.
final class FoundationModelsTests: XCTestCase {
  override func setUpWithError() throws {
    guard #available(iOS 26.0, *) else { throw XCTSkip("Foundation Models requires iOS 26") }
  }

  // MARK: - Requests and options

  @available(iOS 26.0, *)
  func testRequestParsesPromptOptionsAndSchema() throws {
    let request = try FMRequest.parse("""
      {"prompt":"Hi","options":{"temperature":0.2,"maximumResponseTokens":50,"samplingMode":{"type":"greedy"}},
       "schema":{"type":"object","properties":{"name":{"type":"string"}},"required":["name"]}}
      """)
    XCTAssertEqual(request.promptText, "Hi")
    XCTAssertEqual(request.options.temperature, 0.2)
    XCTAssertEqual(request.options.maximumResponseTokens, 50)
    XCTAssertNotNil(request.schema)
    XCTAssertFalse(request.needsIOS27Overload)
  }

  @available(iOS 26.0, *)
  func testRequestWithoutPromptIsRejected() {
    XCTAssertThrowsError(try FMRequest.parse("{}")) { error in
      XCTAssertEqual((error as? FMBridgeError)?.code, "INVALID_PROMPT")
    }
  }

  @available(iOS 26.0, *)
  func testReasoningLevelAndMetadataSelectTheIOS27Overload() throws {
    XCTAssertTrue(try FMRequest.parse(#"{"prompt":"Hi","options":{"reasoningLevel":"deep"}}"#).needsIOS27Overload)
    XCTAssertTrue(try FMRequest.parse(#"{"prompt":"Hi","metadata":{"screen":"home"}}"#).needsIOS27Overload)
    let custom = try FMRequest.parse(#"{"prompt":"Hi","options":{"reasoningLevel":{"custom":"extra"}}}"#)
    XCTAssertEqual(custom.reasoningLevel, "custom")
    XCTAssertEqual(custom.customReasoningLevel, "extra")
  }

  @available(iOS 26.0, *)
  func testSamplingModes() throws {
    XCTAssertNil(try FMOptionsParser.samplingMode(nil))
    XCTAssertNotNil(try FMOptionsParser.samplingMode(["type": "greedy"]))
    XCTAssertNotNil(try FMOptionsParser.samplingMode(["type": "topK", "k": 40, "seed": 7]))
    XCTAssertNotNil(try FMOptionsParser.samplingMode(["type": "probabilityThreshold", "probabilityThreshold": 0.9]))
    XCTAssertThrowsError(try FMOptionsParser.samplingMode(["type": "topK"]))
    XCTAssertThrowsError(try FMOptionsParser.samplingMode(["type": "beam"]))
  }

  // MARK: - Schemas

  @available(iOS 26.0, *)
  func testSchemaConversionCoversTheSupportedSubset() throws {
    let schema: [String: Any] = [
      "type": "object",
      "properties": [
        "name": ["type": "string", "description": "Full name"],
        "age": ["type": "integer", "minimum": 0, "maximum": 130],
        "role": ["type": "string", "enum": ["admin", "member"]],
        "tags": ["type": "array", "items": ["type": "string"], "maxItems": 3],
        "address": ["type": "object", "properties": ["city": ["type": "string"]], "required": ["city"]],
        "nickname": ["type": ["string", "null"]],
      ],
      "required": ["name", "age"],
      "x-fourlyn-order": ["name", "age", "role", "tags", "address", "nickname"],
    ]
    XCTAssertNoThrow(try FMSchemaConverter.generationSchema(from: schema, defaultName: "Person"))
  }

  @available(iOS 26.0, *)
  func testSchemaConversionResolvesLocalRefs() throws {
    let schema: [String: Any] = [
      "type": "object",
      "properties": ["home": ["$ref": "#/$defs/Address"]],
      "required": ["home"],
      "$defs": ["Address": ["type": "object", "properties": ["city": ["type": "string"]], "required": ["city"]]],
    ]
    XCTAssertNoThrow(try FMSchemaConverter.generationSchema(from: schema))
  }

  @available(iOS 26.0, *)
  func testUnsupportedSchemasFailWithInvalidSchema() {
    let cases: [[String: Any]] = [
      ["type": "object", "properties": ["x": ["$ref": "https://example.com/schema"]]],
      ["type": "object", "properties": ["x": ["enum": [1, 2]]]],
      ["type": "object", "properties": ["x": ["type": "date"]]],
      ["type": "object", "properties": ["x": ["description": "no type"]]],
    ]
    for schema in cases {
      XCTAssertThrowsError(try FMSchemaConverter.generationSchema(from: schema)) { error in
        XCTAssertEqual((error as? FMBridgeError)?.code, "INVALID_SCHEMA", "\(schema)")
      }
    }
  }

  // MARK: - Transcripts

  @available(iOS 26.0, *)
  func testPlainMessagesBecomeTranscriptEntries() throws {
    let entries = try FMTranscriptConverter.entries(fromMessages: [
      ["role": "user", "content": "Weather in Delhi?"],
      ["role": "toolCalls", "calls": [["id": "call-1", "toolName": "getWeather", "argumentsJSON": #"{"city":"Delhi"}"#]]],
      ["role": "toolOutput", "id": "call-1", "toolName": "getWeather", "content": "31°C"],
      ["role": "assistant", "content": "It is 31°C in Delhi."],
    ])
    let js = FMTranscriptConverter.entries(entries)
    XCTAssertEqual(js.map { $0["type"] as? String }, ["prompt", "toolCalls", "toolOutput", "response"])
    let call = (js[1]["calls"] as? [[String: Any]])?.first
    XCTAssertEqual(call?["toolName"] as? String, "getWeather")
    XCTAssertEqual(try FMJSON.parseObject(call?["argumentsJSON"] as? String ?? "").string("city"), "Delhi")
    XCTAssertEqual(js[2]["toolName"] as? String, "getWeather")
    XCTAssertEqual(FMTranscriptConverter.text(of: {
      if case .response(let response) = entries[3] { return response.segments }
      return []
    }()), "It is 31°C in Delhi.")
  }

  @available(iOS 26.0, *)
  func testInvalidPlainMessagesAreRejected() {
    XCTAssertThrowsError(try FMTranscriptConverter.entries(fromMessages: [["role": "system", "content": "x"]]))
    XCTAssertThrowsError(try FMTranscriptConverter.entries(fromMessages: [["role": "user"]]))
    XCTAssertThrowsError(try FMTranscriptConverter.entries(fromMessages: [["role": "toolOutput", "content": "x"]]))
    XCTAssertThrowsError(try FMTranscriptConverter.entries(fromMessages: ["text"]))
  }

  @available(iOS 26.0, *)
  func testInstructionsEntryIsOnlyCreatedWhenNeeded() {
    XCTAssertNil(FMTranscriptConverter.instructionsEntry(nil, tools: []))
    guard case .instructions(let instructions)? = FMTranscriptConverter.instructionsEntry("Be brief.", tools: []) else {
      return XCTFail("expected an instructions entry")
    }
    XCTAssertEqual(FMTranscriptConverter.text(of: instructions.segments), "Be brief.")
  }

  @available(iOS 26.0, *)
  func testTranscriptSurvivesAJSONRoundTrip() throws {
    let entries = try FMTranscriptConverter.entries(fromMessages: [
      ["role": "user", "content": "My favourite colour is teal."],
      ["role": "assistant", "content": "OK."],
    ])
    let transcript = Transcript(entries: entries)
    let restored = try FMTranscriptConverter.decode(try FMTranscriptConverter.encode(transcript))
    XCTAssertEqual(restored, transcript)
    let js = FMTranscriptConverter.toJS(restored)
    XCTAssertEqual((js["entries"] as? [[String: Any]])?.count, 2)
    XCTAssertNotNil(js["json"] as? String)
  }

  @available(iOS 26.0, *)
  func testCorruptTranscriptFailsWithInvalidTranscript() {
    XCTAssertThrowsError(try FMTranscriptConverter.decode("{not json")) { error in
      XCTAssertEqual((error as? FMBridgeError)?.code, "INVALID_TRANSCRIPT")
    }
  }

  // MARK: - History

  /// instructions, then three finished turns, then the in-flight prompt.
  @available(iOS 26.0, *)
  private func conversation() throws -> [Transcript.Entry] {
    let instructions = FMTranscriptConverter.instructionsEntry("Be brief.", tools: [])!
    return [instructions] + (try FMTranscriptConverter.entries(fromMessages: [
      ["role": "user", "content": "one"],
      ["role": "assistant", "content": "1"],
      ["role": "user", "content": "two"],
      ["role": "toolCalls", "calls": [["id": "c1", "toolName": "lookup", "argumentsJSON": "{}"]]],
      ["role": "toolOutput", "id": "c1", "toolName": "lookup", "content": "found"],
      ["role": "assistant", "content": "2"],
      ["role": "user", "content": "three"],
      ["role": "assistant", "content": "3"],
      ["role": "user", "content": "current"],
    ]))
  }

  @available(iOS 26.0, *)
  private func summary(_ entries: [Transcript.Entry]) -> [String] {
    FMTranscriptConverter.entries(entries).map { entry in
      let type = entry["type"] as? String ?? "?"
      let text = (entry["segments"] as? [[String: Any]])?.compactMap { $0["text"] as? String }.joined() ?? ""
      return text.isEmpty ? type : "\(type):\(text)"
    }
  }

  @available(iOS 26.0, *)
  func testSelectionKeepsChosenEntriesPlusInstructionsAndTheCurrentTurn() throws {
    let entries = try conversation()
    let keep = [entries[1].id, entries[2].id] // the first turn only
    XCTAssertEqual(summary(FMHistorySelection.select(entries, keeping: keep)), [
      "instructions:Be brief.", "prompt:one", "response:1", "prompt:current",
    ])
  }

  @available(iOS 26.0, *)
  func testSelectionOfNothingStillSendsInstructionsAndTheCurrentPrompt() throws {
    XCTAssertEqual(summary(FMHistorySelection.select(try conversation(), keeping: [])), ["instructions:Be brief.", "prompt:current"])
  }

  @available(iOS 26.0, *)
  func testSelectionIgnoresUnknownIDsAndKeepsOriginalOrder() throws {
    let entries = try conversation()
    let keep = [entries[8].id, "does-not-exist", entries[7].id]
    XCTAssertEqual(summary(FMHistorySelection.select(entries, keeping: keep)), [
      "instructions:Be brief.", "prompt:three", "response:3", "prompt:current",
    ])
  }

  @available(iOS 26.0, *)
  func testSelectionDropsAToolOutputLeftWithoutItsCall() throws {
    let entries = try conversation()
    let keep = [entries[5].id, entries[6].id] // tool output and the answer, but not the call
    XCTAssertEqual(summary(FMHistorySelection.select(entries, keeping: keep)), [
      "instructions:Be brief.", "response:2", "prompt:current",
    ])
  }

  #if compiler(>=6.4)
  @available(iOS 27.0, *)
  private func apply(_ strategy: [String: Any]?) throws -> [String] {
    summary(try FMHistoryStrategy.parse(strategy).apply(try conversation()))
  }

  func testHistoryStrategies() throws {
    guard #available(iOS 27.0, *) else { throw XCTSkip("Dynamic profiles require iOS 27") }
    XCTAssertEqual(try apply(nil).count, 10)
    XCTAssertEqual(try apply(["strategy": "none"]), ["instructions:Be brief.", "prompt:current"])
    XCTAssertEqual(try apply(["strategy": "lastTurns", "count": 2]), [
      "instructions:Be brief.", "prompt:three", "response:3", "prompt:current",
    ])
    XCTAssertEqual(try apply(["strategy": "last", "count": 3]), [
      "instructions:Be brief.", "prompt:three", "response:3", "prompt:current",
    ])
    XCTAssertEqual(try apply(["strategy": "all", "dropToolCalls": true]), [
      "instructions:Be brief.", "prompt:one", "response:1", "prompt:two", "response:2", "prompt:three", "response:3", "prompt:current",
    ])
  }

  func testHistoryStrategyNeverDropsTheCurrentTurn() throws {
    guard #available(iOS 27.0, *) else { throw XCTSkip("Dynamic profiles require iOS 27") }
    XCTAssertEqual(try apply(["strategy": "last", "count": 0]), ["instructions:Be brief.", "prompt:current"])
    XCTAssertEqual(try apply(["strategy": "lastTurns", "count": 0]), ["instructions:Be brief.", "prompt:current"])
  }

  func testInvalidHistoryStrategiesAreRejected() throws {
    guard #available(iOS 27.0, *) else { throw XCTSkip("Dynamic profiles require iOS 27") }
    XCTAssertThrowsError(try FMHistoryStrategy.parse(["strategy": "last"]))
    XCTAssertThrowsError(try FMHistoryStrategy.parse(["strategy": "newest", "count": 2]))
  }

  // MARK: - iOS 27 error mapping

  func testPrivateCloudComputeErrors() throws {
    guard #available(iOS 27.0, *) else { throw XCTSkip("Private Cloud Compute requires iOS 27") }
    typealias PCCError = PrivateCloudComputeLanguageModel.Error

    let unavailable = FMErrorMapper.map(PCCError.serviceUnavailable(.init(debugDescription: "Service is down")))
    XCTAssertEqual(unavailable["code"] as? String, "PRIVATE_CLOUD_COMPUTE_UNAVAILABLE")
    XCTAssertEqual((unavailable["details"] as? [String: Any])?["reason"] as? String, "SERVICE_UNAVAILABLE")

    let entitlement = FMErrorMapper.map(PCCError.serviceUnavailable(.init(debugDescription: "The process is missing the required entitlement")))
    XCTAssertEqual(entitlement["code"] as? String, "PRIVATE_CLOUD_COMPUTE_UNAVAILABLE")
    XCTAssertEqual((entitlement["details"] as? [String: Any])?["reason"] as? String, "ENTITLEMENT_REQUIRED")

    let resetDate = Date(timeIntervalSince1970: 1_800_000_000)
    let quota = FMErrorMapper.map(PCCError.quotaLimitReached(.init(resetDate: resetDate, debugDescription: "Over quota")))
    XCTAssertEqual(quota["code"] as? String, "QUOTA_LIMIT_REACHED")
    let details = quota["details"] as? [String: Any]
    XCTAssertEqual(details?["resetDate"] as? String, ISO8601DateFormatter().string(from: resetDate))
    XCTAssertEqual(details?["canRequestLimitIncrease"] as? Bool, false)
  }
  #endif
}
#endif
