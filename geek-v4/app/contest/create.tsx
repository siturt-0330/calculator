// =============================================================================
// app/contest/create.tsx — コンテストを作る (3 ステップ・ウィザード)
// -----------------------------------------------------------------------------
//   STEP1 どこで開催 (① 既存コミュ内 / ② 新しいコンテストコミュニティ)
//   STEP2 お題 + 種類(5プリセット) + 選択肢
//   STEP3 締切 / 結果発表 → 公開
// バックエンド: 0151+0152(本番) / ② は 0153(create_contest_community・未適用なら②送信は失敗)。
// 締切は datetime ピッカー非依存の duration プリセット(CHECK lock>=+15分 / result>lock を満たす)。
// ④ハイブリッドは has_eval_phase=true → eval_unlock_at を lock〜result の中点に自動設定。
// =============================================================================

import { View, Text, ScrollView, TextInput, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
import { useState, useMemo } from 'react';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { Trophy, BarChart3, Sparkles, Star, X, Plus, Check, Users, ChevronLeft, AlertTriangle, ImagePlus, Search } from 'lucide-react-native';

import { useTheme } from '../../hooks/useColors';
import type { ColorPalette } from '../../lib/theme/palettes';
import { R, SP, SIZE } from '../../design/tokens';
import { T } from '../../design/typography';
import { PressableScale } from '../../components/ui/PressableScale';
import { ContestTypePicker } from '../../components/contest/ContestTypePicker';
import { ContestOptionMedia } from '../../components/contest/ContestOptionMedia';
import { useToastStore } from '../../stores/toastStore';
import { fetchMyCommunities } from '../../lib/api/communities-feed';
import { pickAndUploadContestMedia } from '../../lib/contestMedia';
import { presetToFlags, type ContestPreset, type ContestOptionInput } from '../../lib/api/contests';
import { useCreateContest, useCreateContestCommunity } from '../../hooks/useContests';

type PresetMeta = { key: ContestPreset; icon: typeof Trophy; name: string; tagline: string; preview: string };
const PRESETS: PresetMeta[] = [
  { key: 'prediction', icon: Trophy, name: '勝敗予想', tagline: '正解のある予想。当たると称号', preview: '選択肢から1つ予想 → 締切後に作成者が正解を発表。的中で称号がつく' },
  { key: 'poll', icon: BarChart3, name: 'アンケート', tagline: '正解なし・みんなの割合を見る', preview: '投票すると、みんなの予想割合が見える。正解はなし' },
  { key: 'submission', icon: Sparkles, name: '公募', tagline: '作品を出し合って投票', preview: '参加者が作品を提出 → 締切後にみんなで投票して人気を決める' },
  { key: 'review', icon: Star, name: 'レビュー', tagline: '★で評価する', preview: '対象を★1〜5で評価。平均と分布が見える' },
  // ハイブリッドは廃止 (2026-06-14)。代わりに ContestTypePicker 末尾の「カスタマイズ(準備中)」へ。
];

const LOCK_OPTIONS = [
  { label: '1時間後', ms: 3600e3 },
  { label: '6時間後', ms: 6 * 3600e3 },
  { label: '1日後', ms: 24 * 3600e3 },
  { label: '3日後', ms: 3 * 24 * 3600e3 },
  { label: '1週間後', ms: 7 * 24 * 3600e3 },
];
// 結果発表/投票期間 (締切の後)。submission 系は「投票期間」、それ以外は「発表まで」。
const RESULT_AFTER_VOTE = [
  { label: '締切後すぐ', ms: 30 * 60e3 },
  { label: '締切後1日', ms: 24 * 3600e3 },
  { label: '締切後3日', ms: 3 * 24 * 3600e3 },
];
const RESULT_AFTER_SUBMISSION = [
  { label: '投票1日間', ms: 24 * 3600e3 },
  { label: '投票3日間', ms: 3 * 24 * 3600e3 },
  { label: '投票1週間', ms: 7 * 24 * 3600e3 },
];

function fmtAbs(ms: number): string {
  const d = new Date(Date.now() + ms);
  return d.toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function CreateContestScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { C } = useTheme();
  const show = useToastStore((s) => s.show);
  const createMut = useCreateContest();
  const createCommunityMut = useCreateContestCommunity();
  const params = useLocalSearchParams<{ community_id?: string }>();

  const [step, setStep] = useState<1 | 2 | 3>(1);
  // ① 既存コミュ内 / ② 新しいコンテストコミュニティ
  const [mode, setMode] = useState<'in_community' | 'new_community'>('in_community');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  // パターン①: 投稿コンポーザ等から community_id を引き継いだら初期選択する。
  const [communityId, setCommunityId] = useState<string | null>(
    typeof params.community_id === 'string' ? params.community_id : null,
  );
  // パターン②: 新設するコンテストコミュニティの名前・アイコン
  const [communityName, setCommunityName] = useState('');
  const [communityIcon, setCommunityIcon] = useState('🏆');
  // 既存コミュが多い人向けの絞り込み (STEP1 / クライアント側 filter のみ)
  const [communitySearch, setCommunitySearch] = useState('');
  const [preset, setPreset] = useState<ContestPreset>('prediction');
  const [options, setOptions] = useState<ContestOptionInput[]>([{ label: '' }, { label: '' }]);
  const [uploadingOpt, setUploadingOpt] = useState<number | null>(null);
  const [lockMs, setLockMs] = useState<number>(24 * 3600e3);
  const [resultMs, setResultMs] = useState<number>(24 * 3600e3);
  const [noDeadline, setNoDeadline] = useState(false);

  const flags = useMemo(() => presetToFlags(preset), [preset]);
  const resultOptions = flags.has_submission ? RESULT_AFTER_SUBMISSION : RESULT_AFTER_VOTE;
  // 期限なしは subjective かつ非submission(アンケート/レビュー)のみ。
  //   勝敗予想(objective)は正解の reveal+称号に lock+result が要る / 公募・④は二段階に lock 必須。
  const canNoDeadline = flags.scoring === 'subjective' && !flags.has_submission;
  const effectiveNoDeadline = noDeadline && canNoDeadline;

  const { data: myCommunities = [], isLoading: loadingComms } = useQuery({
    queryKey: ['my-communities'],
    queryFn: fetchMyCommunities,
    staleTime: 60_000,
  });

  // 名前で client side 絞り込み (選択値 communityId には触れない = 隠れても選択は保持)
  const filteredComms = useMemo(() => {
    const query = communitySearch.trim().toLowerCase();
    if (!query) return myCommunities;
    return myCommunities.filter((c) => c.name.toLowerCase().includes(query));
  }, [myCommunities, communitySearch]);
  // 検索欄は数が多い人にだけ出す (少数ならそのまま一覧が見やすい)
  const showCommunitySearch = myCommunities.length > 6;

  const setOptionLabel = (i: number, v: string) => setOptions((prev) => prev.map((o, idx) => (idx === i ? { ...o, label: v } : o)));
  const setOptionMedia = (i: number, m: { url: string; type: 'image' | 'video' } | null) =>
    setOptions((prev) => prev.map((o, idx) => (idx === i ? { ...o, mediaUrl: m?.url ?? null, mediaType: m?.type ?? null } : o)));
  const addOption = () => setOptions((prev) => (prev.length >= 20 ? prev : [...prev, { label: '' }]));
  const removeOption = (i: number) => setOptions((prev) => (prev.length <= 2 ? prev : prev.filter((_, idx) => idx !== i)));
  const pickOptionMedia = async (i: number) => {
    if (uploadingOpt != null) return;
    setUploadingOpt(i);
    try {
      const m = await pickAndUploadContestMedia();
      if (m) setOptionMedia(i, m);
    } catch (e) {
      show(e instanceof Error ? e.message : 'メディアのアップロードに失敗しました', 'error');
    } finally {
      setUploadingOpt(null);
    }
  };

  const validOptionCount = options.filter((o) => (o.label ?? '').trim().length > 0 || o.mediaUrl).length;
  const pending = createMut.isPending || createCommunityMut.isPending;

  // ---- 各ステップのバリデーション ----
  const step1Reason =
    mode === 'in_community' ? (!communityId ? 'コミュニティを選んでください' : null)
      : communityName.trim().length < 2 ? 'コミュニティ名を入力してください' : null;
  const step2Reason =
    title.trim().length < 1 ? 'お題を入力してください'
      : flags.needsOptions && validOptionCount < 2 ? '選択肢を2つ以上入力してください' : null;
  const stepReason = step === 1 ? step1Reason : step === 2 ? step2Reason : null;

  const goNext = () => {
    if (step === 1 && !step1Reason) setStep(2);
    else if (step === 2 && !step2Reason) setStep(3);
  };
  const close = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/feed' as never);
  };
  const goBack = () => { if (step === 1) close(); else setStep((s) => (s - 1) as 1 | 2 | 3); };

  const onSubmit = async () => {
    if (step1Reason || step2Reason || pending) return;
    const lockAt = effectiveNoDeadline ? null : new Date(Date.now() + lockMs).toISOString();
    const resultAt = effectiveNoDeadline ? null : new Date(Date.now() + lockMs + resultMs).toISOString();
    // ④ハイブリッド: eval_unlock_at は lock〜result の中点 (CHECK lock < eval < result を満たす)
    const evalUnlockAt = !effectiveNoDeadline && flags.has_eval_phase ? new Date(Date.now() + lockMs + Math.floor(resultMs / 2)).toISOString() : null;
    const optionList = flags.needsOptions ? options.filter((o) => (o.label ?? '').trim().length > 0 || o.mediaUrl) : undefined;
    try {
      if (mode === 'new_community') {
        const r = await createCommunityMut.mutateAsync({
          communityName, iconEmoji: communityIcon, title, description, preset, options: optionList, lockAt, evalUnlockAt, resultAt,
        });
        show('コンテストコミュニティを作りました！', 'success');
        router.replace(`/contest/${r.contestId}` as never);
      } else {
        const created = await createMut.mutateAsync({
          communityId: communityId as string, title, description, preset, options: optionList, lockAt, evalUnlockAt, resultAt,
        });
        show('コンテストを公開しました！', 'success');
        router.replace(`/contest/${created.id}` as never);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      let userMsg = 'コンテストの作成に失敗しました';
      if (msg.includes('Network') || msg.includes('Failed to fetch')) userMsg = '通信エラー。電波を確認してください';
      else if (msg.includes('create_contest_community') || msg.includes('PGRST202')) userMsg = '②はまだ準備中です（0153 未適用）';
      else if (msg.toLowerCase().includes('row-level') || msg.includes('42501')) userMsg = '権限エラー。ここで作成できません';
      show(userMsg, 'error');
    }
  };

  const STEP_TITLES = ['どこで開催?', 'お題と種類', '締切と発表'];

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: C.bg }}>
      {/* ===== ヘッダー: 戻る / タイトル+ステップ / 閉じる ===== */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: SP['3'], paddingTop: insets.top + SP['2'], height: 56 + insets.top }}>
        <PressableScale onPress={goBack} haptic="tap" hitSlop={10} accessibilityLabel={step === 1 ? '閉じる' : '戻る'}
          style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
          <ChevronLeft size={26} color={C.text} strokeWidth={2.2} />
        </PressableScale>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text style={[T.bodyB, { color: C.text }]}>{STEP_TITLES[step - 1]}</Text>
          <View style={{ flexDirection: 'row', gap: 5, marginTop: 5 }}>
            {[1, 2, 3].map((n) => (
              <View key={n} style={{ width: n === step ? 18 : 6, height: 6, borderRadius: R.full, backgroundColor: n === step ? C.accent : C.border2 }} />
            ))}
          </View>
        </View>
        <PressableScale onPress={close} haptic="tap" hitSlop={10} accessibilityLabel="閉じる"
          style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
          <X size={22} color={C.text3} strokeWidth={2.2} />
        </PressableScale>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: SP['4'], paddingTop: SP['2'], paddingBottom: SP['10'], gap: SP['6'] }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* ============================ STEP 1: どこで開催 ============================ */}
        {step === 1 && (
          <>
            <Section C={C} label="どこで開く?" hint="既存コミュ内 / 答えた人だけの専用コミュを新設">
              <View style={{ gap: SP['2'] }}>
                {([
                  { m: 'in_community', icon: Users, t: '既存コミュニティ内', d: '参加中のコミュの中でコンテストを開く' },
                  { m: 'new_community', icon: Sparkles, t: '新しいコンテストコミュニティ', d: '答えた人だけが入れる専用コミュを新設' },
                ] as const).map((opt) => {
                  const on = mode === opt.m;
                  const OIcon = opt.icon;
                  return (
                    <PressableScale key={opt.m} onPress={() => setMode(opt.m)} haptic="tap"
                      style={{ flexDirection: 'row', alignItems: 'center', gap: SP['3'], borderRadius: R.lg, borderWidth: 1.5, borderColor: on ? C.accent : C.border, backgroundColor: on ? C.accent + '14' : C.bg2, padding: SP['3'] }}>
                      <View style={{ width: 36, height: 36, borderRadius: R.md, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? C.accent + '24' : C.glass }}>
                        <OIcon size={18} color={on ? C.accent : C.text2} strokeWidth={2} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[T.bodyB, { color: C.text }]}>{opt.t}</Text>
                        <Text style={[T.caption, { color: C.text3 }]}>{opt.d}</Text>
                      </View>
                      {on && <Check size={18} color={C.accent} strokeWidth={2.4} />}
                    </PressableScale>
                  );
                })}
              </View>
            </Section>

            {mode === 'in_community' ? (
              <Section C={C} label="どのコミュニティ?" hint="参加しているコミュニティで開く">
                {loadingComms ? (
                  <Text style={[T.small, { color: C.text3 }]}>読み込み中…</Text>
                ) : myCommunities.length === 0 ? (
                  <Text style={[T.small, { color: C.text3, lineHeight: 20 }]}>参加中のコミュがありません。「新しいコンテストコミュニティ」なら今すぐ作れます。</Text>
                ) : (
                  <View style={{ gap: SP['2'] }}>
                    {/* コミュが多い人向けの絞り込み (6件超で表示) */}
                    {showCommunitySearch && (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'], backgroundColor: C.bg3, borderRadius: R.full, borderWidth: 1, borderColor: communitySearch ? C.accent : C.border, paddingHorizontal: SP['3'], paddingVertical: 6 }}>
                        <Search size={16} color={C.text3} strokeWidth={2.2} />
                        <TextInput
                          value={communitySearch}
                          onChangeText={setCommunitySearch}
                          placeholder="コミュニティを検索"
                          placeholderTextColor={C.text4}
                          style={{ flex: 1, color: C.text, fontSize: 14, paddingVertical: 2, ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null) }}
                        />
                        {communitySearch.length > 0 && (
                          <PressableScale onPress={() => setCommunitySearch('')} haptic="tap" hitSlop={8} accessibilityLabel="検索をクリア"
                            style={{ width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg4 }}>
                            <X size={12} color={C.text2} strokeWidth={2.4} />
                          </PressableScale>
                        )}
                      </View>
                    )}
                    {filteredComms.length === 0 ? (
                      <Text style={[T.small, { color: C.text3 }]}>「{communitySearch.trim()}」に一致するコミュはありません</Text>
                    ) : (
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SP['2'] }}>
                        {filteredComms.map((c) => {
                          const on = communityId === c.id;
                          return (
                            <PressableScale key={c.id} onPress={() => setCommunityId(c.id)} haptic="tap"
                              style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'], paddingVertical: SP['2'], paddingHorizontal: SP['3'], borderRadius: R.full, borderWidth: 1.5, borderColor: on ? C.accent : C.border2, backgroundColor: on ? C.accent + '1f' : 'transparent' }}>
                              <Text style={{ fontSize: 15 }}>{c.icon_emoji || '👥'}</Text>
                              <Text style={[T.smallB, { color: on ? C.accent : C.text2 }]} numberOfLines={1}>{c.name}</Text>
                            </PressableScale>
                          );
                        })}
                      </View>
                    )}
                  </View>
                )}
              </Section>
            ) : (
              <Section C={C} label="コンテストコミュニティ" hint="この名前で専用コミュが生まれます">
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['3'] }}>
                  <TextInput value={communityIcon} onChangeText={(v) => setCommunityIcon([...v].slice(0, 2).join(''))} placeholder="🏆" placeholderTextColor={C.text4}
                    style={{ ...T.h2, width: 52, textAlign: 'center', color: C.text, paddingVertical: SP['2'], borderBottomWidth: 1, borderBottomColor: C.border }} />
                  <TextInput value={communityName} onChangeText={setCommunityName} placeholder="例: 天皇賞予想部" placeholderTextColor={C.text4} maxLength={40}
                    style={{ ...T.h3, flex: 1, color: C.text, paddingVertical: SP['2'], borderBottomWidth: 1, borderBottomColor: C.border2 }} />
                </View>
                <Text style={[T.caption, { color: C.text3, lineHeight: 18 }]}>このコンテストに答えると参加できる専用コミュになります。投票しただけでは入会しません（「参加する」で入会）。</Text>
              </Section>
            )}
          </>
        )}

        {/* ============================ STEP 2: お題 + 種類 + 選択肢 ============================ */}
        {step === 2 && (
          <>
            <Section C={C} label="お題" hint="みんなが参加したくなる一言を">
              <TextInput value={title} onChangeText={setTitle} placeholder="例: 天皇賞（秋）GⅠ 優勝予想" placeholderTextColor={C.text4} maxLength={60} autoFocus
                style={{ ...T.h2, color: C.text, paddingVertical: SP['2'], borderBottomWidth: 1, borderBottomColor: C.border2 }} />
              <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
                <Text style={[T.caption, { color: C.text4 }]}>{title.length} / 60</Text>
              </View>
              <TextInput value={description} onChangeText={setDescription} placeholder="補足（任意）" placeholderTextColor={C.text4} maxLength={600} multiline
                style={{ ...T.body, color: C.text2 }} />
            </Section>

            <Section C={C} label="種類" hint="どんなコンテストにする?">
              <ContestTypePicker C={C} value={preset} onChange={setPreset} />
            </Section>

            {flags.needsOptions && (
              <Section C={C} label="選択肢" hint="2つ以上。画像・動画も付けられます">
                <View style={{ gap: SP['3'] }}>
                  {options.map((o, i) => (
                    <View key={i} style={{ gap: SP['2'] }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
                        <View style={{ width: 22, height: 22, borderRadius: R.full, borderWidth: 1.5, borderColor: C.border2, alignItems: 'center', justifyContent: 'center' }}>
                          <Text style={[T.captionM, { color: C.text3 }]}>{i + 1}</Text>
                        </View>
                        <TextInput value={o.label} onChangeText={(v) => setOptionLabel(i, v)} placeholder={`選択肢 ${i + 1}`} placeholderTextColor={C.text4} maxLength={80}
                          style={{ ...T.body, color: C.text, flex: 1, paddingVertical: SP['2'], borderBottomWidth: 1, borderBottomColor: C.border }} />
                        <PressableScale onPress={() => pickOptionMedia(i)} haptic="tap" hitSlop={8} disabled={uploadingOpt != null} accessibilityLabel="画像・動画を追加"
                          style={{ width: 30, height: 30, alignItems: 'center', justifyContent: 'center' }}>
                          {uploadingOpt === i ? <ActivityIndicator size="small" color={C.accent} /> : <ImagePlus size={18} color={o.mediaUrl ? C.accent : C.text4} strokeWidth={2} />}
                        </PressableScale>
                        {options.length > 2 && (
                          <PressableScale onPress={() => removeOption(i)} haptic="tap" hitSlop={8} accessibilityLabel="削除"
                            style={{ width: 28, height: 28, alignItems: 'center', justifyContent: 'center' }}>
                            <X size={16} color={C.text4} strokeWidth={2} />
                          </PressableScale>
                        )}
                      </View>
                      {o.mediaUrl && (
                        <View style={{ paddingLeft: 30 }}>
                          <ContestOptionMedia url={o.mediaUrl} type={o.mediaType ?? 'image'} height={140} />
                          <PressableScale onPress={() => setOptionMedia(i, null)} haptic="tap" hitSlop={6} style={{ alignSelf: 'flex-start', marginTop: SP['1'] }}>
                            <Text style={[T.caption, { color: C.text3 }]}>メディアを外す</Text>
                          </PressableScale>
                        </View>
                      )}
                    </View>
                  ))}
                  {options.length < 20 && (
                    <PressableScale onPress={addOption} haptic="tap" style={{ flexDirection: 'row', alignItems: 'center', gap: SP['1'], paddingVertical: SP['2'], alignSelf: 'flex-start' }}>
                      <Plus size={16} color={C.accent} strokeWidth={2.4} />
                      <Text style={[T.smallB, { color: C.accent }]}>選択肢を追加</Text>
                    </PressableScale>
                  )}
                </View>
              </Section>
            )}

            {preset === 'submission' && <NoticeCard C={C} text="提出期間は他の人の作品は見えません。締切後に一斉公開され、みんなで投票します。" />}
            {flags.scoring === 'objective' && <AmberNotice C={C} />}
          </>
        )}

        {/* ============================ STEP 3: 締切 / 結果 ============================ */}
        {step === 3 && (
          <>
            {canNoDeadline && (
              <PressableScale onPress={() => setNoDeadline((v) => !v)} haptic="tap"
                style={{ flexDirection: 'row', alignItems: 'center', gap: SP['3'], borderRadius: R.lg, borderWidth: 1, borderColor: noDeadline ? C.accent : C.border, backgroundColor: noDeadline ? C.accent + '12' : C.bg2, padding: SP['3'] }}>
                <View style={{ width: 22, height: 22, borderRadius: R.sm, borderWidth: 1.5, borderColor: noDeadline ? C.accent : C.border2, backgroundColor: noDeadline ? C.accent : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                  {noDeadline && <Check size={14} color="#fff" strokeWidth={3} />}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[T.bodyB, { color: C.text }]}>期限を設けない</Text>
                  <Text style={[T.caption, { color: C.text3 }]}>いつでも投票でき、投票するとすぐ結果が見えます</Text>
                </View>
              </PressableScale>
            )}
            {!effectiveNoDeadline && (
              <>
                <Section C={C} label={flags.has_submission ? '受付の締切' : '予想の締切'} hint={`${fmtAbs(lockMs)} に締切`}>
                  <ChipRow C={C} options={LOCK_OPTIONS} value={lockMs} onChange={setLockMs} />
                </Section>
                <Section C={C} label={flags.has_submission ? '投票期間' : '結果発表'} hint={`${fmtAbs(lockMs + resultMs)} に${flags.has_submission ? '締め切り' : '発表'}`}>
                  <ChipRow C={C} options={resultOptions} value={resultMs} onChange={setResultMs} />
                </Section>
              </>
            )}
            {/* 確認サマリ */}
            <View style={{ borderRadius: R.lg, borderWidth: 1, borderColor: C.border, backgroundColor: C.bg2, padding: SP['4'], gap: 6 }}>
              <SummaryRow C={C} k="開催" v={mode === 'new_community' ? `新コミュ「${communityName || '—'}」` : (myCommunities.find((c) => c.id === communityId)?.name ?? '—')} />
              <SummaryRow C={C} k="種類" v={PRESETS.find((p) => p.key === preset)?.name ?? '—'} />
              <SummaryRow C={C} k="お題" v={title || '—'} />
              <SummaryRow C={C} k="期限" v={effectiveNoDeadline ? '期限なし' : `${fmtAbs(lockMs + resultMs)} まで`} />
            </View>
          </>
        )}
      </ScrollView>

      {/* ===== 下部固定: 次へ / 公開 ===== */}
      <View style={{ paddingHorizontal: SP['4'], paddingTop: SP['2'], paddingBottom: insets.bottom + SP['3'], borderTopWidth: 1, borderTopColor: C.border, backgroundColor: C.bg, gap: SP['2'] }}>
        {step < 3 ? (
          <PressableScale onPress={goNext} haptic="tap" disabled={!!stepReason}
            style={{ borderRadius: R.full, height: SIZE.buttonLg, alignItems: 'center', justifyContent: 'center', backgroundColor: C.accent, opacity: stepReason ? 0.5 : 1 }}>
            <Text style={[T.buttonLg, { color: '#fff' }]}>次に進む</Text>
          </PressableScale>
        ) : (
          <PressableScale onPress={onSubmit} haptic="success" disabled={pending}
            style={{ borderRadius: R.full, height: SIZE.buttonLg, alignItems: 'center', justifyContent: 'center', backgroundColor: C.accent, opacity: pending ? 0.5 : 1 }}>
            <Text style={[T.buttonLg, { color: '#fff' }]}>{pending ? '公開中…' : mode === 'new_community' ? 'コミュニティを作って公開' : 'コンテストを公開する'}</Text>
          </PressableScale>
        )}
        {stepReason && <Text style={[T.caption, { color: C.text3, textAlign: 'center' }]}>{stepReason}</Text>}
      </View>
    </KeyboardAvoidingView>
  );
}

// ---- 小物 -------------------------------------------------------------------
function Section({ C, label, hint, children }: { C: ColorPalette; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: SP['3'] }}>
      <View>
        <Text style={[T.smallB, { color: C.text, letterSpacing: 0.2 }]}>{label}</Text>
        {hint && <Text style={[T.caption, { color: C.text3, marginTop: 2 }]}>{hint}</Text>}
      </View>
      {children}
    </View>
  );
}

function ChipRow({ C, options, value, onChange }: { C: ColorPalette; options: { label: string; ms: number }[]; value: number; onChange: (ms: number) => void }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SP['2'] }}>
      {options.map((o) => {
        const on = value === o.ms;
        return (
          <PressableScale key={o.label} onPress={() => onChange(o.ms)} haptic="tap"
            style={{ paddingVertical: SP['2'], paddingHorizontal: SP['4'], borderRadius: R.full, borderWidth: 1.5, borderColor: on ? C.accent : C.border2, backgroundColor: on ? C.accent + '1f' : 'transparent' }}>
            <Text style={[T.smallB, { color: on ? C.accent : C.text2 }]}>{o.label}</Text>
          </PressableScale>
        );
      })}
    </View>
  );
}

function NoticeCard({ C, text }: { C: ColorPalette; text: string }) {
  return (
    <View style={{ borderRadius: R.lg, borderWidth: 1, borderColor: C.border, backgroundColor: C.bg2, padding: SP['4'] }}>
      <Text style={[T.small, { color: C.text2, lineHeight: 20 }]}>{text}</Text>
    </View>
  );
}

// 正解入力タイプ(①勝敗予想)の注意。結果はあなたが入力 → 通報チェック。
function AmberNotice({ C }: { C: ColorPalette }) {
  return (
    <View style={{ flexDirection: 'row', gap: SP['3'], backgroundColor: C.amber + '14', borderWidth: 1, borderColor: C.amber + '40', borderRadius: R.lg, padding: SP['4'] }}>
      <AlertTriangle size={16} color={C.amber} strokeWidth={2} style={{ marginTop: 2 }} />
      <Text style={[T.small, { color: C.text2, flex: 1, lineHeight: 20 }]}>
        結果（正解）は<Text style={[T.smallB, { color: C.text }]}>あなたが入力</Text>します。まちがっていたら、みんなが通報できます。
      </Text>
    </View>
  );
}

function SummaryRow({ C, k, v }: { C: ColorPalette; k: string; v: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: SP['3'] }}>
      <Text style={[T.caption, { color: C.text4, width: 36 }]}>{k}</Text>
      <Text style={[T.small, { color: C.text2, flex: 1 }]} numberOfLines={1}>{v}</Text>
    </View>
  );
}
