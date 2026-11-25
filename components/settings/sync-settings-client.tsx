'use client';

import { useState, useTransition, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  Check, Edit2, Plus, Trash2, RefreshCw, CheckCircle2, XCircle,
  Users, Building2, Layers, BarChart2, ShieldAlert, GraduationCap,
  UserCheck, Loader2, Clock, Wifi, WifiOff, Play, FileText, Filter,
  BookOpen, Database, Globe, Sparkles, Brain, Grid3x3, Stethoscope, Upload, UploadCloud, RotateCcw,
  History, AlertTriangle, User as UserIcon, Terminal, CalendarClock, MousePointerClick, Download,
  Briefcase, Network, Award, FileSpreadsheet, Cake, Settings2, Link2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { InfoHint } from '@/components/ui/info-hint';
import {
  createCompanyTenantMappingAction,
  updateCompanyTenantMappingAction,
  deleteCompanyTenantMappingAction,
  toggleCompanyTenantMappingAction,
  listSyncRunsAction,
  type TenantStat,
  type SyncRunRow,
} from '@/lib/sync-actions';
import { CollapsibleCard, CARD_ACCENT, ACCENT_HEADER_BAND, type CardAccent } from '@/components/settings/collapsible-card';
import { formatDateTime } from '@/lib/datetime';

// ── Types ─────────────────────────────────────────────────────

type Mapping = {
  id: number;
  companyId: string;
  tenantId: string;
  label: string | null;
  isActive: boolean;
  tenantName: string;
  tenantSlug: string;
  createdAt: string;
  updatedAt: string;
};

type TenantOption = { id: string; name: string; slug: string };

type StatModule = {
  count: number;
  lastSync: string | null;
  breakdown: TenantStat[];
};

type SyncStats = {
  employees:    StatModule;
  divisions:    StatModule;
  departments:  StatModule;
  positions:    StatModule;
  employeePosition: StatModule;
  technicalCompetency: StatModule;
  performance:  StatModule;
  disciplinary: StatModule;
  education:    StatModule;
  personal:     StatModule;
  candidates:   StatModule;
  jobProfiles:  StatModule;
  kamusKompetensi: StatModule;
};

type Props = {
  mappings: Mapping[];
  tenants: TenantOption[];
  stats: SyncStats;
  /** Newest run per module key, from sync_runs. Empty when migration 0044 is unapplied. */
  latestRuns: Record<string, SyncRunRow>;
  initialRunHistory: { runs: SyncRunRow[]; total: number; page: number; pageSize: number };
  /** Section 6: embedding + kamus name mapping (rendered collapsed by the page). */
  knowledge?: React.ReactNode;
  /** Section 7, first: source DB connections. */
  connections?: React.ReactNode;
  /** Section 7, last: destructive maintenance (candidate pool). */
  maintenance?: React.ReactNode;
};

type DialogState =
  | { mode: 'closed' }
  | { mode: 'create' }
  | { mode: 'edit'; mapping: Mapping }
  | { mode: 'delete'; mapping: Mapping };

// ── Data summary ─────────────────────────────────────────────
// One row per synced module instead of thirteen cards: the question on every
// visit is "is the data fresh and does every row belong to a Company?", and a
// table answers that in one glance where a grid of big numbers did not.

/** Job keys as recorded in sync_runs → the label people know the module by. */
const MODULE_LABELS: Record<string, string> = {
  all: 'Sinkronisasi penuh',
  employees: 'Karyawan',
  org: 'Struktur organisasi',
  positions: 'Position mapping',
  'positions/all': 'Position mapping',
  performance: 'Penilaian kinerja',
  'grade-levels': 'Grade level',
  'behavior-competencies': 'Kompetensi perilaku',
  disciplinary: 'Kedisiplinan',
  education: 'Pendidikan',
  personal: 'Data pribadi',
  candidates: 'Kandidat',
  'job-profiles': 'Job profile',
  'kamus-kompetensi': 'Kamus kompetensi',
  hav: 'HAV',
  mcu: 'MCU',
};

const SUMMARY_ROWS: { key: keyof SyncStats; label: string; icon: React.ElementType; hint: string }[] = [
  { key: 'employees', label: 'Karyawan', icon: Users, hint: 'Master karyawan (DB MPMDS)' },
  { key: 'divisions', label: 'Divisi', icon: Building2, hint: 'Diturunkan dari data karyawan' },
  { key: 'departments', label: 'Departemen', icon: Layers, hint: 'Diturunkan dari data karyawan' },
  { key: 'positions', label: 'Master Posisi', icon: FileText, hint: 'Master jabatan & hierarki' },
  { key: 'employeePosition', label: 'Penempatan Karyawan', icon: Users, hint: 'Karyawan ↔ posisi aktif' },
  { key: 'technicalCompetency', label: 'Kompetensi Teknis', icon: BarChart2, hint: 'Tuntutan jabatan vs capaian karyawan' },
  { key: 'performance', label: 'Penilaian Kinerja', icon: BarChart2, hint: 'Appraisal per tahun (DB MPMHRGA)' },
  { key: 'disciplinary', label: 'Kedisiplinan', icon: ShieldAlert, hint: 'API Orange' },
  { key: 'education', label: 'Pendidikan', icon: GraduationCap, hint: 'API Orange' },
  { key: 'personal', label: 'Data Pribadi', icon: Cake, hint: 'Tanggal lahir (API Orange) — sumber usia' },
  { key: 'candidates', label: 'Kandidat', icon: UserCheck, hint: 'Turunan; hanya kandidat aktif dihitung' },
  { key: 'jobProfiles', label: 'Job Profile', icon: FileText, hint: 'PDF yang diunggah — lintas Company' },
  { key: 'kamusKompetensi', label: 'Kamus Kompetensi', icon: BookOpen, hint: 'PDF yang diunggah — lintas Company' },
];

function DataSummaryCard({ stats }: { stats: SyncStats }) {
  const tone = CARD_ACCENT.neutral;
  return (
    <Card>
      <CardHeader className={cn(ACCENT_HEADER_BAND, tone.header)}>
        <CardTitle className="flex items-center gap-2">
          <Database className={cn('h-4 w-4', tone.icon)} />
          Ringkasan Data Tersinkron
          <InfoHint title="Ringkasan Data Tersinkron">
            Jumlah baris per modul di database Pulse untuk semua Company (kecuali Kandidat: hanya yang aktif) dan
            kapan terakhir berubah. Chip menunjukkan rincian per Company yang sudah dipetakan.
          </InfoHint>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Modul</TableHead>
              <TableHead className="w-28 text-right">Baris</TableHead>
              <TableHead>Per Company</TableHead>
              <TableHead className="w-40">Terakhir berubah</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {SUMMARY_ROWS.map((row) => {
              const m = stats[row.key];
              const Icon = row.icon;
              const stale = m.lastSync ? Date.now() - new Date(m.lastSync).getTime() > 14 * 86_400_000 : false;
              // Rows whose Company ID has no mapping are deliberately not
              // surfaced here (operator's call) — the mapping card below is
              // where that is fixed.
              const mapped = (m.breakdown ?? []).filter((b) => b.tenantId !== '__unmapped__');
              return (
                <TableRow key={row.key}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium leading-tight">{row.label}</p>
                        <p className="truncate text-[11px] text-muted-foreground">{row.hint}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className={cn('text-right text-sm font-semibold tabular-nums', m.count === 0 && 'text-muted-foreground')}>
                    {m.count.toLocaleString('id-ID')}
                  </TableCell>
                  <TableCell>
                    {mapped.length > 0 ? (
                      <ul className="flex flex-wrap gap-1">
                        {mapped.map((b) => (
                          <li key={b.tenantId}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Badge variant="secondary" className="px-1.5 py-0 text-[10px] font-normal tabular-nums">
                                  <span className="font-medium">{b.tenantSlug}</span>
                                  <span className="ml-1 text-muted-foreground">{b.count.toLocaleString('id-ID')}</span>
                                </Badge>
                              </TooltipTrigger>
                              <TooltipContent side="bottom">{b.tenantName}: {b.count.toLocaleString('id-ID')} baris</TooltipContent>
                            </Tooltip>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className="text-[11px] text-muted-foreground">lintas Company</span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {m.lastSync ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className={cn('inline-flex items-center gap-1', stale && 'text-amber-700 dark:text-amber-300')}>
                            {stale && <AlertTriangle className="h-3 w-3" />}
                            {relativeAge(m.lastSync)}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">
                          {formatDateTime(m.lastSync)}
                          {stale && ' — lebih dari 2 minggu; sinkronisasi terjadwal mungkin gagal'}
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      <span className="text-muted-foreground/60">belum pernah</span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ── Source-file upload ────────────────────────────────────────

/**
 * Route key ("positions/all") -> the key sync_runs is recorded under
 * ("positions:all").
 *
 * The audit middleware derives job_key from the request path with
 * `path.replace(/\//g, ":")`, so any multi-segment route is stored with colons.
 * Looking the run up by the raw route key therefore missed every time and the
 * UI claimed "Belum pernah dijalankan" for Position Mapping — the only op whose
 * key contains a slash. Mirroring the middleware's transform here keeps the
 * existing history rows valid instead of rewriting them.
 */
function jobKeyOf(routeKey: string): string {
  return routeKey.replace(/\//g, ':');
}

/** Keep only files whose extension matches the accept list. */
function filterAccepted(files: File[], accept: string): File[] {
  const exts = accept
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.startsWith('.'));
  if (exts.length === 0) return files;
  return files.filter((f) => exts.some((e) => f.name.toLowerCase().endsWith(e)));
}

/**
 * Post each File as a RAW body (not multipart) with the name in ?filename= —
 * that needs no extra dependency on the service and passes through the Next.js
 * proxy untouched.
 *
 * Bounded parallelism: sequential is far too slow for a few hundred PDFs,
 * unbounded would open a socket per file and stall the service.
 */
async function uploadFiles(
  kind: string,
  files: File[],
  onProgress: (done: number, total: number) => void,
  /** Job Profile only: tenant(s) this upload belongs to, chosen at upload time. */
  tenantIds?: string[],
): Promise<{ failures: string[] }> {
  const failures: string[] = [];
  let done = 0;
  let cursor = 0;
  const CONCURRENCY = 4;

  const uploadOne = async (file: File): Promise<string | null> => {
    // HAV/MCU/Kamus are tenant-agnostic — nothing to scope an upload to. Job
    // Profile takes an optional tenant list so ownership is set the moment the
    // document exists, applied once the sync ingests it.
    const qs = new URLSearchParams({ filename: file.name });
    if (tenantIds && tenantIds.length > 0) qs.set('tenants', tenantIds.join(','));
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/api/sync/upload/${kind}?${qs}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/octet-stream' },
          body: file,
        },
      );
      const data = (await res.json().catch(() => null)) as
        | { success?: boolean; message?: string }
        | null;
      if (!res.ok || !data?.success) return `${file.name}: ${data?.message ?? `HTTP ${res.status}`}`;
      return null;
    } catch (e) {
      return `${file.name}: ${(e as Error).message}`;
    }
  };

  const workers = Array.from({ length: Math.min(CONCURRENCY, files.length) }, async () => {
    while (cursor < files.length) {
      const file = files[cursor++]!;
      const failure = await uploadOne(file);
      if (failure) failures.push(failure);
      onProgress(++done, files.length);
    }
  });
  await Promise.all(workers);
  return { failures };
}

// ── File sources: upload-driven ingestion ─────────────────────

/**
 * A file-based data source. There is deliberately NO "sync from the shared
 * folder" control any more: uploading IS the trigger. The file is posted, the
 * matching sync runs immediately, and the service deletes the uploaded copy
 * once its contents are in Postgres — so the upload store stays a hand-off
 * buffer instead of a second, silently-diverging copy of the data.
 */
type FileSource = {
  /** Upload endpoint segment. */ kind: string;
  /** Sync route segment. */ syncKey: string;
  label: string;
  icon: React.ElementType;
  accept: string;
  multiple: boolean;
  /** Long-running (LLM extraction) — cannot be awaited in the request. */
  slow: boolean;
  desc: string;
  /** What one upload replaces, when it replaces rather than adds. */
  replaces?: string;
  /**
   * Downloadable starter file, for the sources with a strict layout: an Excel
   * workbook, or an editable Word document for the PDF sources (filled in, then
   * saved as PDF). The link label follows the file type.
   */
  template?: { href: string; filename: string };
  /**
   * Optional tenant assignment (only meaningful for Job Profile PDFs). Chosen
   * at upload time and applied directly to job_profile_tenants once the
   * document is ingested; no tenant picked = visible to every tenant.
   */
  tenantScoped?: boolean;
};

const FILE_SOURCES: FileSource[] = [
  {
    kind: 'job-profiles', syncKey: 'job-profiles', label: 'Job Profile', icon: FileText,
    accept: '.pdf', multiple: true, slow: true,
    desc: 'Profil jabatan dari PDF, diekstrak dengan LLM. Beri nama berkas: KODE_POSISI JD-XXX-001 Nama Jabatan.pdf — kode posisi di depan dipakai untuk mencocokkan dokumen ke posisinya.',
    tenantScoped: true,
    // Editable Word file: fill it in, then Save As → PDF (scripts/gen-pdf-templates.ts).
    template: { href: '/templates/template-job-profile.docx', filename: 'template-job-profile.docx' },
  },
  {
    kind: 'kamus', syncKey: 'kamus-kompetensi', label: 'Kamus Kompetensi', icon: BookOpen,
    accept: '.pdf', multiple: true, slow: false,
    desc: 'Kamus kompetensi teknis — kode, definisi, dan 4 level proficiency. Satu kompetensi per halaman.',
    // The parser reads the PDF by text position, so the Word template keeps the
    // exact layout it needs (scripts/gen-pdf-templates.ts says which parts).
    template: { href: '/templates/template-kamus-kompetensi.docx', filename: 'template-kamus-kompetensi.docx' },
  },
  {
    kind: 'hav', syncKey: 'hav', label: 'HAV Quadrant', icon: Grid3x3,
    accept: '.xlsx,.xls,.xlsm', multiple: false, slow: false,
    desc: 'Kuadran HAV per employee ID. Berlaku untuk semua Company.',
    replaces: 'Memperbarui per NPK — karyawan yang tidak ada di file tetap memakai kuadran sebelumnya.',
    template: {
      href: '/templates/template-hav-quadrant.xlsx',
      filename: 'template-hav-quadrant.xlsx',
    },
  },
  {
    kind: 'mcu', syncKey: 'mcu', label: 'Status MCU', icon: Stethoscope,
    accept: '.xlsx,.xls,.xlsm', multiple: false, slow: false,
    desc: 'Status medical check-up per employee ID. Berlaku untuk semua Company.',
    replaces: 'Memperbarui per NPK — karyawan yang tidak ada di file tetap memakai status sebelumnya.',
    template: {
      href: '/templates/template-mcu.xlsx',
      filename: 'template-mcu.xlsx',
    },
  },
];

/**
 * Sources that normally come from MSSQL or the HR API, uploadable as Excel.
 *
 * Different in kind from FILE_SOURCES above, which is why they get their own
 * card: for those four a file IS the only source, whereas here the upload
 * OVERRIDES a live pull for one run. The service consumes the workbook and
 * deletes it, so the next scheduled sync goes back to the real source — a
 * correction, not a permanent switch.
 *
 * `replaces` states the row key rather than a vague "updates existing data",
 * because whether a row updates or duplicates hinges entirely on that key.
 *
 * Templates come from the sync service (GET /api/sync/upload/template/<kind>),
 * generated from the same spec the parser reads, so a column can never be
 * renamed in one without the other following.
 */
const EXCEL_DATA_SOURCES: FileSource[] = [
  {
    kind: 'employees', syncKey: 'employees', label: 'Data Karyawan', icon: Users,
    accept: '.xlsx,.xls,.xlsm', multiple: false, slow: false,
    desc: 'Master karyawan: NPK, nama, grade, divisi, departemen, tanggal masuk.',
    replaces: 'Key: EMPLOYEE_ID. Karyawan yang tidak ada di file tetap utuh.',
    template: { href: '/api/sync/upload/template/employees', filename: 'template-employees.xlsx' },
  },
  {
    kind: 'positions-master', syncKey: 'positions/master', label: 'Master Jabatan', icon: Briefcase,
    accept: '.xlsx,.xls,.xlsm', multiple: false, slow: false,
    desc: 'Master posisi: kode, judul internal/eksternal, grade, masa berlaku.',
    replaces: 'Key: COMPANY_ID + POSITION_ID + VALID_FROM.',
    template: { href: '/api/sync/upload/template/positions-master', filename: 'template-positions-master.xlsx' },
  },
  {
    kind: 'positions-hierarchy', syncKey: 'positions/hierarchy', label: 'Hierarki Jabatan', icon: Network,
    accept: '.xlsx,.xls,.xlsm', multiple: false, slow: false,
    desc: 'Relasi atasan - bawahan antar posisi (parent position).',
    replaces: 'Key: COMPANY_ID + POSITION_ID + VALID_FROM.',
    template: { href: '/api/sync/upload/template/positions-hierarchy', filename: 'template-positions-hierarchy.xlsx' },
  },
  {
    kind: 'positions-employees', syncKey: 'positions/employees', label: 'Penempatan Karyawan', icon: UserCheck,
    accept: '.xlsx,.xls,.xlsm', multiple: false, slow: false,
    desc: 'Pemetaan karyawan ke posisi, termasuk penanda posisi utama.',
    replaces: 'Key: COMPANY_ID + EMPLOYEE_ID + POSITION_ID + VALID_FROM.',
    template: { href: '/api/sync/upload/template/positions-employees', filename: 'template-positions-employees.xlsx' },
  },
  {
    kind: 'positions-competencies', syncKey: 'positions/competencies', label: 'Kompetensi Teknis', icon: Brain,
    accept: '.xlsx,.xls,.xlsm', multiple: false, slow: false,
    desc: 'Level kompetensi teknis yang dituntut jabatan vs yang dicapai karyawan.',
    replaces: 'Key: COMPANY_ID + EMPLOYEE_ID + POSITION_ID + TECHNICAL_ID.',
    template: { href: '/api/sync/upload/template/positions-competencies', filename: 'template-positions-competencies.xlsx' },
  },
  {
    kind: 'performance', syncKey: 'performance', label: 'Penilaian Kinerja', icon: BarChart2,
    accept: '.xlsx,.xls,.xlsm', multiple: false, slow: false,
    desc: 'Riwayat performance appraisal per tahun (S1, S2, promosi).',
    replaces: 'Key: COMPANY_ID + EMPLOYEE_ID + TAHUN + SEQ.',
    template: { href: '/api/sync/upload/template/performance', filename: 'template-performance.xlsx' },
  },
  {
    kind: 'grade-levels', syncKey: 'grade-levels', label: 'Level & Grade', icon: Award,
    accept: '.xlsx,.xls,.xlsm', multiple: false, slow: false,
    desc: 'Pemetaan level jabatan ke grade — dasar rentang grade posisi.',
    replaces: 'Key: COMPANY_ID + LEVEL_ID + GRADE_ID.',
    template: { href: '/api/sync/upload/template/grade-levels', filename: 'template-grade-levels.xlsx' },
  },
  {
    kind: 'behavior-competencies', syncKey: 'behavior-competencies', label: 'Kompetensi Perilaku', icon: Sparkles,
    accept: '.xlsx,.xls,.xlsm', multiple: false, slow: false,
    desc: 'Hasil assessment center terakhir per karyawan: rekomendasi dan keterangan.',
    replaces: 'Key: COMPANY_ID + EMPLOYEE_ID (satu baris per karyawan).',
    template: { href: '/api/sync/upload/template/behavior-competencies', filename: 'template-behavior-competencies.xlsx' },
  },
  {
    kind: 'disciplinary', syncKey: 'disciplinary', label: 'Catatan Disiplin', icon: ShieldAlert,
    accept: '.xlsx,.xls,.xlsm', multiple: false, slow: false,
    desc: 'Riwayat pelanggaran & sanksi. Menentukan status disiplin kandidat.',
    replaces: 'Key: COMPANY_ID + EMPLOYEE_ID + DISCIPLINARY_NO.',
    template: { href: '/api/sync/upload/template/disciplinary', filename: 'template-disciplinary.xlsx' },
  },
  {
    kind: 'education', syncKey: 'education', label: 'Riwayat Pendidikan', icon: GraduationCap,
    accept: '.xlsx,.xls,.xlsm', multiple: false, slow: false,
    desc: 'Jenjang, jurusan, institusi, dan IPK per karyawan.',
    replaces: 'Key: NPK + jenjang + jurusan + institusi + tahun. Tidak pernah menghapus riwayat.',
    template: { href: '/api/sync/upload/template/education', filename: 'template-education.xlsx' },
  },
];

type TilePhase =
  | { stage: 'idle' }
  | { stage: 'uploading'; done: number; total: number }
  | { stage: 'processing'; count: number }
  | { stage: 'done'; message: string; background: boolean }
  | { stage: 'error'; message: string };

function FileSourceTile({
  source,
  disabledReason,
  buildSyncUrl,
  lastRun,
  onBusyChange,
  onCompleted,
  tenants,
}: {
  source: FileSource;
  disabledReason: string | null;
  buildSyncUrl: (key: string, extra?: Record<string, string>) => string;
  lastRun?: SyncRunRow;
  onBusyChange: (busy: boolean) => void;
  onCompleted: () => void;
  /** Business units to choose from for a tenant-scoped source (Job Profile). */
  tenants: { id: string; name: string }[];
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<TilePhase>({ stage: 'idle' });
  const [dragging, setDragging] = useState(false);
  /** dragenter/dragleave fire per child element; count them to avoid flicker. */
  const dragDepth = useRef(0);
  const [selectedTenantIds, setSelectedTenantIds] = useState<string[]>([]);

  const busy = phase.stage === 'uploading' || phase.stage === 'processing';
  const disabled = Boolean(disabledReason) || busy;

  useEffect(() => { onBusyChange(busy); }, [busy, onBusyChange]);

  async function handleFiles(fileList: FileList | File[]) {
    const picked = filterAccepted(Array.from(fileList), source.accept);
    if (picked.length === 0) {
      setPhase({ stage: 'error', message: `Tidak ada file ${source.accept} yang cocok.` });
      return;
    }
    // Single-file sources overwrite one fixed name, so more than one upload
    // would silently discard all but the last — say so instead.
    const files = source.multiple ? picked : picked.slice(0, 1);
    const ignored = picked.length - files.length;

    setPhase({ stage: 'uploading', done: 0, total: files.length });
    const { failures } = await uploadFiles(source.kind, files, (done, total) =>
      setPhase({ stage: 'uploading', done, total }),
      source.tenantScoped ? selectedTenantIds : undefined,
    );

    const uploaded = files.length - failures.length;
    if (uploaded === 0) {
      setPhase({ stage: 'error', message: failures[0] ?? 'Semua file gagal diunggah.' });
      toast.error(`Unggah ${source.label} gagal`, { description: failures.slice(0, 3).join(' · ') });
      if (inputRef.current) inputRef.current.value = '';
      return;
    }
    if (failures.length) {
      toast.error(`${failures.length} file gagal diunggah`, {
        description: failures.slice(0, 3).join(' · '),
      });
    }

    // Uploading is the trigger — run the matching sync straight away.
    setPhase({ stage: 'processing', count: uploaded });
    try {
      // uploadsOnly: this run exists to process what was just uploaded, so the
      // service must not also rescan the shared folder. The scheduled job calls
      // the sync functions directly and never sets this.
      const url = buildSyncUrl(source.syncKey, { uploadsOnly: '1' });
      if (source.slow) {
        // LLM extraction over many PDFs far outlives a request; fire and forget,
        // and be explicit that deletion happens when it eventually finishes.
        fetch(url, { method: 'POST' }).catch(() => {});
        setPhase({
          stage: 'done',
          background: true,
          message: `${uploaded} file sedang diproses di latar belakang. File akan dihapus otomatis setelah selesai.`,
        });
        toast.success(`${uploaded} file ${source.label} diunggah`, {
          description: 'Pemrosesan berjalan di latar belakang. Muat ulang halaman beberapa menit lagi.',
        });
      } else {
        const res = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(180_000) });
        if (!res.ok) throw new Error(await res.text());
        const data = (await res.json()) as {
          success?: boolean; message?: string; synced?: number; total?: number;
          /** Rows stored but pointing at a reference that does not exist yet (sync-service SyncResult). */
          warnings?: string[];
        };
        // Only an explicit success:false means failure — see triggerSync.
        if (data.success === false) throw new Error(data.message ?? 'Sinkronisasi gagal');
        setPhase({
          stage: 'done',
          background: false,
          message: data.message ?? `${uploaded} file diproses.`,
        });
        toast.success(`${source.label} diproses`, {
          description:
            (data.synced != null
              ? `${data.synced.toLocaleString('id-ID')} dari ${data.total?.toLocaleString('id-ID')} record. `
              : '') + 'File unggahan sudah dihapus.',
        });
        // Stored, but not connected yet: an unmapped Company ID, an NPK missing
        // from Data Karyawan, an unknown position or competency code. Its own
        // toast (not a line inside the success one) because it is what the user
        // has to act on.
        if (data.warnings && data.warnings.length > 0) {
          toast.warning(`${source.label}: ${data.warnings.length} peringatan data`, {
            description: data.warnings.join(' • '),
            duration: 20_000,
          });
        }
        onCompleted();
      }
      if (ignored > 0) {
        toast.warning(`${ignored} file lain diabaikan`, {
          description: `${source.label} hanya menerima satu file per unggahan.`,
        });
      }
    } catch (e) {
      const message = (e as Error).message;
      setPhase({ stage: 'error', message });
      toast.error(`Pemrosesan ${source.label} gagal`, { description: message });
    } finally {
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  const Icon = source.icon;

  const formats = source.accept.replace(/\./g, '').toUpperCase().replace(/,/g, ' · ');
  const openPicker = () => { if (!disabled) inputRef.current?.click(); };

  return (
    <div className="flex flex-col rounded-lg border bg-card p-3">
      <input
        ref={inputRef}
        type="file"
        accept={source.accept}
        multiple={source.multiple}
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) void handleFiles(e.target.files);
        }}
      />

      <div className="flex items-start gap-2">
        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold">{source.label}</span>
            {source.slow && (
              <Badge variant="secondary" className="shrink-0 text-[10px]">Lama</Badge>
            )}
          </div>
          <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{source.desc}</p>
        </div>
      </div>

      {/* Dropzone — the primary control. Drag counter (not a bare boolean) so
          dragging across child elements doesn't flicker the highlight off. */}
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled}
        aria-label={`Unggah berkas ${source.label}`}
        onClick={openPicker}
        onKeyDown={(e) => {
          if (disabled) return;
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPicker(); }
        }}
        onDragEnter={(e) => {
          if (disabled) return;
          e.preventDefault();
          dragDepth.current += 1;
          setDragging(true);
        }}
        onDragOver={(e) => { if (!disabled) e.preventDefault(); }}
        onDragLeave={() => {
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (dragDepth.current === 0) setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          dragDepth.current = 0;
          setDragging(false);
          if (disabled) return;
          if (e.dataTransfer.files?.length) void handleFiles(e.dataTransfer.files);
        }}
        className={cn(
          'mt-2.5 flex min-h-[104px] flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed px-3 py-4 text-center transition-colors outline-none',
          disabled
            ? 'cursor-not-allowed border-muted bg-muted/30 opacity-70'
            : 'cursor-pointer border-muted-foreground/25 hover:border-primary/50 hover:bg-primary/5 focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30',
          dragging && !disabled && 'border-primary bg-primary/10',
        )}
      >
        {busy ? (
          <>
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <p className="text-xs font-medium">
              {phase.stage === 'uploading'
                ? `Mengunggah ${phase.done}/${phase.total}…`
                : 'Memproses berkas…'}
            </p>
            {phase.stage === 'uploading' && phase.total > 1 && (
              <div className="mt-0.5 h-1 w-32 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-200"
                  style={{ width: `${Math.round((phase.done / phase.total) * 100)}%` }}
                />
              </div>
            )}
          </>
        ) : (
          <>
            <UploadCloud
              className={cn(
                'h-6 w-6 transition-colors',
                dragging && !disabled ? 'text-primary' : 'text-muted-foreground',
              )}
            />
            <p className="text-xs font-medium leading-snug">
              {dragging && !disabled
                ? 'Lepaskan untuk mengunggah'
                : <>Seret berkas ke sini, atau <span className="text-primary underline underline-offset-2">pilih berkas</span></>}
            </p>
            <p className="text-[10px] text-muted-foreground">
              {formats} · {source.multiple ? 'bisa banyak berkas' : 'satu berkas'}
            </p>
          </>
        )}
      </div>

      {source.template && (
        <a
          href={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}${source.template.href}`}
          download={source.template.filename}
          // Stop the click reaching the dropzone wrapper, which would open the
          // file picker on top of the download.
          onClick={(e) => e.stopPropagation()}
          className="mt-2 inline-flex w-fit items-center gap-1.5 rounded-md border border-dashed px-2 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
        >
          <Download className="h-3 w-3" />
          {source.template.filename.endsWith('.docx')
            ? 'Unduh template Word (simpan sebagai PDF)'
            : 'Unduh template Excel'}
        </a>
      )}

      {source.replaces && (
        <p className="mt-1.5 flex items-start gap-1 text-[10px] leading-snug text-muted-foreground">
          <RefreshCw className="mt-px h-2.5 w-2.5 shrink-0" />
          <span>{source.replaces}</span>
        </p>
      )}

      {source.tenantScoped && (
        <div
          className="mt-2.5 flex flex-col gap-1.5"
          // Stop clicks on the checkboxes from bubbling to the dropzone
          // wrapper, which would open the file picker on top of them.
          onClick={(e) => e.stopPropagation()}
        >
          <span className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
            <Building2 className="h-3 w-3" />
            Company (opsional)
          </span>
          <div className="flex flex-wrap gap-x-3 gap-y-1.5">
            {tenants.map((t) => (
              <label
                key={t.id}
                className="flex cursor-pointer items-center gap-1.5 text-xs"
              >
                <Checkbox
                  checked={selectedTenantIds.includes(t.id)}
                  disabled={disabled}
                  onCheckedChange={(checked) =>
                    setSelectedTenantIds((prev) =>
                      checked ? [...prev, t.id] : prev.filter((id) => id !== t.id),
                    )
                  }
                />
                {t.name}
              </label>
            ))}
          </div>
          <span className="text-[10px] leading-snug text-muted-foreground">
            Dokumen langsung dipetakan ke Company yang dipilih. Kosongkan untuk membiarkannya tampil
            di semua Company — bisa diatur belakangan dari halaman Job Profile.
          </span>
        </div>
      )}

      {/* Outcome */}
      {phase.stage === 'done' && (
        <p className="mt-2 flex items-start gap-1.5 rounded-md bg-emerald-500/10 p-1.5 text-[11px] leading-snug text-emerald-700 dark:text-emerald-300">
          {phase.background
            ? <Clock className="mt-px h-3 w-3 shrink-0" />
            : <CheckCircle2 className="mt-px h-3 w-3 shrink-0" />}
          <span className="min-w-0">{phase.message}</span>
        </p>
      )}
      {phase.stage === 'error' && (
        <p className="mt-2 flex items-start gap-1.5 rounded-md bg-rose-500/10 p-1.5 text-[11px] leading-snug text-rose-700 dark:text-rose-300">
          <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
          <span className="min-w-0 break-words">{phase.message}</span>
        </p>
      )}
      {disabledReason && phase.stage === 'idle' && (
        <p className="mt-2 text-[10px] text-muted-foreground">{disabledReason}</p>
      )}

      <div className="mt-auto pt-1.5">
        <LastRunLine run={lastRun} />
      </div>
    </div>
  );
}

function FileSourcesCard({
  sources,
  title,
  icon: TitleIcon,
  description,
  notice = null,
  columns = 2,
  disabledReason,
  buildSyncUrl,
  latestRuns,
  onCompleted,
  defaultOpen = true,
  storageKey,
  accent,
  tenants = [],
}: {
  sources: FileSource[];
  storageKey?: string;
  accent?: CardAccent;
  title: string;
  icon: React.ElementType;
  description: string;
  notice?: React.ReactNode;
  /** 2 for the four bespoke file sources, 3 for the wider Excel grid. */
  columns?: 2 | 3;
  disabledReason: string | null;
  buildSyncUrl: (key: string, extra?: Record<string, string>) => string;
  latestRuns: Record<string, SyncRunRow>;
  onCompleted: () => void;
  defaultOpen?: boolean;
  /** Business units, for the Job Profile upload's tenant picker. */
  tenants?: { id: string; name: string }[];
}) {
  const [busyKeys, setBusyKeys] = useState<Set<string>>(new Set());
  // Bail out when nothing actually changed. Each tile reports its busy state
  // from an effect whose callback prop is re-created every render, so always
  // returning a fresh Set here would re-render forever.
  const setBusy = useCallback((key: string, busy: boolean) => {
    setBusyKeys((prev) => {
      if (prev.has(key) === busy) return prev;
      const next = new Set(prev);
      busy ? next.add(key) : next.delete(key);
      return next;
    });
  }, []);

  return (
    <CollapsibleCard
      defaultOpen={defaultOpen}
      storageKey={storageKey}
      accent={accent}
      title={
        <>
          <TitleIcon className="h-5 w-5" />
          {title}
          {busyKeys.size > 0 && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </>
      }
      description={description}
    >
      {notice}

      <div
        className={cn(
          'grid gap-3 sm:grid-cols-2',
          columns === 3 && 'xl:grid-cols-3',
        )}
      >
        {sources.map((source) => (
          <FileSourceTile
            key={source.kind}
            source={source}
            disabledReason={disabledReason}
            buildSyncUrl={buildSyncUrl}
            lastRun={latestRuns[jobKeyOf(source.syncKey)]}
            onBusyChange={(busy) => setBusy(source.kind, busy)}
            onCompleted={onCompleted}
            tenants={tenants}
          />
        ))}
      </div>
    </CollapsibleCard>
  );
}

// ── Sync audit trail helpers ──────────────────────────────────

const TRIGGER_META: Record<string, { label: string; icon: React.ElementType }> = {
  ui: { label: 'Manual (UI)', icon: MousePointerClick },
  api: { label: 'API', icon: Globe },
  cron: { label: 'Terjadwal', icon: CalendarClock },
  cli: { label: 'CLI', icon: Terminal },
};

const RUN_STATUS_META: Record<string, { label: string; className: string }> = {
  success: { label: 'Berhasil', className: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20' },
  failed: { label: 'Gagal', className: 'bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/20' },
  running: { label: 'Berjalan', className: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20' },
};

/** Compact "3 menit lalu" style age, so staleness is obvious at a glance. */
function relativeAge(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diffMs)) return '-';
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'baru saja';
  if (mins < 60) return `${mins} menit lalu`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} jam lalu`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} hari lalu`;
  const months = Math.floor(days / 30);
  return `${months} bulan lalu`;
}

function formatDuration(ms: number | null): string {
  if (ms == null) return '-';
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const mins = Math.floor(ms / 60_000);
  const secs = Math.round((ms % 60_000) / 1000);
  return `${mins}m ${secs}s`;
}

/** One-line "last run" summary shown under each module button. */
function LastRunLine({ run }: { run: SyncRunRow | undefined }) {
  if (!run) {
    return <p className="px-1 text-[10px] text-muted-foreground/60">Belum pernah dijalankan</p>;
  }
  const status = RUN_STATUS_META[run.status];
  const trigger = TRIGGER_META[run.triggerSource] ?? TRIGGER_META.api;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <p className="flex items-center gap-1 px-1 text-[10px] text-muted-foreground">
          {run.status === 'running' ? (
            <Loader2 className="h-2.5 w-2.5 shrink-0 animate-spin text-amber-500" />
          ) : run.status === 'failed' ? (
            <AlertTriangle className="h-2.5 w-2.5 shrink-0 text-rose-500" />
          ) : (
            <CheckCircle2 className="h-2.5 w-2.5 shrink-0 text-emerald-500" />
          )}
          <span className="truncate">{relativeAge(run.startedAt)}</span>
          {run.synced != null && <span className="tabular-nums">· {run.synced.toLocaleString('id-ID')}</span>}
        </p>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-xs">
        <p className="font-medium">{status?.label ?? run.status} — {formatDateTime(run.startedAt)}</p>
        <ul className="mt-1 space-y-0.5 text-xs text-primary-foreground">
          <li>Trigger: {trigger.label}{run.actor ? ` (${run.actor})` : ''}</li>
          {run.mode && <li>Mode: {run.mode}</li>}
          {run.synced != null && <li>Record: {run.synced.toLocaleString('id-ID')}{run.total != null ? ` / ${run.total.toLocaleString('id-ID')}` : ''}</li>}
          <li>Durasi: {formatDuration(run.durationMs)}</li>
          {run.error && <li className="text-rose-500">Error: {run.error.slice(0, 200)}</li>}
        </ul>
      </TooltipContent>
    </Tooltip>
  );
}




// ── Sync operations config ────────────────────────────────────

// Grouped by where the data actually comes from, verified against
// sync-service/src/services/* rather than by name:
//   • Database  — MSSQL via queryDbMPMDS / queryDbMPMHRGA
//   • API Orange — the external REST gateway (config.api.baseUrl)
//   • File      — PDF / Excel read off the shared folder (config.localPdfFolder)
//   • Turunan   — no external source; derives rows from data already in Postgres
const SYNC_GROUPS = [
  {
    id: 'database',
    label: 'Database',
    icon: Database,
    hint: 'MSSQL — DB MPMDS & DB MPMHRGA',
    ops: [
      { key: 'employees',     label: 'Karyawan',          icon: Users,         slow: false, desc: 'Data master karyawan dari DB MPMDS (MPMDS_ORANGE_DATA)' },
      { key: 'org',           label: 'Struktur Org',      icon: Building2,     slow: false, desc: 'Divisi & departemen diturunkan dari data karyawan yang tersinkron' },
      { key: 'positions/all', label: 'Position Mapping',  icon: Layers,        slow: false, desc: 'Master posisi, hierarki, mapping employee-position, dan technical competency' },
      { key: 'performance',   label: 'Penilaian Kinerja', icon: BarChart2,     slow: false, desc: 'Rekap appraisal dari DB MPMHRGA (DVP_PA_HISTORY_DTL)' },
      { key: 'grade-levels',  label: 'Grade Level',       icon: Layers,        slow: false, desc: 'Master grade / level jabatan dari DB MPMHRGA' },
      { key: 'behavior-competencies', label: 'Kompetensi Perilaku', icon: Brain, slow: false, desc: 'Assessment perilaku terbaru per karyawan dari DB MPMHRGA' },
    ],
  },
  {
    id: 'api',
    label: 'API Orange',
    icon: Globe,
    hint: 'REST API gateway eksternal',
    ops: [
      { key: 'disciplinary',  label: 'Kedisiplinan',      icon: ShieldAlert,   slow: true,  desc: 'Catatan disiplin dari API Orange (berjalan lama)' },
      { key: 'education',     label: 'Pendidikan',        icon: GraduationCap, slow: true,  desc: 'Riwayat pendidikan dari API Orange (berjalan lama)' },
      { key: 'personal',      label: 'Data Pribadi',      icon: Cake,          slow: false, desc: 'Tanggal lahir karyawan dari API Orange — sumber usia kandidat. Hanya tanggal lahir yang disimpan.' },
    ],
  },
  // NOTE: the file-based sources (Job Profile, Kamus, HAV, MCU) deliberately do
  // NOT appear here. They are driven entirely by upload in FileSourcesCard —
  // there is no "sync from the shared folder" trigger for them any more.
  {
    id: 'derived',
    label: 'Turunan',
    icon: Sparkles,
    hint: 'Diolah dari data yang sudah tersinkron',
    ops: [
      { key: 'candidates',    label: 'Kandidat',          icon: UserCheck,     slow: false,
        desc: 'Derivasi record kandidat dari semua data yang telah disinkron. Mode upsert: perbarui data yang ada. Mode bangun ulang: hapus & susun ulang data turunan (riwayat jabatan, kompetensi teknis hasil sync) dari nol.',
        rebuild: {
          confirm:
            'Bangun ulang data turunan kandidat?\n\n' +
            'Yang dihapus lalu disusun ulang dari tabel sync:\n' +
            '• Riwayat jabatan kandidat\n' +
            '• Kompetensi teknis hasil sync (input manual TIDAK dihapus)\n\n' +
            'Record kandidat sendiri tetap dipertahankan beserta ID-nya, sehingga hasil scoring, successor terpilih, dan cache skor aspek tidak hilang.',
        } },
    ],
  },
] as const;

// ── Main Component ────────────────────────────────────────────

export function SyncSettingsClient({ mappings, tenants, stats, latestRuns, initialRunHistory, knowledge, connections, maintenance }: Props) {
  const router = useRouter();
  const [dialog, setDialog] = useState<DialogState>({ mode: 'closed' });
  const [isPending, startTransition] = useTransition();
  const [serviceStatus, setServiceStatus] = useState<'checking' | 'online' | 'offline'>('checking');
  const [syncing, setSyncing] = useState<Set<string>>(new Set());
  const [tenantFilter, setTenantFilter] = useState<string>('all');
  // Pending "bangun ulang dari nol" request awaiting the operator's confirmation.
  const [rebuildAsk, setRebuildAsk] = useState<{ key: string; slow: boolean; label: string; message: string } | null>(null);

  const closeDialog = () => setDialog({ mode: 'closed' });

  // Tenants available for filtering = only those with an active mapping
  const filterableTenants = useMemo(
    () => {
      const activeTenantIds = new Set(
        mappings.filter((m) => m.isActive).map((m) => m.tenantId),
      );
      return tenants.filter((t) => activeTenantIds.has(t.id));
    },
    [mappings, tenants],
  );

  // Reset filter if the selected tenant is no longer in the list
  useEffect(() => {
    if (tenantFilter !== 'all' && !filterableTenants.some((t) => t.id === tenantFilter)) {
      setTenantFilter('all');
    }
  }, [filterableTenants, tenantFilter]);

  const buildSyncUrl = useCallback(
    (key: string, extra?: Record<string, string>) => {
      const params = new URLSearchParams();
      if (tenantFilter !== 'all') params.set('tenantId', tenantFilter);
      for (const [k, v] of Object.entries(extra ?? {})) params.set(k, v);
      const qs = params.toString();
      return `${process.env.NEXT_PUBLIC_BASE_PATH}/api/sync/${key}${qs ? `?${qs}` : ''}`;
    },
    [tenantFilter],
  );

  const filterLabel = useMemo(() => {
    if (tenantFilter === 'all') return null;
    return filterableTenants.find((t) => t.id === tenantFilter);
  }, [tenantFilter, filterableTenants]);

  // Why every sync/upload control is greyed out, when it is. Single source of
  // truth so each control can SAY why instead of just looking broken.
  const offlineReason =
    serviceStatus === 'online'
      ? null
      : serviceStatus === 'checking'
        ? 'Masih memeriksa koneksi ke layanan sinkronisasi…'
        : 'Layanan sinkronisasi tidak dapat dihubungi. Periksa container sync / SYNC_SERVICE_URL, lalu muat ulang halaman.';

  // Source syncs switched off in the service (SOURCE_SYNC_ENABLED=false, e.g. a
  // demo away from the company network): only the full sync is disabled — the
  // uploads and everything they feed keep working.
  const [sourceSyncOff, setSourceSyncOff] = useState(false);
  const sourceSyncReason = sourceSyncOff
    ? 'Sinkronisasi dari sumber (MSSQL / API HR / folder bersama) dinonaktifkan di layanan sinkronisasi (SOURCE_SYNC_ENABLED=false). Unggah berkas di bawah tetap berjalan dan langsung diteruskan ke Company.'
    : null;

  // Check sync service health on mount
  useEffect(() => {
    const check = async () => {
      try {
        const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_PATH}/api/sync/health`, { signal: AbortSignal.timeout(3000) });
        setServiceStatus(res.ok ? 'online' : 'offline');
        const body = (await res.json().catch(() => null)) as { sourceSync?: boolean } | null;
        setSourceSyncOff(body?.sourceSync === false);
      } catch {
        setServiceStatus('offline');
      }
    };
    check();
  }, []);

  const setSyncingKey = useCallback((key: string, active: boolean) => {
    setSyncing((prev) => {
      const next = new Set(prev);
      active ? next.add(key) : next.delete(key);
      return next;
    });
  }, []);

  async function triggerSync(key: string, slow = false, extra?: Record<string, string>) {
    setSyncingKey(key, true);
    try {
      const url = buildSyncUrl(key, extra);
      if (slow) {
        // Fire and forget for long-running operations
        fetch(url, { method: 'POST' }).catch(() => {});
        toast.success(`Sinkronisasi ${key} dimulai`, {
          description: filterLabel
            ? `Hanya Company ${filterLabel.name}. Proses berjalan di latar belakang dan membutuhkan beberapa menit.`
            : 'Proses ini berjalan di latar belakang dan membutuhkan beberapa menit.',
        });
        return;
      }
      const res = await fetch(url, {
        method: 'POST',
        signal: AbortSignal.timeout(120_000),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json() as { success?: boolean; message?: string; synced?: number; total?: number };
      // Only an EXPLICIT success:false is a failure. A 200 whose body omits the
      // flag is still a success — composite endpoints answer with a per-part
      // breakdown, and treating the missing flag as falsy reported healthy runs
      // as "gagal".
      if (data.success !== false) {
        toast.success(data.message ?? `Sinkronisasi ${key} selesai`, {
          description: data.synced != null ? `${data.synced.toLocaleString('id-ID')} dari ${data.total?.toLocaleString('id-ID')} record diproses` : undefined,
        });
        // Pull the freshly-recorded run so "terakhir dijalankan" reflects it
        // without a manual page reload.
        router.refresh();
      } else {
        toast.error(data.message ?? `Sinkronisasi ${key} gagal`);
      }
    } catch (e) {
      toast.error(`Gagal memicu sinkronisasi: ${(e as Error).message}`);
    } finally {
      setSyncingKey(key, false);
    }
  }

  async function triggerFullSync() {
    setSyncingKey('all', true);
    try {
      const url = buildSyncUrl('all/background');
      const res = await fetch(url, { method: 'POST' });
      if (!res.ok) throw new Error(await res.text());
      toast.success('Sinkronisasi penuh dimulai', {
        description: filterLabel
          ? `Hanya Company ${filterLabel.name}. Semua modul akan disinkronkan secara berurutan. Muat ulang halaman beberapa menit lagi untuk melihat data terbaru.`
          : 'Semua modul akan disinkronkan secara berurutan. Muat ulang halaman beberapa menit lagi untuk melihat data terbaru.',
      });
    } catch (e) {
      toast.error(`Gagal memulai sinkronisasi penuh: ${(e as Error).message}`);
    } finally {
      setSyncingKey('all', false);
    }
  }

  function handleCreate(formData: FormData) {
    startTransition(async () => {
      try {
        await createCompanyTenantMappingAction(formData);
        toast.success('Mapping berhasil ditambahkan');
        closeDialog();
      } catch (e) {
        toast.error((e as Error).message);
      }
    });
  }

  function handleUpdate(formData: FormData) {
    startTransition(async () => {
      try {
        await updateCompanyTenantMappingAction(formData);
        toast.success('Mapping berhasil diperbarui');
        closeDialog();
      } catch (e) {
        toast.error((e as Error).message);
      }
    });
  }

  function handleDelete(id: number) {
    const fd = new FormData();
    fd.set('id', String(id));
    startTransition(async () => {
      try {
        await deleteCompanyTenantMappingAction(fd);
        toast.success('Mapping berhasil dihapus');
        closeDialog();
      } catch (e) {
        toast.error((e as Error).message);
      }
    });
  }

  function handleToggle(id: number, currentlyActive: boolean) {
    const fd = new FormData();
    fd.set('id', String(id));
    fd.set('isActive', String(!currentlyActive));
    startTransition(async () => {
      try {
        await toggleCompanyTenantMappingAction(fd);
        toast.success(currentlyActive ? 'Mapping dinonaktifkan' : 'Mapping diaktifkan');
      } catch (e) {
        toast.error((e as Error).message);
      }
    });
  }

  const activeMappings = mappings.filter((m) => m.isActive).length;
  const newestRun = Object.values(latestRuns).reduce<SyncRunRow | null>(
    (best, run) => (!best || run.startedAt > best.startedAt ? run : best),
    null,
  );

  return (
    <div className="space-y-6">
      {/* ── 1. Status & the one button most visits are for ─────── */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-2">
              {/* {serviceStatus === 'checking' && (
                <Badge variant="outline" className="gap-1 text-xs">
                  <Loader2 className="h-3 w-3 animate-spin" /> Memeriksa layanan…
                </Badge>
              )}
              {serviceStatus === 'online' && (
                <Badge variant="outline" className="gap-1 border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                  <Wifi className="h-3 w-3" /> Layanan sinkronisasi online
                </Badge>
              )}
              {serviceStatus === 'offline' && (
                <Badge variant="outline" className="gap-1 border-destructive/40 bg-destructive/10 text-destructive">
                  <WifiOff className="h-3 w-3" /> Layanan sinkronisasi offline
                </Badge>
              )} */}
              <p className="text-xs text-muted-foreground">
                {newestRun ? (
                  <>
                    Terakhir berjalan: <strong className="text-foreground">{MODULE_LABELS[newestRun.jobKey] ?? newestRun.jobKey}</strong>{' '}
                    {relativeAge(newestRun.startedAt)} ·{' '}
                    <span className={newestRun.status === 'failed' ? 'text-rose-600 dark:text-rose-400' : undefined}>
                      {RUN_STATUS_META[newestRun.status]?.label ?? newestRun.status}
                    </span>
                  </>
                ) : (
                  'Belum ada eksekusi tercatat.'
                )}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Select value={tenantFilter} onValueChange={setTenantFilter}>
                <SelectTrigger id="tenantFilter" className="h-9 w-56" aria-label="Filter Company">
                  <Filter className="mr-1.5 h-3.5 w-3.5 text-muted-foreground" />
                  <SelectValue placeholder="Pilih Company…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Company</SelectItem>
                  {filterableTenants.length === 0 ? (
                    <SelectItem value="__none__" disabled>
                      Belum ada mapping aktif
                    </SelectItem>
                  ) : (
                    filterableTenants.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name} <span className="text-muted-foreground">({t.slug})</span>
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              <Button
                size="lg"
                className="h-9"
                disabled={syncing.has('all') || Boolean(offlineReason) || sourceSyncOff}
                title={sourceSyncReason ?? undefined}
                onClick={triggerFullSync}
              >
                {syncing.has('all') ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Memulai…</>
                ) : (
                  <><RefreshCw className="mr-2 h-4 w-4" />Jalankan Sinkronisasi Penuh</>
                )}
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Menarik semua modul berurutan di latar belakang (beberapa menit)
            {filterLabel ? <> — hanya untuk <strong>{filterLabel.name}</strong></> : null}. Berkas
            (job profile, kamus, HAV, MCU) tidak ikut: unggah lewat kartu di bawah.
          </p>
          {!offlineReason && sourceSyncReason && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2.5 text-xs">
              <WifiOff className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
              <div className="min-w-0">
                <p className="font-semibold text-amber-700 dark:text-amber-300">Sinkronisasi dari sumber dinonaktifkan</p>
                <p className="mt-0.5 text-muted-foreground">{sourceSyncReason}</p>
              </div>
            </div>
          )}
          {offlineReason && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2.5 text-xs">
              <WifiOff className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
              <div className="min-w-0">
                <p className="font-semibold text-amber-700 dark:text-amber-300">
                  Semua tombol sinkronisasi &amp; unggah dinonaktifkan
                </p>
                <p className="mt-0.5 text-muted-foreground">{offlineReason}</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── 2. Is the data fresh? One row per module ────────────── */}
      <DataSummaryCard stats={stats} />

      {/* ── 3. Company mapping — decides which Company every synced row lands in ── */}
      <CollapsibleCard
        defaultOpen
        storageKey="sync:mapping"
        accent="primary"
        title={
          <>
            <Link2 className="h-4 w-4 text-primary" />
            Pemetaan Company ID → Company
          </>
        }
        summary={
          <span className="tabular-nums">
            {activeMappings} aktif
            {mappings.length - activeMappings > 0 && ` · ${mappings.length - activeMappings} nonaktif`}
          </span>
        }
        description={
          <>
            Company ID dari database sumber (mis. <code className="rounded bg-muted px-1 py-0.5 text-xs">MPM2</code>) masuk ke
            Company Pulse yang mana — tanpa mapping, data hasil tarikan tidak masuk ke Company mana pun. Hanya mapping aktif yang diproses.
          </>
        }
        headerExtra={
          <Button size="sm" className="shrink-0" onClick={() => setDialog({ mode: 'create' })}>
            <Plus className="mr-1.5 h-4 w-4" />
            Tambah Mapping
          </Button>
        }
      >
      {mappings.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-12 text-center">
          <RefreshCw className="mb-3 h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm font-medium text-muted-foreground">Belum ada mapping</p>
          <p className="mt-1 text-xs text-muted-foreground/70">
            Tambahkan pemetaan Company ID untuk memulai sinkronisasi.
          </p>
          <Button
            size="sm"
            variant="outline"
            className="mt-4"
            onClick={() => setDialog({ mode: 'create' })}
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Tambah Mapping
          </Button>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-35">Company ID</TableHead>
              <TableHead>Label</TableHead>
              <TableHead>Company</TableHead>
              <TableHead className="w-25 text-center">Status</TableHead>
              <TableHead className="w-40">Diperbarui</TableHead>
              <TableHead className="w-25 text-right">Aksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {mappings.map((m) => (
              <TableRow key={m.id} className={cn(!m.isActive && 'opacity-50')}>
                <TableCell className="font-mono font-semibold">{m.companyId}</TableCell>
                <TableCell className="text-muted-foreground">{m.label ?? '—'}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-1.5">
                    <span>{m.tenantName}</span>
                    <span className="text-xs text-muted-foreground/60">({m.tenantSlug})</span>
                  </div>
                </TableCell>
                <TableCell className="text-center">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() => handleToggle(m.id, m.isActive)}
                        className="inline-flex cursor-pointer items-center gap-1 disabled:cursor-not-allowed"
                      >
                        {m.isActive ? (
                          <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                            <CheckCircle2 className="mr-1 h-3 w-3" /> Aktif
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="border-muted text-muted-foreground">
                            <XCircle className="mr-1 h-3 w-3" /> Nonaktif
                          </Badge>
                        )}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>Klik untuk {m.isActive ? 'nonaktifkan' : 'aktifkan'}</TooltipContent>
                  </Tooltip>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {formatDateTime(m.updatedAt)}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => setDialog({ mode: 'edit', mapping: m })}
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Edit</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive hover:text-destructive"
                          onClick={() => setDialog({ mode: 'delete', mapping: m })}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Hapus</TooltipContent>
                    </Tooltip>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      </CollapsibleCard>

      {/* ── 4. Uploads — the only way these four sources get in ─── */}
      <FileSourcesCard
        sources={FILE_SOURCES}
        title="Unggah Berkas Sumber"
        icon={UploadCloud}
        description="Job profile (PDF), kamus kompetensi (PDF), HAV dan MCU (Excel) tidak ditarik dari mana pun — mengunggah di sini ADALAH cara memasukkannya. Berkas dihapus dari server begitu isinya masuk database."
        disabledReason={offlineReason}
        buildSyncUrl={buildSyncUrl}
        latestRuns={latestRuns}
        onCompleted={() => router.refresh()}
        tenants={tenants}
        storageKey="sync:uploads"
        accent="primary"
      />



      {/* ── 6. History — collapsed; the header carries the last result ── */}
      {/* <SyncAuditTrail initial={initialRunHistory} /> */}

      {/* ── 7. AI knowledge (embedding) — collapsed; page-provided ── */}
      {knowledge}

      {/* ── 8. Settings & maintenance — set once, or destructive ─── */}
      <div className="space-y-3 pt-2">
        <div className="flex items-start gap-2.5 px-1">
          <Settings2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div>
            <h2 className="text-sm font-semibold">Pengaturan &amp; Pemeliharaan</h2>
            <p className="text-xs text-muted-foreground">
              Jarang dibuka:{' '}
              {[
                connections ? 'koneksi database sumber' : null,
                'unggah Excel pengganti sumber',
                maintenance ? 'pengosongan pool kandidat' : null,
              ]
                .filter(Boolean)
                .join(', ')}
              . Semuanya tertutup; ringkasannya ada di judul tiap kartu.
            </p>
          </div>
        </div>

        {connections}


        <FileSourcesCard
          sources={EXCEL_DATA_SOURCES}
          columns={3}
          title="Unggah Excel Pengganti Sumber"
          icon={FileSpreadsheet}
          description="Untuk data yang biasanya ditarik dari database / API Orange. Sekali jalan: hanya memperbarui baris yang ada di berkas, dan perubahannya langsung diteruskan ke data kandidat dan posisi setiap Company. Sinkronisasi terjadwal berikutnya kembali ke sumber aslinya. Dipakai saat koneksi sumber bermasalah atau perlu koreksi manual."
          disabledReason={offlineReason}
          buildSyncUrl={buildSyncUrl}
          latestRuns={latestRuns}
          defaultOpen={false}
          storageKey="sync:excel"
          accent="caution"
          onCompleted={() => router.refresh()}
        />

        {maintenance}
      </div>

      {/* ── Rebuild-from-scratch confirmation (no native confirm()) ── */}
      <AlertDialog open={rebuildAsk !== null} onOpenChange={(open) => !open && setRebuildAsk(null)}>
        <AlertDialogContent className="sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-base">Bangun ulang {rebuildAsk?.label} dari nol?</AlertDialogTitle>
            <AlertDialogDescription className="whitespace-pre-line text-xs">
              {rebuildAsk?.message}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel className="h-9 text-xs">Batal</AlertDialogCancel>
            <AlertDialogAction
              className="h-9 text-xs"
              onClick={() => {
                if (!rebuildAsk) return;
                const { key, slow } = rebuildAsk;
                setRebuildAsk(null);
                triggerSync(key, slow, { mode: 'rebuild' });
              }}
            >
              Bangun ulang
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Create dialog ─────────────────────────────────────── */}
      <MappingDialog
        open={dialog.mode === 'create'}
        title="Tambah Mapping"
        description="Hubungkan satu Company ID Mulia ke Company Pulse."
        tenants={tenants}
        isPending={isPending}
        onClose={closeDialog}
        onSubmit={handleCreate}
      />

      {/* ── Edit dialog ───────────────────────────────────────── */}
      {dialog.mode === 'edit' && (
        <MappingDialog
          open
          title="Edit Mapping"
          description="Perbarui pemetaan Company ID ke Company."
          tenants={tenants}
          isPending={isPending}
          defaultValues={dialog.mapping}
          onClose={closeDialog}
          onSubmit={handleUpdate}
        />
      )}

      {/* ── Delete confirm dialog ─────────────────────────────── */}
      {dialog.mode === 'delete' && (
        <Dialog open onOpenChange={closeDialog}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Hapus Mapping?</DialogTitle>
              <DialogDescription>
                Mapping <strong>{dialog.mapping.companyId}</strong> → <strong>{dialog.mapping.tenantName}</strong> akan
                dihapus permanen. Sinkronisasi data perusahaan ini tidak akan berjalan lagi.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={closeDialog}>Batal</Button>
              <Button
                variant="destructive"
                disabled={isPending}
                onClick={() => handleDelete(dialog.mapping.id)}
              >
                {isPending ? 'Menghapus…' : 'Hapus'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

// ── Shared create/edit dialog ────────────────────────────────

type MappingDialogProps = {
  open: boolean;
  title: string;
  description: string;
  tenants: TenantOption[];
  isPending: boolean;
  defaultValues?: Mapping;
  onClose: () => void;
  onSubmit: (formData: FormData) => void;
};

function MappingDialog({
  open,
  title,
  description,
  tenants,
  isPending,
  defaultValues,
  onClose,
  onSubmit,
}: MappingDialogProps) {
  const [selectedTenant, setSelectedTenant] = useState(defaultValues?.tenantId ?? '');

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <form
          action={onSubmit}
          className="grid gap-4 pt-2"
        >
          {defaultValues && (
            <input type="hidden" name="id" value={defaultValues.id} />
          )}
          {defaultValues && (
            <input type="hidden" name="isActive" value={String(defaultValues.isActive)} />
          )}

          <div className="grid gap-1.5">
            <Label htmlFor="companyId">
              Company ID <span className="text-destructive">*</span>
            </Label>
            <Input
              id="companyId"
              name="companyId"
              placeholder="MPM2"
              defaultValue={defaultValues?.companyId}
              className="font-mono uppercase"
              required
            />
            <p className="text-xs text-muted-foreground">
              Nilai COMPANY_ID dari tabel Mulia (mis. <code>MPM2</code>).
            </p>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="tenantId">
              Company <span className="text-destructive">*</span>
            </Label>
            <input type="hidden" name="tenantId" value={selectedTenant} />
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  className="w-full justify-between bg-card"
                >
                  {selectedTenant
                    ? tenants.find((t) => t.id === selectedTenant)?.name
                    : 'Pilih tenant…'}
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="ml-2 h-4 w-4 shrink-0 opacity-50"
                  >
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-full p-0">
                <Command>
                  <CommandInput placeholder="Cari Company…" />
                  <CommandEmpty>Company tidak ditemukan.</CommandEmpty>
                  <CommandGroup>
                    {tenants.map((t) => (
                      <CommandItem
                        key={t.id}
                        value={t.id}
                        onSelect={(currentValue) => {
                          setSelectedTenant(
                            currentValue === selectedTenant ? '' : currentValue
                          );
                        }}
                      >
                        <Check
                          className={cn(
                            'mr-2 h-4 w-4',
                            selectedTenant === t.id
                              ? 'opacity-100'
                              : 'opacity-0'
                          )}
                        />
                        {t.name} ({t.slug})
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </Command>
              </PopoverContent>
            </Popover>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="label">Label <span className="text-muted-foreground text-xs">(opsional)</span></Label>
            <Input
              id="label"
              name="label"
              placeholder="Nama perusahaan atau keterangan"
              defaultValue={defaultValues?.label ?? ''}
            />
          </div>

          <DialogFooter className="gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>Batal</Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? 'Menyimpan…' : 'Simpan'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
