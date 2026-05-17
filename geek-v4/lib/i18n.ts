import { useLanguageStore, type Lang } from '@/stores/languageStore';

// 主要 UI 文字列の翻訳辞書 (ja を基準として ja以外を定義すれば自動切替)
type Dict = Record<string, Partial<Record<Lang, string>>>;

const DICT: Dict = {
  // 共通
  'ログイン':            { en: 'Log in',         zh: '登录',     ko: '로그인',     es: 'Iniciar sesión', fr: 'Se connecter' },
  'アカウントを作成':    { en: 'Create account', zh: '注册',     ko: '회원가입',   es: 'Crear cuenta',   fr: 'Créer un compte' },
  'メールアドレス':      { en: 'Email',          zh: '邮箱',     ko: '이메일',     es: 'Correo',         fr: 'E-mail' },
  'パスワード':          { en: 'Password',       zh: '密码',     ko: '비밀번호',   es: 'Contraseña',     fr: 'Mot de passe' },
  '好きを、匿名で、安心して続ける。':
    { en: 'Anonymously enjoy what you love, safely.', zh: '匿名享受热爱，安全持续。', ko: '익명으로 좋아하는 것을 안전하게.', es: 'Disfruta lo que amas, anónimo y seguro.', fr: 'Profitez anonymement de ce que vous aimez.' },

  // フィード
  'All':                  { ja: 'All', en: 'All',          zh: '全部',     ko: '전체',      es: 'Todo',     fr: 'Tout' },
  '選択した # のみ':      { en: 'Liked # only',   zh: '仅喜欢的标签', ko: '좋아하는 # 만', es: 'Solo # favoritas', fr: 'Tags aimés uniquement' },
  '好きなタグ':           { en: 'Liked tags',     zh: '喜欢的标签', ko: '좋아하는 태그', es: 'Tags favoritos', fr: 'Tags aimés' },
  'ブロックするタグ':     { en: 'Blocked tags',   zh: '屏蔽的标签', ko: '차단 태그',   es: 'Tags bloqueados', fr: 'Tags bloqués' },
  'これもどうですか？':   { en: 'Try these too?', zh: '这些怎么样？', ko: '이것은 어때요?', es: '¿Estos también?', fr: 'Et ceux-ci ?' },

  // タブ
  'ホーム':               { en: 'Home',           zh: '主页',     ko: '홈',         es: 'Inicio',     fr: 'Accueil' },
  '掲示板':               { en: 'BBS',            zh: '论坛',     ko: '게시판',     es: 'Foro',       fr: 'Forum' },
  '推し活':               { en: 'Oshi',           zh: '推活',     ko: '응원',       es: 'Oshi',       fr: 'Oshi' },
  'ゲーム':               { en: 'Game',           zh: '游戏',     ko: '게임',       es: 'Juego',      fr: 'Jeu' },
  'マイページ':           { en: 'My page',        zh: '我的',     ko: '내 페이지',  es: 'Mi página',  fr: 'Mon espace' },

  // 投稿アクション
  '投稿する':             { en: 'Post',           zh: '发布',     ko: '게시',       es: 'Publicar',   fr: 'Publier' },
  'コメント':             { en: 'Comment',        zh: '评论',     ko: '댓글',       es: 'Comentar',   fr: 'Commenter' },
  'いいね':               { en: 'Like',           zh: '点赞',     ko: '좋아요',     es: 'Me gusta',   fr: "J'aime" },
  '気になる':             { en: 'Concern',        zh: '在意',     ko: '우려',       es: 'Inquietud',  fr: 'Préoccupant' },
  '保存':                 { en: 'Save',           zh: '保存',     ko: '저장',       es: 'Guardar',    fr: 'Enregistrer' },
  'シェア':               { en: 'Share',          zh: '分享',     ko: '공유',       es: 'Compartir',  fr: 'Partager' },

  // ゲーム
  '大富豪':               { en: 'Daifugo',        zh: '大富豪',   ko: '대부호',     es: 'Daifugo',    fr: 'Daifugo' },
  '将棋':                 { en: 'Shogi',          zh: '将棋',     ko: '쇼기',       es: 'Shogi',      fr: 'Shogi' },
  '麻雀':                 { en: 'Mahjong',        zh: '麻雀',     ko: '마작',       es: 'Mahjong',    fr: 'Mahjong' },
  'テキサスポーカー':     { en: 'Texas Poker',    zh: '德州扑克', ko: '텍사스 포커', es: 'Póquer Texas', fr: 'Poker Texas' },

  // 翻訳ボタン
  '翻訳':                 { en: 'Translate',      zh: '翻译',     ko: '번역',       es: 'Traducir',   fr: 'Traduire' },
  '原文':                 { en: 'Original',       zh: '原文',     ko: '원문',       es: 'Original',   fr: 'Original' },
  '翻訳中...':            { en: 'Translating...', zh: '翻译中...', ko: '번역 중...', es: 'Traduciendo...', fr: 'Traduction...' },
};

// React Hook で使用: const t = useT(); t('好きなタグ')
export function useT() {
  const lang = useLanguageStore((s) => s.lang);
  return (jaText: string): string => {
    if (lang === 'ja') return jaText;
    const entry = DICT[jaText];
    if (!entry) return jaText;
    return entry[lang] ?? jaText;
  };
}

// 静的に翻訳
export function translate(jaText: string, lang: Lang): string {
  if (lang === 'ja') return jaText;
  const entry = DICT[jaText];
  if (!entry) return jaText;
  return entry[lang] ?? jaText;
}

// =============================================
// 動的コンテンツ (投稿/コメント) の翻訳
// =============================================
// MyMemory API (無料・APIキー不要・上限あり) を利用
// https://mymemory.translated.net/doc/spec.php

const cache = new Map<string, string>();

export async function translateDynamic(text: string, targetLang: Lang): Promise<string> {
  if (!text || targetLang === 'ja') return text;
  const cacheKey = `${targetLang}:${text}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=ja|${targetLang}`;
    const res = await fetch(url);
    if (!res.ok) return text;
    const data = await res.json() as { responseData?: { translatedText?: string } };
    const translated = data?.responseData?.translatedText ?? text;
    cache.set(cacheKey, translated);
    return translated;
  } catch {
    return text;
  }
}

// 言語ラベル
export const LANG_LABEL: Record<Lang, string> = {
  ja: '🇯🇵 日本語',
  en: '🇺🇸 English',
  zh: '🇨🇳 中文',
  ko: '🇰🇷 한국어',
  es: '🇪🇸 Español',
  fr: '🇫🇷 Français',
};
