import { useEffect, useMemo } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useTagFilterStore } from '@/stores/tagFilterStore';
import { useTagGraphStore, type TagNode } from '@/stores/tagGraphStore';
import { useAuthStore } from '@/stores/authStore';
import { PressableScale } from '@/components/ui/PressableScale';
import { EmptyState } from '@/components/ui/EmptyState';
import { TopBar } from '@/components/nav/TopBar';
import { C, R, SP, GRAD } from '@/design/tokens';
import { T } from '@/design/typography';
import { TABBAR } from '@/design/tabbar';
import { Icon } from '@/constants/icons';

export default function OshiScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { likedTags } = useTagFilterStore();
  const { nodes, rootIds, hydrate: hydrateGraph } = useTagGraphStore();
  const { user } = useAuthStore();

  useEffect(() => { void hydrateGraph(); }, [hydrateGraph]);

  const accountAge = user?.created_at
    ? Math.floor((Date.now() - new Date(user.created_at).getTime()) / (1000 * 60 * 60 * 24))
    : 0;

  // 各タグがどのタググラフルートに属するか算出
  // alias もキーとして扱う + related (関連タグ) も収集
  const groupedLiked = useMemo(() => {
    const likedSet = new Set(likedTags);
    type Group = {
      rootId: string;
      rootLabel: string;
      tags: string[];
      aliasOf: Record<string, string>;
      relatedSuggestions: { tag: string; via: string }[]; // 未likeで紐付くタグ
    };
    const groups: Group[] = [];
    const usedTags = new Set<string>();

    for (const rootId of rootIds) {
      const root = nodes[rootId];
      if (!root) continue;
      const found: string[] = [];
      const aliasOf: Record<string, string> = {};
      const relatedSet = new Set<string>(); // 重複排除
      const relatedSuggestions: { tag: string; via: string }[] = [];
      let hasLiked = false;
      const visit = (id: string) => {
        const n = nodes[id];
        if (!n) return;
        const nodeIsLiked = likedSet.has(n.label);
        if (nodeIsLiked && !usedTags.has(n.label)) {
          found.push(n.label);
          usedTags.add(n.label);
          hasLiked = true;
        }
        for (const a of n.aliases) {
          if (likedSet.has(a) && !usedTags.has(a)) {
            found.push(a);
            usedTags.add(a);
            aliasOf[a] = n.label;
            hasLiked = true;
          }
        }
        // related: liked じゃないものを suggestion として収集
        const nodeLiked = nodeIsLiked || n.aliases.some((a) => likedSet.has(a));
        if (nodeLiked) {
          for (const r of n.related ?? []) {
            if (!likedSet.has(r) && !relatedSet.has(r)) {
              relatedSet.add(r);
              relatedSuggestions.push({ tag: r, via: n.label });
            }
          }
        }
        for (const c of n.children) visit(c);
      };
      visit(rootId);
      if (hasLiked) {
        groups.push({ rootId, rootLabel: root.label, tags: found, aliasOf, relatedSuggestions });
      }
    }

    const ungrouped = likedTags.filter((t) => !usedTags.has(t));
    return { groups, ungrouped };
  }, [likedTags, rootIds, nodes]);

  const hasGroupedTags = groupedLiked.groups.length > 0;
  const { addLiked } = useTagFilterStore();

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <TopBar title="推し活" large />
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: SP['4'],
          paddingBottom: TABBAR.height + insets.bottom + SP['10'],
          gap: SP['4'],
        }}
      >
        {/* 推し活継続日数カード */}
        <LinearGradient
          colors={[...GRAD.accent]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{
            borderRadius: R.xl,
            padding: SP['5'],
            gap: SP['2'],
          }}
        >
          <Text style={[T.small, { color: '#ffffffcc', letterSpacing: 0.5 }]}>推し活</Text>
          <Text style={{ fontSize: 64, fontWeight: '800', color: '#fff', letterSpacing: -2 }}>
            {accountAge}<Text style={{ fontSize: 22, fontWeight: '600' }}> 日</Text>
          </Text>
        </LinearGradient>

        {/* 推しタグ一覧 */}
        <View style={{
          padding: SP['4'],
          backgroundColor: C.bg2,
          borderRadius: R.lg,
          borderWidth: 1,
          borderColor: C.border,
          gap: SP['3'],
        }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={[T.smallM, { color: C.text3, letterSpacing: 0.5 }]}>推し</Text>
            <View style={{ flexDirection: 'row', gap: SP['3'] }}>
              <PressableScale onPress={() => router.push('/oshi/tag-graph' as never)} haptic="tap">
                <Text style={[T.smallM, { color: '#22D3A4' }]}>連携</Text>
              </PressableScale>
              <PressableScale onPress={() => router.push('/filter' as never)} haptic="tap">
                <Text style={[T.smallM, { color: C.accent }]}>編集</Text>
              </PressableScale>
            </View>
          </View>
          {likedTags.length === 0 ? (
            <EmptyState
              icon={Icon.heart}
              title="まだ推しがありません"
              message="好きなタグを登録して、推し活を始めよう"
              actionLabel="推しを登録"
              onAction={() => router.push('/filter' as never)}
            />
          ) : hasGroupedTags ? (
            <View style={{ gap: SP['3'] }}>
              {/* グループ化されたタグ */}
              {groupedLiked.groups.map((g) => (
                <View
                  key={g.rootId}
                  style={{
                    padding: SP['3'],
                    backgroundColor: C.bg3,
                    borderRadius: R.md,
                    borderWidth: 1,
                    borderColor: C.accentSoft,
                    gap: SP['2'],
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={[T.smallM, { color: C.accentLight, fontWeight: '700', flex: 1 }]}>
                      {g.rootLabel}
                    </Text>
                    <Text style={[T.caption, { color: C.text3 }]}>{g.tags.length}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                    {g.tags.map((t) => {
                      const aliasOf = g.aliasOf[t];
                      return (
                        <PressableScale
                          key={t}
                          onPress={() => router.push(`/tag/${encodeURIComponent(t)}` as never)}
                          haptic="select"
                          style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            gap: 3,
                            paddingHorizontal: SP['3'],
                            paddingVertical: 6,
                            backgroundColor: aliasOf ? C.bg2 : C.accentBg,
                            borderRadius: R.full,
                            borderWidth: 1,
                            borderColor: aliasOf ? C.border : C.accentSoft,
                          }}
                        >
                          <Text style={[T.caption, { color: aliasOf ? C.text2 : C.accentLight }]}>
                            #{t}
                          </Text>
                          {aliasOf && (
                            <Text style={{ fontSize: 9, color: C.text3 }}>
                              ≡{aliasOf}
                            </Text>
                          )}
                        </PressableScale>
                      );
                    })}
                  </View>

                  {/* 関連タグサジェスト */}
                  {g.relatedSuggestions.length > 0 && (
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 }}>
                      {g.relatedSuggestions.map((s) => (
                        <PressableScale
                          key={s.tag}
                          onPress={() => addLiked(s.tag)}
                          haptic="confirm"
                          style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            gap: 3,
                            paddingHorizontal: SP['3'],
                            paddingVertical: 6,
                            backgroundColor: 'rgba(124,177,255,0.10)',
                            borderRadius: R.full,
                            borderWidth: 1,
                            borderColor: 'rgba(124,177,255,0.3)',
                            borderStyle: 'dashed',
                          }}
                        >
                          <Text style={{ fontSize: 10, color: '#7CB1FF' }}>＋</Text>
                          <Text style={[T.caption, { color: '#7CB1FF' }]}>{s.tag}</Text>
                        </PressableScale>
                      ))}
                    </View>
                  )}
                </View>
              ))}

              {/* 未分類 */}
              {groupedLiked.ungrouped.length > 0 && (
                <View
                  style={{
                    padding: SP['3'],
                    backgroundColor: C.bg3,
                    borderRadius: R.md,
                    borderWidth: 1,
                    borderColor: C.border,
                    gap: SP['2'],
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={{ fontSize: 14 }}>📌</Text>
                    <Text style={[T.smallM, { color: C.text2, fontWeight: '700', flex: 1 }]}>未分類</Text>
                    <Text style={[T.caption, { color: C.text3 }]}>{groupedLiked.ungrouped.length}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                    {groupedLiked.ungrouped.map((t) => (
                      <PressableScale
                        key={t}
                        onPress={() => router.push(`/tag/${encodeURIComponent(t)}` as never)}
                        haptic="select"
                        style={{
                          paddingHorizontal: SP['3'],
                          paddingVertical: 6,
                          backgroundColor: C.accentBg,
                          borderRadius: R.full,
                          borderWidth: 1,
                          borderColor: C.accentSoft,
                        }}
                      >
                        <Text style={[T.caption, { color: C.accentLight }]}>#{t}</Text>
                      </PressableScale>
                    ))}
                  </View>
                  <PressableScale
                    onPress={() => router.push('/oshi/tag-graph' as never)}
                    haptic="tap"
                    style={{ alignSelf: 'flex-start' }}
                  >
                    <Text style={[T.caption, { color: '#22D3A4', fontWeight: '600' }]}>
                      ＋ タグ連携でグループ化する
                    </Text>
                  </PressableScale>
                </View>
              )}
            </View>
          ) : (
            // 連携なし → 従来表示 + 連携誘導
            <View style={{ gap: SP['3'] }}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SP['2'] }}>
                {likedTags.map((t) => (
                  <PressableScale
                    key={t}
                    onPress={() => router.push(`/tag/${encodeURIComponent(t)}` as never)}
                    haptic="select"
                    style={{
                      paddingHorizontal: SP['4'],
                      paddingVertical: SP['3'],
                      backgroundColor: C.accentBg,
                      borderRadius: R.lg,
                      borderWidth: 1,
                      borderColor: C.accentSoft,
                      minWidth: 100,
                    }}
                  >
                    <Text style={[T.bodyMd, { color: C.accentLight }]}>#{t}</Text>
                  </PressableScale>
                ))}
              </View>
              <PressableScale
                onPress={() => router.push('/oshi/tag-graph' as never)}
                haptic="tap"
                style={{
                  padding: SP['3'],
                  backgroundColor: '#22D3A422',
                  borderWidth: 1,
                  borderColor: '#22D3A455',
                  borderRadius: R.md,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: SP['2'],
                }}
              >
                <Text style={{ fontSize: 16 }}>🔗</Text>
                <View style={{ flex: 1 }}>
                  <Text style={[T.smallM, { color: '#22D3A4', fontWeight: '700' }]}>
                    タグを連携・グループ化する
                  </Text>
                  <Text style={[T.caption, { color: C.text2 }]}>
                    同義タグ (=LOVE と イコラブ等) を1つにまとめたり、グループ化できます
                  </Text>
                </View>
                <Icon.chevronR size={16} color="#22D3A4" strokeWidth={2.2} />
              </PressableScale>
            </View>
          )}
        </View>

        {/* クイックアクセス */}
        <View style={{ gap: SP['2'] }}>
          <QuickItem
            icon={Icon.hash}
            title="タグ連携"
            sub="同義タグ・グループ化・ツリー管理"
            onPress={() => router.push('/oshi/tag-graph' as never)}
            color="#22D3A4"
          />
          <QuickItem
            icon={Icon.calendar}
            title="カレンダー"
            sub="推しのイベントを一覧"
            onPress={() => router.push('/corners/calendar' as never)}
            color={C.accent}
          />
          <QuickItem
            icon={Icon.map}
            title="聖地マップ"
            sub="推しの聖地・スポット"
            onPress={() => router.push('/corners/map' as never)}
            color={C.pink}
          />
        </View>
      </ScrollView>
    </View>
  );
}

function QuickItem({
  icon: I,
  title,
  sub,
  onPress,
  color,
}: {
  icon: React.ComponentType<Record<string, unknown>>;
  title: string;
  sub: string;
  onPress: () => void;
  color: string;
}) {
  return (
    <PressableScale onPress={onPress} haptic="tap" style={{
      flexDirection: 'row',
      alignItems: 'center',
      padding: SP['4'],
      backgroundColor: C.bg2,
      borderRadius: R.lg,
      borderWidth: 1,
      borderColor: C.border,
      gap: SP['3'],
    }}>
      <View style={{
        width: 40, height: 40, borderRadius: 20,
        backgroundColor: color + '22',
        alignItems: 'center', justifyContent: 'center',
      }}>
        <I size={20} color={color} strokeWidth={2.2} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[T.bodyMd, { color: C.text }]}>{title}</Text>
        <Text style={[T.caption, { color: C.text3 }]}>{sub}</Text>
      </View>
      <Icon.chevronR size={18} color={C.text3} strokeWidth={2.2} />
    </PressableScale>
  );
}
