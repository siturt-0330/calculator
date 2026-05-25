// ============================================================
// lib/geocode.ts
// ------------------------------------------------------------
// 住所 / 施設名 → 緯度経度 (geocode) と、その逆 (reverseGeocode) を
// Platform 別バックエンドで統一インターフェース提供する純関数群。
//
// 設計判断:
//   - Native (iOS/Android): expo-location.geocodeAsync を使う
//       → OS 内蔵の地理 API。無料、安定、追加権限不要 (位置情報権限は
//         現在地取得時のみ必要、geocode 自体は権限不要)
//   - Web: Nominatim (OpenStreetMap, https://nominatim.openstreetmap.org)
//       → 無料、API キー不要。ただし以下の規約を守る:
//         a) リクエスト rate ≤ 1 req/sec
//            → caller 側で debounce 350ms 以上を強制
//         b) HTTP header `User-Agent` に何のアプリかを示す
//            → 「Geek/4.0 (web; +https://geekboard.netlify.app)」
//         c) 大量 cron / scraping 禁止 (ユーザー入力ベースのみ)
//
// 戻り値の正規化:
//   GeocodeResult = { displayName, address, lat, lon }
//   両プラットフォームで同じ shape を返すよう adapt する。
//
// 失敗 / タイムアウト:
//   - network 失敗 → 空配列を返す (例外を caller に伝播させない)
//   - タイムアウト 8s
//   - 不正クエリ (空文字 / 2 文字未満) は早期 return []
// ============================================================

import { Platform } from 'react-native';

export type GeocodeResult = {
  /** "東京ドーム" 等の表示名 (UI で「○○ を選択」と出す) */
  displayName: string;
  /** "東京都文京区後楽1丁目3-61" 等のフル住所 (副表示) */
  address: string;
  lat: number;
  lon: number;
};

const TIMEOUT_MS = 8_000;
const MAX_RESULTS = 3;

// Nominatim 用 User-Agent (規約上必須)。
// 個別 build で値を差し替えたい場合は EXPO_PUBLIC_USER_AGENT を環境変数に。
const NOMINATIM_UA = 'Geek/4.0 (web; +https://geekboard.netlify.app)';
const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org';

function timeoutPromise<T>(ms: number, label: string): Promise<T> {
  return new Promise<T>((_, reject) => {
    setTimeout(() => reject(new Error(`[geocode] ${label} timeout after ${ms}ms`)), ms);
  });
}

// ============================================================
// Web: Nominatim 経由
// ============================================================
type NominatimRow = {
  display_name: string;
  lat: string;
  lon: string;
  name?: string;
  address?: { [k: string]: string };
};

async function geocodeWeb(query: string): Promise<GeocodeResult[]> {
  const url =
    `${NOMINATIM_BASE}/search?format=json&addressdetails=1&limit=${MAX_RESULTS}` +
    `&accept-language=ja&q=${encodeURIComponent(query)}`;
  try {
    const res = await Promise.race([
      fetch(url, { headers: { 'User-Agent': NOMINATIM_UA, Accept: 'application/json' } }),
      timeoutPromise<Response>(TIMEOUT_MS, 'geocode-web'),
    ]);
    if (!res.ok) return [];
    const rows = (await res.json()) as NominatimRow[];
    return rows.slice(0, MAX_RESULTS).map((r) => ({
      displayName: r.name ?? r.display_name.split(',')[0] ?? r.display_name,
      address: r.display_name,
      lat: Number(r.lat),
      lon: Number(r.lon),
    }));
  } catch {
    return [];
  }
}

async function reverseGeocodeWeb(lat: number, lon: number): Promise<GeocodeResult | null> {
  const url =
    `${NOMINATIM_BASE}/reverse?format=json&addressdetails=1` +
    `&lat=${lat}&lon=${lon}&accept-language=ja`;
  try {
    const res = await Promise.race([
      fetch(url, { headers: { 'User-Agent': NOMINATIM_UA, Accept: 'application/json' } }),
      timeoutPromise<Response>(TIMEOUT_MS, 'reverse-geocode-web'),
    ]);
    if (!res.ok) return null;
    const r = (await res.json()) as NominatimRow;
    if (!r?.display_name) return null;
    return {
      displayName: r.name ?? r.display_name.split(',')[0] ?? r.display_name,
      address: r.display_name,
      lat,
      lon,
    };
  } catch {
    return null;
  }
}

// ============================================================
// Native: expo-location.geocodeAsync (端末 OS 内蔵 geocoder)
// ============================================================
type ExpoLocationModule = {
  geocodeAsync: (q: string) => Promise<Array<{ latitude: number; longitude: number }>>;
  reverseGeocodeAsync: (c: { latitude: number; longitude: number }) => Promise<ExpoAddressRow[]>;
};

// expo-location.reverseGeocodeAsync の戻り行 (型定義は下の関数で再宣言される件の前置き)
type ExpoAddressRow = {
  city?: string | null;
  district?: string | null;
  name?: string | null;
  postalCode?: string | null;
  region?: string | null;
  street?: string | null;
  country?: string | null;
};

function loadExpoLocation(): ExpoLocationModule {
  // require は Web では呼ばれない (Platform.OS 判定で gated)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('expo-location') as ExpoLocationModule;
}

async function geocodeNative(query: string): Promise<GeocodeResult[]> {
  try {
    const Location = loadExpoLocation();
    const rows = await Promise.race([
      Location.geocodeAsync(query),
      timeoutPromise<Array<{ latitude: number; longitude: number }>>(TIMEOUT_MS, 'geocode-native'),
    ]);
    // OS 内蔵 geocoder は逆引きの address text を直接返さないので reverse して
    // 各候補に住所文字列を付ける。
    const out: GeocodeResult[] = [];
    for (const row of rows.slice(0, MAX_RESULTS)) {
      try {
        const addr = await Location.reverseGeocodeAsync({
          latitude: row.latitude,
          longitude: row.longitude,
        });
        const first = addr[0];
        const display = first?.name ?? query;
        const address = first
          ? [first.country, first.region, first.city, first.district, first.street, first.name]
              .filter((s) => !!s)
              .join(' ')
          : '';
        out.push({ displayName: display, address, lat: row.latitude, lon: row.longitude });
      } catch {
        out.push({ displayName: query, address: '', lat: row.latitude, lon: row.longitude });
      }
    }
    return out;
  } catch {
    return [];
  }
}

async function reverseGeocodeNative(lat: number, lon: number): Promise<GeocodeResult | null> {
  try {
    const Location = loadExpoLocation();
    const rows = await Promise.race([
      Location.reverseGeocodeAsync({ latitude: lat, longitude: lon }),
      timeoutPromise<ExpoAddressRow[]>(TIMEOUT_MS, 'reverse-native'),
    ]);
    const first = rows[0];
    if (!first) return null;
    const displayName = first.name ?? 'マップで指定した場所';
    const address = [first.country, first.region, first.city, first.district, first.street, first.name]
      .filter((s) => !!s)
      .join(' ');
    return { displayName, address, lat, lon };
  } catch {
    return null;
  }
}

// ============================================================
// 共通 API — Platform を吸収して同じ shape を返す
// ============================================================

/**
 * 住所 / 施設名 を最大 3 件の候補に変換。失敗時は空配列。
 * caller は 350ms 以上 debounce すること (Nominatim 規約)。
 */
export async function geocode(query: string): Promise<GeocodeResult[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  return Platform.OS === 'web' ? geocodeWeb(q) : geocodeNative(q);
}

/**
 * 緯度経度 → 住所 (マップタップで pin を立てた時の自動 fill 用)。
 * 失敗時は null。
 */
export async function reverseGeocode(lat: number, lon: number): Promise<GeocodeResult | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return Platform.OS === 'web' ? reverseGeocodeWeb(lat, lon) : reverseGeocodeNative(lat, lon);
}
