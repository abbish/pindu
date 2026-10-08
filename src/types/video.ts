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
  createdAt: string;
  updatedAt: string;
}

/** 一条字幕 */
export interface Cue {
  startMs: number;
  endMs: number;
  en: string;
  zh: string;
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
}

/** 切分规划（编辑器草稿） */
export interface VideoPlan {
  /** 用户写的切分要求 */
  requirements: string;
  segments: VideoSegment[];
}

export interface VideoDetail {
  video: Video;
  cues: Cue[];
  plan: VideoPlan | null;
  /** 时间轴缩略图地址，第 i 张在 i * thumbIntervalMs */
  thumbs: string[];
  thumbIntervalMs: number;
  /** 已切出的短片 */
  clips: VideoClip[];
}

/** 已切出的短片（对应一篇短文） */
export interface VideoClip {
  passageId: number;
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
  /** 学习者的切分要求 */
  requirements: string;
  minSeconds: number;
  maxSeconds: number;
  /** 在当前规划基础上按意见修改 */
  feedback?: string;
}
