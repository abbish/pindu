/** 素材之间的关联（对应 Rust `types/material.rs`）：标签（单词本 / 短文（含视频切片）/ 原始视频共用）与单词 */
import type { Id } from './common';

/** 标签 */
export interface Tag {
  id: Id;
  name: string;
  /** 图标（emoji；旧「主题」迁来的有，新建的可以没有） */
  icon: string | null;
}

/** 标签与各类素材的数量 */
export interface TagUsage extends Tag {
  wordBooks: number;
  passages: number;
  videos: number;
}

/** 素材种类 */
export type MaterialKind = 'word_book' | 'passage' | 'video';

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
