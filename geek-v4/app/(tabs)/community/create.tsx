// =============================================================================
// app/(tabs)/community/create.tsx — コミュニティ作成(EDITORIAL「特集」言語)
// -----------------------------------------------------------------------------
// 司書台帳(Library Catalog)の美学で組んだ作成フォーム。黒地 C.bg + 1px 罫線 +
// 大型タイポ + 紫 accent を要所に集中。塗りカード/濃い影は使わず、罫線と余白で
// リズムを作る。UI は presentational な部品に分解し、本画面は state / fetch /
// router / 下書き連携を司る「画面」層に徹する。
//
//   部品: EditorialFormHeader(マストヘッド) / EditorialIconPicker(蔵書票) /
//         EditorialField(下線一本入力) / SimilarCommunityNotice(欄外註) /
//         EditorialTagEditor(主題分類) / EditorialVisibilityCards(ACCESS) /
//         EditorialSubmitBar(刷る)
//
// 自動下書き(draftsStore):
//   - 一度でも入力(名前/説明/タグ/アイコン)があれば 600ms debounce で 1 件 upsert。
//     初回に newDraftId('community') を発番し、以後は同 ID を更新(draftIdRef)。
//   - ?draftId=xxx で「下書き一覧」から再開。name/description/tags/visibility と
//     アイコン URI を復元(blob は同一セッションなら best-effort で再構築)。
//   - 作成成功(アイコン upload 失敗時も community は出来ている)で当該下書きを削除。
//
// 公開設定は API の Visibility('open'|'request'|'invite')をそのまま単一 state に
// 持つ(旧実装の visibility+closedMode 二重管理を廃止)。
// =============================================================================

import { View, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { useState, useEffect, useRef, useMemo } from 'react';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { useQuery } from '@tanstack/react-query';

import { C, SP } from '../../../design/tokens';
import { TABBAR } from '../../../design/tabbar';
import {
  createCommunity,
  searchByName,
  uploadCommunityIcon,
  updateCommunity,
  type Visibility,
  type Community,
} from '../../../lib/api/communities';
import { useToastStore } from '../../../stores/toastStore';
import { searchTags } from '../../../lib/api/tags';
import { useDebounce } from '../../../hooks/useDebounce';
import { deepNormalize } from '../../../lib/search/tokenize';
import { prepareImageUpload } from '../../../lib/image';
import { openCropper } from '../../../lib/imageCropper';
import { useDraftsStore, newDraftId } from '../../../stores/draftsStore';

import { EditorialFormHeader } from '../../../components/community/EditorialFormHeader';
import { EditorialIconPicker } from '../../../components/community/EditorialIconPicker';
import { EditorialField } from '../../../components/community/EditorialField';
import { SimilarCommunityNotice } from '../../../components/community/SimilarCommunityNotice';
import { EditorialTagEditor } from '../../../components/community/EditorialTagEditor';
import { EditorialVisibilityCards } from '../../../components/community/EditorialVisibilityCards';
import { EditorialSubmitBar } from '../../../components/community/EditorialSubmitBar';

// 2026-05: コミュニティ「ジャンル」ピッカーは撤去済み (UI / state / 作成ロジック)。
// DB column communities.genre は migration 0044 で default 'legacy' で残置 (既存データ保持)。

export default function CreateCommunityScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ draftId?: string }>();
  const show = useToastStore((s) => s.show);

  // ---- フォーム state ----
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  // ローカルでアップロード待ちのアイコン (URI = preview / blob = upload body)
  const [localIconUri, setLocalIconUri] = useState<string | null>(null);
  // Web では Blob、Native では FormData が来る。両方を Supabase Storage に渡せる。
  const [localIconBlob, setLocalIconBlob] = useState<Blob | FormData | null>(null);
  const [localIconMime, setLocalIconMime] = useState<string>('image/jpeg');
  const [iconLoading, setIconLoading] = useState(false);
  // 公開設定は API Visibility をそのまま単一 state で持つ('open'|'request'|'invite')。
  const [visibility, setVisibility] = useState<Visibility>('open');
  const [tagInput, setTagInput] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // ---- 下書き連携 ----
  // 自動保存で同一 ID を更新するための下書き ID。初回保存 or 復元時に確定する。
  const draftIdRef = useRef<string | null>(null);
  // 復元は mount で 1 回だけ。
  const draftRestored = useRef(false);

  // ---------------------------------------------------------------------------
  // タグ補完: query が短いときは早めに反応 (100ms)、長くなったら 150ms debounce
  // ---------------------------------------------------------------------------
  const debouncedTagQuery = useDebounce(tagInput, tagInput.trim().length <= 2 ? 100 : 150);

  const { data: tagSuggestions = [] } = useQuery({
    queryKey: ['community-create-tag-suggestions', debouncedTagQuery.trim()],
    // 共有 searchTags: generateVariants(表記ゆれ/同義語/ローマ字)で broad fetch し
    // similarity + post_count で再ランキング。生 ilike では拾えなかった既存タグが出る。
    queryFn: () => searchTags(debouncedTagQuery, { limit: 8 }),
    staleTime: 30_000,
    enabled: debouncedTagQuery.trim().length > 0,
  });

  // 「新しいタグ "#query" を作る」を出すか — 入力あり & 候補/既選択に同名(正規化一致)なし
  const showCreateNewTag = useMemo(() => {
    const q = debouncedTagQuery.trim().replace(/^#/, '');
    if (!q) return false;
    const nq = deepNormalize(q);
    if (tags.some((t) => deepNormalize(t) === nq)) return false;
    if (tagSuggestions.some((s) => deepNormalize(s.name) === nq)) return false;
    return true;
  }, [debouncedTagQuery, tagSuggestions, tags]);

  // ---------------------------------------------------------------------------
  // 類似名チェック (短いクエリ 150ms / 通常 200ms debounce)
  // ---------------------------------------------------------------------------
  const [similar, setSimilar] = useState<Community[]>([]);
  const [checking, setChecking] = useState(false);
  const lastQueryRef = useRef('');
  useEffect(() => {
    const q = name.trim();
    if (q.length < 2) {
      setSimilar([]);
      return;
    }
    lastQueryRef.current = q;
    setChecking(true);
    const delay = q.length <= 3 ? 150 : 200;
    const t = setTimeout(async () => {
      const results = await searchByName(q, 5);
      // race condition 防止 — 最後のクエリと一致しているかチェック
      if (lastQueryRef.current === q) {
        setSimilar(results);
        setChecking(false);
      }
    }, delay);
    return () => clearTimeout(t);
  }, [name]);

  // ---------------------------------------------------------------------------
  // 下書き復元 — ?draftId=xxx で「下書き一覧」から再開 (mount 1 回)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (draftRestored.current) return;
    draftRestored.current = true;
    const did = typeof params.draftId === 'string' ? params.draftId : '';
    if (!did) return;
    const d = useDraftsStore.getState().items.find((x) => x.id === did);
    if (!d || d.kind !== 'community') return;
    setName(d.name);
    setDescription(d.description);
    setTags(d.tags);
    setVisibility(d.visibility);
    if (d.iconUri) {
      const iconUri = d.iconUri; // async closure 用に narrow を確定させる
      setLocalIconUri(iconUri);
      // best-effort: 同一セッションなら URI から upload blob を再構築する。
      // 失効(別セッションの blob: URL 等)時は preview だけ残し、submit 時に再選択を促す。
      void (async () => {
        try {
          const prepared = await prepareImageUpload(iconUri, {
            maxSizeBytes: 5 * 1024 * 1024,
            maxWidth: 512,
            maxHeight: 512,
            quality: 0.85,
          });
          setLocalIconBlob(prepared.blob);
          setLocalIconMime(prepared.mime);
        } catch (e) {
          console.warn('[community/create] draft icon re-prepare failed:', e);
        }
      })();
    }
    draftIdRef.current = d.id;
    show('下書きを開きました', 'info');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------------------------------------------------------------------
  // 下書き自動保存 (debounce 600ms)
  // 一度でも何か入力したら自動で下書き登録 → 以後は同一 draftId を更新。
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const meaningful =
      name.trim().length > 0 ||
      description.trim().length > 0 ||
      tags.length > 0 ||
      !!localIconUri;
    if (!meaningful) return;
    const t = setTimeout(() => {
      let id = draftIdRef.current;
      if (!id) {
        id = newDraftId('community');
        draftIdRef.current = id;
      }
      useDraftsStore.getState().upsert({
        id,
        kind: 'community',
        name,
        description,
        tags,
        visibility,
        // 単一 visibility が真。closedMode は型互換のため派生値で埋める(表示は visibility 駆動)。
        closedMode: visibility === 'invite' ? 'invite' : 'request',
        iconUri: localIconUri,
      });
    }, 600);
    return () => clearTimeout(t);
  }, [name, description, tags, visibility, localIconUri]);

  // ---------------------------------------------------------------------------
  // アイコン選択 — ライブラリ → 自前 circular cropper → EXIF strip + 検証
  // ---------------------------------------------------------------------------
  const pickIcon = async () => {
    if (iconLoading || submitting) return;
    setIconLoading(true);
    try {
      if (Platform.OS !== 'web') {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) {
          show('写真へのアクセス権限が必要です', 'warn');
          return; // finally で loading 解除される
        }
      }
      const r = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: 'images',
        // allowsEditing は使わない — 自前 circular cropper で UX を統一
        quality: 1,
      });
      if (r.canceled || !r.assets[0]) {
        return; // finally で loading 解除される
      }
      const asset = r.assets[0];
      // openCropper 中は spinner を一旦解除 (出っぱなし防止)
      setIconLoading(false);
      let croppedUri: string | null = null;
      try {
        croppedUri = await openCropper(asset.uri);
      } catch (cropErr) {
        console.warn('[community/create] cropper threw:', cropErr);
        show('画像の切り抜きでエラーが発生しました', 'error');
        return;
      }
      if (!croppedUri) return; // cancel or timeout

      setIconLoading(true);
      // prepareImageUpload: EXIF 除去 + magic byte 検証 + size check (5MB)
      let prepared;
      try {
        prepared = await prepareImageUpload(croppedUri, {
          maxSizeBytes: 5 * 1024 * 1024,
          maxWidth: 512, // アイコンなので大きすぎないように
          maxHeight: 512,
          quality: 0.85,
        });
      } catch (e) {
        console.warn('[community/create] prepareImageUpload failed:', e);
        const msg = e instanceof Error ? e.message : '画像処理に失敗しました';
        show(`画像処理エラー: ${msg}`, 'warn');
        return;
      }
      setLocalIconUri(croppedUri);
      setLocalIconBlob(prepared.blob);
      setLocalIconMime(prepared.mime);
      show('アイコンを切り抜きました', 'success');
    } catch (e) {
      console.warn('[community/create] pick icon failed:', e);
      const msg = e instanceof Error ? e.message : '';
      show(msg ? `画像の取得に失敗しました: ${msg}` : '画像の取得に失敗しました', 'error');
    } finally {
      // 必ず loading 解除 — エラー / cancel / 成功すべてで
      setIconLoading(false);
    }
  };

  const removeIcon = () => {
    setLocalIconUri(null);
    setLocalIconBlob(null);
  };

  // ---------------------------------------------------------------------------
  // タグ操作
  // ---------------------------------------------------------------------------
  const addTagByName = (raw: string) => {
    const t = raw.trim().replace(/^#/, '');
    if (!t) return;
    // deepNormalize 一致は既存とみなす (例: 「ポケモン」と「ぽけもん」)
    const nq = deepNormalize(t);
    if (tags.some((x) => deepNormalize(x) === nq)) {
      setTagInput('');
      return;
    }
    if (tags.length >= 10) {
      show('タグは最大 10 個まで', 'warn');
      return;
    }
    setTags([...tags, t]);
    setTagInput('');
  };

  const addTag = () => addTagByName(tagInput);
  const removeTag = (t: string) => setTags(tags.filter((x) => x !== t));

  // ---------------------------------------------------------------------------
  // 作成
  // ---------------------------------------------------------------------------
  const onSubmit = async () => {
    if (submitting) return;
    if (name.trim().length < 2) {
      show('コミュニティ名は 2 文字以上にしてください', 'warn');
      return;
    }
    if (name.trim().length > 40) {
      show('コミュニティ名は 40 文字以内にしてください', 'warn');
      return;
    }
    if (!localIconBlob) {
      show('アイコン画像を選択してください', 'warn');
      return;
    }
    setSubmitting(true);
    try {
      // Step 1: row を INSERT (icon_url なし)
      const { data: created, error } = await createCommunity({
        name,
        description,
        icon_emoji: '👥', // placeholder
        icon_color: '#7C6AF7', // placeholder
        visibility,
        tags,
      });
      if (error || !created) {
        show(error ?? 'コミュニティ作成に失敗しました', 'error');
        return;
      }
      // Step 2: アイコンアップロード — 失敗しても community は出来ているので警告だけ
      const { url, error: upErr } = await uploadCommunityIcon(created.id, localIconBlob, localIconMime);
      if (upErr || !url) {
        console.warn('[community/create] icon upload failed:', upErr);
        const detail = upErr ? `\n詳細: ${upErr}` : '';
        show(`アイコンのアップロードに失敗しました。${detail}\n後で詳細画面から再設定できます。`, 'warn');
        // community 自体は作成済 → 下書きは破棄して詳細へ
        if (draftIdRef.current) useDraftsStore.getState().remove(draftIdRef.current);
        router.replace(`/community/${created.id}` as never);
        return;
      }
      // Step 3: icon_url を反映 — 失敗しても致命的ではないので警告のみ
      try {
        await updateCommunity(created.id, { icon_url: url });
      } catch (e) {
        console.warn('[community/create] icon_url update failed:', e);
      }
      show('コミュニティを作成しました！', 'success');
      // 作成成功 → この下書きを削除
      if (draftIdRef.current) useDraftsStore.getState().remove(draftIdRef.current);
      router.replace(`/community/${created.id}` as never);
    } catch (e) {
      console.warn('[community/create] submit failed:', e);
      const msg = e instanceof Error ? e.message : '';
      let userMsg = 'コミュニティ作成に失敗しました';
      if (msg.includes('Network') || msg.includes('Failed to fetch')) {
        userMsg = '通信エラー。電波を確認してください';
      } else if (msg.includes('row-level security') || msg.includes('RLS')) {
        userMsg = '権限エラー。ログインし直してください';
      }
      show(userMsg, 'error');
    } finally {
      // 成功時は router.replace で離れるが、エラー時に確実にフォーム解放するため呼ぶ
      setSubmitting(false);
    }
  };

  // 戻る — back stack が空ならコミュニティタブへ
  const handleBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/community' as never);
  };

  // submit が押せない理由(誌面注記用)。名前 < 2 → アイコン未選択 の順で 1 つだけ示す。
  const disabledReason =
    name.trim().length < 2
      ? 'コミュニティ名を 2 文字以上で入力してください'
      : !localIconBlob
        ? 'アイコン画像を選択してください'
        : null;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={{ flex: 1, backgroundColor: C.bg }}
    >
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + SP['2'],
          // (tabs) 配下なので下部 tab bar の高さ + safe area を加味して末尾が隠れないように
          paddingBottom: TABBAR.height + insets.bottom + SP['10'],
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* マストヘッド(自前で左右 SP[5] + 最下辺 hairline を持つ) */}
        <EditorialFormHeader
          titleEn="NEW COMMUNITY"
          titleJa="コミュニティを作る"
          onBack={handleBack}
        />

        {/* 蔵書票アイコン(中央・必須) */}
        <View style={{ height: SP['6'] }} />
        <EditorialIconPicker
          uri={localIconUri}
          loading={iconLoading}
          onPick={pickIcon}
          onRemove={removeIcon}
        />

        {/* コミュニティ名(下線一本・必須・カウンタ) */}
        <View style={{ height: SP['6'] }} />
        <View style={{ paddingHorizontal: SP['5'] }}>
          <EditorialField
            label="コミュニティ名"
            required
            hint="短く・覚えやすい名前 (2〜40文字)"
            value={name}
            onChangeText={setName}
            placeholder="例: 関西ゲーム開発者"
            maxLength={40}
            showCount
            autoFocus
          />
        </View>

        {/* 似た名前の欄外註(自前で左右 SP[5] margin を持つ) */}
        <SimilarCommunityNotice
          communities={similar}
          checking={checking}
          query={name.trim()}
          onPressCommunity={(id) => router.push(`/community/${id}` as never)}
        />

        {/* 説明(任意・複数行・カウンタ) */}
        <View style={{ height: SP['5'] }} />
        <View style={{ paddingHorizontal: SP['5'] }}>
          <EditorialField
            label="説明（任意）"
            hint="どんな話をする場所か、ひと言で"
            value={description}
            onChangeText={setDescription}
            placeholder="どんな話をする場所か"
            maxLength={500}
            multiline
            showCount
          />
        </View>

        {/* 主題分類(タグ・自前で左右 SP[5] + 上下 border を持つ) */}
        <View style={{ height: SP['4'] }} />
        <EditorialTagEditor
          tags={tags}
          onRemove={removeTag}
          input={tagInput}
          onInputChange={setTagInput}
          onSubmitTag={addTag}
          suggestions={tagSuggestions}
          showCreateNew={showCreateNewTag}
          onPickSuggestion={(n) => addTagByName(n)}
          onCreateNew={() => addTagByName(tagInput)}
          max={10}
        />

        {/* ACCESS(公開設定・自前で左右 SP[5] を持つ) */}
        <EditorialVisibilityCards value={visibility} onChange={setVisibility} />

        {/* 刷る(作成・自前で左右 SP[5] を持つ) */}
        <View style={{ height: SP['5'] }} />
        <EditorialSubmitBar
          label="コミュニティを作成"
          onPress={onSubmit}
          loading={submitting}
          disabled={name.trim().length < 2 || !localIconBlob}
          disabledReason={disabledReason}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
