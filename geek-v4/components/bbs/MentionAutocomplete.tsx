// ============================================================
// MentionAutocomplete
// ============================================================
// BBS スレッド返信入力欄向けの @メンション補完 UI。
//
// Polish (Phase 2):
//   - gradient + glass の見た目に揃え (current design system)
//   - 候補 10+ で縦スクロール可 (maxHeight 220)
//   - 選択中候補を accent 色で highlight (キーボード操作対応)
//   - Web 限定で上下矢印 / Enter / Escape のキーボードナビゲーション
//     (RN では keyboard event を取れないため Web のみ)
//   - default export と named export の両方を提供 (柔軟性のため)
//
// 互換性:
//   props.input / candidates / onPick の interface は維持。
//   既存呼び出し側 (app/bbs/[id].tsx) は変更不要。
// ============================================================
import { useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import { Platform, ScrollView, View, Text } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { PressableScale } from '../ui/PressableScale';
import { similarity as damerauSimilarity } from '../../lib/search/typoCorrect';
import { deepNormalize } from '../../lib/search/tokenize';
import { C, GRAD, R, SP, SHADOW } from '../../design/tokens';
import { T } from '../../design/typography';

export type MentionTarget = { id: string; label: string }; // id = reply id or "#N", label = display

export interface MentionAutocompleteProps {
  input: string;
  candidates: MentionTarget[];
  onPick: (target: MentionTarget) => void;
  /** 候補一覧の最大表示数 (default: 12) */
  maxCandidates?: number;
}

// 1 行あたりの推定高さ。pill (paddingVertical 6 + line 18 + gap) で約 32–34px。
// 6 行ぶん見える高さを既定値とする (10+ になれば scroll で対応)。
const ROW_HEIGHT = 36;
const MAX_VISIBLE_ROWS = 6;

export function MentionAutocomplete({
  input,
  candidates,
  onPick,
  maxCandidates = 12,
}: MentionAutocompleteProps) {
  // input から最後の '@' 以降のトークンを抽出
  const token = useMemo(() => {
    const at = input.lastIndexOf('@');
    if (at === -1) return null;
    const after = input.slice(at + 1);
    if (after.includes(' ') || after.includes('\n')) return null;
    return after;
  }, [input]);

  const matches = useMemo(() => {
    if (token === null) return [];
    if (token.length === 0) return candidates.slice(0, maxCandidates);
    // deepNormalize で「マリン」「まりん」「Marine」を同一視
    const qn = deepNormalize(token);
    const scored = candidates
      .map((c) => {
        const ln = deepNormalize(c.label);
        let score = 0;
        if (ln === qn) score = 100;
        else if (ln.startsWith(qn)) score = 80;
        else if (ln.includes(qn)) score = 60;
        else {
          const sim = damerauSimilarity(qn, ln);
          if (sim >= 0.65) score = sim * 50;
        }
        return { c, score };
      })
      .filter((r) => r.score > 0);
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, maxCandidates).map((r) => r.c);
  }, [token, candidates, maxCandidates]);

  // ---- キーボードナビゲーション (Web 限定) ----
  // RN Web は <View> でも tabIndex を渡せば key event を受けられるが、
  // ここでは input 側の key event を観測する方が UX が良いため
  // window-level listener を使う。
  const [active, setActive] = useState(0);

  // matches が変わるたび active を 0 にリセット
  useEffect(() => {
    setActive(0);
  }, [matches]);

  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    if (matches.length === 0) return;
    const onKey = (e: KeyboardEvent) => {
      // BBS 返信 input にフォーカスがある時のみ反応させたいが、global 監視で十分。
      // どのみち matches.length===0 だと no-op。
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive((i) => (i + 1) % matches.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((i) => (i - 1 + matches.length) % matches.length);
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        // Enter / Tab で確定 — TextInput の改行と競合するため、
        // 確定後は onPick (Tab の場合は preventDefault) で TextInput 側の振る舞いを上書き。
        const target = matches[active];
        if (!target) return;
        e.preventDefault();
        onPick(target);
      } else if (e.key === 'Escape') {
        // 入力をクリアせず active のみ 0 戻し
        setActive(0);
      }
    };
    // capture: true で TextInput の onKeyPress より先に拾える
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [matches, active, onPick]);

  // active が変わったら scroll を追従させる
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    if (!scrollRef.current) return;
    scrollRef.current.scrollTo({ y: active * ROW_HEIGHT, animated: true });
  }, [active]);

  if (token === null || matches.length === 0) return null;

  const scrollNeeded = matches.length > MAX_VISIBLE_ROWS;
  const containerMaxHeight = MAX_VISIBLE_ROWS * ROW_HEIGHT + SP['4']; // padding 込みでざっくり

  return (
    <View
      // Gradient + glass で current design system に合わせる。
      // - 外側 View: rounded + 1px glass border + 紫 shadow (subtle)
      // - 内側 LinearGradient: glass tint (淡い紫→透明)
      // - rgba 背景 + dark base で擬似 glass (Web は backdrop-filter なしでも十分映える)
      style={{
        borderRadius: R.lg,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: C.glassBorder,
        backgroundColor: C.bg2,
        ...SHADOW.sm,
      }}
      // a11y: スクリーンリーダにはリスト box として認識させる
      accessibilityRole={Platform.OS === 'web' ? 'menu' : undefined}
      accessibilityLabel="メンション候補"
    >
      <LinearGradient
        colors={GRAD.glass}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ padding: SP['2'], gap: SP['1'] }}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingHorizontal: 4,
          }}
        >
          <Text style={[T.caption, { color: C.text3 }]}>@ メンション候補</Text>
          {Platform.OS === 'web' && matches.length > 1 ? (
            <Text style={[T.caption, { color: C.text4, fontSize: 11 }]}>
              ↑↓ / Enter
            </Text>
          ) : null}
        </View>

        <ScrollView
          ref={scrollRef}
          // 候補 10+ になっても縦スクロールで吸収。MAX_VISIBLE_ROWS を超えなければ
          // contentContainer の高さは自然と縮むので、ほぼ no-op。
          style={
            scrollNeeded ? { maxHeight: containerMaxHeight } : undefined
          }
          // chip をドラッグ中に下層 list が動かないよう keyboard を保持
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={scrollNeeded}
          // chip 群は wrap させたいので horizontal=false (default) のまま、
          // 内側を flexWrap row で並べる。
          nestedScrollEnabled
        >
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
            {matches.map((m, idx) => {
              const isActive = idx === active;
              return (
                <PressableScale
                  key={m.id}
                  onPress={() => onPick(m)}
                  // Web の hover で active を切り替える (mouse でも良い体験)。
                  onPressIn={() => {
                    if (Platform.OS === 'web') setActive(idx);
                  }}
                  haptic="select"
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 4,
                    paddingHorizontal: SP['2'],
                    paddingVertical: 6,
                    backgroundColor: isActive ? C.accentSoft : C.bg3,
                    borderRadius: R.full,
                    borderWidth: 1,
                    borderColor: isActive ? C.accent : C.border,
                    // active な chip は紫 glow を薄く乗せる
                    ...(isActive ? SHADOW.accentGlow : null),
                  }}
                  accessibilityState={{ selected: isActive }}
                  accessibilityLabel={`@${m.label}`}
                >
                  <Text
                    style={[
                      T.smallM,
                      { color: isActive ? C.accentLight : C.accent },
                    ]}
                  >
                    @{m.label}
                  </Text>
                </PressableScale>
              );
            })}
          </View>
        </ScrollView>
      </LinearGradient>
    </View>
  );
}

// default export も用意 (柔軟性のため — 既存 named import は維持)
export default MentionAutocomplete;
