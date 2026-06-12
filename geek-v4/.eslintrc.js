module.exports = {
  root: true,
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react/recommended',
    'plugin:react-hooks/recommended',
    'plugin:react-native/all',
  ],
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint', 'react', 'react-hooks', 'react-native'],
  settings: { react: { version: 'detect' } },
  env: { 'react-native/react-native': true, es2022: true },
  rules: {
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    'react/prop-types': 'off',
    'react/react-in-jsx-scope': 'off',
    'react-hooks/exhaustive-deps': 'warn',
    'react-native/no-inline-styles': 'off',
    'react-native/no-color-literals': 'off',
    'react-native/sort-styles': 'off',
    // AppText / HeadingText は Text の wrapper (components/ui/) — 生テキストを許可
    'react-native/no-raw-text': ['error', { skip: ['AppText', 'HeadingText'] }],
    // Apple HIG: 可読テキストの最小サイズは 11pt。9-10pt の直書きを再発させない
    'no-restricted-syntax': [
      'warn',
      {
        selector:
          "Property[key.name='fontSize'] > Literal[value<11], Property[key.value='fontSize'] > Literal[value<11]",
        message: 'fontSize は 11pt 未満禁止 (Apple HIG)。T.caption (11pt) 以上を使ってください。',
      },
    ],
  },
  overrides: [
    {
      // テストの期待値・typography のトークン定義は fontSize リテラル検査の対象外
      files: ['tests/**/*', '**/*.test.ts', '**/*.test.tsx', 'design/typography.ts'],
      rules: { 'no-restricted-syntax': 'off' },
    },
  ],
  // netlify/ は Deno ランタイムの Edge Function (Deno global 等) なので RN 向け lint から除外
  ignorePatterns: ['node_modules', '.expo', 'ios', 'android', 'dist', 'netlify'],
};
