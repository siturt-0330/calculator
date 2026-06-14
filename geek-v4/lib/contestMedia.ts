// =============================================================================
// lib/contestMedia.ts — コンテスト選択肢/作品の画像・動画を選んで upload する共通入口
// -----------------------------------------------------------------------------
// 作成UIの選択肢メディアと、公募の作品提出で共用。posts-media bucket に上げて URL を返す
// (画像は EXIF strip + magic-byte + 再エンコード、動画は size/MIME 検証 — lib/media.ts)。
// =============================================================================

import { Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';

import { supabase } from './supabase';
import { uploadPostImage, uploadPostVideo, validateVideoSource } from './media';
import { showPermissionRescue } from './permissionRescue';

export type ContestMedia = { url: string; type: 'image' | 'video' };

// ライブラリから画像 or 動画を1つ選び、upload して { url, type } を返す。
// canceled / 権限拒否は null。失敗は throw。
export async function pickAndUploadContestMedia(): Promise<ContestMedia | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('ログインしてください');

  if (Platform.OS !== 'web') {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      showPermissionRescue('写真・動画へのアクセスが許可されていません');
      return null;
    }
  }

  const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images', 'videos'], quality: 1 });
  if (r.canceled || !r.assets[0]) return null;
  const asset = r.assets[0];

  if (asset.type === 'video') {
    const v = await validateVideoSource({ uri: asset.uri, fileSize: asset.fileSize, mimeType: asset.mimeType });
    if (!v.ok) throw new Error(v.reason);
    const url = await uploadPostVideo(asset.uri, user.id, { mime: v.mime, ext: v.ext });
    return { url, type: 'video' };
  }
  const url = await uploadPostImage(asset.uri, user.id);
  return { url, type: 'image' };
}
