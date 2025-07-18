import React, { useState } from 'react';
import styles from './TextImport.module.css';

export type ImportMethod = 'text' | 'file';

export interface TextImportProps {
  /** 当前导入方式 */
  method: ImportMethod;
  /** 导入方式变化回调 */
  onMethodChange: (method: ImportMethod) => void;
  /** 文本内容 */
  textContent: string;
  /** 文本内容变化回调 */
  onTextChange: (content: string) => void;
  /** 文件上传回调 */
  onFileUpload: (file: File) => void;
  /** 分析文本回调 */
  onAnalyzeText: () => void;
  /** 当前选择的AI模型ID */
  selectedModelId?: string;
  /** AI模型变化回调 */
  onModelChange?: (modelId: string) => void;
  /** 分析加载状态 */
  analyzing?: boolean;
  /** 可用的AI模型列表 */
  availableModels?: Array<{ id: string; label: string; description?: string }>;
}

// 默认模型列表（当没有提供 availableModels 时使用）
const DEFAULT_AI_MODELS = [
  { id: 'default', label: '默认模型', description: '使用系统默认配置的AI模型' }
];

/**
 * 文本导入组件
 */
export const TextImport: React.FC<TextImportProps> = ({
  method,
  onMethodChange,
  textContent,
  onTextChange,
  onFileUpload,
  onAnalyzeText,
  selectedModelId = 'default',
  onModelChange,
  analyzing = false,
  availableModels = DEFAULT_AI_MODELS
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
    const file = files.find(f => f.type === 'text/plain' || f.name.endsWith('.txt') || f.name.endsWith('.md'));
    
    if (file) {
      onFileUpload(file);
    }
  };

  const canAnalyze = textContent.trim().length > 0 && !analyzing;

  return (
    <div className={styles.container}>
      {/* Import Method Tabs */}
      <div className={styles.methodTabs}>
        <button
          className={`${styles.methodTab} ${method === 'text' ? styles.active : ''}`}
          onClick={() => onMethodChange('text')}
          type="button"
        >
          <i className="fas fa-keyboard" />
          <span>文本输入</span>
        </button>
        <button
          className={`${styles.methodTab} ${method === 'file' ? styles.active : ''}`}
          onClick={() => onMethodChange('file')}
          type="button"
        >
          <i className="fas fa-upload" />
          <span>文件上传</span>
        </button>
      </div>

      {/* Text Input Section */}
      {method === 'text' && (
        <div className={styles.textSection}>
          <label className={styles.label}>输入文本内容</label>
          <textarea
            className={styles.textarea}
            placeholder="在这里输入包含单词的文本内容，系统会自动识别和提取单词..."
            rows={8}
            value={textContent}
            onChange={(e) => onTextChange(e.target.value)}
          />
          <div className={styles.textFooter}>
            <p className={styles.hint}>支持英文文本，系统会自动提取单词</p>
            <div className={styles.analyzeSection}>
              {onModelChange && (
                <div className={styles.modelSelect}>
                  <select
                    id="ai-model-select"
                    value={selectedModelId}
                    onChange={(e) => onModelChange(e.target.value)}
                    className={styles.select}
                    disabled={analyzing}
                    title="选择用于文本分析的AI模型"
                  >
                    {availableModels.map(model => (
                      <option key={model.id} value={model.id} title={model.description}>
                        {model.label}
                      </option>
                    ))}
                  </select>
                  <i className="fas fa-chevron-down" />
                </div>
              )}
              <button
                className={`${styles.analyzeBtn} ${!canAnalyze ? styles.disabled : ''}`}
                onClick={onAnalyzeText}
                disabled={!canAnalyze}
                type="button"
              >
                {analyzing ? (
                  <i className="fas fa-spinner fa-spin" />
                ) : (
                  <i className="fas fa-magic" />
                )}
                <span>{analyzing ? '分析中...' : '分析文本'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* File Upload Section */}
      {method === 'file' && (
        <div className={styles.fileSection}>
          <div
            className={`${styles.dropZone} ${isDragOver ? styles.dragOver : ''}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <i className="fas fa-cloud-upload-alt" />
            <p className={styles.dropTitle}>拖拽文件到这里或点击上传</p>
            <p className={styles.dropHint}>支持 .txt 和 .md 格式文件</p>
            <label className={styles.fileButton}>
              <input
                type="file"
                accept=".txt,.md,text/plain"
                onChange={handleFileInputChange}
                className={styles.fileInput}
              />
              <i className="fas fa-folder-open" />
              <span>选择文件</span>
            </label>
          </div>
        </div>
      )}
    </div>
  );
};

export default TextImport;