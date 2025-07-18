import { useState, useCallback } from 'react';
import { formatErrorMessage, getErrorType } from '../components/ErrorModal';

interface ErrorState {
  isOpen: boolean;
  title: string;
  message: string;
  details?: string;
  retryAction?: () => void;
}

export const useErrorHandler = () => {
  const [errorState, setErrorState] = useState<ErrorState>({
    isOpen: false,
    title: '',
    message: '',
  });

  const showError = useCallback((error: any, retryAction?: () => void) => {
    const { message, details } = formatErrorMessage(error);
    const title = getErrorType(error);
    
    setErrorState({
      isOpen: true,
      title,
      message,
      details,
      retryAction,
    });
    
    // 同时在控制台输出错误信息
    console.error(`[${title}]`, message, details ? `\nDetails: ${details}` : '');
  }, []);

  const hideError = useCallback(() => {
    setErrorState(prev => ({ ...prev, isOpen: false }));
  }, []);

  const retry = useCallback(() => {
    if (errorState.retryAction) {
      errorState.retryAction();
    }
    hideError();
  }, [errorState.retryAction, hideError]);

  return {
    errorState,
    showError,
    hideError,
    retry,
  };
};
