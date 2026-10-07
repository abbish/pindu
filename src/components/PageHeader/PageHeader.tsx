import React from 'react';

export interface PageHeaderProps {
  /** 页面标题 */
  title: React.ReactNode;
  /** 一句说明 */
  description?: React.ReactNode;
  /** 右侧操作（每屏只有一个主按钮） */
  actions?: React.ReactNode;
}

/** 页头：标题 + 说明 + 右侧操作（page-layout-standard.md） */
export const PageHeader: React.FC<PageHeaderProps> = ({ title, description, actions }) => (
  <div className="flex flex-wrap items-end justify-between gap-4">
    <div className="min-w-0">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
    </div>
    {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
  </div>
);
