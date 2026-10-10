import { createContext, useContext, useEffect } from 'react';

/** AppShell 提供：页面设置自己的动态标题（顶栏面包屑末项），null 恢复默认 */
export const PageTitleContext = createContext<(title: string | null) => void>(() => {});

/**
 * 详情页在数据加载后设置顶栏面包屑的末项（如词汇本名称）；离开页面时自动恢复默认。
 * 父级面包屑由路由表 TOP_LEVEL_OF 自动推出，页面不用管。
 */
export function usePageTitle(title: string | null | undefined): void {
  const setTitle = useContext(PageTitleContext);
  useEffect(() => {
    setTitle(title || null);
    return () => setTitle(null);
  }, [title, setTitle]);
}
