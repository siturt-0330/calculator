# Upgrade Notes (Expo 52 → 56)

## 現状 (2026-05-22)

`npm audit` で 27 件の脆弱性 (High 6 / Moderate 21 / Critical 0)。
`npm audit fix --legacy-peer-deps` 適用後、26 件 (High 6 / Moderate 20) に減少。

**残る 26 件はすべて Expo SDK 52 → 56 のメジャーアップグレードが必要**。
ピンポイント修正だと peer dep 不整合で破綻するため、まとめてやる必要がある。

実際の `@expo/cli` / `tar` / `cacache` / `@expo/config` は Expo の内部ツールチェイン
(build / prebuild) に閉じており、**実行時に投入される攻撃ベクタは無い**。
ビルドパイプライン (CI) の信頼境界内のみで動く。とはいえ CI が悪意ある input を
受け取るリスク (例: PR の untrusted な build) はあるため、優先度は中。

## 主な脆弱性

| パッケージ | 深刻度 | 脆弱性概要 | 解決バージョン |
|---|---|---|---|
| `@xmldom/xmldom` | High | XML injection (CVSS 7.5, GHSA-wh4c-j3r5-mjhp) | ✅ 互換修正済 |
| `@expo/cli` | High | tar / cacache 経由の path traversal | expo@56 |
| `@expo/plist` | High | xml parser 経由 (CVSS 7.5) | ✅ 互換修正済 |
| `cacache` | High | path traversal | expo@56 |
| `tar` | High | path traversal | expo@56 |
| `@expo/config-plugins` | Moderate | xml parser 経由 | expo@56 |
| `@expo/metro-config` | Moderate | postcss ReDoS | expo@56 |
| `ajv` | Moderate | プロトタイプ汚染 | expo-dev-client@56 |
| `expo-notifications` | Moderate | 上流 deps | expo-notifications@56 |
| `xcode` | Moderate | uuid 旧版 | expo@56 |

完全リスト: `npm audit` を参照。

## Expo 56 アップグレード手順 (推奨フロー)

> Expo 52 → 53 → 54 → 55 → 56 を一気に飛ばすので破壊的変更は多い。
> 必ず別ブランチで作業し、段階的に動作確認すること。

### 1. ブランチ作成 + バックアップ

```bash
git checkout -b upgrade/expo-56
git tag pre-expo-56-upgrade
```

### 2. Expo CLI でメジャー更新

```bash
cd geek-v4
npx expo install expo@~56.0.0 --fix
npx expo install --check       # peer dep の整合性確認 → 推奨バージョン表示
npx expo install --fix         # 表示された推奨バージョンに合わせる
```

`--fix` で以下の主要パッケージが揃って上がる:
- `expo-router` 4 → 5 (URL/segments の API 変更あり)
- `expo-notifications` 0.29 → 0.30 (token 取得 API 変更)
- `expo-dev-client` 5 → 6
- `expo-splash-screen` 0.29 → 0.30 (preventAutoHideAsync の戻り値型変更)
- `expo-image` 2 → 3 (一部 prop 名変更)
- `react-native` 0.76 → 0.79 (新アーキテクチャ既定 on)
- `react` 18 → 19 (新 hooks 利用可、互換性は概ね OK)

### 3. 主な破壊的変更チェックリスト

- [ ] **expo-router 4 → 5**
  - `useGlobalSearchParams` の戻り値型が strict に。`as never` キャストを `as string` に修正
  - `<Stack.Screen>` の `options` で deprecate された prop を確認
- [ ] **React 19**
  - `useEffect` の cleanup タイミング微変更 (StrictMode で 2 回マウントが既定)
  - `useFormStatus` 等の新 API が React Native でも使える
- [ ] **React Native 0.79**
  - 新アーキテクチャ (Fabric + TurboModules) が default → 一部 native module が動かない可能性
    - `react-native-maps`, `react-native-mmkv`, `@gorhom/bottom-sheet` の最新版を要確認
  - `Animated.Value` の型が strict 化
- [ ] **expo-notifications 0.30**
  - `getDevicePushTokenAsync` の戻り値が `{ data: string }` から直接 `string` に
  - VAPID 鍵の渡し方が変更
- [ ] **Reanimated 3 → 4** (新アーキ対応版)
  - worklet の strict-mode が有効になる場合あり

### 4. 動作確認

```bash
npm run type-check
npm run lint
npm test
npm run web    # Web で起動して主要画面を巡回
npm run ios    # iOS でビルド & 起動
npm run android
```

特に確認すべき画面:
- ログイン / サインアップ (パスワードリセット含む)
- フィード (FlashList の挙動)
- 投稿作成 (画像ピッカー、画像クロップ)
- マップ (Leaflet + react-native-maps)
- BBS スレッド詳細 (Reanimated アニメーション)
- 通知 (push token 取得)

### 5. EAS Build で実機ビルド検証

```bash
eas build --profile preview --platform ios
eas build --profile preview --platform android
```

internal distribution で TestFlight / Firebase App Distribution に流して
社内テスター数名で 1 週間程度 dogfood。

### 6. ロールバック計画

```bash
git checkout master
eas update --branch production --message "Rollback Expo 56 upgrade"
```

OTA で旧バンドルに戻す。それでも不具合が残る場合は前バージョン APK/IPA を
ストア配信に戻す (これは時間がかかるため最終手段)。

## 互換修正済の差分

`npm audit fix --legacy-peer-deps` で適用した変更:
- `package-lock.json` のみが更新される (`package.json` は変更されない)
- 互換性のある patch / minor バージョンだけが選ばれる

## 今すぐやるべきこと vs 後回しでよいこと

**今すぐ:**
- [x] 互換修正 (`npm audit fix`) — 既に適用済
- [ ] Supabase ダッシュボードでパスワードポリシーを Letters + Digits に
- [ ] CI に `npm audit --audit-level=high` を追加 (新規 High 脆弱性で fail)

**Q3 中:**
- [ ] expo@56 アップグレード作業 (見積もり: 集中作業で 3〜5 日 + テスト 1 週間)

**長期的に検討:**
- [ ] Sentry / PostHog SDK のバージョン更新
- [ ] React Compiler (React 19 の新機能) の導入
