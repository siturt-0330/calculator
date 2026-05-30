// ============================================================
// hooks/useJoinCommunity.ts の deriveJoinAction のテスト
// ============================================================
// メンバーシップ + visibility から「カードの参加ボタンが何をすべきか」
// (none / join / navigate) を導く純関数の判定をルール通り検証する。
// ============================================================

// このテストは deriveJoinAction 純関数のみ対象。hook の依存先はすべてモック化する
jest.mock('expo-router', () => ({ useRouter: jest.fn() }));
jest.mock('@tanstack/react-query', () => ({ useQueryClient: jest.fn() }));
jest.mock('../../stores/toastStore', () => ({ useToastStore: jest.fn() }));
jest.mock('../../lib/api/communities', () => ({ joinCommunity: jest.fn() }));
import { deriveJoinAction } from '../../hooks/useJoinCommunity';

describe('deriveJoinAction', () => {
  it('メンバーなら open でも none (参加済みは何もしない)', () => {
    expect(deriveJoinAction({ visibility: 'open' }, true)).toBe('none');
  });

  it('メンバーなら request でも none', () => {
    expect(deriveJoinAction({ visibility: 'request' }, true)).toBe('none');
  });

  it('非メンバー + open はその場で join', () => {
    expect(deriveJoinAction({ visibility: 'open' }, false)).toBe('join');
  });

  it('非メンバー + request は詳細画面へ navigate', () => {
    expect(deriveJoinAction({ visibility: 'request' }, false)).toBe('navigate');
  });

  it('非メンバー + invite は詳細画面へ navigate', () => {
    expect(deriveJoinAction({ visibility: 'invite' }, false)).toBe('navigate');
  });
});
