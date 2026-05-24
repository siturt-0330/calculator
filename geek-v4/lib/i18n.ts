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

  // 共通の Toast / Error メッセージ — toastStore.show() 内で自動翻訳される
  // (Auth flow / お気に入り / シェア 等の高頻度メッセージのみカバー)
  'メールアドレスの形式が正しくありません。':
    { en: 'Invalid email format.', zh: '邮箱格式不正确。', ko: '이메일 형식이 올바르지 않습니다.', es: 'Formato de correo no válido.', fr: 'Format d\'e-mail invalide.' },
  'オフラインです。インターネット接続を確認してください。':
    { en: 'Offline. Please check your internet connection.', zh: '离线。请检查您的网络连接。', ko: '오프라인입니다. 인터넷 연결을 확인하세요.', es: 'Sin conexión. Verifique su Internet.', fr: 'Hors ligne. Vérifiez votre connexion.' },
  'メールアドレスとパスワードを入力してください。':
    { en: 'Please enter your email and password.', zh: '请输入邮箱和密码。', ko: '이메일과 비밀번호를 입력하세요.', es: 'Ingrese correo y contraseña.', fr: 'Saisissez e-mail et mot de passe.' },
  'パスワードは 72 文字以内にしてください。':
    { en: 'Password must be 72 characters or less.', zh: '密码不能超过 72 个字符。', ko: '비밀번호는 72자 이하여야 합니다.', es: 'La contraseña debe tener 72 caracteres o menos.', fr: 'Mot de passe : 72 caractères max.' },
  'メールアドレスまたはパスワードが違います。':
    { en: 'Incorrect email or password.', zh: '邮箱或密码不正确。', ko: '이메일 또는 비밀번호가 잘못되었습니다.', es: 'Correo o contraseña incorrectos.', fr: 'E-mail ou mot de passe incorrect.' },
  '確認メールのリンクをクリックしてからログインしてください。':
    { en: 'Please click the link in the confirmation email before logging in.', zh: '请先点击确认邮件中的链接。', ko: '확인 이메일의 링크를 먼저 클릭해 주세요.', es: 'Haga clic en el enlace del correo de confirmación primero.', fr: 'Cliquez sur le lien de confirmation reçu.' },
  '短時間に試行しすぎました。少し待ってから再度お試しください。':
    { en: 'Too many attempts. Please wait a moment and try again.', zh: '尝试次数过多，请稍后再试。', ko: '시도가 너무 잦습니다. 잠시 후 다시 시도하세요.', es: 'Demasiados intentos. Espere un momento.', fr: 'Trop de tentatives. Patientez un instant.' },
  'ネットワークエラー。接続を確認してください。':
    { en: 'Network error. Please check your connection.', zh: '网络错误。请检查您的连接。', ko: '네트워크 오류. 연결을 확인하세요.', es: 'Error de red. Verifique su conexión.', fr: 'Erreur réseau. Vérifiez votre connexion.' },
  'ログインに失敗しました。しばらくしてからもう一度お試しください。':
    { en: 'Login failed. Please try again later.', zh: '登录失败，请稍后重试。', ko: '로그인 실패. 잠시 후 다시 시도하세요.', es: 'Error de inicio de sesión.', fr: 'Échec de la connexion.' },
  'メールアドレスを入力してください。':
    { en: 'Please enter your email.', zh: '请输入邮箱。', ko: '이메일을 입력하세요.', es: 'Ingrese su correo.', fr: 'Saisissez votre e-mail.' },
  'パスワードが一致しません。':
    { en: 'Passwords do not match.', zh: '密码不匹配。', ko: '비밀번호가 일치하지 않습니다.', es: 'Las contraseñas no coinciden.', fr: 'Les mots de passe ne correspondent pas.' },
  'パスワードを更新しました。再度ログインしてください。':
    { en: 'Password updated. Please log in again.', zh: '密码已更新。请重新登录。', ko: '비밀번호 변경 완료. 다시 로그인해 주세요.', es: 'Contraseña actualizada. Inicie sesión.', fr: 'Mot de passe mis à jour.' },
  'このメールアドレスは既に登録済みです。ログインしてください。':
    { en: 'This email is already registered. Please log in.', zh: '该邮箱已注册，请登录。', ko: '이미 가입된 이메일입니다. 로그인해 주세요.', es: 'Correo ya registrado. Inicie sesión.', fr: 'E-mail déjà enregistré. Connectez-vous.' },
  'アカウントを作成しました！':
    { en: 'Account created!', zh: '账户创建成功！', ko: '계정이 생성되었습니다!', es: '¡Cuenta creada!', fr: 'Compte créé !' },
  '確認メールを送信しました。リンクをクリックしてからログインしてください。':
    { en: 'Confirmation email sent. Click the link to log in.', zh: '已发送确认邮件，请点击链接登录。', ko: '확인 이메일을 보냈습니다.', es: 'Correo de confirmación enviado.', fr: 'E-mail de confirmation envoyé.' },
  '登録完了。ログインしてください。':
    { en: 'Registration complete. Please log in.', zh: '注册完成。请登录。', ko: '가입 완료. 로그인해 주세요.', es: 'Registro completo. Inicie sesión.', fr: 'Inscription terminée. Connectez-vous.' },
  '通報しました。ご協力ありがとうございます。':
    { en: 'Report sent. Thank you for your help.', zh: '已举报。感谢您的协助。', ko: '신고가 접수되었습니다. 협조해 주셔서 감사합니다.', es: 'Denuncia enviada. Gracias.', fr: 'Signalement envoyé. Merci.' },
  '通報に失敗しました。':
    { en: 'Failed to report.', zh: '举报失败。', ko: '신고에 실패했습니다.', es: 'Error al denunciar.', fr: 'Échec du signalement.' },
  '保存に失敗しました':
    { en: 'Failed to save', zh: '保存失败', ko: '저장에 실패했습니다', es: 'Error al guardar', fr: 'Échec de l\'enregistrement' },
  '共有に失敗しました':
    { en: 'Failed to share', zh: '分享失败', ko: '공유에 실패했습니다', es: 'Error al compartir', fr: 'Échec du partage' },
  '🔗 リンクをコピーしました':
    { en: '🔗 Link copied', zh: '🔗 链接已复制', ko: '🔗 링크 복사됨', es: '🔗 Enlace copiado', fr: '🔗 Lien copié' },
  '「気になる」を取り消しました':
    { en: 'Concern removed', zh: '已取消「在意」', ko: '관심 해제됨', es: 'Inquietud retirada', fr: 'Préoccupation retirée' },
  'リアクションに失敗しました':
    { en: 'Failed to react', zh: '反应失败', ko: '리액션 실패', es: 'Error al reaccionar', fr: 'Échec de la réaction' },
  'いいねに失敗しました':
    { en: 'Failed to like', zh: '点赞失败', ko: '좋아요 실패', es: 'Error al dar me gusta', fr: 'Échec du j\'aime' },
  '「気になる」に失敗しました':
    { en: 'Failed to mark as concern', zh: '「在意」失败', ko: '관심 표시 실패', es: 'Error al marcar inquietud', fr: 'Échec de la préoccupation' },
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

// imperative 翻訳 — hook が使えない場所 (Promise.catch, lib/api/* throws, toastStore 内部) 用。
// 現在の言語を store から読んで translate に渡す。
// ※ Reactive ではない (lang 変更で UI 内の既出文字列は再翻訳されない)。
//   toast のように一回限りの表示には十分。
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
