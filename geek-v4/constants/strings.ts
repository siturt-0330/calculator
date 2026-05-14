export const S = {
  // 投稿
  POST_SUCCESS: '投稿しました。',
  POST_FAIL: '投稿に失敗しました。',
  POST_CONTENT_REQUIRED: '画像かテキストを入力してください。',
  POST_TAG_REQUIRED: 'タグを 1 つ以上追加してください。',
  POST_TRUST_LOW: '投稿には信頼スコア 20 以上が必要です。',
  // いいね
  LIKE_ADDED: 'いいねしました。',
  // 保存
  SAVE_ADDED: '保存しました。',
  SAVE_REMOVED: '保存を取り消しました。',
  // 通報
  REPORT_SUCCESS: '通報しました。ご協力ありがとうございます。',
  REPORT_FAIL: '通報に失敗しました。',
  // ブロック
  BLOCK_SUCCESS: 'ブロックしました。',
  BLOCK_REMOVED: 'ブロックを解除しました。',
  // エラー共通
  NETWORK_ERROR: '通信状況をご確認のうえ、もう一度お試しください。',
  // BBS
  BBS_REPLY_SUCCESS: '返信しました。',
  BBS_TRUST_LOW: '掲示板への投稿には信頼スコア 10 以上が必要です。',
} as const;
