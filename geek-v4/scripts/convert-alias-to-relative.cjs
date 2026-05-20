// ============================================================
// Codemod: 「@/foo」 形式の import を相対パスに変換
// ============================================================
// Netlify CI 環境で「@/」alias が Metro から解決できない問題が
// babel/tsconfig/metro いずれの手法でも回避できなかったため、
// import 文を物理的に相対パスに置換する最終手段。
//
// 実行: node scripts/convert-alias-to-relative.cjs
// ============================================================
const { readFileSync, writeFileSync } = require('fs');
const { relative, dirname, resolve } = require('path');
const { globSync } = require('glob');

const projectRoot = process.cwd();
const files = globSync(
  '{app,components,hooks,lib,stores,types,design,constants,assets}/**/*.{ts,tsx}',
  { cwd: projectRoot, absolute: true },
);

let totalReplacements = 0;
let filesChanged = 0;

function toRel(fromDir, targetAbs) {
  let r = relative(fromDir, targetAbs).split('\\').join('/');
  if (!r.startsWith('.')) r = './' + r;
  return r;
}

for (const file of files) {
  const src = readFileSync(file, 'utf8');
  const fileDir = dirname(file);
  let changed = src;

  // from '@/foo' / from "@/foo"
  changed = changed.replace(/(from\s*['"])@\/([^'"]+)(['"])/g, (m, pre, p, post) => {
    totalReplacements++;
    return pre + toRel(fileDir, resolve(projectRoot, p)) + post;
  });
  // import('@/foo')
  changed = changed.replace(/(import\s*\(\s*['"])@\/([^'"]+)(['"])/g, (m, pre, p, post) => {
    totalReplacements++;
    return pre + toRel(fileDir, resolve(projectRoot, p)) + post;
  });
  // require('@/foo')
  changed = changed.replace(/(require\s*\(\s*['"])@\/([^'"]+)(['"])/g, (m, pre, p, post) => {
    totalReplacements++;
    return pre + toRel(fileDir, resolve(projectRoot, p)) + post;
  });

  if (changed !== src) {
    writeFileSync(file, changed);
    filesChanged++;
  }
}

console.log('Files changed:', filesChanged);
console.log('Total replacements:', totalReplacements);
