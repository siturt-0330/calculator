import {
  parseYouTube,
  youTubeThumbnailUrl,
  youTubeWatchUrl,
  youTubeOEmbedUrl,
} from '../../lib/utils/youtube';

// 11 桁の代表的な video id (Rick Astley)
const ID = 'dQw4w9WgXcQ';

describe('parseYouTube', () => {
  it('youtube.com/watch?v=<id> を抽出', () => {
    expect(parseYouTube(`https://www.youtube.com/watch?v=${ID}`)).toEqual({ videoId: ID });
  });

  it('www 無し watch?v= を抽出', () => {
    expect(parseYouTube(`https://youtube.com/watch?v=${ID}`)).toEqual({ videoId: ID });
  });

  it('youtu.be/<id> (短縮) を抽出', () => {
    expect(parseYouTube(`https://youtu.be/${ID}`)).toEqual({ videoId: ID });
  });

  it('youtube.com/shorts/<id> を抽出', () => {
    expect(parseYouTube(`https://www.youtube.com/shorts/${ID}`)).toEqual({ videoId: ID });
  });

  it('youtube.com/embed/<id> を抽出', () => {
    expect(parseYouTube(`https://www.youtube.com/embed/${ID}`)).toEqual({ videoId: ID });
  });

  it('youtube.com/v/<id> (旧式埋め込み) を抽出', () => {
    expect(parseYouTube(`https://www.youtube.com/v/${ID}`)).toEqual({ videoId: ID });
  });

  it('youtube.com/live/<id> を抽出', () => {
    expect(parseYouTube(`https://www.youtube.com/live/${ID}`)).toEqual({ videoId: ID });
  });

  it('m.youtube.com を抽出', () => {
    expect(parseYouTube(`https://m.youtube.com/watch?v=${ID}`)).toEqual({ videoId: ID });
  });

  it('music.youtube.com を抽出', () => {
    expect(parseYouTube(`https://music.youtube.com/watch?v=${ID}`)).toEqual({ videoId: ID });
  });

  it('クエリ付き watch (?v= の後ろに &t=) を抽出', () => {
    expect(parseYouTube(`https://www.youtube.com/watch?v=${ID}&t=42s`)).toEqual({ videoId: ID });
  });

  it('クエリ付き watch (?v= の前に別パラメータ) を抽出', () => {
    expect(parseYouTube(`https://www.youtube.com/watch?feature=share&v=${ID}`)).toEqual({
      videoId: ID,
    });
  });

  it('youtu.be に ?si=...&t=... が付いても抽出', () => {
    expect(parseYouTube(`https://youtu.be/${ID}?si=AbCdEf12&t=30`)).toEqual({ videoId: ID });
  });

  it('shorts に ?feature= が付いても抽出', () => {
    expect(parseYouTube(`https://www.youtube.com/shorts/${ID}?feature=share`)).toEqual({
      videoId: ID,
    });
  });

  it('embed に ?autoplay=1 が付いても抽出', () => {
    expect(parseYouTube(`https://www.youtube.com/embed/${ID}?autoplay=1&rel=0`)).toEqual({
      videoId: ID,
    });
  });

  it('フラグメント (#t=10s) 付きでも抽出', () => {
    expect(parseYouTube(`https://www.youtube.com/watch?v=${ID}#t=10s`)).toEqual({ videoId: ID });
  });

  it('http (非 https) でも抽出', () => {
    expect(parseYouTube(`http://www.youtube.com/watch?v=${ID}`)).toEqual({ videoId: ID });
  });

  it('スキーム無し (youtu.be/<id>) でも抽出', () => {
    expect(parseYouTube(`youtu.be/${ID}`)).toEqual({ videoId: ID });
  });

  it('スキーム無し (www.youtube.com/watch?v=) でも抽出', () => {
    expect(parseYouTube(`www.youtube.com/watch?v=${ID}`)).toEqual({ videoId: ID });
  });

  it('前後の空白を trim して抽出', () => {
    expect(parseYouTube(`   https://youtu.be/${ID}   `)).toEqual({ videoId: ID });
  });

  it('id にハイフン / アンダースコアを含むものを抽出', () => {
    const weird = 'a_b-C1d2E3f';
    expect(parseYouTube(`https://youtu.be/${weird}`)).toEqual({ videoId: weird });
  });

  // --- 非 YouTube / 不正系 ---

  it('非 YouTube ドメインは null', () => {
    expect(parseYouTube('https://vimeo.com/123456789')).toBeNull();
  });

  it('YouTube を装った別ドメインは null (notyoutube.com)', () => {
    expect(parseYouTube(`https://notyoutube.com/watch?v=${ID}`)).toBeNull();
  });

  it('サフィックス偽装 (youtube.com.evil.com) は null', () => {
    expect(parseYouTube(`https://youtube.com.evil.com/watch?v=${ID}`)).toBeNull();
  });

  it('v パラメータが無い watch は null', () => {
    expect(parseYouTube('https://www.youtube.com/watch?feature=share')).toBeNull();
  });

  it('v が 11 桁未満は null', () => {
    expect(parseYouTube('https://www.youtube.com/watch?v=short')).toBeNull();
  });

  it('v が 11 桁超は null', () => {
    expect(parseYouTube(`https://www.youtube.com/watch?v=${ID}EXTRA`)).toBeNull();
  });

  it('shorts の id が 11 桁未満は null', () => {
    expect(parseYouTube('https://www.youtube.com/shorts/abc')).toBeNull();
  });

  it('空文字は null', () => {
    expect(parseYouTube('')).toBeNull();
  });

  it('空白のみは null', () => {
    expect(parseYouTube('   ')).toBeNull();
  });

  it('URL として壊れている文字列は null', () => {
    expect(parseYouTube('ht!tp://%%%')).toBeNull();
  });

  it('YouTube だが id を含まない URL (トップページ) は null', () => {
    expect(parseYouTube('https://www.youtube.com/')).toBeNull();
  });

  it('非文字列 (型外) は null', () => {
    // 実行時に不正な値が渡るケースのガード
    expect(parseYouTube(undefined as unknown as string)).toBeNull();
    expect(parseYouTube(null as unknown as string)).toBeNull();
  });
});

describe('youTubeThumbnailUrl', () => {
  it('hqdefault.jpg の URL を返す', () => {
    expect(youTubeThumbnailUrl(ID)).toBe(`https://i.ytimg.com/vi/${ID}/hqdefault.jpg`);
  });
});

describe('youTubeWatchUrl', () => {
  it('正規の watch URL を返す', () => {
    expect(youTubeWatchUrl(ID)).toBe(`https://www.youtube.com/watch?v=${ID}`);
  });

  it('parseYouTube の結果と round-trip する', () => {
    const parsed = parseYouTube(`https://youtu.be/${ID}`);
    expect(parsed).not.toBeNull();
    if (parsed) {
      expect(parseYouTube(youTubeWatchUrl(parsed.videoId))).toEqual({ videoId: ID });
    }
  });
});

describe('youTubeOEmbedUrl', () => {
  it('url を encode して oembed エンドポイントを組み立てる', () => {
    const src = `https://www.youtube.com/watch?v=${ID}`;
    expect(youTubeOEmbedUrl(src)).toBe(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(src)}&format=json`,
    );
  });

  it('クエリ付き URL の & や = を確実に encode する', () => {
    const src = `https://www.youtube.com/watch?v=${ID}&t=10s`;
    const out = youTubeOEmbedUrl(src);
    // 元 URL の & はエンコードされ、oembed 側の区切り & だけが生で残る
    expect(out).toContain('%26t%3D10s');
    expect(out.endsWith('&format=json')).toBe(true);
  });
});
