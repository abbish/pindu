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
  
  const [wordBooks, setWordBooks] = useState<WordBookOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    loadWordBooks();
    setDefaultDates();
  }, []);

  const loadWordBooks = async () => {
    try {
      setLoading(true);
      setError(null);
      
      // Mock word books data - should be replaced with actual API call
      const mockBooks: WordBookOption[] = [
        {
          id: 1,
          name: '基础生活词汇',
          description: '日常生活中常用的基础英语单词',
          wordCount: 120,
          category: 'basic'
        },
        {
          id: 2,
          name: '动物世界',
          description: '各种动物的英文名称和相关词汇',
          wordCount: 80,
          category: 'animals'
        },
        {
          id: 3,
          name: '食物与饮料',
          description: '各种食物和饮料的英文表达',
          wordCount: 95,
          category: 'food'
        },
        {
          id: 4,
          name: '学校用品',
          description: '学习用品和教室物品的英文名称',
          wordCount: 65,
          category: 'school'
        },
        {
          id: 5,
          name: '颜色形状',
          description: '基础颜色和几何形状的英文表达',
          wordCount: 45,
          category: 'colors'
        },
        {
          id: 6,
          name: '家庭成员',
          description: '家庭成员称谓和关系词汇',
          wordCount: 30,
          category: 'family'
        }
      ];
      
      // Simulate API delay
      await new Promise(resolve => setTimeout(resolve, 500));
      setWordBooks(mockBooks);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载单词本失败');
    } finally {
      setLoading(false);
    }
  };

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
      
      // Mock API call to create plan
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      // TODO: Implement actual plan creation
      console.log('Creating plan:', formData);
      
      setSuccess(true);
    } catch (err) {
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
    setFormData({
      name: '',
      description: '',
      startDate: '',
      endDate: '',
      selectedBooks: []
    });
    setDefaultDates();
  };

  if (error && !loading) {
    return (
      <div className={styles.page}>
        <Header activeNav="plans" onNavChange={handleNavChange} />
        <main className={styles.main}>
          <div className={styles.error}>
            <div className={styles.errorIcon}>
              <i className="fas fa-exclamation-triangle" />
            </div>
            <p className={styles.errorText}>{error}</p>
            <div className={styles.errorActions}>
              <Button onClick={loadWordBooks}>重试</Button>
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