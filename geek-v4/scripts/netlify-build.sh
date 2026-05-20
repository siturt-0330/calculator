#!/usr/bin/env bash
# Netlify build script — wrapped to handle complex shell logic outside the TOML.
# Prints debug info before the actual build so log shows exactly what state we're in.
set -e

echo "=== HEAD commit ==="
git rev-parse HEAD || true
echo
echo "=== Working tree commit message ==="
git log -1 --pretty=format:'%h %s' || true
echo
echo
echo "=== Auth layout file content ==="
cat 'app/(auth)/_layout.tsx' || echo "(file missing)"
echo
echo "=== Any remaining @/design imports in source? ==="
grep -rn "@/design" app components hooks lib stores design 2>/dev/null | head -5 || echo "(none)"
echo
echo "=== Babel config head ==="
head -20 babel.config.js || true
echo
echo "=== Metro config head ==="
head -30 metro.config.js || true
echo
echo "=== START BUILD ==="
npm ci --legacy-peer-deps
npx expo export --platform web --output-dir dist
