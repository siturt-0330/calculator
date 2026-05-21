// ============================================================
// Admin: タグターゲティング広告管理
// ============================================================
// 広告一覧 + ステータスフィルタ + 作成/編集 modal + 7d 集計表示。
// 個別追跡なし — 集計は ad_events から count() で取るだけ。
// ============================================================
import { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TextInput,
  Modal,
  Switch,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { TopBar } from '../../components/nav/TopBar';
import { BackButton } from '../../components/nav/BackButton';
import { PressableScale } from '../../components/ui/PressableScale';
import { Spinner } from '../../components/ui/Spinner';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { Icon } from '../../constants/icons';
import { useToastStore } from '../../stores/toastStore';
import { C, R, SP, SHADOW } from '../../design/tokens';
import { T } from '../../design/typography';
import {
  fetchAllAds,
  createAd,
  updateAd,
  deleteAd,
  fetchAdStats,
  type AdminAd,
  type AdStatus,
  type CreateAdInput,
} from '../../lib/api/ads';

const STATUS_FILTERS: Array<{ key: AdStatus | 'all'; label: string }> = [
  { key: 'all',     label: 'すべて' },
  { key: 'active',  label: '配信中' },
  { key: 'paused',  label: '一時停止' },
  { key: 'draft',   label: '下書き' },
  { key: 'ended',   label: '終了' },
];

const STATUS_META: Record<AdStatus, { label: string; fg: string; bg: string; border: string }> = {
  draft:    { label: '下書き', fg: C.text3,        bg: C.bg3,      border: C.border },
  active:   { label: '配信中', fg: C.green,        bg: C.greenBg,  border: C.green + '55' },
  paused:   { label: '停止中', fg: C.amber,        bg: C.amberBg,  border: C.amber + '55' },
  ended:    { label: '終了',   fg: C.text3,        bg: C.bg3,      border: C.border },
};

export default function AdminAdsScreen() {
  const insets = useSafeAreaInsets();
  const { show } = useToastStore();
  const qc = useQueryClient();

  const [filter, setFilter] = useState<AdStatus | 'all'>('all');
  const [editing, setEditing] = useState<AdminAd | null>(null);
  const [creating, setCreating] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<AdminAd | null>(null);

  const { data: ads = [], isLoading, refetch } = useQuery({
    queryKey: ['admin-ads', filter],
    queryFn: () => fetchAllAds(filter === 'all' ? undefined : filter),
    staleTime: 20_000,
  });

  const remove = useMutation({
    mutationFn: deleteAd,
    onSuccess: () => {
      show('削除しました', 'success');
      void qc.invalidateQueries({ queryKey: ['admin-ads'] });
    },
    onError: (e: unknown) => show(e instanceof Error ? e.message : '削除に失敗しました', 'error'),
  });

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <TopBar
        title="広告管理"
        left={<BackButton />}
        right={
          <PressableScale
            onPress={() => setCreating(true)}
            haptic="confirm"
            style={{
              paddingHorizontal: SP['3'],
              paddingVertical: 7,
              backgroundColor: C.accent,
              borderRadius: R.full,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 4,
            }}
            accessibilityLabel="広告を作成"
          >
            <Icon.plus size={14} color="#fff" strokeWidth={2.6} />
            <Text style={[T.smallB, { color: '#fff' }]}>作成</Text>
          </PressableScale>
        }
      />

      {/* status filter pills */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          flexDirection: 'row',
          gap: 6,
          paddingHorizontal: SP['4'],
          paddingVertical: SP['3'],
        }}
      >
        {STATUS_FILTERS.map((f) => (
          <PressableScale
            key={f.key}
            onPress={() => setFilter(f.key)}
            haptic="select"
            hitSlop={8}
            style={{
              paddingHorizontal: SP['3'],
              paddingVertical: 6,
              backgroundColor: filter === f.key ? C.accentBg : C.bg2,
              borderRadius: R.full,
              borderWidth: 1,
              borderColor: filter === f.key ? C.accent + '66' : C.border,
            }}
          >
            <Text style={[T.caption, { color: filter === f.key ? C.accentLight : C.text2, fontWeight: '700' }]}>
              {f.label}
            </Text>
          </PressableScale>
        ))}
      </ScrollView>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: SP['4'],
          paddingBottom: insets.bottom + SP['10'],
          gap: SP['2'],
        }}
      >
        {isLoading ? (
          <View style={{ padding: SP['8'], alignItems: 'center' }}>
            <Spinner />
          </View>
        ) : ads.length === 0 ? (
          <View style={{
            padding: SP['8'],
            alignItems: 'center',
            gap: SP['2'],
            backgroundColor: C.bg2,
            borderRadius: R.lg,
            borderWidth: 1,
            borderColor: C.border,
          }}>
            <Text style={{ fontSize: 36 }}>📢</Text>
            <Text style={[T.body, { color: C.text2 }]}>広告がありません</Text>
            <Text style={[T.caption, { color: C.text3, textAlign: 'center' }]}>
              「作成」から新しい広告を追加できます
            </Text>
          </View>
        ) : (
          ads.map((ad) => (
            <AdRow
              key={ad.id}
              ad={ad}
              onEdit={() => setEditing(ad)}
              onDelete={() => setPendingDelete(ad)}
            />
          ))
        )}
      </ScrollView>

      {(creating || editing) && (
        <AdFormModal
          ad={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={() => {
            void refetch();
            setCreating(false);
            setEditing(null);
          }}
        />
      )}

      <ConfirmDialog
        visible={pendingDelete !== null}
        title="広告を削除"
        message={pendingDelete ? `「${pendingDelete.headline}」を削除します。配信履歴も全て消えます。` : ''}
        confirmLabel="削除する"
        onConfirm={() => {
          if (pendingDelete) remove.mutate(pendingDelete.id);
          setPendingDelete(null);
        }}
        onCancel={() => setPendingDelete(null)}
        destructive
      />
    </View>
  );
}

// ============================================================
// 1 行 — 広告 summary + 7d 集計
// ============================================================
function AdRow({ ad, onEdit, onDelete }: { ad: AdminAd; onEdit: () => void; onDelete: () => void }) {
  const { data: stats } = useQuery({
    queryKey: ['admin-ad-stats', ad.id],
    queryFn: () => fetchAdStats(ad.id, 7),
    staleTime: 60_000,
  });
  const meta = STATUS_META[ad.status];
  const ctr = stats && stats.impressions > 0
    ? `${((stats.clicks / stats.impressions) * 100).toFixed(1)}%`
    : '—';
  return (
    <View
      style={[
        {
          padding: SP['3'],
          backgroundColor: C.bg2,
          borderRadius: R.lg,
          borderWidth: 1,
          borderColor: C.border,
          gap: SP['2'],
        },
        SHADOW.card,
      ]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'], flexWrap: 'wrap' }}>
        <View style={{
          paddingHorizontal: SP['2'],
          paddingVertical: 1,
          backgroundColor: meta.bg,
          borderRadius: R.sm,
          borderWidth: 1,
          borderColor: meta.border,
        }}>
          <Text style={{ fontSize: 10, color: meta.fg, fontWeight: '700' }}>{meta.label}</Text>
        </View>
        <Text style={[T.captionM, { color: C.text3 }]} numberOfLines={1}>
          {ad.advertiser_name}
        </Text>
      </View>

      <Text style={[T.bodyB, { color: C.text }]} numberOfLines={1}>
        {ad.headline}
      </Text>
      <Text style={[T.small, { color: C.text2 }]} numberOfLines={2}>
        {ad.body}
      </Text>

      {/* target tags */}
      {ad.target_tags.length > 0 && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
          {ad.target_tags.slice(0, 6).map((t) => (
            <View key={t} style={{
              paddingHorizontal: 6,
              paddingVertical: 1,
              backgroundColor: C.accentBg,
              borderRadius: R.sm,
              borderWidth: 1,
              borderColor: C.accent + '44',
            }}>
              <Text style={{ fontSize: 10, color: C.accentLight, fontWeight: '600' }}>#{t}</Text>
            </View>
          ))}
          {ad.target_tags.length > 6 && (
            <Text style={{ fontSize: 10, color: C.text3, fontWeight: '600' }}>
              +{ad.target_tags.length - 6}
            </Text>
          )}
        </View>
      )}

      {/* 7d stats */}
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: SP['4'], flexWrap: 'wrap' }}>
        <StatNum label="表示" value={stats?.impressions} />
        <StatNum label="クリック" value={stats?.clicks} />
        <StatNum label="CTR" value={ctr} />
        <Text style={[T.caption, { color: C.text4 }]}>過去 7 日</Text>
      </View>

      <View style={{ flexDirection: 'row', gap: SP['2'], justifyContent: 'flex-end' }}>
        <PressableScale
          onPress={onEdit}
          haptic="tap"
          style={{
            paddingHorizontal: SP['3'],
            paddingVertical: 6,
            backgroundColor: C.bg3,
            borderRadius: R.full,
            borderWidth: 1,
            borderColor: C.border,
          }}
        >
          <Text style={[T.smallB, { color: C.text, fontSize: 12 }]}>編集</Text>
        </PressableScale>
        <PressableScale
          onPress={onDelete}
          haptic="warn"
          style={{
            paddingHorizontal: SP['3'],
            paddingVertical: 6,
            backgroundColor: C.redBg,
            borderRadius: R.full,
            borderWidth: 1,
            borderColor: C.red + '55',
          }}
        >
          <Text style={[T.smallB, { color: C.red, fontSize: 12 }]}>削除</Text>
        </PressableScale>
      </View>
    </View>
  );
}

function StatNum({ label, value }: { label: string; value: number | string | undefined }) {
  const text =
    value === undefined ? '—'
    : typeof value === 'number' ? value.toLocaleString('ja-JP')
    : value;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
      <Text style={[T.caption, { color: C.text3 }]}>{label}</Text>
      <Text style={[T.smallB, { color: C.text, fontWeight: '700' }]}>{text}</Text>
    </View>
  );
}

// ============================================================
// 作成 / 編集 modal
// ============================================================
type FormState = CreateAdInput;

function emptyForm(): FormState {
  return {
    advertiser_name: '',
    headline: '',
    body: '',
    image_url: null,
    click_url: '',
    cta_label: '詳しく見る',
    target_tags: [],
    exclude_tags: [],
    status: 'draft',
    starts_at: null,
    ends_at: null,
    daily_budget_yen: 0,
  };
}

const STATUS_OPTIONS: AdStatus[] = ['draft', 'active', 'paused', 'ended'];

function AdFormModal({
  ad,
  onClose,
  onSaved,
}: {
  ad: AdminAd | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { show } = useToastStore();
  const [form, setForm] = useState<FormState>(emptyForm());
  const [tagInput, setTagInput] = useState('');
  const [excludeTagInput, setExcludeTagInput] = useState('');

  useEffect(() => {
    if (ad) {
      setForm({
        advertiser_name: ad.advertiser_name,
        headline: ad.headline,
        body: ad.body,
        image_url: ad.image_url,
        click_url: ad.click_url,
        cta_label: ad.cta_label,
        target_tags: ad.target_tags,
        exclude_tags: ad.exclude_tags,
        status: ad.status,
        starts_at: ad.starts_at,
        ends_at: ad.ends_at,
        daily_budget_yen: ad.daily_budget_yen,
      });
    } else {
      setForm(emptyForm());
    }
  }, [ad]);

  const valid = useMemo(() => {
    return (
      form.advertiser_name.trim().length > 0 &&
      form.headline.trim().length > 0 &&
      form.body.trim().length > 0 &&
      /^https?:\/\//.test(form.click_url) &&
      form.cta_label.trim().length > 0
    );
  }, [form]);

  const save = useMutation({
    mutationFn: async () => {
      const payload: CreateAdInput = {
        ...form,
        advertiser_name: form.advertiser_name.trim(),
        headline: form.headline.trim(),
        body: form.body.trim(),
        click_url: form.click_url.trim(),
        cta_label: form.cta_label.trim(),
        image_url: form.image_url ? form.image_url.trim() || null : null,
      };
      if (ad) {
        return updateAd(ad.id, payload);
      }
      return createAd(payload);
    },
    onSuccess: () => {
      show(ad ? '更新しました' : '作成しました', 'success');
      onSaved();
    },
    onError: (e: unknown) => show(e instanceof Error ? e.message : '保存に失敗しました', 'error'),
  });

  const addTag = (kind: 'target' | 'exclude') => {
    const raw = (kind === 'target' ? tagInput : excludeTagInput).trim().replace(/^#/, '');
    if (!raw) return;
    setForm((f) => {
      const arr = kind === 'target' ? f.target_tags : f.exclude_tags;
      if (arr.includes(raw)) return f;
      const next = [...arr, raw];
      return kind === 'target' ? { ...f, target_tags: next } : { ...f, exclude_tags: next };
    });
    if (kind === 'target') setTagInput('');
    else setExcludeTagInput('');
  };

  const removeTag = (kind: 'target' | 'exclude', tag: string) => {
    setForm((f) => {
      const arr = kind === 'target' ? f.target_tags : f.exclude_tags;
      const next = arr.filter((t) => t !== tag);
      return kind === 'target' ? { ...f, target_tags: next } : { ...f, exclude_tags: next };
    });
  };

  return (
    <Modal visible animationType="slide" presentationStyle="formSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: C.bg }}>
        <TopBar
          title={ad ? '広告を編集' : '広告を作成'}
          left={
            <PressableScale onPress={onClose} hitSlop={10} haptic="tap" accessibilityLabel="閉じる">
              <Icon.close size={22} color={C.text} strokeWidth={2.2} />
            </PressableScale>
          }
          right={
            <PressableScale
              onPress={() => save.mutate()}
              disabled={!valid || save.isPending}
              haptic="confirm"
              style={{
                paddingHorizontal: SP['3'],
                paddingVertical: 7,
                backgroundColor: valid ? C.accent : C.bg3,
                borderRadius: R.full,
                opacity: save.isPending ? 0.6 : 1,
              }}
            >
              {save.isPending ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={[T.smallB, { color: valid ? '#fff' : C.text3 }]}>
                  {ad ? '更新' : '作成'}
                </Text>
              )}
            </PressableScale>
          }
        />
        <ScrollView
          contentContainerStyle={{
            padding: SP['4'],
            paddingBottom: insets.bottom + SP['10'],
            gap: SP['4'],
          }}
        >
          <Field label="広告主名" required>
            <TextInput
              value={form.advertiser_name}
              onChangeText={(v) => setForm((f) => ({ ...f, advertiser_name: v }))}
              placeholder="例: 株式会社 Example"
              placeholderTextColor={C.text3}
              style={inputStyle}
              maxLength={80}
            />
          </Field>

          <Field label="ヘッドライン" required>
            <TextInput
              value={form.headline}
              onChangeText={(v) => setForm((f) => ({ ...f, headline: v }))}
              placeholder="80 文字まで"
              placeholderTextColor={C.text3}
              style={inputStyle}
              maxLength={80}
            />
          </Field>

          <Field label="本文" required>
            <TextInput
              value={form.body}
              onChangeText={(v) => setForm((f) => ({ ...f, body: v }))}
              placeholder="280 文字まで"
              placeholderTextColor={C.text3}
              multiline
              style={[inputStyle, { minHeight: 96, textAlignVertical: 'top' }]}
              maxLength={280}
            />
          </Field>

          <Field label="画像 URL">
            <TextInput
              value={form.image_url ?? ''}
              onChangeText={(v) => setForm((f) => ({ ...f, image_url: v || null }))}
              placeholder="https://..."
              placeholderTextColor={C.text3}
              style={inputStyle}
              autoCapitalize="none"
              keyboardType="url"
            />
          </Field>

          <Field label="リンク先 URL" required>
            <TextInput
              value={form.click_url}
              onChangeText={(v) => setForm((f) => ({ ...f, click_url: v }))}
              placeholder="https://..."
              placeholderTextColor={C.text3}
              style={inputStyle}
              autoCapitalize="none"
              keyboardType="url"
            />
          </Field>

          <Field label="CTA ラベル" required>
            <TextInput
              value={form.cta_label}
              onChangeText={(v) => setForm((f) => ({ ...f, cta_label: v }))}
              placeholder="例: 詳しく見る"
              placeholderTextColor={C.text3}
              style={inputStyle}
              maxLength={20}
            />
          </Field>

          {/* target_tags */}
          <Field label="ターゲットタグ" hint="このタグに興味のあるユーザーに配信。空なら全配信 (薄め)">
            <View style={{ flexDirection: 'row', gap: SP['2'] }}>
              <TextInput
                value={tagInput}
                onChangeText={setTagInput}
                placeholder="タグを入力して追加"
                placeholderTextColor={C.text3}
                style={[inputStyle, { flex: 1 }]}
                onSubmitEditing={() => addTag('target')}
                returnKeyType="done"
                autoCapitalize="none"
              />
              <PressableScale
                onPress={() => addTag('target')}
                haptic="tap"
                style={{
                  paddingHorizontal: SP['3'],
                  justifyContent: 'center',
                  backgroundColor: C.bg3,
                  borderRadius: R.md,
                  borderWidth: 1,
                  borderColor: C.border,
                }}
              >
                <Text style={[T.smallB, { color: C.text }]}>追加</Text>
              </PressableScale>
            </View>
            <TagChips
              tags={form.target_tags}
              tone="accent"
              onRemove={(t) => removeTag('target', t)}
            />
          </Field>

          {/* exclude_tags */}
          <Field label="除外タグ" hint="このタグに興味のあるユーザーには配信しない (競合・センシティブ等)">
            <View style={{ flexDirection: 'row', gap: SP['2'] }}>
              <TextInput
                value={excludeTagInput}
                onChangeText={setExcludeTagInput}
                placeholder="タグを入力して追加"
                placeholderTextColor={C.text3}
                style={[inputStyle, { flex: 1 }]}
                onSubmitEditing={() => addTag('exclude')}
                returnKeyType="done"
                autoCapitalize="none"
              />
              <PressableScale
                onPress={() => addTag('exclude')}
                haptic="tap"
                style={{
                  paddingHorizontal: SP['3'],
                  justifyContent: 'center',
                  backgroundColor: C.bg3,
                  borderRadius: R.md,
                  borderWidth: 1,
                  borderColor: C.border,
                }}
              >
                <Text style={[T.smallB, { color: C.text }]}>追加</Text>
              </PressableScale>
            </View>
            <TagChips
              tags={form.exclude_tags}
              tone="danger"
              onRemove={(t) => removeTag('exclude', t)}
            />
          </Field>

          {/* status */}
          <Field label="ステータス">
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {STATUS_OPTIONS.map((s) => {
                const active = form.status === s;
                const meta = STATUS_META[s];
                return (
                  <PressableScale
                    key={s}
                    onPress={() => setForm((f) => ({ ...f, status: s }))}
                    haptic="select"
                    style={{
                      paddingHorizontal: SP['3'],
                      paddingVertical: 6,
                      backgroundColor: active ? meta.bg : C.bg2,
                      borderRadius: R.full,
                      borderWidth: 1,
                      borderColor: active ? meta.border : C.border,
                    }}
                  >
                    <Text style={[T.caption, { color: active ? meta.fg : C.text2, fontWeight: '700' }]}>
                      {meta.label}
                    </Text>
                  </PressableScale>
                );
              })}
            </View>
          </Field>

          {/* schedule */}
          <Field label="配信開始 (任意)" hint="ISO 8601 形式: 2026-01-01T00:00:00Z">
            <TextInput
              value={form.starts_at ?? ''}
              onChangeText={(v) => setForm((f) => ({ ...f, starts_at: v || null }))}
              placeholder="未指定なら即時"
              placeholderTextColor={C.text3}
              style={inputStyle}
              autoCapitalize="none"
            />
          </Field>
          <Field label="配信終了 (任意)" hint="ISO 8601 形式">
            <TextInput
              value={form.ends_at ?? ''}
              onChangeText={(v) => setForm((f) => ({ ...f, ends_at: v || null }))}
              placeholder="未指定なら無期限"
              placeholderTextColor={C.text3}
              style={inputStyle}
              autoCapitalize="none"
            />
          </Field>

          {/* budget */}
          <Field label="1 日あたりの予算 (円)">
            <TextInput
              value={String(form.daily_budget_yen)}
              onChangeText={(v) => {
                const n = parseInt(v.replace(/[^0-9]/g, ''), 10);
                setForm((f) => ({ ...f, daily_budget_yen: Number.isFinite(n) ? n : 0 }));
              }}
              placeholder="0"
              placeholderTextColor={C.text3}
              style={inputStyle}
              keyboardType="number-pad"
            />
          </Field>
        </ScrollView>
      </View>
    </Modal>
  );
}

const inputStyle = {
  backgroundColor: C.bg2,
  borderRadius: R.md,
  borderWidth: 1,
  borderColor: C.border,
  paddingHorizontal: SP['3'],
  paddingVertical: 10,
  color: C.text,
  fontSize: 15,
};

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <Text style={[T.captionM, { color: C.text2, fontWeight: '700' }]}>{label}</Text>
        {required && <Text style={{ fontSize: 11, color: C.red, fontWeight: '700' }}>*</Text>}
      </View>
      {children}
      {hint && <Text style={[T.caption, { color: C.text3 }]}>{hint}</Text>}
    </View>
  );
}

function TagChips({
  tags,
  tone,
  onRemove,
}: {
  tags: string[];
  tone: 'accent' | 'danger';
  onRemove: (t: string) => void;
}) {
  if (tags.length === 0) return null;
  const fg = tone === 'accent' ? C.accentLight : C.red;
  const bg = tone === 'accent' ? C.accentBg : C.redBg;
  const border = tone === 'accent' ? C.accent + '44' : C.red + '44';
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
      {tags.map((t) => (
        <PressableScale
          key={t}
          onPress={() => onRemove(t)}
          haptic="tap"
          hitSlop={6}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
            paddingHorizontal: SP['2'],
            paddingVertical: 4,
            backgroundColor: bg,
            borderRadius: R.sm,
            borderWidth: 1,
            borderColor: border,
          }}
        >
          <Text style={{ fontSize: 11, color: fg, fontWeight: '600' }}>#{t}</Text>
          <Icon.close size={10} color={fg} strokeWidth={2.4} />
        </PressableScale>
      ))}
    </View>
  );
}
