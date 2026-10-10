import type { PassageSummary } from './passage';
import type { Tag } from './material';

/** 视频库类型（对应 src-tauri/src/types/video.rs、services/subtitle.rs 与 media.rs，camelCase） */

export type VideoStatus = 'importing' | 'ready' | 'processing' | 'done' | 'failed';

export interface Video {
  id: number;
  title: string;
  /** 导入时的视频文件名 */
  sourceName: string;
  subtitleName: string | null;
  /** 原视频还在（没有删除来释放空间） */
  hasSource: boolean;
  /** 编辑器播放的地址（本机媒体服务）；导入完成前为空 */
  mediaUrl: string | null;
  /** 封面地址 */
  coverUrl: string | null;
  durationMs: number;
  width: number | null;
  height: number | null;
  sizeBytes: number;
  status: VideoStatus;
  error: string | null;
  cueCount: number;
  clipCount: number;
  /** 字幕时间纠偏（毫秒，正数 = 字幕延后）；详情里的 cues 已按它换算 */
  subtitleOffsetMs: number;
  /** 标签（列表里有；详情里为空） */
  tags: Tag[];
  createdAt: string;
  updatedAt: string;
}

/** 一条字幕 */
export interface Cue {
  startMs: number;
  endMs: number;
  en: string;
  zh: string;
  /** 和上一条是同一句话（AI 整理字幕时断的句）；未整理时没有 */
  join?: boolean | null;
}

/** 规划里的一段 */
export interface VideoSegment {
  /** 前端生成的稳定 id */
  id: string;
  startMs: number;
  endMs: number;
  title: string;
  /** 场景（如「餐厅点餐」） */
  scene: string;
  /** CEFR 水平 a1–c1，空表示未定 */
  level: string;
  /** 学习重点 */
  focus: string;
  keyWords: string[];
  /** 重点词里的词组在字幕里的写法（小写词组 → 写法，AI 规划时标注） */
  keyWordForms?: Record<string, string[]>;
  /** 标签名（切分时写进切片的标签） */
  tags?: string[];
}

/** 切分规划（编辑器草稿） */
export interface VideoPlan {
  /** 用户写的切分要求 */
  requirements: string;
  segments: VideoSegment[];
}

/** 一个视频的一个切分规划（同一个视频可以按不同主题 / 意图规划多批） */
export interface VideoPlanInfo {
  id: number;
  name: string;
  plan: VideoPlan;
  createdAt: string;
  updatedAt: string;
}

export interface VideoDetail {
  video: Video;
  cues: Cue[];
  /** 这个视频的全部切分规划（至少一个） */
  plans: VideoPlanInfo[];
  /** 时间轴缩略图地址，第 i 张在 i * thumbIntervalMs */
  thumbs: string[];
  thumbIntervalMs: number;
  /** 已切出的短片 */
  clips: VideoClip[];
}

/** 已切出的短片（对应一篇短文） */
export interface VideoClip {
  passageId: number;
  /** 从哪个规划切出来的 */
  planId: number | null;
  seq: number;
  startMs: number;
  endMs: number;
}

/** 短文对应的视频短片（短文详情页播放） */
export interface PassageVideo {
  videoId: number;
  videoTitle: string;
  /** 短片与封面的播放地址（本机媒体服务） */
  clipUrl: string;
  posterUrl: string | null;
  /** 在原视频里的起止 */
  startMs: number;
  endMs: number;
}

export interface StartVideoImportRequest {
  videoPath: string;
  subtitlePath: string;
  /** 另一个语言的字幕（按时间对齐） */
  secondSubtitlePath?: string;
  title?: string;
}

export interface VideoImportStarted {
  videoId: number;
  jobId: string;
}

/** 视频组件（ffmpeg）状态 */
export interface MediaToolsStatus {
  available: boolean;
  dir: string | null;
  version: string | null;
  encoder: string | null;
  /** 用的是随应用自带的 */
  builtIn: boolean;
}

/** AI 规划切分（后台任务） */
export interface StartVideoPlanRequest {
  videoId: number;
  /** 规划写进哪个规划 */
  planId: number;
  /** 学习者的切分要求 */
  requirements: string;
  minSeconds: number;
  maxSeconds: number;
  /** 在当前规划基础上按意见修改 */
  feedback?: string;
}

/** 视频库「片段」：切出来的短片（一段 = 一篇带视频的短文） */
export interface ClipSummary extends PassageSummary {
  videoId: number;
  videoTitle: string;
  /** 在原视频里第几段 */
  seq: number;
  /** 在原视频里的起止 */
  startMs: number;
  endMs: number;
  clipUrl: string | null;
  posterUrl: string | null;
}
