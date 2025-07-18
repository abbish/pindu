import React, { useState, useEffect } from 'react';
import styles from './CreatePlanPage.module.css';
import { 
  Header, 
  Breadcrumb,
  Button, 
  FormInput,
  WordBookSelector,
  PlanPreview
} from '../components';
import type { PlanFormData, WordBookOption } from '../components';
import { WordBookService } from '../services/wordbookService';
import { StudyService } from '../services/studyService';
import { useAsyncData } from '../hooks/useAsyncData';
import { showErrorMessage } from '../utils/errorHandler';

export interface CreatePlanPageProps {
  /** Navigation handler */
  onNavigate?: (page: string) => void;
}

/**
 * Create Study Plan page component
 */
export const CreatePlanPage: React.FC<CreatePlanPageProps> = ({ onNavigate }) => {
  const [formData, setFormData] = useState<PlanFormData>({
    name: '',
    description: '',
    startDate: '',
    endDate: '',
    selectedBooks: []
  });

  const wordBookService = new WordBookService();
  const studyService = new StudyService();
  const { data: rawWordBooks, loading, error: loadError, refresh } = useAsyncData(async () => {
    const result = await wordBookService.getAllWordBooks();
    if (result.success) {
      return result.data;
    } else {
      throw new Error(result.error || '获取单词本列表失败');
    }
  });
  const [creating, setCreating] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, setCreatedPlanId] = useState<number | null>(null);

  useEffect(() => {
    setDefaultDates();
  }, []);

  // Convert database word books to component format
  const wordBooks: WordBookOption[] = (rawWordBooks && Array.isArray(rawWordBooks)) ? rawWordBooks.map(book => ({
    id: book.id,
    name: book.title,
    description: book.description,
    wordCount: book.total_words,
    category: book.icon_color // Using icon_color as category for now
  })) : [];

  const setDefaultDates = () => {
    const today = new Date();
    const nextMonth = new Date(today);
    nextMonth.setMonth(today.getMonth() + 1);
    
    setFormData(prev => ({
      ...prev,
      startDate: today.toISOString().split('T')[0],
      endDate: nextMonth.toISOString().split('T')[0]
    }));
  };

  const handleInputChange = (field: keyof PlanFormData) => (value: string) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleBooksChange = (selectedIds: number[]) => {
    setFormData(prev => ({
      ...prev,
      selectedBooks: selectedIds
    }));
  };

  const handleNavChange = (nav: string) => {
    onNavigate?.(nav);
  };

  const handleBack = () => {
    onNavigate?.('plans');
  };

  const handleBreadcrumbClick = (page: string) => {
    onNavigate?.(page);
  };

  const canCreatePlan = () => {
    return (
      formData.name.trim() !== '' &&
      formData.startDate !== '' &&
      formData.endDate !== '' &&
      formData.selectedBooks.length > 0 &&
      new Date(formData.endDate) > new Date(formData.startDate)
    );
  };

  const handleCreatePlan = async () => {
    if (!canCreatePlan()) return;

    try {
      setCreating(true);
      setError(null);

      // Collect all words from selected books
      const allWordIds: number[] = [];
      for (const bookId of formData.selectedBooks) {
        const result = await wordBookService.getWordsByBookId(bookId);
        if (result.success && result.data) {
          allWordIds.push(...result.data.data.map(word => word.id));
        }
      }

      if (allWordIds.length === 0) {
        throw new Error('所选单词本中没有单词，请选择包含单词的单词本');
      }

      // Create the study plan using real API
      const createRequest = {
        name: formData.name.trim(),
        description: formData.description?.trim() || '',
        word_ids: allWordIds,
        mastery_level: 1, // Default mastery level
      };

      console.log('Creating study plan:', createRequest);
      const planResult = await studyService.createStudyPlan(createRequest);

      if (planResult.success) {
        console.log('Created plan with ID:', planResult.data);
        setCreatedPlanId(planResult.data);
        setSuccess(true);
      } else {
        throw new Error(planResult.error || '创建学习计划失败');
      }
    } catch (err) {
      console.error('Failed to create study plan:', err);
      setError(err instanceof Error ? err.message : '创建计划失败');
    } finally {
      setCreating(false);
    }
  };

  const handleSaveDraft = async () => {
    try {
      // TODO: Implement save draft functionality
      console.log('Saving draft:', formData);
      // Show success message
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存草稿失败');
    }
  };

  const handleStartStudy = () => {
    // Navigate to the newly created plan
    onNavigate?.('plans');
  };

  const handleCreateAnother = () => {
    setSuccess(false);
    setCreatedPlanId(null);
    setError(null);
    setFormData({
      name: '',
      description: '',
      startDate: '',
      endDate: '',
      selectedBooks: []
    });
    setDefaultDates();
  };

  if (loadError && !loading) {
    return (
      <div className={styles.page}>
        <Header activeNav="plans" onNavChange={handleNavChange} />
        <main className={styles.main}>
          <div className={styles.error}>
            <div className={styles.errorIcon}>
              <i className="fas fa-exclamation-triangle" />
            </div>
            <p className={styles.errorText}>{showErrorMessage(loadError)}</p>
            <div className={styles.errorActions}>
              <Button onClick={refresh}>重试</Button>
              <Button variant="secondary" onClick={handleBack}>返回</Button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (success) {
    return (
      <div className={styles.page}>
        <Header activeNav="plans" onNavChange={handleNavChange} />
        <main className={styles.main}>
          <div className={styles.success}>
            <div className={styles.successIcon}>
              <i className="fas fa-check-circle" />
            </div>
            <p className={styles.successText}>学习计划创建成功！</p>
            <div className={styles.successActions}>
              <Button onClick={handleStartStudy}>开始学习</Button>
              <Button variant="secondary" onClick={handleCreateAnother}>
                再创建一个
              </Button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <Header activeNav="plans" onNavChange={handleNavChange} />
      
      <main className={styles.main}>
        {/* Breadcrumb */}
        <Breadcrumb
          items={[
            { label: '首页', key: 'home', icon: 'home' },
            { label: '学习计划', key: 'plans', icon: 'tasks' }
          ]}
          current="创建计划"
          onNavigate={handleBreadcrumbClick}
        />

        {/* Page Header */}
        <section className={styles.pageHeader}>
          <div className={styles.headerContent}>
            <div className={styles.headerInfo}>
              <h2>创建学习计划</h2>
              <p>制定个性化的单词学习计划，让学习更有条理</p>
            </div>
            <button className={styles.backButton} onClick={handleBack}>
              <i className="fas fa-arrow-left" />
              <span>返回</span>
            </button>
          </div>
        </section>

        {/* Form Layout */}
        <div className={styles.formLayout}>
          {/* Form Section */}
          <div className={styles.formSection}>
            <h3 className={styles.sectionTitle}>计划基本信息</h3>
            
            {/* Error Message */}
            {error && (
              <div className={styles.errorBanner}>
                <div className={styles.errorIcon}>
                  <i className="fas fa-exclamation-triangle" />
                </div>
                <p>{error}</p>
              </div>
            )}
            
            {/* Basic Info */}
            <div className={styles.basicInfo}>
              <FormInput
                label="计划名称"
                name="planName"
                value={formData.name}
                placeholder="请输入学习计划名称"
                helperText="给你的学习计划起一个有趣的名字"
                required
                onChange={handleInputChange('name')}
              />
              
              <FormInput
                label="计划描述"
                name="planDescription"
                type="textarea"
                value={formData.description}
                placeholder="描述一下这个学习计划的目标和内容"
                rows={3}
                onChange={handleInputChange('description')}
              />
            </div>

            {/* Schedule Settings */}
            <div className={styles.scheduleSettings}>
              <h4 className={styles.scheduleTitle}>学习安排</h4>
              
              <div className={styles.dateFields}>
                <FormInput
                  label="开始日期"
                  name="startDate"
                  type="date"
                  value={formData.startDate}
                  required
                  onChange={handleInputChange('startDate')}
                />
                
                <FormInput
                  label="结束日期"
                  name="endDate"
                  type="date"
                  value={formData.endDate}
                  required
                  onChange={handleInputChange('endDate')}
                />
              </div>
            </div>

            {/* Word Book Selection */}
            <WordBookSelector
              books={wordBooks}
              selectedBooks={formData.selectedBooks}
              onSelectionChange={handleBooksChange}
              loading={loading}
            />
          </div>

          {/* Preview Section */}
          <PlanPreview
            formData={formData}
            wordBooks={wordBooks}
            onCreatePlan={handleCreatePlan}
            onSaveDraft={handleSaveDraft}
            canCreate={canCreatePlan()}
            loading={creating}
          />
        </div>
      </main>
    </div>
  );
};

export default CreatePlanPage;