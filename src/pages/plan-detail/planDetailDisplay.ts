/**
 * 计划详情页的纯展示函数（无 React 依赖，可在 node --test 中测试）
 */
import type { StudyPlanAction, UnifiedStudyPlanStatus } from '../../types';

export interface ActionConfig {
  /** 按钮文案 */
  label: string;
  /** primary：页头按钮；menu：放进“更多”菜单；danger：“更多”菜单里的破坏性操作 */
  tone: 'primary' | 'menu' | 'danger';
}

export function getActionConfig(action: string, _currentStatus?: UnifiedStudyPlanStatus): ActionConfig {
  switch (action) {
    case 'publish':
      return { label: '发布计划', tone: 'primary' };
    case 'start':
      return { label: '开始学习', tone: 'primary' };
    case 'resume':
      return { label: '继续学习', tone: 'primary' };
    case 'restart':
      return { label: '重新学习', tone: 'primary' };
    case 'pause':
      return { label: '暂停计划', tone: 'menu' };
    case 'complete':
      return { label: '标记为完成', tone: 'menu' };
    case 'terminate':
      return { label: '终止学习', tone: 'danger' };
    case 'delete':
      return { label: '删除计划', tone: 'danger' };
    default:
      return { label: action, tone: 'primary' };
  }
}

const PRIORITY: Partial<Record<StudyPlanAction, number>> = {
  resume: 1,
  start: 2,
  publish: 3,
  restart: 4,
  pause: 6,
  complete: 7,
  terminate: 8,
  delete: 9,
};

/**
 * 页头操作排序并分组：主操作是页头按钮；暂停、标记完成放进“更多”菜单；终止、删除是菜单里的破坏性操作。
 * 计划删除是物理删除，不存在“已删除”计划，恢复 / 永久删除不再出现。
 */
export function groupPlanActions(
  actions: StudyPlanAction[],
  status: UnifiedStudyPlanStatus
): { primary: StudyPlanAction[]; menu: StudyPlanAction[]; danger: StudyPlanAction[] } {
  const sorted = actions
    .filter((a) => a !== 'restore' && a !== 'permanentDelete')
    .sort((a, b) => (PRIORITY[a] ?? 99) - (PRIORITY[b] ?? 99));
  const tone = (a: StudyPlanAction) => getActionConfig(a, status).tone;
  return {
    primary: sorted.filter((a) => tone(a) === 'primary'),
    menu: sorted.filter((a) => tone(a) === 'menu'),
    danger: sorted.filter((a) => tone(a) === 'danger'),
  };
}

// 时间进度的唯一实现在 utils/timeProgress.ts（计划卡片与详情页共用，口径与后端统计一致）
export { calculateTimeProgress } from '../../utils/timeProgress';
