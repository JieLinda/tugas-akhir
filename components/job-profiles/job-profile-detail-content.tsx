'use client';

import { useIdentifierDisplay } from '@/components/app-mode-provider';

import { useMemo } from 'react';
import {
  AlertCircle,
  Clock,
  Info,
  Sparkles,
  Award,
  FileCode,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { parseJobProfileTechnicalCompetencies } from '@/lib/job-profile-utils';
import { formatDateTime } from '@/lib/datetime';
import { DemoMaskedText } from '@/components/demo/demo-masked-text';

// Shared types for a Job Profile row and its extracted structured data. Kept
// here (co-located with the detail renderer) so both the Job Profile catalog
// page and the Job Family Sync page consume one definition.
export type ExtractedJobProfile = {
  documentInfo: {
    documentNumber: string | null;
    effectiveDate: string | null;
    revision: string | null;
    pageCount: string | null;
  } | null;
  jobIdentity: {
    positionName: string;
    divisionDepartment: string;
    directSupervisor: string;
    subordinates: string[];
  } | null;
  organizationStructure: {
    organizationChartSummary: string | null;
  } | null;
  jobSpecification: {
    education: string | null;
    experience: string | null;
    gender: string | null;
    skills: string[];
  } | null;
  behavioralCompetencies: string[] | null;
  /** New extractions: {competency, level} objects; old rows: plain strings. */
  technicalCompetencies: ({ competency: string; level: string | number | null } | string)[] | null;
  authorities: string[] | null;
  jobPurpose: string | null;
  responsibilities: {
    responsibility: string;
    successIndicator: string;
  }[] | null;
  workingRelationships: {
    internal: string[];
    external: string[];
  } | null;
  problemSolving: {
    references: string[];
    approvalRequired: string[];
    challenges: string[];
  } | null;
  approvals: {
    preparedBy: string | null;
    checkedBy: string | null;
    approvedBy: string | null;
  } | null;
};

export type JobProfileRow = {
  id: number;
  fileName: string;
  filePath: string;
  sourceFolder: string | null;
  fileHash: string | null;
  jobProfileNumber: string | null;
  positionName: string | null;
  divisionDepartment: string | null;
  supervisor: string | null;
  jobPurpose: string | null;
  extractedData: any; // Can cast to ExtractedJobProfile
  rawText: string | null;
  status: string;
  errorMessage: string | null;
  syncedAt: Date;
  processedAt: Date | null;
  /**
   * Non-null while the file is waiting for (re)extraction. Separate from
   * `status`, which describes the extracted CONTENT — a file queued for a
   * re-read keeps serving its previous extraction until the new one lands.
   *
   * REQUIRED, not optional. The page builds this row type by re-listing every
   * field by hand, so an optional field is one a mapper can drop in silence —
   * which is exactly what happened: 271 queued files rendered as "0 menunggu"
   * and tsc had nothing to say about it.
   */
  queuedAt: Date | null;
  /**
   * No tenant assigned yet, so this document is shown to all of them. Flagged
   * rather than hidden — a newly-synced document should not disappear before
   * someone assigns it (Job Profile page → tenant picker).
   */
  unmapped?: boolean;
  /** Tenant ids this document is currently assigned to; empty = unmapped. */
  tenantIds?: string[];
};

export function toStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => {
        if (typeof item === 'string') return [item];
        // An OBJECT here means the extraction put something in the wrong list —
        // the classic case is a technical competency landing among the
        // behavioural ones when the PDF prints the two tables side by side.
        // This used to drop it, so the entry vanished from the page entirely
        // and the only symptom was a list that looked short. Rendering its name
        // is strictly better: the reader sees that something is there and that
        // it does not belong. `sync-service/src/audit-job-profile-competencies.ts`
        // lists the affected files, and a re-extraction moves them for good.
        if (item && typeof item === 'object') {
          const o = item as Record<string, unknown>;
          const name = o.competency ?? o.name ?? o.responsibility ?? o.title;
          return typeof name === 'string' && name.trim() ? [name] : [];
        }
        return [];
      })
      .map((item) => item.trim())
      .filter(Boolean);
  }

  if (typeof value === 'string') {
    return value
      .split(/\r?\n|•|;|\|/g)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

/**
 * Read-only detail body for a Job Profile: the error banner (for failed rows) +
 * the tabbed structured view (overview, responsibilities, specifications,
 * competencies, relationships, raw JSON). The surrounding dialog header/actions
 * are supplied by the caller.
 */
export function JobProfileDetailContent({ profile }: { profile: JobProfileRow }) {
  const ids = useIdentifierDisplay();
  const profileDetails = useMemo<ExtractedJobProfile | null>(() => {
    if (!profile.extractedData) return null;
    try {
      const data = profile.extractedData;
      return typeof data === 'string' ? JSON.parse(data) : data;
    } catch {
      return null;
    }
  }, [profile]);

  return (
    <>
      {/* Error Message if failed */}
      {profile.status === 'failed' && profile.errorMessage && (
        <div className="bg-rose-50 dark:bg-rose-950/20 border-b border-rose-100 dark:border-rose-900/30 p-4 shrink-0 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-rose-600 dark:text-rose-400 mt-0.5 shrink-0" />
          <div>
            <h5 className="font-bold text-sm text-rose-800 dark:text-rose-300">Kesalahan Ekstraksi Dokumen</h5>
            <p className="text-xs text-rose-600 dark:text-rose-400/90 mt-1 font-mono break-all bg-white/50 dark:bg-black/30 p-1.5 rounded border border-rose-100/50 dark:border-rose-900/20">
              {profile.errorMessage}
            </p>
          </div>
        </div>
      )}

      {/* Content Tabs */}
      <div className="flex-1 overflow-hidden min-h-0 flex flex-col">
        {profile.status === 'completed' && profileDetails ? (
          <Tabs defaultValue="overview" className="flex-1 flex flex-col min-h-0">
            <div className="border-b border-slate-100 dark:border-slate-800/80 px-6 bg-slate-50/30 dark:bg-slate-950/10">
              <TabsList className="bg-transparent border-none gap-2 h-12 p-0">
                <TabsTrigger
                  value="overview"
                  className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent shadow-none px-3 font-semibold text-xs h-full"
                >
                  Informasi Utama
                </TabsTrigger>
                <TabsTrigger
                  value="responsibilities"
                  className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent shadow-none px-3 font-semibold text-xs h-full"
                >
                  Tanggung Jawab ({profileDetails.responsibilities?.length || 0})
                </TabsTrigger>
                <TabsTrigger
                  value="specifications"
                  className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent shadow-none px-3 font-semibold text-xs h-full"
                >
                  Spesifikasi Jabatan
                </TabsTrigger>
                <TabsTrigger
                  value="competencies"
                  className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent shadow-none px-3 font-semibold text-xs h-full"
                >
                  Kompetensi
                </TabsTrigger>
                <TabsTrigger
                  value="relationships"
                  className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent shadow-none px-3 font-semibold text-xs h-full"
                >
                  Hubungan &amp; Pemecahan Masalah
                </TabsTrigger>
                <TabsTrigger
                  value="raw_json"
                  className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent shadow-none px-3 font-semibold text-xs h-full flex items-center gap-1"
                >
                  <FileCode className="h-3.5 w-3.5" />
                  <span>Data Mentah JSON</span>
                </TabsTrigger>
              </TabsList>
            </div>

            <div className="flex-1 overflow-auto p-6 min-h-0">
              {/* OVERVIEW TAB */}
              <TabsContent value="overview" className="mt-0 space-y-6 focus-visible:ring-0">
                {/* Job Purpose */}
                <div className="space-y-2">
                  <h5 className="text-xs font-bold uppercase tracking-wider text-primary">Tujuan Jabatan (Job Purpose)</h5>
                  <div className="bg-slate-50 dark:bg-slate-950/30 border border-slate-100 dark:border-slate-800/80 rounded-xl p-4 leading-relaxed text-sm text-foreground/90 italic">
                    &ldquo;<DemoMaskedText text={profileDetails.jobPurpose || '-'} />&rdquo;
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Subordinates & Structure */}
                  <Card className="shadow-none border-slate-200/50 dark:border-slate-800/80 bg-slate-50/10 dark:bg-slate-950/10">
                    <CardHeader className="p-4 pb-2">
                      <CardTitle className="text-xs uppercase tracking-wider text-slate-500 font-bold">Struktur Organisasi &amp; Bawahan</CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-0 space-y-4">
                      <div>
                        <p className="text-[10px] font-bold uppercase text-muted-foreground">Bawahan Langsung / Subordinate</p>
                        {profileDetails.jobIdentity?.subordinates && profileDetails.jobIdentity.subordinates.length > 0 ? (
                          <ul className="mt-2 space-y-1.5 list-disc pl-5">
                            {profileDetails.jobIdentity.subordinates.map((sub, idx) => (
                              <li key={idx} className="text-sm font-medium text-foreground/80">{sub}</li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-sm text-muted-foreground mt-1">Tidak ada bawahan langsung yang tercatat</p>
                        )}
                      </div>

                      {profileDetails.organizationStructure?.organizationChartSummary && (
                        <div className="border-t border-slate-100 dark:border-slate-800/70 pt-3">
                          <p className="text-[10px] font-bold uppercase text-muted-foreground">Ikhtisar Bagan Organisasi</p>
                          <p className="text-xs text-foreground/80 mt-1.5 leading-relaxed"><DemoMaskedText text={profileDetails.organizationStructure.organizationChartSummary} /></p>
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  {/* Document details & Approvals */}
                  <div className="space-y-6">
                    <Card className="shadow-none border-slate-200/50 dark:border-slate-800/80 bg-slate-50/10 dark:bg-slate-950/10">
                      <CardHeader className="p-4 pb-2">
                        <CardTitle className="text-xs uppercase tracking-wider text-slate-500 font-bold">Informasi Administrasi Dokumen</CardTitle>
                      </CardHeader>
                      <CardContent className="p-4 pt-0 text-sm space-y-3 font-medium">
                        <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-800/75">
                          <span className="text-muted-foreground">Nomor Dokumen</span>
                          <span className="text-foreground tracking-wide font-mono font-semibold">{profileDetails.documentInfo?.documentNumber ? ids.code(profileDetails.documentInfo.documentNumber) : '-'}</span>
                        </div>
                        <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-800/75">
                          <span className="text-muted-foreground">Tanggal Berlaku</span>
                          <span className="text-foreground">{profileDetails.documentInfo?.effectiveDate || '-'}</span>
                        </div>
                        <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-800/75">
                          <span className="text-muted-foreground">Revisi</span>
                          <span className="text-foreground font-mono">{profileDetails.documentInfo?.revision || '-'}</span>
                        </div>
                        <div className="flex justify-between py-1.5">
                          <span className="text-muted-foreground">Jumlah Halaman</span>
                          <span className="text-foreground">{profileDetails.documentInfo?.pageCount || '-'}</span>
                        </div>
                      </CardContent>
                    </Card>

                    {profileDetails.approvals && (
                      <Card className="shadow-none border-slate-200/50 dark:border-slate-800/80 bg-slate-50/10 dark:bg-slate-950/10">
                        <CardHeader className="p-4 pb-2">
                          <CardTitle className="text-xs uppercase tracking-wider text-slate-500 font-bold">Persetujuan &amp; Otorisasi</CardTitle>
                        </CardHeader>
                        <CardContent className="p-4 pt-0 text-xs space-y-2.5 font-medium">
                          <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800/70">
                            <span className="text-muted-foreground">Dibuat Oleh</span>
                            <span className="text-foreground font-semibold"><DemoMaskedText text={profileDetails.approvals.preparedBy || '-'} /></span>
                          </div>
                          <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800/70">
                            <span className="text-muted-foreground">Diperiksa Oleh</span>
                            <span className="text-foreground font-semibold"><DemoMaskedText text={profileDetails.approvals.checkedBy || '-'} /></span>
                          </div>
                          <div className="flex justify-between py-1">
                            <span className="text-muted-foreground">Disetujui Oleh</span>
                            <span className="text-foreground font-semibold"><DemoMaskedText text={profileDetails.approvals.approvedBy || '-'} /></span>
                          </div>
                        </CardContent>
                      </Card>
                    )}
                  </div>
                </div>

                {/* File Audit Logs */}
                <Card className="shadow-none border-dashed border-slate-200 dark:border-slate-800 bg-slate-100/30 dark:bg-slate-950/10">
                  <CardContent className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 text-xs">
                    <div className="space-y-1">
                      <p className="font-semibold text-slate-500 flex items-center gap-1.5">
                        <Info className="h-4 w-4 text-slate-400" />
                        <span>Informasi Sumber Sinkronisasi File</span>
                      </p>
                      <p className="text-muted-foreground font-mono break-all pr-12 line-clamp-1">Path: {profile.filePath}</p>
                    </div>
                    <div className="shrink-0 text-muted-foreground">
                      {profile.processedAt && (
                        <p>Diproses: {formatDateTime(profile.processedAt)}</p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* RESPONSIBILITIES TAB */}
              <TabsContent value="responsibilities" className="mt-0 focus-visible:ring-0">
                {profileDetails.responsibilities && profileDetails.responsibilities.length > 0 ? (
                  <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-sm bg-white dark:bg-slate-900">
                    <Table>
                      <TableHeader className="bg-slate-50 dark:bg-slate-950/40">
                        <TableRow className="border-b border-slate-200 dark:border-slate-800">
                          <TableHead className="w-12 text-center font-bold text-xs uppercase tracking-wider py-4">No</TableHead>
                          <TableHead className="w-1/2 font-bold text-xs uppercase tracking-wider py-4">Tanggung Jawab Utama</TableHead>
                          <TableHead className="w-1/2 font-bold text-xs uppercase tracking-wider py-4">Indikator Keberhasilan (KPI)</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {profileDetails.responsibilities.map((resp, idx) => (
                          <TableRow
                            key={idx}
                            className="border-b border-slate-100 dark:border-slate-800/65 last:border-0 hover:bg-slate-50/50 dark:hover:bg-slate-950/10"
                          >
                            <TableCell className="text-center font-bold font-sans text-xs text-muted-foreground py-4">
                              {idx + 1}
                            </TableCell>
                            <TableCell className="py-4 text-sm font-medium leading-relaxed text-foreground/95 align-top whitespace-pre-line pr-4">
                              <DemoMaskedText text={resp.responsibility} />
                            </TableCell>
                            <TableCell className="py-4 text-sm font-medium leading-relaxed text-slate-600 dark:text-slate-300 align-top whitespace-pre-line pl-4">
                              <DemoMaskedText text={resp.successIndicator} />
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <div className="py-12 text-center text-muted-foreground bg-slate-50/50 dark:bg-slate-950/20 rounded-xl border border-dashed border-slate-200 dark:border-slate-800">
                    <p className="text-sm font-medium">Batas tanggung jawab tidak terekstraksi atau kosong.</p>
                  </div>
                )}
              </TabsContent>

              {/* SPECIFICATIONS TAB */}
              <TabsContent value="specifications" className="mt-0 space-y-6 focus-visible:ring-0">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Minimum Standard Qualification */}
                  <Card className="shadow-none border-slate-200/50 dark:border-slate-800/80 bg-slate-50/10 dark:bg-slate-950/10">
                    <CardHeader className="p-4 pb-2 border-b border-slate-100 dark:border-slate-800/60 mb-3">
                      <CardTitle className="text-xs uppercase tracking-wider text-slate-500 font-bold flex items-center gap-2">
                        <Award className="h-4 w-4 text-primary" />
                        <span>Standar Kualifikasi Jabatan</span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-0 text-sm space-y-4">
                      <div>
                        <p className="text-[10px] font-bold uppercase text-muted-foreground tracking-wider">Tingkat Pendidikan</p>
                        <p className="text-sm font-semibold mt-1 text-foreground/90">{profileDetails.jobSpecification?.education || '-'}</p>
                      </div>

                      <div>
                        <p className="text-[10px] font-bold uppercase text-muted-foreground tracking-wider">Pengalaman Kerja</p>
                        <p className="text-sm font-semibold mt-1 text-foreground/90">{profileDetails.jobSpecification?.experience || '-'}</p>
                      </div>

                      {profileDetails.jobSpecification?.gender && (
                        <div>
                          <p className="text-[10px] font-bold uppercase text-muted-foreground tracking-wider">Gender / Persyaratan Tambahan</p>
                          <p className="text-sm font-semibold mt-1 text-foreground/90">{profileDetails.jobSpecification?.gender}</p>
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  {/* Professional Skills */}
                  <Card className="shadow-none border-slate-200/50 dark:border-slate-800/80 bg-slate-50/10 dark:bg-slate-950/10">
                    <CardHeader className="p-4 pb-2 border-b border-slate-100 dark:border-slate-800/60 mb-3">
                      <CardTitle className="text-xs uppercase tracking-wider text-slate-500 font-bold flex items-center gap-2">
                        <Sparkles className="h-4 w-4 text-primary" />
                        <span>Keahlian &amp; Pengetahuan Tambahan</span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-0">
                      {profileDetails.jobSpecification?.skills && profileDetails.jobSpecification.skills.length > 0 ? (
                        <div className="flex flex-wrap gap-2 mt-2">
                          {profileDetails.jobSpecification.skills.map((skill, idx) => (
                            <Badge key={idx} variant="outline" className="bg-white dark:bg-slate-800 text-foreground border-slate-200/80 px-2.5 py-1 text-xs text-medium">
                              {skill}
                            </Badge>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground mt-2 font-medium">Tidak ada spesifikasi keahlian khusus terdaftar</p>
                      )}
                    </CardContent>
                  </Card>
                </div>

                {/* Job Authorities */}
                {profileDetails.authorities && profileDetails.authorities.length > 0 && (
                  <Card className="shadow-none border-slate-200/50 dark:border-slate-800/80 bg-slate-50/10 dark:bg-slate-950/10">
                    <CardHeader className="p-4 pb-2">
                      <CardTitle className="text-xs uppercase tracking-wider text-slate-500 font-bold">Wewenang Posisi (Authorities)</CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-0">
                      <ul className="list-disc pl-5 space-y-1.5">
                        {profileDetails.authorities.map((auth, idx) => (
                          <li key={idx} className="text-sm text-foreground/80 font-medium leading-relaxed"><DemoMaskedText text={auth} /></li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                )}
              </TabsContent>

              {/* COMPETENCIES TAB */}
              <TabsContent value="competencies" className="mt-0 space-y-6 focus-visible:ring-0">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Behavioral Competency */}
                  <Card className="shadow-none border-slate-200/50 dark:border-slate-800/80 bg-slate-50/10 dark:bg-slate-950/10">
                    <CardHeader className="p-4 pb-2 border-b border-slate-100 dark:border-slate-800/60 mb-3">
                      <CardTitle className="text-xs uppercase tracking-wider text-blue-500 font-bold flex items-center gap-2">
                        <Award className="h-4 w-4" />
                        <span>Kompetensi Perilaku (Behavioral)</span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-0">
                      {profileDetails.behavioralCompetencies && profileDetails.behavioralCompetencies.length > 0 ? (
                        <div className="space-y-2 mt-2">
                          {toStringList(profileDetails.behavioralCompetencies).map((comp, idx) => (
                            <div key={idx} className="flex items-center gap-2.5 p-2 bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800/65 rounded-lg text-sm text-slate-700 dark:text-slate-300 font-medium text-bold">
                              <span className="h-2 w-2 rounded-full bg-blue-500 shrink-0" />
                              <span>{comp}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground mt-2 font-medium">Tidak ada rincian kompetensi perilaku</p>
                      )}
                    </CardContent>
                  </Card>

                  {/* Technical Competency */}
                  <Card className="shadow-none border-slate-200/50 dark:border-slate-800/80 bg-slate-50/10 dark:bg-slate-950/10">
                    <CardHeader className="p-4 pb-2 border-b border-slate-100 dark:border-slate-800/60 mb-3">
                      <CardTitle className="text-xs uppercase tracking-wider text-emerald-500 font-bold flex items-center gap-2">
                        <Sparkles className="h-4 w-4" />
                        <span>Kompetensi Teknis (Technical)</span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-0">
                      {profileDetails.technicalCompetencies && profileDetails.technicalCompetencies.length > 0 ? (
                        <div className="space-y-2 mt-2">
                          {parseJobProfileTechnicalCompetencies(profileDetails.technicalCompetencies).map((comp, idx) => (
                            <div key={idx} className="flex items-center gap-2.5 p-2 bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800/65 rounded-lg text-sm text-slate-700 dark:text-slate-300 font-medium text-bold">
                              <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" />
                              <span className="min-w-0 flex-1">{comp.technicalName}</span>
                              {comp.targetProficiency && (
                                <Badge variant="outline" className="shrink-0 border-emerald-300/60 bg-emerald-500/10 text-[10px] font-semibold text-emerald-700 dark:border-emerald-800 dark:text-emerald-300">
                                  {comp.targetProficiency}
                                </Badge>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground mt-2 font-medium">Tidak ada rincian kompetensi teknis</p>
                      )}
                    </CardContent>
                  </Card>
                </div>
              </TabsContent>

              {/* RELATIONSHIPS & PROBLEM SOLVING TAB */}
              <TabsContent value="relationships" className="mt-0 space-y-6 focus-visible:ring-0">
                {/* Relationships */}
                {profileDetails.workingRelationships && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <Card className="shadow-none border-slate-200/50 dark:border-slate-800/80 bg-slate-50/10 dark:bg-slate-950/10">
                      <CardHeader className="p-4 pb-2">
                        <CardTitle className="text-xs uppercase tracking-wider text-slate-500 font-bold">Hubungan Kerja Internal</CardTitle>
                      </CardHeader>
                      <CardContent className="p-4 pt-0">
                        {profileDetails.workingRelationships.internal && profileDetails.workingRelationships.internal.length > 0 ? (
                          <ul className="list-disc pl-5 space-y-1.5 mt-1">
                            {toStringList(profileDetails.workingRelationships.internal).map((item, idx) => (
                              <li key={idx} className="text-sm text-foreground/80 font-medium leading-relaxed"><DemoMaskedText text={item} /></li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-sm text-muted-foreground mt-1">Tidak ada hubungan kerja internal yang terdaftar</p>
                        )}
                      </CardContent>
                    </Card>

                    <Card className="shadow-none border-slate-200/50 dark:border-slate-800/80 bg-slate-50/10 dark:bg-slate-950/10">
                      <CardHeader className="p-4 pb-2">
                        <CardTitle className="text-xs uppercase tracking-wider text-slate-500 font-bold">Hubungan Kerja Eksternal</CardTitle>
                      </CardHeader>
                      <CardContent className="p-4 pt-0">
                        {profileDetails.workingRelationships.external && profileDetails.workingRelationships.external.length > 0 ? (
                          <ul className="list-disc pl-5 space-y-1.5 mt-1">
                            {toStringList(profileDetails.workingRelationships.external).map((item, idx) => (
                              <li key={idx} className="text-sm text-foreground/80 font-medium leading-relaxed"><DemoMaskedText text={item} /></li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-sm text-muted-foreground mt-1">Tidak ada hubungan kerja eksternal yang terdaftar</p>
                        )}
                      </CardContent>
                    </Card>
                  </div>
                )}

                {/* Problem Solving / Decisions */}
                {profileDetails.problemSolving && (
                  <Card className="shadow-none border-slate-200/50 dark:border-slate-800/80 bg-slate-50/10 dark:bg-slate-950/10">
                    <CardHeader className="p-4 pb-2 border-b border-slate-100 dark:border-slate-800/50 mb-3">
                      <CardTitle className="text-xs uppercase tracking-wider text-slate-500 font-bold">Pemecahan Masalah &amp; Pengambilan Keputusan</CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-0 space-y-4">
                      {profileDetails.problemSolving.challenges && profileDetails.problemSolving.challenges.length > 0 && (
                        <div>
                          <p className="text-[10px] font-bold uppercase text-muted-foreground tracking-wider">Tantangan Jabatan Utama (Challenges)</p>
                          <ul className="list-disc pl-5 space-y-1 mt-1.5">
                            {toStringList(profileDetails.problemSolving.challenges).map((item, idx) => (
                              <li key={idx} className="text-sm text-foreground/80 font-medium leading-relaxed"><DemoMaskedText text={item} /></li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {profileDetails.problemSolving.references && profileDetails.problemSolving.references.length > 0 && (
                        <div className="border-t border-slate-100 dark:border-slate-800/60 pt-3">
                          <p className="text-[10px] font-bold uppercase text-muted-foreground tracking-wider">Rujukan Penunjang / SOP</p>
                          <ul className="list-disc pl-5 space-y-1 mt-1.5">
                            {toStringList(profileDetails.problemSolving.references).map((item, idx) => (
                              <li key={idx} className="text-sm text-foreground/80 font-medium leading-relaxed"><DemoMaskedText text={item} /></li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {profileDetails.problemSolving.approvalRequired && profileDetails.problemSolving.approvalRequired.length > 0 && (
                        <div className="border-t border-slate-100 dark:border-slate-800/60 pt-3">
                          <p className="text-[10px] font-bold uppercase text-muted-foreground tracking-wider">Keputusan Yang Memerlukan Persetujuan Atasan</p>
                          <ul className="list-disc pl-5 space-y-1 mt-1.5">
                            {toStringList(profileDetails.problemSolving.approvalRequired).map((item, idx) => (
                              <li key={idx} className="text-sm text-foreground/80 font-medium leading-relaxed"><DemoMaskedText text={item} /></li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}
              </TabsContent>

              {/* RAW JSON TAB */}
              <TabsContent value="raw_json" className="mt-0 h-full flex flex-col focus-visible:ring-0 min-h-75">
                <div className="flex-1 rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-slate-950 text-slate-100 flex flex-col h-full font-mono text-xs">
                  <div className="sticky top-0 bg-slate-900 border-b border-slate-800 px-4 py-2 flex items-center justify-between shrink-0">
                    <span className="text-slate-400 font-sans text-xs">extracted_data_raw.json</span>
                    <span className="text-slate-500 font-sans text-[10px]">
                      {ids.demo ? 'Dikosongkan (mode demo)' : 'JSON Schema Verified'}
                    </span>
                  </div>
                  <pre
                    className="p-4 overflow-auto flex-1 font-mono leading-relaxed select-all text-emerald-400/90"
                    style={{ tabSize: 2 }}
                  >
                    {/* Demo mode: left empty on purpose — the raw extraction is the
                        whole document in one block (the named sections are
                        masked server-side, but the rest would read as a dump). */}
                    <code>{ids.demo ? '' : JSON.stringify(profileDetails, null, 2)}</code>
                  </pre>
                </div>
              </TabsContent>
            </div>
          </Tabs>
        ) : profile.status === 'processing' || profile.status === 'pending' ? (
          <div className="flex-1 flex flex-col items-center justify-center py-20 text-center space-y-4">
            <Clock className="h-10 w-10 text-amber-500 animate-spin" />
            <div>
              <h4 className="font-bold text-slate-800 dark:text-slate-200">Sedang Mengekstraksi Dokumen</h4>
              <p className="text-xs text-muted-foreground mt-1 max-w-xs mx-auto">
                Dokumen ini sedang diproses oleh model Multi-modal AI Vision kami untuk menguraikan struktur bagian dan kualifikasi yang ada. Mohon tunggu beberapa saat.
              </p>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center py-20 text-center space-y-4">
            <AlertCircle className="h-10 w-10 text-rose-500" />
            <div>
              <h4 className="font-bold text-slate-800 dark:text-slate-200">Gagal Membaca Data</h4>
              <p className="text-xs text-muted-foreground mt-1 max-w-xs mx-auto">
                Data ekstraksi terstruktur tidak tersedia atau mengalami galat saat parsing. Silakan periksa rincian logs kesalahan atau jalankan sinkronisasi ulang.
              </p>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
