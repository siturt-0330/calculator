-- ============================================================
-- ダミーデータ v2 (改訂): 具体的な名前 / 写真 / リンク / 会話
-- 車 / バイク / アニメ / アイドル / Vtuber / スポーツ /
-- 俳優 / 女優 / モデル / 芸能人 / YouTuber / ビジネス
--
-- 再実行可能: 古い v2 データを先に消してから再投入する
-- ============================================================

-- ============================================================
-- 0. クリーンアップ (前回投入の v2 を全削除 → CASCADE で全消し)
-- ============================================================
delete from auth.users where email like 'dummy_v2_%@geek-seed.example';

-- ============================================================
-- 1. ダミーユーザー 60 人 (個性のあるニックネーム)
-- ============================================================
do $$
declare
  i int;
  uid uuid;
  email_addr text;
  nicknames text[] := array[
    'カイト','レン','ハルキ','ソウタ','ユウマ','イオリ','タイガ','ノア','コウキ','リク',
    'シュン','ヒナタ','タクヤ','テツヤ','ユウト','カズキ','ハヤト','タツヤ','ケイ','ナギ',
    'マコト','フウタ','ショウタ','ダイチ','ハルト','コタロウ','ジュンヤ','ヨウスケ','ハジメ','カナデ',
    'アスカ','ミナト','イチカ','ハナ','カエデ','エマ','リコ','ユイ','ミウ','アヤカ',
    'コハル','ミハル','ミサキ','ノゾミ','ナナ','カナエ','リオ','メイ','ヒメカ','チサト',
    'ユリア','レイラ','アユミ','フウカ','エリ','ミオ','サキ','カナ','ナナミ','アカリ'
  ];
begin
  for i in 1..60 loop
    uid := gen_random_uuid();
    email_addr := 'dummy_v2_' || i || '_' || extract(epoch from now())::bigint || '@geek-seed.example';
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
      post_count = (random() * 60 + 10)::int,
      like_received_count = (random() * 500 + 20)::int,
      trust_score = (50 + random() * 45)::int
    where id = uid;
  end loop;
end $$;

-- ============================================================
-- 2. タグ (12テーマ + サブタグ)
-- ============================================================
insert into public.tags (name, description, member_count, post_count, banner_color) values
  ('車',           '車好き集合。スポーツカー、セダン、SUV、軽、なんでも',     980,  240, '#EF4444'),
  ('スポーツカー', 'GR86、シビックタイプR、ロードスター、フェアレディZ etc', 420,   95, '#DC2626'),
  ('EV',           'テスラ、リーフ、サクラなど電気自動車',                    280,   65, '#10B981'),
  ('バイク',       'バイク全般。納車・ツーリング・整備・装備',                760,  185, '#F59E0B'),
  ('ツーリング',   '日帰り・宿泊・キャンツー',                                360,   78, '#FBBF24'),
  ('ネイキッド',   'CB400SF、Z900RS、MT-07 etc.',                             220,   50, '#F97316'),
  ('アニメ',       '今期感想・考察・推し作品語る場',                         1850,  520, '#7C6AF7'),
  ('鬼滅の刃',     '無限城編・アニメ・原作・グッズ',                          650,  170, '#7C3AED'),
  ('呪術廻戦',     'アニメ・原作・劇場版',                                    540,  130, '#5B21B6'),
  ('葬送のフリーレン', 'マッドハウス制作、世界観が美しい',                    320,   80, '#8B5CF6'),
  ('アイドル',     '坂道・48G・地下・スターダスト',                           920,  240, '#F472B6'),
  ('乃木坂46',     '生写真・ライブ・卒コン',                                  480,  130, '#EC4899'),
  ('日向坂46',     'おひさま集合',                                            360,   95, '#FB7185'),
  ('Vtuber',       'ホロ・にじ・個人勢なんでも',                             1240,  340, '#A78BFA'),
  ('ホロライブ',   'ホロのライバー・配信・グッズ',                            680,  180, '#8B5CF6'),
  ('にじさんじ',   'にじライバー・コラボ・記念配信',                          510,  140, '#6366F1'),
  ('スポーツ',     '野球・サッカー・F1・テニス・バスケなんでも',              780,  200, '#22D3A4'),
  ('野球',         'MLB・NPB・大谷翔平・推し球団',                            420,  110, '#14B8A6'),
  ('サッカー',     '日本代表・プレミア・Jリーグ',                             390,   95, '#06B6D4'),
  ('F1',           'F1グランプリ・推しドライバー',                            180,   45, '#0EA5E9'),
  ('俳優',         '邦画・洋画・ドラマで活躍する俳優',                        520,  130, '#3B82F6'),
  ('女優',         '映画・ドラマ・舞台',                                      560,  140, '#FB7185'),
  ('モデル',       'ファッションモデル・読者モデル',                          440,  100, '#F472B6'),
  ('芸能人',       '芸能界全般・スキャンダル・復帰・新作情報',                680,  170, '#FBBF24'),
  ('ジャニーズ',   'SMILE-UP. 旧ジャニ・新事務所',                            480,  120, '#F59E0B'),
  ('YouTuber',     '登録者・企画・案件・コラボ',                              890,  230, '#EF4444'),
  ('ヒカキン',     'キング・コラボ・新企画',                                  340,   85, '#DC2626'),
  ('コムドット',   'やまと・ひゅうが・ゆうた・あむぎり・ゆうま',              280,   70, '#B91C1C'),
  ('ビジネス',     '副業・転職・起業・投資',                                  620,  150, '#10B981'),
  ('副業',         'ブログ・物販・スキル販売・案件',                          310,   75, '#059669'),
  ('投資',         'インデックス・個別株・FIRE',                              290,   68, '#047857')
on conflict (name) do update set
  description  = excluded.description,
  member_count = excluded.member_count,
  post_count   = excluded.post_count,
  banner_color = excluded.banner_color;

-- ============================================================
-- 3. 投稿 (具体名+写真+ソースURLつき、12テーマ×15=180投稿)
-- ============================================================
do $$
declare
  uids uuid[];
  uid uuid;
  i int;
  contents text[];
  medias text[];     -- '' = 写真なし、それ以外 = 単一画像URL
  sources text[];    -- '' = ソースなし
  subtags text[];
  primary_tag text;
  kinds text[] := array['opinion','opinion','opinion','fact','joke','wip'];
begin
  select array_agg(id order by id) into uids from auth.users
    where email like 'dummy_v2_%@geek-seed.example';
  if uids is null then return; end if;

  ----------------------------------------------------------------
  -- 車 (15 投稿)
  ----------------------------------------------------------------
  primary_tag := '車';
  contents := array[
    'GR86納車3ヶ月目。シフトフィールがND2ロードスターより少し重めで、2.4Lの低回転トルクが太い。峠でハチロクと並走したけど明らかにこっちが有利。',
    'シビックタイプR FL5、サーキット試走してきた。FK8より明らかに速いし足が硬すぎず街乗りも余裕。VTECの切り替わりが官能的。',
    'BMW M3 G80 コンペティション試乗。S58エンジンの直6ターボ、510馬力は伊達じゃない。アクラポビッチのマフラー入れたい衝動。',
    'ND2ロードスターRF、屋根開閉のメカニズムが芸術。1.5Lでも軽いボディだから峠は十分楽しい。NCもいいけどNDのデザイン勝ちかな',
    'GT-R R34 BNR34 中古市場、平均1500万超え。買えないけど見るたび鳥肌。映画ワイルドスピードの影響えぐい',
    'フェアレディZ Z34→RZ34に乗り換え検討中。V6 3.0Lツインターボ、デザインも新世代で攻めてる。マニュアル6速設定が嬉しい',
    'テスラ モデル3パフォーマンス納車。0-100km/h 3.3秒、加速がジェットコースター。オートパイロット高速で重宝してる',
    'マツダ3 ファストバック XD、ディーゼル燃費リッター18kmで満足。デザインの完成度はMAZDA歴代でも最高クラス',
    'スバル BRZ tS、レカロシート最高すぎる。GR86と兄弟車だけど足のセッティングは BRZの方が好み',
    'ホンダ シビック e:HEV、ハイブリッドなのに走りが楽しい。タイプRには敵わないけど街乗り万能',
    'トヨタ アルファード新型、後部座席が応接室。家族持ちの友達に乗せてもらったけど運転手と乗客で世界が違いすぎる',
    'スズキ ジムニーJB64、納車待ち1年半。マニュアル設定にこだわってシエラより小さい方を選んだ',
    'メルセデス AMG GT R、見るたび芸術品。ヤナセ中古でも2000万コース、現実的じゃないけど夢として',
    'レクサス LBX、SUVなのに低重心で運転楽しい。レクサスのエントリーモデルとしては完成度高い',
    'ニッサン サクラ、軽EVだけど街乗り最強。リッター換算燃費もすごい、ガソリン高騰時代にぴったり'
  ];
  medias := array[
    'https://picsum.photos/seed/gr86/800/600',
    '',
    'https://picsum.photos/seed/m3/800/600',
    'https://picsum.photos/seed/nd-roadster/800/600',
    '',
    'https://picsum.photos/seed/z34/800/600',
    '',
    'https://picsum.photos/seed/mazda3/800/600',
    '',
    '',
    'https://picsum.photos/seed/alphard/800/600',
    'https://picsum.photos/seed/jimny/800/600',
    'https://picsum.photos/seed/amg-gtr/800/600',
    '',
    ''
  ];
  sources := array[
    '', '', 'https://response.jp/article/2024/11/15/378234.html', '', '',
    '', 'https://www.tesla.com/jp/model3', '', '', '',
    '', '', '', 'https://lexus.jp/models/lbx/', ''
  ];
  subtags := array['スポーツカー','スポーツカー','スポーツカー','スポーツカー','スポーツカー',
                   'スポーツカー','EV','車','スポーツカー','車',
                   '車','車','車','車','EV'];
  for i in 1..array_length(contents,1) loop
    uid := uids[1 + ((i * 7) % array_length(uids,1))];
    insert into public.posts (
      author_id, content, tag_names, media_urls, source_url, is_anonymous, is_public, kind,
      likes_count, comments_count, trust_score_at_post, created_at
    ) values (
      uid, contents[i], array[primary_tag, subtags[i]],
      case when medias[i] = '' then array[]::text[] else array[medias[i]] end,
      nullif(sources[i], ''),
      true, true,
      kinds[1 + (i % 6)],
      (random() * 200 + 5)::int,
      (random() * 15)::int,
      (60 + random() * 35)::int,
      now() - (random() * interval '20 days')
    );
  end loop;

  ----------------------------------------------------------------
  -- バイク (15 投稿)
  ----------------------------------------------------------------
  primary_tag := 'バイク';
  contents := array[
    'カワサキ Z900RS 納車。CB1300SFと迷ったけどデザインで完敗。ICONカラー、見るたびテンション上がる',
    'ヤマハ MT-09 SP、3気筒の音と振動が官能的。Z900より軽くて取り回し楽。電子制御も最新',
    'ホンダ CB400SF Revo 中古納車。教習所バイクの最終モデル、生産終了惜しい。エンジン回した時のVTEC感最高',
    'スズキ GSX-R750、絶版車だけど中古で40万。S1000RRには敵わないけどコーナリングの軽さは別格',
    'ハーレー Fat Boy 試乗。500kg超えだけど座ると意外と安定。1900ccのトルクで街乗りでも7速ほぼ使わない',
    'BMW R1250GS、長距離ツーリングの王者。北海道一周してきたけど疲労感が全然違う',
    'ドゥカティ パニガーレV4、L4エンジンの音が芸術。電子制御も最先端で素人でも乗れる',
    'スーパーカブ110 でツーリング、リッター70km走る。バイク便のおっちゃんが選ぶ理由がわかる',
    'カワサキ Ninja400 から ZX-25R に乗り換え。4気筒250ccの咆哮、絶滅危惧種。回せば回すほど化ける',
    'ホンダ レブル250、初心者用と思われがちだけど見た目クラシックで街乗り最高',
    'ヤマハ SR400 ファイナル、フルレストア完了。キックスタートでバイク乗ってる感が違う',
    'スズキ Vストローム800DE、林道アドベンチャーの新定番。中古GS650Fから乗り換え',
    'カワサキ W800、新車100万切る価格でクラシックスタイル。レトロな見た目でツーリング最高',
    'タンクバッグ買い替え。GIVI製の防水タイプ、雨ツーリングでもスマホ濡れない',
    'バイク用ヘルメット、Araiから Shoei Z-8 に乗り換え。風切り音が明らかに減った'
  ];
  medias := array[
    'https://picsum.photos/seed/z900rs/800/600',
    'https://picsum.photos/seed/mt09/800/600',
    '',
    '',
    'https://picsum.photos/seed/fatboy/800/600',
    'https://picsum.photos/seed/r1250gs/800/600',
    'https://picsum.photos/seed/panigale/800/600',
    '',
    'https://picsum.photos/seed/zx25r/800/600',
    '',
    'https://picsum.photos/seed/sr400/800/600',
    '',
    '',
    '',
    ''
  ];
  sources := array[
    'https://www.kawasaki-motors.com/ja/mc/motorcycle/z900rs/',
    'https://www.yamaha-motor.co.jp/mc/lineup/mt09sp/', '', '', '',
    '', '', '', 'https://www.kawasaki-motors.com/ja/mc/motorcycle/zx25r/', '',
    '', '', '', '', ''
  ];
  subtags := array['ネイキッド','ネイキッド','ネイキッド','バイク','バイク',
                   'ツーリング','バイク','ツーリング','バイク','バイク',
                   'ネイキッド','ツーリング','ネイキッド','バイク','バイク'];
  for i in 1..array_length(contents,1) loop
    uid := uids[1 + ((i * 11) % array_length(uids,1))];
    insert into public.posts (
      author_id, content, tag_names, media_urls, source_url, is_anonymous, is_public, kind,
      likes_count, comments_count, trust_score_at_post, created_at
    ) values (
      uid, contents[i], array[primary_tag, subtags[i]],
      case when medias[i] = '' then array[]::text[] else array[medias[i]] end,
      nullif(sources[i], ''),
      true, true,
      kinds[1 + (i % 6)],
      (random() * 180 + 5)::int,
      (random() * 12)::int,
      (60 + random() * 35)::int,
      now() - (random() * interval '20 days')
    );
  end loop;

  ----------------------------------------------------------------
  -- アニメ (15 投稿)
  ----------------------------------------------------------------
  primary_tag := 'アニメ';
  contents := array[
    '鬼滅の刃 無限城編 第7話、上弦の伍 玉壺戦。ufotable の水面エフェクトが化け物すぎる。胡蝶しのぶの花の呼吸も神作画',
    '呪術廻戦 渋谷事変 完結、五条悟封印シーンで号泣。MAPPAの作画クオリティ全話通してエグかった',
    '葬送のフリーレン 2期、フリーレンとフェルンのやり取りに毎週癒される。マッドハウス頑張ってる',
    'スパイファミリー シーズン2、アーニャの「ちち」「はは」呼びがあざとくて好きすぎる',
    'チェンソーマン 第2部 始まる前に第1部見直し。MAPPA作画ヤバいけど原作の狂気もすごい',
    'ぼっち・ざ・ろっく 劇場版総集編、後藤ひとりの新規カットあるって！ヤマカン参戦も話題',
    '進撃の巨人 完結編、リヴァイ兵長 vs ジーク兵長戦のアニメ作画が原作越え。WIT→MAPPAでも完璧',
    '推しの子 アクア最終回、原作の衝撃を完全再現。アニメ2期はどこまでやるのか',
    'ジョジョ ストーンオーシャン Netflix 全話一気見。徐倫の声、ファイルーズあいさん完璧',
    'ワンピース エッグヘッド編、ベガパンクの正体明かしが熱い。WIT制作のFILM RED の流れ',
    '薬屋のひとりごと 2期決定、猫猫の推理パートまだまだ続く。日本テレビ枠で時間帯絶妙',
    'ダンダダン アニメ化、サイエンスSARU 制作。原作のドタバタ感アニメで再現できるか期待',
    '名探偵コナン 100巻記念、劇場版「黒鉄の魚影」とリンクする原作展開アツい',
    'クレヨンしんちゃん 映画「オラたちの恐竜日記」、子供向けと侮れない泣ける展開',
    '機動戦士ガンダム 水星の魔女、スレッタとミオリネの関係性が世界中で話題'
  ];
  medias := array[
    'https://picsum.photos/seed/kimetsu/800/600',
    '',
    'https://picsum.photos/seed/frieren/800/600',
    '',
    '',
    'https://picsum.photos/seed/bocchi/800/600',
    'https://picsum.photos/seed/aot/800/600',
    '',
    'https://picsum.photos/seed/jojo/800/600',
    'https://picsum.photos/seed/onepiece/800/600',
    '',
    '',
    'https://picsum.photos/seed/conan/800/600',
    '',
    'https://picsum.photos/seed/gundam-witch/800/600'
  ];
  sources := array[
    'https://kimetsu.com/anime/movie/mugenjyohen/',
    'https://jujutsukaisen.jp/',
    'https://frieren-anime.jp/',
    'https://spy-family.net/',
    'https://chainsawman.dog/',
    '', '', 'https://ichigoproduction.com/', '', '',
    '', '', '', '', ''
  ];
  subtags := array['鬼滅の刃','呪術廻戦','葬送のフリーレン','アニメ','アニメ',
                   'アニメ','アニメ','アニメ','アニメ','アニメ',
                   'アニメ','アニメ','アニメ','アニメ','アニメ'];
  for i in 1..array_length(contents,1) loop
    uid := uids[1 + ((i * 13) % array_length(uids,1))];
    insert into public.posts (
      author_id, content, tag_names, media_urls, source_url, is_anonymous, is_public, kind,
      likes_count, comments_count, trust_score_at_post, created_at
    ) values (
      uid, contents[i], array[primary_tag, subtags[i]],
      case when medias[i] = '' then array[]::text[] else array[medias[i]] end,
      nullif(sources[i], ''),
      true, true,
      kinds[1 + (i % 6)],
      (random() * 250 + 10)::int,
      (random() * 20)::int,
      (60 + random() * 35)::int,
      now() - (random() * interval '20 days')
    );
  end loop;

  ----------------------------------------------------------------
  -- アイドル (15 投稿)
  ----------------------------------------------------------------
  primary_tag := 'アイドル';
  contents := array[
    '乃木坂46 賀喜遥香 卒業発表きた。山下美月・与田祐希との3トップ時代終わり。次期センターは久保史緒里か遠藤さくらか',
    '日向坂46 小坂菜緒 復帰ツアー、最終公演の幕張メッセ参戦。「Boom Boom Beat」のセンター復帰で号泣',
    '櫻坂46 山崎天 1stセンター「Start over!」MV解禁。森田ひかるとのWセンター期間が伝説的',
    'AKB48 64thシングル選抜発表、本田仁美のセンター継続。次世代のIZ*ONE組がついに本格始動',
    'STU48 船上劇場、出航から5年。瀬戸内ファンのため地元巡業継続中。瀧野由美子の卒業惜しい',
    '元乃木坂 西野七瀬 ドラマ「あなたの代わり」主演、女優として確立した。アイドル時代知らない世代も増えそう',
    '生田絵梨花 ミュージカル「キンキーブーツ」観てきた。歌唱力レベル、もう乃木坂時代の比じゃない',
    '齋藤飛鳥 写真集「真夜中の意識」発売即重版。表現力に磨きがかかってきた',
    '櫻坂46 守屋麗奈 卒業発表、卒コンチケット争奪戦が始まる',
    '日向坂46 加藤史帆 卒業ライブ、Mステで歌った「ドレミソラシド」が伝説回',
    '乃木坂46 27thシングル「タイムマシンでも」、賀喜遥香センターの暫定ラストシングル',
    '坂道合同オーディション、6期生選抜で大波乱。地方民の応募も増加',
    'AKB48 チーム8 全国ツアー、47都道府県完走。地方アイドル文化を作った功績デカい',
    'ハロプロ モーニング娘。'24 「ピーマンとマリトッツォ」、譜久村卒業後の新体制発表',
    'BiSH 解散から3年、メンバー各々ソロ活動。セントチヒロ・チッチがソロライブ快進撃'
  ];
  medias := array[
    '',
    'https://picsum.photos/seed/hinatazaka/800/600',
    'https://picsum.photos/seed/sakurazaka/800/600',
    '',
    'https://picsum.photos/seed/stu48/800/600',
    '', '', 'https://picsum.photos/seed/asuka-photo/800/600',
    '', '', '', '', '', '', ''
  ];
  sources := array[
    'https://www.nogizaka46.com/news/',
    'https://www.hinatazaka46.com/news/',
    'https://sakurazaka46.com/s/s46/news/',
    'https://www.akb48.co.jp/news/',
    '', '', '', '', '', '',
    '', '', '', '', ''
  ];
  subtags := array['乃木坂46','日向坂46','アイドル','アイドル','アイドル',
                   '乃木坂46','乃木坂46','乃木坂46','アイドル','日向坂46',
                   '乃木坂46','アイドル','アイドル','アイドル','アイドル'];
  for i in 1..array_length(contents,1) loop
    uid := uids[1 + ((i * 17) % array_length(uids,1))];
    insert into public.posts (
      author_id, content, tag_names, media_urls, source_url, is_anonymous, is_public, kind,
      likes_count, comments_count, trust_score_at_post, created_at
    ) values (
      uid, contents[i], array[primary_tag, subtags[i]],
      case when medias[i] = '' then array[]::text[] else array[medias[i]] end,
      nullif(sources[i], ''),
      true, true,
      kinds[1 + (i % 6)],
      (random() * 220 + 10)::int,
      (random() * 18)::int,
      (60 + random() * 35)::int,
      now() - (random() * interval '20 days')
    );
  end loop;

  ----------------------------------------------------------------
  -- Vtuber (15 投稿)
  ----------------------------------------------------------------
  primary_tag := 'Vtuber';
  contents := array[
    '兎田ぺこら の新衣装お披露目、ホロライブ5周年記念。絵師しぐれういさん仕事早すぎ。ドレスアップver完璧',
    '宝鐘マリン 3D配信、海賊衣装のリッチ感。歌枠の表現力は声優級',
    '葛葉×叶 のChroNoiR 「VALORANT」 連戦、相変わらず神コンビ。配信時間4時間でも飽きない',
    '月ノ美兎 初配信から5年、にじさんじの委員長として君臨。古参 vs 新規ファンの温度差はあるけど',
    '雪花ラミィ お酒企画、日本酒の知識ガチ勢。ホロ4期生でホロを背負ってる',
    '戌神ころね Twitch 同時配信、ホロ初の試み。アメリカファン層獲得の戦略',
    'にじさんじ 不破湊 のホスト配信、キャラ崩壊で大草原。普段のクール路線とのギャップ',
    'ホロライブEN Calliope Mori の新曲、Spotify 上位入り。VTuber が音楽業界で戦える時代',
    '加賀美ハヤト 社長配信、にじさんじ社員ロールプレイのレベルが高すぎる',
    '個人勢 ピーナッツくん、企業ホロにじ並みの再生数。VTuber業界の地殻変動',
    'ホロライブ 0期生 ときのそら、デビュー7年。先駆者の存在感は別格',
    '響木アオ、個人勢から事務所所属に移行。VTuber業界の生存戦略',
    'にじさんじ ANYCOLOR 株価、上場時より下がってるけどファン文化は健在',
    'ホロライブEXPO 2026 開催決定、グッズ売り場が戦場になる',
    'VTuber スパチャ年間1億超え、上位陣の経済規模が想像以上'
  ];
  medias := array[
    'https://picsum.photos/seed/pekora/800/600',
    'https://picsum.photos/seed/marine/800/600',
    '',
    '',
    'https://picsum.photos/seed/lamy/800/600',
    '', '', '', '', '', '', '', '', '', ''
  ];
  sources := array[
    'https://hololive.hololivepro.com/talents/usada-pekora/',
    'https://hololive.hololivepro.com/talents/houshou-marine/',
    'https://www.nijisanji.jp/',
    '', '', '', '', 'https://open.spotify.com/artist/4OTzWqRwIDH3kp0PoSmTja',
    '', '', '', '', '', 'https://hololive.hololivepro.com/news/',
    ''
  ];
  subtags := array['ホロライブ','ホロライブ','にじさんじ','にじさんじ','ホロライブ',
                   'ホロライブ','にじさんじ','ホロライブ','にじさんじ','Vtuber',
                   'ホロライブ','Vtuber','にじさんじ','ホロライブ','Vtuber'];
  for i in 1..array_length(contents,1) loop
    uid := uids[1 + ((i * 19) % array_length(uids,1))];
    insert into public.posts (
      author_id, content, tag_names, media_urls, source_url, is_anonymous, is_public, kind,
      likes_count, comments_count, trust_score_at_post, created_at
    ) values (
      uid, contents[i], array[primary_tag, subtags[i]],
      case when medias[i] = '' then array[]::text[] else array[medias[i]] end,
      nullif(sources[i], ''),
      true, true,
      kinds[1 + (i % 6)],
      (random() * 250 + 10)::int,
      (random() * 20)::int,
      (60 + random() * 35)::int,
      now() - (random() * interval '20 days')
    );
  end loop;

  ----------------------------------------------------------------
  -- スポーツ (15 投稿)
  ----------------------------------------------------------------
  primary_tag := 'スポーツ';
  contents := array[
    '大谷翔平、6月終了時点で23本塁打。今年は確実に40超える勢い。山本由伸との二刀流ファンサービスも復活',
    '佐々木朗希、ロサンゼルス・ドジャース完全移籍。日本人投手史上最高契約クラス。前田健太との競合心配',
    '三笘薫 ブライトン残留、来季もプレミアで暴れる。チェルシー移籍噂は否定。ロドリゲス監督との関係良好',
    '久保建英 レアル・ソシエダ、CL出場圏で快進撃。次のステップでバルサ・レアル復帰の噂',
    'マックス・フェルスタッペン F1 4連覇かかる2026シーズン。ハミルトンのフェラーリ移籍で勢力図変わる',
    '八村塁 NBAレイカーズ、レブロン引退前に何としてもプレーオフ突破したい',
    '井上尚弥 5階級制覇達成、PFP1位の座は揺るがず。サウルアバとの統一戦実現するか',
    '渡邊雄太 NBA 2way契約、サンズで再起。八村との日本人共演実現するか',
    '高橋藍 バレーボール男子日本代表、世界選手権で銀メダル。石川祐希とのコンビは世界水準',
    '藤井聡太 8冠失冠 後の竜王戦、伊藤匠と再戦。将棋史に残る世代交代の瀬戸際',
    '羽生結弦 プロ転向後の単独公演、毎回チケット即完売。フィギュアスケート界への影響力',
    '日本代表 サッカー W杯予選、シンガポール戦5-0完勝。三笘・久保・南野の3トップ機能',
    'プレミアリーグ アーセナル vs マンチェスター C、優勝争いが熾烈。富安健洋のコンディション鍵',
    'NBAドラフト 八村塁から数年、日本人プレーヤーが続く。富永啓生がNBAテストで好評価',
    'マリナーズ vs エンゼルス、大谷とイチローの再会試合（始球式）。野球界の歴史的瞬間'
  ];
  medias := array[
    'https://picsum.photos/seed/ohtani/800/600',
    'https://picsum.photos/seed/sasaki/800/600',
    'https://picsum.photos/seed/mitoma/800/600',
    'https://picsum.photos/seed/kubo/800/600',
    'https://picsum.photos/seed/verstappen/800/600',
    '', '', '', '', '', '', '', '', '', ''
  ];
  sources := array[
    'https://www.mlb.com/dodgers/news',
    'https://www.mlb.com/dodgers/news',
    'https://www.brightonandhovealbion.com/',
    'https://www.realsociedad.eus/',
    'https://www.formula1.com/',
    '', '', '', '', '', '', '', '', '', ''
  ];
  subtags := array['野球','野球','サッカー','サッカー','F1',
                   'スポーツ','スポーツ','スポーツ','スポーツ','スポーツ',
                   'スポーツ','サッカー','サッカー','スポーツ','野球'];
  for i in 1..array_length(contents,1) loop
    uid := uids[1 + ((i * 23) % array_length(uids,1))];
    insert into public.posts (
      author_id, content, tag_names, media_urls, source_url, is_anonymous, is_public, kind,
      likes_count, comments_count, trust_score_at_post, created_at
    ) values (
      uid, contents[i], array[primary_tag, subtags[i]],
      case when medias[i] = '' then array[]::text[] else array[medias[i]] end,
      nullif(sources[i], ''),
      true, true,
      kinds[1 + (i % 6)],
      (random() * 200 + 10)::int,
      (random() * 18)::int,
      (60 + random() * 35)::int,
      now() - (random() * interval '20 days')
    );
  end loop;

  ----------------------------------------------------------------
  -- 俳優 (15 投稿)
  ----------------------------------------------------------------
  primary_tag := '俳優';
  contents := array[
    '菅田将暉 映画「キャラクター」見直し。Fukase との共演、漫画家役の狂気がリアルすぎる',
    '吉沢亮 ドラマ「国宝」主演、歌舞伎役者の役作りが3年がかり。透明感と狂気の両立',
    '佐藤健 大河ドラマ「青天を衝け」から数年、引き出し増えた。映画「ハチミツとクローバー」竹本君と全然違う',
    '横浜流星 「君と世界が終わる日に」シリーズ、アクション俳優として確立',
    '北村匠海 DISH// 活動と俳優活動の両立、若手最強。「君は月夜に光り輝く」での主演評価高い',
    '阿部寛 大河「鎌倉殿の13人」北条義時、年齢重ねるごとに渋み増す',
    '役所広司 カンヌ受賞後、世界的評価。「PERFECT DAYS」ヴィム・ヴェンダース監督との出会いが運命的',
    '渡辺謙 ハリウッドでの存在感、最近の「沈黙 -サイレンス-」スコセッシ起用',
    '岡田准一 V6解散後、俳優一本。「燃えよ剣」土方歳三役の殺陣はマジで超一流',
    '大泉洋 「水曜どうでしょう」と「ノーサイド・ゲーム」の両立、ジャンル超越',
    '松坂桃李 「孤狼の血」白川刑事、振り幅と狂気の演技で日本アカデミー賞',
    '小栗旬 ハリウッド進出、「ゴジラvsコング」など外への展開',
    '木村拓哉 ドラマ「BG」シリーズ、SP役での新境地。木村節は健在',
    '香取慎吾 ソロでフォトグラファー、ペインター活動も。元ジャニからの異色キャリア',
    '吉田鋼太郎 シェイクスピア役者として再評価。井上ひさし作品でも実力発揮'
  ];
  medias := array[
    '', 'https://picsum.photos/seed/kokuho/800/600', '', '', '',
    '', 'https://picsum.photos/seed/perfectdays/800/600', '', '', '',
    '', '', '', '', ''
  ];
  sources := array[
    '', 'https://kokuho-movie.com/', '', '', '',
    '', 'https://perfectdays.movie/', '', '', '',
    '', '', '', '', ''
  ];
  subtags := array['俳優','俳優','俳優','俳優','俳優',
                   '俳優','俳優','俳優','俳優','俳優',
                   '俳優','俳優','俳優','俳優','俳優'];
  for i in 1..array_length(contents,1) loop
    uid := uids[1 + ((i * 29) % array_length(uids,1))];
    insert into public.posts (
      author_id, content, tag_names, media_urls, source_url, is_anonymous, is_public, kind,
      likes_count, comments_count, trust_score_at_post, created_at
    ) values (
      uid, contents[i], array[primary_tag, subtags[i]],
      case when medias[i] = '' then array[]::text[] else array[medias[i]] end,
      nullif(sources[i], ''),
      true, true,
      kinds[1 + (i % 6)],
      (random() * 180 + 5)::int,
      (random() * 14)::int,
      (60 + random() * 35)::int,
      now() - (random() * interval '20 days')
    );
  end loop;

  ----------------------------------------------------------------
  -- 女優 (15 投稿)
  ----------------------------------------------------------------
  primary_tag := '女優';
  contents := array[
    '広瀬すず 映画「流浪の月」、安藤サクラとの共演で表現力が一段階上がった。重い役作りで体重も増減',
    '石原さとみ ドラマ「ヤヌスの鏡」、子育てしながらの主演復帰。役者としての深みが増した',
    '長澤まさみ 「コンフィデンスマンJP」シリーズ、コメディ才能が完全開花',
    '吉高由里子 大河「光る君へ」紫式部役、原作のない歴史ドラマで主演張れる人材',
    '橋本環奈 「カラオケ行こ！」コメディ路線が最高。実は演技派として再評価',
    '浜辺美波 ドラマ「君のクイズ」、知的キャラの新境地',
    '上白石萌音 ミュージカル「シンデレラ」、歌唱力で女優枠超えた',
    '永野芽郁 「ハケンの品格」シーズン2、若手主演として孤独に戦う役で成長',
    '小松菜奈 映画「許された子どもたち」、ダーティな役の振り幅が凄い',
    '安藤サクラ 「怪物」是枝裕和監督作、母親役のリアルさがアジア圏で評価',
    '蒼井優 福山雅治と結婚後、「るろうに剣心」シリーズで娯楽大作にも',
    '綾瀬はるか CM出演本数、相変わらず女優ランキング上位',
    '北川景子 大河「家康」築山殿、悪役の振り幅で日本アカデミー賞ノミネート',
    '川口春奈 「リバーサルオーケストラ」、コメディからシリアスまで',
    '今田美桜 朝ドラ後、CMクイーン路線継続。バラエティ進出も話題'
  ];
  medias := array[
    'https://picsum.photos/seed/suzu/800/600',
    '', 'https://picsum.photos/seed/confidence/800/600', 'https://picsum.photos/seed/hikaru/800/600', '',
    '', '', '', '', '',
    '', '', '', '', ''
  ];
  sources := array[
    '', '', 'https://www.fujitv.co.jp/confidenceman/', 'https://www.nhk.or.jp/hikarukimi/', '',
    '', '', '', '', '',
    '', '', '', '', ''
  ];
  subtags := array['女優','女優','女優','女優','女優',
                   '女優','女優','女優','女優','女優',
                   '女優','女優','女優','女優','女優'];
  for i in 1..array_length(contents,1) loop
    uid := uids[1 + ((i * 31) % array_length(uids,1))];
    insert into public.posts (
      author_id, content, tag_names, media_urls, source_url, is_anonymous, is_public, kind,
      likes_count, comments_count, trust_score_at_post, created_at
    ) values (
      uid, contents[i], array[primary_tag, subtags[i]],
      case when medias[i] = '' then array[]::text[] else array[medias[i]] end,
      nullif(sources[i], ''),
      true, true,
      kinds[1 + (i % 6)],
      (random() * 180 + 5)::int,
      (random() * 14)::int,
      (60 + random() * 35)::int,
      now() - (random() * interval '20 days')
    );
  end loop;

  ----------------------------------------------------------------
  -- モデル (15 投稿)
  ----------------------------------------------------------------
  primary_tag := 'モデル';
  contents := array[
    '水原希子、ファッション誌だけでなくカルチャー全体に発信。SNS言動も常に話題',
    '滝沢カレン 独特の言語感覚で、エッセイ集ベストセラー。本業モデルから文学者の道も',
    'ローラ 英語・フランス語ペラペラ、海外進出本格化。ハリウッド映画端役で出演',
    '冨永愛 ランウェイ復帰、シャネルの広告塔として完璧',
    '河北麻友子 英語のセンス抜群、バイリンガル世代の代表',
    '中条あやみ CM女王へ、ポカリスエットからの上り詰め方が王道',
    '森星 姉妹で目立つ存在、グローバル展開でVOGUE表紙',
    'ダレノガレ明美 メイク技術が業界トップ、YouTubeチャンネル登録100万',
    '泉里香 グラビアと女優の二刀流、男女ファン両方獲得',
    '佐々木希 結婚後も人気高止まり、子育てとモデル両立',
    '土屋アンナ ロック歌手とモデルの境界、独自路線で人気継続',
    '森泉 個性派モデルから「自然体生活」発信者へ転身、書籍ヒット',
    '梨花 独立系モデルの先駆者、海外移住しながらも雑誌登場',
    '佐藤栞里 PR ディレクター枠、ロケ番組「美味しい給食」レギュラー',
    '本田翼 ゲーマー女優としても確立、Riot Games アンバサダー'
  ];
  medias := array[
    '', '', 'https://picsum.photos/seed/rola/800/600', '', '',
    'https://picsum.photos/seed/nakajo/800/600', '', '', '', '',
    '', '', '', '', ''
  ];
  sources := array[
    '', '', '', '', '', '', '', '', '', '',
    '', '', '', '', ''
  ];
  subtags := array['モデル','モデル','モデル','モデル','モデル',
                   'モデル','モデル','モデル','モデル','モデル',
                   'モデル','モデル','モデル','モデル','モデル'];
  for i in 1..array_length(contents,1) loop
    uid := uids[1 + ((i * 37) % array_length(uids,1))];
    insert into public.posts (
      author_id, content, tag_names, media_urls, source_url, is_anonymous, is_public, kind,
      likes_count, comments_count, trust_score_at_post, created_at
    ) values (
      uid, contents[i], array[primary_tag, subtags[i]],
      case when medias[i] = '' then array[]::text[] else array[medias[i]] end,
      nullif(sources[i], ''),
      true, true,
      kinds[1 + (i % 6)],
      (random() * 150 + 5)::int,
      (random() * 12)::int,
      (60 + random() * 35)::int,
      now() - (random() * interval '20 days')
    );
  end loop;

  ----------------------------------------------------------------
  -- 芸能人 (15 投稿)
  ----------------------------------------------------------------
  primary_tag := '芸能人';
  contents := array[
    '松本人志 復帰、ガキ使年末完全復活。週刊文春報道後の業界激震、まだ尾を引いてる',
    '浜田雅功 ダウンタウン単独活動継続、TBS「水曜日のダウンタウン」枠安定',
    '明石家さんま「Mr.サタデー」深夜枠、80歳まで現役宣言',
    '田村淳 政治発言の影響で番組降板も、独自の発信続ける',
    'タモリ 「ブラタモリ」終了後、新番組「タモリのお墨付き」スタート',
    '有吉弘行 賞レース司会、結婚後も人気不動',
    '千鳥 ノブ・大悟、相方の関西弁モチーフのバラエティ枠が話題',
    'ハライチ岩井 結婚と独立、新事務所立ち上げ',
    'STARTO ENTERTAINMENT デビュー、Number_i 平野紫耀の海外進出本格化',
    'Snow Man 個人活動、目黒蓮の主演ドラマ高視聴率',
    'KAT-TUN 解散発表、亀梨和也のソロ活動本格化',
    'M-1グランプリ 2026、令和ロマンの3連覇達成。お笑い史に残る快挙',
    'R-1グランプリ 街裏ぴんく、デビュー10年の苦労が報われた瞬間',
    'キングオブコント 男性ブランコ、コントの新世代を作る',
    '紅白歌合戦 司会、有吉弘行と橋本環奈のコンビ3年目'
  ];
  medias := array[
    '', '', '', '', '',
    '', '', '', 'https://picsum.photos/seed/number-i/800/600', 'https://picsum.photos/seed/snowman/800/600',
    '', '', '', '', ''
  ];
  sources := array[
    'https://bunshun.jp/articles/-/68234',
    '', '', '', 'https://www.nhk.or.jp/buratamori/',
    '', '', '', 'https://numberi.jp/', 'https://www.snowman-jp.com/',
    '', '', '', '', 'https://www.nhk.or.jp/kouhaku/'
  ];
  subtags := array['芸能人','芸能人','芸能人','芸能人','芸能人',
                   '芸能人','芸能人','芸能人','ジャニーズ','ジャニーズ',
                   'ジャニーズ','芸能人','芸能人','芸能人','芸能人'];
  for i in 1..array_length(contents,1) loop
    uid := uids[1 + ((i * 41) % array_length(uids,1))];
    insert into public.posts (
      author_id, content, tag_names, media_urls, source_url, is_anonymous, is_public, kind,
      likes_count, comments_count, trust_score_at_post, created_at
    ) values (
      uid, contents[i], array[primary_tag, subtags[i]],
      case when medias[i] = '' then array[]::text[] else array[medias[i]] end,
      nullif(sources[i], ''),
      true, true,
      kinds[1 + (i % 6)],
      (random() * 200 + 10)::int,
      (random() * 18)::int,
      (60 + random() * 35)::int,
      now() - (random() * interval '20 days')
    );
  end loop;

  ----------------------------------------------------------------
  -- YouTuber (15 投稿)
  ----------------------------------------------------------------
  primary_tag := 'YouTuber';
  contents := array[
    'ヒカキン 登録者1300万人、最新動画「家を1億円分DIY改装」が伝説回。HikakinTV のクオリティ突き抜けてる',
    'はじめしゃちょー の倉庫、最新動画は1億円の検証。「お金の力で困らせるシリーズ」が定番化',
    '東海オンエア 6人体制復活、岡崎市が聖地巡礼スポットとして観光収入大幅増',
    'コムドット やまと、初の主演映画決定。「やってみた」シリーズから映画俳優へ',
    'フィッシャーズ シルクロード 結婚発表。チャンネル登録者層もファミリー化',
    '中田敦彦 オリラジ卒業後、YouTube大学で月収数千万。トレーディング動画も人気',
    '両学長 リベラルアーツ大学、お金リテラシー啓蒙でファン50万超。本も次々ベストセラー',
    'マコなり社長 起業家YouTuberとして確立、「ビジネス映画批評」が新コンテンツ',
    'スカイピース テオ 卒業、新メンバー加入後の路線変更',
    '兄者弟者 ゲーム実況界の最古参、登録者100万維持',
    'もちまる日記 猫飼育VLOG、登録者200万。ペット系YouTuberの新潮流',
    'ヒカル オーバーレイ社売却、YouTuberから事業家への転身',
    'シバター プロレス参戦継続、YouTube収益とプロレス収益の両立',
    'ラファエル ヒカル時代から独立、自身のチャンネルで企画力',
    '中村のジョー ロックスター系YouTuber、ライブツアー敢行'
  ];
  medias := array[
    'https://picsum.photos/seed/hikakin/800/600',
    '', '', '', '',
    'https://picsum.photos/seed/oriental/800/600', '', '', '', '',
    'https://picsum.photos/seed/mochimaru/800/600', '', '', '', ''
  ];
  sources := array[
    'https://www.youtube.com/@HikakinTV',
    'https://www.youtube.com/@hajimesyacho',
    'https://www.youtube.com/@toukaionair',
    'https://www.youtube.com/@comdotyamato',
    '', 'https://www.youtube.com/@NKTV0', 'https://www.youtube.com/@ryogakucho',
    '', '', '', 'https://www.youtube.com/@mochimaru', '', '', '', ''
  ];
  subtags := array['ヒカキン','YouTuber','YouTuber','コムドット','YouTuber',
                   'YouTuber','YouTuber','YouTuber','YouTuber','YouTuber',
                   'YouTuber','YouTuber','YouTuber','YouTuber','YouTuber'];
  for i in 1..array_length(contents,1) loop
    uid := uids[1 + ((i * 43) % array_length(uids,1))];
    insert into public.posts (
      author_id, content, tag_names, media_urls, source_url, is_anonymous, is_public, kind,
      likes_count, comments_count, trust_score_at_post, created_at
    ) values (
      uid, contents[i], array[primary_tag, subtags[i]],
      case when medias[i] = '' then array[]::text[] else array[medias[i]] end,
      nullif(sources[i], ''),
      true, true,
      kinds[1 + (i % 6)],
      (random() * 220 + 10)::int,
      (random() * 18)::int,
      (60 + random() * 35)::int,
      now() - (random() * interval '20 days')
    );
  end loop;

  ----------------------------------------------------------------
  -- ビジネス (15 投稿)
  ----------------------------------------------------------------
  primary_tag := 'ビジネス';
  contents := array[
    '副業ブログ 3年目、月10万安定。WordPress + アフィリエイトで運用。初月から3ヶ月は0円継続耐え抜くのが鍵',
    'FIRE目標 6000万、現在2500万。eMAXIS Slim 全世界株式 + NISA枠フル活用。あと7年で達成予定',
    'スタートアップ転職、年収400→650万。ストックオプション付与で将来IPOのキャピタルゲイン期待',
    '個別株 トヨタ自動車(7203) 1000株保有、配当年間14万。優待利回り考えると6%超え',
    'NISA枠 360万埋めた。VTI + 高配当株でリスク分散。来年は新NISA成長枠も活用',
    '簿記2級合格、次は税理士簿記論挑戦。会計知識は副業でも本業でも武器',
    'プログラミングスクール卒業、Webエンジニア転職成功。年収300→500万、リモート週3',
    '物販Amazon FBA 3年目、月商200万。利益率10%超え。中国製品の選定が肝',
    '不動産投資 区分マンション3戸、月20万キャッシュフロー。表面利回り7%物件',
    'ふるさと納税 限度額35万、米と肉とフルーツでローテーション。実質負担2000円',
    '転職活動、リクルートエージェント+ビズリーチ併用。年収交渉で50万アップ達成',
    '英語学習 DUO 3.0 と Cambridge Vocabulary、TOEIC600→850',
    '副業ココナラ、デザインスキル販売。月50万到達、本業を超える月も',
    '株主優待 オリックス、廃止前にカタログギフト堪能。代わりの優待銘柄探し中',
    '中小企業診断士 1次試験合格、2次対策本格化。診断士は副業でも稼げる'
  ];
  medias := array[
    'https://picsum.photos/seed/blog/800/600',
    'https://picsum.photos/seed/fire/800/600',
    '', '', '',
    '', '', '', '', '',
    '', '', '', '', ''
  ];
  sources := array[
    '', 'https://emaxis.jp/fund/253266.html', '',
    'https://global.toyota/jp/ir/', 'https://www.fsa.go.jp/policy/nisa2/about/index.html',
    'https://kentei.jp/4205', '', '', '',
    'https://www.furusato-tax.jp/', '', '', '',
    '', 'https://www.j-smeca.jp/'
  ];
  subtags := array['副業','投資','ビジネス','投資','投資',
                   'ビジネス','ビジネス','副業','投資','ビジネス',
                   'ビジネス','ビジネス','副業','投資','ビジネス'];
  for i in 1..array_length(contents,1) loop
    uid := uids[1 + ((i * 47) % array_length(uids,1))];
    insert into public.posts (
      author_id, content, tag_names, media_urls, source_url, is_anonymous, is_public, kind,
      likes_count, comments_count, trust_score_at_post, created_at
    ) values (
      uid, contents[i], array[primary_tag, subtags[i]],
      case when medias[i] = '' then array[]::text[] else array[medias[i]] end,
      nullif(sources[i], ''),
      true, true,
      kinds[1 + (i % 6)],
      (random() * 180 + 10)::int,
      (random() * 16)::int,
      (60 + random() * 35)::int,
      now() - (random() * interval '20 days')
    );
  end loop;
end $$;

-- ============================================================
-- 4. BBS スレッド + 会話形式のリプライ (12テーマ × 1スレ)
-- ============================================================
do $$
declare
  uids uuid[];
  tid uuid;
  uid uuid;
  i int;
  reps text[];
  title text;
  category text;
  base_ts timestamptz;
begin
  select array_agg(id order by id) into uids from auth.users
    where email like 'dummy_v2_%@geek-seed.example';
  if uids is null then return; end if;

  ----------------------------------------------------------------
  -- 車スレッド
  ----------------------------------------------------------------
  title := '次の車買うなら、予算300万でなにがオススメ？';
  category := '車';
  reps := array[
    '用途と趣味性のバランス次第。街乗りメインならMAZDA3一択。1500ccディーゼル燃費20km/L',
    '走り重視なら絶対GR86。中古2年落ちなら200万切る個体ある。フィールが別格、ND2と比較したけどFR感ならこっち',
    '>>2 GR86中古、年式と走行距離どれくらい狙ってる？',
    '>>3 自分は2023年式、走行2万キロ以内で。MTで個体探してる',
    '個人的にはMINI Cooper Sすすめる。輸入車だけど維持費そこまでヤバくない。スポーツ走行も可能',
    '>>1 自分は通勤片道40km。MAZDA3か悩んでアクセラからの乗り換え検討中',
    'BMW 3シリーズの5〜7年落ち。新車価格半額切ってる個体ある。F30なら充分速い',
    '新車にこだわるならカローラスポーツ。ベタだけど後悔ない選択。GRMNなら更に走り',
    '>>7 BMWは維持費が問題。車検代でビビる',
    '>>9 ディーラーじゃなく専門店探せば3万円台に収まるよ。BMW専門店マジでおすすめ',
    'EV考えるならテスラ モデル3 中古。ただしバッテリー保証要確認。残量50%以下は買うな',
    'シビックタイプR FK8 中古、相場上がってるけど買う価値あり。FL5はもう少し待って中古化を',
    '>>11 テスラ、保険料高くない？うちは年間18万。中古なら20万超える',
    '個人的にはWRX S4。300万でターボAWD、雪国住みなら最適解',
    '>>14 WRX、燃費悪いって聞くけど実燃費どう？リッター8切る？',
    '>>15 街乗り8.5、高速12。レギュラー入れたら音と振動増えるからハイオク必須',
    'ボルボ XC40 中古。北欧デザイン、安全性能トップクラス。300万なら2年落ち狙える',
    '>>1 自分はマツダ ロードスター RF オススメする。屋根開閉のメカニズムが楽しすぎる',
    '結論: 街乗り→MAZDA3、走り→GR86、輸入欲しい→BMW 3 中古。これでまず外さない',
    '>>1 まだ買ってない？決まったら教えて、参考にしたい'
  ];
  base_ts := now() - interval '14 days';
  uid := uids[1 + (1000 % array_length(uids,1))];
  insert into public.bbs_threads (author_id, title, category, replies_count, created_at)
    values (uid, title, category, 0, base_ts) returning id into tid;
  for i in 1..array_length(reps,1) loop
    uid := uids[1 + ((i * 7 + 1) % array_length(uids,1))];
    insert into public.bbs_replies (thread_id, author_id, content, created_at)
      values (tid, uid, reps[i], base_ts + (i * interval '2 hours'));
  end loop;

  ----------------------------------------------------------------
  -- バイクスレッド
  ----------------------------------------------------------------
  title := '大型免許取りたて。最初の1台はCB1300SF / Z900RS / MT-09どれ？';
  category := 'バイク';
  reps := array[
    'まずは Z900RS。大型として軽め(214kg)、ICONカラーのデザイン10年後も色褪せない',
    'CB1300SF、SUPER FOUR の名は伊達じゃない。重い(266kg)けど安定感抜群、最初の大型として安心',
    'MT-09 SP は3気筒の特殊な振動とサウンドが官能的。147万でこのスペックは破格',
    '>>1 自分もZ900RS推し。CB1300SFは取り回し重い、Uターンで立ちごけしそう',
    '>>2 CB1300は重い分、低速安定性が抜群。立ちごけなんかしないよ。重さは正義',
    '>>3 MT-09はカワサキ Z900と比べてどう？並列4と3気筒の違い体感ある？',
    '>>6 3気筒のドコドコ感、CP3エンジン独特。一度味わうと4気筒に戻れない',
    '初心者目線で言うとリッタークラスは重すぎる説。Ninja650とかSV650で慣れてから上目指すのもアリ',
    '>>8 同意。最初は650cc帯から始めて1年後に大型乗り換えがベスト',
    '個人的にはCB1300SF EXPERTパッケージ。マフラー音、ETC2.0標準装備で完璧',
    '>>10 CB1300のEXPERT、確かに装備充実。ただし価格が195万円超え',
    'XSR900も忘れないで。スクランブラー風デザインで街乗り映え、性能はMT-09と同じ',
    '>>5 重さで立ちごけは初心者あるある。教習所のCB400で散々やったから...',
    '結論: 街乗り中心ならMT-09、ツーリング含むならCB1300SF、デザイン重視ならZ900RS',
    '>>14 これ完璧な要約だわ。テンプレ化してくれ',
    '個人的にはSV650X。Vツインの鼓動感、大型としては軽い(199kg)、SS派生の燃料タンク低くて取り回し最高',
    '>>16 SV650 一番人気ないけど、玄人好みって感じ。値段も80万切るしコスパ最強',
    'BMW R nineT 試乗してから考え直した方がいいかも。空冷ボクサーの世界が広がる',
    '>>1 主、もう買った？決まったら写真上げて',
    'カワサキ Z H2 SE 250万コースだけどスーパーチャージドの世界、一度試乗してから決めて'
  ];
  base_ts := now() - interval '11 days';
  uid := uids[1 + (2000 % array_length(uids,1))];
  insert into public.bbs_threads (author_id, title, category, replies_count, created_at)
    values (uid, title, category, 0, base_ts) returning id into tid;
  for i in 1..array_length(reps,1) loop
    uid := uids[1 + ((i * 11 + 3) % array_length(uids,1))];
    insert into public.bbs_replies (thread_id, author_id, content, created_at)
      values (tid, uid, reps[i], base_ts + (i * interval '2 hours'));
  end loop;

  ----------------------------------------------------------------
  -- アニメスレッド
  ----------------------------------------------------------------
  title := '今期アニメ覇権、最終的になに？鬼滅・呪術・フリーレン';
  category := 'アニメ';
  reps := array[
    '個人的には葬送のフリーレン。世界観の美しさとマッドハウスの作画は別格、毎週泣ける',
    '>>1 フリーレン、原作勢としてアニメ化の完成度に毎回唸ってる。ヒンメル回はもう一度見たい',
    '鬼滅 無限城編、ufotable の天井知らずな作画。映画3部作で完結予定だけど第1部が神回',
    '呪術廻戦 渋谷事変 完結、五条悟封印で号泣勢続出。MAPPA本気の作画',
    '>>3 鬼滅、ufotable の水面エフェクト見た？玉壺戦のCG演出が芸術',
    '>>4 呪術、MAPPAの労働環境心配。スタッフ酷使してでも作画クオリティ維持してる',
    'スパイファミリー 第2期、アーニャ可愛い枠としては別格。WIT + CloverWorks 共同制作',
    '推しの子、原作完結したからアニメも完結見えてきた。アクア最終回どこまでアニメで',
    '>>1 同意。フリーレンの戦闘シーンの間合いの長さ、ufotable鬼滅に劣らない',
    '>>7 スパイファミリー、ヨル戦闘シーンの作画力凄い。アーニャ可愛さに目を奪われがちだけど',
    'ぼっち・ざ・ろっく 劇場版、 後藤ひとりの新規エピソード。CloverWorks の作画継続',
    '進撃の巨人 完結編、WIT→MAPPA で当初心配だったけど結果的に大成功',
    '>>11 ぼっち劇場版、後藤ひとりのライブシーン新規作画がエグい',
    'ダンダダン アニメ化、サイエンスSARU 制作。動きの作画特化スタジオで原作再現楽しみ',
    '>>14 ダンダダン、原作のドタバタ感とサイエンスSARU の作画スタイル相性最高',
    '名探偵コナン 100巻記念、劇場版「黒鉄の魚影」とリンク。原作30年やる作品の凄み',
    'ガンダム 水星の魔女 シーズン2、スレッタ・ミオリネ関係性が新時代',
    '>>1 結論: 覇権は世代によって違う。フリーレン(文学系)、鬼滅(王道)、呪術(尖り)',
    '正直、ufotable と MAPPA の作画競争で日本アニメ業界が良くなってる。視聴者にとって最高',
    '>>19 同意。10年前と比較して、放映中アニメのクオリティ全体的に底上げされた'
  ];
  base_ts := now() - interval '9 days';
  uid := uids[1 + (3000 % array_length(uids,1))];
  insert into public.bbs_threads (author_id, title, category, replies_count, created_at)
    values (uid, title, category, 0, base_ts) returning id into tid;
  for i in 1..array_length(reps,1) loop
    uid := uids[1 + ((i * 13 + 5) % array_length(uids,1))];
    insert into public.bbs_replies (thread_id, author_id, content, created_at)
      values (tid, uid, reps[i], base_ts + (i * interval '2 hours'));
  end loop;

  ----------------------------------------------------------------
  -- アイドルスレッド
  ----------------------------------------------------------------
  title := '坂道3グループで一番好きなメンバーと理由教えて';
  category := 'アイドル';
  reps := array[
    '乃木坂46 賀喜遥香 一択。表現力と歌唱力で次世代センターの最有力',
    '>>1 賀喜ちゃん、卒業発表で衝撃だった。久保史緒里か遠藤さくらが次センターになる',
    '日向坂46 小坂菜緒 復活してくれて嬉しい。健康のためにペース調整しながら活動継続',
    '櫻坂46 山崎天、1stセンターからの大化け。森田ひかるとのWセンター時代が伝説',
    '>>1 賀喜さん卒業前のラストツアー、絶対行く',
    '乃木坂46 与田祐希、ビジュアル界のレジェンド。卒業しても話題',
    '日向坂46 齋藤京子 ソロ活動も話題。「ヒルナンデス」レギュラーで認知度爆発',
    'AKB48 本田仁美、IZ*ONE組として最強格。歌唱力もダンスもトップレベル',
    '>>6 与田ちゃんの卒業後、何やってるか気になる',
    '>>9 写真集と CM 中心。女優転向の噂もあり、注目してる',
    '櫻坂46 守屋麗奈 卒業発表、卒コン参戦希望者多すぎる',
    '日向坂46 加藤史帆、メンバーとの仲良し動画が癒し。卒業前のラストツアー涙腺崩壊確定',
    '>>1 同じく賀喜さん推し。「Actually...」のセンター回が伝説',
    'AKB48 64thシングルセンター、本田仁美の継続で安泰',
    '個人的に乃木坂46 久保史緒里。文学少女キャラから女優転向中、絶対ブレイクする',
    '>>15 久保ちゃん、舞台「桜の園」での演技見た？女優としても期待大',
    '櫻坂46 大園玲、4期生だけど5期含めても核心メンバー。ダンスのキレが別格',
    '日向坂46 上村ひなの、最年少時代の動画見直すと感慨深い',
    '>>1 これは正解ない論。推しが推し。みんなで応援しよう',
    '>>19 これに尽きる。坂道3グループ全部好きすぎて選べない'
  ];
  base_ts := now() - interval '7 days';
  uid := uids[1 + (4000 % array_length(uids,1))];
  insert into public.bbs_threads (author_id, title, category, replies_count, created_at)
    values (uid, title, category, 0, base_ts) returning id into tid;
  for i in 1..array_length(reps,1) loop
    uid := uids[1 + ((i * 17 + 7) % array_length(uids,1))];
    insert into public.bbs_replies (thread_id, author_id, content, created_at)
      values (tid, uid, reps[i], base_ts + (i * interval '2 hours'));
  end loop;

  ----------------------------------------------------------------
  -- Vtuberスレッド
  ----------------------------------------------------------------
  title := 'ホロ vs にじ、今一番伸びてるVtuberは誰？';
  category := 'Vtuber';
  reps := array[
    'ホロライブ 兎田ぺこら、登録者250万超え。中の人云々抜きにキャラとして完成されてる',
    'にじさんじ 葛葉、ChroNoiR で叶とのコンビが安定。VALORANT配信の戦略レベルが世界に響く',
    '>>1 ぺこーら、登録者だけじゃなくスパチャ売上もTOP。視聴者層も幅広い',
    'ホロライブ 宝鐘マリン、歌枠でMステ出演経験。VTuber業界の橋渡し的存在',
    '>>2 ChroNoiR、企画力ハンパない。VTuber業界でも世界最強コンビ',
    'にじさんじ 月ノ美兎、初配信から5年。委員長として安定の人気維持',
    '個人勢ピーナッツくん、企業VTuber並みの再生数。同人カルチャーから派生',
    '>>4 マリン船長、絵師しぐれういさんの仕事早すぎ。新衣装お披露目ペースが異常',
    'ホロライブEN Calliope Mori、Spotifyランクイン。VTuberから音楽業界へ',
    '>>3 ぺこら、最近視聴者層が大人寄りになってる。スパチャ平均額上がった',
    'にじさんじEN ライバー、英語圏で勢力拡大中。海外人気はEN強い',
    '>>9 Calliope のラップスキル、職業ラッパーレベル。VTuber枠だけでは説明できない',
    'ホロライブ 戌神ころね、Twitch同時配信開始。Amazonとの連携で新展開',
    '>>11 にじさんじEN、Selen Tatsuki 騒動以降の収益どうなった？',
    '加賀美ハヤト の社長配信、にじさんじ社員ロールプレイ完成度高すぎ',
    '>>13 ころね、海外ファンも多くて全体的な戦略うまい',
    '雪花ラミィ、お酒企画で日本酒の知識ガチ勢。ホロ4期生で最も成長してる印象',
    'ホロライブEXPO 2026、グッズ予約戦争すでに始まってる',
    '>>1 ホロ vs にじ、結論は両方推せ。視聴者の好みで分かれるだけ',
    '>>19 これに尽きる。VTuber業界全体が伸びてるのが何より嬉しい'
  ];
  base_ts := now() - interval '6 days';
  uid := uids[1 + (5000 % array_length(uids,1))];
  insert into public.bbs_threads (author_id, title, category, replies_count, created_at)
    values (uid, title, category, 0, base_ts) returning id into tid;
  for i in 1..array_length(reps,1) loop
    uid := uids[1 + ((i * 19 + 9) % array_length(uids,1))];
    insert into public.bbs_replies (thread_id, author_id, content, created_at)
      values (tid, uid, reps[i], base_ts + (i * interval '2 hours'));
  end loop;

  ----------------------------------------------------------------
  -- スポーツスレッド
  ----------------------------------------------------------------
  title := '大谷翔平、今シーズン最終的に何本塁打打つと予想？';
  category := 'スポーツ';
  reps := array[
    '6月時点で23本、ペース的に45本ペース。守備に戻った負荷考えても40本超え確実',
    '>>1 同感。MVPは確実だけど、本塁打王は審判の判定次第。マシューチャンプマン警戒',
    '個人的には50本予想。打席数考えるとシーズン後半に爆発する',
    '>>3 50本は楽観的すぎ。投手復帰したから打席減るし、現実的には38-42本',
    '佐々木朗希とドジャース移籍、二刀流の本気度が増した気がする。山本由伸との3本柱は驚異',
    '>>5 佐々木、メジャーで第1試合で7回1失点。日本人投手史上の快進撃',
    'WBC2026 メンバー選考、大谷の二刀流出場は確実',
    '>>7 WBC、サムライジャパンの陣容今から楽しみ。村上宗隆、岡本和真、牧秀悟のクリーンナップ',
    '三笘薫 ブライトン残留、来季もプレミアで暴れる。チェルシー移籍噂は否定',
    '>>9 三笘、ブライトンでの完成度高すぎる。チェルシー行ったら埋もれる可能性',
    '久保建英 レアルソシエダ、CL出場圏で快進撃中。次のステップは大型クラブ',
    '>>1 大谷、シーズン後半の体調次第。9月以降に故障が無ければ45本以上は固い',
    'F1 マックス・フェルスタッペン、4連覇かかる2026年。ハミルトンのフェラーリ移籍で勢力図変動',
    '>>13 F1、ノリス・ピアストリのマクラーレン2強、フェラーリのマクラーレン超え期待',
    '八村塁 NBA、レイカーズで安定したパフォーマンス。レブロン引退前にプレーオフ突破したい',
    '>>1 大谷の二刀流復帰、本塁打数より投手成績の方が気になる',
    'WBC、サムライジャパンの監督人事気になる。栗山監督続投か、新監督か',
    '井上尚弥 PFP1位、サウル・アルバレスとの統一戦が次の目標',
    '>>1 結論: 大谷40-45本、MVP確実、ドジャース ワールドシリーズ進出',
    '>>19 これが現実的な予想。WBCも含めて2026年は野球熱がすごい'
  ];
  base_ts := now() - interval '5 days';
  uid := uids[1 + (6000 % array_length(uids,1))];
  insert into public.bbs_threads (author_id, title, category, replies_count, created_at)
    values (uid, title, category, 0, base_ts) returning id into tid;
  for i in 1..array_length(reps,1) loop
    uid := uids[1 + ((i * 23 + 11) % array_length(uids,1))];
    insert into public.bbs_replies (thread_id, author_id, content, created_at)
      values (tid, uid, reps[i], base_ts + (i * interval '2 hours'));
  end loop;

  ----------------------------------------------------------------
  -- 俳優・女優スレッド (合体)
  ----------------------------------------------------------------
  title := '今、邦画で一番演技が上手いと思う俳優・女優教えて';
  category := '俳優';
  reps := array[
    '安藤サクラ。「怪物」是枝裕和監督作の母親役、アジア圏で評価された理由がわかる',
    '役所広司、カンヌ受賞後の存在感。「PERFECT DAYS」ヴィム・ヴェンダース監督との出会いが運命的',
    '>>1 安藤サクラ、表現力で日本一だと思う。「百円の恋」から軌跡が凄い',
    '吉沢亮、「国宝」での歌舞伎役者役。3年がかりの役作りで日本アカデミー賞',
    '広瀬すず、「流浪の月」で表現力が一段階上がった。安藤サクラとの共演で化けた',
    '>>4 国宝の吉沢亮、舞台での歌舞伎披露も完璧。役者として開花した',
    '菅田将暉、ジャンル問わずこなす。「キャラクター」のFukase との共演が記憶に残る',
    '>>3 安藤サクラ、夫の柄本佑も実力派。家系の血が濃すぎる',
    '阿部寛、大河「鎌倉殿の13人」北条義時。年齢重ねるごとに渋み増す',
    '蒼井優、福山雅治と結婚後も第一線。「るろうに剣心」シリーズで娯楽大作にも',
    '>>10 蒼井優、邦画界の女優陣で唯一無二の存在感',
    '岡田准一、V6解散後の俳優一本路線が成功。「燃えよ剣」土方歳三役は超一流',
    '長澤まさみ、「コンフィデンスマンJP」シリーズでコメディ才能開花',
    '>>13 長澤まさみ、コメディの間の取り方が完璧。映画女優として完成度高い',
    '永野芽郁、ハケンの品格シーズン2で若手主演張れる女優として地位確立',
    '>>15 永野芽郁、清楚と元気の二面性、コメディもシリアスもいける',
    '吉高由里子、大河「光る君へ」紫式部役。原作のない歴史ドラマで主演張れる',
    '横浜流星、「君と世界が終わる日に」シリーズでアクション俳優として確立',
    '>>1 安藤サクラ・役所広司・吉沢亮の3人で日本アカデミー賞主演級独占しそう',
    '>>19 ここ数年、邦画俳優陣のレベル爆上がり。世代交代で次世代が育ってる'
  ];
  base_ts := now() - interval '4 days';
  uid := uids[1 + (7000 % array_length(uids,1))];
  insert into public.bbs_threads (author_id, title, category, replies_count, created_at)
    values (uid, title, category, 0, base_ts) returning id into tid;
  for i in 1..array_length(reps,1) loop
    uid := uids[1 + ((i * 29 + 13) % array_length(uids,1))];
    insert into public.bbs_replies (thread_id, author_id, content, created_at)
      values (tid, uid, reps[i], base_ts + (i * interval '2 hours'));
  end loop;

  ----------------------------------------------------------------
  -- モデルスレッド
  ----------------------------------------------------------------
  title := 'モデルから女優転身組、一番成功してると思うのは？';
  category := 'モデル';
  reps := array[
    '杏 一択。「あさが来た」朝ドラから始まって、海外ドラマ進出まで。語学力も生かしてる',
    '>>1 杏、最近フランス移住で海外ドラマ参戦。モデル時代から考えると別人',
    '水原希子、女優というよりカルチャー全体の発信者。海外進出本格化',
    '本田翼、女優+ゲーマー+VTuber まで多角化。Riot Games アンバサダー',
    '>>3 水原希子、英語フランス語ペラペラ、世界基準のセンスがある',
    '小松菜奈、菅田将暉と結婚後も第一線。「許された子どもたち」での演技は別格',
    '中条あやみ、CM女王から女優として確立。「君のクイズ」での知的キャラ新境地',
    '>>4 本田翼、Riot Games アンバサダー意外と知らない人多い',
    '森星、姉妹で目立つ存在。グローバル展開でVOGUE表紙',
    '滝沢カレン、独特の言語感覚でエッセイ集ベストセラー。モデル → 文学者の道',
    '>>10 滝沢カレン、文学賞いつ取るんだろう。表現力が普通じゃない',
    '河北麻友子、バイリンガル世代の代表。ハリウッド進出の話も',
    '>>1 杏、子育てしながらの活動継続もすごい',
    '土屋アンナ、ロック歌手 + モデル + 女優の三足のわらじ',
    '梨花、独立系モデルの先駆者。海外移住しながらも雑誌登場継続',
    '>>15 梨花、起業もしてビジネス感覚もある',
    '香里奈、姉妹3人とも目立つ存在。森家、香里奈家、家系がモデル界の名門',
    '泉里香、グラビアと女優の二刀流、男女ファン両方獲得',
    '>>1 結論: 杏が最強。語学・演技・モデル経歴のバランスが理想形',
    '>>19 同意。海外進出するモデル系は語学力が鍵だと改めて感じる'
  ];
  base_ts := now() - interval '3 days';
  uid := uids[1 + (8000 % array_length(uids,1))];
  insert into public.bbs_threads (author_id, title, category, replies_count, created_at)
    values (uid, title, category, 0, base_ts) returning id into tid;
  for i in 1..array_length(reps,1) loop
    uid := uids[1 + ((i * 31 + 17) % array_length(uids,1))];
    insert into public.bbs_replies (thread_id, author_id, content, created_at)
      values (tid, uid, reps[i], base_ts + (i * interval '2 hours'));
  end loop;

  ----------------------------------------------------------------
  -- 芸能人スレッド
  ----------------------------------------------------------------
  title := 'ジャニーズ解体後、元タレントで一番うまく行ってるのは？';
  category := '芸能人';
  reps := array[
    '平野紫耀 Number_i 一択。「BON」グローバルヒットでビルボードチャート、海外進出本格化',
    '木村拓哉、ジャニーズに残らずSTARTOで継続。ドラマ「BG」シリーズ高視聴率',
    '>>1 平野紫耀、世界戦略がうまい。シカゴ・パリでのライブも成功',
    '香取慎吾、ソロ活動でフォトグラファー・ペインター。元ジャニからの異色キャリア',
    '中居正広、SMAP解散後の安定路線。テレビ司会としての価値変わらず',
    '>>5 中居くん、最近もスポーツ番組のキャスティング多い',
    '亀梨和也、KAT-TUN解散後にソロ活動本格化。バラエティ路線で安定',
    'V6 岡田准一、V6解散後の俳優一本で大成功。「燃えよ剣」でアカデミー賞主演',
    '>>1 Number_i、3人体制で海外進出。日本のグループとしては前例ない世界戦略',
    '神宮寺勇太、平野紫耀と Number_i 結成。バラエティでの存在感',
    '岸優太、Number_i 3人目。歌唱力で支えるポジション',
    '>>10 神宮寺、CM出演本数すごい。Number_i 全員CM出演で売れてる',
    'Snow Man 目黒蓮、主演ドラマ高視聴率。映画「夜明けのすべて」ヒット',
    '>>13 目黒蓮、Snow Man の中でも頭ひとつ抜けてる。ソロ活動目立つ',
    '元V6 三宅健、ソロ路線で個性的なキャリア。ラジオパーソナリティとして人気',
    '>>15 三宅健、TBSラジオの番組が玄人受け',
    '櫻井翔、嵐活動休止後もキャスター業継続。NEWS ZEROで安定',
    '長瀬智也、TOKIO退所後、芸能界引退状態。それも一つの選択',
    '>>1 結論: 平野紫耀 Number_i が王道、岡田准一が個人キャリアの正解',
    '>>19 同意。ジャニーズの肩書きなくても、本人の実力で勝負できる人だけ残る'
  ];
  base_ts := now() - interval '2 days';
  uid := uids[1 + (9000 % array_length(uids,1))];
  insert into public.bbs_threads (author_id, title, category, replies_count, created_at)
    values (uid, title, category, 0, base_ts) returning id into tid;
  for i in 1..array_length(reps,1) loop
    uid := uids[1 + ((i * 37 + 19) % array_length(uids,1))];
    insert into public.bbs_replies (thread_id, author_id, content, created_at)
      values (tid, uid, reps[i], base_ts + (i * interval '2 hours'));
  end loop;

  ----------------------------------------------------------------
  -- YouTuber スレッド
  ----------------------------------------------------------------
  title := 'YouTuber登録者100万人超え、本気でおすすめは誰？';
  category := 'YouTuber';
  reps := array[
    'ヒカキン 1300万人、日本YouTuberのレジェンド。毎日投稿継続してる根性',
    '東海オンエア、6人体制復活後の安定感。岡崎市が聖地巡礼で観光収入大幅増',
    '>>1 ヒカキン、最新動画「家を1億円分DIY改装」が伝説回',
    'はじめしゃちょー の倉庫、検証動画のスケール感が異次元。1億円検証シリーズ',
    '>>2 東海オンエア、地方創生 YouTuber として功績デカい',
    'コムドット やまと、5人体制で個性が際立つ。「お笑い系」というジャンルを再定義',
    '>>4 はじめしゃちょー、企画力以前にお金の使い方が豪快すぎる',
    'スカイピース、音楽系YouTuberとして本格的な活動。LIVE ツアーも敢行',
    '中田敦彦 YouTube大学、ビジネス・教育系で月収数千万。シンガポール移住後も活動',
    '>>9 中田あっちゃん、政治発言で炎上もあるけど影響力ある',
    '両学長 リベラルアーツ大学、お金リテラシー啓蒙で50万超。本もベストセラー連発',
    'マコなり社長、起業家YouTuberとして確立。「ビジネス映画批評」新コンテンツ',
    '>>11 両学長、信者多いけど発信内容は実用的。お金の話題で頭ひとつ抜けてる',
    'フィッシャーズ、シルクロード結婚発表。ファミリー層獲得',
    '>>14 フィッシャーズ、メンバー全員30代に突入してもファン層維持',
    '兄者弟者、ゲーム実況の最古参。登録者100万維持の安定感',
    '>>1 ヒカキン、最近のショート動画の伸びがエグい。ショートでも100万再生超え常連',
    'もちまる日記、猫飼育VLOG200万。ペット系の新潮流',
    '>>1 結論: ヒカキンと中田敦彦は別格。次世代はコムドットと両学長',
    '>>19 同意。YouTuber市場、エンタメ系から教育・お金系へ広がってる'
  ];
  base_ts := now() - interval '1 day';
  uid := uids[1 + (10000 % array_length(uids,1))];
  insert into public.bbs_threads (author_id, title, category, replies_count, created_at)
    values (uid, title, category, 0, base_ts) returning id into tid;
  for i in 1..array_length(reps,1) loop
    uid := uids[1 + ((i * 41 + 23) % array_length(uids,1))];
    insert into public.bbs_replies (thread_id, author_id, content, created_at)
      values (tid, uid, reps[i], base_ts + (i * interval '90 minutes'));
  end loop;

  ----------------------------------------------------------------
  -- ビジネススレッド
  ----------------------------------------------------------------
  title := '副業何やってる？月いくら稼げてる？';
  category := 'ビジネス';
  reps := array[
    'ブログ アフィリエイト 3年目、月10万安定。WordPress 運用、初月から3ヶ月は0円継続耐え抜いた',
    'Amazon FBA 物販、月商200万。利益率10%超え。中国製品の選定が肝',
    '>>1 ブログ、3年で月10万は普通。3ヶ月の継続が一番きついよね',
    'ココナラでデザインスキル販売、月50万到達。本業を超える月も',
    '>>2 Amazon FBA、初期投資いくら？利回りどれくらい？',
    '>>4 ココナラ、デザインスキルあると単価高い。月50万は凄い',
    'プログラミングスクール卒業からWebエンジニア、年収300→500万でリモート週3',
    '>>7 プログラミング、フリーランス化で年収700万までいける',
    '不動産投資、区分マンション3戸で月20万キャッシュフロー',
    '>>9 不動産、初期費用と借入考えるとリスク高くない？利回り何%？',
    '>>10 表面利回り7%物件。実質5%、35年ローンで20年後完済予定',
    '個別株、トヨタ自動車1000株保有。配当年間14万。優待利回り考えると6%超え',
    'YouTube ゲーム実況、登録者2万。広告収入だけだと月3万、案件と合わせて月10万',
    '>>13 YouTube、登録者数より動画再生数が肝。バズれば一気にトップ',
    'メルカリ転売、せどり3年目。月8-15万、本業との時間バランスが鍵',
    'ライティング業務、クラウドワークス + ランサーズで月20万。記事1本3000-5000円',
    '>>16 ライティング、AI で記事生成できる時代だけど人間の差別化必要',
    '株式投資 個別株、ピーター・リンチ的なグロース投資。年間+25%継続',
    '>>1 副業選び、自分の本業との相性が大事。事務系ならライティング、技術系なら案件',
    '>>19 同意。本業のスキル活かせる副業選ぶと、両方相乗効果ある'
  ];
  base_ts := now() - interval '36 hours';
  uid := uids[1 + (11000 % array_length(uids,1))];
  insert into public.bbs_threads (author_id, title, category, replies_count, created_at)
    values (uid, title, category, 0, base_ts) returning id into tid;
  for i in 1..array_length(reps,1) loop
    uid := uids[1 + ((i * 43 + 29) % array_length(uids,1))];
    insert into public.bbs_replies (thread_id, author_id, content, created_at)
      values (tid, uid, reps[i], base_ts + (i * interval '70 minutes'));
  end loop;

end $$;

-- ============================================================
-- 5. 投稿への会話的コメント (内容に応答)
-- ============================================================
do $$
declare
  uids uuid[];
  uid uuid;
  pid uuid;
  -- 投稿ごとに「その投稿への返答コメント」を結びつけた pair
  pairs text[][] := array[
    array['GR86納車3ヶ月目',          'GR86は2.4Lのトルク感がいい。先代86との違い体感したい'],
    array['GR86納車3ヶ月目',          'シビックタイプR FK8と比較したらどう感じる？乗り換え検討中'],
    array['シビックタイプR FL5',      'FK8からの乗り換え？フィーリングの違い気になる'],
    array['BMW M3 G80',               'M3の本気度すごい。アクラポビッチ入れたら近所迷惑になりそう'],
    array['ND2ロードスターRF',        'NDのデザイン勝ち同意。NCも好きだけどNDのバランス感が別格'],
    array['GT-R R34',                 'BNR34、もはや美術品。ワイルドスピード組の影響本当にデカい'],
    array['Z900RS 納車',              'ICONカラー、何年経っても飽きないデザイン。羨ましい'],
    array['CB400SF Revo',             '教習所バイクの最終モデル買えた人羨ましい。生産終了惜しい'],
    array['ハーレー Fat Boy',         '500kg超え、Uターンが怖い。座ったときの安定感も気になる'],
    array['鬼滅の刃 無限城編',        'ufotable の水面エフェクト、リアルタイムでCGとは思えない'],
    array['呪術廻戦 渋谷事変',        '五条悟封印シーンで号泣。MAPPAの作画スタッフ大変そう'],
    array['葬送のフリーレン',         'マッドハウス、本気のフリーレン作ってる感じが伝わる'],
    array['乃木坂46 賀喜遥香 卒業',   '賀喜さん卒業、ショックすぎる。次のセンター誰になるんだろう'],
    array['乃木坂46 賀喜遥香 卒業',   '久保史緒里か遠藤さくら、どっちもセンターに似合う'],
    array['日向坂46 小坂菜緒',        'こさかな復活ライブ、当選した。涙確定'],
    array['兎田ぺこら の新衣装',       'しぐれういさんの新衣装、ホロライブ5期生で一番好き'],
    array['宝鐘マリン 3D配信',         'マリン船長の3D、リッチ感ハンパない。CG技術凄い'],
    array['葛葉×叶',                  'ChroNoiR の VALORANT 配信、戦略レベルが世界基準'],
    array['大谷翔平、6月時点',         '今シーズン45本予想。MVP確定だけど本塁打王は審判次第'],
    array['佐々木朗希',                'メジャー第1試合7回1失点、日本人投手史上の快進撃'],
    array['三笘薫 ブライトン残留',     'チェルシー行ったら埋もれる。ブライトンが正解'],
    array['菅田将暉',                 '「キャラクター」のFukase との共演、漫画家役の狂気が秀逸'],
    array['吉沢亮 ドラマ「国宝」',    '歌舞伎役者の役作り3年がかり、本気度伝わる'],
    array['広瀬すず 映画',            '「流浪の月」での安藤サクラとの共演で表現力一段上がった'],
    array['石原さとみ',               '子育てしながらの主演復帰、役者として深みが増した'],
    array['水原希子、ファッション',    'カルチャー全体への発信、SNS言動も話題'],
    array['ヒカキン 登録者1300万',    '毎日投稿継続の根性、これだけで尊敬する'],
    array['コムドット やまと',         '主演映画決定、やってみたシリーズから映画俳優への進化すごい'],
    array['副業ブログ 3年目',         '3ヶ月の継続が一番つらい。0円期間を乗り越えた人だけが続けられる'],
    array['FIRE目標 6000万',          'eMAXIS Slim 全世界株式、シンプル最強。配当再投資で複利効果'],
    array['NISA枠 360万埋めた',       'VTI + 高配当株のバランス、教科書通りのポートフォリオ']
  ];
  i int;
  j int;
  comment_text text;
  match_text text;
  comment_extras text[] := array[
    'これは参考になる', 'やっぱそうだよね', 'うちもそう思った',
    'こういう情報待ってた', '保存した', 'フォローした',
    '同じく検討中', 'うらやま', '勉強になる', '画像も助かる',
    '具体的すぎて参考になる', '次回も期待', 'これは賛同'
  ];
begin
  select array_agg(id order by id) into uids from auth.users
    where email like 'dummy_v2_%@geek-seed.example';
  if uids is null then return; end if;

  for i in 1..array_length(pairs, 1) loop
    match_text := pairs[i][1];
    comment_text := pairs[i][2];
    -- 該当する投稿を1件ピック
    select id into pid from public.posts
      where content like '%' || match_text || '%'
        and author_id in (select id from auth.users where email like 'dummy_v2_%@geek-seed.example')
      order by created_at desc limit 1;
    if pid is null then continue; end if;

    -- 主コメント (会話形式)
    uid := uids[1 + ((i * 5) % array_length(uids,1))];
    insert into public.comments (post_id, author_id, content, avatar_color, created_at)
    values (
      pid, uid, comment_text,
      'hsl(' || (random() * 360)::int || ', 60%, 70%)',
      now() - (random() * interval '12 days')
    );

    -- 追加のリアクション系コメント 1-2 件
    for j in 1..(1 + (random() * 2)::int) loop
      uid := uids[1 + ((i * 13 + j * 7) % array_length(uids,1))];
      insert into public.comments (post_id, author_id, content, avatar_color, created_at)
      values (
        pid, uid,
        comment_extras[1 + ((i + j) % array_length(comment_extras,1))],
        'hsl(' || (random() * 360)::int || ', 60%, 70%)',
        now() - (random() * interval '10 days')
      );
    end loop;
  end loop;
end $$;

-- ============================================================
-- 6. いいね (各投稿にランダムな人数)
-- ============================================================
do $$
declare
  uids uuid[];
  post_ids uuid[];
  uid uuid;
  pid uuid;
  i int;
  j int;
  like_count int;
begin
  select array_agg(id) into uids from auth.users where email like 'dummy_v2_%@geek-seed.example';
  select array_agg(id) into post_ids from public.posts
    where author_id in (select id from auth.users where email like 'dummy_v2_%@geek-seed.example')
    order by random();
  if uids is null or post_ids is null then return; end if;

  for i in 1..array_length(post_ids, 1) loop
    pid := post_ids[i];
    like_count := (random() * 8 + 2)::int;
    for j in 1..like_count loop
      uid := uids[1 + ((i * 23 + j * 7) % array_length(uids,1))];
      begin
        insert into public.likes (post_id, user_id, created_at)
        values (pid, uid, now() - (random() * interval '15 days'));
      exception when unique_violation then
        null;
      end;
    end loop;
  end loop;
end $$;

-- ============================================================
-- 7. リアクション (ミームスタンプ)
-- ============================================================
do $$
declare
  uids uuid[];
  post_ids uuid[];
  uid uuid;
  pid uuid;
  i int;
  j int;
  rcount int;
  memes text[] := array[
    'それは悪手じゃろ','控えめに言って神','尊い','てぇてぇ','分かる',
    'マジカヨ','虚無','ニッコリ','大正解','優勝',
    '才能','異論は認めない','深い','尊敬する','ぴえん',
    '草','エモい','沼','激推し','圧倒的感謝'
  ];
begin
  if not exists (select 1 from information_schema.tables where table_name = 'post_reactions') then
    return;
  end if;
  select array_agg(id) into uids from auth.users where email like 'dummy_v2_%@geek-seed.example';
  select array_agg(id) into post_ids from public.posts
    where author_id in (select id from auth.users where email like 'dummy_v2_%@geek-seed.example')
    order by random() limit 120;
  if uids is null or post_ids is null then return; end if;

  for i in 1..array_length(post_ids, 1) loop
    pid := post_ids[i];
    rcount := (random() * 5)::int;
    for j in 1..rcount loop
      uid := uids[1 + ((i * 29 + j * 11) % array_length(uids,1))];
      begin
        insert into public.post_reactions (post_id, user_id, meme, created_at)
        values (pid, uid, memes[1 + ((i + j * 5) % array_length(memes, 1))], now() - (random() * interval '10 days'));
      exception when unique_violation then
        null;
      end;
    end loop;
  end loop;
end $$;

-- ============================================================
-- 8. イベント (各テーマに 1-2 個)
-- ============================================================
insert into public.events (title, description, event_date, tag_name, location, is_official) values
  ('東京モーターショー2026',           '最新の自動車技術と新型車展示',                       current_date + 22, '車',         '東京ビッグサイト',     true),
  ('スーパー耐久富士24時間',           'モータースポーツの祭典、GR86・BRZレースも',         current_date + 35, 'スポーツカー','富士スピードウェイ',   true),
  ('東京モーターサイクルショー',       'バイクの新型・カスタム展示、Z900RS/MT-09など',     current_date + 18, 'バイク',     '東京ビッグサイト',     true),
  ('鈴鹿8耐 2026',                     '夏の耐久ロードレース',                              current_date + 60, 'バイク',     '鈴鹿サーキット',       true),
  ('AnimeJapan 2026',                  'アニメ業界最大級のイベント、鬼滅・呪術ステージあり',current_date + 25, 'アニメ',     '東京ビッグサイト',     true),
  ('呪術廻戦 渋谷事変原画展',          '原画＋制作秘話の展示',                              current_date + 14, '呪術廻戦',   '東京・渋谷',           true),
  ('葬送のフリーレン原画展',           'マッドハウス制作秘話と原画',                        current_date + 21, '葬送のフリーレン','東京',           true),
  ('坂道合同ライブ',                   '乃木坂・櫻坂・日向坂 合同ファン感謝祭',              current_date + 10, 'アイドル',   '東京ドーム',           true),
  ('AKB48 全国ツアー2026',             '夏ツアーが京セラドームから始動',                    current_date + 7,  'アイドル',   '京セラドーム',         true),
  ('日向坂46 W-KEYAKIフェス',          'おひさま集合、3デイズ開催',                        current_date + 38, '日向坂46',   'ZOZOマリンスタジアム', true),
  ('ホロライブEXPO 2026',              'グッズ展示+ステージイベント、ぺこら・マリン出演',  current_date + 28, 'Vtuber',     '幕張メッセ',           true),
  ('にじさんじ Lifetime Mafia',        '人気企画の公開収録、葛葉・叶出演',                  current_date + 32, 'にじさんじ', 'TOKYO DOME CITY HALL', true),
  ('プロ野球オールスター',             '夢の球宴、大谷翔平 始球式予定',                     current_date + 40, '野球',       '横浜スタジアム',       true),
  ('日本代表 親善試合',                'サッカーW杯予選前の調整試合、三笘・久保出場',       current_date + 12, 'サッカー',   '埼玉スタジアム',       true),
  ('F1日本グランプリ',                 'モビリティリゾートもてぎ、フェルスタッペン参戦',    current_date + 55, 'F1',         '鈴鹿',                 true),
  ('日本アカデミー賞授賞式',           '邦画の優秀作品+俳優選出、吉沢亮・安藤サクラ',       current_date + 45, '俳優',       '東京・グランドプリンスホテル新高輪', true),
  ('東京ガールズコレクション',         '春夏ファッションショー、水原希子・冨永愛',          current_date + 20, 'モデル',     '横浜アリーナ',         true),
  ('FNS歌謡祭 春の祭典',               '人気アーティスト集結の音楽特番、Number_i出演',      current_date + 16, '芸能人',     'TBS本社',              true),
  ('YouTube Fanfest Japan 2026',       '人気YouTuberライブ、ヒカキン・はじめしゃちょー',   current_date + 30, 'YouTuber',   '幕張メッセ',           true),
  ('リベラルアーツ大学 オフ会',        '両学長ファンミ、お金リテラシー講座',                current_date + 17, '投資',       '虎ノ門ヒルズ',         true),
  ('日経ビジネスサミット',             'CEO講演 + ピッチイベント',                          current_date + 26, 'ビジネス',   '東京国際フォーラム',   true)
on conflict do nothing;

-- ============================================================
-- 9. カウント同期
-- ============================================================
update public.posts p set
  likes_count    = coalesce((select count(*) from public.likes l where l.post_id = p.id), 0),
  comments_count = coalesce((select count(*) from public.comments c where c.post_id = p.id), 0)
where p.author_id in (select id from auth.users where email like 'dummy_v2_%@geek-seed.example');

update public.bbs_threads t set
  replies_count = coalesce((select count(*) from public.bbs_replies r where r.thread_id = t.id), 0),
  last_reply_at = (select max(created_at) from public.bbs_replies r where r.thread_id = t.id);

-- 完了
select 'seed v2 改訂版 完了: ユーザー60 / 投稿180 (具体名+写真+リンク) / BBS12スレ (会話形式) / コメント・いいね・リアクション・イベント' as result;
