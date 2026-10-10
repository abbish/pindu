import { BaseService } from './baseService';
import type { ApiResult } from '../types';
import type { ClipSummary, VideoPlanInfo, MediaToolsStatus, PassageVideo, StartVideoImportRequest, StartVideoPlanRequest, Video, VideoDetail, VideoImportStarted, VideoPlan } from '../types/video';
import { notifyOnSuccess } from './tagService';

/** 视频库（handlers/video.rs）：视频组件、导入（后台任务）、列表 / 详情 / 波形、改名、规划草稿、删除 */
export class VideoService extends BaseService {
  async getMediaToolsStatus(): Promise<ApiResult<MediaToolsStatus>> {
    return this.executeWithLoading(() => this.client.invoke<MediaToolsStatus>('get_media_tools_status'));
  }

  /** 指定 ffmpeg 所在文件夹；null 恢复自动查找 */
  async setFfmpegDir(dir: string | null): Promise<ApiResult<MediaToolsStatus>> {
    return this.executeWithLoading(() => this.client.invoke<MediaToolsStatus>('set_ffmpeg_dir', { dir }));
  }

  /** 导入视频与字幕：字幕立即解析（格式不对直接报错），视频处理是后台任务 */
  async startImport(request: StartVideoImportRequest): Promise<ApiResult<VideoImportStarted>> {
    return this.executeWithLoading(() => this.client.invoke<VideoImportStarted>('start_video_import', { request }));
  }

  async getVideos(): Promise<ApiResult<Video[]>> {
    return this.executeWithLoading(() => this.client.invoke<Video[]>('get_videos'));
  }

  /** 全部切片（视频库「片段」） */
  async getClips(): Promise<ApiResult<ClipSummary[]>> {
    return this.executeWithLoading(() => this.client.invoke<ClipSummary[]>('get_clips'));
  }

  async getVideo(videoId: number): Promise<ApiResult<VideoDetail>> {
    return this.executeWithLoading(() => this.client.invoke<VideoDetail>('get_video', { videoId }));
  }

  /** 波形峰值（每秒 50 个，0–1） */
  async getPeaks(videoId: number): Promise<ApiResult<number[]>> {
    return this.executeWithLoading(() => this.client.invoke<number[]>('get_video_peaks', { videoId }));
  }

  async rename(videoId: number, title: string): Promise<ApiResult<void>> {
    return this.executeWithLoading(() => this.client.invoke<void>('rename_video', { videoId, title }));
  }

  async savePlan(planId: number, plan: VideoPlan): Promise<ApiResult<void>> {
    return this.executeWithLoading(() => this.client.invoke<void>('save_video_plan', { planId, plan }));
  }

  /** 新建规划：空白，或复制 copyFrom；名字为空时用「规划 N」 */
  async createPlan(videoId: number, name?: string, copyFrom?: number): Promise<ApiResult<VideoPlanInfo>> {
    return this.executeWithLoading(() => this.client.invoke<VideoPlanInfo>('create_video_plan', { videoId, name, copyFrom }));
  }

  async renamePlan(planId: number, name: string): Promise<ApiResult<void>> {
    return this.executeWithLoading(() => this.client.invoke<void>('rename_video_plan', { planId, name }));
  }

  /** 删除规划（切出的片段保留） */
  async deletePlan(planId: number): Promise<ApiResult<void>> {
    return this.executeWithLoading(() => this.client.invoke<void>('delete_video_plan', { planId }));
  }

  /** 字幕时间纠偏（毫秒，正数 = 字幕延后） */
  async setSubtitleOffset(videoId: number, offsetMs: number): Promise<ApiResult<void>> {
    return this.executeWithLoading(() => this.client.invoke<void>('set_video_subtitle_offset', { videoId, offsetMs }));
  }

  /** 「AI 规划切分」的要求建议（AI 读字幕给的；refresh 换一批） */
  async suggestRequirements(videoId: number, refresh: boolean): Promise<ApiResult<string[]>> {
    return this.executeWithLoading(() => this.client.invoke<string[]>('suggest_video_requirements', { videoId, refresh }));
  }

  /** AI 规划切分（后台任务）：结果写进规划草稿，返回任务 id */
  async startPlan(request: StartVideoPlanRequest): Promise<ApiResult<string>> {
    return this.executeWithLoading(() => this.client.invoke<string>('start_video_plan', { request }));
  }

  /** 按规划切出短片并生成短文（后台任务）；已切好的片段跳过 */
  async startProcessing(planId: number): Promise<ApiResult<string>> {
    return this.executeWithLoading(() => this.client.invoke<string>('start_video_processing', { planId }));
  }

  /** 短文对应的视频短片；不是视频短片时为 null */
  async getPassageVideo(passageId: number): Promise<ApiResult<PassageVideo | null>> {
    return this.executeWithLoading(() => this.client.invoke<PassageVideo | null>('get_passage_video', { passageId }));
  }

  async delete(videoId: number): Promise<ApiResult<void>> {
    return notifyOnSuccess(await this.executeWithLoading(() => this.client.invoke<void>('delete_video', { videoId })));
  }

  /** 删除原视频释放空间（切分完成后） */
  async deleteSource(videoId: number): Promise<ApiResult<void>> {
    return this.executeWithLoading(() => this.client.invoke<void>('delete_video_source', { videoId }));
  }
}

export const videoService = new VideoService();
