import React, { useState } from 'react';
import styles from './CreateWordBookPage.module.css';
import { 
  Header, 
  Breadcrumb,
  Button, 
  FormInput,
  ThemeSelector,
  WordImporter,
  CreateWordBookPreview
} from '../components';
import type { 
  ThemeOption,
  ImportMethod,
  ExtractedWord,
  CreateWordBookFormData
} from '../components';

export interface CreateWordBookPageProps {
  /** Navigation handler */
  onNavigate?: (page: string, params?: any) => void;
}

const DEFAULT_THEMES: ThemeOption[] = [
  { id: 'animals', name: '动物', icon: 'paw', color: 'primary' },
  { id: 'food', name: '食物', icon: 'utensils', color: 'orange' },
  { id: 'study', name: '学习', icon: 'graduation-cap', color: 'green' },
  { id: 'colors', name: '颜色', icon: 'palette', color: 'purple' },
  { id: 'family', name: '家庭', icon: 'home', color: 'blue' },
  { id: 'games', name: '游戏', icon: 'gamepad', color: 'pink' },
  { id: 'other', name: '其他', icon: 'star', color: 'yellow' }
];

/**
 * 创建单词本页面组件
 */
export const CreateWordBookPage: React.FC<CreateWordBookPageProps> = ({ 
  onNavigate 
}) => {
  const [formData, setFormData] = useState<CreateWordBookFormData>({
    name: '',
    description: '',
    selectedThemes: []
  });
  
  const [importMethod, setImportMethod] = useState<ImportMethod>('text');
  const [textContent, setTextContent] = useState('');
  const [selectedModel, setSelectedModel] = useState('deepseek-r1');
  const [extractedWords, setExtractedWords] = useState<ExtractedWord[]>([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleNavChange = (nav: string) => {
    onNavigate?.(nav);
  };

  const handleBreadcrumbClick = (page: string) => {
    onNavigate?.(page);
  };

  const handleBackClick = () => {
    onNavigate?.('wordbooks');
  };

  const handleFormChange = (field: keyof CreateWordBookFormData, value: any) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleThemeChange = (selectedThemes: string[]) => {
    handleFormChange('selectedThemes', selectedThemes);
  };

  const handleFileUpload = async (file: File) => {
    try {
      const text = await file.text();
      setTextContent(text);
      setImportMethod('text');
      
      // File content will be automatically analyzed by WordImporter component
    } catch (err) {
      setError('文件读取失败，请重试');
    }
  };

  const handleWordsExtracted = (words: ExtractedWord[]) => {
    setExtractedWords(words);
    
    // Auto-set name if empty
    if (!formData.name) {
      setFormData(prev => ({
        ...prev,
        name: '水果单词本'
      }));
    }
    
    // Auto-select food theme if not selected
    if (formData.selectedThemes.length === 0) {
      setFormData(prev => ({
        ...prev,
        selectedThemes: ['food']
      }));
    }
  };

  const handleWordToggle = (wordId: string) => {
    setExtractedWords(prev =>
      prev.map(word =>
        word.id === wordId ? { ...word, selected: !word.selected } : word
      )
    );
  };

  const handleSelectAll = (selected: boolean) => {
    setExtractedWords(prev =>
      prev.map(word => ({ ...word, selected }))
    );
  };

  const handleCreateWordBook = async () => {
    const selectedWords = extractedWords.filter(word => word.selected);
    
    if (!formData.name.trim()) {
      setError('请输入单词本名称');
      return;
    }
    
    if (selectedWords.length === 0) {
      setError('请至少选择一个单词');
      return;
    }

    setCreating(true);
    setError(null);

    try {
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      // Success - navigate to word books page
      onNavigate?.('wordbooks');
    } catch (err) {
      setError('创建单词本失败，请重试');
    } finally {
      setCreating(false);
    }
  };

  const handleSaveDraft = async () => {
    // TODO: Implement save draft functionality
    console.log('Save draft:', formData, extractedWords.filter(w => w.selected));
  };

  const selectedWords = extractedWords.filter(word => word.selected);
  const canCreate = formData.name.trim().length > 0 && selectedWords.length > 0 && !creating;

  return (
    <div className={styles.page}>
      <Header activeNav="wordbooks" onNavChange={handleNavChange} />
      
      <main className={styles.main}>
        {/* Breadcrumb */}
        <Breadcrumb
          items={[
            { label: '首页', key: 'home', icon: 'home' },
            { label: '单词本', key: 'wordbooks', icon: 'bookmark' }
          ]}
          current="创建单词本"
          onNavigate={handleBreadcrumbClick}
        />

        {/* Page Header */}
        <section className={styles.pageHeader}>
          <div className={styles.headerContent}>
            <div className={styles.headerInfo}>
              <h2 className={styles.pageTitle}>创建单词本</h2>
              <p className={styles.pageDescription}>通过文本导入或上传文件创建专属的单词本</p>
            </div>
            <Button
              variant="secondary"
              onClick={handleBackClick}
            >
              <i className="fas fa-arrow-left" />
              <span style={{ marginLeft: '8px' }}>返回</span>
            </Button>
          </div>
        </section>

        {/* Error Message */}
        {error && (
          <div className={styles.errorMessage}>
            <i className="fas fa-exclamation-triangle" />
            <span>{error}</span>
            <button onClick={() => setError(null)}>
              <i className="fas fa-times" />
            </button>
          </div>
        )}

        {/* Main Content */}
        <div className={styles.contentLayout}>
          {/* Form Section */}
          <div className={styles.formSection}>
            {/* Basic Information */}
            <div className={styles.formCard}>
              <h3 className={styles.cardTitle}>基本信息</h3>
              
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
                themes={DEFAULT_THEMES}
                selectedThemes={formData.selectedThemes}
                onSelectionChange={handleThemeChange}
                multiple={false}
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

            {/* Word Importer */}
            <div className={styles.formCard}>
              <WordImporter
                method={importMethod}
                onMethodChange={setImportMethod}
                textContent={textContent}
                onTextChange={setTextContent}
                onFileUpload={handleFileUpload}
                selectedModel={selectedModel}
                onModelChange={setSelectedModel}
                extractedWords={extractedWords}
                onWordsExtracted={handleWordsExtracted}
                onWordToggle={handleWordToggle}
                onSelectAll={handleSelectAll}
                showSaveAction={false}
                title="导入单词内容"
                description="通过文本分析或文件上传创建单词本的初始内容"
                onSelectedWordsChange={(words) => {
                  // 这里可以实时更新预览区域显示的选中单词
                  console.log('Selected words changed:', words);
                }}
              />
            </div>
          </div>

          {/* Preview Section */}
          <div className={styles.previewSection}>
            <CreateWordBookPreview
              formData={formData}
              availableThemes={DEFAULT_THEMES}
              selectedWords={selectedWords}
              onCreateWordBook={handleCreateWordBook}
              onSaveDraft={handleSaveDraft}
              canCreate={canCreate}
              creating={creating}
            />
          </div>
        </div>
      </main>
    </div>
  );
};

export default CreateWordBookPage;