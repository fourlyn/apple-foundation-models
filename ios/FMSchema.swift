import Foundation
#if canImport(FoundationModels)
import FoundationModels

/// Converts a JSON Schema (as normalized by `src/schema/normalize.ts`) into Apple's
/// `GenerationSchema` via `DynamicGenerationSchema`.
///
/// Supported keywords: `type` (object, array, string, integer, number, boolean, null),
/// `properties`, `required`, `items`, `minItems`, `maxItems`, `enum`, `const`, `pattern`,
/// `minimum`, `maximum`, `anyOf` / `oneOf`, `$ref` to `$defs` / `definitions`,
/// `title`, `description`, and nullable types (`["string", "null"]`).
///
/// JSON object key order is lost when parsed natively, so the JS layer adds
/// `x-fourlyn-order` (the declared property order) to every object schema.
/// Models generate properties in declaration order, so this matters for quality.
@available(iOS 26.0, *)
struct FMSchemaConverter {
  private var dependencies: [DynamicGenerationSchema] = []
  private var usedNames: Set<String> = []
  private var definitions: [String: [String: Any]] = [:]

  static func generationSchema(fromJSON json: String, defaultName: String = "Response") throws -> GenerationSchema {
    let object = try FMJSON.parseObject(json)
    return try generationSchema(from: object, defaultName: defaultName)
  }

  static func generationSchema(from schema: [String: Any], defaultName: String = "Response") throws -> GenerationSchema {
    var converter = FMSchemaConverter()
    return try converter.convertRoot(schema, defaultName: defaultName)
  }

  private mutating func convertRoot(_ schema: [String: Any], defaultName: String) throws -> GenerationSchema {
    let defs = (schema.object("$defs") ?? [:]).merging(schema.object("definitions") ?? [:]) { first, _ in first }
    for (name, value) in defs {
      guard let value = value as? [String: Any] else { continue }
      definitions[name] = value
    }
    // Definitions become named dependencies that can be referenced with `$ref`.
    for name in definitions.keys.sorted() {
      usedNames.insert(name)
    }
    for name in definitions.keys.sorted() {
      let converted = try convert(definitions[name]!, suggestedName: name, isNamedDefinition: true)
      dependencies.append(converted)
    }

    let rootName = uniqueName(schema.string("title") ?? defaultName)
    let root = try convert(schema, suggestedName: rootName, isNamedDefinition: true)
    return try GenerationSchema(root: root, dependencies: dependencies)
  }

  private mutating func uniqueName(_ base: String) -> String {
    let cleaned = base.isEmpty ? "Object" : base
    var candidate = cleaned
    var index = 2
    while usedNames.contains(candidate) {
      candidate = "\(cleaned)\(index)"
      index += 1
    }
    usedNames.insert(candidate)
    return candidate
  }

  /// Returns the type list of a schema, e.g. `["string", "null"]` -> `["string", "null"]`.
  private func types(of schema: [String: Any]) -> [String] {
    if let type = schema.string("type") { return [type] }
    if let types = schema["type"] as? [String] { return types }
    return []
  }

  /// Whether the schema allows `null` (used to mark properties optional).
  static func isNullable(_ schema: [String: Any]) -> Bool {
    if let types = schema["type"] as? [String], types.contains("null") { return true }
    for key in ["anyOf", "oneOf"] {
      if let choices = schema[key] as? [[String: Any]],
         choices.contains(where: { $0.string("type") == "null" }) {
        return true
      }
    }
    return false
  }

  private mutating func convert(_ schema: [String: Any], suggestedName: String, isNamedDefinition: Bool = false) throws -> DynamicGenerationSchema {
    let description = schema.string("description")

    if let ref = schema.string("$ref") {
      let name = ref.components(separatedBy: "/").last ?? ref
      guard definitions[name] != nil else {
        throw FMBridgeError(code: "INVALID_SCHEMA", message: "Unresolvable $ref '\(ref)'. Only local refs to $defs/definitions are supported.")
      }
      return DynamicGenerationSchema(referenceTo: name)
    }

    if let values = schema["enum"] as? [Any] {
      let strings = values.compactMap { $0 as? String }
      guard strings.count == values.count, !strings.isEmpty else {
        throw FMBridgeError(code: "INVALID_SCHEMA", message: "Only non-empty string enums are supported (at '\(suggestedName)').")
      }
      let name = isNamedDefinition ? suggestedName : uniqueName(suggestedName)
      return DynamicGenerationSchema(name: name, description: description, anyOf: strings)
    }

    if let constant = schema["const"] {
      guard let string = constant as? String else {
        throw FMBridgeError(code: "INVALID_SCHEMA", message: "Only string `const` values are supported (at '\(suggestedName)').")
      }
      let name = isNamedDefinition ? suggestedName : uniqueName(suggestedName)
      return DynamicGenerationSchema(name: name, description: description, anyOf: [string])
    }

    for key in ["anyOf", "oneOf"] {
      if let choices = schema[key] as? [[String: Any]] {
        let nonNull = choices.filter { $0.string("type") != "null" }
        if nonNull.count == 1 {
          var merged = nonNull[0]
          if merged["description"] == nil, let description { merged["description"] = description }
          return try convert(merged, suggestedName: suggestedName, isNamedDefinition: isNamedDefinition)
        }
        guard !nonNull.isEmpty else {
          throw FMBridgeError(code: "INVALID_SCHEMA", message: "`\(key)` must contain at least one non-null schema (at '\(suggestedName)').")
        }
        let name = isNamedDefinition ? suggestedName : uniqueName(suggestedName)
        var converted: [DynamicGenerationSchema] = []
        for (index, choice) in nonNull.enumerated() {
          converted.append(try convert(choice, suggestedName: choice.string("title") ?? "\(name)Option\(index + 1)"))
        }
        return DynamicGenerationSchema(name: name, description: description, anyOf: converted)
      }
    }

    let typeList = types(of: schema).filter { $0 != "null" }
    let type: String
    if let first = typeList.first {
      type = first
    } else if schema["properties"] != nil {
      type = "object"
    } else if schema["items"] != nil {
      type = "array"
    } else if types(of: schema) == ["null"] {
      type = "null"
    } else {
      throw FMBridgeError(code: "INVALID_SCHEMA", message: "Schema at '\(suggestedName)' has no supported `type`.")
    }

    switch type {
    case "object":
      let name = isNamedDefinition ? suggestedName : uniqueName(schema.string("title") ?? suggestedName)
      let properties = schema.object("properties") ?? [:]
      let required = Set((schema["required"] as? [String]) ?? [])
      let declaredOrder = (schema["x-fourlyn-order"] as? [String]) ?? []
      let order = declaredOrder.filter { properties[$0] != nil } + properties.keys.sorted().filter { !declaredOrder.contains($0) }
      var converted: [DynamicGenerationSchema.Property] = []
      for key in order {
        guard let propertySchema = properties[key] as? [String: Any] else { continue }
        let child = try convert(propertySchema, suggestedName: "\(name)_\(key)")
        converted.append(DynamicGenerationSchema.Property(
          name: key,
          description: propertySchema.string("description"),
          schema: child,
          isOptional: !required.contains(key) || FMSchemaConverter.isNullable(propertySchema)
        ))
      }
      return DynamicGenerationSchema(name: name, description: description, properties: converted)

    case "array":
      let itemSchema = schema.object("items") ?? ["type": "string"]
      let items = try convert(itemSchema, suggestedName: "\(suggestedName)Item")
      return DynamicGenerationSchema(arrayOf: items, minimumElements: schema.int("minItems"), maximumElements: schema.int("maxItems"))

    case "string":
      var guides: [GenerationGuide<String>] = []
      if let pattern = schema.string("pattern") {
        do {
          let regex = try Regex(pattern)
          guides.append(.pattern(regex))
        } catch {
          throw FMBridgeError(code: "INVALID_SCHEMA", message: "Invalid `pattern` regex at '\(suggestedName)': \(error.localizedDescription)")
        }
      }
      return DynamicGenerationSchema(type: String.self, guides: guides)

    case "integer":
      var guides: [GenerationGuide<Int>] = []
      let minimum = schema.int("minimum")
      let maximum = schema.int("maximum")
      if let minimum, let maximum {
        guides.append(.range(minimum...maximum))
      } else if let minimum {
        guides.append(.minimum(minimum))
      } else if let maximum {
        guides.append(.maximum(maximum))
      }
      return DynamicGenerationSchema(type: Int.self, guides: guides)

    case "number":
      var guides: [GenerationGuide<Double>] = []
      let minimum = schema.double("minimum")
      let maximum = schema.double("maximum")
      if let minimum, let maximum {
        guides.append(.range(minimum...maximum))
      } else if let minimum {
        guides.append(.minimum(minimum))
      } else if let maximum {
        guides.append(.maximum(maximum))
      }
      return DynamicGenerationSchema(type: Double.self, guides: guides)

    case "boolean":
      return DynamicGenerationSchema(type: Bool.self)

    case "null":
      #if compiler(>=6.3)
      if #available(iOS 26.4, *) {
        return DynamicGenerationSchema.null
      }
      #endif
      throw FMBridgeError(code: "INVALID_SCHEMA", message: "A standalone `null` type requires iOS 26.4 or later.")

    default:
      throw FMBridgeError(code: "INVALID_SCHEMA", message: "Unsupported JSON Schema type '\(type)' at '\(suggestedName)'.")
    }
  }
}
#endif
