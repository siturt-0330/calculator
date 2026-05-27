// ============================================================
// lib/api/accountState.ts
// ============================================================
// アカウント制限の透明性 UI 用 API (Reddit ガイド #11).
//
// profiles.account_state を fetch し、UI 表示に必要な
//   - 現在の state
//   - 受けている制限の一覧
//   - 復帰方法のヒント
// を 1 つのオブジェクトに整形して返す。
//
// 注意点:
//   - account_state が null / 未定義 / 想定外の値の場合は 'healthy' として扱う (defensive)
//   - 既存の AccountState 型 (types/models.ts) を再 export し、import 元を統一する
// ============================================================
import { supabase } from '../supabase';
import { withApiTimeout } from '../withApiTimeout';
import type { AccountState } from '../../types/models';

export type { AccountState };

export interface AccountStateInfo {
  /** 現在のアカウント状態 (未定義 / null は 'healthy' に正規化) */
  state: AccountState;
  /** 現状受けている機能制限の人間可読リスト ('healthy' のときは空配列) */
  restrictions: string[];
  /** 復帰方法のヒント ('healthy' のときは空文字) */
  resolutionHint: string;
}

const STATE_VALUES: ReadonlyArray<AccountState> = [
  'healthy',
  'caution',
  'restricted',
  'warned',
  'suspended',
];

function normalizeState(raw: unknown): AccountState {
  if (typeof raw === 'string' && (STATE_VALUES as ReadonlyArray<string>).includes(raw)) {
    return raw as AccountState;
  }
  return 'healthy';
}

// 状態ごとの「制限内容」「復帰条件」定義
//   - restrictions: ユーザーが見て分かる文面 (短文 + 動詞句)
//   - resolutionHint: 復帰条件を 1〜2 文で
// 文言は将来 i18n / admin カスタムに置換できるよう関数で隔離している。
function describeState(state: AccountState): { restrictions: string[]; resolutionHint: string } {
  switch (state) {
    case 'healthy':
      return { restrictions: [], resolutionHint: '' };
    case 'caution':
      return {
        restrictions: [
          'まだ全機能が使えますが、注意状態にあります',
          '同じパターンの違反が続くと制限へ移行します',
        ],
        resolutionHint:
          '今後 14 日間ルール違反となる通報が増えなければ、自動で「通常」状態に戻ります。',
      };
    case 'restricted':
      return {
        restrictions: [
          '新規投稿が 1 日あたり 3 件までに制限されています',
          'コメント・返信が一時的に制限されています',
          'タグ作成と公式コミュニティへの投稿は不可です',
        ],
        resolutionHint:
          '今後 30 日間ルール違反となる通報がなければ、自動で「注意」状態へ緩和されます。',
      };
    case 'warned':
      return {
        restrictions: [
          'すべての投稿・コメント・返信が一時停止されています',
          'リアクション・保存・ブックマークも不可です',
          'プロフィール編集のみ可能',
        ],
        resolutionHint:
          'この状態は停止予告です。30 日以内に追加の違反があるとアカウント停止に移行します。異議申し立てが可能です。',
      };
    case 'suspended':
      return {
        restrictions: [
          'アカウントは停止されており、すべての機能が使えません',
          'ログインはできますが、書き込み・閲覧の一部に制限があります',
        ],
        resolutionHint:
          '異議申し立てフォームから停止理由の確認と再審査を依頼できます。',
      };
    default:
      return { restrictions: [], resolutionHint: '' };
  }
}

/**
 * ログイン中ユーザーの account_state を取得し、UI 表示用に整形する。
 *
 * - 未ログイン: 'healthy' を返す (画面側で null render させる前提)
 * - 取得失敗 / RLS 弾き: 'healthy' を返す (フィードを止めない fail-open)
 *   ※ admin 側の操作で本人が hard-locked になるケースは別経路 (authStore.checkAccountState)
 *      が責任を持つので、ここは「表示用の透明性 UI が壊れない」ことを優先する。
 */
export async function fetchMyAccountState(): Promise<AccountStateInfo> {
  let raw: unknown = null;
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { state: 'healthy', restrictions: [], resolutionHint: '' };
    }
    const { data, error } = await withApiTimeout(
      supabase
        .from('profiles')
        .select('account_state')
        .eq('id', user.id)
        .maybeSingle(),
      'accountState.fetchMine',
      6000,
    );
    if (error) {
      // 取得失敗時は healthy fallback。UI に「不明」を出すよりはるかに親切。
      console.warn('[accountState] fetch failed:', error.message);
      return { state: 'healthy', restrictions: [], resolutionHint: '' };
    }
    raw = (data as { account_state?: unknown } | null)?.account_state ?? null;
  } catch (e) {
    console.warn('[accountState] threw:', e instanceof Error ? e.message : e);
    return { state: 'healthy', restrictions: [], resolutionHint: '' };
  }
  const state = normalizeState(raw);
  const { restrictions, resolutionHint } = describeState(state);
  return { state, restrictions, resolutionHint };
}

// state -> 短い表示用 label (Card title 等で利用)
export function accountStateLabel(state: AccountState): string {
  switch (state) {
    case 'caution':    return '警告中';
    case 'restricted': return '制限中';
    case 'warned':     return '停止予告';
    case 'suspended':  return '停止中';
    case 'healthy':
    default:           return '通常';
  }
}

// state -> 1 文の short description (Card description 用)
export function accountStateShortDescription(state: AccountState): string {
  switch (state) {
    case 'caution':
      return '注意状態です。違反が続くと制限に移行します。';
    case 'restricted':
      return '投稿・コメントなど一部の機能が制限されています。';
    case 'warned':
      return 'アカウント停止予告が発行されています。詳細をご確認ください。';
    case 'suspended':
      return 'アカウントが停止されています。';
    case 'healthy':
    default:
      return '';
  }
}
