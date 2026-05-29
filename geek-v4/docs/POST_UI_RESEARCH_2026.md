# POST_UI_RESEARCH_2026.md

> 2026-05 時点で「世界レベル」と評価される SNS / 投稿系アプリの投稿 UI を横断調査し、Geek
> (匿名・趣味特化・コミュニティ × タイムライン同居) の投稿画面を **世界水準** に押し上げる
> ための設計指針をまとめる文書。
>
> このドキュメントは `app/post/create.tsx` (現行) のリファクタ判断・新コンポーネント発注の
> 設計 RFC として参照されることを想定する。既存の `design/tokens.ts` (`C / GRAD / SP / R / SIZE / SHADOW`)、
> `lib/memes.ts`、`supabase/functions/suggest-caption` を最大限活用する前提で書かれている。

---

## 0. TL;DR (先に結論)

- 2026 年現在、**「テキスト中心 + 1 画面完結 + 軽い段階性 (Reveal-on-Demand)」** が SNS 投稿 UI のベース。
  X / Threads / Bluesky / Mastodon / Lemmy はこのパターン。
- **メディア中心 (Instagram / TikTok / YouTube Shorts / Pinterest)** は逆に「メディア選択 → 編集 → メタ入力」
  の 2-3 段 wizard が主流。Geek は **テキスト中心 + メディア任意** の SNS なので前者がベース、
  メディアが入った瞬間だけプチ wizard 化するハイブリッドが最適解。
- **共通の作法 (must-have)**:
  - Top-right Primary CTA (Post/投稿) は常時可視 + invalid 理由の inline 表示
  - 文字数 ring / 数値カウンタ (色変化: 緑 → 黄 → 赤)
  - 下書き自動保存 + 復元時の Undo (= Instagram / X の現行挙動)
  - キーボード追従の sticky tool bar (画像 / hashtag / mention / poll / cw …)
  - Reduce-Motion + Dark-Mode + 大文字対応 (a11y は世界標準で要求される)
- **Geek 独自の世界レベル要素 (差別化)**:
  1. **匿名と本名のワンタップ切替** をボトムシート内に「メイン CTA の左隣」として常置
  2. **タグ必須・候補は本文文脈ベースで動的更新** (= 検索 v2 の resonance を投稿側でも実行)
  3. **コミュニティ宛先選択を `visibility` と統合した 2x2 グリッド** (Reddit/Discord/Threads にも無い)
  4. **CW (Content Warning) を 4 カテゴリで pre-set + 微妙な脳のブレを軽減**
  5. **「投稿前に AI に下書きを見てもらう」 (suggest-caption 拡張) を sticky AI ボタンで一発呼び出し**
- 推奨レイアウトは **Full-screen modal (現行 `post/create` を踏襲) + 内側で sticky toolbar + collapsible
  sections** の構成。Bottom sheet は「画像/タグ/コミュニティ picker」のみ用い、本体は full-screen
  に維持する。理由は 5.1 で詳述。

---

## 1. リサーチ対象 (12 社一覧)

| # | サービス | カテゴリ | 投稿の主体 | 主要画面構成 |
|---|---|---|---|---|
| 1 | X (Twitter) | テキスト先行 | 短文 + メディア任意 | フルスクリーン modal |
| 2 | Instagram | メディア先行 | 写真 / 動画 | 3 段 wizard (選択 → 編集 → 詳細) |
| 3 | YouTube Shorts | メディア先行 | 縦動画 | 2 段 (撮影/upload → 詳細) |
| 4 | TikTok | メディア先行 | 縦動画 | 3 段 (撮影/upload → 編集 → post) |
| 5 | Reddit | 文 / リンク / メディア | テキスト中心 | tab 切替 (text/image/link/poll/video) |
| 6 | Threads (Meta) | テキスト先行 | 短文 + media + 長文 | フルスクリーン modal + add-to-thread |
| 7 | Pinterest | メディア先行 | 1 枚 + メタ | 1 画面 (image + title + desc + link + tags) |
| 8 | Mastodon | テキスト先行 | 短文 + CW | フルスクリーン (web) / sheet (mobile) |
| 9 | Bluesky | テキスト先行 | 短文 + media | フルスクリーン modal + intent links |
| 10 | Discord (Forum) | テキスト | タイトル + 本文 + tag | フルスクリーン or bottom sheet |
| 11 | Lemmy / Kbin | テキスト / link | community-scoped | 1 画面 (community → title → body) |
| 12 | note / Zenn / Qiita | 長文 | Markdown article | 専用 editor (両ペイン or single) |

LinkedIn (12+α) も補助的に参照 (AI rewrite の参考)。

---

## 2. 各社の特徴抜粋

### 2.1 X (Twitter)

- **画面**: フルスクリーン modal。上部に close (×) + 自分のアバター + audience selector (Everyone / Circle)。
  本文 textarea 1 つ、下端 sticky に画像 / GIF / poll / 場所 / 絵文字 / schedule の 6 アイコン。
- **入力 flow**: 1 画面完結。Add-to-thread は同じ画面で「+」を押すと thread が増える (= 縦に textarea が積まれる)。
- **文字数**: 280 文字の円形 progress ring。残り 20 文字を切ると ring がオレンジ、超過で赤 + ナンバー
  表示に切り替わる。
- **AI 補完**: 2026 年に Grok 経由で「動画生成 / 画像アニメ化」を composer 内から呼べる feature を
  rollout 中。"Rewrite with Grok" は post 前に文章を整える ボタン。
- **下書き**: ×ボタンで「Save draft / Delete / Cancel」の 3 択 sheet。Drafts は別画面で一覧可。
- **強み**: 1 画面完結の徹底。Ring で進捗を視認できる。Audience selector を上に置いて
  「公開範囲ミス」を構造的に減らす。
- **弱み**: 機能が増え続け、底辺 toolbar が時に窮屈。新規 ユーザーには絵文字 / GIF / poll の差が
  わかりづらい。

### 2.2 Instagram

- **画面**: 3 段 wizard。①メディアグリッド選択 (camera-roll を底面 sheet で展開、画面上半分に
  プレビュー、下半分に grid) → ②編集 (フィルタ / トリミング / カバー選択 / 並び替え) → ③詳細
  (キャプション + tag people + 場所 + 高度な設定)。
- **メディア選択**: Grid 表示 + マルチ選択時は右上に丸番号が振られる。長押し drag で順序入れ替え。
- **タグ**: People-tag (= mention) は画像上のピン UI、ハッシュタグはキャプション本文に自然に
  混ぜる。サジェストは type中に inline で出る。
- **下書き**: feed post のみ Draft 化可。戻る (back) を押すと「Save draft / Discard / Cancel」
  modal。auto-save ではなく明示保存。
- **AI 補完**: 2024 以降 Meta AI の "Write with AI" が一部地域で先行。Re-write / 短く / カジュアルに
  などのテキスト変換 chip。
- **強み**: メディアプライマリの設計の完成形。プレビュー → 編集 → メタ入力の段差が
  気持ちよく "完成" を感じさせる。
- **弱み**: テキスト中心の投稿には冗長。Story / Reel / Feed の入口が同一画面で 3 つあり迷う。

### 2.3 YouTube Shorts

- **画面**: 撮影 (record) または upload 後に、トリミング → 音 → text overlay → 「次へ」 → 詳細
  (タイトル / 公開設定 / 視聴者向け表記 / 場所 / 公開タイミング)。
- **タグ / hashtag**: 説明欄に書く方式。投稿後、最初の 3 件が clickable リンクとしてタイトル上に表示。
- **モバイル特有**: タグ入力欄が「More options」配下に隠れていて、creator は気付かない事が多い。
  これは UX 失敗例として有名。
- **弱み**: ハッシュタグ入口の発見性が低い → Geek では「タグは必須」「本文 textarea 直下に
  常時可視」が逆に正解になる。

### 2.4 TikTok

- **画面**: 録画 (or upload) → 編集 (音 / effect / caption / sticker) → 「次へ」 → post 詳細
  (caption + hashtag + cover + 公開範囲 + コメント許可 + duet/stitch + AI generated 表示)。
- **caption + hashtag**: 一つの textarea 内で `#` を打つと auto-suggest が popover で出る。
  人気度 (10K posts / 1.2M views など) が併記される。
- **公開範囲**: Everyone / Friends / Only me を radio で並列。コメント / duet / stitch も同じ画面で
  granular control。
- **強み**: hashtag suggest の popover が最も洗練されている。ボリュームが表示されるので
  「使われていない死にタグ」を回避できる。
- **弱み**: 投稿前の画面が縦に長く、scroll が必要。

### 2.5 Reddit

- **画面**: 上部に「コミュニティ選択 (r/...)」が必須。次に「Post type tabs (Text / Image & Video /
  Link / Poll)」。下に「タイトル」「本文 / 添付」「Flair 選択」「OC / Spoiler / NSFW チェック」「Post」。
- **特徴**: コミュニティ → 形式 → 内容 → 装飾 の階段が明確。コミュニティを選ばないと
  Post できないハードゲート。
- **強み**: 「どこに投稿するか」を最初に決めさせるので公開範囲ミスゼロ。Flair (= tag) は
  そのコミュニティで予め定義されたものから選ぶ → 自由入力じゃないので品質が安定。
- **弱み**: 自由タグが無いので発見性が community 依存になりがち。Geek は **自由タグ** で
  attractiveness を稼ぐ設計なので、コミュニティ × タグの 2 軸でゆく必要がある。

### 2.6 Threads (Meta)

- **画面**: フルスクリーン modal。本文 textarea + メディア + リンクプレビュー + audience selector
  (default = Anyone)。500 文字 → 上部に倒立の countdown 表示 (15 分編集猶予)。
- **長文サポート**: 2025 後半に「長文 attach」が rollout。本文の右下 page-icon から長文 editor
  (basic formatting あり) が開く。
- **multi-part thread**: 「Add to thread」で同画面に textarea が縦に追加される (X と同じ)。
- **emoji picker**: composer に絵文字 face button が常設、global emoji picker が開く。
- **強み**: テキスト中心 SNS の現代版 1 画面完結 + 軽い段階性。長文は明示的にモード切替する
  分離設計。
- **弱み**: Instagram と graph 共有なので「匿名性」が無い (Geek の差別化ポイント)。

### 2.7 Pinterest

- **画面**: 1 画面に「image upload」「title」「description」「link (destination URL)」「board 選択」
  「tags (keyword)」が並ぶシンプルな form。
- **タグ**: keyword tag を pin 作成時に追加できる (idea pin 廃止後、機能追加)。
- **強み**: design + meta が同一画面で見渡せる。画像のオーソリティが高いプラットフォームだが
  入力は form-like。
- **弱み**: 動的 (= リアルタイム suggest) が薄い。Geek の参考としては小さい。

### 2.8 Mastodon

- **画面**: web は中央列が composer。textarea + CW toggle + visibility (4 段: Public / Unlisted /
  Followers-only / Mentioned only) + 言語選択 + 画像 + poll + sensitive media flag。
- **CW**: 「CW」ボタンを押すと textarea の上に「Write your warning here」line が現れる。
- **強み**: 4 段階の visibility + CW + 言語選択を 1 画面で出している (連邦型 SNS の必要性)。
- **弱み**: CW の UI が新規ユーザーに伝わりにくい (「Show more」が disable に見える、
  contrast 不足の指摘が repo issue 上で多数)。Geek は CW を「カテゴリ pill」で実装することで
  この問題を回避できる。

### 2.9 Bluesky

- **画面**: フルスクリーン modal。textarea + media + alt text (画像 a11y 必須化) + language + threadgate
  + reply gate。文字数 300。
- **特徴**: AT Protocol の influence で、composer に「reply gate (who can reply)」「threadgate
  (who can quote)」が出る。
- **intent links**: 外部から `?text=...` で本文 pre-fill できる URL spec が公開されている。
- **強み**: 画像 a11y (alt text) を投稿前に required prompt として出す → 世界水準の a11y 配慮。
- **弱み**: 公式 app 以外で multi-account 切替 UI が弱い。

### 2.10 Discord (Forum channel post)

- **画面**: タイトル + 本文 + tag (forum で定義) + 添付。新規 post の「最初の message」が
  forum thread の OP になる。
- **強み**: タイトル必須 → 検索性が高い (thread 一覧で title 表示)。
- **弱み**: タグはサーバー owner が定義する制限あり (= Reddit Flair に近い)。

### 2.11 Lemmy / Kbin (federated Reddit alike)

- **画面**: コミュニティ (Local / All) → title → body or URL → NSFW チェック → submit。
- **federation toggle**: 投稿のサーバー越境 (federate) を on/off できる toggle。
- **強み**: 連邦性のためのコントロールが UI に出ている。Geek 流に翻訳すると「コミュニティに
  も載せる / ホームにも載せる」の 2 軸 visibility に対応 (現状の `community_only` / `community_public`)。

### 2.12 note / Zenn / Qiita (日本の長文系・参考)

- **共通**: Markdown editor + プレビュー or WYSIWYG。Cover image + title + body + tags + 価格
  (note) / publication (zenn) / series。
- **特徴**: 「保存して下書き」「公開」を上部の primary CTA で並列に置く。
- **Geek への示唆**: 長文 thread (= BBS) 形式の投稿には markdown 軽量 support と「下書き」を
  primary に並列出しすると良い。

### 2.13 LinkedIn (補助参考: AI rewrite)

- 2024-2025 にネイティブ composer に「Rewrite with AI」 (professional / casual / celebratory に変換)
  が組み込まれた。Geek の suggest-caption の発展形として参考になる。

---

## 3. 共通パターン (確立された best practice — Geek でも採用)

| # | パターン | 採用元 | 重要度 |
|---|---|---|---|
| 1 | フルスクリーン modal で composer (1 画面で完結) | X / Threads / Bluesky / Mastodon (mobile) | 必須 |
| 2 | Primary CTA を右上に常時可視 (Post / 投稿) | 全社 | 必須 |
| 3 | Audience / visibility を本文より「上」に置き、ミスを構造で防ぐ | X / Threads / Reddit / Mastodon | 必須 |
| 4 | 下書き auto-save + 復元時の Undo | Instagram / X / Threads | 必須 (Geek は実装済) |
| 5 | 文字数の数値 + 残り少のとき色変化 (緑 → 黄 → 赤) | X (ring) / TikTok / Threads | 必須 |
| 6 | Sticky bottom toolbar (画像 / poll / GIF / 場所 / 絵文字) | X / Threads / Bluesky | 強推奨 |
| 7 | Hashtag inline suggest (popover with volume) | TikTok / Instagram | 強推奨 |
| 8 | 画像 1〜N 枚を grid + 並び順番号 + 削除 X | Instagram / X | 必須 (Geek は実装済) |
| 9 | 動画は 1 本 (1 投稿) + プレビュー縮小 thumb | Reels / Shorts / TikTok | 強推奨 (Geek は実装済) |
| 10 | A11y: ダークモード / Reduce Motion / alt-text 入力 | Bluesky / Mastodon | 必須 |
| 11 | CW (Content Warning) toggle + カテゴリ pill | Mastodon (粗) / Geek (改良) | 強推奨 (Geek 独自で洗練) |
| 12 | Add-to-thread (連投) | X / Threads | optional (Geek には BBS スレ機能で代替) |
| 13 | キーボード追従 (KeyboardAware / safe-area inset) | 全社 (mobile) | 必須 |
| 14 | エラー (公開できない理由) を inline で出す | Twitter / Threads | 必須 (Geek は実装済) |
| 15 | 投稿前 AI 補完 (rewrite / suggest) | LinkedIn / X / Instagram | 強推奨 (suggest-caption 活用) |

---

## 4. 差別化要素 (各社の独自要素 — Geek が選んで取り入れる)

| サービス | 独自要素 | Geek 採否 | 理由 |
|---|---|---|---|
| X | 円形 progress ring (280 文字) | **採用** | 視認性高、ring は Reanimated で実装容易 |
| X | Audience selector top-left | 統合 | Geek は 2x2 visibility grid を本文下に配置済 (既存設計尊重) |
| Instagram | 3 段 wizard (メディア → 編集 → 詳細) | **部分採用** | 「画像が 1 枚以上選ばれた時だけ、編集 step を sheet で開く」 hybrid |
| Instagram | 画像の長押し drag 並び替え | **採用** | 既存 grid に drag handler を追加 (Reanimated + Gesture) |
| TikTok | hashtag suggest with volume | **採用** | suggest-caption + tagSearchV3 で実装可能 |
| TikTok | 公開範囲が granular (comment / duet / stitch) | 不採用 | Geek は visibility 4 段 + 匿名/本名で十分 |
| Reddit | コミュニティ選択ハードゲート | **部分採用** | visibility=community_* のときだけ require、それ以外は self-only post を許す |
| Threads | 長文 attach (page icon で別 editor) | optional | Geek は BBS スレに長文を分離する設計、composer は 2000 文字で十分 |
| Threads | 編集 15 分猶予 + countdown | optional | 既存仕様 (編集機能未実装) と相談、優先度低 |
| Pinterest | board (= コレクション) 必須 | 不採用 | Geek の community + tag で代替 |
| Mastodon | 言語 tag | optional | i18n が拡張されたら追加検討 |
| Bluesky | 画像 alt-text **必須プロンプト** | **採用** | a11y で世界水準を狙うなら絶対採用、Phase 2 で投入 |
| Bluesky | thread/reply gate | 不採用 | Geek は匿名性で代替 (誰でも返信は基本) |
| Discord | タイトル必須 (forum) | 部分採用 | BBS スレ作成時のみ既存仕様で title 必須 |
| LinkedIn | AI rewrite (tone 変換) | **採用** | suggest-caption の拡張として: casual / formal / hype の 3 tone |

---

## 5. Geek 向け推奨設計 — 「世界レベルの投稿 UI」

### 5.1 全体レイアウト

**結論: フルスクリーン modal (現行の `app/post/create.tsx` を踏襲) を維持**。Bottom sheet 化はしない。

#### なぜフルスクリーンか

- Geek の投稿は **テキスト + タグ + 画像/動画 + visibility + CW + poll + 出典URL + 匿名** と
  項目が多く、Threads/X 規模では物足りない。Bottom sheet (50% / 80%) では確実に
  scroll 競合 (sheet 自体の swipe vs 内部 scroll) が起き、入力中に sheet が誤って閉じる
  事故が出る。
- Composer に AI suggest / hashtag suggest / community picker などの「副次的 UI」が乗ると、
  Bottom sheet では visual hierarchy が崩壊する。
- Mastodon mobile も 2024 以降フルスクリーン化、Threads / Bluesky / X はずっとフルスクリーン。
  これが SNS 標準。

#### 構造

```
[ TopBar:  ← (close)        投稿 (= title)        [下書き保存中…] [投稿 button] ]
[ ScrollView (keyboardShouldPersistTaps=handled)                                 ]
  [ Section 1: 本文 + メディア (合体) ]
    [ TextArea (auto-grow, autoFocus)                                            ]
    [ Image grid (max 4) + Video slot (max 1)                                    ]
    [ Char counter (ring + 数値) — text 入力中だけ float in                       ]
  [ Section 2: タグ (required) ]
    [ AI 自動 tag suggest (from content) + 履歴 chip + tag input + + 追加 button   ]
    [ Selected tag pills (削除可)                                                ]
  [ Section 3: 公開範囲 (2x2 grid) ]
  [ Section 4 (conditional): コミュニティ選択 ]
  [ Section 5 (collapsible): 投票 ]
  [ Section 6 (collapsible): CW ]
  [ Section 7 (collapsible): 出典 URL (advanced) ]
  [ Section 8: 匿名 toggle ]
  [ Section 9 (inline): 投稿できない理由 ]
[ Sticky bottom toolbar (KeyboardAvoid):                                         ]
   📷 (image) | 🎬 (video) | # (tag input focus) | 📊 (poll) | ⚠️ (cw) | 🤖 (AI)  ]
```

新規要素: 末尾の **Sticky bottom toolbar**。これが現行設計の決定的な強化点。
キーボード ON 時にも常に親指で届く高さに浮かべる (Threads / X / Bluesky と同じ感覚)。

### 5.2 入力エリア (本文 + メディア合体)

- **TextArea** は `autoFocus` で開始即 typing 可能。
- **auto-grow**: min 6 行 / max 18 行。Reanimated で `withSpring` (damping: 18, stiffness: 220) で
  滑らかに高さアニメ。
- **Placeholder**: 動的ローテーション。タグが選択されたら `「{tag} について語ろう」`、何も無いときは
  `「いまの気持ち、ぽちぽちと」` 等の Geek らしい砕けたコピー。
- **Char counter**: テキスト入力開始でフェードイン、右下に固定。
  - 数値表示: `{n} / 2000`
  - 残り 100 以下: 数値が `C.amber` に変化
  - 残り 20 以下: `C.red` + 軽い shake (一度だけ)
  - 残り 0: 入力 block + haptic warn
  - 加えて **X 風 ring** (12px サイズ) を数値の左に配置。Reanimated `useDerivedValue` で
    `strokeDashoffset` をアニメ。色 ring も上記閾値で変化。
- **メディア grid**: TextArea 直下に固定。現行と同じ 4 thumb + video 1 slot。
  - **drag 並び替え** (新): 長押しで thumb が浮き、ドラッグで並び替え。`react-native-gesture-handler` +
    `Reanimated`。
  - **alt text 入力** (新): 各 thumb の長押し → 「alt text を追加 (任意)」 sheet が開く。Bluesky 流。
    視覚障碍者向けで a11y スコアが跳ね上がる。
  - **動画は post-record 編集なし** (上限 100MB / 60s / 1080p / mp4 のみ)。trimming は Phase 2。

### 5.3 メディア選択

- **画像 picker**: `expo-image-picker.launchImageLibraryAsync` (現行通り)。**multi-select は 4 枚まで**。
- **動画 picker**: 1 本まで。`validateVideoSource` を通す (現行通り)。
- **camera direct**: composer の sticky toolbar から `launchCameraAsync` を呼ぶ entry を追加
  (現行はライブラリのみ)。
- **drag reorder**: Phase 1 では tap で「右へ移動」「左へ移動」の小 button 表示でも可、
  Phase 2 で drag に格上げ。
- **圧縮プレビュー**: 画像は 5MB 超で auto-compress (現行 `prepareImageUpload` で実装済)、
  完了後 「画像 1: 4.2MB → 1.1MB に圧縮」 を toast 表示。安心感に直結。

### 5.4 タグ (Geek の魂)

タグは Geek 検索 v2 の根幹。投稿側でも妥協しない。

- **AI 自動提案** (現行 `useAutoTagSuggest` を維持・拡張):
  - 本文 600ms debounce → サーバの suggest-caption に拡張呼び出し (本文・既存タグ → 候補)。
  - 候補は最大 6 個、`reason` 付きで chip 表示。Geek 紫の 1 ボーダー (`rgba(124,106,247,0.4)`)
    で囲む。タップで即 add。
- **入力 inline suggest** (現行 `TagInputSuggestions` を強化):
  - type 中に「好まれている tag」「直近 24h の hot tag」「自分が過去使った tag」を 3 列で同時表示。
  - 各 chip に `posts: 1.2K` のような volume を併記 (TikTok 流)。これで「死に tag」を回避できる。
- **タグ最大 5 個** (現行通り)。6 個目を type すると tag input が disabled になり、
  「上限に達しました — 1 個外してから追加」を inline 表示。
- **入力 UX 強化**:
  - `Enter` で確定 + space で確定 (両方 OK) — 親指タイピングの快適度向上。
  - `#` 接頭辞を自動で除去 (現行通り)。
  - **ペースト時の自動分割**: `#tag1 #tag2 #tag3` をペーストしたら自動で 3 個に分割
    (TikTok にも無い細やかな配慮)。

### 5.5 公開範囲

**現行の 2x2 グリッド** (private / public / community_only / community_public) は世界水準でも稀に見る
質の高さ。**維持 + 微改善** に留める。

- 既存: emoji + 大文字 label + 説明 + active 時は accent border + check badge。
- 改善案:
  1. 選択時に `Layout.springify().damping(18)` で軽く scale (1.0 → 1.02) する pulse。
  2. デフォルトを `public` ではなく、過去 5 投稿で多く選んだものに動的設定 (= 学習)。
  3. `community_only` / `community_public` を選んだ瞬間にコミュニティ picker section が
     `FadeInDown.springify()` で展開 (現行も近いが、より bouncy に)。

### 5.6 AI 補完 (suggest-caption 活用)

これが Geek を世界レベルに持ち上げる **核心の差別化**。

#### 5.6.1 機能 3 つ

1. **キャプション提案** (現行 `suggest-caption` の素直な活用):
   - sticky toolbar の「🤖」ボタン → bottom sheet で 3 候補を表示 → tap で本文に挿入 (差し替え or 末尾追加)。
2. **トーン変換** (LinkedIn 流の拡張):
   - 既存本文がある時に「砕けて / 真面目に / オタクっぽく」の 3 chip を出す。
   - Edge function 側で system prompt を切替。
3. **タグ自動提案** (現行 `useAutoTagSuggest`):
   - 本文 + suggest-caption 候補 を組み合わせて候補度を再計算。

#### 5.6.2 UI 配置

- sticky bottom toolbar の右端に **🤖 button** (`SHADOW.glow` で紫 glow)。
- tap で `BottomSheet` がせり上がり、上部に 3 候補、下部に「もっと候補」「閉じる」。
- AI 候補は **本文より上品な文字色** (`C.text2`) で表示 → ユーザーが「自分の言葉」と区別できる。
- 採用すると本文 textarea に挿入され、`Layout.springify()` で text-area の高さが伸びる。

#### 5.6.3 Edge function 拡張案

現行 `suggest-caption/index.ts` は 「文字列テンプレート」しか返さないので、以下を順次:

- Phase 1: tone を accept (`?tone=casual|formal|otaku`)。
- Phase 2: 本文を accept して rewrite (現状は tags 配列のみ)。
- Phase 3: 外部 LLM (Anthropic API) に接続。秘密鍵は `supabase secrets`。**fail-secure** で
  失敗時は現状のテンプレートに fallback (= 現行関数は残す)。

### 5.7 アニメーション

すべて Reanimated 3 + worklet。spring を default に。

| 対象 | アニメ | 値 |
|---|---|---|
| Section の展開 (poll/cw/advanced) | `FadeInDown` + `Layout.springify()` | damping: 20, stiffness: 200 |
| 画像 thumb 追加 | `FadeIn.duration(180)` | (現行維持) |
| 公開範囲 active 化 | `withSpring` scale 1 → 1.02 → 1 | damping: 14 |
| char counter ring | `useDerivedValue` で stroke offset 補間 | duration: 120ms ease |
| AI sheet 上昇 | `gorhom/bottom-sheet` の snapPoint アニメ | (内蔵) |
| keyboard 連動 | `KeyboardAvoidingView` + `react-native-keyboard-controller` | (現行 KeyboardAware) |
| エラー inline 表示 | `FadeIn.duration(180)` + tiny shake (右に 6px, 戻り 0px) 1 回 | (新) |
| 投稿成功 | hap.success + Toast の `entering={SlideInUp.duration(220)}` | (既存 toast を流用) |

**Reduce Motion** が ON のときは spring を全部 `withTiming(value, { duration: 0 })` に
切替 (= jump cut)。`useReducedMotion` hook で判定。

### 5.8 ASCII Wireframe

```
┌───────────────────────────────────────────────┐
│  ←                投稿        ↻ 保存中…  [投稿] │ ← TopBar (sticky)
├───────────────────────────────────────────────┤
│                                               │
│  ╭──────────────────────────────╮ char  ◐    │
│  │  ここに本文 (auto-grow)      │  42 / 2000 │
│  │  プレースホルダー: 「{tag}に  │            │
│  │   ついて語ろう」など動的     │            │
│  ╰──────────────────────────────╯            │
│                                               │
│  [img] [img] [img] [+]   [vid] [+]            │ ← media grid
│                                               │
│  ─────────────────────────────────────────    │
│  タグ *                              3 / 5    │
│  🤖 本文から提案 (3 件)                       │
│   ├ + ポケモン      ├ + アニメ     ├ + 雑談  │
│  入力中の候補 (volume 付き):                  │
│   ├ #バンドリ (1.2K) ├ #fes (340)             │
│  ╭─────────────────────╮  [+ 追加]            │
│  │ # tag を入力        │                      │
│  ╰─────────────────────╯                      │
│  [#ポケモン X] [#アニメ X]                    │
│                                               │
│  ─────────────────────────────────────────    │
│  公開範囲 *                                   │
│  ╭──────────╮ ╭──────────╮                    │
│  │ 🔒 自分だけ│ │🌐 一般公開│                    │
│  │ 下書き     │ │ホーム公開 │                    │
│  ╰──────────╯ ╰──────────╯                    │
│  ╭──────────╮ ╭──────────╮                    │
│  │👥コミュのみ│ │📣 全員に  │                    │
│  ╰──────────╯ ╰──────────╯                    │
│                                               │
│  (visibility が community 系のときだけ ↓)     │
│  ╭ コミュニティ選択 (1 件選択中) ───────────╮ │
│  │ [🎮 ポケモン]  ✕                          │ │
│  │ ╭ 参加中を検索 ───────────╮                │ │
│  │ │ 🔍 ...                  │                │ │
│  │ ╰────────────────────────╯                │ │
│  │ ☑ 🎮 ポケモン  メンバー 12.4K              │ │
│  │ ☐ 🎨 イラスト   メンバー 8.9K              │ │
│  ╰──────────────────────────────────────────╯ │
│                                               │
│  [▸ 投票を追加]                               │
│  [▸ CW を追加]                                │
│  [▸ 出典 URL]                                 │
│                                               │
│  ╭ 🕶️  匿名で投稿        ────────  [●○] ╮     │
│  ╰──────────────────────────────────────╯     │
│                                               │
│  ⚠ タグを 1 つ以上 追加してください          │ ← inline error
│                                               │
└───────────────────────────────────────────────┘
│ 📷  🎬  #  📊  ⚠️                       🤖 AI │ ← sticky toolbar (KeyboardAvoid)
└───────────────────────────────────────────────┘
```

(ボトムシートが開いた時のレイヤ重ね順は最上位、本体は背後で凍結 = swipe 禁止)

### 5.9 デザイントークン推奨値

既存の `design/tokens.ts` を **そのまま流用** することを推奨。新規 alias は最小限。

| 用途 | token |
|---|---|
| modal background | `C.bg` (#0a0a0a) |
| section card | `C.bg2` (#161618) |
| input background | `C.bg3` (#1c1c1c) |
| primary CTA | `C.accent` (#7C6AF7) + `SHADOW.glow` |
| 文字メイン | `C.text` (#f5f5f7) |
| 文字 secondary | `C.text2` (#a1a1aa) |
| 文字 hint | `C.text3` (#71717a) |
| border | `C.border` (#27272a) |
| error / warn | `C.amber` / `C.red` |
| AI suggest border | `rgba(124,177,255,0.4)` (現行通り、accent-blue) |
| section gap | `SP['5']` (20px) |
| inner gap | `SP['2']` (8px) |
| input radius | `R.lg` (14px) |
| chip radius | `R.full` |

新規追加トークン (`tokens.ts` に補強候補):

```ts
// composer 内 sticky toolbar 用 (新規)
composerToolbar: 'rgba(20,20,22,0.92)', // blur 風 (BlurView と併用)
composerToolbarBorder: 'rgba(255,255,255,0.08)',
charCountWarn: '#F5A623', // 残り 100 文字 (= amber)
charCountDanger: '#E24B4A', // 残り 20 文字 (= red)
charCountSafe: '#22D3A4',   // 余裕あり (= green)
```

### 5.10 ハプティクス

現行 `design/haptics.ts` の hap.* を全所で使う。新規パターンは最小限:

| 操作 | hap |
|---|---|
| タグ追加 | `select` |
| タグ削除 | `select` |
| 画像 add | `tap` |
| 画像 remove | `warn` |
| 公開範囲切替 | `select` |
| poll 追加 | `confirm` |
| CW カテゴリ選択 | `select` |
| AI suggest tap | `confirm` |
| 投稿成功 | `success` |
| 投稿失敗 | `error` |
| 文字数 max 達 | `warn` (1 回だけ) |

---

## 6. Geek の差別化案 (匿名性 + コミュニティ × 投稿)

Geek は **「好きを、匿名で、安心して続ける」** がコアコンセプト。投稿 UI も他社と
差別化できる軸を整理する。

### 6.1 匿名性ファースト

- **匿名トグルを sticky toolbar の隣** に置き、常時 1 タップで切替可能にする。
  X / Threads は graph 公開が前提 (= 匿名性 0)、Mastodon でも匿名性は instance 単位の運用に
  依存する。Geek が「匿名」をデフォルト ON にして、しかも一目で確認できることが UX の
  独自性。
- **匿名 ↔ 本名 切替を haptic + visual で強調**: 切り替えるたびに本文上部に小バナー
  「いま 匿名 で投稿します」「いま 本名 で投稿します」を 1.6 秒だけ表示。Threads でも X でも
  ここまでの「確認感」は出していない。

### 6.2 コミュニティ + visibility 統合 grid

- 既存の 2x2 grid は世界水準。これを **「投稿先カード化」** すると、Discord / Reddit / Lemmy
  の community 概念と SNS の visibility 概念をひとつの操作で完結させた稀有な UI になる。
- カード内に小 preview (どこに掲載されるか) を ASCII で簡潔表示:
  - `🔒 自分だけ` → なし
  - `🌐 一般公開` → 「ホーム」
  - `👥 コミュのみ` → 「○○コミュニティ」
  - `📣 全員に` → 「ホーム + ○○コミュニティ」

### 6.3 タグ × CW (品質ゲート)

- タグが必須なので「死に投稿」が少ない。これは Geek の検索性を支える土台。
- CW を spoiler / nsfw / violence / sensitive の 4 カテゴリで pre-set し、初心者でも適切な
  警告を付けやすい。Mastodon の自由テキスト CW より誤用が起きにくい。
- **Phase 2 提案**: タグから AI が「これは spoiler の可能性があります」と自動 prompt する。
  例: タグに「鬼滅 無限城」が入っていたら `cwCategory='spoiler'` を suggest。

### 6.4 投稿の "心理的フリクション" 軽減

- 投稿しないユーザーの主因は「公開範囲ミス / 失敗の恥」。Geek は匿名 default + 4 段
  visibility + private (下書き同等) を提供することで構造的に解決済。これを UI でも
  「**最初に押す PrimaryCTA で 5 秒だけ "公開範囲: 一般公開で投稿します" を再確認**」
  すると、初心者の安心感が伸びる (LinkedIn / 投稿前 confirm の応用)。
- ただし confirm は **3 回投稿したら自動 OFF** にして、慣れたユーザーの邪魔をしない。
  これがフリクション設計のバランス。

### 6.5 BBS との連携 (Geek 独自)

- BBS スレ形式投稿 (`?title=1`) のときだけタイトル欄が出る現行設計はそのまま。
- BBS の長文投稿への移行を上部に banner で promote すべきか検討:
  - 本文 1500 文字を超えると「**長文向けに BBS スレで投稿しますか？**」 inline banner。
  - これは Threads の「長文 attach」と同じ思想だが、Geek は **既存の BBS** に流すことで
    機能の二重化を避けられる。

### 6.6 ストアレビュー的視点

- AppStore / Google Play で「写真投稿が面倒」「公開範囲が分からない」「タグ付けが分からない」
  が SNS App の典型不満。Geek は上記設計を実現すると、レビュー観点でも勝てる:
  - 公開範囲: 2x2 grid + preview の明快さ
  - タグ: 必須化 + AI 自動提案で迷わない
  - 写真: 4 枚 + drag 並び替え + alt text
  - 匿名: 1 タップで確認

---

## 7. 実装優先順位

### Phase 0 (現状 — すでに実装済)

- フルスクリーン modal の composer (`app/post/create.tsx`)
- 本文 + 画像 4 + 動画 1
- タグ必須 + AI 自動提案 (`useAutoTagSuggest`)
- 2x2 visibility grid
- コミュニティ多選択 picker
- CW 4 カテゴリ pill
- poll (multi-select + 期間)
- 出典 URL (collapsible)
- 匿名 toggle
- 下書き auto-save + 復元 Undo
- 投稿不可理由の inline 表示
- KeyboardAware
- 文字数表示 (数値のみ)

### Phase 1 (1-2 週で世界水準に追いつく)

1. **Sticky bottom toolbar** (📷 🎬 # 📊 ⚠️ 🤖 の 6 アイコン、KeyboardAvoid 連動)
   — 工数 1d
2. **文字数 ring (X 風)** + 色変化 + shake — 工数 0.5d
3. **AI 候補シート** (suggest-caption 連携、3 候補 + 採用) — 工数 1d
4. **画像長押し drag 並び替え** — 工数 1d
5. **画像 alt text 入力 sheet** (Bluesky a11y) — 工数 1d
6. **TextArea auto-grow + 動的 placeholder** — 工数 0.5d
7. **匿名↔本名トグルのバナー演出** — 工数 0.5d

### Phase 2 (世界レベル仕上げ)

1. **AI rewrite (tone 変換: 砕けて / 真面目に / オタクっぽく)** + Edge function 拡張
   — 工数 2d
2. **タグ candidate に volume 表示** (TikTok 流) — 工数 1d
3. **camera 直接撮影 entry** (sticky toolbar から) — 工数 0.5d
4. **動画 trim / poster 自動生成** (`expo-video` ベース) — 工数 3d
5. **デフォルト visibility を 5 投稿履歴から学習** — 工数 1d
6. **「長文は BBS スレへ」 banner (1500 文字超)** — 工数 0.5d
7. **CW を tag から自動 suggest** (タグ → 既知 spoiler tag DB と照合) — 工数 1.5d
8. **投稿前 confirm 5s (初心者 3 投稿限定)** — 工数 0.5d
9. **Reduce Motion 完全対応の見直し** — 工数 0.5d
10. **a11y 対応の総点検** (TalkBack / VoiceOver で実機テスト) — 工数 1d

### Phase 3 (差別化を完璧に)

1. **「ポストプレビュー」モード**: 投稿前に「他人にこう見えます」を実フィードカードで再現
   — 工数 1d
2. **AI トーンの「Geek 専用 persona」追加**: 「○○警察」「萌え語り」「考察勢」など、
   コミュニティの空気感に合わせた rewrite — 工数 2d
3. **投稿後アニメーション**: 投稿成功時に Reanimated で post-card がリストへ飛び込む
   motion (FLIP technique) — 工数 1.5d

---

## 8. 参考 URL

### Composer 全般
- [X iOS Tweet composer (Mobbin)](https://mobbin.com/explore/screens/549ee237-84e7-4cf0-849f-894bd8f5ccb1)
- [Twitter UI UX Review (CreateBytes)](https://createbytes.com/insights/Twitter-UI-UX-Review-Design-experience-analysis)
- [Meta Threads UX Principles (Thearakim, Bootcamp)](https://bootcamp.uxdesign.cc/metas-threads-a-quick-look-at-ux-ui-principles-26167275e67b)
- [Top Threads Features (Buffer)](https://buffer.com/resources/threads-new-features/)
- [Bluesky iOS App UI/UX animation (60fps.design)](https://60fps.design/apps/bluesky)
- [Action Intent Links (Bluesky Docs)](https://docs.bsky.app/docs/advanced-guides/intent-links)

### Instagram / TikTok / Shorts / Pinterest
- [Instagram Layout / Stories (help)](https://help.instagram.com/385953178139846)
- [Instagram Grid Layout 2026 (Inro)](https://www.inro.social/blog/instagram-layout)
- [Instagram Patterns and Flows (Bo Bayerl, Medium)](https://bobayerl.medium.com/instagram-patterns-and-flows-927ee305c1b)
- [TikTok Caption & Subtitle Best Practices 2026 (OpusClip)](https://www.opus.pro/blog/tiktok-caption-subtitle-best-practices)
- [YouTube Shorts Hashtags 2026 (Hashtag Tools)](https://hashtagtools.io/blog/youtube-shorts-hashtags-title-vs-description-2026)
- [Pinterest UI/UX Review (CreateBytes)](https://createbytes.com/insights/pinterest-ui-ux-review-boom-or-bloom)
- [Pinterest Pin Creation Case Study (Medium)](https://medium.com/design-bootcamp/case-study-maintaining-the-ui-of-create-a-pin-feature-on-pinterest-for-various-devices-4860657709a8)

### Mastodon / Lemmy / Discord
- [Mastodon Content Warning UX issue (GitHub)](https://github.com/mastodon/mastodon/issues/722)
- [Mastodon CW accessibility issue (GitHub)](https://github.com/mastodon/mastodon/issues/30724)
- [Discord Forum Channels FAQ (Discord support)](https://support.discord.com/hc/en-us/articles/6208479917079-Forum-Channels-FAQ)
- [Lemmy and Kbin (PCMag Medium)](https://medium.com/pcmag-access/lemmy-and-kbin-the-best-reddit-alternatives-743f0355289d)

### Tech / Animation / A11y
- [React Native Reanimated docs](https://docs.swmansion.com/react-native-reanimated/docs/2.x/api/LayoutAnimations/entryAnimations/)
- [Bottom Sheets UX Guidelines (NN/g)](https://www.nngroup.com/articles/bottom-sheet/)
- [Cancel vs Close (NN/g)](https://www.nngroup.com/articles/cancel-vs-close/)
- [Mobile UX Best Practices 2026 (Brand Vision)](https://www.brandvm.com/post/mobile-ux-best-practices)
- [Mobile-First UX 2026 (Revival Pixel)](https://www.revivalpixel.com/blog/mobile-first-ux-2026-thumb-driven-design-wins)

### 長文プラットフォーム
- [Zenn / Qiita / note 比較 (note)](https://note.com/dango_tsukimi/n/n335a1bfaf620)
- [Note Qiita Zenn 比較 (Zenn)](https://zenn.dev/soshi1234/articles/note-qiita-zenn-comparison)

---

## 9. 改訂履歴

| 日付 | 改訂 |
|---|---|
| 2026-05-29 | 初版 — 12 社調査 + Geek 向け推奨設計 |

> 次回更新タイミング:
> - Phase 1 (Sticky toolbar / Ring / AI sheet) 実装完了後に「実装と理論の差分」を追記
> - 競合の composer UI に大変更 (X が縦長 wizard 化など) があった時
> - Geek の社内 dogfooding で「ここが世界レベルじゃない」と判明した時
