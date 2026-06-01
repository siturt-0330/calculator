// ============================================================
// geek-official — イベント管理 (calendar)
// ============================================================
import { View, Text, ScrollView, Modal, TextInput, ActivityIndicator, Pressable } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useMemo, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { C, R, SP, SHADOW } from '../../../design/tokens';
import { T } from '../../../design/typography';
import { BackButton } from '../../../components/nav/BackButton';
import { PressableScale } from '../../../components/ui/PressableScale';
import { EmptyState } from '../../../components/ui/EmptyState';
import { Spinner } from '../../../components/ui/Spinner';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import { Icon } from '../../../constants/icons';
import { useToastStore } from '../../../stores/toastStore';
import { useAuthStore } from '../../../stores/authStore';
import { fetchCommunity } from '../../../lib/api/communities';
import {
  fetchCalendarEvents,
  createCalendarEvent,
  deleteCalendarEvent,
  type CalendarEvent,
} from '../../../lib/api/officialCommunities';

function defaultStartsAt(): string {
  const d = new Date();
  d.setHours(d.getHours() + 1, 0, 0, 0);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

function parseLocalDateTime(s: string): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export default function OfficialEventsScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams();
  const id = typeof params.communityId === 'string' ? params.communityId : '';
  const userId = useAuthStore((s) => s.user?.id);
  const show = useToastStore((s) => s.show);
  const qc = useQueryClient();

  const [modalOpen, setModalOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<CalendarEvent | null>(null);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [startsAt, setStartsAt] = useState(defaultStartsAt());
  const [endsAt, setEndsAt] = useState('');
  const [location, setLocation] = useState('');
  const [url, setUrl] = useState('');

  const { data: community } = useQuery({
    queryKey: ['community', id],
    queryFn: () => fetchCommunity(id),
    enabled: id.length > 0,
    staleTime: 60_000,
  });
  const isAdmin = !!community && !!userId && community.official_admin_user_id === userId;

  const { data: events = [], isLoading } = useQuery({
    queryKey: ['community', id, 'official-calendar'],
    queryFn: () => fetchCalendarEvents(id),
    enabled: id.length > 0,
    staleTime: 20_000,
  });

  const grouped = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const ev of events) {
      const d = new Date(ev.starts_at);
      if (Number.isNaN(d.getTime())) continue;
      const key = `${d.getFullYear()}年${(d.getMonth() + 1).toString().padStart(2, '0')}月`;
      const arr = map.get(key) ?? [];
      arr.push(ev);
      map.set(key, arr);
    }
    return Array.from(map.entries());
  }, [events]);

  const create = useMutation({
    mutationFn: () => {
      const startsDate = parseLocalDateTime(startsAt);
      const endsDate = parseLocalDateTime(endsAt);
      if (!startsDate) throw new Error('開始日時が不正です');
      if (endsDate && endsDate.getTime() < startsDate.getTime()) throw new Error('終了は開始より後にしてください');
      return createCalendarEvent({
        community_id: id,
        title: title.trim(),
        description: description.trim(),
        starts_at: startsDate.toISOString(),
        ends_at: endsDate ? endsDate.toISOString() : null,
        location: location.trim(),
        url: url.trim() || null,
      });
    },
    onSuccess: () => {
      show('イベントを追加しました', 'success');
      setModalOpen(false);
      setTitle(''); setDescription(''); setLocation(''); setUrl('');
      setStartsAt(defaultStartsAt()); setEndsAt('');
      void qc.invalidateQueries({ queryKey: ['community', id, 'official-calendar'] });
    },
    onError: (e: unknown) => {
      show(e instanceof Error ? e.message : '追加に失敗しました', 'error');
    },
  });

  const remove = useMutation({
    mutationFn: (eid: string) => deleteCalendarEvent(eid),
    onSuccess: () => {
      show('削除しました', 'success');
      void qc.invalidateQueries({ queryKey: ['community', id, 'official-calendar'] });
    },
    onError: () => show('削除に失敗しました', 'error'),
  });

  const canSubmit = title.trim().length >= 1 && parseLocalDateTime(startsAt) !== null && !create.isPending;

  if (!isAdmin) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top + SP['4'], paddingHorizontal: SP['4'] }}>
        <BackButton />
        <EmptyState icon={Icon.lock} title="権限がありません" />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View
        style={{
          paddingTop: insets.top + SP['2'],
          paddingHorizontal: SP['4'],
          paddingBottom: SP['2'],
          flexDirection: 'row',
          alignItems: 'center',
          gap: SP['2'],
          borderBottomWidth: 1,
          borderBottomColor: C.border,
        }}
      >
        <BackButton />
        <Text style={[T.h3, { color: C.text, flex: 1 }]}>イベント管理</Text>
        <PressableScale
          onPress={() => setModalOpen(true)}
          haptic="confirm"
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
            paddingHorizontal: SP['3'],
            paddingVertical: 6,
            backgroundColor: C.accent,
            borderRadius: R.full,
            ...SHADOW.accentGlow,
          }}
        >
          <Icon.plus size={14} color="#fff" strokeWidth={2.6} />
          <Text style={[T.caption, { color: '#fff', fontWeight: '700' }]}>追加</Text>
        </PressableScale>
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: SP['4'],
          paddingTop: SP['3'],
          paddingBottom: insets.bottom + SP['16'],
          gap: SP['3'],
        }}
      >
        {isLoading ? (
          <View style={{ paddingVertical: SP['10'], alignItems: 'center' }}>
            <Spinner size="large" />
          </View>
        ) : events.length === 0 ? (
          <EmptyState
            icon={Icon.calendar}
            title="イベントはまだありません"
            message="右上の + ボタンから追加できます"
            tone="amber"
          />
        ) : (
          grouped.map(([monthLabel, monthEvents], gi) => (
            <Animated.View key={monthLabel} entering={FadeInDown.delay(gi * 40).duration(220)} style={{ gap: SP['2'] }}>
              <Text style={[T.smallB, { color: C.text3, letterSpacing: 1, marginTop: SP['2'] }]}>{monthLabel}</Text>
              {monthEvents.map((ev) => (
                <EventCard key={ev.id} event={ev} onDelete={() => setPendingDelete(ev)} />
              ))}
            </Animated.View>
          ))
        )}
      </ScrollView>

      {/* 追加モーダル */}
      <Modal visible={modalOpen} transparent animationType="fade" onRequestClose={() => setModalOpen(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' }}>
          <View
            style={{
              backgroundColor: C.bg2,
              borderTopLeftRadius: R['2xl'],
              borderTopRightRadius: R['2xl'],
              padding: SP['4'],
              paddingBottom: insets.bottom + SP['4'],
              gap: SP['3'],
              maxHeight: '90%',
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
              <Text style={[T.h3, { color: C.text, flex: 1 }]}>イベントを追加</Text>
              <PressableScale
                onPress={() => setModalOpen(false)}
                haptic="tap"
                hitSlop={12}
                accessibilityLabel="閉じる"
                style={{ padding: 6 }}
              >
                <Icon.close size={20} color={C.text2} strokeWidth={2.4} />
              </PressableScale>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: SP['3'] }}>
              <Field label="タイトル">
                <TextInput value={title} onChangeText={setTitle} placeholder="例: ファンミーティング" placeholderTextColor={C.text3} style={fieldStyle} maxLength={100} />
              </Field>
              <Field label="開始日時 (YYYY-MM-DDTHH:MM)">
                {/* memory DoS 対策: 日時 string は 32 文字 cap */}
                <TextInput value={startsAt} onChangeText={setStartsAt} placeholder="2025-06-01T19:30" placeholderTextColor={C.text3} autoCapitalize="none" autoCorrect={false} style={fieldStyle} maxLength={32} />
              </Field>
              <Field label="終了日時 (任意)">
                {/* memory DoS 対策: 日時 string は 32 文字 cap */}
                <TextInput value={endsAt} onChangeText={setEndsAt} placeholder="2025-06-01T21:00" placeholderTextColor={C.text3} autoCapitalize="none" autoCorrect={false} style={fieldStyle} maxLength={32} />
              </Field>
              <Field label="場所 (任意)">
                <TextInput value={location} onChangeText={setLocation} placeholder="例: 渋谷ホール / オンライン" placeholderTextColor={C.text3} style={fieldStyle} maxLength={200} />
              </Field>
              <Field label="URL (任意)">
                {/* memory DoS 対策: URL は 2048 文字 cap (browser 標準 URL 上限) */}
                <TextInput value={url} onChangeText={setUrl} placeholder="https://..." placeholderTextColor={C.text3} autoCapitalize="none" autoCorrect={false} style={fieldStyle} maxLength={2048} />
              </Field>
              <Field label="説明">
                <TextInput
                  value={description}
                  onChangeText={setDescription}
                  placeholder="内容・参加方法など"
                  placeholderTextColor={C.text3}
                  multiline
                  style={[fieldStyle, { minHeight: 90, textAlignVertical: 'top' }]}
                  maxLength={2000}
                />
              </Field>
            </ScrollView>
            <PressableScale
              onPress={() => create.mutate()}
              haptic="confirm"
              disabled={!canSubmit}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                paddingVertical: SP['3'],
                backgroundColor: C.accent,
                borderRadius: R.lg,
                opacity: canSubmit ? 1 : 0.5,
              }}
            >
              {create.isPending && <ActivityIndicator size="small" color="#fff" />}
              <Text style={[T.bodyB, { color: '#fff', fontWeight: '700' }]}>追加する</Text>
            </PressableScale>
          </View>
        </View>
      </Modal>

      <ConfirmDialog
        visible={pendingDelete !== null}
        title="イベントを削除"
        message={pendingDelete ? `「${pendingDelete.title}」を削除します。` : ''}
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

const fieldStyle = {
  color: C.text,
  backgroundColor: C.bg3,
  borderRadius: R.md,
  paddingHorizontal: SP['3'],
  paddingVertical: SP['3'],
  ...T.body,
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 4 }}>
      <Text style={[T.small, { color: C.text2 }]}>{label}</Text>
      {children}
    </View>
  );
}

function EventCard({ event, onDelete }: { event: CalendarEvent; onDelete: () => void }) {
  const d = new Date(event.starts_at);
  const valid = !Number.isNaN(d.getTime());
  const day = valid ? d.getDate() : '?';
  const weekday = valid ? (['日', '月', '火', '水', '木', '金', '土'][d.getDay()] ?? '') : '';
  const time = valid
    ? `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
    : '';
  return (
    <Pressable>
      <View
        style={[
          {
            flexDirection: 'row',
            gap: SP['3'],
            padding: SP['3'],
            backgroundColor: C.bg2,
            borderRadius: R.lg,
            borderWidth: 1,
            borderColor: C.border,
          },
          SHADOW.card,
        ]}
      >
        <View
          style={{
            width: 56,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: C.bg3,
            borderRadius: R.md,
            paddingVertical: SP['2'],
          }}
        >
          <Text style={[T.numLg, { color: C.text }]}>{day}</Text>
          <Text style={[T.caption, { color: C.text3 }]}>{weekday}</Text>
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                paddingHorizontal: SP['2'],
                paddingVertical: 2,
                backgroundColor: C.accentBg,
                borderRadius: R.sm,
              }}
            >
              <Icon.clock size={10} color={C.accentLight} strokeWidth={2.4} />
              <Text style={{ color: C.accentLight, fontSize: 10, fontWeight: '700' }}>{time}</Text>
            </View>
            <PressableScale onPress={onDelete} haptic="warn" hitSlop={6} style={{ padding: 4, marginLeft: 'auto' }}>
              <Icon.trash size={14} color={C.red} strokeWidth={2.2} />
            </PressableScale>
          </View>
          <Text style={[T.bodyB, { color: C.text }]} numberOfLines={2}>{event.title}</Text>
          {event.location.length > 0 && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Icon.map size={12} color={C.text3} strokeWidth={2.2} />
              <Text style={[T.small, { color: C.text2 }]} numberOfLines={1}>{event.location}</Text>
            </View>
          )}
          {event.description.length > 0 && (
            <Text style={[T.small, { color: C.text2 }]} numberOfLines={2}>{event.description}</Text>
          )}
        </View>
      </View>
    </Pressable>
  );
}
