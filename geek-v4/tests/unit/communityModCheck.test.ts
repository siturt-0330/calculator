// ============================================================
// lib/utils/communityModCheck.ts のテスト
// ============================================================
// migration 0068 と一緒に導入する mod 権限判定ロジックの単体テスト。
// 本番の権限担保は RLS + RPC 側 (SQL) なので、ここは UI 用ガードの
// 振る舞いを確認する。13 ケース。
// ============================================================

import {
  isModRole,
  roleRank,
  canDeletePost,
  canDeleteComment,
  canDeleteBBSReply,
  canKickMember,
  canBanMember,
  canPromoteMember,
  canDemoteMember,
} from '../../lib/utils/communityModCheck';

describe('isModRole', () => {
  it('owner / admin は true', () => {
    expect(isModRole('owner')).toBe(true);
    expect(isModRole('admin')).toBe(true);
  });

  it('member / null / undefined / 想定外文字列は false', () => {
    expect(isModRole('member')).toBe(false);
    expect(isModRole(null)).toBe(false);
    expect(isModRole(undefined)).toBe(false);
    expect(isModRole('moderator')).toBe(false);
    expect(isModRole('')).toBe(false);
  });
});

describe('roleRank', () => {
  it('owner > admin > member の順', () => {
    expect(roleRank('owner')).toBe(2);
    expect(roleRank('admin')).toBe(1);
    expect(roleRank('member')).toBe(0);
  });

  it('想定外は member 扱い (= 0)', () => {
    expect(roleRank(null)).toBe(0);
    expect(roleRank(undefined)).toBe(0);
    expect(roleRank('superuser')).toBe(0);
  });
});

describe('canDeletePost', () => {
  const post = {
    author_id: 'user-A',
    community_ids: ['comm-1', 'comm-2'],
  };

  it('投稿者本人は常に削除可 (mod でなくても)', () => {
    expect(
      canDeletePost(post, { id: 'user-A', modCommunities: [] }),
    ).toBe(true);
  });

  it('attached community の mod なら他人投稿でも削除可', () => {
    expect(
      canDeletePost(post, { id: 'user-B', modCommunities: ['comm-2'] }),
    ).toBe(true);
  });

  it('別 community の mod では削除不可 (交差なし)', () => {
    expect(
      canDeletePost(post, { id: 'user-B', modCommunities: ['comm-99'] }),
    ).toBe(false);
  });

  it('mod でもなく投稿者でもない一般ユーザーは削除不可', () => {
    expect(
      canDeletePost(post, { id: 'user-B', modCommunities: [] }),
    ).toBe(false);
  });

  it('未ログイン (id="") は削除不可', () => {
    expect(
      canDeletePost(post, { id: '', modCommunities: ['comm-1'] }),
    ).toBe(false);
  });
});

describe('canDeleteComment', () => {
  const comment = {
    author_id: 'user-A',
    post_community_ids: ['comm-1'],
  };

  it('自著は常に削除可', () => {
    expect(
      canDeleteComment(comment, { id: 'user-A', modCommunities: [] }),
    ).toBe(true);
  });

  it('該当 community の mod なら他人コメントも削除可', () => {
    expect(
      canDeleteComment(comment, { id: 'user-B', modCommunities: ['comm-1'] }),
    ).toBe(true);
  });

  it('別 community の mod では削除不可', () => {
    expect(
      canDeleteComment(comment, { id: 'user-B', modCommunities: ['comm-2'] }),
    ).toBe(false);
  });
});

describe('canDeleteBBSReply', () => {
  it('自著は常に削除可 (community なしの全体スレでも)', () => {
    expect(
      canDeleteBBSReply(
        { author_id: 'user-A', thread_community_id: null },
        { id: 'user-A', modCommunities: [] },
      ),
    ).toBe(true);
  });

  it('community 紐付きスレで mod なら他人返信も削除可', () => {
    expect(
      canDeleteBBSReply(
        { author_id: 'user-A', thread_community_id: 'comm-1' },
        { id: 'user-B', modCommunities: ['comm-1'] },
      ),
    ).toBe(true);
  });

  it('全体スレ (community_id=null) では mod 経路なし', () => {
    expect(
      canDeleteBBSReply(
        { author_id: 'user-A', thread_community_id: null },
        { id: 'user-B', modCommunities: ['comm-1', 'comm-2'] },
      ),
    ).toBe(false);
  });

  it('別 community の mod では削除不可', () => {
    expect(
      canDeleteBBSReply(
        { author_id: 'user-A', thread_community_id: 'comm-1' },
        { id: 'user-B', modCommunities: ['comm-99'] },
      ),
    ).toBe(false);
  });
});

describe('canKickMember (owner > admin > member)', () => {
  it('owner は admin / member を kick 可', () => {
    expect(canKickMember('owner', 'admin')).toBe(true);
    expect(canKickMember('owner', 'member')).toBe(true);
  });

  it('admin は member だけ kick 可。admin / owner は kick 不可', () => {
    expect(canKickMember('admin', 'member')).toBe(true);
    expect(canKickMember('admin', 'admin')).toBe(false);
    expect(canKickMember('admin', 'owner')).toBe(false);
  });

  it('owner ↔ owner / admin ↔ admin の同階層は kick 不可 (自他問わず)', () => {
    expect(canKickMember('owner', 'owner')).toBe(false);
    expect(canKickMember('admin', 'admin')).toBe(false);
  });

  it('member / null / undefined は誰も kick 不可', () => {
    expect(canKickMember('member', 'member')).toBe(false);
    expect(canKickMember(null, 'member')).toBe(false);
    expect(canKickMember(undefined, 'member')).toBe(false);
  });

  it('想定外 role の target は member 扱いで kick 可になる (admin 以上の actor)', () => {
    // 想定外 role は rank=0 = member 扱い → admin から見て kick 可
    expect(canKickMember('admin', 'unknown_role')).toBe(true);
    expect(canKickMember('owner', 'unknown_role')).toBe(true);
  });
});

describe('canBanMember', () => {
  it('現状は canKickMember と同じ規則', () => {
    expect(canBanMember('owner', 'admin')).toBe(true);
    expect(canBanMember('admin', 'member')).toBe(true);
    expect(canBanMember('admin', 'owner')).toBe(false);
    expect(canBanMember('member', 'member')).toBe(false);
  });
});

// ============================================================
// 0069: promote / demote 権限
// ============================================================
describe('canPromoteMember (owner → member→admin)', () => {
  it('owner は member を昇格可', () => {
    expect(canPromoteMember('owner', 'member')).toBe(true);
  });

  it('owner であっても owner / admin は昇格不可', () => {
    expect(canPromoteMember('owner', 'owner')).toBe(false);
    expect(canPromoteMember('owner', 'admin')).toBe(false);
  });

  it('admin / member / null は昇格を発動できない (owner 限定)', () => {
    expect(canPromoteMember('admin', 'member')).toBe(false);
    expect(canPromoteMember('member', 'member')).toBe(false);
    expect(canPromoteMember(null, 'member')).toBe(false);
    expect(canPromoteMember(undefined, 'member')).toBe(false);
  });

  it('想定外 role は member 扱いにはしない (= 文字列一致のみ)', () => {
    expect(canPromoteMember('owner', 'unknown')).toBe(false);
    expect(canPromoteMember('superowner', 'member')).toBe(false);
  });
});

describe('canDemoteMember (owner → admin→member)', () => {
  it('owner は admin を降格可', () => {
    expect(canDemoteMember('owner', 'admin')).toBe(true);
  });

  it('owner であっても owner / member は降格不可', () => {
    expect(canDemoteMember('owner', 'owner')).toBe(false);
    expect(canDemoteMember('owner', 'member')).toBe(false);
  });

  it('admin / member / null は降格を発動できない', () => {
    expect(canDemoteMember('admin', 'admin')).toBe(false);
    expect(canDemoteMember('member', 'admin')).toBe(false);
    expect(canDemoteMember(null, 'admin')).toBe(false);
    expect(canDemoteMember(undefined, 'admin')).toBe(false);
  });

  it('想定外 role は admin 扱いにはしない', () => {
    expect(canDemoteMember('owner', 'unknown')).toBe(false);
    expect(canDemoteMember('owner', null)).toBe(false);
  });
});
