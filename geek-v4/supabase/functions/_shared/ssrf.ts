// ============================================================
// _shared/ssrf.ts — SSRF ガード共通ヘルパ (og-fetch / og-image 共有)
// ============================================================
// user-supplied URL をサーバ側 (Edge Function) で fetch する全経路で
// 使い回す SSRF 防御。og-fetch と og-image で重複させないため _shared に
// 切り出す (DRY)。OWASP A10 / SSRF Prevention Cheat Sheet 準拠:
//
//   - http / https スキームのみ許可 (file:/gopher:/ftp:/data: 等は拒否)
//   - URL 内 credential (user:pass@host) を拒否
//   - private / loopback / link-local / CGNAT / metadata(169.254.169.254)
//     を IPv4・IPv6 両方でブロック (IPv4-mapped IPv6 も埋め込み v4 を再判定)
//   - 可能なら Deno で対象ホストを DNS 解決し、解決後 IP も同じ分類器で検証
//     (DNS rebinding / 名前→内部IP 解決の入口を塞ぐ)
//   - リダイレクトは呼び出し側で redirect:'manual' とし、各 hop の Location を
//     再度この validateUrl + assertHostResolvesToPublic に通す
//
// ★ 注意: 「解決+分類」だけでは接続時の再解決による TOCTOU window が残る
//    (完全な fix は検証済み IP を pin して接続)。Deno fetch は IP pin を
//    直接サポートしないため、ここでは「fetch 直前に DNS を分類し、private に
//    解決されるホストを弾く」ところまでを担保する。窓は狭めるが 0 ではない。
// ============================================================

// ------------------------------------------------------------
// IPv4 ドット 10 進が private/loopback/link-local 等の禁止範囲か判定
// ------------------------------------------------------------
export function isBlockedIpv4(host: string): boolean {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const octets = [m[1], m[2], m[3], m[4]].map((o) => Number(o));
  // 各オクテットが 0-255 に収まらなければ不正な IP literal として拒否
  if (octets.some((o) => Number.isNaN(o) || o < 0 || o > 255)) return true;
  const [a, b] = octets as [number, number, number, number];
  if (a === 0) return true; // 0.0.0.0/8 (0.0.0.0 含む)
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 10) return true; // 10.0.0.0/8 private
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local (metadata 含む)
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a >= 224) return true; // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved
  return false;
}

// ------------------------------------------------------------
// IPv6 リテラル (角括弧除去済) が loopback / private / link-local 等か判定
// ------------------------------------------------------------
export function isBlockedIpv6(rawHost: string): boolean {
  // URL.hostname は IPv6 を角括弧付きで返すので外す。zone id (%eth0) も除去。
  let h = rawHost.trim().toLowerCase();
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);
  const zone = h.indexOf('%');
  if (zone !== -1) h = h.slice(0, zone);
  if (!h.includes(':')) return false; // IPv6 ではない

  if (h === '::1' || h === '::') return true; // loopback / unspecified
  // IPv4-mapped (::ffff:127.0.0.1 等) は埋め込み v4 を再判定
  const mapped = h.match(/:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped && mapped[1] && isBlockedIpv4(mapped[1])) return true;
  // IPv4-mapped が 16 進形式 (::ffff:7f00:1) の場合も拾う
  const hexMapped = h.match(/::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hexMapped && hexMapped[1] && hexMapped[2]) {
    const hi = parseInt(hexMapped[1], 16);
    const lo = parseInt(hexMapped[2], 16);
    if (!Number.isNaN(hi) && !Number.isNaN(lo)) {
      const v4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
      if (isBlockedIpv4(v4)) return true;
    }
  }

  // 先頭ハイバイトで範囲判定
  const firstGroup = h.split(':').find((g) => g.length > 0) ?? '';
  if (firstGroup) {
    const val = parseInt(firstGroup, 16);
    if (!Number.isNaN(val)) {
      const high = val >> 8; // 上位 8bit
      if ((high & 0xfe) === 0xfc) return true; // fc00::/7 unique-local
      if (high === 0xfe && (val & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
      if (high === 0xff) return true; // ff00::/8 multicast
    }
  }
  return false;
}

// ------------------------------------------------------------
// hostname が拒否対象か (localhost / *.local / bare IP リテラル)
// ------------------------------------------------------------
export function isBlockedHostname(hostname: string): boolean {
  const host = hostname.trim().toLowerCase();
  if (!host) return true;
  if (host === 'localhost') return true;
  if (host.endsWith('.localhost')) return true;
  if (host === 'local' || host.endsWith('.local')) return true; // mDNS / *.local
  if (isBlockedIpv4(host)) return true;
  if (isBlockedIpv6(host)) return true;
  return false;
}

// ------------------------------------------------------------
// URL 全体を検証。OK なら正規化済 URL 文字列、NG なら null。
// (静的検証のみ。DNS 解決は assertHostResolvesToPublic で別途行う)
// ------------------------------------------------------------
export function validateUrl(raw: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null; // パース不能
  }
  // http(s) 以外 (file:, ftp:, gopher:, data: 等) は全て拒否
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  // URL 内 credential (user:pass@host) を拒否
  if (parsed.username || parsed.password) return null;
  if (isBlockedHostname(parsed.hostname)) return null;
  return parsed.toString();
}

// ------------------------------------------------------------
// 対象ホストを DNS 解決し、解決後の IP が public か検証する。
// ------------------------------------------------------------
// DNS rebinding / 「名前は無害だが内部 IP に解決される」攻撃の入口を塞ぐ。
// - IP リテラルは validateUrl で既に分類済なので解決不要 (skip)。
// - Deno.resolveDns 権限が無い / 環境が解決できない場合は throw せず
//   "未確定" として呼び出し側に委ねる (= 静的検証は既に通っている)。
//   fail-open に倒すのは可用性のためだが、静的検証 (validateUrl) を必ず
//   先に通すことが前提。
//
// 戻り値: true=public 確認済 / false=private に解決(=拒否すべき) /
//         null=解決不能(判定不可、呼び出し側ポリシーに委ねる)
export async function assertHostResolvesToPublic(hostname: string): Promise<boolean | null> {
  const host = hostname.trim().toLowerCase();
  // 角括弧付き IPv6 リテラルを剥がす
  const bare = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;

  // 既に IP リテラルなら静的分類で完結 (DNS 不要)
  const looksIpv4 = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(bare);
  const looksIpv6 = bare.includes(':');
  if (looksIpv4) return !isBlockedIpv4(bare);
  if (looksIpv6) return !isBlockedIpv6(bare);

  // Deno.resolveDns で A / AAAA を引く。権限/環境次第で失敗しうる。
  const resolve = (Deno as unknown as {
    resolveDns?: (q: string, t: 'A' | 'AAAA') => Promise<string[]>;
  }).resolveDns;
  if (typeof resolve !== 'function') return null; // 解決機構が無い → 判定不可

  let anyResolved = false;
  for (const rec of ['A', 'AAAA'] as const) {
    let ips: string[] = [];
    try {
      ips = await resolve(host, rec);
    } catch {
      continue; // この record type は引けなかった (NXDOMAIN/権限/未対応)
    }
    for (const ip of ips) {
      anyResolved = true;
      const blocked = rec === 'A' ? isBlockedIpv4(ip) : isBlockedIpv6(ip);
      if (blocked) return false; // 1 つでも内部 IP に解決 → 即拒否
    }
  }
  // 解決はできたが全て public、または 1 件も引けなかった
  return anyResolved ? true : null;
}

// ============================================================
// og-image プロキシ署名 (og-fetch=署名 / og-image=検証 の単一ソース)
// ============================================================
// ★ ここを single source にすることで、署名側(og-fetch)と検証側(og-image)の
//   スキームが絶対にズレない。両者は同じ secret(OG_IMAGE_PROXY_SECRET)を使う。
//   検証は og-image 側が hex(HMAC-SHA256(secret, decodeURIComponent(u))) を照合する。

// HMAC-SHA256(secret, message) を hex 文字列で返す。
export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  let out = '';
  for (const b of new Uint8Array(sig)) out += b.toString(16).padStart(2, '0');
  return out;
}

// 元画像 URL → og-image プロキシの署名つき URL。
// 閲覧者を外部画像ホストへ直接アクセスさせない (IP/UA 漏洩防止) ための要。
//   形式: <supabaseUrl>/functions/v1/og-image?u=encodeURIComponent(元URL)&sig=hex(HMAC(secret,元URL))
//   - secret 未設定 / supabaseUrl 無 / 元URL が SSRF NG → null
//   - 署名後 URL が DB CHECK 上限 (2048) を超える → null
//   いずれも「raw URL を返さない」= fail-secure (画像なしにデグレード)。
const MAX_PROXIED_IMAGE_URL = 2048;
export async function signImageUrl(
  rawImageUrl: string | null,
  secret: string,
  supabaseUrl: string,
): Promise<string | null> {
  if (!rawImageUrl || !secret || !supabaseUrl) return null;
  // 元画像 URL 自体も SSRF 検証 (署名前に弾く)
  if (!validateUrl(rawImageUrl)) return null;
  try {
    const sig = await hmacSha256Hex(secret, rawImageUrl);
    const base = supabaseUrl.replace(/\/+$/, '');
    const proxied = `${base}/functions/v1/og-image?u=${encodeURIComponent(rawImageUrl)}&sig=${sig}`;
    return proxied.length > MAX_PROXIED_IMAGE_URL ? null : proxied;
  } catch {
    return null;
  }
}
