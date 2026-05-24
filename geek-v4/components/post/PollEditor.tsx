// ============================================================
// PollEditor — 投票 (poll) 編集 UI (collapsible)
// ============================================================
// app/post/create.tsx から抽出。controlled component。
// 親 (CreatePost) が poll 状態を保持し、submit 時に pollPayload を組み立てる。
// PollEditor 自体は state を持たない pure presentational。
//
// props:
//   open       : 折りたたみ ON/OFF
//   onToggle   : open を反転
//   question   : 投票の質問文
//   options    : 選択肢配列 (2-6)
//   multi      : 複数選択を許可するか
//   hours      : 期間 (6 / 24 / 72 / 168) — null なら hours 指定なし
// ============================================================
import { Text, View } from 'react-native';
import Animated, { FadeInDown, Layout } from 'react-native-reanimated';
import { X } from 'lucide-react-native';
import { Input } from '../ui/Input';
import { PressableScale } from '../ui/PressableScale';
import { C, R, SP } from '../../design/tokens';
import { T } from '../../design/typography';

const HOURS_PRESETS = [6, 24, 72, 168] as const;

export function PollEditor({
  open,
  onToggle,
  question,
  onQuestionChange,
  options,
  onOptionsChange,
  multi,
  onMultiChange,
  hours,
  onHoursChange,
}: {
  open: boolean;
  onToggle: () => void;
  question: string;
  onQuestionChange: (v: string) => void;
  options: string[];
  onOptionsChange: (next: string[]) => void;
  multi: boolean;
  onMultiChange: (v: boolean) => void;
  hours: number | null;
  onHoursChange: (h: number) => void;
}) {
  return (
    <View style={{ gap: SP['2'] }}>
      <PressableScale
        onPress={onToggle}
        haptic="tap"
        scaleValue={0.99}
        style={{
          flexDirection: 'row', alignItems: 'center', gap: SP['2'],
          paddingHorizontal: SP['3'], paddingVertical: SP['3'],
          borderRadius: R.md,
          backgroundColor: open ? C.accent + '15' : C.bg2,
          borderWidth: 1,
          borderColor: open ? C.accent : C.border,
        }}
      >
        <Text style={{ fontSize: 16 }}>📊</Text>
        <View style={{ flex: 1 }}>
          <Text style={[T.smallB, { color: open ? C.accentLight : C.text }]}>
            投票を追加
          </Text>
          <Text style={[T.caption, { color: C.text3 }]}>
            {open ? '質問と選択肢を入力 (下) ・最大 6 個' : 'みんなに聞いてみたいことがあれば'}
          </Text>
        </View>
        <Text style={[T.caption, { color: open ? C.accent : C.text3, fontWeight: '700' }]}>
          {open ? '閉じる' : '＋ 追加'}
        </Text>
      </PressableScale>
      {open && (
        <Animated.View
          entering={FadeInDown.duration(180)}
          layout={Layout.springify().damping(20)}
          style={{
            padding: SP['3'],
            backgroundColor: C.bg3,
            borderRadius: R.md,
            borderWidth: 1, borderColor: C.border,
            gap: SP['2'],
          }}>
          <Input
            placeholder="質問 (例: 鬼滅で一番強い柱は？)"
            value={question}
            onChangeText={onQuestionChange}
            maxLength={200}
          />
          {options.map((opt, i) => (
            <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
              <Text style={[T.caption, { color: C.text3, width: 18 }]}>{i + 1}.</Text>
              <View style={{ flex: 1 }}>
                <Input
                  placeholder={`選択肢 ${i + 1}`}
                  value={opt}
                  onChangeText={(v) => onOptionsChange(options.map((o, j) => j === i ? v : o))}
                  maxLength={80}
                />
              </View>
              {options.length > 2 && (
                <PressableScale
                  onPress={() => onOptionsChange(options.filter((_, j) => j !== i))}
                  haptic="warn"
                  style={{ padding: 4 }}
                >
                  <X size={14} color={C.text3} strokeWidth={2.4} />
                </PressableScale>
              )}
            </View>
          ))}
          {options.length < 6 && (
            <PressableScale
              onPress={() => onOptionsChange([...options, ''])}
              haptic="tap"
              style={{
                alignSelf: 'flex-start',
                paddingHorizontal: SP['3'], paddingVertical: 4,
                borderRadius: R.full,
                backgroundColor: C.bg2, borderWidth: 1, borderColor: C.border,
              }}
            >
              <Text style={[T.caption, { color: C.text2 }]}>+ 選択肢を追加</Text>
            </PressableScale>
          )}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'], marginTop: SP['1'] }}>
            <PressableScale
              onPress={() => onMultiChange(!multi)}
              haptic="select"
              style={{
                paddingHorizontal: SP['2'], paddingVertical: 4,
                borderRadius: R.full,
                backgroundColor: multi ? C.accent : C.bg2,
                borderWidth: 1,
                borderColor: multi ? C.accent : C.border,
              }}
            >
              <Text style={[T.caption, { color: multi ? '#fff' : C.text2 }]}>
                {multi ? '✓ 複数選択可' : '単一選択'}
              </Text>
            </PressableScale>
            <View style={{ flex: 1 }} />
            <Text style={[T.caption, { color: C.text3 }]}>期間:</Text>
            {HOURS_PRESETS.map((h) => (
              <PressableScale
                key={h}
                onPress={() => onHoursChange(h)}
                haptic="select"
                style={{
                  paddingHorizontal: SP['2'], paddingVertical: 4,
                  borderRadius: R.full,
                  backgroundColor: hours === h ? C.accent : C.bg2,
                  borderWidth: 1,
                  borderColor: hours === h ? C.accent : C.border,
                }}
              >
                <Text style={[T.caption, { color: hours === h ? '#fff' : C.text2 }]}>
                  {h < 24 ? `${h}h` : `${h / 24}d`}
                </Text>
              </PressableScale>
            ))}
          </View>
        </Animated.View>
      )}
    </View>
  );
}
