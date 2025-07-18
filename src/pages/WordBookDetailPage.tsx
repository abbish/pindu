import React, { useState, useEffect } from 'react';
import {
  Header,
  Breadcrumb,
  Button,

  WordListTable,

  EditWordBookModal,
  DeleteWordBookModal,
  EditWordModal,
  useToast,
  type WordListDetail,
  type ExtractedWord,

} from '../components';
import { BatchDeleteModal } from '../components/BatchDeleteModal';
import { WordImporterModalV2 } from '../components/WordImporterModal/WordImporterModalV2';
import { StatusTag } from '../components/StatusTag';
import { WordBookService } from '../services';
import { type WordBook, type Word, type WordTypeDistribution, type UpdateWordBookRequest, type UpdateWordRequest } from '../types';
import styles from './WordBookDetailPage.module.css';



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
  // 状态管理
  const [wordBookData, setWordBookData] = useState<WordBook | null>(null);
  const [words, setWords] = useState<WordListDetail[]>([]);
  const [statistics, setStatistics] = useState<WordTypeDistribution | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal states
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showImporterModal, setShowImporterModal] = useState(false);
  const [showEditWordModal, setShowEditWordModal] = useState(false);
  const [editLoading, setEditLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [editWordLoading, setEditWordLoading] = useState(false);
  const [currentEditingWord, setCurrentEditingWord] = useState<Word | null>(null);

  // 批量删除相关状态
  const [showBatchDeleteModal, setShowBatchDeleteModal] = useState(false);
  const [wordsToDelete, setWordsToDelete] = useState<WordListDetail[]>([]);
  const [batchDeleteLoading, setBatchDeleteLoading] = useState(false);

  // 创建服务实例
  const wordbookService = new WordBookService();
  const { showToast } = useToast();

  // Word Importer states
  const [saving, setSaving] = useState(false);

  // Word list states
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize] = useState(20);
  const [totalWords, setTotalWords] = useState(0);
  const [wordsLoading, setWordsLoading] = useState(false);

  // 加载单词本数据
  const loadWordBookData = async () => {
    if (!id) {
      setError('单词本ID不能为空');
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // 获取单词本详情
      const wordBookResult = await wordbookService.getWordBookById(id);
      if (wordBookResult.success && wordBookResult.data) {
        setWordBookData(wordBookResult.data);
      } else {
        const errorMessage = wordBookResult.success ? '获取单词本详情失败' : wordBookResult.error || '获取单词本详情失败';
        throw new Error(errorMessage);
      }

      // 获取单词列表
      await loadWords();

      // 获取统计信息
      try {
        const statsResult = await wordbookService.getWordBookTypeStatistics(id);
        if (statsResult.success && statsResult.data) {
          setStatistics(statsResult.data);
        }
      } catch (statsError) {
        console.warn('获取统计信息失败:', statsError);
        // 统计信息失败不影响主要功能，只记录警告
      }

    } catch (err) {
      console.error('获取数据失败:', err);
      setError('获取数据失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  // 数据获取
  useEffect(() => {
    loadWordBookData();
  }, [id]);

  // 加载单词列表
  const loadWords = async (page: number = currentPage) => {
    if (!id) return;

    try {
      setWordsLoading(true);

      const pagination = { page, page_size: pageSize };

      const wordsResult = await wordbookService.getWordsByBookId(id, undefined, pagination);

      if (wordsResult.success && wordsResult.data) {
        // 转换 Word 类型到 WordListDetail 类型
        const wordListDetails: WordListDetail[] = wordsResult.data.data.map((word: Word) => ({
          id: word.id,
          word: word.word,
          meaning: word.meaning,
          partOfSpeech: (word.part_of_speech || 'n.') as WordListDetail['partOfSpeech'],
          ipa: word.ipa || '',
          syllables: word.syllables || ''
        }));
        setWords(wordListDetails);
        setTotalWords(wordsResult.data.total);
        setCurrentPage(wordsResult.data.page);
      }
    } catch (error) {
      console.error('加载单词列表失败:', error);
      showToast('加载单词列表失败', 'error');
    } finally {
      setWordsLoading(false);
    }
  };

  // 分页处理
  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    loadWords(page);
  };

  // 刷新数据函数
  const refreshData = async () => {
    if (!id || !wordBookData) return;

    try {
      // 重新加载单词列表
      await loadWords();

      // 获取统计信息
      const statsResult = await wordbookService.getWordBookTypeStatistics(id);
      if (statsResult.success && statsResult.data) {
        setStatistics(statsResult.data);
      }

      // 更新单词本数据中的单词数量
      const updatedWordBookResult = await wordbookService.getWordBookById(id);
      if (updatedWordBookResult.success && updatedWordBookResult.data) {
        setWordBookData(updatedWordBookResult.data);
      }
    } catch (error) {
      console.error('刷新数据失败:', error);
    }
  };

  const handleNavChange = (page: string) => {
    onNavigate?.(page);
  };

  const handleBreadcrumbClick = (key: string) => {
    onNavigate?.(key);
  };

  const handleBackClick = () => {
    onNavigate?.('wordbooks');
  };





  const handleSaveWords = async (selectedWords: ExtractedWord[]) => {
    if (!id || !wordBookData) return;

    setSaving(true);
    try {
      // 转换为AnalyzedWord格式
      const analyzedWords = selectedWords.map(word => {
        const rawPos = word.phonics?.pos_abbreviation || word.partOfSpeech || 'n.';
        const standardizedPos = standardizePOS(rawPos);

        return {
          word: word.word,
          meaning: word.meaning,
          part_of_speech: standardizedPos,
          // 自然拼读分析字段
          ipa: word.phonics?.ipa || '',
          syllables: word.phonics?.syllables || '',
          phonics_rule: word.phonics?.phonics_rule || '',
          analysis_explanation: word.phonics?.analysis_explanation || '',
          pos_abbreviation: standardizedPos,
          pos_english: word.phonics?.pos_english || '',
          pos_chinese: word.phonics?.pos_chinese || ''
        };
      });

      // 使用新的批量保存API，支持查重和更新
      const result = await wordbookService.createWordBookFromAnalysis({
        title: wordBookData.title, // 使用现有单词本的标题
        description: wordBookData.description || '',
        words: analyzedWords,
        book_id: wordBookData.id // 指定现有单词本ID
      });

      if (result.success) {
        const { added_count, updated_count } = result.data;

        // 刷新单词列表和统计数据
        await refreshWordList();

        // 关闭Modal并清除状态
        setShowImporterModal(false);

        // 显示成功消息
        const message = `成功处理 ${selectedWords.length} 个单词（新增: ${added_count}, 更新: ${updated_count}）`;
        showToast(message, 'success');
      } else {
        throw new Error(result.error);
      }

    } catch (error) {
      console.error('Error saving words:', error);
      showToast('保存单词失败', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handlePlayPronunciation = (word: WordListDetail) => {
    console.log('Playing pronunciation for:', word.word);
    // TODO: Implement text-to-speech functionality
  };

  const handleEditWord = async (word: WordListDetail) => {
    try {
      // 获取完整的单词数据
      const wordsResult = await wordbookService.getWordsByBookId(wordBookData!.id);
      if (wordsResult.success && wordsResult.data) {
        const fullWord = wordsResult.data.data.find(w => w.id === word.id);
        if (fullWord) {
          setCurrentEditingWord(fullWord);
          setShowEditWordModal(true);
        } else {
          showToast('未找到单词数据', 'error');
        }
      } else {
        showToast('获取单词数据失败', 'error');
      }
    } catch (error) {
      console.error('获取单词详情失败:', error);
      showToast('获取单词详情失败', 'error');
    }
  };

  const handleDeleteWord = async (word: WordListDetail) => {
    setWordsToDelete([word]);
    setShowBatchDeleteModal(true);
  };

  // 批量删除处理函数
  const handleBatchDelete = async (words: WordListDetail[]) => {
    setWordsToDelete(words);
    setShowBatchDeleteModal(true);
  };

  // 确认删除
  const handleConfirmBatchDelete = async () => {
    if (wordsToDelete.length === 0) return;

    try {
      setBatchDeleteLoading(true);

      // 逐个删除单词
      for (const word of wordsToDelete) {
        const result = await wordbookService.deleteWord(word.id);
        if (!result.success) {
          throw new Error(`删除单词"${word.word}"失败`);
        }
      }

      showToast(
        wordsToDelete.length === 1
          ? '单词删除成功'
          : `成功删除 ${wordsToDelete.length} 个单词`,
        'success'
      );

      setShowBatchDeleteModal(false);
      setWordsToDelete([]);

      // 重新加载数据
      await refreshData();
    } catch (error) {
      console.error('删除单词失败:', error);
      showToast(
        error instanceof Error ? error.message : '删除单词失败',
        'error'
      );
    } finally {
      setBatchDeleteLoading(false);
    }
  };

  // 保存编辑单词
  const handleSaveEditWord = async (wordId: number, data: UpdateWordRequest) => {
    try {
      setEditWordLoading(true);
      const result = await wordbookService.updateWord(wordId, data);
      if (result.success) {
        showToast('单词更新成功', 'success');
        setShowEditWordModal(false);
        setCurrentEditingWord(null);
        // 重新加载数据
        await refreshData();
      } else {
        showToast('更新单词失败', 'error');
      }
    } catch (error) {
      console.error('更新单词失败:', error);
      showToast('更新单词失败', 'error');
    } finally {
      setEditWordLoading(false);
    }
  };

  // 编辑单词本处理函数
  const handleEditWordBook = () => {
    setShowEditModal(true);
  };

  const handleSaveWordBook = async (data: UpdateWordBookRequest) => {
    if (!wordBookData) return;

    setEditLoading(true);
    try {
      await wordbookService.updateWordBook(wordBookData.id, data);

      // 重新获取最新的单词本数据（包括updated_at字段）
      await loadWordBookData();

      showToast('单词本信息更新成功', 'success');
      setShowEditModal(false);
    } catch (error) {
      console.error('更新单词本失败:', error);
      showToast('更新单词本失败', 'error');
    } finally {
      setEditLoading(false);
    }
  };

  // 删除单词本处理函数
  const handleDeleteWordBook = () => {
    setShowDeleteModal(true);
  };

  const handleConfirmDelete = async () => {
    if (!wordBookData) return;

    setDeleteLoading(true);
    try {
      await wordbookService.deleteWordBook(wordBookData.id);
      showToast('单词本已删除', 'success');

      // 返回单词本列表
      if (onNavigate) {
        onNavigate('wordbooks');
      }
    } catch (error) {
      console.error('删除单词本失败:', error);
      showToast('删除单词本失败', 'error');
    } finally {
      setDeleteLoading(false);
    }
  };

  // 刷新单词列表
  const refreshWordList = async () => {
    if (!wordBookData) return;

    try {
      // 重新加载单词列表
      const pagination = { page: currentPage, page_size: pageSize };

      const [wordsResult, statsResult] = await Promise.all([
        wordbookService.getWordsByBookId(wordBookData.id, undefined, pagination),
        wordbookService.getWordBookTypeStatistics(wordBookData.id)
      ]);

      if (wordsResult.success && wordsResult.data) {
        const wordListDetails: WordListDetail[] = wordsResult.data.data.map(word => ({
          id: word.id,
          word: word.word,
          meaning: word.meaning,
          ipa: word.ipa || '',
          syllables: word.syllables || '',
          partOfSpeech: (word.part_of_speech as any) || 'n.'
        }));
        setWords(wordListDetails);
        setTotalWords(wordsResult.data.total);
        setCurrentPage(wordsResult.data.page);
      }

      if (statsResult.success && statsResult.data) {
        setStatistics(statsResult.data);
      }

      // 更新单词本统计
      await wordbookService.updateAllWordBookCounts();

      // 重新获取单词本详情以更新统计数据
      const detailResult = await wordbookService.getWordBookById(wordBookData.id);
      if (detailResult.success && detailResult.data) {
        setWordBookData(detailResult.data);
      }
    } catch (error) {
      console.error('刷新数据失败:', error);
    }
  };

  // 打开补充单词Modal
  const handleOpenImporter = () => {
    setShowImporterModal(true);
  };

  // 关闭补充单词Modal
  const handleCloseImporter = () => {
    setShowImporterModal(false);
  };

  // 加载状态
  if (loading) {
    return (
      <div className={styles.page}>
        <Header activeNav="wordbooks" onNavChange={handleNavChange} />
        <main className={styles.main}>
          <div className={styles.loading}>
            <i className="fas fa-spinner fa-spin" />
            <span>加载中...</span>
          </div>
        </main>
      </div>
    );
  }

  // 错误状态
  if (error || !wordBookData) {
    return (
      <div className={styles.page}>
        <Header activeNav="wordbooks" onNavChange={handleNavChange} />
        <main className={styles.main}>
          <div className={styles.error}>
            <i className="fas fa-exclamation-triangle" />
            <span>{error || '单词本不存在'}</span>
            <Button variant="primary" onClick={handleBackClick}>
              返回单词本列表
            </Button>
          </div>
        </main>
      </div>
    );
  }



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
              <div className={styles.titleRow}>
                <h2>{wordBookData.title}</h2>
                <StatusTag status={wordBookData.status} size="medium" />
              </div>
              <p>{wordBookData.description || '暂无描述'}</p>

              {/* 主题标签 */}
              {wordBookData.theme_tags && wordBookData.theme_tags.length > 0 && (
                <div className={styles.themeTags}>
                  {wordBookData.theme_tags.map((tag) => (
                    <span key={tag.id} className={styles.themeTag}>
                      <span className={styles.tagIcon}>{tag.icon}</span>
                      <span className={styles.tagName}>{tag.name}</span>
                    </span>
                  ))}
                </div>
              )}

              <div className={styles.headerMeta}>
                <span className={styles.metaItem}>
                  <i className="fas fa-calendar-plus" />
                  创建于 {wordBookData.created_at ? new Date(wordBookData.created_at).toLocaleDateString() : '未知'}
                </span>
                <span className={styles.metaItem}>
                  <i className="fas fa-edit" />
                  更新于 {wordBookData.updated_at ? new Date(wordBookData.updated_at).toLocaleDateString() : '未更新'}
                </span>
              </div>
            </div>
            <div className={styles.headerActions}>
              <Button
                variant="primary"
                onClick={handleEditWordBook}
              >
                <i className="fas fa-edit" />
                编辑
              </Button>
              <Button
                variant="danger"
                onClick={handleDeleteWordBook}
              >
                <i className="fas fa-trash" />
                删除
              </Button>
            </div>
          </div>
        </section>

        {/* Statistics Section */}
        <section className={styles.statisticsSection}>
          <div className={styles.statisticsGrid}>
            <div className={styles.statCard}>
              <div className={styles.statIcon}>
                <i className="fas fa-book" />
              </div>
              <div className={styles.statContent}>
                <div className={styles.statValue}>{wordBookData.total_words || 0}</div>
                <div className={styles.statLabel}>总单词数</div>
              </div>
            </div>

            <div className={styles.statCard}>
              <div className={styles.statIcon}>
                <i className="fas fa-cube" />
              </div>
              <div className={styles.statContent}>
                <div className={styles.statValue}>{statistics?.nouns || 0}</div>
                <div className={styles.statLabel}>名词</div>
              </div>
            </div>

            <div className={styles.statCard}>
              <div className={styles.statIcon}>
                <i className="fas fa-running" />
              </div>
              <div className={styles.statContent}>
                <div className={styles.statValue}>{statistics?.verbs || 0}</div>
                <div className={styles.statLabel}>动词</div>
              </div>
            </div>

            <div className={styles.statCard}>
              <div className={styles.statIcon}>
                <i className="fas fa-palette" />
              </div>
              <div className={styles.statContent}>
                <div className={styles.statValue}>{statistics?.adjectives || 0}</div>
                <div className={styles.statLabel}>形容词</div>
              </div>
            </div>

            <div className={styles.statCard}>
              <div className={styles.statIcon}>
                <i className="fas fa-ellipsis-h" />
              </div>
              <div className={styles.statContent}>
                <div className={styles.statValue}>{statistics?.others || 0}</div>
                <div className={styles.statLabel}>其他</div>
              </div>
            </div>
          </div>
        </section>

        {/* Word List Section */}
        <div className={styles.wordListSection}>
          <WordListTable
            words={words}
            onPlayPronunciation={handlePlayPronunciation}
            onEditWord={handleEditWord}
            onDeleteWord={handleDeleteWord}
            onBatchDelete={handleBatchDelete}
            onAddWords={handleOpenImporter}
            loading={wordsLoading}
            pagination={{
              current: currentPage,
              pageSize: pageSize,
              total: totalWords,
              onChange: handlePageChange
            }}
          />
        </div>
      </main>

      {/* Edit Word Book Modal */}
      <EditWordBookModal
        isOpen={showEditModal}
        onClose={() => setShowEditModal(false)}
        wordBook={wordBookData}
        onSave={handleSaveWordBook}
        saving={editLoading}
      />

      {/* Delete Word Book Modal */}
      <DeleteWordBookModal
        isOpen={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        wordBook={wordBookData}
        onDelete={handleConfirmDelete}
        deleting={deleteLoading}
      />

      {/* Edit Word Modal */}
      <EditWordModal
        isOpen={showEditWordModal}
        onClose={() => {
          setShowEditWordModal(false);
          setCurrentEditingWord(null);
        }}
        word={currentEditingWord}
        onSave={handleSaveEditWord}
        saving={editWordLoading}
      />

      {/* Word Importer Modal V2 */}
      <WordImporterModalV2
        isOpen={showImporterModal}
        onClose={handleCloseImporter}
        onSaveWords={handleSaveWords}
        saving={saving}
      />

      {/* Batch Delete Modal */}
      <BatchDeleteModal
        isOpen={showBatchDeleteModal}
        onClose={() => {
          setShowBatchDeleteModal(false);
          setWordsToDelete([]);
        }}
        onConfirm={handleConfirmBatchDelete}
        words={wordsToDelete}
        deleting={batchDeleteLoading}
      />
    </div>
  );
};

export default WordBookDetailPage;