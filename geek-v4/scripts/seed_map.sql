-- 位置情報カラム + 観光地テーブル
alter table public.events add column if not exists lat double precision;
alter table public.events add column if not exists lng double precision;

create table if not exists public.tourism_spots (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  lat double precision not null,
  lng double precision not null,
  address text,
  tag_name text,
  category text not null default 'general',
  rating real default 4.0,
  created_at timestamptz default now()
);

alter table public.tourism_spots enable row level security;
drop policy if exists "ts_read" on public.tourism_spots;
create policy "ts_read" on public.tourism_spots for select using (true);

-- 既存イベントに緯度経度を付与（東京近郊中心）
update public.events set lat = 35.6298, lng = 139.7967 where location = '東京ビッグサイト';
update public.events set lat = 35.6486, lng = 140.0359 where location = '幕張メッセ';
update public.events set lat = 35.4660, lng = 139.6228 where location = '横浜アリーナ';
update public.events set lat = 35.6580, lng = 139.7016 where location = '渋谷';
update public.events set lat = 35.1709, lng = 136.8815 where location = '名古屋';
update public.events set lat = 35.7100, lng = 139.8107 where location = '東京ドーム';
update public.events set lat = 35.6909, lng = 139.7003 where location = '東京' and lat is null;
update public.events set lat = 35.6700, lng = 139.6500 where location = 'オンライン';
update public.events set lat = 35.6586, lng = 139.7454 where location = '全国';
update public.events set lat = 35.6258, lng = 139.7806 where location = '東京流通センター';

-- 観光地（聖地巡礼スポット）データ投入
insert into public.tourism_spots (name, description, lat, lng, address, tag_name, category, rating)
values
  -- 東京・関東
  ('秋葉原電気街', 'アニメ・ゲーム・アイドルの聖地', 35.6985, 139.7728, '東京都千代田区外神田', 'アニメ', '聖地', 4.7),
  ('中野ブロードウェイ', 'マニアックなサブカルの楽園', 35.7079, 139.6657, '東京都中野区中野', '漫画', '聖地', 4.5),
  ('池袋サンシャインシティ', 'アニメイト本店、ナンジャタウン', 35.7295, 139.7193, '東京都豊島区東池袋', 'アニメ', '聖地', 4.4),
  ('東京キャラクターストリート', '主要キャラクターショップ集結', 35.6814, 139.7660, '東京都千代田区丸の内', 'アニメ', '聖地', 4.3),
  ('神田明神', 'ラブライブ聖地として有名', 35.7019, 139.7677, '東京都千代田区外神田', 'アニメ', '聖地', 4.6),
  ('原宿', 'コスプレ・ファッションの発信地', 35.6702, 139.7027, '東京都渋谷区神宮前', 'コスプレ', '聖地', 4.2),
  ('東京タワー', '東京観光の定番ランドマーク', 35.6586, 139.7454, '東京都港区芝公園', null, '観光', 4.5),
  ('スカイツリー', '世界一の電波塔', 35.7101, 139.8107, '東京都墨田区押上', null, '観光', 4.4),
  ('明治神宮', '都心の森・初詣の名所', 35.6764, 139.6993, '東京都渋谷区代々木神園町', null, '観光', 4.6),
  ('鎌倉高校前駅', 'スラムダンク聖地', 35.3068, 139.5012, '神奈川県鎌倉市腰越', '漫画', '聖地', 4.7),
  ('箱根', '温泉・自然の名所', 35.2324, 139.0567, '神奈川県箱根町', null, '観光', 4.5),
  ('江ノ島', 'デート・観光の定番', 35.2998, 139.4801, '神奈川県藤沢市江の島', null, '観光', 4.4),

  -- 名古屋
  ('大須商店街', '名古屋のサブカル聖地', 35.1597, 136.9011, '愛知県名古屋市中区大須', 'アニメ', '聖地', 4.3),
  ('熱田神宮', '三種の神器・観光名所', 35.1273, 136.9085, '愛知県名古屋市熱田区神宮', null, '観光', 4.5),

  -- 京都・大阪
  ('伏見稲荷大社', '千本鳥居・観光名所', 34.9671, 135.7727, '京都府京都市伏見区深草', null, '観光', 4.7),
  ('清水寺', '京都の象徴的寺院', 34.9949, 135.7851, '京都府京都市東山区清水', null, '観光', 4.6),
  ('日本橋でんでんタウン', '大阪のアニメ電気街', 34.6612, 135.5024, '大阪府大阪市浪速区日本橋', 'アニメ', '聖地', 4.4),
  ('USJ', 'コラボイベント多数', 34.6655, 135.4323, '大阪府大阪市此花区桜島', null, '観光', 4.6),

  -- 北海道
  ('小樽運河', '映画ロケ地としても有名', 43.1980, 140.9942, '北海道小樽市港町', null, '観光', 4.5),
  ('札幌時計台', '札幌のシンボル', 43.0628, 141.3528, '北海道札幌市中央区北1条西', null, '観光', 4.0),

  -- 福岡
  ('博多座', 'コスプレ・舞台イベント開催地', 33.5947, 130.4115, '福岡県福岡市博多区下川端町', '声優', '聖地', 4.3),

  -- 沖縄
  ('美ら海水族館', '人気観光地', 26.6943, 127.8780, '沖縄県国頭郡本部町石川', null, '観光', 4.7),

  -- 千葉
  ('成田山新勝寺', '初詣・成田空港近く', 35.7857, 140.3186, '千葉県成田市成田', null, '観光', 4.4),
  ('東京ディズニーリゾート', 'コラボ多数', 35.6329, 139.8804, '千葉県浦安市舞浜', null, '観光', 4.7);
