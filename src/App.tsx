import { useState, useCallback } from 'react';
import { ErrorBoundary, ToastProvider } from './components';
import DevTools from './components/DevTools';
import HomePage from './pages/HomePage';
import StudyPlansPage from './pages/StudyPlansPage';
import CreatePlanPageV2 from './pages/CreatePlanPageV2';
import PlanDetailPage from './pages/PlanDetailPage';
import WordBookPage from './pages/WordBookPage';
import CreateWordBookPageV2 from './pages/CreateWordBookPageV2';
import WordBookDetailPage from './pages/WordBookDetailPage';
import StartStudyPlanPage from './pages/StartStudyPlanPage';
import FinishStudyPlanPage from './pages/FinishStudyPlanPage';
import CalendarPage from './pages/CalendarPage';
import { SettingsPage } from './pages/SettingsPage';
// Real database implementation is now in place

function App() {
  const [currentPage, setCurrentPage] = useState('home');
  const [pageParams, setPageParams] = useState<any>(null);

  const handleNavigation = useCallback((page: string, params?: any) => {
    setCurrentPage(page);
    setPageParams(params);
  }, []);

  const renderPage = () => {
    switch (currentPage) {
      case 'plans':
        return <StudyPlansPage onNavigate={handleNavigation} />;
      case 'create-plan':
        return <CreatePlanPageV2 onNavigate={handleNavigation} />;
      case 'plan-detail':
        return <PlanDetailPage planId={pageParams?.planId || 1} onNavigate={handleNavigation} />;
      case 'wordbooks':
        return <WordBookPage onNavigate={handleNavigation} />;
      case 'create-wordbook':
        return <CreateWordBookPageV2 onNavigate={handleNavigation} />;
      case 'wordbook-detail':
        return <WordBookDetailPage id={pageParams?.id} onNavigate={handleNavigation} />;
      case 'start-study-plan':
        return <StartStudyPlanPage planId={pageParams?.planId} onNavigate={handleNavigation} />;
      case 'finish-study-plan':
        return <FinishStudyPlanPage results={pageParams} onNavigate={handleNavigation} />;
      case 'study':
        return <StartStudyPlanPage planId={pageParams?.planId} onNavigate={handleNavigation} />;
      case 'study-completion':
        return <FinishStudyPlanPage results={pageParams} onNavigate={handleNavigation} />;
      case 'calendar':
        return <CalendarPage onNavigate={handleNavigation} />;
      case 'settings':
        return <SettingsPage onNavigate={handleNavigation} />;
      case 'home':
      default:
        return <HomePage onNavigate={handleNavigation} />;
    }
  };

  return (
    <ErrorBoundary>
      <ToastProvider>
        {renderPage()}
        <DevTools />
      </ToastProvider>
    </ErrorBoundary>
  );
}

export default App;
