import React, { useState, useEffect } from 'react';
import { Modal, Button, Input, TextArea } from '../';
import { ThemeSelector } from '../ThemeSelector';
import { type WordBook, type UpdateWordBookRequest, type ThemeTag } from '../../types';
import { WordBookService } from '../../services/wordbookService';
import styles from './EditWordBookModal.module.css';

export interface EditWordBookModalProps {
  /** 是否显示模态框 */
  isOpen: boolean;
  /** 关闭模态框 */
  onClose: () => void;
  /** 单词本数据 */
  wordBook: WordBook | null;
  /** 保存回调 */
  onSave: (data: UpdateWordBookRequest) => Promise<void>;
  /** 保存中状态 */
  saving?: boolean;
}

/**
 * 编辑单词本信息模态框
 */
export const EditWordBookModal: React.FC<EditWordBookModalProps> = ({
  isOpen,
  onClose,
  wordBook,
  onSave,
  saving = false
}) => {
  const [formData, setFormData] = useState<UpdateWordBookRequest>({
    title: '',
    description: '',
    icon: 'bookmark',
    status: 'normal',
    theme_tag_ids: []
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [availableThemes, setAvailableThemes] = useState<ThemeTag[]>([]);
  const [selectedThemeIds, setSelectedThemeIds] = useState<string[]>([]);
  const [themesLoading, setThemesLoading] = useState(false);

  // 加载主题标签
  useEffect(() => {
    const loadThemes = async () => {
      setThemesLoading(true);
      try {
        const wordbookService = new WordBookService();
        const result = await wordbookService.getThemeTags();
        if (result.success && result.data) {
          setAvailableThemes(result.data);
        }
      } catch (error) {
        console.error('加载主题标签失败:', error);
      } finally {
        setThemesLoading(false);
      }
    };

    if (isOpen) {
      loadThemes();
    }
  }, [isOpen]);

  // 当单词本数据变化时更新表单
  useEffect(() => {
    if (wordBook) {
      const currentThemeIds = wordBook.theme_tags?.map(tag => tag.id.toString()) || [];

      setFormData({
        title: wordBook.title,
        description: wordBook.description || '',
        icon: wordBook.icon || 'bookmark',
        status: wordBook.status || 'normal',
        theme_tag_ids: wordBook.theme_tags?.map(tag => tag.id) || []
      });
      setSelectedThemeIds(currentThemeIds);
      setErrors({});
    }
  }, [wordBook]);

  // 表单验证
  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.title || !formData.title.trim()) {
      newErrors.title = '单词本名称不能为空';
    } else if (formData.title.trim().length > 100) {
      newErrors.title = '单词本名称不能超过100个字符';
    }

    if (formData.description && formData.description.length > 500) {
      newErrors.description = '描述不能超过500个字符';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // 处理保存
  const handleSave = async () => {
    if (!validateForm()) {
      return;
    }

    try {
      await onSave(formData);
      onClose();
    } catch (error) {
      console.error('保存失败:', error);
    }
  };

  // 处理输入变化
  const handleInputChange = (field: keyof UpdateWordBookRequest, value: string) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));

    // 清除对应字段的错误
    if (errors[field]) {
      setErrors(prev => ({
        ...prev,
        [field]: ''
      }));
    }
  };

  // 处理主题标签选择变化
  const handleThemeSelectionChange = (selectedIds: string[]) => {
    setSelectedThemeIds(selectedIds);
    setFormData(prev => ({
      ...prev,
      theme_tag_ids: selectedIds.map(id => parseInt(id))
    }));
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="编辑单词本信息"
      size="medium"
    >
      <div className={styles.form}>
        <div className={styles.field}>
          <label className={styles.label}>
            单词本名称 <span className={styles.required}>*</span>
          </label>
          <Input
            value={formData.title || ''}
            onChange={(value) => handleInputChange('title', value)}
            placeholder="请输入单词本名称"
            error={errors.title}
            maxLength={100}
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label}>描述</label>
          <TextArea
            value={formData.description || ''}
            onChange={(value) => handleInputChange('description', value)}
            placeholder="请输入单词本描述（可选）"
            error={errors.description}
            maxLength={500}
            rows={4}
          />
        </div>

        {/* 主题标签选择器 */}
        <div className={styles.field}>
          <label className={styles.label}>主题标签</label>
          {themesLoading ? (
            <div className={styles.loading}>
              <i className="fas fa-spinner fa-spin" />
              <span>加载主题标签中...</span>
            </div>
          ) : (
            <ThemeSelector
              themes={availableThemes.map(tag => ({
                id: tag.id.toString(),
                name: tag.name,
                icon: tag.icon,
                color: 'primary' as const // 简化颜色处理
              }))}
              selectedThemes={selectedThemeIds}
              onSelectionChange={handleThemeSelectionChange}
              multiple={true}
              label=""
              description="选择一个或多个主题标签来分类你的单词本"
            />
          )}
        </div>

        <div className={styles.field}>
          <label className={styles.label}>图标</label>
          <div className={styles.iconSelector}>
            {['bookmark', 'book', 'graduation-cap', 'globe', 'star', 'heart'].map((icon) => (
              <button
                key={icon}
                type="button"
                className={`${styles.iconOption} ${formData.icon === icon ? styles.selected : ''}`}
                onClick={() => handleInputChange('icon', icon)}
                title={`选择${icon}图标`}
              >
                <i className={`fas fa-${icon}`} />
              </button>
            ))}
          </div>
        </div>

        <div className={styles.field}>
          <label className={styles.label}>状态</label>
          <div className={styles.statusSelector}>
            <button
              type="button"
              className={`${styles.statusOption} ${formData.status === 'draft' ? styles.selected : ''}`}
              onClick={() => handleInputChange('status', 'draft')}
            >
              <i className="fas fa-edit" />
              <span>草稿</span>
              <small>可以继续编辑和完善</small>
            </button>
            <button
              type="button"
              className={`${styles.statusOption} ${formData.status === 'normal' ? styles.selected : ''}`}
              onClick={() => handleInputChange('status', 'normal')}
            >
              <i className="fas fa-check-circle" />
              <span>正式</span>
              <small>已完成，可以开始学习</small>
            </button>
          </div>
        </div>
      </div>

      <div className={styles.actions}>
        <Button
          variant="secondary"
          onClick={onClose}
          disabled={saving}
        >
          取消
        </Button>
        <Button
          variant="primary"
          onClick={handleSave}
          loading={saving}
        >
          保存
        </Button>
      </div>
    </Modal>
  );
};

export default EditWordBookModal;
