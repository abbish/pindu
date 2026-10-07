import React, { useEffect, useState } from 'react';
import { Loader2, RefreshCw, TriangleAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { SettingsPanel, SettingsRow, SettingsSection } from '@/components/SettingsLayout/SettingsLayout';
import { useToast } from '@/components/Toast/ToastContainer';
import { PageError } from '@/components/PageError';
import { cn } from '@/lib/utils';
import { dataManagementService } from '../../services/dataManagementService';
import type { DatabaseOverview } from '../../types';

/** 两步确认弹窗：先看清影响（warning），再输入确认文本（confirm） */
interface ConfirmDialogState {
  isOpen: boolean;
  step: 'warning' | 'confirm';
  confirmText: string;
}

const CLOSED: ConfirmDialogState = { isOpen: false, step: 'warning', confirmText: '' };
const RESET_TEXT = 'RESET';
const DELETE_TEXT = 'DELETE DATABASE';

/**
 * 设置「数据管理」：数据库概览、数据表与选择性重置、危险操作（重置用户数据 / 删除数据库并重启，均两步确认）
 */
export const DataManagementSettings: React.FC = () => {
  const toast = useToast();
  const [overview, setOverview] = useState<DatabaseOverview | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  // 选择性重置
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // 重置的范围在打开弹窗时确定：全部用户数据 / 选中的表
  const [resetScope, setResetScope] = useState<'all' | 'selected'>('all');
  const [resetDialog, setResetDialog] = useState<ConfirmDialogState>(CLOSED);
  const [deleteDialog, setDeleteDialog] = useState<ConfirmDialogState>(CLOSED);

  const [loadError, setLoadError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const result = await dataManagementService.getDatabaseStatistics();
    setLoading(false);
    if (result.success) {
      setOverview(result.data);
      setLoadError(null);
    } else if (overview) {
      // 已有数据时只是刷新失败：保留旧数据，轻提示
      toast.showError('无法刷新数据概览', result.error);
    } else {
      setLoadError(result.error);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const tables = overview?.tables ?? [];
  const countOf = (table: string) => tables.find((t) => t.table_name === table)?.record_count || 0;
  const selectedTables = tables.filter((t) => selected.has(t.table_name));
  const selectedRecords = selectedTables.reduce((n, t) => n + (t.record_count || 0), 0);

  const toggleTable = (name: string, checked: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(name);
      else next.delete(name);
      return next;
    });

  const exitSelecting = () => {
    setSelecting(false);
    setSelected(new Set());
  };

  const openReset = (scope: 'all' | 'selected') => {
    // 按钮在没选表时已禁用
    if (scope === 'selected' && selected.size === 0) return;
    setResetScope(scope);
    setResetDialog({ isOpen: true, step: 'warning', confirmText: '' });
  };

  const confirmReset = async () => {
    if (resetDialog.step === 'warning') {
      setResetDialog((prev) => ({ ...prev, step: 'confirm', confirmText: '' }));
      return;
    }
    // 确认按钮在确认文本不对时已禁用
    if (resetDialog.confirmText !== RESET_TEXT) return;
    setBusy(true);
    const result = resetScope === 'selected' ? await dataManagementService.resetSelectedTables(Array.from(selected)) : await dataManagementService.resetUserData();
    setBusy(false);
    if (!result.success) {
      toast.showError('无法重置数据', result.error);
      return;
    }
    setResetDialog(CLOSED);
    if (resetScope === 'selected') exitSelecting();
    await load();
    toast.showSuccess('已重置数据', `删除了 ${result.data.deleted_records} 条记录`);
  };

  const confirmDelete = async () => {
    if (deleteDialog.step === 'warning') {
      setDeleteDialog((prev) => ({ ...prev, step: 'confirm', confirmText: '' }));
      return;
    }
    if (deleteDialog.confirmText !== DELETE_TEXT) return;
    setBusy(true);
    // 成功时应用会重启，这个调用通常不会返回
    const result = await dataManagementService.deleteDatabaseAndRestart();
    setBusy(false);
    toast.showError('无法删除数据库', result.success ? '应用没有重启，请手动重启后再试' : result.error);
  };

  const numberCell = (value: number, unit: string) => (
    <span className="text-sm tabular-nums">
      {value.toLocaleString()}
      <span className="ml-0.5 text-xs text-muted-foreground">{unit}</span>
    </span>
  );

  return (
    <SettingsPanel title="数据管理" description="所有数据只保存在本机的 SQLite 数据库（vocabulary.db）中">
      <SettingsSection
        title="概览"
        actions={
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            刷新统计
          </Button>
        }
      >
        {loadError && !overview ? (
          <PageError title="无法加载数据概览" message={loadError} onRetry={load} />
        ) : loading && !overview ? (
          <div className="space-y-2 p-4">
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-full" />
          </div>
        ) : overview ? (
          <>
            <SettingsRow label="数据表">{numberCell(overview.total_tables || 0, '个')}</SettingsRow>
            <SettingsRow label="总记录数">{numberCell(overview.total_records || 0, '条')}</SettingsRow>
          </>
        ) : (
          <SettingsRow label="暂无统计" description="点击“刷新统计”加载数据库信息" />
        )}
      </SettingsSection>

      {overview && (
        <SettingsSection
          title="数据表"
          description={selecting ? '勾选要清空的数据表，其余数据不受影响' : '可以只清空部分数据表（选择性重置）'}
          actions={
            selecting ? (
              <>
                <Button variant="ghost" size="sm" onClick={() => setSelected(new Set(tables.map((t) => t.table_name)))}>
                  全选
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
                  取消全选
                </Button>
                <Button variant="outline" size="sm" onClick={exitSelecting}>
                  完成
                </Button>
              </>
            ) : (
              <Button variant="outline" size="sm" onClick={() => setSelecting(true)}>
                选择性重置
              </Button>
            )
          }
        >
          {tables.map((table) => {
            const checked = selected.has(table.table_name);
            const label = (
              <span className="flex items-center gap-2">
                {table.display_name}
                <Badge variant="outline" className="h-5 font-mono text-[10px] font-normal">
                  {table.table_type}
                </Badge>
              </span>
            );
            return selecting ? (
              <label
                key={table.table_name}
                className={cn('flex items-center gap-3 px-4 py-3 hover:bg-muted/40', checked && 'bg-destructive/5 hover:bg-destructive/10')}
              >
                <Checkbox checked={checked} onCheckedChange={(v) => toggleTable(table.table_name, v === true)} aria-label={`选择 ${table.display_name}`} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{label}</div>
                  <div className="mt-0.5 truncate text-[13px] text-muted-foreground">{table.description}</div>
                </div>
                {numberCell(table.record_count || 0, '条')}
              </label>
            ) : (
              <SettingsRow key={table.table_name} label={label} description={table.description}>
                {numberCell(table.record_count || 0, '条')}
              </SettingsRow>
            );
          })}
          {selecting && (
            <div className="flex items-center gap-3 rounded-b-xl bg-muted/40 px-4 py-3">
              <p className="flex-1 text-sm">
                已选择 <strong className="tabular-nums">{selectedTables.length}</strong> 个表，共{' '}
                <strong className="tabular-nums">{selectedRecords.toLocaleString()}</strong> 条记录
              </p>
              <Button variant="destructive" size="sm" onClick={() => openReset('selected')} disabled={busy || selected.size === 0}>
                重置选中的表（{selected.size}）
              </Button>
            </div>
          )}
        </SettingsSection>
      )}

      <SettingsSection title="危险操作" tone="danger">
        <SettingsRow
          label="重置所有用户数据"
          description="永久删除所有单词本和单词、学习计划和学习进度、练习记录和会话、学习统计数据；AI 模型配置和系统设置会保留。"
        >
          <Button variant="destructive" size="sm" onClick={() => openReset('all')} disabled={busy || loading}>
            重置…
          </Button>
        </SettingsRow>
        <SettingsRow label="删除数据库并重启" description="删除整个数据库文件并重启应用，重启后是全新的空数据库，连 AI 模型配置和系统设置也会丢失。">
          <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => setDeleteDialog({ isOpen: true, step: 'warning', confirmText: '' })} disabled={busy}>
            删除…
          </Button>
        </SettingsRow>
      </SettingsSection>

      {/* 重置确认（两步） */}
      <Dialog open={resetDialog.isOpen} onOpenChange={(open) => !open && !busy && setResetDialog(CLOSED)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <TriangleAlert className="size-5" />
              {resetDialog.step === 'warning' ? (resetScope === 'selected' ? '确认重置选中的数据表' : '确认重置所有用户数据') : '最终确认'}
            </DialogTitle>
            <DialogDescription>此操作不可撤销！</DialogDescription>
          </DialogHeader>
          {resetDialog.step === 'warning' ? (
            <div className="space-y-2 text-sm">
              {resetScope === 'selected' ? (
                <>
                  <p>您即将清空以下数据表：</p>
                  <ul className="max-h-48 list-inside list-disc overflow-y-auto text-muted-foreground">
                    {selectedTables.map((t) => (
                      <li key={t.table_name}>
                        {t.display_name}（{t.record_count || 0} 条记录）
                      </li>
                    ))}
                  </ul>
                  <p>
                    总计：<strong>{selectedRecords.toLocaleString()}</strong> 条记录将被删除
                  </p>
                </>
              ) : (
                <>
                  <p>您即将删除所有用户数据，包括：</p>
                  <ul className="list-inside list-disc text-muted-foreground">
                    <li>所有单词本和单词（{countOf('word_books')} 个单词本）</li>
                    <li>所有学习计划和进度（{countOf('study_plans')} 个学习计划）</li>
                    <li>所有练习记录（{countOf('practice_sessions')} 个练习会话）</li>
                  </ul>
                  <p className="font-medium">AI 模型配置将被保留。</p>
                </>
              )}
            </div>
          ) : (
            <div className="space-y-2 text-sm">
              <p>
                请在下方输入 <strong className="font-mono">{RESET_TEXT}</strong> 来确认此操作：
              </p>
              <Input
                value={resetDialog.confirmText}
                onChange={(e) => setResetDialog((prev) => ({ ...prev, confirmText: e.target.value }))}
                onKeyDown={(e) => e.key === 'Enter' && resetDialog.confirmText === RESET_TEXT && confirmReset()}
                placeholder={RESET_TEXT}
                className="font-mono"
                autoFocus
                aria-label="确认文本"
              />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetDialog(CLOSED)} disabled={busy}>
              取消
            </Button>
            <Button variant="destructive" onClick={confirmReset} disabled={busy || (resetDialog.step === 'confirm' && resetDialog.confirmText !== RESET_TEXT)}>
              {busy && <Loader2 className="animate-spin" />}
              {resetDialog.step === 'warning' ? '继续' : '确认重置'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除数据库确认（两步） */}
      <Dialog open={deleteDialog.isOpen} onOpenChange={(open) => !open && !busy && setDeleteDialog(CLOSED)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <TriangleAlert className="size-5" />
              {deleteDialog.step === 'warning' ? '极度危险操作！' : '最终确认'}
            </DialogTitle>
            <DialogDescription>此操作将完全删除数据库文件并重启应用程序！</DialogDescription>
          </DialogHeader>
          {deleteDialog.step === 'warning' ? (
            <div className="space-y-2 text-sm">
              <p className="font-medium">将会发生的事情：</p>
              <ul className="list-inside list-disc text-muted-foreground">
                <li>完全删除数据库文件（vocabulary.db）</li>
                <li>自动重启应用程序</li>
                <li>重启后将创建全新的空数据库</li>
                <li>所有数据将永久丢失，包括：单词本和单词、学习计划和进度、练习记录、AI 模型配置、系统设置</li>
              </ul>
              <p className="font-medium text-destructive">注意：此操作比“重置所有用户数据”更彻底，连 AI 配置也会丢失！</p>
              <p className="text-muted-foreground">如果只想清理用户数据，请使用“重置所有用户数据”。</p>
            </div>
          ) : (
            <div className="space-y-2 text-sm">
              <p>
                请在下方输入 <strong className="font-mono">{DELETE_TEXT}</strong> 来确认此操作：
              </p>
              <Input
                value={deleteDialog.confirmText}
                onChange={(e) => setDeleteDialog((prev) => ({ ...prev, confirmText: e.target.value }))}
                placeholder={DELETE_TEXT}
                className="font-mono"
                autoFocus
                aria-label="确认文本"
              />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialog(CLOSED)} disabled={busy}>
              取消
            </Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={busy || (deleteDialog.step === 'confirm' && deleteDialog.confirmText !== DELETE_TEXT)}>
              {busy && <Loader2 className="animate-spin" />}
              {deleteDialog.step === 'warning' ? '继续' : '删除数据库并重启'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsPanel>
  );
};
