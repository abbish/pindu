import React, { useState } from 'react';
import styles from './AddWords.module.css';

export type AddWordsMethod = 'manual' | 'upload';

export interface AddWordsProps {
  /** 当前方法 */
  method: AddWordsMethod;
  /** 方法变化回调 */
  onMethodChange: (method: AddWordsMethod) => void;
  /** 手动输入内容 */
  manualContent: string;
  /** 手动输入变化回调 */
  onManualContentChange: (content: string) => void;
  /** 文件上传回调 */
  onFileUpload: (file: File) => void;
  /** 添加单词回调 */
  onAddWords: () => void;
  /** 当前选择的AI模型 */
  selectedModel?: string;
  /** AI模型变化回调 */
  onModelChange?: (model: string) => void;
  /** 添加加载状态 */
  adding?: boolean;
}

const AI_MODELS = [
  { value: 'gpt-4', label: 'GPT-4' },
  { value: 'gpt-3.5', label: 'GPT-3.5' },
  { value: 'ux-pilot-3', label: 'UX Pilot-3' },
  { value: 'gemini-pro', label: 'Gemini Pro' }
];

/**
 * 补充单词组件
 */
export const AddWords: React.FC<AddWordsProps> = ({
  method,
  onMethodChange,
  manualContent,
  onManualContentChange,
  onFileUpload,
  onAddWords,
  selectedModel = 'gpt-4',
  onModelChange,
  adding = false
}) => {
  const [isDragOver, setIsDragOver] = useState(false);

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onFileUpload(file);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    
    const files = Array.from(e.dataTransfer.files);
    const file = files.find(f => 
      f.type === 'text/plain' || 
      f.type === 'text/csv' || 
      f.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      f.name.endsWith('.txt') || 
      f.name.endsWith('.csv') || 
      f.name.endsWith('.xlsx')
    );
    
    if (file) {
      onFileUpload(file);
    }
  };

  const canAdd = (method === 'manual' && manualContent.trim().length > 0) || method === 'upload';

  return (
    <div className={styles.container}>
      <h3 className={styles.title}>补充单词</h3>
      
      {/* Tab Navigation */}
      <div className={styles.tabContainer}>
        <button
          className={`${styles.tab} ${method === 'manual' ? styles.active : ''}`}
          onClick={() => onMethodChange('manual')}
          type="button"
        >
          手动添加
        </button>
        <button
          className={`${styles.tab} ${method === 'upload' ? styles.active : ''}`}
          onClick={() => onMethodChange('upload')}
          type="button"
        >
          文件上传
        </button>
      </div>

      {/* Manual Input Form */}
      {method === 'manual' && (
        <div className={styles.manualForm}>
          <div className={styles.inputGroup}>
            <label className={styles.label}>输入单词</label>
            <textarea
              className={styles.textarea}
              placeholder="输入单词，每行一个单词，AI将自动补充词性和释义..."
              rows={8}
              value={manualContent}
              onChange={(e) => onManualContentChange(e.target.value)}
            />
          </div>
          
          <div className={styles.manualActions}>
            <button
              className={`${styles.addBtn} ${!canAdd ? styles.disabled : ''}`}
              onClick={onAddWords}
              disabled={!canAdd || adding}
              type="button"
            >
              {adding ? (
                <i className="fas fa-spinner fa-spin" />
              ) : (
                <i className="fas fa-plus" />
              )}
              <span>{adding ? '添加中...' : '添加单词'}</span>
            </button>
            
            {onModelChange && (
              <div className={styles.modelSelect}>
                <select
                  value={selectedModel}
                  onChange={(e) => onModelChange(e.target.value)}
                  className={styles.select}
                >
                  {AI_MODELS.map(model => (
                    <option key={model.value} value={model.value}>
                      {model.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>
      )}

      {/* File Upload Form */}
      {method === 'upload' && (
        <div className={styles.uploadForm}>
          <div
            className={`${styles.dropZone} ${isDragOver ? styles.dragOver : ''}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <i className="fas fa-cloud-upload-alt" />
            <p className={styles.dropTitle}>拖拽文件到此处或点击上传</p>
            <label className={styles.fileButton}>
              <input
                type="file"
                accept=".txt,.csv,.xlsx"
                onChange={handleFileInputChange}
                className={styles.fileInput}
              />
              选择文件
            </label>
          </div>
          
          <div className={styles.uploadHints}>
            <p>支持格式：.txt, .csv, .xlsx</p>
            <p>文件大小：最大 10MB</p>
          </div>
          
          <div className={styles.uploadActions}>
            <button
              className={`${styles.uploadBtn} ${adding ? styles.disabled : ''}`}
              onClick={onAddWords}
              disabled={adding}
              type="button"
            >
              {adding ? (
                <i className="fas fa-spinner fa-spin" />
              ) : (
                <i className="fas fa-upload" />
              )}
              <span>{adding ? '上传中...' : '上传文件'}</span>
            </button>
            
            {onModelChange && (
              <div className={styles.modelSelect}>
                <select
                  value={selectedModel}
                  onChange={(e) => onModelChange(e.target.value)}
                  className={styles.select}
                >
                  {AI_MODELS.map(model => (
                    <option key={model.value} value={model.value}>
                      {model.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default AddWords;