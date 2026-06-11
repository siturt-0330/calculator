// ============================================================
// app/settings/notifications.tsx
// ============================================================
// 通知設定画面 — Push (端末通知) と In-app (アプリ内通知一覧) を
// 11 カテゴリ × 2 軸で独立トグルできる。
//
// データソース:
//   - master switch / quiet hours / Web push 設定 → zustand (settingsStore)
//   - カテゴリ別 push / inapp → notification_preferences テーブル (migration 0070)
//
// UI 構成 (2026-06-11 刷新):
//   - PC (web の広い画面) ではコンテンツを maxWidth 640 で中央寄せして間延びを防ぐ
//   - セクション = 小さな uppercase ラベル + hairline (admin の SectionHeader 風)
//     「プッシュ通知」(マスター + おやすみ時間を 1 カードに divider でまとめる)
//     → 「一括操作」(outline pill chips) → カテゴリ別カード
//   - 行アイコンは accentBg の丸チップ (影・白背景なし)
//   - 配色は useColors() (ライト/ダーク両対応)
// ============================================================

import { useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  Switch,
  Modal,
  Pressable,
  Platform,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';
import type { ComponentType } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TopBar } from '../../components/nav/TopBar';
import { BackButton } from '../../components/nav/BackButton';
import { Divider } from '../../components/ui/Divider';
import { PressableScale } from '../../components/ui/PressableScale';
import { PushNotificationToggle } from '../../components/ui/PushNotificationToggle';
import { registerNativePushToken } from '../../lib/api/push';
import { NotificationToggleRow } from '../../components/settings/NotificationToggleRow';
import { useSettingsStore, isInQuietHours } from '../../stores/settingsStore';
import { useToastStore } from '../../stores/toastStore';
import {
  useNotificationPreferences,
  useUpdateNotificationPreference,
} from '../../hooks/useNotificationPreferences';
import type {
  NotificationCategory,
  NotificationPref,
} from '../../lib/api/notificationPreferences';
import { R, SP } from '../../design/tokens';
import { T } from '../../design/typography';
import { Icon } from '../../constants/icons';
import { useColors } from '../../hooks/useColors';
import type { LucideIcon } from 'lucide-react-native';

// ============================================================
// セクション定義 — UI 上のグルーピング
// ============================================================
type CategoryRow = {
  category: NotificationCategory;
  label: string;
  description: string;
  icon: keyof typeof Icon;
};

type Section = { title: string; rows: CategoryRow[] };

const SECTIONS: readonly Section[] = [
  {
    title: 'いいね・コメント・返信',
    rows: [
      { category: 'like', label: 'いいね', description: '投稿にいいねされたとき', icon: 'heart' },
      { category: 'comment', label: 'コメント', description: '投稿にコメントが付いたとき', icon: 'comment' },
      { category: 'reply', label: '返信', description: '自分のコメントに返信が付いたとき', icon: 'comment' },
    ],
  },
  {
    title: 'メンション・フォロー',
    rows: [
      { category: 'mention', label: 'メンション', description: '@で名指しされたとき', icon: 'at' },
      { category: 'follow', label: 'フォロー', description: '誰かにフォローされたとき', icon: 'friends' },
    ],
  },
  {
    title: '友達',
    rows: [
      { category: 'friend_request', label: '友達リクエスト', description: '友達リクエストを受信したとき', icon: 'friends' },
      { category: 'friend_accept', label: '友達承認', description: '友達リクエストが承認されたとき', icon: 'friends' },
    ],
  },
  {
    title: '公式・イベント',
    rows: [
      { category: 'official_post', label: '公式投稿', description: '公式コミュニティの新着情報', icon: 'shield' },
      { category: 'event', label: 'イベント通知', description: '推しイベントの開催情報', icon: 'calendar' },
    ],
  },
  {
    title: 'モデレーション・システム',
    rows: [
      { category: 'mod_action', label: 'モデレーション操作', description: '管理者から通知があったとき', icon: 'shield' },
      { category: 'system', label: 'システム通知', description: '運営からのお知らせ・アップデート情報', icon: 'bell' },
    ],
  },
] as const;

// PC ブラウザでカードが全幅に間延びしないための中央寄せ幅
const CONTENT_MAX_WIDTH = 640;

export default function NotificationsSettingsScreen() {
  const insets = useSafeAreaInsets();
  const C = useColors();
  const { width: winW } = useWindowDimensions();
  // web の広い画面のみ中央 640px に収める (native / 狭い web では全幅)
  const isWideWeb = Platform.OS === 'web' && winW >= 700;

  // 全 store 取得をやめて必要 field のみ subscribe — 他 field の更新で
  // re-render されないようにする (旧 _layout の挙動と同じ)
  const pushEnabled = useSettingsStore((s) => s.pushEnabled);
  const quietStartHour = useSettingsStore((s) => s.quietStartHour);
  const quietEndHour = useSettingsStore((s) => s.quietEndHour);
  const update = useSettingsStore((s) => s.update);
  const show = useToastStore((s) => s.show);
  const [quietPickerOpen, setQuietPickerOpen] = useState<null | 'start' | 'end'>(null);

  const quietActive = isInQuietHours(quietStartHour, quietEndHour);

  // カテゴリ別 preference の取得 + mutation
  const { preferences, isLoading } = useNotificationPreferences();
  const mutate = useUpdateNotificationPreference();

  // category → { push, inapp } マップ (lookup O(1))
  const prefMap = useMemo(() => {
    const m = new Map<NotificationCategory, NotificationPref>();
    for (const p of preferences) m.set(p.category, p);
    return m;
  }, [preferences]);

  function getPref(category: NotificationCategory): { push: boolean; inapp: boolean } {
    const p = prefMap.get(category);
    return { push: p?.push ?? true, inapp: p?.inapp ?? true };
  }

  function handleChange(category: NotificationCategory, patch: { push?: boolean; inapp?: boolean }) {
    mutate.mutate({ category, patch });
  }

  // 一括操作 (全 push off / 全 inapp off / 全 on)
  function bulkApply(value: boolean, target: 'push' | 'inapp' | 'both') {
    for (const section of SECTIONS) {
      for (const row of section.rows) {
        const patch =
          target === 'push' ? { push: value }
          : target === 'inapp' ? { inapp: value }
          : { push: value, inapp: value };
        mutate.mutate({ category: row.category, patch });
      }
    }
  }

  // マスタースイッチ ON 時、native は OS 権限要求 + Expo Push Token 登録まで行う。
  // 旧 onboarding 通知画面が native の唯一の権限要求箇所だったが、登録最小化で廃止したため、
  // ここが native ユーザーの push 有効化の入口になる。これが無いと token 未登録で通知が永遠に届かない。
  // web は PushNotificationToggle が別途権限/購読を扱うので、ここではフラグ更新のみ。
  const handleMasterToggle = useCallback(
    async (v: boolean) => {
      if (v && Platform.OS !== 'web') {
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
          const Notifications = require('expo-notifications') as typeof import('expo-notifications');
          const perm = await Notifications.requestPermissionsAsync();
          // OS ダイアログで「許可しない」を選んだら pushEnabled を true にしない。
          // (旧実装は granted を無視して必ず ON にしていたため「ONなのに永遠に届かない」不整合が出た)
          if (!perm.granted) {
            show('端末の通知が許可されていません。設定アプリから許可してください', 'warn');
            update('pushEnabled', false);
            return;
          }
          const r = await registerNativePushToken();
          if (!r.ok) {
            console.warn('[settings] push token register failed:', r.error);
            show('通知の登録に失敗しました。時間をおいて再試行してください', 'warn');
          }
        } catch (e) {
          console.warn('[settings] notification setup error:', e);
          show('通知の設定中にエラーが発生しました', 'warn');
          update('pushEnabled', false);
          return;
        }
      }
      update('pushEnabled', v);
    },
    [update, show],
  );

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <TopBar title="通知設定" left={<BackButton />} />
      <ScrollView
        contentContainerStyle={{
          padding: SP['4'],
          paddingBottom: insets.bottom + SP['10'],
        }}
      >
        {/* 中央寄せラッパ — PC の広い画面でのみ maxWidth を効かせる */}
        <View
          style={{
            width: '100%',
            maxWidth: isWideWeb ? CONTENT_MAX_WIDTH : undefined,
            alignSelf: 'center',
            gap: SP['6'],
          }}
        >
          {/* リード文 — カード化せず軽く添える */}
          <Text style={[T.caption, { color: C.text3, paddingHorizontal: SP['1'] }]}>
            Push (端末通知) と In-app (アプリ内通知一覧) はカテゴリごとに別々で on / off できます。
          </Text>

          {/* ===== プッシュ通知 (マスター + おやすみ時間) ===== */}
          <View style={{ gap: SP['2'] }}>
            <SectionHeader label="プッシュ通知" />
            <View
              style={{
                backgroundColor: C.bg2,
                borderRadius: R.lg,
                borderWidth: 1,
                borderColor: C.border,
                overflow: 'hidden',
              }}
            >
              {/* マスタートグル */}
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: SP['3'],
                  padding: SP['4'],
                }}
              >
                <IconChip icon={Icon.bell} active={pushEnabled} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={[T.bodyB, { color: C.text }]}>プッシュ通知マスター</Text>
                  <Text style={[T.caption, { color: C.text3 }]}>
                    {pushEnabled
                      ? 'カテゴリ別の設定に従って通知します'
                      : 'すべての Push が無効化されています'}
                  </Text>
                </View>
                <Switch
                  value={pushEnabled}
                  onValueChange={handleMasterToggle}
                  trackColor={{ false: C.bg4, true: C.accent }}
                  thumbColor="#fff"
                />
              </View>
              <Divider />
              {/* おやすみ時間 */}
              <View style={{ padding: SP['4'], gap: SP['3'] }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP['3'] }}>
                  <IconChip icon={Icon.moon} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={[T.bodyB, { color: C.text }]}>おやすみ時間</Text>
                    <Text style={[T.caption, { color: C.text3 }]}>
                      指定した時間帯はすべてのプッシュ通知をミュートします
                    </Text>
                  </View>
                  {quietActive && (
                    <View
                      style={{
                        paddingHorizontal: SP['2'],
                        paddingVertical: 2,
                        backgroundColor: C.accentBg,
                        borderRadius: R.full,
                      }}
                    >
                      <Text style={[T.captionM, { color: C.accent }]}>ミュート中</Text>
                    </View>
                  )}
                </View>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: SP['3'],
                  }}
                >
                  <HourPill
                    label="開始"
                    value={quietStartHour}
                    onPress={() => setQuietPickerOpen('start')}
                  />
                  <Text style={[T.bodyM, { color: C.text3 }]}>〜</Text>
                  <HourPill
                    label="終了"
                    value={quietEndHour}
                    onPress={() => setQuietPickerOpen('end')}
                  />
                </View>
                {(quietStartHour !== null || quietEndHour !== null) && (
                  <PressableScale
                    onPress={() => {
                      update('quietStartHour', null);
                      update('quietEndHour', null);
                    }}
                    style={{
                      alignSelf: 'center',
                      paddingHorizontal: SP['3'],
                      paddingVertical: SP['1'],
                    }}
                  >
                    <Text style={[T.caption, { color: C.text3, textDecorationLine: 'underline' }]}>
                      設定を解除
                    </Text>
                  </PressableScale>
                )}
              </View>
            </View>

            {/* Web Push (ブラウザ通知) — native では何も描画されない */}
            <PushNotificationToggle />
          </View>

          {/* ===== 一括操作 ===== */}
          <View style={{ gap: SP['2'] }}>
            <SectionHeader label="一括操作" />
            <View
              style={{
                flexDirection: 'row',
                flexWrap: 'wrap',
                gap: SP['2'],
                paddingHorizontal: SP['1'],
              }}
            >
              <BulkChip label="全 Push OFF" onPress={() => bulkApply(false, 'push')} />
              <BulkChip label="全 In-app OFF" onPress={() => bulkApply(false, 'inapp')} />
              <BulkChip label="全 ON" onPress={() => bulkApply(true, 'both')} />
            </View>
          </View>

          {/* ===== カテゴリ別 prefs ===== */}
          {SECTIONS.map((section) => (
            <View key={section.title} style={{ gap: SP['2'] }}>
              <SectionHeader label={section.title} />
              <View
                style={{
                  backgroundColor: C.bg2,
                  borderRadius: R.lg,
                  borderWidth: 1,
                  borderColor: C.border,
                  overflow: 'hidden',
                  opacity: isLoading ? 0.6 : 1,
                }}
              >
                {section.rows.map((row, i) => {
                  const IconCmp = Icon[row.icon];
                  const { push, inapp } = getPref(row.category);
                  return (
                    <View key={row.category}>
                      <NotificationToggleRow
                        icon={IconCmp}
                        label={row.label}
                        description={row.description}
                        push={push}
                        inapp={inapp}
                        onChangePush={(v) => handleChange(row.category, { push: v })}
                        onChangeInApp={(v) => handleChange(row.category, { inapp: v })}
                      />
                      {i < section.rows.length - 1 && <Divider />}
                    </View>
                  );
                })}
              </View>
            </View>
          ))}
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

// ============================================================
// セクション見出し — 小さな uppercase ラベル + hairline (admin の SectionHeader 風)
// ============================================================
function SectionHeader({ label }: { label: string }) {
  const C = useColors();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: SP['2'],
        paddingHorizontal: SP['1'],
      }}
    >
      <Text
        style={{
          fontSize: 10,
          fontWeight: '800',
          color: C.text3,
          letterSpacing: 1.2,
          textTransform: 'uppercase',
        }}
      >
        {label}
      </Text>
      <View style={{ flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: C.border }} />
    </View>
  );
}

// ============================================================
// アイコン丸チップ — 背景 accentBg の正円。影・白背景は付けない
// ============================================================
type IconLike = LucideIcon | ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;

function IconChip({ icon: IconCmp, active = false }: { icon: IconLike; active?: boolean }) {
  const C = useColors();
  return (
    <View
      style={{
        width: 40,
        height: 40,
        borderRadius: R.full,
        backgroundColor: active ? C.accent : C.accentBg,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <IconCmp size={20} color={active ? '#fff' : C.accent} strokeWidth={2.2} />
    </View>
  );
}

// ============================================================
// 一括操作 chip — outline pill
// ============================================================
function BulkChip({ label, onPress }: { label: string; onPress: () => void }) {
  const C = useColors();
  return (
    <PressableScale
      onPress={onPress}
      haptic="tap"
      style={{
        height: 34,
        paddingHorizontal: SP['4'],
        borderRadius: R.full,
        borderWidth: 1,
        borderColor: C.border2,
        backgroundColor: 'transparent',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={[T.smallM, { color: C.text2 }]}>{label}</Text>
    </PressableScale>
  );
}

// ============================================================
// おやすみ時間ピッカー — 丸ピル (未設定は「—」/ 設定済みは accent 文字)
// ============================================================
function HourPill({
  label,
  value,
  onPress,
}: {
  label: string;
  value: number | null;
  onPress: () => void;
}) {
  const C = useColors();
  return (
    <PressableScale
      onPress={onPress}
      haptic="tap"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: SP['2'],
        height: 40,
        minWidth: 116,
        paddingHorizontal: SP['4'],
        borderRadius: R.full,
        backgroundColor: C.bg3,
        borderWidth: 1,
        borderColor: value === null ? C.border : C.accent + '66',
      }}
    >
      <Text style={[T.caption, { color: C.text3 }]}>{label}</Text>
      <Text style={[T.bodyB, { color: value === null ? C.text3 : C.accent }]}>
        {value === null ? '—' : `${String(value).padStart(2, '0')}:00`}
      </Text>
    </PressableScale>
  );
}

function HourPickerModal({
  visible,
  title,
  value,
  onClose,
  onConfirm,
}: {
  visible: boolean;
  title: string;
  value: number | null;
  onClose: () => void;
  onConfirm: (hour: number) => void;
}) {
  const C = useColors();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        style={{ flex: 1, backgroundColor: C.scrim, justifyContent: 'flex-end' }}
      >
        <Pressable
          onPress={(e) => e.stopPropagation()}
          style={{
            // PC でも間延びしないようシートの中身は中央 560px に収める (狭い画面では全幅)
            width: '100%',
            maxWidth: 560,
            alignSelf: 'center',
            backgroundColor: C.bg2,
            borderTopLeftRadius: R.xl,
            borderTopRightRadius: R.xl,
            padding: SP['4'],
            paddingBottom: SP['6'],
            gap: SP['3'],
          }}
        >
          <Text style={[T.h4, { color: C.text, textAlign: 'center' }]}>{title}</Text>
          <View
            style={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              gap: SP['2'],
              justifyContent: 'center',
            }}
          >
            {Array.from({ length: 24 }).map((_, h) => (
              <PressableScale
                key={h}
                onPress={() => onConfirm(h)}
                haptic="tap"
                style={{
                  width: 56,
                  height: 44,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: value === h ? C.accent : C.bg3,
                  borderRadius: R.md,
                  borderWidth: 1,
                  borderColor: value === h ? C.accent : C.border,
                }}
              >
                <Text
                  style={[
                    T.smallM,
                    { color: value === h ? '#fff' : C.text, fontWeight: '700' },
                  ]}
                >
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
