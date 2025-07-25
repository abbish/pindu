import React from 'react';
import { Modal } from '../Modal';
import { type PracticeSession } from '../../types/study';
import styles from './IncompletePracticeModal.module.css';

export interface IncompletePracticeModalProps {
  /** 是否显示模态框 */
  isOpen: boolean;
  /** 未完成的练习会话列表 */
  sessions: PracticeSession[];
  /** 继续练习回调 */
  onContinue: (session: PracticeSession) => void;
  /** 取消练习回调 */
  onCancel: (session: PracticeSession) => void;
  /** 关闭模态框回调 */
  onClose: () => void;
  /** 跳过提醒回调 */
  onSkip: () => void;
}

/**
 * 未完成练习提醒模态框
 */
export const IncompletePracticeModal: React.FC<IncompletePracticeModalProps> = ({
  isOpen,
  sessions,
  onContinue,
  onCancel,
  onClose,
  onSkip
}) => {
  // 格式化时间显示
  const formatTime = (timeString: string) => {
    const date = new Date(timeString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffHours / 24);

    if (diffDays > 0) {
      return `${diffDays}天前`;
    } else if (diffHours > 0) {
      return `${diffHours}小时前`;
    } else {
      return '刚刚';
    }
  };

  // 格式化练习时长
  const formatDuration = (milliseconds: number | null | undefined) => {
    if (!milliseconds || isNaN(milliseconds)) {
      return '0分0秒';
    }
    const minutes = Math.floor(milliseconds / (1000 * 60));
    const seconds = Math.floor((milliseconds % (1000 * 60)) / 1000);
    return `${minutes}分${seconds}秒`;
  };

  // 格式化日程日期
  const formatScheduleDate = (dateString: string) => {
    const date = new Date(dateString);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);

    // 比较日期（忽略时间）
    const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const todayOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const yesterdayOnly = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate());
    const tomorrowOnly = new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate());

    if (dateOnly.getTime() === todayOnly.getTime()) {
      return '今天';
    } else if (dateOnly.getTime() === yesterdayOnly.getTime()) {
      return '昨天';
    } else if (dateOnly.getTime() === tomorrowOnly.getTime()) {
      return '明天';
    } else {
      return date.toLocaleDateString('zh-CN', {
        month: 'short',
        day: 'numeric',
        weekday: 'short'
      });
    }
  };

  // 获取日程状态文本
  const getScheduleStatusText = (dateString: string) => {
    const date = new Date(dateString);
    const today = new Date();
    const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const todayOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate());

    if (dateOnly.getTime() < todayOnly.getTime()) {
      return '已延期';
    } else if (dateOnly.getTime() === todayOnly.getTime()) {
      return '今日计划';
    } else {
      return '未来计划';
    }
  };

  // 获取日程状态样式类
  const getScheduleStatusClass = (dateString: string) => {
    const date = new Date(dateString);
    const today = new Date();
    const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const todayOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate());

    if (dateOnly.getTime() < todayOnly.getTime()) {
      return styles.overdue; // 延期 - 红色
    } else if (dateOnly.getTime() === todayOnly.getTime()) {
      return styles.today; // 今天 - 绿色
    } else {
      return styles.future; // 未来 - 蓝色
    }
  };

  if (!isOpen || !sessions || sessions.length === 0) {
    return null;
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="发现未完成的练习"
      size="large"
    >
      <div className={styles.content}>
        <div className={styles.header}>
          <div className={styles.icon}>
            <i className="fas fa-clock" />
          </div>
          <div className={styles.message}>
            <h3 className={styles.title}>您有 {(sessions || []).length} 个未完成的练习</h3>
            <p className={styles.description}>
              继续之前的练习可以保持学习连贯性，提高学习效果。
            </p>
          </div>
        </div>

        <div className={styles.sessionList}>
          {(sessions || []).map((session) => {
            // 后端通过serde自动转换为camelCase，直接使用即可
            const sessionId = session.sessionId;
            const planId = session.planId;
            const scheduleDate = session.scheduleDate;
            const startTime = session.startTime;
            const activeTime = session.activeTime;
            const pauseCount = session.pauseCount;
            const wordStates = session.wordStates;
            const planTitle = session.planTitle || `学习计划 #${planId}`;

            return (
              <div key={sessionId} className={styles.sessionCard}>
                <div className={styles.sessionInfo}>
                  <div className={styles.sessionHeader}>
                    <h4 className={styles.sessionTitle}>
                      {planTitle}
                    </h4>
                    <span className={styles.sessionTime}>
                      {formatTime(startTime)}
                    </span>
                  </div>
                
                <div className={styles.sessionDetails}>
                  {/* 日程状态和日期 */}
                  <div className={styles.detailItem}>
                    <i className={`fas fa-calendar-day ${getScheduleStatusClass(scheduleDate)}`} />
                    <span>{getScheduleStatusText(scheduleDate)}: {formatScheduleDate(scheduleDate)}</span>
                  </div>

                  <div className={styles.detailItem}>
                    <i className="fas fa-clock" />
                    <span>已练习: {formatDuration(activeTime)}</span>
                  </div>

                  {pauseCount > 0 && (
                    <div className={styles.detailItem}>
                      <i className="fas fa-pause" />
                      <span>暂停 {pauseCount} 次</span>
                    </div>
                  )}

                  <div className={styles.detailItem}>
                    <i className="fas fa-book" />
                    <span>单词进度: {wordStates?.length || 0} 个单词</span>
                  </div>
                </div>
              </div>

              <div className={styles.sessionActions}>
                <button
                  type="button"
                  className={styles.continueBtn}
                  onClick={() => onContinue(session)}
                >
                  <i className="fas fa-play" />
                  继续练习
                </button>

                <button
                  type="button"
                  className={styles.cancelBtn}
                  onClick={() => onCancel(session)}
                  title="取消这个练习"
                >
                  <i className="fas fa-times" />
                </button>
              </div>
            </div>
            );
          })}
        </div>

        <div className={styles.footer}>
          <div className={styles.footerActions}>
            <button
              type="button"
              className={styles.skipBtn}
              onClick={onSkip}
            >
              跳过提醒
            </button>

            <button
              type="button"
              className={styles.closeBtn}
              onClick={onClose}
            >
              稍后处理
            </button>
          </div>
          
          <div className={styles.footerNote}>
            <i className="fas fa-info-circle" />
            <span>未完成的练习会保存您的进度，可以随时继续。</span>
          </div>
        </div>
      </div>
    </Modal>
  );
};

export default IncompletePracticeModal;
