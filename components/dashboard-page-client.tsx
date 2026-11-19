'use client';

import Link from 'next/link';
import {
  BriefcaseIcon,
  CheckCircleIcon,
  CircleWavyCheckIcon,
  DatabaseIcon,
  GridNineIcon,
  PulseIcon,
  TargetIcon,
  TrendUpIcon,
  UserMinusIcon,
  UsersThreeIcon,
} from '@phosphor-icons/react';
import { ArrowRight, CircleHelp } from 'lucide-react';
import { DashboardHeader } from '@/components/dashboard-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { BOX_META } from '@/lib/hav-box-meta';
import { appSummary } from '@/lib/talent-data';
import { HAV_QUADRANTS } from '@/lib/hav-quadrant';
import { talentBoxFromQuadrant } from '@/lib/hav-quadrant-derive';
import { cn } from '@/lib/utils';
import type { DashboardOverviewType } from '@/lib/pulse-data';
import { formatDateTime } from '@/lib/datetime';

const bandTone: Record<string, string> = {
  'Strong bench': 'bg-emerald-500',
  Watchlist: 'bg-amber-500',
  'Critical gap': 'bg-rose-500',
};

/** Band label → /positions?band= value (see READINESS_BANDS in lib/pulse-data.ts). */
const bandQueryKey: Record<string, string> = {
  'Strong bench': 'strong',
  Watchlist: 'watchlist',
  'Critical gap': 'critical',
};

const bandRangeLabel: Record<string, string> = {
  'Strong bench': 'coverage ≥ 80%',
  Watchlist: 'coverage 50–79%',
  'Critical gap': 'coverage < 50%',
};

function formatActivityTime(value: Date | null): string {
  if (!value) return 'Belum ada aktivitas';
  return formatDateTime(value);
}

function getRunStatusTone(status: string): string {
  if (status === 'completed') {
    return 'border-emerald-200 bg-emerald-500/10 text-emerald-700 dark:border-emerald-900/70 dark:bg-emerald-500/15 dark:text-emerald-300';
  }

  if (status === 'draft') {
    return 'border-amber-200 bg-amber-500/10 text-amber-700 dark:border-amber-900/70 dark:bg-amber-500/15 dark:text-amber-300';
  }

  return 'border-slate-200 bg-slate-500/10 text-slate-700 dark:border-slate-800 dark:bg-slate-500/15 dark:text-slate-300';
}

function getCoverageTone(value: number): string {
  if (value >= 80) return 'text-emerald-700 dark:text-emerald-300';
  if (value >= 50) return 'text-amber-700 dark:text-amber-300';
  return 'text-rose-700 dark:text-rose-300';
}

// ── Bento building blocks ─────────────────────────────────────

/**
 * One tile of the bento mosaic. Fills its grid cell (stretch) and clips its own
 * content, so list bodies can scroll internally at xl (where cells have a fixed
 * height) while flowing naturally at smaller widths.
 */
function Cell({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <section
      className={cn(
        'flex min-h-0 flex-col overflow-hidden rounded-2xl border bg-card text-card-foreground shadow-sm transition-shadow hover:shadow-md',
        className,
      )}
    >
      {children}
    </section>
  );
}

/**
 * The "?" beside a headline figure.
 *
 * Not one number on this page is a stored column — every one is derived at
 * request time in `getDashboardOverview` — so "where did this come from" is a
 * question the database cannot answer either. A tooltip was the obvious choice
 * and is the wrong one: these answers are a formula plus the thing the formula
 * deliberately excludes, which is three sentences, and a tooltip both refuses
 * that length and never opens on touch.
 *
 * `className` exists because two of these must sit OUTSIDE the Link they
 * explain (see the Ready now cell) and are therefore positioned by the caller.
 */
function MetricHelp({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Penjelasan ${label}`}
          className={cn(
            'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted-foreground/60 transition-colors',
            'hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
            className,
          )}
        >
          <CircleHelp className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <p className="text-sm font-semibold leading-tight">{label}</p>
        <div className="mt-2 space-y-2 text-xs leading-relaxed text-muted-foreground">{children}</div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * One text for two figures: "Ready now / soon" is the numerator and "Bench
 * coverage" is the ratio, so a second copy would be the same explanation free
 * to drift from the first.
 */
const COVERAGE_HELP = (
  <>
    <p>
      <span className="font-medium text-foreground">Rumus:</span> kandidat ber-readiness{' '}
      <span className="font-medium text-foreground">Short</span> atau{' '}
      <span className="font-medium text-foreground">Medium</span> ÷ seluruh kandidat yang pernah
      diberi skor — dihitung dari{' '}
      <span className="font-medium text-foreground">run terakhir yang sudah selesai</span> di setiap
      posisi (run yang masih berjalan atau draft diabaikan).
    </p>
    <p>
      Readiness diturunkan dari skor akhir run: ≥ 80 Short, ≥ 65 Medium, ≥ 50 Long, sisanya Not
      Ready. Ambangnya diatur di Tata Kelola → Kesiapan &amp; Pensiun, jadi angka ini ikut berubah
      kalau ambangnya diubah.
    </p>
    <p>
      Yang dihitung adalah <span className="font-medium text-foreground">baris hasil scoring</span>,
      bukan jumlah orang: satu kandidat yang masuk tiga posisi terhitung tiga kali. Posisi yang
      belum pernah dinilai tidak masuk pembilang maupun penyebut.
    </p>
  </>
);

const INCUMBENT_HELP = (
  <>
    <p>
      <span className="font-medium text-foreground">Rumus:</span> posisi yang punya nama pejabat
      aktif ÷ seluruh posisi terdaftar di Company ini.
    </p>
    <p>
      Angka ini soal <span className="font-medium text-foreground">kelengkapan data pejabat</span>,
      bukan soal suksesor. 100% berarti setiap posisi sudah tercatat siapa yang mendudukinya — bukan
      berarti setiap posisi sudah punya calon pengganti.
    </p>
  </>
);

const BANDS_HELP = (
  <>
    <p>
      Penyebutnya <span className="font-medium text-foreground">jumlah posisi</span>, bukan jumlah
      kandidat. Setiap posisi punya coverage sendiri: persentase kandidat Short/Medium pada run
      terakhir posisi itu. Strong bench ≥ 80%, Watchlist 50–79%, Critical gap &lt; 50%.
    </p>
    <p>
      <span className="font-medium text-foreground">Posisi yang belum pernah dinilai ikut
      terhitung</span> — coverage-nya 0%, sehingga jatuh ke Critical gap. Kalau Critical gap terasa
      terlalu besar, periksa dulu berapa posisi yang memang belum punya run sama sekali.
    </p>
  </>
);

function CellHead({
  icon,
  tone,
  title,
  desc,
  help,
}: {
  icon: React.ReactNode;
  tone: string;
  title: string;
  desc?: string;
  help?: React.ReactNode;
}) {
  return (
    <div className="flex shrink-0 items-center gap-2.5 px-4 pt-4">
      <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', tone)}>{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold leading-tight">{title}</p>
        {desc ? <p className="truncate text-[11px] text-muted-foreground">{desc}</p> : null}
      </div>
      {help}
    </div>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center rounded-xl border border-dashed p-4 text-center text-xs text-muted-foreground">
      {children}
    </div>
  );
}

interface DashboardPageClientProps {
  overview: DashboardOverviewType;
}

export function DashboardPageClient({ overview }: DashboardPageClientProps) {
  const { totals } = overview;
  const topPosition = overview.topPositions[0];
  const maxHav = Math.max(...overview.havDistribution.map((i) => i.employees), 1);
  /** Candidates actually placed in a quadrant — the denominator of the 5-Box strip. */
  const havPlaced = overview.havCoverage.manual + overview.havCoverage.stored + overview.havCoverage.derived;

  const heroKpis = [
    {
      icon: <BriefcaseIcon className="h-4 w-4 text-sky-600 dark:text-sky-400" weight="duotone" />,
      value: totals.positions,
      label: 'Positions',
      note: `${totals.scoredPositions} sudah scoring`,
      href: '/positions',
      hint: 'Buka daftar positions',
    },
    {
      icon: <UsersThreeIcon className="h-4 w-4 text-violet-600 dark:text-violet-400" weight="duotone" />,
      // The REAL talent pool: candidates that clear the program's filter rules,
      // the same figure /talent-pool shows. The old card counted every live
      // candidate, which answers "how many people do we have" — a different
      // question that made the dashboard disagree with the page it linked to.
      value: totals.talentPoolQualified,
      label: 'Talent pool',
      note: `lolos dari ${totals.talentPoolEvaluated} karyawan`,
      href: '/talent-pool',
      hint: 'Buka Talent Pool',
    },
    {
      icon: <UserMinusIcon className="h-4 w-4 text-rose-600 dark:text-rose-400" weight="duotone" />,
      value: totals.positionsNeedingChange,
      label: 'Perlu pergantian',
      note: 'pejabat mendekati pensiun',
      href: '/positions',
      hint: 'Buka Manajemen Posisi',
    },
  ];

  return (
    <>
      <DashboardHeader
        title={appSummary.subtitle}
        actions={
          <div className="flex items-center gap-2">
            <Button asChild size="sm">
              <Link href="/positions">
                <BriefcaseIcon className="mr-1 h-4 w-4" weight="duotone" />
                Posisi
              </Link>
            </Button>
          </div>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-slim">
        <div className="mx-auto w-full p-4 lg:p-6">
          <div className="grid grid-cols-6 gap-3 xl:auto-rows-[10.75rem]">
            {/* ── Hero ─────────────────────────────────────────── */}
            <Cell className="col-span-6 border-primary/20 bg-[radial-gradient(circle_at_top_right,rgba(234,88,12,0.14),transparent_55%)] xl:col-span-4 xl:row-span-2">
              <div className="flex h-full flex-col justify-between gap-4 p-5">
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-primary/15 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-primary">
                      Pulse Command Center
                    </span>
                    <Badge className="border-sky-200 bg-sky-500/10 text-sky-700 dark:border-sky-900/60 dark:bg-sky-500/15 dark:text-sky-300" variant="outline">
                      Company · {overview.tenant.name}
                    </Badge>
                    <Badge className="border-emerald-200 bg-emerald-500/10 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-500/15 dark:text-emerald-300" variant="outline">
                      {totals.scoredPositions}/{totals.positions} posisi scoring
                    </Badge>
                  </div>

                  <div>
                    <h2 className="text-2xl font-bold tracking-tight text-slate-950 dark:text-slate-50">
                      Predictive Usage for Leadership &amp; Successor Excellence
                    </h2>
                    <p className="mt-1.5 max-w-xl text-sm leading-6 text-slate-600 dark:text-slate-300">
                      Fokus utama saat ini ada di{' '}
                      <span className="font-medium text-slate-800 dark:text-slate-100">
                        {topPosition?.title ?? 'posisi kritis'}
                      </span>{' '}
                      dengan coverage readiness {topPosition?.readinessCoverage ?? 0}%.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2.5">
                  {heroKpis.map((kpi) => (
                    <Link
                      key={kpi.label}
                      href={kpi.href}
                      aria-label={`${kpi.label}: ${kpi.value}, ${kpi.note}. ${kpi.hint}.`}
                      className={cn(
                        'group rounded-xl border bg-background/60 p-3 backdrop-blur-sm transition-colors',
                        'hover:border-primary/40 hover:bg-background',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                      )}
                    >
                      <div className="flex items-center gap-1.5">
                        {kpi.icon}
                        <span className="truncate text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                          {kpi.label}
                        </span>
                        <ArrowRight
                          aria-hidden
                          className="ml-auto h-3 w-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                        />
                      </div>
                      <p className="mt-1 text-2xl font-bold tabular-nums text-slate-950 dark:text-slate-50">{kpi.value}</p>
                      <p className="truncate text-[11px] text-muted-foreground">{kpi.note}</p>
                    </Link>
                  ))}
                </div>

                <div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1 font-medium text-slate-600 dark:text-slate-300">
                      Bench coverage
                      <MetricHelp label="Bench coverage">{COVERAGE_HELP}</MetricHelp>
                    </span>
                    <span className={cn('font-semibold', getCoverageTone(totals.readinessCoverage))}>
                      {totals.readinessCoverage}%
                    </span>
                  </div>
                  <div className="mt-1.5 h-2 rounded-full bg-slate-200/70 dark:bg-slate-800/80">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${totals.readinessCoverage}%` }} />
                  </div>
                </div>
              </div>
            </Cell>

            {/* ── Ready now stat ───────────────────────────────── */}
            <Cell className="relative col-span-3 border-emerald-200/60 bg-gradient-to-br from-emerald-500/10 to-card dark:border-emerald-900/50 xl:col-span-2">
              {/* Outside the Link deliberately. A <button> inside an <a> is
                  invalid markup, and the only way to stop the anchor navigating
                  from an inner click is preventDefault — which Radix's
                  composeEventHandlers reads as "already handled" and would
                  swallow the popover with it. */}
              <MetricHelp label="Ready now / soon" className="absolute right-3 top-3 z-10">
                {COVERAGE_HELP}
              </MetricHelp>
              <Link
                href="/positions?readiness=ready"
                aria-label={`Ready now atau soon: ${totals.readyNow} kandidat, ${totals.readinessCoverage} persen dari kandidat hasil scoring. Buka posisi yang sudah punya kandidat siap.`}
                className="group flex h-full flex-col justify-between p-4 transition-colors hover:bg-emerald-500/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-500"
              >
                <div className="flex items-start justify-between">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                    <TrendUpIcon className="h-5 w-5" weight="duotone" />
                  </span>
                </div>
                <div>
                  <p className="flex items-center gap-2 text-3xl font-bold tabular-nums text-slate-950 dark:text-slate-50">
                    {totals.readyNow}
                    <ArrowRight
                      aria-hidden
                      className="h-4 w-4 text-emerald-600/70 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 dark:text-emerald-400/70"
                    />
                  </p>
                  <p className="text-xs font-medium text-slate-700 dark:text-slate-200">Ready now / soon</p>
                  <p className="text-[11px] text-muted-foreground">{totals.readinessCoverage}% dari kandidat hasil scoring</p>
                </div>
              </Link>
            </Cell>

            {/* ── Incumbent coverage stat ──────────────────────── */}
            <Cell className="col-span-3 border-sky-200/60 bg-gradient-to-br from-sky-500/10 to-card dark:border-sky-900/50 xl:col-span-2">
              <div className="flex h-full flex-col justify-between p-4">
                <div className="flex items-start justify-between">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-500/15 text-sky-600 dark:text-sky-400">
                    <CircleWavyCheckIcon className="h-5 w-5" weight="duotone" />
                  </span>
                  <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-sky-700/70 dark:text-sky-300/70">
                    Incumbent
                    <MetricHelp label="Incumbent coverage">{INCUMBENT_HELP}</MetricHelp>
                  </span>
                </div>
                <div>
                  <p className="text-3xl font-bold tabular-nums text-slate-950 dark:text-slate-50">{totals.holderCoverage}%</p>
                  <p className="text-xs font-medium text-slate-700 dark:text-slate-200">Incumbent coverage</p>
                  <div className="mt-2 h-1.5 rounded-full bg-slate-200/70 dark:bg-slate-800/80">
                    <div className="h-full rounded-full bg-sky-500" style={{ width: `${totals.holderCoverage}%` }} />
                  </div>
                </div>
              </div>
            </Cell>

            {/* ── Position management ───────────────────────────── */}
            <Cell className="col-span-6 md:col-span-3 xl:col-span-2 xl:row-span-2">
              <CellHead
                icon={<TargetIcon className="h-4 w-4 text-rose-600 dark:text-rose-400" weight="duotone" />}
                tone="bg-rose-500/15"
                title="Posisi"
                desc="Coverage readiness terendah"
              />
              <div className="mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto scrollbar-slim px-4">
                {overview.topPositions.length > 0 ? (
                  overview.topPositions.map((position) => (
                    <Link
                      key={position.id}
                      href={`/positions/${position.id}`}
                      className="block rounded-xl border p-2.5 transition-colors hover:bg-muted/50"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-slate-950 dark:text-slate-50">{position.title}</p>
                          <p className="truncate text-[11px] text-muted-foreground">{position.department}</p>
                        </div>
                        <Badge variant="outline" className={cn('shrink-0', getCoverageTone(position.readinessCoverage))}>
                          {position.readinessCoverage}%
                        </Badge>
                      </div>
                      <div className="mt-2 flex items-center gap-3 text-[11px] text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <UsersThreeIcon className="h-3.5 w-3.5" weight="duotone" />
                          {position.candidates}
                        </span>
                        <span className="flex items-center gap-1">
                          <CheckCircleIcon className="h-3.5 w-3.5" weight="duotone" />
                          {position.readyNow} ready
                        </span>
                      </div>
                    </Link>
                  ))
                ) : (
                  <EmptyState>Belum ada posisi kritis untuk Company ini.</EmptyState>
                )}
              </div>
              <div className="shrink-0 border-t p-2">
                <Button asChild variant="ghost" size="sm" className="w-full">
                  <Link href="/positions">
                    Lihat Semua
                    <ArrowRight className="ml-1 h-3 w-3" />
                  </Link>
                </Button>
              </div>
            </Cell>

            {/* ── HAV heat matrix ──────────────────────────────── */}
            <Cell className="col-span-6 md:col-span-3 xl:col-span-2 xl:row-span-2">
              <CellHead
                icon={<GridNineIcon className="h-4 w-4 text-indigo-600 dark:text-indigo-400" weight="duotone" />}
                tone="bg-indigo-500/15"
                title="HAV 16 Grid"
                desc="HAV yang berlaku · manual › upload › rumus PA × BA"
              />
              <div className="mt-3 min-h-0 flex-1 overflow-y-auto scrollbar-slim px-4">
                <div className="grid grid-cols-4 gap-1.5">
                  {overview.havDistribution.map((item) => {
                    const ratio = item.employees / maxHav;
                    const quadrant = HAV_QUADRANTS.find((q) => q.number === item.quadrant);
                    // Cell colour is the quadrant's 5-Box, not its population:
                    // the grid's whole point is that Q1 and Q16 are opposite
                    // outcomes, and a heat ramp painted the crowded corner red
                    // whichever corner it was. Population stays legible as the
                    // bar's width.
                    const box = talentBoxFromQuadrant(item.quadrant);
                    const meta = BOX_META[box ?? 'NONE'];
                    const empty = item.employees === 0;
                    return (
                      <div
                        key={item.quadrant}
                        title={[
                          quadrant
                            ? `#${item.quadrant} ${quadrant.name} · ${meta.label} — ${item.employees} kandidat`
                            : `Q${item.quadrant}`,
                          item.derived > 0 || item.manual > 0
                            ? [
                                item.manual > 0 ? `${item.manual} ditempatkan manual (Talent Mapping)` : null,
                                `${item.stored} dari upload HAV`,
                                item.derived > 0 ? `${item.derived} otomatis dari PA × kompetensi` : null,
                              ]
                                .filter(Boolean)
                                .join(' · ')
                            : null,
                        ]
                          .filter(Boolean)
                          .join('\n')}
                        className={cn(
                          'flex min-w-0 flex-col rounded-lg border p-2',
                          empty ? 'border-border bg-muted/30' : cn(meta.border, meta.cell),
                        )}
                      >
                        <div className="flex items-baseline justify-between gap-1">
                          <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400">#{item.quadrant}</span>
                          <span className="flex items-baseline gap-0.5">
                            {item.derived > 0 && (
                              <span
                                className="text-[9px] font-semibold leading-none text-muted-foreground"
                                aria-label="sebagian otomatis"
                              >
                                ~
                              </span>
                            )}
                            <span className="text-sm font-bold leading-none tabular-nums text-slate-900 dark:text-slate-100">
                              {item.employees}
                            </span>
                          </span>
                        </div>
                        <p className="mt-1 truncate text-[10px] font-medium leading-tight text-slate-600 dark:text-slate-300">
                          {quadrant?.name ?? `Q${item.quadrant}`}
                        </p>
                        <div className="mt-1.5 h-1 rounded-full bg-muted/60">
                          <div
                            className={cn('h-full rounded-full', empty ? 'bg-transparent' : meta.dot)}
                            style={{ width: `${ratio * 100}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 16 kuadran → 5-Box (kategori tiap kuadran) + asal angkanya. */}
              <div className="shrink-0 space-y-2 border-t px-4 py-3">
                {/* A "Talent Matrix →" link to /talent used to sit beside this
                    heading. The rollup itself stays: it is derived from HAV
                    quadrants by lib/hav-quadrant-derive.ts, not from
                    talent_data_staging, so it never depended on that feature —
                    only the link did. /talent is deleted from main; it lives on
                    branch `parked/talent-5box` (docs/talent-5box-parked.md). */}
                <p className="text-[11px] font-semibold text-slate-700 dark:text-slate-200">Konversi 5-Box</p>
                {havPlaced > 0 ? (
                  <>
                    <div className="flex h-1.5 overflow-hidden rounded-full bg-muted/60">
                      {overview.havBoxRollup
                        .filter((row) => row.employees > 0)
                        .map((row) => (
                          <div
                            key={row.box}
                            className={BOX_META[row.box].dot}
                            style={{ width: `${(row.employees / havPlaced) * 100}%` }}
                            title={`${BOX_META[row.box].label} — ${row.employees} kandidat (${row.percentage}%) · kuadran ${row.quadrants.join(', ')}`}
                          />
                        ))}
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-1">
                      {overview.havBoxRollup.map((row) => (
                        <span
                          key={row.box}
                          className="flex items-center gap-1 text-[10px] text-muted-foreground"
                          title={`${BOX_META[row.box].blurb} · kuadran ${row.quadrants.join(', ')}`}
                        >
                          <span className={cn('h-1.5 w-1.5 rounded-full', BOX_META[row.box].dot)} />
                          {BOX_META[row.box].label}
                          <span className="font-semibold tabular-nums text-slate-700 dark:text-slate-200">
                            {row.employees}
                          </span>
                        </span>
                      ))}
                    </div>
                  </>
                ) : (
                  <p className="text-[10px] text-muted-foreground">
                    Belum ada kandidat yang bisa dipetakan — PA atau kompetensi behavioral belum tersinkron.
                  </p>
                )}
              </div>
            </Cell>

            {/* ── Readiness bands ──────────────────────────────── */}
            <Cell className="col-span-6 md:col-span-3 xl:col-span-2 xl:row-span-2">
              <CellHead
                icon={<CircleWavyCheckIcon className="h-4 w-4 text-emerald-600 dark:text-emerald-400" weight="duotone" />}
                tone="bg-emerald-500/15"
                title="Readiness Bands"
                desc="Distribusi coverage successor"
                help={<MetricHelp label="Readiness Bands">{BANDS_HELP}</MetricHelp>}
              />
              <div className="mt-3 min-h-0 flex-1 space-y-2.5 overflow-y-auto scrollbar-slim px-4 pb-4">
                {overview.readinessBands.map((band) => {
                  const key = bandQueryKey[band.label];
                  return (
                    <Link
                      key={band.label}
                      href={key ? `/positions?band=${key}` : '/positions'}
                      aria-label={`${band.label} (${bandRangeLabel[band.label] ?? ''}): ${band.count} posisi, ${band.percentage} persen. Buka daftar posisinya.`}
                      className="group block rounded-xl border p-3 transition-colors hover:border-primary/40 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">{band.label}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {band.count} posisi · {bandRangeLabel[band.label] ?? ''}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <p className="text-lg font-semibold tabular-nums text-slate-950 dark:text-slate-50">{band.percentage}%</p>
                          <ArrowRight
                            aria-hidden
                            className="h-3.5 w-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                          />
                        </div>
                      </div>
                      <div className="mt-2 h-2 rounded-full bg-muted">
                        <div className={cn('h-full rounded-full', bandTone[band.label] ?? 'bg-slate-400')} style={{ width: `${band.percentage}%` }} />
                      </div>
                    </Link>
                  );
                })}
              </div>
            </Cell>

            {/* Program Snapshot and Department Concentration were removed on
                purpose: the snapshot restated governance (how many templates
                exist and how often each ran), and the department breakdown
                answered a headcount question rather than a succession one.
                Neither drove a decision from this page. The data behind them
                is still on DashboardOverviewType (`programs`,
                `departmentBreakdown`) if either is ever wanted back. */}
            {/* ── Audit trail ──────────────────────────────────── */}
            {/* Full width now that the two cells beside it are gone — a
                half-empty final row reads as something failed to load. */}
            <Cell className="col-span-6 xl:row-span-2">
              <CellHead
                icon={<PulseIcon className="h-4 w-4 text-emerald-600 dark:text-emerald-400" weight="duotone" />}
                tone="bg-emerald-500/15"
                title="Audit Trail"
                desc="Aktivitas terbaru yang tercatat"
              />
              <div className="mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto scrollbar-slim px-4 pb-4">
                {overview.recentAudit.length > 0 ? (
                  overview.recentAudit.map((entry) => (
                    <div key={entry.id} className="rounded-xl border p-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-slate-950 dark:text-slate-50">{entry.action}</p>
                          <p className="truncate text-[11px] text-muted-foreground">{entry.actor}</p>
                        </div>
                        <span className="shrink-0 text-[11px] text-muted-foreground">{formatActivityTime(entry.createdAt)}</span>
                      </div>
                      <p className="mt-1.5 line-clamp-2 text-xs leading-5 text-slate-600 dark:text-slate-300">{entry.summary}</p>
                    </div>
                  ))
                ) : (
                  <EmptyState>Belum ada audit log untuk Company ini.</EmptyState>
                )}
              </div>
            </Cell>
          </div>
        </div>
      </div>
    </>
  );
}
