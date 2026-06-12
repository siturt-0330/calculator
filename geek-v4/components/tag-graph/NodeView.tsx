// ============================================================
// NodeView — タグツリー (oshi/tag-graph) の 1 ノード表示
// ============================================================
// app/oshi/tag-graph.tsx から抽出。
// - 再帰的に自己を呼び出してツリー描画
// - すべての state 変更は props のコールバック経由 (=  pure な presentational)
// - 親側 (TagGraphScreen) が nodes / expanded / likedSet を握る
// ============================================================
import { View, Text } from 'react-native';
import { PressableScale } from '../ui/PressableScale';
import { Icon } from '../../constants/icons';
import { C, R, SP } from '../../design/tokens';
import { T } from '../../design/typography';
import type { TagNode } from '../../stores/tagGraphStore';

export type NodeViewProps = {
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
};

export function NodeView({
  id, nodes, depth, expanded, likedSet, isRoot, canMoveUp, canMoveDown,
  onToggle, onAddChild, onAddAlias, onAddRelated, onRename, onRemove,
  onRemoveAlias, onRemoveRelated, onAddAllToLiked,
  onMove, onMoveUp, onMoveDown,
}: NodeViewProps) {
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
                <Text style={{ fontSize: 11, color: C.accentLight }}>≡</Text>
                <Text style={[T.caption, { color: C.accentLight }]}>{a}</Text>
                <Text style={{ fontSize: 11, color: C.text3 }}>✕</Text>
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
                <Text style={{ fontSize: 11, color: '#7CB1FF' }}>🔗</Text>
                <Text style={[T.caption, { color: '#7CB1FF' }]}>{r}</Text>
                <Text style={{ fontSize: 11, color: C.text3 }}>✕</Text>
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
            <Text style={{ fontSize: 11, color: C.text2 }}>≡</Text>
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
            <Text style={{ fontSize: 11 }}>🔗</Text>
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
            <Text style={{ fontSize: 11, color: C.text2 }}>⇄</Text>
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
