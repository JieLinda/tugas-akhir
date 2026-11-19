'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { History, Save, Clock, Trash2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';
import { InfoHint } from '@/components/ui/info-hint';
import { formatDateTime } from '@/lib/datetime';

import {
  updateScoringPromptAction,
  listScoringPromptVersions,
  saveScoringPromptVersionAction,
  restoreScoringPromptVersionAction,
  deleteScoringPromptVersionAction,
  type ScoringPromptsData,
  type ScoringPromptVersion,
} from '@/lib/scoring-prompt-actions';

interface ScoringPromptsEditorProps {
  data: ScoringPromptsData;
}

export function ScoringPromptsEditor({ data }: ScoringPromptsEditorProps) {
  const entries = Object.entries(data.prompts);
  const [selectedKey, setSelectedKey] = useState<string>(entries[0]?.[0] ?? '');
  const [editValue, setEditValue] = useState(entries[0]?.[1]?.prompt ?? '');
  const [saving, setSaving] = useState(false);

  // Version history state
  const [versions, setVersions] = useState<ScoringPromptVersion[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [showSaveVersion, setShowSaveVersion] = useState(false);
  const [saveSummary, setSaveSummary] = useState('');
  const [savingVer, setSavingVer] = useState(false);
  const [restoringVer, setRestoringVer] = useState<number | null>(null);
  const [deletingVer, setDeletingVer] = useState<number | null>(null);

  const selected = selectedKey ? data.prompts[selectedKey] : null;

  function handleSelect(key: string) {
    setSelectedKey(key);
    setEditValue(data.prompts[key]?.prompt ?? '');
  }

  async function handleSave() {
    if (!selectedKey) return;
    setSaving(true);
    try {
      const result = await updateScoringPromptAction(selectedKey, editValue);
      if (result.success) {
        data.prompts[selectedKey].prompt = editValue;
        toast.success('Prompt berhasil disimpan.');
      } else {
        toast.error('Gagal menyimpan prompt.');
      }
    } catch {
      toast.error('Terjadi kesalahan saat menyimpan.');
    } finally {
      setSaving(false);
    }
  }

  async function handleLoadHistory() {
    if (!selectedKey) return;
    setHistoryLoading(true);
    try {
      const list = await listScoringPromptVersions(selectedKey);
      setVersions(list);
      setShowHistory(true);
    } catch {
      toast.error('Gagal memuat riwayat.');
    } finally {
      setHistoryLoading(false);
    }
  }

  async function handleSaveVersionConfirm() {
    if (!selectedKey) return;
    setSavingVer(true);
    try {
      const fd = new FormData();
      fd.set('key', selectedKey);
      fd.set('content', editValue);
      fd.set('summary', saveSummary);
      const result = await saveScoringPromptVersionAction(fd);
      if (result.success) {
        data.prompts[selectedKey].prompt = editValue;
        toast.success('Versi prompt disimpan.');
        setShowSaveVersion(false);
        setSaveSummary('');
        setVersions([]);
      } else {
        toast.error('Gagal menyimpan versi.');
      }
    } catch {
      toast.error('Terjadi kesalahan saat menyimpan versi.');
    } finally {
      setSavingVer(false);
    }
  }

  async function handleRestore(version: number) {
    if (!selectedKey) return;
    setRestoringVer(version);
    try {
      const fd = new FormData();
      fd.set('key', selectedKey);
      fd.set('version', String(version));
      const result = await restoreScoringPromptVersionAction(fd);
      if (result.success && result.prompt !== undefined) {
        setEditValue(result.prompt);
        data.prompts[selectedKey].prompt = result.prompt;
        toast.success(`Versi v${version} dipulihkan.`);
        setShowHistory(false);
      } else {
        toast.error('Gagal memulihkan versi.');
      }
    } catch {
      toast.error('Terjadi kesalahan saat memulihkan.');
    } finally {
      setRestoringVer(null);
    }
  }

  async function handleDelete(version: number) {
    if (!selectedKey) return;
    try {
      const fd = new FormData();
      fd.set('key', selectedKey);
      fd.set('version', String(version));
      const result = await deleteScoringPromptVersionAction(fd);
      if (result.success) {
        toast.success('Versi prompt dihapus.');
        setVersions((prev) => prev.filter((v) => v.version !== version));
      } else {
        toast.error('Gagal menghapus versi.');
      }
    } catch {
      toast.error('Terjadi kesalahan saat menghapus.');
    } finally {
      setDeletingVer(null);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
      <Card className="h-fit">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-1.5 text-sm">
            Prompt Keys
            <InfoHint title="Prompt Keys">Pilih prompt untuk dilihat dan diedit.</InfoHint>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 p-2">
          {entries.map(([key, entry]) => (
            <button
              key={key}
              onClick={() => handleSelect(key)}
              className={cn(
                'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors',
                key === selectedKey
                  ? 'bg-primary/10 font-semibold text-primary'
                  : 'hover:bg-muted/60',
              )}
            >
              <div className="flex-1 min-w-0">
                <p className="truncate text-xs font-medium">{entry.label}</p>
                <p className="truncate text-[10px] text-muted-foreground">{entry.description}</p>
              </div>
            </button>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-1.5 text-base">
              {selected?.label ?? 'Pilih prompt'}
              {selected?.description ? (
                <InfoHint title={selected.label}>{selected.description}</InfoHint>
              ) : null}
            </CardTitle>
          </div>
          {selected && (
            <div className="flex shrink-0 items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setShowSaveVersion(true)}
                disabled={!editValue.trim()}
                className="h-8 gap-1 text-xs text-muted-foreground"
              >
                <Save className="h-3.5 w-3.5" />
                Simpan Versi
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleLoadHistory}
                disabled={historyLoading}
                className="h-8 gap-1.5 text-xs"
              >
                {historyLoading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <History className="h-3.5 w-3.5 text-muted-foreground" />
                )}
                Riwayat
              </Button>
            </div>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          {selected ? (
            <>
              <Textarea
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                className="min-h-[300px] font-mono text-xs leading-relaxed"
                placeholder="Konten prompt..."
              />
              <div className="flex items-center justify-end gap-3">
                <Button size="sm" onClick={handleSave} disabled={saving}>
                  {saving ? 'Menyimpan...' : 'Simpan Perubahan'}
                </Button>
              </div>
            </>
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Pilih prompt dari daftar di samping untuk melihat dan mengedit.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Version History Dialog */}
      <Dialog open={showHistory} onOpenChange={setShowHistory}>
        <DialogContent className="sm:max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <History className="h-5 w-5 text-muted-foreground shrink-0" />
              Riwayat Prompt — {selected?.label ?? ''}
            </DialogTitle>
            <DialogDescription className="text-xs">
              Semua versi prompt yang pernah disimpan. Klik &quot;Gunakan&quot; untuk memulihkan versi lama.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto min-h-0 -mx-6 px-6">
            {versions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <History className="mb-3 h-8 w-8 text-muted-foreground/40" />
                <p className="text-sm font-medium text-muted-foreground">Belum ada riwayat</p>
                <p className="mt-1 text-xs text-muted-foreground/70">
                  Prompt akan otomatis tersimpan sebagai versi baru saat Anda menyimpan perubahan pada prompt.
                </p>
              </div>
            ) : (
              <div className="space-y-3 py-2">
                {versions.map((v) => (
                  <div key={v.version} className="rounded-lg border p-4 space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="text-xs font-semibold">
                          v{v.version}
                        </Badge>
                        <span className="text-[11px] text-muted-foreground">
                          {formatDateTime(v.createdAt)}
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={restoringVer === v.version}
                          onClick={() => handleRestore(v.version)}
                          className="h-7 text-xs gap-1"
                        >
                          {restoringVer === v.version ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Clock className="h-3 w-3" />
                          )}
                          Gunakan
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 text-destructive p-0"
                          onClick={() => setDeletingVer(v.version)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                    {v.summary && <p className="text-xs text-muted-foreground italic">&quot;{v.summary}&quot;</p>}
                    <div className="max-h-32 overflow-y-auto rounded bg-muted/30 p-2.5">
                      <pre className="text-[11px] leading-relaxed whitespace-pre-wrap break-words font-mono">
                        {v.content.length > 600 ? v.content.slice(0, 600) + '...' : v.content}
                      </pre>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <DialogFooter className="pt-2 gap-2 border-t mt-4 -mx-6 px-6">
            <Button type="button" variant="outline" onClick={() => setShowHistory(false)} className="h-9 text-xs">
              Tutup
            </Button>
          </DialogFooter>
        </DialogContent>

        <AlertDialog open={deletingVer !== null} onOpenChange={(open) => !open && setDeletingVer(null)}>
          <AlertDialogContent className="sm:max-w-md">
            <AlertDialogHeader>
              <AlertDialogTitle className="text-base">Hapus versi prompt ini?</AlertDialogTitle>
              <AlertDialogDescription className="text-xs">
                Tindakan ini tidak dapat dibatalkan. Prompt versi ini akan dihapus permanen dari riwayat.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={() => setDeletingVer(null)} className="h-9 text-xs">
                Batal
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={() => deletingVer !== null && handleDelete(deletingVer)}
                className="h-9 text-xs"
              >
                Hapus
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </Dialog>

      {/* Save Version Dialog */}
      <AlertDialog open={showSaveVersion} onOpenChange={setShowSaveVersion}>
        <AlertDialogContent className="sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-base">Simpan sebagai Versi Baru</AlertDialogTitle>
            <AlertDialogDescription className="text-xs">
              Prompt saat ini akan disimpan sebagai versi baru di riwayat dan menjadi prompt aktif.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Catatan (opsional)</Label>
            <Input
              value={saveSummary}
              onChange={(e) => setSaveSummary(e.target.value)}
              placeholder="Contoh: Menambahkan instruksi penilaian teknis"
              className="text-sm"
              autoFocus
            />
          </div>
          <AlertDialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => setShowSaveVersion(false)} disabled={savingVer} className="h-9 text-xs">
              Batal
            </Button>
            <Button onClick={handleSaveVersionConfirm} disabled={savingVer} className="h-9 text-xs">
              {savingVer ? 'Menyimpan...' : 'Simpan Versi'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
