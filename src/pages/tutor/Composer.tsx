import React, { useEffect, useRef } from 'react';
import { ArrowUp, Clock, FileText, Paperclip, Pencil, Square, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { MicButton } from '@/components/MicButton';
import { useToast } from '@/components';
import { AI_MATERIAL_EXTENSIONS, IMPORT_FILE_EXTENSIONS, IMPORT_MAX_FILE_BYTES } from '@/utils/passageImport';
import { imageMime, type Attachment } from './useTutorChat';

/** 一次最多带几个附件（图片 8 张、文件 5 个，与后端一致） */
const MAX_IMAGES = 8;
const MAX_FILES = 5;
/** 可以发的文件：与导入材料相同（文本、字幕、Word、PDF、图片） */
const EXTENSIONS = [...new Set([...IMPORT_FILE_EXTENSIONS, ...AI_MATERIAL_EXTENSIONS])];
const ACCEPT = EXTENSIONS.join(',');
const SHOWN = EXTENSIONS.filter((e) => e !== '.markdown' && e !== '.jpeg').join(' ');
const isImage = (f: File) => imageMime(f) !== null;
const extensionOf = (f: File) => `.${f.name.split('.').pop()?.toLowerCase() ?? ''}`;

/**
 * 输入框：Enter 发送（Shift+Enter 换行）；可以选文件（PDF、Word、图片）或直接粘贴截图（图片显示缩略图）。
 * 回答进行中：输入了内容就发送（AI 在当前一步做完后看到），没输入时是停止按钮。
 */
export const Composer: React.FC<{
  draft: string;
  attachments: Attachment[];
  running: boolean;
  /** 有提问在等回答：输入的文字作为回答 */
  answering?: boolean;
  /** 变化时获得焦点、光标移到末尾（开场示例填进来后） */
  focusKey?: number;
  /** 拿到「打开选文件」的函数（开场示例在点击时直接调用：选文件窗口要在用户点击里打开） */
  pickerRef?: React.MutableRefObject<(() => void) | null>;
  /** 排队等 AI 老师看的消息 */
  queue: string[];
  onEditQueued: (index: number) => void;
  onRemoveQueued: (index: number) => void;
  onDraft: (text: string) => void;
  onAttachments: (attachments: Attachment[]) => void;
  onSend: () => void;
  onStop: () => void;
}> = ({ draft, attachments, running, answering, focusKey, pickerRef, queue, onEditQueued, onRemoveQueued, onDraft, onAttachments, onSend, onStop }) => {
  const picker = useRef<HTMLInputElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const canSend = draft.trim().length > 0 || attachments.length > 0;
  /** 说话转文字要一两秒：拼到那时的草稿后面 */
  const draftRef = useRef(draft);
  draftRef.current = draft;

  useEffect(() => {
    const el = textarea.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [focusKey]);

  // 输入框随内容长高（最多 max-h-60，超过后在框内滚动）
  useEffect(() => {
    const el = textarea.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [draft]);

  useEffect(() => {
    if (!pickerRef) return;
    pickerRef.current = () => picker.current?.click();
    return () => {
      pickerRef.current = null;
    };
  }, [pickerRef]);

  const toast = useToast();

  const add = (files: File[]) => {
    // 不支持的、太大的说出来，不悄悄丢掉
    // 粘贴的截图可能没有文件名，按类型认图片
    const unsupported = files.filter((f) => !isImage(f) && !EXTENSIONS.includes(extensionOf(f)));
    const tooBig = files.filter((f) => !unsupported.includes(f) && f.size > IMPORT_MAX_FILE_BYTES);
    if (unsupported.length > 0) {
      toast.showError(`不能发 ${unsupported.map((f) => f.name).join('、')}`, `可以发 ${SHOWN}`);
    }
    if (tooBig.length > 0) {
      toast.showError(`${tooBig.map((f) => f.name).join('、')} 太大了`, `文件不能超过 ${IMPORT_MAX_FILE_BYTES / 1024 / 1024}MB`);
    }
    const ok = files.filter((f) => !unsupported.includes(f) && !tooBig.includes(f));
    const imageRoom = MAX_IMAGES - attachments.filter((a) => isImage(a.file)).length;
    const fileRoom = MAX_FILES - attachments.filter((a) => !isImage(a.file)).length;
    const images = ok.filter(isImage).slice(0, Math.max(0, imageRoom));
    const others = ok.filter((f) => !isImage(f)).slice(0, Math.max(0, fileRoom));
    if (images.length + others.length < ok.length) {
      toast.showError('附件太多了', `一次最多 ${MAX_IMAGES} 张图片、${MAX_FILES} 个文件`);
    }
    onAttachments([
      ...attachments,
      ...images.map((file) => ({ file, preview: URL.createObjectURL(file) })),
      ...others.map((file) => ({ file })),
    ]);
  };

  return (
    <div className="shrink-0 px-6 pb-4">
      <input
        ref={picker}
        type="file"
        multiple
        // 不能用 hidden（display: none）：WebView 里对它 click() 不会弹出选择窗口，与 MaterialInput 一致用 sr-only
        className="sr-only"
        tabIndex={-1}
        accept={ACCEPT}
        onChange={(e) => {
          add(Array.from(e.target.files ?? []));
          e.target.value = '';
        }}
      />
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          // 拖进来的文件同样作为附件
          if (e.dataTransfer.files.length === 0) return;
          e.preventDefault();
          add(Array.from(e.dataTransfer.files));
        }}
        className="mx-auto max-w-3xl rounded-xl border bg-background p-1.5 shadow-sm focus-within:ring-1 focus-within:ring-ring"
      >
        {queue.length > 0 && (
          <ol className="mb-2 flex flex-col gap-1 border-b px-1 pb-2" aria-label="排队的消息">
            {queue.map((text, i) => (
              <li key={`${i}-${text}`} className="group flex items-center gap-2 rounded-md px-1 py-0.5 text-sm hover:bg-accent">
                <Clock className="size-3.5 shrink-0 text-muted-foreground" aria-label="排队中" />
                <span className="min-w-0 flex-1 truncate" title={text}>
                  {text}
                </span>
                <button
                  type="button"
                  onClick={() => onEditQueued(i)}
                  className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-background hover:text-foreground"
                  aria-label="编辑"
                  title="拿回输入框编辑"
                >
                  <Pencil className="size-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => onRemoveQueued(i)}
                  className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-background hover:text-foreground"
                  aria-label="删除"
                  title="删除"
                >
                  <X className="size-3.5" />
                </button>
              </li>
            ))}
          </ol>
        )}
        {attachments.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 px-1 pt-1 pb-1.5">
            {attachments.map((a, i) => (
              <span key={a.preview ?? `${a.file.name}-${i}`} className="group relative inline-block">
                {a.preview ? (
                  <img src={a.preview} alt={a.file.name} title={a.file.name} className="size-10 rounded-md border object-cover" />
                ) : (
                  <span className="inline-flex h-7 max-w-56 items-center gap-1 rounded-md border bg-muted/40 px-2 text-xs" title={a.file.name}>
                    <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate">{a.file.name}</span>
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => {
                    if (a.preview) URL.revokeObjectURL(a.preview);
                    onAttachments(attachments.filter((_, j) => j !== i));
                  }}
                  className="absolute -top-1.5 -right-1.5 flex size-4 items-center justify-center rounded-full bg-foreground text-background opacity-0 group-hover:opacity-100"
                  aria-label="移除"
                  title="移除"
                >
                  <X className="size-2.5" />
                </button>
              </span>
            ))}
          </div>
        )}
        {/* 一行：添加文件 · 输入框（随内容长高） · 用英语说 · 发送 / 停止 */}
        <div className="flex items-end gap-1">
          <Button
            size="icon"
            variant="ghost"
            className="size-8 shrink-0"
            onClick={() => picker.current?.click()}
            aria-label="添加文件"
            title="添加文件（PDF、Word、图片、文本）"
          >
            <Paperclip />
          </Button>
          <Textarea
            ref={textarea}
            value={draft}
            onChange={(e) => onDraft(e.target.value)}
            onPaste={(e) => {
              // 粘贴截图：作为图片附件（文字照常粘贴）
              const images = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith('image/') || isImage(f));
              if (images.length > 0) {
                e.preventDefault();
                add(images);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                if (canSend) onSend();
              }
            }}
            placeholder={
              answering
                ? '直接输入你的回答，或者点上面的选项'
                : running
                  ? '补充一句（排队，AI 老师做完这一步就会看到）'
                  : '问问题，或者让 AI 老师帮你做点什么…（可以直接粘贴截图）'
            }
            rows={1}
            className="max-h-60 min-h-8 flex-1 resize-none border-0 px-1 py-1.5 shadow-none focus-visible:ring-0 dark:bg-transparent"
          />
          <MicButton className="shrink-0" label="用英语说" onText={(text) => onDraft(draftRef.current.trim() ? `${draftRef.current.trimEnd()} ${text}` : text)} />
          {running && !canSend ? (
            <Button size="icon" className="size-8 shrink-0" onClick={onStop} aria-label="停止" title="停止">
              <Square className="size-3.5 fill-current" />
            </Button>
          ) : (
            <Button size="icon" className="size-8 shrink-0" onClick={onSend} disabled={!canSend} aria-label="发送" title="发送">
              <ArrowUp />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};
