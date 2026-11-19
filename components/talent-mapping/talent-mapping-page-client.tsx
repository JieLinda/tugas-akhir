'use client';

import { useIsDemoMode } from '@/components/app-mode-provider';
import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import {
  Calculator,
  CircleSlash,
  Clock,
  Eye,
  EyeOff,
  FileSpreadsheet,
  Hand,
  History,
  Layers,
  Loader2,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  Table2,
  TriangleAlert,
  Trophy,
  Users,
  X,
} from 'lucide-react';
import { toast } from 'sonner';

import { DashboardHeader } from '@/components/dashboard-header';
import { TalentPoolSectionNav } from '@/components/talent-pool-section-nav';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Combobox } from '@/components/ui/combobox';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { OPERATOR_LABELS } from '@/components/governance/governance-types';
import { FIELD_VALUE_OPTIONS } from '@/lib/candidate-field-values';
import { formatDateTime } from '@/lib/datetime';
import { BOX_META } from '@/lib/hav-box-meta';
import { QUADRANTS_BY_TALENT_BOX, TALENT_BOXES } from '@/lib/hav-quadrant-derive';
import { moveTalentMappingCandidateAction, refreshTalentMappingAction } from '@/lib/talent-mapping-actions';
import {
  isSyncAuditAction,
  type TalentMappingCandidate,
  type TalentMappingData,
  type TalentMappingGateInfo,
  type TalentMappingSource,
} from '@/lib/talent-mapping';
import { cn } from '@/lib/utils';
import { InfoHint } from '@/components/ui/info-hint';

import { CandidateDetailDialog } from './candidate-detail-dialog';
import { HavSixteenBox } from './hav-sixteen-box';
import { AuditTable, MappingTable } from './mapping-tables';
import { MoveDialog, type PendingMove } from './move-dialog';
import { quadrantBox, quadrantLabel, syncOriginLabel } from './shared';

/**
 * Shared with the Talent Pool page on purpose: this map is the continuation of
 * that list, in the same menu, over the same people — revealing one and finding
 * the other still hidden would read as a bug. Per tab; clears when it closes.
 */
const MASK_STORAGE_KEY = 'pulse:talent-pool:masked';

const ALL = 'all';

type SourceFilter = 'all' | TalentMappingSource | 'drifted' | 'in-pool' | 'out-of-pool' | 'sync-changed';
type SortKey = 'map' | 'name' | 'source';
type AuditFilter = 'all' | 'manual' | 'sync';

const SOURCE_FILTER_LABEL: Record<SourceFilter, string> = {
  all: 'Semua kandidat di peta',
  'in-pool': 'Lolos Talent Pool',
  'out-of-pool': 'Tidak lolos Talent Pool',
  upload: 'Sumber: upload HAV',
  formula: 'Sumber: rumus',
  manual: 'Sumber: manual',
  drifted: 'Manual — HAV otomatis berubah',
  'sync-changed': 'HAV otomatis pernah diubah sync',
  none: 'Belum terpetakan',
};

const AUDIT_FILTER_LABEL: Record<AuditFilter, string> = {
  all: 'Semua peristiwa',
  manual: 'Manual saja',
  sync: 'Sync saja',
};

/** "termasuk Clear, ST (Surat Teguran)" — the discipline rule as the page says it. */
function gateRuleText(rule: TalentMappingGateInfo['rules'][number]): string {
  const options = FIELD_VALUE_OPTIONS.disciplineStatus ?? [];
  const label = (v: string | number) => options.find((o) => o.value === String(v))?.label ?? String(v);
  const values = Array.isArray(rule.value)
    ? (rule.value as (string | number)[]).map(label).join(', ')
    : rule.value != null
      ? label(rule.value)
      : '';
  return `${OPERATOR_LABELS[rule.operator] ?? rule.operator} ${values}`.trim();
}

const SORT_LABEL: Record<SortKey, string> = {
  map: 'Urut: posisi di peta (TOP → BOTTOM)',
  name: 'Urut: nama',
  source: 'Urut: manual dulu',
};

function boxRank(c: TalentMappingCandidate): number {
  const box = quadrantBox(c.quadrant);
  return box ? TALENT_BOXES.indexOf(box) : TALENT_BOXES.length;
}

function compareRows(a: TalentMappingCandidate, b: TalentMappingCandidate, key: SortKey): number {
  const byName = a.name.localeCompare(b.name);
  if (key === 'name') return byName;
  if (key === 'source') {
    const order: Record<TalentMappingSource, number> = { manual: 0, upload: 1, formula: 2, none: 3 };
    return order[a.source] - order[b.source] || byName;
  }
  return boxRank(a) - boxRank(b) || (a.quadrant ?? 99) - (b.quadrant ?? 99) || byName;
}

function StatCard({
  icon,
  tone,
  label,
  value,
  hint,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  tone: string;
  label: string;
  value: number;
  hint: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <Card
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={(e) => {
        if (onClick && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onClick();
        }
      }}
      className={cn(
        'gap-2 py-4',
        onClick && 'cursor-pointer transition-colors hover:border-primary/50',
        active && 'border-primary ring-1 ring-primary/30',
      )}
    >
      <CardHeader className="px-4 pb-0">
        <CardTitle className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <span className={cn('flex h-6 w-6 items-center justify-center rounded-md', tone)}>{icon}</span>
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4">
        <p className="text-2xl font-bold leading-none tabular-nums">{value}</p>
        <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  );
}

export function TalentMappingPageClient({
  data: initialData,
  canManage,
  actor,
}: {
  data: TalentMappingData;
  /** candidates.manage — without it the map is read-only. */
  canManage: boolean;
  /** Who the trail will name for a move made from this page. */
  actor: { name: string | null; username: string | null };
}) {
  const demoSearch = useIsDemoMode();
  // Held in state: every move returns the recomputed map, and swapping it in is
  // what puts the updated map on screen without a reload.
  const [data, setData] = useState<TalentMappingData>(initialData);
  useEffect(() => setData(initialData), [initialData]);

  const [masked, setMasked] = useState(true);
  useEffect(() => {
    try {
      if (sessionStorage.getItem(MASK_STORAGE_KEY) === 'false') setMasked(false);
    } catch {
      // Storage blocked — stay masked, the safe default.
    }
  }, []);
  const toggleMasked = useCallback(() => {
    setMasked((prev) => {
      const next = !prev;
      try {
        sessionStorage.setItem(MASK_STORAGE_KEY, String(next));
      } catch {
        // Ignore — the toggle still works for this render.
      }
      return next;
    });
  }, []);

  const [query, setQuery] = useState('');
  const [division, setDivision] = useState(ALL);
  const [department, setDepartment] = useState(ALL);
  const [selectedQuadrant, setSelectedQuadrant] = useState<number | null>(null);
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [sortKey, setSortKey] = useState<SortKey>('map');
  const [tab, setTab] = useState<'table' | 'history'>('table');
  const [auditFilter, setAuditFilter] = useState<AuditFilter>('all');

  const [detailId, setDetailId] = useState<string | null>(null);
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null);
  /** Reopen the candidate dialog after a move that was started from it. */
  const [returnToDetail, setReturnToDetail] = useState(false);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [saving, startSaving] = useTransition();
  const [refreshing, startRefreshing] = useTransition();

  const byId = useMemo(() => new Map(data.candidates.map((c) => [c.id, c])), [data.candidates]);
  const mapIds = useMemo(() => new Set(data.candidates.map((c) => c.id)), [data.candidates]);

  const { divisionOptions, departmentOptions } = useMemo(() => {
    const divisions = new Set<string>();
    const departments = new Set<string>();
    for (const c of data.candidates) {
      if (c.division) divisions.add(c.division);
      if (c.department) departments.add(c.department);
    }
    const sorted = (s: Set<string>) => Array.from(s).sort((a, b) => a.localeCompare(b));
    return {
      divisionOptions: [
        { value: ALL, label: 'Semua divisi' },
        ...sorted(divisions).map((d) => ({ value: d, label: d })),
      ],
      departmentOptions: [
        { value: ALL, label: 'Semua departemen' },
        ...sorted(departments).map((d) => ({ value: d, label: d })),
      ],
    };
  }, [data.candidates]);

  // Search / division / department scope BOTH the grid and the table, so the
  // counts on the squares always describe the rows below them.
  const scoped = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.candidates.filter((c) => {
      if (division !== ALL && c.division !== division) return false;
      if (department !== ALL && c.department !== department) return false;
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        c.employeeId.toLowerCase().includes(q) ||
        c.currentPosition.toLowerCase().includes(q) ||
        c.department.toLowerCase().includes(q) ||
        c.division.toLowerCase().includes(q)
      );
    });
  }, [data.candidates, query, division, department]);

  const tableRows = useMemo(() => {
    const rows = scoped.filter((c) => {
      if (selectedQuadrant != null && c.quadrant !== selectedQuadrant) return false;
      if (sourceFilter === 'drifted') return c.baselineDrifted;
      if (sourceFilter === 'in-pool') return c.inTalentPool;
      if (sourceFilter === 'out-of-pool') return !c.inTalentPool;
      if (sourceFilter === 'sync-changed') return c.automaticChangedAt != null;
      if (sourceFilter !== 'all' && c.source !== sourceFilter) return false;
      return true;
    });
    return [...rows].sort((a, b) => compareRows(a, b, sortKey));
  }, [scoped, selectedQuadrant, sourceFilter, sortKey]);

  const scopeActive = query.trim() !== '' || division !== ALL || department !== ALL;
  const resetScope = () => {
    setQuery('');
    setDivision(ALL);
    setDepartment(ALL);
  };

  const showSource = (filter: SourceFilter) => {
    setSourceFilter((prev) => (prev === filter ? 'all' : filter));
    setTab('table');
  };

  const requestMove = useCallback(
    (candidateId: string, target: number | 'auto', fromDetail: boolean) => {
      if (!canManage || !byId.has(candidateId)) return;
      setReturnToDetail(fromDetail);
      setDetailId(null);
      setPendingMove({ candidateId, target });
    },
    [byId, canManage],
  );

  const closeMove = useCallback(() => {
    const id = pendingMove?.candidateId ?? null;
    setPendingMove(null);
    if (returnToDetail && id) setDetailId(id);
    setReturnToDetail(false);
  }, [pendingMove, returnToDetail]);

  const confirmMove = useCallback(
    (justification: string) => {
      const move = pendingMove;
      const candidate = move ? byId.get(move.candidateId) : null;
      if (!move || !candidate) return;
      startSaving(async () => {
        try {
          const res = await moveTalentMappingCandidateAction({
            candidateId: move.candidateId,
            target: move.target,
            justification,
            expectedQuadrant: candidate.quadrant,
          });
          if (res.data) setData(res.data);
          if (res.ok) {
            toast.success(res.message);
            setHistoryVersion((v) => v + 1);
            closeMove();
          } else {
            toast.error(res.message);
            // A refusal that carries a fresh map means the view was stale: the
            // move the dialog describes no longer starts from what it says, so
            // close it rather than let it be resubmitted as written.
            if (res.data) closeMove();
          }
        } catch (err) {
          toast.error(err instanceof Error ? err.message : 'Gagal menyimpan perpindahan.');
        }
      });
    },
    [byId, closeMove, pendingMove],
  );

  const refresh = () => {
    startRefreshing(async () => {
      try {
        setData(await refreshTalentMappingAction());
        toast.success('Peta dimuat ulang dari data terbaru.');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Gagal memuat ulang peta.');
      }
    });
  };

  const counts = data.counts;
  const gate = data.gate;
  const detailCandidate = detailId ? (byId.get(detailId) ?? null) : null;
  const moveCandidate = pendingMove ? (byId.get(pendingMove.candidateId) ?? null) : null;
  const auditRows = useMemo(
    () =>
      auditFilter === 'all'
        ? data.audit
        : data.audit.filter((e) => (auditFilter === 'sync') === isSyncAuditAction(e.action)),
    [data.audit, auditFilter],
  );
  const gateText = gate.rules.map(gateRuleText).join(' dan ');

  return (
    <>
      <DashboardHeader
        title="Talent Mapping"
        info={
          data.program
            ? `Peta 16-box HAV semua kandidat aktif yang lolos aturan Disiplin Talent Pool — tempat HAV dikonsolidasi dari upload HAV, rumus PA × Behavioral Assessment, dan penempatan manual. Antara penempatan manual dan sync, yang terjadi paling akhir yang berlaku. HAV yang tampil di sini dipakai aturan filter "${data.program.name}", program suksesi, dan scoring; setiap perubahan — manual maupun sync — tercatat beserta waktu, pelaku, dan alasannya.`
            : undefined
        }
        // A missing program is a finding about this business unit, not an
        // explanation of the page, so it stays printed under the title.
        description={data.program ? undefined : 'Program Talent Pool belum tersedia pada unit bisnis ini'}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={refresh} disabled={refreshing} className="gap-1.5">
              {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Muat ulang
            </Button>
            <Button variant={masked ? 'outline' : 'secondary'} size="sm" onClick={toggleMasked} className="gap-1.5">
              {masked ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
              {masked ? 'Tampilkan data' : 'Samarkan data'}
            </Button>
          </>
        }
      />
      <TalentPoolSectionNav />

      <div className="space-y-4 p-4">
        {!data.program && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
            Program dengan kode <code className="text-xs">talent</code> tidak ditemukan pada Company ini, sehingga
            tidak ada populasi untuk dipetakan.
          </div>
        )}
        {data.program && counts.population === 0 && (
          <div className="rounded-lg border border-muted-foreground/30 bg-muted/40 px-4 py-3 text-sm">
            Belum ada kandidat aktif yang lolos aturan Disiplin Talent Pool, jadi peta ini kosong. Tinjau aturan
            filternya di halaman{' '}
            <Link href="/talent-pool" className="font-semibold text-primary underline-offset-2 hover:underline">
              Talent Pool
            </Link>
            .
          </div>
        )}

        {/* How this page decides who is on it and which HAV applies — in front
            of the reader, not inside a collapsed section: both rules changed
            (2026-10) and neither is guessable from the grid. */}
        {data.program && (
          <div className="grid gap-3 rounded-xl border bg-card p-4 text-xs leading-relaxed text-muted-foreground lg:grid-cols-3">
            <div className="space-y-1">
              <p className="flex items-center gap-1.5 font-semibold text-foreground">
                <ShieldCheck className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                Siapa yang tampil
              </p>
              {gate.rules.length > 0 ? (
                <p>
                  Semua kandidat aktif yang lolos aturan <strong>Disiplin</strong> Talent Pool ({gateText}).
                  {gate.excluded > 0 && (
                    <>
                      {' '}
                      <strong className="tabular-nums text-foreground">{gate.excluded}</strong> dari {gate.evaluated}{' '}
                      kandidat tidak tampil karena status disiplinnya.
                    </>
                  )}
                </p>
              ) : (
                <p className="text-amber-700 dark:text-amber-300">
                  Talent Pool tidak punya aturan Disiplin yang aktif
                  {gate.disabledCount > 0 ? ' (dinonaktifkan)' : ''} — peta memuat seluruh {gate.evaluated} kandidat
                  aktif.
                </p>
              )}
              <p>
                Aturan Talent Pool lainnya — HAV, PA, Behavioral Assessment, MCU, masa kerja — <strong>tidak</strong>{' '}
                menyaring peta: HAV, PA, dan BA adalah input peta ini, dan aturan MCU hanya menandai.
                Status Lolos Talent Pool tetap ditampilkan per kandidat sebagai keterangan. Atur di halaman{' '}
                <Link href="/talent-pool" className="font-medium text-primary underline-offset-2 hover:underline">
                  Talent Pool
                </Link>
                .
              </p>
            </div>
            <div className="space-y-1">
              <p className="flex items-center gap-1.5 font-semibold text-foreground">
                <Layers className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                HAV yang berlaku
              </p>
              <p>
                <strong>Penempatan manual</strong> (halaman ini) › <strong>Upload HAV</strong> (Excel, sumber utama) ›{' '}
                <strong>Rumus PA × BA</strong> bila tanpa upload › belum terpetakan. Satu nilai ini dipakai aturan filter,
                scoring, profil kandidat, dan Beranda.
              </p>
            </div>
            <div className="space-y-1">
              <p className="flex items-center gap-1.5 font-semibold text-foreground">
                <Clock className="h-4 w-4 text-slate-600 dark:text-slate-300" />
                Urutan waktu: yang terbaru menang
              </p>
              <p>
                Penempatan manual berlaku sampai ada <strong>sync setelahnya</strong> yang mengubah HAV otomatis kandidat
                itu — upload HAV (kapan pun, tidak menunggu cron Senin), HAV.xlsx folder bersama, atau Sync Kandidat yang
                membawa PA/BA baru dari MSSQL. Sync yang tidak mengubah HAV-nya tidak menyentuh penempatan manual.
              </p>
              <p>
                {data.lastSync ? (
                  <>
                    Sync terakhir yang mengubah HAV otomatis:{' '}
                    <strong className="tabular-nums text-foreground">{formatDateTime(data.lastSync.at)}</strong> ·{' '}
                    {syncOriginLabel(data.lastSync.origin)}.
                  </>
                ) : (
                  'Belum ada sync yang mengubah HAV otomatis sejak pencatatan waktu dimulai.'
                )}
              </p>
            </div>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
          <StatCard
            icon={<Users className="h-3.5 w-3.5 text-slate-600 dark:text-slate-300" />}
            tone="bg-slate-500/15"
            label="Kandidat di peta"
            value={counts.population}
            hint={
              gate.rules.length > 0
                ? `Lolos aturan Disiplin Talent Pool${gate.excluded > 0 ? ` · ${gate.excluded} tidak tampil karena disiplin` : ''}`
                : 'Seluruh kandidat aktif — tidak ada aturan Disiplin yang aktif'
            }
            active={sourceFilter === 'all' && selectedQuadrant == null}
            onClick={() => {
              setSourceFilter('all');
              setSelectedQuadrant(null);
              setTab('table');
            }}
          />
          <StatCard
            icon={<Trophy className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />}
            tone="bg-emerald-500/15"
            label="Lolos Talent Pool"
            value={counts.inTalentPool}
            hint="Keterangan, bukan saringan: lolos seluruh aturan Talent Pool dengan HAV yang berlaku"
            active={sourceFilter === 'in-pool'}
            onClick={() => showSource('in-pool')}
          />
          <StatCard
            icon={<FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />}
            tone="bg-emerald-500/15"
            label="Dari upload HAV"
            value={counts.upload}
            hint="Sumber utama — kuadran dari Excel HAV"
            active={sourceFilter === 'upload'}
            onClick={() => showSource('upload')}
          />
          <StatCard
            icon={<Calculator className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400" />}
            tone="bg-sky-500/15"
            label="Dari rumus"
            value={counts.formula}
            hint="Tanpa upload HAV — dihitung dari PA × Behavioral Assessment"
            active={sourceFilter === 'formula'}
            onClick={() => showSource('formula')}
          />
          <StatCard
            icon={<Hand className="h-3.5 w-3.5 text-violet-600 dark:text-violet-400" />}
            tone="bg-violet-500/15"
            label="Penempatan manual"
            value={counts.manual}
            hint={
              counts.drifted > 0
                ? `${counts.drifted} di antaranya HAV otomatisnya berubah sejak ditempatkan`
                : 'Berlaku sampai sync berikutnya mengubah HAV otomatisnya'
            }
            active={sourceFilter === 'manual'}
            onClick={() => showSource('manual')}
          />
          <StatCard
            icon={<CircleSlash className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />}
            tone="bg-amber-500/15"
            label="Belum terpetakan"
            value={counts.unplaced}
            hint="Tanpa upload HAV, dan PA atau BA belum tersedia — bukan hasil penilaian"
            active={sourceFilter === 'none'}
            onClick={() => showSource('none')}
          />
        </div>

        {/* Toolbar — scopes the grid and the table together. */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-64 flex-1">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={demoSearch ? 'Cari nama, posisi, departemen…' : 'Cari nama, NPK, posisi, departemen…'}
              className="pl-8"
            />
          </div>
          <div className="w-52">
            <Combobox
              options={divisionOptions}
              value={division}
              onValueChange={setDivision}
              placeholder="Semua divisi"
              searchPlaceholder="Cari divisi…"
              emptyText="Divisi tidak ditemukan."
              triggerClassName="h-9 text-sm"
              className="w-md"
            />
          </div>
          <div className="w-52">
            <Combobox
              options={departmentOptions}
              value={department}
              onValueChange={setDepartment}
              placeholder="Semua departemen"
              searchPlaceholder="Cari departemen…"
              emptyText="Departemen tidak ditemukan."
              triggerClassName="h-9 text-sm"
              className="w-md"
            />
          </div>
          {scopeActive && (
            <Button variant="ghost" size="sm" onClick={resetScope} className="gap-1.5">
              <RotateCcw className="h-3.5 w-3.5" />
              Reset
            </Button>
          )}
        </div>

        {scopeActive && (
          <p className="text-xs text-muted-foreground">
            Peta dan tabel menampilkan <strong className="tabular-nums text-foreground">{scoped.length}</strong> dari{' '}
            <strong className="tabular-nums text-foreground">{counts.population}</strong> kandidat (disaring).
          </p>
        )}

        {masked && (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3">
            <EyeOff className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-amber-700 dark:text-amber-300">Data kandidat disamarkan</p>
              <p className="text-xs text-muted-foreground">
                Peta hanya menampilkan jumlah per kuadran. Siapa berada di kuadran mana, nilai PA, Behavioral
                Assessment, dan alasan perpindahan disembunyikan
                {canManage ? ' — tampilkan data untuk melihat dan memindahkan kandidat.' : '.'}
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={toggleMasked}
              className="shrink-0 gap-2 border-amber-500/40 bg-background font-semibold text-amber-700 hover:bg-amber-500/10 dark:text-amber-300"
            >
              <Eye className="h-4 w-4" />
              Tampilkan data
            </Button>
          </div>
        )}

        {!masked && counts.drifted > 0 && (
          <button
            type="button"
            onClick={() => showSource('drifted')}
            className="flex w-full items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-left text-sm transition-colors hover:bg-amber-500/10"
          >
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <span>
              <strong>{counts.drifted} penempatan manual</strong> dibuat terhadap HAV otomatis (upload atau rumus) yang
              berbeda dari hari ini, tanpa sync yang menggantikannya — misalnya PA/BA diubah manual di halaman Kandidat,
              atau penempatan dibuat sebelum pencatatan waktu. Penempatannya tetap berlaku; klik untuk meninjau apakah
              alasannya masih relevan.
            </span>
          </button>
        )}

        <HavSixteenBox
          candidates={scoped}
          masked={masked}
          canManage={canManage}
          referenceYear={data.paReferenceYear}
          selectedQuadrant={selectedQuadrant}
          onSelectQuadrant={(q) => {
            setSelectedQuadrant(q);
            if (q != null) setTab('table');
          }}
          onOpenCandidate={setDetailId}
          onDropCandidate={(candidateId, quadrant) => requestMove(candidateId, quadrant, false)}
        />

        <details className="group rounded-xl border bg-card px-4 py-3 text-sm">
          <summary className="cursor-pointer select-none font-semibold text-foreground">
            Sumber HAV, rumus pemetaan & konversi 5-Box
          </summary>
          <div className="mt-3 space-y-1 rounded-lg bg-muted/40 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
            <p className="font-semibold text-foreground">HAV yang berlaku — satu nilai untuk filter, scoring, profil, Beranda</p>
            <p>
              <strong>1. Penempatan manual</strong> di halaman ini → <strong>2. Upload HAV</strong> (Excel, sumber
              utama) → <strong>3. Rumus PA × BA</strong> bila tidak ada upload → belum terpetakan.
            </p>
            <p>
              <strong>Yang terbaru menang.</strong> Setiap sync yang <strong>mengubah</strong> HAV otomatis seorang
              kandidat dicatat waktunya — upload HAV (kapan pun diunggah), HAV.xlsx folder bersama, atau Sync Kandidat yang
              membawa PA/BA baru dari MSSQL sehingga hasil rumusnya bergeser. Penempatan manual yang lebih lama dari
              perubahan itu digantikan (tercatat di riwayat sebagai &ldquo;manual digantikan&hellip;&rdquo;); penempatan
              yang dibuat sesudahnya tetap berlaku. Kandidat yang HAV otomatisnya tidak berubah tetap memakai kuadran
              sebelumnya — manual, upload lama, atau rumus. Data PA/BA yang hilang dari sumber tidak dianggap perubahan.
            </p>
            <p>
              Peta memuat semua kandidat yang lolos aturan <strong>Disiplin</strong> Talent Pool. Aturan Talent Pool
              lainnya (termasuk HAV) dinilai atas kuadran yang berlaku hanya sebagai keterangan Lolos / Tidak lolos,
              sehingga memindahkan kandidat bisa mengubah statusnya tanpa ia hilang dari peta.
            </p>
          </div>
          <div className="mt-3 grid gap-4 text-xs leading-relaxed text-muted-foreground lg:grid-cols-3">
            <div className="space-y-1">
              <p className="font-semibold text-foreground">Sumbu Y — Behavioral Assessment (atas → bawah)</p>
              <p><strong>High</strong>: STRENGTH</p>
              <p><strong>Mid High</strong>: VERY HIGH, PENGEMBANGAN JANGKA PENDEK</p>
              <p>
                <strong>Mid Low</strong>: NEED TARGETED DEVELOPMENT, HIGH, READY, POTENSI, MIDDLE HIGH, READY WITH
                DEVELOPMENT
              </p>
              <p>
                <strong>Low</strong>: LOW, MIDDLE LOW, FOCUS ON OPTIMIZATION — serta VERY LOW, NOT READY, BELUM ADA
                POTENSI
              </p>
            </div>
            <div className="space-y-1">
              <p className="font-semibold text-foreground">Sumbu X — Performance Appraisal (kanan → kiri)</p>
              <p><strong>High</strong>: 2 periode terakhir AA, AB, BA, BB</p>
              <p><strong>Mid High</strong>: 2 periode terakhir CA, CB, AC, BC</p>
              <p><strong>Mid Low</strong>: 2 periode terakhir CC</p>
              <p>
                <strong>Low</strong>: pernah ada D, E, atau C- dalam 2 tahun terakhir — mengalahkan dua periode
                terbaru
              </p>
              <p>
                Periode kosong dilewati; satu-satunya periode bernilai dibaca dua kali (C → CC). Data PA kosong atau
                kategori BA tidak dikenali → belum terpetakan, bukan kuadran tebakan.
              </p>
            </div>
            <div className="space-y-1">
              <p className="font-semibold text-foreground">16 kuadran → 5-Box</p>
              {TALENT_BOXES.map((box) => (
                <p key={box} className="flex items-center gap-1.5">
                  <span className={cn('h-2 w-2 rounded-full', BOX_META[box].dot)} />
                  <strong>{box}</strong>: {QUADRANTS_BY_TALENT_BOX[box].map((q) => `Q${q}`).join(', ')}
                </p>
              ))}
              <p className="pt-1">
                Menyeret kandidat kembali ke kuadran HAV otomatisnya (upload, atau rumus bila tanpa upload) menghapus
                penempatan manualnya.
              </p>
            </div>
          </div>
        </details>

        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <div className="flex flex-wrap items-center gap-2">
            <TabsList className="h-10">
              <TabsTrigger value="table" className="gap-1.5">
                <Table2 className="h-4 w-4" />
                Tabel Pemetaan
                <Badge variant="secondary" className="tabular-nums">
                  {tableRows.length}
                </Badge>
              </TabsTrigger>
              <TabsTrigger value="history" className="gap-1.5">
                <History className="h-4 w-4" />
                Riwayat HAV
                <Badge variant="secondary" className="tabular-nums">
                  {data.auditTotal}
                </Badge>
              </TabsTrigger>
            </TabsList>

            {tab === 'history' && (
              <Select value={auditFilter} onValueChange={(v) => setAuditFilter(v as AuditFilter)}>
                <SelectTrigger size="sm" className="h-9 w-44 text-sm" aria-label="Saring peristiwa">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(AUDIT_FILTER_LABEL) as AuditFilter[]).map((k) => (
                    <SelectItem key={k} value={k}>
                      {AUDIT_FILTER_LABEL[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {tab === 'table' && (
              <>
                {selectedQuadrant != null && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setSelectedQuadrant(null)}
                    className="gap-1.5"
                    title="Hapus saringan kuadran"
                  >
                    {masked ? `Q${selectedQuadrant}` : quadrantLabel(selectedQuadrant)}
                    <X className="h-3.5 w-3.5" />
                  </Button>
                )}
                <Select value={sourceFilter} onValueChange={(v) => setSourceFilter(v as SourceFilter)}>
                  <SelectTrigger size="sm" className="h-9 w-52 text-sm" aria-label="Saring sumber">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(SOURCE_FILTER_LABEL) as SourceFilter[]).map((k) => (
                      <SelectItem key={k} value={k}>
                        {SOURCE_FILTER_LABEL[k]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={sortKey} onValueChange={(v) => setSortKey(v as SortKey)}>
                  <SelectTrigger size="sm" className="h-9 w-68 text-sm" aria-label="Urutkan">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => (
                      <SelectItem key={k} value={k}>
                        {SORT_LABEL[k]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </>
            )}
          </div>

          <TabsContent value="table" className="mt-3">
            <Card className="overflow-hidden py-0">
              <MappingTable
                rows={tableRows}
                masked={masked}
                referenceYear={data.paReferenceYear}
                onOpenCandidate={setDetailId}
              />
            </Card>
          </TabsContent>

          <TabsContent value="history" className="mt-3 space-y-2">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
              Riwayat HAV, terbaru di atas
              <InfoHint size="xs" title="Riwayat HAV">
                Urutan peristiwa HAV — perpindahan manual dan sync yang mengubah HAV otomatis — terbaru di atas. Urutan
                inilah yang menentukan HAV yang berlaku: yang terakhir menang.
              </InfoHint>
            </p>
            {counts.offMapPlacements > 0 && (
              <p className="text-xs text-muted-foreground">
                {counts.offMapPlacements} penempatan manual milik kandidat yang saat ini tidak ada di peta (tidak lolos
                aturan Disiplin). Penempatannya tetap berlaku sebagai HAV mereka di tempat lain — profil, scoring — dan
                tampil lagi di peta bila kandidat lolos kembali.
              </p>
            )}
            <Card className="overflow-hidden py-0">
              <AuditTable
                entries={auditRows}
                total={auditFilter === 'all' ? data.auditTotal : auditRows.length}
                masked={masked}
                mapIds={mapIds}
                onOpenCandidate={setDetailId}
              />
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      <CandidateDetailDialog
        candidate={detailCandidate}
        referenceYear={data.paReferenceYear}
        masked={masked}
        canManage={canManage}
        historyVersion={historyVersion}
        onOpenChange={(open) => {
          if (!open) setDetailId(null);
        }}
        onRequestMove={(target) => {
          if (detailCandidate) requestMove(detailCandidate.id, target, true);
        }}
      />

      <MoveDialog
        move={pendingMove}
        candidate={moveCandidate}
        actor={actor}
        referenceYear={data.paReferenceYear}
        saving={saving}
        onCancel={closeMove}
        onConfirm={confirmMove}
      />
    </>
  );
}
