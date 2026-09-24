import { createRunOncePlugin, withEntitlementsPlist, type ConfigPlugin } from '@expo/config-plugins';

const pkg = require('../../package.json');

export type AppleFoundationModelsPluginProps = {
  /**
   * Entitlements to add to the iOS app, e.g. Apple's managed Private Cloud Compute entitlement.
   * Apple grants the PCC entitlement per team (https://developer.apple.com/private-cloud-compute/);
   * use the exact key and value from your approval / Xcode's Signing & Capabilities.
   *
   * ```json
   * ["@fourlyn/apple-foundation-models", { "entitlements": { "<key from Apple>": true } }]
   * ```
   */
  entitlements?: Record<string, boolean | string | string[]>;
};

/**
 * Config plugin for `@fourlyn/apple-foundation-models`.
 *
 * On-device Foundation Models need no configuration: this plugin is optional and only
 * adds entitlements you pass in (for Private Cloud Compute). It never invents entitlement keys.
 */
const withAppleFoundationModels: ConfigPlugin<AppleFoundationModelsPluginProps | void> = (config, props) => {
  const entitlements = props?.entitlements ?? {};
  if (Object.keys(entitlements).length === 0) return config;
  return withEntitlementsPlist(config, (mod) => {
    Object.assign(mod.modResults, entitlements);
    return mod;
  });
};

export default createRunOncePlugin(withAppleFoundationModels, pkg.name, pkg.version);
