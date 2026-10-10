import React, { useId, useRef, useState } from 'react';
import { FileText, FileUp, Info, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { InlineError } from '@/components/InlineError';
import { cn } from '@/lib/utils';
import { materialService } from '@/services/materialService';
import { formatBytes } from '@/utils/fileSize';
import { IMPORT_FILE_EXTENSIONS, IMPORT_MAX_FILE_BYTES, bytesToBase64, englishWordCount, fileExtension } from '@/utils/passageImport';

/** 显示给用户的文件类型（.markdown 与 .md 同类，不重复列出） */
const SHOWN_EXTENSIONS = IMPORT_FILE_EXTENSIONS.filter((e) => e !== '.markdown').join(' ');

export interface MaterialInputProps {
  /** 文本（粘贴的，或从文件读出后用户改过的） */
  text: string;
  onTextChange: (text: string) => void;
  /** 文本来自哪个文件（null：粘贴的） */
  sourceLabel: string | null;
  onSourceLabelChange: (label: string | null) => void;
  /** 文本框标题 */
  label: string;
  placeholder?: string;
  /** 字符上限（超出时标红；不传则不限） */
  maxChars?: number;
  /** 显示「材料会发送给 AI 模型」的说明 */
  privacyNote?: boolean;
  autoFocus?: boolean;
  disabled?: boolean;
}

/**
 * 用户资料输入（词汇本「从我的材料提取」与短文「从我的材料导入」共用）：
 * 粘贴文本，或选择 / 拖入文件（txt、md、srt、vtt、docx、pdf）——文件由后端读成清理过的纯文本，填进同一个文本框，可以再改。
 */
export const MaterialInput: React.FC<MaterialInputProps> = ({
  text,
  onTextChange,
  sourceLabel,
  onSourceLabelChange,
  label,
  placeholder = '粘贴英文课文、故事、新闻或字幕…',
  maxChars,
  privacyNote,
  autoFocus,
  disabled,
}) => {
  const id = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [reading, setReading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  const chars = text.trim().length;
  const words = englishWordCount(text);
  const over = maxChars !== undefined && chars > maxChars;

  const readFile = async (file: File | undefined | null) => {
    if (!file || disabled) return;
    const ext = fileExtension(file.name);
    if (!IMPORT_FILE_EXTENSIONS.includes(ext)) return setError(`不支持${ext ? ` ${ext} ` : '这种'}文件，可以导入 ${SHOWN_EXTENSIONS}`);
    if (file.size > IMPORT_MAX_FILE_BYTES) return setError(`文件不能超过 ${formatBytes(IMPORT_MAX_FILE_BYTES)}`);
    setError(null);
    setWarnings([]);
    setReading(file.name);
    let fileBase64: string;
    try {
      fileBase64 = bytesToBase64(new Uint8Array(await file.arrayBuffer()));
    } catch {
      setReading(null);
      return setError('无法读取这个文件，请重新选择');
    }
    const result = await materialService.readFile({ fileName: file.name, fileBase64 });
    setReading(null);
    if (!result.success) return setError(result.error);
    onTextChange(result.data.text);
    onSourceLabelChange(result.data.sourceLabel);
    setWarnings(result.data.warnings);
  };

  const clearFile = () => {
    onTextChange('');
    onSourceLabelChange(null);
    setWarnings([]);
    setError(null);
  };

  return (
    <div
      className="flex flex-col gap-2"
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        readFile(e.dataTransfer.files?.[0]);
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        <Button variant="ghost" size="sm" className="h-7" onClick={() => fileInput.current?.click()} disabled={disabled || reading !== null}>
          <FileUp />
          选择文件
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept={IMPORT_FILE_EXTENSIONS.join(',')}
          className="sr-only"
          tabIndex={-1}
          onChange={(e) => {
            readFile(e.target.files?.[0]);
            e.target.value = ''; // 允许重复选择同一文件
          }}
        />
      </div>

      {sourceLabel && (
        <div className="flex items-center gap-2 rounded-md bg-muted/60 px-3 py-1.5 text-xs text-muted-foreground">
          <FileText className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate">
            已读取 <span className="font-medium text-foreground">{sourceLabel}</span>
          </span>
          <Button variant="ghost" size="icon" className="size-6" aria-label="清除文件内容" onClick={clearFile} disabled={disabled}>
            <X />
          </Button>
        </div>
      )}

      <div className="relative">
        <Textarea
          id={id}
          value={text}
          onChange={(e) => onTextChange(e.target.value)}
          placeholder={placeholder}
          className={cn('resize-y pb-7 leading-relaxed min-h-64', dragging && 'border-primary bg-accent/30')}
          aria-invalid={over}
          autoFocus={autoFocus}
          disabled={disabled || reading !== null}
        />
        {reading !== null && (
          <div className="absolute inset-0 flex items-center justify-center gap-2 rounded-md bg-background/80 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            正在读取 {reading}…
          </div>
        )}
        {dragging && reading === null && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-md text-sm font-medium text-primary">松开导入文件</div>
        )}
        <span className={cn('pointer-events-none absolute right-3 bottom-2 text-xs tabular-nums', over ? 'text-destructive' : 'text-muted-foreground')}>
          {words > 0 && `${words} 词`}
          {maxChars !== undefined && ` · ${chars} / ${maxChars} 字符`}
        </span>
      </div>

      <p className="text-xs text-muted-foreground">
        支持 {SHOWN_EXTENSIONS}，不超过 {formatBytes(IMPORT_MAX_FILE_BYTES)}
      </p>
      {over && <p className="text-xs text-destructive">超过 {maxChars} 字符，删掉一些或分几次添加</p>}
      {warnings.length > 0 && (
        <ul className="space-y-0.5 text-xs text-warning">
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
      {error && <InlineError title="无法读取文件">{error}</InlineError>}
      {privacyNote && (
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          文字会发送给所配置的 AI 模型处理
        </p>
      )}
    </div>
  );
};
