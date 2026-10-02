// swift-tools-version: 6.0
//
// Used only to run the native unit tests in `ios/Tests`:
//
//   xcodebuild test -scheme AppleFoundationModelsBridge-Package -destination 'platform=iOS Simulator,name=<simulator>'
//
// The library itself ships through CocoaPods (`ios/AppleFoundationModels.podspec`).
// The two files that depend on ExpoModulesCore are left out so the bridge logic builds on its own.
import PackageDescription

let package = Package(
  name: "AppleFoundationModelsBridge",
  platforms: [.iOS("16.4")],
  targets: [
    .target(
      name: "AppleFoundationModelsBridge",
      path: "ios",
      exclude: [
        "AppleFoundationModelsModule.swift",
        "FMSession.swift",
        "AppleFoundationModels.podspec",
        "Tests",
      ],
      swiftSettings: [.swiftLanguageMode(.v5)]
    ),
    .testTarget(
      name: "AppleFoundationModelsBridgeTests",
      dependencies: ["AppleFoundationModelsBridge"],
      path: "ios/Tests",
      swiftSettings: [.swiftLanguageMode(.v5)]
    ),
  ]
)
