module.exports = function (api) {
  api.cache(true);
  const isProduction = process.env.NODE_ENV === 'production';
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
      ...(isProduction
        ? [['transform-remove-console', { exclude: ['error', 'warn'] }]]
        : []),
      // ★ react-native-reanimated/plugin は必ず最後
      'react-native-reanimated/plugin',
    ],
  };
};
