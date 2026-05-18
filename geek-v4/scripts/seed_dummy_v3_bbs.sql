-- ============================================================
-- ダミー BBS スレッド v3
-- 8 カテゴリ × 複数スレ × 各15〜22 返信
--   雑談 / ゲーム / マンガ / 音楽 / 推し活 / グルメ / コスプレ / ニュース
-- ============================================================
-- 前提: seed_dummy_v2.sql 実行済み (dummy_v2_xxx@geek-seed.example ユーザー)
-- 再実行可能: 直前の v3_bbs スレッドだけ消してから入れ直す
-- ============================================================

-- ============================================================
-- 0. クリーンアップ (v3 で作った BBS スレッドだけ削除)
-- ============================================================
delete from public.bbs_threads
where title like '[v3]%';

-- ============================================================
-- 1. メイン投入: dummy_v2 ユーザーを使って 8 カテゴリ分の濃いスレッドを追加
-- ============================================================
do $$
declare
  uids uuid[];
  uid uuid;
  tid uuid;
  reps text[];
  title text;
  category text;
  base_ts timestamptz;
  i int;
begin
  select array_agg(id order by id) into uids from auth.users
    where email like 'dummy_v2_%@geek-seed.example';
  if uids is null or array_length(uids,1) is null then
    raise notice 'no dummy v2 users; run seed_dummy_v2.sql first';
    return;
  end if;

  ----------------------------------------------------------------
  -- 雑談 #1
  ----------------------------------------------------------------
  title := '[v3] 今日あった一番どうでもいい話、書いてけ';
  category := '雑談';
  reps := array[
    'コンビニで会計の時、店員さんと「アッ...アッ...」って2人同時にお釣り取りに行った',
    '>>1 あるあるすぎて笑った',
    '駅のエスカレーターで前の人と同じタイミングで立ち位置変えて気まずかった',
    '今日昼に食ったカップ麺、底に粉末スープ残ってて最後の一口だけ激辛だった',
    '>>4 わかる、たまにスープ濃すぎる時あるよな',
    'マンション帰宅したら隣の部屋の前にAmazonの段ボール5個積まれてた',
    '電車で寝てたら起きた瞬間に隣のおじさんとガッツリ目合った',
    '>>7 そのおじさんも気まずいやろなw',
    '靴下、洗濯すると必ず1枚行方不明になる現象を解明したい',
    '>>9 洗濯機の中に挟まってるか、ベッドの下に転がってるかどっちか',
    'スマホの充電ケーブル、3本買ったのに3本ともリビングで絡まってる',
    'コーヒー淹れようとして粉じゃなくて麦茶のティーバッグ入れた',
    '>>12 経験ある、何かが違うとは思った瞬間',
    '会社の同僚、今日いきなり髪型変えてきたけど誰も触れない地獄',
    '>>14 触れていいのか分からないの普通にあるw',
    'マスク外し忘れて寝てたら朝起きたとき鼻だけ赤くなってた',
    'コンビニで「袋つけますか？」って聞かれるの、毎回0.5秒悩む',
    '>>17 環境のためにエコバッグ持ってきたつもりが、コンビニ近所だし手で持つかってなる',
    'カラオケで採点モード使ったら平均65点。歌が下手と気づいた31歳',
    '>>19 採点モードは罪深い。気にせず楽しめ',
    '今日の天気予報、雨マークだったのに快晴で傘無駄に持ち歩いた'
  ];
  base_ts := now() - interval '10 hours';
  uid := uids[1 + (101 % array_length(uids,1))];
  insert into public.bbs_threads (author_id, title, category, replies_count, created_at)
    values (uid, title, category, 0, base_ts) returning id into tid;
  for i in 1..array_length(reps,1) loop
    uid := uids[1 + ((i * 7 + 13) % array_length(uids,1))];
    insert into public.bbs_replies (thread_id, author_id, content, created_at)
      values (tid, uid, reps[i], base_ts + (i * interval '12 minutes'));
  end loop;

  ----------------------------------------------------------------
  -- 雑談 #2
  ----------------------------------------------------------------
  title := '[v3] 真夜中に書き込む人だけが集うスレ';
  category := '雑談';
  reps := array[
    '深夜2時、寝れない',
    '>>1 仲間。3時の鐘が鳴る前に寝たい',
    '冷蔵庫開けて閉めるだけの行動、深夜にしがち',
    '夜中にYouTube見始めると気付いたら朝',
    '>>4 アルゴリズムが容赦ない',
    '夜のコンビニって店員さんと客の距離感が独特',
    '>>6 24時間営業の店舗、店員さん一人体制で大変そう',
    '夜中に冷蔵庫の音、急に大きく聞こえる現象',
    '寝る前にスマホ見るなって言われるけど、それしかやることない',
    '>>9 ブルーライトカット眼鏡買ったけど効果が体感できない',
    '部屋暗くしてエアコンの音だけ聞いてる時間が一番好き',
    '>>11 詩人',
    'インスタントラーメンを夜中に食べる罪悪感が癖になる',
    '結局朝5時にやっと眠くなって、起きるのが昼',
    '>>14 これな。生活リズム崩壊',
    '夜中の散歩、意外と人がいる',
    '深夜のラジオ番組、ながら聞きするのが至福',
    '>>17 オールナイトニッポンの伝統',
    '寝ようとしてベッド入ると目がギラギラする現象',
    '>>19 寝室と寝る場所を分けると改善するらしい'
  ];
  base_ts := now() - interval '3 days';
  uid := uids[1 + (201 % array_length(uids,1))];
  insert into public.bbs_threads (author_id, title, category, replies_count, created_at)
    values (uid, title, category, 0, base_ts) returning id into tid;
  for i in 1..array_length(reps,1) loop
    uid := uids[1 + ((i * 11 + 5) % array_length(uids,1))];
    insert into public.bbs_replies (thread_id, author_id, content, created_at)
      values (tid, uid, reps[i], base_ts + (i * interval '8 minutes'));
  end loop;

  ----------------------------------------------------------------
  -- ゲーム #1
  ----------------------------------------------------------------
  title := '[v3] エルデンリング DLC SHADOW OF THE ERDTREE クリアした人語ろう';
  category := 'ゲーム';
  reps := array[
    'ラスボス、プロムン・メスメル戦よりキツいんだが',
    '>>1 メスメル戦のローリング地獄、心折れそうになった',
    '聖樹の枝の祝福集めるだけで体感+8レベル分くらい強くなる',
    'NPC招集祭壇でレオナルド呼べるの本編に持ち込みたい',
    '>>4 同感。レオナルド味方として強すぎる',
    'スコリャ呪術もいいけどクリア後はやっぱ脳筋ビルド',
    'リアル王者ラダーンの完全体、本編の方が良かった説',
    '>>7 設定的に黄金樹のリアル王者ラダーンとは別人格扱いだから...',
    'メスメル槍と古き獣の杖の二刀流、戦技でほぼ全部殴れる',
    '>>9 神話槍構成は本気の硬派ビルド',
    'タリスマン2個増えたのありがたい、エンチャ盛れる',
    'NPCイベント、ヒアエニア(Hyetta?)ルートと交差してて分岐怪しい',
    '>>12 ヒアエニアじゃなくてヒアラン。フロムあるある',
    'DLC専用ボス、本編より平均強い。難易度的にニューゲーム+前提',
    '影の地のフィールドBGM最高、特にラウフ古遺跡',
    '>>15 シャブリリの古遺跡入った時の絶望感、忘れられない',
    'スコリャ呪術師の集落イベント、超有能',
    '>>17 ベイル装備手に入れた瞬間ガッツポーズ',
    '次回作、ELDEN RING NIGHTREIGN がマルチ専用？フロム新境地',
    'クリア後にもう1周する作品って今のところエルデンだけかも',
    '>>20 メトロイドプライム リマスター級の体験'
  ];
  base_ts := now() - interval '8 days';
  uid := uids[1 + (301 % array_length(uids,1))];
  insert into public.bbs_threads (author_id, title, category, replies_count, created_at)
    values (uid, title, category, 0, base_ts) returning id into tid;
  for i in 1..array_length(reps,1) loop
    uid := uids[1 + ((i * 13 + 7) % array_length(uids,1))];
    insert into public.bbs_replies (thread_id, author_id, content, created_at)
      values (tid, uid, reps[i], base_ts + (i * interval '90 minutes'));
  end loop;

  ----------------------------------------------------------------
  -- ゲーム #2
  ----------------------------------------------------------------
  title := '[v3] Apex Legends シーズン22 環境語ろう';
  category := 'ゲーム';
  reps := array[
    'ヒューズ Buff 来たのにピック率上がらない不思議',
    '>>1 ニュウキャッスル + バンガロールが固すぎてヒューズの居場所がない',
    'プロリーグでVALKヴァルキリーまだトップピック維持してる',
    'ホライゾン、グラビティリフト調整で帰ってきた感ある',
    '>>4 ホラ復活嬉しいけどQの硬直長くて使いづらい',
    'マッドマギーは結局上位プレイヤーじゃないとキツい',
    'ランクのキルポイント計算、KP上限緩和で打開しやすくなった',
    '>>7 マスター以上は依然KP上限の壁あるけど',
    'プラチナ帯のレベルダウン現象、リセット後ひどい',
    '>>9 シーズン序盤あるある',
    'AKがフルチョーク + デジタルスコープでDPS最強格',
    '>>11 R301の連射安定性に比べたら反動キツい',
    'マスティフ復活希望、ボルトショットガン強すぎ',
    'PUBG MOBILE から流れてきた勢いだけど Apex 操作難しい',
    '>>14 同じバトロワでも別ゲー感覚、慣れたら戻れない',
    'コントローラーvsキーボードマウス、競技シーンでは依然分かれてる',
    '>>16 PADエイムアシストの議論は永遠の課題',
    'シーズン22、新マップ「ストームポイント」リバンプ来てる',
    '>>18 リバンプというより微調整レベルじゃない？',
    'コンテストポイントの調整で激戦区分散したのは良い',
    '結局Apexは「強キャラ + 強武器」より「連携取れるパーティ」が最強'
  ];
  base_ts := now() - interval '2 days';
  uid := uids[1 + (302 % array_length(uids,1))];
  insert into public.bbs_threads (author_id, title, category, replies_count, created_at)
    values (uid, title, category, 0, base_ts) returning id into tid;
  for i in 1..array_length(reps,1) loop
    uid := uids[1 + ((i * 17 + 11) % array_length(uids,1))];
    insert into public.bbs_replies (thread_id, author_id, content, created_at)
      values (tid, uid, reps[i], base_ts + (i * interval '40 minutes'));
  end loop;

  ----------------------------------------------------------------
  -- ゲーム #3
  ----------------------------------------------------------------
  title := '[v3] ゼルダの伝説 ティアキン、500時間遊んだ猛者おる？';
  category := 'ゲーム';
  reps := array[
    'はい、現在620時間。地下マップ100%、空島100%、地上99%',
    '>>1 すげぇ。地上の99%って何残してる？',
    '>>2 ハイラル城裏のコログ1匹。場所マジで分からん',
    'ウルトラハンドで作った乗り物、SNSで凄いの見ると自分の発想力の無さを実感',
    '>>4 蒸気船作る人とか変態的。研究者並み',
    'マスターソード強化フル + 攻撃力UP料理 で雑魚瞬殺できる時の快感',
    'ゾナイの装置、ロケットがおもしろアイテム筆頭',
    '>>7 ロケット+盾で空中ジャンプは草',
    '英傑モード(Hero Mode/マスターモード)実装はよ',
    '>>9 DLC期待してたけど結局来ないかも',
    'シーカータワー(空島のチカラ管理人)再登場してほしかった',
    'ブレワイから引き続きハイラル世界の作り込みは唯一無二',
    '>>12 任天堂のオープンワールド技術、世界1位だわ',
    'スカイダイビング、地下マップ降下が一番気持ちいい',
    '>>14 ガーディアン残党(ハートビート瓜) との遭遇、地下なら最強',
    '料理レシピ集めも 500時間プレイの楽しみ方の一つ',
    'コログのお駄賃 1000個達成済、ご褒美の○○マスクの破壊力',
    '>>17 コログのマスク、達成感はあるけど効果は地味...',
    '次回作、ハイラル外の地続き世界に行きたい',
    '結論: 500時間遊んでも飽きない、ティアキンは10年後の名作'
  ];
  base_ts := now() - interval '6 days';
  uid := uids[1 + (303 % array_length(uids,1))];
  insert into public.bbs_threads (author_id, title, category, replies_count, created_at)
    values (uid, title, category, 0, base_ts) returning id into tid;
  for i in 1..array_length(reps,1) loop
    uid := uids[1 + ((i * 19 + 3) % array_length(uids,1))];
    insert into public.bbs_replies (thread_id, author_id, content, created_at)
      values (tid, uid, reps[i], base_ts + (i * interval '110 minutes'));
  end loop;

  ----------------------------------------------------------------
  -- マンガ #1
  ----------------------------------------------------------------
  title := '[v3] 進撃の巨人 完結から1年、結局あのラストどう思う？';
  category := 'マンガ';
  reps := array[
    'ミカサのラスト、賛否分かれたけどあれ以外考えられない',
    '>>1 エレンの「俺はミカサが好きだ」発言、初見鳥肌',
    '地ならし容認できなかったけど、エレンの選択は伏線回収完璧',
    'ハンジさんの最期、これは泣いた',
    '>>4 ハンジ団長として完璧な散り様、エンタメ漫画史に残る',
    '結末の意見対立、賛否でファン界隈ガチで割れたよな',
    'リヴァイ生存ルート、最後にジャンと再会するシーン補完してほしかった',
    '>>7 ジャン・コニーの仲、最終盤で逆転して胸熱',
    '諫山先生インタビュー、「アルミンが主人公」発言が深い',
    '>>9 アルミン視点の物語と考えると見方変わる',
    '進撃の最終回、漫画史でランキング作るとしたら上位確実',
    'NETFLIX 海外ファン、ラストに「This is too realistic」反応多数',
    'リヴァイの幼少期エピソード、もう少し描いてほしかった',
    '>>13 リヴァイは外伝(悔いなき選択)で十分',
    '結末の解釈、エレンの愛が全てを動かしたって読み方が好き',
    '>>15 同感。地ならしを止めるためだけじゃなく、ミカサに自由をって',
    'エンディング後の世界、ナレーション部分の戦争描写が痛烈',
    '進撃 全34巻、人生に1度は読むべき作品',
    '>>18 同意。日本マンガで「戦争」をここまで描いた作品は希少',
    'アニメ最終話、原作との差分があったけど結果オーライ',
    '>>20 MAPPA 最終回の見開きシーン、原作リスペクト感じた'
  ];
  base_ts := now() - interval '12 days';
  uid := uids[1 + (401 % array_length(uids,1))];
  insert into public.bbs_threads (author_id, title, category, replies_count, created_at)
    values (uid, title, category, 0, base_ts) returning id into tid;
  for i in 1..array_length(reps,1) loop
    uid := uids[1 + ((i * 23 + 5) % array_length(uids,1))];
    insert into public.bbs_replies (thread_id, author_id, content, created_at)
      values (tid, uid, reps[i], base_ts + (i * interval '3 hours'));
  end loop;

  ----------------------------------------------------------------
  -- マンガ #2
  ----------------------------------------------------------------
  title := '[v3] 連載中のマンガで「これは10年後に古典になる」と思う作品';
  category := 'マンガ';
  reps := array[
    '推しの子、原作完結したけど10年後絶対読み継がれる',
    '>>1 アクアの最期は議論呼んだけど、テーマ的に正しい結末',
    'チェンソーマン 第二部、ドラマ性で第一部超えた',
    'ダンダダン、龍幸伸さんの画力で世界中ファン獲得中',
    '>>4 ダンダダン、海外人気めちゃくちゃ高い',
    '怪獣8号、設定だけなら過去にもあったけどキャラ力で抜けてる',
    'ブルーロック、サッカーマンガとして革命的な視点',
    '>>7 サッカーじゃなくて「エゴの哲学」マンガとして読んでる',
    'スパイファミリー、ファミリーコメディの定番化候補',
    'チ。―地球の運動について―、完結したけど学術系マンガの最高峰',
    '>>10 チ。は史実とフィクションの混ぜ方が芸術的',
    '葬送のフリーレン、ファンタジー×日常の融合が新しい',
    '>>12 葬送のフリーレン、世界観の深さがマンガ史的に新ジャンル',
    'アンデッドアンラック、ジャンプ系で複雑な伏線回収するから読み返しが楽しい',
    'ワンピース完結まであと数年、最終巻発売イベントは社会現象になりそう',
    '>>15 ワンピ最終巻、確実に書店に行列できる',
    '名探偵コナン、青山先生健在のうちに完結してほしい',
    'ガッシュベル新作 「2」、雷句先生の連載復活で歓喜',
    '>>18 ガッシュ2、ジャンプ→Web連載になったけど内容濃い',
    'キングダム、史実考証ベースの戦記マンガ最高峰',
    '結論: 「古典」になるかは10年後の話題性次第。今熱いのを今読もう'
  ];
  base_ts := now() - interval '4 days';
  uid := uids[1 + (402 % array_length(uids,1))];
  insert into public.bbs_threads (author_id, title, category, replies_count, created_at)
    values (uid, title, category, 0, base_ts) returning id into tid;
  for i in 1..array_length(reps,1) loop
    uid := uids[1 + ((i * 27 + 9) % array_length(uids,1))];
    insert into public.bbs_replies (thread_id, author_id, content, created_at)
      values (tid, uid, reps[i], base_ts + (i * interval '2 hours'));
  end loop;

  ----------------------------------------------------------------
  -- 音楽 #1
  ----------------------------------------------------------------
  title := '[v3] 邦楽で「死ぬ前にこの1曲」教えて';
  category := '音楽';
  reps := array[
    'スピッツ「ロビンソン」、青春そのもの',
    '>>1 同意。スピッツのメロディは時代超える',
    'Mr.Children「Tomorrow never knows」、世代の象徴',
    '宇多田ヒカル「First Love」、永遠の名曲',
    '>>4 First Love、初恋の人を必ず思い出す',
    'B''z「ultra soul」、運動会で永遠に流れる',
    'YOASOBI「夜に駆ける」、現代邦楽の象徴',
    '>>7 YOASOBI、小説原作の歌で新時代を作った',
    'Official髭男dism「Pretender」、紅白で歌われ続けるだろう',
    'King Gnu「白日」、常田大希の才能の極み',
    '>>10 King Gnu、ジャンルレスで革命的',
    'あいみょん「マリーゴールド」、令和の名曲',
    '中島みゆき「糸」、結婚式の定番として永遠',
    '>>13 「糸」、世代問わず泣ける曲ランキング1位',
    'サザンオールスターズ「TSUNAMI」、桑田佳祐の最高傑作',
    'ミスチル「innocent world」、青春の終わりが見える曲',
    '>>16 桜井和寿、歌詞の世界観がノーベル文学賞級',
    'X JAPAN「紅」、ライブのオープニングで人生変わる',
    '>>18 hideのカリスマ性、X JAPAN無くなった今でも色褪せない',
    'Aimer「カタオモイ」、結婚式定番として10年残る',
    '結論: 邦楽は時代ごとに名曲が出るから「1曲」は決められない'
  ];
  base_ts := now() - interval '6 days';
  uid := uids[1 + (501 % array_length(uids,1))];
  insert into public.bbs_threads (author_id, title, category, replies_count, created_at)
    values (uid, title, category, 0, base_ts) returning id into tid;
  for i in 1..array_length(reps,1) loop
    uid := uids[1 + ((i * 29 + 7) % array_length(uids,1))];
    insert into public.bbs_replies (thread_id, author_id, content, created_at)
      values (tid, uid, reps[i], base_ts + (i * interval '110 minutes'));
  end loop;

  ----------------------------------------------------------------
  -- 音楽 #2 (洋楽)
  ----------------------------------------------------------------
  title := '[v3] 洋楽好き集まれ、最近のヘビロテ教えて';
  category := '音楽';
  reps := array[
    'Sabrina Carpenter「Espresso」、サマーソングオブザイヤー',
    '>>1 Espresso、TikTok で爆発したのも納得',
    'Taylor Swift「Cruel Summer」、今更ヘビロテ中',
    'The Weeknd 新アルバム発表、AfterHours以来の本気感',
    '>>4 The Weeknd、80sシンセウェーブ路線継続して欲しい',
    'Olivia Rodrigo「GUTS」アルバム全曲名曲',
    'Billie Eilish「BIRDS OF A FEATHER」、姉のFinneasアレンジ神',
    '>>7 Billie の弟Finneas、プロデューサーとして異常な才能',
    'Doja Cat「Paint The Town Red」、ラップの実力ハンパない',
    'Bruno Mars × Lady Gaga「Die With A Smile」、デュオ最高',
    '>>10 Die With A Smile、Bruno のレジェンド感戻ってきた',
    'Charli XCX「BRAT」、夏のスマッシュアルバム',
    'Post Malone カントリーアルバム「F-1 Trillion」、ジャンル超越',
    '>>13 ポスマロ、ジャンル変えても安定したクオリティ',
    'Tate McRae「greedy」、ダンスポップ復活の象徴',
    '>>15 Tate McRae、ダンス出身でパフォーマンス完璧',
    'Beyoncé「COWBOY CARTER」、カントリーチャレンジ大成功',
    'Kendrick Lamar「Not Like Us」、ドレイクとのビーフで歴史的',
    '>>18 Not Like Us、ラップ史にぶち込まれる1曲',
    'Sleep Token、メタルシーンの新星',
    'Spotify Wrapped 2024、自分のリスト見直したらほぼ全部K-POPだった件'
  ];
  base_ts := now() - interval '1 days';
  uid := uids[1 + (502 % array_length(uids,1))];
  insert into public.bbs_threads (author_id, title, category, replies_count, created_at)
    values (uid, title, category, 0, base_ts) returning id into tid;
  for i in 1..array_length(reps,1) loop
    uid := uids[1 + ((i * 31 + 13) % array_length(uids,1))];
    insert into public.bbs_replies (thread_id, author_id, content, created_at)
      values (tid, uid, reps[i], base_ts + (i * interval '30 minutes'));
  end loop;

  ----------------------------------------------------------------
  -- 推し活 #1
  ----------------------------------------------------------------
  title := '[v3] 推し活で月いくら使ってる？正直に答えて';
  category := '推し活';
  reps := array[
    'ライブ含めて月3万円ペース、年間36万円',
    '>>1 自分も同じくらい。家計簿つけると現実見える',
    '生写真とトレカで月5万、ライブ遠征で年間60万コース',
    '推しがいないと人生楽しくない、コスパで考えると安い',
    '>>4 これ。趣味が無い人と比べたら充実度別格',
    '本人不在の同担拒否ガチ勢、年間100万超えてる',
    'グッズ収納のために部屋借り直した、月7000円追加',
    '>>7 部屋借りるのはガチすぎる',
    '推しのCD/Blu-ray、同じものを複数買う「複数買い文化」',
    '>>9 握手券・チェキ券・抽選券... 1人1枚じゃ足りない',
    '推しが舞台俳優だから、舞台代+遠征費で1公演10万',
    '推し活してから貯金できなくなった、でも幸せ',
    '>>12 推しのために貯金、推しのために働く',
    '推し活費を「自己投資」と言い換えて経費にしてる(個人事業主)',
    '>>14 確定申告でNG食らわないでねw',
    'グッズ買いすぎて部屋が祭壇化',
    '推しに会えない時のメンタル、お金じゃ買えない',
    '>>17 推し活は精神安定剤、医療費と思えば安い',
    '推しの卒業発表、その日から1ヶ月眠れなかった',
    '>>19 自分も経験ある。喪失感は半年は引きずる',
    'いつかは推しが結婚するだろうけど、その時は祝福で送り出したい'
  ];
  base_ts := now() - interval '5 days';
  uid := uids[1 + (601 % array_length(uids,1))];
  insert into public.bbs_threads (author_id, title, category, replies_count, created_at)
    values (uid, title, category, 0, base_ts) returning id into tid;
  for i in 1..array_length(reps,1) loop
    uid := uids[1 + ((i * 33 + 5) % array_length(uids,1))];
    insert into public.bbs_replies (thread_id, author_id, content, created_at)
      values (tid, uid, reps[i], base_ts + (i * interval '95 minutes'));
  end loop;

  ----------------------------------------------------------------
  -- 推し活 #2
  ----------------------------------------------------------------
  title := '[v3] 推しの誕生日のお祝い、みんな何してる？';
  category := '推し活';
  reps := array[
    '誕生日広告(駅貼り)出した、新宿駅で5万円コース',
    '>>1 新宿の電気広告すごい、推しがリポストしてくれて泣いた',
    'カフェコラボに行ってお祝いケーキ、毎年恒例',
    '推しの好きな数字分のお花を送る、配信で「ありがとう」聞けたら勝利',
    '>>4 配信のチャットに「お誕生日おめでとう」を一番乗りで打つ努力',
    'バースデーケーキ手作り、見立て (推しの好きな色のデコレーション)',
    '推しと同じ服を着て、推しに送ってもらいたい誕生日を擬似体験',
    '>>7 推しと同じ服チャレンジ、勇気いる',
    'ファンレターを誕生日に送る、年に1回の感謝の手紙',
    '>>9 ファンレター、誕生日カードと一緒に毎年送ってる',
    'チェキ会で「お誕生日おめでとう」って言うために並んだ',
    '推しの故郷(地元)に行って、「○○のいた場所」巡礼',
    '>>12 聖地巡礼、推しと同じ景色を見るの感動する',
    'SNSで「#〇〇生誕祭2026」タグでお祝い投稿',
    '>>14 タグでファン同士の繋がり生まれる',
    '推しのプロデュースグッズ全種コンプ',
    '誕生日プレゼント、運営に届けてもらう (個別NG)',
    '>>17 運営経由なら必ず届く、直接NGの推しに対しての気遣い',
    '推しのファミレスに合わせてお祝いケーキ予約',
    '>>19 推しの推しのファミレス、コラボメニュー食い倒れた'
  ];
  base_ts := now() - interval '15 hours';
  uid := uids[1 + (602 % array_length(uids,1))];
  insert into public.bbs_threads (author_id, title, category, replies_count, created_at)
    values (uid, title, category, 0, base_ts) returning id into tid;
  for i in 1..array_length(reps,1) loop
    uid := uids[1 + ((i * 37 + 11) % array_length(uids,1))];
    insert into public.bbs_replies (thread_id, author_id, content, created_at)
      values (tid, uid, reps[i], base_ts + (i * interval '15 minutes'));
  end loop;

  ----------------------------------------------------------------
  -- グルメ #1
  ----------------------------------------------------------------
  title := '[v3] 東京で本当に美味いラーメン屋、忖度なしで';
  category := 'グルメ';
  reps := array[
    '飯田橋 中華蕎麦とみ田 (松戸の方じゃない)。鶏白湯系の最高峰',
    '>>1 とみ田の松戸本店は鳥豚骨つけ麺、東京店とは別ジャンル',
    '銀座 篝(かがり)、鶏白湯SOBA革命起こした',
    '東京駅 八雲、家系の聖地ラーメンストリート店舗',
    '>>4 八雲、観光客で並ぶけど味は本物',
    '渋谷 大勝軒、つけ麺の元祖。山岸さんレシピ継承',
    '新宿 凪、煮干しラーメンの本気度',
    '>>7 凪、煮干し効き過ぎて翌日も口臭問題',
    '池袋 屯ちん、東京豚骨ラーメンの大箱店',
    '六本木 田中商店、深夜の家系',
    '>>10 田中商店、24時間営業の頃が最高だった',
    '神田 雲林坊、坦々麺日本一説',
    '神田 神保町 ラーメン二郎、聖地。土曜は4時間待ち',
    '>>13 二郎神保町、コール聞こえなくてヤサイマシマシだけ言ってる',
    '荻窪 春木屋、東京醤油の聖地。3000円以上のラーメン出してる',
    '>>15 春木屋、値段高いけど来客層上品で文化的',
    '東京って実は塩ラーメンの名店少ない、京都の方が強い',
    '一蘭の本店、新宿店舗、味噌も塩も評価別れる',
    '>>18 一蘭はチェーン店として優秀、味の安定性',
    '結局家系か、二郎か、王道醤油か、自分の好みで決めるしかない',
    '>>20 「東京で美味いラーメン」は答えがない問い'
  ];
  base_ts := now() - interval '7 days';
  uid := uids[1 + (701 % array_length(uids,1))];
  insert into public.bbs_threads (author_id, title, category, replies_count, created_at)
    values (uid, title, category, 0, base_ts) returning id into tid;
  for i in 1..array_length(reps,1) loop
    uid := uids[1 + ((i * 41 + 3) % array_length(uids,1))];
    insert into public.bbs_replies (thread_id, author_id, content, created_at)
      values (tid, uid, reps[i], base_ts + (i * interval '120 minutes'));
  end loop;

  ----------------------------------------------------------------
  -- グルメ #2
  ----------------------------------------------------------------
  title := '[v3] 1人で行ける焼肉、神店舗教えてください';
  category := 'グルメ';
  reps := array[
    '焼肉ライク、1人席カウンター完備。1900円で部位3種食える',
    '>>1 焼肉ライク、コスパ最強。営業時間長いのもありがたい',
    '焼肉きんぐの平日ランチ、サラダバー込みで2000円台',
    '七輪焼肉 安安、深夜営業で1人客率高い',
    '>>4 安安、肉の質がそこそこなのに価格がコスパ良すぎ',
    '叙々苑、1人で行くなら新宿東口店。カウンター席ある',
    '>>6 叙々苑1人、メンタル強くないと無理',
    '焼肉 タレ ジョージーズ、1人焼肉カウンター特化',
    '牛角の食べ放題、1人プランあるの最近知った',
    '>>9 牛角1人食べ放題、肉オーダー多めにしないと元取れない',
    'ホルモン亭ICHIBAN、新橋の1人焼肉聖地',
    '>>11 ICHIBAN、深夜1時まで営業で仕事帰り重宝',
    'スエヒロ館、サラリーマンの1人焼肉メッカ',
    '焼肉ジュー部、1人焼肉カウンター + ハイボール80円キャンペーン',
    '>>14 ハイボール80円、つい飲みすぎる',
    '神田 牛蔵、ランチタイム1人客多い',
    '個室焼肉 玄、完全個室で1人客でも気にならない',
    '>>17 玄、デート用じゃなくて1人専用と化してる人多い',
    '韓国焼肉 ホルモン市場 ノブ、1人席あり',
    '結論: 焼肉ライク 一強。値段・品質・1人客向きの3拍子',
    '>>20 焼肉ライク、海外でも展開始まったね'
  ];
  base_ts := now() - interval '2 days';
  uid := uids[1 + (702 % array_length(uids,1))];
  insert into public.bbs_threads (author_id, title, category, replies_count, created_at)
    values (uid, title, category, 0, base_ts) returning id into tid;
  for i in 1..array_length(reps,1) loop
    uid := uids[1 + ((i * 43 + 17) % array_length(uids,1))];
    insert into public.bbs_replies (thread_id, author_id, content, created_at)
      values (tid, uid, reps[i], base_ts + (i * interval '70 minutes'));
  end loop;

  ----------------------------------------------------------------
  -- コスプレ #1
  ----------------------------------------------------------------
  title := '[v3] 初心者コスプレイヤー、最初の衣装どこで買えばいい？';
  category := 'コスプレ';
  reps := array[
    'ACOS、コスパいいけどクオリティ次第。最初の1着なら全然OK',
    '>>1 ACOSは安いけどサイズ感が独特、サイズ表しっかり確認',
    'コスプレ専門「ハッカドール」、中級者向けクオリティ',
    'タオバオ直輸入、安いけど届くまで2週間 + 検品必須',
    '>>4 タオバオは博打。当たれば1万で完成度80%',
    'メルカリの中古コスプレ、傷み少ない出品多数',
    '>>6 中古、汗の臭いが致命的なケースあるから注意',
    'コスチュームショップ、コミケ会場で直販あるよ',
    '自作派、生地代だけで5000円以内収まる',
    '>>9 自作はミシン技術次第。素人ハードル高い',
    'プロ依頼、フルオーダー10万円〜',
    'ACOSのセール時期狙え、夏冬コミケ前は割引',
    '>>12 セールでも在庫切れがネック、人気衣装は予約必須',
    'ウィッグはエアリーシュガー or ジェミニ、必ずプロ用',
    '>>14 ウィッグの差で完成度8割決まる',
    'カラコン、ベルジョ(Berry Gem)推し',
    '靴、ブーツは中古ハードオフで500円から探せる',
    '>>17 ブーツの靴底貼り替えだけ業者依頼するのアリ',
    '小物(剣・盾・武器)、3Dプリンタで作るの主流',
    'メイク道具、ドンキで全部揃う。専門店でなくてもOK',
    '結論: 最初はACOS + メルカリ + ウィッグ専門店、これで2万円コース'
  ];
  base_ts := now() - interval '4 days';
  uid := uids[1 + (801 % array_length(uids,1))];
  insert into public.bbs_threads (author_id, title, category, replies_count, created_at)
    values (uid, title, category, 0, base_ts) returning id into tid;
  for i in 1..array_length(reps,1) loop
    uid := uids[1 + ((i * 45 + 7) % array_length(uids,1))];
    insert into public.bbs_replies (thread_id, author_id, content, created_at)
      values (tid, uid, reps[i], base_ts + (i * interval '85 minutes'));
  end loop;

  ----------------------------------------------------------------
  -- コスプレ #2
  ----------------------------------------------------------------
  title := '[v3] レイヤー同士の交流イベント、おすすめ教えて';
  category := 'コスプレ';
  reps := array[
    'コミケ 3日目、コスプレ広場が交流の聖地',
    '>>1 コミケC1新会場、コスプレエリア広くなったね',
    'コスプレフェス TFT(東京流通センター)、毎月開催',
    'acosta!、池袋・大阪・各地で開催。撮影会メインのイベント',
    '>>4 acosta!、撮影者と分けるシステムで安心',
    'ホココス(ホテル コスプレ)、1日借りて自由撮影',
    '>>6 ホココス、衣装着替えできるホテル特化',
    'PARTY ON !!、屋外イベント。お台場・幕張で開催',
    'アニメジャパン、レイヤー集まる場の側面も',
    '>>9 アニメジャパン、企業ブース回るついでに撮影も',
    '中野コスプレ撮影会、毎週土日',
    '>>11 中野なら徒歩で衣装シーズン中の小道具買い足し可能',
    '世界コスプレサミット、名古屋で年1。海外勢交流',
    'JCC(ジャパンコスプレチャンピオンシップ)、競技志向',
    '>>14 JCC優勝者、海外イベントの招待制チケット',
    'コスプレ婚活パーティー、最近増えてる',
    '>>16 同担婚活、思った以上に成立する',
    'X(旧Twitter)のリアル友達申請、イベント参加の方が早い',
    '>>18 X DMだけだと知らない人と会うリスク、イベントの方が安全',
    'Instagram でレイヤー検索、地元勢繋がるとリアル交流に発展',
    '結論: イベント参加 + SNSで活動 + 撮影会 が王道ルート'
  ];
  base_ts := now() - interval '20 hours';
  uid := uids[1 + (802 % array_length(uids,1))];
  insert into public.bbs_threads (author_id, title, category, replies_count, created_at)
    values (uid, title, category, 0, base_ts) returning id into tid;
  for i in 1..array_length(reps,1) loop
    uid := uids[1 + ((i * 47 + 13) % array_length(uids,1))];
    insert into public.bbs_replies (thread_id, author_id, content, created_at)
      values (tid, uid, reps[i], base_ts + (i * interval '17 minutes'));
  end loop;

  ----------------------------------------------------------------
  -- ニュース #1
  ----------------------------------------------------------------
  title := '[v3] 2026年、日本で一番ヤバいニュースなに？';
  category := 'ニュース';
  reps := array[
    'インバウンドオーバーツーリズム、京都・富士山周辺の住民負担限界',
    '>>1 富士山入山料2000円、外国人観光客の受け止め方さまざま',
    '少子化、出生率1.0前後で過去最低更新',
    '物価高、食料品が前年比10%以上の値上げ',
    '>>4 卵1パック300円、コンビニお弁当が600円越え',
    '住宅価格高騰、東京23区は新築マンション平均1億超え',
    '日銀の金融政策転換、住宅ローン金利上昇が直撃',
    '>>7 住宅ローン変動金利、1.2%超えてる人もいる',
    '能登半島地震復興、まだ仮設住宅暮らしの住民多数',
    'AI規制法案、政府が新法整備で議論中',
    '>>10 AI生成物の著作権、まだ国際的に統一されてない',
    '電気代値上げ、原発再稼働議論が再燃',
    '>>12 政府の原発再稼働方針、世論ガッツリ分かれる',
    'パワハラ・カスハラ、企業の問題対応で罰則強化議論',
    'マイナンバーカード、保険証一体化で混乱',
    '>>15 マイナ保険証、システムトラブルで医療現場大変',
    '高齢者運転、80歳以上の事故が問題化',
    'クマ被害、東北・関東で過去最多。生活圏侵入',
    '>>18 クマ問題、対策も観光客への安全周知も追いついてない',
    '能登半島地震1周年、岸田政権から現政権への課題引き継ぎ',
    '結論: 政治・経済・社会、すべての分野でターニングポイント'
  ];
  base_ts := now() - interval '3 days';
  uid := uids[1 + (901 % array_length(uids,1))];
  insert into public.bbs_threads (author_id, title, category, replies_count, created_at)
    values (uid, title, category, 0, base_ts) returning id into tid;
  for i in 1..array_length(reps,1) loop
    uid := uids[1 + ((i * 49 + 5) % array_length(uids,1))];
    insert into public.bbs_replies (thread_id, author_id, content, created_at)
      values (tid, uid, reps[i], base_ts + (i * interval '60 minutes'));
  end loop;

  ----------------------------------------------------------------
  -- ニュース #2
  ----------------------------------------------------------------
  title := '[v3] AIが仕事奪う説、自分の業界はどうなる？';
  category := 'ニュース';
  reps := array[
    'プログラマ歴15年、GitHub Copilot使ってから生産性5倍。奪われるんじゃなくて補助される',
    '>>1 同感。AI使えるプログラマが「使えないプログラマ」を駆逐する',
    'デザイナー、Midjourney/DALL-E でラフ作りが10分。クライアント満足度上がった',
    'コピーライター、ChatGPTで草案出してリライト。半分の時間で品質維持',
    '>>4 コピーライティング、クリエイティブ部分は人間しかできない',
    '翻訳業、機械翻訳の精度上がってから単価が下落。専門翻訳は健在',
    '医療画像診断、AI が放射線科の業務90%代替できる時代',
    '>>7 放射線科医、AI診断結果のダブルチェック役にシフト',
    '弁護士、契約書AI で初動分析。人間の判断はまだ必要',
    '会計士、決算データ自動化で人手不要に',
    '>>10 会計士はもう20年前から自動化進んでる',
    '営業職、商談AI で顧客マッチング。人間関係構築は人間の領域',
    '>>12 営業AIの精度、業種によってバラツキ',
    'クリエイティブ業界、ジョブが減るんじゃなく形が変わる',
    'AIにできない「対人 + 創造 + 戦略」を磨くのが正解',
    '>>15 同感。AIに使われる人と、AIを使う人の分断',
    '製造業、ロボットアームAI で熟練工不要になり始めた',
    '>>17 熟練工の経験値、AIが学習素材として吸収',
    '教師、プロンプトエンジニアリング教科が新設される動き',
    '結論: AIに取って代わられる業務はあるが、新しい仕事も同時に生まれる',
    '>>20 産業革命の時と同じパターン、本質変わらない'
  ];
  base_ts := now() - interval '1 days';
  uid := uids[1 + (902 % array_length(uids,1))];
  insert into public.bbs_threads (author_id, title, category, replies_count, created_at)
    values (uid, title, category, 0, base_ts) returning id into tid;
  for i in 1..array_length(reps,1) loop
    uid := uids[1 + ((i * 51 + 19) % array_length(uids,1))];
    insert into public.bbs_replies (thread_id, author_id, content, created_at)
      values (tid, uid, reps[i], base_ts + (i * interval '25 minutes'));
  end loop;

end $$;

-- ============================================================
-- 2. last_reply_at と replies_count を更新
-- ============================================================
update public.bbs_threads t
set
  replies_count = sub.cnt,
  last_reply_at = sub.last_at
from (
  select thread_id, count(*) as cnt, max(created_at) as last_at
  from public.bbs_replies
  group by thread_id
) sub
where t.id = sub.thread_id
  and t.title like '[v3]%';
