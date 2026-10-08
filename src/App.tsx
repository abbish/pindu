import { useState, useCallback } from 'react';
import { ErrorBoundary, ToastProvider } from './components';
import { AppShell } from './components/AppShell/AppShell';
import { DevTools } from './components/DevTools';
import { StartupGate } from './components/StartupGate';
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
import { FOCUS_PAGES, type NavigateFn, type PageKey, type Route, type RouteParams } from './navigation';

function App() {
  const [route, setRoute] = useState<Route>({ page: 'home' });

  const navigate = useCallback((page: PageKey, params?: RouteParams[PageKey]) => {
    // page 与 params 的配对由 NavigateFn 在调用处保证
    setRoute({ page, params } as Route);
  }, []) as NavigateFn;

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
          ? <PlanDetailPage planId={route.params.planId} initialTab={route.params.tab} onNavigate={navigate} />
          : <StudyPlansPage onNavigate={navigate} />;
      case 'wordbooks':
        return <WordBookPage onNavigate={navigate} />;
      case 'wordbook-detail':
        return <WordBookDetailPage id={route.params?.id} onNavigate={navigate} />;
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
        return <CreatePassagePage initial={route.params} onNavigate={navigate} />;
      case 'import-passage':
        return <ImportPassagePage onNavigate={navigate} />;
      case 'passage-detail':
        return <PassageDetailPage key={route.params?.passageId} passageId={route.params?.passageId} fromPlan={route.params?.fromPlan} returnTo={route.params?.returnTo} onNavigate={navigate} />;
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
  const shellParent = fromPlan
    ? {
        section: 'plans' as const,
        trail: [{ label: fromPlan.planName, onClick: () => navigate('plan-detail', { planId: fromPlan.planId, tab: 'passages' }) }],
      }
    : undefined;

  return (
    <ErrorBoundary>
      <ToastProvider>
        {/* 数据库打开并升级成功才渲染应用，否则只显示原因（见 StartupGate） */}
        <StartupGate>
          {/* 专注模式页面（单词练习）自绘整窗框架，其余页面由 AppShell 提供侧边栏与顶栏 */}
          {FOCUS_PAGES.has(route.page) ? (
            renderPage()
          ) : (
            <AppShell page={route.page} onNavigate={navigate} parent={shellParent}>
              {renderPage()}
            </AppShell>
          )}
          <DevTools />
        </StartupGate>
      </ToastProvider>
    </ErrorBoundary>
  );
}

export default App;
