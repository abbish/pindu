import React, { useState } from 'react';
import { 
  Header,
  Breadcrumb,
  Button,
  WordBookHeader,
  WordListTable,
  WordImporter,
  type WordListDetail,
  type ImportMethod,
  type ExtractedWord
} from '../components';
import styles from './WordBookDetailPage.module.css';

export interface WordBookDetailPageProps {
  /** 单词本ID */
  id?: number;
  /** Navigation handler */
  onNavigate?: (page: string, params?: any) => void;
}

/**
 * 单词本详情页面
 */
export const WordBookDetailPage: React.FC<WordBookDetailPageProps> = ({ 
  id,
  onNavigate 
}) => {
  // Mock data for WordBookHeader
  const [wordBookData] = useState({
    id: id || 1,
    title: '水果单词本',
    description: '学习各种水果的英文单词',
    theme: {
      id: 'primary',
      name: '青色',
      icon: 'bookmark',
      color: 'primary' as const
    },
    createdAt: '2024-01-15',
    lastStudied: '2024-01-20',
    studyCount: 15,
    stats: {
      totalWords: 24,
      nouns: 18,
      verbs: 4,
      adjectives: 2
    }
  });

  // Mock data for WordListTable
  const [words] = useState<WordListDetail[]>([
    { id: 1, word: 'apple', meaning: '苹果', partOfSpeech: 'n.', phonetic: '/ˈæpl/' },
    { id: 2, word: 'banana', meaning: '香蕉', partOfSpeech: 'n.', phonetic: '/bəˈnænə/' },
    { id: 3, word: 'orange', meaning: '橙子', partOfSpeech: 'n.', phonetic: '/ˈɔːrɪndʒ/' },
    { id: 4, word: 'strawberry', meaning: '草莓', partOfSpeech: 'n.', phonetic: '/ˈstrɔːbəri/' },
    { id: 5, word: 'watermelon', meaning: '西瓜', partOfSpeech: 'n.', phonetic: '/ˈwɔːtərmelən/' },
    { id: 6, word: 'grape', meaning: '葡萄', partOfSpeech: 'n.', phonetic: '/ɡreɪp/' }
  ]);

  // Word Importer states
  const [importMethod, setImportMethod] = useState<ImportMethod>('text');
  const [textContent, setTextContent] = useState('');
  const [selectedModel, setSelectedModel] = useState('gpt-4');
  const [extractedWords, setExtractedWords] = useState<ExtractedWord[]>([]);
  const [saving, setSaving] = useState(false);

  // Word list states
  const [searchTerm, setSearchTerm] = useState('');

  const handleNavChange = (page: string) => {
    onNavigate?.(page);
  };

  const handleBreadcrumbClick = (key: string) => {
    onNavigate?.(key);
  };

  const handleBackClick = () => {
    onNavigate?.('wordbooks');
  };

  const handleFileUpload = (file: File) => {
    console.log('File uploaded:', file.name);
    // TODO: Implement file upload logic
  };

  const handleWordsExtracted = (words: ExtractedWord[]) => {
    setExtractedWords(words);
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

  const handleSaveWords = async (selectedWords: ExtractedWord[]) => {
    setSaving(true);
    try {
      console.log('Saving words to word book:', selectedWords);
      
      // Simulate API call to add words to the word book
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // TODO: Update the word list with new words
      // TODO: Update word book statistics
      
      // Clear the importer after successful save and reset to import step
      setExtractedWords([]);
      setTextContent('');
      
      console.log('Words successfully added to word book');
    } catch (error) {
      console.error('Error saving words:', error);
    } finally {
      setSaving(false);
    }
  };

  const handlePlayPronunciation = (word: WordListDetail) => {
    console.log('Playing pronunciation for:', word.word);
    // TODO: Implement text-to-speech functionality
  };

  const handleEditWord = (word: WordListDetail) => {
    console.log('Editing word:', word);
    // TODO: Implement word editing functionality
  };

  const handleDeleteWord = (word: WordListDetail) => {
    console.log('Deleting word:', word);
    // TODO: Implement word deletion functionality
  };

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
          current={wordBookData.title}
          onNavigate={handleBreadcrumbClick}
        />

        {/* Page Header */}
        <section className={styles.pageHeader}>
          <div className={styles.headerContent}>
            <div className={styles.headerInfo}>
              <h2 className={styles.pageTitle}>{wordBookData.title}</h2>
              <p className={styles.pageDescription}>{wordBookData.description}</p>
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

        {/* Word Book Header */}
        <WordBookHeader
          wordBook={wordBookData}
          onEdit={() => console.log('Edit word book')}
          onDelete={() => console.log('Delete word book')}
          onShare={() => console.log('Share word book')}
        />

        {/* Main Content - 2 Column Layout */}
        <div className={styles.contentGrid}>
          {/* Left Column - Word List */}
          <div className={styles.leftColumn}>
            <WordListTable
              words={words}
              searchTerm={searchTerm}
              onSearchChange={setSearchTerm}
              onPlayPronunciation={handlePlayPronunciation}
              onEditWord={handleEditWord}
              onDeleteWord={handleDeleteWord}
              loading={false}
            />
          </div>

          {/* Right Column - Word Importer */}
          <div className={styles.rightColumn}>
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
              onSaveWords={handleSaveWords}
              saving={saving}
              title="补充单词"
              description="通过分析文本内容导入新单词到当前单词本"
              saveButtonText="添加到单词本"
            />
          </div>
        </div>
      </main>
    </div>
  );
};

export default WordBookDetailPage;