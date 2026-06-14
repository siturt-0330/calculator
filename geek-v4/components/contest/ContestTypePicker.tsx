// =============================================================================
// components/contest/ContestTypePicker.tsx — タイプ選択(ミニモック横スクロール + 説明/具体例)
// -----------------------------------------------------------------------------
// ユーザー好み: 各タイプの実カードを小さく示すミニモック(勝敗予想=左レール行/アンケート=割合
// バー/公募=作品グリッド/レビュー=★)。名前の下に一言サブ。
// 下に「選んだタイプの説明 + 具体例チップ」を出して親切に。選択=紫グロー枠+ピンク名+チェック。
// ※ ハイブリッドは廃止 (2026-06-14)。代わりに末尾へ「カスタマイズ(準備中)」の非選択カードを置く。
//   ContestPreset 型 / presetToFlags の 'hybrid' は既存データ互換のため温存し、UI からだけ外す。
// =============================================================================

import { View, Text, ScrollView } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Check } from 'lucide-react-native';

import type { ColorPalette } from '../../lib/theme/palettes';
import { R, SP } from '../../design/tokens';
import { T } from '../../design/typography';
import { PressableScale } from '../ui/PressableScale';
import { hap } from '../../design/haptics';
import { useToastStore } from '../../stores/toastStore';
import type { ContestPreset } from '../../lib/api/contests';

const GRAD = ['#7C6AF7', '#B98CFF', '#E891C7'] as const;
const PINK = '#E891C7';
const MINI_BG = '#08070b';
const SCREEN_PAD = SP['4']; // create.tsx の左右パディング(端まで流すため相殺)

type TypeMeta = { key: ContestPreset; name: string; sub: string; detail: string; examples: string[] };
const TYPES: TypeMeta[] = [
  { key: 'prediction', name: '勝敗予想', sub: '当たると称号',   detail: '選択肢から1つ予想 → 締切後に正解を発表。的中で称号がつきます。', examples: ['天皇賞の優勝馬は?', '推しの新曲センターは誰?', 'M-1優勝コンビは?'] },
  { key: 'poll',       name: 'アンケート', sub: '割合を見る',   detail: '正解なし。投票すると、みんなの割合が見えます。気軽に。', examples: ['新衣装、どっちが好き?', '次のライブ何公演行く?'] },
  { key: 'submission', name: '公募',     sub: '作品で勝負',     detail: '参加者が作品を提出 → 締切後に一斉公開され、みんなで投票。', examples: ['推し活フォトコン', 'みんなのファンアート大会'] },
  { key: 'review',     name: 'レビュー', sub: '★で評価',       detail: 'みんなが★1〜5で評価。平均と分布が見えます。', examples: ['新譜の評価', '新作映画レビュー'] },
];

// ---- ミニ部品 ---------------------------------------------------------------
function Dot({ on }: { on?: boolean }) {
  if (on) return <View style={{ width: 9, height: 9, borderRadius: 5, overflow: 'hidden' }}><LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flex: 1 }} /></View>;
  return <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: 'rgba(255,255,255,.18)' }} />;
}
function Row({ on }: { on?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, paddingLeft: 5 }}>
      {on && <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={{ position: 'absolute', left: 0, top: 3, width: 2.5, height: 15, borderRadius: 2 }} />}
      <Dot on={on} />
      <View style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: on ? 'rgba(255,255,255,.4)' : 'rgba(255,255,255,.13)' }} />
      {on && <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: PINK }} />}
    </View>
  );
}
function PollBar({ w, grad }: { w: number; grad?: boolean }) {
  return (
    <View style={{ height: 7, borderRadius: 3, backgroundColor: 'rgba(255,255,255,.08)', overflow: 'hidden' }}>
      <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${w}%`, borderRadius: 3, overflow: 'hidden' }}>
        {grad ? <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ flex: 1 }} /> : <View style={{ flex: 1, backgroundColor: 'rgba(255,255,255,.22)' }} />}
      </View>
    </View>
  );
}
function Tile({ colors, ring }: { colors: readonly [string, string]; ring?: boolean }) {
  return (
    <View style={{ flex: 1, borderRadius: 5, overflow: 'hidden', borderWidth: ring ? 1.5 : 0, borderColor: ring ? '#C58CF0' : 'transparent' }}>
      <LinearGradient colors={colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flex: 1 }} />
    </View>
  );
}
function Grid({ compact }: { compact?: boolean }) {
  const h = compact ? 30 : 52;
  return (
    <View style={{ flexDirection: 'row', gap: 6, height: h }}>
      <Tile colors={['#3a2160', '#1d1233']} ring /><Tile colors={['#163a4a', '#0f2233']} />
      <Tile colors={['#4a1d33', '#2a1020']} /><Tile colors={['#2e2660', '#1a1633']} />
    </View>
  );
}
// カスタマイズ(準備中)用のミニモック: 設定スライダー風の 3 行 (muted)。
function CustomizeMini() {
  const wrap = { height: 76, borderRadius: 10, backgroundColor: MINI_BG, padding: 10, justifyContent: 'center', gap: 9 } as const;
  const rows = [0.34, 0.66, 0.5];
  return (
    <View style={wrap}>
      {rows.map((p, i) => (
        <View key={i} style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,.12)' }}>
            <View style={{ position: 'absolute', left: `${p * 100}%`, top: -3, width: 9, height: 9, borderRadius: 5, backgroundColor: 'rgba(255,255,255,.4)', marginLeft: -4 }} />
          </View>
        </View>
      ))}
    </View>
  );
}

function Mini({ kind }: { kind: ContestPreset }) {
  const wrap = { height: 76, borderRadius: 10, backgroundColor: MINI_BG, padding: 10 } as const;
  if (kind === 'prediction') return <View style={[wrap, { justifyContent: 'center', gap: 7 }]}><Row /><Row on /><Row /></View>;
  if (kind === 'poll') return <View style={[wrap, { justifyContent: 'center', gap: 7 }]}><PollBar w={62} grad /><PollBar w={43} /><PollBar w={26} /></View>;
  if (kind === 'submission') return <View style={[wrap, { justifyContent: 'center' }]}><Grid /></View>;
  if (kind === 'review') {
    return (
      <View style={[wrap, { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 }]}>
        {[0, 1, 2, 3, 4].map((i) => <Text key={i} style={{ fontSize: 18, lineHeight: 20, color: i < 4 ? PINK : 'rgba(255,255,255,.16)' }}>★</Text>)}
      </View>
    );
  }
  // hybrid = 公募(グリッド) + 二段階の帯
  return (
    <View style={[wrap, { justifyContent: 'center', gap: 7 }]}>
      <View style={{ flexDirection: 'row', gap: 4 }}>
        {[0, 1].map((i) => (
          <View key={i} style={{ flex: 1, height: 4, borderRadius: 2, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,.12)' }}>
            {i === 0 && <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ flex: 1 }} />}
          </View>
        ))}
      </View>
      <Grid compact />
    </View>
  );
}

// ---- 本体 -------------------------------------------------------------------
export function ContestTypePicker({ C, value, onChange }: { C: ColorPalette; value: ContestPreset; onChange: (p: ContestPreset) => void }) {
  const sel = TYPES.find((t) => t.key === value);
  const show = useToastStore((s) => s.show);
  return (
    <View style={{ gap: SP['3'] }}>
      {/* ミニモック横スクロール(端まで流す) */}
      <View style={{ marginHorizontal: -SCREEN_PAD }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: SP['3'], paddingHorizontal: SCREEN_PAD, paddingVertical: 2 }}>
          {TYPES.map((t) => {
            const on = value === t.key;
            return (
              <PressableScale key={t.key} onPress={() => onChange(t.key)} haptic="select"
                style={{
                  width: 158, borderRadius: 15, padding: 11, backgroundColor: on ? '#120f18' : '#0f0e14',
                  borderWidth: 1.5, borderColor: on ? '#C58CF0' : C.border,
                  shadowColor: '#BE82F0', shadowOpacity: on ? 0.35 : 0, shadowRadius: on ? 14 : 0, shadowOffset: { width: 0, height: 0 }, elevation: on ? 6 : 0,
                }}>
                <Mini kind={t.key} />
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 11 }}>
                  <Text style={[T.smallB, { color: on ? PINK : 'rgba(255,255,255,.92)', flex: 1 }]}>{t.name}</Text>
                  {on && <Check size={15} color={PINK} strokeWidth={2.6} />}
                </View>
                <Text style={[T.caption, { color: C.text3, marginTop: 1 }]}>{t.sub}</Text>
              </PressableScale>
            );
          })}

          {/* カスタマイズ(準備中) — 選択不可のプレースホルダ。破線枠 + 準備中バッジ + 低不透明度で
              「もうすぐ来るけど今は選べない」を示す。タップ時はハプティクス + トーストで反応する。 */}
          <PressableScale
            onPress={() => {
              hap.tap();
              show('まもなく追加予定です', 'info');
            }}
            accessibilityRole="button"
            accessibilityLabel="カスタマイズ（準備中）"
            accessibilityState={{ disabled: true }}
            style={{
              width: 158, borderRadius: 15, padding: 11, backgroundColor: '#0f0e14',
              borderWidth: 1.5, borderColor: C.border, borderStyle: 'dashed', opacity: 0.65,
            }}
          >
            <CustomizeMini />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 11 }}>
              <Text style={[T.smallB, { color: 'rgba(255,255,255,.78)', flex: 1 }]}>カスタマイズ</Text>
              <View style={{ backgroundColor: C.glass, borderRadius: R.full, paddingHorizontal: 7, paddingVertical: 2 }}>
                <Text style={[T.caption, { color: C.text3, fontWeight: '700' }]}>準備中</Text>
              </View>
            </View>
            <Text style={[T.caption, { color: C.text3, marginTop: 1 }]}>自由に組み合わせ</Text>
          </PressableScale>
        </ScrollView>
      </View>

      {/* 選んだタイプの説明 + 具体例 */}
      {sel && (
        <View style={{ backgroundColor: C.accent + '0f', borderWidth: 1, borderColor: C.accent + '2e', borderRadius: R.lg, padding: SP['3'], gap: SP['2'] }}>
          <Text style={[T.small, { color: C.text2, lineHeight: 20 }]}>{sel.detail}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SP['1'] }}>
            {sel.examples.map((ex) => (
              <View key={ex} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: C.glass, borderRadius: R.full, paddingVertical: 4, paddingHorizontal: 9 }}>
                <Text style={[T.caption, { color: C.accentLight, fontWeight: '700' }]}>例</Text>
                <Text style={[T.caption, { color: C.text2 }]}>{ex}</Text>
              </View>
            ))}
          </View>
        </View>
      )}
    </View>
  );
}
