'use client';

import { useState } from 'react';
import { Loader2, Save, UserMinus } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { updateRetirementConfigAction } from '@/lib/retirement-config-actions';
import type { RetirementConfig } from '@/lib/retirement-config';

/** "GENERAL MANAGER" → "General Manager". */
function levelLabel(name: string): string {
  return name
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export function RetirementEditor({
  initialConfig,
  levelNames,
}: {
  initialConfig: RetirementConfig;
  /** Level names of the active business unit, so the form offers the ladder
   *  this tenant actually uses rather than a hardcoded list. */
  levelNames: string[];
}) {
  // Union of what's configured and what the tenant's grade ladder has — a level
  // that exists in the data but has no threshold yet must still be editable.
  const levels = Array.from(
    new Set([...Object.keys(initialConfig.byLevel), ...levelNames.map((l) => l.toUpperCase())]),
  ).sort();

  const [byLevel, setByLevel] = useState<Record<string, string>>(
    Object.fromEntries(
      levels.map((level) => [level, String(initialConfig.byLevel[level] ?? initialConfig.defaultMinAge)]),
    ),
  );
  const [defaultMinAge, setDefaultMinAge] = useState(String(initialConfig.defaultMinAge));
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const parsed: Record<string, number> = {};
      for (const [level, value] of Object.entries(byLevel)) {
        const n = Number(value);
        if (Number.isFinite(n) && n > 0) parsed[level] = Math.round(n);
      }
      const res = await updateRetirementConfigAction({
        byLevel: parsed,
        defaultMinAge: Number(defaultMinAge) || initialConfig.defaultMinAge,
      });
      if (res.success) toast.success('Ambang usia pensiun disimpan.');
      else toast.error(res.error ?? 'Gagal menyimpan.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menyimpan.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="border-slate-200/80 shadow-xs dark:border-slate-800">
      <CardHeader className="border-b pb-3">
        <CardTitle className="flex items-center gap-2 text-base font-semibold">
          <UserMinus className="h-4 w-4 text-rose-500" />
          Ambang Usia Pensiun
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Usia minimum yang membuat seorang pejabat ditandai “mendekati pensiun” di Position
          Management. Ambangnya per level karena tiap level pensiun pada jadwal berbeda — dan
          urgensi suksesi diukur dari sisa waktu pejabatnya, bukan dari usianya saja.
        </p>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {levels.map((level) => (
            <div key={level} className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">{levelLabel(level)}</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={30}
                  max={100}
                  value={byLevel[level] ?? ''}
                  onChange={(e) => setByLevel((prev) => ({ ...prev, [level]: e.target.value }))}
                  className="h-9 text-sm"
                />
                <span className="shrink-0 text-xs text-muted-foreground">tahun</span>
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-end justify-between gap-3 border-t pt-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">
              Level lain (yang tidak tercantum di atas)
            </Label>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={30}
                max={100}
                value={defaultMinAge}
                onChange={(e) => setDefaultMinAge(e.target.value)}
                className="h-9 w-28 text-sm"
              />
              <span className="text-xs text-muted-foreground">tahun</span>
            </div>
          </div>
          <Button size="sm" onClick={save} disabled={saving}>
            {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />}
            Simpan ambang pensiun
          </Button>
        </div>

        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Pejabat yang tanggal lahirnya belum tersinkron TIDAK pernah ditandai — data yang belum ada
          bukan temuan. Jalankan sinkronisasi “Data Pribadi” lebih dulu bila usianya masih kosong.
        </p>
      </CardContent>
    </Card>
  );
}
