// Metro config for developing the library inside this example app.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const root = path.resolve(__dirname, '..');
const config = getDefaultConfig(__dirname);

config.watchFolders = [root];

// Make sure only one copy of react / react-native is bundled.
config.resolver.blockList = [
  ...Array.from(config.resolver.blockList ?? []),
  new RegExp(path.resolve(root, 'node_modules', 'react').replace(/[/\\]/g, '[/\\\\]') + '[/\\\\].*'),
  new RegExp(path.resolve(root, 'node_modules', 'react-native').replace(/[/\\]/g, '[/\\\\]') + '[/\\\\].*'),
  new RegExp(path.resolve(root, 'node_modules', 'expo').replace(/[/\\]/g, '[/\\\\]') + '[/\\\\].*'),
];
config.resolver.nodeModulesPaths = [path.resolve(__dirname, 'node_modules'), path.resolve(root, 'node_modules')];
config.resolver.extraNodeModules = {
  '@fourlyn/apple-foundation-models': root,
};

module.exports = config;
