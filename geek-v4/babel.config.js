module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      // tsconfigPaths: true は Expo SDK 50+ の正式 path alias 解決手法だが、
      // Netlify CI 環境で稀に効かないケースが報告されているため、
      // 下の module-resolver plugin で belt-and-suspenders の二重化を行う。
      ['babel-preset-expo', { jsxImportSource: 'nativewind', tsconfigPaths: true }],
      'nativewind/babel',
    ],
    plugins: [
      // 「@」 を repo root にハードコードで alias 化。Metro / tsconfig 経路が
      // 何らかの理由で失敗しても、こちらが必ず先に解決する。
      [
        'module-resolver',
        {
          root: ['./'],
          extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
          alias: {
            '@': './',
          },
        },
      ],
      // ★ react-native-reanimated/plugin は必ず最後
      'react-native-reanimated/plugin',
    ],
  };
};
