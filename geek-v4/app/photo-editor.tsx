// ============================================================
// app/photo-editor.tsx — フル写真エディタ (web canvas)
// ============================================================
// openPhotoEditor(uri) から push される全画面エディタ。HTML canvas に画像を描き、
// 描く / 文字 / スタンプ / モザイク / フィルター / 切り抜き(クロッパー委譲) を適用して
// 完了で full 解像度の JPEG data URL を resolvePhotoEditor で返す。
//
// ★ web 専用。native は openPhotoEditor 側で openCropper にフォールバックするため
//   ここには来ないが、直 URL 等の保険として native では即 cancel する。
//
// 状態は「描画に必要なもの (ops/filter/選択/下書き/画像/box)」を ref で保持し、
// コントロールの再描画だけ version state で起こす (canvas の stale closure 回避 + 軽量)。
// 座標は全て画像 px。表示は contain-fit (lib/photoEditorRender.ts)。
// ============================================================

import { useEffect, useRef, useState, useCallback, createElement, type PointerEvent as ReactPointerEvent } from 'react';
import {
  View,
  Text,
  Platform,
  TextInput,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Crop, Type as TypeIcon, LayoutGrid, Undo2 } from 'lucide-react-native';
import { Icon } from '../constants/icons';
import { C, SP, R } from '../design/tokens';
import { PressableScale } from '../components/ui/PressableScale';
import { resolvePhotoEditor, consumePendingPhoto } from '../lib/photoEditor';
import { openCropper } from '../lib/imageCropper';
import {
  FILTERS,
  DRAW_COLORS,
  BRUSH_SIZES,
  STAMP_EMOJIS,
  containFit,
  screenToImage,
  imageToScreen,
  hitTestObject,
  objBounds,
  buildPixelated,
  renderEditor,
  exportEditor,
  type EditorOp,
  type StrokeOp,
  type MosaicOp,
  type TextObj,
  type StampObj,
} from '../lib/photoEditorRender';

type Tool = 'none' | 'draw' | 'mosaic';
type Panel = 'home' | 'filter' | 'draw' | 'mosaic' | 'stamp' | 'object';

function cloneOps(ops: EditorOp[]): EditorOp[] {
  return ops.map((o) =>
    o.type === 'stroke' || o.type === 'mosaic'
      ? { ...o, points: o.points.map((p) => ({ ...p })) }
      : { ...o },
  );
}

export default function PhotoEditorScreen() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const paramId =
    typeof params.id === 'string' ? params.id : Array.isArray(params.id) ? params.id[0] ?? '' : '';
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // マウント時に一度だけ取り込む (Map から消えても画面側 uri は保持 = 編集中に
  // 突然 cancel されない)。consumePendingPhoto は read のみで副作用なし。
  const [sourceUri] = useState(() => consumePendingPhoto(paramId) ?? '');

  // ---- 退出 (canGoBack フォールバック + 二重防止) ----
  const navigatedRef = useRef(false);
  const safeExit = useCallback(() => {
    if (navigatedRef.current) return;
    navigatedRef.current = true;
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/feed' as never);
  }, [router]);

  // ---- 画像 / canvas refs ----
  const imgRef = useRef<HTMLImageElement | null>(null);
  const pixRef = useRef<HTMLCanvasElement | null>(null);
  const imgSizeRef = useRef<{ w: number; h: number } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const boxRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 });

  // ---- 編集データ (描画用 = ref) ----
  const opsRef = useRef<EditorOp[]>([]);
  const filterRef = useRef<string>('none');
  const selectedRef = useRef<number>(-1);
  const draftRef = useRef<StrokeOp | MosaicOp | null>(null);
  const dragRef = useRef<{ index: number; sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null);
  const historyRef = useRef<{ ops: EditorOp[]; filter: string }[]>([]);

  // ---- コントロール用 state ----
  const [, setVersion] = useState(0);
  const bump = useCallback(() => setVersion((v) => v + 1), []);
  const [tool, setTool] = useState<Tool>('none');
  const [panel, setPanel] = useState<Panel>('home');
  const [colorIdx, setColorIdx] = useState(0);
  const [brushIdx, setBrushIdx] = useState(1);
  const [boxSize, setBoxSize] = useState({ w: 0, h: 0 });
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState<{ open: boolean; value: string; editIndex: number }>({
    open: false,
    value: '',
    editIndex: -1,
  });

  const isWeb = Platform.OS === 'web';

  // ---- native 保険: フルエディタは web 専用 ----
  useEffect(() => {
    if (!isWeb) {
      resolvePhotoEditor(null);
      safeExit();
    }
  }, [isWeb, safeExit]);

  // ---- uri 無し → cancel ----
  useEffect(() => {
    if (isWeb && !sourceUri) {
      resolvePhotoEditor(null);
      safeExit();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceUri]);

  // ---- unmount safety ----
  useEffect(() => {
    return () => {
      resolvePhotoEditor(null);
    };
  }, []);

  // ---- 描画 ----
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    const sz = imgSizeRef.current;
    const box = boxRef.current;
    if (!canvas || !img || !sz || box.w <= 0 || box.h <= 0) return;
    const dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
    const bw = Math.round(box.w * dpr);
    const bh = Math.round(box.h * dpr);
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, box.w, box.h);
    const fit = containFit(box.w, box.h, sz.w, sz.h);
    const draft = draftRef.current;
    const opsToDraw = draft ? [...opsRef.current, draft] : opsRef.current;
    renderEditor(ctx, img, pixRef.current, opsToDraw, filterRef.current, fit);
    // 選択中の text/stamp に破線枠
    const sel = selectedRef.current;
    const selOp = sel >= 0 ? opsRef.current[sel] : null;
    if (selOp && (selOp.type === 'text' || selOp.type === 'stamp')) {
      const b = objBounds(selOp);
      const tl = imageToScreen(b.x, b.y, fit);
      ctx.save();
      ctx.strokeStyle = C.accent;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(tl.x - 4, tl.y - 4, b.w * fit.scale + 8, b.h * fit.scale + 8);
      ctx.restore();
    }
  }, []);

  // ---- 画像ロード (baseUri は crop で差し替えるので state) ----
  const [baseUri, setBaseUri] = useState('');
  useEffect(() => {
    if (sourceUri && !baseUri) setBaseUri(sourceUri);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceUri]);

  useEffect(() => {
    if (!isWeb || !baseUri) return;
    let alive = true;
    setReady(false);
    const img = new Image();
    if (!baseUri.startsWith('blob:') && !baseUri.startsWith('data:')) img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (!alive) return;
      const w = img.naturalWidth || img.width;
      const h = img.naturalHeight || img.height;
      if (!w || !h) {
        setLoadError(true);
        return;
      }
      imgRef.current = img;
      imgSizeRef.current = { w, h };
      try {
        pixRef.current = buildPixelated(img, w, h);
      } catch {
        pixRef.current = null;
      }
      setLoadError(false);
      setReady(true);
      requestAnimationFrame(() => draw());
    };
    img.onerror = () => {
      if (alive) setLoadError(true);
    };
    img.src = baseUri;
    return () => {
      alive = false;
    };
  }, [isWeb, baseUri, draw]);

  // box / ready 変化で再描画
  useEffect(() => {
    if (ready) draw();
  }, [ready, boxSize, draw]);

  // ---- history ----
  const snapshot = useCallback(() => {
    historyRef.current.push({ ops: cloneOps(opsRef.current), filter: filterRef.current });
    if (historyRef.current.length > 40) historyRef.current.shift();
  }, []);
  const undo = useCallback(() => {
    const prev = historyRef.current.pop();
    if (!prev) return;
    opsRef.current = prev.ops;
    filterRef.current = prev.filter;
    selectedRef.current = -1;
    setPanel('home');
    bump();
    draw();
  }, [bump, draw]);

  // ---- pointer ----
  const getImgPt = (e: { clientX: number; clientY: number }) => {
    const canvas = canvasRef.current;
    const sz = imgSizeRef.current;
    const box = boxRef.current;
    if (!canvas || !sz) return null;
    const rect = canvas.getBoundingClientRect();
    const fit = containFit(box.w, box.h, sz.w, sz.h);
    return screenToImage(e.clientX - rect.left, e.clientY - rect.top, fit);
  };
  const curScale = () => {
    const sz = imgSizeRef.current;
    const box = boxRef.current;
    if (!sz) return 1;
    return containFit(box.w, box.h, sz.w, sz.h).scale || 1;
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (busy) return;
    const pt = getImgPt(e);
    if (!pt) return;
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {
      /* noop */
    }
    if (tool === 'draw' || tool === 'mosaic') {
      const scale = curScale();
      if (tool === 'draw') {
        draftRef.current = {
          type: 'stroke',
          color: DRAW_COLORS[colorIdx] ?? '#FF3B30',
          width: BRUSH_SIZES[brushIdx]!.px / scale,
          points: [pt],
        };
      } else {
        draftRef.current = {
          type: 'mosaic',
          width: (BRUSH_SIZES[brushIdx]!.px * 1.6) / scale,
          points: [pt],
        };
      }
      draw();
      return;
    }
    // 選択 / ドラッグ
    const pad = 12 / curScale();
    const hit = hitTestObject(opsRef.current, pt.x, pt.y, pad);
    selectedRef.current = hit;
    if (hit >= 0) {
      const op = opsRef.current[hit] as TextObj | StampObj;
      // snapshot は「実際に動かした初回」に取る (タップ選択だけで履歴が積まれ、
      // 最初の取り消しが無反応になるのを防ぐ)。
      dragRef.current = { index: hit, sx: pt.x, sy: pt.y, ox: op.x, oy: op.y, moved: false };
      setPanel('object');
    }
    bump();
    draw();
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (draftRef.current) {
      const pt = getImgPt(e);
      if (pt) {
        const d = draftRef.current;
        const last = d.points[d.points.length - 1];
        if (last) {
          // 点を補間して隙間を無くす (速いスワイプでモザイク円が離れ、隠したはずの
          // 元画像が漏れるプライバシー欠陥を防ぐ。描画ストロークの途切れも防ぐ)。
          const dx = pt.x - last.x;
          const dy = pt.y - last.y;
          const dist = Math.hypot(dx, dy);
          const stepLen = Math.max(1, d.width * 0.4);
          if (dist > stepLen) {
            const n = Math.floor(dist / stepLen);
            for (let k = 1; k < n; k++) {
              d.points.push({ x: last.x + (dx * k) / n, y: last.y + (dy * k) / n });
            }
          }
        }
        d.points.push(pt);
        draw();
      }
      return;
    }
    const drag = dragRef.current;
    if (drag) {
      const pt = getImgPt(e);
      if (!pt) return;
      const op = opsRef.current[drag.index] as TextObj | StampObj | undefined;
      if (op) {
        if (!drag.moved) {
          snapshot(); // 実移動の初回だけ履歴を積む
          drag.moved = true;
        }
        op.x = drag.ox + (pt.x - drag.sx);
        op.y = drag.oy + (pt.y - drag.sy);
        draw();
      }
    }
  };

  const onPointerUp = () => {
    if (draftRef.current) {
      const d = draftRef.current;
      draftRef.current = null;
      if (d.points.length > 0) {
        snapshot();
        opsRef.current = [...opsRef.current, d];
        selectedRef.current = -1;
      }
      bump();
      draw();
      return;
    }
    if (dragRef.current) {
      dragRef.current = null;
      bump();
    }
  };

  // ---- ops 操作 ----
  const addObject = (op: TextObj | StampObj) => {
    snapshot();
    opsRef.current = [...opsRef.current, op];
    selectedRef.current = opsRef.current.length - 1;
    setPanel('object');
    bump();
    draw();
  };
  const deleteSelected = () => {
    const sel = selectedRef.current;
    if (sel < 0) return;
    snapshot();
    opsRef.current = opsRef.current.filter((_, i) => i !== sel);
    selectedRef.current = -1;
    setPanel('home');
    bump();
    draw();
  };
  const resizeSelected = (factor: number) => {
    const sel = selectedRef.current;
    const op = sel >= 0 ? opsRef.current[sel] : null;
    if (!op || (op.type !== 'text' && op.type !== 'stamp')) return;
    snapshot();
    op.size = Math.max(8, op.size * factor);
    bump();
    draw();
  };
  const setFilter = (id: string) => {
    snapshot();
    filterRef.current = id;
    bump();
    draw();
  };

  // ---- text 確定 ----
  const confirmText = () => {
    const value = text.value.trim();
    const sz = imgSizeRef.current;
    if (!value || !sz) {
      setText({ open: false, value: '', editIndex: -1 });
      return;
    }
    if (text.editIndex >= 0) {
      const op = opsRef.current[text.editIndex];
      if (op && op.type === 'text') {
        snapshot();
        op.text = value;
        bump();
        draw();
      }
    } else {
      addObject({
        type: 'text',
        text: value,
        color: DRAW_COLORS[colorIdx] ?? '#FFFFFF',
        x: sz.w / 2,
        y: sz.h / 2,
        size: Math.max(20, sz.w * 0.09),
      });
    }
    setText({ open: false, value: '', editIndex: -1 });
  };

  // ---- 切り抜き (クロッパー委譲。現状を flatten してから渡す) ----
  const doCrop = async () => {
    if (busy || !ready || !imgSizeRef.current) return;
    setBusy(true);
    try {
      const sz = imgSizeRef.current;
      const flattened = exportEditor(
        imgRef.current!,
        pixRef.current,
        opsRef.current,
        filterRef.current,
        sz.w,
        sz.h,
        0.92,
      );
      const cropped = await openCropper(flattened, { shape: 'rect', aspect: 'original', outMaxEdge: 1440, timeoutMs: 300_000 });
      if (cropped) {
        // 新ベースに差し替え、注釈はベースに焼き込み済みなのでリセット
        opsRef.current = [];
        filterRef.current = 'none';
        historyRef.current = [];
        selectedRef.current = -1;
        setPanel('home');
        setTool('none');
        setBaseUri(cropped);
        bump();
      }
    } catch (e) {
      console.warn('[photo-editor] crop failed:', e);
    } finally {
      setBusy(false);
    }
  };

  // ---- 完了 ----
  const done = () => {
    if (busy) return;
    const sz = imgSizeRef.current;
    if (!sz || !imgRef.current) {
      resolvePhotoEditor(null);
      safeExit();
      return;
    }
    // 無編集なら元 uri をそのまま返す (再エンコード回避)
    if (opsRef.current.length === 0 && filterRef.current === 'none' && baseUri === sourceUri) {
      resolvePhotoEditor(sourceUri);
      safeExit();
      return;
    }
    setBusy(true);
    try {
      const out = exportEditor(imgRef.current, pixRef.current, opsRef.current, filterRef.current, sz.w, sz.h, 0.9);
      resolvePhotoEditor(out);
      safeExit();
    } catch (e) {
      console.warn('[photo-editor] export failed:', e);
      resolvePhotoEditor(baseUri || sourceUri || null);
      safeExit();
    } finally {
      setBusy(false);
    }
  };

  const cancel = () => {
    resolvePhotoEditor(null);
    safeExit();
  };

  const selectTool = (t: Tool, p: Panel) => {
    setTool(t);
    setPanel(p);
    selectedRef.current = -1;
    bump();
    draw();
  };

  // ============================================================
  // render
  // ============================================================
  if (!isWeb) {
    return <View style={{ flex: 1, backgroundColor: '#000' }} />;
  }

  const selOp = selectedRef.current >= 0 ? opsRef.current[selectedRef.current] : null;

  const canvasEl = createElement('canvas', {
    ref: (el: HTMLCanvasElement | null) => {
      canvasRef.current = el;
    },
    style: {
      width: boxSize.w || 1,
      height: boxSize.h || 1,
      touchAction: 'none',
      userSelect: 'none',
      display: 'block',
    },
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel: onPointerUp,
  });

  return (
    <View style={{ flex: 1, backgroundColor: '#0a0a0a' }}>
      {/* 上バー */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingTop: insets.top + SP['2'],
          paddingBottom: SP['2'],
          paddingHorizontal: SP['4'],
        }}
      >
        <PressableScale onPress={cancel} disabled={busy} haptic="tap" hitSlop={12} accessibilityLabel="編集をやめる">
          <Icon.arrowL size={26} color="#fff" strokeWidth={2.2} />
        </PressableScale>
        <PressableScale
          onPress={undo}
          disabled={busy || historyRef.current.length === 0}
          haptic="tap"
          hitSlop={12}
          accessibilityLabel="取り消し"
          style={{ flexDirection: 'row', alignItems: 'center', gap: 6, opacity: historyRef.current.length === 0 ? 0.4 : 1 }}
        >
          <Undo2 size={20} color="#fff" strokeWidth={2.2} />
          <Text style={{ color: '#fff', fontSize: 14, fontWeight: '600' }}>取り消し</Text>
        </PressableScale>
        <PressableScale
          onPress={done}
          disabled={busy || !ready}
          haptic="confirm"
          hitSlop={12}
          accessibilityLabel="完了"
          style={{
            paddingHorizontal: SP['4'],
            paddingVertical: SP['2'],
            borderRadius: 20,
            backgroundColor: busy || !ready ? 'rgba(255,255,255,0.15)' : C.accent,
          }}
        >
          {busy ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={{ color: '#fff', fontSize: 15, fontWeight: '800' }}>完了</Text>
          )}
        </PressableScale>
      </View>

      {/* canvas エリア */}
      <View
        style={{ flex: 1, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}
        onLayout={(e) => {
          const { width, height } = e.nativeEvent.layout;
          boxRef.current = { w: width, h: height };
          setBoxSize({ w: width, h: height });
        }}
      >
        {loadError ? (
          <View style={{ padding: SP['6'], alignItems: 'center' }}>
            <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700', marginBottom: 6 }}>画像を表示できません</Text>
            <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 13, textAlign: 'center', lineHeight: 19 }}>
              HEIC や巨大な写真は一部ブラウザで開けない場合があります。別の写真でお試しください。
            </Text>
          </View>
        ) : !ready ? (
          <ActivityIndicator size="large" color="#fff" />
        ) : (
          canvasEl
        )}
      </View>

      {/* コンテキスト操作行 */}
      <ContextRow
        panel={panel}
        selOp={selOp}
        colorIdx={colorIdx}
        setColorIdx={(i) => {
          setColorIdx(i);
          // 選択中 text の色も変える
          const sel = selectedRef.current;
          const op = sel >= 0 ? opsRef.current[sel] : null;
          if (op && op.type === 'text') {
            snapshot();
            op.color = DRAW_COLORS[i] ?? op.color;
            draw();
          }
          bump();
        }}
        brushIdx={brushIdx}
        setBrushIdx={(i) => {
          setBrushIdx(i);
          bump();
        }}
        filterId={filterRef.current}
        onFilter={setFilter}
        onAddStamp={(emoji) => {
          const sz = imgSizeRef.current;
          if (!sz) return;
          addObject({ type: 'stamp', emoji, x: sz.w / 2, y: sz.h / 2, size: Math.max(40, sz.w * 0.2) });
        }}
        onResize={resizeSelected}
        onDelete={deleteSelected}
        onEditText={() => {
          const op = selOp;
          if (op && op.type === 'text') {
            setText({ open: true, value: op.text, editIndex: selectedRef.current });
          }
        }}
      />

      {/* メインツール行 */}
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-around',
          alignItems: 'center',
          paddingTop: SP['2'],
          paddingBottom: insets.bottom + SP['2'],
          paddingHorizontal: SP['2'],
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: 'rgba(255,255,255,0.15)',
          backgroundColor: '#141414',
        }}
      >
        <ToolButton icon={<Icon.sparkles size={22} color={panel === 'filter' ? C.accent : '#fff'} strokeWidth={2} />} label="フィルター" active={panel === 'filter'} onPress={() => selectTool('none', 'filter')} disabled={busy} />
        <ToolButton icon={<Icon.edit size={22} color={tool === 'draw' ? C.accent : '#fff'} strokeWidth={2} />} label="描く" active={tool === 'draw'} onPress={() => selectTool('draw', 'draw')} disabled={busy} />
        <ToolButton icon={<TypeIcon size={22} color="#fff" strokeWidth={2} />} label="文字" active={false} onPress={() => { setTool('none'); selectedRef.current = -1; setText({ open: true, value: '', editIndex: -1 }); }} disabled={busy} />
        <ToolButton icon={<Text style={{ fontSize: 20 }}>😀</Text>} label="スタンプ" active={panel === 'stamp'} onPress={() => selectTool('none', 'stamp')} disabled={busy} />
        <ToolButton icon={<LayoutGrid size={22} color={tool === 'mosaic' ? C.accent : '#fff'} strokeWidth={2} />} label="モザイク" active={tool === 'mosaic'} onPress={() => selectTool('mosaic', 'mosaic')} disabled={busy} />
        <ToolButton icon={<Crop size={22} color="#fff" strokeWidth={2} />} label="切り抜き" active={false} onPress={doCrop} disabled={busy} />
      </View>

      {/* テキスト入力モーダル */}
      {text.open && (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: SP['6'] }]}>
          <View style={{ width: '100%', maxWidth: 420, backgroundColor: C.bg2, borderRadius: R.xl, padding: SP['5'], gap: SP['4'] }}>
            <Text style={{ color: C.text, fontSize: 16, fontWeight: '700' }}>テキストを入力</Text>
            <TextInput
              value={text.value}
              onChangeText={(v) => setText((s) => ({ ...s, value: v }))}
              placeholder="入力してください"
              placeholderTextColor={C.text3}
              autoFocus
              maxLength={60}
              onSubmitEditing={confirmText}
              style={{ color: C.text, fontSize: 18, borderBottomWidth: 2, borderBottomColor: C.accent, paddingVertical: SP['2'] }}
            />
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: SP['3'] }}>
              <PressableScale onPress={() => setText({ open: false, value: '', editIndex: -1 })} haptic="tap" style={{ paddingHorizontal: SP['4'], paddingVertical: SP['2'] }}>
                <Text style={{ color: C.text3, fontSize: 15, fontWeight: '600' }}>キャンセル</Text>
              </PressableScale>
              <PressableScale onPress={confirmText} haptic="confirm" style={{ paddingHorizontal: SP['5'], paddingVertical: SP['2'], borderRadius: 20, backgroundColor: C.accent }}>
                <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>OK</Text>
              </PressableScale>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}

// ============================================================
// ToolButton
// ============================================================
function ToolButton({
  icon,
  label,
  active,
  onPress,
  disabled,
}: {
  icon: JSX.Element;
  label: string;
  active: boolean;
  onPress: () => void;
  disabled?: boolean;
}): JSX.Element {
  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      haptic="tap"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      style={{ alignItems: 'center', justifyContent: 'center', gap: 3, paddingHorizontal: SP['1'], minWidth: 52, opacity: disabled ? 0.5 : 1 }}
    >
      {icon}
      <Text style={{ color: active ? C.accent : '#fff', fontSize: 11, fontWeight: active ? '800' : '600' }}>{label}</Text>
    </PressableScale>
  );
}

// ============================================================
// ContextRow — パネル別の操作 (フィルター/描く/モザイク/スタンプ/選択オブジェクト)
// ============================================================
function ContextRow({
  panel,
  selOp,
  colorIdx,
  setColorIdx,
  brushIdx,
  setBrushIdx,
  filterId,
  onFilter,
  onAddStamp,
  onResize,
  onDelete,
  onEditText,
}: {
  panel: Panel;
  selOp: EditorOp | null | undefined;
  colorIdx: number;
  setColorIdx: (i: number) => void;
  brushIdx: number;
  setBrushIdx: (i: number) => void;
  filterId: string;
  onFilter: (id: string) => void;
  onAddStamp: (emoji: string) => void;
  onResize: (factor: number) => void;
  onDelete: () => void;
  onEditText: () => void;
}): JSX.Element | null {
  const rowStyle = { paddingVertical: SP['2'], paddingHorizontal: SP['3'], backgroundColor: '#1c1c1c' } as const;

  // 選択オブジェクトの操作を最優先
  if (selOp && (selOp.type === 'text' || selOp.type === 'stamp')) {
    return (
      <View style={[rowStyle, { flexDirection: 'row', alignItems: 'center', gap: SP['2'] }]}>
        <CircleBtn label="−" onPress={() => onResize(1 / 1.18)} />
        <CircleBtn label="＋" onPress={() => onResize(1.18)} />
        {selOp.type === 'text' && (
          <PressableScale onPress={onEditText} haptic="tap" style={pillStyle}>
            <Text style={pillText}>文字を編集</Text>
          </PressableScale>
        )}
        {selOp.type === 'text' && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: SP['2'], alignItems: 'center', paddingHorizontal: SP['1'] }}>
            {DRAW_COLORS.map((c, i) => (
              <ColorDot key={c} color={c} active={i === colorIdx} onPress={() => setColorIdx(i)} />
            ))}
          </ScrollView>
        )}
        <View style={{ flex: 1 }} />
        <PressableScale onPress={onDelete} haptic="warn" style={[pillStyle, { backgroundColor: 'rgba(255,59,48,0.18)' }]}>
          <Text style={[pillText, { color: '#FF6B6B' }]}>削除</Text>
        </PressableScale>
      </View>
    );
  }

  if (panel === 'filter') {
    return (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={rowStyle} contentContainerStyle={{ gap: SP['2'], alignItems: 'center' }}>
        {FILTERS.map((f) => {
          const active = f.id === filterId;
          return (
            <PressableScale key={f.id} onPress={() => onFilter(f.id)} haptic="tap" style={[pillStyle, active && { backgroundColor: C.accent }]}>
              <Text style={[pillText, active && { color: '#fff', fontWeight: '800' }]}>{f.label}</Text>
            </PressableScale>
          );
        })}
      </ScrollView>
    );
  }

  if (panel === 'draw') {
    return (
      <View style={[rowStyle, { flexDirection: 'row', alignItems: 'center', gap: SP['2'] }]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: SP['2'], alignItems: 'center', paddingRight: SP['2'] }}>
          {DRAW_COLORS.map((c, i) => (
            <ColorDot key={c} color={c} active={i === colorIdx} onPress={() => setColorIdx(i)} />
          ))}
        </ScrollView>
        <View style={{ flexDirection: 'row', gap: SP['1'] }}>
          {BRUSH_SIZES.map((b, i) => (
            <PressableScale key={b.label} onPress={() => setBrushIdx(i)} haptic="tap" style={[pillStyle, i === brushIdx && { backgroundColor: C.accent }]}>
              <Text style={[pillText, i === brushIdx && { color: '#fff', fontWeight: '800' }]}>{b.label}</Text>
            </PressableScale>
          ))}
        </View>
      </View>
    );
  }

  if (panel === 'mosaic') {
    return (
      <View style={[rowStyle, { flexDirection: 'row', alignItems: 'center', gap: SP['2'] }]}>
        <Text style={{ color: C.text3, fontSize: 12, marginRight: SP['1'] }}>太さ</Text>
        {BRUSH_SIZES.map((b, i) => (
          <PressableScale key={b.label} onPress={() => setBrushIdx(i)} haptic="tap" style={[pillStyle, i === brushIdx && { backgroundColor: C.accent }]}>
            <Text style={[pillText, i === brushIdx && { color: '#fff', fontWeight: '800' }]}>{b.label}</Text>
          </PressableScale>
        ))}
        <Text style={{ color: C.text3, fontSize: 11, marginLeft: SP['2'], flex: 1 }}>なぞって隠す</Text>
      </View>
    );
  }

  if (panel === 'stamp') {
    return (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={rowStyle} contentContainerStyle={{ gap: SP['1'], alignItems: 'center' }}>
        {STAMP_EMOJIS.map((emoji) => (
          <PressableScale key={emoji} onPress={() => onAddStamp(emoji)} haptic="tap" style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: 26 }}>{emoji}</Text>
          </PressableScale>
        ))}
      </ScrollView>
    );
  }

  // home: ヒント
  return (
    <View style={rowStyle}>
      <Text style={{ color: C.text3, fontSize: 12, textAlign: 'center' }}>下のツールで編集 → 「完了」で投稿に反映</Text>
    </View>
  );
}

const pillStyle = {
  paddingHorizontal: SP['3'],
  paddingVertical: SP['1'],
  borderRadius: 16,
  backgroundColor: 'rgba(255,255,255,0.12)',
} as const;
const pillText = { color: '#fff', fontSize: 13, fontWeight: '600' } as const;

function CircleBtn({ label, onPress }: { label: string; onPress: () => void }): JSX.Element {
  return (
    <PressableScale onPress={onPress} haptic="tap" style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: '#fff', fontSize: 20, fontWeight: '700', lineHeight: 22 }}>{label}</Text>
    </PressableScale>
  );
}

function ColorDot({ color, active, onPress }: { color: string; active: boolean; onPress: () => void }): JSX.Element {
  return (
    <PressableScale
      onPress={onPress}
      haptic="tap"
      accessibilityLabel={`色 ${color}`}
      style={{
        width: 28,
        height: 28,
        borderRadius: 14,
        backgroundColor: color,
        borderWidth: active ? 3 : 1,
        borderColor: active ? C.accent : 'rgba(255,255,255,0.5)',
      }}
    />
  );
}
