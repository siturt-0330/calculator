// ============================================================
// Icon registry — only icons actually rendered somewhere.
// ============================================================
// lucide-react-native の tree-shaking 効きを最大化するため、
// 名前付き import で「実際に使う」アイコンだけを並べる。
// 未使用エントリは bundle に乗らないようにここから除外する。
// (棚卸し: Icon.foo の grep 結果 vs このマップで突き合わせ)
// ============================================================
import {
  Home, Compass, Plus, MessageSquare, User,
  Bell, SlidersHorizontal, Search,
  Heart, MessageCircle, Bookmark, Share2, MoreHorizontal,
  Calendar, MapPin, ShoppingBag, Users,
  Ban, Lock, Shield, AlertTriangle, CheckCircle2, XCircle,
  ChevronLeft, ChevronRight, ChevronDown, ChevronUp,
  X, Check,
  Camera, Image as ImageIcon,
  Sparkles, Award, Flag, Trophy,
  Settings, LogOut, HelpCircle, Info,
  ArrowLeft, ArrowUpLeft,
  Eye, EyeOff, Edit3, Trash2,
  Send, Hash, AtSign, Phone, Clock,
  Users2, Globe2,
  Gamepad2,
  Copy,
  Moon, Sun, Palette,
  Play, Pause, TrendingUp,
  RefreshCw,
  Volume2, VolumeX,
  Instagram, Facebook,
  MessageSquareQuote,
} from 'lucide-react-native';

/**
 * lucide strokeWidth の標準 5 段。
 * SF Symbols weight との対応: regular↔2.0 / medium↔2.4 / bold↔2.8
 * (Obsidian: Apple SF Symbols とアイコン設計)
 */
export const STROKE = {
  light: 1.8,
  regular: 2,
  medium: 2.4,
  semibold: 2.6,
  bold: 2.8,
} as const;

export const Icon = {
  home: Home, corners: Compass, post: Plus, bbs: MessageSquare, mypage: User,
  bell: Bell, filter: SlidersHorizontal, search: Search,
  heart: Heart, comment: MessageCircle, save: Bookmark, share: Share2, more: MoreHorizontal,
  calendar: Calendar, map: MapPin, goods: ShoppingBag, friends: Users,
  block: Ban, lock: Lock, shield: Shield, warn: AlertTriangle, check: CheckCircle2, fail: XCircle,
  chevronL: ChevronLeft, chevronR: ChevronRight, chevronD: ChevronDown, chevronU: ChevronUp,
  close: X, ok: Check, plus: Plus,
  camera: Camera, image: ImageIcon,
  sparkles: Sparkles, award: Award, flag: Flag, trophy: Trophy,
  settings: Settings, logout: LogOut, help: HelpCircle, info: Info,
  arrowL: ArrowLeft, arrowUL: ArrowUpLeft,
  eye: Eye, eyeOff: EyeOff, edit: Edit3, trash: Trash2, copy: Copy,
  send: Send, hash: Hash, at: AtSign, phone: Phone, clock: Clock,
  community: Users2, globe: Globe2,
  moon: Moon, sun: Sun, palette: Palette,
  play: Play, pause: Pause, trendingUp: TrendingUp, refresh: RefreshCw,
  volume: Volume2, volumeMute: VolumeX,
  instagram: Instagram, facebook: Facebook,
  // TabIcon.tsx の TabKey 'game' から参照されている (dead route だが型に存在)
  game: Gamepad2,
  quote: MessageSquareQuote,
} as const;

export type IconName = keyof typeof Icon;
