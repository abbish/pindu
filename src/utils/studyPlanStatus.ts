import type {
  StudyPlanStatus,
  StudyPlanLifecycleStatus,
  StatusDisplayConfig,
  StatusFilterOption,
  UnifiedStudyPlanStatus
} from '../types';

/**
 * 获取管理状态的显示配置
 */
export function getStatusDisplay(status: StudyPlanStatus): StatusDisplayConfig {
  switch (status) {
    case 'normal':
      return {
        label: '正常',
        color: 'green',
        icon: 'check-circle'
      };
    case 'draft':
      return {
        label: '草稿',
        color: 'orange',
        icon: 'edit'
      };
    case 'deleted':
      return {
        label: '已删除',
        color: 'red',
        icon: 'trash'
      };
    default:
      return {
        label: '未知',
        color: 'gray',
        icon: 'question-circle'
      };
  }
}

/**
 * 获取生命周期状态的显示配置
 */
export function getLifecycleStatusDisplay(status: StudyPlanLifecycleStatus): StatusDisplayConfig {
  switch (status) {
    case 'pending':
      return {
        label: '待开始',
        color: 'blue',
        icon: 'clock'
      };
    case 'active':
      return {
        label: '进行中',
        color: 'green',
        icon: 'play'
      };
    case 'completed':
      return {
        label: '已完成',
        color: 'gray',
        icon: 'check'
      };
    case 'terminated':
      return {
        label: '已终止',
        color: 'red',
        icon: 'stop'
      };
    default:
      return {
        label: '未知',
        color: 'gray',
        icon: 'question-circle'
      };
  }
}

/**
 * 检查状态转换是否合法
 */
export function canTransitionTo(
  currentStatus: StudyPlanStatus,
  currentLifecycleStatus: StudyPlanLifecycleStatus,
  targetAction: 'start' | 'complete' | 'terminate' | 'restart' | 'edit' | 'publish' | 'delete'
): boolean {
  switch (targetAction) {
    case 'start':
      return currentStatus === 'normal' && currentLifecycleStatus === 'pending';
    case 'complete':
      return currentStatus === 'normal' && currentLifecycleStatus === 'active';
    case 'terminate':
      return currentStatus === 'normal' && currentLifecycleStatus === 'active';
    case 'restart':
      return currentStatus === 'normal' && (currentLifecycleStatus === 'completed' || currentLifecycleStatus === 'terminated');
    case 'edit':
      return currentStatus === 'normal';
    case 'publish':
      return currentStatus === 'draft';
    case 'delete':
      return currentStatus !== 'deleted';
    default:
      return false;
  }
}

/**
 * 获取可用的操作按钮
 */
export function getAvailableActions(
  status: StudyPlanStatus,
  lifecycleStatus: StudyPlanLifecycleStatus,
  unifiedStatus?: UnifiedStudyPlanStatus
): Array<{
  action: string;
  label: string;
  icon: string;
  color: 'primary' | 'success' | 'warning' | 'danger';
  confirmMessage?: string;
}> {
  const actions = [];

  // 优先使用新的统一状态，如果没有则使用旧的双状态系统
  const currentStatus = unifiedStatus || convertLegacyStatus(status, lifecycleStatus);

  // 按照新的统一状态定义按钮显示逻辑
  switch (currentStatus) {
    case 'Pending':
      // 待开始状态 = 可以看到开始学习 + 进入草稿
      actions.push({
        action: 'start',
        label: '开始学习',
        icon: 'play',
        color: 'primary' as const,
        confirmMessage: '确认开始此学习计划吗？'
      });
      actions.push({
        action: 'edit',
        label: '进入草稿',
        icon: 'edit',
        color: 'warning' as const,
        confirmMessage: '进入草稿状态后可以修改计划内容，但需要重新生成日程。确认继续吗？'
      });
      break;

    case 'Active':
      // 进行中状态 = 可以看到终止学习
      actions.push({
        action: 'terminate',
        label: '终止学习',
        icon: 'stop',
        color: 'danger' as const,
        confirmMessage: '确认终止此学习计划吗？终止后可以重新开始学习。'
      });
      break;

    case 'Completed':
    case 'Terminated':
      // 已完成/已终止状态 = 可以看到重新学习 + 删除计划
      actions.push({
        action: 'restart',
        label: '重新学习',
        icon: 'refresh',
        color: 'primary' as const,
        confirmMessage: '重新学习将清空所有历史进度并重新生成日程，确认继续吗？'
      });
      actions.push({
        action: 'delete',
        label: '删除计划',
        icon: 'trash',
        color: 'danger' as const,
        confirmMessage: '确认删除此学习计划吗？删除后无法恢复。'
      });
      break;

    case 'Draft':
      // 草稿状态 = 可以看到编辑计划 + 删除计划
      actions.push({
        action: 'edit',
        label: '编辑计划',
        icon: 'edit',
        color: 'warning' as const
      });
      actions.push({
        action: 'delete',
        label: '删除计划',
        icon: 'trash',
        color: 'danger' as const,
        confirmMessage: '确认删除此学习计划吗？删除后无法恢复。'
      });
      break;

    case 'Deleted':
      // 已删除状态 = 无可用操作
      break;

    default:
      // 未知状态，回退到旧逻辑
      console.warn('Unknown unified status:', currentStatus);
      break;
  }

  return actions;
}

/**
 * 将旧的双状态系统转换为新的统一状态
 */
function convertLegacyStatus(
  status: StudyPlanStatus,
  lifecycleStatus: StudyPlanLifecycleStatus
): UnifiedStudyPlanStatus {
  if (status === 'deleted') return 'Deleted';
  if (status === 'draft') return 'Draft';

  // status === 'normal'
  switch (lifecycleStatus) {
    case 'pending': return 'Pending';
    case 'active': return 'Active';
    case 'completed': return 'Completed';
    case 'terminated': return 'Terminated';
    default: return 'Draft';
  }
}

/**
 * 获取状态过滤选项
 */
export function getStatusFilterOptions(): StatusFilterOption[] {
  return [
    { value: 'all', label: '全部状态' },
    { value: 'normal', label: '正常' },
    { value: 'draft', label: '草稿' },
    { value: 'deleted', label: '已删除' }
  ];
}

/**
 * 获取生命周期状态过滤选项
 */
export function getLifecycleStatusFilterOptions(): StatusFilterOption[] {
  return [
    { value: 'all', label: '全部阶段' },
    { value: 'pending', label: '待开始' },
    { value: 'active', label: '进行中' },
    { value: 'completed', label: '已完成' },
    { value: 'terminated', label: '已终止' }
  ];
}

/**
 * 格式化状态变更历史的显示文本
 */
export function formatStatusHistoryMessage(
  fromStatus?: string,
  toStatus?: string,
  fromLifecycleStatus?: string,
  toLifecycleStatus?: string,
  reason?: string
): string {
  const statusPart = fromStatus && toStatus && fromStatus !== toStatus
    ? `状态从"${getStatusDisplay(fromStatus as StudyPlanStatus).label}"变更为"${getStatusDisplay(toStatus as StudyPlanStatus).label}"`
    : '';

  const lifecyclePart = fromLifecycleStatus && toLifecycleStatus && fromLifecycleStatus !== toLifecycleStatus
    ? `阶段从"${getLifecycleStatusDisplay(fromLifecycleStatus as StudyPlanLifecycleStatus).label}"变更为"${getLifecycleStatusDisplay(toLifecycleStatus as StudyPlanLifecycleStatus).label}"`
    : '';

  const parts = [statusPart, lifecyclePart].filter(Boolean);
  const changeText = parts.length > 0 ? parts.join('，') : '状态更新';

  return reason ? `${changeText}（${reason}）` : changeText;
}

/**
 * 获取状态组合的显示文本
 */
export function getStatusCombinationText(
  status: StudyPlanStatus,
  lifecycleStatus: StudyPlanLifecycleStatus
): string {
  const statusConfig = getStatusDisplay(status);
  const lifecycleConfig = getLifecycleStatusDisplay(lifecycleStatus);
  
  if (status === 'deleted') {
    return statusConfig.label;
  }
  
  return `${statusConfig.label} · ${lifecycleConfig.label}`;
}
