import {
  Home, Compass, Plus, MessageSquare, User,
  Bell, SlidersHorizontal, Search,
  Heart, MessageCircle, Bookmark, Share2, MoreHorizontal,
  Calendar, MapPin, ShoppingBag, Users,
  Ban, Lock, Shield, AlertTriangle, CheckCircle2, XCircle,
  ChevronLeft, ChevronRight, ChevronDown, ChevronUp,
  X, Check, Minus,
  Camera, Image as ImageIcon, Video, Mic,
  Sparkles, TrendingUp, Award, Flag,
  Settings, LogOut, HelpCircle, Info,
  ArrowLeft, ArrowRight, ArrowUp, ArrowDown, ArrowUpLeft,
  Eye, EyeOff, Edit3, Trash2, Copy,
  Send, Smile, Hash, AtSign, Phone, Gamepad2, Swords, Clock,
  Users2, Globe2, UserPlus,
} from 'lucide-react-native';

export const Icon = {
  home: Home, corners: Compass, post: Plus, bbs: MessageSquare, mypage: User,
  bell: Bell, filter: SlidersHorizontal, search: Search,
  heart: Heart, comment: MessageCircle, save: Bookmark, share: Share2, more: MoreHorizontal,
  calendar: Calendar, map: MapPin, goods: ShoppingBag, friends: Users,
  block: Ban, lock: Lock, shield: Shield, warn: AlertTriangle, check: CheckCircle2, fail: XCircle,
  chevronL: ChevronLeft, chevronR: ChevronRight, chevronD: ChevronDown, chevronU: ChevronUp,
  close: X, ok: Check, plus: Plus, minus: Minus,
  camera: Camera, image: ImageIcon, video: Video, mic: Mic,
  sparkles: Sparkles, trending: TrendingUp, award: Award, flag: Flag,
  settings: Settings, logout: LogOut, help: HelpCircle, info: Info,
  arrowL: ArrowLeft, arrowR: ArrowRight, arrowU: ArrowUp, arrowD: ArrowDown, arrowUL: ArrowUpLeft,
  eye: Eye, eyeOff: EyeOff, edit: Edit3, trash: Trash2, copy: Copy,
  send: Send, emoji: Smile, hash: Hash, at: AtSign, phone: Phone,
  game: Gamepad2, swords: Swords, clock: Clock,
  community: Users2, globe: Globe2, userPlus: UserPlus,
} as const;

export type IconName = keyof typeof Icon;
