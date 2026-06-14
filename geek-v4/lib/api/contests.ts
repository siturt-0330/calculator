// =============================================================================
// lib/api/contests.ts — コンテスト機能のデータ層 (0151 + 0152 スキーマに対応)
// -----------------------------------------------------------------------------
// 設計の砦 (DB 側で構造的に担保。詳細は supabase/migrations/0151+0152):
//   - 完全匿名: 個票 (contest_predictions) は self/admin しか読めない。集計は RPC 経由のみ。
//   - コミット後リビール: get_contest_breakdown は「自分が投票済み」のときだけ分布を返す。
//   - k-匿名: N>=5 かつ各非空セル>=2 のときだけ options を返す (k_anonymity_met)。
//   - 正解は別表 contest_answers (直読み不可)。confirm_contest_result(DEFINER, 1回限り) で確定、
//     get_contest_result(result_at 経過後のみ) で公開。
//   - ★ author_id は anon/authenticated から列 SELECT を revoke 済 (0152)。
//     → contests / contest_options は **author_id を select しない**。`select('*')` も不可。
// =============================================================================

import { supabase } from '../supabase';
import { withApiTimeout } from '../withApiTimeout';

// ---- 列リスト (author_id を含めない。0152 の列 revoke と整合) ------------------
const CONTEST_COLS =
  'id, community_id, title, description, scoring, input_kind, has_submission, has_eval_phase, ' +
  'lock_at, eval_unlock_at, result_at, voided, voided_reason, titles_processed, created_at, updated_at';
const OPTION_COLS = 'id, contest_id, ordinal, label, kind, created_at, media_url, media_type';

// ---- 型 ----------------------------------------------------------------------
export type ContestScoring = 'objective' | 'subjective';
export type ContestInputKind = 'single' | 'star';
export type ContestOptionKind = 'curated' | 'submission';

// UI レベルのプリセット (5 種)。DB のスイッチ群へ presetToFlags で展開する。
//   prediction ①勝敗予想 / poll ②-bアンケート / submission ②-a公募 / review ③レビュー / hybrid ④ハイブリッド
export type ContestPreset = 'prediction' | 'poll' | 'submission' | 'review' | 'hybrid';

// フェーズ (get_contest_breakdown.phase と一致)
export type ContestPhase = 'open' | 'locked' | 'evaluating' | 'result' | 'voided';

export type Contest = {
  id: string;
  community_id: string;
  title: string;
  description: string | null;
  scoring: ContestScoring;
  input_kind: ContestInputKind;
  has_submission: boolean;
  has_eval_phase: boolean;
  lock_at: string | null; // 期限なしは null
  eval_unlock_at: string | null;
  result_at: string | null; // 期限なしは null
  voided: boolean;
  voided_reason: string | null;
  titles_processed: boolean;
  created_at: string;
  updated_at: string;
};

export type ContestOption = {
  id: string;
  contest_id: string;
  ordinal: number;
  label: string;
  kind: ContestOptionKind;
  created_at: string;
  media_url: string | null;
  media_type: 'image' | 'video' | null;
};

// 選択肢の作成入力(ラベル + 任意のメディア)。label か media のどちらかが要る。
export type ContestOptionInput = { label: string; mediaUrl?: string | null; mediaType?: 'image' | 'video' | null };

export type ContestWithOptions = Contest & { options: ContestOption[] };

// get_contest_breakdown の戻り (jsonb)。未コミット時は options=null・人数も伏せる。
export type ContestBreakdownOption = {
  option_id?: string; // single
  rating?: number; // star (1..5)
  label?: string;
  count: number;
  percent: number;
  is_mine: boolean;
};
export type ContestBreakdown = {
  now: string;
  phase: ContestPhase;
  lock_at: string | null;
  eval_unlock_at: string | null;
  result_at: string | null;
  voided: boolean;
  my_committed: boolean;
  my_option_id?: string | null;
  my_rating?: number | null;
  total_n?: number | null; // N<K_MIN_N の間は null
  k_anonymity_met?: boolean;
  options: ContestBreakdownOption[] | null; // k 未達は null
  answer_option_id?: string | null; // result_at 経過後のみ
  k_policy: { min_n: number; min_cell: number };
  error?: string;
};

export type ContestResult =
  | { revealed: false }
  | { voided: true }
  | { error: string }
  | { revealed: true; answer_option_id: string | null; confirmed_at?: string };

// ---- プリセット ⇄ スイッチ ----------------------------------------------------
type ContestFlags = {
  scoring: ContestScoring;
  input_kind: ContestInputKind;
  has_submission: boolean;
  has_eval_phase: boolean;
  needsOptions: boolean; // 作成時に運営が curated 選択肢を入力するか
};

export function presetToFlags(preset: ContestPreset): ContestFlags {
  switch (preset) {
    case 'prediction': // ① 勝敗予想: 正解あり・単一選択・運営が選択肢
      return { scoring: 'objective', input_kind: 'single', has_submission: false, has_eval_phase: false, needsOptions: true };
    case 'poll': // ②-b アンケート: 正解なし・単一選択・運営が選択肢
      return { scoring: 'subjective', input_kind: 'single', has_submission: false, has_eval_phase: false, needsOptions: true };
    case 'submission': // ②-a 公募: 正解なし・単一選択・参加者が作品提出
      return { scoring: 'subjective', input_kind: 'single', has_submission: true, has_eval_phase: false, needsOptions: false };
    case 'review': // ③ レビュー: 正解なし・★評価
      return { scoring: 'subjective', input_kind: 'star', has_submission: false, has_eval_phase: false, needsOptions: false };
    case 'hybrid': // ④ ハイブリッド: 提出 + 評価フェーズ (現状 subjective。objective 化は未確定)
      return { scoring: 'subjective', input_kind: 'single', has_submission: true, has_eval_phase: true, needsOptions: false };
  }
}

// DB の Contest からプリセットを逆引き (UI の出し分け用)
export function flagsToPreset(c: Pick<Contest, 'scoring' | 'input_kind' | 'has_submission' | 'has_eval_phase'>): ContestPreset {
  if (c.input_kind === 'star') return 'review';
  if (c.has_eval_phase) return 'hybrid';
  if (c.has_submission) return 'submission';
  if (c.scoring === 'objective') return 'prediction';
  return 'poll';
}

// ---- フェーズ導出 (client 側。サーバの breakdown.phase と一致させる) ------------
export function derivePhase(c: Pick<Contest, 'voided' | 'lock_at' | 'eval_unlock_at' | 'result_at'>, now: Date = new Date()): ContestPhase {
  if (c.voided) return 'voided';
  if (!c.lock_at) return 'open'; // 締切なし = ずっと open
  const t = now.getTime();
  if (t < new Date(c.lock_at).getTime()) return 'open';
  if (!c.result_at) return 'locked'; // lock 後・結果発表なし
  const evalAt = c.eval_unlock_at ? new Date(c.eval_unlock_at).getTime() : new Date(c.lock_at).getTime();
  if (t < evalAt) return 'locked';
  if (t < new Date(c.result_at).getTime()) return 'evaluating';
  return 'result';
}

// 投票がまだ可能か (cp_insert の締切窓と一致: submission は lock 後〜result / それ以外は lock_at まで。NULL=無期限)
export function isVotingOpen(c: Pick<Contest, 'voided' | 'lock_at' | 'result_at' | 'has_submission'>, now: Date = new Date()): boolean {
  if (c.voided) return false;
  const t = now.getTime();
  if (c.has_submission) {
    if (c.lock_at && t < new Date(c.lock_at).getTime()) return false; // 受付フェーズ(まだ投票不可)
    return !c.result_at || t < new Date(c.result_at).getTime();
  }
  return !c.lock_at || t < new Date(c.lock_at).getTime(); // 締切なし = 開いている
}

// =============================================================================
// 読み取り
// =============================================================================
export async function getContest(id: string): Promise<ContestWithOptions | null> {
  const [cRes, oRes] = await Promise.all([
    withApiTimeout(supabase.from('contests').select(CONTEST_COLS).eq('id', id).maybeSingle(), 'contests.getContest', 8000),
    withApiTimeout(
      supabase.from('contest_options').select(OPTION_COLS).eq('contest_id', id).order('ordinal', { ascending: true }),
      'contests.getContest.options',
      8000,
    ),
  ]);
  if (cRes.error || !cRes.data) return null;
  const options = (oRes.data ?? []) as unknown as ContestOption[];
  return { ...(cRes.data as unknown as Contest), options };
}

// コミュニティ内のコンテスト一覧 (新しい締切順)
export async function listContestsByCommunity(communityId: string, limit = 30): Promise<Contest[]> {
  const { data, error } = await withApiTimeout(
    supabase
      .from('contests')
      .select(CONTEST_COLS)
      .eq('community_id', communityId)
      .order('result_at', { ascending: false })
      .limit(limit),
    'contests.listByCommunity',
    8000,
  );
  if (error || !data) return [];
  return data as unknown as Contest[];
}

// ホーム「コンテスト」スコープ用: 自分が見えるコンテスト (RLS が可視性を担保)。
// 進行中 (未 void) を締切が近い順で。
export async function listOpenContests(limit = 30): Promise<Contest[]> {
  const { data, error } = await withApiTimeout(
    supabase
      .from('contests')
      .select(CONTEST_COLS)
      .eq('voided', false)
      .order('lock_at', { ascending: true })
      .limit(limit),
    'contests.listOpen',
    8000,
  );
  if (error || !data) return [];
  return data as unknown as Contest[];
}

// 開催中(未void かつ result_at が null or 未到達)のコンテストを持つ community_id 集合。
// コミュアバターの「コンテスト開催中」リング判定に使う(RLS が可視性を担保)。
export async function fetchActiveContestCommunityIds(): Promise<string[]> {
  const nowIso = new Date().toISOString();
  const { data, error } = await withApiTimeout(
    supabase.from('contests').select('community_id').eq('voided', false).or(`result_at.is.null,result_at.gt.${nowIso}`),
    'contests.activeCommunityIds',
    8000,
  );
  if (error || !data) return [];
  const ids = new Set<string>();
  for (const r of data as Array<{ community_id: string }>) ids.add(r.community_id);
  return [...ids];
}

// =============================================================================
// 集計 / 正解 (RPC)
// =============================================================================
export async function getBreakdown(contestId: string): Promise<ContestBreakdown | null> {
  const { data, error } = await withApiTimeout(
    supabase.rpc('get_contest_breakdown', { p_contest_id: contestId }),
    'contests.breakdown',
    8000,
  );
  if (error || !data) return null;
  return data as ContestBreakdown;
}

export async function getResult(contestId: string): Promise<ContestResult | null> {
  const { data, error } = await withApiTimeout(
    supabase.rpc('get_contest_result', { p_contest_id: contestId }),
    'contests.result',
    8000,
  );
  if (error || !data) return null;
  return data as ContestResult;
}

// =============================================================================
// 書き込み
// =============================================================================
export type CreateContestInput = {
  communityId: string;
  title: string;
  description?: string;
  preset: ContestPreset;
  options?: ContestOptionInput[]; // prediction / poll の curated 選択肢(ラベル + 任意メディア)
  lockAt?: string | null; // ISO・期限なしは null
  evalUnlockAt?: string | null; // ISO (hybrid のみ)
  resultAt?: string | null; // ISO・期限なしは null
};

// コンテストを作成し (必要なら) curated 選択肢を挿入。作成された contest を返す。
export async function createContest(input: CreateContestInput): Promise<Contest> {
  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user.id;
  if (!userId) throw new Error('Not authenticated');

  const flags = presetToFlags(input.preset);
  const { data: created, error } = await supabase
    .from('contests')
    .insert({
      community_id: input.communityId,
      author_id: userId, // INSERT は author_id を書ける (列 revoke は SELECT のみ)
      title: input.title.trim(),
      description: input.description?.trim() || null,
      scoring: flags.scoring,
      input_kind: flags.input_kind,
      has_submission: flags.has_submission,
      has_eval_phase: flags.has_eval_phase,
      lock_at: input.lockAt ?? null,
      eval_unlock_at: flags.has_eval_phase ? (input.evalUnlockAt ?? null) : null,
      result_at: input.resultAt ?? null,
    })
    .select(CONTEST_COLS)
    .single();
  if (error || !created) throw error ?? new Error('コンテストの作成に失敗しました');

  // curated 選択肢 (prediction / poll)。submission / review は作成時に入れない。
  if (flags.needsOptions && input.options && input.options.length > 0) {
    const cid = (created as unknown as Contest).id;
    const rows = input.options
      .map((o, i) => ({
        contest_id: cid, ordinal: i, label: (o.label ?? '').trim(), kind: 'curated' as const, author_id: userId,
        media_url: o.mediaUrl ?? null, media_type: o.mediaType ?? null,
      }))
      .filter((r) => r.label.length > 0 || r.media_url); // ラベル or メディアがあれば採用
    if (rows.length > 0) {
      const { error: optErr } = await supabase.from('contest_options').insert(rows);
      if (optErr) throw optErr;
    }
  }
  return created as unknown as Contest;
}

// 公募 (submission) に自分の作品 (= 選択肢) を提出する。作品はタイトル + 画像/動画。
export async function submitEntry(contestId: string, input: { label?: string; mediaUrl?: string | null; mediaType?: 'image' | 'video' | null }): Promise<ContestOption> {
  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user.id;
  if (!userId) throw new Error('Not authenticated');

  const label = (input.label ?? '').trim();
  if (label.length === 0 && !input.mediaUrl) throw new Error('作品名か画像/動画を入れてください');

  // ordinal は末尾。既存数を数えて採番 (curated 上限 20 は submission には非適用)。
  const { data: existing } = await supabase.from('contest_options').select('ordinal').eq('contest_id', contestId);
  const nextOrdinal = ((existing ?? []) as Array<{ ordinal: number }>).reduce((m, r) => Math.max(m, r.ordinal + 1), 0);

  const { data, error } = await supabase
    .from('contest_options')
    .insert({
      contest_id: contestId, ordinal: nextOrdinal, label, kind: 'submission', author_id: userId,
      media_url: input.mediaUrl ?? null, media_type: input.mediaType ?? null,
    })
    .select(OPTION_COLS)
    .single();
  if (error || !data) throw error ?? new Error('作品の提出に失敗しました');
  return data as unknown as ContestOption;
}

// 投票 (予想ロック=不可逆。UNIQUE(contest_id,user_id) で 1 人 1 票)
export type CastVoteInput = { contestId: string; optionId?: string; rating?: number; comment?: string };
export async function castVote(input: CastVoteInput): Promise<void> {
  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user.id;
  if (!userId) throw new Error('Not authenticated');
  const { error } = await supabase.from('contest_predictions').insert({
    contest_id: input.contestId,
    user_id: userId,
    option_id: input.optionId ?? null,
    rating: input.rating ?? null,
    comment: input.comment?.trim() || null,
  });
  if (error) throw error;
}

// 正解確定 (作成者のみ・1 回限り・以後不変)。true=今回確定 / false=既に確定済み。
export async function confirmResult(contestId: string, optionId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('confirm_contest_result', {
    p_contest_id: contestId,
    p_option_id: optionId,
  });
  if (error) throw error;
  return data === true;
}

// =============================================================================
// ② コンテストコミュニティ (入場ゲート型・0153)
// =============================================================================
export type CreateContestCommunityInput = {
  communityName: string;
  iconEmoji?: string;
  communityDescription?: string;
  title: string;
  description?: string;
  preset: ContestPreset;
  options?: ContestOptionInput[];
  lockAt?: string | null;
  evalUnlockAt?: string | null;
  resultAt?: string | null;
};

// 専用コミュ + コンテスト + link を 1 RPC で原子的に作る。作成者は trigger で owner 自動 join。
export async function createContestCommunity(input: CreateContestCommunityInput): Promise<{ communityId: string; contestId: string }> {
  const flags = presetToFlags(input.preset);
  const { data, error } = await supabase.rpc('create_contest_community', {
    p_community_name: input.communityName.trim(),
    p_icon_emoji: input.iconEmoji ?? '🏆',
    p_community_desc: input.communityDescription?.trim() ?? '',
    p_title: input.title.trim(),
    p_description: input.description?.trim() ?? '',
    p_scoring: flags.scoring,
    p_input_kind: flags.input_kind,
    p_has_submission: flags.has_submission,
    p_has_eval_phase: flags.has_eval_phase,
    p_lock_at: input.lockAt ?? null,
    p_eval_unlock_at: flags.has_eval_phase ? (input.evalUnlockAt ?? null) : null,
    p_result_at: input.resultAt ?? null,
    p_options: flags.needsOptions
      ? (input.options ?? [])
          .filter((o) => (o.label ?? '').trim().length > 0 || o.mediaUrl)
          .map((o) => ({ label: (o.label ?? '').trim(), media_url: o.mediaUrl ?? null, media_type: o.mediaType ?? null }))
      : null,
  });
  if (error || !data) throw error ?? new Error('コンテストコミュニティの作成に失敗しました');
  const r = data as { community_id: string; contest_id: string };
  return { communityId: r.community_id, contestId: r.contest_id };
}

// コンテスト詳細の「参加する」出し分け状態
export type ContestJoinState = { is_entry: boolean; community_id?: string; answered?: boolean; is_member?: boolean };
export async function getContestJoinState(contestId: string): Promise<ContestJoinState> {
  const { data, error } = await supabase.rpc('get_contest_join_state', { p_contest_id: contestId });
  if (error || !data) return { is_entry: false };
  return data as ContestJoinState;
}

// 自分がこのコンテストの作成者か (author_id は client から読めないので DEFINER RPC で判定)
export async function isContestAuthor(contestId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('is_contest_author', { p_contest_id: contestId });
  if (error) return false;
  return data === true;
}

// 通報 (self・1 回。閾値で自動 void)
export async function reportContest(contestId: string, reason?: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('report_contest', {
    p_contest_id: contestId,
    p_reason: reason ?? null,
  });
  if (error) throw error;
  return data === true;
}
