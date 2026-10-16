/** 本机发音评估（对应 src-tauri/src/pronunciation 与 handlers/pronunciation.rs，camelCase） */

export interface PronunciationStatus {
  /** 这台电脑能运行本机模型；不能时不显示跟读评估 */
  supported: boolean;
  /** 模型已下载，可以评估 */
  ready: boolean;
  /** 模型大小（字节） */
  modelBytes: number;
  /** 正在下载的任务 id */
  downloadJob: string | null;
  settings: PronunciationSettings;
}

/** 发音评估设置（「设置 → 朗读与发音」） */
export interface PronunciationSettings {
  /** 练习「看 · 说」时跟读并评估 */
  enabled: boolean;
  /** auto 跟学习者（小学生宽松，其余标准） */
  strictness: 'auto' | 'lenient' | 'standard' | 'strict';
}

export interface AssessPronunciationRequest {
  /** 要读的英文（一个词或一句话） */
  text: string;
  /** 录音：16kHz 单声道 16 位小端 PCM，base64 */
  audio: string;
  /** 学习计划里的跟读：带上时保存结果（给计划的发音统计） */
  context?: PronunciationContext;
}

export interface PronunciationContext {
  planId: number;
  sessionId?: string;
  wordId?: number;
  passageId?: number;
}

/** 计划的发音统计里的一个音 */
export interface SoundStat {
  /** 这个音（IPA） */
  ipa: string;
  /** 读过几次 */
  times: number;
  /** 其中读得不准的次数 */
  weak: number;
  /** 最常听成的音（空字符串 = 常没读出来） */
  heardAs: string | null;
  /** 读错过的词 */
  words: string[];
}

export interface PronunciationOverview {
  /** 跟读了几次 */
  attempts: number;
  /** 平均分 */
  average: number | null;
  /** 常错的音，不准的比例高的在前 */
  sounds: SoundStat[];
}

export interface PhoneAssessment {
  /** 标准读法里的这个音（IPA） */
  ipa: string;
  /** 0–100 */
  score: number;
  /** 不准时最像的读法（IPA；空字符串表示像是没读出来） */
  heardAs: string | null;
  /** 明显读成了常见的读偏（如 th 读成 s）：分数不变，可以提醒一句 */
  likelyConfused: boolean;
}

export interface WordAssessment {
  word: string;
  /** 词典里有这个词（没有的不评分） */
  known: boolean;
  score: number | null;
  phones: PhoneAssessment[];
}

export interface Assessment {
  /** 能评分的词的平均分 */
  score: number | null;
  words: WordAssessment[];
  /** 听到的音（IPA） */
  heard: string;
  /** 有没有听到说话 */
  voiced: boolean;
}

/** 语音输入（本机把说的话转成文字，中英文都认） */
export interface DictationStatus {
  /** 这台电脑能运行本机模型；不能时不显示说话输入 */
  supported: boolean;
  /** 模型已下载 */
  ready: boolean;
  /** 模型大小（字节） */
  modelBytes: number;
  /** 正在下载的任务 */
  downloadJob: string | null;
}

/** zh 中文为主（夹着英文单词也认）/ en 英文 */
export type DictationLanguage = 'zh' | 'en';

/** 评估同步跟读 / 影子跟读的一段录音 */
export interface AssessShadowingRequest {
  /** 这段录音跟着说的句子（按顺序） */
  texts: string[];
  /** 每句原声在录音里大概的位置（毫秒，相对录音开头） */
  windows: ([number, number] | null)[];
  /** 录音：16kHz 单声道 16 位小端 PCM，base64 */
  audio: string;
}

/** 跟读录音里的一句：学习者说这句的位置（毫秒，相对录音开头；没说为 null）与每个词说没说出来 */
export interface ShadowSentence {
  startMs: number | null;
  endMs: number | null;
  words: ShadowWord[];
}

export interface ShadowWord {
  word: string;
  /** 说出来了 */
  said: boolean;
  /** 说出来时在录音里的起点（毫秒） */
  startMs: number | null;
}
