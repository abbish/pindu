import React, { useState, useEffect } from 'react';
import styles from './DevTools.module.css';

interface DevToolsProps {
  enabled?: boolean;
}

const DevTools: React.FC<DevToolsProps> = ({ enabled = import.meta.env.DEV }) => {
  const [isVisible, setIsVisible] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [apiCalls, setApiCalls] = useState<{command: string, args: any, timestamp: number}[]>([]);
  
  // 只在开发模式下显示
  if (!enabled) return null;
  
  // 拦截控制台日志
  useEffect(() => {
    if (!enabled) return;
    
    const originalConsoleLog = console.log;
    const originalConsoleError = console.error;
    
    console.log = (...args) => {
      originalConsoleLog(...args);
      setLogs(prev => [...prev, `[LOG] ${args.map(arg => 
        typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
      ).join(' ')}`].slice(-50)); // 只保留最近50条日志
    };
    
    console.error = (...args) => {
      originalConsoleError(...args);
      setLogs(prev => [...prev, `[ERROR] ${args.map(arg => 
        typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
      ).join(' ')}`].slice(-50));
    };
    
    // 监听API调用
    const handleApiCall = (event: CustomEvent) => {
      const { command, args } = event.detail;
      setApiCalls(prev => [...prev, { 
        command, 
        args, 
        timestamp: Date.now() 
      }].slice(-20)); // 只保留最近20个API调用
    };
    
    window.addEventListener('tauri-api-call' as any, handleApiCall as any);
    
    return () => {
      console.log = originalConsoleLog;
      console.error = originalConsoleError;
      window.removeEventListener('tauri-api-call' as any, handleApiCall as any);
    };
  }, [enabled]);
  
  return (
    <div className={styles.devTools}>
      <button 
        className={styles.toggleButton}
        onClick={() => setIsVisible(!isVisible)}
      >
        {isVisible ? '隐藏调试面板' : '显示调试面板'}
      </button>
      
      {isVisible && (
        <div className={styles.panel}>
          <h3>开发者调试面板</h3>
          
          <div className={styles.section}>
            <h4>环境信息</h4>
            <div className={styles.info}>
              <div>开发模式: {import.meta.env.DEV ? '是' : '否'}</div>
              <div>环境: {import.meta.env.MODE}</div>
              <div>Tauri环境: {typeof window !== 'undefined' && '__TAURI__' in window ? '是' : '否'}</div>
            </div>
          </div>
          
          <div className={styles.section}>
            <h4>最近API调用 ({apiCalls.length})</h4>
            <div className={styles.apiCalls}>
              {apiCalls.map((call, index) => (
                <div key={index} className={styles.apiCall}>
                  <div className={styles.command}>{call.command}</div>
                  <div className={styles.args}>{JSON.stringify(call.args)}</div>
                  <div className={styles.timestamp}>
                    {new Date(call.timestamp).toLocaleTimeString()}
                  </div>
                </div>
              ))}
              {apiCalls.length === 0 && <div>暂无API调用</div>}
            </div>
          </div>
          
          <div className={styles.section}>
            <h4>控制台日志</h4>
            <div className={styles.logs}>
              {logs.map((log, index) => (
                <div key={index} className={styles.log}>
                  {log}
                </div>
              ))}
              {logs.length === 0 && <div>暂无日志</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DevTools;
