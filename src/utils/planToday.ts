/**
 * 计划卡上的「今天」（纯逻辑，首页与学习计划列表共用）：
 * - 今天要做什么：单词日程（含过期待补）+ 到期没完成的短文任务，合成计划卡日程栏的一行小字；
 * - 「继续学习」先去哪：今天的单词没练完 → 单词练习；单词练完（或只练短文）且有到期短文 → 那篇短文；
 *   都没有 → 原来的行为（单词计划按 pickPracticeSchedule 选日程，只练短文的计划打开详情）。
 */
import type { PracticeContent, TodayStudySchedule } from '../types/study';
import type { TodayPassageTask } from '../types/passage';

/** 到期没完成的短文任务（最早到期的在前） */
function pendingOf(tasks: TodayPassageTask[]): TodayPassageTask[] {
  return tasks
    .filter((t) => t.status !== 'completed')
    .sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate) || a.itemId - b.itemId);
}

/** 今天的单词日程是否还要练（没有今天的日程视为不用） */
const wordsPending = (schedule: TodayStudySchedule | undefined) => !!schedule && schedule.status !== 'completed';

export type PlanNextStep = { kind: 'words' } | { kind: 'passage'; task: TodayPassageTask } | { kind: 'default' };

/** 「继续学习」的去向；passageTasks 为这个计划今天的短文任务（get_today_passage_tasks 中属于该计划的） */
export function nextStepOf(
  practiceContent: PracticeContent | undefined,
  todaySchedule: TodayStudySchedule | undefined,
  passageTasks: TodayPassageTask[]
): PlanNextStep {
  const pendingPassages = pendingOf(passageTasks);
  if (practiceContent !== 'passages' && wordsPending(todaySchedule)) return { kind: 'words' };
  if (pendingPassages.length > 0) return { kind: 'passage', task: pendingPassages[0] };
  return { kind: 'default' };
}

/** 日程栏的“今天”一行；今天什么都没有时为 null（显示原来的图例） */
export function todayLine(
  todaySchedule: TodayStudySchedule | undefined,
  passageTasks: TodayPassageTask[],
  dateLabel: (date: string) => string
): { text: string; warning: boolean } | null {
  const pendingPassages = pendingOf(passageTasks);
  const parts: string[] = [];
  let warning = false;
  if (wordsPending(todaySchedule)) {
    const s = todaySchedule!;
    if (s.status === 'overdue') {
      warning = true;
      parts.push(`${dateLabel(s.schedule_date)}的单词还没练${s.overdue_count > 1 ? `（共 ${s.overdue_count} 天待补）` : ''}`);
    }
    const counts = [s.new_words_count > 0 && `新词 ${s.new_words_count}`, s.review_words_count > 0 && `复习 ${s.review_words_count}`].filter(Boolean);
    parts.push(counts.length > 0 ? counts.join(' · ') : `单词 ${s.total_words_count}`);
  }
  if (pendingPassages.length > 0) {
    if (pendingPassages.some((t) => t.status === 'overdue')) warning = true;
    parts.push(pendingPassages.length === 1 ? `短文《${pendingPassages[0].title}》` : `短文 ${pendingPassages.length} 篇`);
  }
  if (parts.length > 0) return { text: `今天：${parts.join(' · ')}`, warning };
  // 今天有过任务且都做完了
  return todaySchedule || passageTasks.length > 0 ? { text: '今天已练完', warning: false } : null;
}
