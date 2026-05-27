-- ============================================================
-- 0067: Q&A モード (post-level) — Reddit ガイド #17 / 4.6 / 5.4 章
-- ------------------------------------------------------------
-- post の author が enable → コメント sort を「author が返信したコメント
-- を優先」に切り替える。アイドル / 専門家の AMA 用途。
--
-- 設計判断:
--   - posts.qa_mode (boolean, default false) の 1 カラムだけ追加。
--     並び替えのロジック自体は client side (lib/utils/qaSort.ts) に置く。
--     server で再計算しないことで comments の RLS / publication と
--     疎結合に保つ — 既存 comment fetch path を一切変えない。
--   - partial index (where qa_mode = true) — 99% 以上の post は false 想定
--     なので、特定 post の判定 / フィルタはこの index を使う。
--   - idempotent (IF NOT EXISTS) — 0062 / 0063 流儀。
-- ============================================================

SET LOCAL statement_timeout = '5min';

alter table public.posts
  add column if not exists qa_mode boolean not null default false;

create index if not exists posts_qa_mode_idx
  on public.posts(qa_mode) where qa_mode = true;
