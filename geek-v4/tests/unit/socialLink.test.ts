// socialLink.ts のユニットテスト (youtube.test.ts と同方針)
import {
  parseInstagram,
  parseFacebook,
  parseSocialLink,
} from '../../lib/utils/socialLink';

describe('parseInstagram', () => {
  it('投稿 /p/<code>/ を判定', () => {
    const r = parseInstagram('https://www.instagram.com/p/CabC_12-3/');
    expect(r).not.toBeNull();
    expect(r?.platform).toBe('instagram');
    expect(r?.kind).toBe('post');
    expect(r?.canonicalUrl).toBe('https://www.instagram.com/p/CabC_12-3/');
    expect(r?.isVideo).toBe(false);
  });

  it('リール /reel/ は isVideo=true', () => {
    const r = parseInstagram('https://instagram.com/reel/XyZ123/');
    expect(r?.kind).toBe('reel');
    expect(r?.isVideo).toBe(true);
    expect(r?.canonicalUrl).toBe('https://www.instagram.com/reel/XyZ123/');
  });

  it('/reels/ も reel に正規化', () => {
    const r = parseInstagram('https://www.instagram.com/reels/ABCdef/');
    expect(r?.kind).toBe('reel');
    expect(r?.canonicalUrl).toBe('https://www.instagram.com/reel/ABCdef/');
  });

  it('IGTV /tv/ は isVideo=true', () => {
    const r = parseInstagram('https://www.instagram.com/tv/ABCdef/');
    expect(r?.kind).toBe('tv');
    expect(r?.isVideo).toBe(true);
  });

  it('tracking param (igshid 等) を落として canonical 化', () => {
    const r = parseInstagram(
      'https://www.instagram.com/p/ABCdef/?igshid=xxx&utm_source=ig_web',
    );
    expect(r?.canonicalUrl).toBe('https://www.instagram.com/p/ABCdef/');
  });

  it('m. サブドメインも許容', () => {
    const r = parseInstagram('https://m.instagram.com/p/ABCdef/');
    expect(r?.platform).toBe('instagram');
  });

  it('スキーム無しの裸 URL も解釈', () => {
    const r = parseInstagram('instagram.com/p/ABCdef/');
    expect(r?.kind).toBe('post');
  });

  it('プロフィール /<username>/', () => {
    const r = parseInstagram('https://www.instagram.com/natgeo/');
    expect(r?.kind).toBe('profile');
    expect(r?.canonicalUrl).toBe('https://www.instagram.com/natgeo/');
  });

  it('予約パス /explore/ はプロフィール扱いしない (link)', () => {
    const r = parseInstagram('https://www.instagram.com/explore/');
    expect(r?.kind).toBe('link');
  });

  it('ストーリー /stories/<user>/<id>', () => {
    const r = parseInstagram('https://www.instagram.com/stories/natgeo/123456/');
    expect(r?.kind).toBe('story');
    expect(r?.canonicalUrl).toBe('https://www.instagram.com/stories/natgeo/123456/');
  });

  it('IG でない/壊れた入力は null', () => {
    expect(parseInstagram('https://notinstagram.com/p/x/')).toBeNull();
    expect(parseInstagram('https://instagram.com.evil.com/p/x/')).toBeNull();
    expect(parseInstagram('https://www.facebook.com/x')).toBeNull();
    expect(parseInstagram('https://youtu.be/abcdefghijk')).toBeNull();
    expect(parseInstagram('')).toBeNull();
    expect(parseInstagram('   ')).toBeNull();
    expect(parseInstagram('not a url')).toBeNull();
    // @ts-expect-error 非文字列も安全に null
    expect(parseInstagram(null)).toBeNull();
  });

  it('canonicalUrl は再パースで同じ結果に戻る (round-trip)', () => {
    const r = parseInstagram('https://www.instagram.com/p/ZzZ_9/?igshid=1');
    const again = parseInstagram(r?.canonicalUrl ?? '');
    expect(again?.kind).toBe('post');
    expect(again?.canonicalUrl).toBe(r?.canonicalUrl);
  });
});

describe('parseFacebook', () => {
  it('動画 /watch/?v= は isVideo=true', () => {
    const r = parseFacebook('https://www.facebook.com/watch/?v=1234567890');
    expect(r?.platform).toBe('facebook');
    expect(r?.kind).toBe('video');
    expect(r?.isVideo).toBe(true);
    expect(r?.canonicalUrl).toBe('https://www.facebook.com/watch/?v=1234567890');
  });

  it('/watch?v= (スラッシュ無し) も同じ', () => {
    const r = parseFacebook('https://www.facebook.com/watch?v=1234567890');
    expect(r?.canonicalUrl).toBe('https://www.facebook.com/watch/?v=1234567890');
  });

  it('リール /reel/<id>', () => {
    const r = parseFacebook('https://www.facebook.com/reel/999888/');
    expect(r?.kind).toBe('reel');
    expect(r?.isVideo).toBe(true);
    expect(r?.canonicalUrl).toBe('https://www.facebook.com/reel/999888/');
  });

  it('投稿 /<page>/posts/<id>', () => {
    const r = parseFacebook('https://www.facebook.com/cocacola/posts/12345');
    expect(r?.kind).toBe('post');
    expect(r?.canonicalUrl).toBe('https://www.facebook.com/cocacola/posts/12345');
  });

  it('写真 /photo.php?fbid=', () => {
    const r = parseFacebook('https://www.facebook.com/photo.php?fbid=7777');
    expect(r?.kind).toBe('photo');
    expect(r?.canonicalUrl).toBe('https://www.facebook.com/photo/?fbid=7777');
  });

  it('ストーリー /story.php?story_fbid=&id=', () => {
    const r = parseFacebook('https://www.facebook.com/story.php?story_fbid=111&id=222');
    expect(r?.kind).toBe('post');
    expect(r?.canonicalUrl).toContain('story_fbid=111');
    expect(r?.canonicalUrl).toContain('id=222');
  });

  it('共有 /share/v/<token>/ は動画扱い', () => {
    const r = parseFacebook('https://www.facebook.com/share/v/abcDEF/');
    expect(r?.kind).toBe('share');
    expect(r?.isVideo).toBe(true);
  });

  it('m. サブドメインを www. に正規化', () => {
    const r = parseFacebook('https://m.facebook.com/cocacola/posts/12345');
    expect(r?.canonicalUrl).toBe('https://www.facebook.com/cocacola/posts/12345');
  });

  it('短縮 fb.watch/<code> は link + isVideo', () => {
    const r = parseFacebook('https://fb.watch/abc123/');
    expect(r?.platform).toBe('facebook');
    expect(r?.kind).toBe('link');
    expect(r?.isVideo).toBe(true);
  });

  it('短縮 fb.me/<code>', () => {
    const r = parseFacebook('https://fb.me/abc123');
    expect(r?.platform).toBe('facebook');
  });

  it('FB でない/壊れた入力は null', () => {
    expect(parseFacebook('https://notfacebook.com/x')).toBeNull();
    expect(parseFacebook('https://facebook.com.evil.com/x')).toBeNull();
    expect(parseFacebook('https://www.instagram.com/p/x/')).toBeNull();
    expect(parseFacebook('')).toBeNull();
    expect(parseFacebook('   ')).toBeNull();
    // @ts-expect-error 非文字列も安全に null
    expect(parseFacebook(undefined)).toBeNull();
  });
});

describe('parseSocialLink (dispatcher)', () => {
  it('IG URL → instagram', () => {
    expect(parseSocialLink('https://www.instagram.com/p/ABC/')?.platform).toBe('instagram');
  });
  it('FB URL → facebook', () => {
    expect(parseSocialLink('https://www.facebook.com/reel/1/')?.platform).toBe('facebook');
  });
  it('YouTube / その他は null', () => {
    expect(parseSocialLink('https://youtu.be/abcdefghijk')).toBeNull();
    expect(parseSocialLink('https://example.com/article')).toBeNull();
  });
});
