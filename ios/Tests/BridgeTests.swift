import XCTest
@testable import AppleFoundationModelsBridge

/// Bridge logic that needs no Apple model: parsing, error mapping and the JS brokers.
final class BridgeTests: XCTestCase {
  // MARK: - Errors

  func testBridgeErrorsKeepCodeAndDetails() {
    let mapped = FMErrorMapper.map(FMBridgeError.unsupportedOS("Dynamic profiles", minimum: "27.0"))
    XCTAssertEqual(mapped["code"] as? String, "UNSUPPORTED_OS_VERSION")
    XCTAssertEqual((mapped["details"] as? [String: Any])?["reason"] as? String, "OS_VERSION")
    XCTAssertEqual((mapped["details"] as? [String: Any])?["minimumOS"] as? String, "27.0")
  }

  func testSDKTooOldIsReportedSeparatelyFromOSTooOld() {
    let mapped = FMErrorMapper.map(FMBridgeError.unsupportedSDK("Private Cloud Compute", sdk: "iOS 27"))
    XCTAssertEqual(mapped["code"] as? String, "UNSUPPORTED_OS_VERSION")
    XCTAssertEqual((mapped["details"] as? [String: Any])?["reason"] as? String, "SDK_VERSION")
  }

  func testCancellationMapsToCancelled() {
    XCTAssertEqual(FMErrorMapper.map(CancellationError())["code"] as? String, "CANCELLED")
  }

  func testToolFailureCarriesToolName() {
    let mapped = FMErrorMapper.map(FMToolExecutionError(toolName: "lookup", message: "database offline"))
    XCTAssertEqual(mapped["code"] as? String, "TOOL_CALL_FAILED")
    XCTAssertEqual((mapped["details"] as? [String: Any])?["toolName"] as? String, "lookup")
  }

  func testUnknownErrorsKeepDomainAndCode() {
    let mapped = FMErrorMapper.map(NSError(domain: "com.example", code: 42, userInfo: [NSLocalizedDescriptionKey: "boom"]))
    XCTAssertEqual(mapped["code"] as? String, "UNKNOWN")
    let details = mapped["details"] as? [String: Any]
    XCTAssertEqual(details?["domain"] as? String, "com.example")
    XCTAssertEqual(details?["nativeCode"] as? Int, 42)
  }

  func testMissingAssetsMapToModelNotReady() {
    let mapped = FMErrorMapper.map(NSError(domain: "com.apple.ModelManagerServices", code: 1))
    XCTAssertEqual(mapped["code"] as? String, "MODEL_NOT_READY")
  }

  func testEntitlementTextIsRecognised() {
    XCTAssertTrue(FMErrorMapper.mentionsEntitlement("The app is missing the required Entitlement."))
    XCTAssertTrue(FMErrorMapper.mentionsEntitlement("ok", "client is not entitled"))
    XCTAssertFalse(FMErrorMapper.mentionsEntitlement("The service is temporarily unavailable."))
  }

  func testErrorMentioningEntitlementMapsToEntitlementRequired() {
    let error = NSError(domain: "com.example", code: 7, userInfo: [NSLocalizedDescriptionKey: "Missing entitlement for Private Cloud Compute."])
    let mapped = FMErrorMapper.map(error)
    XCTAssertEqual(mapped["code"] as? String, "ENTITLEMENT_REQUIRED")
    XCTAssertEqual((mapped["details"] as? [String: Any])?["reason"] as? String, "ENTITLEMENT_REQUIRED")
  }

  // MARK: - Model selectors

  func testModelSpecDefaultsToSystem() throws {
    let spec = try FMModelSpec.parse(nil)
    XCTAssertEqual(spec.kind, .system)
    XCTAssertEqual(spec.useCase, "general")
    XCTAssertEqual(spec.guardrails, "default")
  }

  func testModelSpecParsesStringsAndObjects() throws {
    XCTAssertEqual(try FMModelSpec.parse("auto").kind, .auto)
    XCTAssertEqual(try FMModelSpec.parse("privateCloudCompute").kind, .privateCloudCompute)
    let spec = try FMModelSpec.parse(["type": "system", "useCase": "contentTagging", "guardrails": "permissiveContentTransformations"])
    XCTAssertEqual(spec.useCase, "contentTagging")
    XCTAssertEqual(spec.guardrails, "permissiveContentTransformations")
  }

  func testModelSpecRejectsUnknownModels() {
    XCTAssertThrowsError(try FMModelSpec.parse("gpt")) { error in
      XCTAssertEqual((error as? FMBridgeError)?.code, "INVALID_ARGUMENT")
    }
    XCTAssertThrowsError(try FMModelSpec.parse(42))
  }

  // MARK: - Tools

  func testToolDescriptorParsesJavaScriptAndNativeTools() throws {
    let js = try FMToolDescriptor.parse(["name": "getWeather", "description": "Weather", "parameters": ["type": "object"]])
    XCTAssertEqual(js.name, "getWeather")
    guard case .javascript(_, let includesSchema) = js.kind else { return XCTFail("expected a JavaScript tool") }
    XCTAssertTrue(includesSchema)

    let native = try FMToolDescriptor.parse(["nativeTool": "vision.ocr"])
    guard case .native(let identifier) = native.kind else { return XCTFail("expected a native tool") }
    XCTAssertEqual(identifier, "vision.ocr")
    XCTAssertEqual(native.name, "vision.ocr")
  }

  func testToolDescriptorRequiresAName() {
    XCTAssertThrowsError(try FMToolDescriptor.parse(["description": "nameless"]))
    XCTAssertThrowsError(try FMToolDescriptor.parse("not an object"))
  }

  func testToolBrokerDeliversTheJavaScriptResult() async throws {
    let broker = FMToolCallBroker()
    broker.emit = { event in
      // JavaScript answers on another thread.
      DispatchQueue.global().async {
        broker.resolve(callId: event["callId"] as! String, result: FMToolResult(json: "\"sunny\"", errorMessage: nil))
      }
    }
    let result = try await broker.invoke(sessionId: "s", requestId: "r", toolName: "getWeather", argumentsJSON: "{}")
    XCTAssertEqual(result.json, "\"sunny\"")
    XCTAssertNil(result.errorMessage)
  }

  func testToolBrokerIgnoresUnknownCallIDs() {
    XCTAssertFalse(FMToolCallBroker().resolve(callId: "nope", result: FMToolResult(json: nil, errorMessage: nil)))
  }

  // MARK: - History transform broker

  func testHistoryBrokerReturnsTheIDsJavaScriptKept() {
    let broker = FMHistoryTransformBroker()
    broker.emit = { event in
      DispatchQueue.global().async {
        XCTAssertEqual(event["profile"] as? String, "chat")
        broker.resolve(id: event["transformId"] as! String, idsJSON: "[\"a\",\"c\"]")
      }
    }
    XCTAssertEqual(broker.request(sessionId: "s", profile: "chat", entries: [], timeout: 5), ["a", "c"])
  }

  func testHistoryBrokerFallsBackWhenJavaScriptDoesNotAnswer() {
    let broker = FMHistoryTransformBroker()
    broker.emit = { _ in }
    let start = Date()
    XCTAssertNil(broker.request(sessionId: "s", profile: "chat", entries: [], timeout: 0.2))
    XCTAssertLessThan(Date().timeIntervalSince(start), 2)
  }

  func testHistoryBrokerFallsBackWhenJavaScriptThrew() {
    let broker = FMHistoryTransformBroker()
    broker.emit = { event in
      DispatchQueue.global().async { broker.resolve(id: event["transformId"] as! String, idsJSON: nil) }
    }
    XCTAssertNil(broker.request(sessionId: "s", profile: "chat", entries: [], timeout: 5))
  }

  func testHistoryBrokerNeverWaitsOnTheJavaScriptThread() {
    let broker = FMHistoryTransformBroker()
    var emitted = false
    broker.emit = { _ in emitted = true }
    let finished = expectation(description: "returns without waiting")
    Thread.detachNewThread {
      FMHistoryTransformBroker.markJavaScriptThread()
      XCTAssertNil(broker.request(sessionId: "s", profile: "chat", entries: [], timeout: 30))
      finished.fulfill()
    }
    wait(for: [finished], timeout: 5)
    XCTAssertFalse(emitted)
  }

  func testHistoryBrokerIgnoresLateAnswers() {
    XCTAssertFalse(FMHistoryTransformBroker().resolve(id: "expired", idsJSON: "[]"))
  }

  // MARK: - JSON helpers

  func testJSONHelpers() throws {
    XCTAssertEqual(try FMJSON.parseObject("{\"a\":1}").int("a"), 1)
    XCTAssertThrowsError(try FMJSON.parseObject("[1]"))
    XCTAssertThrowsError(try FMJSON.parse("{nope"))
    XCTAssertEqual(FMJSON.stringify("text"), "\"text\"")
  }
}
