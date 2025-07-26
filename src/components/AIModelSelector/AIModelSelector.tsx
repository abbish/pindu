import React, { useState, useEffect } from 'react';
import styles from './AIModelSelector.module.css';
import { AIModelService } from '../../services/aiModelService';
import type { AIModelConfig } from '../../types';

export interface AIModelSelectorProps {
  /** 选中的模型ID */
  selectedModel?: number;
  /** 模型选择变化回调 */
  onModelChange: (modelId?: number) => void;
  /** 是否禁用 */
  disabled?: boolean;
  /** 标签文本 */
  label?: string;
  /** 描述文本 */
  description?: string;
}

/**
 * AI模型选择器组件
 */
export const AIModelSelector: React.FC<AIModelSelectorProps> = ({
  selectedModel,
  onModelChange,
  disabled = false,
  label = 'AI模型选择',
  description = '选择用于分析的AI模型（可选，默认使用系统推荐模型）'
}) => {
  const [models, setModels] = useState<AIModelConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const aiModelService = new AIModelService();

  useEffect(() => {
    loadModels();
  }, []);

  const loadModels = async () => {
    try {
      setLoading(true);
      setError(null);

      const result = await aiModelService.getAIModels();
      if (result.success) {
        setModels(result.data);
        
        // 如果没有选中模型且有默认模型，自动选择默认模型
        if (!selectedModel) {
          const defaultModel = result.data.find(model => model.isDefault);
          if (defaultModel) {
            onModelChange(defaultModel.id);
          }
        }
      } else {
        throw new Error(result.error || '获取AI模型列表失败');
      }
    } catch (err) {
      console.error('Failed to load AI models:', err);
      setError(err instanceof Error ? err.message : '加载AI模型失败');
    } finally {
      setLoading(false);
    }
  };

  const handleModelChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value;
    if (value === '') {
      onModelChange(undefined);
    } else {
      onModelChange(parseInt(value));
    }
  };

  if (loading) {
    return (
      <div className={styles.container}>
        <label className={styles.label}>{label}</label>
        <div className={styles.loading}>
          <i className={`fas fa-spinner ${styles.loadingSpinner}`} />
          <span>加载AI模型...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.container}>
        <label className={styles.label}>{label}</label>
        <div className={styles.error}>
          <i className="fas fa-exclamation-triangle" />
          <span>{error}</span>
          <button 
            className={styles.retryButton}
            onClick={loadModels}
            type="button"
          >
            重试
          </button>
        </div>
      </div>
    );
  }

  if (models.length === 0) {
    return (
      <div className={styles.container}>
        <label className={styles.label}>{label}</label>
        <div className={styles.empty}>
          <i className="fas fa-robot" />
          <span>暂无可用的AI模型</span>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <label className={styles.label}>{label}</label>
      {description && (
        <p className={styles.description}>{description}</p>
      )}
      
      <select
        className={styles.select}
        value={selectedModel || ''}
        onChange={handleModelChange}
        disabled={disabled}
      >
        <option value="">使用系统推荐模型</option>
        {models.map(model => (
          <option key={model.id} value={model.id}>
            {model.displayName}
            {model.isDefault && ' (默认)'}
          </option>
        ))}
      </select>

      {selectedModel && (
        <div className={styles.modelInfo}>
          {(() => {
            const model = models.find(m => m.id === selectedModel);
            if (!model) return null;
            
            return (
              <div className={styles.modelDetails}>
                <div className={styles.modelName}>
                  <i className="fas fa-robot" />
                  <span>{model.displayName}</span>
                  {model.isDefault && (
                    <span className={styles.defaultBadge}>默认</span>
                  )}
                </div>
                {model.description && (
                  <div className={styles.modelDescription}>
                    {model.description}
                  </div>
                )}
                <div className={styles.modelParams}>
                  <span className={styles.param}>
                    最大令牌: {model.maxTokens || 4000}
                  </span>
                  <span className={styles.param}>
                    温度: {model.temperature || 0.3}
                  </span>
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
};

export default AIModelSelector;
