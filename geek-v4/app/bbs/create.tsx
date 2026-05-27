import { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import Animated, { FadeIn, FadeInDown, Layout } from 'react-native-reanimated';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createThread } from '../../lib/api/bbs';
import { discoverCommunities, type Community } from '../../lib/api/communities';
import type { ThreadVisibility } from '../../types/models';
import { C, SP, R } from '../../design/tokens';
import { T } from '../../design/typography';
import { Button } from '../../components/ui/Button';
import { PressableScale } from '../../components/ui/PressableScale';
import { Icon } from '../../constants/icons';
import { notify, Haptics } from '../../lib/haptics';
import { useToastStore } from '../../stores/toastStore';

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
      createThread(title.trim(), category.trim() || '雑談', {
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

  const handleSubmit = async () => {
    setError('');
    if (!title.trim()) {
      setError('スレッドのタイトルを入力してください。');
      return;
    }
    if (title.trim().length > 50) {
      setError('タイトルは50文字以内で入力してください。');
      return;
    }
    if (visibility === 'community_only' && !selectedCommunityId) {
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
        <Button
          label="投稿"
          onPress={handleSubmit}
          loading={isPending}
          disabled={
            !title.trim()
            || title.trim().length > 50
            || (visibility === 'community_only' && !selectedCommunityId)
            || isPending
          }
          size="sm"
        />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: SP['5'], gap: SP['5'], paddingBottom: insets.bottom + SP['10'] }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ gap: SP['2'] }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: SP['1'] }}>
            <Text style={[T.smallB, { color: C.text2 }]}>タイトル</Text>
            <Text style={[T.caption, { color: C.red }]}>*</Text>
            <View style={{ flex: 1 }} />
            <Text style={[T.caption, { color: title.length > 50 ? C.red : C.text3 }]}>
              {title.length} / 50
            </Text>
          </View>
          <Text style={[T.caption, { color: C.text3 }]}>
            何の話か一目で分かる短いタイトルを
          </Text>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="例: 鬼滅 無限城編 ネタバレ感想"
            placeholderTextColor={C.text3}
            maxLength={60}
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
                borderColor: title.length > 50 ? C.red : C.border,
              },
            ]}
          />
        </View>

        <View style={{ gap: SP['2'] }}>
          <Text style={[T.smallB, { color: C.text2 }]}>カテゴリ（任意）</Text>
          <Text style={[T.caption, { color: C.text3 }]}>
            プリセットから選ぶ、または自由入力
          </Text>
          <TextInput
            value={category}
            onChangeText={setCategory}
            placeholder="例: アニメ、ゲーム、雑談..."
            placeholderTextColor={C.text3}
            keyboardAppearance="dark"
            selectionColor={C.accent}
            // memory DoS 対策: short tag/category 用に 40 文字 cap
            maxLength={40}
            style={[
              T.body,
              {
                color: C.text,
                backgroundColor: C.bg3,
                borderRadius: R.md,
                paddingHorizontal: SP['4'],
                paddingVertical: SP['3'],
                borderWidth: 1.5,
                borderColor: C.border,
              },
            ]}
          />
          {/* カテゴリプリセット */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
            {['雑談', 'アニメ', 'ゲーム', 'マンガ', '音楽', 'アイドル', 'Vtuber', '推し活', 'グルメ', 'コスプレ', 'ニュース'].map((c) => {
              const active = category === c;
              return (
                <PressableScale
                  key={c}
                  onPress={() => setCategory(c)}
                  haptic="select"
                  style={{
                    paddingHorizontal: SP['3'], paddingVertical: 6,
                    backgroundColor: active ? C.accent : C.bg3,
                    borderRadius: R.full,
                    borderWidth: 1, borderColor: active ? C.accent : C.border,
                  }}
                >
                  <Text style={{ fontSize: 12, color: active ? '#fff' : C.text2, fontWeight: '600' }}>
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
