import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

/*
 * 桌面应用设置页的通用骨架（macOS 系统设置 / Claude 桌面版的模式）：
 * 面板标题 → 若干分组（组标题 + 圆角卡片）→ 卡片里是一行行设置（左：名称 + 说明，右：控件）。
 */

export interface SettingsPanelProps {
  /** 面板标题（与左侧导航项同名） */
  title: React.ReactNode;
  /** 标题下的一句说明 */
  description?: React.ReactNode;
  /** 返回上一级（下钻页使用，如「AI 模型 › 某提供商」） */
  back?: { label: string; onClick: () => void };
  /** 标题右侧附加内容（如状态徽章） */
  aside?: React.ReactNode;
  children: React.ReactNode;
}

/** 一个设置面板（右侧内容区） */
export const SettingsPanel: React.FC<SettingsPanelProps> = ({ title, description, back, aside, children }) => (
  <div className="flex flex-col gap-8">
    <header className="space-y-1">
      {back && (
        <button
          type="button"
          onClick={back.onClick}
          className="-ml-1 mb-1 inline-flex items-center gap-0.5 rounded-md px-1 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <ChevronLeft className="size-4" />
          {back.label}
        </button>
      )}
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {aside}
      </div>
      {description && <p className="text-sm text-muted-foreground">{description}</p>}
    </header>
    {children}
  </div>
);

export interface SettingsSectionProps {
  /** 分组标题 */
  title?: React.ReactNode;
  /** 分组说明 */
  description?: React.ReactNode;
  /** 分组标题右侧的操作（如搜索、添加） */
  actions?: React.ReactNode;
  /** 危险操作组：卡片描红 */
  tone?: 'default' | 'danger';
  className?: string;
  children: React.ReactNode;
}

/** 设置分组：组标题 + 卡片（卡片内的行自动分隔） */
export const SettingsSection: React.FC<SettingsSectionProps> = ({ title, description, actions, tone = 'default', className, children }) => (
  <section className={cn('flex flex-col gap-3', className)}>
    {(title || actions) && (
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          {title && <h2 className={cn('text-[15px] font-semibold', tone === 'danger' && 'text-destructive')}>{title}</h2>}
          {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
    )}
    <div className={cn('divide-y rounded-xl border bg-card text-card-foreground', tone === 'danger' && 'border-destructive/40')}>{children}</div>
  </section>
);

export interface SettingsRowProps {
  /** 设置项名称 */
  label: React.ReactNode;
  /** 说明（灰字，可多行） */
  description?: React.ReactNode;
  /** 右侧控件 */
  children?: React.ReactNode;
  /** 名称关联的控件 id（点击名称聚焦控件） */
  htmlFor?: string;
  /** 整行可点击（下钻），右侧显示箭头 */
  onClick?: () => void;
  /** 名称左侧的图标 */
  icon?: React.ReactNode;
  /** 控件放到说明下方（宽控件：输入框组、长列表） */
  stacked?: boolean;
  /** 两栏表单：左栏固定宽度放名称与说明，右栏放控件（靠右对齐；输入框等 w-full 控件占满右栏），整页宽的表单用 */
  columns?: boolean;
  className?: string;
}

/** 一行设置：左侧名称与说明，右侧控件；onClick 时整行是下钻按钮 */
export const SettingsRow: React.FC<SettingsRowProps> = ({ label, description, children, htmlFor, onClick, icon, stacked, columns, className }) => {
  const text = (
    <div className="min-w-0 flex-1">
      {htmlFor ? (
        <label htmlFor={htmlFor} className="text-sm font-medium">
          {label}
        </label>
      ) : (
        <div className="text-sm font-medium">{label}</div>
      )}
      {description && <div className="mt-0.5 text-[13px] leading-5 text-muted-foreground">{description}</div>}
    </div>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(
          'flex w-full items-center gap-3 px-4 py-3 text-left outline-none transition-colors first:rounded-t-xl last:rounded-b-xl hover:bg-muted/50 focus-visible:bg-muted/60',
          className
        )}
      >
        {icon}
        {text}
        {children}
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
      </button>
    );
  }

  if (columns) {
    return (
      <div className={cn('grid grid-cols-[13rem_minmax(0,1fr)] items-start gap-6 px-4 py-4', className)}>
        <div className="flex min-w-0 items-start gap-3 pt-1.5">
          {icon}
          {text}
        </div>
        {children && <div className="flex min-w-0 flex-col items-end gap-2 text-right">{children}</div>}
      </div>
    );
  }

  return (
    <div className={cn('flex gap-3 px-4 py-3', stacked ? 'flex-col' : 'items-center', className)}>
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {icon}
        {text}
      </div>
      {children && <div className={cn('flex items-center gap-2', !stacked && 'shrink-0')}>{children}</div>}
    </div>
  );
};
