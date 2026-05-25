// ============================================================
// コミュニティ編集 (wiki 編集) — migration 0048
// ------------------------------------------------------------
// メンバー全員がアイコン / 名前 / 説明 / タグを編集可能 (visibility は owner のみ)。
//
// レイアウトは spot/create / event/create と統一 (Card + 必須 Badge + sticky CTA)。
// ============================================================

import {
  View,
  Text,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Image,
} from 'react-native';
import { useEffect, useMemo, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { C, R, SP } from '../../../../design/tokens';
import { T } from '../../../../design/typography';
import { BackButton } from '../../../../components/nav/BackButton';
import { Input } from '../../../../components/ui/Input';
import { Button } from '../../../../components/ui/Button';
import { PressableScale } from '../../../../components/ui/PressableScale';
import { TagPill } from '../../../../components/tag/TagPill';
import { Icon } from '../../../../constants/icons';
import { useToastStore } from '../../../../stores/toastStore';
import {
  fetchCommunity,
  updateCommunity,
  replaceCommunityTags,
  uploadCommunityIcon,
} from '../../../../lib/api/communities';
import { prepareImageUpload } from '../../../../lib/image';
import { sanitizeUrl } from '../../../../lib/sanitize';
import { TABBAR } from '../../../../design/tabbar';

export default function EditCommunityScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams();
  const id = typeof params.id === 'string' ? params.id : '';
  const { show } = useToastStore();
  const qc = useQueryClient();

  const { data: community, isLoading } = useQuery({
    queryKey: ['community', id],
    queryFn: () => fetchCommunity(id),
    enabled: id.length > 0,
  });

  // hydrate state once
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState('');
  const [hydrated, setHydrated] = useState(false);

  // 新しいアイコン (差し替え時のみ存在)
  const [newIconUri, setNewIconUri] = useState<string | null>(null);
  const [newIconBlob, setNewIconBlob] = useState<Blob | FormData | null>(null);
  const [newIconMime, setNewIconMime] = useState<string>('image/jpeg');

  const [iconLoading, setIconLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (community && !hydrated) {
      setName(community.name);
      setDescription(community.description ?? '');
      setTags(community.tags ?? []);
      setHydrated(true);
    }
  }, [community, hydrated]);

  // member 以外は編集不可
  const canEdit = !!community?.is_member;

  // 変更があるか
  const hasChanges = useMemo(() => {
    if (!community) return false;
    if (newIconUri !== null) return true;
    if (name.trim() !== community.name) return true;
    if (description.trim() !== (community.description ?? '')) return true;
    const origSet = new Set(community.tags ?? []);
    const newSet = new Set(tags);
    if (origSet.size !== newSet.size) return true;
    for (const t of origSet) {
      if (!newSet.has(t)) return true;
    }
    return false;
  }, [community, newIconUri, name, description, tags]);

  const canSubmit =
    hydrated && canEdit && hasChanges && name.trim().length >= 2 && !submitting;

  const pickIcon = async () => {
    if (iconLoading || submitting) return;
    setIconLoading(true);
    try {
      if (Platform.OS !== 'web') {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) {
          show('写真へのアクセス権限が必要です', 'warn');
          return;
        }
      }
      const r = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: 'images',
        quality: 1,
        allowsEditing: true,
        aspect: [1, 1],
      });
      if (r.canceled || !r.assets[0]) return;
      const asset = r.assets[0];
      const prepared = await prepareImageUpload(asset.uri, {
        maxSizeBytes: 5 * 1024 * 1024,
        maxWidth: 512,
        maxHeight: 512,
        quality: 0.85,
      });
      setNewIconUri(asset.uri);
      setNewIconBlob(prepared.blob);
      setNewIconMime(prepared.mime);
    } catch (e) {
      const msg = e instanceof Error ? e.message : '画像処理に失敗しました';
      show(`画像処理エラー: ${msg}`, 'error');
    } finally {
      setIconLoading(false);
    }
  };

  const addTag = () => {
    const t = tagDraft.trim().replace(/^#/, '');
    if (t.length === 0) return;
    if (t.length > 40) {
      show('タグは 40 文字以下にしてください', 'warn');
      return;
    }
    if (tags.includes(t)) {
      setTagDraft('');
      return;
    }
    if (tags.length >= 10) {
      show('タグは 10 個までです', 'warn');
      return;
    }
    setTags([...tags, t]);
    setTagDraft('');
  };

  const removeTag = (t: string) => {
    setTags(tags.filter((x) => x !== t));
  };

  const handleSave = async () => {
    if (!canSubmit || !community) return;
    setSubmitting(true);
    try {
      // 1. アイコン差し替え (変更ある時のみ)
      let nextIconUrl: string | null = null;
      if (newIconBlob) {
        const { url, error: upErr } = await uploadCommunityIcon(community.id, newIconBlob, newIconMime);
        if (upErr || !url) {
          show(`アイコン更新に失敗しました${upErr ? `: ${upErr}` : ''}`, 'error');
          setSubmitting(false);
          return;
        }
        nextIconUrl = url;
      }

      // 2. name / description / icon_url を一括 update
      const patch: { name?: string; description?: string; icon_url?: string } = {};
      if (name.trim() !== community.name) patch.name = name.trim();
      if (description.trim() !== (community.description ?? '')) patch.description = description.trim();
      if (nextIconUrl) patch.icon_url = nextIconUrl;
      if (Object.keys(patch).length > 0) {
        const { error: updErr } = await updateCommunity(community.id, patch);
        if (updErr) {
          show(updErr, 'error');
          setSubmitting(false);
          return;
        }
      }

      // 3. tags が変わっていれば replace
      const origSet = new Set(community.tags ?? []);
      const newSet = new Set(tags);
      const tagsChanged =
        origSet.size !== newSet.size ||
        [...origSet].some((t) => !newSet.has(t));
      if (tagsChanged) {
        const { error: tagErr } = await replaceCommunityTags(community.id, tags);
        if (tagErr) {
          show(`タグ更新に失敗しました: ${tagErr}`, 'error');
          setSubmitting(false);
          return;
        }
      }

      show('コミュニティを更新しました', 'success');
      void qc.invalidateQueries({ queryKey: ['community', id] });
      router.back();
    } catch (e) {
      const msg = e instanceof Error ? e.message : '更新に失敗しました';
      show(msg, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  if (isLoading || !community) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color={C.accent} />
      </View>
    );
  }

  if (!canEdit) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, padding: SP['6'], alignItems: 'center', justifyContent: 'center' }}>
        <Text style={[T.h4, { color: C.text, textAlign: 'center' }]}>
          コミュニティに参加すると編集できます
        </Text>
        <PressableScale onPress={() => router.back()} haptic="tap" style={{ marginTop: SP['4'] }}>
          <Text style={[T.bodyB, { color: C.accent, fontWeight: '700' }]}>戻る</Text>
        </PressableScale>
      </View>
    );
  }

  const displayedIconUri = newIconUri ?? (community.icon_url ? sanitizeUrl(community.icon_url) : null);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: C.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Header */}
      <View
        style={{
          paddingTop: insets.top + SP['2'],
          paddingHorizontal: SP['4'],
          paddingBottom: SP['3'],
          flexDirection: 'row',
          alignItems: 'center',
          gap: SP['3'],
        }}
      >
        <BackButton />
        <Text style={[T.h3, { color: C.text, flex: 1 }]}>コミュニティを編集</Text>
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: SP['4'],
          paddingTop: SP['2'],
          paddingBottom: TABBAR.height + insets.bottom + SP['24'],
          gap: SP['4'],
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* wiki 説明 banner */}
        <View
          style={{
            padding: SP['3'],
            backgroundColor: C.amberBg,
            borderRadius: R.md,
            borderWidth: 1,
            borderColor: C.amber + '55',
          }}
        >
          <Text style={[T.caption, { color: C.amber, fontWeight: '700' }]}>
            📝 メンバー全員が編集できます (wiki 形式)
          </Text>
          <Text style={[T.caption, { color: C.text2, marginTop: 2 }]}>
            間違いや古い情報を見つけたら直してください。
          </Text>
        </View>

        {/* ───────── アイコン ───────── */}
        <Card>
          <SectionHeader title="アイコン" badge={{ kind: 'optional' }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['3'] }}>
            <View
              style={{
                width: 72,
                height: 72,
                borderRadius: 36,
                backgroundColor: displayedIconUri ? C.bg3 : community.icon_color,
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
                borderWidth: 1,
                borderColor: C.border,
              }}
            >
              {displayedIconUri ? (
                <Image source={{ uri: displayedIconUri }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
              ) : (
                <Text style={{ fontSize: 32 }}>{community.icon_emoji}</Text>
              )}
            </View>
            <View style={{ flex: 1, gap: SP['1'] }}>
              <PressableScale
                onPress={pickIcon}
                disabled={iconLoading}
                haptic="tap"
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  paddingVertical: SP['2'] + 2,
                  paddingHorizontal: SP['3'],
                  backgroundColor: C.accent,
                  borderRadius: R.md,
                  opacity: iconLoading ? 0.6 : 1,
                }}
              >
                {iconLoading ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Icon.image size={14} color="#fff" strokeWidth={2.4} />
                )}
                <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>
                  {iconLoading ? '処理中…' : '画像を選ぶ'}
                </Text>
              </PressableScale>
              {newIconUri && (
                <PressableScale
                  onPress={() => {
                    setNewIconUri(null);
                    setNewIconBlob(null);
                  }}
                  haptic="tap"
                  hitSlop={4}
                  style={{
                    paddingVertical: 4,
                    alignItems: 'center',
                  }}
                >
                  <Text style={[T.caption, { color: C.text3, fontWeight: '700' }]}>
                    新しい画像を破棄
                  </Text>
                </PressableScale>
              )}
            </View>
          </View>
          <Text style={[T.caption, { color: C.text3 }]}>
            JPEG / PNG / WebP · 5MB まで · 自動で 512px 角に圧縮
          </Text>
        </Card>

        {/* ───────── 名前 ───────── */}
        <Card>
          <SectionHeader
            title="名前"
            badge={{ kind: 'required' }}
            right={
              <Text style={[T.caption, { color: name.length > 35 ? C.amber : C.text3 }]}>
                {name.length} / 40
              </Text>
            }
          />
          <Input
            placeholder="2 文字以上"
            value={name}
            onChangeText={setName}
            maxLength={40}
          />
        </Card>

        {/* ───────── 説明 ───────── */}
        <Card>
          <SectionHeader
            title="説明"
            badge={{ kind: 'optional' }}
            right={
              <Text style={[T.caption, { color: description.length > 450 ? C.amber : C.text3 }]}>
                {description.length} / 500
              </Text>
            }
          />
          <Input
            placeholder="どんなコミュニティか、ひと言で"
            value={description}
            onChangeText={setDescription}
            multiline
            numberOfLines={3}
            maxLength={500}
            textAlignVertical="top"
          />
        </Card>

        {/* ───────── タグ ───────── */}
        <Card>
          <SectionHeader
            title="タグ"
            badge={{ kind: 'optional' }}
            right={
              <Text style={[T.caption, { color: tags.length >= 10 ? C.amber : C.text3 }]}>
                {tags.length} / 10
              </Text>
            }
          />
          {tags.length > 0 && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {tags.map((t) => (
                <View
                  key={t}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 4,
                    paddingLeft: SP['2'] + 2,
                    paddingRight: 4,
                    paddingVertical: 4,
                    backgroundColor: C.accentBg,
                    borderRadius: R.full,
                    borderWidth: 1,
                    borderColor: C.accent + '55',
                  }}
                >
                  <Text style={{ fontSize: 12, color: C.accent, fontWeight: '700' }}>
                    #{t}
                  </Text>
                  <PressableScale
                    onPress={() => removeTag(t)}
                    haptic="tap"
                    hitSlop={6}
                    accessibilityLabel={`タグ ${t} を削除`}
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: 10,
                      backgroundColor: C.bg3,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Icon.close size={11} color={C.text2} strokeWidth={2.4} />
                  </PressableScale>
                </View>
              ))}
            </View>
          )}
          {tags.length < 10 && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
              <View style={{ flex: 1 }}>
                <Input
                  placeholder="タグを追加 (例: ホロライブ)"
                  value={tagDraft}
                  onChangeText={setTagDraft}
                  onSubmitEditing={addTag}
                  maxLength={40}
                  returnKeyType="done"
                  autoCapitalize="none"
                />
              </View>
              <PressableScale
                onPress={addTag}
                disabled={tagDraft.trim().length === 0}
                haptic="tap"
                style={{
                  paddingHorizontal: SP['3'],
                  paddingVertical: SP['3'],
                  backgroundColor: tagDraft.trim().length === 0 ? C.bg3 : C.accent,
                  borderRadius: R.md,
                  opacity: tagDraft.trim().length === 0 ? 0.5 : 1,
                }}
              >
                <Icon.plus size={16} color="#fff" strokeWidth={2.6} />
              </PressableScale>
            </View>
          )}
        </Card>
      </ScrollView>

      {/* Sticky CTA */}
      <View
        style={{
          position: 'absolute',
          left: 0, right: 0,
          bottom: 0,
          paddingHorizontal: SP['4'],
          paddingTop: SP['3'],
          paddingBottom: insets.bottom + SP['3'],
          backgroundColor: C.bg,
          borderTopWidth: 1,
          borderTopColor: C.border,
          gap: SP['2'],
        }}
      >
        {!canSubmit && hydrated && (
          <Text style={[T.caption, { color: C.text3, textAlign: 'center' }]}>
            {name.trim().length < 2
              ? '名前は 2 文字以上必要です'
              : !hasChanges
                ? '変更がありません'
                : ''}
          </Text>
        )}
        <Button
          label={submitting ? '保存中…' : '変更を保存'}
          onPress={handleSave}
          variant="primary"
          size="lg"
          fullWidth
          disabled={!canSubmit}
          loading={submitting}
          haptic="confirm"
        />
      </View>
    </KeyboardAvoidingView>
  );
}

// ============================================================
// 小物コンポーネント (spot/create / event/create と統一)
// ============================================================

function Card({ children }: { children: React.ReactNode }) {
  return (
    <View
      style={{
        padding: SP['4'],
        backgroundColor: C.bg2,
        borderRadius: R.lg,
        borderWidth: 1,
        borderColor: C.border,
        gap: SP['3'],
      }}
    >
      {children}
    </View>
  );
}

type BadgeKind = 'required' | 'optional' | 'recommended';

function SectionHeader({
  title,
  badge,
  right,
}: {
  title: string;
  badge?: { kind: BadgeKind };
  right?: React.ReactNode;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
      <Text style={[T.bodyB, { color: C.text, fontWeight: '700' }]}>{title}</Text>
      {badge && <Badge kind={badge.kind} />}
      <View style={{ flex: 1 }} />
      {right}
    </View>
  );
}

function Badge({ kind }: { kind: BadgeKind }) {
  const meta = {
    required:    { label: '必須', fg: C.red,    bg: C.red + '22',    border: C.red + '44' },
    optional:    { label: '任意', fg: C.text3,  bg: C.bg3,           border: C.border },
    recommended: { label: '推奨', fg: C.accent, bg: C.accentBg,      border: C.accent + '55' },
  }[kind];
  return (
    <View
      style={{
        paddingHorizontal: 6,
        paddingVertical: 1,
        borderRadius: R.full,
        backgroundColor: meta.bg,
        borderWidth: 1,
        borderColor: meta.border,
      }}
    >
      <Text style={{ fontSize: 10, color: meta.fg, fontWeight: '700' }}>
        {meta.label}
      </Text>
    </View>
  );
}
