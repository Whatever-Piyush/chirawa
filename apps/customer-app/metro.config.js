const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Watch all workspace packages
config.watchFolders = [workspaceRoot];

// Resolve from project node_modules first, then workspace root
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// Disable package exports resolution — the workspace @chirawa/* packages have
// "exports" fields pointing to dist/ which doesn't exist. With this off, Metro
// falls back to the "main" field, which we point at TS source for those packages.
config.resolver.unstable_enablePackageExports = false;

module.exports = config;
