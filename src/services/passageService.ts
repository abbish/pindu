import { BaseService } from './baseService';
import type { ApiResult, Word } from '../types';
import type {
  AnalyzeSentenceRequest,
  SentenceAnalysis,
  AddPassageWordsRequest,
  GeneratePassageRequest,
  GeneratePassagesRequest,
  ImportPassagesRequest,
  ImportPreview,
  PassageNewWord,
  PassageOrigin,
  PrepareImportRequest,
  GenerateQuestionSetRequest,
  Passage,
  PassageAttempt,
  PassageMode,
  PassageStatistics,
  PassageSummary,
  PassageWordCandidate,
  PassagePlan,
  PassageWordSources,
  PlanScopeCount,
  PlanPassage,
  PlanPassageCandidate,
  PlanPassageCandidatesRequest,
  QuestionSet,
  SetPlanPassagesRequest,
  SubmitPassageAttemptRequest,
  TodayPassageTask,
} from '../types/passage';
import type { WordCard } from '../types/material';
import { notifyOnSuccess } from './tagService';

/** 短文库：短文（独立素材）、阅读理解题组、作答与统计 */
class PassageService extends BaseService {
  /** 候选词：按来源（词汇本、学习计划）合并去重 */
  async getWordCandidates(request: PassageWordSources): Promise<ApiResult<PassageWordCandidate[]>> {
    return this.executeWithLoading(() => this.client.invoke<PassageWordCandidate[]>('get_passage_word_candidates', { request }));
  }

  /** 所选计划里每种取词策略能取到的词数 */
  async getPlanScopeCounts(planIds: number[]): Promise<ApiResult<PlanScopeCount[]>> {
    return this.executeWithLoading(() =>
      this.client.invoke<PlanScopeCount[]>('get_plan_scope_counts', {
        planIds,
      }),
    );
  }

  /** 内容规划：AI 提议写几篇、每篇的构思与用词（约 20–40 秒；不保存）。`feedback` 为对上一版的调整意见 */
  async planPassages(request: GeneratePassageRequest, feedback?: string): Promise<ApiResult<PassagePlan>> {
    return this.executeWithLoading(() =>
      this.client.invoke<PassagePlan>('plan_passages', {
        request,
        feedback: feedback || null,
      }),
    );
  }

  /** 按内容规划逐篇写短文（后台任务）：返回任务 id；逐篇状态在 job.detail.items，写好的 id 在 job.result.passageIds */
  async startGeneration(request: GeneratePassagesRequest): Promise<ApiResult<string>> {
    return this.executeWithLoading(() => this.client.invoke<string>('start_passage_generation', { request }));
  }

  async getPassages(filter: { bookId?: number; planId?: number; origin?: PassageOrigin } = {}): Promise<ApiResult<PassageSummary[]>> {
    return this.executeWithLoading(() => this.client.invoke<PassageSummary[]>('get_passages', filter));
  }

  async getPassage(passageId: number): Promise<ApiResult<Passage>> {
    return this.executeWithLoading(() => this.client.invoke<Passage>('get_passage', { passageId }));
  }

  /** 目标词的完整资料（音标、音节、拼读、释义、例句），朗读时点词查看 */
  async getPassageWords(passageId: number): Promise<ApiResult<Word[]>> {
    return this.executeWithLoading(() => this.client.invoke<Word[]>('get_passage_words', { passageId }));
  }

  /** 不在词汇本的目标词已有的单词卡 */
  async getWordCards(passageId: number): Promise<ApiResult<WordCard[]>> {
    return this.executeWithLoading(() => this.client.invoke<WordCard[]>('get_passage_word_cards', { passageId }));
  }

  /** 读原文时把选中的词加成目标词，返回更新后的短文 */
  /** `form`：词组在原文里的写法（句子分析给出的，如 picked it up）；读原文划选时不传 */
  async addTargetWord(passageId: number, word: string, form?: string): Promise<ApiResult<Passage>> {
    return this.executeWithLoading(() => this.client.invoke<Passage>('add_passage_target_word', { passageId, word, form }));
  }

  /** 分析短文里的一句（已分析过且不要求重新分析时直接返回保存的结果） */
  async analyzeSentence(request: AnalyzeSentenceRequest): Promise<ApiResult<SentenceAnalysis>> {
    return this.executeWithLoading(() => this.client.invoke<SentenceAnalysis>('analyze_sentence', { request }));
  }

  /** 给还没有单词卡的未收录目标词生成单词卡（后台任务）；都有了返回 null */
  async startWordCards(passageId: number): Promise<ApiResult<string | null>> {
    return this.executeWithLoading(() => this.client.invoke<string | null>('start_word_cards', { passageId }));
  }

  async deletePassage(passageId: number): Promise<ApiResult<void>> {
    return notifyOnSuccess(await this.executeWithLoading(() => this.client.invoke<void>('delete_passage', { passageId })));
  }

  /** 出一套阅读理解题（后台任务）：返回任务 id；完成后题组已保存，job.result 为 { setId, name, count } */
  async startQuestionSetGeneration(request: GenerateQuestionSetRequest): Promise<ApiResult<string>> {
    return this.executeWithLoading(() => this.client.invoke<string>('start_question_set_generation', { request }));
  }

  async getQuestionSet(setId: number): Promise<ApiResult<QuestionSet>> {
    return this.executeWithLoading(() => this.client.invoke<QuestionSet>('get_question_set', { setId }));
  }

  async deleteQuestionSet(setId: number): Promise<ApiResult<void>> {
    return this.executeWithLoading(() => this.client.invoke<void>('delete_question_set', { setId }));
  }

  /** 开始练习某套题；有未提交的同模式作答时接着用 */
  /** 开始作答；planId：从计划里的短文任务进入（完成后计入计划，待开始的计划随之开始） */
  async startAttempt(setId: number, mode: PassageMode, planId?: number): Promise<ApiResult<PassageAttempt>> {
    return this.executeWithLoading(() =>
      this.client.invoke<PassageAttempt>('start_passage_attempt', {
        setId,
        mode,
        planId,
      }),
    );
  }

  /** 提交作答：客观题即时判分，开放题 AI 评分 */
  async submitAttempt(request: SubmitPassageAttemptRequest): Promise<ApiResult<PassageAttempt>> {
    return this.executeWithLoading(() => this.client.invoke<PassageAttempt>('submit_passage_attempt', { request }));
  }

  /** 开放题评分失败后重试 */
  async regradeOpen(attemptId: number): Promise<ApiResult<PassageAttempt>> {
    return this.executeWithLoading(() => this.client.invoke<PassageAttempt>('regrade_passage_open', { attemptId }));
  }

  async getStatistics(planId?: number): Promise<ApiResult<PassageStatistics>> {
    return this.executeWithLoading(() =>
      this.client.invoke<PassageStatistics>('get_passage_statistics', {
        planId,
      }),
    );
  }

  // ==================== 导入材料 ====================

  /** 预处理材料：清理、分句、按篇幅拆好（确定性，不用 AI，不保存） */
  async prepareImport(request: PrepareImportRequest): Promise<ApiResult<ImportPreview>> {
    return this.executeWithLoading(() => this.client.invoke<ImportPreview>('prepare_passage_import', { request }));
  }

  /** 导入几篇材料（后台任务）：返回任务 id；逐篇状态在 job.detail.items，导入好的 id 在 job.result.passageIds */
  async startImport(request: ImportPassagesRequest): Promise<ApiResult<string>> {
    return this.executeWithLoading(() => this.client.invoke<string>('start_passage_import', { request }));
  }

  /** 短文里还不在词汇本的目标词 */
  async getNewWords(passageId: number): Promise<ApiResult<PassageNewWord[]>> {
    return this.executeWithLoading(() => this.client.invoke<PassageNewWord[]>('get_passage_new_words', { passageId }));
  }

  /** 把短文里的生词加进词汇本，返回新建单词的 id */
  async addWordsToBook(request: AddPassageWordsRequest): Promise<ApiResult<number[]>> {
    return this.executeWithLoading(() => this.client.invoke<number[]>('add_passage_words_to_book', { request }));
  }

  // ==================== 学习计划里的短文 ====================

  /** 计划里的短文任务（按顺序，含状态与完成作答） */
  async getPlanPassages(planId: number): Promise<ApiResult<PlanPassage[]>> {
    return this.executeWithLoading(() => this.client.invoke<PlanPassage[]>('get_plan_passages', { planId }));
  }

  /** 修改计划的练习内容、短文（完整顺序）与间隔天数 */
  async setPlanPassages(request: SetPlanPassagesRequest): Promise<ApiResult<void>> {
    return this.executeWithLoading(() => this.client.invoke<void>('set_plan_passages', { request }));
  }

  /** 今天的短文任务（首页） */
  async getTodayPassageTasks(): Promise<ApiResult<TodayPassageTask[]>> {
    return this.executeWithLoading(() => this.client.invoke<TodayPassageTask[]>('get_today_passage_tasks'));
  }

  /** 可加进计划的短文（按相关度排序，含题组） */
  async getPlanPassageCandidates(request: PlanPassageCandidatesRequest): Promise<ApiResult<PlanPassageCandidate[]>> {
    return this.executeWithLoading(() => this.client.invoke<PlanPassageCandidate[]>('get_plan_passage_candidates', { request }));
  }

  /** 只朗读的短文任务：读完了 */
  async completePlanPassageReading(planId: number, passageId: number): Promise<ApiResult<void>> {
    return this.executeWithLoading(() =>
      this.client.invoke<void>('complete_plan_passage_reading', {
        planId,
        passageId,
      }),
    );
  }
}

export const passageService = new PassageService();
