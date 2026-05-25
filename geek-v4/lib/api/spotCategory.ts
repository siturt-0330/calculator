// ============================================================
// lib/api/spotCategory.ts
// ------------------------------------------------------------
// 聖地のカテゴリ定義 — supabase / react-native 依存を持たない pure モジュール。
// テスト (tests/unit/spotCategory.test.ts) から import できるよう、
// lib/api/communities.ts (RN チェーン含む) から分離した。
//
// migration 0045 の check 制約と一致させる必要がある。
// 値の追加 / 変更は migration 追加と同時に。
// ============================================================

export type SpotCategory =
  | 'live_venue'      // ライブ会場
  | 'work_setting'    // 聖地 (作品の舞台)
  | 'collab_cafe'     // コラボカフェ
  | 'goods_shop'      // グッズ販売
  | 'photo_spot'      // 撮影スポット
  | 'shrine_temple'   // 神社・寺
  | 'restaurant'      // 飲食
  | 'other';          // その他

export const SPOT_CATEGORY_META: Record<
  SpotCategory,
  { label: string; emoji: string; color: string }
> = {
  live_venue:    { label: 'ライブ会場',  emoji: '🎤', color: '#F472B6' },
  work_setting:  { label: '聖地',         emoji: '⛩',  color: '#7C6AF7' },
  collab_cafe:   { label: 'コラボカフェ', emoji: '☕', color: '#F5A623' },
  goods_shop:    { label: 'グッズ販売',  emoji: '🛍', color: '#22D3A4' },
  photo_spot:    { label: '撮影スポット', emoji: '📸', color: '#3B82F6' },
  shrine_temple: { label: '神社・寺',     emoji: '⛩',  color: '#A78BFA' },
  restaurant:    { label: '飲食',         emoji: '🍜', color: '#FF8C30' },
  other:         { label: 'その他',       emoji: '📍', color: '#94A3B8' },
};

// 作成 / 編集 UI で選択肢として並べる順 (other は最後)
export const SELECTABLE_SPOT_CATEGORIES: SpotCategory[] = [
  'live_venue',
  'work_setting',
  'collab_cafe',
  'goods_shop',
  'photo_spot',
  'shrine_temple',
  'restaurant',
  'other',
];
