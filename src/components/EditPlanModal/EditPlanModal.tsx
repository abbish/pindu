import React, { useState, useEffect } from 'react';
import styles from './EditPlanModal.module.css';
import {
  Modal,
  Button,
  FormInput,
  WordBookSelector,
  AIModelSelector,
  PlanningProgress,
  StudySchedulePreview
} from '../';
import type { WordBookOption } from '../';
import { WordBookService } from '../../services/wordbookService';
import { StudyService } from '../../services/studyService';
import { useAsyncData } from '../../hooks/useAsyncData';
import { useToast } from '../';
import type { 
  StudyPlan,
  StudyPlanScheduleRequest, 
  StudyPlanAIResult, 
  IntensityLevel,
  StudyPlanStatus
} from '../../types';

export interface EditPlanModalProps {
  /** 是否显示模态框 */
  isOpen: boolean;
  /** 关闭模态框 */
  onClose: () => void;
  /** 要编辑的学习计划 */
  plan: StudyPlan | null;
  /** 保存成功回调 */
  onSave?: (planId: number) => void;
  /** 保存中状态 */
  saving?: boolean;
}

// Tab类型
type TabType = 'basic' | 'schedule';

// 基本信息表单数据类型
interface BasicFormData {
  name: string;
  description: string;
}

// 高级设置表单数据类型
interface AdvancedFormData {
  intensityLevel: IntensityLevel;
  studyPeriodDays: number;
  reviewFrequency: number;
  startDate: string;
  selectedBooks: number[];
  selectedModel?: number;
}

/**
 * 编辑学习计划模态框组件
 */
export const EditPlanModal: React.FC<EditPlanModalProps> = ({
  isOpen,
  onClose,
  plan,
  onSave,
  saving = false
}) => {
  const { showToast } = useToast();
  const wordBookService = new WordBookService();
  const studyService = new StudyService();

  // 当前Tab状态
  const [activeTab, setActiveTab] = useState<TabType>('basic');

  // 基本信息表单数据
  const [basicFormData, setBasicFormData] = useState<BasicFormData>({
    name: '',
    description: '',
  });

  // 高级设置表单数据
  const [advancedFormData, setAdvancedFormData] = useState<AdvancedFormData>({
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
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [abortController, setAbortController] = useState<AbortController | null>(null);



  // 获取单词本数据
  const { data: rawWordBooks, loading: loadingBooks, error: loadError } = useAsyncData(async () => {
    const result = await wordBookService.getAllWordBooks();
    if (result.success) {
      return result.data.filter(book => book.status === 'normal');
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

  // 初始化表单数据
  useEffect(() => {
    if (plan && isOpen) {
      // 加载关联的单词本
      loadPlanWordBooks();

      // 初始化基本信息
      setBasicFormData({
        name: plan.name || '',
        description: plan.description || '',
      });

      // 初始化高级设置
      setAdvancedFormData({
        intensityLevel: (plan.intensity_level as IntensityLevel) || 'normal',
        studyPeriodDays: plan.study_period_days || 14,
        reviewFrequency: plan.review_frequency || 4,
        startDate: plan.start_date || '',
        selectedBooks: [], // 将在 loadPlanWordBooks 中设置
        selectedModel: undefined, // TODO: 从计划中获取AI模型
      });

      setActiveTab('basic');
      setAiResult(null);
      setError(null);
    }
  }, [plan, isOpen]);

  // 加载计划关联的单词本
  const loadPlanWordBooks = async () => {
    if (!plan) return;

    try {
      const result = await studyService.getStudyPlanWordBooks(plan.id);
      if (result.success) {
        setAdvancedFormData(prev => ({
          ...prev,
          selectedBooks: result.data
        }));
      }
    } catch (err) {
      console.error('Failed to load plan word books:', err);
    }
  };

  // 重置状态
  const resetState = () => {
    setActiveTab('basic');
    setAiResult(null);
    setError(null);
    setPlanning(false);
    setUpdating(false);
    if (abortController) {
      abortController.abort();
      setAbortController(null);
    }
  };

  // 关闭模态框
  const handleClose = () => {
    resetState();
    onClose();
  };

  // 基本信息表单字段更新
  const updateBasicFormData = (field: keyof BasicFormData, value: any) => {
    setBasicFormData(prev => ({ ...prev, [field]: value }));
  };

  // 高级设置表单字段更新
  const updateAdvancedFormData = (field: keyof AdvancedFormData, value: any) => {
    setAdvancedFormData(prev => ({ ...prev, [field]: value }));
  };

  // 验证基本信息
  const validateBasicInfo = (): boolean => {
    if (!basicFormData.name.trim()) {
      setError('请输入计划名称');
      return false;
    }
    setError(null);
    return true;
  };

  // 验证高级设置
  const validateAdvancedSettings = (): boolean => {
    if (advancedFormData.selectedBooks.length === 0) {
      setError('请至少选择一个单词本');
      return false;
    }
    if (!advancedFormData.startDate) {
      setError('请选择开始日期');
      return false;
    }
    setError(null);
    return true;
  };

  // 仅保存基本信息
  const handleSaveBasicInfo = async () => {
    if (!validateBasicInfo() || !plan) return;

    try {
      setUpdating(true);
      setError(null);

      const result = await studyService.updateStudyPlanBasicInfo(plan.id, {
        name: basicFormData.name.trim(),
        description: basicFormData.description?.trim() || '',
      });

      if (result.success) {
        showToast('计划基本信息已更新', 'success');
        onSave?.(plan.id);
        handleClose();
      } else {
        throw new Error(result.error || '更新失败');
      }
    } catch (err) {
      console.error('Failed to update plan basic info:', err);
      setError(err instanceof Error ? err.message : '更新失败');
    } finally {
      setUpdating(false);
    }
  };



  // 开始AI规划
  const handleStartPlanning = async () => {
    if (!validateAdvancedSettings() || !plan) return;

    try {
      setPlanning(true);
      setError(null);
      setAiResult(null); // 清除之前的结果

      // 创建取消控制器
      const controller = new AbortController();
      setAbortController(controller);

      // 清除之前的进度
      await wordBookService.clearAnalysisProgress();

      // 构建AI规划请求
      const request = {
        name: basicFormData.name.trim(),
        description: basicFormData.description?.trim() || '',
        intensityLevel: advancedFormData.intensityLevel,
        studyPeriodDays: advancedFormData.studyPeriodDays,
        reviewFrequency: advancedFormData.reviewFrequency,
        startDate: advancedFormData.startDate,
        wordbookIds: advancedFormData.selectedBooks,
        modelId: advancedFormData.selectedModel,
      };

      console.log('Calling generateStudyPlanSchedule with request:', request);
      const result = await studyService.generateStudyPlanSchedule(request);
      console.log('generateStudyPlanSchedule result:', result);

      // 检查是否被取消
      if (abortController?.signal.aborted) {
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
      if (abortController?.signal.aborted) {
        console.log('AI规划被用户取消');
        return;
      }

      console.error('AI规划失败:', err);
      setError(err instanceof Error ? err.message : 'AI规划失败');

      // 发生错误时停止进程
      await stopPlanningProcess();
    } finally {
      if (!abortController?.signal.aborted) {
        setPlanning(false);
        setAbortController(null);
      }
    }
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
      setAiResult(null);

      console.log('AI规划进程已完全停止');
    } catch (err) {
      console.error('停止AI规划进程失败:', err);
      // 即使出错也要重置前端状态
      setPlanning(false);
      setError(null);
      setAiResult(null);
    }
  };

  // 取消AI规划
  const handleCancelPlanning = async () => {
    await stopPlanningProcess();
  };

  // 保存更新的计划
  const handleSaveUpdatedPlan = async () => {
    if (!plan) return;

    try {
      setUpdating(true);
      setError(null);

      // 如果有新的AI结果，使用完整更新方法
      if (aiResult && ((aiResult as any).daily_plans || aiResult.dailyPlans) &&
          ((aiResult as any).daily_plans?.length > 0 || aiResult.dailyPlans?.length > 0)) {
        const updateRequest = {
          name: basicFormData.name.trim(),
          description: basicFormData.description?.trim() || '',
          intensityLevel: advancedFormData.intensityLevel,
          studyPeriodDays: advancedFormData.studyPeriodDays,
          reviewFrequency: advancedFormData.reviewFrequency,
          startDate: advancedFormData.startDate,
          wordbookIds: advancedFormData.selectedBooks,
          schedule: aiResult, // 传递整个aiResult对象
          status: 'draft' as const // 编辑计划时保持草稿状态
        };

        console.log('Updating study plan with schedule:', updateRequest);
        const result = await studyService.updateStudyPlanWithSchedule(plan.id, updateRequest);

        if (result.success) {
          showToast('学习计划已更新', 'success');
          onSave?.(plan.id);
          handleClose();
        } else {
          throw new Error(result.error || '更新失败');
        }
      } else {
        // 如果没有新的AI结果，只更新基本信息
        const basicUpdateRequest = {
          name: basicFormData.name.trim(),
          description: basicFormData.description?.trim() || ''
        };

        console.log('Updating study plan basic info:', basicUpdateRequest);
        const result = await studyService.updateStudyPlanBasicInfo(plan.id, basicUpdateRequest);

        if (result.success) {
          showToast('学习计划基本信息已更新', 'success');
          onSave?.(plan.id);
          handleClose();
        } else {
          throw new Error(result.error || '更新失败');
        }
      }
    } catch (err) {
      console.error('Failed to save updated plan:', err);
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setUpdating(false);
    }
  };

  // 渲染Tab导航
  const renderTabNavigation = () => (
    <div className={styles.tabNavigation}>
      <button
        type="button"
        className={`${styles.tabButton} ${activeTab === 'basic' ? styles.active : ''}`}
        onClick={() => setActiveTab('basic')}
      >
        基本信息
      </button>
      <button
        type="button"
        className={`${styles.tabButton} ${activeTab === 'schedule' ? styles.active : ''}`}
        onClick={() => setActiveTab('schedule')}
      >
        日程规划
      </button>
    </div>
  );

  // 渲染基本信息Tab
  const renderBasicTab = () => (
    <div className={styles.basicTab}>
      <div className={styles.formSection}>
        <FormInput
          label="计划名称"
          value={basicFormData.name}
          onChange={(value) => updateBasicFormData('name', value)}
          placeholder="请输入学习计划名称"
          required
        />

        <FormInput
          label="计划描述"
          value={basicFormData.description}
          onChange={(value) => updateBasicFormData('description', value)}
          placeholder="请输入计划描述（可选）"
          type="textarea"
        />
      </div>

      {error && (
        <div className={styles.error}>
          <i className="fas fa-exclamation-triangle" />
          {error}
        </div>
      )}

      <div className={styles.actions}>
        <Button
          variant="primary"
          onClick={handleSaveBasicInfo}
          loading={updating}
          disabled={updating}
        >
          <i className="fas fa-save" />
          保存基本信息
        </Button>
      </div>
    </div>
  );

  // 渲染日程规划Tab
  const renderScheduleTab = () => (
    <div className={styles.scheduleTab}>
      {!aiResult ? (
        // 学习设置和AI规划
        <div className={styles.planningSection}>
          <div className={styles.formSection}>
            <h3 className={styles.sectionTitle}>学习设置</h3>

            <div className={styles.settingsGrid}>
              <div className={styles.settingItem}>
                <label>学习强度</label>
                <select
                  value={advancedFormData.intensityLevel}
                  onChange={(e) => updateAdvancedFormData('intensityLevel', e.target.value)}
                  className={styles.select}
                  title="学习强度"
                >
                  <option value="easy">轻松模式 (5-15词/天)</option>
                  <option value="normal">标准模式 (15-30词/天)</option>
                  <option value="intensive">强化模式 (30-50词/天)</option>
                </select>
              </div>

              <div className={styles.settingItem}>
                <label>学习周期</label>
                <select
                  value={advancedFormData.studyPeriodDays}
                  onChange={(e) => updateAdvancedFormData('studyPeriodDays', parseInt(e.target.value))}
                  className={styles.select}
                  title="学习周期"
                >
                  <option value={7}>1周</option>
                  <option value={14}>2周</option>
                  <option value={28}>4周</option>
                </select>
              </div>

              <div className={styles.settingItem}>
                <label>复习频率</label>
                <select
                  value={advancedFormData.reviewFrequency}
                  onChange={(e) => updateAdvancedFormData('reviewFrequency', parseInt(e.target.value))}
                  className={styles.select}
                  title="复习频率"
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
                  value={advancedFormData.startDate}
                  onChange={(e) => updateAdvancedFormData('startDate', e.target.value)}
                  className={styles.dateInput}
                />
              </div>
            </div>

            <div className={styles.wordbookSelection}>
              <h4>选择单词本</h4>
              <WordBookSelector
                books={wordBooks}
                selectedBooks={advancedFormData.selectedBooks}
                onSelectionChange={(books) => updateAdvancedFormData('selectedBooks', books)}
                loading={loadingBooks}
              />
            </div>

            <div className={styles.aiModelSelection}>
              <h4>AI模型选择（可选）</h4>
              <AIModelSelector
                selectedModel={advancedFormData.selectedModel}
                onModelChange={(modelId) => updateAdvancedFormData('selectedModel', modelId || undefined)}
                label=""
                description="选择用于重新生成学习计划的AI模型（可选，默认使用系统推荐模型）"
              />
            </div>
          </div>

          {error && (
            <div className={styles.error}>
              <i className="fas fa-exclamation-triangle" />
              {error}
            </div>
          )}

          <div className={styles.actions}>
            <Button
              variant="primary"
              onClick={handleStartPlanning}
              loading={planning}
              disabled={planning || advancedFormData.selectedBooks.length === 0}
            >
              <i className="fas fa-magic" />
              {planning ? '生成中...' : '重新生成日程'}
            </Button>
          </div>
        </div>
      ) : (
        // AI规划结果展示
        <div className={styles.resultSection}>
          <StudySchedulePreview
            aiResult={aiResult}
            onCreatePlan={handleSaveUpdatedPlan}
            loading={updating}
            mode="edit"
          />
        </div>
      )}
    </div>
  );

  // 渲染高级设置界面（保留用于兼容）
  const renderAdvancedMode = () => (
    <div className={styles.advancedMode}>
      <div className={styles.stepIndicator}>
        <div className={`${styles.stepItem} ${styles.completed}`}>
          <i className="fas fa-check" />
          基本信息
        </div>
        <div className={`${styles.stepConnector} ${styles.completed}`} />
        <div className={`${styles.stepItem} ${styles.active}`}>
          <i className="fas fa-cog" />
          学习设置
        </div>
      </div>

      <div className={styles.formSection}>
        <h3 className={styles.sectionTitle}>学习设置</h3>

        <div className={styles.settingsGrid}>
          <div className={styles.settingItem}>
            <label>学习强度</label>
            <select
              value={advancedFormData.intensityLevel}
              onChange={(e) => updateAdvancedFormData('intensityLevel', e.target.value)}
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
              value={advancedFormData.studyPeriodDays}
              onChange={(e) => updateAdvancedFormData('studyPeriodDays', parseInt(e.target.value))}
              className={styles.select}
            >
              <option value={7}>1周 (7天)</option>
              <option value={14}>2周 (14天)</option>
              <option value={28}>4周 (28天)</option>
            </select>
          </div>

          <div className={styles.settingItem}>
            <label>复习频率</label>
            <select
              value={advancedFormData.reviewFrequency}
              onChange={(e) => updateAdvancedFormData('reviewFrequency', parseInt(e.target.value))}
              className={styles.select}
            >
              <option value={3}>3次复习</option>
              <option value={4}>4次复习</option>
              <option value={5}>5次复习</option>
            </select>
          </div>
        </div>

        <FormInput
          label="开始日期"
          value={advancedFormData.startDate}
          onChange={(value) => updateAdvancedFormData('startDate', value)}
          type="date"
          required
        />
      </div>

      <div className={styles.formSection}>
        <h3 className={styles.sectionTitle}>单词本选择</h3>
        <WordBookSelector
          books={wordBooks}
          selectedBooks={advancedFormData.selectedBooks}
          onSelectionChange={(books) => updateAdvancedFormData('selectedBooks', books)}
          loading={loadingBooks}
        />
      </div>

      <div className={styles.formSection}>
        <h3 className={styles.sectionTitle}>AI模型选择</h3>
        <AIModelSelector
          selectedModel={advancedFormData.selectedModel}
          onModelChange={(modelId) => updateAdvancedFormData('selectedModel', modelId || undefined)}
          label="AI模型选择"
          description="选择用于重新生成学习计划的AI模型（可选，默认使用系统推荐模型）"
        />
      </div>

      {error && (
        <div className={styles.error}>
          <i className="fas fa-exclamation-triangle" />
          {error}
        </div>
      )}

      <div className={styles.actions}>
        <Button
          variant="secondary"
          onClick={handleBackToBasic}
          disabled={updating}
        >
          <i className="fas fa-arrow-left" />
          返回
        </Button>

        <Button
          variant="primary"
          onClick={handleStartPlanning}
          disabled={updating}
        >
          <i className="fas fa-magic" />
          重新生成日程
        </Button>
      </div>
    </div>
  );



  // 渲染确认界面
  const renderConfirmationMode = () => (
    <div className={styles.confirmationMode}>
      <div className={styles.stepIndicator}>
        <div className={`${styles.stepItem} ${styles.completed}`}>
          <i className="fas fa-check" />
          基本信息
        </div>
        <div className={`${styles.stepConnector} ${styles.completed}`} />
        <div className={`${styles.stepItem} ${styles.completed}`}>
          <i className="fas fa-check" />
          学习设置
        </div>
        <div className={`${styles.stepConnector} ${styles.completed}`} />
        <div className={`${styles.stepItem} ${styles.active}`}>
          <i className="fas fa-check-circle" />
          确认更新
        </div>
      </div>

      {aiResult && (
        <StudySchedulePreview
          aiResult={aiResult}
          onCreatePlan={handleSaveUpdatedPlan}
          loading={updating}
          mode="edit"
        />
      )}

      {error && (
        <div className={styles.error}>
          <i className="fas fa-exclamation-triangle" />
          {error}
        </div>
      )}
    </div>
  );

  if (!plan) return null;

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={handleClose}
        title={`编辑学习计划 - ${plan.name}`}
        size="large"
      >
        <div className={styles.editPlanModal}>
          {renderTabNavigation()}
          <div className={styles.tabContent}>
            {activeTab === 'basic' && renderBasicTab()}
            {activeTab === 'schedule' && renderScheduleTab()}
          </div>
        </div>
      </Modal>

      {/* AI规划进度模态框 */}
      <PlanningProgress
        isVisible={planning}
        onCancel={handleCancelPlanning}
      />
    </>
  );
};
