import React, { useState, useEffect, useMemo, useRef } from 'react';
import { TextImport, WordGrid, Button, type ImportMethod, type ExtractedWord } from '../';
import { WordExtractionMode } from '../../types';
import styles from './WordImporter.module.css';
import { AIModelService } from '../../services/aiModelService';


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
  /** 选择的AI模型 (向后兼容) */
  selectedModel: string;
  /** AI模型变化回调 (向后兼容) */
  onModelChange: (model: string) => void;
  /** 提取的单词列表 */
  extractedWords: ExtractedWord[];
  /** 设置提取的单词 */
  onWordsExtracted: (words: ExtractedWord[]) => void;
  /** 单词切换回调 */
  onWordToggle: (wordId: string) => void;
  /** 全选/取消全选回调 */
  onSelectAll: (selected: boolean) => void;
  /** 按词性选择回调 */
  onSelectByPartOfSpeech?: (partOfSpeech: string, selected: boolean) => void;
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
  /** 单词提取模式 */
  extractionMode?: WordExtractionMode;
  /** 提取模式变化回调 */
  onExtractionModeChange?: (mode: WordExtractionMode) => void;
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
  onSelectByPartOfSpeech,
  onSaveWords,
  saving = false,
  title = '导入词汇',
  description = '通过文本分析或文件上传导入新词汇',
  saveButtonText = '保存选中单词',
  showSaveAction = true,
  onSelectedWordsChange,
  extractionMode = 'focus',
  onExtractionModeChange
}) => {
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState<'import' | 'select'>('import');
  const [availableModels, setAvailableModels] = useState<Array<{ id: string; label: string; description?: string }>>([]);
  const [selectedModelId, setSelectedModelId] = useState<string>('default');
  const [, setLoadingModels] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);

  const aiModelService = new AIModelService();

  // 向后兼容性处理：如果传入了 selectedModel，使用它来初始化 selectedModelId
  useEffect(() => {
    if (isInitialized && selectedModel && selectedModel !== selectedModelId) {
      console.log('Setting selectedModelId from prop:', selectedModel);
      setSelectedModelId(selectedModel);
    }
  }, [selectedModel, isInitialized]); // 只在初始化完成后才同步

  // 向后兼容性处理：当 selectedModelId 改变时，通知父组件
  useEffect(() => {
    if (isInitialized && onModelChange && selectedModelId !== selectedModel) {
      console.log('Notifying parent of model change:', selectedModelId);
      onModelChange(selectedModelId);
    }
  }, [selectedModelId, isInitialized]); // 只在初始化完成后才通知

  // 加载可用的AI模型
  useEffect(() => {
    const loadModels = async () => {
      setLoadingModels(true);
      try {
        const modelsResult = await aiModelService.getAIModels();
        let modelOptions: any[] = [];

        if (modelsResult.success) {
          modelOptions = modelsResult.data.map(model => ({
            id: model.id.toString(),
            label: `${model.displayName} (${model.provider?.displayName || '未知提供商'})`,
            description: model.description || `${model.provider?.displayName || '未知提供商'}提供的${model.displayName}模型`,
          }));
        } else {
          console.error('Failed to load AI models:', modelsResult.error);
        }

        setAvailableModels(modelOptions);

        // 设置默认选中的模型
        const defaultModel = modelsResult.success ? modelsResult.data.find(m => m.isDefault) : null;
        if (defaultModel && !selectedModel) {
          console.log('Setting default model:', defaultModel.id.toString());
          setSelectedModelId(defaultModel.id.toString());
        } else if (selectedModel) {
          console.log('Using model from props:', selectedModel);
          setSelectedModelId(selectedModel);
        } else if (modelOptions.length > 0) {
          // 如果没有默认模型，选择第一个可用模型
          console.log('No default model found, using first available:', modelOptions[0].id);
          setSelectedModelId(modelOptions[0].id);
        }
      } catch (error) {
        console.error('Failed to load AI models:', error);
        // 如果加载失败，设置空的模型列表
        setAvailableModels([]);
      } finally {
        setLoadingModels(false);
        setIsInitialized(true); // 标记初始化完成
      }
    };

    loadModels();
  }, []);

  // 移除了传统词汇分析的转换函数

  // 转换 PhonicsWord 到 ExtractedWord
  const convertPhonicsToExtracted = (phonicsWords: any[]): ExtractedWord[] => {
    return phonicsWords.map((word, index) => ({
      id: `${index + 1}`,
      word: word.word,
      meaning: word.chinese_translation,
      partOfSpeech: convertPOSAbbreviation(word.pos_abbreviation),
      frequency: word.frequency || 1,
      selected: true, // 默认选中所有单词
      // 添加自然拼读特有的信息
      phonics: {
        ipa: word.ipa,
        syllables: word.syllables,
        phonics_rule: word.phonics_rule,
        analysis_explanation: word.analysis_explanation,
        pos_abbreviation: word.pos_abbreviation,
        pos_english: word.pos_english,
        pos_chinese: word.pos_chinese,
        frequency: word.frequency
      }
    }));
  };

  // 转换词性缩写到标准格式
  const convertPOSAbbreviation = (pos?: string): ExtractedWord['partOfSpeech'] => {
    if (!pos) return 'n.';

    const normalizedPos = pos.toLowerCase().replace(/\./g, '').trim();
    const posMap: Record<string, ExtractedWord['partOfSpeech']> = {
      'n': 'n.',
      'noun': 'n.',
      'nouns': 'n.',
      'v': 'v.',
      'verb': 'v.',
      'verbs': 'v.',
      'adj': 'adj.',
      'adjective': 'adj.',
      'adjectives': 'adj.',
      'adv': 'adv.',
      'adverb': 'adv.',
      'adverbs': 'adv.',
      'prep': 'prep.',
      'preposition': 'prep.',
      'prepositions': 'prep.',
      'conj': 'conj.',
      'conjunction': 'conj.',
      'conjunctions': 'conj.',
      'int': 'int.',
      'interjection': 'int.',
      'interjections': 'int.',
      'pron': 'pron.',
      'pronoun': 'pron.',
      'pronouns': 'pron.',
      'art': 'art.',
      'article': 'art.',
      'articles': 'art.',
      'det': 'det.',
      'determiner': 'det.',
      'determiners': 'det.',
    };

    return posMap[normalizedPos] || 'n.';
  };



  const handleAnalyzeText = async () => {
    if (!textContent.trim() && method === 'text') {
      setError('请先输入要分析的文本内容');
      return;
    }

    setError(null);
    setAnalyzing(true);

    try {
      console.log('Starting phonics analysis with model:', selectedModelId);

      // 使用自然拼读分析API
      let modelIdToUse: number | undefined;

      if (selectedModelId === '' || !selectedModelId) {
        // 如果没有选择模型，使用默认模型
        modelIdToUse = undefined;
      } else {
        const parsedId = parseInt(selectedModelId);
        if (isNaN(parsedId)) {
          throw new Error(`Invalid model ID: ${selectedModelId}`);
        }
        modelIdToUse = parsedId;
      }

      console.log('Using model ID:', modelIdToUse);

      const phonicsResult = await aiModelService.analyzePhonics(
        textContent,
        modelIdToUse,
        extractionMode
      );

      console.log('Phonics analysis result:', phonicsResult);

      if (!phonicsResult.success) {
        throw new Error(phonicsResult.error || '分析失败');
      }

      // 转换自然拼读分析结果为ExtractedWord格式
      const extractedWords = convertPhonicsToExtracted(phonicsResult.data.words);

      console.log('Converted extracted words:', extractedWords);

      onWordsExtracted(extractedWords);
      setCurrentStep('select');
    } catch (err) {
      console.error('Phonics analysis failed:', err);

      // AI 分析失败，显示错误信息
      const errorMessage = err instanceof Error ? err.message : String(err);
      if (errorMessage.includes('XML parsing error') || errorMessage.includes('No valid words found')) {
        setError('AI 返回的数据格式不正确，请重新点击分析按钮重试。如果问题持续存在，请检查所选模型是否支持自然拼读分析。');
      } else {
        setError('分析失败，请检查文本内容、网络连接或重新点击分析按钮重试');
      }
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

  // 使用 useMemo 优化选中单词的计算
  const selectedWords = useMemo(() => {
    return extractedWords.filter(word => word.selected);
  }, [extractedWords]);

  const selectedCount = selectedWords.length;
  const canSave = selectedCount > 0 && !saving;

  // 使用 useRef 来跟踪上一次的选中单词，避免不必要的回调
  const prevSelectedWordsRef = useRef<ExtractedWord[]>([]);

  // 监听选中单词变化，通知外部组件
  React.useEffect(() => {
    if (onSelectedWordsChange) {
      // 比较选中单词的ID数组，而不是整个对象数组
      const currentSelectedIds = selectedWords.map(w => w.id).sort();
      const prevSelectedIds = prevSelectedWordsRef.current.map(w => w.id).sort();

      // 只有当选中的单词ID发生变化时才调用回调
      if (JSON.stringify(currentSelectedIds) !== JSON.stringify(prevSelectedIds)) {
        console.log('Selected words changed:', selectedWords.length, 'words selected');
        prevSelectedWordsRef.current = selectedWords;
        onSelectedWordsChange(selectedWords);
      }
    }
  }, [selectedWords]); // 移除 onSelectedWordsChange 避免循环

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
          {/* 提取模式选择 */}
          <div className={styles.extractionModeSection}>
            <h4 className={styles.sectionTitle}>提取模式</h4>
            <div className={styles.modeOptions}>
              <label className={`${styles.modeOption} ${extractionMode === 'focus' ? styles.selected : ''}`}>
                <input
                  type="radio"
                  name="extractionMode"
                  value="focus"
                  checked={extractionMode === 'focus'}
                  onChange={(e) => onExtractionModeChange?.(e.target.value as WordExtractionMode)}
                  className={styles.modeRadio}
                />
                <div className={styles.modeContent}>
                  <div className={styles.modeTitle}>
                    <i className="fas fa-bullseye" />
                    重点模式（推荐）
                  </div>
                  <div className={styles.modeDescription}>
                    过滤掉 a、the、is 等简单词汇，专注于有学习价值的单词
                  </div>
                </div>
              </label>

              <label className={`${styles.modeOption} ${extractionMode === 'all' ? styles.selected : ''}`}>
                <input
                  type="radio"
                  name="extractionMode"
                  value="all"
                  checked={extractionMode === 'all'}
                  onChange={(e) => onExtractionModeChange?.(e.target.value as WordExtractionMode)}
                  className={styles.modeRadio}
                />
                <div className={styles.modeContent}>
                  <div className={styles.modeTitle}>
                    <i className="fas fa-list" />
                    全量模式
                  </div>
                  <div className={styles.modeDescription}>
                    提取文本中的所有单词，包括简单的功能词
                  </div>
                </div>
              </label>
            </div>
          </div>

          <TextImport
            method={method}
            onMethodChange={onMethodChange}
            textContent={textContent}
            onTextChange={onTextChange}
            onFileUpload={onFileUpload}
            onAnalyzeText={handleAnalyzeText}
            selectedModelId={selectedModelId}
            onModelChange={setSelectedModelId}
            analyzing={analyzing}
            availableModels={availableModels}
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
              onSelectByPartOfSpeech={onSelectByPartOfSpeech}
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