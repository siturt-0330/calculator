// ============================================================
// lib/api/acquisition.ts — ユーザー流入元(traffic source)の取得・記録
// ------------------------------------------------------------
// 広告の流入元別配信(fetchTargetedAdsV2)のために、サインアップ時に
// 「どこから来たユーザーか」を user_acquisition(migration 0119)へ記録する。
//
// フロー(Web):
//   1. ランディング/サインアップ時に captureAcquisitionFromUrl() で URL クエリ
//      (?traffic_source / ?utm_*) を sessionStorage に退避。
//   2. サインアップ成功後に recordAcquisition() で user_acquisition へ insert
//      (本人のみ insert 可。既存があれば skip = 流入元は不変)。
//
// プライバシー: user_acquisition は本人+admin限定RLS(0119)。一般公開しない。
// Native(deep link / install referrer)対応は将来TODO。
// ============================================================
import { supabase } from '../supabase';
import { swallow } from '../swallow';

const ACQ_KEY = 'geek.acq';
// user_acquisition.traffic_source の check 制約と一致させる
const VALID_SOURCES = ['google_ads', 'app_store', 'play_store', 'organic', 'referral', 'other'];

type AcquisitionData = {
  traffic_source?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
};

/**
 * Web の URL クエリ (?traffic_source / ?utm_source / ?utm_medium / ?utm_campaign) を
 * 読み取り sessionStorage に退避する。サインアップ前(ランディング/フォーム表示時)に呼ぶ。
 * Native / SSR では no-op。
 */
export function captureAcquisitionFromUrl(): void {
  if (typeof window === 'undefined' || !window.location) return;
  try {
    const params = new URLSearchParams(window.location.search);
    const data: AcquisitionData = {};
    const ts = params.get('traffic_source');
    if (ts && VALID_SOURCES.includes(ts)) data.traffic_source = ts;
    const us = params.get('utm_source');
    if (us) data.utm_source = us.slice(0, 80);
    const um = params.get('utm_medium');
    if (um) data.utm_medium = um.slice(0, 80);
    const uc = params.get('utm_campaign');
    if (uc) data.utm_campaign = uc.slice(0, 80);
    if (Object.keys(data).length > 0) {
      window.sessionStorage.setItem(ACQ_KEY, JSON.stringify(data));
    }
  } catch (e) {
    swallow('acquisition.capture', e);
  }
}

/**
 * sessionStorage に退避した流入元を user_acquisition へ記録する。
 * サインアップ成功直後に fire-and-forget で呼ぶ。
 * - 本人(auth.uid())のみ insert 可 (RLS)。
 * - 既存レコードがあれば skip (流入元は記録時固定)。
 * - 0119 未適用や RLS 等で失敗しても握りつぶす (サインアップ体験を止めない)。
 */
export async function recordAcquisition(): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    const raw = window.sessionStorage.getItem(ACQ_KEY);
    if (!raw) return;
    const data = JSON.parse(raw) as AcquisitionData;
    const uid = (await supabase.auth.getUser()).data.user?.id;
    if (!uid) return;

    // 既存があれば二重記録しない (流入元は不変)
    const { data: existing } = await supabase
      .from('user_acquisition')
      .select('user_id')
      .eq('user_id', uid)
      .maybeSingle();
    if (existing) {
      window.sessionStorage.removeItem(ACQ_KEY);
      return;
    }

    await supabase.from('user_acquisition').insert({
      user_id: uid,
      traffic_source: data.traffic_source ?? null,
      utm_source: data.utm_source ?? null,
      utm_medium: data.utm_medium ?? null,
      utm_campaign: data.utm_campaign ?? null,
    });
    window.sessionStorage.removeItem(ACQ_KEY);
  } catch (e) {
    swallow('acquisition.record', e);
  }
}
