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
  'auth.forgot':              { ja: 'パスワードを忘れた方', en: 'Forgot password?', ko: '비밀번호를 잊으셨나요?', zh: '忘记密码？', th: 'ลืมรหัสผ่าน?', fr: 'Mot de passe oublié ?', es: '¿Olvidaste tu contraseña?' },
  'auth.reset_password':      { ja: 'パスワード再設定', en: 'Reset password', ko: '비밀번호 재설정', zh: '重置密码', th: 'ตั้งรหัสผ่านใหม่', fr: 'Réinitialiser le mot de passe', es: 'Restablecer contraseña' },
  'auth.new_password':        { ja: '新しいパスワード', en: 'New password', ko: '새 비밀번호', zh: '新密码', th: 'รหัสผ่านใหม่', fr: 'Nouveau mot de passe', es: 'Nueva contraseña' },
  'auth.back_to_login':       { ja: 'ログイン画面に戻る', en: 'Back to login', ko: '로그인 화면으로 돌아가기', zh: '返回登录页', th: 'กลับไปยังหน้าเข้าสู่ระบบ', fr: 'Retour à la connexion', es: 'Volver al inicio de sesión' },
  'auth.have_account':        { ja: '既にアカウントをお持ちですか？', en: 'Already have an account?', ko: '이미 계정이 있으신가요?', zh: '已有账号？', th: 'มีบัญชีอยู่แล้ว?', fr: 'Vous avez déjà un compte ?', es: '¿Ya tienes una cuenta?' },
  'auth.phone_optional':      { ja: '電話番号 (任意)', en: 'Phone (optional)', ko: '전화번호 (선택)', zh: '电话号码（可选）', th: 'หมายเลขโทรศัพท์ (ไม่บังคับ)', fr: 'Téléphone (facultatif)', es: 'Teléfono (opcional)' },
  'auth.create_account':      { ja: 'アカウントを作成', en: 'Create account', ko: '계정 만들기', zh: '创建账号', th: 'สร้างบัญชี', fr: 'Créer un compte', es: 'Crear cuenta' },
  'auth.tagline':             { ja: '好きを、匿名で、安心して続ける', en: 'Love what you love — anonymously, safely.', ko: '좋아하는 것을, 익명으로, 안심하고.', zh: '匿名安心地坚持热爱', th: 'รักในสิ่งที่ชอบ ด้วยตัวตนนิรนาม', fr: 'Aimer ce que vous aimez, anonymement, sereinement', es: 'Ama lo que amas, anónima y seguramente' },

  // bbs
  'bbs.title':                { ja: '掲示板', en: 'Boards', ko: '게시판', zh: '论坛', th: 'กระดาน', fr: 'Forums', es: 'Foros' },
  'bbs.create_thread':        { ja: 'スレ立て', en: 'New thread', ko: '새 스레드', zh: '发新帖', th: 'สร้างกระทู้', fr: 'Nouveau fil', es: 'Nuevo hilo' },
  'bbs.search_placeholder':   { ja: 'スレッドを検索', en: 'Search threads', ko: '스레드 검색', zh: '搜索帖子', th: 'ค้นหากระทู้', fr: 'Rechercher des fils', es: 'Buscar hilos' },
  'bbs.suggest':              { ja: 'もしかして:', en: 'Did you mean:', ko: '혹시:', zh: '您是不是要找:', th: 'หมายถึง:', fr: 'Vouliez-vous dire :', es: '¿Quizás quisiste decir:' },
  'bbs.lively':               { ja: '賑わい中', en: 'Busy now', ko: '활발함', zh: '热闹中', th: 'คึกคัก', fr: 'Animé', es: 'Animado' },

  // community
  'community.find':           { ja: 'コミュニティを探す', en: 'Find a community', ko: '커뮤니티 찾기', zh: '查找社区', th: 'ค้นหาคอมมูนิตี้', fr: 'Trouver une communauté', es: 'Buscar una comunidad' },
  'community.create':         { ja: '作成', en: 'Create', ko: '만들기', zh: '创建', th: 'สร้าง', fr: 'Créer', es: 'Crear' },
  'community.also_search':    { ja: 'これも検索:', en: 'Also search:', ko: '함께 검색:', zh: '同时搜索:', th: 'ค้นหาด้วย:', fr: 'Recherchez aussi :', es: 'También buscar:' },
  'community.searching':      { ja: '検索中…', en: 'Searching…', ko: '검색 중…', zh: '搜索中…', th: 'กำลังค้นหา…', fr: 'Recherche en cours…', es: 'Buscando…' },
  'community.official':       { ja: '公式コミュニティ', en: 'Official communities', ko: '공식 커뮤니티', zh: '官方社区', th: 'คอมมูนิตี้ทางการ', fr: 'Communautés officielles', es: 'Comunidades oficiales' },
  'community.clear_filter':   { ja: 'フィルタを解除', en: 'Clear filter', ko: '필터 해제', zh: '清除筛选', th: 'ล้างตัวกรอง', fr: 'Effacer le filtre', es: 'Borrar filtro' },
  'community.name':           { ja: '名前', en: 'Name', ko: '이름', zh: '名称', th: 'ชื่อ', fr: 'Nom', es: 'Nombre' },
  'community.description_optional': { ja: '説明（任意）', en: 'Description (optional)', ko: '설명 (선택)', zh: '描述（可选）', th: 'คำอธิบาย (ไม่บังคับ)', fr: 'Description (facultatif)', es: 'Descripción (opcional)' },
  'community.tags_optional':  { ja: 'タグ（任意）', en: 'Tags (optional)', ko: '태그 (선택)', zh: '标签（可选）', th: 'แท็ก (ไม่บังคับ)', fr: 'Tags (facultatif)', es: 'Etiquetas (opcional)' },

  // generic chrome
  'chrome.close':             { ja: '閉じる', en: 'Close', ko: '닫기', zh: '关闭', th: 'ปิด', fr: 'Fermer', es: 'Cerrar' },
  'chrome.confirm':           { ja: '確認', en: 'Confirm', ko: '확인', zh: '确认', th: 'ยืนยัน', fr: 'Confirmer', es: 'Confirmar' },
  'chrome.next':              { ja: '次へ', en: 'Next', ko: '다음', zh: '下一步', th: 'ถัดไป', fr: 'Suivant', es: 'Siguiente' },
  'chrome.skip':              { ja: 'あとで', en: 'Later', ko: '나중에', zh: '稍后', th: 'ภายหลัง', fr: 'Plus tard', es: 'Más tarde' },
  'chrome.done':              { ja: '完了', en: 'Done', ko: '완료', zh: '完成', th: 'เสร็จ', fr: 'Terminé', es: 'Hecho' },

  // common (additions)
  'common.copy':              { ja: 'コピー', en: 'Copy', ko: '복사', zh: '复制', th: 'คัดลอก', fr: 'Copier', es: 'Copiar' },
  'common.copied':            { ja: 'コピーしました', en: 'Copied', ko: '복사됨', zh: '已复制', th: 'คัดลอกแล้ว', fr: 'Copié', es: 'Copiado' },
  'common.more':              { ja: 'もっと見る', en: 'See more', ko: '더 보기', zh: '查看更多', th: 'ดูเพิ่ม', fr: 'Voir plus', es: 'Ver más' },
  'common.error':             { ja: 'エラーが発生しました', en: 'An error occurred', ko: '오류가 발생했습니다', zh: '发生错误', th: 'เกิดข้อผิดพลาด', fr: 'Une erreur s\'est produite', es: 'Ocurrió un error' },
  'common.try_again':         { ja: 'もう一度お試しください', en: 'Please try again', ko: '다시 시도해주세요', zh: '请重试', th: 'กรุณาลองอีกครั้ง', fr: 'Veuillez réessayer', es: 'Por favor intenta de nuevo' },
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
