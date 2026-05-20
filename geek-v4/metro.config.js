const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');
const path = require('path');

const config = getDefaultConfig(__dirname);

// ============================================================
// Path alias for "@/*" → "./*" — Metro レベルで明示的に解決させる
// ============================================================
// 理由: Expo SDK 52 + Netlify CI 環境では babel-preset-expo の tsconfigPaths や
// babel-plugin-module-resolver だけでは Metro が @/foo を解決できないケースが
// 確認されたため、Metro の resolver 自体に直接 alias を渡す。
//
// resolver.resolveRequest フックで "@/" プレフィックスを repo root への
// 絶対パスに書き換える。babel 側の解決と二重化されてるが衝突しない。
// ============================================================
const projectRoot = __dirname;
const originalResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.startsWith('@/')) {
    const rewritten = path.join(projectRoot, moduleName.slice(2));
    return context.resolveRequest(context, rewritten, platform);
  }
  if (typeof originalResolveRequest === 'function') {
    return originalResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = withNativeWind(config, { input: './global.css' });
