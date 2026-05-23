// ============================================================
// VisibilityPicker — 投稿の公開範囲を選ぶ 2x2 グリッド
// ============================================================
// app/post/create.tsx から抽出。
// 4 つの選択肢 (private / public / community_only / community_public) を
// 2 列グリッドで縦長を圧縮。active 時は accent border + ✓ バッジ。
// pure presentational — value/onChange の controlled component。
// ============================================================
import { Text, View } from 'react-native';
import { PressableScale } from '../ui/PressableScale';
import { Icon } from '../../constants/icons';
import { C, R, SP } from '../../design/tokens';
import { T } from '../../design/typography';
import type { PostVisibility } from '../../lib/api/posts';

type VisibilityOption = {
  value: PostVisibility;
  emoji: string;
  label: string;
  desc: string;
};

const VISIBILITY_OPTIONS: VisibilityOption[] = [
  { value: 'private',          emoji: '🔒', label: '自分だけ',                              desc: '下書きとしてあなただけ見える' },
  { value: 'public',           emoji: '🌐', label: '一般公開',                              desc: 'コミュニティには載せず、ホームに公開' },
  { value: 'community_only',   emoji: '👥', label: '指定コミュニティのメンバーだけ',        desc: '選んだコミュニティ内の人だけ閲覧可' },
  { value: 'community_public', emoji: '📣', label: '全員に公開 (コミュニティにも掲載)',     desc: 'ホームにも、コミュニティにも掲載' },
];

export function VisibilityPicker({
  value,
  onChange,
}: {
  value: PostVisibility;
  onChange: (v: PostVisibility) => void;
}) {
  return (
    <View style={{ gap: SP['2'] }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: SP['1'] }}>
        <Text style={[T.smallB, { color: C.text2 }]}>公開範囲</Text>
        <Text style={[T.caption, { color: C.red }]}>*</Text>
      </View>
      <Text style={[T.caption, { color: C.text3 }]}>
        だれに見せる投稿か。後から変更できません
      </Text>
      {/* 2 列グリッド: 縦の長さを 1/2 に圧縮 */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -SP['1'], marginTop: SP['1'] }}>
        {VISIBILITY_OPTIONS.map((opt) => {
          const active = value === opt.value;
          return (
            <View key={opt.value} style={{ width: '50%', padding: SP['1'] }}>
              <PressableScale
                onPress={() => onChange(opt.value)}
                haptic="select"
                scaleValue={0.97}
                style={{
                  minHeight: 96,
                  gap: 6,
                  paddingHorizontal: SP['3'],
                  paddingVertical: SP['3'],
                  borderRadius: R.lg,
                  backgroundColor: active ? C.accent + '18' : C.bg2,
                  borderWidth: 1.5,
                  borderColor: active ? C.accent : C.border,
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={{ fontSize: 20 }}>{opt.emoji}</Text>
                  {active && (
                    <View style={{ flex: 1, alignItems: 'flex-end' }}>
                      <View style={{
                        width: 18, height: 18, borderRadius: 9,
                        backgroundColor: C.accent,
                        alignItems: 'center', justifyContent: 'center',
                      }}>
                        <Icon.ok size={11} color="#fff" strokeWidth={3} />
                      </View>
                    </View>
                  )}
                </View>
                <Text style={[T.smallB, { color: active ? C.accentLight : C.text }]} numberOfLines={2}>
                  {opt.label}
                </Text>
                <Text style={[T.caption, { color: C.text3, fontSize: 10, lineHeight: 14 }]} numberOfLines={2}>
                  {opt.desc}
                </Text>
              </PressableScale>
            </View>
          );
        })}
      </View>
    </View>
  );
}
