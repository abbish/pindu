import React from 'react';
import {
  Apple,
  Book,
  BookOpen,
  Bookmark,
  Briefcase,
  Cpu,
  FlaskConical,
  Globe,
  GraduationCap,
  Heart,
  House,
  Landmark,
  Languages,
  Leaf,
  Lightbulb,
  Mic,
  Music,
  Palette,
  PawPrint,
  Plane,
  Rocket,
  Star,
  Stethoscope,
  Trophy,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * 单词本可选图标：值为数据库 word_books.icon 中保存的名称。
 * 前 6 个沿用旧版名称（bookmark / book / graduation-cap / globe / star / heart），保持已有数据可用。
 */
export const WORD_BOOK_ICONS: { value: string; label: string; icon: LucideIcon }[] = [
  { value: 'bookmark', label: '书签', icon: Bookmark },
  { value: 'book', label: '书本', icon: Book },
  { value: 'book-open', label: '打开的书', icon: BookOpen },
  { value: 'graduation-cap', label: '学士帽', icon: GraduationCap },
  { value: 'languages', label: '语言', icon: Languages },
  { value: 'mic', label: '演讲', icon: Mic },
  { value: 'lightbulb', label: '灵感', icon: Lightbulb },
  { value: 'trophy', label: '考试', icon: Trophy },
  { value: 'briefcase', label: '工作', icon: Briefcase },
  { value: 'cpu', label: '科技', icon: Cpu },
  { value: 'flask', label: '科学', icon: FlaskConical },
  { value: 'rocket', label: '探索', icon: Rocket },
  { value: 'globe', label: '地球', icon: Globe },
  { value: 'plane', label: '旅行', icon: Plane },
  { value: 'landmark', label: '历史', icon: Landmark },
  { value: 'house', label: '日常', icon: House },
  { value: 'leaf', label: '自然', icon: Leaf },
  { value: 'paw', label: '动物', icon: PawPrint },
  { value: 'apple', label: '食物', icon: Apple },
  { value: 'stethoscope', label: '健康', icon: Stethoscope },
  { value: 'music', label: '音乐', icon: Music },
  { value: 'palette', label: '艺术', icon: Palette },
  { value: 'star', label: '星星', icon: Star },
  { value: 'heart', label: '爱心', icon: Heart },
];

/** 可选的图标颜色（数据库 word_books.icon_color 的值）；色值是 app.css 中的 --book-* token，随主题切换 */
export const WORD_BOOK_COLORS: { value: string; label: string; swatch: string }[] = [
  { value: 'teal', label: '青绿', swatch: 'bg-book-teal' },
  { value: 'blue', label: '蓝', swatch: 'bg-book-blue' },
  { value: 'indigo', label: '靛蓝', swatch: 'bg-book-indigo' },
  { value: 'purple', label: '紫', swatch: 'bg-book-purple' },
  { value: 'pink', label: '粉', swatch: 'bg-book-pink' },
  { value: 'red', label: '红', swatch: 'bg-book-red' },
  { value: 'orange', label: '橙', swatch: 'bg-book-orange' },
  { value: 'amber', label: '琥珀', swatch: 'bg-book-amber' },
  { value: 'green', label: '绿', swatch: 'bg-book-green' },
  { value: 'slate', label: '石板灰', swatch: 'bg-book-slate' },
];

/** 图标颜色 → 样式（类名写全，便于 Tailwind 扫描）；旧值 primary / yellow 映射到 teal / amber */
const COLOR_CLASS: Record<string, string> = {
  teal: 'bg-book-teal/15 text-book-teal',
  primary: 'bg-book-teal/15 text-book-teal',
  blue: 'bg-book-blue/15 text-book-blue',
  indigo: 'bg-book-indigo/15 text-book-indigo',
  purple: 'bg-book-purple/15 text-book-purple',
  pink: 'bg-book-pink/15 text-book-pink',
  red: 'bg-book-red/15 text-book-red',
  orange: 'bg-book-orange/15 text-book-orange',
  amber: 'bg-book-amber/15 text-book-amber',
  yellow: 'bg-book-amber/15 text-book-amber',
  green: 'bg-book-green/15 text-book-green',
  slate: 'bg-book-slate/15 text-book-slate',
};

/** 把存储值规整成当前可选项（旧值 primary → teal，yellow → amber，未知 → teal） */
export const normalizeBookColor = (color?: string | null): string => {
  if (color === 'primary' || !color) return 'teal';
  if (color === 'yellow') return 'amber';
  return WORD_BOOK_COLORS.some((c) => c.value === color) ? color : 'teal';
};

export interface WordBookIconProps {
  /** 图标名称（WORD_BOOK_ICONS 的 value），未知时用打开的书 */
  icon?: string | null;
  /** 颜色名称（icon_color） */
  color?: string | null;
  /** 方块尺寸等样式 */
  className?: string;
}

/** 单词本图标方块 */
export const WordBookIcon: React.FC<WordBookIconProps> = ({ icon, color, className }) => {
  const Icon = WORD_BOOK_ICONS.find((i) => i.value === icon)?.icon ?? BookOpen;
  return (
    <div className={cn('flex size-9 shrink-0 items-center justify-center rounded-lg', COLOR_CLASS[normalizeBookColor(color)], className)}>
      <Icon className="size-[18px]" />
    </div>
  );
};
