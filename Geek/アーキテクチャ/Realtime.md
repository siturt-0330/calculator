---
tags: [geek-v4, realtime, supabase, architecture, channel, hot-bug]
---

# Realtime

Geek (geek-v4) の Supabase Realtime ラッパの実態メモ。**過去 hot bug が最も頻発した領域**。
1 channel/1 table 分離・同時 channel 上限・dead channel 自動回収・ghost channel 統合まで、実コード基準で記録する。

> ⚠️ ドキュメント不整合 (要注意): `CLAUDE.md` §5.3 / §11 / §16 は同時 channel 上限を **20** と書いているが、
> 実コード `lib/realtime.ts` は既に **12** に絞られている (`MAX_CONCURRENT_CHANNELS = 12`)。
> このノートは**実コードの値 (12) が正**として書く。CLAUDE.md の 20 は古い。

関連: [[アーキテクチャ概要]] / [[データ層・Supabase・RLS・マイグレーション運用]] / [[State管理 (Zustand・React Query)]] / [[地雷・落とし穴 総覧]]

---

## 概要

- バックエンドは Supabase Realtime (Postgres logical replication → WebSocket)。`postgres_changes` イベントで `INSERT/UPDATE/DELETE/*` を購読する。
- **すべての subscription は `lib/realtime.ts` の `attachChannel(name, build, onStatus?)` を経由する**のがこの repo の鉄則。`supabase.channel(...).subscribe()` を component / hook から直に呼ばない。
  - 理由 1: 同名 channel を複数 component が subscribe しようとすると、Supabase Client は同名 channel を**再利用**するため 2 回目以降の `.on()` が「subscribe 後の追加は不可」で全滅する。`attachChannel` が channel 名で **refCount** を管理し、初回だけ実 subscribe、2 回目以降は既存 channel を共有する。
  - 理由 2: 同時 channel 数の上限管理 (`MAX_CONCURRENT_CHANNELS`) を 1 箇所に集約できる。直 subscribe すると上限集計から漏れる **ghost channel** になる (過去にこれが実際に起きた → 後述)。
- ライフサイクル監視: `attachChannel` の第 3 引数 `onStatus` で `SUBSCRIBED / CHANNEL_ERROR / TIMED_OUT / CLOSED` を観測できる。「realtime が来てない」の切り分けが桁違いに楽になるので、各 hook はほぼ必ず渡している。
- データ更新方式は 2 系統:
  - **invalidate 方式**: イベントを debounce してから React Query を invalidate (例: `useFeedRealtime` → `invalidateFeedPage`)。
  - **直 cache patch 方式**: イベントから cache に直接 prepend / 書き換え (例: `useUserChannel` の notifications INSERT は cache へ直 prepend で新着即時)。
- 詳しい React Query 連携は [[State管理 (Zustand・React Query)]]、cache patch helper は `lib/cacheUpdates/feedPagePatcher.ts` 参照。

---

## 仕組み・設計 (具体ファイルパス付き)

### 中核: `lib/realtime.ts`

単一の `Map<string, Entry>` で全 channel を管理する singleton。`Entry = { channel, refCount, lastAttachAt }`。

公開 API:

| 関数 | 役割 |
|---|---|
| `attachChannel(name, build, onStatus?)` | name で refCount。初回のみ `build(supabase.channel(name))` で `.on()` をチェーンし subscribe。戻り値は detacher (`() => void`)。 |
| `detachAllChannels()` | 全 channel を強制 detach (logout 時)。 |
| `gcStaleChannels(thresholdMs = 5分)` | 最終 attach から閾値以上経過した channel を `removeChannel` + Map 削除。戻り値=掃除数。 |
| `getChannelStats()` | `{ count, names, max }` を返す debug 用。dev tools / hook から現在の channel 状態を覗ける。 |

refCount の流れ:

```ts
// attach: 既存なら refCount++ して既存 channel を共有
const existing = channels.get(name);
if (existing) { existing.refCount++; existing.lastAttachAt = Date.now(); return () => detachChannel(name); }

// detach: refCount-- し、0 になったら removeChannel + Map から削除
function detachChannel(name) {
  const entry = channels.get(name);
  if (!entry) return;
  entry.refCount--;
  if (entry.refCount <= 0) { void supabase.removeChannel(entry.channel); channels.delete(name); }
}
```

### 同時 channel 上限 (`MAX_CONCURRENT_CHANNELS = 12`)

```ts
// lib/realtime.ts
// 20 は緩すぎた (10 user で Free tier 200 connection を食い潰す) ので 12 に絞る。
const MAX_CONCURRENT_CHANNELS = 12;
```

- DoS / connection pool 枯渇の防止。**Supabase Realtime の per-connection 上限より前にクライアント側で reject** する設計。
- 上限到達時は **例外を投げず** `console.warn` を出して **no-op detacher** を返す (subscribe しない):
  ```ts
  if (channels.size >= MAX_CONCURRENT_CHANNELS) {
    console.warn(`[realtime] channel limit reached (${MAX_CONCURRENT_CHANNELS}). Skipping subscription for "${name}".`);
    return () => {};
  }
  ```
- 副作用: 上限を超えると「その subscription だけ静かに無効化」される (silent degrade)。「特定の画面だけ realtime が来ない」を見たら `getChannelStats().count` が 12 に張り付いていないか疑う。

### Dead channel 自動回収 (2026-05 の重要対策)

`CHANNEL_ERROR / TIMED_OUT / CLOSED` を `DEAD_STATUSES` として扱い、subscribe の status callback 内で**同一 channel instance に限り** Map から除去 + `removeChannel`:

```ts
const DEAD_STATUSES = new Set(['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED']);
// status callback 内
if (DEAD_STATUSES.has(s)) {
  const current = channels.get(name);
  if (current && current.channel === ch) {      // 再 attach で別 channel に置換済みなら触らない
    console.warn('[realtime] auto-detach dead channel:', name, s);
    channels.delete(name);
    void supabase.removeChannel(ch);
  }
}
```

- なぜ必要か: 死んだ channel が refCount で Map に居続けると、別 component が同名 attach した時に **"dead channel" を再利用**してしまい「subscribe しない / event 来ない / server 側 connection は open のまま」になる。これを自動回収する。
- `onStatus` (ユーザー callback) は dead 判定より**先に**転送する。callback が例外を投げても auto-detach は止めない (`try/catch` で握る)。

### GC: `gcStaleChannels` / 全断: `detachAllChannels`

- `detachAllChannels()` は **logout で必須**。`stores/authStore.ts` が 2 箇所で呼ぶ (`auth.detach.hydrate` と signOut パス)。残すと前ユーザーの channel が次セッションに漏れる。
- `gcStaleChannels(thresholdMs)` は logout / app foreground 復帰時の掃除用。`lastAttachAt` が古い channel を一掃する。

### 消費側 hook の一覧 (すべて `attachChannel` 経由)

| hook / ファイル | channel name 例 | 購読テーブル |
|---|---|---|
| `hooks/useFeedRealtime.ts` | `feed-rt:<hash>` | `post_reactions`, `likes` (1 channel + 2 `.on()`) |
| `hooks/useUserChannel.ts` | `user:<userId>` | `notifications` / `feature_flags` / `bookmark_collections` / `saved_searches` / `user_stamps` (1 channel + 5 `.on()`) |
| `hooks/usePostDetail.ts` | `post-detail-bundle:<id>` | 投稿詳細の bundle |
| `hooks/useBBS.ts` | `bbs-threads-list-threads` 等 | BBS スレッド list |
| `hooks/usePolls.ts` | `polls-bundle:<hash>` | 投票 |
| `hooks/useReactions.ts` | `reactions:<hash>` | legacy reactions 経路 |
| `hooks/useCommentReactions.ts` | `comment-reactions:<hash>` | コメントリアクション |
| `hooks/useAddedTags.ts` | `post-added-tags:<hash>` | 追加タグ |
| `hooks/useAdminReports.ts` | (admin) | 通報 (→ [[Admin Console (運営管理)]]) |
| `hooks/useFeed.ts` | (base feed) | base posts |

- channel name は長すぎると接続 reject されるため、id 集合を `stableKeyFor()` で hash 化し先頭を切って使う (`sortedKey.slice(0, 32)` 等)。`stableKeyFor` は [[State管理 (Zustand・React Query)]] の queryKey hash と同じもの。
- feed 全体の realtime は **`useFeedRealtime` に集約**し、必ず feed 画面から起動する。`useReactions` 等の個別 subscription は legacy 経路。
- `useUserChannel` は **`app/_layout.tsx` の RealtimeRoot で 1 度だけ** mount し、auth 後 / signOut 後の userId 変化に追従する。同 user で多重 mount しても refCount で共有されるので安全。

### `useFeedRealtime` の具体 (debounce + filter cap)

- `MAX_FILTER_IDS = 30`: `post_id=in.(...)` の filter に渡す id 数の safety cap。長すぎる filter は server-side で reject される。
- `DEBOUNCE_MS = 300`: クリック直後の `DELETE + INSERT` 連発を 1 回の invalidate にまとめる。timer は **unmount cleanup で必ず clear + null 化** (unmount 後の fire 防止)。
- invalidate は **RPC cache (`['feed-page', ...]`) だけ** refetch。legacy cache 群は対応 hook が個別の staleTime で扱う (二重 refetch コスト回避)。

---

## 注意点・地雷

### 1 channel/1 table 分離 — ただし「条件付き」の鉄則

`CLAUDE.md` §5.3 の原則は **「1 channel に複数 table を chain しない」**。理由は:

> **publication 未登録 table の binding が CHANNEL_ERROR を起こすと、その channel 全体が死ぬ (event が一切配信されなくなる)。**

= 1 channel に 4 table chain して 1 つでも未登録なら、登録済 table の event も全部来なくなる (cascade)。これが「リアルタイムのスタンプが届かない」hot bug の真因だった。

**ただし現状のコードは厳密な 1:1 ではない**。実際の進化 (`useFeedRealtime.ts` / `useUserChannel.ts` のコメントに記録あり):

- 2026-05-24: `post_reactions / likes / concerns / saves` を 1 channel に chain → `concerns/saves` が publication 未登録で CHANNEL_ERROR cascade → **1 table/1 channel に分離**。
- 2026-05-28 (Audit E#5): `post_reactions` と `likes` は **両方 publication 登録済 (migration 0008)** と確認できたため、**1 channel + 2 `.on()` に再統合**。feed 描画時の同時 channel 数を 2→1 に減らすため。
- 同様に `useUserChannel` は **5 table を 1 channel に統合** (全て publication 登録済を 0008/0009/0010/0013 で確認)。

→ **正しい理解**: 「cascade リスクは publication 未登録 table が混ざる場合だけ」。**全 table が publication 登録済なら 1 channel に束ねてよい** (むしろ同時 channel 数を減らせて望ましい)。
→ **必須ルール**: 1 channel に新規 table を足す時は、その table が `supabase_realtime` publication に登録済か**必ず確認**する。未登録を混ぜた瞬間に channel 全体が死ぬ。未登録 table を購読したいなら、その table だけ別 channel に分離する。

### publication 登録状況 (2026-05 時点 / 要再確認)

`CLAUDE.md` §5.3 ベース。★printing 当時の値なので migration で増えている可能性あり、新規購読前に実際の publication を確認すること。

- ✅ 登録済: `post_reactions`, `likes`, `bbs_replies`, `comments`, `notifications`
  - (hook コメントから補完: `feature_flags`, `bookmark_collections`, `saved_searches`, `user_stamps` も登録済とされる)
- ❌ 未登録 (subscribe するとそれだけで CHANNEL_ERROR): `concerns`, `saves`, `community_stamp_reactions` 等

### 過去 hot bug 一覧

| 症状 | 真因 | 対策 / 状態 |
|---|---|---|
| リアルタイムのスタンプ/リアクションが届かない | 1 channel に 4 table chain、`concerns/saves` 未登録で CHANNEL_ERROR cascade → channel 全死 | 1 table/1 channel 分離 → 登録済のみ再統合。**解決済** |
| feed で他人のリアクションが反映されない | realtime subscription が `useReactions(legacyIds)` の中にしか無く、feed は RPC 経路 (`legacyIds=[]`) で disabled だった | `useFeedRealtime` を新設し feed.tsx から起動。**解決済** |
| ghost channel が上限集計から漏れる | `useNotifications` が module-scope で `supabase.channel('notifications:userId').subscribe()` を直に持ち、`attachChannel` とは**別の 2 つ目の channel manager**として動いていた (Audit E#3) | notifications を `useUserChannel` の `user:<userId>` channel に統合し `attachChannel` 経由に。`useNotifications` は React Query のみ管理。**解決済** |
| dead channel を再利用して event が来ない | CHANNEL_ERROR 等の死んだ channel が refCount で Map に残存 | status callback で dead 自動回収 (`DEAD_STATUSES` + `removeChannel`)。**解決済 (2026-05)** |
| client が channel 増えすぎて不安定 | 同時 channel 上限なし | `MAX_CONCURRENT_CHANNELS` で頭打ち、超えたら warn + no-op |

### その他の落とし穴

- **★ ドキュメント不整合 (未解決の表記ズレ)**: 上限値は実コード **12**。CLAUDE.md (§5.3 / §11 / §16) は **20** のまま。コードを信じる。CLAUDE.md 側の更新が必要。
- **silent degrade に注意**: 上限超過時も未登録 table 混入時も、エラーで落ちるのではなく「その購読だけ静かに無効」になりがち。`onStatus` の `CHANNEL_ERROR` ログと `getChannelStats()` で能動的に観測する。
- **console.warn / .error は本番でも残す**: babel `transform-remove-console` の除外設定済み。realtime の status ログは本番デバッグの生命線なので消さない。
- **channel name は短く**: 長い name は接続 reject される。id 集合は必ず hash 化して slice。
- **notif の queryKey 形を一致させる**: `useUserChannel` の cache patch 先 `['notifications', userId]` と `useNotifications` の `notifKey(userId)` が**同形でないと**、realtime の prepend/invalidate が UI 側の cache entry に当たらず「新着が出ない」になる。
- **logout で `detachAllChannels` 必須**: 残すと前ユーザーの channel が次セッションに漏れる。認証連携は [[認証・セッション]]。
- **filter id は 30 件まで**: それ以上は `MAX_FILTER_IDS` で切る。表示中の id が 30 を超える場合、超過分の event は届かない (debounce invalidate でカバーする設計)。

---

## 関連

- [[アーキテクチャ概要]] — 全体構成の中での Realtime の位置
- [[データ層・Supabase・RLS・マイグレーション運用]] — publication 登録 (migration 0008 等)・RLS との関係
- [[State管理 (Zustand・React Query)]] — invalidate / cache patch・`stableKeyFor`・`feedPagePatcher`
- [[フィード・ランキング・レコメンド]] — `useFeedRealtime` が支える feed 更新
- [[認証・セッション]] — logout 時の `detachAllChannels` / userId 変化への追従
- [[Admin Console (運営管理)]] — `useAdminReports` の通報 realtime
- [[地雷・落とし穴 総覧]] — channel cascade / ghost channel / 上限 silent degrade
