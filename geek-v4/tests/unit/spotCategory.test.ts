// ============================================================
// SpotCategory / SPOT_CATEGORY_META の仕様回帰テスト
// ============================================================
// migration 0045 で追加した 8 カテゴリの DB 値とフロントの一致を保証。
// カテゴリラベルや色を変える時、テストが失敗 → 意図的か必ず気付ける。
// ============================================================

import {
  SELECTABLE_SPOT_CATEGORIES,
  SPOT_CATEGORY_META,
  type SpotCategory,
} from '../../lib/api/spotCategory';

describe('SpotCategory — 8 カテゴリ仕様', () => {
  it('SELECTABLE_SPOT_CATEGORIES に 8 件あり、other が最後', () => {
    expect(SELECTABLE_SPOT_CATEGORIES).toHaveLength(8);
    expect(SELECTABLE_SPOT_CATEGORIES[SELECTABLE_SPOT_CATEGORIES.length - 1]).toBe('other');
  });

  it('全カテゴリに META (label / emoji / color) が定義されている', () => {
    for (const c of SELECTABLE_SPOT_CATEGORIES) {
      const meta = SPOT_CATEGORY_META[c];
      expect(meta).toBeDefined();
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.emoji.length).toBeGreaterThan(0);
      expect(meta.color).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it('期待ラベルの確認 (user 仕様と一致)', () => {
    const expectedLabels: Record<SpotCategory, string> = {
      live_venue: 'ライブ会場',
      work_setting: '聖地',
      collab_cafe: 'コラボカフェ',
      goods_shop: 'グッズ販売',
      photo_spot: '撮影スポット',
      shrine_temple: '神社・寺',
      restaurant: '飲食',
      other: 'その他',
    };
    for (const [key, label] of Object.entries(expectedLabels)) {
      expect(SPOT_CATEGORY_META[key as SpotCategory].label).toBe(label);
    }
  });

  it('migration 0045 の check 制約と同じ値セットになっている', () => {
    // migration 側の値リスト (順序問わず、集合一致)
    const migrationValues = [
      'live_venue', 'work_setting', 'collab_cafe', 'goods_shop',
      'photo_spot', 'shrine_temple', 'restaurant', 'other',
    ];
    expect(new Set(SELECTABLE_SPOT_CATEGORIES)).toEqual(new Set(migrationValues));
  });
});
