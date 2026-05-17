import { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTagFilterStore, DEFAULT_BLOCKED_TAGS } from '@/stores/tagFilterStore';
import { useTagGraphStore } from '@/stores/tagGraphStore';
import { useToastStore } from '@/stores/toastStore';
import { TopBar } from '@/components/nav/TopBar';
import { BackButton } from '@/components/nav/BackButton';
import { TagPill } from '@/components/tag/TagPill';
import { Input } from '@/components/ui/Input';
import { PressableScale } from '@/components/ui/PressableScale';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { TagInputSuggestions } from '@/components/tag/TagInputSuggestions';
import { buildTagSuggestions, REASON_LABEL } from '@/lib/utils/tagSuggest';
import { Icon } from '@/constants/icons';
import { C, R, SP } from '@/design/tokens';
import { T } from '@/design/typography';

const DEFAULT_SET = new Set<string>(DEFAULT_BLOCKED_TAGS);

export default function BlockedTagsSettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { likedTags, blockedTags, addBlocked, removeBlocked } = useTagFilterStore();
  const { nodes, rootIds, hydrate: hydrateGraph } = useTagGraphStore();
  const { show } = useToastStore();
  const [input, setInput] = useState('');
  const [resetOpen, setResetOpen] = useState(false);

  useEffect(() => { void hydrateGraph(); }, [hydrateGraph]);

  const handleAdd = () => {
    const t = input.trim().replace(/^#/, '');
    if (!t) return;
    if (blockedTags.includes(t)) {
      show('すでにブロック済みです', 'warn');
      return;
    }
    addBlocked(t);
    show(`「${t}」をブロックしました`, 'success');
    setInput('');
  };

  // デフォルトと追加分を分けて表示
  const defaultBlocked = useMemo(() => blockedTags.filter((t) => DEFAULT_SET.has(t)), [blockedTags]);
  const customBlocked = useMemo(() => blockedTags.filter((t) => !DEFAULT_SET.has(t)), [blockedTags]);

  // 関連タグ提案 (タグ連携)
  const blockSuggestions = useMemo(() => {
    const raw = buildTagSuggestions(blockedTags, nodes, rootIds, 24);
    return raw.filter(
      (s) => !likedTags.includes(s.tag) && !blockedTags.includes(s.tag),
    );
  }, [blockedTags, likedTags, nodes, rootIds]);

  // デフォルトに戻す: 全 default を再追加 (重複は無視される)
  const restoreDefaults = () => {
    let added = 0;
    for (const t of DEFAULT_BLOCKED_TAGS) {
      if (!blockedTags.includes(t)) {
        addBlocked(t);
        added++;
      }
    }
    show(`${added} 件のデフォルトタグを復元しました`, 'success');
  };

  const Hash = Icon.hash;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <TopBar title="ブロックするタグ" left={<BackButton />} />
      <ScrollView
        contentContainerStyle={{
          padding: SP['4'],
          paddingBottom: insets.bottom + SP['10'],
          gap: SP['4'],
        }}
        keyboardShouldPersistTaps="handled"
      >
        {/* 案内 */}
        <View style={{
          padding: SP['3'],
          backgroundColor: 'rgba(226,75,74,0.08)',
          borderRadius: R.md,
          borderWidth: 1,
          borderColor: 'rgba(226,75,74,0.3)',
          gap: SP['1'],
        }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={{ fontSize: 14 }}>🛡️</Text>
            <Text style={[T.smallM, { color: '#E24B4A', fontWeight: '700' }]}>
              ブロック中のタグを含む投稿はフィードに表示されません
            </Text>
          </View>
          <Text style={[T.caption, { color: C.text2, lineHeight: 16 }]}>
            計 {blockedTags.length} 件 ({defaultBlocked.length} 個デフォルト + {customBlocked.length} 個追加)
          </Text>
        </View>

        {/* 追加入力 */}
        <View style={{ gap: SP['2'] }}>
          <Text style={[T.smallM, { color: C.text2 }]}>新しくブロックするタグ</Text>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: SP['2'] }}>
            <View style={{ flex: 1 }}>
              <Input
                icon={Hash}
                placeholder="例: ネタバレ / 暴言 / マルチ商法"
                value={input}
                onChangeText={setInput}
                onSubmitEditing={handleAdd}
                returnKeyType="done"
                autoCapitalize="none"
              />
            </View>
            <PressableScale
              onPress={handleAdd}
              haptic="confirm"
              disabled={!input.trim()}
              style={{
                paddingHorizontal: SP['4'],
                height: 44,
                backgroundColor: input.trim() ? '#E24B4A' : C.bg3,
                borderRadius: R.md,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                opacity: input.trim() ? 1 : 0.5,
              }}
            >
              <Icon.plus size={18} color="#fff" strokeWidth={2.6} />
              <Text style={[T.smallM, { color: '#fff', fontWeight: '700' }]}>追加</Text>
            </PressableScale>
          </View>
          {/* リアルタイム類似タグ提案 */}
          <TagInputSuggestions
            input={input}
            excludeTags={[...likedTags, ...blockedTags]}
            onPick={(t) => { addBlocked(t); setInput(''); show(`「${t}」をブロック`, 'success'); }}
            variant="blocked"
          />
        </View>

        {/* 追加したカスタムタグ (先頭表示) */}
        {customBlocked.length > 0 && (
          <View style={{ gap: SP['2'] }}>
            <Text style={[T.smallM, { color: C.text2, fontWeight: '700' }]}>
              あなたが追加 ({customBlocked.length})
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SP['2'] }}>
              {customBlocked.map((t) => (
                <TagPill key={t} name={t} state="blocked" onPress={() => {
                  removeBlocked(t);
                  show(`「${t}」のブロックを解除`, 'info', { undoLabel: '元に戻す', onUndo: () => addBlocked(t) });
                }} />
              ))}
            </View>
          </View>
        )}

        {/* デフォルトタグ (常に全71個表示、active/inactive をトグル可能) */}
        <View style={{ gap: SP['2'] }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={{ fontSize: 12 }}>🛡️</Text>
            <Text style={[T.smallM, { color: C.text2, fontWeight: '700', flex: 1 }]}>
              安全のためデフォルトでブロック ({defaultBlocked.length}/{DEFAULT_BLOCKED_TAGS.length})
            </Text>
            {defaultBlocked.length < DEFAULT_BLOCKED_TAGS.length && (
              <PressableScale onPress={restoreDefaults} haptic="confirm">
                <Text style={[T.caption, { color: C.accent, fontWeight: '700' }]}>
                  全部ブロックに戻す
                </Text>
              </PressableScale>
            )}
          </View>
          <Text style={[T.caption, { color: C.text3 }]}>
            赤=ブロック中 / グレー=解除済み。タップで切り替えられます
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SP['2'] }}>
            {DEFAULT_BLOCKED_TAGS.map((t) => {
              const active = blockedTags.includes(t);
              return active ? (
                <TagPill key={t} name={t} state="blocked" onPress={() => {
                  removeBlocked(t);
                  show(`「${t}」のブロックを解除`, 'info', { undoLabel: '元に戻す', onUndo: () => addBlocked(t) });
                }} />
              ) : (
                <PressableScale
                  key={t}
                  onPress={() => {
                    addBlocked(t);
                    show(`「${t}」をブロック`, 'success');
                  }}
                  haptic="select"
                  style={{
                    paddingHorizontal: SP['3'],
                    paddingVertical: 4,
                    borderRadius: R.full,
                    backgroundColor: 'transparent',
                    borderWidth: 1,
                    borderColor: C.border,
                    opacity: 0.5,
                  }}
                >
                  <Text style={[T.small, { color: C.text3 }]}>#{t}</Text>
                </PressableScale>
              );
            })}
          </View>
        </View>

        {/* 関連ブロック候補 */}
        {blockSuggestions.length > 0 && (
          <View style={{
            padding: SP['3'],
            backgroundColor: C.bg2,
            borderRadius: R.md,
            borderWidth: 1,
            borderColor: C.border,
            gap: SP['2'],
          }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={{ fontSize: 14 }}>🔗</Text>
              <Text style={[T.smallM, { color: C.text, fontWeight: '700', flex: 1 }]}>
                これもブロックしますか？
              </Text>
              <PressableScale onPress={() => router.push('/oshi/tag-graph' as never)} haptic="tap">
                <Text style={[T.caption, { color: C.accent }]}>連携を編集</Text>
              </PressableScale>
            </View>
            <Text style={[T.caption, { color: C.text3 }]}>
              検索エンジン+タグ連携から関連を提案 ({blockSuggestions.length}件)
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {blockSuggestions.map((s) => {
                const meta = REASON_LABEL[s.reason];
                return (
                  <PressableScale
                    key={s.tag}
                    onPress={() => {
                      addBlocked(s.tag);
                      show(`「${s.tag}」をブロック`, 'success');
                    }}
                    haptic="confirm"
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 4,
                      paddingHorizontal: SP['3'],
                      paddingVertical: 6,
                      backgroundColor: 'rgba(226,75,74,0.13)',
                      borderRadius: R.full,
                      borderWidth: 1,
                      borderColor: 'rgba(226,75,74,0.4)',
                    }}
                  >
                    <Text style={{ fontSize: 11 }}>{meta.icon}</Text>
                    <Text style={[T.smallM, { color: '#E24B4A', fontWeight: '700' }]}>
                      {s.tag}
                    </Text>
                  </PressableScale>
                );
              })}
            </View>
            <PressableScale
              onPress={() => {
                let count = 0;
                for (const s of blockSuggestions) {
                  if (!blockedTags.includes(s.tag) && !likedTags.includes(s.tag)) {
                    addBlocked(s.tag);
                    count++;
                  }
                }
                if (count > 0) show(`${count}件をまとめてブロック`, 'success');
              }}
              haptic="confirm"
              style={{
                alignSelf: 'flex-start',
                marginTop: SP['1'],
                paddingHorizontal: SP['3'],
                paddingVertical: SP['1'],
                backgroundColor: 'rgba(226,75,74,0.20)',
                borderRadius: R.full,
                borderWidth: 1,
                borderColor: 'rgba(226,75,74,0.5)',
              }}
            >
              <Text style={[T.caption, { color: '#E24B4A', fontWeight: '700' }]}>
                🛡️ 上記をまとめてブロック
              </Text>
            </PressableScale>
          </View>
        )}

        {/* リセット (全クリア) */}
        {blockedTags.length > 0 && (
          <PressableScale
            onPress={() => setResetOpen(true)}
            haptic="warn"
            style={{
              alignSelf: 'center',
              marginTop: SP['4'],
              paddingHorizontal: SP['4'],
              paddingVertical: SP['2'],
              borderRadius: R.full,
              borderWidth: 1,
              borderColor: C.border,
              backgroundColor: C.bg2,
            }}
          >
            <Text style={[T.caption, { color: C.text3 }]}>
              全てのブロックを解除
            </Text>
          </PressableScale>
        )}
      </ScrollView>

      <ConfirmDialog
        visible={resetOpen}
        title="すべて解除しますか？"
        message={`${blockedTags.length} 件のブロックタグをすべて解除します。安全フィルタも外れます。`}
        confirmLabel="すべて解除"
        cancelLabel="キャンセル"
        destructive
        onCancel={() => setResetOpen(false)}
        onConfirm={() => {
          for (const t of [...blockedTags]) removeBlocked(t);
          setResetOpen(false);
          show('すべてのブロックを解除しました', 'info');
        }}
      />
    </View>
  );
}
