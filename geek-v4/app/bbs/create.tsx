import { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
import Animated, { FadeIn, FadeInDown, Layout } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createThread } from '../../lib/api/bbs';
import { discoverCommunities, type Community } from '../../lib/api/communities';
import type { ThreadVisibility } from '../../types/models';
import { C, SP, R, GRAD, SHADOW } from '../../design/tokens';
import { T } from '../../design/typography';
import { PressableScale } from '../../components/ui/PressableScale';
import { Icon } from '../../constants/icons';
import { notify, Haptics } from '../../lib/haptics';
import { useToastStore } from '../../stores/toastStore';

// カテゴリ chip 用のカラーパレット — (tabs)/bbs.tsx と同じマップを共有することで
// 一覧画面 ⇄ 作成画面で色のブレを防ぐ。「すべて」はリスト画面側でしか使わないので除外。
const CATEGORIES = ['雑談', 'アニメ', 'ゲーム', 'マンガ', '音楽', 'アイドル', 'Vtuber', '推し活', 'グルメ', 'コスプレ', 'ニュース'] as const;
const CATEGORY_COLORS: Record<string, string> = {
  '雑談': '#22D3A4', 'アニメ': '#FF6B7A', 'ゲーム': '#7CB1FF',
  'マンガ': '#F472B6', '音楽': '#FCD34D', 'アイドル': '#FF8C30',
  'Vtuber': '#A78BFA', '推し活': '#EC4899', 'グルメ': '#84CC16',
  'コスプレ': '#06B6D4', 'ニュース': '#94A3B8',
};

// タイトル文字数制限 — 残文字数 chip と inline error で同じ閾値を共有
const TITLE_MIN = 2;
const TITLE_MAX = 80;
const TITLE_WARN_AT = 70; // この閾値を超えると amber chip

export default function BBSCreateScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { show } = useToastStore();
  // ?community_id=X で deep link されたら community 限定で preselect する
  const params = useLocalSearchParams<{ community_id?: string }>();
  const initialCommunityId = typeof params.community_id === 'string' ? params.community_id : null;

  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('');
  const [error, setError] = useState('');
  // 公開設定
  const [visibility, setVisibility] = useState<ThreadVisibility>(
    initialCommunityId ? 'community_only' : 'public',
  );
  const [selectedCommunityId, setSelectedCommunityId] = useState<string | null>(initialCommunityId);
  // public でも「コミュニティに紐付けたい」場合のトグル
  const [attachToCommunity, setAttachToCommunity] = useState<boolean>(!!initialCommunityId);
  // コミュニティ検索
  const [communityQuery, setCommunityQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');

  const BackIcon = Icon.arrowL;

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(communityQuery.trim()), 150);
    return () => clearTimeout(t);
  }, [communityQuery]);

  // コミュニティ検索 (visibility=community_only または attachToCommunity の時だけ)
  const showCommunityPicker = visibility === 'community_only' || attachToCommunity;
  const communitiesQ = useQuery<Community[]>({
    queryKey: ['discover-communities', debouncedQuery],
    queryFn: () => discoverCommunities({ query: debouncedQuery || undefined, limit: 12 }),
    enabled: showCommunityPicker,
    staleTime: 30_000,
  });

  // 選択中のコミュニティが検索結果に出ないケース (deep link 等) を補うため別フェッチ
  const selectedCommunityQ = useQuery<Community | null>({
    queryKey: ['community-by-id', selectedCommunityId],
    queryFn: async () => {
      if (!selectedCommunityId) return null;
      const list = await discoverCommunities({ query: undefined, limit: 30 });
      return list.find((c) => c.id === selectedCommunityId) ?? null;
    },
    enabled: !!selectedCommunityId && showCommunityPicker,
    staleTime: 60_000,
  });

  // 表示用のコミュニティ一覧 — 選択中のものは常に先頭に固定
  const displayCommunities = useMemo<Community[]>(() => {
    const list = communitiesQ.data ?? [];
    if (!selectedCommunityId) return list;
    const sel = selectedCommunityQ.data;
    if (!sel) return list;
    const others = list.filter((c) => c.id !== selectedCommunityId);
    return [sel, ...others];
  }, [communitiesQ.data, selectedCommunityQ.data, selectedCommunityId]);

  const { mutateAsync, isPending } = useMutation({
    mutationFn: () =>
      createThread(title.trim(), category || '雑談', {
        community_id: selectedCommunityId ?? undefined,
        visibility,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bbs-threads'] });
      if (selectedCommunityId) {
        qc.invalidateQueries({ queryKey: ['community-threads', selectedCommunityId] });
      }
      notify(Haptics.NotificationFeedbackType.Success);
      router.back();
    },
    onError: () => {
      notify(Haptics.NotificationFeedbackType.Error);
      setError('スレッドの作成に失敗しました。');
    },
  });

  // 入力の前後空白を除いた "実質的な" タイトル — validation / preview / submit で共有
  const trimmedTitle = title.trim();
  const titleLen = trimmedTitle.length;
  const titleTooShort = titleLen > 0 && titleLen < TITLE_MIN;
  const titleTooLong = titleLen > TITLE_MAX;
  const titleEmpty = titleLen === 0;
  // 公開設定 × コミュニティ選択の必須要件
  const needsCommunity = visibility === 'community_only' && !selectedCommunityId;

  const canSubmit = !titleEmpty && !titleTooShort && !titleTooLong && !needsCommunity && !isPending;

  const handleSubmit = async () => {
    setError('');
    if (titleEmpty) {
      setError('スレッドのタイトルを入力してください。');
      notify(Haptics.NotificationFeedbackType.Warning);
      return;
    }
    if (titleTooShort) {
      setError(`タイトルは${TITLE_MIN}文字以上で入力してください。`);
      notify(Haptics.NotificationFeedbackType.Warning);
      return;
    }
    if (titleTooLong) {
      setError(`タイトルは${TITLE_MAX}文字以内で入力してください。`);
      notify(Haptics.NotificationFeedbackType.Warning);
      return;
    }
    if (needsCommunity) {
      show('コミュニティを選んでください', 'warn');
      notify(Haptics.NotificationFeedbackType.Warning);
      return;
    }
    try {
      await mutateAsync();
    } catch {
      // onError 内で error state を立てているのでここでは握り潰す
      // (await の throw が unhandled rejection になるのを防ぐ)
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: C.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: SP['4'],
          paddingTop: insets.top + SP['2'],
          paddingBottom: SP['3'],
          borderBottomWidth: 1,
          borderBottomColor: C.border,
        }}
      >
        <PressableScale onPress={() => router.back()} haptic="tap" style={{ padding: SP['2'] }}>
          <BackIcon size={24} color={C.text} strokeWidth={2.2} />
        </PressableScale>
        <Text style={[T.h4, { color: C.text, flex: 1, marginLeft: SP['3'] }]}>スレッドを作成</Text>
        {/* Submit — GRAD.primary (紫→桃→…) で 「ここを押せ」感を強める.
            disabled (空 / 文字数超過 / community 未選択 / 送信中) は grey 表示で
            「押せない」ことを 1 秒で伝える. loading 中は spinner inline. */}
        <PressableScale
          onPress={handleSubmit}
          disabled={!canSubmit}
          haptic="confirm"
          accessibilityLabel="スレッドを作成"
          accessibilityState={{ disabled: !canSubmit, busy: isPending }}
          style={{
            height: 36,
            paddingHorizontal: SP['4'],
            borderRadius: R.full,
            overflow: 'hidden',
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'row',
            gap: SP['2'],
            backgroundColor: canSubmit ? 'transparent' : C.bg4,
            ...(canSubmit ? SHADOW.glow : null),
          }}
        >
          {canSubmit && (
            <LinearGradient
              colors={[...GRAD.primary]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}
            />
          )}
          {isPending ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={[T.buttonSm, { color: canSubmit ? '#fff' : C.text3 }]}>
              作成
            </Text>
          )}
        </PressableScale>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: SP['5'], gap: SP['5'], paddingBottom: insets.bottom + SP['10'] }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ gap: SP['2'] }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: SP['1'] }}>
            <Text style={[T.smallB, { color: C.text2 }]}>タイトル</Text>
            <Text style={[T.caption, { color: C.red }]}>*</Text>
          </View>
          <Text style={[T.caption, { color: C.text3 }]}>
            何の話か一目で分かる短いタイトルを
          </Text>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="例: 鬼滅 無限城編 ネタバレ感想"
            placeholderTextColor={C.text3}
            // maxLength は hard cap. validation 側 (TITLE_MAX) は trim 後の長さで判定する
            maxLength={TITLE_MAX + 20}
            autoFocus
            keyboardAppearance="dark"
            selectionColor={C.accent}
            style={[
              T.body,
              {
                color: C.text,
                backgroundColor: C.bg3,
                borderRadius: R.md,
                paddingHorizontal: SP['4'],
                paddingVertical: SP['3'],
                borderWidth: 1.5,
                borderColor: titleTooLong ? C.red : titleLen >= TITLE_WARN_AT ? C.amber : C.border,
              },
            ]}
          />
          {/* 残文字数 chip — 警告色は 70 文字以降 amber, 80 文字超で red */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
            <View
              style={{
                paddingHorizontal: SP['2'], paddingVertical: 2,
                borderRadius: R.full,
                backgroundColor: titleTooLong ? C.redBg : titleLen >= TITLE_WARN_AT ? C.amberBg : C.bg3,
                borderWidth: 1,
                borderColor: titleTooLong ? C.red : titleLen >= TITLE_WARN_AT ? C.amber : C.border,
              }}
            >
              <Text
                style={[
                  T.caption,
                  {
                    color: titleTooLong ? C.red : titleLen >= TITLE_WARN_AT ? C.amber : C.text3,
                    fontVariant: ['tabular-nums'],
                  },
                ]}
              >
                {titleLen} / {TITLE_MAX}
              </Text>
            </View>
            {titleTooShort && (
              <Text style={[T.caption, { color: C.amber }]}>
                あと{TITLE_MIN - titleLen}文字以上必要です
              </Text>
            )}
            {titleTooLong && (
              <Text style={[T.caption, { color: C.red }]}>
                {titleLen - TITLE_MAX}文字オーバー
              </Text>
            )}
          </View>
        </View>

        <View style={{ gap: SP['2'] }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: SP['1'] }}>
            <Text style={[T.smallB, { color: C.text2 }]}>カテゴリ</Text>
            <Text style={[T.caption, { color: C.text3 }]}>(任意)</Text>
            <View style={{ flex: 1 }} />
            {!!category && (
              <PressableScale
                onPress={() => setCategory('')}
                haptic="tap"
                hitSlop={6}
                accessibilityLabel="カテゴリ解除"
              >
                <Text style={[T.caption, { color: C.text3 }]}>解除</Text>
              </PressableScale>
            )}
          </View>
          <Text style={[T.caption, { color: C.text3 }]}>
            プリセットから 1 つ選んでください。未選択時は「雑談」として投稿されます。
          </Text>
          {/* カテゴリ chip grid — 選択中はそのカテゴリ色で fill, 未選択は outline.
              色は (tabs)/bbs.tsx の CATEGORY_COLORS と完全に同じ. */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SP['2'], marginTop: 4 }}>
            {CATEGORIES.map((c) => {
              const active = category === c;
              const color = CATEGORY_COLORS[c] ?? C.accent;
              return (
                <PressableScale
                  key={c}
                  onPress={() => setCategory(active ? '' : c)}
                  haptic="select"
                  hitSlop={6}
                  accessibilityLabel={`カテゴリ ${c}${active ? ' (選択中)' : ''}`}
                  style={{
                    paddingHorizontal: SP['3'],
                    paddingVertical: 7,
                    borderRadius: R.full,
                    backgroundColor: active ? color : 'transparent',
                    borderWidth: 1.5,
                    borderColor: active ? color : C.border2,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 4,
                    ...(active ? SHADOW.xs : null),
                  }}
                >
                  {/* 未選択時は色 dot で「このカテゴリの色」をプレビュー */}
                  {!active && (
                    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }} />
                  )}
                  <Text
                    style={[
                      T.smallM,
                      { color: active ? '#fff' : C.text2, fontSize: 12, lineHeight: 16 },
                    ]}
                  >
                    {c}
                  </Text>
                </PressableScale>
              );
            })}
          </View>
        </View>

        {/* 公開設定 */}
        <View style={{ gap: SP['2'] }}>
          <Text style={[T.smallB, { color: C.text2 }]}>公開設定</Text>
          <Text style={[T.caption, { color: C.text3 }]}>
            だれが見られるスレッドかを選ぶ
          </Text>
          <View style={{ flexDirection: 'row', gap: SP['2'], marginTop: SP['1'] }}>
            <PressableScale
              onPress={() => {
                setVisibility('public');
                // public に戻したら attach は維持 (オプションとして残す)
              }}
              haptic="select"
              style={{
                flex: 1,
                paddingHorizontal: SP['3'], paddingVertical: SP['3'],
                borderRadius: R.md,
                backgroundColor: visibility === 'public' ? C.accentBg : C.bg3,
                borderWidth: 1.5,
                borderColor: visibility === 'public' ? C.accent : C.border,
                alignItems: 'center', gap: 2,
              }}
            >
              <Text style={[T.smallM, { color: visibility === 'public' ? C.accentLight : C.text }]}>
                🌐 一般公開
              </Text>
              <Text style={[T.caption, { color: C.text3, textAlign: 'center' }]}>
                全員が見える / 掲示板リストにも出る
              </Text>
            </PressableScale>
            <PressableScale
              onPress={() => {
                setVisibility('community_only');
                setAttachToCommunity(true);
              }}
              haptic="select"
              style={{
                flex: 1,
                paddingHorizontal: SP['3'], paddingVertical: SP['3'],
                borderRadius: R.md,
                backgroundColor: visibility === 'community_only' ? C.accentBg : C.bg3,
                borderWidth: 1.5,
                borderColor: visibility === 'community_only' ? C.accent : C.border,
                alignItems: 'center', gap: 2,
              }}
            >
              <Text style={[T.smallM, { color: visibility === 'community_only' ? C.accentLight : C.text }]}>
                🔒 コミュニティ限定
              </Text>
              <Text style={[T.caption, { color: C.text3, textAlign: 'center' }]}>
                選んだコミュニティのメンバーだけ閲覧可
              </Text>
            </PressableScale>
          </View>
        </View>

        {/* コミュニティ紐付け (public 時は optional チェック、community_only 時は必須) */}
        <View style={{ gap: SP['2'] }}>
          {visibility === 'public' ? (
            <PressableScale
              onPress={() => setAttachToCommunity((v) => !v)}
              haptic="select"
              style={{
                flexDirection: 'row', alignItems: 'center', gap: SP['2'],
                paddingHorizontal: SP['3'], paddingVertical: SP['3'],
                borderRadius: R.md,
                backgroundColor: attachToCommunity ? C.accentBg : C.bg3,
                borderWidth: 1, borderColor: attachToCommunity ? C.accentSoft : C.border,
              }}
            >
              <View style={{
                width: 18, height: 18, borderRadius: 4,
                borderWidth: 1.5,
                borderColor: attachToCommunity ? C.accent : C.border2,
                backgroundColor: attachToCommunity ? C.accent : 'transparent',
                alignItems: 'center', justifyContent: 'center',
              }}>
                {attachToCommunity && (
                  <Text style={{ color: '#fff', fontSize: 11, fontWeight: '900' }}>✓</Text>
                )}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[T.smallM, { color: C.text }]}>コミュニティに紐付ける</Text>
                <Text style={[T.caption, { color: C.text3 }]}>
                  掲示板リストとコミュニティ内の両方に表示されます
                </Text>
              </View>
            </PressableScale>
          ) : (
            <View style={{
              paddingHorizontal: SP['3'], paddingVertical: SP['2'],
              borderRadius: R.md,
              backgroundColor: C.accentBg,
              borderWidth: 1, borderColor: C.accentSoft,
            }}>
              <Text style={[T.caption, { color: C.accentLight }]}>
                コミュニティを選択してください (必須)
              </Text>
            </View>
          )}

          {showCommunityPicker && (
            <Animated.View
              entering={FadeInDown.duration(200)}
              layout={Layout.springify().damping(20)}
              style={{ gap: SP['2'] }}
            >
              <View style={{
                flexDirection: 'row', alignItems: 'center', gap: SP['2'],
                paddingHorizontal: SP['3'], paddingVertical: SP['2'],
                backgroundColor: C.bg3,
                borderRadius: R.full,
                borderWidth: 1, borderColor: C.border,
              }}>
                <Icon.search size={16} color={C.text3} strokeWidth={2.2} />
                <TextInput
                  value={communityQuery}
                  onChangeText={setCommunityQuery}
                  placeholder="コミュニティを検索"
                  placeholderTextColor={C.text3}
                  keyboardAppearance="dark"
                  selectionColor={C.accent}
                  autoCorrect={false}
                  autoCapitalize="none"
                  // memory DoS 対策: search query は 200 文字 cap
                  maxLength={200}
                  style={[T.body, { flex: 1, color: C.text, paddingVertical: 0 }]}
                />
                {communityQuery.length > 0 && (
                  <PressableScale onPress={() => setCommunityQuery('')} haptic="tap">
                    <Icon.close size={14} color={C.text3} strokeWidth={2.2} />
                  </PressableScale>
                )}
              </View>

              <View style={{ gap: 6 }}>
                {communitiesQ.isLoading && displayCommunities.length === 0 ? (
                  <Text style={[T.caption, { color: C.text3, paddingHorizontal: SP['2'] }]}>
                    読み込み中…
                  </Text>
                ) : displayCommunities.length === 0 ? (
                  <Text style={[T.caption, { color: C.text3, paddingHorizontal: SP['2'] }]}>
                    一致するコミュニティがありません
                  </Text>
                ) : (
                  displayCommunities.map((c) => {
                    const selected = c.id === selectedCommunityId;
                    return (
                      <PressableScale
                        key={c.id}
                        onPress={() => {
                          if (selected) {
                            // 同じものをタップ → 解除 (community_only 時は何もしない — 必須)
                            if (visibility === 'community_only') return;
                            setSelectedCommunityId(null);
                          } else {
                            setSelectedCommunityId(c.id);
                          }
                        }}
                        haptic="select"
                        style={{
                          flexDirection: 'row', alignItems: 'center', gap: SP['3'],
                          paddingHorizontal: SP['3'], paddingVertical: SP['2'],
                          borderRadius: R.md,
                          backgroundColor: selected ? C.accentBg : C.bg3,
                          borderWidth: 1.5,
                          borderColor: selected ? C.accent : C.border,
                        }}
                      >
                        <View style={{
                          width: 32, height: 32, borderRadius: 8,
                          backgroundColor: c.icon_color || C.bg4,
                          alignItems: 'center', justifyContent: 'center',
                        }}>
                          <Text style={{ fontSize: 18 }}>{c.icon_emoji || '🏠'}</Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={[T.smallM, { color: C.text }]} numberOfLines={1}>
                            {c.name}
                          </Text>
                          <Text style={[T.caption, { color: C.text3 }]}>
                            {c.member_count.toLocaleString('ja-JP')}人のメンバー
                          </Text>
                        </View>
                        {selected && (
                          <View style={{
                            width: 20, height: 20, borderRadius: 10,
                            backgroundColor: C.accent,
                            alignItems: 'center', justifyContent: 'center',
                          }}>
                            <Text style={{ color: '#fff', fontSize: 12, fontWeight: '900' }}>✓</Text>
                          </View>
                        )}
                      </PressableScale>
                    );
                  })
                )}
              </View>
            </Animated.View>
          )}
        </View>

        {/* プレビュー — 入力中の見た目を card で常時 (タイトルが 1 字以上で出現).
            一覧画面のスレッド行と同じ trim を意識した layout で違和感を減らす. */}
        {titleLen > 0 && !titleTooLong && (
          <Animated.View
            entering={FadeIn.duration(180)}
            layout={Layout.springify().damping(22)}
            style={{ gap: SP['2'] }}
          >
            <Text style={[T.caption, { color: C.text3 }]}>プレビュー</Text>
            <View
              style={{
                flexDirection: 'row',
                gap: SP['3'],
                paddingHorizontal: SP['3'],
                paddingVertical: SP['3'],
                borderRadius: R.lg,
                backgroundColor: 'rgba(255,255,255,0.04)',
                borderWidth: 1,
                borderColor: 'rgba(255,255,255,0.08)',
                ...SHADOW.xs,
              }}
            >
              {/* category 色の縦バー — 一覧画面の chip 色と揃える */}
              <View
                style={{
                  width: 3,
                  borderRadius: 2,
                  backgroundColor: category ? (CATEGORY_COLORS[category] ?? C.accent) : C.border2,
                }}
              />
              <View style={{ flex: 1, gap: 6 }}>
                {!!category && (
                  <View
                    style={{
                      alignSelf: 'flex-start',
                      paddingHorizontal: SP['2'],
                      paddingVertical: 2,
                      borderRadius: R.full,
                      backgroundColor: `${CATEGORY_COLORS[category] ?? C.accent}22`,
                      borderWidth: 1,
                      borderColor: CATEGORY_COLORS[category] ?? C.accent,
                    }}
                  >
                    <Text
                      style={[
                        T.caption,
                        { color: CATEGORY_COLORS[category] ?? C.accent, fontSize: 10 },
                      ]}
                    >
                      {category}
                    </Text>
                  </View>
                )}
                <Text style={[T.bodyB, { color: C.text }]} numberOfLines={2}>
                  {trimmedTitle}
                </Text>
                <Text style={[T.caption, { color: C.text3 }]}>
                  {visibility === 'community_only' ? '🔒 コミュニティ限定' : '🌐 一般公開'}
                  {selectedCommunityId && selectedCommunityQ.data
                    ? ` ・ ${selectedCommunityQ.data.name}`
                    : ''}
                </Text>
              </View>
            </View>
          </Animated.View>
        )}

        {error ? (
          <Animated.View entering={FadeIn.duration(150)} style={{ backgroundColor: C.redBg, borderRadius: R.md, padding: SP['3'], flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
            <Icon.warn size={14} color={C.red} strokeWidth={2.4} />
            <Text style={[T.small, { color: C.red, flex: 1 }]}>{error}</Text>
          </Animated.View>
        ) : null}

        <Text style={[T.caption, { color: C.text3, textAlign: 'center', marginTop: SP['2'] }]}>
          匿名で投稿されます · 個人情報は書かない
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
