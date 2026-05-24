module.exports = function (api) {
  api.cache(true);
  const isProduction = process.env.NODE_ENV === 'production';

  // ============================================================
  // defensive plugin loader
  // ============================================================
  // Netlify 等の CI 環境で NODE_ENV=production + npm の挙動の組み合わせで
  // babel-plugin-transform-remove-console が install されない事故が稀に起きる。
  // resolve できなければ silently skip — プラグイン無くても最終バンドルは
  // 動く (console.log が残るだけ、bundle size 微増のみ)。
  let hasRemoveConsole = false;
  try {
    require.resolve('babel-plugin-transform-remove-console');
    hasRemoveConsole = true;
  } catch {
    // not installed — silently skip
  }

  return {
    presets: [
      ['babel-preset-expo', { jsxImportSource: 'nativewind' }],
      'nativewind/babel',
    ],
    plugins: [
      // production build では console.log を除去してバンドルサイズ縮小。
      // console.error / console.warn は残す (Sentry breadcrumb との整合)。
      // ★ reanimated より前に置く (削除されたコードがそのまま reanimated plugin
      //   を通れば worklet 化対象が減り解析コストも下がる)。
      ...(isProduction && hasRemoveConsole
        ? [['transform-remove-console', { exclude: ['error', 'warn'] }]]
        : []),
      // ★ react-native-reanimated/plugin は必ず最後
      'react-native-reanimated/plugin',
    ],
  };
};
