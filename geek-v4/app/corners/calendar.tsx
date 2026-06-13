import { useMemo, useState } from 'react';
import { View, Text, ScrollView, ActivityIndicator, Modal } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useWebKeyboardInset } from '../../hooks/useWebKeyboardInset';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { C, SP, R } from '../../design/tokens';
import { T } from '../../design/typography';
import { BackButton } from '../../components/nav/BackButton';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { PressableScale } from '../../components/ui/PressableScale';
import { Icon } from '../../constants/icons';
import { useTagFilterStore } from '../../stores/tagFilterStore';
import { useToastStore } from '../../stores/toastStore';
import { fetchMonthEvents, createPersonalEvent, createProposal, voteProposal, getMyVotes, type CalendarEvent } from '../../lib/api/calendar';

const DAYS = ['日', '月', '火', '水', '木', '金', '土'];
const MONTHS = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];

function fmt(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

export default function CalendarScreen() {
  const insets = useSafeAreaInsets();
  // selector化: 必要 field の likedTags のみ subscribe — blockedTags 更新時に
  // calendar 全体が re-render するのを防ぐ。
  const likedTags = useTagFilterStore((s) => s.likedTags);
  const show = useToastStore((s) => s.show);
  const qc = useQueryClient();

  const [cursor, setCursor] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);

  const year = cursor.getFullYear();
  const month = cursor.getMonth() + 1;

  const { data: events = [], isLoading } = useQuery<CalendarEvent[]>({
    queryKey: ['calendar', year, month, likedTags.sort().join(',')],
    queryFn: () => fetchMonthEvents(year, month, likedTags),
    staleTime: 30_000,
  });

  const proposalIds = useMemo(
    () => events.filter((e) => e.source === 'proposal').map((e) => e.id),
    [events],
  );
  const { data: myVotes = {} } = useQuery({
    queryKey: ['my-proposal-votes', proposalIds.sort().join(',')],
    queryFn: () => getMyVotes(proposalIds),
    enabled: proposalIds.length > 0,
  });

  // 月のグリッド生成
  const grid = useMemo(() => {
    const first = new Date(year, month - 1, 1);
    const lastDay = new Date(year, month, 0).getDate();
    const startWeekday = first.getDay();
    const cells: { date: string; day: number; inMonth: boolean }[] = [];
    // 前月の埋め
    const prevLast = new Date(year, month - 1, 0).getDate();
    for (let i = startWeekday - 1; i >= 0; i--) {
      const d = new Date(year, month - 2, prevLast - i);
      cells.push({ date: fmt(d), day: d.getDate(), inMonth: false });
    }
    for (let d = 1; d <= lastDay; d++) {
      const dt = new Date(year, month - 1, d);
      cells.push({ date: fmt(dt), day: d, inMonth: true });
    }
    // 次月の埋め（6行 = 42セルに揃える）
    while (cells.length < 42) {
      const d = new Date(year, month, cells.length - startWeekday - lastDay + 1);
      cells.push({ date: fmt(d), day: d.getDate(), inMonth: false });
    }
    return cells;
  }, [year, month]);

  const eventsByDate = useMemo(() => {
    const m: Record<string, CalendarEvent[]> = {};
    for (const ev of events) {
      (m[ev.event_date] ??= []).push(ev);
    }
    return m;
  }, [events]);

  const todayStr = fmt(new Date());
  const selectedEvents = selectedDate ? (eventsByDate[selectedDate] ?? []) : [];

  const goPrev = () => setCursor(new Date(year, month - 2, 1));
  const goNext = () => setCursor(new Date(year, month, 1));

  const voteMut = useMutation({
    mutationFn: ({ id, vote }: { id: string; vote: boolean }) => voteProposal(id, vote),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['calendar'] });
      qc.invalidateQueries({ queryKey: ['my-proposal-votes'] });
    },
  });

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{
        paddingTop: insets.top + SP['2'],
        paddingHorizontal: SP['4'],
        paddingBottom: SP['2'],
      }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <BackButton />
          <PressableScale
            onPress={() => {
              if (!selectedDate) setSelectedDate(todayStr);
              setShowAddModal(true);
            }}
            haptic="confirm"
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: SP['1'],
              paddingHorizontal: SP['3'],
              paddingVertical: SP['2'],
              borderRadius: R.full,
              backgroundColor: C.accent,
            }}
          >
            <Icon.plus size={16} color="#fff" strokeWidth={2.4} />
            <Text style={[T.smallM, { color: '#fff' }]}>予定追加</Text>
          </PressableScale>
        </View>

        {/* 月切り替え */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: SP['3'] }}>
          <PressableScale onPress={goPrev} haptic="tap" style={{ padding: SP['2'] }}>
            <Icon.chevronL size={24} color={C.text} strokeWidth={2.2} />
          </PressableScale>
          <Text style={[T.h2, { color: C.text }]}>{year}年 {MONTHS[month - 1]}</Text>
          <PressableScale onPress={goNext} haptic="tap" style={{ padding: SP['2'] }}>
            <Icon.chevronR size={24} color={C.text} strokeWidth={2.2} />
          </PressableScale>
        </View>
      </View>

      {/* 曜日ヘッダー */}
      <View style={{ flexDirection: 'row', paddingHorizontal: SP['2'], paddingVertical: SP['2'] }}>
        {DAYS.map((d, i) => (
          <View key={d} style={{ flex: 1, alignItems: 'center' }}>
            <Text style={[T.caption, { color: i === 0 ? C.red : i === 6 ? C.blue : C.text3 }]}>{d}</Text>
          </View>
        ))}
      </View>

      {/* カレンダーグリッド */}
      <View style={{ paddingHorizontal: SP['2'] }}>
        {Array.from({ length: 6 }).map((_, row) => (
          <View key={row} style={{ flexDirection: 'row' }}>
            {grid.slice(row * 7, row * 7 + 7).map((cell, col) => {
              const dayEvents = eventsByDate[cell.date] ?? [];
              const isToday = cell.date === todayStr;
              const isSelected = cell.date === selectedDate;
              const dayOfWeek = col;
              return (
                <PressableScale
                  key={cell.date + col}
                  onPress={() => setSelectedDate(cell.date)}
                  haptic="select"
                  style={{
                    flex: 1,
                    height: 60,
                    margin: 1,
                    padding: 4,
                    borderRadius: R.sm,
                    backgroundColor: isSelected ? C.accentBg : isToday ? C.bg3 : 'transparent',
                    borderWidth: isToday ? 1 : 0,
                    borderColor: isToday ? C.accent : 'transparent',
                  }}
                >
                  <Text style={[
                    T.smallM,
                    {
                      color: !cell.inMonth ? C.text4 : dayOfWeek === 0 ? C.red : dayOfWeek === 6 ? C.blue : C.text,
                      textAlign: 'center',
                    },
                  ]}>
                    {cell.day}
                  </Text>
                  <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 2, marginTop: 4, flexWrap: 'wrap' }}>
                    {dayEvents.slice(0, 3).map((e) => (
                      <View
                        key={e.id}
                        style={{
                          width: 4, height: 4, borderRadius: 2,
                          backgroundColor:
                            e.source === 'official' ? C.accent :
                            e.source === 'proposal' ? C.amber :
                            C.green,
                        }}
                      />
                    ))}
                  </View>
                </PressableScale>
              );
            })}
          </View>
        ))}
      </View>

      {/* 凡例 */}
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: SP['3'], paddingVertical: SP['2'] }}>
        <Legend color={C.accent} label="公式" />
        <Legend color={C.amber} label="提案中" />
        <Legend color={C.green} label="自分" />
      </View>

      {/* 選択日のイベント一覧 */}
      <ScrollView
        style={{ flex: 1, borderTopWidth: 1, borderTopColor: C.border }}
        contentContainerStyle={{ padding: SP['4'], paddingBottom: insets.bottom + SP['8'], gap: SP['2'] }}
      >
        {!selectedDate ? (
          <Text style={[T.small, { color: C.text3, textAlign: 'center', padding: SP['4'] }]}>
            日付をタップで予定を表示
          </Text>
        ) : isLoading ? (
          <ActivityIndicator color={C.accent} />
        ) : selectedEvents.length === 0 ? (
          <Text style={[T.small, { color: C.text3, textAlign: 'center', padding: SP['4'] }]}>
            {selectedDate} に予定はありません
          </Text>
        ) : (
          selectedEvents.map((ev) => (
            <EventCard
              key={ev.id}
              event={ev}
              voted={!!myVotes[ev.id]}
              onVote={() =>
                voteMut.mutate({ id: ev.id, vote: !myVotes[ev.id] })
              }
            />
          ))
        )}
      </ScrollView>

      {/* 追加モーダル */}
      <AddEventModal
        visible={showAddModal}
        defaultDate={selectedDate ?? todayStr}
        onClose={() => setShowAddModal(false)}
        onAdded={() => {
          setShowAddModal(false);
          qc.invalidateQueries({ queryKey: ['calendar'] });
          show('予定を追加しました', 'success');
        }}
      />
    </View>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
      <Text style={[T.caption, { color: C.text3 }]}>{label}</Text>
    </View>
  );
}

function EventCard({ event, voted, onVote }: { event: CalendarEvent; voted: boolean; onVote: () => void }) {
  const isProposal = event.source === 'proposal';
  const isOfficial = event.source === 'official';
  return (
    <View style={{
      padding: SP['4'],
      backgroundColor: C.bg2,
      borderRadius: R.lg,
      borderWidth: 1,
      borderColor: isProposal ? C.amber + '44' : C.border,
      gap: SP['2'],
    }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: SP['2'] }}>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'], marginBottom: 2 }}>
            <View style={{
              paddingHorizontal: SP['2'], paddingVertical: 2, borderRadius: R.sm,
              backgroundColor: isProposal ? C.amberBg : isOfficial ? C.accentBg : C.greenBg,
            }}>
              <Text style={[T.caption, { color: isProposal ? C.amber : isOfficial ? C.accentLight : C.green }]}>
                {isProposal ? '提案中' : isOfficial ? '公式' : '自分'}
              </Text>
            </View>
            {event.tag_name && (
              <Text style={[T.caption, { color: C.accent }]}>#{event.tag_name}</Text>
            )}
          </View>
          <Text style={[T.bodyMd, { color: C.text }]}>{event.title}</Text>
          {event.location && (
            <Text style={[T.caption, { color: C.text3, marginTop: 2 }]}>📍 {event.location}</Text>
          )}
        </View>
      </View>
      {isProposal && (
        <View style={{ gap: SP['2'] }}>
          <View style={{ height: 4, backgroundColor: C.bg4, borderRadius: 2, overflow: 'hidden' }}>
            <View style={{
              height: '100%',
              width: `${Math.min(100, ((event.vote_count ?? 0) / Math.max(event.required_votes ?? 1, 1)) * 100)}%`,
              backgroundColor: C.amber,
            }} />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
            <Text style={[T.caption, { color: C.text3, flex: 1 }]}>
              {event.vote_count ?? 0} / {event.required_votes ?? 1} 同意で全員のカレンダーに採用（タグ参加者の10%）
            </Text>
            <PressableScale
              onPress={onVote}
              haptic="confirm"
              style={{
                paddingHorizontal: SP['3'],
                paddingVertical: SP['2'],
                borderRadius: R.full,
                backgroundColor: voted ? C.amber : C.bg3,
                borderWidth: 1,
                borderColor: voted ? C.amber : C.border,
              }}
            >
              <Text style={[T.smallM, { color: voted ? '#fff' : C.text2 }]}>
                {voted ? '✓ 同意済み' : '同意する'}
              </Text>
            </PressableScale>
          </View>
        </View>
      )}
    </View>
  );
}

function AddEventModal({
  visible,
  defaultDate,
  onClose,
  onAdded,
}: {
  visible: boolean;
  defaultDate: string;
  onClose: () => void;
  onAdded: () => void;
}) {
  // selector化 — modal が出るたびに blockedTags の更新で巻き込まれないよう、
  // likedTags のみ subscribe する。
  const likedTags = useTagFilterStore((s) => s.likedTags);
  const show = useToastStore((s) => s.show);
  const insets = useSafeAreaInsets();
  // web: ソフトキーボード高さ (native は 0)。scrim の下 padding に足して
  // sheet をキーボードの上へ持ち上げる (入力欄/追加ボタンがキーボードの裏に隠れない)。
  const webKeyboardInset = useWebKeyboardInset();
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(defaultDate);
  const [tag, setTag] = useState(likedTags[0] ?? '');
  const [location, setLocation] = useState('');
  const [scope, setScope] = useState<'personal' | 'proposal'>('personal');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!title.trim()) {
      show('タイトルを入力してください', 'warn');
      return;
    }
    if (scope === 'proposal' && !tag.trim()) {
      show('提案にはタグが必要です', 'warn');
      return;
    }
    setSaving(true);
    try {
      if (scope === 'personal') {
        await createPersonalEvent({
          title: title.trim(),
          event_date: date,
          tag_name: tag.trim() || undefined,
          location: location.trim() || undefined,
        });
      } else {
        await createProposal({
          title: title.trim(),
          event_date: date,
          tag_name: tag.trim(),
          location: location.trim() || undefined,
        });
      }
      setTitle('');
      setLocation('');
      onAdded();
    } catch (e) {
      show('追加に失敗しました', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={{
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.6)',
        justifyContent: 'flex-end',
        // web のみ: キーボード高さ分 content box を縮め、sheet をキーボード上端へ。
        paddingBottom: webKeyboardInset,
      }}>
        <View style={{
          backgroundColor: C.bg2,
          padding: SP['5'],
          // キーボード表示中 (web) は home indicator 用 safe-area を足さない。
          paddingBottom: webKeyboardInset > 0 ? SP['5'] : insets.bottom + SP['5'],
          borderTopLeftRadius: 24,
          borderTopRightRadius: 24,
          gap: SP['4'],
          // 縦長フォーム — 画面 (キーボード上) に収め、はみ出し分はスクロールさせる。
          maxHeight: '90%',
        }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={[T.h3, { color: C.text }]}>予定を追加</Text>
            <PressableScale
              onPress={onClose}
              haptic="tap"
              hitSlop={12}
              accessibilityLabel="閉じる"
              style={{ padding: SP['2'] }}
            >
              <Icon.close size={22} color={C.text2} strokeWidth={2.2} />
            </PressableScale>
          </View>

          {/* フォーム本体 — キーボードで panel が縮む時にここがスクロールし、
              header と「追加」ボタンは常に見える (flexShrink: 1 で内寸に収める)。 */}
          <ScrollView
            style={{ flexShrink: 1 }}
            contentContainerStyle={{ gap: SP['4'] }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* 公開範囲選択 */}
            <View style={{ flexDirection: 'row', gap: SP['2'] }}>
              <ScopeOption
                active={scope === 'personal'}
                label="🔒 自分だけ"
                desc="自分のカレンダーにだけ追加"
                onPress={() => setScope('personal')}
              />
              <ScopeOption
                active={scope === 'proposal'}
                label="📢 みんなに提案"
                desc="10%同意でタグ全体に同期"
                onPress={() => setScope('proposal')}
              />
            </View>

            <Input
              label="タイトル"
              value={title}
              onChangeText={setTitle}
              placeholder="例: 推しライブ"
              // memory DoS 対策: タイトルは 80 文字 cap
              maxLength={80}
            />
            <Input
              label="日付"
              value={date}
              onChangeText={setDate}
              placeholder="YYYY-MM-DD"
              // memory DoS 対策: 日付 string は 10 文字 (YYYY-MM-DD)
              maxLength={10}
            />
            <Input
              label={scope === 'proposal' ? 'タグ（必須）' : 'タグ（任意）'}
              value={tag}
              onChangeText={setTag}
              placeholder="例: アニメ"
              icon={Icon.hash}
              // memory DoS 対策: tag 名は 40 文字 cap
              maxLength={40}
            />
            <Input
              label="場所（任意）"
              value={location}
              onChangeText={setLocation}
              placeholder="例: 渋谷"
              // memory DoS 対策: 場所は 200 文字 cap
              maxLength={200}
            />
          </ScrollView>

          <Button label="追加" onPress={submit} loading={saving} />
        </View>
      </View>
    </Modal>
  );
}

function ScopeOption({
  active,
  label,
  desc,
  onPress,
}: {
  active: boolean;
  label: string;
  desc: string;
  onPress: () => void;
}) {
  return (
    <PressableScale
      onPress={onPress}
      haptic="select"
      style={{
        flex: 1,
        padding: SP['3'],
        borderRadius: R.md,
        backgroundColor: active ? C.accentBg : C.bg3,
        borderWidth: 1.5,
        borderColor: active ? C.accent : C.border,
        gap: 2,
      }}
    >
      <Text style={[T.smallM, { color: active ? C.accentLight : C.text }]}>{label}</Text>
      <Text style={[T.caption, { color: C.text3 }]}>{desc}</Text>
    </PressableScale>
  );
}
