// ============================================================
// 国際化辞書 (ASEAN 展開を見据えた多言語サポート)
// ============================================================
// 言語コード:
//   ja: 日本語 (デフォルト)
//   en: English
//   ko: 한국어
//   zh: 中文 (Simplified)
//   th: ภาษาไทย
//   vi: Tiếng Việt
// ============================================================

import type { Lang } from '../../stores/languageStore';

// キーをドット区切りで namespace 化
export const STRINGS: Record<string, Partial<Record<Lang, string>>> = {
  // common
  'common.ok':            { ja: 'OK', en: 'OK', ko: '확인', zh: '确定', th: 'ตกลง', fr: 'OK', es: 'OK' },
  'common.cancel':        { ja: 'キャンセル', en: 'Cancel', ko: '취소', zh: '取消', th: 'ยกเลิก', fr: 'Annuler', es: 'Cancelar' },
  'common.save':          { ja: '保存', en: 'Save', ko: '저장', zh: '保存', th: 'บันทึก', fr: 'Enregistrer', es: 'Guardar' },
  'common.delete':        { ja: '削除', en: 'Delete', ko: '삭제', zh: '删除', th: 'ลบ', fr: 'Supprimer', es: 'Eliminar' },
  'common.edit':          { ja: '編集', en: 'Edit', ko: '편집', zh: '编辑', th: 'แก้ไข', fr: 'Modifier', es: 'Editar' },
  'common.back':          { ja: '戻る', en: 'Back', ko: '뒤로', zh: '返回', th: 'ย้อนกลับ', fr: 'Retour', es: 'Atrás' },
  'common.retry':         { ja: '再試行', en: 'Retry', ko: '다시 시도', zh: '重试', th: 'ลองอีก', fr: 'Réessayer', es: 'Reintentar' },
  'common.loading':       { ja: '読み込み中…', en: 'Loading…', ko: '로딩 중…', zh: '加载中…', th: 'กำลังโหลด…', fr: 'Chargement…', es: 'Cargando…' },
  'common.search':        { ja: '検索', en: 'Search', ko: '검색', zh: '搜索', th: 'ค้นหา', fr: 'Rechercher', es: 'Buscar' },
  'common.send':          { ja: '送信', en: 'Send', ko: '보내기', zh: '发送', th: 'ส่ง', fr: 'Envoyer', es: 'Enviar' },
  'common.add':           { ja: '追加', en: 'Add', ko: '추가', zh: '添加', th: 'เพิ่ม', fr: 'Ajouter', es: 'Agregar' },
  'common.share':         { ja: '共有', en: 'Share', ko: '공유', zh: '分享', th: 'แชร์', fr: 'Partager', es: 'Compartir' },
  'common.report':        { ja: '通報', en: 'Report', ko: '신고', zh: '举报', th: 'รายงาน', fr: 'Signaler', es: 'Reportar' },
  'common.minutes_ago':   { ja: '{n}分前', en: '{n} min ago', ko: '{n}분 전', zh: '{n}分钟前', th: '{n} นาทีที่แล้ว', fr: 'il y a {n} min', es: 'hace {n} min' },
  'common.hours_ago':     { ja: '{n}時間前', en: '{n}h ago', ko: '{n}시간 전', zh: '{n}小时前', th: '{n} ชม.ที่แล้ว', fr: 'il y a {n}h', es: 'hace {n}h' },
  'common.just_now':      { ja: 'たった今', en: 'just now', ko: '방금', zh: '刚刚', th: 'เมื่อสักครู่', fr: "à l'instant", es: 'justo ahora' },
  'common.yesterday':     { ja: '昨日', en: 'yesterday', ko: '어제', zh: '昨天', th: 'เมื่อวาน', fr: 'hier', es: 'ayer' },

  // tabs
  'tab.home':             { ja: 'ホーム', en: 'Home', ko: '홈', zh: '首页', th: 'หน้าหลัก', fr: 'Accueil', es: 'Inicio' },
  'tab.bbs':              { ja: '掲示板', en: 'Boards', ko: '게시판', zh: '论坛', th: 'กระดาน', fr: 'Forums', es: 'Foros' },
  'tab.oshi':             { ja: '推し活', en: 'Fandom', ko: '응원', zh: '应援', th: 'แฟนคลับ', fr: 'Fandom', es: 'Fandom' },
  'tab.mypage':           { ja: 'マイ', en: 'Me', ko: '내', zh: '我的', th: 'ของฉัน', fr: 'Moi', es: 'Yo' },

  // feed
  'feed.trending_tags':       { ja: 'いま盛り上がっているタグ', en: 'Trending tags now', ko: '지금 핫한 태그', zh: '热门标签', th: 'แท็กยอดนิยม', fr: 'Tags tendance', es: 'Tags en tendencia' },
  'feed.no_posts':            { ja: 'まだ投稿がありません', en: 'No posts yet', ko: '게시물이 없습니다', zh: '还没有帖子', th: 'ยังไม่มีโพสต์', fr: 'Pas encore de posts', es: 'Aún no hay publicaciones' },
  'feed.post_first':          { ja: '最初の投稿をしてみよう', en: 'Make the first post', ko: '첫 게시물을 작성하세요', zh: '发布第一条', th: 'โพสต์แรกเลย', fr: 'Soyez le premier à poster', es: 'Haz la primera publicación' },

  // notifications
  'notif.title':              { ja: '通知', en: 'Notifications', ko: '알림', zh: '通知', th: 'การแจ้งเตือน', fr: 'Notifications', es: 'Notificaciones' },
  'notif.mark_all_read':      { ja: 'すべて既読', en: 'Mark all read', ko: '모두 읽음', zh: '全部已读', th: 'อ่านทั้งหมด', fr: 'Tout marquer comme lu', es: 'Marcar todo como leído' },
  'notif.empty':              { ja: 'まだ通知はありません', en: 'No notifications yet', ko: '알림이 없습니다', zh: '暂无通知', th: 'ยังไม่มีการแจ้งเตือน', fr: 'Aucune notification', es: 'Sin notificaciones' },

  // settings
  'settings.title':           { ja: '設定', en: 'Settings', ko: '설정', zh: '设置', th: 'การตั้งค่า', fr: 'Paramètres', es: 'Ajustes' },
  'settings.account':         { ja: 'アカウント', en: 'Account', ko: '계정', zh: '账户', th: 'บัญชี', fr: 'Compte', es: 'Cuenta' },
  'settings.notifications':   { ja: '通知設定', en: 'Notifications', ko: '알림 설정', zh: '通知设置', th: 'การแจ้งเตือน', fr: 'Notifications', es: 'Notificaciones' },
  'settings.privacy':         { ja: 'プライバシー', en: 'Privacy', ko: '개인정보', zh: '隐私', th: 'ความเป็นส่วนตัว', fr: 'Confidentialité', es: 'Privacidad' },
  'settings.blocked_tags':    { ja: 'ブロックするタグ', en: 'Blocked tags', ko: '차단 태그', zh: '屏蔽标签', th: 'แท็กที่บล็อก', fr: 'Tags bloqués', es: 'Etiquetas bloqueadas' },
  'settings.blocked_users':   { ja: 'ブロックしたユーザー', en: 'Blocked users', ko: '차단한 사용자', zh: '屏蔽用户', th: 'ผู้ใช้ที่บล็อก', fr: 'Utilisateurs bloqués', es: 'Usuarios bloqueados' },
  'settings.logout':          { ja: 'ログアウト', en: 'Log out', ko: '로그아웃', zh: '退出', th: 'ออกจากระบบ', fr: 'Déconnexion', es: 'Cerrar sesión' },
  'settings.delete_account':  { ja: 'アカウントを削除', en: 'Delete account', ko: '계정 삭제', zh: '删除账户', th: 'ลบบัญชี', fr: 'Supprimer le compte', es: 'Eliminar cuenta' },
  'settings.export_data':     { ja: 'データをエクスポート', en: 'Export my data', ko: '내 데이터 내보내기', zh: '导出我的数据', th: 'ส่งออกข้อมูล', fr: 'Exporter mes données', es: 'Exportar mis datos' },

  // post
  'post.compose':             { ja: '投稿', en: 'Post', ko: '게시', zh: '发布', th: 'โพสต์', fr: 'Publier', es: 'Publicar' },
  'post.draft_restored':      { ja: '下書きを復元しました', en: 'Draft restored', ko: '초안 복원됨', zh: '草稿已恢复', th: 'กู้คืนแบบร่างแล้ว', fr: 'Brouillon restauré', es: 'Borrador restaurado' },
  'post.posted':              { ja: '投稿しました', en: 'Posted', ko: '게시됨', zh: '已发布', th: 'โพสต์แล้ว', fr: 'Publié', es: 'Publicado' },
  'post.tag_required':        { ja: 'タグを1つ以上追加してください。', en: 'Add at least 1 tag.', ko: '태그를 1개 이상 추가하세요.', zh: '请至少添加 1 个标签。', th: 'เพิ่มอย่างน้อย 1 แท็ก', fr: 'Ajoutez au moins 1 tag.', es: 'Añade al menos 1 etiqueta.' },

  // errors
  'error.network':            { ja: '通信エラー。電波を確認してください。', en: 'Network error. Check connection.', ko: '네트워크 오류. 연결을 확인하세요.', zh: '网络错误。请检查连接。', th: 'ข้อผิดพลาดเครือข่าย', fr: 'Erreur réseau.', es: 'Error de red.' },
  'error.auth':               { ja: '権限エラー。ログインし直してください。', en: 'Auth error. Please log in again.', ko: '인증 오류. 다시 로그인하세요.', zh: '权限错误。请重新登录。', th: 'ข้อผิดพลาดการตรวจสอบสิทธิ์', fr: 'Erreur d\'authentification.', es: 'Error de autenticación.' },
  'error.rate_limit':         { ja: '操作が短時間で多すぎます。少し待ってお試しください。', en: 'Too many actions. Please wait.', ko: '너무 많은 작업. 잠시 후 다시 시도하세요.', zh: '操作过于频繁。请稍候。', th: 'ดำเนินการบ่อยเกินไป รอสักครู่', fr: 'Trop d\'actions. Veuillez patienter.', es: 'Demasiadas acciones. Por favor espera.' },

  // auth
  'auth.login':               { ja: 'ログイン', en: 'Log in', ko: '로그인', zh: '登录', th: 'เข้าสู่ระบบ', fr: 'Connexion', es: 'Iniciar sesión' },
  'auth.signup':              { ja: '新規登録', en: 'Sign up', ko: '회원가입', zh: '注册', th: 'สมัครสมาชิก', fr: 'Inscription', es: 'Registrarse' },
  'auth.email':               { ja: 'メールアドレス', en: 'Email', ko: '이메일', zh: '邮箱', th: 'อีเมล', fr: 'Email', es: 'Correo electrónico' },
  'auth.password':            { ja: 'パスワード', en: 'Password', ko: '비밀번호', zh: '密码', th: 'รหัสผ่าน', fr: 'Mot de passe', es: 'Contraseña' },
};

export function t(key: keyof typeof STRINGS | string, lang: Lang, vars: Record<string, string | number> = {}): string {
  const entry = STRINGS[key];
  if (!entry) return key;
  let str = entry[lang] ?? entry.ja ?? key;
  for (const [k, v] of Object.entries(vars)) {
    str = str.replaceAll(`{${k}}`, String(v));
  }
  return str;
}
