module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      ['babel-preset-expo', { jsxImportSource: 'nativewind' }],
      'nativewind/babel',
    ],
    plugins: [
      // ★ react-native-reanimated/plugin は必ず最後
      'react-native-reanimated/plugin',
    ],
  };
};
