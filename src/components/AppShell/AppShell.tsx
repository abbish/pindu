import React, { useCallback, useRef, useState } from 'react';
import { BookOpen, CalendarDays, FileText, Home, ListChecks, Moon, Settings, Sun } from 'lucide-react';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { Separator } from '@/components/ui/separator';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { PageTitleContext } from './pageTitle';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useTheme } from '@/hooks/useTheme';
import { PAGE_TITLE, TOP_LEVEL_OF, type NavigateFn, type PageKey, type TopLevelPage } from '@/navigation';
import { JobIndicator } from '@/components/Jobs';
import { UpdateBanner } from '../UpdateBanner';

export interface AppShellProps {
  /** 当前页面键（决定侧边栏高亮与顶栏标题） */
  page: PageKey;
  /** 页面跳转 */
  onNavigate: NavigateFn;
  /**
   * 从别处进入时的上级路径（替代默认的「一级页面 ›」），如从计划打开短文：
   * 侧边栏高亮 section，面包屑为 section › trail… › 当前标题
   */
  parent?: { section: TopLevelPage; trail: { label: string; onClick: () => void }[] };
  /** 页面内容（外壳只负责框架，内容区是唯一滚动区域） */
  children: React.ReactNode;
}

type NavItem = { key: TopLevelPage; label: string; icon: React.ComponentType };

/** 侧边栏分组：一级功能（无标题）+ 素材库（单词本、短文） */
const NAV_GROUPS: { label?: string; items: NavItem[] }[] = [
  {
    items: [
      { key: 'home', label: '首页', icon: Home },
      { key: 'plans', label: '计划', icon: ListChecks },
      { key: 'calendar', label: '日历', icon: CalendarDays },
    ],
  },
  {
    label: '素材库',
    items: [
      { key: 'wordbooks', label: '单词本', icon: BookOpen },
      { key: 'passages', label: '短文库', icon: FileText },
    ],
  },
];

const SIDEBAR_OPEN_KEY = 'sidebar-open';

function readSidebarOpen(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_OPEN_KEY) !== 'false';
  } catch {
    return true;
  }
}

/**
 * 桌面应用外壳：可折叠侧边栏（shadcn Sidebar，⌘/Ctrl+B）+ 顶栏 + 内容区。
 * 外壳铺满窗口，只有内容区滚动；侧栏折叠状态重启后保持。
 * 主题切换与设置放在侧栏底部；系统日志在「设置 → 通用」里。
 */
export const AppShell: React.FC<AppShellProps> = ({ page, onNavigate, parent, children }) => {
  const [open, setOpen] = useState(readSidebarOpen);
  const { theme, toggleTheme } = useTheme();
  const active = parent?.section ?? TOP_LEVEL_OF[page];

  // 页面经 usePageTitle 提供的动态标题；按页面键记录，换页后旧标题自动失效
  const pageRef = useRef(page);
  pageRef.current = page;
  const [dynamicTitle, setDynamicTitle] = useState<{ page: PageKey; title: string } | null>(null);
  const setPageTitle = useCallback((t: string | null) => {
    setDynamicTitle(t ? { page: pageRef.current, title: t } : null);
  }, []);
  const currentTitle = (dynamicTitle?.page === page ? dynamicTitle.title : null) ?? PAGE_TITLE[page];
  const isSubPage = active !== page;

  const handleOpenChange = (value: boolean) => {
    setOpen(value);
    try {
      localStorage.setItem(SIDEBAR_OPEN_KEY, String(value));
    } catch {
      // 存储不可用时只影响下次启动的折叠状态
    }
  };

  return (
    <TooltipProvider delayDuration={300}>
      <SidebarProvider open={open} onOpenChange={handleOpenChange} className="h-svh overflow-hidden">
        <Sidebar collapsible="icon" className="select-none">
          <SidebarHeader>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton size="lg" tooltip="拼读 Pindu.app" onClick={() => onNavigate('home')}>
                  {/* 品牌标记：沿用图标的主色方块 + 「拼」字（完整图标带文字，缩小后与侧边栏不协调） */}
                  <span
                    aria-hidden
                    className="flex aspect-square size-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-base leading-none font-bold text-sidebar-primary-foreground"
                  >
                    拼
                  </span>
                  <span className="flex min-w-0 flex-1 items-baseline gap-1.5 truncate">
                    <span className="text-base font-semibold">拼读</span>
                    <span className="text-sm text-muted-foreground">Pindu.app</span>
                  </span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarHeader>

          <SidebarContent>
            {NAV_GROUPS.map((group, i) => (
              <SidebarGroup key={group.label ?? i}>
                {group.label && <SidebarGroupLabel>{group.label}</SidebarGroupLabel>}
                <SidebarGroupContent>
                  <SidebarMenu>
                    {group.items.map(({ key, label, icon: Icon }) => (
                      <SidebarMenuItem key={key}>
                        <SidebarMenuButton isActive={active === key} tooltip={label} onClick={() => onNavigate(key)}>
                          <Icon />
                          <span>{label}</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            ))}
          </SidebarContent>

          <SidebarFooter>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton tooltip={theme === 'dark' ? '浅色模式' : '深色模式'} onClick={toggleTheme}>
                  {theme === 'dark' ? <Sun /> : <Moon />}
                  <span>{theme === 'dark' ? '浅色模式' : '深色模式'}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton isActive={active === 'settings'} tooltip="设置" onClick={() => onNavigate('settings')}>
                  <Settings />
                  <span>设置</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarFooter>
        </Sidebar>

        <SidebarInset className="min-h-0 overflow-hidden">
          <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3 select-none">
            <SidebarTrigger aria-label="折叠侧边栏" />
            <Separator orientation="vertical" className="mr-1 data-[orientation=vertical]:h-4" />
            <Breadcrumb>
              <BreadcrumbList>
                {isSubPage && (
                  <>
                    <BreadcrumbItem>
                      <BreadcrumbLink asChild>
                        <button type="button" onClick={() => onNavigate(active)}>
                          {PAGE_TITLE[active]}
                        </button>
                      </BreadcrumbLink>
                    </BreadcrumbItem>
                    <BreadcrumbSeparator />
                  </>
                )}
                {parent?.trail.map((item, i) => (
                  <React.Fragment key={i}>
                    <BreadcrumbItem>
                      <BreadcrumbLink asChild>
                        <button type="button" className="max-w-60 truncate" onClick={item.onClick}>
                          {item.label}
                        </button>
                      </BreadcrumbLink>
                    </BreadcrumbItem>
                    <BreadcrumbSeparator />
                  </React.Fragment>
                ))}
                <BreadcrumbItem>
                  <BreadcrumbPage className="max-w-96 truncate font-medium">{currentTitle}</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
            <div className="ml-auto">
              <JobIndicator onNavigate={onNavigate} />
            </div>
          </header>
          <UpdateBanner />
          <div className="min-h-0 flex-1 overflow-y-auto">
            <PageTitleContext.Provider value={setPageTitle}>{children}</PageTitleContext.Provider>
          </div>
        </SidebarInset>
      </SidebarProvider>

    </TooltipProvider>
  );
};
