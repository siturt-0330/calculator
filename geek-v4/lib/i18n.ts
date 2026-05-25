import { useLanguageStore, type Lang } from '../stores/languageStore';

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

  // ============================================================
  // D スコープ追加 (2026-05): フィード / 投稿カード / トースト / エラー
  // ============================================================
  // UI 高頻度ラベル (フィード周り)
  'すべて':               { en: 'All',                zh: '全部',         ko: '전체',       es: 'Todo',           fr: 'Tout' },
  'タグを追加':           { en: 'Add tag',            zh: '添加标签',     ko: '태그 추가',  es: 'Añadir tag',     fr: 'Ajouter un tag' },
  '事実':                 { en: 'Fact',               zh: '事实',         ko: '사실',       es: 'Hecho',          fr: 'Fait' },
  '意見':                 { en: 'Opinion',            zh: '意见',         ko: '의견',       es: 'Opinión',        fr: 'Avis' },
  'ジョーク':             { en: 'Joke',               zh: '玩笑',         ko: '농담',       es: 'Broma',          fr: 'Blague' },
  '制作中':               { en: 'WIP',                zh: '制作中',       ko: '제작 중',    es: 'WIP',            fr: 'En cours' },
  '完了':                 { en: 'Done',               zh: '完成',         ko: '완료',       es: 'Hecho',          fr: 'Terminé' },
  '送信':                 { en: 'Send',               zh: '发送',         ko: '전송',       es: 'Enviar',         fr: 'Envoyer' },
  '閉じる':               { en: 'Close',              zh: '关闭',         ko: '닫기',       es: 'Cerrar',         fr: 'Fermer' },
  'キャンセル':           { en: 'Cancel',             zh: '取消',         ko: '취소',       es: 'Cancelar',       fr: 'Annuler' },
  '保存する':             { en: 'Save',               zh: '保存',         ko: '저장',       es: 'Guardar',        fr: 'Enregistrer' },
  '読み込み中...':        { en: 'Loading...',         zh: '加载中...',    ko: '로딩 중...', es: 'Cargando...',    fr: 'Chargement...' },
  'もっと見る':           { en: 'See more',           zh: '查看更多',     ko: '더 보기',    es: 'Ver más',        fr: 'Voir plus' },
  'もっと読み込む':       { en: 'Load more',          zh: '加载更多',     ko: '더 불러오기', es: 'Cargar más',    fr: 'Charger plus' },
  '戻る':                 { en: 'Back',               zh: '返回',         ko: '뒤로',       es: 'Atrás',          fr: 'Retour' },
  '確認':                 { en: 'OK',                 zh: '确认',         ko: '확인',       es: 'OK',             fr: 'OK' },
  'テキストスタンプ':     { en: 'Text stamp',         zh: '文字贴纸',     ko: '텍스트 스탬프', es: 'Sticker de texto', fr: 'Sticker texte' },
  'スタンプを検索...':    { en: 'Search stamps...',   zh: '搜索贴纸...',  ko: '스탬프 검색...', es: 'Buscar...',    fr: 'Rechercher...' },
  '新しいスタンプを作る': { en: 'Create new stamp',   zh: '创建新贴纸',   ko: '새 스탬프 만들기', es: 'Crear sticker', fr: 'Créer un sticker' },

  // ============================================================
  // Toast / Error 文 (translateStatic 経由で stores/toastStore.ts から呼ばれる)
  // ============================================================
  'ログインしてください':           { en: 'Please log in',                 zh: '请登录',          ko: '로그인해 주세요',    es: 'Por favor inicia sesión',  fr: 'Veuillez vous connecter' },
  'ログインに失敗しました':         { en: 'Login failed',                  zh: '登录失败',        ko: '로그인 실패',        es: 'Error al iniciar sesión',  fr: 'Échec de la connexion' },
  '通信エラーが発生しました':       { en: 'Network error',                 zh: '网络错误',        ko: '네트워크 오류',      es: 'Error de red',             fr: 'Erreur réseau' },
  'オフラインです':                 { en: 'You are offline',               zh: '您处于离线状态',  ko: '오프라인입니다',     es: 'Sin conexión',             fr: 'Vous êtes hors-ligne' },
  '接続が回復しました':             { en: 'Connection restored',           zh: '连接已恢复',      ko: '연결이 복구됨',      es: 'Conexión restaurada',      fr: 'Connexion rétablie' },
  '投稿しました':                   { en: 'Posted',                        zh: '已发布',          ko: '게시 완료',          es: 'Publicado',                fr: 'Publié' },
  '投稿に失敗しました':             { en: 'Post failed',                   zh: '发布失败',        ko: '게시 실패',          es: 'Error al publicar',        fr: 'Échec de la publication' },
  'コメントしました':               { en: 'Commented',                     zh: '已评论',          ko: '댓글 작성',          es: 'Comentado',                fr: 'Commenté' },
  '送信に失敗しました':             { en: 'Send failed',                   zh: '发送失败',        ko: '전송 실패',          es: 'Error al enviar',          fr: 'Échec de l’envoi' },
  '保存しました':                   { en: 'Saved',                         zh: '已保存',          ko: '저장됨',             es: 'Guardado',                 fr: 'Enregistré' },
  '保存を解除しました':             { en: 'Unsaved',                       zh: '已取消保存',      ko: '저장 해제',          es: 'Eliminado de guardados',   fr: 'Retiré des enregistrements' },
  '通報しました':                   { en: 'Reported',                      zh: '已举报',          ko: '신고됨',             es: 'Reportado',                fr: 'Signalé' },
  '通報に失敗しました':             { en: 'Report failed',                 zh: '举报失败',        ko: '신고 실패',          es: 'Error al reportar',        fr: 'Échec du signalement' },
  'シェアできませんでした':         { en: 'Failed to share',               zh: '分享失败',        ko: '공유 실패',          es: 'No se pudo compartir',     fr: 'Échec du partage' },
  'リンクをコピーしました':         { en: 'Link copied',                   zh: '已复制链接',      ko: '링크 복사됨',        es: 'Enlace copiado',           fr: 'Lien copié' },
  'リアクションに失敗しました':     { en: 'Reaction failed',               zh: '反应失败',        ko: '리액션 실패',        es: 'Error en la reacción',     fr: 'Échec de la réaction' },
  '何かエラーが発生しました':       { en: 'Something went wrong',          zh: '发生了一些错误',  ko: '오류가 발생했습니다', es: 'Algo salió mal',           fr: 'Une erreur est survenue' },
  'もう一度お試しください':         { en: 'Please try again',              zh: '请再试一次',      ko: '다시 시도해 주세요', es: 'Inténtalo de nuevo',       fr: 'Veuillez réessayer' },
  '権限がありません':               { en: 'Permission denied',             zh: '没有权限',        ko: '권한이 없습니다',    es: 'Permiso denegado',         fr: 'Accès refusé' },
  '画像の読み込みに失敗しました':   { en: 'Failed to load image',          zh: '图片加载失败',    ko: '이미지 로드 실패',   es: 'Error al cargar la imagen', fr: 'Échec du chargement de l’image' },
  'メールアドレスが正しくありません': { en: 'Invalid email address',       zh: '电子邮箱无效',    ko: '이메일이 올바르지 않습니다', es: 'Correo no válido',    fr: 'Adresse e-mail invalide' },
  'パスワードが正しくありません':   { en: 'Invalid password',              zh: '密码错误',        ko: '비밀번호가 올바르지 않습니다', es: 'Contraseña incorrecta', fr: 'Mot de passe incorrect' },
  '入力内容を確認してください':     { en: 'Please check your input',       zh: '请检查输入内容',  ko: '입력 내용을 확인해 주세요', es: 'Verifica tu entrada',  fr: 'Veuillez vérifier vos entrées' },
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

// ============================================================
// translateStatic — hook が使えない場所から呼ぶための imperative 版
// ------------------------------------------------------------
// useT() は React component / hook 内でしか使えない。
// store action / catch handler / lib 内部 などから呼びたい時はこっち。
// 内部で languageStore の最新 state を読むので、user が言語を切り替えれば
// 次回呼び出しから新言語が適用される。
//
// 用例 (stores/toastStore.ts):
//   show: (message, variant) => {
//     const localized = translateStatic(message);
//     set((s) => ({ toasts: [...s.toasts, { ..., message: localized }] }));
//   }
//
// 辞書に無い文字列はそのまま返るので、既存 caller の挙動は変わらない
// (= 安全な fallback)。
// ============================================================
export function translateStatic(jaText: string): string {
  const lang = useLanguageStore.getState().lang;
  return translate(jaText, lang);
}

// =============================================
// 動的コンテンツ (投稿/コメント) の翻訳
// =============================================
// MyMemory API (無料・APIキー不要・上限あり) を利用
// https://mymemory.translated.net/doc/spec.php

const cache = new Map<string, string>();

// ============================================================
// 固有名詞 (ブランド) の保護
// ------------------------------------------------------------
// MyMemory に "Geek" を渡すと "オタク" / "긱" / "极客" 等の一般名詞に
// 翻訳されてしまう。Geek はアプリのブランド名なので必ず "Geek" のまま残したい。
//
// 戦略: 翻訳 API に渡す前に Geek → 翻訳されにくい placeholder に置換し、
// 戻り値で復元する。placeholder は:
//   - underscore で囲んだ uppercase token (MyMemory はトークン化 + 個別翻訳しないことが多い)
//   - 日本語/英語/中韓辞書に存在しない文字列
//   - 必ず ASCII でエンコード安全
//
// マッチは `\bGeek\b` (大文字始まりの正確な単語) のみ:
//   - "geek" 小文字 → 一般名詞として翻訳して OK
//   - "GEEK" 全大文字 → 別物として一旦保留 (将来必要なら追加)
//   - 全角 "Ｇｅｅｋ" → 一旦保留 (テキスト入力で正規化されている前提)
// JS の \b は Japanese char (\W) と Latin char (\w) の境目でもマッチするので
// 「これはGeekだ」「Geekアプリ」のような日本語混在文も正しく拾える。
// ============================================================
const BRAND_PLACEHOLDER = '__GEEKBRAND__';

export function protectBrandNames(text: string): string {
  return text.replace(/\bGeek\b/g, BRAND_PLACEHOLDER);
}

export function restoreBrandNames(text: string): string {
  // case-insensitive で復元 — API が token を lowercase 化する事故にも耐性
  return text.replace(/__GEEKBRAND__/gi, 'Geek');
}

export async function translateDynamic(text: string, targetLang: Lang): Promise<string> {
  if (!text || targetLang === 'ja') return text;
  const cacheKey = `${targetLang}:${text}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const protectedSrc = protectBrandNames(text);

  try {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(protectedSrc)}&langpair=ja|${targetLang}`;
    const res = await fetch(url);
    if (!res.ok) return text;
    const data = await res.json() as { responseData?: { translatedText?: string } };
    const translated = data?.responseData?.translatedText ?? protectedSrc;
    const final = restoreBrandNames(translated);
    cache.set(cacheKey, final);
    return final;
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
  th: '🇹🇭 ภาษาไทย',
  vi: '🇻🇳 Tiếng Việt',
  id: '🇮🇩 Bahasa Indonesia',
  es: '🇪🇸 Español',
  fr: '🇫🇷 Français',
};
