// ============================================================
// TagPickerSheet — 投稿に付けるタグを bottom sheet で選択
// ------------------------------------------------------------
// TikTok の hashtag picker 風: 検索 + 人気タグ + 最近使ったタグ。
//
// 設計判断:
//   - React Native Modal + Reanimated 3 (SlideInDown / SlideOutDown)
//     既存 WhyThisResult / EditHistoryModal と同じ pattern。
//     @gorhom/bottom-sheet 不要 (簡単化 + 親の visible state だけで操作)
//   - props.visible が true になった時点で props.currentTags を local draft に
//     複写し、その後の追加 / 削除は draft 側でのみ操作。保存タップで
//     onSubmit(draft) を呼んで親に流す。close (×, backdrop) は draft 破棄。
//   - 最近使ったタグは lib/storage.ts の MMKV / localStorage 同期 wrapper を
//     使い、JSON 配列で保持 (key: RECENT_TAGS_KEY)。
//     保存時に LRU upsert (最大 RECENT_TAGS_MAX = 10)。
//   - 人気タグは static (約 20 個)。query にマッチしたものはハイライト。
//   - 既選択 chip は disabled スタイル (薄く + 押せない) で重複追加を防ぐ。
//   - maxTags 到達したら inline message + 追加ボタンを disabled に。
//   - dark / light どちらでも見えるよう useColors() で配色。
// ============================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, {
  FadeIn,
  FadeOut,
  SlideInDown,
  SlideOutDown,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '../../constants/icons';
import { useColors } from '../../hooks/useColors';
import { T } from '../../design/typography';
import { R, SP } from '../../design/tokens';
import { hapticPresets } from '../../lib/haptics';
import { getJson, setJson } from '../../lib/storage';

// ============================================================
// constants
// ============================================================

/** 人気タグの static リスト (TikTok 風: 1 タップで追加できる候補) */
const POPULAR_TAGS: readonly string[] = [
  '雑談',
  '日常',
  'ニュース',
  '画像',
  '動画',
  'ゲーム',
  'アニメ',
  '漫画',
  '音楽',
  'カフェ',
  '料理',
  '旅行',
  '本',
  '映画',
  'スポーツ',
  '勉強',
  '仕事',
  '健康',
  '趣味',
  'ペット',
] as const;

/** 最近使ったタグの MMKV / localStorage key */
const RECENT_TAGS_KEY = 'geek:recent_post_tags';

/** 最近使ったタグの保持上限 (LRU 古いものから drop) */
const RECENT_TAGS_MAX = 10;

/** デフォルト maxTags (props で上書き可) */
const DEFAULT_MAX_TAGS = 5;

/** 入力タグの最大長 (DB 側制約と整合) */
const TAG_MAX_LEN = 32;

// ============================================================
// helpers
// ============================================================

/**
 * 入力タグの正規化:
 *   - 先頭 # を除去
 *   - 前後 trim
 *   - 全角空白 → 半角空白 → さらに削除 (空白を含むタグは弾く方針)
 *   - 32 文字で truncate
 */
function normalizeTag(raw: string): string {
  return raw
    .replace(/^#+/, '')
    .replace(/[　\s]+/g, '')
    .trim()
    .slice(0, TAG_MAX_LEN);
}

/** MMKV から最近使ったタグを読む。配列でなければ空配列扱い */
function loadRecentTags(): string[] {
  const raw = getJson<unknown>(RECENT_TAGS_KEY);
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is string => typeof v === 'string' && v.length > 0);
}

/**
 * 保存時に最近使ったタグを LRU で upsert する。
 * - 既存にあれば最前に移動
 * - 新規ならば先頭に追加して 10 件で打ち切り
 */
function persistRecentTags(submitted: readonly string[]): void {
  if (submitted.length === 0) return;
  const prev = loadRecentTags();
  // 新しいものを先頭に + 既存から重複除去 → 上限 cap
  const seen = new Set<string>();
  const next: string[] = [];
  for (const t of submitted) {
    if (seen.has(t)) continue;
    seen.add(t);
    next.push(t);
  }
  for (const t of prev) {
    if (seen.has(t)) continue;
    seen.add(t);
    next.push(t);
  }
  setJson(RECENT_TAGS_KEY, next.slice(0, RECENT_TAGS_MAX));
}

// ============================================================
// props
// ============================================================

type Props = {
  visible: boolean;
  onClose: () => void;
  currentTags: string[];
  onSubmit: (tags: string[]) => void;
  maxTags?: number;
};

// ============================================================
// TagPickerSheet
// ============================================================

export function TagPickerSheet({
  visible,
  onClose,
  currentTags,
  onSubmit,
  maxTags = DEFAULT_MAX_TAGS,
}: Props) {
  const C = useColors();
  const insets = useSafeAreaInsets();

  // local draft — visible true で props.currentTags から復元する
  const [draft, setDraft] = useState<string[]>(() => [...currentTags]);
  const [query, setQuery] = useState<string>('');
  const [recent, setRecent] = useState<string[]>([]);

  // sheet が open になった瞬間、外部 currentTags と recent をスナップショット
  useEffect(() => {
    if (!visible) return;
    setDraft([...currentTags]);
    setQuery('');
    setRecent(loadRecentTags());
  }, [visible, currentTags]);

  const draftSet = useMemo(() => new Set(draft), [draft]);
  const reachedMax = draft.length >= maxTags;

  /** タグを draft に追加する。既に含まれている / max 到達なら no-op */
  const addTag = useCallback(
    (raw: string) => {
      const normalized = normalizeTag(raw);
      if (normalized.length === 0) return;
      if (draftSet.has(normalized)) return;
      if (draft.length >= maxTags) {
        hapticPresets.warning();
        return;
      }
      hapticPresets.light();
      setDraft((prev) => [...prev, normalized]);
    },
    [draft.length, draftSet, maxTags],
  );

  /** draft から 1 件削除する */
  const removeTag = useCallback((tag: string) => {
    hapticPresets.warning();
    setDraft((prev) => prev.filter((t) => t !== tag));
  }, []);

  /** input から enter / submit ボタンで現在の query を確定する */
  const submitQuery = useCallback(() => {
    const normalized = normalizeTag(query);
    if (normalized.length === 0) return;
    addTag(normalized);
    setQuery('');
  }, [addTag, query]);

  /** 保存 — onSubmit + recent 更新 + onClose */
  const handleSave = useCallback(() => {
    hapticPresets.success();
    persistRecentTags(draft);
    onSubmit(draft);
    onClose();
  }, [draft, onClose, onSubmit]);

  /** × や backdrop で閉じる — draft 破棄 */
  const handleClose = useCallback(() => {
    hapticPresets.light();
    onClose();
  }, [onClose]);

  // ============================================================
  // suggestion フィルタ
  // ============================================================
  const normalizedQuery = useMemo(() => normalizeTag(query).toLowerCase(), [query]);
  const queryActive = normalizedQuery.length > 0;

  /** 人気タグから query にマッチするものを抽出 (highlight 対象も同一集合) */
  const filteredPopular = useMemo(() => {
    if (!queryActive) return POPULAR_TAGS;
    return POPULAR_TAGS.filter((t) => t.toLowerCase().includes(normalizedQuery));
  }, [normalizedQuery, queryActive]);

  /** 入力中の query を新規タグ候補として最上部に出す (人気/最近に既存があれば skip) */
  const showCreateRow = useMemo(() => {
    if (!queryActive) return false;
    if (draftSet.has(normalizedQuery)) return false;
    // 既存 static 人気タグと完全一致なら create を出さない (それを使う方が自然)
    return !POPULAR_TAGS.some((t) => t.toLowerCase() === normalizedQuery);
  }, [draftSet, normalizedQuery, queryActive]);

  return (
    <Modal
      transparent
      visible={visible}
      animationType="none"
      onRequestClose={handleClose}
      presentationStyle="overFullScreen"
    >
      <Animated.View
        entering={FadeIn.duration(180)}
        exiting={FadeOut.duration(140)}
        style={{
          flex: 1,
          backgroundColor: C.scrim,
          justifyContent: 'flex-end',
        }}
      >
        {/* backdrop — tap で close (draft 破棄) */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="閉じる"
          onPress={handleClose}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
        />

        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ width: '100%' }}
        >
          <Animated.View
            entering={SlideInDown.duration(260)}
            exiting={SlideOutDown.duration(200)}
            style={{
              backgroundColor: C.bg2,
              borderTopLeftRadius: R.xl,
              borderTopRightRadius: R.xl,
              borderTopWidth: 1,
              borderTopColor: C.border,
              paddingBottom: insets.bottom + SP['3'],
              maxHeight: '92%',
            }}
          >
            {/* ===== drag indicator ===== */}
            <View style={{ alignItems: 'center', paddingTop: SP['2'] }}>
              <View
                style={{
                  width: 36,
                  height: 4,
                  borderRadius: 2,
                  backgroundColor: C.text4,
                }}
              />
            </View>

            {/* ===== header (title + close) ===== */}
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                paddingHorizontal: SP['5'],
                paddingTop: SP['3'],
                paddingBottom: SP['3'],
              }}
            >
              <Text style={[T.h3, { color: C.text, flex: 1 }]}>タグを追加</Text>
              <Pressable
                onPress={handleClose}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel="閉じる"
                style={({ pressed }) => ({
                  width: 32,
                  height: 32,
                  borderRadius: 16,
                  backgroundColor: pressed ? C.bg4 : C.bg3,
                  alignItems: 'center',
                  justifyContent: 'center',
                })}
              >
                <Icon.close size={18} color={C.text2} strokeWidth={2.2} />
              </Pressable>
            </View>

            {/* ===== current draft chips ===== */}
            <View
              style={{
                paddingHorizontal: SP['5'],
                paddingBottom: SP['3'],
              }}
            >
              <Text
                style={[
                  T.captionM,
                  { color: C.text3, marginBottom: SP['2'] },
                ]}
              >
                選択中 {draft.length} / {maxTags}
              </Text>
              {draft.length === 0 ? (
                <Text style={[T.small, { color: C.text4 }]}>
                  下から選ぶか、検索欄に入力して追加
                </Text>
              ) : (
                <View
                  style={{
                    flexDirection: 'row',
                    flexWrap: 'wrap',
                    gap: SP['2'],
                  }}
                >
                  {draft.map((tag) => (
                    <SelectedTagChip
                      key={tag}
                      tag={tag}
                      onRemove={() => removeTag(tag)}
                      accentBg={C.accent}
                      accentFg="#ffffff"
                    />
                  ))}
                </View>
              )}
              {reachedMax && (
                <Text
                  style={[
                    T.caption,
                    { color: C.amber, marginTop: SP['2'] },
                  ]}
                >
                  これ以上追加できません ({maxTags} 件まで)
                </Text>
              )}
            </View>

            {/* ===== search input ===== */}
            <View style={{ paddingHorizontal: SP['5'], paddingBottom: SP['3'] }}>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  backgroundColor: C.bg3,
                  borderRadius: R.lg,
                  borderWidth: 1,
                  borderColor: C.border,
                  paddingHorizontal: SP['3'],
                  height: 44,
                  gap: SP['2'],
                }}
              >
                <Icon.search size={18} color={C.text3} strokeWidth={2.2} />
                <TextInput
                  value={query}
                  onChangeText={setQuery}
                  onSubmitEditing={submitQuery}
                  returnKeyType="done"
                  placeholder="タグを検索 or 入力"
                  placeholderTextColor={C.text4}
                  autoCapitalize="none"
                  autoCorrect={false}
                  selectionColor={C.accent}
                  cursorColor={C.accent}
                  maxLength={TAG_MAX_LEN}
                  style={{
                    flex: 1,
                    color: C.text,
                    fontSize: 15,
                    padding: 0,
                    ...(Platform.OS === 'web'
                      ? ({ outlineStyle: 'none' } as object)
                      : null),
                  }}
                />
                {query.length > 0 && (
                  <Pressable
                    onPress={() => setQuery('')}
                    accessibilityRole="button"
                    accessibilityLabel="入力をクリア"
                    hitSlop={10}
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: 11,
                      backgroundColor: C.bg4,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Icon.close size={12} color={C.text2} strokeWidth={2.4} />
                  </Pressable>
                )}
              </View>
            </View>

            {/* ===== suggestions ===== */}
            <ScrollView
              style={{ flexGrow: 0 }}
              contentContainerStyle={{
                paddingHorizontal: SP['5'],
                paddingBottom: SP['3'],
                gap: SP['4'],
              }}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {/* 1) 入力中タグの新規作成 (人気・既選択に無いとき) */}
              {showCreateRow && (
                <View>
                  <Text
                    style={[
                      T.captionM,
                      { color: C.text3, marginBottom: SP['2'] },
                    ]}
                  >
                    新しいタグ
                  </Text>
                  <View
                    style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SP['2'] }}
                  >
                    <SuggestionChip
                      label={normalizedQuery}
                      onPress={() => {
                        addTag(normalizedQuery);
                        setQuery('');
                      }}
                      selected={false}
                      disabled={reachedMax}
                      isCreate
                      C={C}
                    />
                  </View>
                </View>
              )}

              {/* 2) 人気タグ — query で highlight (filter) */}
              {filteredPopular.length > 0 && (
                <View>
                  <Text
                    style={[
                      T.captionM,
                      { color: C.text3, marginBottom: SP['2'] },
                    ]}
                  >
                    人気タグ
                  </Text>
                  <View
                    style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SP['2'] }}
                  >
                    {filteredPopular.map((tag) => {
                      const selected = draftSet.has(tag);
                      return (
                        <SuggestionChip
                          key={`popular:${tag}`}
                          label={tag}
                          onPress={() => addTag(tag)}
                          selected={selected}
                          disabled={selected || (reachedMax && !selected)}
                          C={C}
                        />
                      );
                    })}
                  </View>
                </View>
              )}

              {/* 3) 最近使ったタグ (storage にあれば) */}
              {recent.length > 0 && (
                <View>
                  <Text
                    style={[
                      T.captionM,
                      { color: C.text3, marginBottom: SP['2'] },
                    ]}
                  >
                    最近使ったタグ
                  </Text>
                  <View
                    style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SP['2'] }}
                  >
                    {recent.map((tag) => {
                      const selected = draftSet.has(tag);
                      return (
                        <SuggestionChip
                          key={`recent:${tag}`}
                          label={tag}
                          onPress={() => addTag(tag)}
                          selected={selected}
                          disabled={selected || (reachedMax && !selected)}
                          C={C}
                        />
                      );
                    })}
                  </View>
                </View>
              )}

              {/* query が活きていて何もマッチしなかった場合の空 hint */}
              {queryActive &&
                filteredPopular.length === 0 &&
                !showCreateRow && (
                  <Text
                    style={[
                      T.small,
                      { color: C.text4, textAlign: 'center', paddingVertical: SP['4'] },
                    ]}
                  >
                    一致する候補はありません
                  </Text>
                )}
            </ScrollView>

            {/* ===== bottom: save button ===== */}
            <View
              style={{
                paddingHorizontal: SP['5'],
                paddingTop: SP['2'],
                paddingBottom: SP['2'],
                borderTopWidth: 1,
                borderTopColor: C.divider,
              }}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="タグを保存"
                onPress={handleSave}
                style={({ pressed }) => ({
                  height: 50,
                  borderRadius: R.lg,
                  backgroundColor: pressed ? C.accentDeep : C.accent,
                  alignItems: 'center',
                  justifyContent: 'center',
                })}
              >
                <Text style={[T.buttonLg, { color: '#ffffff' }]}>保存</Text>
              </Pressable>
            </View>
          </Animated.View>
        </KeyboardAvoidingView>
      </Animated.View>
    </Modal>
  );
}

// ============================================================
// SelectedTagChip — 選択中タグ chip (「#xxx ×」削除可)
// ============================================================
type SelectedTagChipProps = {
  tag: string;
  onRemove: () => void;
  accentBg: string;
  accentFg: string;
};

function SelectedTagChip({
  tag,
  onRemove,
  accentBg,
  accentFg,
}: SelectedTagChipProps) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        height: 32,
        paddingLeft: 14,
        paddingRight: 10,
        gap: 6,
        borderRadius: R.full,
        backgroundColor: accentBg,
      }}
    >
      <Text
        style={[
          T.smallB,
          { color: accentFg, lineHeight: 18 },
        ]}
        numberOfLines={1}
      >
        #{tag}
      </Text>
      <Pressable
        onPress={onRemove}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={`#${tag} を削除`}
        style={{
          width: 18,
          height: 18,
          borderRadius: 9,
          backgroundColor: 'rgba(255,255,255,0.22)',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon.close size={11} color={accentFg} strokeWidth={2.6} />
      </Pressable>
    </View>
  );
}

// ============================================================
// SuggestionChip — 人気タグ / 最近使った / create のいずれかの chip
// ============================================================
type SuggestionChipProps = {
  label: string;
  onPress: () => void;
  selected: boolean;
  disabled: boolean;
  isCreate?: boolean;
  // useColors() の戻り値を呼び元で 1 度だけ評価して chip に渡す。
  C: ReturnType<typeof useColors>;
};

function SuggestionChip({
  label,
  onPress,
  selected,
  disabled,
  isCreate,
  C,
}: SuggestionChipProps) {
  // 状態別の配色:
  //   - selected (既選択): accent bg + 文字白 (押せない)
  //   - disabled (max 到達): 灰 bg + 薄文字
  //   - create   : accent border + accent 文字
  //   - default  : text2 系の subtle bg + 通常文字
  let bg: string;
  let fg: string;
  let borderColor: string | undefined;
  if (selected) {
    bg = C.accentBg;
    fg = C.accent;
    borderColor = C.accentSoft;
  } else if (disabled) {
    bg = C.bg3;
    fg = C.text4;
    borderColor = C.border;
  } else if (isCreate) {
    bg = 'transparent';
    fg = C.accent;
    borderColor = C.accent;
  } else {
    bg = C.bg3;
    fg = C.text;
    borderColor = C.border;
  }

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityLabel={selected ? `#${label} は選択済み` : `#${label} を追加`}
      accessibilityState={{ disabled, selected }}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        height: 32,
        paddingHorizontal: 14,
        borderRadius: R.full,
        backgroundColor: pressed && !disabled ? C.bg4 : bg,
        borderWidth: 1,
        borderColor: borderColor ?? 'transparent',
        opacity: disabled && !selected ? 0.55 : 1,
      })}
    >
      {isCreate && (
        <Text
          style={{
            color: fg,
            fontSize: 13,
            fontWeight: '700',
            marginRight: 4,
          }}
        >
          ＋
        </Text>
      )}
      <Text
        style={[
          T.smallM,
          {
            color: fg,
            lineHeight: 18,
            fontWeight: selected || isCreate ? '700' : '600',
          },
        ]}
        numberOfLines={1}
      >
        #{label}
      </Text>
    </Pressable>
  );
}
