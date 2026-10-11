import React, { useEffect, useRef } from 'react';
import { ArrowUp, FileText, Paperclip, Square, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { Attachment } from './useTutorChat';

/** 一次最多带几个附件（图片 8 张、文件 5 个，与后端一致） */
const MAX_IMAGES = 8;
const MAX_FILES = 5;
/** 可以发的文件 */
const ACCEPT = '.pdf,.docx,image/png,image/jpeg,image/webp,image/gif';
const isImage = (f: File) => f.type.startsWith('image/');

/**
 * 输入框：Enter 发送（Shift+Enter 换行）；可以选文件（PDF、Word、图片）或直接粘贴截图（图片显示缩略图）。
 * 回答进行中：输入了内容就发送（AI 在当前一步做完后看到），没输入时是停止按钮。
 */
export const Composer: React.FC<{
  draft: string;
  attachments: Attachment[];
  running: boolean;
  onDraft: (text: string) => void;
  onAttachments: (attachments: Attachment[]) => void;
  onSend: () => void;
  onStop: () => void;
}> = ({ draft, attachments, running, onDraft, onAttachments, onSend, onStop }) => {
  const picker = useRef<HTMLInputElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const canSend = draft.trim().length > 0 || attachments.length > 0;

  useEffect(() => {
    textarea.current?.focus();
  }, []);

  const add = (files: File[]) => {
    const imageRoom = MAX_IMAGES - attachments.filter((a) => isImage(a.file)).length;
    const fileRoom = MAX_FILES - attachments.filter((a) => !isImage(a.file)).length;
    const images = files.filter(isImage).slice(0, Math.max(0, imageRoom));
    const others = files.filter((f) => !isImage(f) && /\.(pdf|docx)$/i.test(f.name)).slice(0, Math.max(0, fileRoom));
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
        hidden
        accept={ACCEPT}
        onChange={(e) => {
          add(Array.from(e.target.files ?? []));
          e.target.value = '';
        }}
      />
      <div className="mx-auto max-w-3xl rounded-xl border bg-background p-2 shadow-sm focus-within:ring-1 focus-within:ring-ring">
        {attachments.length > 0 && (
          <div className="flex flex-wrap items-end gap-2 px-1 pt-1 pb-2">
            {attachments.map((a, i) => (
              <span key={a.preview ?? `${a.file.name}-${i}`} className="group relative inline-block">
                {a.preview ? (
                  <img src={a.preview} alt={a.file.name} title={a.file.name} className="size-14 rounded-md border object-cover" />
                ) : (
                  <span className="inline-flex h-14 max-w-48 items-center gap-1.5 rounded-md border bg-muted/40 px-2 text-xs" title={a.file.name}>
                    <FileText className="size-4 shrink-0 text-muted-foreground" />
                    <span className="truncate">{a.file.name}</span>
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => onAttachments(attachments.filter((_, j) => j !== i))}
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
        <Textarea
          ref={textarea}
          value={draft}
          onChange={(e) => onDraft(e.target.value)}
          onPaste={(e) => {
            // 粘贴截图：作为图片附件（文字照常粘贴）
            const images = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith('image/'));
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
          placeholder={running ? '补充一句（AI 老师做完这一步就会看到）' : '问问题，或者让 AI 老师帮你做点什么…（可以直接粘贴截图）'}
          rows={2}
          className="max-h-60 min-h-0 resize-none border-0 shadow-none focus-visible:ring-0"
        />
        <div className="flex items-center gap-1 pt-1">
          <Button
            size="icon"
            variant="ghost"
            className="size-8"
            onClick={() => picker.current?.click()}
            aria-label="添加文件"
            title="添加文件（PDF、Word、图片）"
          >
            <Paperclip />
          </Button>
          <div className="flex-1" />
          {running && !canSend ? (
            <Button size="icon" className="size-8" onClick={onStop} aria-label="停止" title="停止">
              <Square className="size-3.5 fill-current" />
            </Button>
          ) : (
            <Button size="icon" className="size-8" onClick={onSend} disabled={!canSend} aria-label="发送" title="发送">
              <ArrowUp />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};
