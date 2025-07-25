import React, { useState, useEffect } from 'react';
import styles from './SettingsPage.module.css';
import {
  Header,
  Breadcrumb,
  Button,
  LoadingSpinner
} from '../components';
import ConfirmDialog from '../components/ConfirmDialog';
import { AIModelService } from '../services/aiModelService';
import { dataManagementService } from '../services/dataManagementService';
import type {
  AIProvider,
  AIModelConfig,
  DatabaseOverview,

  Id
} from '../types';
import { useErrorHandler } from '../hooks/useErrorHandler';

export interface SettingsPageProps {
  /** Navigation handler */
  onNavigate?: (page: string, params?: any) => void;
}

/**
 * 设置页面组件
 */
export const SettingsPage: React.FC<SettingsPageProps> = ({
  onNavigate
}) => {
  const [activeTab, setActiveTab] = useState<'ai-models' | 'general' | 'data-management'>('ai-models');
  const [providers, setProviders] = useState<AIProvider[]>([]);
  const [models, setModels] = useState<AIModelConfig[]>([]);
  const [defaultModel, setDefaultModel] = useState<AIModelConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // 数据管理相关状态
  const [databaseOverview, setDatabaseOverview] = useState<DatabaseOverview | null>(null);
  const [dataLoading, setDataLoading] = useState(false);
  const [resetting, setResetting] = useState(false);

  // 选择性重置相关状态
  const [selectedTables, setSelectedTables] = useState<Set<string>>(new Set());
  const [selectiveResetMode, setSelectiveResetMode] = useState(false);

  // 编辑状态
  const [editingProvider, setEditingProvider] = useState<AIProvider | null>(null);
  const [editingModel, setEditingModel] = useState<AIModelConfig | null>(null);
  const [showAddProvider, setShowAddProvider] = useState(false);
  const [showAddModel, setShowAddModel] = useState(false);

  // 确认对话框状态
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    type?: 'danger' | 'warning' | 'info';
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
    type: 'warning'
  });

  // 重置确认对话框状态
  const [resetDialog, setResetDialog] = useState<{
    isOpen: boolean;
    step: 'warning' | 'confirm';
    confirmText: string;
  }>({
    isOpen: false,
    step: 'warning',
    confirmText: '',
  });

  // 删除数据库确认对话框状态
  const [deleteDbDialog, setDeleteDbDialog] = useState<{
    isOpen: boolean;
    step: 'warning' | 'confirm';
    confirmText: string;
  }>({
    isOpen: false,
    step: 'warning',
    confirmText: '',
  });

  // 表单数据
  const [providerForm, setProviderForm] = useState({
    name: '',
    display_name: '',
    base_url: '',
    api_key: '',
    description: '',
  });

  const [modelForm, setModelForm] = useState({
    provider_id: 0,
    display_name: '',
    model_id: '',
    description: '',
    max_tokens: 4000,
    temperature: 0.3,
  });

  const { errorState, showError, hideError } = useErrorHandler();
  
  const aiModelService = new AIModelService();

  useEffect(() => {
    console.log('🔧 SettingsPage: Component mounted, loading data...');
    console.log('🔧 Environment Info:', {
      isDev: import.meta.env.DEV,
      mode: import.meta.env.MODE,
      isTauri: typeof window !== 'undefined' && '__TAURI__' in window,
      userAgent: navigator.userAgent
    });
    loadData();
  }, []);

  const loadData = async () => {
    console.log('loadData: Starting to load settings data...');
    try {
      setLoading(true);
      console.log('loadData: Calling API services...');
      const [providersResult, modelsResult, defaultModelResult] = await Promise.all([
        aiModelService.getAllAIProviders(), // 使用新的API获取所有供应商（包括禁用的）
        aiModelService.getAllAIModels(),    // 使用新的API获取所有模型（包括禁用的）
        aiModelService.getDefaultAIModel()
      ]);

      // 检查API调用结果
      if (!providersResult.success) {
        throw new Error(providersResult.error || '获取AI提供商失败');
      }
      if (!modelsResult.success) {
        throw new Error(modelsResult.error || '获取AI模型失败');
      }
      if (!defaultModelResult.success) {
        throw new Error(defaultModelResult.error || '获取默认模型失败');
      }

      const providersData = providersResult.data || [];
      const modelsData = modelsResult.data || [];
      const defaultModelData = defaultModelResult.data;

      console.log('loadData: API calls successful:', {
        providersCount: providersData.length,
        modelsCount: modelsData.length,
        defaultModel: defaultModelData
      });

      setProviders(providersData);
      setModels(modelsData);
      setDefaultModel(defaultModelData);
      console.log('loadData: State updated successfully');
    } catch (error) {
      console.error('loadData: Error loading data:', error);
      showError(error);
    } finally {
      setLoading(false);
    }
  };

  const handleNavChange = (nav: string) => {
    onNavigate?.(nav);
  };

  const handleBreadcrumbClick = (key: string) => {
    onNavigate?.(key);
  };

  // 加载数据库统计信息
  const loadDatabaseStatistics = async () => {
    try {
      setDataLoading(true);
      const result = await dataManagementService.getDatabaseStatistics();

      if (result.success) {
        setDatabaseOverview(result.data);
      } else {
        showError(new Error(result.error || '获取数据库统计失败'));
      }
    } catch (error) {
      showError(error);
    } finally {
      setDataLoading(false);
    }
  };

  // 处理标签切换
  const handleTabChange = (tab: 'ai-models' | 'general' | 'data-management') => {
    setActiveTab(tab);

    // 如果切换到数据管理标签，加载数据库统计
    if (tab === 'data-management' && !databaseOverview) {
      loadDatabaseStatistics();
    }
  };

  // 处理重置数据库按钮点击
  const handleResetDatabase = () => {
    setResetDialog({
      isOpen: true,
      step: 'warning',
      confirmText: '',
    });
  };

  // 处理删除数据库按钮点击
  const handleDeleteDatabase = () => {
    setDeleteDbDialog({
      isOpen: true,
      step: 'warning',
      confirmText: '',
    });
  };

  // 处理重置确认
  const handleResetConfirm = async () => {
    if (resetDialog.step === 'warning') {
      // 第一步：显示警告，进入确认步骤
      setResetDialog(prev => ({
        ...prev,
        step: 'confirm',
        confirmText: '',
      }));
    } else if (resetDialog.step === 'confirm') {
      // 第二步：检查确认文本并执行重置
      if (resetDialog.confirmText !== 'RESET') {
        showError(new Error('请输入正确的确认文本 "RESET"'));
        return;
      }

      try {
        setResetting(true);
        const result = await dataManagementService.resetUserData();

        if (result.success) {
          // 重置成功，关闭对话框并刷新统计信息
          setResetDialog({
            isOpen: false,
            step: 'warning',
            confirmText: '',
          });

          // 刷新数据库统计
          await loadDatabaseStatistics();

          // 显示成功消息
          alert(`重置成功！${result.data.message}`);
        } else {
          showError(new Error(result.error || '重置失败'));
        }
      } catch (error) {
        showError(error);
      } finally {
        setResetting(false);
      }
    }
  };

  // 处理重置取消
  const handleResetCancel = () => {
    setResetDialog({
      isOpen: false,
      step: 'warning',
      confirmText: '',
    });
  };

  // 处理删除数据库确认
  const handleDeleteDbConfirm = async () => {
    if (deleteDbDialog.step === 'warning') {
      // 第一步：显示警告，进入确认步骤
      setDeleteDbDialog(prev => ({
        ...prev,
        step: 'confirm',
        confirmText: '',
      }));
    } else if (deleteDbDialog.step === 'confirm') {
      // 第二步：检查确认文本并执行删除
      if (deleteDbDialog.confirmText !== 'DELETE DATABASE') {
        showError(new Error('请输入正确的确认文本 "DELETE DATABASE"'));
        return;
      }

      try {
        setResetting(true);
        // 调用删除数据库并重启的API
        // 注意：这个调用可能不会返回，因为应用会重启
        await dataManagementService.deleteDatabaseAndRestart();

        // 如果到达这里，说明删除失败了
        showError(new Error('删除数据库失败'));
      } catch (error) {
        showError(error);
      } finally {
        setResetting(false);
      }
    }
  };

  // 处理删除数据库取消
  const handleDeleteDbCancel = () => {
    setDeleteDbDialog({
      isOpen: false,
      step: 'warning',
      confirmText: '',
    });
  };

  // 处理表格选择
  const handleTableSelect = (tableName: string, checked: boolean) => {
    const newSelected = new Set(selectedTables);
    if (checked) {
      newSelected.add(tableName);
    } else {
      newSelected.delete(tableName);
    }
    setSelectedTables(newSelected);
  };

  // 处理全选/取消全选
  const handleSelectAll = (checked: boolean) => {
    if (checked && databaseOverview) {
      const allTables = new Set(databaseOverview.tables.map(t => t.table_name));
      setSelectedTables(allTables);
    } else {
      setSelectedTables(new Set());
    }
  };

  // 处理选择性重置
  const handleSelectiveReset = async () => {
    if (selectedTables.size === 0) {
      showError(new Error('请至少选择一个数据表进行重置'));
      return;
    }

    if (resetDialog.step === 'warning') {
      // 第一步：显示警告，进入确认步骤
      setResetDialog(prev => ({
        ...prev,
        step: 'confirm',
        confirmText: '',
      }));
    } else if (resetDialog.step === 'confirm') {
      // 第二步：检查确认文本并执行重置
      if (resetDialog.confirmText !== 'RESET') {
        showError(new Error('请输入正确的确认文本 "RESET"'));
        return;
      }

      try {
        setResetting(true);
        const result = await dataManagementService.resetSelectedTables(Array.from(selectedTables));

        if (result.success) {
          // 重置成功，关闭对话框并刷新统计信息
          setResetDialog({
            isOpen: false,
            step: 'warning',
            confirmText: '',
          });

          // 清空选择
          setSelectedTables(new Set());
          setSelectiveResetMode(false);

          // 刷新数据库统计
          await loadDatabaseStatistics();

          // 显示成功消息
          alert(`重置成功！${result.data.message}`);
        } else {
          showError(new Error(result.error || '重置失败'));
        }
      } catch (error) {
        showError(error);
      } finally {
        setResetting(false);
      }
    }
  };

  // 获取选中表的统计信息
  const getSelectedTablesStats = () => {
    if (!databaseOverview) return { count: 0, records: 0 };

    const selectedTablesList = databaseOverview.tables.filter(t =>
      selectedTables.has(t.table_name)
    );

    return {
      count: selectedTablesList.length,
      records: selectedTablesList.reduce((sum, t) => sum + (t.record_count || 0), 0)
    };
  };

  const handleSetDefaultModel = async (modelId: Id) => {
    try {
      setSaving(true);
      await aiModelService.setDefaultAIModel(modelId);
      await loadData(); // 重新加载数据
    } catch (error) {
      showError(error);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteProvider = (providerId: Id) => {
    console.log('handleDeleteProvider called with providerId:', providerId);

    setConfirmDialog({
      isOpen: true,
      title: '删除AI提供商',
      message: '确定要删除这个AI提供商吗？这将同时删除其下的所有模型。',
      type: 'danger',
      onConfirm: async () => {
        console.log('User confirmed provider deletion');
        setConfirmDialog(prev => ({ ...prev, isOpen: false }));

        try {
          console.log('Starting provider deletion...');
          setSaving(true);
          await aiModelService.deleteAIProvider(providerId);
          console.log('Provider deleted successfully, reloading data...');
          await loadData();
          console.log('Data reloaded successfully');
        } catch (error) {
          console.error('Error deleting provider:', error);
          showError(error);
        } finally {
          setSaving(false);
        }
      }
    });
  };

  const handleDeleteModel = (modelId: Id) => {
    console.log('handleDeleteModel called with modelId:', modelId);

    setConfirmDialog({
      isOpen: true,
      title: '删除AI模型',
      message: '确定要删除这个AI模型吗？',
      type: 'danger',
      onConfirm: async () => {
        console.log('User confirmed model deletion');
        setConfirmDialog(prev => ({ ...prev, isOpen: false }));

        try {
          console.log('Starting model deletion...');
          setSaving(true);
          await aiModelService.deleteAIModel(modelId);
          console.log('Model deleted successfully, reloading data...');
          await loadData();
          console.log('Data reloaded successfully');
        } catch (error) {
          console.error('Error deleting model:', error);
          showError(error);
        } finally {
          setSaving(false);
        }
      }
    });
  };

  const handleToggleModelActive = async (modelId: Id, isActive: boolean) => {
    console.log('handleToggleModelActive called:', { modelId, isActive, newState: !isActive });

    try {
      console.log('Starting model toggle...');
      setSaving(true);
      await aiModelService.updateAIModel(modelId, { is_active: !isActive });
      console.log('Model toggle successful, reloading data...');
      await loadData();
      console.log('Data reloaded after model toggle');
    } catch (error) {
      console.error('Error toggling model:', error);
      showError(error);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleProviderActive = async (providerId: Id, isActive: boolean) => {
    console.log('handleToggleProviderActive called:', { providerId, isActive, newState: !isActive });

    try {
      console.log('Starting provider toggle...');
      setSaving(true);
      await aiModelService.updateAIProvider(providerId, { is_active: !isActive });
      console.log('Provider toggle successful, reloading data...');
      await loadData();
      console.log('Data reloaded after provider toggle');
    } catch (error) {
      console.error('Error toggling provider:', error);
      showError(error);
    } finally {
      setSaving(false);
    }
  };

  // 表单处理函数
  const resetProviderForm = () => {
    setProviderForm({
      name: '',
      display_name: '',
      base_url: '',
      api_key: '',
      description: '',
    });
  };

  const resetModelForm = () => {
    setModelForm({
      provider_id: 0,
      display_name: '',
      model_id: '',
      description: '',
      max_tokens: 4000,
      temperature: 0.3,
    });
  };

  const handleAddProvider = () => {
    resetProviderForm();
    setEditingProvider(null);
    setShowAddProvider(true);
  };

  const handleEditProvider = (provider: AIProvider) => {
    setProviderForm({
      name: provider.name,
      display_name: provider.display_name,
      base_url: provider.base_url,
      api_key: provider.api_key,
      description: provider.description || '',
    });
    setEditingProvider(provider);
    setShowAddProvider(true);
  };

  const handleSaveProvider = async () => {
    try {
      setSaving(true);
      if (editingProvider) {
        // 更新提供商
        await aiModelService.updateAIProvider(editingProvider.id, {
          display_name: providerForm.display_name,
          base_url: providerForm.base_url,
          api_key: providerForm.api_key,
          description: providerForm.description,
        });
      } else {
        // 创建新提供商
        await aiModelService.createAIProvider(providerForm);
      }
      setShowAddProvider(false);
      setEditingProvider(null);
      await loadData();
    } catch (error) {
      showError(error);
    } finally {
      setSaving(false);
    }
  };

  const handleAddModel = () => {
    resetModelForm();
    setEditingModel(null);
    setShowAddModel(true);
  };

  const handleEditModel = (model: AIModelConfig) => {
    setModelForm({
      provider_id: model.provider.id,
      display_name: model.display_name,
      model_id: model.model_id,
      description: model.description || '',
      max_tokens: model.max_tokens || 4000,
      temperature: model.temperature || 0.3,
    });
    setEditingModel(model);
    setShowAddModel(true);
  };

  const handleSaveModel = async () => {
    try {
      setSaving(true);
      if (editingModel) {
        // 更新模型
        await aiModelService.updateAIModel(editingModel.id, {
          display_name: modelForm.display_name,
          model_id: modelForm.model_id,
          description: modelForm.description,
          max_tokens: modelForm.max_tokens,
          temperature: modelForm.temperature,
        });
      } else {
        // 创建新模型
        await aiModelService.createAIModel({
          provider_id: modelForm.provider_id,
          name: modelForm.display_name, // 使用display_name作为name
          display_name: modelForm.display_name,
          model_id: modelForm.model_id,
          description: modelForm.description,
          max_tokens: modelForm.max_tokens,
          temperature: modelForm.temperature,
        });
      }
      setShowAddModel(false);
      setEditingModel(null);
      await loadData();
    } catch (error) {
      showError(error);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className={styles.page}>
        <Header activeNav="settings" onNavChange={handleNavChange} />
        <main className={styles.main}>
          <div className={styles.loading}>
            <LoadingSpinner />
            <span>加载设置...</span>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <Header activeNav="settings" onNavChange={handleNavChange} />
      
      <main className={styles.main}>
        {/* Breadcrumb */}
        <Breadcrumb
          items={[
            { label: '首页', key: 'home', icon: 'home' }
          ]}
          current="设置"
          onNavigate={handleBreadcrumbClick}
        />

        {/* Page Header */}
        <section className={styles.pageHeader}>
          <div className={styles.headerContent}>
            <div className={styles.headerInfo}>
              <h2 className={styles.pageTitle}>系统设置</h2>
              <p className={styles.pageDescription}>管理应用程序的配置和偏好设置</p>
            </div>
          </div>
        </section>

        {/* Settings Tabs */}
        <section className={styles.settingsTabs}>
          <div className={styles.tabList}>
            <button
              type="button"
              className={`${styles.tab} ${activeTab === 'ai-models' ? styles.tabActive : ''}`}
              onClick={() => handleTabChange('ai-models')}
            >
              <i className="fas fa-robot" />
              AI模型配置
            </button>
            <button
              type="button"
              className={`${styles.tab} ${activeTab === 'general' ? styles.tabActive : ''}`}
              onClick={() => handleTabChange('general')}
            >
              <i className="fas fa-cog" />
              通用设置
            </button>
            <button
              type="button"
              className={`${styles.tab} ${activeTab === 'data-management' ? styles.tabActive : ''}`}
              onClick={() => handleTabChange('data-management')}
            >
              <i className="fas fa-database" />
              数据管理
            </button>
          </div>

          <div className={styles.tabContent}>
            {activeTab === 'ai-models' && (
              <div className={styles.aiModelsTab}>
                {/* Default Model Section */}
                <div className={styles.settingSection}>
                  <div className={styles.sectionHeader}>
                    <h3 className={styles.sectionTitle}>默认AI模型</h3>
                    <p className={styles.sectionDescription}>
                      选择用于文本分析的默认AI模型
                    </p>
                  </div>
                  <div className={styles.sectionContent}>
                    {defaultModel ? (
                      <div className={styles.defaultModelCard}>
                        <div className={styles.modelInfo}>
                          <h4 className={styles.modelName}>{defaultModel.display_name}</h4>
                          <p className={styles.modelProvider}>{defaultModel.provider?.display_name || '未知提供商'}</p>
                          <p className={styles.modelDescription}>{defaultModel.description}</p>
                        </div>
                        <div className={styles.modelActions}>
                          <span className={styles.defaultBadge}>默认</span>
                        </div>
                      </div>
                    ) : (
                      <div className={styles.noDefaultModel}>
                        <p>未设置默认模型</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* AI Providers Section */}
                <div className={styles.settingSection}>
                  <div className={styles.sectionHeader}>
                    <h3 className={styles.sectionTitle}>AI提供商</h3>
                    <p className={styles.sectionDescription}>
                      管理AI服务提供商配置
                    </p>
                    <Button onClick={handleAddProvider} disabled={saving}>
                      <i className="fas fa-plus" />
                      添加提供商
                    </Button>
                  </div>
                  <div className={styles.sectionContent}>
                    <div className={styles.providersList}>
                      {Array.isArray(providers) && providers.map(provider => (
                        <div key={provider.id} className={styles.providerCard}>
                          <div className={styles.providerInfo}>
                            <h4 className={styles.providerName}>{provider.display_name}</h4>
                            <p className={styles.providerUrl}>{provider.base_url}</p>
                            <p className={styles.providerApiKey}>API密钥: {provider.api_key ? '已配置' : '未配置'}</p>
                            {provider.description && (
                              <p className={styles.providerDescription}>{provider.description}</p>
                            )}
                          </div>
                          <div className={styles.providerActions}>
                            <button
                              type="button"
                              className={styles.editButton}
                              onClick={() => handleEditProvider(provider)}
                              disabled={saving}
                              title="编辑提供商"
                            >
                              <i className="fas fa-edit" />
                            </button>
                            <button
                              type="button"
                              className={`${styles.toggleButton} ${provider.is_active ? styles.active : styles.inactive}`}
                              onClick={() => {
                                console.log('Provider toggle button clicked:', { providerId: provider.id, isActive: provider.is_active });
                                handleToggleProviderActive(provider.id, provider.is_active);
                              }}
                              disabled={saving}
                              title={provider.is_active ? '点击禁用此供应商' : '点击启用此供应商'}
                            >
                              {provider.is_active ? '禁用' : '启用'}
                            </button>
                            <button
                              type="button"
                              className={styles.deleteButton}
                              onClick={() => {
                                console.log('Provider delete button clicked:', { providerId: provider.id });
                                handleDeleteProvider(provider.id);
                              }}
                              disabled={saving}
                              title="删除此供应商（危险操作）"
                            >
                              删除
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* AI Models Section */}
                <div className={styles.settingSection}>
                  <div className={styles.sectionHeader}>
                    <h3 className={styles.sectionTitle}>AI模型</h3>
                    <p className={styles.sectionDescription}>
                      管理可用的AI模型配置
                    </p>
                    <Button onClick={handleAddModel} disabled={saving}>
                      <i className="fas fa-plus" />
                      添加模型
                    </Button>
                  </div>
                  <div className={styles.sectionContent}>
                    <div className={styles.modelsList}>
                      {Array.isArray(models) && models.map(model => (
                        <div key={model.id} className={styles.modelCard}>
                          <div className={styles.modelInfo}>
                            <h4 className={styles.modelName}>{model.display_name}</h4>
                            <p className={styles.modelProvider}>{model.provider?.display_name || '未知提供商'}</p>
                            {model.description && (
                              <p className={styles.modelDescription}>{model.description}</p>
                            )}
                            <div className={styles.modelParams}>
                              {model.max_tokens && (
                                <span className={styles.param}>最大令牌: {model.max_tokens}</span>
                              )}
                              {model.temperature && (
                                <span className={styles.param}>温度: {model.temperature}</span>
                              )}
                            </div>
                          </div>
                          <div className={styles.modelActions}>
                            {model.is_default && (
                              <span className={styles.defaultBadge}>默认</span>
                            )}
                            <button
                              type="button"
                              className={styles.editButton}
                              onClick={() => handleEditModel(model)}
                              disabled={saving}
                              title="编辑模型"
                            >
                              <i className="fas fa-edit" />
                            </button>
                            <button
                              type="button"
                              className={styles.setDefaultButton}
                              onClick={() => handleSetDefaultModel(model.id)}
                              disabled={saving || model.is_default}
                            >
                              设为默认
                            </button>
                            <button
                              type="button"
                              className={`${styles.toggleButton} ${model.is_active ? styles.active : styles.inactive}`}
                              onClick={() => {
                                console.log('Model toggle button clicked:', { modelId: model.id, isActive: model.is_active });
                                handleToggleModelActive(model.id, model.is_active);
                              }}
                              disabled={saving}
                              title={model.is_active ? '点击禁用此模型' : '点击启用此模型'}
                            >
                              {model.is_active ? '禁用' : '启用'}
                            </button>
                            <button
                              type="button"
                              className={styles.deleteButton}
                              onClick={() => {
                                console.log('Model delete button clicked:', { modelId: model.id });
                                handleDeleteModel(model.id);
                              }}
                              disabled={saving}
                              title="删除此模型（危险操作）"
                            >
                              删除
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'general' && (
              <div className={styles.generalTab}>
                <div className={styles.settingSection}>
                  <div className={styles.sectionHeader}>
                    <h3 className={styles.sectionTitle}>通用设置</h3>
                    <p className={styles.sectionDescription}>
                      应用程序的基本配置选项
                    </p>
                  </div>
                  <div className={styles.sectionContent}>
                    <p className={styles.comingSoon}>更多设置选项即将推出...</p>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'data-management' && (
              <div className={styles.dataManagementTab}>
                {/* 数据库概览 */}
                <div className={styles.settingSection}>
                  <div className={styles.sectionHeader}>
                    <h3 className={styles.sectionTitle}>数据库概览</h3>
                    <p className={styles.sectionDescription}>
                      查看系统中的数据统计信息
                    </p>
                    <Button
                      onClick={loadDatabaseStatistics}
                      disabled={dataLoading}
                      variant="secondary"
                    >
                      <i className="fas fa-sync-alt" />
                      刷新统计
                    </Button>
                  </div>
                  <div className={styles.sectionContent}>
                    {dataLoading ? (
                      <div className={styles.loading}>
                        <LoadingSpinner />
                        <span>加载数据统计...</span>
                      </div>
                    ) : databaseOverview ? (
                      <div className={styles.databaseOverview}>
                        <div className={styles.overviewStats}>
                          <div className={styles.statItem}>
                            <div className={styles.statValue}>{databaseOverview.total_tables || 0}</div>
                            <div className={styles.statLabel}>数据表</div>
                          </div>
                          <div className={styles.statItem}>
                            <div className={styles.statValue}>{(databaseOverview.total_records || 0).toLocaleString()}</div>
                            <div className={styles.statLabel}>总记录数</div>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className={styles.emptyState}>
                        <p>点击"刷新统计"按钮加载数据库信息</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* 数据表详情 */}
                {databaseOverview && (
                  <div className={styles.settingSection}>
                    <div className={styles.sectionHeader}>
                      <h3 className={styles.sectionTitle}>
                        📊 数据表列表
                      </h3>
                      <p className={styles.sectionDescription}>
                        系统中的所有数据表，可选择性重置
                      </p>
                      <div className={styles.tableActions}>
                        <Button
                          onClick={() => setSelectiveResetMode(!selectiveResetMode)}
                          variant={selectiveResetMode ? "primary" : "secondary"}
                          size="sm"
                        >
                          {selectiveResetMode ? '取消选择' : '选择性重置'}
                        </Button>
                        {selectiveResetMode && (
                          <>
                            <Button
                              onClick={() => handleSelectAll(true)}
                              variant="outline"
                              size="sm"
                            >
                              全选
                            </Button>
                            <Button
                              onClick={() => handleSelectAll(false)}
                              variant="outline"
                              size="sm"
                            >
                              取消全选
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                    <div className={styles.sectionContent}>
                      {selectiveResetMode && (
                        <div className={styles.selectionSummary}>
                          <p>
                            已选择 <strong>{getSelectedTablesStats().count}</strong> 个表，
                            共 <strong>{getSelectedTablesStats().records.toLocaleString()}</strong> 条记录
                          </p>
                        </div>
                      )}
                      <div className={styles.tablesList}>
                        {(databaseOverview.tables || []).map(table => (
                          <div
                            key={table.table_name}
                            className={`${styles.tableStatsCard} ${
                              selectiveResetMode && selectedTables.has(table.table_name) ? styles.selected : ''
                            }`}
                          >
                            {selectiveResetMode && (
                              <div className={styles.tableCheckbox}>
                                <input
                                  type="checkbox"
                                  id={`table-${table.table_name}`}
                                  checked={selectedTables.has(table.table_name)}
                                  onChange={(e) => handleTableSelect(table.table_name, e.target.checked)}
                                  aria-label={`选择 ${table.display_name}`}
                                />
                                <label htmlFor={`table-${table.table_name}`} className={styles.visuallyHidden}>
                                  选择 {table.display_name}
                                </label>
                              </div>
                            )}
                            <div className={styles.tableInfo}>
                              <h4 className={styles.tableName}>
                                {table.display_name}
                                <span className={styles.tableType}>({table.table_type})</span>
                              </h4>
                              <p className={styles.tableDescription}>{table.description}</p>
                            </div>
                            <div className={styles.tableStats}>
                              <span className={styles.recordCount}>{(table.record_count || 0).toLocaleString()}</span>
                              <span className={styles.recordLabel}>条记录</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* 重置操作 */}
                <div className={styles.settingSection}>
                  <div className={styles.sectionHeader}>
                    <h3 className={styles.sectionTitle}>
                      ⚠️ 重置数据库
                    </h3>
                    <p className={styles.sectionDescription}>
                      清理所有用户数据，恢复到全新状态
                    </p>
                  </div>
                  <div className={styles.sectionContent}>
                    <div className={styles.resetSection}>
                      <div className={styles.resetWarning}>
                        <h4>⚠️ 危险操作</h4>
                        <p>此操作将永久删除以下数据：</p>
                        <ul>
                          <li>所有单词本和单词</li>
                          <li>所有学习计划和学习进度</li>
                          <li>所有练习记录和会话</li>
                          <li>所有学习统计数据</li>
                        </ul>
                        <p><strong>AI模型配置和系统设置将被保留</strong></p>
                      </div>
                      <div className={styles.resetButtons}>
                        <Button
                          onClick={() => {
                            console.log('Reset all button clicked!');
                            handleResetDatabase();
                          }}
                          disabled={resetting || dataLoading}
                          variant="danger"
                        >
                          🗑️ 重置所有用户数据
                        </Button>

                        <Button
                          onClick={() => {
                            console.log('Delete database button clicked!');
                            handleDeleteDatabase();
                          }}
                          disabled={resetting || dataLoading}
                          variant="danger"
                        >
                          💥 删除数据库并重启
                        </Button>

                        {selectiveResetMode && selectedTables.size > 0 && (
                          <Button
                            onClick={() => {
                              console.log('Reset selected button clicked!', Array.from(selectedTables));
                              setResetDialog({
                                isOpen: true,
                                step: 'warning',
                                confirmText: '',
                              });
                            }}
                            disabled={resetting || dataLoading}
                            variant="danger"
                          >
                            🗑️ 重置选中的表 ({selectedTables.size})
                          </Button>
                        )}

                        <p className={styles.debugInfo}>
                          调试信息: resetting={resetting ? 'true' : 'false'}, dataLoading={dataLoading ? 'true' : 'false'}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Provider Form Modal */}
        {showAddProvider && (
          <div className={styles.modal}>
            <div className={styles.modalContent}>
              <div className={styles.modalHeader}>
                <h3 className={styles.modalTitle}>
                  {editingProvider ? '编辑提供商' : '添加提供商'}
                </h3>
                <button
                  type="button"
                  className={styles.modalClose}
                  onClick={() => setShowAddProvider(false)}
                  title="关闭"
                >
                  <i className="fas fa-times" />
                </button>
              </div>
              <div className={styles.modalBody}>
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>名称 *</label>
                  <input
                    type="text"
                    className={styles.formInput}
                    value={providerForm.name}
                    onChange={(e) => setProviderForm({...providerForm, name: e.target.value})}
                    placeholder="例如: openai"
                    disabled={!!editingProvider}
                  />
                </div>
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>显示名称 *</label>
                  <input
                    type="text"
                    className={styles.formInput}
                    value={providerForm.display_name}
                    onChange={(e) => setProviderForm({...providerForm, display_name: e.target.value})}
                    placeholder="例如: OpenAI"
                  />
                </div>
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>API地址 *</label>
                  <input
                    type="text"
                    className={styles.formInput}
                    value={providerForm.base_url}
                    onChange={(e) => setProviderForm({...providerForm, base_url: e.target.value})}
                    placeholder="例如: https://api.openai.com/v1"
                  />
                </div>
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>API密钥 *</label>
                  <input
                    type="password"
                    className={styles.formInput}
                    value={providerForm.api_key}
                    onChange={(e) => setProviderForm({...providerForm, api_key: e.target.value})}
                    placeholder="请输入API密钥"
                  />
                </div>
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>描述</label>
                  <textarea
                    className={styles.formTextarea}
                    value={providerForm.description}
                    onChange={(e) => setProviderForm({...providerForm, description: e.target.value})}
                    placeholder="提供商描述"
                    rows={3}
                  />
                </div>
              </div>
              <div className={styles.modalFooter}>
                <Button
                  variant="secondary"
                  onClick={() => setShowAddProvider(false)}
                  disabled={saving}
                >
                  取消
                </Button>
                <Button
                  onClick={handleSaveProvider}
                  disabled={saving || !providerForm.name || !providerForm.display_name || !providerForm.base_url || !providerForm.api_key}
                >
                  {saving ? '保存中...' : '保存'}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Model Form Modal */}
        {showAddModel && (
          <div className={styles.modal}>
            <div className={styles.modalContent}>
              <div className={styles.modalHeader}>
                <h3 className={styles.modalTitle}>
                  {editingModel ? '编辑模型' : '添加模型'}
                </h3>
                <button
                  type="button"
                  className={styles.modalClose}
                  onClick={() => setShowAddModel(false)}
                  title="关闭"
                >
                  <i className="fas fa-times" />
                </button>
              </div>
              <div className={styles.modalBody}>
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>提供商 *</label>
                  <select
                    className={styles.formSelect}
                    value={modelForm.provider_id}
                    onChange={(e) => setModelForm({...modelForm, provider_id: parseInt(e.target.value)})}
                    title="选择AI提供商"
                  >
                    <option value={0}>请选择提供商</option>
                    {providers.filter(p => p.is_active).map(provider => (
                      <option key={provider.id} value={provider.id}>
                        {provider.display_name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>显示名称 *</label>
                  <input
                    type="text"
                    className={styles.formInput}
                    value={modelForm.display_name}
                    onChange={(e) => setModelForm({...modelForm, display_name: e.target.value})}
                    placeholder="例如: GPT-3.5 Turbo"
                  />
                </div>
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>模型ID *</label>
                  <input
                    type="text"
                    className={styles.formInput}
                    value={modelForm.model_id}
                    onChange={(e) => setModelForm({...modelForm, model_id: e.target.value})}
                    placeholder="例如: gpt-3.5-turbo"
                  />
                </div>
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>描述</label>
                  <textarea
                    className={styles.formTextarea}
                    value={modelForm.description}
                    onChange={(e) => setModelForm({...modelForm, description: e.target.value})}
                    placeholder="模型描述"
                    rows={3}
                  />
                </div>
                <div className={styles.formRow}>
                  <div className={styles.formGroup}>
                    <label className={styles.formLabel}>最大令牌</label>
                    <input
                      type="number"
                      className={styles.formInput}
                      value={modelForm.max_tokens}
                      onChange={(e) => setModelForm({...modelForm, max_tokens: parseInt(e.target.value)})}
                      min={1}
                      max={200000}
                      title="设置模型最大令牌数"
                      placeholder="4000"
                    />
                  </div>
                  <div className={styles.formGroup}>
                    <label className={styles.formLabel}>温度</label>
                    <input
                      type="number"
                      className={styles.formInput}
                      value={modelForm.temperature}
                      onChange={(e) => setModelForm({...modelForm, temperature: parseFloat(e.target.value)})}
                      min={0}
                      max={2}
                      step={0.1}
                      title="设置模型温度参数"
                      placeholder="0.3"
                    />
                  </div>
                </div>
              </div>
              <div className={styles.modalFooter}>
                <Button
                  variant="secondary"
                  onClick={() => setShowAddModel(false)}
                  disabled={saving}
                >
                  取消
                </Button>
                <Button
                  onClick={handleSaveModel}
                  disabled={saving || !modelForm.provider_id || !modelForm.display_name || !modelForm.model_id}
                >
                  {saving ? '保存中...' : '保存'}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Reset Confirmation Dialog */}
        {resetDialog.isOpen && (
          <div className={styles.modal}>
            <div className={styles.modalContent}>
              <div className={styles.modalHeader}>
                <h3 className={styles.modalTitle}>
                  {resetDialog.step === 'warning' ? '确认重置数据库' : '最终确认'}
                </h3>
                <button
                  type="button"
                  className={styles.modalClose}
                  onClick={handleResetCancel}
                  title="关闭"
                >
                  <i className="fas fa-times" />
                </button>
              </div>
              <div className={styles.modalBody}>
                {resetDialog.step === 'warning' ? (
                  <div className={styles.resetConfirmWarning}>
                    <div className={styles.warningIcon}>⚠️</div>
                    <h4>此操作不可撤销！</h4>
                    {selectiveResetMode && selectedTables.size > 0 ? (
                      <>
                        <p>您即将删除以下选中的数据表：</p>
                        <ul>
                          {Array.from(selectedTables).map(tableName => {
                            const table = databaseOverview?.tables?.find(t => t.table_name === tableName);
                            return (
                              <li key={tableName}>
                                {table?.display_name || tableName}（{table?.record_count || 0} 条记录）
                              </li>
                            );
                          })}
                        </ul>
                        <p>总计：<strong>{getSelectedTablesStats().records.toLocaleString()}</strong> 条记录将被删除</p>
                      </>
                    ) : (
                      <>
                        <p>您即将删除所有用户数据，包括：</p>
                        <ul>
                          <li>所有单词本和单词（{databaseOverview?.tables?.find(t => t.table_name === 'word_books')?.record_count || 0} 个单词本）</li>
                          <li>所有学习计划和进度（{databaseOverview?.tables?.find(t => t.table_name === 'study_plans')?.record_count || 0} 个学习计划）</li>
                          <li>所有练习记录（{databaseOverview?.tables?.find(t => t.table_name === 'practice_sessions')?.record_count || 0} 个练习会话）</li>
                        </ul>
                      </>
                    )}
                    <p><strong>AI模型配置将被保留</strong></p>
                    <p>确定要继续吗？</p>
                  </div>
                ) : (
                  <div className={styles.resetConfirmInput}>
                    <div className={styles.warningIcon}>🔥</div>
                    <h4>最终确认</h4>
                    <p>请在下方输入框中输入 <strong>"RESET"</strong> 来确认此操作：</p>
                    <input
                      type="text"
                      className={styles.confirmInput}
                      value={resetDialog.confirmText}
                      onChange={(e) => setResetDialog(prev => ({
                        ...prev,
                        confirmText: e.target.value
                      }))}
                      placeholder="请输入 RESET"
                      autoFocus
                    />
                    <p className={styles.inputHint}>
                      只有输入正确的确认文本才能执行重置操作
                    </p>
                  </div>
                )}
              </div>
              <div className={styles.modalFooter}>
                <Button
                  variant="secondary"
                  onClick={handleResetCancel}
                  disabled={resetting}
                >
                  取消
                </Button>
                <Button
                  onClick={selectiveResetMode && selectedTables.size > 0 ? handleSelectiveReset : handleResetConfirm}
                  disabled={resetting || (resetDialog.step === 'confirm' && resetDialog.confirmText !== 'RESET')}
                  variant="danger"
                >
                  {resetting ? '重置中...' : resetDialog.step === 'warning' ? '继续' :
                    (selectiveResetMode && selectedTables.size > 0 ? '确认重置选中表' : '确认重置')}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Delete Database Confirmation Dialog */}
        {deleteDbDialog.isOpen && (
          <div className={styles.modal}>
            <div className={styles.modalContent}>
              <div className={styles.modalHeader}>
                <h3 className={styles.modalTitle}>
                  {deleteDbDialog.step === 'warning' ? '⚠️ 删除数据库并重启' : '🔥 最终确认'}
                </h3>
                <button
                  type="button"
                  className={styles.modalClose}
                  onClick={handleDeleteDbCancel}
                  disabled={resetting}
                  title="关闭对话框"
                >
                  <i className="fas fa-times" />
                </button>
              </div>
              <div className={styles.modalBody}>
                {deleteDbDialog.step === 'warning' ? (
                  <div className={styles.resetConfirmWarning}>
                    <div className={styles.warningIcon}>💥</div>
                    <h4>极度危险操作！</h4>
                    <p><strong>此操作将完全删除数据库文件并重启应用程序！</strong></p>
                    <div className={styles.warningDetails}>
                      <h5>将会发生的事情：</h5>
                      <ul>
                        <li>🗑️ 完全删除数据库文件 (vocabulary.db)</li>
                        <li>🔄 自动重启应用程序</li>
                        <li>🆕 重启后将创建全新的空数据库</li>
                        <li>❌ 所有数据将永久丢失，包括：
                          <ul>
                            <li>所有单词本和单词</li>
                            <li>所有学习计划和进度</li>
                            <li>所有练习记录</li>
                            <li>AI模型配置</li>
                            <li>系统设置</li>
                          </ul>
                        </li>
                      </ul>
                    </div>
                    <div className={styles.warningNote}>
                      <p><strong>⚠️ 注意：此操作比"重置数据库"更彻底，连AI配置也会丢失！</strong></p>
                      <p>如果您只想清理用户数据，请使用"重置所有用户数据"功能。</p>
                    </div>
                  </div>
                ) : (
                  <div className={styles.resetConfirmWarning}>
                    <div className={styles.warningIcon}>🔥</div>
                    <h4>最终确认</h4>
                    <p>请在下方输入框中输入 <strong>"DELETE DATABASE"</strong> 来确认此操作：</p>
                    <input
                      type="text"
                      className={styles.confirmInput}
                      value={deleteDbDialog.confirmText}
                      onChange={(e) => setDeleteDbDialog(prev => ({
                        ...prev,
                        confirmText: e.target.value
                      }))}
                      placeholder="请输入 DELETE DATABASE"
                      autoFocus
                    />
                    <p className={styles.inputHint}>
                      只有输入正确的确认文本才能执行删除操作
                    </p>
                  </div>
                )}
              </div>
              <div className={styles.modalFooter}>
                <Button
                  variant="secondary"
                  onClick={handleDeleteDbCancel}
                  disabled={resetting}
                >
                  取消
                </Button>
                <Button
                  onClick={handleDeleteDbConfirm}
                  disabled={resetting || (deleteDbDialog.step === 'confirm' && deleteDbDialog.confirmText !== 'DELETE DATABASE')}
                  variant="danger"
                >
                  {resetting ? '删除中...' : deleteDbDialog.step === 'warning' ? '继续' : '确认删除数据库'}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Error Modal */}
        {errorState.isOpen && (
          <div className={styles.errorModal}>
            <div className={styles.errorModalContent}>
              <h3 className={styles.errorTitle}>错误</h3>
              <p className={styles.errorMessage}>{errorState.message}</p>
              <div className={styles.errorActions}>
                <Button onClick={hideError}>关闭</Button>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* 确认对话框 */}
      <ConfirmDialog
        isOpen={confirmDialog.isOpen}
        title={confirmDialog.title}
        message={confirmDialog.message}
        type={confirmDialog.type}
        onConfirm={confirmDialog.onConfirm}
        onCancel={() => {
          console.log('User cancelled in confirm dialog');
          setConfirmDialog(prev => ({ ...prev, isOpen: false }));
        }}
      />
    </div>
  );
};
