'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, BookOpen, GraduationCap, Layers, Loader2, Search, Sparkles, Trophy } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { listKamusCompetencies, type KamusRecordRow } from '@/lib/kamus-actions';
import { formatDate } from '@/lib/datetime';
import { useIdentifierDisplay } from '@/components/app-mode-provider';
import { DemoMaskedText } from '@/components/demo/demo-masked-text';

const LEVELS = [
  { key: 'levelBasic', label: 'Basic Knowledge', short: '1 · Basic', icon: BookOpen, tone: 'border-sky-200 bg-sky-500/5 dark:border-sky-900/50', accent: 'text-sky-600 dark:text-sky-400' },
  { key: 'levelIntermediate', label: 'Intermediate', short: '2 · Intermediate', icon: Layers, tone: 'border-emerald-200 bg-emerald-500/5 dark:border-emerald-900/50', accent: 'text-emerald-600 dark:text-emerald-400' },
  { key: 'levelAdvance', label: 'Advance', short: '3 · Advance', icon: GraduationCap, tone: 'border-amber-200 bg-amber-500/5 dark:border-amber-900/50', accent: 'text-amber-600 dark:text-amber-400' },
  { key: 'levelMastery', label: 'Mastery', short: '4 · Mastery', icon: Trophy, tone: 'border-violet-200 bg-violet-500/5 dark:border-violet-900/50', accent: 'text-violet-600 dark:text-violet-400' },
] as const;

/** Split a level paragraph into bullet items ("• " separators from the PDF). */
function bulletize(text: string | null): string[] {
  if (!text) return [];
  return text
    .split(/\s*•\s*/g)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function KamusPageClient() {
  // Demo mode masks competency codes, and so does not search by them.
  const ids = useIdentifierDisplay();
  const [records, setRecords] = useState<KamusRecordRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<KamusRecordRow | null>(null);

  const load = () => {
    setError(null);
    setRecords(null);
    listKamusCompetencies()
      .then(setRecords)
      .catch((e) => setError(e instanceof Error ? e.message : 'Gagal memuat kamus kompetensi.'));
  };

  // Fetch after paint — keeps the page shell instant.
  useEffect(() => {
    let active = true;
    setError(null);
    listKamusCompetencies()
      .then((rows) => active && setRecords(rows))
      .catch((e) => active && setError(e instanceof Error ? e.message : 'Gagal memuat kamus kompetensi.'));
    return () => {
      active = false;
    };
  }, []);

  const loading = records === null && !error;

  const filtered = useMemo(() => {
    const list = records ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (r) =>
        (!ids.demo && r.code.toLowerCase().includes(q)) ||
        r.name.toLowerCase().includes(q) ||
        (r.description ?? '').toLowerCase().includes(q),
    );
  }, [records, search]);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full space-y-5 p-6">
        {/* Toolbar */}
        <Card>
          <CardContent className="flex flex-wrap items-center gap-3 pt-0">
            <div className="relative min-w-64 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={ids.demo ? 'Cari nama atau isi definisi…' : 'Cari kode (TC 003), nama, atau isi definisi…'}
                className="pl-9"
                disabled={loading || Boolean(error)}
              />
            </div>
            <Badge variant="secondary" className="tabular-nums">
              {loading ? '…' : `${filtered.length} / ${records?.length ?? 0}`} kompetensi
            </Badge>
          </CardContent>
        </Card>

        {/* Competency grid */}
        {error ? (
          <Card className="border-rose-200/70 dark:border-rose-900/60">
            <CardContent className="flex flex-col items-center gap-3 py-12 text-center text-sm text-muted-foreground">
              <AlertTriangle className="h-5 w-5 text-rose-500" />
              <span>{error}</span>
              <Button variant="outline" size="sm" onClick={load}>
                Coba lagi
              </Button>
            </CardContent>
          </Card>
        ) : loading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-40 animate-pulse rounded-xl border bg-muted/40" />
            ))}
            <div className="col-span-full flex items-center justify-center gap-2 py-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Memuat kamus kompetensi…
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <Card>
            <CardContent className="py-14 text-center text-sm text-muted-foreground">
              {(records?.length ?? 0) === 0
                ? 'Belum ada data kamus. Jalankan sinkronisasi "Kamus Kompetensi" di menu Sinkronisasi.'
                : 'Tidak ada kompetensi yang cocok dengan pencarian.'}
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((r) => {
              const levelCount = LEVELS.filter((l) => r[l.key]).length;
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setSelected(r)}
                  className="group rounded-xl border bg-card p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
                >
                  <div className="flex items-start justify-between gap-2">
                    <Badge variant="outline" className="shrink-0 font-mono text-[10px] font-bold tracking-wider">
                      {ids.code(r.code)}
                    </Badge>
                    <span className="text-[10px] font-semibold text-muted-foreground">
                      {levelCount}/4 level
                    </span>
                  </div>
                  <p className="mt-2 text-sm font-bold leading-snug text-slate-900 group-hover:text-primary dark:text-slate-100">
                    {r.name}
                  </p>
                  <p className="mt-1.5 line-clamp-3 text-xs leading-relaxed text-muted-foreground">
                    <DemoMaskedText text={r.description || 'Tidak ada deskripsi.'} />
                  </p>
                  <div className="mt-3 flex flex-wrap gap-1">
                    {LEVELS.map((l) =>
                      r[l.key] ? (
                        <span
                          key={l.key}
                          className={`rounded border px-1.5 py-px text-[9px] font-bold ${l.tone} ${l.accent}`}
                        >
                          {l.short}
                        </span>
                      ) : null,
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Detail dialog */}
      <Dialog open={Boolean(selected)} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="flex max-h-[88vh] flex-col sm:max-w-4xl">
          {selected && (
            <>
              <DialogHeader className="shrink-0">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="font-mono text-[10px] font-bold tracking-wider">
                    {ids.code(selected.code)}
                  </Badge>
                  <DialogTitle className="text-base">{selected.name}</DialogTitle>
                </div>
                {selected.description && (
                  <DialogDescription className="flex items-start gap-2 pt-1 text-left leading-relaxed">
                    <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                    <span>
                      <DemoMaskedText text={selected.description} />
                    </span>
                  </DialogDescription>
                )}
              </DialogHeader>

              <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                <div className="grid gap-3 sm:grid-cols-2">
                  {LEVELS.map((l) => {
                    const items = bulletize(selected[l.key]);
                    return (
                      <div key={l.key} className={`rounded-xl border p-3.5 ${l.tone}`}>
                        <p className={`mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider ${l.accent}`}>
                          <l.icon className="h-3.5 w-3.5" /> {l.label}
                        </p>
                        {items.length > 0 ? (
                          <ul className="space-y-1.5">
                            {items.map((item, i) => (
                              <li key={i} className="flex gap-1.5 text-xs leading-relaxed text-slate-700 dark:text-slate-300">
                                <span className={`mt-1.5 size-1 shrink-0 rounded-full bg-current ${l.accent}`} />
                                <span>
                                  <DemoMaskedText text={item} />
                                </span>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-xs italic text-muted-foreground">Tidak ada rincian level ini.</p>
                        )}
                      </div>
                    );
                  })}
                </div>
                <p className="mt-3 text-[10px] text-muted-foreground">
                  Sumber: {selected.sourceFile ?? '-'} · Disinkron{' '}
                  {formatDate(selected.syncedAt)}
                </p>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
