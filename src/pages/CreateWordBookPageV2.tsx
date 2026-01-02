import React, { useState, useEffect } from 'react';
import {
  Header,
  Breadcrumb,
  FormInput,
  ThemeSelector,
  Button,
  useToast,
  WordGrid,
  type ExtractedWord,

} from '../components';
import { WordImporterModal } from '../components/WordImporterModal';
import { WordBookService } from '../services/wordbookService';
import type { AnalyzedWord, ThemeTag } from '../types';
import styles from './CreateWordBookPage.module.css';

// 主题类型定义
interface Theme {
  id: string;
  name: string;
  icon: string;
  color: 'primary' | 'blue' | 'green' | 'orange' | 'pink' | 'purple' | 'yellow';
}

// 标准化词性函数
const standardizePOS = (pos: string): string => {
  if (!pos) return 'n.';

  const normalizedPos = pos.toLowerCase().replace(/\./g, '').trim();

  const posMap: Record<string, string> = {
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

export interface CreateWordBookPageV2Props {
  /** Navigation handler */
  onNavigate?: (page: string, params?: any) => void;
}

// 默认主题选项
const DEFAULT_THEMES: Theme[] = [
  { id: 'study', name: '学习', icon: '📚', color: 'blue' },
  { id: 'business', name: '商务', icon: '💼', color: 'green' },
  { id: 'travel', name: '旅行', icon: '✈️', color: 'orange' },
  { id: 'daily', name: '日常', icon: '🏠', color: 'primary' },
  { id: 'science', name: '科学', icon: '🔬', color: 'purple' },
  { id: 'art', name: '艺术', icon: '🎨', color: 'pink' },
];

type Step = 'basic' | 'import' | 'preview';

interface FormData {
  name: string;
  description: string;
  selectedThemes: string[];
}

export const CreateWordBookPageV2: React.FC<CreateWordBookPageV2Props> = ({ onNavigate }) => {
  const { showToast } = useToast();
  const wordBookService = new WordBookService();

  // 步骤状态
  const [currentStep, setCurrentStep] = useState<Step>('basic');

  // 表单数据
  const [formData, setFormData] = useState<FormData>({
    name: '',
    description: '',
    selectedThemes: [],
  });

  // 单词数据
  const [extractedWords, setExtractedWords] = useState<ExtractedWord[]>([]);

  // 主题标签数据
  const [themeTags, setThemeTags] = useState<ThemeTag[]>([]);
  const [loadingThemes, setLoadingThemes] = useState(true);

  // 状态管理
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showImporter, setShowImporter] = useState(false);

  // 加载主题标签
  useEffect(() => {
    const loadThemeTags = async () => {
      try {
        const result = await wordBookService.getThemeTags();
        if (result.success) {
          setThemeTags(result.data);
        } else {
          console.error('Failed to load theme tags:', result.error);
          // 如果加载失败，使用默认主题
          setThemeTags(DEFAULT_THEMES.map((theme, index) => ({
            id: index + 1,
            name: theme.name,
            icon: theme.icon,
            color: theme.color,
            created_at: new Date().toISOString(),
          })));
        }
      } catch (error) {
        console.error('Error loading theme tags:', error);
        // 使用默认主题作为后备
        setThemeTags(DEFAULT_THEMES.map((theme, index) => ({
          id: index + 1,
          name: theme.name,
          icon: theme.icon,
          color: theme.color,
          created_at: new Date().toISOString(),
        })));
      } finally {
        setLoadingThemes(false);
      }
    };

    loadThemeTags();
  }, []);

  // 表单验证
  const isBasicFormValid = () => {
    return formData.name.trim().length > 0 && formData.selectedThemes.length > 0;
  };

  // 处理表单变化
  const handleFormChange = (field: keyof FormData, value: string | string[]) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  // 处理主题选择
  const handleThemeChange = (themes: string[]) => {
    handleFormChange('selectedThemes', themes);
  };

  // 进入下一步
  const handleNextStep = () => {
    if (currentStep === 'basic') {
      if (!isBasicFormValid()) {
        setError('请填写完整的基本信息');
        return;
      }
      setCurrentStep('import');
      setShowImporter(true);
    } else if (currentStep === 'import') {
      if (extractedWords.length === 0) {
        setError('请至少导入一个单词');
        return;
      }
      setCurrentStep('preview');
    }
    setError(null);
  };

  // 返回上一步
  const handlePrevStep = () => {
    if (currentStep === 'import') {
      setCurrentStep('basic');
      setShowImporter(false);
    } else if (currentStep === 'preview') {
      setCurrentStep('import');
    }
    setError(null);
  };

  // 处理单词导入完成
  const handleWordsImported = async (words: ExtractedWord[]) => {
    setExtractedWords(words);
    setShowImporter(false);
    setCurrentStep('preview');
  };

  // 单词选择切换
  const handleWordToggle = (wordId: string) => {
    setExtractedWords(prev => 
      prev.map(word => 
        word.id === wordId 
          ? { ...word, selected: !word.selected }
          : word
      )
    );
  };

  // 全选/取消全选
  const handleSelectAll = (selected: boolean) => {
    setExtractedWords(prev => 
      prev.map(word => ({ ...word, selected }))
    );
  };

  // 保存草稿
  const handleSaveDraft = async () => {
    await handleSave('draft');
  };

  // 创建单词本
  const handleCreate = async () => {
    await handleSave('normal');
  };

  // 保存逻辑
  const handleSave = async (status: 'draft' | 'normal') => {
    const selectedWords = extractedWords.filter(word => word.selected);
    
    if (selectedWords.length === 0) {
      setError('请至少选择一个单词');
      return;
    }

    setCreating(true);
    setError(null);

    try {
      // 转换 ExtractedWord 到 AnalyzedWord 格式
      const analyzedWords: AnalyzedWord[] = selectedWords.map(word => {
        // 使用标准化的词性处理逻辑
        const rawPos = word.phonics?.pos_abbreviation || word.partOfSpeech || 'n.';
        const standardizedPos = standardizePOS(rawPos);

        return {
          word: word.word,
          meaning: word.meaning,
          phonetic: word.phonics?.ipa || undefined,
          part_of_speech: standardizedPos,
          example_sentence: undefined,
          // 自然拼读分析字段
          ipa: word.phonics?.ipa || undefined,
          syllables: word.phonics?.syllables || undefined,
          pos_abbreviation: standardizedPos,
          pos_english: word.phonics?.pos_english || undefined,
          pos_chinese: word.phonics?.pos_chinese || undefined,
          phonics_rule: word.phonics?.phonics_rule || undefined,
          analysis_explanation: word.phonics?.analysis_explanation || undefined,
        };
      });

      // 获取主题信息（使用第一个选中的主题作为主图标）
      const selectedThemeNames = formData.selectedThemes;
      const selectedThemeObjects = themeTags.filter(theme => selectedThemeNames.includes(theme.name));
      const selectedThemeIds = selectedThemeObjects.map(theme => theme.id);

      const firstSelectedTheme = selectedThemeObjects[0];
      const icon = firstSelectedTheme?.icon || '📚';
      const iconColor = firstSelectedTheme?.color || '#3B82F6';

      // 调用API创建单词本
      const result = await wordBookService.createWordBookFromAnalysis({
        title: formData.name.trim(),
        description: formData.description?.trim() || '',
        icon,
        icon_color: iconColor,
        words: analyzedWords,
        status,
        theme_tag_ids: selectedThemeIds.length > 0 ? selectedThemeIds : undefined,
      });

      if (result.success) {
        const actionText = status === 'draft' ? '草稿已保存' : '单词本创建成功';
        showToast(actionText, 'success');
        // result.data 是 WordSaveResult 对象，包含 book_id 字段
        onNavigate?.('wordbook-detail', { id: result.data.book_id });
      } else {
        throw new Error(result.error || '操作失败');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '操作失败，请重试';
      setError(errorMessage);
      showToast(errorMessage, 'error');
    } finally {
      setCreating(false);
    }
  };

  // 渲染步骤指示器
  const renderStepIndicator = () => (
    <div className={styles.stepIndicator}>
      <div className={`${styles.step} ${currentStep === 'basic' ? styles.active : ''} ${currentStep !== 'basic' ? styles.completed : ''}`}>
        <div className={styles.stepNumber}>1</div>
        <div className={styles.stepLabel}>基本信息</div>
      </div>
      <div className={styles.stepConnector} />
      <div className={`${styles.step} ${currentStep === 'import' ? styles.active : ''} ${currentStep === 'preview' ? styles.completed : ''}`}>
        <div className={styles.stepNumber}>2</div>
        <div className={styles.stepLabel}>导入单词</div>
      </div>
      <div className={styles.stepConnector} />
      <div className={`${styles.step} ${currentStep === 'preview' ? styles.active : ''}`}>
        <div className={styles.stepNumber}>3</div>
        <div className={styles.stepLabel}>确认内容</div>
      </div>
    </div>
  );

  // 渲染基本信息步骤
  const renderBasicStep = () => (
    <div className={styles.stepContent}>
      <div className={styles.formSection}>
        <FormInput
          label="单词本名称"
          name="name"
          placeholder="请输入单词本名称"
          value={formData.name}
          onChange={(value) => handleFormChange('name', value)}
          helperText="给你的单词本起一个有意义的名字"
          required
        />

        <ThemeSelector
          themes={themeTags.map(tag => ({
            id: tag.name, // ThemeSelector期望的是字符串ID，我们使用name作为ID
            name: tag.name,
            icon: tag.icon,
            color: tag.color as any, // 类型转换，因为数据库中的color是字符串
          }))}
          selectedThemes={formData.selectedThemes}
          onSelectionChange={handleThemeChange}
          multiple={true}
          label="主题标签"
          description="选择一个或多个主题标签来分类你的单词本"
          disabled={loadingThemes}
        />

        <FormInput
          label="描述"
          name="description"
          type="textarea"
          placeholder="描述一下这个单词本的内容和用途"
          value={formData.description}
          onChange={(value) => handleFormChange('description', value)}
          rows={3}
        />
      </div>

      {error && (
        <div className={styles.error}>
          <i className="fas fa-exclamation-triangle" />
          {error}
        </div>
      )}

      <div className={styles.stepActions}>
        <Button variant="secondary" onClick={() => onNavigate?.('wordbooks')}>
          取消
        </Button>
        <Button 
          variant="primary" 
          onClick={handleNextStep}
          disabled={!isBasicFormValid()}
        >
          下一步：导入单词
        </Button>
      </div>
    </div>
  );

  // 渲染导入步骤
  const renderImportStep = () => (
    <div className={styles.stepContent}>

      <div className={styles.importSection}>
        <div className={styles.importPlaceholder}>
          <i className="fas fa-magic" />
          <h4>使用AI分析文本</h4>
          <p>点击下方按钮打开文本分析器，输入英文文本或上传文件，AI将自动提取单词并进行自然拼读分析</p>
          <Button
            variant="primary"
            onClick={() => setShowImporter(true)}
            size="lg"
          >
            <i className="fas fa-plus" />
            开始导入单词
          </Button>
        </div>

        {extractedWords.length > 0 && (
          <div className={styles.importedWords}>
            <div className={styles.importedHeader}>
              <h4>已导入的单词 ({extractedWords.length})</h4>
              <Button
                variant="secondary"
                onClick={() => setShowImporter(true)}
                size="sm"
              >
                重新导入
              </Button>
            </div>
            <div className={styles.wordPreview}>
              {extractedWords.slice(0, 10).map(word => (
                <span key={word.id} className={styles.wordTag}>
                  {word.word}
                </span>
              ))}
              {extractedWords.length > 10 && (
                <span className={styles.moreWords}>
                  +{extractedWords.length - 10} 更多...
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className={styles.error}>
          <i className="fas fa-exclamation-triangle" />
          {error}
        </div>
      )}

      <div className={styles.stepActions}>
        <Button variant="secondary" onClick={handlePrevStep}>
          上一步
        </Button>
        <Button
          variant="primary"
          onClick={handleNextStep}
          disabled={extractedWords.length === 0}
        >
          下一步：确认内容
        </Button>
      </div>
    </div>
  );

  // 渲染预览步骤
  const renderPreviewStep = () => {
    const selectedWords = extractedWords.filter(word => word.selected);
    const selectedThemes = DEFAULT_THEMES.filter(theme => formData.selectedThemes.includes(theme.id));
    const primaryTheme = selectedThemes[0];

    return (
      <div className={styles.stepContent}>
        {/* 单词本信息预览 */}
        <div className={styles.previewSection}>
          <div className={styles.bookInfo}>
            <div
              className={styles.bookIcon}
              data-theme-color={primaryTheme?.id}
            >
              {primaryTheme?.icon}
            </div>
            <div className={styles.bookDetails}>
              <h4>{formData.name}</h4>
              <p>{formData.description || '暂无描述'}</p>
              <div className={styles.bookMeta}>
                <span className={styles.metaItem}>
                  <i className="fas fa-tag" />
                  {selectedThemes.map(theme => theme.name).join(', ')}
                </span>
                <span className={styles.metaItem}>
                  <i className="fas fa-list" />
                  {selectedWords.length} 个单词
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* 单词列表 */}
        <div className={styles.wordsSection}>
          <div className={styles.wordsHeader}>
            <h4>单词列表</h4>
            <div className={styles.wordsActions}>
              <Button
                variant="secondary"
                onClick={() => handleSelectAll(true)}
                size="sm"
              >
                全选
              </Button>
              <Button
                variant="secondary"
                onClick={() => handleSelectAll(false)}
                size="sm"
              >
                取消全选
              </Button>
            </div>
          </div>

          <WordGrid
            words={extractedWords}
            onWordToggle={handleWordToggle}
            onSelectAll={handleSelectAll}
          />
        </div>

        {error && (
          <div className={styles.error}>
            <i className="fas fa-exclamation-triangle" />
            {error}
          </div>
        )}

        <div className={styles.stepActions}>
          <Button variant="secondary" onClick={handlePrevStep}>
            上一步
          </Button>
          <Button
            variant="secondary"
            onClick={handleSaveDraft}
            disabled={creating || selectedWords.length === 0}
            loading={creating}
          >
            保存草稿
          </Button>
          <Button
            variant="primary"
            onClick={handleCreate}
            disabled={creating || selectedWords.length === 0}
            loading={creating}
          >
            创建单词本
          </Button>
        </div>
      </div>
    );
  };

  // 处理导航
  const handleNavChange = (nav: string) => {
    onNavigate?.(nav);
  };

  const handleBreadcrumbClick = (page: string) => {
    onNavigate?.(page);
  };

  return (
    <div className={styles.page}>
      <Header activeNav="wordbooks" onNavChange={handleNavChange} />

      <Breadcrumb
        items={[
          { label: '首页', key: 'home', icon: 'home' },
          { label: '单词本', key: 'wordbooks', icon: 'bookmark' }
        ]}
        current="创建单词本"
        onNavigate={handleBreadcrumbClick}
      />

      <div className={styles.main}>
        <div className={styles.pageHeader}>
          <h1>创建单词本</h1>
          <p>通过AI分析文本内容，快速创建个性化单词本</p>
        </div>

        {/* 步骤指示器 */}
        {renderStepIndicator()}

        {/* 当前步骤内容 */}
        {currentStep === 'basic' && renderBasicStep()}
        {currentStep === 'import' && renderImportStep()}
        {currentStep === 'preview' && renderPreviewStep()}

        {/* 单词导入模态框 */}
        <WordImporterModal
          isOpen={showImporter}
          onClose={() => setShowImporter(false)}
          onSaveWords={handleWordsImported}
          saving={false}
        />
      </div>
    </div>
  );
};

export default CreateWordBookPageV2;
