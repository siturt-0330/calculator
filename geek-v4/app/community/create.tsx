import { View, Text, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, R, SP } from '@/design/tokens';
import { T } from '@/design/typography';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { BackButton } from '@/components/nav/BackButton';
import { PressableScale } from '@/components/ui/PressableScale';
import { Icon } from '@/constants/icons';
import { createCommunity, type Visibility } from '@/lib/api/communities';
import { useToastStore } from '@/stores/toastStore';

// よく使いそうな絵文字選択肢 — emoji picker は重いので固定リストで
const EMOJI_OPTIONS = [
  '👥', '🎮', '📚', '🎵', '🎨', '⚽', '🍙', '☕',
  '🌸', '🎬', '📷', '🎤', '💼', '🧑‍💻', '🏃', '🎯',
  '🐱', '🐶', '🦊', '🌍', '🔬', '⚙️', '✨', '🔥',
];

const COLOR_OPTIONS = [
  '#7C6AF7', // accent purple
  '#22D3A4', // green
  '#F5A623', // amber
  '#F472B6', // pink
  '#3B82F6', // blue
  '#E24B4A', // red
  '#9F96F9', // light purple
  '#cca87a', // beige
];

type VisibilityOption = {
  value: Visibility;
  label: string;
  desc: string;
  icon: React.ReactNode;
};

export default function CreateCommunityScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { show } = useToastStore();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [emoji, setEmoji] = useState('👥');
  const [color, setColor] = useState<string>(COLOR_OPTIONS[0] ?? '#7C6AF7');
  const [visibility, setVisibility] = useState<Visibility>('open');
  const [closedMode, setClosedMode] = useState<'request' | 'invite'>('request');
  const [tagInput, setTagInput] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const VISIBILITY_OPTIONS: VisibilityOption[] = [
    {
      value: 'open',
      label: 'オープン',
      desc: 'だれでも自由に参加できる。検索結果に表示される。',
      icon: <Icon.globe size={18} color={C.green} strokeWidth={2} />,
    },
    {
      value: 'request',
      label: 'クローズ・許可制',
      desc: '参加には承認が必要。検索結果には表示される。',
      icon: <Icon.lock size={18} color={C.amber} strokeWidth={2} />,
    },
    {
      value: 'invite',
      label: 'クローズ・完全招待制',
      desc: '検索結果に表示されない。招待リンクのみで参加可能。',
      icon: <Icon.shield size={18} color={C.red} strokeWidth={2} />,
    },
  ];

  const addTag = () => {
    const t = tagInput.trim().replace(/^#/, '');
    if (!t || tags.includes(t)) return;
    if (tags.length >= 10) {
      show('タグは 10 個までです', 'warn');
      return;
    }
    setTags([...tags, t]);
    setTagInput('');
  };

  const removeTag = (t: string) => setTags(tags.filter((x) => x !== t));

  const onSubmit = async () => {
    if (submitting) return;
    if (name.trim().length < 2) {
      show('コミュニティ名は 2 文字以上にしてください', 'warn');
      return;
    }
    if (name.trim().length > 40) {
      show('コミュニティ名は 40 文字以内にしてください', 'warn');
      return;
    }
    setSubmitting(true);
    // closed 配下では closedMode を選んだ方を渡す
    const v: Visibility = visibility === 'open' ? 'open' : closedMode;
    const { data, error } = await createCommunity({
      name,
      description,
      icon_emoji: emoji,
      icon_color: color,
      visibility: v,
      tags,
    });
    setSubmitting(false);
    if (error || !data) {
      show(error ?? 'コミュニティ作成に失敗しました', 'error');
      return;
    }
    show('コミュニティを作成しました！', 'success');
    router.replace(`/community/${data.id}` as never);
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={{ flex: 1, backgroundColor: C.bg }}
    >
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + SP['2'],
          paddingHorizontal: SP['5'],
          paddingBottom: insets.bottom + SP['10'],
          gap: SP['5'],
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
          <BackButton />
          <Text style={[T.h2, { color: C.text, flex: 1 }]}>新しいコミュニティ</Text>
        </View>

        {/* プレビュー */}
        <View
          style={{
            padding: SP['4'],
            backgroundColor: C.bg2,
            borderRadius: R.lg,
            borderWidth: 1,
            borderColor: C.border,
            alignItems: 'center',
            gap: SP['2'],
          }}
        >
          <View
            style={{
              width: 80,
              height: 80,
              borderRadius: 40,
              backgroundColor: color,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ fontSize: 44 }}>{emoji}</Text>
          </View>
          <Text style={[T.h3, { color: C.text }]} numberOfLines={1}>
            {name.trim() || '名前なし'}
          </Text>
          {description.trim().length > 0 && (
            <Text style={[T.small, { color: C.text3, textAlign: 'center' }]} numberOfLines={2}>
              {description}
            </Text>
          )}
        </View>

        {/* 名前 */}
        <View style={{ gap: SP['2'] }}>
          <Text style={[T.smallM, { color: C.text2 }]}>名前 (2 - 40 文字)</Text>
          <Input
            value={name}
            onChangeText={setName}
            placeholder="例: 関西ゲーム開発者"
            maxLength={40}
            autoFocus
            keyboardAppearance="dark"
            selectionColor={C.accent}
          />
        </View>

        {/* 説明 */}
        <View style={{ gap: SP['2'] }}>
          <Text style={[T.smallM, { color: C.text2 }]}>説明 (任意 / 最大 500 文字)</Text>
          <Input
            value={description}
            onChangeText={setDescription}
            placeholder="どんな話をする場所か"
            maxLength={500}
            multiline
            numberOfLines={4}
            keyboardAppearance="dark"
            selectionColor={C.accent}
            style={{ minHeight: 88, paddingTop: 12, textAlignVertical: 'top' }}
          />
        </View>

        {/* アイコン (絵文字) */}
        <View style={{ gap: SP['2'] }}>
          <Text style={[T.smallM, { color: C.text2 }]}>アイコン</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SP['2'] }}>
            {EMOJI_OPTIONS.map((e) => (
              <PressableScale
                key={e}
                onPress={() => setEmoji(e)}
                haptic="tap"
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 22,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: emoji === e ? color + '33' : C.bg2,
                  borderWidth: 2,
                  borderColor: emoji === e ? color : 'transparent',
                }}
              >
                <Text style={{ fontSize: 22 }}>{e}</Text>
              </PressableScale>
            ))}
          </View>
        </View>

        {/* 色 */}
        <View style={{ gap: SP['2'] }}>
          <Text style={[T.smallM, { color: C.text2 }]}>背景色</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SP['2'] }}>
            {COLOR_OPTIONS.map((c) => (
              <PressableScale
                key={c}
                onPress={() => setColor(c)}
                haptic="tap"
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 20,
                  backgroundColor: c,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderWidth: 3,
                  borderColor: color === c ? C.text : 'transparent',
                }}
              >
                {color === c && <Icon.ok size={18} color="#fff" strokeWidth={3} />}
              </PressableScale>
            ))}
          </View>
        </View>

        {/* タグ */}
        <View style={{ gap: SP['2'] }}>
          <Text style={[T.smallM, { color: C.text2 }]}>タグ (最大 10 個)</Text>
          <View style={{ flexDirection: 'row', gap: SP['2'] }}>
            <View style={{ flex: 1 }}>
              <Input
                icon={Icon.hash}
                value={tagInput}
                onChangeText={setTagInput}
                onSubmitEditing={addTag}
                placeholder="例: 就活 / 関西 / プログラミング"
                returnKeyType="done"
                keyboardAppearance="dark"
                selectionColor={C.accent}
              />
            </View>
            <PressableScale
              onPress={addTag}
              haptic="tap"
              disabled={!tagInput.trim()}
              style={{
                paddingHorizontal: SP['4'],
                height: 44,
                backgroundColor: tagInput.trim() ? C.accent : C.bg3,
                borderRadius: R.md,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: tagInput.trim() ? 1 : 0.5,
              }}
            >
              <Icon.plus size={18} color="#fff" strokeWidth={2.6} />
            </PressableScale>
          </View>
          {tags.length > 0 && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SP['1'] }}>
              {tags.map((t) => (
                <PressableScale
                  key={t}
                  onPress={() => removeTag(t)}
                  haptic="tap"
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 4,
                    paddingHorizontal: SP['3'],
                    paddingVertical: SP['1'],
                    backgroundColor: C.accentBg,
                    borderRadius: R.full,
                    borderWidth: 1,
                    borderColor: C.accent + '55',
                  }}
                >
                  <Text style={[T.caption, { color: C.accent, fontWeight: '600' }]}>#{t}</Text>
                  <Icon.close size={12} color={C.accent} strokeWidth={2.5} />
                </PressableScale>
              ))}
            </View>
          )}
        </View>

        {/* 公開設定 */}
        <View style={{ gap: SP['2'] }}>
          <Text style={[T.smallM, { color: C.text2 }]}>公開設定</Text>
          {VISIBILITY_OPTIONS.map((opt) => {
            const isClosed = opt.value !== 'open';
            const isSelected = isClosed
              ? visibility !== 'open' && closedMode === opt.value
              : visibility === 'open';
            return (
              <PressableScale
                key={opt.value}
                onPress={() => {
                  if (opt.value === 'open') {
                    setVisibility('open');
                  } else {
                    setVisibility('request'); // sentinel — closed flag
                    setClosedMode(opt.value);
                  }
                }}
                haptic="select"
                style={{
                  flexDirection: 'row',
                  gap: SP['3'],
                  padding: SP['3'],
                  backgroundColor: isSelected ? C.accentBg : C.bg2,
                  borderRadius: R.md,
                  borderWidth: 1.5,
                  borderColor: isSelected ? C.accent : C.border,
                  alignItems: 'flex-start',
                }}
              >
                <View
                  style={{
                    marginTop: 2,
                    width: 32,
                    height: 32,
                    borderRadius: 16,
                    backgroundColor: C.bg3,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {opt.icon}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[T.bodyMd, { color: C.text, fontWeight: '700' }]}>{opt.label}</Text>
                  <Text style={[T.caption, { color: C.text3, marginTop: 2 }]}>{opt.desc}</Text>
                </View>
                <View
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: 10,
                    borderWidth: 2,
                    borderColor: isSelected ? C.accent : C.text4,
                    backgroundColor: isSelected ? C.accent : 'transparent',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginTop: 4,
                  }}
                >
                  {isSelected && <Icon.ok size={12} color="#fff" strokeWidth={3} />}
                </View>
              </PressableScale>
            );
          })}
        </View>

        <Button
          label="コミュニティを作成"
          onPress={onSubmit}
          loading={submitting}
          disabled={submitting || name.trim().length < 2}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
