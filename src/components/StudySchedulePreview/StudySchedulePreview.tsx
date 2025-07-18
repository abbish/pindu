import React, { useState } from 'react';
import styles from './StudySchedulePreview.module.css';
import type { StudyPlanAIResult, DailyStudyPlan } from '../../types';

export interface StudySchedulePreviewProps {
  /** AI规划结果 */
  aiResult: StudyPlanAIResult | null;
}

/**
 * 学习计划日程预览组件
 */
export const StudySchedulePreview: React.FC<StudySchedulePreviewProps> = ({
  aiResult
}) => {
  const [expandedDays, setExpandedDays] = useState<Set<number>>(new Set());
  const [viewMode, setViewMode] = useState<'summary' | 'detailed'>('summary');

  // 如果没有AI结果，显示占位符
  if (!aiResult) {
    return (
      <div className={styles.container}>
        <div className={styles.header}>
          <div className={styles.headerInfo}>
            <h3>学习计划详情</h3>
            <p>等待AI规划结果...</p>
          </div>
        </div>
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon}>
            <i className="fas fa-calendar-alt" />
          </div>
          <p>AI规划完成后将显示详细的学习计划</p>
        </div>
      </div>
    );
  }

  const toggleDayExpansion = (day: number) => {
    const newExpanded = new Set(expandedDays);
    if (newExpanded.has(day)) {
      newExpanded.delete(day);
    } else {
      newExpanded.add(day);
    }
    setExpandedDays(newExpanded);
  };

  const expandAll = () => {
    setExpandedDays(new Set(aiResult.dailyPlans.map(plan => plan.day)));
  };

  const collapseAll = () => {
    setExpandedDays(new Set());
  };

  const getWordTypeStats = (dailyPlan: DailyStudyPlan) => {
    const newWords = dailyPlan.words.filter(word => !word.isReview);
    const reviewWords = dailyPlan.words.filter(word => word.isReview);
    
    return {
      newCount: newWords.length,
      reviewCount: reviewWords.length,
      total: dailyPlan.words.length
    };
  };

  const getPriorityStats = (dailyPlan: DailyStudyPlan) => {
    const high = dailyPlan.words.filter(word => word.priority === 'high').length;
    const medium = dailyPlan.words.filter(word => word.priority === 'medium').length;
    const low = dailyPlan.words.filter(word => word.priority === 'low').length;
    
    return { high, medium, low };
  };

  return (
    <div className={styles.container}>
      {/* 头部信息 */}
      <div className={styles.header}>
        <div className={styles.headerInfo}>
          <h3>学习计划详情</h3>
          <p>共 {aiResult.dailyPlans.length} 天，{aiResult.planMetadata.totalWords} 个单词</p>
        </div>
        
        <div className={styles.headerControls}>
          <div className={styles.viewModeToggle}>
            <button
              className={`${styles.toggleButton} ${viewMode === 'summary' ? styles.active : ''}`}
              onClick={() => setViewMode('summary')}
            >
              概览
            </button>
            <button
              className={`${styles.toggleButton} ${viewMode === 'detailed' ? styles.active : ''}`}
              onClick={() => setViewMode('detailed')}
            >
              详细
            </button>
          </div>
          
          {viewMode === 'detailed' && (
            <div className={styles.expandControls}>
              <button className={styles.controlButton} onClick={expandAll}>
                展开全部
              </button>
              <button className={styles.controlButton} onClick={collapseAll}>
                收起全部
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 计划元数据 */}
      <div className={styles.metadata}>
        <div className={styles.metadataGrid}>
          <div className={styles.metadataItem}>
            <span className={styles.metadataLabel}>计划类型:</span>
            <span className={styles.metadataValue}>{aiResult.planMetadata.planType}</span>
          </div>
          <div className={styles.metadataItem}>
            <span className={styles.metadataLabel}>学习强度:</span>
            <span className={styles.metadataValue}>
              {aiResult.planMetadata.intensityLevel === 'easy' && '轻松模式'}
              {aiResult.planMetadata.intensityLevel === 'normal' && '标准模式'}
              {aiResult.planMetadata.intensityLevel === 'intensive' && '强化模式'}
            </span>
          </div>
          <div className={styles.metadataItem}>
            <span className={styles.metadataLabel}>复习频率:</span>
            <span className={styles.metadataValue}>{aiResult.planMetadata.reviewFrequency} 次</span>
          </div>
          <div className={styles.metadataItem}>
            <span className={styles.metadataLabel}>学习周期:</span>
            <span className={styles.metadataValue}>
              {aiResult.planMetadata.startDate} 至 {aiResult.planMetadata.endDate}
            </span>
          </div>
        </div>
      </div>

      {/* 日程列表 */}
      <div className={styles.scheduleList}>
        {viewMode === 'summary' ? (
          // 概览模式
          <div className={styles.summaryView}>
            {aiResult.dailyPlans.map((dailyPlan, index) => {
              const stats = getWordTypeStats(dailyPlan);
              const priorities = getPriorityStats(dailyPlan);
              
              return (
                <div key={index} className={styles.summaryItem}>
                  <div className={styles.summaryHeader}>
                    <div className={styles.dayInfo}>
                      <span className={styles.dayNumber}>第 {dailyPlan.day} 天</span>
                      <span className={styles.dayDate}>{dailyPlan.date}</span>
                    </div>
                    <div className={styles.summaryStats}>
                      <span className={styles.statBadge}>
                        新学: {stats.newCount}
                      </span>
                      <span className={styles.statBadge}>
                        复习: {stats.reviewCount}
                      </span>
                      <span className={styles.statBadge}>
                        总计: {stats.total}
                      </span>
                    </div>
                  </div>
                  
                  <div className={styles.priorityBar}>
                    <div 
                      className={styles.prioritySegment} 
                      style={{ 
                        width: `${(priorities.high / stats.total) * 100}%`,
                        backgroundColor: 'var(--color-error)'
                      }}
                      title={`高优先级: ${priorities.high} 个`}
                    />
                    <div 
                      className={styles.prioritySegment} 
                      style={{ 
                        width: `${(priorities.medium / stats.total) * 100}%`,
                        backgroundColor: 'var(--color-warning)'
                      }}
                      title={`中优先级: ${priorities.medium} 个`}
                    />
                    <div 
                      className={styles.prioritySegment} 
                      style={{ 
                        width: `${(priorities.low / stats.total) * 100}%`,
                        backgroundColor: 'var(--color-success)'
                      }}
                      title={`低优先级: ${priorities.low} 个`}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          // 详细模式
          <div className={styles.detailedView}>
            {aiResult.dailyPlans.map((dailyPlan, index) => {
              const isExpanded = expandedDays.has(dailyPlan.day);
              const stats = getWordTypeStats(dailyPlan);
              
              return (
                <div key={index} className={styles.detailedItem}>
                  <div 
                    className={styles.detailedHeader}
                    onClick={() => toggleDayExpansion(dailyPlan.day)}
                  >
                    <div className={styles.dayInfo}>
                      <span className={styles.dayNumber}>第 {dailyPlan.day} 天</span>
                      <span className={styles.dayDate}>{dailyPlan.date}</span>
                    </div>
                    <div className={styles.headerStats}>
                      <span className={styles.wordCount}>{stats.total} 个单词</span>
                      <span className={styles.breakdown}>
                        新学 {stats.newCount} · 复习 {stats.reviewCount}
                      </span>
                    </div>
                    <div className={styles.expandIcon}>
                      <i className={`fas fa-chevron-${isExpanded ? 'up' : 'down'}`} />
                    </div>
                  </div>
                  
                  {isExpanded && (
                    <div className={styles.detailedContent}>
                      <div className={styles.wordsList}>
                        {dailyPlan.words.map((word, wordIndex) => (
                          <div key={wordIndex} className={styles.wordItem}>
                            <div className={styles.wordInfo}>
                              <span className={styles.wordText}>{word.word}</span>
                              <div className={styles.wordMeta}>
                                <span className={`${styles.wordType} ${word.isReview ? styles.review : styles.new}`}>
                                  {word.isReview ? `复习 (第${word.reviewCount}次)` : '新学'}
                                </span>
                                <span className={`${styles.priority} ${styles[word.priority]}`}>
                                  {word.priority === 'high' && '高'}
                                  {word.priority === 'medium' && '中'}
                                  {word.priority === 'low' && '低'}
                                </span>
                                <span className={styles.difficulty}>
                                  难度 {word.difficultyLevel}
                                </span>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default StudySchedulePreview;
