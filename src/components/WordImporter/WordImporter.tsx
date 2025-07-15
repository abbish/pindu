import React, { useState } from 'react';
import { TextImport, WordGrid, Button, type ImportMethod, type ExtractedWord } from '../';
import styles from './WordImporter.module.css';

export interface WordImporterProps {
  /** 导入方法 */
  method: ImportMethod;
  /** 方法变化回调 */
  onMethodChange: (method: ImportMethod) => void;
  /** 文本内容 */
  textContent: string;
  /** 文本变化回调 */
  onTextChange: (content: string) => void;
  /** 文件上传回调 */
  onFileUpload: (file: File) => void;
  /** 选择的AI模型 */
  selectedModel: string;
  /** AI模型变化回调 */
  onModelChange: (model: string) => void;
  /** 提取的单词列表 */
  extractedWords: ExtractedWord[];
  /** 设置提取的单词 */
  onWordsExtracted: (words: ExtractedWord[]) => void;
  /** 单词切换回调 */
  onWordToggle: (wordId: string) => void;
  /** 全选/取消全选回调 */
  onSelectAll: (selected: boolean) => void;
  /** 保存选中单词回调 */
  onSaveWords?: (words: ExtractedWord[]) => Promise<void>;
  /** 保存状态 */
  saving?: boolean;
  /** 标题 */
  title?: string;
  /** 描述 */
  description?: string;
  /** 保存按钮文字 */
  saveButtonText?: string;
  /** 是否显示保存操作 */
  showSaveAction?: boolean;
  /** 选中的单词变化回调（用于外部组件实时获取选中状态） */
  onSelectedWordsChange?: (words: ExtractedWord[]) => void;
}

/**
 * 通用词汇导入组件
 * 整合文本导入、AI分析、单词选择和保存功能
 */
export const WordImporter: React.FC<WordImporterProps> = ({
  method,
  onMethodChange,
  textContent,
  onTextChange,
  onFileUpload,
  selectedModel,
  onModelChange,
  extractedWords,
  onWordsExtracted,
  onWordToggle,
  onSelectAll,
  onSaveWords,
  saving = false,
  title = '导入词汇',
  description = '通过文本分析或文件上传导入新词汇',
  saveButtonText = '保存选中单词',
  showSaveAction = true,
  onSelectedWordsChange
}) => {
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState<'import' | 'select'>('import');

  const handleAnalyzeText = async () => {
    if (!textContent.trim() && method === 'text') {
      setError('请先输入要分析的文本内容');
      return;
    }

    setError(null);
    setAnalyzing(true);

    try {
      // Simulate AI analysis - should be replaced with actual API call
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Mock extracted words based on text content or file
      const mockWords: ExtractedWord[] = [
        {
          id: '1',
          word: 'apple',
          meaning: '苹果',
          partOfSpeech: 'n.',
          frequency: 3,
          selected: true
        },
        {
          id: '2',
          word: 'banana',
          meaning: '香蕉',
          partOfSpeech: 'n.',
          frequency: 2,
          selected: true
        },
        {
          id: '3',
          word: 'orange',
          meaning: '橙子',
          partOfSpeech: 'n.',
          frequency: 1,
          selected: false
        },
        {
          id: '4',
          word: 'grape',
          meaning: '葡萄',
          partOfSpeech: 'n.',
          frequency: 4,
          selected: true
        },
        {
          id: '5',
          word: 'watermelon',
          meaning: '西瓜',
          partOfSpeech: 'n.',
          frequency: 1,
          selected: true
        },
        {
          id: '6',
          word: 'strawberry',
          meaning: '草莓',
          partOfSpeech: 'n.',
          frequency: 2,
          selected: false
        },
        {
          id: '7',
          word: 'pineapple',
          meaning: '菠萝',
          partOfSpeech: 'n.',
          frequency: 1,
          selected: true
        },
        {
          id: '8',
          word: 'mango',
          meaning: '芒果',
          partOfSpeech: 'n.',
          frequency: 3,
          selected: true
        },
        {
          id: '9',
          word: 'eat',
          meaning: '吃',
          partOfSpeech: 'v.',
          frequency: 5,
          selected: false
        },
        {
          id: '10',
          word: 'sweet',
          meaning: '甜的',
          partOfSpeech: 'adj.',
          frequency: 4,
          selected: true
        },
        {
          id: '11',
          word: 'delicious',
          meaning: '美味的',
          partOfSpeech: 'adj.',
          frequency: 2,
          selected: false
        }
      ];

      onWordsExtracted(mockWords);
      setCurrentStep('select');
      
    } catch (err) {
      setError('文本分析失败，请重试');
    } finally {
      setAnalyzing(false);
    }
  };

  const handleSaveWords = async () => {
    const selectedWords = extractedWords.filter(word => word.selected);
    
    if (selectedWords.length === 0) {
      setError('请至少选择一个单词');
      return;
    }
    
    setError(null);
    
    if (onSaveWords) {
      try {
        await onSaveWords(selectedWords);
        // 保存成功后返回到导入阶段
        setCurrentStep('import');
      } catch (error) {
        // 保存失败时保持在选择阶段
        console.error('保存失败:', error);
      }
    }
  };

  const handleBackToImport = () => {
    setCurrentStep('import');
    setError(null);
  };

  const selectedCount = extractedWords.filter(word => word.selected).length;
  const canSave = selectedCount > 0 && !saving;

  // 监听选中单词变化，通知外部组件
  React.useEffect(() => {
    if (onSelectedWordsChange) {
      const selectedWords = extractedWords.filter(word => word.selected);
      onSelectedWordsChange(selectedWords);
    }
  }, [extractedWords, onSelectedWordsChange]);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.stepIndicator}>
          <div className={`${styles.step} ${currentStep === 'import' ? styles.active : styles.completed}`}>
            <span className={styles.stepNumber}>1</span>
            <span className={styles.stepLabel}>导入内容</span>
          </div>
          <div className={styles.stepConnector} />
          <div className={`${styles.step} ${currentStep === 'select' ? styles.active : ''}`}>
            <span className={styles.stepNumber}>2</span>
            <span className={styles.stepLabel}>选择单词</span>
          </div>
        </div>
        
        <h3 className={styles.title}>
          {currentStep === 'import' ? title : '选择要添加的单词'}
        </h3>
        <p className={styles.description}>
          {currentStep === 'import' 
            ? description 
            : '从分析结果中选择你需要的单词，点击单词可以切换选择状态'
          }
        </p>
      </div>

      {/* Error Message */}
      {error && (
        <div className={styles.errorMessage}>
          <i className="fas fa-exclamation-triangle" />
          <span>{error}</span>
          <button onClick={() => setError(null)} className={styles.closeBtn}>
            <i className="fas fa-times" />
          </button>
        </div>
      )}

      {/* Content Import Step */}
      {currentStep === 'import' && (
        <div className={styles.importSection}>
          <TextImport
            method={method}
            onMethodChange={onMethodChange}
            textContent={textContent}
            onTextChange={onTextChange}
            onFileUpload={onFileUpload}
            onAnalyzeText={handleAnalyzeText}
            selectedModel={selectedModel}
            onModelChange={onModelChange}
            analyzing={analyzing}
          />
        </div>
      )}

      {/* Word Selection Step */}
      {currentStep === 'select' && extractedWords.length > 0 && (
        <>
          {/* Back Button */}
          <div className={styles.backSection}>
            <Button
              variant="outline"
              onClick={handleBackToImport}
            >
              <i className="fas fa-arrow-left" />
              <span style={{ marginLeft: '8px' }}>重新分析</span>
            </Button>
          </div>

          {/* Word Grid */}
          <div className={styles.wordSection}>
            <WordGrid
              words={extractedWords}
              onWordToggle={onWordToggle}
              onSelectAll={onSelectAll}
              loading={analyzing}
            />
          </div>
        </>
      )}

      {/* Save Action */}
      {showSaveAction && onSaveWords && currentStep === 'select' && extractedWords.length > 0 && (
        <div className={styles.saveSection}>
          <div className={styles.saveInfo}>
            <span className={styles.selectedCount}>
              已选择 {selectedCount} 个单词
            </span>
          </div>
          <Button
            variant="primary"
            onClick={handleSaveWords}
            disabled={!canSave}
          >
            {saving && <i className="fas fa-spinner fa-spin" />}
            {!saving && <i className="fas fa-save" />}
            <span style={{ marginLeft: '8px' }}>
              {saving ? '保存中...' : saveButtonText}
            </span>
          </Button>
        </div>
      )}
    </div>
  );
};

export default WordImporter;