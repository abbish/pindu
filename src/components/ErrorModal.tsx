import React from 'react';

interface ErrorModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  message: string;
  details?: string;
  onRetry?: () => void;
}

export const ErrorModal: React.FC<ErrorModalProps> = ({
  isOpen,
  onClose,
  title,
  message,
  details,
  onRetry,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4 shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center">
            <div className="w-8 h-8 bg-red-100 rounded-full flex items-center justify-center mr-3">
              <i className="fas fa-exclamation-triangle text-red-600"></i>
            </div>
            <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <i className="fas fa-times"></i>
          </button>
        </div>

        {/* Content */}
        <div className="mb-6">
          <p className="text-gray-700 mb-3">{message}</p>
          
          {details && (
            <details className="mt-3">
              <summary className="cursor-pointer text-sm text-gray-500 hover:text-gray-700">
                查看详细信息
              </summary>
              <div className="mt-2 p-3 bg-gray-50 rounded border text-sm text-gray-600 font-mono whitespace-pre-wrap">
                {details}
              </div>
            </details>
          )}
        </div>

        {/* Actions */}
        <div className="flex justify-end space-x-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors"
          >
            关闭
          </button>
          {onRetry && (
            <button
              onClick={() => {
                onRetry();
                onClose();
              }}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
            >
              重试
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

// 错误信息格式化工具
export const formatErrorMessage = (error: any): { message: string; details?: string } => {
  if (typeof error === 'string') {
    return { message: error };
  }
  
  if (error instanceof Error) {
    return {
      message: error.message,
      details: error.stack,
    };
  }
  
  if (error && typeof error === 'object') {
    if (error.message) {
      return {
        message: error.message,
        details: JSON.stringify(error, null, 2),
      };
    }
    
    return {
      message: '发生了未知错误',
      details: JSON.stringify(error, null, 2),
    };
  }
  
  return {
    message: '发生了未知错误',
    details: String(error),
  };
};

// 错误类型判断
export const getErrorType = (error: any): string => {
  const errorStr = String(error).toLowerCase();
  
  if (errorStr.includes('database') || errorStr.includes('数据库')) {
    return '数据库错误';
  }
  
  if (errorStr.includes('network') || errorStr.includes('网络')) {
    return '网络错误';
  }
  
  if (errorStr.includes('tauri') || errorStr.includes('invoke')) {
    return 'API 调用错误';
  }
  
  if (errorStr.includes('not running in tauri environment')) {
    return '环境错误';
  }
  
  return '系统错误';
};
