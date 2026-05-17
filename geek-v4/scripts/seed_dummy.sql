-- ============================================================
-- ダミーデータ投入：30ユーザー + 80投稿 + コメント + BBS + イベント
-- ============================================================

-- 1. ダミーユーザー30人
do $$
declare
  i int;
  uid uuid;
  email_addr text;
  nicknames text[] := array[
    'マサハル','レイナ','タカヒロ','ユウキ','アヤカ','ケンタ','ハルカ','リョウ','サキ','ダイチ',
    'ミナ','ソウタ','エリカ','タクミ','カナ','ヒロト','ナナミ','ショウ','メイ','ユウタ',
    'アオイ','ジュン','コハル','ナオキ','ミオ','タロウ','ハナコ','ケイ','リオ','カイト'
  ];
begin
  for i in 1..30 loop
    uid := gen_random_uuid();
    email_addr := 'dummy' || i || '_' || extract(epoch from now())::bigint || '@geek-seed.example';
    insert into auth.users (
      id, instance_id, aud, role, email,
      encrypted_password, email_confirmed_at,
      created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data
    ) values (
      uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email_addr,
      crypt('seed_dummy_pw', gen_salt('bf')), now() - (random() * interval '60 days'),
      now() - (random() * interval '90 days'), now(),
      '{"provider":"email"}'::jsonb,
      jsonb_build_object('nickname', nicknames[i])
    );
    update public.profiles set
      nickname = nicknames[i],
      onboarded = true,
      post_count = (random() * 30 + 5)::int,
      like_received_count = (random() * 200)::int,
      trust_score = (50 + random() * 40)::int
    where id = uid;
  end loop;
end $$;

-- 2. 投稿80件
do $$
declare
  uids uuid[];
  uid uuid;
  i int;
  tag_a text;
  tag_b text;
  tag_pool text[] := array['アニメ','ポケモン','ゲーム','VTuber','漫画','声優','コスプレ','アイドル','同人','映画','カメラ','鉄道'];
  sub_pool text[] := array['今期','感想','考察','レビュー','推し活','撮影','イベント','新作','配信','コラボ'];
  contents text[] := array[
    '今期のアニメ豊作すぎて見るの追いつかん',
    'ポケポケのパック開けすぎて課金止まらん',
    'FF14のレイド攻略、3日目でやっとクリアできた',
    'ホロライブの新衣装、絵師さん天才すぎる',
    '呪術廻戦最終巻、何度読んでも泣ける',
    'コスプレ衣装のウィッグセット、5時間かかった',
    '乃木坂のライブ前、徹夜で物販並んだら朝5時で諦めた',
    'カメラレンズ買ったけど沼すぎる',
    '推しの実況聞きながら作業はかどる',
    '同人誌即売会、明日の準備全然終わってない',
    'グッズの保管どうしてる？引き出しもう限界',
    '声優ラジオ、最近のテンション高すぎて笑った',
    'ハッシュタグ追ってたら時間溶けた',
    'コミケの戦利品まとめた。今年も買いすぎた',
    'にじさんじの新人ライバー、めっちゃおもろい',
    '原神ガチャ天井した。ピックアップこい',
    'アイドル現場、推しの目線もらえた気がする',
    'カメラ初心者だけどおすすめのレンズある？',
    '撮り鉄、今日も始発で出発',
    '邦画見てたら泣けた、おすすめ作品教えて',
    '最近のソシャゲ、シナリオが神すぎる',
    '推しのソロライブまでカウントダウン',
    '同担拒否って意味わからん派です',
    '深夜のオフ会、楽しすぎて記憶がない',
    'グッズ交換相手募集、DM待ってます',
    'ライブ後の余韻が消えない、明日仕事行きたくない',
    '声優のラジオ番組、深夜なのに毎週聴いてしまう',
    'カードゲームの大会出るか迷ってる',
    '原作読み返したらアニメの解釈違いに気付いた',
    'コラボカフェ全制覇したい',
    '推しの誕生日企画、何やろうか悩み中',
    '聖地巡礼してきた。完全再現で感動',
    'モンハン、レア素材1000周してもまだ出ない',
    'スプラトゥーンS+いけた',
    '配信切り抜きから本配信ハマる流れ',
    'コミティアの新刊、表紙が天才',
    'バンド系VTuberのカバー、声めちゃ合ってる',
    '今日のオフ会、推し色コーデで揃えた',
    'グッズ買いすぎて部屋が祭壇',
    '推しのソロ曲、何回聞いても泣ける',
    '同人誌の搬入準備、徹夜確定',
    'コミケ受かったぜ',
    'ライブBDの円盤化、待ちきれん',
    '声優の生誕祭、メッセージ送りまくった',
    'カメラの新機種、貯金崩しても買うか悩み中',
    '推しの公式SNS、フォロワー10万突破おめでとう',
    'コラボグッズ、転売価格になる前にゲットした',
    '深夜アニメ、寝不足覚悟で全部リアタイ',
    '聖地のカフェ、限定メニューが神レベル',
    '推し変じゃないけど新しい子も気になる',
    '同人イベント終わったら脱力する',
    '配信者の切り抜き動画、永遠に見れる',
    '推しの新曲MV、再生回数貢献中',
    'グッズ整理、半日かかった',
    'コミケサークル、設営完了',
    '推しのソロライブチケット当選した',
    '声優のサイン会、整理券ゲット',
    'ライブグッズの予約、戦争すぎる',
    'コラボカフェ、平日でも並ぶ',
    'カメラ仲間と聖地撮影会楽しかった'
  ];
begin
  select array_agg(id) into uids from auth.users where email like 'dummy%@geek-seed.example';
  if uids is null or array_length(uids, 1) is null then return; end if;

  for i in 1..80 loop
    uid := uids[1 + (i % array_length(uids, 1))];
    tag_a := tag_pool[1 + (i % array_length(tag_pool, 1))];
    tag_b := sub_pool[1 + ((i * 3) % array_length(sub_pool, 1))];
    insert into public.posts (
      author_id, content, tag_names, is_anonymous, is_public, kind,
      likes_count, comments_count, created_at
    ) values (
      uid,
      contents[1 + (i % array_length(contents, 1))],
      array[tag_a, tag_b],
      true, true,
      (array['opinion','opinion','opinion','joke','fact'])[1 + (i % 5)],
      (random() * 80)::int,
      (random() * 15)::int,
      now() - (random() * interval '30 days')
    );
  end loop;
end $$;

-- 3. タグ情報更新（既存タグに説明文＋メンバー数）
insert into public.tags (name, description, member_count, post_count, banner_color)
values
  ('アニメ', 'アニメ好きの集い。今期の感想、考察、評価などなんでも', 1240, 380, '#7C6AF7'),
  ('ポケモン', 'ポケモン全般。ゲーム・アニメ・カード・グッズ', 890, 220, '#F5A623'),
  ('ゲーム', 'ゲーム全般。レビュー・攻略・おすすめ・雑談', 1520, 410, '#22D3A4'),
  ('VTuber', 'バーチャル配信者を語るタグ', 780, 195, '#3B82F6'),
  ('コスプレ', '衣装制作・撮影・イベント情報', 460, 140, '#F472B6'),
  ('アイドル', '坂道・48G・地下・K-POP', 620, 175, '#F472B6'),
  ('声優', 'ラジオ・イベント・出演作の感想', 540, 130, '#7C6AF7'),
  ('漫画', '少年・少女・青年・BL・百合なんでも', 1100, 290, '#22D3A4'),
  ('同人', '即売会・創作・グッズ交換', 420, 110, '#F5A623'),
  ('映画', '邦画・洋画・アニメ映画', 380, 95, '#3B82F6'),
  ('カメラ', 'カメラ・レンズ・撮影', 290, 75, '#22D3A4'),
  ('鉄道', '撮り鉄・乗り鉄', 180, 50, '#3B82F6')
on conflict (name) do update set
  description = excluded.description,
  member_count = excluded.member_count,
  post_count = excluded.post_count,
  banner_color = excluded.banner_color;

-- 4. BBSスレッド + リプライ
do $$
declare
  uids uuid[];
  thread_id uuid;
  uid uuid;
  i int;
  j int;
  rep_count int;
  titles text[] := array[
    '今期最高のアニメOP教えて',
    'ガチでハマってるゲーム晒すスレ',
    'コスプレ衣装の保管方法相談',
    '推しに会えたエピソード語ろう',
    'グッズ交換相手募集（東京）',
    '最近のVTuber新人で注目してる人',
    '声優のラジオでおすすめある？',
    '同人誌即売会の準備どうしてる',
    'カメラ初心者の機材選び相談',
    '聖地巡礼でよかった場所教えて',
    '今期アニメの絶対覇権はどれ',
    'ポケカ価格高騰すぎて引退する人いる？'
  ];
  reply_contents text[] := array[
    'わかる', 'それな', '神', '同志おる！', '私もそれ気になってた',
    '最高', '優勝', '同感です', 'ガチで', 'うちのもおすすめ',
    'それは沼です', 'やめとけ（金がなくなる）', '激しく同意',
    'マジで時間溶ける', 'いつも応援してます', 'まじか',
    'すごい', '草', '神回', 'おもろい', 'やりますねぇ！',
    'それな〜', 'ぴえん', 'てぇてぇ'
  ];
  categories text[] := array['アニメ','ゲーム','コスプレ','雑談','声優','VTuber','同人','カメラ'];
begin
  select array_agg(id) into uids from auth.users where email like 'dummy%@geek-seed.example';
  if uids is null then return; end if;

  for i in 1..array_length(titles, 1) loop
    uid := uids[1 + (i % array_length(uids, 1))];
    insert into public.bbs_threads (author_id, title, category, replies_count, last_reply_at, created_at)
    values (
      uid, titles[i], categories[1 + (i % array_length(categories, 1))],
      0, null, now() - (random() * interval '14 days')
    ) returning id into thread_id;

    rep_count := 5 + (random() * 15)::int;
    for j in 1..rep_count loop
      uid := uids[1 + ((i * 7 + j) % array_length(uids, 1))];
      insert into public.bbs_replies (thread_id, author_id, content, created_at)
      values (
        thread_id, uid,
        reply_contents[1 + ((i + j) % array_length(reply_contents, 1))],
        now() - (random() * interval '10 days')
      );
    end loop;
  end loop;
end $$;

-- 5. カレンダーイベント
alter table public.events add column if not exists is_official boolean not null default true;
insert into public.events (title, description, event_date, tag_name, location, is_official)
values
  ('アニメ新番組キックオフ生放送', '今期のアニメをまとめて紹介', current_date + 3, 'アニメ', 'オンライン', true),
  ('コミックマーケット104', '夏のコミケ開催', current_date + 7, '同人', '東京ビッグサイト', true),
  ('ホロライブ4周年ライブ', '記念ライブ', current_date + 10, 'VTuber', '幕張メッセ', true),
  ('ポケモンセンター新作グッズ発売', '限定アイテム多数', current_date + 5, 'ポケモン', '全国', true),
  ('声優ラジオフェスティバル', '人気ラジオ番組勢揃い', current_date + 14, '声優', '横浜アリーナ', true),
  ('コスプレサミット', '世界規模のコスプレイベント', current_date + 21, 'コスプレ', '名古屋', true),
  ('FF14 新拡張パッチ配信', '新ストーリー解禁', current_date + 6, 'ゲーム', 'オンライン', true),
  ('坂道ライブ 渋谷', 'ファン感謝祭', current_date + 12, 'アイドル', '渋谷', true),
  ('呪術廻戦展', '原画展示', current_date + 28, '漫画', '東京', true),
  ('カメラ展 CP+', '最新機材展示', current_date + 18, 'カメラ', '横浜', true),
  ('にじさんじEN ライブ', '英語圏ライバー初の合同', current_date + 25, 'VTuber', '東京ドーム', true),
  ('M3-2026春', '音楽系同人即売会', current_date + 35, '同人', '東京流通センター', true)
on conflict do nothing;
