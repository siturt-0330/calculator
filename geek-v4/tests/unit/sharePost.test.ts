// ============================================================
// lib/utils/sharePost.ts のユニットテスト
// ============================================================
// 対象: getEmbedCode / getEmbedPreviewUrl / shareToX / copyPostLink
//
// react-native の Share / Linking / Platform は jest.mock で差し替え。
// @react-native-clipboard/clipboard も in-memory mock に置き換え。
// ============================================================

// react-native モジュールを mock
jest.mock('react-native', () => ({
  Share: {
    share: jest.fn().mockResolvedValue({ action: 'sharedAction' }),
  },
  Linking: {
    openURL: jest.fn().mockResolvedValue(undefined),
    canOpenURL: jest.fn().mockResolvedValue(true),
  },
  Platform: {
    OS: 'ios',
  },
}));

// @react-native-clipboard/clipboard を virtual mock として登録
// (実パッケージが未インストールの環境でも jest が require() を横取りできるようにする)
jest.mock(
  '@react-native-clipboard/clipboard',
  () => ({
    default: {
      setString: jest.fn(),
    },
  }),
  { virtual: true },
);

import { Share, Linking } from 'react-native';
import {
  getEmbedCode,
  getEmbedPreviewUrl,
  shareToX,
  copyPostLink,
  type ShareablePost,
} from '../../lib/utils/sharePost';

const BASE_URL = 'https://geek-app.netlify.app';

// テスト用の投稿オブジェクト
const POST_FULL: ShareablePost = {
  id: 'post-abc123',
  title: 'テスト投稿タイトル',
  content: 'これはテスト投稿の本文です',
  tags: ['tech', 'geek'],
};

const POST_MINIMAL: ShareablePost = {
  id: 'post-xyz',
};

const POST_LONG_CONTENT: ShareablePost = {
  id: 'post-long',
  content: 'あ'.repeat(120), // 100 文字超 → 切り詰め
};

beforeEach(() => {
  jest.clearAllMocks();
});

// ----------------------------------------------------------
// 1. getEmbedPreviewUrl
// ----------------------------------------------------------
describe('getEmbedPreviewUrl', () => {
  it('正しい埋め込みプレビュー URL を返す', () => {
    const url = getEmbedPreviewUrl('post-abc123');
    expect(url).toBe(`${BASE_URL}/embed/post/post-abc123`);
  });

  it('post ID に特殊文字が含まれる場合は encodeURIComponent で処理する', () => {
    const url = getEmbedPreviewUrl('post/with spaces&chars');
    expect(url).toBe(
      `${BASE_URL}/embed/post/${encodeURIComponent('post/with spaces&chars')}`,
    );
  });

  it('空文字 ID でも URL 形式を維持する', () => {
    const url = getEmbedPreviewUrl('');
    expect(url).toBe(`${BASE_URL}/embed/post/`);
  });
});

// ----------------------------------------------------------
// 2. getEmbedCode
// ----------------------------------------------------------
describe('getEmbedCode', () => {
  it('iframe HTML を返す', () => {
    const code = getEmbedCode(POST_FULL);
    expect(code).toMatch(/^<iframe /);
    expect(code).toMatch(/<\/iframe>$/);
  });

  it('src に埋め込みプレビュー URL が含まれる', () => {
    const code = getEmbedCode(POST_FULL);
    const expectedSrc = getEmbedPreviewUrl(POST_FULL.id);
    expect(code).toContain(`src="${expectedSrc}"`);
  });

  it('src に post ID が含まれる', () => {
    const code = getEmbedCode(POST_FULL);
    expect(code).toContain(POST_FULL.id);
  });

  it('width="100%" height="400" が設定されている', () => {
    const code = getEmbedCode(POST_FULL);
    expect(code).toContain('width="100%"');
    expect(code).toContain('height="400"');
  });

  it('frameborder="0" が設定されている', () => {
    const code = getEmbedCode(POST_FULL);
    expect(code).toContain('frameborder="0"');
  });

  it('allowfullscreen が含まれる', () => {
    const code = getEmbedCode(POST_FULL);
    expect(code).toContain('allowfullscreen');
  });

  it('loading="lazy" が含まれる', () => {
    const code = getEmbedCode(POST_FULL);
    expect(code).toContain('loading="lazy"');
  });

  it('POST_MINIMAL (title/content/tags なし) でも正しく生成される', () => {
    const code = getEmbedCode(POST_MINIMAL);
    expect(code).toContain(POST_MINIMAL.id);
    expect(code).toMatch(/^<iframe /);
  });

  it('post ID が異なれば src も異なる', () => {
    const code1 = getEmbedCode({ id: 'aaa' });
    const code2 = getEmbedCode({ id: 'bbb' });
    expect(code1).not.toBe(code2);
    expect(code1).toContain('aaa');
    expect(code2).toContain('bbb');
  });
});

// ----------------------------------------------------------
// 3. shareToX
// ----------------------------------------------------------
describe('shareToX', () => {
  it('Linking.canOpenURL が true のとき Linking.openURL を呼ぶ', async () => {
    (Linking.canOpenURL as jest.Mock).mockResolvedValue(true);
    await shareToX(POST_FULL);
    expect(Linking.openURL).toHaveBeenCalledTimes(1);
  });

  it('生成した URL が twitter.com/intent/tweet で始まる', async () => {
    (Linking.canOpenURL as jest.Mock).mockResolvedValue(true);
    await shareToX(POST_FULL);
    const calledUrl = (Linking.openURL as jest.Mock).mock.calls[0][0] as string;
    expect(calledUrl).toMatch(/^https:\/\/twitter\.com\/intent\/tweet\?/);
  });

  it('tweet intent URL に post URL が含まれる', async () => {
    (Linking.canOpenURL as jest.Mock).mockResolvedValue(true);
    await shareToX(POST_FULL);
    const calledUrl = (Linking.openURL as jest.Mock).mock.calls[0][0] as string;
    const postUrl = `${BASE_URL}/post/${encodeURIComponent(POST_FULL.id)}`;
    // URL は URLSearchParams でエンコードされるので二重エンコードを考慮
    expect(calledUrl).toContain(encodeURIComponent(postUrl));
  });

  it('tweet intent URL に "text" パラメータが含まれる', async () => {
    (Linking.canOpenURL as jest.Mock).mockResolvedValue(true);
    await shareToX(POST_FULL);
    const calledUrl = (Linking.openURL as jest.Mock).mock.calls[0][0] as string;
    expect(calledUrl).toContain('text=');
  });

  it('Linking.canOpenURL が false のとき Error を throw する', async () => {
    (Linking.canOpenURL as jest.Mock).mockResolvedValue(false);
    await expect(shareToX(POST_FULL)).rejects.toThrow(
      'X (Twitter) を開けませんでした。ブラウザを確認してください。',
    );
    expect(Linking.openURL).not.toHaveBeenCalled();
  });

  it('canOpenURL には twitter.com/intent/tweet URL を渡す', async () => {
    (Linking.canOpenURL as jest.Mock).mockResolvedValue(true);
    await shareToX(POST_MINIMAL);
    const checkedUrl = (Linking.canOpenURL as jest.Mock).mock.calls[0][0] as string;
    expect(checkedUrl).toMatch(/^https:\/\/twitter\.com\/intent\/tweet\?/);
  });

  it('POST_MINIMAL でも正常に動作する', async () => {
    (Linking.canOpenURL as jest.Mock).mockResolvedValue(true);
    await expect(shareToX(POST_MINIMAL)).resolves.toBeUndefined();
    expect(Linking.openURL).toHaveBeenCalledTimes(1);
  });

  it('タグが含まれる投稿では tweet テキストに #タグ が含まれる', async () => {
    (Linking.canOpenURL as jest.Mock).mockResolvedValue(true);
    await shareToX(POST_FULL);
    const calledUrl = (Linking.openURL as jest.Mock).mock.calls[0][0] as string;
    // URLSearchParams でエンコードされた # (%23) が含まれる
    expect(calledUrl).toContain('%23tech');
    expect(calledUrl).toContain('%23geek');
  });

  it('100 文字超の content は切り詰められて tweet テキストに使われる', async () => {
    (Linking.canOpenURL as jest.Mock).mockResolvedValue(true);
    await shareToX(POST_LONG_CONTENT);
    const calledUrl = (Linking.openURL as jest.Mock).mock.calls[0][0] as string;
    // 元テキスト(120文字)がそのままエンコードされた場合よりも短くなっている
    // (切り詰め後は 100 文字 + '…')
    const rawLong = encodeURIComponent('あ'.repeat(120));
    expect(calledUrl).not.toContain(rawLong);
  });
});

// ----------------------------------------------------------
// 4. copyPostLink
// ----------------------------------------------------------
describe('copyPostLink', () => {
  let clipboardModule: { setString: jest.Mock };

  beforeEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    clipboardModule = require('@react-native-clipboard/clipboard').default;
    // mockReset: カウントと実装の両方をリセット (clearAllMocks はカウントのみ)
    (clipboardModule.setString as jest.Mock).mockReset();
  });

  it('コピー成功時は true を返す', () => {
    const result = copyPostLink(POST_FULL);
    expect(result).toBe(true);
  });

  it('Clipboard.setString に正しい URL を渡す', () => {
    copyPostLink(POST_FULL);
    const expectedUrl = `${BASE_URL}/post/${encodeURIComponent(POST_FULL.id)}`;
    expect(clipboardModule.setString).toHaveBeenCalledWith(expectedUrl);
  });

  it('Clipboard.setString は 1 回だけ呼ばれる', () => {
    copyPostLink(POST_FULL);
    expect(clipboardModule.setString).toHaveBeenCalledTimes(1);
  });

  it('URL 形式が BASE_URL/post/<id> である', () => {
    copyPostLink({ id: 'my-post-id-999' });
    expect(clipboardModule.setString).toHaveBeenCalledWith(
      `${BASE_URL}/post/my-post-id-999`,
    );
  });

  it('post ID に特殊文字が含まれる場合は encodeURIComponent で処理する', () => {
    copyPostLink({ id: 'post with spaces' });
    const calledUrl = clipboardModule.setString.mock.calls[0][0] as string;
    expect(calledUrl).toBe(`${BASE_URL}/post/post%20with%20spaces`);
  });

  it('Clipboard.setString が例外を throw したとき false を返す', () => {
    clipboardModule.setString.mockImplementation(() => {
      throw new Error('clipboard error');
    });
    const result = copyPostLink(POST_FULL);
    expect(result).toBe(false);
  });

  it('POST_MINIMAL でも成功する', () => {
    const result = copyPostLink(POST_MINIMAL);
    expect(result).toBe(true);
    expect(clipboardModule.setString).toHaveBeenCalledWith(
      `${BASE_URL}/post/${POST_MINIMAL.id}`,
    );
  });
});

// ----------------------------------------------------------
// 5. Share.share は呼ばれない (純関数テスト範囲外の確認)
// ----------------------------------------------------------
describe('getEmbedCode / getEmbedPreviewUrl / copyPostLink は Share.share を呼ばない', () => {
  it('getEmbedCode は Share.share を呼ばない', () => {
    getEmbedCode(POST_FULL);
    expect(Share.share).not.toHaveBeenCalled();
  });

  it('getEmbedPreviewUrl は Share.share を呼ばない', () => {
    getEmbedPreviewUrl(POST_FULL.id);
    expect(Share.share).not.toHaveBeenCalled();
  });

  it('copyPostLink は Share.share を呼ばない', () => {
    copyPostLink(POST_FULL);
    expect(Share.share).not.toHaveBeenCalled();
  });
});
