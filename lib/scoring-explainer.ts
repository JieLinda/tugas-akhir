/**
 * Markdown summaries of a candidate's per-criterion scoring, for the clipboard.
 *
 * WHY THIS EXISTS. Every figure on the Readiness / Kandidat surfaces is now a
 * click target that opens its derivation, and that took away text selection —
 * a reader can no longer drag-select a number to ask about it. These builders
 * give it back in a better form: instead of whatever happened to be under the
 * cursor, the whole derivation as structured keywords and numbers.
 *
 * The destination is the AI Assistant tab. That imposes the one constraint that
 * shapes everything here: **the vocabulary is a contract.** Every label emitted
 * below is also defined in `lib/scoring-methodology-brief.ts`, which the chat
 * route injects into its system prompt, so a pasted summary lands on terms the
 * assistant already knows how to explain. Renaming a label here without
 * renaming it there turns a precise question into a guess — keep the two in step.
 *
 * ONE implementation, deliberately. The same builders serve the criterion-level
 * copy button (rendered by `CriterionSection`, shared by the Readiness tab and
 * the Kandidat tab's breakdown-chip popup) and each derivation dialog. Two
 * copies would drift into describing the same score differently on two surfaces,
 * and the whole point is that the paste is trustworthy.
 *
 * Pure functions over already-loaded detail objects — no I/O, no server action,
 * so a client component can call them during a click handler.
 */

import { clientIdentifierDisplay } from '@/lib/app-mode-client';
import type {
  CandidateProgressRow,
  CareerDetail,
  CareerPair,
  CareerScoreBasis,
  CareerUnscoredReason,
  EducationDetail,
  TechnicalDetail,
  TechnicalPair,
} from '@/lib/progress-running-actions';
import { EDU_TIER_LABEL, resolveEduTier } from '@/lib/education-tier';
import { computePaBreakdown } from '@/lib/pa-topsis';
import { formatDateTime } from '@/lib/datetime';

const LEVELS: Record<number, string> = {
  1: 'Basic',
  2: 'Intermediate',
  3: 'Advance',
  4: 'Mastery',
};

// Demo mode (lib/app-mode-client.ts): this text is copied and sent to the
// assistant, so it masks NPKs and codes exactly as the screen does.
const ids = () => clientIdentifierDisplay();
/** The engine titles an untitled stint with its position code; demo mode masks that too. */
const stintTitle = (p: { title: string; positionId?: string | null }) =>
  ids().demo && p.positionId && p.title === p.positionId ? ids().code(p.positionId) : p.title;
const lvl = (n: number) => `L${n} ${LEVELS[n] ?? '?'}`;
const num = (v: number | null | undefined, digits = 3) =>
  v == null || !Number.isFinite(v) ? '—' : v.toFixed(digits);

/** Drop empty lines a conditional produced, so the paste has no ragged gaps. */
const lines = (...xs: (string | null | undefined | false)[]) =>
  xs.filter((x): x is string => typeof x === 'string' && x.length > 0).join('\n');

const MATCH_TYPE_ID: Record<TechnicalPair['matchType'], string> = {
  exact: 'identitas-nama',
  code: 'identitas-kode-kamus',
  semantic: 'kemiripan-makna',
  unmatched: 'tanpa-pasangan',
  unmeasurable: 'tidak-dapat-diukur',
};

const REQUIRED_SOURCE_ID: Record<string, string> = {
  profile: 'dokumen job profile',
  critical_position: 'daftar kompetensi pada posisi',
  incumbent: 'kompetensi pemegang jabatan saat ini',
  position_aggregate: 'gabungan kompetensi seluruh pemegang jabatan',
  none: 'tidak ada acuan',
};

const CAREER_BASIS_ID: Record<CareerScoreBasis, string> = {
  document: 'dokumen-job-profile',
  incumbent_competency: 'fallback-kompetensi-incumbent',
  unscored: 'tidak-dinilai',
};

const UNSCORED_REASON_ID: Record<CareerUnscoredReason, string> = {
  no_target_reference: 'posisi target tidak punya acuan kompetensi sama sekali',
  no_position_code: 'stint hanya bertitel, tanpa kode posisi',
  no_incumbent_competency:
    'kode posisi diketahui tetapi tidak ada pemegang yang dapat dipakai / pemegangnya tanpa data kompetensi',
};

const DEPTH_SOURCE_ID: Record<string, string> = {
  jd: 'syarat pengalaman tertulis di job profile jabatan sasaran × 2 — ABSOLUT',
  fixed: 'standar tetap dari konfigurasi — ABSOLUT, sama di setiap run',
  inherited: 'diwarisi dari run dasar (run inkremental)',
  // Only historical runs carry this, and the label has to say why it matters:
  // a pool-derived yardstick shrank when the bench was weak, so those scores are
  // not comparable with anything produced after the change.
  pool: 'ATURAN LAMA: median kandidat run ini × 2 — RELATIF terhadap peserta run, jadi tidak sebanding dengan run setelah aturan ini diganti',
};

const CALIBRATION_SOURCE_ID: Record<string, string> = {
  capped: 'rentang terukur, dibatasi di sebagian atasnya agar bukti dari kompetensi pejabat tidak bisa menyamai dokumen job profile asli',
  pinned: 'ditetapkan manual lewat konfigurasi',
  inherited: 'diwarisi dari run dasar (run inkremental)',
  empirical: 'ATURAN LAMA: p5–p95 similarity dokumen run ini — batas atasnya praktis sama dengan kecocokan dokumen terbaik di run itu',
  fixed: 'ATURAN LAMA: anchor tetap karena sampel dokumen run itu terlalu sedikit',
};

// ── Technical ──────────────────────────────────────────────────────

/** One competency pairing, as a Markdown list item plus its arithmetic. */
function technicalPairLine(p: TechnicalPair): string {
  const cand = p.candidate
    ? `${p.candidate.name} (${p.levelUnknown ? 'level belum diasesmen' : lvl(p.candidate.level)}${p.candidate.code ? `, kode ${ids().code(p.candidate.code)}` : ', tanpa kode kamus'})`
    : '(tidak ada pasangan)';
  const arith =
    p.matchType === 'unmatched' || p.matchType === 'unmeasurable'
      ? 'nilai 0'
      : p.similarity == null && p.levelFactor == null
        ? `nilai pasangan ${num(p.value)} (rincian sim'/faktor level tidak tercatat pada run ini)`
        : `sim' ${num(p.similarity)} × faktor level ${num(p.levelFactor)} = ${num(p.value)}`;
  const raw =
    p.matchType === 'semantic' && p.similarityRaw != null
      ? ` [cosine mentah ${num(p.similarityRaw, 4)}]`
      : '';
  return `- ${p.required.name} (${lvl(p.required.level)}${p.required.code ? `, kode ${ids().code(p.required.code)}` : ', tanpa kode kamus'}) -> ${cand} | ${MATCH_TYPE_ID[p.matchType]} | ${arith}${raw}`;
}

/**
 * Runs finished before the per-pair breakdown was recorded keep only `value`.
 * Emitting a bare "—" for sim' and faktor level there would invite the assistant
 * to reconstruct them from the formula and present the guess as the record, so
 * the absence is stated instead. Same rule the engine follows everywhere else:
 * a gap is reported, never implied.
 */
function legacyPairNote(detail: TechnicalDetail): string | null {
  const scored = detail.pairs.filter(
    (p) => p.matchType !== 'unmatched' && p.matchType !== 'unmeasurable',
  );
  if (scored.length === 0) return null;
  const missing = scored.filter((p) => p.similarity == null || p.levelFactor == null).length;
  if (missing === 0) return null;
  return `CATATAN KETERSEDIAAN DATA: run ini selesai sebelum rincian per pasangan dicatat, sehingga sim' dan faktor level tidak tersimpan untuk ${missing} dari ${scored.length} pasangan (tertulis "—"). Hanya "nilai pasangan" yang tercatat. JANGAN menghitung ulang atau menebak sim'/faktor level untuk pasangan itu — nyatakan saja bahwa rinciannya tidak tercatat pada run ini.`;
}

/**
 * How the pair values became the score — the step the assistant used to get
 * wrong, and could not have got right.
 *
 * A pair's value can reach 1.75 (an identity pair above the level the job asked
 * for), so Sigma/M can exceed 1. The engine SATURATES it at 1, but the markdown
 * used to print only `skor technical` and the raw pairs, so the obvious
 * arithmetic — add the pairs, divide by M, times 100 — produced 113 and read as
 * authoritative. Nothing in the prompt contradicted it.
 *
 * Now the saturation is stated, and the overshoot is reported as what it is: a
 * finding about depth of mastery, not a score above the top of the scale.
 */
function technicalScaleLines(detail: TechnicalDetail): string[] {
  const out: string[] = [];
  const rawMean = detail.normalizedRaw;

  if (rawMean != null && rawMean > 1.0005) {
    out.push(
      `normalisasi Sigma/M sebelum pembatasan: ${num(rawMean)} — DI ATAS 1, artinya kandidat melampaui level yang dituntut pada cukup banyak pasangan identitas.`,
      `normalisasi Sigma/M dipakai: ${num(detail.normalized)} (dibatasi pada 1.000)`,
      `PENTING: skor technical DIBATASI pada 100. Surplus over-kualifikasi bersifat KOMPENSATORIS — ia boleh menutup kekurangan level pada kompetensi lain, tetapi tidak bisa membuat kandidat lebih dari "memenuhi seluruh tuntutan", karena kriteria ini menanyakan "bisakah orang ini melakukan yang diminta jabatan" dan pertanyaan itu jenuh di "ya, semuanya". JANGAN menyajikan Sigma/M x 100 sebagai skor jika hasilnya di atas 100 — sebutkan pembatasannya.`,
    );
  } else {
    out.push(`normalisasi Sigma/M: ${num(detail.normalized)}`);
  }

  // A stored score above 100 can only come from a run finished before the bound
  // existed. Say so rather than letting it read as the current rule.
  if (detail.score > 100) {
    out.push(
      `CATATAN ATURAN LAMA: skor ${detail.score} melebihi 100 karena run ini selesai SEBELUM agregat technical dibatasi pada 100. Nilainya dibiarkan apa adanya — sebuah run adalah catatan penilaian pada tanggal tertentu dan tidak ditulis ulang. Run baru pada posisi yang sama akan memberi maksimum 100, jadi skor technical run ini TIDAK sebanding langsung dengan run setelah perubahan.`,
    );
  }

  return out;
}

export function buildTechnicalMarkdown(detail: TechnicalDetail): string {
  const divisor = detail.effectiveRequiredCount ?? detail.requiredCount;
  const byType = (t: TechnicalPair['matchType']) =>
    detail.pairs.filter((p) => p.matchType === t).length;

  return lines(
    `## Kriteria TECHNICAL COMPETENCY`,
    ``,
    `skor technical: ${detail.score}`,
    ...technicalScaleLines(detail),
    `jumlah set kompetensi kandidat (N): ${detail.candidateCount}`,
    `jumlah kompetensi dituntut posisi (M): ${detail.requiredCount}`,
    `pembagi M efektif: ${divisor}${
      divisor !== detail.requiredCount
        ? ` (${detail.requiredCount - divisor} kolom dikeluarkan karena tidak dapat diukur)`
        : ''
    }`,
    `sumber acuan kompetensi: ${REQUIRED_SOURCE_ID[detail.requiredSource ?? 'profile'] ?? detail.requiredSource ?? 'tidak tercatat'}`,
    detail.requiredSourceDetail ? `rincian acuan: ${detail.requiredSourceDetail}` : null,
    detail.simFloor != null && detail.simCeil != null
      ? `batas kemiripan (anchor kamus): bawah ${detail.simFloor} , atas ${detail.simCeil}`
      : `batas kemiripan (anchor kamus): tidak tercatat pada run ini`,
    `pasangan identitas: ${byType('exact') + byType('code')} (nama sama ${byType('exact')}, via kode kamus ${byType('code')})`,
    `pasangan kemiripan makna: ${byType('semantic')}`,
    `pasangan tanpa pasangan: ${byType('unmatched')}`,
    `pasangan tidak dapat diukur: ${byType('unmeasurable')}`,
    `pasangan dengan level belum diasesmen (faktor netral 1.000): ${detail.levelUnknownPairs ?? 0}`,
    ``,
    legacyPairNote(detail),
    legacyPairNote(detail) ? `` : null,
    `list pasangan required -> aktual:`,
    detail.pairs.length > 0
      ? detail.pairs.map(technicalPairLine).join('\n')
      : '- (tidak ada kompetensi dituntut)',
    detail.surplusCandidates && detail.surplusCandidates.length > 0
      ? lines(
          ``,
          `kompetensi kandidat tanpa pasangan (N>M, bernilai 0): ${detail.surplusCandidates.length}`,
          detail.surplusCandidates.map((s) => `- ${s.name} (${lvl(s.level)})`).join('\n'),
        )
      : null,
  );
}

export function buildTechnicalPairMarkdown(p: TechnicalPair, detail: TechnicalDetail): string {
  const divisor = detail.effectiveRequiredCount ?? detail.requiredCount;
  const isIdentity = p.matchType === 'exact' || p.matchType === 'code';
  const gap = p.candidate ? p.candidate.level - p.required.level : null;

  return lines(
    `## Penjabaran satu pasangan kompetensi (TECHNICAL)`,
    ``,
    `kompetensi dituntut: ${p.required.name}`,
    `level dituntut (t): ${lvl(p.required.level)}`,
    `kode kamus dituntut: ${p.required.code ? ids().code(p.required.code) : '(tidak ada di kamus)'}`,
    `kompetensi kandidat dipasangkan: ${p.candidate?.name ?? '(tidak ada pasangan)'}`,
    p.candidate
      ? `level kandidat (k): ${p.levelUnknown ? 'belum diasesmen' : lvl(p.candidate.level)}`
      : null,
    p.candidate ? `kode kamus kandidat: ${p.candidate.code ? ids().code(p.candidate.code) : '(tidak ada di kamus)'}` : null,
    `jenis pasangan: ${MATCH_TYPE_ID[p.matchType]}`,
    ``,
    // A pair from a run that predates the breakdown has only `value`. Saying so
    // is the difference between "not recorded" and "zero", and stops the
    // assistant from recomputing the parts and presenting them as the record.
    p.similarity == null && p.levelFactor == null
      ? `CATATAN KETERSEDIAAN DATA: run ini selesai sebelum rincian per pasangan dicatat — sim' dan faktor level TIDAK tersimpan untuk pasangan ini, hanya "nilai pasangan" di bawah. Jangan menghitung ulang atau menebak keduanya; nyatakan saja tidak tercatat.`
      : lines(
          `sim' (kemiripan dipakai): ${num(p.similarity)}`,
          p.similarityRaw != null ? `cosine mentah: ${num(p.similarityRaw, 4)}` : null,
          detail.simFloor != null && detail.simCeil != null
            ? `batas rentang: bawah ${detail.simFloor} , atas ${detail.simCeil}`
            : null,
          `faktor level: ${num(p.levelFactor)}`,
          p.levelUnknown
            ? `catatan faktor level: NETRAL 1.000 karena proficiency kandidat belum diasesmen (NULL/#N/A/NOT ASSESSED) — bukan kekurangan level`
            : gap != null && gap >= 0
              ? isIdentity
                ? `rumus faktor level: min(1 + 0.75 × (k − t) ÷ 3 , 1.75) dengan k−t = ${gap} (pasangan identitas berhak bonus melebihi level)`
                : `rumus faktor level: diplafon 1.000 karena pasangan hanya mirip, bukan identitas`
              : gap != null
                ? `rumus faktor level: maks(0 , 1 − (t − k) ÷ 4) dengan t−k = ${-gap}`
                : null,
        ),
    ``,
    `nilai pasangan: ${num(p.value)}`,
    `kontribusi ke skor: ${num(p.value)} ÷ ${divisor} × 100 = ${divisor > 0 ? num((p.value / divisor) * 100, 1) : '—'} poin`,
    `skor technical kandidat: ${detail.score} (Sigma/M = ${num(detail.normalized)})`,
    p.matchType === 'unmeasurable'
      ? lines(
          ``,
          `alasan bernilai 0: kompetensi ini tidak ada di kamus DAN tidak ada kompetensi kandidat yang identitasnya sama, sehingga kolomnya dijamin 0 untuk SETIAP kandidat`,
          `perlakuan: DIKELUARKAN dari pembagi M (bukan dihitung nol) supaya kamus yang belum lengkap tidak menekan skor semua orang`,
        )
      : null,
    p.matchType === 'unmatched'
      ? lines(
          ``,
          `alasan bernilai 0: ${detail.candidateCount === 0 ? 'kandidat tidak punya data kompetensi teknis sama sekali (N=0)' : 'seluruh kompetensi kandidat sudah terpakai untuk kolom lain, atau tidak ada yang cukup mirip'}`,
          `perlakuan: TETAP dihitung di pembagi M — kompetensinya terdefinisi dan kandidat ini memang tidak menutupinya`,
        )
      : null,
  );
}

// ── Career ─────────────────────────────────────────────────────────

/**
 * A stint's contribution to the years axis, as the ENGINE computed it.
 *
 * Never recompute this as `sim' × years`. That was right until recency decay
 * arrived, and it is now wrong by exactly the decay factor — which is worst
 * precisely where it matters, on the old stints whose demotion is the point. The
 * stored value is authoritative; the product is only a fallback for runs that
 * predate the field, and there the two agree by construction.
 */
function stintEffectiveYears(p: CareerPair): number {
  return p.effectiveYears ?? (p.similarity ?? 0) * p.years;
}

/** The decay factor, only when it actually cost something. */
function recencyNote(p: CareerPair): string {
  if (p.recencyFactor == null || p.recencyFactor >= 0.995) return '';
  return ` × penyusutan ${num(p.recencyFactor)}`;
}

function careerPairLine(p: CareerPair, basis: CareerScoreBasis): string {
  const rel =
    p.similarity != null
      ? `relevansi sim' ${num(p.similarity)}${p.similarityRaw != null ? ` [mentah ${num(p.similarityRaw, 4)}]` : ''}${recencyNote(p)} | ${num(stintEffectiveYears(p), 3)} th efektif`
      : `tidak dinilai (menyumbang 0 ke kedua sumbu)`;
  const via =
    basis === 'incumbent_competency'
      ? ` | via kompetensi incumbent ${p.fallbackEmployeeIds?.map(ids().npk).join(',') || '—'}${p.fallbackRaw != null ? ` (cakupan ${num(p.fallbackRaw)})` : ''}`
      : basis === 'document'
        ? ` | dokumen "${p.jobProfileName ?? `#${p.jobProfileId}`}"`
        : p.unscoredReason
          ? ` | sebab: ${UNSCORED_REASON_ID[p.unscoredReason]}`
          : '';
  return `- ${stintTitle(p)}${p.positionId ? ` [pos ${ids().code(p.positionId)}]` : ' [tanpa kode posisi]'}${p.isCurrent ? ' (masih menjabat)' : ''} | ${p.years.toFixed(2)} th | ${CAREER_BASIS_ID[basis]} | ${rel}${via}`;
}

const basisOf = (p: CareerPair): CareerScoreBasis =>
  p.basis ?? (p.similarity != null ? 'document' : 'unscored');

export function buildCareerMarkdown(detail: CareerDetail): string {
  return lines(
    `## Kriteria CAREER RELEVANCE`,
    ``,
    `skor career: ${detail.score}`,
    // The shape changed, so the label has to say WHICH shape produced this number.
    // `breadthWeight` is present only on runs that used the multiplicative form.
    detail.breadthWeight != null
      ? `normalisasi = capaian_tahun × (${num(1 - detail.breadthWeight, 2)} + ${num(detail.breadthWeight, 2)} × capaian_periode): ${num(detail.normalized, 4)}`
      : `normalisasi (ATURAN LAMA: min kedua sumbu): ${num(detail.normalized, 4)}`,
    `job profile posisi target: ${detail.targetJobProfileName ?? '(tidak ditemukan)'}`,
    `status pencocokan target: ${detail.targetStatus}`,
    ``,
    detail.recencyDecayPerYear != null && detail.recencyDecayPerYear > 0
      ? `penyusutan pengalaman lama: ${num(detail.recencyDecayPerYear * 100, 1)}% per tahun sejak penugasan berakhir (penugasan berjalan tidak menyusut)`
      : `penyusutan pengalaman lama: tidak diterapkan pada run ini`,
    `tahun efektif = Sigma(sim' × lama × penyusutan): ${num(detail.effectiveYears)}`,
    `periode efektif = Sigma(sim' × penyusutan): ${num(detail.effectiveRows)}`,
    `T_tahun (target): ${num(detail.targetYears, 2)}`,
    `T_periode (target): ${num(detail.targetRows, 2)}`,
    detail.statedExperienceText
      ? `syarat pengalaman tertulis di job profile sasaran: "${detail.statedExperienceText}" -> ${num(detail.statedExperienceYears, 1)} th (dikali 2 karena syarat tertulis adalah batas MINIMAL untuk layak, bukan titik nilai penuh)`
      : null,
    `capaian_tahun = min(1, tahun efektif ÷ T_tahun): ${num(detail.depthYears, 4)}`,
    `capaian_periode = min(1, periode efektif ÷ T_periode): ${num(detail.depthRows, 4)}`,
    detail.breadthWeight != null
      ? `sisi yang paling menekan skor: ${detail.binding === 'years' ? 'kedalaman durasi di bidang relevan' : detail.binding === 'rows' ? 'keragaman penugasan' : '—'} (dibandingkan dari poin yang HILANG, bukan dari capaian mentah — keragaman paling banyak bisa menghapus ${num(detail.breadthWeight * 100, 0)}% skor)`
      : `sumbu penentu (yang terkecil): ${detail.binding === 'years' ? 'kedalaman durasi' : detail.binding === 'rows' ? 'kedalaman riwayat' : '—'}`,
    `asal T: ${DEPTH_SOURCE_ID[detail.targetSource ?? ''] ?? 'tidak tercatat'}`,
    ``,
    `total tenur: ${num(detail.totalYears, 2)} th`,
    `tenur yang dapat dinilai: ${num(detail.matchedYears, 2)} th (cakupan ${detail.coverage != null ? `${Math.round(detail.coverage * 100)}%` : '—'})`,
    `periode dinilai via dokumen: ${detail.documentCount ?? '—'}`,
    `periode dinilai via fallback kompetensi incumbent: ${detail.fallbackCount ?? '—'}`,
    `periode tidak dapat dinilai: ${detail.unscoredCount ?? '—'}`,
    detail.calibration
      ? `penyetaraan fallback: ${num(detail.calibration.lo)}–${num(detail.calibration.hi)}` +
        (detail.calibration.cap != null
          ? ` (batas atas = ${num(detail.calibration.cap * 100, 0)}% dari rentang penuh)`
          : '') +
        ` — ${CALIBRATION_SOURCE_ID[detail.calibration.source] ?? detail.calibration.source}` +
        (detail.calibration.idfWeighted === true
          ? '; cakupan kompetensi dibobot kekhasan'
          : detail.calibration.idfWeighted === false
            ? '; cakupan kompetensi TIDAK dibobot kekhasan'
            : '')
      : null,
    detail.meanSimilarity != null
      ? `rata-rata relevansi tertimbang (diagnostik saja, BUKAN skor): ${num(detail.meanSimilarity, 4)}`
      : null,
    ``,
    `list riwayat posisi kandidat:`,
    detail.pairs.length > 0
      ? detail.pairs.map((p) => careerPairLine(p, basisOf(p))).join('\n')
      : '- (tidak ada riwayat posisi)',
  );
}

export function buildCareerDepthMarkdown(detail: CareerDetail, axis: 'years' | 'rows'): string {
  const isYears = axis === 'years';
  const eff = (isYears ? detail.effectiveYears : detail.effectiveRows) ?? 0;
  const target = (isYears ? detail.targetYears : detail.targetRows) ?? 0;
  const depth = (isYears ? detail.depthYears : detail.depthRows) ?? 0;
  const other = (isYears ? detail.depthRows : detail.depthYears) ?? 0;
  const binding = detail.binding === axis;
  // `breadthWeight` present = the multiplicative shape; absent = a run made when
  // the two axes combined with min(). The whole explanation below branches on it,
  // because under min() both axes are hard caps and under the new shape only one
  // is — advice derived from the wrong one would be wrong.
  const w = detail.breadthWeight;
  const multiplicative = w != null;
  const bothSaturated = depth >= 0.9999 && other >= 0.9999;
  const tied = !bothSaturated && Math.abs(depth - other) < 1e-4;
  const scored = detail.pairs.filter((p) => p.similarity != null);
  const unscored = detail.pairs.filter((p) => p.similarity == null);
  // Points each axis actually costs, which is what "binding" compares now.
  const lossYears = 1 - (detail.depthYears ?? 0);
  const lossRows = (w ?? 0) * (1 - (detail.depthRows ?? 0));

  return lines(
    `## Penjabaran ${isYears ? 'KEDALAMAN DURASI (sumbu tahun)' : 'KERAGAMAN PENUGASAN (sumbu periode)'} — CAREER`,
    ``,
    `kontribusi tiap periode jabatan:`,
    scored.length > 0
      ? scored
          .map(
            (p) =>
              `- ${stintTitle(p)}: ${
                isYears
                  ? `sim' ${num(p.similarity)} × ${p.years.toFixed(2)} th${recencyNote(p)} = ${num(stintEffectiveYears(p))}`
                  : `sim' ${num(p.similarity)}${recencyNote(p)}`
              }`,
          )
          .join('\n')
      : '- (tidak ada periode yang dapat dinilai)',
    unscored.length > 0
      ? unscored
          .map(
            (p) =>
              `- ${stintTitle(p)}: tidak dinilai = 0.000${p.unscoredReason ? ` (sebab: ${UNSCORED_REASON_ID[p.unscoredReason]})` : ''}`,
          )
          .join('\n')
      : null,
    ``,
    `${isYears ? 'tahun efektif' : 'periode efektif'} (jumlah): ${num(eff)}`,
    `T_${isYears ? 'tahun' : 'periode'}: ${num(target, 2)}`,
    `capaian = min(1, ${num(eff)} ÷ ${num(target, 2)}): ${num(depth, 4)} (${Math.round(depth * 100)}%)`,
    `asal T: ${DEPTH_SOURCE_ID[detail.targetSource ?? ''] ?? 'tidak tercatat'}`,
    ``,
    `capaian_tahun: ${num(detail.depthYears, 4)}`,
    `capaian_periode: ${num(detail.depthRows, 4)}`,
    multiplicative
      ? `skor career = capaian_tahun × (${num(1 - w!, 2)} + ${num(w!, 2)} × capaian_periode) × 100 = ${detail.score}`
      : `skor career = min(kedua capaian) × 100 = ${detail.score}   [ATURAN LAMA]`,
    multiplicative
      ? `bentuk ini BUKAN min(): kedalaman durasi memikul skor, keragaman penugasan hanya memodulasinya sebesar ${num(w! * 100, 0)}%. Jadi satu penugasan relevan yang dalam tetap memperoleh ${num((1 - w!) * 100, 0)}% nilai penuh walaupun cuma satu penugasan — dulu dengan min() ia tertahan oleh jumlah penugasannya sendiri, yang membuang bukti terkuat kriteria ini.`
      : `run ini memakai aturan lama min(kedua capaian): satu penugasan panjang di jabatan yang persis sama tertahan oleh jumlah penugasannya sendiri. Aturan itu sudah diganti bentuk perkalian, jadi skor career run ini tidak sebanding langsung dengan run yang lebih baru.`,
    ``,
    // Under min() both axes are hard caps and "which is smaller" is the whole
    // story. Under the multiplicative shape they are not comparable that way:
    // depth can cost the entire score, breadth at most `w` of it. So the question
    // "is this axis the one holding the score back" has to be answered from
    // points LOST, or the advice points at the wrong axis.
    bothSaturated
      ? `sumbu ini penentu? TIDAK ADA — kedua capaian sudah jenuh di 1.0000, artinya pengalaman relevan kandidat sudah melampaui KEDUA target. Skor career sudah maksimum 100 dan tidak ada yang perlu ditingkatkan pada kriteria ini.`
      : multiplicative
        ? lines(
            `poin yang HILANG dari tiap sumbu (inilah yang dibandingkan, bukan capaian mentahnya):`,
            `- sumbu tahun    : 1 − ${num(detail.depthYears, 4)} = ${num(lossYears, 4)}`,
            `- sumbu periode  : ${num(w!, 2)} × (1 − ${num(detail.depthRows, 4)}) = ${num(lossRows, 4)}`,
            binding
              ? `sumbu ini penentu? YA — ia menghapus ${num(isYears ? lossYears : lossRows, 4)} poin, lebih besar dari sumbu satunya (${num(isYears ? lossRows : lossYears, 4)}).`
              : `sumbu ini penentu? TIDAK — ia hanya menghapus ${num(isYears ? lossYears : lossRows, 4)} poin, sementara sumbu satunya menghapus ${num(isYears ? lossRows : lossYears, 4)}.`,
            `Kenapa dibandingkan dari poin yang hilang: keragaman penugasan paling banyak hanya bisa menghapus ${num(w! * 100, 0)}% skor, sedangkan kedalaman durasi bisa menghapus seluruhnya. Membandingkan ${num(detail.depthYears, 4)} dengan ${num(detail.depthRows, 4)} secara langsung — cara lama, waktu keduanya digabung dengan min() — sudah tidak sah.`,
          )
        : tied
          ? `sumbu ini penentu? SERI — kedua capaian sama besar (${num(depth, 4)}), jadi keduanya sama-sama menahan skor dan harus naik bersamaan.`
          : binding
            ? `sumbu ini penentu? YA — nilainya ${num(depth, 4)} lebih kecil dari sumbu satunya ${num(other, 4)}, dan skor mengambil yang terkecil.`
            : `sumbu ini penentu? TIDAK — nilainya ${num(depth, 4)} lebih besar dari sumbu satunya ${num(other, 4)}, jadi menaikkannya tidak mengubah skor sampai sumbu satunya ikut naik.`,
    !bothSaturated && (binding || tied)
      ? `implikasi: ${
          isYears
            ? 'menambah waktu di jabatan yang relevan menaikkan skor — dan penugasan yang sedang berjalan tidak menyusut, jadi penugasan relevan SEKARANG bernilai lebih besar daripada pengalaman relevan yang sudah lama berakhir'
            : `total lamanya memadai tetapi terkonsentrasi di sedikit jabatan; menyebar pengalaman relevan ke lebih banyak penugasan menaikkan skor, tetapi paling banyak ${multiplicative ? `${num(w! * 100, 0)}%` : 'sampai sumbu ini menyamai sumbu tahun'}`
        }`
      : null,
    detail.recencyDecayPerYear != null && detail.recencyDecayPerYear > 0 && isYears
      ? `catatan penyusutan: tiap penugasan yang SUDAH BERAKHIR dikali exp(−${num(detail.recencyDecayPerYear, 3)} × tahun sejak berakhir), jadi "th efektif" di atas selalu lebih kecil dari sim' × lama untuk penugasan lama. Penugasan yang masih berjalan tidak menyusut.`
      : null,
  );
}

export function buildCareerPairMarkdown(
  p: CareerPair,
  basis: CareerScoreBasis,
  detail: CareerDetail,
): string {
  return lines(
    `## Penjabaran satu periode jabatan (CAREER)`,
    ``,
    `jabatan: ${stintTitle(p)}`,
    `kode posisi: ${p.positionId ? ids().code(p.positionId) : '(tidak tercatat)'}`,
    p.companyId ? `perusahaan: ${ids().code(p.companyId)}` : null,
    `lama menjabat: ${p.years.toFixed(2)} th${p.isCurrent ? ' (masih menjabat, dihitung sampai hari ini)' : ''}`,
    `jalur penilaian: ${CAREER_BASIS_ID[basis]}`,
    `status pencocokan job profile: ${p.status}`,
    p.matchType ? `cara dipasangkan: ${p.matchType}` : null,
    ``,
    basis === 'document'
      ? lines(
          `job profile jabatan ini: ${p.jobProfileName ?? `#${p.jobProfileId}`}`,
          `job profile posisi target: ${detail.targetJobProfileName ?? '(tidak ditemukan)'}`,
          `cosine mentah antar dokumen: ${num(p.similarityRaw, 4)}`,
          `sim' setelah direntangkan: ${num(p.similarity)}`,
          p.similarity === 0
            ? `alasan bernilai 0: cosine berada di bawah batas bawah — jabatan ini tidak lebih mirip dengan posisi target dibanding sepasang job profile sembarang. Perbandingannya berhasil; hasilnya memang tidak menunjukkan hubungan.`
            : null,
        )
      : null,
    basis === 'incumbent_competency'
      ? lines(
          `jabatan ini TIDAK punya dokumen job profile, sehingga dinilai lewat kompetensi pemegang jabatannya`,
          `pemegang jabatan dipakai: ${p.fallbackEmployeeIds?.map(ids().npk).join(', ') || '—'}`,
          `asal asesmen kompetensinya: ${p.fallbackBasis ?? '—'}`,
          detail.calibration?.idfWeighted === true
            ? `cakupan kompetensi (rata-rata BERBOBOT KEKHASAN): ${num(p.fallbackRaw)} — kompetensi yang diminta hampir semua job profile (mis. Software Application Operation, ada di ~93% dokumen) hampir tidak menambah nilai, sedangkan kompetensi yang cuma diminta sedikit jabatan berbobot besar. Tanpa pembobotan ini, siapa pun yang manajer otomatis menutup ~45% syarat jabatan apa pun.`
            : `cakupan kompetensi (Sigma nilai pasangan ÷ M, tanpa bobot kekhasan): ${num(p.fallbackRaw)}`,
          `setelah disetarakan ke skala dokumen: ${num(p.similarityRaw, 4)}`,
          `sim' setelah direntangkan: ${num(p.similarity)}`,
          detail.calibration
            ? `rentang penyetaraan: ${num(detail.calibration.lo)} – ${num(detail.calibration.hi)} — ${CALIBRATION_SOURCE_ID[detail.calibration.source] ?? detail.calibration.source}`
            : null,
          detail.calibration?.cap != null
            ? `PLAFON: cakupan kompetensi 100% pun hanya mencapai sim' ${num(detail.calibration.cap)} (${num(detail.calibration.cap * 100, 0)}% dari rentang penuh), tidak 1,000. Alasannya: bukti dari kompetensi orang yang kebetulan menduduki jabatan itu lebih lemah daripada dokumen job profile yang benar-benar ada — ia membedakan rumpun jabatan jauh lebih buruk, dan 5% pasangan jabatan yang TIDAK berhubungan pun berbagi ≥75% kompetensi. Jadi jalur ini tidak boleh berarti "ini persis pekerjaan yang sama".`
            : detail.calibration
              ? `catatan: run ini memakai aturan lama, yaitu rentang p5–p95 similarity dokumen run itu sendiri. Batas atasnya praktis sama dengan kecocokan dokumen TERBAIK di run itu, sehingga cakupan kompetensi 100% bernilai sama dengan "ini persis pekerjaan yang sama". Skor jalur ini pada run lama karena itu terlalu tinggi.`
              : null,
          p.fallbackPairs && p.fallbackPairs.length > 0
            ? lines(
                `pasangan kompetensi yang membentuk cakupan:`,
                p.fallbackPairs
                  .map(
                    (fp) =>
                      `  - ${fp.required.name} -> ${fp.candidate?.name ?? '(tidak ada pasangan)'} = ${num(fp.value)}`,
                  )
                  .join('\n'),
              )
            : null,
        )
      : null,
    basis === 'unscored'
      ? lines(
          `periode ini menyumbang 0 ke KEDUA sumbu`,
          `sebab: ${p.unscoredReason ? UNSCORED_REASON_ID[p.unscoredReason] : 'tidak dapat dipasangkan ke job profile dan fallback kompetensi tidak dapat dijalankan'}`,
          `perlakuan: TETAP dihitung — tidak dikeluarkan dari pembagi, sehingga cakupan data yang buruk memang menurunkan skor`,
        )
      : null,
    p.similarity != null
      ? lines(
          ``,
          p.recencyFactor != null && p.recencyFactor < 0.995
            ? lines(
                `penyusutan karena usia pengalaman: ${num(p.recencyFactor)}`,
                `  penugasan ini sudah berakhir, jadi kontribusinya dikali exp(−${num(detail.recencyDecayPerYear ?? 0.043, 3)} × tahun sejak berakhir).`,
                `  Angka ${num(detail.recencyDecayPerYear ?? 0.043, 3)} adalah laju penyusutan keterampilan dari literatur human capital (~4,3%/tahun), bukan angka setelan.`,
                `  Penugasan yang masih berjalan bernilai penuh (penyusutan 1,000).`,
              )
            : p.recencyFactor != null
              ? `penyusutan karena usia pengalaman: 1,000 (penugasan masih berjalan atau baru berakhir)`
              : `penyusutan karena usia pengalaman: tidak diterapkan pada run ini — penugasan yang berakhir puluhan tahun lalu dihitung sama besar dengan yang sedang dijalani`,
          `kontribusi ke sumbu durasi: sim' ${num(p.similarity)} × ${p.years.toFixed(2)} th${recencyNote(p)} = ${num(stintEffectiveYears(p))} th efektif`,
          `kontribusi ke sumbu keragaman: ${num(p.similarity)}${recencyNote(p)} = ${num((p.similarity ?? 0) * (p.recencyFactor ?? 1))} periode efektif`,
        )
      : null,
    ``,
    `skor career kandidat: ${detail.score}`,
  );
}

// ── Education ──────────────────────────────────────────────────────

const EDU_REQ_SOURCE_ID: Record<string, string> = {
  profile: 'dokumen job profile posisi',
  critical_position: 'kolom pendidikan pada posisi',
  incumbent: 'pendidikan pemegang jabatan saat ini (PENDEKATAN, bukan syarat resmi jabatan)',
  none: 'tidak ada syarat yang dinyatakan',
};

/**
 * The exact-match tier. Recorded when the run stored it, otherwise RE-DERIVED
 * from education vs requirement by `resolveEduTier` — never inferred from the
 * score, which cannot distinguish a tier value from a legacy flat one. So every
 * run, old or new, is explained by the same rule.
 */
function eduTierOf(e: EducationDetail) {
  return resolveEduTier({
    source: e.source,
    score: e.score,
    education: e.education,
    requirement: e.requirement,
    exactComparison: e.exactComparison ?? null,
  });
}

/**
 * Education, with the SCORING PATH made explicit.
 *
 * The old version listed score + both sub-scores flat, which let a reader (and
 * the AI assistant) blend two mutually exclusive rules: on the exact-match path
 * the score is a TIER (100/80/50) and the sub-scores are null; on the LLM path
 * it is the plain MEAN of those sub-scores. An exact match at `equal` scores 80
 * BY RULE, and explanations were inventing "internal weighting" to account for
 * the 20 points — points that were never deducted from anything.
 */
export function buildEducationMarkdown(e: EducationDetail): string {
  const info = eduTierOf(e);
  const tier = info?.tier ?? null;
  const isLlm = e.source === 'llm-grounded' || e.source === 'llm-structured';
  const lo =
    e.educationLevel != null && e.majorRelevance != null
      ? Math.min(e.educationLevel, e.majorRelevance)
      : null;

  return lines(
    `## Kriteria EMPLOYEE PROFILE — PENDIDIKAN`,
    ``,
    `skor education: ${e.score}`,
    `pendidikan kandidat: ${e.education ?? '—'}`,
    `jurusan kandidat: ${e.major ?? '—'}`,
    `syarat pendidikan posisi: ${e.requirement ?? '(tidak dinyatakan)'}`,
    `sumber syarat: ${EDU_REQ_SOURCE_ID[e.requirementSource ?? ''] ?? e.requirementSource ?? 'tidak tercatat'}`,
    `jalur penilaian: ${e.source}`,
    ``,
    tier
      ? lines(
          `ATURAN YANG BERLAKU: jalur PENCOCOKAN PERSIS (deterministik, tanpa model bahasa).`,
          `Skor ditentukan oleh TINGKATAN, bukan dihitung dari sub-skor apa pun.`,
          `Kedua sub-skor (jenjang / relevansi jurusan) TIDAK ADA pada jalur ini.`,
          ``,
          `tingkatan: ${EDU_TIER_LABEL[tier]} -> nilai aturan ${info?.ruleScore}`,
          `tingkatan lain: LEBIH TINGGI=100 · SETARA=80 · LEBIH RENDAH=50`,
          e.matchedTokens?.length ? `token yang cocok persis: ${e.matchedTokens.join(', ')}` : null,
          ``,
          tier === 'equal'
            ? `CATATAN PENTING: skor ${e.score} di sini berarti "TEPAT MEMENUHI syarat", BUKAN pengurangan dari 100. Nilai 100 hanya untuk kandidat yang jenjangnya DI ATAS syarat (mis. S2 melawan syarat S1). Jangan menjelaskan jarak ${100 - e.score} poin ke 100 sebagai pengurangan, pembobotan, atau kekurangan apa pun — tidak ada yang dikurangi.`
            : tier === 'lower'
              ? `CATATAN: bidang studinya cocok tetapi jenjangnya di bawah syarat, sehingga tingkatannya 50 dan bukan 0 — jurusan yang tepat pada jenjang lebih rendah tetap dihargai separuh.`
              : `CATATAN: sudah pada tingkatan tertinggi.`,
          `yang bisa menaikkan: ${
            tier === 'higher'
              ? 'tidak ada, sudah maksimum'
              : tier === 'equal'
                ? 'HANYA jenjang pendidikan yang lebih tinggi dari syarat jabatan. Relevansi jurusan tidak berpengaruh di jalur ini karena jalur ini sudah menyatakan jurusannya cocok.'
                : 'menaikkan jenjang hingga setara syarat (memindahkan ke tingkatan 80)'
          }`,
          info?.basis === 'derived'
            ? `asal tingkatan: DITURUNKAN ULANG dari jenjang kandidat vs syarat posisi (run ini selesai sebelum tingkatan mulai dicatat). Aturannya sama persis dengan yang dipakai mesin skoring, jadi tingkatan di atas tetap sah.`
            : null,
          info?.deviates
            ? `CATATAN PENYIMPANGAN: skor tersimpan ${e.score} TIDAK sama dengan nilai aturan tingkatan (${info.ruleScore}). Run ini dinilai sebelum aturan tingkatan berlaku, ketika setiap pencocokan persis diberi satu nilai tunggal. Skor ${e.score} itulah yang benar-benar masuk ke TOPSIS dan membentuk peringkat, jadi TIDAK diubah. Jelaskan keduanya: tingkatannya "${tier}" menurut aturan yang berlaku sekarang (${info.ruleScore}), sementara angka yang membentuk peringkat run ini adalah ${e.score}.`
            : null,
        )
      : null,
    info && info.basis === 'undeterminable'
      ? lines(
          `ATURAN YANG BERLAKU: jalur PENCOCOKAN PERSIS (deterministik, tanpa model bahasa).`,
          `Jenjang DAN bidang studi kandidat sama-sama memenuhi syarat posisi.`,
          `Kedua sub-skor (jenjang / relevansi jurusan) TIDAK ADA pada jalur ini.`,
          e.matchedTokens?.length ? `token yang cocok persis: ${e.matchedTokens.join(', ')}` : null,
          ``,
          `tingkatan: TIDAK DAPAT DITENTUKAN — tidak ada jenjang yang dikenali pada sisi kandidat maupun pada syarat posisi, sehingga perbandingan jenjang tidak pernah terjadi. Ini berbeda dari "tidak tercatat": memang tidak ada yang bisa dibandingkan.`,
          `Aturan tingkatan: LEBIH TINGGI=100 · SETARA=80 · LEBIH RENDAH=50.`,
          `JANGAN menyimpulkan tingkatannya dari besarnya skor.`,
        )
      : null,
    isLlm
      ? lines(
          `ATURAN YANG BERLAKU: jalur MODEL BAHASA (tidak ada pencocokan persis).`,
          `Dinilai terhadap tanggung jawab & indikator keberhasilan jabatan, bukan hanya syarat minimal.`,
          e.source === 'llm-grounded'
            ? `Di-grounding ke pencarian web, sehingga alasannya mengutip sumber.`
            : `Panggilan grounded gagal menghasilkan format valid; dipakai jalur perbaikan tanpa kutipan sumber (rubrik sama).`,
          e.reusedFrom
            ? `JAWABAN MODEL DIPAKAI ULANG: model TIDAK dipanggil pada run ini. Seluruh masukan yang dibaca model (jenjang & jurusan kandidat, syarat pendidikan, judul posisi, tujuan jabatan, tanggung jawab & indikatornya, prompt, pengaturan model) identik dengan run terakhir posisi ini, jadi jawaban model dari run ${e.reusedFrom.answeredInRunId}${e.reusedFrom.answeredAt ? ` (${formatDateTime(e.reusedFrom.answeredAt)})` : ''} dipakai ulang agar masukan yang sama menghasilkan skor yang sama. Sumbu jenjang tetap dihitung dengan aturan run ini.`
            : null,
          ``,
          e.groundedMajorAxis != null
            ? lines(
                `DUA SUMBU, dan hanya satu yang ditentukan model:`,
                ``,
                `SUMBU 1 — JENJANG (aturan tetap, BUKAN model):`,
                e.levelComparison
                  ? `  ${EDU_TIER_LABEL[e.levelComparison]} -> nilai ${e.levelScore}`
                  : `  tidak dapat ditentukan -> sumbu ini DIBUANG (tidak ditebak)`,
                `  aturan: LEBIH TINGGI=100 · SETARA=80 · LEBIH RENDAH=50`,
                ``,
                `SUMBU 2 — RELEVANSI (akumulasi DUA jawaban model):`,
                `  jawaban model, relevansi jenjang: ${e.educationLevel ?? '—'}`,
                `  jawaban model, relevansi jurusan: ${e.majorRelevance ?? '—'}`,
                `  akumulasi = ( ${e.educationLevel ?? '—'} + ${e.majorRelevance ?? '—'} ) ÷ 2 = ${e.groundedMajorAxis}`,
                ``,
                e.levelScore != null
                  ? `SKOR AKHIR = ( sumbu jenjang + sumbu relevansi ) ÷ 2 = ( ${e.levelScore} + ${e.groundedMajorAxis} ) ÷ 2 = ${e.score}`
                  : `SKOR AKHIR = sumbu relevansi saja (sumbu jenjang dibuang) = ${e.score}`,
                ``,
                `PENTING: kesesuaian JENJANG tidak pernah ditentukan model. Model ditanya soal jenjang dan jurusan secara terpisah, tetapi kedua jawabannya diakumulasikan menjadi SATU sumbu relevansi. Dengan begitu aturan "jenjang di atas syarat minimal dihargai lebih tinggi daripada yang sekadar setara" berlaku sama di jalur ini dan di jalur pencocokan persis.`,
                e.levelScore != null && e.groundedMajorAxis != null
                  ? e.levelScore === e.groundedMajorAxis
                    ? `sumbu penahan: SEIMBANG — kedua sumbu ${e.levelScore}.`
                    : `sumbu penahan: ${e.levelScore < e.groundedMajorAxis ? 'JENJANG' : 'RELEVANSI'} (${Math.min(e.levelScore, e.groundedMajorAxis)}) — sumbu satunya ${Math.max(e.levelScore, e.groundedMajorAxis)}. Sebutkan ini eksplisit. ${
                        e.levelScore < e.groundedMajorAxis
                          ? e.levelComparison === 'lower'
                            ? 'Jenjang kandidat DI BAWAH syarat minimal (dinilai 50 menurut aturan, bukan 0). Hanya menaikkan jenjang yang menggeser sumbu ini.'
                            : 'Jenjang TEPAT memenuhi syarat (80), bukan di atasnya. Hanya jenjang LEBIH TINGGI dari syarat yang menggesernya ke 100.'
                          : 'Jenjang sudah memadai menurut aturan; yang menahan skor adalah penilaian relevansi oleh model — kutip bagian "alasan" di bawah.'
                      }`
                  : null,
              )
            : lines(
                `sub-skor jenjang pendidikan (jawaban model): ${e.educationLevel ?? '—'}`,
                `sub-skor relevansi jurusan (jawaban model): ${e.majorRelevance ?? '—'}`,
                `rumus (ATURAN LAMA): skor = rata-rata sederhana kedua jawaban model = ${e.score}`,
                `CATATAN KETERSEDIAAN DATA: run ini selesai SEBELUM sumbu jenjang dipindahkan keluar dari penilaian model. Jadi pada run ini kesesuaian jenjang ikut ditentukan model, bukan aturan tetap — berbeda dari run baru. Jangan menjelaskan run ini seolah memakai sumbu jenjang berbasis aturan.`,
              ),
          e.searchQueries?.length ? `kueri pencarian: ${e.searchQueries.join(' | ')}` : null,
          e.sources?.length ? `sumber dikutip: ${e.sources.map((s) => s.title).join(' | ')}` : null,
        )
      : null,
    !info && !isLlm
      ? lines(
          `ATURAN YANG BERLAKU: TIDAK DAPAT DINILAI — skor 0.`,
          `Nol di sini berarti BELUM DINILAI, bukan "pendidikannya tidak sesuai". Yang pertama masalah data/konfigurasi, yang kedua temuan tentang kandidat. Bila seluruh pool bernilai 0, kriteria ini dibuang dari matriks TOPSIS dan bobotnya dibagikan ke kriteria lain.`,
        )
      : null,
    e.reason ? lines(``, `alasan yang tercatat: ${e.reason}`) : null,
  );
}

// ── Performance Appraisal ──────────────────────────────────────────

/**
 * PA, rebuilt from the stored six-slot CSV (see lib/pa-topsis.ts) rather than
 * read, so every run — including ones finished before the derivation existed —
 * gets the same explanation. Three things the score cannot say on its own are
 * always stated: blank slots were read as C rather than skipped, the anchors are
 * absolute so the score is comparable across runs, and E sits below the negative
 * anchor which makes an all-E record outrank an all-D one.
 */
export function buildPerformanceMarkdown(
  detail: NonNullable<CandidateProgressRow['performanceDetail']>,
): string {
  const b = computePaBreakdown(detail.grade, detail.score ?? null);
  return lines(
    `## Kriteria PERFORMANCE APPRAISAL`,
    ``,
    `skor performance: ${detail.score}`,
    `CSV enam slot semester (terbaru dulu): ${detail.grade ?? '(tidak ada)'}`,
    `metode: TOPSIS jangkar ABSOLUT atas enam periode (jangkar tetap, BUKAN diambil dari kandidat lain), dengan bobot periode terdegradasi ke belakang`,
    `pemetaan nilai: A=4 B=3 C=2 D=1 E=0`,
    `jangkar ideal (semua A): 4 · jangkar anti-ideal (semua D): 1`,
    `bobot periode: TERDEGRADASI ke belakang (AHP dari preferensi 0.8^k, CR=0): 0.2711 0.2168 0.1735 0.1388 0.1110 0.0888 dari terbaru ke terlama — semester terbaru bernilai ~3x yang tertua`,
    ``,
    `rincian tiap periode:`,
    b.periods
      .map(
        (p) =>
          `- ${p.label}: ${p.raw || '(kosong)'}${p.substituted ? ' -> dibaca C' : ''} = ${p.value} | bobot ${p.weight.toFixed(4)} | ke D+ ${p.contribPlus.toFixed(4)} | ke D- ${p.contribMinus.toFixed(4)}`,
      )
      .join('\n'),
    ``,
    `D+ = akar( Sigma bobot x (nilai - 4)^2 ) = ${b.dPlus.toFixed(4)}`,
    `D- = akar( Sigma bobot x (nilai - 1)^2 ) = ${b.dMinus.toFixed(4)}`,
    `CC = D- / (D+ + D-) = ${b.dMinus.toFixed(4)} / ${(b.dPlus + b.dMinus).toFixed(4)} = ${b.closeness.toFixed(4)}`,
    `skor = bulat( CC x 100 ) = ${b.score}`,
    ``,
    b.substitutedCount > 0
      ? `CATATAN SUBSTITUSI: ${b.substitutedCount} dari ${b.periods.length} slot kosong/tidak dikenali dan DIBACA SEBAGAI C, bukan diabaikan. Jadi skor ini sebagian bertumpu pada nilai substitusi, bukan penilaian nyata. Kandidat tanpa data PA sama sekali mendapat 33 — bukan 0 dan bukan 50. Sebutkan ini bila skornya dipertanyakan.`
      : null,
    b.uniform
      ? `CATATAN: seluruh periode bernilai sama, sehingga degradasi bobot tidak berpengaruh sama sekali — kedua jarak berskala akar(Sigma bobot) = 1 dan kedekatannya identik untuk pembobotan apa pun.`
      : `CATATAN: nilai antar-periode BERVARIASI, jadi degradasi bobot BERPENGARUH di sini. URUTAN nilai penting dan itu dimaksudkan: A,C,C,C,C,C mendapat 51 (membaik belakangan) sementara C,C,C,C,C,A mendapat 41 (menurun).`,
    !b.recomputedMatchesStored
      ? `CATATAN PENYIMPANGAN: hitung ulang menghasilkan ${b.score} sementara skor tersimpan ${b.storedScore}. Penjabaran di atas memakai bobot periode yang berlaku SEKARANG (terdegradasi, 0.2711 sampai 0.0888), sedangkan run ini dinilai dengan pembobotan yang berbeda. Angka ${b.storedScore} itulah yang membentuk peringkat run ini dan TIDAK diubah. Jelaskan keduanya, jangan dicampur.`
      : null,
    b.anomaly === 'below_negative_anchor'
      ? `ANOMALI NYATA: rekam jejak ini memuat nilai E = 0, yang berada DI BAWAH jangkar negatif D = 1, sehingga jaraknya ke "semua D" bukan nol. Akibatnya rekam jejak semua-E mendapat 20 sementara semua-D mendapat 0 — E dinilai LEBIH TINGGI daripada D. Ini konsekuensi pemilihan jangkar, bukan penilaian kandidat.`
      : null,
    `sifat penting: karena jangkarnya absolut, skor PA SEBANDING antar-run — berbeda dari skor akhir TOPSIS yang bergantung pada siapa saja peserta run.`,
  );
}

// ── Remaining three aspects ────────────────────────────────────────

function buildSimpleMarkdown(c: CandidateProgressRow, criterion: string): string {
  switch (criterion) {
    case 'behavior':
      return lines(
        `## Kriteria BEHAVIOR COMPETENCY`,
        ``,
        `skor behavior: ${c.behaviorDetail?.score ?? c.scoreBreakdown?.behavior ?? '—'}`,
        `label rekomendasi asesmen: ${c.behaviorDetail?.recommendation ?? '(tidak ada)'}`,
        c.behaviorDetail?.notes ? `catatan asesmen: ${c.behaviorDetail.notes}` : null,
        `aturan: kategori dinilai BERPASANGAN, nilai ordinal 6..0, skor = ordinal × 100 ÷ 6. Tanpa asesmen = 0 (tidak ada perlakuan netral, karena kriteria ini menilai bukti positif).`,
      );
    case 'performance':
      return c.performanceDetail
        ? buildPerformanceMarkdown(c.performanceDetail)
        : lines(
            `## Kriteria PERFORMANCE APPRAISAL`,
            ``,
            `skor performance: ${c.scoreBreakdown?.performance ?? '—'}`,
            `rincian performance tidak tercatat pada run ini`,
          );
    case 'hav':
      return lines(
        `## Kriteria HAV MAPPING`,
        ``,
        `skor hav: ${c.havDetail?.score ?? c.scoreBreakdown?.hav ?? '—'}`,
        `kuadran HAV: ${c.havDetail?.quadrant ?? '(tidak ada)'}`,
        `aturan: pemetaan kuadran ke 5 tingkat. Tanpa data HAV dipakai tingkat "tanpa data" (40), bukan 0.`,
      );
    case 'education':
      return c.educationDetail
        ? buildEducationMarkdown(c.educationDetail)
        : lines(
            `## Kriteria EMPLOYEE PROFILE — PENDIDIKAN`,
            ``,
            `skor education: ${c.scoreBreakdown?.education ?? '—'}`,
            `rincian pendidikan tidak tercatat pada run ini`,
          );
    default:
      return '';
  }
}

// ── Entry points ───────────────────────────────────────────────────

/** Header every paste carries, so the assistant knows who and what it is about. */
function candidateHeader(c: CandidateProgressRow): string {
  return lines(
    `# Rincian perhitungan skor kandidat`,
    ``,
    `nama kandidat: ${c.name}`,
    c.rank != null ? `peringkat pada run ini: ${c.rank}` : null,
    c.weightedScore != null ? `skor akhir (kedekatan TOPSIS): ${c.weightedScore}` : null,
    c.readiness ? `tingkat kesiapan: ${c.readiness}` : null,
    c.jobProfileMatched ? `job profile posisi sasaran: ${c.jobProfileMatched}` : null,
    c.scoreBreakdown
      ? `skor per aspek: technical ${c.scoreBreakdown.technical ?? '—'} · career ${c.scoreBreakdown.career ?? '—'} · behavior ${c.scoreBreakdown.behavior ?? '—'} · performance ${c.scoreBreakdown.performance ?? '—'} · hav ${c.scoreBreakdown.hav ?? '—'} · education ${c.scoreBreakdown.education ?? '—'}`
      : null,
    ``,
  );
}

/** Footer that turns a paste into a question the assistant can act on. */
const ASK = lines(
  ``,
  `---`,
  `Tolong jelaskan angka-angka di atas selangkah demi selangkah dengan bahasa yang mudah dimengerti: dari mana setiap angka berasal, mengapa nilainya sebesar itu, dan apa yang paling menentukan skor akhir kriteria ini.`,
);

/**
 * The instruction, exported so callers can choose. `ask: false` yields DATA ONLY
 * — what the clipboard should carry, because a summary pasted into a spreadsheet
 * or a ticket must not arrive with "Tolong jelaskan…" attached. `ask: true` is for
 * the payload handed to the assistant.
 */
export const ASK_SUFFIX = ASK;

/** Whole-criterion summary — the copy button in each criterion header. */
export function buildCriterionMarkdown(
  c: CandidateProgressRow,
  criterion: string,
  opts: { ask?: boolean } = {},
): string {
  let body = '';
  if (criterion === 'technical' && c.technicalMatching) {
    body = buildTechnicalMarkdown(c.technicalMatching);
  } else if (criterion === 'career' && c.careerMatching) {
    body = buildCareerMarkdown(c.careerMatching);
  } else {
    body = buildSimpleMarkdown(c, criterion);
  }
  if (!body) return '';
  return candidateHeader(c) + body + (opts.ask === false ? '' : ASK);
}

/** Every criterion at once — for "copy the whole breakdown". */
export function buildAllCriteriaMarkdown(
  c: CandidateProgressRow,
  opts: { ask?: boolean } = {},
): string {
  const parts = [
    c.technicalMatching ? buildTechnicalMarkdown(c.technicalMatching) : '',
    c.careerMatching ? buildCareerMarkdown(c.careerMatching) : '',
    buildSimpleMarkdown(c, 'behavior'),
    c.performanceDetail ? buildPerformanceMarkdown(c.performanceDetail) : '',
    buildSimpleMarkdown(c, 'hav'),
    c.educationDetail ? buildEducationMarkdown(c.educationDetail) : '',
  ].filter(Boolean);
  return candidateHeader(c) + parts.join('\n\n') + (opts.ask === false ? '' : ASK);
}

/** Derivation pastes carry the same header/footer as a criterion paste. */
export function withAskWrapper(
  body: string,
  c?: CandidateProgressRow | null,
  opts: { ask?: boolean } = {},
): string {
  return (c ? candidateHeader(c) : '') + body + (opts.ask === false ? '' : ASK);
}
