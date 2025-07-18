import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface LogEntry {
  timestamp: string;
  level: string;
  component: string;
  message: string;
  details?: string;
}

interface LogViewerProps {
  isOpen: boolean;
  onClose: () => void;
}

export const LogViewer: React.FC<LogViewerProps> = ({ isOpen, onClose }) => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<string>('');
  const [levelFilter, setLevelFilter] = useState<string>('');

  const loadLogs = async () => {
    setLoading(true);
    try {
      const logLines = await invoke<string[]>('get_system_logs');
      const parsedLogs: LogEntry[] = logLines
        .map(line => {
          try {
            return JSON.parse(line) as LogEntry;
          } catch {
            // 如果不是 JSON 格式，创建一个简单的日志条目
            return {
              timestamp: new Date().toISOString(),
              level: 'INFO',
              component: 'SYSTEM',
              message: line,
            };
          }
        })
        .filter(log => log !== null);

      setLogs(parsedLogs);
    } catch (error) {
      console.error('Failed to load logs:', error);
      // 显示错误信息作为日志
      setLogs([{
        timestamp: new Date().toISOString(),
        level: 'ERROR',
        component: 'LOG_VIEWER',
        message: 'Failed to load system logs',
        details: String(error),
      }]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadLogs();
    }
  }, [isOpen]);

  const filteredLogs = logs.filter(log => {
    const matchesText = !filter || 
      log.message.toLowerCase().includes(filter.toLowerCase()) ||
      log.component.toLowerCase().includes(filter.toLowerCase());
    
    const matchesLevel = !levelFilter || log.level === levelFilter;
    
    return matchesText && matchesLevel;
  });

  const getLevelColor = (level: string) => {
    switch (level) {
      case 'ERROR': return 'text-red-600 bg-red-50';
      case 'WARN': return 'text-yellow-600 bg-yellow-50';
      case 'INFO': return 'text-blue-600 bg-blue-50';
      case 'DEBUG': return 'text-gray-600 bg-gray-50';
      default: return 'text-gray-600 bg-gray-50';
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg w-full max-w-4xl h-3/4 mx-4 shadow-xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="text-lg font-semibold text-gray-900">系统日志</h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <i className="fas fa-times"></i>
          </button>
        </div>

        {/* Filters */}
        <div className="p-4 border-b bg-gray-50">
          <div className="flex space-x-4">
            <div className="flex-1">
              <input
                type="text"
                placeholder="搜索日志..."
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <select
                value={levelFilter}
                onChange={(e) => setLevelFilter(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">所有级别</option>
                <option value="ERROR">错误</option>
                <option value="WARN">警告</option>
                <option value="INFO">信息</option>
                <option value="DEBUG">调试</option>
              </select>
            </div>
            <button
              onClick={loadLogs}
              disabled={loading}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? '刷新中...' : '刷新'}
            </button>
          </div>
        </div>

        {/* Log Content */}
        <div className="flex-1 overflow-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-gray-500">加载中...</div>
            </div>
          ) : filteredLogs.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-gray-500">没有找到日志记录</div>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredLogs.map((log, index) => (
                <div key={index} className="border border-gray-200 rounded-lg p-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center space-x-3">
                      <span className={`px-2 py-1 rounded text-xs font-medium ${getLevelColor(log.level)}`}>
                        {log.level}
                      </span>
                      <span className="text-sm text-gray-500">
                        {new Date(log.timestamp).toLocaleString()}
                      </span>
                      <span className="text-sm font-medium text-gray-700">
                        {log.component}
                      </span>
                    </div>
                  </div>
                  <div className="mt-2 text-sm text-gray-800">
                    {log.message}
                  </div>
                  {log.details && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs text-gray-500 hover:text-gray-700">
                        详细信息
                      </summary>
                      <div className="mt-1 p-2 bg-gray-50 rounded text-xs text-gray-600 font-mono whitespace-pre-wrap">
                        {log.details}
                      </div>
                    </details>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t bg-gray-50">
          <div className="flex justify-between items-center text-sm text-gray-500">
            <span>显示 {filteredLogs.length} 条日志</span>
            <button
              onClick={onClose}
              className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700"
            >
              关闭
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
