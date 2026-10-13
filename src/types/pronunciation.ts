/** 本机发音评估（对应 src-tauri/src/pronunciation 与 handlers/pronunciation.rs，camelCase） */

export interface PronunciationStatus {
  /** 模型已下载，可以评估 */
  ready: boolean;
  /** 模型大小（字节） */
  modelBytes: number;
  /** 正在下载的任务 id */
  downloadJob: string | null;
  settings: PronunciationSettings;
}

/** 发音评估设置（「设置 → 学习者 → 发音」） */
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
