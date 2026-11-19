'use client';

import { useState } from 'react';
import { InfoHint } from '@/components/ui/info-hint';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { getReadinessConfig, updateReadinessConfigAction, type ReadinessConfig, type ReadinessThreshold } from '@/lib/readiness-config-actions';

interface ReadinessEditorProps {
  initialConfig: ReadinessConfig;
}

const LEVEL_COLORS: Record<string, string> = {
  Short: 'border-emerald-300 bg-emerald-500/10 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  Medium: 'border-amber-300 bg-amber-500/10 text-amber-700 dark:border-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  Long: 'border-sky-300 bg-sky-500/10 text-sky-700 dark:border-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
  'Not Ready': 'border-slate-300 bg-slate-500/10 text-slate-700 dark:border-slate-700 dark:bg-slate-500/15 dark:text-slate-300',
};

export function ReadinessEditor({ initialConfig }: ReadinessEditorProps) {
  const [thresholds, setThresholds] = useState<ReadinessThreshold[]>(initialConfig.thresholds);
  const [defaultLevel, setDefaultLevel] = useState(initialConfig.defaultLevel);
  const [saving, setSaving] = useState(false);

  function updateThreshold(index: number, field: keyof ReadinessThreshold, value: string | number) {
    setThresholds((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  }

  function addThreshold() {
    const minScore = thresholds.length > 0 ? Math.max(0, thresholds[thresholds.length - 1].minScore - 15) : 30;
    setThresholds((prev) => [...prev, { minScore, level: 'Long', eta: '', description: '' }]);
  }

  function removeThreshold(index: number) {
    setThresholds((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSave() {
    setSaving(true);
    try {
      const result = await updateReadinessConfigAction(thresholds, defaultLevel);
      if (result.success) {
        toast.success('Threshold readiness berhasil disimpan.');
      } else {
        toast.error('Gagal menyimpan konfigurasi.');
      }
    } catch {
      toast.error('Terjadi kesalahan saat menyimpan.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5 text-base">
            Readiness Thresholds
            <InfoHint title="Readiness Thresholds">
              Threshold skor yang menentukan level readiness kandidat. Short &rarr; siap sekarang, Medium &rarr; siap
              dalam waktu dekat, Long &rarr; perlu pengembangan. Not Ready adalah default untuk skor di bawah threshold
              terendah.
            </InfoHint>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            {thresholds.map((t, i) => (
              <div
                key={i}
                className="grid grid-cols-[140px_120px_1fr_40px] items-center gap-3 rounded-lg border p-3"
              >
                <div>
                  <Label className="text-[10px] text-muted-foreground">Level</Label>
                  <Select
                    value={t.level}
                    onValueChange={(v) => updateThreshold(i, 'level', v)}
                  >
                    <SelectTrigger size="sm" className={`mt-1 w-full text-xs font-semibold ${LEVEL_COLORS[t.level] ?? ''}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Short" className="text-xs">Short</SelectItem>
                      <SelectItem value="Medium" className="text-xs">Medium</SelectItem>
                      <SelectItem value="Long" className="text-xs">Long</SelectItem>
                      <SelectItem value="Not Ready" className="text-xs">Not Ready</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-[10px] text-muted-foreground">Min Score</Label>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={t.minScore}
                    onChange={(e) => updateThreshold(i, 'minScore', parseInt(e.target.value) || 0)}
                    className="mt-1 h-8 text-xs font-semibold tabular-nums"
                  />
                </div>
                <div>
                  <Label className="text-[10px] text-muted-foreground">ETA</Label>
                  <Input
                    value={t.eta}
                    onChange={(e) => updateThreshold(i, 'eta', e.target.value)}
                    placeholder="Contoh: 0 - 1 tahun"
                    className="mt-1 h-8 text-xs"
                  />
                </div>
                <div className="flex items-end h-full pb-0.5">
                  <button
                    type="button"
                    onClick={() => removeThreshold(i)}
                    className="text-[10px] text-rose-500 hover:text-rose-700 hover:underline"
                  >
                    Hapus
                  </button>
                </div>
              </div>
            ))}
          </div>

          <Button variant="outline" size="sm" onClick={addThreshold}>
            + Tambah Threshold
          </Button>

          <div className="flex items-center gap-3 rounded-lg border border-slate-200/60 p-3 dark:border-slate-700">
            <div className="min-w-0 flex-1">
              <Label className="text-[10px] text-muted-foreground">Default Level</Label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Level yang diberikan jika skor di bawah semua threshold.
              </p>
            </div>
            <Select
              value={defaultLevel}
              onValueChange={setDefaultLevel}
            >
              <SelectTrigger size="sm" className={`w-32 text-xs font-semibold ${LEVEL_COLORS[defaultLevel] ?? ''}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Short" className="text-xs">Short</SelectItem>
                <SelectItem value="Medium" className="text-xs">Medium</SelectItem>
                <SelectItem value="Long" className="text-xs">Long</SelectItem>
                <SelectItem value="Not Ready" className="text-xs">Not Ready</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex justify-end border-t pt-4">
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {saving ? 'Menyimpan...' : 'Simpan Threshold'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
