import { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, TextInput, Modal } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TopBar } from '../../components/nav/TopBar';
import { BackButton } from '../../components/nav/BackButton';
import { PressableScale } from '../../components/ui/PressableScale';
import { StatBadge } from '../../components/ui/StatBadge';
import { EmptyState } from '../../components/ui/EmptyState';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { SuggestedClusters } from '../../components/tag-graph/SuggestedClusters';
import { useTagClusterSuggestions } from '../../hooks/useTagClusterSuggestions';
import { useTagGraphStore, type TagNode, TEMPLATES } from '../../stores/tagGraphStore';
import { useTagFilterStore } from '../../stores/tagFilterStore';
import { useTagCooccurStore } from '../../stores/tagCooccurStore';
import { useToastStore } from '../../stores/toastStore';
import { findRelatedTags } from '../../lib/search/tagVector';
import { normalize } from '../../lib/search/tokenize';
import { Icon } from '../../constants/icons';
import { C, R, SP } from '../../design/tokens';
import { T } from '../../design/typography';

type ActionTarget =
  | { kind: 'add-root' }
  | { kind: 'add-child'; parentId: string; parentLabel: string }
  | { kind: 'add-alias'; nodeId: string; nodeLabel: string }
  | { kind: 'add-related'; nodeId: string; nodeLabel: string }
  | { kind: 'rename'; nodeId: string; current: string };

type ConfirmTarget =
  | { kind: 'remove-node'; nodeId: string; nodeLabel: string; childCount: number }
  | { kind: 'remove-alias'; nodeId: string; alias: string; nodeLabel: string }
  | { kind: 'remove-related'; nodeId: string; related: string; nodeLabel: string };

type MoveTarget = { nodeId: string; nodeLabel: string };

export default function TagGraphScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const {
    nodes, rootIds, hydrated, hydrate,
    addNode, removeNode, renameNode,
    addAliases, removeAlias,
    addRelatedMulti, removeRelated,
    moveNode, moveRoot, importLikedTags, applyTemplate,
  } = useTagGraphStore();
  const [action, setAction] = useState<ActionTarget | null>(null);
  const [confirm, setConfirm] = useState<ConfirmTarget | null>(null);
  const [moveTarget, setMoveTarget] = useState<MoveTarget | null>(null);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [input, setInput] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');

  const { likedTags, addLiked } = useTagFilterStore();
  const { cooccur, tagPopularity, ensureFresh: ensureCooccur, loading: cooccurLoading, hydrate: hydrateCooccur } = useTagCooccurStore();
  const { show } = useToastStore();
  const likedSet = useMemo(() => new Set(likedTags), [likedTags]);

  // タグ自動グルーピング候補 (共起 + 同義 で抽出)
  // ユーザーが「これらをまとめてグループ化」 ボタンで 1 タップ accept できる
  const clusterSuggestions = useTagClusterSuggestions({ maxClusters: 4 });

  useEffect(() => { void hydrateCooccur(); void ensureCooccur(); }, [hydrateCooccur, ensureCooccur]);

  // AI 連携提案: 全ノードに対し、ベクトル類似度の高い未連携タグを発見
  const aiSuggestions = useMemo(() => {
    const candidateSet = new Set<string>();
    // 候補プール: liked タグ + 共起マップに含まれるタグ + graph 内のタグ
    for (const t of likedTags) candidateSet.add(t);
    for (const t of Object.keys(tagPopularity)) candidateSet.add(t);
    for (const n of Object.values(nodes)) {
      candidateSet.add(n.label);
      for (const a of n.aliases) candidateSet.add(a);
      for (const r of n.related ?? []) candidateSet.add(r);
    }
    const candidates = [...candidateSet];

    // 各ルートノードに対して提案 (最大3件)
    const out: { nodeId: string; nodeLabel: string; suggestions: { tag: string; score: number; signals: string[] }[] }[] = [];
    for (const rid of rootIds) {
      const n = nodes[rid];
      if (!n) continue;
      const existing = new Set<string>([
        normalize(n.label),
        ...n.aliases.map(normalize),
        ...(n.related ?? []).map(normalize),
        ...n.children.map((c) => normalize(nodes[c]?.label ?? '')),
      ]);
      const filtered = candidates.filter((c) => !existing.has(normalize(c)));
      const top = findRelatedTags(n.label, filtered, { nodes, cooccur }, { topK: 3, minScore: 0.25 });
      if (top.length > 0) {
        out.push({ nodeId: rid, nodeLabel: n.label, suggestions: top });
      }
    }
    return out.slice(0, 8); // 表示上位 8 ルート
  }, [rootIds, nodes, likedTags, tagPopularity, cooccur]);

  // 移動先候補 (自身と子孫を除く)
  const moveCandidates = useMemo(() => {
    if (!moveTarget) return { roots: [] as string[], all: [] as { id: string; label: string; depth: number }[] };
    const excluded = new Set<string>([moveTarget.nodeId]);
    const collectDescendants = (id: string) => {
      excluded.add(id);
      const n = nodes[id];
      if (n) for (const c of n.children) collectDescendants(c);
    };
    collectDescendants(moveTarget.nodeId);
    const all: { id: string; label: string; depth: number }[] = [];
    const walk = (id: string, depth: number) => {
      if (excluded.has(id)) return;
      const n = nodes[id];
      if (!n) return;
      all.push({ id, label: n.label, depth });
      for (const c of n.children) walk(c, depth + 1);
    };
    for (const r of rootIds) walk(r, 0);
    return { all };
  }, [moveTarget, nodes, rootIds]);

  // 全ノードの名前/別名/関連を含む検索インデックス
  const filteredRootIds = useMemo(() => {
    if (!search.trim()) return rootIds;
    const q = search.trim().toLowerCase();
    const matches = (id: string): boolean => {
      const n = nodes[id];
      if (!n) return false;
      if (n.label.toLowerCase().includes(q)) return true;
      if (n.aliases.some((a) => a.toLowerCase().includes(q))) return true;
      if ((n.related ?? []).some((r) => r.toLowerCase().includes(q))) return true;
      return n.children.some((c) => matches(c));
    };
    return rootIds.filter(matches);
  }, [rootIds, nodes, search]);

  // ノード数 / 別名数 / 関連数
  const stats = useMemo(() => {
    const ids = Object.keys(nodes);
    const aliasTotal = ids.reduce((sum, id) => sum + (nodes[id]?.aliases.length ?? 0), 0);
    const relatedTotal = ids.reduce((sum, id) => sum + (nodes[id]?.related?.length ?? 0), 0);
    const leafCount = ids.filter((id) => nodes[id]?.children.length === 0).length;
    const groupCount = ids.length - leafCount;
    return { total: ids.length, aliasTotal, relatedTotal, leafCount, groupCount };
  }, [nodes]);

  useEffect(() => { void hydrate(); }, [hydrate]);

  const toggleExpand = (id: string) => {
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  const submitAction = () => {
    const value = input.trim();
    if (!value || !action) {
      setAction(null);
      setInput('');
      return;
    }
    if (action.kind === 'add-root') {
      // カンマ区切りで複数追加
      const parts = value.split(/[,、]/).map((p) => p.trim()).filter(Boolean);
      const ids = parts.map((p) => addNode(p, null));
      setExpanded((s) => {
        const next = new Set(s);
        ids.forEach((id) => next.add(id));
        return next;
      });
    } else if (action.kind === 'add-child') {
      const parts = value.split(/[,、]/).map((p) => p.trim()).filter(Boolean);
      const ids = parts.map((p) => addNode(p, action.parentId));
      setExpanded((s) => {
        const next = new Set(s).add(action.parentId);
        ids.forEach((id) => next.add(id));
        return next;
      });
    } else if (action.kind === 'add-alias') {
      // カンマ区切りで複数追加
      const aliases = value.split(/[,、]/).map((p) => p.trim()).filter(Boolean);
      addAliases(action.nodeId, aliases);
    } else if (action.kind === 'add-related') {
      const items = value.split(/[,、]/).map((p) => p.trim()).filter(Boolean);
      addRelatedMulti(action.nodeId, items);
    } else if (action.kind === 'rename') {
      renameNode(action.nodeId, value);
    }
    setAction(null);
    setInput('');
  };

  const confirmDelete = () => {
    if (!confirm) return;
    if (confirm.kind === 'remove-node') {
      removeNode(confirm.nodeId);
    } else if (confirm.kind === 'remove-alias') {
      removeAlias(confirm.nodeId, confirm.alias);
    } else if (confirm.kind === 'remove-related') {
      removeRelated(confirm.nodeId, confirm.related);
    }
    setConfirm(null);
  };

  const addAllToLiked = (nodeId: string) => {
    const node = nodes[nodeId];
    if (!node) return;
    const collect = (id: string, acc: string[]) => {
      const n = nodes[id];
      if (!n) return;
      acc.push(n.label, ...n.aliases);
      n.children.forEach((c) => collect(c, acc));
    };
    const all: string[] = [];
    collect(nodeId, all);
    all.forEach((t) => addLiked(t));
    show(`${all.length}個のタグを好きに追加`, 'success');
  };

  const handleImport = () => {
    const count = importLikedTags(likedTags);
    if (count === 0) {
      show('追加できる新しいタグはありません', 'info');
    } else {
      show(`${count}個のタグをツリーに追加`, 'success');
    }
  };

  const handleMove = (newParentId: string | null) => {
    if (!moveTarget) return;
    moveNode(moveTarget.nodeId, newParentId);
    setMoveTarget(null);
    show('ノードを移動しました', 'success');
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <TopBar
        title="タグ連携"
        left={<BackButton />}
        right={
          <PressableScale
            onPress={() => { setAction({ kind: 'add-root' }); setInput(''); }}
            haptic="confirm"
            style={{
              flexDirection: 'row', alignItems: 'center', gap: 4,
              paddingHorizontal: SP['3'], paddingVertical: 6,
              backgroundColor: C.accent, borderRadius: R.full,
            }}
          >
            <Icon.plus size={16} color="#fff" strokeWidth={2.6} />
            <Text style={[T.smallM, { color: '#fff', fontWeight: '700' }]}>追加</Text>
          </PressableScale>
        }
      />

      {hydrated && rootIds.length === 0 ? (
        <ScrollView contentContainerStyle={{ padding: SP['4'], paddingTop: SP['6'], gap: SP['4'] }}>
          <View style={{
            padding: SP['4'],
            backgroundColor: C.accentBg,
            borderRadius: R.lg,
            borderWidth: 1,
            borderColor: C.accentSoft,
          }}>
            <Text style={[T.smallM, { color: C.accentLight, marginBottom: SP['2'] }]}>💡 使い方</Text>
            <Text style={[T.small, { color: C.text2, lineHeight: 19 }]}>
              ・「+ 追加」でルートを作成 (カンマ区切りで複数同時可){'\n'}
              ・各ノードに子グループ/タグを追加して木構造を作る{'\n'}
              ・別名 (例: =LOVE と イコラブ) を登録して同義タグを連携{'\n'}
              ・親グループでまとめれば、グループ全体のタグを一括検索可能に
            </Text>
          </View>

          {/* テンプレート選択 */}
          <View style={{
            padding: SP['4'],
            backgroundColor: C.bg2,
            borderRadius: R.lg,
            borderWidth: 1,
            borderColor: C.border,
            gap: SP['3'],
          }}>
            <View>
              <Text style={[T.h4, { color: C.text }]}>🚀 テンプレートで始める</Text>
              <Text style={[T.caption, { color: C.text3, marginTop: 2 }]}>
                既製のジャンル別ツリーをワンタップで導入
              </Text>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SP['2'] }}>
              {TEMPLATES.map((tpl) => (
                <PressableScale
                  key={tpl.id}
                  onPress={() => {
                    applyTemplate(tpl.data);
                    show(`「${tpl.name}」テンプレートを適用`, 'success');
                  }}
                  haptic="confirm"
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 6,
                    paddingHorizontal: SP['3'],
                    paddingVertical: SP['2'],
                    backgroundColor: C.accentBg,
                    borderRadius: R.full,
                    borderWidth: 1,
                    borderColor: C.accentSoft,
                  }}
                >
                  <Text style={{ fontSize: 14 }}>{tpl.emoji}</Text>
                  <Text style={[T.smallM, { color: C.accentLight, fontWeight: '700' }]}>{tpl.name}</Text>
                </PressableScale>
              ))}
            </View>
          </View>

          {/* 好きなタグの取り込み */}
          {likedTags.length > 0 && (
            <PressableScale
              onPress={handleImport}
              haptic="confirm"
              style={{
                padding: SP['4'],
                backgroundColor: '#22D3A422',
                borderWidth: 1,
                borderColor: '#22D3A455',
                borderRadius: R.lg,
                flexDirection: 'row',
                alignItems: 'center',
                gap: SP['3'],
              }}
            >
              <Text style={{ fontSize: 22 }}>❤️</Text>
              <View style={{ flex: 1 }}>
                <Text style={[T.bodyMd, { color: '#22D3A4', fontWeight: '700' }]}>
                  好きなタグ ({likedTags.length}) を取り込む
                </Text>
                <Text style={[T.caption, { color: C.text2 }]}>
                  全ての好きなタグをルートに一括追加
                </Text>
              </View>
              <Icon.chevronR size={18} color="#22D3A4" strokeWidth={2.2} />
            </PressableScale>
          )}

          <EmptyState
            icon={Icon.hash}
            title="または手動で作成"
            message="ボタンから空のノードを追加"
            actionLabel="ノードを追加"
            onAction={() => { setAction({ kind: 'add-root' }); setInput(''); }}
          />
        </ScrollView>
      ) : (
        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: SP['3'],
            paddingTop: SP['3'],
            paddingBottom: insets.bottom + SP['10'],
            gap: SP['2'],
          }}
        >
          {/* 統計バー */}
          {stats.total > 0 && (
            <View style={{
              flexDirection: 'row', flexWrap: 'wrap', gap: SP['2'],
              marginBottom: SP['1'],
              paddingHorizontal: SP['2'],
            }}>
              <StatBadge icon="📁" label={`${stats.groupCount}グループ`} color="#7C6AF7" />
              <StatBadge icon="#️⃣" label={`${stats.leafCount}タグ`} color="#22D3A4" />
              <StatBadge icon="≡" label={`${stats.aliasTotal}別名`} color="#F472B6" />
              <StatBadge icon="🔗" label={`${stats.relatedTotal}関連`} color="#7CB1FF" />
            </View>
          )}

          {/* 検索バー */}
          <View style={{
            flexDirection: 'row', alignItems: 'center',
            backgroundColor: C.bg2, borderRadius: R.md,
            borderWidth: 1, borderColor: C.border,
            paddingHorizontal: SP['3'],
            marginBottom: SP['2'],
          }}>
            <Icon.search size={16} color={C.text3} strokeWidth={2.2} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="検索 (タグ名・別名)"
              placeholderTextColor={C.text3}
              style={[T.body, { flex: 1, color: C.text, paddingVertical: SP['2'], paddingHorizontal: SP['2'] }]}
            />
            {search.length > 0 && (
              <PressableScale onPress={() => setSearch('')} haptic="tap" style={{ padding: 4 }}>
                <Icon.close size={14} color={C.text3} strokeWidth={2.2} />
              </PressableScale>
            )}
          </View>

          {/* タグ自動グルーピング候補 — AI 提案より前 (1 タップ accept で複数まとめて追加できる) */}
          <SuggestedClusters
            clusters={clusterSuggestions.clusters}
            hydrated={clusterSuggestions.hydrated}
          />

          {/* AI 連携提案 (ベクトル類似度) */}
          {aiSuggestions.length > 0 && (
            <View style={{
              padding: SP['3'],
              backgroundColor: 'rgba(124,177,255,0.13)',
              borderRadius: R.md,
              borderWidth: 1,
              borderColor: 'rgba(124,177,255,0.4)',
              gap: SP['2'],
            }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={[T.smallM, { color: '#7CB1FF', fontWeight: '700', flex: 1 }]}>
                  AI が連携を提案
                </Text>
                {cooccurLoading && <Text style={{ fontSize: 10, color: '#7CB1FF' }}>分析中…</Text>}
              </View>
              <Text style={[T.caption, { color: '#ffffffaa', fontSize: 10 }]}>
                共起・字面・タグ階層・同義語からベクトル類似度を計算
              </Text>
              {aiSuggestions.map((s) => (
                <View key={s.nodeId} style={{
                  padding: SP['2'],
                  backgroundColor: 'rgba(0,0,0,0.25)',
                  borderRadius: R.sm,
                  gap: 4,
                }}>
                  <Text style={[T.caption, { color: '#fff', fontWeight: '700' }]}>
                    📁 {s.nodeLabel}
                  </Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
                    {s.suggestions.map((sg) => (
                      <View key={sg.tag} style={{ flexDirection: 'row', gap: 2 }}>
                        <PressableScale
                          onPress={() => {
                            addRelatedMulti(s.nodeId, [sg.tag]);
                            show(`「${sg.tag}」を関連に追加`, 'success');
                          }}
                          haptic="confirm"
                          style={{
                            flexDirection: 'row', alignItems: 'center', gap: 3,
                            paddingHorizontal: 6, paddingVertical: 3,
                            backgroundColor: 'rgba(124,177,255,0.2)',
                            borderRadius: R.sm,
                            borderWidth: 1, borderColor: 'rgba(124,177,255,0.45)',
                          }}
                        >
                          <Text style={{ fontSize: 9, color: '#7CB1FF' }}>＋</Text>
                          <Text style={{ fontSize: 11, color: '#7CB1FF', fontWeight: '700' }}>{sg.tag}</Text>
                          <Text style={{ fontSize: 9, color: '#ffffff77' }}>{Math.round(sg.score * 100)}%</Text>
                        </PressableScale>
                      </View>
                    ))}
                  </View>
                </View>
              ))}
            </View>
          )}

          {/* 追加ツールバー */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SP['2'], marginBottom: SP['2'] }}>
            <PressableScale
              onPress={handleImport}
              haptic="confirm"
              style={{
                flexDirection: 'row', alignItems: 'center', gap: 4,
                paddingHorizontal: SP['3'], paddingVertical: 6,
                backgroundColor: '#22D3A422',
                borderRadius: R.full,
                borderWidth: 1, borderColor: '#22D3A455',
              }}
            >
              <Text style={{ fontSize: 12 }}>❤️</Text>
              <Text style={[T.caption, { color: '#22D3A4', fontWeight: '700' }]}>好きを取込</Text>
            </PressableScale>
            <PressableScale
              onPress={() => setTemplateOpen(true)}
              haptic="confirm"
              style={{
                flexDirection: 'row', alignItems: 'center', gap: 4,
                paddingHorizontal: SP['3'], paddingVertical: 6,
                backgroundColor: C.accentBg,
                borderRadius: R.full,
                borderWidth: 1, borderColor: C.accentSoft,
              }}
            >
              <Text style={{ fontSize: 12 }}>🚀</Text>
              <Text style={[T.caption, { color: C.accentLight, fontWeight: '700' }]}>テンプレート</Text>
            </PressableScale>
          </View>

          {filteredRootIds.length === 0 && search.length > 0 ? (
            <View style={{ padding: SP['4'], alignItems: 'center' }}>
              <Text style={[T.body, { color: C.text3 }]}>「{search}」に一致するタグがありません</Text>
            </View>
          ) : filteredRootIds.map((id, idx) => (
            <NodeView
              key={id}
              id={id}
              nodes={nodes}
              depth={0}
              expanded={expanded}
              likedSet={likedSet}
              isRoot
              canMoveUp={idx > 0}
              canMoveDown={idx < filteredRootIds.length - 1}
              onToggle={toggleExpand}
              onAddChild={(pid, plabel) => { setAction({ kind: 'add-child', parentId: pid, parentLabel: plabel }); setInput(''); }}
              onAddAlias={(nid, nlabel) => { setAction({ kind: 'add-alias', nodeId: nid, nodeLabel: nlabel }); setInput(''); }}
              onAddRelated={(nid, nlabel) => { setAction({ kind: 'add-related', nodeId: nid, nodeLabel: nlabel }); setInput(''); }}
              onRename={(nid, current) => { setAction({ kind: 'rename', nodeId: nid, current }); setInput(current); }}
              onRemove={(nid) => {
                const node = nodes[nid];
                if (!node) return;
                setConfirm({ kind: 'remove-node', nodeId: nid, nodeLabel: node.label, childCount: node.children.length });
              }}
              onRemoveAlias={(nid, alias) => {
                const node = nodes[nid];
                if (!node) return;
                setConfirm({ kind: 'remove-alias', nodeId: nid, alias, nodeLabel: node.label });
              }}
              onRemoveRelated={(nid, related) => {
                const node = nodes[nid];
                if (!node) return;
                setConfirm({ kind: 'remove-related', nodeId: nid, related, nodeLabel: node.label });
              }}
              onAddAllToLiked={addAllToLiked}
              onMove={(nid) => {
                const node = nodes[nid];
                if (!node) return;
                setMoveTarget({ nodeId: nid, nodeLabel: node.label });
              }}
              onMoveUp={(nid) => moveRoot(nid, 'up')}
              onMoveDown={(nid) => moveRoot(nid, 'down')}
            />
          ))}
        </ScrollView>
      )}

      {/* 移動モーダル */}
      <Modal visible={!!moveTarget} transparent animationType="slide" onRequestClose={() => setMoveTarget(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' }}>
          <View style={{
            backgroundColor: C.bg2,
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            borderTopWidth: 1,
            borderColor: C.border,
            maxHeight: '80%',
          }}>
            <View style={{ paddingHorizontal: SP['4'], paddingTop: SP['4'], paddingBottom: SP['2'], gap: SP['1'] }}>
              <Text style={[T.h3, { color: C.text }]}>「{moveTarget?.nodeLabel}」を移動</Text>
              <Text style={[T.caption, { color: C.text3 }]}>新しい親を選択 (子孫は一緒に移動)</Text>
            </View>
            <ScrollView contentContainerStyle={{ paddingHorizontal: SP['3'], paddingBottom: insets.bottom + SP['6'], gap: 4 }}>
              <PressableScale
                onPress={() => handleMove(null)}
                haptic="confirm"
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: SP['2'],
                  padding: SP['3'],
                  backgroundColor: C.bg3, borderRadius: R.md,
                  borderWidth: 1, borderColor: C.accentSoft,
                }}
              >
                <Text style={{ fontSize: 18 }}>🌳</Text>
                <Text style={[T.bodyMd, { color: C.text, fontWeight: '700' }]}>ルートへ (最上位)</Text>
              </PressableScale>
              {moveCandidates.all.map((c) => (
                <PressableScale
                  key={c.id}
                  onPress={() => handleMove(c.id)}
                  haptic="confirm"
                  style={{
                    flexDirection: 'row', alignItems: 'center', gap: SP['2'],
                    padding: SP['3'],
                    paddingLeft: SP['3'] + c.depth * 16,
                    backgroundColor: C.bg3, borderRadius: R.md,
                    borderWidth: 1, borderColor: C.border,
                  }}
                >
                  <Text style={{ fontSize: 14 }}>{(nodes[c.id]?.children.length ?? 0) > 0 ? '📁' : '#️⃣'}</Text>
                  <Text style={[T.body, { color: C.text }]} numberOfLines={1}>{c.label}</Text>
                </PressableScale>
              ))}
              <PressableScale
                onPress={() => setMoveTarget(null)}
                style={{ padding: SP['3'], alignItems: 'center', marginTop: SP['2'] }}
              >
                <Text style={[T.smallM, { color: C.text2 }]}>キャンセル</Text>
              </PressableScale>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* テンプレートモーダル */}
      <Modal visible={templateOpen} transparent animationType="slide" onRequestClose={() => setTemplateOpen(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' }}>
          <View style={{
            backgroundColor: C.bg2,
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            borderTopWidth: 1,
            borderColor: C.border,
            padding: SP['4'],
            paddingBottom: insets.bottom + SP['4'],
            gap: SP['3'],
          }}>
            <Text style={[T.h3, { color: C.text }]}>🚀 テンプレート追加</Text>
            <Text style={[T.caption, { color: C.text3 }]}>既製のジャンル別ツリーを取り込み (既存ツリーは保持)</Text>
            <View style={{ gap: SP['2'] }}>
              {TEMPLATES.map((tpl) => (
                <PressableScale
                  key={tpl.id}
                  onPress={() => {
                    applyTemplate(tpl.data);
                    setTemplateOpen(false);
                    show(`「${tpl.name}」テンプレートを適用`, 'success');
                  }}
                  haptic="confirm"
                  style={{
                    flexDirection: 'row', alignItems: 'center', gap: SP['3'],
                    padding: SP['3'],
                    backgroundColor: C.bg3, borderRadius: R.md,
                    borderWidth: 1, borderColor: C.border,
                  }}
                >
                  <Text style={{ fontSize: 28 }}>{tpl.emoji}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={[T.bodyMd, { color: C.text, fontWeight: '700' }]}>{tpl.name}</Text>
                    <Text style={[T.caption, { color: C.text3 }]}>{tpl.description}</Text>
                  </View>
                  <Icon.chevronR size={18} color={C.accentLight} strokeWidth={2.2} />
                </PressableScale>
              ))}
            </View>
            <PressableScale onPress={() => setTemplateOpen(false)} style={{ padding: SP['3'], alignItems: 'center' }}>
              <Text style={[T.smallM, { color: C.text2 }]}>キャンセル</Text>
            </PressableScale>
          </View>
        </View>
      </Modal>

      {/* 削除確認ダイアログ */}
      <ConfirmDialog
        visible={!!confirm}
        title={
          confirm?.kind === 'remove-alias'
            ? `別名「${confirm.alias}」を削除しますか？`
            : confirm?.kind === 'remove-related'
              ? `関連タグ「${confirm.related}」を削除しますか？`
              : `「${confirm?.nodeLabel ?? ''}」を削除しますか？`
        }
        message={
          confirm?.kind === 'remove-alias'
            ? `「${confirm.nodeLabel}」の別名から「${confirm.alias}」を取り除きます。本体は残ります。`
            : confirm?.kind === 'remove-related'
              ? `「${confirm.nodeLabel}」の関連タグから「${confirm.related}」を取り除きます。本体は残ります。`
              : confirm?.kind === 'remove-node' && confirm.childCount > 0
                ? `このノードには ${confirm.childCount} 個の子ノードがあります。子はルートに繰り上がります (削除はされません)。`
                : 'このノードを削除します。'
        }
        confirmLabel="削除"
        cancelLabel="キャンセル"
        destructive
        onConfirm={confirmDelete}
        onCancel={() => setConfirm(null)}
      />

      <Modal
        visible={!!action}
        transparent
        animationType="fade"
        onRequestClose={() => { setAction(null); setInput(''); }}
      >
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: SP['6'] }}>
          <View style={{
            backgroundColor: C.bg2,
            borderRadius: R.xl,
            borderWidth: 1,
            borderColor: C.border,
            padding: SP['5'],
            gap: SP['3'],
          }}>
            <Text style={[T.h3, { color: C.text }]}>
              {action?.kind === 'add-root'    ? '新しいノードを追加' :
               action?.kind === 'add-child'   ? `「${action.parentLabel}」に追加` :
               action?.kind === 'add-alias'   ? `「${action.nodeLabel}」の別名を追加` :
               action?.kind === 'add-related' ? `「${action.nodeLabel}」の関連タグを追加` :
               action?.kind === 'rename'      ? '名前を変更' : ''}
            </Text>
            <Text style={[T.caption, { color: C.text3 }]}>
              {action?.kind === 'add-alias'
                ? '別名は同義タグ (= 同じものの別表記)。例: =LOVE と イコラブ。カンマ区切りで複数追加可'
                : action?.kind === 'add-related'
                  ? '関連タグは概念的に紐付く別タグ。例: 日向坂 → おひさま (ファン名)。カンマ区切りで複数追加可'
                  : action?.kind === 'rename'
                    ? '新しい名前を入力'
                    : 'タグ名 or グループ名を入力。カンマ区切りで複数同時追加可'}
            </Text>
            <TextInput
              value={input}
              onChangeText={setInput}
              placeholder={
                action?.kind === 'add-alias'   ? '例: イコラブ, =LOVE, ikoraba' :
                action?.kind === 'add-related' ? '例: おひさま, ひなおた' :
                action?.kind === 'add-child'   ? '例: cute street, frurts zipper' :
                action?.kind === 'rename'      ? '新しい名前' : '例: カワラボ, アイドル'
              }
              placeholderTextColor={C.text3}
              autoFocus
              onSubmitEditing={submitAction}
              style={[
                T.body,
                {
                  color: C.text,
                  backgroundColor: C.bg3,
                  borderRadius: R.md,
                  paddingHorizontal: SP['4'],
                  paddingVertical: SP['3'],
                  borderWidth: 1,
                  borderColor: C.border,
                },
              ]}
            />
            <View style={{ flexDirection: 'row', gap: SP['2'], justifyContent: 'flex-end' }}>
              <PressableScale
                onPress={() => { setAction(null); setInput(''); }}
                style={{ paddingHorizontal: SP['4'], paddingVertical: SP['3'] }}
              >
                <Text style={[T.smallM, { color: C.text2 }]}>キャンセル</Text>
              </PressableScale>
              <PressableScale
                onPress={submitAction}
                haptic="confirm"
                disabled={!input.trim()}
                style={{
                  paddingHorizontal: SP['5'], paddingVertical: SP['3'],
                  backgroundColor: input.trim() ? C.accent : C.bg3,
                  borderRadius: R.full,
                  opacity: input.trim() ? 1 : 0.5,
                }}
              >
                <Text style={[T.smallM, { color: '#fff', fontWeight: '700' }]}>OK</Text>
              </PressableScale>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// StatBadge は components/ui/StatBadge.tsx へ切り出し (Phase 8 split)

function NodeView({
  id, nodes, depth, expanded, likedSet, isRoot, canMoveUp, canMoveDown,
  onToggle, onAddChild, onAddAlias, onAddRelated, onRename, onRemove,
  onRemoveAlias, onRemoveRelated, onAddAllToLiked,
  onMove, onMoveUp, onMoveDown,
}: {
  id: string;
  nodes: Record<string, TagNode>;
  depth: number;
  expanded: Set<string>;
  likedSet: Set<string>;
  isRoot?: boolean;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  onToggle: (id: string) => void;
  onAddChild: (parentId: string, parentLabel: string) => void;
  onAddAlias: (nodeId: string, nodeLabel: string) => void;
  onAddRelated: (nodeId: string, nodeLabel: string) => void;
  onRename: (nodeId: string, current: string) => void;
  onRemove: (id: string) => void;
  onRemoveAlias: (id: string, alias: string) => void;
  onRemoveRelated: (id: string, related: string) => void;
  onAddAllToLiked: (id: string) => void;
  onMove: (id: string) => void;
  onMoveUp?: (id: string) => void;
  onMoveDown?: (id: string) => void;
}) {
  const n = nodes[id];
  if (!n) return null;
  const hasChildren = n.children.length > 0;
  const isExpanded = expanded.has(id);
  const isGroup = hasChildren;
  const isLiked = likedSet.has(n.label) || n.aliases.some((a) => likedSet.has(a));

  return (
    <View style={{ gap: SP['2'], position: 'relative' }}>
      {/* ツリー接続線 (depth > 0 の時) */}
      {depth > 0 && (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: (depth - 1) * 16 + 10,
            top: 0,
            bottom: 0,
            width: 1,
            backgroundColor: C.border,
          }}
        />
      )}
      {depth > 0 && (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: (depth - 1) * 16 + 10,
            top: 24,
            width: depth * 16 - 10 + 2,
            height: 1,
            backgroundColor: C.border,
          }}
        />
      )}
      <View
        style={{
          marginLeft: depth * 16,
          backgroundColor: depth === 0 ? C.bg2 : C.bg3,
          borderRadius: R.md,
          borderWidth: 1,
          borderColor: isLiked ? C.accent : isGroup ? C.accentSoft : C.border,
          padding: SP['3'],
          gap: SP['2'],
        }}
      >
        {/* ヘッダー行 */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
          {hasChildren ? (
            <PressableScale onPress={() => onToggle(id)} haptic="tap" style={{ padding: 2 }}>
              <Text style={{ fontSize: 12, color: C.accent }}>
                {isExpanded ? '▼' : '▶'}
              </Text>
            </PressableScale>
          ) : (
            <Text style={{ fontSize: 12, color: C.text3, paddingLeft: 6 }}>•</Text>
          )}
          <Text style={{ fontSize: 16 }}>{isGroup ? '📁' : '#️⃣'}</Text>
          <PressableScale onPress={() => onRename(id, n.label)} haptic="tap" style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={[T.bodyB, { color: C.text, fontWeight: '700' }]} numberOfLines={1}>
                {n.label}
              </Text>
              {isLiked && <Text style={{ fontSize: 12 }}>❤️</Text>}
            </View>
          </PressableScale>
          {/* ルートノード時: 上下並び替え */}
          {isRoot && canMoveUp && (
            <PressableScale onPress={() => onMoveUp?.(id)} haptic="tap" style={{ padding: 4 }}>
              <Text style={{ fontSize: 12, color: C.text3 }}>↑</Text>
            </PressableScale>
          )}
          {isRoot && canMoveDown && (
            <PressableScale onPress={() => onMoveDown?.(id)} haptic="tap" style={{ padding: 4 }}>
              <Text style={{ fontSize: 12, color: C.text3 }}>↓</Text>
            </PressableScale>
          )}
          <PressableScale
            onPress={() => onRemove(id)}
            haptic="warn"
            style={{ padding: 4 }}
          >
            <Icon.close size={16} color={C.text3} strokeWidth={2.2} />
          </PressableScale>
        </View>

        {/* 別名 (同義タグ) */}
        {n.aliases.length > 0 && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {n.aliases.map((a) => (
              <PressableScale
                key={a}
                onPress={() => onRemoveAlias(id, a)}
                haptic="warn"
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 4,
                  paddingHorizontal: SP['2'],
                  paddingVertical: 3,
                  backgroundColor: C.accentBg,
                  borderRadius: R.full,
                  borderWidth: 1,
                  borderColor: C.accentSoft,
                }}
              >
                <Text style={{ fontSize: 10, color: C.accentLight }}>≡</Text>
                <Text style={[T.caption, { color: C.accentLight }]}>{a}</Text>
                <Text style={{ fontSize: 10, color: C.text3 }}>✕</Text>
              </PressableScale>
            ))}
          </View>
        )}

        {/* 関連タグ (概念的に紐付く別タグ) */}
        {(n.related ?? []).length > 0 && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {(n.related ?? []).map((r) => (
              <PressableScale
                key={r}
                onPress={() => onRemoveRelated(id, r)}
                haptic="warn"
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 4,
                  paddingHorizontal: SP['2'],
                  paddingVertical: 3,
                  backgroundColor: 'rgba(124,177,255,0.13)',
                  borderRadius: R.full,
                  borderWidth: 1,
                  borderColor: 'rgba(124,177,255,0.4)',
                }}
              >
                <Text style={{ fontSize: 10, color: '#7CB1FF' }}>🔗</Text>
                <Text style={[T.caption, { color: '#7CB1FF' }]}>{r}</Text>
                <Text style={{ fontSize: 10, color: C.text3 }}>✕</Text>
              </PressableScale>
            ))}
          </View>
        )}

        {/* アクションボタン */}
        <View style={{ flexDirection: 'row', gap: SP['2'], flexWrap: 'wrap' }}>
          <PressableScale
            onPress={() => onAddChild(id, n.label)}
            haptic="confirm"
            style={{
              flexDirection: 'row', alignItems: 'center', gap: 4,
              paddingHorizontal: SP['2'], paddingVertical: 4,
              backgroundColor: C.accentBg, borderRadius: R.sm,
              borderWidth: 1, borderColor: C.accentSoft,
            }}
          >
            <Icon.plus size={11} color={C.accentLight} strokeWidth={2.4} />
            <Text style={[T.caption, { color: C.accentLight, fontWeight: '600' }]}>子タグ</Text>
          </PressableScale>
          <PressableScale
            onPress={() => onAddAlias(id, n.label)}
            haptic="tap"
            style={{
              flexDirection: 'row', alignItems: 'center', gap: 4,
              paddingHorizontal: SP['2'], paddingVertical: 4,
              backgroundColor: C.bg3, borderRadius: R.sm,
              borderWidth: 1, borderColor: C.border,
            }}
          >
            <Text style={{ fontSize: 10, color: C.text2 }}>≡</Text>
            <Text style={[T.caption, { color: C.text2, fontWeight: '600' }]}>別名</Text>
          </PressableScale>
          <PressableScale
            onPress={() => onAddRelated(id, n.label)}
            haptic="tap"
            style={{
              flexDirection: 'row', alignItems: 'center', gap: 4,
              paddingHorizontal: SP['2'], paddingVertical: 4,
              backgroundColor: 'rgba(124,177,255,0.13)',
              borderRadius: R.sm,
              borderWidth: 1, borderColor: 'rgba(124,177,255,0.4)',
            }}
          >
            <Text style={{ fontSize: 10 }}>🔗</Text>
            <Text style={[T.caption, { color: '#7CB1FF', fontWeight: '600' }]}>関連</Text>
          </PressableScale>
          <PressableScale
            onPress={() => onAddAllToLiked(id)}
            haptic="confirm"
            style={{
              flexDirection: 'row', alignItems: 'center', gap: 4,
              paddingHorizontal: SP['2'], paddingVertical: 4,
              backgroundColor: '#22D3A422',
              borderRadius: R.sm,
              borderWidth: 1, borderColor: '#22D3A455',
            }}
          >
            <Text style={{ fontSize: 11 }}>❤️</Text>
            <Text style={[T.caption, { color: '#22D3A4', fontWeight: '600' }]}>
              {isGroup ? '全部好きに' : '好きに'}
            </Text>
          </PressableScale>
          <PressableScale
            onPress={() => onMove(id)}
            haptic="tap"
            style={{
              flexDirection: 'row', alignItems: 'center', gap: 4,
              paddingHorizontal: SP['2'], paddingVertical: 4,
              backgroundColor: C.bg3, borderRadius: R.sm,
              borderWidth: 1, borderColor: C.border,
            }}
          >
            <Text style={{ fontSize: 10, color: C.text2 }}>⇄</Text>
            <Text style={[T.caption, { color: C.text2, fontWeight: '600' }]}>移動</Text>
          </PressableScale>
        </View>
      </View>

      {/* 子ノード */}
      {isExpanded && (
        <View style={{ gap: SP['2'] }}>
          {n.children.map((cid) => (
            <NodeView
              key={cid}
              id={cid}
              nodes={nodes}
              depth={depth + 1}
              expanded={expanded}
              likedSet={likedSet}
              onToggle={onToggle}
              onAddChild={onAddChild}
              onAddAlias={onAddAlias}
              onAddRelated={onAddRelated}
              onRename={onRename}
              onRemove={onRemove}
              onRemoveAlias={onRemoveAlias}
              onRemoveRelated={onRemoveRelated}
              onAddAllToLiked={onAddAllToLiked}
              onMove={onMove}
            />
          ))}
        </View>
      )}
    </View>
  );
}
