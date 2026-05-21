const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const geekV4 = path.resolve(projectRoot, '../geek-v4');

const config = getDefaultConfig(projectRoot);

// Watch geek-v4 so any edit to admin screens / shared stores hot-reloads here too.
config.watchFolders = [geekV4];

// @opentelemetry/api stub (supabase optional dep we never use).
config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules || {}),
  '@opentelemetry/api': path.resolve(projectRoot, 'stubs/opentelemetry-api.js'),
};

module.exports = config;
