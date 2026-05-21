-- ============================================================
-- 0033: Geek 公式コミュニティの seed
-- ============================================================
-- アプリ自体の公式コミュニティを 1 つ作成し、is_official=true で
-- siturt0330@gmail.com を管理者にする。
-- お知らせ・新機能・ガイドラインなどを発信する場として運用する。
--
-- このマイグレーションは 0032 が適用されていることが前提。
-- 冪等: 既に同名のコミュニティがあれば何もしない。
--
-- 0024 の communities_set_created_by trigger は auth.uid() を要求するため
-- SQL Editor から実行する seed では一時的に無効化する。
-- ============================================================

do $$
declare
  v_admin_user_id uuid;
  v_community_id  uuid;
begin
  -- 管理者 (= 開発者) の user_id を取得
  select id into v_admin_user_id
    from auth.users
   where email = 'siturt0330@gmail.com'
   limit 1;

  if v_admin_user_id is null then
    raise notice '[0033] siturt0330@gmail.com not found — skipping Geek official seed';
    return;
  end if;

  -- 既存チェック
  select id into v_community_id
    from public.communities
   where name = 'Geek公式'
   limit 1;

  if v_community_id is not null then
    raise notice '[0033] Geek公式 community already exists (id=%) — skipping', v_community_id;
    return;
  end if;

  -- 0024 / 0026 の auth.uid() 要求 trigger を一時的に無効化 (seed 実行時のみ)
  -- communities INSERT → handle_new_community trigger 経由で community_members
  -- にも INSERT されるので、両方の auth.uid() ガードを外す必要がある。
  alter table public.communities disable trigger communities_set_created_by;
  alter table public.community_members disable trigger community_members_normalize_insert;

  -- 公式コミュニティを作成 (handle_new_community trigger が自動で owner も追加)
  begin
    insert into public.communities (
      name, description,
      icon_emoji, icon_color, visibility,
      is_official, official_admin_user_id,
      official_admin_display_name, official_organization,
      official_approved_at, official_features,
      created_by
    ) values (
      'Geek公式',
      'Geek アプリの公式コミュニティです。お知らせ・新機能のアナウンス・コミュニティガイドライン・運営からのメッセージなどを発信します。質問は Q&A コーナーへどうぞ。',
      '✨', '#7C6AF7', 'open',
      true, v_admin_user_id,
      'Geek 運営', 'Geek 開発チーム',
      now(), array['qna', 'calendar', 'map']::text[],
      v_admin_user_id
    )
    returning id into v_community_id;
  exception when others then
    -- trigger は必ず戻す
    alter table public.communities enable trigger communities_set_created_by;
    alter table public.community_members enable trigger community_members_normalize_insert;
    raise;
  end;

  -- trigger を元に戻す
  alter table public.communities enable trigger communities_set_created_by;
  alter table public.community_members enable trigger community_members_normalize_insert;

  -- 念のため: handle_new_community で挿入されなかった場合の保険
  insert into public.community_members (community_id, user_id, role)
  values (v_community_id, v_admin_user_id, 'owner')
  on conflict (community_id, user_id) do nothing;

  -- ガイドラインタグを付与 (任意)
  insert into public.community_tags (community_id, tag)
  values
    (v_community_id, '公式'),
    (v_community_id, 'お知らせ'),
    (v_community_id, 'ガイドライン')
  on conflict do nothing;

  -- 初期ナレッジドキュメントを 4 件追加 (Q&A コーナーの種)
  insert into public.community_qna_documents (community_id, title, content, created_by) values
  (
    v_community_id,
    'Geek とは',
    E'Geek は、アニメ・マンガ・ゲーム・推し活など、好きなことを語り合うための**匿名 SNS** です。\n\n'
    || E'## 基本コンセプト\n'
    || E'- **完全匿名**: 投稿者の名前は表示されません (公式コミュニティの管理者を除く)\n'
    || E'- **タグベース**: 好きなタグをフォロー、興味のないタグをブロック\n'
    || E'- **コミュニティ機能**: 同じ趣味の人が集まる小さな部屋を作れます\n'
    || E'- **公式コミュニティ**: 認証された組織や個人が運営する場 (このコミュニティもそう)\n\n'
    || E'## こんな人におすすめ\n'
    || E'- 自分の趣味を語りたいけど SNS の人間関係は面倒\n'
    || E'- 同じ作品が好きな人と感想を共有したい\n'
    || E'- 推しの活動情報を集めたい',
    v_admin_user_id
  ),
  (
    v_community_id,
    '使い方ガイド',
    E'## 投稿する\n'
    || E'1. ホーム右上の「+」ボタンをタップ\n'
    || E'2. 本文を書き、タグを付ける\n'
    || E'3. 公開範囲を選んで送信\n\n'
    || E'## コミュニティに参加する\n'
    || E'1. 「コミュニティ」タブ → 「探す」をタップ\n'
    || E'2. 興味のあるコミュニティを選んで「参加」\n'
    || E'3. open: 誰でも参加可 / request: 承認制 / invite: 招待制\n\n'
    || E'## 通報する\n'
    || E'投稿の「…」メニューから「通報」を選ぶと、運営に届きます。スパム・誹謗中傷・違反コンテンツは積極的に通報してください。',
    v_admin_user_id
  ),
  (
    v_community_id,
    'コミュニティガイドライン',
    E'Geek を健全に保つため、以下を禁止しています。\n\n'
    || E'## 禁止行為\n'
    || E'- 個人情報の晒し (住所・本名・電話番号など)\n'
    || E'- 誹謗中傷・ヘイトスピーチ\n'
    || E'- スパム投稿・宣伝目的の連投\n'
    || E'- 詐欺・違法薬物・暴力の誘発\n'
    || E'- なりすまし\n'
    || E'- 公式コミュニティになりすました偽コミュニティ\n\n'
    || E'## 推奨\n'
    || E'- 好きなことは思いっきり語ろう\n'
    || E'- 違う意見も尊重しよう\n'
    || E'- 困ったら通報ボタンへ\n\n'
    || E'違反が確認された場合、警告 → 制限 → 凍結 の段階で対応します。',
    v_admin_user_id
  ),
  (
    v_community_id,
    '公式コミュニティ申請について',
    E'公式コミュニティとは、認証された組織や個人が運営する場です。\n\n'
    || E'## 公式登録のメリット\n'
    || E'- **公式バッジ**が表示される (信頼性アップ)\n'
    || E'- 管理者だけは**匿名解除**される (実名 + 所属を表示)\n'
    || E'- **Q&Aコーナー**: 登録したナレッジから自動回答\n'
    || E'- **カレンダー**: イベント告知\n'
    || E'- **地図**: 聖地巡礼・観光地マッピング (地域活性化にも)\n\n'
    || E'## 申請手順\n'
    || E'1. まず通常のコミュニティを作成 (オーナーになる)\n'
    || E'2. コミュニティ詳細画面の「公式コミュニティとして申請する」をタップ\n'
    || E'3. 実名・所属・申請理由を入力して送信\n'
    || E'4. 運営が審査 (通常 1-3 営業日)\n'
    || E'5. 承認されると公式バッジが付き、選択した機能が有効になります\n\n'
    || E'**こんな方が公式登録に向いています**\n'
    || E'- 公式アニメ・ゲーム運営、出版社\n'
    || E'- 自治体・観光協会 (聖地巡礼や地域活性化)\n'
    || E'- 公認イベント・企業の広報窓口',
    v_admin_user_id
  );

  -- ようこそイベント (カレンダー)
  insert into public.community_calendar_events (community_id, title, description, starts_at, location, created_by) values
  (
    v_community_id,
    'Geek アプリ正式リリース',
    'Geek アプリの正式リリースを記念するマイルストーン。ぜひ感想や要望を投稿してください！',
    now(),
    'オンライン',
    v_admin_user_id
  );

  raise notice '[0033] Geek公式 community created with id=% admin=%', v_community_id, v_admin_user_id;
end $$;
