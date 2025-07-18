import React, { useState, useEffect } from 'react';
import { Button, Input, TextArea, Select, Modal } from '../';
import { type Word, type UpdateWordRequest } from '../../types';
import styles from './EditWordModal.module.css';

export interface EditWordModalProps {
  /** 是否显示模态框 */
  isOpen: boolean;
  /** 关闭模态框回调 */
  onClose: () => void;
  /** 要编辑的单词数据 */
  word: Word | null;
  /** 保存回调 */
  onSave: (wordId: number, data: UpdateWordRequest) => Promise<void>;
  /** 保存状态 */
  saving?: boolean;
}

// 词性选项
const PART_OF_SPEECH_OPTIONS = [
  { value: 'n.', label: '名词 (n.)' },
  { value: 'v.', label: '动词 (v.)' },
  { value: 'adj.', label: '形容词 (adj.)' },
  { value: 'adv.', label: '副词 (adv.)' },
  { value: 'prep.', label: '介词 (prep.)' },
  { value: 'conj.', label: '连词 (conj.)' },
  { value: 'int.', label: '感叹词 (int.)' },
  { value: 'pron.', label: '代词 (pron.)' }
];



/**
 * 编辑单词模态框组件
 */
export const EditWordModal: React.FC<EditWordModalProps> = ({
  isOpen,
  onClose,
  word,
  onSave,
  saving = false
}) => {
  const [formData, setFormData] = useState<UpdateWordRequest>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  // 当单词数据变化时，重置表单
  useEffect(() => {
    if (word) {
      setFormData({
        word: word.word,
        meaning: word.meaning,
        description: word.description || '',
        ipa: word.ipa || '',
        syllables: word.syllables || '',
        phonics_segments: word.phonics_segments || '',
        part_of_speech: word.part_of_speech || 'n.',
        category_id: word.category_id,
        // 新增自然拼读分析字段
        pos_abbreviation: word.pos_abbreviation || '',
        pos_english: word.pos_english || '',
        pos_chinese: word.pos_chinese || '',
        phonics_rule: word.phonics_rule || '',
        analysis_explanation: word.analysis_explanation || ''
      });
      setErrors({});
    }
  }, [word]);

  const handleInputChange = (field: keyof UpdateWordRequest, value: string | number) => {
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

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.word?.trim()) {
      newErrors.word = '单词不能为空';
    }

    if (!formData.meaning?.trim()) {
      newErrors.meaning = '中文释义不能为空';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = async () => {
    if (!word || !validateForm()) {
      return;
    }

    try {
      await onSave(word.id, formData);
      onClose();
    } catch (error) {
      console.error('保存单词失败:', error);
    }
  };

  const handleClose = () => {
    setFormData({});
    setErrors({});
    onClose();
  };

  if (!word) {
    return null;
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="编辑单词"
      size="large"
    >
      <div className={styles.container}>
        <form className={styles.form} onSubmit={(e) => e.preventDefault()}>
          {/* 基础信息 */}
          <div className={styles.section}>
            <h4 className={styles.sectionTitle}>基础信息</h4>
            <div className={styles.row}>
              <div className={styles.field}>
                <label className={styles.label}>
                  单词 <span className={styles.required}>*</span>
                </label>
                <Input
                  value={formData.word || ''}
                  onChange={(value) => handleInputChange('word', value)}
                  placeholder="请输入单词"
                  error={errors.word}
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>
                  中文释义 <span className={styles.required}>*</span>
                </label>
                <Input
                  value={formData.meaning || ''}
                  onChange={(value) => handleInputChange('meaning', value)}
                  placeholder="请输入中文释义"
                  error={errors.meaning}
                />
              </div>
            </div>
            
            <div className={styles.field}>
              <label className={styles.label}>详细描述</label>
              <TextArea
                value={formData.description || ''}
                onChange={(value) => handleInputChange('description', value)}
                placeholder="请输入详细描述（可选）"
                rows={3}
              />
            </div>
          </div>

          {/* 语音信息 */}
          <div className={styles.section}>
            <h4 className={styles.sectionTitle}>语音信息</h4>
            <div className={styles.row}>
              <div className={styles.field}>
                <label className={styles.label}>IPA音标</label>
                <Input
                  value={formData.ipa || ''}
                  onChange={(value) => handleInputChange('ipa', value)}
                  placeholder="请输入IPA音标"
                />
              </div>
            </div>
            
            <div className={styles.row}>
              <div className={styles.field}>
                <label className={styles.label}>音节</label>
                <Input
                  value={formData.syllables || ''}
                  onChange={(value) => handleInputChange('syllables', value)}
                  placeholder="请输入音节划分"
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>自然拼读片段</label>
                <Input
                  value={formData.phonics_segments || ''}
                  onChange={(value) => handleInputChange('phonics_segments', value)}
                  placeholder="请输入自然拼读片段"
                />
              </div>
            </div>
          </div>

          {/* 语法信息 */}
          <div className={styles.section}>
            <h4 className={styles.sectionTitle}>语法信息</h4>
            <div className={styles.row}>
              <div className={styles.field}>
                <label className={styles.label}>词性</label>
                <Select
                  value={formData.part_of_speech || 'n.'}
                  onChange={(value) => handleInputChange('part_of_speech', value)}
                  options={PART_OF_SPEECH_OPTIONS}
                />
              </div>
            </div>

            <div className={styles.row}>
              <div className={styles.field}>
                <label className={styles.label}>词性缩写</label>
                <Input
                  value={formData.pos_abbreviation || ''}
                  onChange={(value) => handleInputChange('pos_abbreviation', value)}
                  placeholder="请输入词性缩写"
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>词性英文</label>
                <Input
                  value={formData.pos_english || ''}
                  onChange={(value) => handleInputChange('pos_english', value)}
                  placeholder="请输入词性英文"
                />
              </div>
            </div>

            <div className={styles.field}>
              <label className={styles.label}>词性中文</label>
              <Input
                value={formData.pos_chinese || ''}
                onChange={(value) => handleInputChange('pos_chinese', value)}
                placeholder="请输入词性中文"
              />
            </div>
          </div>

          {/* 自然拼读分析 */}
          <div className={styles.section}>
            <h4 className={styles.sectionTitle}>自然拼读分析</h4>
            <div className={styles.field}>
              <label className={styles.label}>拼读规则</label>
              <Input
                value={formData.phonics_rule || ''}
                onChange={(value) => handleInputChange('phonics_rule', value)}
                placeholder="请输入拼读规则"
              />
            </div>

            <div className={styles.field}>
              <label className={styles.label}>分析说明</label>
              <TextArea
                value={formData.analysis_explanation || ''}
                onChange={(value) => handleInputChange('analysis_explanation', value)}
                placeholder="请输入分析说明（可选）"
                rows={3}
              />
            </div>
          </div>
        </form>

        {/* 操作按钮 */}
        <div className={styles.actions}>
          <Button
            variant="secondary"
            onClick={handleClose}
            disabled={saving}
          >
            取消
          </Button>
          <Button
            variant="primary"
            onClick={handleSave}
            loading={saving}
            disabled={saving}
          >
            保存
          </Button>
        </div>
      </div>
    </Modal>
  );
};

export default EditWordModal;
