require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'AppleFoundationModels'
  s.version        = package['version']
  s.summary        = package['description']
  s.description    = package['description']
  s.license        = package['license']
  s.author         = package['author']
  s.homepage       = package['homepage']
  # The module can be installed in apps targeting older iOS versions.
  # Every Foundation Models call is guarded with `#available(iOS 26.0, *)`,
  # and the framework is weak-linked so the app still launches on iOS < 26.
  s.platforms      = {
    :ios => '16.4'
  }
  s.swift_version  = '5.10'
  s.source         = { git: 'https://github.com/fourlyn/apple-foundation-models.git', tag: "v#{s.version}" }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.weak_frameworks = 'FoundationModels'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift}"
end
