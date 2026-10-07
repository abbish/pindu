import React, { useEffect, useState } from 'react';
import { Loader2, Plus, Sparkles, Trash2, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/Toast/ToastContainer';
import { cn } from '@/lib/utils';
import { wordAnalysisService } from '@/services/wordAnalysisService';
import { wordBookService } from '@/services/wordbookService';
import { PART_OF_SPEECH_ENGLISH, PART_OF_SPEECH_LABELS, standardizePartOfSpeech } from '@/utils/partOfSpeech';
import type { UpdateWordRequest, Word, WordExample } from '@/types';
import { InlineError } from '@/components/InlineError';
import { messageOf } from '@/utils/errorHandler';

export interface WordFormDialogProps {
  /** 是否显示 */
  isOpen: boolean;
  /** 关闭 */
  onClose: () => void;
  /** 所在单词本 */
  bookId: number;
  /** 编辑的单词；不传为手动添加 */
  word?: Word | null;
  /** 保存成功 */
  onSaved: () => void;
}

interface FormValues {
  word: string;
  meaning: string;
  pos: string;
  ipa: string;
  syllables: string;
  /** 拼读块，空格或 / 分隔（保存为 JSON 数组） */
  segments: string;
  rule: string;
  explanation: string;
  description: string;
  examples: WordExample[];
}

const EMPTY: FormValues = { word: '', meaning: '', pos: 'n.', ipa: '', syllables: '', segments: '', rule: '', explanation: '', description: '', examples: [] };

/** 数据库里的拼读块（JSON 数组字符串）→ 编辑文本 */
const segmentsToText = (raw?: string | null): string => {
  if (!raw) return '';
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(String).join(' / ');
  } catch {
    // 旧数据可能不是 JSON：原样显示
  }
  return raw;
};
const textToSegments = (text: string): string[] =>
  text
    .split(/[\s/·|]+/)
    .map((s) => s.trim())
    .filter(Boolean);

const fromWord = (w?: Word | null): FormValues =>
  w
    ? {
        word: w.word,
        meaning: w.meaning,
        pos: standardizePartOfSpeech(w.pos_abbreviation || w.part_of_speech),
        ipa: w.ipa || '',
        syllables: w.syllables || '',
        segments: segmentsToText(w.phonics_segments),
        rule: w.phonics_rule || '',
        explanation: w.analysis_explanation || '',
        description: w.description || '',
        examples: (w.examples ?? []).map((e) => ({ sentence: e.sentence, translation: e.translation ?? '' })),
      }
    : EMPTY;

/**
 * 手动添加 / 编辑单词（同一表单）：单词、释义、词性 → 发音与拼读（音节、拼读块可按音节一键拆分）→ 例句逐条编辑。
 * 词性缩写 / 中文 / 英文由词性自动带出。填好单词与释义后可以“AI 补全”空着的发音、拼读与例句。
 * 保存失败时弹窗不关并显示后端原因（如单词本里已有同名单词）。
 */
export const WordFormDialog: React.FC<WordFormDialogProps> = ({ isOpen, onClose, bookId, word, onSaved }) => {
  const editing = Boolean(word);
  const toast = useToast();
  const [values, setValues] = useState<FormValues>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<'word' | 'meaning', string>>>({});
  const [submitError, setSubmitError] = useState<{ title: string; message: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [filling, setFilling] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setValues(fromWord(word));
    setErrors({});
    setSubmitError(null);
  }, [isOpen, word]);

  const set = <K extends keyof FormValues>(key: K, value: FormValues[K]) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    if (key === 'word' || key === 'meaning') setErrors((prev) => ({ ...prev, [key]: undefined }));
  };
  const setExample = (index: number, patch: Partial<WordExample>) =>
    set(
      'examples',
      values.examples.map((e, i) => (i === index ? { ...e, ...patch } : e))
    );

  /** 用 AI 补全空着的字段（不覆盖已填写的内容） */
  const aiFill = async () => {
    const w = values.word.trim();
    if (!w) {
      setErrors({ word: '先填写单词' });
      return;
    }
    setFilling(true);
    setSubmitError(null);
    try {
      const result = await wordAnalysisService.analyzeExtractedWords([w], { bookId, meanings: [values.meaning.trim()] });
      if (!result.success) throw new Error(result.error);
      const p = result.data.words[0];
      if (!p) throw new Error('AI 没有返回这个单词的分析');
      setValues((prev) => ({
        ...prev,
        meaning: prev.meaning || p.chinese_translation,
        pos: prev.meaning ? prev.pos : standardizePartOfSpeech(p.pos_abbreviation),
        ipa: prev.ipa || p.ipa,
        syllables: prev.syllables || p.syllables,
        segments: prev.segments || textToSegments((prev.syllables || p.syllables).replace(/-/g, ' ')).join(' / '),
        rule: prev.rule || p.phonics_rule,
        explanation: prev.explanation || p.analysis_explanation,
        examples: prev.examples.some((e) => e.sentence.trim()) ? prev.examples : (p.examples ?? []),
      }));
      toast.showSuccess('已补全空着的内容', '可以再检查修改后保存');
    } catch (err) {
      setSubmitError({ title: '无法 AI 补全', message: messageOf(err) ?? '请再试一次' });
    } finally {
      setFilling(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const nextErrors: typeof errors = {};
    if (!values.word.trim()) nextErrors.word = '请填写单词';
    if (!values.meaning.trim()) nextErrors.meaning = '请填写中文释义';
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    const segments = textToSegments(values.segments);
    const payload: UpdateWordRequest = {
      word: values.word.trim(),
      meaning: values.meaning.trim(),
      part_of_speech: values.pos,
      pos_abbreviation: values.pos,
      pos_chinese: PART_OF_SPEECH_LABELS[values.pos] ?? '',
      pos_english: PART_OF_SPEECH_ENGLISH[values.pos] ?? '',
      ipa: values.ipa.trim(),
      syllables: values.syllables.trim(),
      phonics_segments: segments.length > 0 ? JSON.stringify(segments) : '',
      phonics_rule: values.rule.trim(),
      analysis_explanation: values.explanation.trim(),
      description: values.description.trim(),
      examples: values.examples
        .map((ex) => ({ sentence: ex.sentence.trim(), translation: (ex.translation ?? '').trim() }))
        .filter((ex) => ex.sentence),
    };
    setSaving(true);
    setSubmitError(null);
    const result = word
      ? await wordBookService.updateWord(word.id, payload)
      : await wordBookService.addWordToBook(bookId, { ...payload, word: payload.word!, meaning: payload.meaning! });
    setSaving(false);
    if (!result.success) {
      setSubmitError({ title: editing ? '无法保存单词' : '无法添加单词', message: result.error });
      return;
    }
    toast.showSuccess(editing ? '单词已保存' : `已添加「${payload.word}」`);
    onSaved();
    onClose();
  };

  const busy = saving || filling;
  const segmentPreview = textToSegments(values.segments);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="flex max-h-[88vh] flex-col gap-0 p-0 sm:max-w-2xl" onOpenAutoFocus={(e) => editing && e.preventDefault()}>
        <form onSubmit={submit} className="flex min-h-0 flex-col" noValidate>
          <DialogHeader className="border-b px-6 pt-5 pb-4">
            <DialogTitle>{editing ? `编辑「${word?.word}」` : '手动添加单词'}</DialogTitle>
            <DialogDescription>{editing ? '修改释义、发音、拼读与例句。' : '填好单词和释义即可保存；其余内容可以让 AI 补全。'}</DialogDescription>
          </DialogHeader>

          <div className="flex min-h-0 flex-col gap-7 overflow-y-auto px-6 py-5">
            {/* 单词 */}
            <section className="space-y-3">
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_9rem] gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="wf-word">单词</Label>
                  <Input id="wf-word" value={values.word} onChange={(e) => set('word', e.target.value)} placeholder="例如：elephant" maxLength={50} autoFocus={!editing} aria-invalid={Boolean(errors.word)} className="font-medium" />
                  {errors.word && <p className="text-xs text-destructive">{errors.word}</p>}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="wf-meaning">中文释义</Label>
                  <Input id="wf-meaning" value={values.meaning} onChange={(e) => set('meaning', e.target.value)} placeholder="例如：大象" aria-invalid={Boolean(errors.meaning)} />
                  {errors.meaning && <p className="text-xs text-destructive">{errors.meaning}</p>}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="wf-pos">词性</Label>
                  <Select value={values.pos} onValueChange={(v) => set('pos', v)}>
                    <SelectTrigger id="wf-pos" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(PART_OF_SPEECH_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label} <span className="text-muted-foreground">{value}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-lg bg-muted/50 px-3 py-2">
                <p className="text-xs text-muted-foreground">AI 会按单词本的场景补全空着的音标、音节、拼读讲解和例句，不会改动已填写的内容。</p>
                <Button type="button" size="sm" variant="outline" className="shrink-0 bg-background" onClick={aiFill} disabled={busy || !values.word.trim()}>
                  {filling ? <Loader2 className="animate-spin" /> : <Sparkles />}
                  {filling ? '正在补全…' : 'AI 补全'}
                </Button>
              </div>
            </section>

            {/* 发音与拼读 */}
            <section className="space-y-3">
              <h3 className="text-sm font-semibold">发音与拼读</h3>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="wf-ipa">音标</Label>
                  <Input id="wf-ipa" value={values.ipa} onChange={(e) => set('ipa', e.target.value)} placeholder="例如 /ˈelɪfənt/" className="font-mono placeholder:font-sans" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="wf-syl">音节</Label>
                  <Input id="wf-syl" value={values.syllables} onChange={(e) => set('syllables', e.target.value)} placeholder="例如 el-e-phant" className="font-mono placeholder:font-sans" />
                </div>
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="wf-seg">拼读块</Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7"
                    disabled={!values.syllables.trim()}
                    onClick={() => set('segments', textToSegments(values.syllables.replace(/-/g, ' ')).join(' / '))}
                  >
                    <Wand2 />
                    按音节拆分
                  </Button>
                </div>
                <Input id="wf-seg" value={values.segments} onChange={(e) => set('segments', e.target.value)} placeholder="例如 el / e / ph / ant（用空格或 / 分隔）" className="font-mono placeholder:font-sans" />
                {segmentPreview.length > 0 && (
                  <div className="flex flex-wrap gap-1 pt-1" aria-label="拼读块预览">
                    {segmentPreview.map((s, i) => (
                      <span key={`${s}-${i}`} className={cn('rounded-md px-2 py-0.5 font-mono text-sm', i % 2 === 0 ? 'bg-accent text-accent-foreground' : 'bg-muted')}>
                        {s}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="wf-rule">拼读规则</Label>
                <Input id="wf-rule" value={values.rule} onChange={(e) => set('rule', e.target.value)} placeholder="例如：ph 发 /f/" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="wf-exp">拼读讲解</Label>
                <Textarea id="wf-exp" value={values.explanation} onChange={(e) => set('explanation', e.target.value)} placeholder="给学生看的拼读说明" className="min-h-20 resize-none" />
              </div>
            </section>

            {/* 例句 */}
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold">例句</h3>
                  <p className="text-xs text-muted-foreground">第一条应是最简单的一句，练习时先展示它</p>
                </div>
                <Button type="button" size="sm" variant="outline" onClick={() => set('examples', [...values.examples, { sentence: '', translation: '' }])}>
                  <Plus />
                  添加例句
                </Button>
              </div>
              {values.examples.length === 0 ? (
                <p className="rounded-lg border border-dashed px-4 py-5 text-center text-sm text-muted-foreground">还没有例句</p>
              ) : (
                <ol className="space-y-2">
                  {values.examples.map((ex, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="mt-2 w-5 shrink-0 text-right text-xs text-muted-foreground tabular-nums">{i + 1}</span>
                      <div className="grid min-w-0 flex-1 gap-1.5">
                        <Input value={ex.sentence} onChange={(e) => setExample(i, { sentence: e.target.value })} placeholder="英文例句" aria-label={`例句 ${i + 1} 英文`} />
                        <Input value={ex.translation ?? ''} onChange={(e) => setExample(i, { translation: e.target.value })} placeholder="中文翻译" aria-label={`例句 ${i + 1} 中文`} className="text-muted-foreground" />
                      </div>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="mt-0.5 size-8 shrink-0 text-muted-foreground hover:text-destructive"
                        aria-label={`删除例句 ${i + 1}`}
                        onClick={() => set('examples', values.examples.filter((_, j) => j !== i))}
                      >
                        <Trash2 />
                      </Button>
                    </li>
                  ))}
                </ol>
              )}
            </section>

            {/* 备注 */}
            <section className="space-y-1.5">
              <Label htmlFor="wf-desc">备注</Label>
              <Textarea id="wf-desc" value={values.description} onChange={(e) => set('description', e.target.value)} placeholder="可选：记忆提示、易错点等" className="min-h-16 resize-none" />
            </section>

            {submitError && <InlineError title={submitError.title}>{submitError.message}</InlineError>}
          </div>

          <DialogFooter className="border-t bg-muted/30 px-6 py-3">
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
              取消
            </Button>
            <Button type="submit" disabled={busy}>
              {saving && <Loader2 className="animate-spin" />}
              {editing ? '保存' : '添加'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
