/** 短文库的类型，对应 Rust `types/passage.rs`（camelCase） */
import type { Tag } from './material';

/** 短文的一句：英文 + 中文翻译 */
export interface PassageSentence {
  en: string;
  zh: string;
  /** 本句开始新段落（导入的材料保留原文分段；AI 写的短文为 false） */
  paragraph: boolean;
  /** 视频短片：这句在短片里的开始 / 结束（毫秒）；文字短文没有 */
  startMs?: number;
  endMs?: number;
}

/** 短文用到的目标词 */
export interface PassageTargetWord {
  /** 手动输入的词为 null */
  wordId: number | null;
  word: string;
  /** true = 用户指定必须出现；false = AI 从来源中挑选 */
  required: boolean;
  /** AI 重点词的中文释义（导入材料时给出；其它为 null） */
  meaning: string | null;
  /** 词组在原文里的实际写法（AI 标注或划选的原文；高亮、挖空按它定位）。单词与没有标注的不返回 */
  forms?: string[];
}

/**
 * 计划的取词策略（可多选，取并集）：wrong 错词 / weak 还没记牢 / recent 最近学的 /
 * upcoming 快到复习 / mastered 已经掌握 / learned 全部学过的
 */
export type PlanWordScope = 'wrong' | 'weak' | 'recent' | 'upcoming' | 'mastered' | 'learned';

/** 一种取词策略能取到的词数 */
export interface PlanScopeCount {
  scope: PlanWordScope;
  count: number;
}

/** 短文的来源（创建时的快照） */
export interface PassageSource {
  /** book 词汇本 / plan 学习计划 */
  kind: 'book' | 'plan';
  refId: number;
  /** 创建时的名称 */
  name: string;
  /** plan 的取词策略（逗号分隔） */
  detail: string | null;
  /** 来源是否还在（被删除时为 false） */
  exists: boolean;
}

/** 难度：basic 基础 / standard 标准 / advanced 提高 */
export type QuestionDifficulty = 'basic' | 'standard' | 'advanced';

/** 题组的生成参数 */
export interface QuestionSetSpec {
  /** 选词填空空数 */
  cloze: number;
  choice: number;
  trueFalse: number;
  open: number;
  difficulty: QuestionDifficulty;
}

/** 题型 */
export type QuestionKind = 'cloze' | 'choice' | 'true_false' | 'open';

/** 题目 */
export interface PassageQuestion {
  id: number;
  kind: QuestionKind;
  /** cloze：被挖空的词（与原文写法一致）；其它：题干 */
  stem: string;
  /** choice 的选项 */
  options: string[];
  /** cloze：被挖空的词；choice：正确选项下标；true_false："true" / "false"；open：null */
  answer: string | null;
  explanation: string | null;
  /** open 的参考答案 */
  referenceAnswer: string | null;
  /** open 的评分要点 */
  rubric: string[];
  /** cloze：空位所在句子（从 0 开始） */
  sentenceIndex: number | null;
}

/** 练习模式：reading 阅读 / listening 听力 */
export type PassageMode = 'reading' | 'listening';

/** 一次完成的作答（列表用） */
export interface PassageAttemptBrief {
  id: number;
  mode: PassageMode;
  objectiveCorrect: number;
  objectiveTotal: number;
  openScore: number | null;
  openTotal: number | null;
  completedAt: string | null;
}

/** 题组摘要 */
export interface QuestionSetSummary {
  id: number;
  passageId: number;
  name: string;
  spec: QuestionSetSpec;
  createdAt: string;
  /** 完成的作答次数 */
  completedAttempts: number;
  lastAttempt: PassageAttemptBrief | null;
}

/** 题组（练习用） */
export interface QuestionSet {
  id: number;
  passageId: number;
  name: string;
  spec: QuestionSetSpec;
  modelName: string | null;
  createdAt: string;
  questions: PassageQuestion[];
  /** 选词填空的词库（答案 + 干扰词，已打乱） */
  clozeBank: string[];
}

/** 短文详情 */
export interface Passage {
  id: number;
  title: string;
  sentences: PassageSentence[];
  targetWords: PassageTargetWord[];
  /** 生成时用的场景 */
  scene: string | null;
  sources: PassageSource[];
  /** 英语水平 a1 / a2 / b1 / b2 */
  level: string;
  /** 英文词数 */
  wordCount: number;
  modelName: string | null;
  createdAt: string;
  questionSets: QuestionSetSummary[];
  /** generated：AI 写的；imported：导入的用户材料 */
  origin: PassageOrigin;
  /** 导入材料的来源说明（文件名或「粘贴的文本」） */
  sourceLabel: string | null;
  tags: Tag[];
}

/** 短文列表项 */
export interface PassageSummary {
  id: number;
  title: string;
  level: string;
  wordCount: number;
  targetWords: PassageTargetWord[];
  sources: PassageSource[];
  createdAt: string;
  /** 题组数 */
  questionSets: number;
  /** 完成的作答次数（所有题组） */
  completedAttempts: number;
  lastAttempt: PassageAttemptBrief | null;
  /** generated：AI 写的；imported：导入的用户材料 */
  origin: PassageOrigin;
  /** 导入材料的来源说明 */
  sourceLabel: string | null;
  tags: Tag[];
}

/** 选词填空一空的结果 */
export interface ClozeResult {
  questionId: number;
  answer: string;
  given: string;
  correct: boolean;
}

/** 一道题的结果（不含选词填空） */
export interface QuestionResult {
  questionId: number;
  given: string;
  /** 客观题是否答对（开放题为 null） */
  correct: boolean | null;
  /** 开放题得分（0–4；未评出为 null） */
  score: number | null;
  feedback: string | null;
  suggestion: string | null;
}

/** 作答记录 */
export interface PassageAttempt {
  id: number;
  setId: number;
  passageId: number;
  planId: number | null;
  scheduleId: number | null;
  mode: PassageMode;
  status: 'in_progress' | 'completed';
  clozeResults: ClozeResult[];
  questionResults: QuestionResult[];
  objectiveCorrect: number;
  objectiveTotal: number;
  openScore: number | null;
  openTotal: number | null;
  /** 开放题 AI 评分失败的原因（可重试） */
  gradingError: string | null;
  /** 毫秒 */
  activeTime: number;
  startedAt: string;
  completedAt: string | null;
}

/** 词汇来源：词汇本、学习计划（都可多选） */
export interface PassageWordSources {
  bookIds: number[];
  planIds: number[];
  /** 计划的取词策略（空 = 全部学过的） */
  planScopes: PlanWordScope[];
}

/** 候选词 */
export interface PassageWordCandidate {
  wordId: number;
  word: string;
  meaning: string;
  /** 来源名称（词汇本名或计划名） */
  source: string;
  /** 已在几篇短文里用过 */
  usage: number;
  /** 计划里的学习情况标签（词汇本来源为空） */
  tags: Exclude<PlanWordScope, 'learned'>[];
  /** 挑词用的学习情况：new / learning / mastered 之一，答错过再加 wrong（词汇本来源按所有计划的练习记录） */
  statuses: PickStatus[];
}

/** AI 挑词的学习情况：没学过 / 学过未掌握 / 常错 / 已掌握 */
export type PickStatus = 'new' | 'learning' | 'wrong' | 'mastered';
/** AI 挑词的单词难度（相对学习者水平） */
export type PickDifficulty = 'easy' | 'medium' | 'hard';
/** AI 挑词的常用程度：日常常用 / 也要书面、少见的 */
export type PickFrequency = 'common' | 'advanced';

/** 生成短文 */
export interface GeneratePassageRequest {
  bookIds: number[];
  planIds: number[];
  /** 计划的取词策略 */
  planScopes: PlanWordScope[];
  /** 必须出现的词（来源里勾选的） */
  requiredWordIds: number[];
  /** 必须出现的词（手动输入） */
  extraWords: string[];
  /** 这些词的中文释义（小写单词 → 释义；按描述生成时 AI 选词给出） */
  extraMeanings?: Record<string, string>;
  /** 再让 AI 从来源里挑几个适合场景的词 */
  aiPick: number;
  /** AI 只从这些学习情况的词里挑（空 = 不限） */
  pickStatuses?: PickStatus[];
  /** AI 挑词的单词难度（空 = 不限） */
  pickDifficulty?: PickDifficulty | null;
  /** AI 挑词的常用程度（空 = 不限） */
  pickFrequency?: PickFrequency | null;
  /** 场景描述（空 = 用所选词汇本的场景） */
  topic?: string | null;
  /** 按描述生成：写作要求（主题、体裁、人物等）；有它时可以不选单词 */
  instruction?: string | null;
  length?: PassageLength;
  /** 按内容规划里的一篇来写（此时用它的词、篇幅与构思） */
  planItem?: PassagePlanItem | null;
}

/** 篇幅：short 一个小片段 / standard 一个完整的小故事 / long 更多细节和情节 */
export type PassageLength = 'short' | 'standard' | 'long';

/** 内容规划里的一篇（AI 提议，用户可改标题、构思、篇幅） */
export interface PassagePlanItem {
  /** 建议标题（英文） */
  title: string;
  /** 故事构思（中文，多行） */
  idea: string;
  /** 这一篇用的词 */
  words: PassageTargetWord[];
  length: PassageLength;
}

/** 内容规划 */
export interface PassagePlan {
  items: PassagePlanItem[];
  /** 为什么这样规划 */
  note: string;
  /** AI 建议的调整方向（针对这份规划） */
  adjustments: string[];
}

/** 为短文生成一套阅读理解题 */
export interface GenerateQuestionSetRequest {
  passageId: number;
  /** 题组名称（空 = 第 N 套） */
  name?: string | null;
  spec: QuestionSetSpec;
}

/** 一道题的作答 */
export interface PassageAnswer {
  questionId: number;
  /** cloze：填的词；choice：选项下标；true_false："true" / "false"；open：回答文字 */
  value: string;
}

/** 提交作答 */
export interface SubmitPassageAttemptRequest {
  attemptId: number;
  /** 毫秒 */
  activeTime: number;
  answers: PassageAnswer[];
}

/** 一种模式的统计 */
export interface PassageModeStatistics {
  attempts: number;
  /** 客观题正确率 0–100 */
  objectiveAccuracy: number | null;
  /** 开放题得分率 0–100 */
  openScoreRate: number | null;
  /** 毫秒 */
  totalTime: number;
}

/** 短文练习统计（与单词练习口径独立） */
export interface PassageStatistics {
  /** 短文总数 */
  totalPassages: number;
  /** 阅读理解题组总数 */
  totalSets: number;
  /** 练过的短文篇数 */
  passages: number;
  reading: PassageModeStatistics;
  listening: PassageModeStatistics;
}

// ==================== 学习计划里的短文（C4） ====================

/** 计划里的一项短文任务（新建计划 / 修改计划短文时传入） */
export interface PlanPassageInput {
  passageId: number;
  /** 用哪套阅读理解题；为空表示只朗读、自由学习（点「读完了」算完成） */
  setId?: number | null;
  /** 练习方式（默认 reading） */
  mode?: PassageMode;
}

/** 修改计划的练习内容与短文（顺序即排期顺序） */
export interface SetPlanPassagesRequest {
  planId: number;
  /** words / passages / both */
  practiceContent: 'words' | 'passages' | 'both';
  /** 完整顺序：已完成的短文必须包含在内（其日期、题组、方式锁定） */
  passages: PlanPassageInput[];
  /** 每几天一篇（1–30） */
  intervalDays: number;
}

/** 短文任务状态：已完成 / 今天 / 逾期 / 之后 */
export type PlanPassageStatus = 'completed' | 'due' | 'overdue' | 'upcoming';

/** 计划里的一项短文任务 */
export interface PlanPassage {
  id: number;
  planId: number;
  passageId: number;
  title: string;
  level: string;
  wordCount: number;
  /** 为空：只朗读的任务 */
  setId: number | null;
  setName: string | null;
  mode: PassageMode;
  sortOrder: number;
  /** 本地日期 YYYY-MM-DD */
  scheduledDate: string;
  completedAt: string | null;
  status: PlanPassageStatus;
  /** 完成这项任务的作答（只读任务为空） */
  attempt: PassageAttemptBrief | null;
  /** 视频切片：只读任务即「看视频跟读」 */
  isVideo: boolean;
}

/** 今天的短文任务（到期没完成的 + 今天完成的） */
export interface TodayPassageTask {
  itemId: number;
  planId: number;
  planName: string;
  passageId: number;
  title: string;
  wordCount: number;
  setId: number | null;
  setName: string | null;
  mode: PassageMode;
  /** 视频切片 */
  isVideo: boolean;
  scheduledDate: string;
  status: Exclude<PlanPassageStatus, 'upcoming'>;
}

/** 给计划挑短文时的候选范围：新建计划传 bookIds，已有计划传 planId */
export interface PlanPassageCandidatesRequest {
  bookIds?: number[];
  planId?: number | null;
}

/** 可加进计划的短文 */
export interface PlanPassageCandidate {
  passage: PassageSummary;
  /** 相关度：目标词里属于计划单词（或所选词汇本）的个数 */
  overlap: number;
  /** 题组（新到旧） */
  sets: QuestionSetSummary[];
  /** 加进计划时默认用的题组：最早生成的一套；没有题组为空（只朗读） */
  defaultSetId: number | null;
}

// ==================== 导入材料（passage-import） ====================

/** 短文的来源：AI 写的 / 导入的用户材料 */
export type PassageOrigin = 'generated' | 'imported' | 'video';

/** 导入材料里的一句原文 */
export interface ImportSentence {
  en: string;
  /** 本句开始新段落 */
  paragraph: boolean;
}

/** 预处理请求：text 与文件二选一（都给时用文件） */
export interface PrepareImportRequest {
  text?: string | null;
  fileName?: string | null;
  /** 文件内容（base64）：txt / md / srt / vtt / docx / pdf，上限 10MB */
  fileBase64?: string | null;
  /** 每篇目标词数（120–450，默认 300） */
  targetWords?: number | null;
}

/** 预览里的一篇 */
export interface ImportPreviewItem {
  title: string;
  sentences: ImportSentence[];
  wordCount: number;
}

/** 预处理结果：清理、分句、按篇幅拆好的预览（不保存） */
export interface ImportPreview {
  /** 文件名或「粘贴的文本」 */
  sourceLabel: string;
  items: ImportPreviewItem[];
  totalWords: number;
  /** 给用户看的提示（如超出上限已截断） */
  warnings: string[];
}

/** 导入一篇：AI 逐句翻译（原文不改）后保存 */
export interface ImportPassageRequest {
  /** 前端生成，用于取消 */
  /** 为空时 AI 起标题 */
  title?: string | null;
  /** 最多 120 句 */
  sentences: ImportSentence[];
  sourceLabel: string;
  /** 原文里属于这些词汇本的词标为目标词 */
  bookIds: number[];
  /** AI 挑重点词（带中文释义） */
  aiKeyWords: boolean;
}

/** 短文里还不在词汇本的目标词 */
export interface PassageNewWord {
  word: string;
  meaning: string | null;
}

/** 把短文里的生词加进词汇本 */
export interface AddPassageWordsRequest {
  passageId: number;
  bookId: number;
  words: string[];
}

/** 读取资料文件（词汇本提取与短文导入共用） */
export interface ReadMaterialRequest {
  fileName: string;
  /** 文件内容 base64：txt / md / srt / vtt / docx / pdf，上限 10MB */
  fileBase64: string;
}

/** 从文件读出的纯文本（已清理；段落之间空一行） */
export interface MaterialText {
  text: string;
  /** 文件名 */
  sourceLabel: string;
  warnings: string[];
}

/** 导入几篇材料（后台任务） */
export interface ImportPassagesRequest {
  items: ImportPassageRequest[];
}

/** 按内容规划写几篇短文（后台任务） */
export interface GeneratePassagesRequest {
  /** 来源、必用词、挑词偏好、主题与篇幅（planItem 不填） */
  base: GeneratePassageRequest;
  items: PassagePlanItem[];
}

/** 写短文任务里一篇的状态（job.detail.items） */
export interface PassageItemStatus {
  state: 'waiting' | 'running' | 'done' | 'failed';
  passageId: number | null;
  /** 写好 / 导入好的短文标题 */
  title: string | null;
  error: string | null;
}

// ==================== 句子分析 ====================

/** 句子成分：原句里连续的一段 + 它在句中的作用 */
export interface SentenceChunk {
  text: string;
  /** 主语 / 谓语 / 宾语 / 状语 / 某某从句… */
  role: string;
}

/** 语法点 */
export interface GrammarPoint {
  title: string;
  /** 原句里体现它的片段（可能为空） */
  text: string;
  explanation: string;
}

/** 句子里的词组 */
export interface SentencePhrase {
  /** 原句里的写法（可能是变形） */
  text: string;
  /** 原形（加入目标词时用） */
  base: string;
  meaning: string;
}

/** 发音要点 */
export interface PronunciationTip {
  text: string;
  tip: string;
}

/** 同一交际功能的其他说法 */
export interface AlternativeExpression {
  en: string;
  zh: string;
}

/** 一句话的分析（AI 生成，按句子缓存） */
export interface SentenceAnalysis {
  /** 句式公式 */
  pattern: string;
  patternNote: string;
  chunks: SentenceChunk[];
  grammar: GrammarPoint[];
  /** 交际功能 */
  function: string;
  functionNote: string;
  alternatives: AlternativeExpression[];
  phrases: SentencePhrase[];
  pronunciation: PronunciationTip[];
}

/** 分析短文 / 视频片段里的一句 */
export interface AnalyzeSentenceRequest {
  passageId: number;
  /** 句子序号（从 0 开始） */
  sentenceIndex: number;
  /** 不用已有的分析，重新生成 */
  refresh?: boolean;
}

/** 指向短文里的一句 */
export interface SentenceRef {
  passageId: number;
  sentenceIndex: number;
}

/** 新建短文时请 AI 给场景建议 */
export interface PassageSceneSuggestRequest {
  /** 所选词汇本（用它们的场景描述） */
  bookIds: number[];
  /** 所选学习计划（用计划里单词所在词汇本的场景） */
  planIds: number[];
  /** 指定的单词（它们所在的词汇本也算进场景） */
  wordIds: number[];
  /** 其他要用的词（手动输入、AI 选的，或候选词节选） */
  words: string[];
  /** 已经给过的建议（换一批时新的不重复） */
  exclude: string[];
}

