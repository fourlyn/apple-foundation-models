// iOS 27 requires the UIScene life cycle. The Expo SDK 57 app template still starts
// React Native from the app delegate, so this plugin switches the example app to
// Expo's `ExpoAppSceneDelegate`. Not needed by the library itself.
const { withAppDelegate, withInfoPlist } = require('expo/config-plugins');

module.exports = function withSceneLifecycle(config) {
  config = withInfoPlist(config, (mod) => {
    mod.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          { UISceneConfigurationName: 'Default Configuration', UISceneDelegateClassName: 'EXExpoAppSceneDelegate' },
        ],
      },
    };
    return mod;
  });
  return withAppDelegate(config, (mod) => {
    let src = mod.modResults.contents;
    src = src.replace('class AppDelegate: ExpoAppDelegate {', 'class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {');
    src = src.replace(/#if os\(iOS\) \|\| os\(tvOS\)\s*window = UIWindow\(frame: UIScreen\.main\.bounds\)[\s\S]*?#endif\n/, '// React Native is started by ExpoAppSceneDelegate (see plugins/withSceneLifecycle.js).\n');
    mod.modResults.contents = src;
    return mod;
  });
};
