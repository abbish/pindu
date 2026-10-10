import { useState, useCallback, useEffect } from 'react';
import { ErrorBoundary, ToastProvider } from './components';
import { AppShell } from './components/AppShell/AppShell';
import { DevTools } from './components/DevTools';
import { JobCenter } from './components/Jobs';
import { StartupGate } from './components/StartupGate';
import { UpdateWatcher } from './components/UpdateBanner';
import { HomePage } from './pages/HomePage';
import { StudyPlansPage } from './pages/StudyPlansPage';
import { CreatePlanPage } from './pages/CreatePlanPage';
import { PlanDetailPage } from './pages/PlanDetailPage';
import { WordBookPage } from './pages/WordBookPage';
import { WordBookDetailPage } from './pages/WordBookDetailPage';
import { WordPracticePage } from './pages/WordPracticePage';
import { PracticeResultPage } from './pages/PracticeResultPage';
import { CalendarPage } from './pages/CalendarPage';
import { SettingsPage } from './pages/SettingsPage';
import { PassagePracticePage } from './pages/PassagePracticePage';
import { PassageLibraryPage } from './pages/PassageLibraryPage';
import { CreatePassagePage } from './pages/CreatePassagePage';
import { ImportPassagePage } from './pages/ImportPassagePage';
import { PassageDetailPage } from './pages/PassageDetailPage';
import { VideoLibraryPage } from './pages/VideoLibraryPage';
import { TagPage } from './pages/TagPage';
import { VideoEditorPage } from './pages/video-editor/VideoEditorPage';
import { FOCUS_PAGES, type NavigateFn, type PageKey, type Route, type RouteParams } from './navigation';
import { pushRoute, startHistory, stepRoute, stepTarget, type RouteHistory } from './utils/routeHistory';

/** 前进 / 后退时跳过的页面：整窗练习、剪辑编辑器、练习结果都有自己的进出流程 */
const skipInHistory = (r: Route) => FOCUS_PAGES.has(r.page) || r.page === 'practice-result';

function App() {
  /** 浏览历史（前进 / 后退）；当前页面是 entries[index] */
  const [history, setHistory] = useState<RouteHistory<Route>>(() => startHistory<Route>({ page: 'home' }));
  const route = history.entries[history.index];

  const navigate = useCallback((page: PageKey, params?: RouteParams[PageKey]) => {
    // page 与 params 的配对由 NavigateFn 在调用处保证
    setHistory((h) => pushRoute(h, { page, params } as Route));
  }, []) as NavigateFn;
  const canBack = stepTarget(history, -1, skipInHistory) !== null;
  const canForward = stepTarget(history, 1, skipInHistory) !== null;
  const back = useCallback(() => setHistory((h) => stepRoute(h, -1, skipInHistory)), []);
  const forward = useCallback(() => setHistory((h) => stepRoute(h, 1, skipInHistory)), []);

  // ⌘[ / ⌘] 与鼠标侧键：后退 / 前进（整窗页面里不响应，它们有自己的退出流程）
  const inFocusPage = FOCUS_PAGES.has(route.page);
  useEffect(() => {
    if (inFocusPage) return;
    // 弹窗打开、正在输入时不响应：跳走会丢掉没保存的内容
    const blocked = (target: EventTarget | null) =>
      Boolean(document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]')) ||
      (target instanceof HTMLElement && Boolean(target.closest('input, textarea, select, [contenteditable="true"]')));
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey || e.repeat || blocked(e.target)) return;
      if (e.key === '[') back();
      else if (e.key === ']') forward();
      else return;
      e.preventDefault();
    };
    const onMouse = (e: MouseEvent) => {
      if (blocked(null)) return;
      if (e.button === 3) back();
      else if (e.button === 4) forward();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mouseup', onMouse);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mouseup', onMouse);
    };
  }, [inFocusPage, back, forward]);

  const renderPage = () => {
    switch (route.page) {
      case 'home':
        return <HomePage onNavigate={navigate} />;
      case 'plans':
        return <StudyPlansPage onNavigate={navigate} />;
      case 'create-plan':
        return <CreatePlanPage onNavigate={navigate} />;
      case 'plan-detail':
        // 缺少 planId 时回到计划列表（此前会静默打开 id=1 的计划）
        return route.params
          ? <PlanDetailPage key={route.params.planId} planId={route.params.planId} initialTab={route.params.tab} onNavigate={navigate} />
          : <StudyPlansPage onNavigate={navigate} />;
      case 'wordbooks':
        return <WordBookPage onNavigate={navigate} />;
      case 'wordbook-detail':
        return <WordBookDetailPage key={route.params?.id} id={route.params?.id} onNavigate={navigate} />;
      case 'word-practice':
        return (
          <WordPracticePage
            planId={route.params?.planId}
            scheduleId={route.params?.scheduleId}
            sessionId={route.params?.sessionId}
            returnTo={route.params?.returnTo}
            onNavigate={navigate}
          />
        );
      case 'practice-result':
        return <PracticeResultPage result={route.params} onNavigate={navigate} />;
      case 'passages':
        return <PassageLibraryPage onNavigate={navigate} />;
      case 'create-passage':
        // 参数变了（如「接着做」上次没做完的）重新挂载，按新的入口初始化
        return <CreatePassagePage key={JSON.stringify(route.params ?? {})} initial={route.params} onNavigate={navigate} />;
      case 'import-passage':
        return <ImportPassagePage onNavigate={navigate} />;
      case 'passage-detail':
        return <PassageDetailPage key={route.params?.passageId} passageId={route.params?.passageId} fromPlan={route.params?.fromPlan} returnTo={route.params?.returnTo} clip={route.params?.clip} onNavigate={navigate} />;
      case 'passage-practice':
        return (
          // key：切换题组 / 模式时重新挂载
          <PassagePracticePage
            key={`${route.params?.setId}-${route.params?.mode}-${route.params?.planId ?? ''}`}
            setId={route.params?.setId}
            mode={route.params?.mode}
            planId={route.params?.planId}
            returnTo={route.params?.returnTo}
            onNavigate={navigate}
          />
        );
      case 'videos':
        return <VideoLibraryPage key={JSON.stringify(route.params ?? {})} tab={route.params?.tab} videoId={route.params?.videoId} onNavigate={navigate} />;
      case 'video-editor':
        return <VideoEditorPage key={route.params?.videoId} videoId={route.params?.videoId} onNavigate={navigate} />;
      case 'tag':
        return <TagPage key={route.params?.tagId} tagId={route.params?.tagId} onNavigate={navigate} />;
      case 'calendar':
        return <CalendarPage onNavigate={navigate} />;
      case 'settings':
        return <SettingsPage onNavigate={navigate} />;
      default: {
        const unreachable: never = route;
        return unreachable;
      }
    }
  };

  // 从计划打开的短文：面包屑「计划 › 计划名 › 短文」，侧边栏高亮「计划」
  const fromPlan = route.page === 'passage-detail' ? route.params?.fromPlan : undefined;
  // 视频片段：面包屑「视频库 › 片段」，侧边栏高亮「视频库」
  const fromClips = route.page === 'passage-detail' && route.params?.clip;
  const shellParent = fromPlan
    ? {
        section: 'plans' as const,
        trail: [{ label: fromPlan.planName, onClick: () => navigate('plan-detail', { planId: fromPlan.planId, tab: 'passages' }) }],
      }
    : fromClips
      ? { section: 'videos' as const, trail: [] }
      : undefined;

  return (
    <ErrorBoundary>
      <ToastProvider>
        {/* 自动检查更新与菜单「检查更新…」：在启动错误页也有效，数据库出问题时也能装上修复版 */}
        <UpdateWatcher />
        {/* 数据库打开并升级成功才渲染应用，否则只显示原因（见 StartupGate） */}
        <StartupGate>
          {/* 专注模式页面（单词练习）自绘整窗框架，其余页面由 AppShell 提供侧边栏与顶栏 */}
          {FOCUS_PAGES.has(route.page) ? (
            renderPage()
          ) : (
            <AppShell page={route.page} onNavigate={navigate} parent={shellParent} activeTagId={route.page === 'tag' ? route.params?.tagId : undefined} history={{ canBack, canForward, onBack: back, onForward: forward }}>
              {renderPage()}
            </AppShell>
          )}
          {/* 后台任务：状态同步、任务面板、完成提示、退出确认 */}
          <JobCenter onNavigate={navigate} />
          <DevTools />
        </StartupGate>
      </ToastProvider>
    </ErrorBoundary>
  );
}

export default App;
