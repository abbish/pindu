import React from 'react';
import styles from './ActionButtons.module.css';

export interface ActionButtonsProps {
  /** 开始下一个计划回调 */
  onNextPlan?: () => void;
  /** 重新练习回调 */
  onRetry?: () => void;
  /** 查看详细报告回调 */
  onDetailedReport?: () => void;
  /** 禁用状态 */
  disabled?: boolean;
}

/**
 * 操作按钮组件
 */
export const ActionButtons: React.FC<ActionButtonsProps> = ({
  onNextPlan,
  onRetry,
  onDetailedReport,
  disabled = false
}) => {
  const buttons = [
    {
      icon: 'fas fa-arrow-right',
      text: '开始下一个计划',
      onClick: onNextPlan,
      className: styles.nextBtn
    },
    {
      icon: 'fas fa-redo',
      text: '重新练习',
      onClick: onRetry,
      className: styles.retryBtn
    },
    {
      icon: 'fas fa-chart-bar',
      text: '查看详细报告',
      onClick: onDetailedReport,
      className: styles.reportBtn
    }
  ];

  return (
    <div className={styles.container}>
      {buttons.map((button, index) => (
        <button
          key={index}
          className={`${styles.actionBtn} ${button.className}`}
          onClick={button.onClick}
          disabled={disabled}
          type="button"
        >
          <i className={button.icon} />
          {button.text}
        </button>
      ))}
    </div>
  );
};

export default ActionButtons;