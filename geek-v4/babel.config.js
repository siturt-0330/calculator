module.exports = function (api) {
  // ============================================================
  // cache strategy
  // ============================================================
  // Babel config 自体は NODE_ENV 以外の env 変数に依存しないので、
  // NODE_ENV をキーにしてキャッシュする (api.cache(true) だと
  // dev → prod 切替時に古い変換が残る、毎回 false だと cold start が遅い)。
  api.cache.using(() => process.env.NODE_ENV);

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

  const isProduction = process.env.NODE_ENV === 'production';

  return {
    presets: [
      ['babel-preset-expo', { jsxImportSource: 'nativewind' }],
      'nativewind/babel',
    ],
    // ============================================================
    // plugin order
    // ============================================================
    // - transform-remove-console は production のみ (dev はそもそも plugin を
    //   evaluation しない → Metro cold start が速い)
    //   console.error / console.warn は残す (Sentry breadcrumb との整合)
    // - ★ react-native-reanimated/plugin は必ず最後 (worklet 解析が他 plugin 後の
    //   AST を見る必要があるため、env block ではなく top-level で末尾固定)
    plugins: [
      ...(isProduction && hasRemoveConsole
        ? [['transform-remove-console', { exclude: ['error', 'warn'] }]]
        : []),
      'react-native-reanimated/plugin',
    ],
    // ============================================================
    // overrides — production-only transforms をここに追加可能
    // ============================================================
    // 現状は transform-remove-console を上の inline ternary で扱っているので
    // overrides は空。今後 prod 専用の追加変換 (例: source map strip 等) が
    // 出てきたらここに集約する。
    overrides: [],
  };
};
