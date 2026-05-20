module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      // tsconfigPaths: true で tsconfig.json の "paths" を Metro が解釈する
      // (Expo SDK 50+ で正式サポート。これを付けないと CI のクリーン環境で
      //  "@/design/tokens" 等の alias が Metro から解決できず build が失敗する。
      //  ローカルだと metro cache で偶然動いてしまうことがある)
      ['babel-preset-expo', { jsxImportSource: 'nativewind', tsconfigPaths: true }],
      'nativewind/babel',
    ],
    plugins: [
      // ★ 必ず最後
      'react-native-reanimated/plugin',
    ],
  };
};
