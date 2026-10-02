import Foundation
#if canImport(FoundationModels)
import FoundationModels
#endif

/// Routes `historyTransform` callbacks from Swift to JavaScript.
///
/// Apple's `DynamicProfile.historyTransform` closure is synchronous, so the calling thread
/// is blocked (bounded by a timeout) while JavaScript decides which entries to keep.
/// JavaScript answers through the synchronous `resolveHistoryTransform` function.
final class FMHistoryTransformBroker: @unchecked Sendable {
  /// How long a JavaScript `historyTransform` may take before the native strategy result is used instead.
  static let defaultTimeout: TimeInterval = 2

  private static let javaScriptThreadKey = "com.fourlyn.foundation-models.js-thread"

  private final class Pending {
    let semaphore = DispatchSemaphore(value: 0)
    var ids: [String]?
  }

  private let lock = NSLock()
  private var pending: [String: Pending] = [:]

  /// Sends the `onHistoryTransform` event to JavaScript. Set by the module.
  var emit: (([String: Any]) -> Void)?

  /// Marks the current thread as the JavaScript thread. Waiting for JavaScript on that
  /// thread could never succeed, so `request` returns immediately there.
  static func markJavaScriptThread() {
    Thread.current.threadDictionary[javaScriptThreadKey] = true
  }

  static var isOnJavaScriptThread: Bool {
    Thread.current.threadDictionary[javaScriptThreadKey] as? Bool == true
  }

  /// Asks JavaScript which entries to keep. Returns the kept entry IDs, or `nil` when
  /// JavaScript did not answer in time, its callback threw, or the call cannot be made.
  func request(sessionId: String, profile: String, entries: [[String: Any]], timeout: TimeInterval = defaultTimeout) -> [String]? {
    guard let emit, !Self.isOnJavaScriptThread else { return nil }
    let id = UUID().uuidString
    let item = Pending()
    lock.lock(); pending[id] = item; lock.unlock()
    emit(["sessionId": sessionId, "transformId": id, "profile": profile, "entries": entries])
    _ = item.semaphore.wait(timeout: .now() + timeout)
    lock.lock()
    pending.removeValue(forKey: id)
    let ids = item.ids
    lock.unlock()
    return ids
  }

  /// Returns `false` if the transform ID is unknown (already answered or timed out).
  @discardableResult
  func resolve(id: String, idsJSON: String?) -> Bool {
    lock.lock()
    let item = pending[id]
    if let item, let idsJSON, let ids = (try? FMJSON.parse(idsJSON)) as? [String] {
      item.ids = ids
    }
    lock.unlock()
    guard let item else { return false }
    item.semaphore.signal()
    return true
  }

  func cancelAll() {
    lock.lock()
    let all = pending.values
    lock.unlock()
    all.forEach { $0.semaphore.signal() }
  }
}

#if canImport(FoundationModels)
@available(iOS 26.0, *)
enum FMHistorySelection {
  /// Applies a JavaScript selection: keeps the entries whose IDs were returned, in their original order.
  /// Instructions and the in-flight turn (the latest prompt and everything after it) are always kept,
  /// so the model always receives a transcript it can answer.
  static func select(_ entries: [Transcript.Entry], keeping ids: [String]) -> [Transcript.Entry] {
    let keep = Set(ids)
    let currentTurnStart = entries.lastIndex(where: {
      if case .prompt = $0 { return true }
      return false
    }) ?? entries.count
    var instructions: [Transcript.Entry] = []
    var rest: [Transcript.Entry] = []
    for (index, entry) in entries.enumerated() {
      if case .instructions = entry {
        instructions.append(entry)
      } else if index >= currentTurnStart || keep.contains(entry.id) {
        rest.append(entry)
      }
    }
    // Never start the window with a tool output whose call was dropped.
    while let first = rest.first, case .toolOutput = first { rest.removeFirst() }
    return instructions + rest
  }
}
#endif
