import React, { useState, useEffect } from 'react';
import styles from './CreatePlanPageV2.module.css';
import {
  Header,
  Breadcrumb,
  Button,
  FormInput,
  WordBookSelector,
  AIModelSelector,
  PlanningProgress,
  StudySchedulePreview
} from '../components';
import type { WordBookOption } from '../components';
import { WordBookService } from '../services/wordbookService';
import { StudyService } from '../services/studyService';
import { useAsyncData } from '../hooks/useAsyncData';
import { useToast } from '../components';
import type { 
  StudyPlanScheduleRequest, 
  StudyPlanAIResult, 
  IntensityLevel,
  StudyPlanStatus
} from '../types';

export interface CreatePlanPageV2Props {
  /** Navigation handler */
  onNavigate?: (page: string, params?: any) => void;
}

// 步骤类型
type Step = 'basic' | 'planning' | 'confirmation';

// 表单数据类型
interface FormData {
  name: string;
  description: string;
  intensityLevel: IntensityLevel;
  studyPeriodDays: number;
  reviewFrequency: number;
  startDate: string;
  selectedBooks: number[];
  selectedModel?: number;
}

/**
 * 创建学习计划页面 V2 - 分步骤AI规划版本
 */
export const CreatePlanPageV2: React.FC<CreatePlanPageV2Props> = ({ onNavigate }) => {
  const { showToast } = useToast();
  const wordBookService = new WordBookService();
  const studyService = new StudyService();

  // 步骤状态
  const [currentStep, setCurrentStep] = useState<Step>('basic');
  
  // 表单数据
  const [formData, setFormData] = useState<FormData>({
    name: '',
    description: '',
    intensityLevel: 'normal',
    studyPeriodDays: 14,
    reviewFrequency: 4,
    startDate: '',
    selectedBooks: [],
  });

  // AI规划结果
  const [aiResult, setAiResult] = useState<StudyPlanAIResult | null>(null);
  
  // 状态管理
  const [planning, setPlanning] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [abortController, setAbortController] = useState<AbortController | null>(null);

  // 格式化学习周期显示文本
  const formatStudyPeriod = (days: number): string => {
    switch (days) {
      case 1: return '1天 (强化突击)';
      case 3: return '3天 (短期集中)';
      case 7: return '1周 (7天)';
      case 14: return '2周 (14天)';
      case 28: return '4周 (28天)';
      default: return `${days} 天`;
    }
  };

  // 获取单词本数据
  const { data: rawWordBooks, loading: loadingBooks, error: loadError } = useAsyncData(async () => {
    const result = await wordBookService.getAllWordBooks();
    if (result.success) {
      return result.data.filter(book => book.status === 'normal'); // 只显示正常状态的单词本
    } else {
      throw new Error(result.error || '获取单词本列表失败');
    }
  });

  // 转换单词本数据格式
  const wordBooks: WordBookOption[] = (rawWordBooks && Array.isArray(rawWordBooks)) ? rawWordBooks.map(book => ({
    id: book.id,
    name: book.title,
    description: book.description,
    wordCount: book.total_words,
    category: book.icon_color
  })) : [];

  useEffect(() => {
    setDefaultDate();
  }, []);

  const setDefaultDate = () => {
    const today = new Date();
    setFormData(prev => ({
      ...prev,
      startDate: today.toISOString().split('T')[0]
    }));
  };

  // 表单验证
  const isBasicFormValid = () => {
    return (
      formData.name.trim().length > 0 &&
      formData.startDate !== '' &&
      formData.selectedBooks.length > 0
    );
  };

  // 处理表单变化
  const handleFormChange = (field: keyof FormData, value: string | number | number[]) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  // 处理单词本选择
  const handleBooksChange = (selectedIds: number[]) => {
    handleFormChange('selectedBooks', selectedIds);
  };

  // 导航处理
  const handleNavChange = (nav: string) => {
    onNavigate?.(nav);
  };

  const handleBack = () => {
    onNavigate?.('plans');
  };

  const handleBreadcrumbClick = (page: string) => {
    onNavigate?.(page);
  };

  // 进入下一步
  const handleNextStep = () => {
    if (currentStep === 'basic') {
      if (!isBasicFormValid()) {
        setError('请填写完整的基本信息并选择单词本');
        return;
      }
      setCurrentStep('planning');
    } else if (currentStep === 'planning') {
      if (!aiResult) {
        setError('请先生成学习计划规划');
        return;
      }
      setCurrentStep('confirmation');
    }
    setError(null);
  };

  // 返回上一步
  const handlePrevStep = () => {
    if (currentStep === 'planning') {
      setCurrentStep('basic');
    } else if (currentStep === 'confirmation') {
      setCurrentStep('planning');
    }
    setError(null);
  };

  // 停止AI规划进程
  const stopPlanningProcess = async () => {
    try {
      // 1. 首先取消后端分析
      await wordBookService.cancelAnalysis();

      // 2. 取消前端控制器
      if (abortController) {
        abortController.abort();
        setAbortController(null);
      }

      // 3. 清除分析进度
      await wordBookService.clearAnalysisProgress();

      // 4. 重置前端状态
      setPlanning(false);
      setError(null);

      console.log('AI规划进程已完全停止');
    } catch (err) {
      console.error('停止AI规划进程失败:', err);
      // 即使出错也要重置前端状态
      setPlanning(false);
      setError(null);
    }
  };

  // 开始AI规划
  const handleStartPlanning = async () => {
    if (!isBasicFormValid()) {
      setError('请先完善基本信息');
      return;
    }

    setPlanning(true);
    setError(null);
    setAiResult(null); // 清除之前的结果

    // 创建新的AbortController
    const controller = new AbortController();
    setAbortController(controller);

    try {
      // 清除之前的进度
      await wordBookService.clearAnalysisProgress();

      const request: StudyPlanScheduleRequest = {
        name: formData.name.trim(),
        description: formData.description?.trim() || '',
        intensityLevel: formData.intensityLevel,
        studyPeriodDays: formData.studyPeriodDays,
        reviewFrequency: formData.reviewFrequency,
        startDate: formData.startDate,
        wordbookIds: formData.selectedBooks,
        modelId: formData.selectedModel,
      };

      console.log('Calling generateStudyPlanSchedule with request:', request);
      const result = await studyService.generateStudyPlanSchedule(request);
      console.log('generateStudyPlanSchedule result:', result);

      // 检查是否被取消
      if (controller.signal.aborted) {
        console.log('AI规划被用户取消');
        return;
      }

      if (result.success) {
        console.log('Setting aiResult with data:', result.data);
        setAiResult(result.data);
        showToast('学习计划规划生成成功', 'success');
      } else {
        console.error('generateStudyPlanSchedule failed:', result.error);
        throw new Error(result.error || 'AI规划失败');
      }
    } catch (err) {
      // 检查是否是取消操作
      if (controller.signal.aborted) {
        console.log('AI规划被用户取消');
        return;
      }

      console.error('Failed to generate study plan schedule:', err);
      setError(err instanceof Error ? err.message : 'AI规划失败');

      // 发生错误时停止进程
      await stopPlanningProcess();
    } finally {
      if (!controller.signal.aborted) {
        setPlanning(false);
        setAbortController(null);
      }
    }
  };

  // 取消AI规划
  const handleCancelPlanning = async () => {
    await stopPlanningProcess();
  };

  // 组件卸载时清理资源
  useEffect(() => {
    return () => {
      // 组件卸载时停止所有进行中的进程
      if (abortController) {
        abortController.abort();
      }
    };
  }, [abortController]);

  // 保存学习计划
  const handleSave = async (status: StudyPlanStatus) => {
    if (!aiResult) {
      setError('没有AI规划结果');
      return;
    }

    setCreating(true);
    setError(null);

    try {
      const endDate = aiResult.planMetadata?.endDate;
      
      const request = {
        name: formData.name.trim(),
        description: formData.description?.trim() || '',
        intensityLevel: formData.intensityLevel,
        studyPeriodDays: formData.studyPeriodDays,
        reviewFrequency: formData.reviewFrequency,
        startDate: formData.startDate,
        endDate: endDate,
        aiPlanData: JSON.stringify(aiResult),
        wordbookIds: formData.selectedBooks,
        status: status,
      };

      const result = await studyService.createStudyPlanWithSchedule(request);

      if (result.success) {
        const actionText = status === 'draft' ? '草稿已保存' : '学习计划创建成功';
        showToast(actionText, 'success');
        onNavigate?.('plan-detail', { planId: result.data });
      } else {
        throw new Error(result.error || '保存失败');
      }
    } catch (err) {
      console.error('Failed to save study plan:', err);
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setCreating(false);
    }
  };

  const handleSaveDraft = () => handleSave('draft');
  const handleCreate = () => handleSave('active' as any);

  if (loadError && !loadingBooks) {
    return (
      <div className={styles.page}>
        <Header activeNav="plans" onNavChange={handleNavChange} />
        <main className={styles.main}>
          <div className={styles.error}>
            <div className={styles.errorIcon}>
              <i className="fas fa-exclamation-triangle" />
            </div>
            <p className={styles.errorText}>加载单词本失败: {loadError.message}</p>
            <div className={styles.errorActions}>
              <Button onClick={() => window.location.reload()}>重试</Button>
              <Button variant="secondary" onClick={handleBack}>返回</Button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <Header activeNav="plans" onNavChange={handleNavChange} />

      <Breadcrumb
        items={[
          { label: '首页', key: 'home', icon: 'home' },
          { label: '学习计划', key: 'plans', icon: 'tasks' }
        ]}
        current="创建计划"
        onNavigate={handleBreadcrumbClick}
      />

      <div className={styles.main}>
        <div className={styles.pageHeader}>
          <h1>创建学习计划</h1>
          <p>通过AI智能规划，制定个性化的单词学习计划</p>
        </div>

        {/* 步骤指示器 */}
        <div className={styles.stepIndicator}>
          <div className={`${styles.step} ${currentStep === 'basic' ? styles.active : ''} ${currentStep !== 'basic' ? styles.completed : ''}`}>
            <div className={styles.stepNumber}>1</div>
            <div className={styles.stepLabel}>基本信息</div>
          </div>
          <div className={styles.stepConnector} />
          <div className={`${styles.step} ${currentStep === 'planning' ? styles.active : ''} ${currentStep === 'confirmation' ? styles.completed : ''}`}>
            <div className={styles.stepNumber}>2</div>
            <div className={styles.stepLabel}>AI规划</div>
          </div>
          <div className={styles.stepConnector} />
          <div className={`${styles.step} ${currentStep === 'confirmation' ? styles.active : ''}`}>
            <div className={styles.stepNumber}>3</div>
            <div className={styles.stepLabel}>确认创建</div>
          </div>
        </div>

        {/* 当前步骤内容 */}
        {currentStep === 'basic' && (
          <div className={styles.stepContent}>
            <div className={styles.formSection}>
              <FormInput
                label="计划名称"
                name="name"
                placeholder="请输入学习计划名称"
                value={formData.name}
                onChange={(value) => handleFormChange('name', value)}
                helperText="给你的学习计划起一个有意义的名字"
                required
              />

              <FormInput
                label="计划描述"
                name="description"
                type="textarea"
                placeholder="描述一下这个学习计划的目标和内容"
                value={formData.description}
                onChange={(value) => handleFormChange('description', value)}
                rows={3}
              />

              <div className={styles.planSettings}>
                <h4>学习参数设置</h4>
                
                <div className={styles.settingsGrid}>
                  <div className={styles.settingItem}>
                    <label>学习强度</label>
                    <select
                      value={formData.intensityLevel}
                      onChange={(e) => handleFormChange('intensityLevel', e.target.value as IntensityLevel)}
                      className={styles.select}
                    >
                      <option value="easy">轻松模式 (5-15词/天)</option>
                      <option value="normal">标准模式 (15-30词/天)</option>
                      <option value="intensive">强化模式 (30-50词/天)</option>
                    </select>
                  </div>

                  <div className={styles.settingItem}>
                    <label>学习周期</label>
                    <select
                      value={formData.studyPeriodDays}
                      onChange={(e) => handleFormChange('studyPeriodDays', parseInt(e.target.value))}
                      className={styles.select}
                    >
                      <option value={1}>1天 (强化突击)</option>
                      <option value={3}>3天 (短期集中)</option>
                      <option value={7}>1周 (7天)</option>
                      <option value={14}>2周 (14天)</option>
                      <option value={28}>4周 (28天)</option>
                      <option value={14}>2周 (14天)</option>
                      <option value={28}>4周 (28天)</option>
                    </select>
                  </div>

                  <div className={styles.settingItem}>
                    <label>复习频率</label>
                    <select
                      value={formData.reviewFrequency}
                      onChange={(e) => handleFormChange('reviewFrequency', parseInt(e.target.value))}
                      className={styles.select}
                    >
                      <option value={3}>3次复习</option>
                      <option value={4}>4次复习</option>
                      <option value={5}>5次复习</option>
                    </select>
                  </div>

                  <div className={styles.settingItem}>
                    <label>开始日期</label>
                    <input
                      type="date"
                      value={formData.startDate}
                      onChange={(e) => handleFormChange('startDate', e.target.value)}
                      className={styles.dateInput}
                      required
                    />
                  </div>
                </div>
              </div>

              <WordBookSelector
                books={wordBooks}
                selectedBooks={formData.selectedBooks}
                onSelectionChange={handleBooksChange}
                loading={loadingBooks}
              />
            </div>

            {error && (
              <div className={styles.error}>
                <i className="fas fa-exclamation-triangle" />
                {error}
              </div>
            )}

            <div className={styles.stepActions}>
              <Button variant="secondary" onClick={handleBack}>
                取消
              </Button>
              <Button 
                variant="primary" 
                onClick={handleNextStep}
                disabled={!isBasicFormValid()}
              >
                下一步：AI规划
              </Button>
            </div>
          </div>
        )}

        {currentStep === 'planning' && (
          <div className={styles.stepContent}>
            <div className={styles.planningSection}>
              <h3>AI智能规划</h3>
              <p>根据您的设置，AI将为您制定科学的学习计划</p>

              {/* 单词本统计信息 */}
              <div className={styles.statisticsSection}>
                <h4>选择的单词本统计</h4>
                <div className={styles.statsGrid}>
                  {formData.selectedBooks.map(bookId => {
                    const book = wordBooks.find(b => b.id === bookId);
                    if (!book) return null;
                    return (
                      <div key={bookId} className={styles.statCard}>
                        <div className={styles.statTitle}>{book.name}</div>
                        <div className={styles.statValue}>{book.wordCount} 个单词</div>
                      </div>
                    );
                  })}
                  <div className={styles.statCard}>
                    <div className={styles.statTitle}>总计</div>
                    <div className={styles.statValue}>
                      {formData.selectedBooks.reduce((total, bookId) => {
                        const book = wordBooks.find(b => b.id === bookId);
                        return total + (book?.wordCount || 0);
                      }, 0)} 个单词
                    </div>
                  </div>
                </div>
              </div>

              {/* 规划参数确认 */}
              <div className={styles.parametersSection}>
                <h4>规划参数确认</h4>
                <div className={styles.parametersList}>
                  <div className={styles.parameterItem}>
                    <span className={styles.parameterLabel}>学习强度:</span>
                    <span className={styles.parameterValue}>
                      {formData.intensityLevel === 'easy' && '轻松模式'}
                      {formData.intensityLevel === 'normal' && '标准模式'}
                      {formData.intensityLevel === 'intensive' && '强化模式'}
                    </span>
                  </div>
                  <div className={styles.parameterItem}>
                    <span className={styles.parameterLabel}>学习周期:</span>
                    <span className={styles.parameterValue}>{formatStudyPeriod(formData.studyPeriodDays)}</span>
                  </div>
                  <div className={styles.parameterItem}>
                    <span className={styles.parameterLabel}>复习频率:</span>
                    <span className={styles.parameterValue}>{formData.reviewFrequency} 次</span>
                  </div>
                  <div className={styles.parameterItem}>
                    <span className={styles.parameterLabel}>开始日期:</span>
                    <span className={styles.parameterValue}>{formData.startDate}</span>
                  </div>
                </div>
              </div>

              {/* AI模型选择 */}
              <div className={styles.modelSection}>
                <AIModelSelector
                  selectedModel={formData.selectedModel}
                  onModelChange={(modelId) => handleFormChange('selectedModel', modelId || '')}
                  label="AI模型选择"
                  description="选择用于生成学习计划的AI模型（可选，默认使用系统推荐模型）"
                />
              </div>

              {/* AI规划结果 */}
              {aiResult && (
                <div className={styles.resultSection}>
                  <h4>规划结果预览</h4>
                  <div className={styles.resultSummary}>
                    <div className={styles.summaryItem}>
                      <span className={styles.summaryLabel}>计划类型:</span>
                      <span className={styles.summaryValue}>{aiResult.planMetadata?.planType || '标准计划'}</span>
                    </div>
                    <div className={styles.summaryItem}>
                      <span className={styles.summaryLabel}>总单词数:</span>
                      <span className={styles.summaryValue}>{aiResult.planMetadata?.totalWords || 0} 个</span>
                    </div>
                    <div className={styles.summaryItem}>
                      <span className={styles.summaryLabel}>学习周期:</span>
                      <span className={styles.summaryValue}>{formatStudyPeriod(aiResult.planMetadata?.studyPeriodDays || 0)}</span>
                    </div>
                    <div className={styles.summaryItem}>
                      <span className={styles.summaryLabel}>结束日期:</span>
                      <span className={styles.summaryValue}>{aiResult.planMetadata?.endDate || '未知'}</span>
                    </div>
                  </div>
                  <div className={styles.dailyPlansPreview}>
                    <p>共生成 {aiResult.dailyPlans?.length || 0} 天的学习计划</p>
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
              <div className={styles.rightActions}>
                {!aiResult && (
                  <Button
                    variant="primary"
                    onClick={handleStartPlanning}
                    disabled={planning}
                  >
                    {planning ? (
                      <>
                        <i className="fas fa-spinner fa-spin" />
                        AI规划中...
                      </>
                    ) : (
                      '开始AI规划'
                    )}
                  </Button>
                )}
                {aiResult && (
                  <>
                    <Button
                      variant="secondary"
                      onClick={handleStartPlanning}
                      disabled={planning}
                    >
                      重新规划
                    </Button>
                    <Button
                      variant="primary"
                      onClick={handleNextStep}
                    >
                      下一步：确认创建
                    </Button>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {currentStep === 'confirmation' && aiResult && (
          <div className={styles.stepContent}>
            <div className={styles.confirmationSection}>
              <h3>确认学习计划</h3>
              <p>请确认以下学习计划信息，确认无误后可以保存</p>

              {/* 计划基本信息 */}
              <div className={styles.planInfo}>
                <h4>计划基本信息</h4>
                <div className={styles.infoGrid}>
                  <div className={styles.infoItem}>
                    <span className={styles.infoLabel}>计划名称:</span>
                    <span className={styles.infoValue}>{formData.name}</span>
                  </div>
                  <div className={styles.infoItem}>
                    <span className={styles.infoLabel}>计划描述:</span>
                    <span className={styles.infoValue}>{formData.description || '无'}</span>
                  </div>
                  <div className={styles.infoItem}>
                    <span className={styles.infoLabel}>学习强度:</span>
                    <span className={styles.infoValue}>
                      {formData.intensityLevel === 'easy' && '轻松模式'}
                      {formData.intensityLevel === 'normal' && '标准模式'}
                      {formData.intensityLevel === 'intensive' && '强化模式'}
                    </span>
                  </div>
                  <div className={styles.infoItem}>
                    <span className={styles.infoLabel}>学习周期:</span>
                    <span className={styles.infoValue}>{formatStudyPeriod(aiResult.planMetadata?.studyPeriodDays || 0)}</span>
                  </div>
                  <div className={styles.infoItem}>
                    <span className={styles.infoLabel}>开始日期:</span>
                    <span className={styles.infoValue}>{aiResult.planMetadata?.startDate || '未知'}</span>
                  </div>
                  <div className={styles.infoItem}>
                    <span className={styles.infoLabel}>结束日期:</span>
                    <span className={styles.infoValue}>{aiResult.planMetadata?.endDate || '未知'}</span>
                  </div>
                </div>
              </div>

              {/* 学习计划详情 */}
              <StudySchedulePreview aiResult={aiResult} />
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
              <div className={styles.rightActions}>
                <Button
                  variant="secondary"
                  onClick={handleSaveDraft}
                  disabled={creating}
                >
                  保存草稿
                </Button>
                <Button
                  variant="primary"
                  onClick={handleCreate}
                  disabled={creating}
                >
                  {creating ? (
                    <>
                      <i className="fas fa-spinner fa-spin" />
                      创建中...
                    </>
                  ) : (
                    '创建学习计划'
                  )}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* AI规划进度模态框 */}
        <PlanningProgress
          isVisible={planning}
          onCancel={handleCancelPlanning}
        />
      </div>
    </div>
  );
};

export default CreatePlanPageV2;
