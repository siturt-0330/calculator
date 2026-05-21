import { View, Text, ScrollView, KeyboardAvoidingView, Platform, Image, ActivityIndicator } from 'react-native';
import { useState, useEffect, useRef, useMemo } from 'react';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { useQuery } from '@tanstack/react-query';
import { C, R, SP } from '../../../design/tokens';
import { T } from '../../../design/typography';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { BackButton } from '../../../components/nav/BackButton';
import { PressableScale } from '../../../components/ui/PressableScale';
import { Icon } from '../../../constants/icons';
import {
  createCommunity,
  searchByName,
  uploadCommunityIcon,
  updateCommunity,
  type Visibility,
  type Community,
} from '../../../lib/api/communities';
import { useToastStore } from '../../../stores/toastStore';
import { supabase } from '../../../lib/supabase';
import { useDebounce } from '../../../hooks/useDebounce';
import { deepNormalize } from '../../../lib/search/tokenize';

type VisibilityOption = {
  value: Visibility | 'request' | 'invite';
  label: string;
  desc: string;
  icon: React.ReactNode;
};

import { prepareImageUpload } from '../../../lib/image';
import { openCropper } from '../../../lib/imageCropper';

export default function CreateCommunityScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { show } = useToastStore();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  // ローカルでアップロード待ちの画像 (URI + blob)
  const [localIconUri, setLocalIconUri] = useState<string | null>(null);
  const [localIconBlob, setLocalIconBlob] = useState<Blob | null>(null);
  const [localIconMime, setLocalIconMime] = useState<string>('image/jpeg');
  const [iconLoading, setIconLoading] = useState(false);
  const [visibility, setVisibility] = useState<Visibility>('open');
  const [closedMode, setClosedMode] = useState<'request' | 'invite'>('request');
  const [tagInput, setTagInput] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // タグ補完: query が短いときは早めに反応 (100ms)、長くなったら 150ms debounce
  const debouncedTagQuery = useDebounce(tagInput, tagInput.trim().length <= 2 ? 100 : 150);

  // tags テーブルから ilike '%query%' + post_count 降順で取得
  const { data: tagSuggestions = [] } = useQuery({
    queryKey: ['community-create-tag-suggestions', debouncedTagQuery.trim()],
    queryFn: async () => {
      const q = debouncedTagQuery.trim().replace(/^#/, '');
      if (!q) return [];
      // ilike は post_count 降順だが、deepNormalize の同義を逃すので
      // 50 件取って client 側で deepNormalize 一致を優先表示する.
      const { data } = await supabase
        .from('tags')
        .select('name, post_count')
        .ilike('name', `%${q}%`)
        .order('post_count', { ascending: false })
        .limit(50);
      const rows = (data ?? []) as { name: string; post_count: number }[];
      // ひらがな / カタカナ / 半角 などの違いで ilike では落ちる候補も拾う
      // (ilike 結果 50 件のうち、deepNormalize で部分一致するもののみ採用)
      const nq = deepNormalize(q);
      const matched = rows.filter((r) => deepNormalize(r.name).includes(nq));
      return matched.slice(0, 8);
    },
    staleTime: 30_000,
    enabled: debouncedTagQuery.trim().length > 0,
  });

  // タグ追加候補に「新しいタグ "#{query}" を作る」を出すかどうか
  // - 入力されていて
  // - 候補に同名 (deepNormalize 一致) が無い
  // - 既に選択済みに無い
  const showCreateNewTag = useMemo(() => {
    const q = debouncedTagQuery.trim().replace(/^#/, '');
    if (!q) return false;
    const nq = deepNormalize(q);
    if (tags.some((t) => deepNormalize(t) === nq)) return false;
    if (tagSuggestions.some((s) => deepNormalize(s.name) === nq)) return false;
    return true;
  }, [debouncedTagQuery, tagSuggestions, tags]);

  // 類似名チェック (短いクエリ 150ms / 通常 200ms debounce)
  const [similar, setSimilar] = useState<Community[]>([]);
  const [checking, setChecking] = useState(false);
  const lastQueryRef = useRef('');
  useEffect(() => {
    const q = name.trim();
    if (q.length < 2) {
      setSimilar([]);
      return;
    }
    lastQueryRef.current = q;
    setChecking(true);
    const delay = q.length <= 3 ? 150 : 200;
    const t = setTimeout(async () => {
      const results = await searchByName(q, 5);
      // race condition 防止 — 最後のクエリと一致しているかチェック
      if (lastQueryRef.current === q) {
        setSimilar(results);
        setChecking(false);
      }
    }, delay);
    return () => clearTimeout(t);
  }, [name]);

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

  const pickIcon = async () => {
    if (iconLoading || submitting) return;
    setIconLoading(true);
    try {
      if (Platform.OS !== 'web') {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) {
          show('写真へのアクセス権限が必要です', 'warn');
          setIconLoading(false);
          return;
        }
      }
      const r = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: 'images',
        // allowsEditing は使わない — 自前 circular cropper で UX を統一
        quality: 1,
      });
      if (r.canceled || !r.assets[0]) {
        setIconLoading(false);
        return;
      }
      const asset = r.assets[0];
      // 自前の circular cropper を開いて切り抜く
      // 注: openCropper 中は loading state を一度解除しないと
      //     UI 上 spinner が出っぱなしになるので setIconLoading(false) する
      setIconLoading(false);
      const croppedUri = await openCropper(asset.uri);
      if (!croppedUri) return; // cancelled
      setIconLoading(true);
      // prepareImageUpload: EXIF 除去 + magic byte 検証 + size check (5MB)
      let prepared;
      try {
        prepared = await prepareImageUpload(croppedUri, {
          maxSizeBytes: 5 * 1024 * 1024,
          maxWidth: 512, // アイコンなので大きすぎないように
          maxHeight: 512,
          quality: 0.85,
        });
      } catch (e) {
        show(e instanceof Error ? e.message : '画像処理に失敗しました', 'warn');
        setIconLoading(false);
        return;
      }
      setLocalIconUri(croppedUri);
      setLocalIconBlob(prepared.blob);
      setLocalIconMime(prepared.mime);
      show('アイコンを切り抜きました', 'success');
    } catch (e) {
      console.warn('[community/create] pick icon failed:', e);
      show('画像の取得に失敗しました', 'error');
    } finally {
      setIconLoading(false);
    }
  };

  const removeIcon = () => {
    setLocalIconUri(null);
    setLocalIconBlob(null);
  };

  const addTagByName = (raw: string) => {
    const t = raw.trim().replace(/^#/, '');
    if (!t) return;
    // deepNormalize 一致のものは既存とみなす (例: 「ポケモン」と「ぽけもん」)
    const nq = deepNormalize(t);
    if (tags.some((x) => deepNormalize(x) === nq)) {
      setTagInput('');
      return;
    }
    if (tags.length >= 10) {
      show('タグは最大 10 個まで', 'warn');
      return;
    }
    setTags([...tags, t]);
    setTagInput('');
  };

  const addTag = () => addTagByName(tagInput);

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
    if (!localIconBlob) {
      show('アイコン画像を選択してください', 'warn');
      return;
    }
    setSubmitting(true);
    const v: Visibility = visibility === 'open' ? 'open' : closedMode;
    // Step 1: row を INSERT (icon_url なし)
    const { data: created, error } = await createCommunity({
      name,
      description,
      icon_emoji: '👥', // placeholder
      icon_color: '#7C6AF7', // placeholder
      visibility: v,
      tags,
    });
    if (error || !created) {
      setSubmitting(false);
      show(error ?? 'コミュニティ作成に失敗しました', 'error');
      return;
    }
    // Step 2: アイコンアップロード — 失敗しても community は出来ているので警告だけ
    const { url, error: upErr } = await uploadCommunityIcon(created.id, localIconBlob, localIconMime);
    if (upErr || !url) {
      console.warn('[community/create] icon upload failed:', upErr);
      show('コミュニティは作成されましたがアイコンアップロードに失敗しました。詳細画面から再設定できます。', 'warn');
      setSubmitting(false);
      router.replace(`/community/${created.id}` as never);
      return;
    }
    // Step 3: icon_url を反映
    await updateCommunity(created.id, { icon_url: url });
    setSubmitting(false);
    show('コミュニティを作成しました！', 'success');
    router.replace(`/community/${created.id}` as never);
  };

  // Preview avatar — uploaded image or fallback
  const previewAvatar = (
    <View
      style={{
        width: 96,
        height: 96,
        borderRadius: 48,
        backgroundColor: C.bg3,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: C.border,
      }}
    >
      {localIconUri ? (
        <Image source={{ uri: localIconUri }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
      ) : (
        <Icon.image size={40} color={C.text4} strokeWidth={1.6} />
      )}
    </View>
  );

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
          <Text style={[T.h2, { color: C.text, flex: 1 }]} numberOfLines={1}>
            新しいコミュニティ
          </Text>
        </View>

        {/* プレビュー + アイコン操作 */}
        <View
          style={{
            padding: SP['4'],
            backgroundColor: C.bg2,
            borderRadius: R.lg,
            borderWidth: 1,
            borderColor: C.border,
            alignItems: 'center',
            gap: SP['3'],
          }}
        >
          {previewAvatar}
          <View style={{ flexDirection: 'row', gap: SP['2'] }}>
            <PressableScale
              onPress={pickIcon}
              haptic="tap"
              hitSlop={8}
              disabled={iconLoading || submitting}
              style={{
                paddingHorizontal: SP['4'],
                paddingVertical: SP['2'],
                backgroundColor: C.accent,
                borderRadius: R.full,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                opacity: iconLoading ? 0.6 : 1,
              }}
            >
              {iconLoading ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Icon.image size={16} color="#fff" strokeWidth={2.4} />
              )}
              <Text style={[T.smallM, { color: '#fff', fontWeight: '700' }]}>
                {localIconUri ? '変更' : 'アイコンを選ぶ'}
              </Text>
            </PressableScale>
            {localIconUri && (
              <PressableScale
                onPress={removeIcon}
                haptic="tap"
                hitSlop={8}
                style={{
                  paddingHorizontal: SP['4'],
                  paddingVertical: SP['2'],
                  borderRadius: R.full,
                  borderWidth: 1,
                  borderColor: C.border,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <Icon.close size={14} color={C.text2} strokeWidth={2.4} />
                <Text style={[T.smallM, { color: C.text2 }]}>削除</Text>
              </PressableScale>
            )}
          </View>
          <Text style={[T.caption, { color: C.text3, textAlign: 'center' }]}>
            写真 / 画像ファイル (JPEG / PNG / WebP / GIF · 5MB まで)
          </Text>
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
          {/* 類似名チェック結果 */}
          {checking && name.trim().length >= 2 && (
            <Text style={[T.caption, { color: C.text3 }]}>類似名を検索中…</Text>
          )}
          {!checking && similar.length > 0 && (
            <View
              style={{
                padding: SP['3'],
                backgroundColor: C.amberBg,
                borderRadius: R.md,
                borderWidth: 1,
                borderColor: C.amber + '55',
                gap: SP['2'],
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Icon.warn size={14} color={C.amber} strokeWidth={2.4} />
                <Text style={[T.smallM, { color: C.amber, fontWeight: '700', flex: 1 }]}>
                  似た名前のコミュニティが {similar.length} 件あります
                </Text>
              </View>
              <Text style={[T.caption, { color: C.text2 }]}>
                参加した方が早いかも。タップして確認:
              </Text>
              {similar.map((c) => (
                <PressableScale
                  key={c.id}
                  onPress={() => router.push(`/community/${c.id}` as never)}
                  haptic="tap"
                  scaleValue={0.98}
                  hitSlop={4}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: SP['2'],
                    padding: SP['2'],
                    backgroundColor: C.bg2,
                    borderRadius: R.md,
                  }}
                >
                  <View
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 16,
                      backgroundColor: c.icon_url ? C.bg3 : c.icon_color,
                      overflow: 'hidden',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {c.icon_url ? (
                      <Image source={{ uri: c.icon_url }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
                    ) : (
                      <Text style={{ fontSize: 16 }}>{c.icon_emoji}</Text>
                    )}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[T.smallM, { color: C.text, fontWeight: '600' }]} numberOfLines={1}>
                      {c.name}
                    </Text>
                    <Text style={[T.caption, { color: C.text3 }]} numberOfLines={1}>
                      メンバー {c.member_count.toLocaleString('ja-JP')} 人
                    </Text>
                  </View>
                  <Icon.chevronR size={16} color={C.text3} strokeWidth={2} />
                </PressableScale>
              ))}
            </View>
          )}
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
            style={{ minHeight: 72, textAlignVertical: 'top' }}
          />
        </View>

        {/* タグ — autocomplete */}
        <View style={{ gap: SP['2'] }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['1'] }}>
            <Text style={[T.smallM, { color: C.text2, flex: 1 }]}>タグ (最大 10 個)</Text>
            {tags.length > 0 && (
              <Text style={[T.caption, { color: C.text3 }]}>{tags.length} / 10</Text>
            )}
          </View>

          {/* 選択済み pills (上に表示) */}
          {tags.length > 0 && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SP['1'] }}>
              {tags.map((t) => (
                <PressableScale
                  key={t}
                  onPress={() => removeTag(t)}
                  haptic="tap"
                  hitSlop={4}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 4,
                    paddingHorizontal: SP['3'],
                    paddingVertical: 4,
                    backgroundColor: C.accentBg,
                    borderRadius: R.full,
                    borderWidth: 1,
                    borderColor: C.accentSoft,
                  }}
                >
                  <Text style={[T.caption, { color: C.accentLight, fontWeight: '700' }]}>
                    #{t}
                  </Text>
                  <Icon.close size={12} color={C.accentLight} strokeWidth={2.5} />
                </PressableScale>
              ))}
            </View>
          )}

          {/* 検索 input */}
          <Input
            icon={Icon.hash}
            value={tagInput}
            onChangeText={setTagInput}
            onSubmitEditing={addTag}
            placeholder="タグを検索 (アニメ、ゲーム…)"
            returnKeyType="done"
            keyboardAppearance="dark"
            selectionColor={C.accent}
            autoCapitalize="none"
            autoCorrect={false}
          />

          {/* サジェスト一覧 (input が空でない時のみ) */}
          {tagInput.trim().length > 0 && (tagSuggestions.length > 0 || showCreateNewTag) && (
            <View
              style={{
                backgroundColor: C.bg2,
                borderRadius: R.lg,
                borderWidth: 1,
                borderColor: C.border,
                overflow: 'hidden',
              }}
            >
              {tagSuggestions.map((s, idx) => {
                const isLast = idx === tagSuggestions.length - 1 && !showCreateNewTag;
                return (
                  <PressableScale
                    key={s.name}
                    onPress={() => addTagByName(s.name)}
                    haptic="tap"
                    scaleValue={0.99}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: SP['2'],
                      paddingHorizontal: SP['3'],
                      paddingVertical: SP['2'],
                      borderBottomWidth: isLast ? 0 : 1,
                      borderBottomColor: C.divider,
                    }}
                  >
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={[T.bodyMd, { color: C.text, fontWeight: '700' }]} numberOfLines={1}>
                        # {s.name}
                      </Text>
                      <Text style={[T.caption, { color: C.text3 }]} numberOfLines={1}>
                        {s.post_count.toLocaleString('ja-JP')} 投稿
                      </Text>
                    </View>
                    <Icon.plus size={16} color={C.text3} strokeWidth={2.4} />
                  </PressableScale>
                );
              })}

              {/* 「新しいタグを作る」行 */}
              {showCreateNewTag && (
                <PressableScale
                  onPress={() => addTagByName(tagInput)}
                  haptic="confirm"
                  scaleValue={0.99}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: SP['2'],
                    paddingHorizontal: SP['3'],
                    paddingVertical: SP['2'],
                    borderTopWidth: tagSuggestions.length > 0 ? 1 : 0,
                    borderTopColor: C.divider,
                  }}
                >
                  <Icon.plus size={16} color={C.accent} strokeWidth={2.6} />
                  <Text style={[T.bodyMd, { color: C.accent, fontWeight: '700', flex: 1 }]} numberOfLines={1}>
                    新しいタグ &quot;#{tagInput.trim().replace(/^#/, '')}&quot; を作る
                  </Text>
                </PressableScale>
              )}
            </View>
          )}

          {/* 補助文言 */}
          {tags.length === 0 && tagInput.trim().length === 0 && (
            <Text style={[T.caption, { color: C.text3 }]}>
              関連するタグを追加すると検索で見つかりやすくなります
            </Text>
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
                    setVisibility('request');
                    setClosedMode(opt.value as 'request' | 'invite');
                  }
                }}
                haptic="select"
                hitSlop={4}
                style={{
                  flexDirection: 'row',
                  gap: SP['3'],
                  padding: SP['3'],
                  backgroundColor: isSelected ? C.accentBg : C.bg2,
                  borderRadius: R.md,
                  borderWidth: 1.5,
                  borderColor: isSelected ? C.accent : C.border,
                  alignItems: 'center',
                }}
              >
                <View
                  style={{
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
                  <Text style={[T.bodyMd, { color: C.text, fontWeight: '700' }]} numberOfLines={1}>
                    {opt.label}
                  </Text>
                  <Text style={[T.caption, { color: C.text3, marginTop: 2 }]} numberOfLines={2}>
                    {opt.desc}
                  </Text>
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
          disabled={submitting || name.trim().length < 2 || !localIconBlob}
          haptic="confirm"
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
