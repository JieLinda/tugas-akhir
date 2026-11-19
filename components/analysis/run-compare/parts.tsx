'use client';

// Small building blocks of the run comparison, shared by the full comparison
// page (L-4) and the "Selisih Peringkat" panel on a run page — one rendering
// of each fact, so the two cannot drift (FR-CMP, "jangan membuat duplikatnya").

import { AlertTriangle, CheckCircle2, Ruler, ShieldAlert, UserPlus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { InfoHint } from '@/components/ui/info-hint';
import { ORIGIN_LABEL, type Origin } from '@/lib/run-compare';
import type { ComparisonDto } from '@/lib/run-compare-dto';
import { fmtTiny } from '@/lib/run-compare-format';
import type { Explanation } from '@/lib/run-compare-explain';
import type { RankingRow, SourceVerdict } from '@/lib/run-compare';

/**
 * "▲2 (naik)" — the glyph AND the word, never colour alone (§6). The colour
 * follows the slope chart's validated pair: blue up, orange down.
 */
export function RankDelta({ delta }: { delta: number | null }) {
  if (delta == null) return <span className="text-muted-foreground">—</span>;
  if (delta === 0) return <span className="whitespace-nowrap text-muted-foreground">— (tetap)</span>;
  return (
    <span
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded-full px-1.5 py-px font-semibold',
        delta > 0
          ? 'bg-blue-500/10 text-blue-700 dark:text-blue-300'
          : 'bg-orange-500/10 text-orange-700 dark:text-orange-300',
      )}
    >
      {delta > 0 ? `▲${delta} (naik)` : `▼${-delta} (turun)`}
    </span>
  );
}

/** Where a configuration value came from (I-3), in the reader's words. */
export function OriginTag({ origin }: { origin: Origin }) {
  const tone =
    origin === 'live_fallback' || origin === 'live'
      ? 'border-amber-500/50 bg-amber-500/10 text-amber-800 dark:text-amber-200'
      : origin === 'not_recorded'
        ? 'border-slate-400/50 bg-slate-400/10 text-slate-600 dark:text-slate-300'
        : 'border-slate-300/70 bg-background text-muted-foreground';
  return (
    <span className={cn('inline-flex items-center rounded border px-1 py-px text-[9px] font-medium', tone)}>
      {ORIGIN_LABEL[origin]}
    </span>
  );
}

const DATA_SIDE: SourceVerdict['key'][] = ['S1', 'S3', 'S4'];
const CONFIG_SIDE: SourceVerdict['key'][] = ['S2', 'S5'];

/**
 * FR-CMP-03: S1–S5, each "Sama" / "Berbeda" with one line, grouped the way a
 * forum reads them. On a frozen parent → child pair anything but S1 differing
 * is a broken freeze — a bug — and is shown as one.
 */
export function SourceSummary({
  sources,
  freezeViolations,
  compact = false,
}: {
  sources: SourceVerdict[];
  freezeViolations: SourceVerdict[];
  compact?: boolean;
}) {
  const by = new Map(sources.map((s) => [s.key, s]));
  const group = (title: string, keys: SourceVerdict['key'][]) => (
    <div className="space-y-1">
      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{title}</p>
      <ul className="space-y-1">
        {keys.map((k) => {
          const s = by.get(k)!;
          return (
            <li key={k} className="flex items-start gap-2 text-xs">
              <span
                className={cn(
                  'inline-flex w-[4.75rem] shrink-0 items-center justify-center gap-1 rounded border px-1 py-px text-[10px] font-semibold',
                  s.differs
                    ? 'border-amber-500/50 bg-amber-500/10 text-amber-800 dark:text-amber-200'
                    : 'border-slate-300/70 text-muted-foreground',
                )}
              >
                {s.differs ? <AlertTriangle className="h-2.5 w-2.5" aria-hidden /> : <CheckCircle2 className="h-2.5 w-2.5" aria-hidden />}
                {s.differs ? 'Berbeda' : 'Sama'}
              </span>
              <span className="min-w-0">
                <span className="font-medium">
                  {k} · {s.label}
                </span>
                {!compact && <span className="text-muted-foreground"> — {s.summary}</span>}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
  return (
    <div className="space-y-3">
      {freezeViolations.length > 0 && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-rose-500/60 bg-rose-500/10 p-2.5 text-xs text-rose-900 dark:text-rose-100"
        >
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>
            <strong>Pelanggaran pembekuan.</strong> Pada pasangan induk–turunan Tambah Kandidat Pembanding hanya
            komposisi pool (S1) yang boleh berbeda, tetapi{' '}
            {freezeViolations.map((v) => `${v.key} (${v.label.toLowerCase()})`).join(', ')} juga berbeda. Ini menandakan
            bug pada pembekuan; laporkan kedua nomor run ini ke tim aplikasi sebelum hasilnya dipakai.
          </span>
        </div>
      )}
      <div className={cn('grid gap-3', !compact && 'md:grid-cols-2')}>
        {group('Perubahan data atau himpunan', DATA_SIDE)}
        {group('Perubahan konfigurasi atau pertimbangan', CONFIG_SIDE)}
      </div>
    </div>
  );
}

/**
 * FR-CMP-09: the template sentences, numbered by their template. The note that
 * they are template-built (no model) sits behind the title's "?"; with an empty
 * title the host card is expected to say it.
 */
export function ExplanationList({ items, title = 'Penjelasan' }: { items: Explanation[]; title?: string }) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-1.5">
      {title && (
        <p className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          {title}
          <InfoHint size="xs" title={title}>
            Kalimat disusun dari templat dan angka hasil hitungan, tanpa model bahasa.
          </InfoHint>
        </p>
      )}
      <ul className="space-y-1.5">
        {items.map((e, i) => (
          <li
            key={`${e.id}-${i}`}
            className="flex items-start gap-2 rounded-lg px-1.5 py-1 text-xs leading-relaxed transition-colors hover:bg-muted/40"
          >
            <span
              className="mt-px shrink-0 rounded-md bg-cyan-500/12 px-1.5 py-px font-mono text-[9px] font-semibold text-cyan-800 dark:text-cyan-200"
              title="Kode templat kalimat"
            >
              {e.id}
            </span>
            <span>{e.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const MEMBERSHIP_LABEL: Record<RankingRow['membership'], string> = {
  both: 'Ada di keduanya',
  only_a: 'Hanya di A',
  only_b: 'Hanya di B',
};
export const membershipLabel = (m: RankingRow['membership']) => MEMBERSHIP_LABEL[m];

/** The row's markers, in glossary words (§6). */
export function RowMarkers({ row }: { row: RankingRow }) {
  const m = row.markers;
  const chips: { text: string; tone: string; icon?: typeof UserPlus; hint?: string }[] = [];
  if (m.comparison) chips.push({ text: 'Kandidat pembanding', tone: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200', icon: UserPlus });
  if (m.existingPool)
    chips.push({
      text: 'Sudah ada di pool induk',
      tone: 'border-slate-400/50 bg-slate-400/10 text-slate-700 dark:text-slate-300',
      hint: 'Tidak dinilai ulang; nilainya diambil dari run induk.',
    });
  if (m.outOfRange) chips.push({ text: 'Di luar rentang grade', tone: 'border-orange-500/50 bg-orange-500/10 text-orange-800 dark:text-orange-200', icon: Ruler });
  if (m.excludedA) chips.push({ text: 'Ditandai dikecualikan di A', tone: 'border-slate-400/50 bg-slate-200/60 text-slate-700 dark:bg-slate-800/60 dark:text-slate-300', hint: 'Penandaan forum; tidak memengaruhi angka.' });
  if (m.excludedB) chips.push({ text: 'Ditandai dikecualikan di B', tone: 'border-slate-400/50 bg-slate-200/60 text-slate-700 dark:bg-slate-800/60 dark:text-slate-300', hint: 'Penandaan forum; tidak memengaruhi angka.' });
  if (m.provisionalA || m.provisionalB)
    chips.push({
      text: `Skor sementara${m.provisionalA && m.provisionalB ? '' : m.provisionalA ? ' di A' : ' di B'}`,
      tone: 'border-violet-500/50 bg-violet-500/10 text-violet-800 dark:text-violet-200',
      hint: 'Sebagian aspek tidak dapat dibaca saat penilaian, sehingga nilainya sementara.',
    });
  if (chips.length === 0) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {chips.map((c) => (
        <span
          key={c.text}
          title={c.hint}
          className={cn('inline-flex items-center gap-0.5 rounded border px-1 py-px text-[9px] font-semibold', c.tone)}
        >
          {c.icon && <c.icon className="h-2.5 w-2.5" aria-hidden />}
          {c.text}
        </span>
      ))}
    </span>
  );
}

/** Finalist status A → B in words. */
export function finalistText(change: RankingRow['finalistChange']): string {
  switch (change) {
    case 'masuk':
      return 'Masuk N besar';
    case 'keluar':
      return 'Keluar dari N besar';
    case 'tetap':
      return 'Tetap finalis';
    case 'tidak':
      return 'Bukan finalis';
    default:
      return '—';
  }
}

/** The replay checks on both runs (NFR-RR-01), one line each. */
export function ReproducibilityLine({ dto }: { dto: ComparisonDto }) {
  const line = (side: 'A' | 'B', r: ComparisonDto['reproducibility']['a']) =>
    !r.verifiable
      ? `Run ${side}: tidak dapat diverifikasi — ${r.reason}`
      : r.reproducible
        ? `Run ${side}: terulang dari data tersimpan (${r.checked} kandidat, selisih maks ${fmtTiny(r.maxStoredDelta)})`
        : `Run ${side}: TIDAK terulang — ${r.rankMismatches.length} peringkat dan ${r.closenessMismatches.length} kecocokan berbeda dari yang tersimpan`;
  const bad = [dto.reproducibility.a, dto.reproducibility.b].some((r) => r.verifiable && !r.reproducible);
  return (
    <p className={cn('text-[10px] leading-relaxed', bad ? 'font-semibold text-rose-700 dark:text-rose-300' : 'text-muted-foreground')}>
      {line('A', dto.reproducibility.a)} · {line('B', dto.reproducibility.b)}
    </p>
  );
}

/** The parts of the position basis an engine read live, in the reader's words. */
const LIVE_PART_LABEL: Record<string, string> = {
  careerTarget: 'dokumen target karier',
  education: 'syarat pendidikan',
  jobProfile: 'job profile target',
  required: 'acuan kompetensi',
};

/**
 * FR-RR-07(c), I-6: anything either run had to read from TODAY's state instead
 * of a frozen snapshot, said above the comparison rather than left to an origin
 * tag deep in the Konfigurasi tab. Nothing renders when both runs are frozen
 * throughout.
 */
export function LiveValuesNotice({ dto }: { dto: ComparisonDto }) {
  const side = (s: 'A' | 'B') => {
    const labelsWith = (origin: Origin) =>
      dto.config.filter((c) => (s === 'A' ? c.originA : c.originB) === origin).map((c) => c.label);
    const basis = (s === 'A' ? dto.a : dto.b).config.positionBasis;
    return {
      // Should have been frozen, but the parent never recorded it.
      fallback: labelsWith('live_fallback'),
      // Read at the run's own creation, as its (legacy) mode did.
      live: labelsWith('live'),
      parts: (basis?.liveParts ?? []).map((p) => LIVE_PART_LABEL[p] ?? p),
      caveats: basis?.caveats ?? [],
    };
  };
  const rows = (['A', 'B'] as const)
    .map((s) => ({ s, ...side(s) }))
    .filter((r) => r.fallback.length + r.live.length + r.parts.length + r.caveats.length > 0);
  if (rows.length === 0) return null;
  return (
    <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-2 text-[11px]">
      <p className="flex items-center gap-1 font-semibold text-amber-800 dark:text-amber-200">
        <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
        Ada nilai yang tidak dibekukan dari run induk
      </p>
      <ul className="mt-0.5 list-disc space-y-0.5 pl-5 text-amber-900 dark:text-amber-100">
        {rows.map((r) => (
          <li key={r.s}>
            <span className="font-semibold">Run {r.s}:</span>{' '}
            {[
              r.fallback.length
                ? `${r.fallback.join('; ')} dibaca dari kondisi saat run ini dibuat, karena run induknya tidak menyimpannya`
                : null,
              r.live.length ? `${r.live.join('; ')} dibaca dari kondisi saat run ini dibuat, bukan dari run induknya` : null,
              r.parts.length ? `bagian basis posisi yang dibaca saat run ini dibuat: ${r.parts.join(', ')}` : null,
              ...r.caveats,
            ]
              .filter((x): x is string => Boolean(x))
              .map((x) => x.replace(/\.\s*$/, ''))
              .join('. ')}
            .
          </li>
        ))}
      </ul>
    </div>
  );
}
