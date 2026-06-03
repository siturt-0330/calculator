// ============================================================
// lucide-react-native tree-shake (production bundle のみ)
// ------------------------------------------------------------
// Metro は default config で barrel を tree-shake しないため、全 import の
//   import { Foo } from 'lucide-react-native'
// を per-icon deep import
//   import Foo from 'lucide-react-native/dist/esm/icons/<kebab>'
// に書き換え、未使用 ~1460 icon を bundle から落とす (web entry を大幅縮小)。
// 旧名 (Home/AlertTriangle/CheckCircle2 等) は alias で個別ファイルが無いので
// canonical 名へ map する (2026-06-03 全件 dist 実在を確認済)。
// ※ production (expo export / EAS build) のみ適用。dev/test は無変換 (ゲート安全)。
// ============================================================
const LUCIDE_ALIAS = {
  Home: 'house',
  HelpCircle: 'circle-help',
  AlertTriangle: 'triangle-alert',
  CheckCircle2: 'circle-check-big',
  XCircle: 'circle-x',
  MoreHorizontal: 'ellipsis',
  Edit3: 'pen-line',
  Globe2: 'earth',
  Users2: 'users-round',
  UserPlus2: 'user-round-plus',
  BarChart3: 'chart-column',
};
function lucideKebab(name) {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([a-zA-Z])([0-9])/g, '$1-$2')
    .toLowerCase();
}
function lucideDeepImportsPlugin({ types: t }) {
  return {
    name: 'lucide-deep-imports',
    visitor: {
      ImportDeclaration(path) {
        const node = path.node;
        if (node.source.value !== 'lucide-react-native') return;
        if (node.importKind === 'type') return; // `import type {...}` は型のみ → 触らない
        const deep = [];
        const keep = [];
        for (const spec of node.specifiers) {
          if (
            t.isImportSpecifier(spec) &&
            spec.importKind !== 'type' &&
            t.isIdentifier(spec.imported)
          ) {
            const file = LUCIDE_ALIAS[spec.imported.name] || lucideKebab(spec.imported.name);
            deep.push(
              t.importDeclaration(
                [t.importDefaultSpecifier(t.identifier(spec.local.name))],
                t.stringLiteral('lucide-react-native/dist/esm/icons/' + file),
              ),
            );
          } else {
            keep.push(spec); // type-only / default / namespace は barrel に残す
          }
        }
        if (deep.length === 0) return;
        const out = [];
        if (keep.length > 0) {
          out.push(t.importDeclaration(keep, t.stringLiteral('lucide-react-native')));
        }
        out.push(...deep);
        path.replaceWithMultiple(out);
      },
    },
  };
}

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
      // lucide barrel → per-icon deep import (production bundle のみ / reanimated より前)
      ...(isProduction ? [lucideDeepImportsPlugin] : []),
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
