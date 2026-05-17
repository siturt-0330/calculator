-- ============================================================
-- ダミーデータの問題修正
-- ============================================================

-- 1. 「事実」投稿に出典URLを付与
do $$
declare
  rec record;
  urls text[] := array[
    'https://natalie.mu/comic',
    'https://anime.eiga.com/news/',
    'https://www.4gamer.net/',
    'https://gigazine.net/news/',
    'https://www.itmedia.co.jp/news/',
    'https://www.famitsu.com/news/',
    'https://animeanime.jp/article/',
    'https://www.oricon.co.jp/news/',
    'https://prtimes.jp/main/html/rd/p/',
    'https://www.nikkei.com/article/'
  ];
  i int := 0;
begin
  for rec in select id from public.posts where kind = 'fact' and source_url is null loop
    i := i + 1;
    update public.posts set source_url = urls[1 + ((i - 1) % array_length(urls, 1))] where id = rec.id;
  end loop;
end $$;

-- 2. 実際のコメントを投稿に紐づけて投入（テーマに沿った内容）
do $$
declare
  uids uuid[];
  uid uuid;
  pst record;
  i int;
  reply_count int;
  generic_replies text[] := array[
    'わかる', 'それな', '神', '同志おる！', '私もそれ気になってた',
    '最高', '優勝', '同感です', 'ガチで', '草', 'おもろい'
  ];
  themed text;
begin
  select array_agg(id) into uids from auth.users where email like 'dummy%@geek-seed.example';
  if uids is null then return; end if;

  for pst in select id, content, tag_names, comments_count from public.posts order by created_at desc limit 80 loop
    -- 既存のcomments_count分だけ実際のコメントを生成
    reply_count := least(pst.comments_count, 6); -- 最大6コメントに制限
    for i in 1..reply_count loop
      uid := uids[1 + ((i * 7 + length(pst.content)) % array_length(uids, 1))];
      -- タグに応じたテーマコメント
      themed := case
        when 'アニメ' = any(pst.tag_names) then (array['今期最強', 'OP神回', '作画ヤバい', 'これは覇権', '原作勢の感想は？', 'EDも泣ける', '声優ガチャ大当たり'])[1 + (i % 7)]
        when 'ポケモン' = any(pst.tag_names) then (array['色違い羨ましい', 'パック高すぎ', 'ポケポケ沼', '対戦勢ですか', 'リザードン狙い', '構築見せて'])[1 + (i % 6)]
        when 'ゲーム' = any(pst.tag_names) then (array['攻略動画見た', '俺もハマってる', 'これは時間溶ける', 'マルチで遊ぼ', 'シナリオ神', '課金不可避'])[1 + (i % 6)]
        when 'VTuber' = any(pst.tag_names) then (array['推しの新衣装可愛い', '配信時間長すぎ', 'コラボ最高', '同接やば', '切り抜きから入りました', '箱推し勢'])[1 + (i % 6)]
        when '漫画' = any(pst.tag_names) then (array['最新刊買った', '回想シーン泣いた', '伏線回収神', '原作派です', '〇〇推し', '展開予想'])[1 + (i % 6)]
        when 'コスプレ' = any(pst.tag_names) then (array['衣装どこの？', 'ウィッグ可愛い', 'メイク技術神', '撮影会楽しそう', '次のイベント参加します'])[1 + (i % 5)]
        when 'アイドル' = any(pst.tag_names) then (array['ライブ参戦予定', '推しの新曲神', 'グッズ並んだ', 'リリイベ行きたい', '同担さん？'])[1 + (i % 5)]
        when '声優' = any(pst.tag_names) then (array['ラジオ毎週聴いてる', 'イベント当選した', '出演作品全部見てる', 'サイン会並ぶ予定', '生誕祭参加'])[1 + (i % 5)]
        when '同人' = any(pst.tag_names) then (array['新刊楽しみ', 'コミケ受かった', '搬入の準備', 'スペース確認', '差し入れ持ってく'])[1 + (i % 5)]
        when '映画' = any(pst.tag_names) then (array['泣ける映画教えて', 'IMAXで観た', 'パンフ買った', '原作と比較', 'おすすめジャンルは？'])[1 + (i % 5)]
        when 'カメラ' = any(pst.tag_names) then (array['レンズ沼', 'ボディおすすめ', '作例見せて', '初心者です', '中古で揃えた'])[1 + (i % 5)]
        else generic_replies[1 + (i % array_length(generic_replies, 1))]
      end;
      insert into public.comments (post_id, author_id, content, avatar_color, created_at)
      values (
        pst.id, uid, themed,
        (array['#7C6AF7','#22D3A4','#F472B6','#F5A623','#3B82F6'])[1 + (i % 5)],
        now() - (random() * interval '20 days')
      );
    end loop;
    -- 実際の件数で更新
    update public.posts set comments_count = reply_count where id = pst.id;
  end loop;
end $$;

-- 3. BBS返信を全削除して、テーマに沿った会話を再投入
delete from public.bbs_replies where thread_id in (
  select id from public.bbs_threads
  where author_id in (select id from auth.users where email like 'dummy%@geek-seed.example')
);

do $$
declare
  uids uuid[];
  thread record;
  i int;
  uid uuid;
  reply_text text;
  themed_chain text[];
begin
  select array_agg(id) into uids from auth.users where email like 'dummy%@geek-seed.example';
  if uids is null then return; end if;

  for thread in select id, title from public.bbs_threads loop
    -- スレッドタイトルに応じた会話チェーン
    themed_chain := case
      when thread.title like '%アニメOP%' then array[
        '今期だと薬屋のヒトリゴトのOPが神',
        '↑同意。映像も曲も天才',
        'ダンダダンのOPも捨てがたい',
        '神作画と中毒性ある曲のコンボ強すぎる',
        '個人的にはフリーレンが今期一番',
        '↑分かる、しっとり系だけど何度も聴きたくなる',
        '配信サイトでOPだけ繰り返してる',
        'OP単体でCD買いたいレベル',
        '昔のアニメで言うとAngel BeatsのOPも好きだった',
        '世代によって名作OPあるよね',
        'EDも語りませんか',
        '今期ED神曲多い'
      ]
      when thread.title like '%ゲーム%' then array[
        'パルワールド未だにハマってる',
        '↑分かる、開拓ゲー無限に遊べる',
        '原神の新キャラ強すぎて環境壊した',
        'FF14は新拡張から復帰しました',
        '↑同じく、新ストーリー神でしたね',
        'モンハンワイルズ予約してる人いる？',
        '↑予約済み、楽しみすぎる',
        'スプラ3でガチアサリ嫌い派です',
        'ガチエリアの方が好きかも',
        'マイクラ友達と遊ぶの楽しすぎる',
        '↑分かる、建築だけで時間溶ける'
      ]
      when thread.title like '%コスプレ衣装%' then array[
        'プラ衣装ケースに防虫剤入れて保管してます',
        '↑防虫剤の種類教えて欲しい',
        'ムシューダ使ってます、無香タイプおすすめ',
        '↑ありがとう、買ってみます',
        'ウィッグはネット被せて吊るしてる',
        '↑型崩れ防止できますね',
        'クリーニングはどうしてる？',
        '基本は手洗い、汗かいた場合はすぐ洗濯',
        'プラケースだと湿気がこもらない？',
        '↑シリカゲル入れてます',
        '海外コスは生地が傷みやすいから注意'
      ]
      when thread.title like '%推し%エピソード%' then array[
        'ライブで目線もらえた気がする',
        '↑神イベントですね羨ましい',
        '高校生の時に握手会で泣いて推しに笑われた',
        '↑微笑ましいエピソード',
        '聖地巡礼してたら本人に遭遇した話',
        '↑運命では？',
        '生誕祭でメッセージ受け取ってもらえた',
        'ラジオで自分のメッセージ読まれた時は震えた',
        '↑同じく、永久保存案件',
        'コラボカフェで推しの担当回行ったらサプライズ来店'
      ]
      when thread.title like '%グッズ交換%' then array[
        '○○の缶バッジ放出します。希望者DMください',
        '↑種類教えてもらえますか',
        'A・B・E推しのアクスタあります。譲渡可',
        '○○とのトレード希望です',
        'スペースで直接交換できる方優先します',
        '東京近郊で対面交換可能な方いますか',
        '↑当方池袋付近です',
        '郵送派です。レターパックライト派',
        '梱包は厳重にお願いします',
        '前回のトラブルがあったので慎重派です'
      ]
      when thread.title like '%VTuber新人%' then array[
        'ホロライブの新人勢、伸び方すごい',
        '↑同接ヤバいよね',
        'にじさんじの新ライバーで歌うまい子いますよね',
        '○○ちゃん推し始めました',
        '↑切り抜きから入った組',
        'インディーで応援したい子もいる',
        '中身バレ気にしないタイプです',
        '純粋にキャラを楽しむ派',
        '配信スタイルで判断したい',
        '初配信のテンションが大事'
      ]
      when thread.title like '%声優%ラジオ%' then array[
        '○○のラジオ深夜なのに必聴',
        '↑分かる、寝不足覚悟で聴いてる',
        'メール採用されると嬉しい',
        '声優ラジオは内輪トークが面白い',
        'パーソナリティの相性が大事だよね',
        '番組終了お知らせ来た時の絶望感',
        'タイムフリーで聴き直す派',
        'ハッシュタグ追ってるけど時間溶ける'
      ]
      when thread.title like '%同人誌即売会%' then array[
        '搬入準備で徹夜確定です',
        '↑頑張って！',
        '新刊何冊刷るか毎回悩む',
        '少なめに刷って後日通販で増刷派',
        '当日のお品書きはSNSに上げる予定',
        '差し入れは何が喜ばれる？',
        '↑お菓子が定番ですが、保冷の必要ないものがいいです',
        'お釣りの準備忘れがち'
      ]
      when thread.title like '%カメラ%' then array[
        'まずはエントリー機種から始めるのがおすすめ',
        '↑どこのメーカーがいいですか？',
        'Sony α6400 が初心者には扱いやすい',
        'Canon の R10 もコスパいい',
        '↑Canonいいですよね、グリップ握りやすい',
        'レンズは沼です、注意してください',
        '中古市場も検討してみるといい',
        'メルカリで意外といい出物ある',
        '初心者なら単焦点1本買って勉強するのが王道'
      ]
      when thread.title like '%聖地巡礼%' then array[
        '神田明神（ラブライブ）は外せない',
        '↑階段で写真撮ってる人多いですよね',
        '鎌倉高校前駅（スラムダンク）は混雑必至',
        '聖地カフェ巡りで全国回ってます',
        '長野県の上田が真田丸＆サマーウォーズで聖地',
        '岐阜の飛騨高山も君の名はで人気',
        '↑朝早く行くのがおすすめ',
        '聖地巡礼マップ作ってる',
        '地方の聖地はホスピタリティすごい'
      ]
      when thread.title like '%今期アニメ%絶対覇権%' then array[
        '今期は薬屋・ダンダダン・フリーレンの三国時代',
        '↑同感、どれも違うジャンルで覇権争い',
        '個人的にはアオハコもダークホース',
        '↑甘酸っぱくていいよね',
        'リゼロ3期来てくれ',
        '原作勢としてはダンダダンの作画が想像超えてきた',
        '薬屋の演出本当に上手い'
      ]
      when thread.title like '%ポケカ価格%' then array[
        '高すぎて引退視野',
        '↑分かる、子供時代に集めてた身としては悲しい',
        '転売価格は無視して定価で集めるのが吉',
        '↑そもそも定価で買えない問題',
        'ポケポケに移行した人多い',
        'リアルカードは飾る用で買ってる',
        '↑お金あって羨ましい'
      ]
      else array[
        'いい話題ですね',
        '私もそう思ってました',
        '皆さんの意見聞きたい',
        '具体的に教えてください',
        '↑分かりやすい説明ありがとう',
        '面白い視点ですね'
      ]
    end;
    -- スレッドに10件のコメント追加
    for i in 1..array_length(themed_chain, 1) loop
      uid := uids[1 + ((i * 11 + length(thread.title)) % array_length(uids, 1))];
      reply_text := themed_chain[i];
      insert into public.bbs_replies (thread_id, author_id, content, created_at)
      values (
        thread.id, uid, reply_text,
        now() - (random() * interval '7 days')
      );
    end loop;
    -- 返信数を実際の値に更新
    update public.bbs_threads
    set replies_count = (select count(*) from public.bbs_replies where thread_id = thread.id),
        last_reply_at = (select max(created_at) from public.bbs_replies where thread_id = thread.id)
    where id = thread.id;
  end loop;
end $$;

select 'fix complete' as status,
  (select count(*) from public.comments) as total_comments,
  (select count(*) from public.bbs_replies) as bbs_replies,
  (select count(*) from public.posts where kind='fact' and source_url is not null) as fact_with_url;
