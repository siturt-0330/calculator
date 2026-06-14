// =============================================================================
// app/contest/[id].tsx — コンテスト詳細 / 投票・集計・結果 (0151+0152 スキーマ)
// -----------------------------------------------------------------------------
// 確定デザイン: 黒地 / グラデ kicker / 白極太タイトル / 左レール選択 (背景は塗らない) /
// ピンクのチェック / クリーン CTA / コミット後リビールのバー集計。
// フェーズ: open(受付) → locked/evaluating(集計) → result(発表) / voided(中止)。
// 砦は DB 側 (get_contest_breakdown はコミット後のみ分布を返す / 正解は result_at 後のみ)。
// ※ lock→reveal の二重リング演出は次の polish pass。まずは機能版。
// =============================================================================

import { View, Text, ScrollView, TextInput, ActivityIndicator } from 'react-native';
import { useState, useMemo } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { ChevronLeft, Flag, Check, Star, Lock, Trophy, Users, ImagePlus } from 'lucide-react-native';

import { useTheme } from '../../hooks/useColors';
import type { ColorPalette } from '../../lib/theme/palettes';
import { R, SP, SIZE } from '../../design/tokens';
import { T, geekGradientFill, type GradientTextStyle } from '../../design/typography';
import { PressableScale } from '../../components/ui/PressableScale';
import { ContestOptionMedia } from '../../components/contest/ContestOptionMedia';
import { pickAndUploadContestMedia } from '../../lib/contestMedia';
import { useToastStore } from '../../stores/toastStore';
import {
  useContest, useContestBreakdown, useContestResult, useIsContestAuthor,
  useCastVote, useSubmitEntry, useConfirmResult, useReportContest,
  useContestJoinState, useJoinContestCommunity,
} from '../../hooks/useContests';
import {
  derivePhase, isVotingOpen, flagsToPreset,
  type ContestWithOptions, type ContestBreakdown, type ContestPreset,
} from '../../lib/api/contests';

const CTA_GRADIENT = ['#7C6AF7', '#A079ED', '#DD80B6'] as const;
const PINK = '#E891C7';

const KICKER: Record<ContestPreset, string> = {
  prediction: '予想コンテスト',
  poll: 'アンケート',
  submission: '公募コンテスト',
  review: 'レビュー',
  hybrid: 'ハイブリッド',
};

function untilLabel(target: string | null): string {
  if (!target) return '';
  const ms = new Date(target).getTime() - Date.now();
  if (ms <= 0) return '締切';
  const min = Math.floor(ms / 60000);
  if (min < 60) return `あと${min}分`;
  const h = Math.floor(min / 60);
  if (h < 24) return `あと${h}時間`;
  return `あと${Math.floor(h / 24)}日`;
}

export default function ContestDetailScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { C } = useTheme();
  const show = useToastStore((s) => s.show);
  const { id: rawId } = useLocalSearchParams<{ id: string }>();
  const id = typeof rawId === 'string' ? rawId : '';

  const { data: contest, isLoading } = useContest(id);
  const phase = useMemo(() => (contest ? derivePhase(contest) : 'open'), [contest]);
  const { data: breakdown } = useContestBreakdown(id, { poll: true });
  const { data: isAuthor } = useIsContestAuthor(id);
  const { data: result } = useContestResult(id, phase === 'result');

  const castVote = useCastVote();
  const submitEntry = useSubmitEntry();
  const confirmResult = useConfirmResult();
  const reportContest = useReportContest();
  const { data: joinState } = useContestJoinState(id);
  const joinMut = useJoinContestCommunity();

  // ローカル選択状態 (投票前)
  const [selOption, setSelOption] = useState<string | null>(null);
  const [selRating, setSelRating] = useState<number>(0);
  const [comment, setComment] = useState('');
  const [entryLabel, setEntryLabel] = useState('');
  const [entryMedia, setEntryMedia] = useState<{ url: string; type: 'image' | 'video' } | null>(null);
  const [entryUploading, setEntryUploading] = useState(false);

  const pickEntryMedia = async () => {
    if (entryUploading) return;
    setEntryUploading(true);
    try { const m = await pickAndUploadContestMedia(); if (m) setEntryMedia(m); }
    catch (e) { show(e instanceof Error ? e.message : 'アップロードに失敗しました', 'error'); }
    finally { setEntryUploading(false); }
  };

  const back = () => { if (router.canGoBack()) router.back(); else router.replace('/(tabs)/feed' as never); };

  const onReport = async () => {
    try { await reportContest.mutateAsync({ contestId: id }); show('通報を受け付けました', 'info'); }
    catch { show('通報に失敗しました', 'error'); }
  };

  if (isLoading) {
    return <View style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={C.accent} /></View>;
  }
  if (!contest) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', gap: SP['3'], padding: SP['6'] }}>
        <Text style={[T.h4, { color: C.text }]}>コンテストが見つかりません</Text>
        <PressableScale onPress={back} haptic="tap"><Text style={[T.bodyB, { color: C.accent }]}>戻る</Text></PressableScale>
      </View>
    );
  }

  const preset = flagsToPreset(contest);
  const committed = !!breakdown?.my_committed;
  const votingOpen = isVotingOpen(contest, new Date());
  const kicker = KICKER[preset];

  // 各状態の本文
  const renderBody = () => {
    if (contest.voided) return <Banner C={C} icon={<Lock size={18} color={C.text3} />} text="このコンテストは中止されました" sub={contest.voided_reason ?? undefined} />;

    // ---- レビュー (★) ----
    if (preset === 'review') {
      if (votingOpen && !committed) {
        return (
          <VotePanel cta="評価する" disabled={selRating < 1 || castVote.isPending}
            onSubmit={async () => { try { await castVote.mutateAsync({ contestId: id, rating: selRating, comment }); show('評価しました', 'success'); } catch (e) { voteError(e, show); } }}>
            <StarPicker C={C} value={selRating} onChange={setSelRating} />
            <CommentField C={C} value={comment} onChange={setComment} />
          </VotePanel>
        );
      }
      return <StarBreakdown C={C} breakdown={breakdown} />;
    }

    // ---- 公募 (submission) ----
    if (preset === 'submission') {
      // 受付フェーズ (now < lock): 作品提出
      if (phase === 'open') {
        const myEntry = contest.options.find((o) => o.kind === 'submission'); // co_read: 自分の提出のみ見える
        return (
          <View style={{ gap: SP['4'] }}>
            <Banner C={C} text={`作品の受付中・${untilLabel(contest.lock_at)}`} sub="締切後に、集まった作品へみんなで投票します。" />
            {myEntry ? (
              <View style={{ borderRadius: R.lg, borderWidth: 1, borderColor: C.border, padding: SP['3'], gap: SP['2'] }}>
                <Text style={[T.caption, { color: C.text3 }]}>あなたの作品</Text>
                {myEntry.media_url && <ContestOptionMedia url={myEntry.media_url} type={myEntry.media_type} height={180} />}
                {!!myEntry.label && <Text style={[T.bodyB, { color: C.text }]}>{myEntry.label}</Text>}
              </View>
            ) : (
              <VotePanel cta="作品を出す" disabled={(!entryMedia && entryLabel.trim().length < 1) || submitEntry.isPending || entryUploading}
                onSubmit={async () => { try { await submitEntry.mutateAsync({ contestId: id, label: entryLabel, mediaUrl: entryMedia?.url, mediaType: entryMedia?.type }); setEntryLabel(''); setEntryMedia(null); show('作品を提出しました', 'success'); } catch (e) { voteError(e, show); } }}>
                {entryMedia ? (
                  <View>
                    <ContestOptionMedia url={entryMedia.url} type={entryMedia.type} height={200} />
                    <PressableScale onPress={() => setEntryMedia(null)} haptic="tap" hitSlop={6} style={{ alignSelf: 'flex-start', marginTop: SP['1'] }}>
                      <Text style={[T.caption, { color: C.text3 }]}>画像・動画を外す</Text>
                    </PressableScale>
                  </View>
                ) : (
                  <PressableScale onPress={pickEntryMedia} haptic="tap" disabled={entryUploading}
                    style={{ borderRadius: R.lg, borderWidth: 1, borderColor: C.border2, borderStyle: 'dashed', paddingVertical: SP['6'], alignItems: 'center', justifyContent: 'center', gap: SP['2'] }}>
                    {entryUploading ? <ActivityIndicator color={C.accent} /> : <ImagePlus size={26} color={C.accent} strokeWidth={1.8} />}
                    <Text style={[T.smallB, { color: C.text2 }]}>{entryUploading ? 'アップロード中…' : '画像・動画を選ぶ'}</Text>
                  </PressableScale>
                )}
                <TextInput value={entryLabel} onChangeText={setEntryLabel} placeholder="作品名・タイトル（任意）" placeholderTextColor={C.text4} maxLength={80}
                  style={{ ...T.body, color: C.text, paddingVertical: SP['3'], borderBottomWidth: 1, borderBottomColor: C.border2 }} />
              </VotePanel>
            )}
          </View>
        );
      }
      // 投票フェーズ (lock..result)
      if (votingOpen && !committed) {
        return (
          <VotePanel cta="投票する" disabled={!selOption || castVote.isPending}
            onSubmit={async () => { try { await castVote.mutateAsync({ contestId: id, optionId: selOption!, comment }); show('投票しました', 'success'); } catch (e) { voteError(e, show); } }}>
            <OptionRail C={C} options={contest.options} selected={selOption} onSelect={setSelOption} />
            <CommentField C={C} value={comment} onChange={setComment} />
          </VotePanel>
        );
      }
      return <SingleBreakdown C={C} contest={contest} breakdown={breakdown} answerId={null} />;
    }

    // ---- 予想 / アンケート (single curated) ----
    if (votingOpen && !committed) {
      const ctaLabel = preset === 'prediction' ? 'この予想でロックする' : '投票する';
      return (
        <VotePanel cta={ctaLabel} disabled={!selOption || castVote.isPending}
          onSubmit={async () => { try { await castVote.mutateAsync({ contestId: id, optionId: selOption!, comment }); show(preset === 'prediction' ? '予想をロックしました' : '投票しました', 'success'); } catch (e) { voteError(e, show); } }}>
          <OptionRail C={C} options={contest.options} selected={selOption} onSelect={setSelOption} />
          <CommentField C={C} value={comment} onChange={setComment} />
          {preset === 'prediction' && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'], marginTop: SP['1'] }}>
              <Lock size={13} color={C.text3} />
              <Text style={[T.caption, { color: C.text3 }]}>予想すると、みんなの予想割合が見えます（一度ロックすると変更できません）</Text>
            </View>
          )}
        </VotePanel>
      );
    }
    const answerId = (result && 'revealed' in result && result.revealed ? result.answer_option_id : breakdown?.answer_option_id) ?? null;
    return <SingleBreakdown C={C} contest={contest} breakdown={breakdown} answerId={answerId} />;
  };

  // 作成者の結果確定 (objective・締切後・未 void)
  const showConfirm = isAuthor && contest.scoring === 'objective' && phase !== 'open' && !contest.voided;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {/* ヘッダー */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SP['3'], paddingTop: insets.top + SP['1'], height: 48 + insets.top }}>
        <PressableScale onPress={back} haptic="tap" hitSlop={10} accessibilityLabel="戻る" style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
          <ChevronLeft size={26} color={C.text} strokeWidth={2.2} />
        </PressableScale>
        <PressableScale onPress={onReport} haptic="tap" hitSlop={10} accessibilityLabel="通報" style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
          <Flag size={18} color={C.text3} strokeWidth={2} />
        </PressableScale>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: SP['5'], paddingBottom: insets.bottom + SP['16'], gap: SP['4'] }} showsVerticalScrollIndicator={false}>
        {/* kicker (グラデ) */}
        <Text style={[T.smallB, { letterSpacing: 1, marginTop: SP['1'] }, geekGradientFill() as GradientTextStyle]}>{kicker.toUpperCase()}</Text>
        {/* タイトル */}
        <Text style={[T.h1, { color: C.text, lineHeight: 36 }]}>{contest.title}</Text>
        {!!contest.description && <Text style={[T.body, { color: C.text2, lineHeight: 22 }]}>{contest.description}</Text>}

        {/* フェーズ */}
        <PhaseBanner C={C} contest={contest} phase={phase} committed={committed} />

        {/* 本文 */}
        <View style={{ marginTop: SP['2'] }}>{renderBody()}</View>

        {/* ② 専用コミュ: 答えた人だけ参加できる (投票≠自動入会) */}
        {joinState?.is_entry && joinState.community_id && (
          <View style={{ marginTop: SP['4'], gap: SP['3'], borderTopWidth: 1, borderTopColor: C.border, paddingTop: SP['5'] }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
              <Users size={16} color={C.accent} strokeWidth={2.2} />
              <Text style={[T.smallB, { color: C.text }]}>このコンテストの専用コミュニティ</Text>
            </View>
            {joinState.is_member ? (
              <PressableScale onPress={() => router.push(`/community/${joinState.community_id}` as never)} haptic="tap"
                style={{ borderRadius: R.full, height: SIZE.buttonMd, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: C.accent }}>
                <Text style={[T.buttonMd, { color: C.accent }]}>コミュニティを開く</Text>
              </PressableScale>
            ) : joinState.answered ? (
              <PressableScale onPress={async () => {
                try { await joinMut.mutateAsync({ communityId: joinState.community_id as string, contestId: id }); show('コミュニティに参加しました！', 'success'); }
                catch (e) { show(e instanceof Error && e.message ? e.message : '参加に失敗しました', 'error'); }
              }} haptic="success" disabled={joinMut.isPending} style={{ borderRadius: R.full, overflow: 'hidden', opacity: joinMut.isPending ? 0.5 : 1 }}>
                <LinearGradient colors={CTA_GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ height: SIZE.buttonMd, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={[T.buttonMd, { color: '#fff' }]}>このコミュニティに参加する</Text>
                </LinearGradient>
              </PressableScale>
            ) : (
              <Text style={[T.small, { color: C.text3, lineHeight: 19 }]}>答えると、このコミュニティに参加できます（投票しただけでは入りません）。</Text>
            )}
          </View>
        )}

        {/* 作成者: 結果確定 */}
        {showConfirm && (
          <ConfirmResultPanel C={C} contest={contest} pending={confirmResult.isPending}
            onConfirm={async (optionId) => {
              try {
                const ok = await confirmResult.mutateAsync({ contestId: id, optionId });
                show(ok ? '結果を確定しました' : 'すでに確定済みです', ok ? 'success' : 'info');
              } catch (e) { voteError(e, show); }
            }} />
        )}
      </ScrollView>
    </View>
  );
}

function voteError(e: unknown, show: (m: string, t?: 'success' | 'error' | 'warn' | 'info') => void) {
  const msg = e instanceof Error ? e.message : '';
  if (msg.includes('duplicate') || msg.includes('23505')) show('すでに投票済みです', 'info');
  else if (msg.includes('Network') || msg.includes('Failed to fetch')) show('通信エラー。電波を確認してください', 'error');
  else show('送信に失敗しました', 'error');
}

// ---- フェーズ表示 -----------------------------------------------------------
function PhaseBanner({ C, contest, phase, committed }: { C: ColorPalette; contest: ContestWithOptions; phase: string; committed: boolean }) {
  let text = '';
  let tone = C.text3;
  const noDeadline = !contest.lock_at;
  if (contest.voided) { text = '中止されました'; }
  else if (phase === 'open') { text = `${contest.has_submission ? '受付中' : '投票受付中'}${noDeadline ? '・期限なし' : `・${untilLabel(contest.lock_at)}`}`; tone = C.accent; }
  else if (contest.has_submission && (!contest.result_at || new Date() < new Date(contest.result_at))) { text = `投票受付中${contest.result_at ? `・${untilLabel(contest.result_at)}` : '・期限なし'}`; tone = C.accent; }
  else if (phase === 'result') { text = '結果発表'; tone = PINK; }
  else { text = contest.result_at ? `締切・集計中・${untilLabel(contest.result_at)}まで` : '集計中'; }
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
      <View style={{ width: 7, height: 7, borderRadius: R.full, backgroundColor: tone }} />
      <Text style={[T.smallB, { color: tone }]}>{text}</Text>
      {committed && <Text style={[T.caption, { color: C.text4 }]}>· 投票済み</Text>}
    </View>
  );
}

// ---- 投票パネル (子要素 + CTA) -----------------------------------------------
function VotePanel({ cta, disabled, onSubmit, children }: { cta: string; disabled: boolean; onSubmit: () => void; children: React.ReactNode }) {
  return (
    <View style={{ gap: SP['4'] }}>
      {children}
      <PressableScale onPress={onSubmit} haptic="success" disabled={disabled} style={{ borderRadius: R.full, overflow: 'hidden', opacity: disabled ? 0.5 : 1 }}>
        <LinearGradient colors={CTA_GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ height: SIZE.buttonLg, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={[T.buttonLg, { color: '#fff' }]}>{cta}</Text>
        </LinearGradient>
      </PressableScale>
    </View>
  );
}

// ---- 単一選択の選択レール (背景は塗らない・左グラデレール + ピンクチェック) ----------
function OptionRail({ C, options, selected, onSelect }: { C: ColorPalette; options: ContestWithOptions['options']; selected: string | null; onSelect: (id: string) => void }) {
  return (
    <View style={{ gap: SP['2'] }}>
      {options.map((o) => {
        const on = selected === o.id;
        return (
          <PressableScale key={o.id} onPress={() => onSelect(o.id)} haptic="select"
            style={{ borderRadius: R.md, borderWidth: 1, borderColor: on ? C.accent : C.border, overflow: 'hidden' }}>
            {o.media_url && <ContestOptionMedia url={o.media_url} type={o.media_type} height={170} rounded={0} />}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['3'], paddingVertical: SP['3'], paddingHorizontal: SP['3'] }}>
              {on && <LinearGradient colors={CTA_GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4 }} />}
              <Text style={[T.bodyB, { color: C.text, flex: 1, paddingLeft: on ? SP['1'] : 0 }]}>{o.label || '（無題）'}</Text>
              {on && <Check size={20} color={PINK} strokeWidth={2.6} />}
            </View>
          </PressableScale>
        );
      })}
    </View>
  );
}

// ---- 単一選択のバー集計 (コミット後リビール) --------------------------------
function SingleBreakdown({ C, contest, breakdown, answerId }: { C: ColorPalette; contest: ContestWithOptions; breakdown: ContestBreakdown | null | undefined; answerId: string | null }) {
  if (!breakdown) return <Loading C={C} />;
  if (!breakdown.my_committed) return <Banner C={C} text="投票するとみんなの結果が見えます" />;
  if (!breakdown.options) return <Banner C={C} text="もう少し集まると結果が見えます" sub={`${breakdown.k_policy.min_n}人以上の投票で公開されます`} />;
  const total = breakdown.total_n ?? 0;
  const myHit = answerId != null && breakdown.my_option_id === answerId;
  return (
    <View style={{ gap: SP['3'] }}>
      {answerId != null && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
          <Trophy size={18} color={myHit ? PINK : C.text2} />
          <Text style={[T.bodyB, { color: myHit ? PINK : C.text }]}>{myHit ? '的中！' : '結果発表'}</Text>
        </View>
      )}
      {breakdown.options.map((o) => {
        const isAnswer = answerId != null && o.option_id === answerId;
        const opt = contest.options.find((co) => co.id === o.option_id);
        return <Bar key={o.option_id} C={C} label={o.label ?? ''} percent={o.percent} count={o.count} mine={o.is_mine} highlight={isAnswer}
          media={opt?.media_url ? { url: opt.media_url, type: opt.media_type } : undefined} />;
      })}
      <Text style={[T.caption, { color: C.text4 }]}>計 {total} 票{contest.has_submission ? '' : ' · 匿名集計'}</Text>
    </View>
  );
}

// ---- ★レビューの集計 --------------------------------------------------------
function StarPicker({ C, value, onChange }: { C: ColorPalette; value: number; onChange: (n: number) => void }) {
  return (
    <View style={{ flexDirection: 'row', gap: SP['2'], justifyContent: 'center', paddingVertical: SP['2'] }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <PressableScale key={n} onPress={() => onChange(n)} haptic="select" hitSlop={6} accessibilityLabel={`${n}つ星`}>
          <Star size={40} color={n <= value ? PINK : C.border2} fill={n <= value ? PINK : 'transparent'} strokeWidth={1.6} />
        </PressableScale>
      ))}
    </View>
  );
}

function StarBreakdown({ C, breakdown }: { C: ColorPalette; breakdown: ContestBreakdown | null | undefined }) {
  if (!breakdown) return <Loading C={C} />;
  if (!breakdown.my_committed) return <Banner C={C} text="評価するとみんなの結果が見えます" />;
  if (!breakdown.options) return <Banner C={C} text="もう少し集まると結果が見えます" sub={`${breakdown.k_policy.min_n}人以上の評価で公開されます`} />;
  const total = breakdown.total_n ?? 0;
  const avg = total > 0 ? breakdown.options.reduce((s, o) => s + (o.rating ?? 0) * o.count, 0) / total : 0;
  return (
    <View style={{ gap: SP['3'] }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: SP['2'] }}>
        <Text style={[T.numLg, { color: PINK }]}>{avg.toFixed(2)}</Text>
        <Star size={18} color={PINK} fill={PINK} />
      </View>
      {[...breakdown.options].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0)).map((o) => (
        <Bar key={o.rating} C={C} label={`★${o.rating}`} percent={o.percent} count={o.count} mine={o.is_mine} highlight={false} />
      ))}
      <Text style={[T.caption, { color: C.text4 }]}>計 {total} 件 · 匿名集計</Text>
    </View>
  );
}

// ---- バー 1 本 --------------------------------------------------------------
function Bar({ C, label, percent, count, mine, highlight, media }: { C: ColorPalette; label: string; percent: number; count: number; mine: boolean; highlight: boolean; media?: { url: string; type: 'image' | 'video' | null } }) {
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'], flex: 1 }}>
          {media?.url && <ContestOptionMedia url={media.url} type={media.type} size={36} />}
          <Text style={[T.bodyB, { color: highlight ? PINK : C.text, flex: 1 }]} numberOfLines={1}>{label || '（無題）'}</Text>
          {mine && <Check size={14} color={PINK} strokeWidth={2.6} />}
        </View>
        <Text style={[T.num, { color: highlight ? PINK : C.text2 }]}>{percent}%</Text>
      </View>
      <View style={{ height: 8, borderRadius: R.full, backgroundColor: C.glass, overflow: 'hidden' }}>
        {highlight ? (
          <LinearGradient colors={CTA_GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ height: 8, width: `${Math.max(2, percent)}%`, borderRadius: R.full }} />
        ) : (
          <View style={{ height: 8, width: `${Math.max(2, percent)}%`, borderRadius: R.full, backgroundColor: mine ? C.accent : C.border2 }} />
        )}
      </View>
      <Text style={[T.caption, { color: C.text4 }]}>{count} 票</Text>
    </View>
  );
}

// ---- 作成者: 結果確定パネル --------------------------------------------------
function ConfirmResultPanel({ C, contest, pending, onConfirm }: { C: ColorPalette; contest: ContestWithOptions; pending: boolean; onConfirm: (optionId: string) => void }) {
  const [pick, setPick] = useState<string | null>(null);
  const curated = contest.options.filter((o) => o.kind === 'curated');
  return (
    <View style={{ marginTop: SP['6'], gap: SP['3'], borderTopWidth: 1, borderTopColor: C.border, paddingTop: SP['5'] }}>
      <Text style={[T.smallB, { color: C.amber }]}>作成者: 正解を確定する</Text>
      <Text style={[T.caption, { color: C.text3, lineHeight: 18 }]}>確定すると結果発表時に公開されます。一度きり・あとから変更できません。</Text>
      <OptionRail C={C} options={curated} selected={pick} onSelect={setPick} />
      <PressableScale onPress={() => pick && onConfirm(pick)} haptic="confirm" disabled={!pick || pending}
        style={{ borderRadius: R.full, height: SIZE.buttonMd, alignItems: 'center', justifyContent: 'center', backgroundColor: C.amber, opacity: !pick || pending ? 0.5 : 1 }}>
        <Text style={[T.buttonMd, { color: '#1a1206' }]}>この結果で確定する</Text>
      </PressableScale>
    </View>
  );
}

// ---- 共通小物 ---------------------------------------------------------------
function CommentField({ C, value, onChange }: { C: ColorPalette; value: string; onChange: (v: string) => void }) {
  return (
    <TextInput value={value} onChangeText={onChange} placeholder="ひとこと（任意・匿名）" placeholderTextColor={C.text4} maxLength={140}
      style={{ ...T.small, color: C.text2, paddingVertical: SP['2'], borderBottomWidth: 1, borderBottomColor: C.border }} />
  );
}
function Banner({ C, text, sub, icon }: { C: ColorPalette; text: string; sub?: string; icon?: React.ReactNode }) {
  return (
    <View style={{ borderRadius: R.lg, borderWidth: 1, borderColor: C.border, backgroundColor: C.bg2, padding: SP['4'], gap: SP['1'], flexDirection: icon ? 'row' : 'column', alignItems: icon ? 'center' : 'stretch' }}>
      {icon}
      <View style={{ flex: icon ? 1 : undefined, gap: 2 }}>
        <Text style={[T.bodyB, { color: C.text }]}>{text}</Text>
        {!!sub && <Text style={[T.small, { color: C.text3, lineHeight: 19 }]}>{sub}</Text>}
      </View>
    </View>
  );
}
function Loading({ C }: { C: ColorPalette }) {
  return <View style={{ paddingVertical: SP['8'], alignItems: 'center' }}><ActivityIndicator color={C.accent} /></View>;
}
