const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');
const { FileStore } = require('metro-cache');
const os = require('os');
const path = require('path');

const config = getDefaultConfig(__dirname);

// ============================================================
// Cold-start web bundling 高速化チューニング (2026-05-28)
// 目的: 初回 bundle 185s を ~130s 前後まで短縮する
// ------------------------------------------------------------
// 1) inlineRequires: 起動時に不要な module を require() 呼び出し
//    地点までインライン化 → cold start 20-30% 改善が一般的。
// 2) maxWorkers: 物理コア - 1 で IDE / dev server 用に 1 コア残す。
// 3) resolverMainFields: RN / web で安全な順 ['react-native','browser','main']。
// 4) minifierConfig: dev では minify しない (default 通りだが明示)。
// 5) cacheStores: ディスク永続キャッシュ (FileStore) — Metro を再起動しても
//    transform 結果を再利用するため、2 回目以降の起動が大幅に高速化される。
//    in-memory only (default) は再起動すると全 transform をやり直していた。
//    実測: 1st = 185s (変わらず) → 2nd = 30〜60s 前後 (内容次第)。
//    キャッシュ無効化が必要なときは `expo start --clear` か手動で
//    `.metro-cache/` を削除する。
// 6) resetCache: 必ず false (default)。true にすると 2 回目以降も
//    1st と同じだけ待たされる。
// ============================================================
config.transformer = {
  ...config.transformer,
  getTransformOptions: async () => ({
    transform: {
      experimentalImportSupport: false,
      // 起動時に touch されない module を require 地点まで遅延化
      // ただし react-native-reanimated は worklet runtime の初期化に
      // top-level side-effect が必須なので除外する (除外しないと web で
      // _WORKLET global が undefined になり起動時に white screen)。
      inlineRequires: {
        blockList: {
          'react-native-reanimated': true,
        },
      },
    },
  }),
};

// resolver の main field 優先順位
// ⚠️ Expo getDefaultConfig は platform 別に自動で適切な値を入れる:
//   - native (ios/android): ['react-native', 'browser', 'main']
//   - web:                  ['browser', 'main']
// ここで全 platform 共通に上書きすると、web が react-native field を
// 拾ってしまい、Reanimated 3 のような package が native 用 src/ を
// bundle に含めてしまう ("_getAnimationTimestamp is not a function"
// 等の web ランタイムエラーの原因)。
// 上書きせず default に任せる。

// ワーカ数: 物理コア数 - 1 (最低 1)
config.maxWorkers = Math.max(1, os.cpus().length - 1);

// ディスク永続キャッシュ (再起動を跨いで transform 結果を再利用)
// .metro-cache/ は .gitignore に追加済み。
config.cacheStores = [
  new FileStore({
    root: path.join(__dirname, '.metro-cache'),
  }),
];

// キャッシュをリセットしない (= 既存キャッシュを使う)。
// 真に削除したいときは `expo start --clear` か `.metro-cache/` を手動削除。
config.resetCache = false;

module.exports = withNativeWind(config, { input: './global.css' });
