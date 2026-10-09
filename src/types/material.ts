/** 素材之间的关联（对应 Rust `types/material.rs`）：标签（单词本 / 短文（含视频切片）/ 原始视频共用）与单词 */
import type { Id } from './common';

/** 标签 */
export interface Tag {
  id: Id;
  name: string;
}

/** 标签与各类素材的数量 */
export interface TagUsage extends Tag {
  wordBooks: number;
  /** 短文（不含视频切片） */
  passages: number;
  /** 视频切片 */
  clips: number;
  /** 原始视频 */
  videos: number;
}

/** 素材种类（存储上的；视频切片的标签存在 passage 下） */
export type MaterialKind = 'word_book' | 'passage' | 'video';

/** 列表上的素材类别（标签筛选按它计数）：切片与短文分开 */
export type MaterialListKind = 'word_book' | 'passage' | 'clip' | 'video';

/** 切片的播放信息 */
export interface ClipBrief {
  videoId: Id;
  videoTitle: string;
  clipUrl: string | null;
  posterUrl: string | null;
  durationMs: number;
}

/** 某个词出现在一篇短文 / 切片里 */
export interface WordMaterial {
  passageId: Id;
  title: string;
  /** generated / imported / video */
  origin: string;
  level: string;
  /** 是这篇的重点词，否则只是正文里出现过 */
  key: boolean;
  /** 第一处出现的句子 */
  en: string;
  zh: string;
  /** 切片：这句在切片里的开始（毫秒） */
  startMs: number | null;
  clip: ClipBrief | null;
}

/** 单词本里一个词在素材里出现的次数 */
export interface WordMaterialCount {
  wordId: Id;
  /** 出现过的短文（不含切片） */
  passages: number;
  /** 出现过的视频切片 */
  clips: number;
}

/** 素材处理的默认值（「设置 → 素材」）；各页面打开时以它为默认，当次仍可修改 */
export interface MaterialSettings {
  /** 单词本：AI 生成单词的数量 */
  wordAiCount: number;
  /** 单词本：从材料提取单词 focus 重点词 / all 全部 */
  wordExtractMode: 'focus' | 'all';
  /** 短文：AI 写短文的篇幅 */
  passageLength: 'short' | 'standard' | 'long';
  /** 短文：AI 挑词的数量 / 难度 / 常用程度 */
  passagePickCount: number;
  passagePickDifficulty: 'easy' | 'medium' | 'hard' | 'any';
  passagePickFrequency: 'common' | 'advanced' | 'any';
  /** 短文：导入材料每篇大约多少词 */
  importTargetWords: number;
  /** 短文：导入材料时让 AI 挑重点词 */
  importKeyWords: boolean;
  /** 阅读理解题难度：auto 按短文水平 */
  questionDifficulty: 'auto' | 'basic' | 'standard' | 'advanced';
  /** 视频：导入时自动整理字幕（断句、补中文） */
  videoAutoPrepare: boolean;
  /** 视频：切分每段时长（秒） */
  videoMinSeconds: number;
  videoMaxSeconds: number;
  /** 学习计划：每天新词数 / 短文间隔天数 / 用 AI 排学习顺序 */
  planDailyNewWords: number;
  planPassageIntervalDays: number;
  planAiOrder: boolean;
}

/** 单词卡：不在单词本里的目标词的学习资料（对应 Rust WordCard） */
export interface WordCard {
  word: string;
  meaning: string;
  posAbbreviation: string;
  posChinese: string;
  ipa: string;
  syllables: string;
  phonicsRule: string;
  analysisExplanation: string;
  examples: { sentence: string; translation: string }[];
}
