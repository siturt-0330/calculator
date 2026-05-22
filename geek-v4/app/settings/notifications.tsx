import { useState } from 'react';
import { View, Text, ScrollView, Switch, Modal, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TopBar } from '../../components/nav/TopBar';
import { BackButton } from '../../components/nav/BackButton';
import { Divider } from '../../components/ui/Divider';
import { PressableScale } from '../../components/ui/PressableScale';
import { PushNotificationToggle } from '../../components/ui/PushNotificationToggle';
import { useSettingsStore, isInQuietHours } from '../../stores/settingsStore';
import { C, R, SP } from '../../design/tokens';
import { T } from '../../design/typography';
import { Icon } from '../../constants/icons';

type Row = {
  key:
    | 'notifyLike'
    | 'notifyComment'
    | 'notifyFollow'
    | 'notifyEvent'
    | 'notifyReply'
    | 'notifyMention'
    | 'notifyTagNew'
    | 'notifyAnnouncement';
  label: string;
  desc: string;
  icon: keyof typeof Icon;
};

const ROWS: Row[] = [
  { key: 'notifyLike', label: 'いいね', desc: '投稿にいいねされたとき', icon: 'heart' },
  { key: 'notifyComment', label: 'コメント', desc: '投稿にコメントが付いたとき', icon: 'comment' },
  { key: 'notifyReply', label: '返信', desc: '自分のコメントに返信が付いたとき', icon: 'comment' },
  { key: 'notifyMention', label: 'メンション', desc: '@で名指しされたとき', icon: 'at' },
  { key: 'notifyFollow', label: 'フォロー', desc: '誰かにフォローされたとき', icon: 'friends' },
  { key: 'notifyTagNew', label: '好きなタグの新着', desc: 'フォロー中タグに新しい投稿があったとき', icon: 'hash' },
  { key: 'notifyEvent', label: 'イベント', desc: '推しイベントの開催情報', icon: 'calendar' },
  { key: 'notifyAnnouncement', label: '運営からのお知らせ', desc: 'アップデート・キャンペーン情報', icon: 'info' },
];

export default function NotificationsSettingsScreen() {
  const insets = useSafeAreaInsets();
  // 全 store 取得をやめて必要 field のみ subscribe — 他の field (language /
  // dataSaver / reduceMotion 等) が更新されたとき、この screen を re-render
  // しないようにする。settings は 15+ field あるので大幅な削減になる。
  const pushEnabled = useSettingsStore((s) => s.pushEnabled);
  const quietStartHour = useSettingsStore((s) => s.quietStartHour);
  const quietEndHour = useSettingsStore((s) => s.quietEndHour);
  const notifyLike = useSettingsStore((s) => s.notifyLike);
  const notifyComment = useSettingsStore((s) => s.notifyComment);
  const notifyFollow = useSettingsStore((s) => s.notifyFollow);
  const notifyEvent = useSettingsStore((s) => s.notifyEvent);
  const notifyReply = useSettingsStore((s) => s.notifyReply);
  const notifyMention = useSettingsStore((s) => s.notifyMention);
  const notifyTagNew = useSettingsStore((s) => s.notifyTagNew);
  const notifyAnnouncement = useSettingsStore((s) => s.notifyAnnouncement);
  const update = useSettingsStore((s) => s.update);
  const settingsValues: Record<Row['key'], boolean> = {
    notifyLike, notifyComment, notifyFollow, notifyEvent,
    notifyReply, notifyMention, notifyTagNew, notifyAnnouncement,
  };
  const [quietPickerOpen, setQuietPickerOpen] = useState<null | 'start' | 'end'>(null);

  const quietActive = isInQuietHours(quietStartHour, quietEndHour);

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <TopBar title="通知設定" left={<BackButton />} />
      <ScrollView
        contentContainerStyle={{
          padding: SP['4'],
          paddingBottom: insets.bottom + SP['10'],
          gap: SP['5'],
        }}
      >
        {/* Master switch */}
        <View style={{
          padding: SP['4'],
          backgroundColor: C.bg2,
          borderRadius: R.lg,
          borderWidth: 1,
          borderColor: C.border,
          flexDirection: 'row',
          alignItems: 'center',
          gap: SP['3'],
        }}>
          <View style={{
            width: 44, height: 44, borderRadius: 22,
            backgroundColor: pushEnabled ? C.accent : C.bg3,
            alignItems: 'center', justifyContent: 'center',
          }}>
            <Icon.bell size={22} color={pushEnabled ? '#fff' : C.text3} strokeWidth={2.2} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[T.bodyM, { color: C.text, fontWeight: '700' }]}>プッシュ通知</Text>
            <Text style={[T.caption, { color: C.text3 }]}>
              {pushEnabled ? '有効' : 'すべての通知が無効化されています'}
            </Text>
          </View>
          <Switch
            value={pushEnabled}
            onValueChange={(v) => update('pushEnabled', v)}
            trackColor={{ false: C.bg4, true: C.accent }}
            thumbColor="#fff"
          />
        </View>

        {/* Web Push (ブラウザ通知) — native では何も描画されない */}
        <PushNotificationToggle />

        {/* おやすみ時間 (Quiet hours) */}
        <View style={{
          padding: SP['4'],
          backgroundColor: C.bg2,
          borderRadius: R.lg,
          borderWidth: 1,
          borderColor: C.border,
          gap: SP['3'],
        }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['2'] }}>
            <Icon.clock size={16} color={C.text2} strokeWidth={2.2} />
            <Text style={[T.bodyM, { color: C.text, fontWeight: '700' }]}>おやすみ時間</Text>
            {quietActive && (
              <View style={{
                marginLeft: 'auto',
                paddingHorizontal: SP['2'], paddingVertical: 2,
                backgroundColor: C.accent + '33', borderRadius: R.full,
              }}>
                <Text style={[T.caption, { color: C.accent, fontWeight: '700' }]}>現在ミュート中</Text>
              </View>
            )}
          </View>
          <Text style={[T.caption, { color: C.text3 }]}>
            指定した時間帯はすべてのプッシュ通知をミュートします
          </Text>
          <View style={{ flexDirection: 'row', gap: SP['2'], alignItems: 'center' }}>
            <HourPickerButton
              label="開始"
              value={quietStartHour}
              onPress={() => setQuietPickerOpen('start')}
            />
            <Text style={{ color: C.text3 }}>—</Text>
            <HourPickerButton
              label="終了"
              value={quietEndHour}
              onPress={() => setQuietPickerOpen('end')}
            />
            {(quietStartHour !== null || quietEndHour !== null) && (
              <PressableScale
                onPress={() => {
                  update('quietStartHour', null);
                  update('quietEndHour', null);
                }}
                style={{ paddingHorizontal: SP['2'], paddingVertical: SP['1'] }}
              >
                <Text style={[T.caption, { color: C.text3 }]}>解除</Text>
              </PressableScale>
            )}
          </View>
        </View>

        {/* 種別ごとの ON/OFF */}
        <View style={{ gap: SP['2'] }}>
          <Text style={[T.smallM, { color: C.text3, paddingHorizontal: SP['2'] }]}>通知の種類</Text>
          <View style={{
            backgroundColor: C.bg2,
            borderRadius: R.lg,
            borderWidth: 1,
            borderColor: C.border,
            overflow: 'hidden',
            opacity: pushEnabled ? 1 : 0.45,
          }}>
            {ROWS.map((r, i) => {
              const I = Icon[r.icon];
              const value = settingsValues[r.key];
              return (
                <View key={r.key}>
                  <View style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    padding: SP['4'],
                    gap: SP['3'],
                  }}>
                    <View style={{
                      width: 36, height: 36, borderRadius: 18,
                      backgroundColor: C.accentSoft,
                      alignItems: 'center', justifyContent: 'center',
                    }}>
                      <I size={18} color={C.accent} strokeWidth={2} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[T.body, { color: C.text }]}>{r.label}</Text>
                      <Text style={[T.caption, { color: C.text3 }]}>{r.desc}</Text>
                    </View>
                    <Switch
                      value={value}
                      onValueChange={(v) => update(r.key, v)}
                      trackColor={{ false: C.bg4, true: C.accent }}
                      thumbColor="#fff"
                      disabled={!pushEnabled}
                    />
                  </View>
                  {i < ROWS.length - 1 && <Divider />}
                </View>
              );
            })}
          </View>
        </View>
      </ScrollView>

      <HourPickerModal
        visible={quietPickerOpen !== null}
        title={quietPickerOpen === 'start' ? '開始時刻' : '終了時刻'}
        value={quietPickerOpen === 'start' ? quietStartHour : quietEndHour}
        onClose={() => setQuietPickerOpen(null)}
        onConfirm={(h) => {
          if (quietPickerOpen === 'start') update('quietStartHour', h);
          else if (quietPickerOpen === 'end') update('quietEndHour', h);
          setQuietPickerOpen(null);
        }}
      />
    </View>
  );
}

function HourPickerButton({ label, value, onPress }: { label: string; value: number | null; onPress: () => void }) {
  return (
    <PressableScale
      onPress={onPress}
      haptic="tap"
      style={{
        paddingHorizontal: SP['3'],
        paddingVertical: SP['3'],
        backgroundColor: C.bg3,
        borderRadius: R.md,
        borderWidth: 1,
        borderColor: C.border,
        minWidth: 92,
        alignItems: 'center',
      }}
    >
      <Text style={[T.caption, { color: C.text3 }]}>{label}</Text>
      <Text style={[T.body, { color: C.text, fontWeight: '700' }]}>
        {value === null ? '—' : `${String(value).padStart(2, '0')}:00`}
      </Text>
    </PressableScale>
  );
}

function HourPickerModal({
  visible, title, value, onClose, onConfirm,
}: {
  visible: boolean;
  title: string;
  value: number | null;
  onClose: () => void;
  onConfirm: (hour: number) => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: '#000a', justifyContent: 'flex-end' }}>
        <Pressable onPress={(e) => e.stopPropagation()} style={{
          backgroundColor: C.bg2,
          borderTopLeftRadius: R.xl,
          borderTopRightRadius: R.xl,
          padding: SP['4'],
          paddingBottom: SP['6'],
          gap: SP['3'],
        }}>
          <Text style={[T.h4, { color: C.text, textAlign: 'center' }]}>{title}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SP['2'], justifyContent: 'center' }}>
            {Array.from({ length: 24 }).map((_, h) => (
              <PressableScale
                key={h}
                onPress={() => onConfirm(h)}
                haptic="tap"
                style={{
                  width: 56, height: 44,
                  alignItems: 'center', justifyContent: 'center',
                  backgroundColor: value === h ? C.accent : C.bg3,
                  borderRadius: R.md,
                  borderWidth: 1,
                  borderColor: value === h ? C.accent : C.border,
                }}
              >
                <Text style={[T.smallM, { color: value === h ? '#fff' : C.text, fontWeight: '700' }]}>
                  {String(h).padStart(2, '0')}
                </Text>
              </PressableScale>
            ))}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
