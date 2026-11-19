'use client';

import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import {
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import {
  ArrowRight,
  AlertTriangle,
  Info,
  Cpu,
  Route,
  Smile,
  BarChart2,
  Grid3x3,
  GraduationCap,
  Search,
  ExternalLink,
  Sparkles,
  ShieldCheck,
  Calculator,
  X,
} from 'lucide-react';
import {
  type CandidateProgressRow,
  type ScoreBreakdown,
  type TechnicalPair,
  type CareerDetail,
  type CareerMatchStatus,
  type CareerMatchType,
  type CareerScoreBasis,
  type CareerUnscoredReason,
  type CompetencyBasis,
  type RequiredSource,
} from '@/lib/progress-running-actions';
import { DEFAULT_ASPECT_WEIGHTS } from '@/lib/scoring-criteria';
import { useIdentifierDisplay } from '@/components/app-mode-provider';
import { MASKED_CODE } from '@/lib/app-mode-shared';
import { CopyMarkdownButton } from '@/components/analysis/copy-markdown-button';
import { useAskAi } from '@/components/analysis/ask-ai-context';
import { criterionAnchorId, type AskPanel, type AskRef } from '@/lib/ask-ai-envelope';
import { EDU_TIER_LABEL, resolveEduTier } from '@/lib/education-tier';
import { computePaBreakdown, PA_IDEAL_NEGATIVE, PA_IDEAL_POSITIVE } from '@/lib/pa-topsis';
import { formatDateTime } from '@/lib/datetime';
import {
  buildAllCriteriaMarkdown,
  buildCareerDepthMarkdown,
  buildCareerPairMarkdown,
  buildCriterionMarkdown,
  buildEducationMarkdown,
  buildPerformanceMarkdown,
  buildTechnicalPairMarkdown,
  withAskWrapper,
} from '@/lib/scoring-explainer';

const LEVEL_LABELS: Record<number, string> = {
  1: 'Basic',
  2: 'Intermediate',
  3: 'Advance',
  4: 'Mastery',
};

const CRITERIA: { key: keyof NonNullable<CandidateProgressRow['scoreBreakdown']>; label: string }[] = [
  { key: 'technical', label: 'Technical' },
  { key: 'career', label: 'Career' },
  { key: 'behavior', label: 'Behavior' },
  { key: 'performance', label: 'Performance' },
  { key: 'hav', label: 'HAV' },
  { key: 'education', label: 'Education' },
];

function levelBadge(level: number) {
  return `L${level} · ${LEVEL_LABELS[level] ?? '?'}`;
}

/**
 * Which candidate and criterion the surrounding section is about.
 *
 * The nested blocks (CareerMatching, TechnicalMatching, EducationBlock,
 * PerformanceBlock) receive only their `detail` object — they have never needed
 * the candidate's identity. The "Tanya AI" action does: a chip has to say whose
 * numbers it carries and where to navigate back to. A context beats threading the
 * same three fields through four components that otherwise do not care.
 */
type CriterionScope = {
  candidateName: string;
  criterion: CriterionKey;
  anchor: string;
};
const CriterionScopeCtx = createContext<CriterionScope | null>(null);

/** Build a chip reference for the current section, or null when out of scope. */
function useAskRef(detail?: string, panel?: AskPanel): AskRef | null {
  const scope = useContext(CriterionScopeCtx);
  const { enabled, currentTab } = useAskAi();
  if (!scope || !enabled) return null;
  return {
    label: CRITERION_TITLES[scope.criterion],
    candidate: scope.candidateName,
    ...(detail ? { detail } : {}),
    ...(panel ? { panel } : {}),
    origin: { tab: currentTab, anchor: scope.anchor },
  };
}

/**
 * Reopen this panel when a chat chip navigates back to it.
 *
 * The signal lives in the provider rather than being consumed inline, because the
 * component that has to act on it is usually NOT mounted when the chip is clicked
 * — the tab it lives in mounts only after the switch. So it is state, matched here
 * on (anchor, kind), applied once, and cleared by whoever acted on it.
 *
 * `apply` is read from a ref so it never has to be a dependency: it closes over
 * component state and would otherwise re-run this on every render.
 */
function useReopenPanel(kind: AskPanel['kind'], apply: (key?: string | number) => void) {
  const scope = useContext(CriterionScopeCtx);
  const { reopen, clearReopen, trace } = useAskAi();
  const applyRef = useRef(apply);
  applyRef.current = apply;
  useEffect(() => {
    if (!reopen || !scope) return;
    // Only the near-miss is worth reporting: the right section, the wrong panel.
    // Every other panel on the page is a non-match by construction and would
    // bury the trace in dozens of lines.
    if (reopen.anchor === scope.anchor && reopen.panel?.kind !== kind) {
      trace('5. section reached, panel kind mismatch', {
        thisPanel: kind,
        chipWanted: reopen.panel?.kind ?? null,
      });
      return;
    }
    if (reopen.anchor !== scope.anchor || reopen.panel?.kind !== kind) return;
    trace('5. panel: OPENING', { kind, key: reopen.panel.key ?? null });
    applyRef.current(reopen.panel.key);
    clearReopen();
  }, [reopen, scope, kind, clearReopen, trace]);
}

// ── Derivation popups ──────────────────────────────────────────────
//
// Every number on this page is the end of an arithmetic chain, and until now the
// chain was only visible in the Konfigurasi tab as a general formula — which
// tells a reader how the criterion works but never how THIS candidate got THIS
// number. These dialogs close that gap: each opens on the figure itself and
// substitutes the candidate's own values into the formula, step by step, ending
// at the number that was clicked. A row that scored 0 explains why it scored 0,
// which is the case a formula alone cannot cover.

/** Monospace derivation block — same visual language as the Konfigurasi tab. */
function Derivation({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-md bg-muted/50 px-3 py-2.5 font-mono text-[10px] leading-relaxed whitespace-pre text-foreground/85">
      {children}
    </pre>
  );
}

function DerivStep({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] font-semibold text-foreground">{title}</p>
      <div className="mt-1 space-y-1.5 text-[11px] leading-relaxed text-muted-foreground">
        {children}
      </div>
    </div>
  );
}

/**
 * Shell every derivation shares — an INLINE expandable panel, deliberately not a
 * modal.
 *
 * It was a `Dialog`, and that was broken in the surface where it matters most.
 * `CriterionDetail` renders in two places: directly on the Readiness page, and
 * inside the criterion-chip `Dialog` in components/analysis/ahp-criterion-popup.tsx.
 * In the second one a derivation modal is a Radix Dialog nested inside a Radix
 * Dialog, and the outer modal's focus trap / `aria-hidden` / scroll-lock machinery
 * kept the inner one from ever appearing — clicking a figure did nothing at all.
 *
 * An inline panel has no portal, no focus trap and no z-index contest, so it
 * behaves identically in both surfaces. It also suits the content better: these
 * derivations are long-form tables and formula blocks, and the chip popup is
 * already a scrollable container.
 *
 * `open`/`onOpenChange` keep the modal-ish prop shape so every call site reads the
 * same, and the panel scrolls itself into view when it opens — it can render below
 * a long table, and an explanation the reader cannot see is the same as no
 * explanation.
 */
function DerivationPanel({
  open,
  onOpenChange,
  title,
  subtitle,
  children,
  copy,
  askRef,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  /**
   * Builds this derivation's Markdown. Every panel gets one: the figures behind
   * it are click targets now, so the numbers inside cannot be drag-selected —
   * this button is the only way to get them out. `ask` decides whether the
   * instruction for the assistant is appended.
   */
  copy?: (opts: { ask: boolean }) => string;
  /** Names this derivation on the chat chip; omit to hide the "Tanya AI" action. */
  askRef?: AskRef | null;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    // `nearest` rather than `center`: inside the chip dialog a centring scroll
    // yanks the whole panel around, and the point is only to make sure the newly
    // revealed block is on screen.
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [open]);

  if (!open) return null;

  return (
    <div
      ref={ref}
      className="mt-2 space-y-3 rounded-lg border border-primary/40 bg-primary/[0.03] p-3"
    >
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-primary/20 pb-2">
        <div className="min-w-0">
          <p className="text-xs font-bold text-foreground">{title}</p>
          {subtitle && (
            <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{subtitle}</p>
          )}
        </div>
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          className="inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="h-2.5 w-2.5" />
          Tutup
        </button>
      </div>
      {copy && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-primary/25 bg-background/60 px-2.5 py-2">
          <CopyMarkdownButton
            build={copy}
            askRef={askRef ?? undefined}
            label="Salin data"
          />
          <span className="text-[10px] leading-snug text-muted-foreground">
            <b>Salin data</b> menaruh angkanya saja di clipboard. <b>Tanya AI</b> mengirimkannya
            beserta permintaan penjelasan ke AI Assistant
          </span>
        </div>
      )}
      <div className="space-y-3.5">{children}</div>
    </div>
  );
}

/**
 * A figure that opens its own derivation. Rendered as a real button so it is
 * keyboard-reachable and announces itself — these are the page's primary
 * explanation affordance, not decoration.
 */
function ClickableFigure({
  onClick,
  className,
  children,
  label,
}: {
  onClick: () => void;
  className?: string;
  children: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        'group cursor-pointer text-left transition-colors',
        'hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
        className,
      )}
    >
      {children}
    </button>
  );
}

/** The "click me" hint, so the affordance is discoverable without hovering. */
function TapHint({ children = 'klik untuk penjabaran' }: { children?: string }) {
  return (
    <span className="inline-flex items-center gap-0.5 text-[9px] font-normal text-primary/70 group-hover:text-primary">
      <Calculator className="h-2.5 w-2.5" />
      {children}
    </span>
  );
}

function scoreBarTone(score: number): string {
  if (score >= 70) return 'bg-emerald-500';
  if (score >= 50) return 'bg-primary';
  if (score >= 30) return 'bg-amber-500';
  return 'bg-rose-500';
}

// ── Reusable criterion section wrapper ─────────────────────────────

function CriterionSection({
  icon: Icon,
  title,
  score,
  children,
  copy,
  askRef,
  anchorId,
  scope,
}: {
  icon: React.ElementType;
  title: string;
  score?: number | null;
  children: React.ReactNode;
  /** Builds the criterion's Markdown summary; omitted when there is nothing to copy. */
  copy?: (opts: { ask: boolean }) => string;
  /** Names this criterion on the chat chip; omit to hide the "Tanya AI" action. */
  askRef?: AskRef | null;
  /** DOM id a chat chip scrolls back to. */
  anchorId?: string;
  /**
   * Candidate + criterion identity for the nested blocks. Provided here because
   * this component is the single wrapper every branch of CriterionDetail's switch
   * returns — putting it here needs no restructuring of that switch.
   */
  scope?: CriterionScope | null;
}) {
  const body = (
    <section id={anchorId} className="scroll-mt-4 rounded-lg border bg-card">
      <header className="flex flex-wrap items-center gap-2 border-b bg-muted/30 px-3 py-2">
        <Icon className="h-3.5 w-3.5 text-primary" />
        <h4 className="text-[11px] font-bold uppercase tracking-wider text-foreground/80">{title}</h4>
        {/* Sits in the header so it is reachable without opening any dialog —
            this is the summary a user most often wants to ask about. */}
        {copy && (
          <CopyMarkdownButton build={copy} askRef={askRef ?? undefined} className="ml-1" />
        )}
        {score != null && (
          <span className="ml-auto flex items-center gap-2">
            <span className="hidden h-1.5 w-24 overflow-hidden rounded-full bg-muted sm:block">
              <span
                className={cn('block h-full rounded-full', scoreBarTone(score))}
                style={{ width: `${Math.max(0, Math.min(100, score))}%` }}
              />
            </span>
            <Badge variant="outline" className="text-[10px] tabular-nums">
              {score}/100
            </Badge>
          </span>
        )}
      </header>
      <div className="p-3">{children}</div>
    </section>
  );
  return scope ? (
    <CriterionScopeCtx.Provider value={scope}>{body}</CriterionScopeCtx.Provider>
  ) : (
    body
  );
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-md border border-dashed bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground">
      {children}
    </p>
  );
}

// ── Technical matching table ───────────────────────────────────────

/**
 * How a pair's cell value was arrived at — `sim′ × levelFactor`. Shown on hover
 * rather than inline because the table's job is the ranking, but a number nobody
 * can decompose is a number nobody can argue with. Returns undefined for runs
 * scored before the breakdown was recorded, so old runs simply show no tooltip
 * instead of a fabricated one.
 */
function pairBreakdown(p: TechnicalPair): string | undefined {
  if (p.matchType === 'unmeasurable')
    return 'Kompetensi ini tidak ada di kamus dan tidak ada kandidat yang memegang namanya — tidak dapat dinilai, sehingga dikeluarkan dari pembagi.';
  if (p.matchType === 'unmatched') return 'Tidak ada kompetensi kandidat yang dipasangkan — nilai 0.';
  if (p.levelFactor == null) return undefined;
  const parts: string[] = [];
  if (p.matchType === 'semantic') {
    const raw = p.similarityRaw != null ? ` (cosine mentah ${p.similarityRaw.toFixed(3)})` : '';
    parts.push(`kemiripan ${(p.similarity ?? 0).toFixed(3)}${raw}`);
  } else {
    parts.push(
      p.matchType === 'code'
        ? 'identitas via kode kamus (bukan kemiripan embedding)'
        : 'identitas, nama sama persis',
    );
  }
  parts.push(
    p.levelUnknown
      ? 'level 1.000 (netral — proficiency kandidat belum diasesmen)'
      : `level ${p.levelFactor.toFixed(3)}`,
  );
  return `${parts.join(' × ')} = ${p.value.toFixed(3)}`;
}

function matchTone(t: TechnicalPair['matchType']): string {
  if (t === 'exact' || t === 'code')
    return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400';
  if (t === 'semantic') return 'border-sky-500/40 bg-sky-500/10 text-sky-600 dark:text-sky-400';
  if (t === 'unmeasurable') return 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400';
  return 'border-muted-foreground/30 bg-muted text-muted-foreground';
}
const matchLabel: Record<TechnicalPair['matchType'], string> = {
  exact: 'Exact',
  code: 'Identik (kamus)',
  semantic: 'Semantic',
  unmatched: 'Tidak cocok',
  unmeasurable: 'Tidak dapat diukur',
};

/**
 * One competency pairing, fully derived. Five outcomes with genuinely different
 * arithmetic: identity by name, identity by kamus code, semantic similarity,
 * no pairing at all, and a column nothing could ever score. The last two have no
 * number to derive — only a reason, which is exactly the case a formula in the
 * Konfigurasi tab cannot cover.
 */
function TechnicalPairDerivation({
  p,
  detail,
}: {
  p: TechnicalPair;
  detail: NonNullable<CandidateProgressRow['technicalMatching']>;
}) {
  const ids = useIdentifierDisplay();
  const divisor = detail.effectiveRequiredCount ?? detail.requiredCount;
  const isIdentity = p.matchType === 'exact' || p.matchType === 'code';
  const gap = p.candidate ? p.candidate.level - p.required.level : null;

  return (
    <>
      <DerivStep title="1. Yang dibandingkan">
        <Derivation>
          {`  Dituntut posisi :  ${p.required.name}
                     ${levelBadge(p.required.level)}${p.required.code ? `  ·  kode kamus ${ids.code(p.required.code)}` : '  ·  (tidak ada di kamus)'}

  Dimiliki kandidat:  ${p.candidate ? p.candidate.name : '— tidak ada pasangan —'}${
    p.candidate
      ? `\n                     ${p.levelUnknown ? 'level belum diasesmen' : levelBadge(p.candidate.level)}${p.candidate.code ? `  ·  kode kamus ${ids.code(p.candidate.code)}` : '  ·  (tidak ada di kamus)'}`
      : ''
  }`}
        </Derivation>
        <p>
          Pasangan ini ditentukan lebih dulu oleh <b>identitas</b> (kode kamus sama, atau nama sama
          persis bila keduanya tidak ada di kamus), lalu sisanya baru dipasangkan satu-lawan-satu
          oleh Hungarian berdasarkan kemiripan makna. Identitas diselesaikan sebelum Hungarian
          justru supaya pasangan yang jelas benar tidak bisa ditukar demi menaikkan total.
        </p>
      </DerivStep>

      {p.matchType === 'unmeasurable' && (
        <DerivStep title="2. Kompetensi ini tidak dapat diukur — dan dikeluarkan dari pembagi">
          <p className="rounded-md bg-amber-500/10 px-2.5 py-2 text-amber-700 dark:text-amber-300">
            Kompetensi yang dituntut ini <b>tidak ada di kamus kompetensi</b> (sehingga tidak punya
            vektor level, dan setiap sel kemiripannya pasti 0) <b>dan</b> tidak ada satu pun
            kompetensi kandidat yang identitasnya sama. Kolom ini dijamin 0 untuk{' '}
            <b>setiap</b> kandidat, jadi membiarkannya di pembagi hanya akan menekan skor semua orang
            karena kamusnya belum lengkap — bukan karena kandidatnya.
          </p>
          <Derivation>
            {`  nilai pasangan  =  0
  masuk pembagi   =  TIDAK

  pembagi M       =  ${divisor}  (dari ${detail.requiredCount} kompetensi yang dituntut,
                     ${detail.requiredCount - divisor} dikeluarkan karena tidak dapat diukur)`}
          </Derivation>
          <p>
            Biasanya ini kompetensi perilaku yang tertulis di job profile sebagai kompetensi teknis —
            &ldquo;Leadership&rdquo;, &ldquo;Communication&rdquo;, &ldquo;Problem Solving&rdquo;.
            Pasangannya tetap ditampilkan, bukan disembunyikan, supaya terlihat bahwa posisinya
            menuntut sesuatu yang belum terdefinisi di kamus.
          </p>
        </DerivStep>
      )}

      {p.matchType === 'unmatched' && (
        <DerivStep title="2. Tidak ada pasangan — nilainya 0">
          <p className="rounded-md bg-amber-500/10 px-2.5 py-2 text-amber-700 dark:text-amber-300">
            {detail.candidateCount === 0
              ? 'Kandidat tidak punya data kompetensi teknis sama sekali (N=0), sehingga matriks Hungarian tidak punya baris untuk dipasangkan. Ini kekosongan data sumber, bukan hasil penilaian.'
              : `Seluruh ${detail.candidateCount} kompetensi kandidat sudah terpakai untuk kolom lain (setiap kompetensi hanya boleh melayani satu kolom), atau tidak ada yang cukup mirip untuk dipasangkan. Kolom ini tidak mendapat pasangan.`}
          </p>
          <Derivation>
            {`  nilai pasangan  =  0
  masuk pembagi   =  YA  (kompetensi ini bisa diukur, hanya tidak tertutupi)

  pembagi M       =  ${divisor}`}
          </Derivation>
          <p>
            Berbeda dengan &ldquo;tidak dapat diukur&rdquo; di atas: kolom ini{' '}
            <b>tetap dihitung</b> di pembagi, karena kompetensinya memang terdefinisi dan kandidat
            ini benar-benar tidak menutupinya. Itu temuan tentang kandidat, bukan tentang kamus.
          </p>
        </DerivStep>
      )}

      {(isIdentity || p.matchType === 'semantic') && (
        <>
          <DerivStep title="2. Kemiripan (sim′)">
            {isIdentity ? (
              <>
                <Derivation>
                  {`  sim′  =  1.000

  ${
    p.matchType === 'code'
      ? 'Identitas lewat KODE KAMUS: kedua nama ditulis berbeda, tetapi\n  resolver memastikan keduanya entri kamus yang sama.'
      : 'Identitas lewat NAMA: kedua nama sama persis setelah normalisasi.'
  }
  Tidak ada embedding yang dilibatkan — keduanya memang kompetensi
  yang sama, jadi tidak ada yang perlu ditaksir.`}
                </Derivation>
                <p>
                  Inilah sebabnya identitas selalu ≥ pasangan yang hanya mirip: sim′-nya 1,000 tanpa
                  taksiran, dan hanya pasangan identitas yang berhak atas bonus melebihi level.
                </p>
              </>
            ) : (
              <>
                <Derivation>
                  {`  cosine mentah  =  ${p.similarityRaw?.toFixed(4) ?? '—'}

  sim′  =  ( cosine − ${detail.simFloor ?? '?'} ) ÷ ( ${detail.simCeil ?? '?'} − ${detail.simFloor ?? '?'} )   dipotong 0–1
        =  ${p.similarity?.toFixed(3) ?? '—'}`}
                </Derivation>
                <p>
                  Cosine mentah <b>tidak boleh dibaca sebagai persentase</b>. Diukur atas seluruh
                  kamus, setiap kompetensi punya kompetensi LAIN yang duduk di sekitar 0,72–0,86 —
                  jadi nilai mentah akan memberi 72–86 poin untuk pasangan yang sama sekali salah.
                  Kedua batas itu dihitung dari isi kamus dan berubah bila kamusnya di-embed ulang;
                  asalnya dijelaskan di tab Konfigurasi → Technical Competency.
                </p>
                {p.similarity === 0 && (
                  <p className="rounded-md bg-amber-500/10 px-2.5 py-2 text-amber-700 dark:text-amber-300">
                    <b>sim′ = 0.</b> Cosine-nya berada di bawah batas bawah, artinya pasangan ini
                    tidak lebih mirip daripada sepasang kompetensi kamus yang diambil sembarang —
                    sehingga tidak dihitung sebagai bukti cakupan sama sekali.
                  </p>
                )}
              </>
            )}
          </DerivStep>

          <DerivStep title="3. Faktor level">
            {p.levelUnknown ? (
              <>
                <Derivation>{`  faktor level  =  1.000   (NETRAL)`}</Derivation>
                <p className="rounded-md bg-amber-500/10 px-2.5 py-2 text-amber-700 dark:text-amber-300">
                  Proficiency kandidat tercatat kosong, <span className="font-mono">#N/A</span>, atau{' '}
                  <span className="font-mono">NOT ASSESSED</span>. Selisih level tidak dapat
                  dihitung, jadi faktornya dibuat netral — tidak menambah dan tidak mengurangi.
                  Menganggapnya level 1 akan <b>melaporkan kekurangan yang datanya tidak pernah
                  menyatakan</b>. Angka ini menandakan asesmen yang belum lengkap, bukan kompetensi
                  yang kurang.
                </p>
              </>
            ) : gap != null && gap >= 0 ? (
              <>
                <Derivation>
                  {`  level kandidat (k) = ${p.candidate!.level}   ≥   level dituntut (t) = ${p.required.level}

${
  isIdentity
    ? `  Pasangan IDENTITAS → berhak bonus melebihi level:

    faktor  =  min( 1 + 0.75 × ( k − t ) ÷ 3 , 1.75 )
            =  min( 1 + 0.75 × ${gap} ÷ 3 , 1.75 )
            =  ${p.levelFactor?.toFixed(3) ?? '—'}`
    : `  Pasangan hanya MIRIP → diplafon 1.000, tanpa bonus:

    faktor  =  1.000

  Melebihi target pada kompetensi yang sebenarnya tidak diminta
  posisi bukan kelebihan yang perlu dibayar, dan plafon ini yang
  menjaga identitas tetap di atas kemiripan belaka.`
}`}
                </Derivation>
                {isIdentity && gap > 0 && (
                  <p>
                    Bonus melebihi level maksimal <b>+75%</b> (plafon 1,75), tercapai penuh saat
                    kandidat tiga level di atas tuntutan. Sebelumnya bonus ini hanya +25%, yang
                    membuat kandidat jauh di atas tuntutan hampir tidak berbeda nilainya dari yang
                    sekadar memenuhi — kedalaman penguasaan nyaris tidak terlihat pada skor.
                  </p>
                )}
              </>
            ) : gap != null ? (
              <>
                <Derivation>
                  {`  level kandidat (k) = ${p.candidate!.level}   <   level dituntut (t) = ${p.required.level}

    faktor  =  maks( 0 , 1 − ( t − k ) ÷ 4 )
            =  maks( 0 , 1 − ${-gap} ÷ 4 )
            =  ${p.levelFactor?.toFixed(3) ?? '—'}      → kurang ${-gap} level`}
                </Derivation>
                <p>
                  Pembaginya <b>4, bukan 3</b>, supaya kekurangan terparah (level 1 melawan tuntutan
                  Mastery) masih menyisakan seperempat kredit. Memegang kompetensinya meski tiga
                  level di bawah <b>bukan</b> hal yang sama dengan tidak memegangnya sama sekali —
                  kandidatnya terbukti punya hal yang diminta, hanya belum cukup dalam.
                </p>
                <p>
                  Level dibaca sebagai tangga urutan (Basic → Intermediate → Advance → Mastery),
                  jadi hanya <b>selisihnya</b> yang bermakna. Rasio (k ÷ t) akan menyatakan bahwa
                  Mastery itu &ldquo;dua kali&rdquo; Intermediate, yang tidak pernah diklaim kamus.
                </p>
              </>
            ) : null}
          </DerivStep>

          <DerivStep title="4. Nilai pasangan dan kontribusinya ke skor">
            <Derivation>
              {`  nilai pasangan  =  sim′  ×  faktor level
                  =  ${(p.similarity ?? 0).toFixed(3)}  ×  ${p.levelFactor?.toFixed(3) ?? '—'}
                  =  ${p.value.toFixed(3)}

  skor Technical  =  min( Σ nilai seluruh pasangan ÷ M , 1 )  × 100
                  =  min( ... ÷ ${divisor} , 1 ) × 100
                  =  ${detail.score}          Σ/M = ${(detail.normalizedRaw ?? detail.normalized).toFixed(3)}${
    (detail.normalizedRaw ?? detail.normalized) > 1 ? `  →  dijenuhkan ke 1,000` : ''
  }

  Kontribusi baris ini  =  ${p.value.toFixed(3)} ÷ ${divisor} × 100  =  ${divisor > 0 ? ((p.value / divisor) * 100).toFixed(1) : '—'} poin`}
            </Derivation>
            {(detail.normalizedRaw ?? detail.normalized) > 1 && (
              <p>
                Σ/M mentah di atas 1,000 memang mungkin — bonus melebihi level bisa membuat satu
                pasangan bernilai sampai 1,75 — tetapi <b>agregatnya dijenuhkan pada 1</b>, jadi
                skor Technical berhenti di 100. Surplusnya bersifat kompensatoris: ia boleh menutup
                kekurangan level pada kompetensi lain, tidak boleh membuat kandidat lebih dari
                &quot;memenuhi seluruh tuntutan&quot;. Kelebihan {(detail.normalizedRaw ?? 1).toFixed(3)} di
                atas 1,000 tetap ditampilkan di sini sebagai temuan kedalaman penguasaan.
              </p>
            )}
            {detail.score > 100 && (
              <p className="rounded-md bg-amber-500/10 px-2 py-1.5 text-[10px] leading-relaxed text-amber-700 dark:text-amber-300">
                <span className="font-semibold">Aturan lama.</span> Run ini selesai sebelum agregat
                Technical dijenuhkan pada 100, jadi skornya tersimpan {detail.score}. Nilainya tidak
                ditulis ulang — sebuah run adalah catatan penilaian pada tanggal tertentu — sehingga
                skor Technical run ini tidak sebanding langsung dengan run sesudah perubahan.
              </p>
            )}
          </DerivStep>
        </>
      )}
    </>
  );
}

function TechnicalMatching({ detail }: { detail: NonNullable<CandidateProgressRow['technicalMatching']> }) {
  const ids = useIdentifierDisplay();
  // Identity covers both: same literal name, and different spellings the
  // resolver established as one kamus entry. They are one thing to the score.
  const exact = detail.pairs.filter(
    (p) => p.matchType === 'exact' || p.matchType === 'code',
  ).length;
  const byCode = detail.pairs.filter((p) => p.matchType === 'code').length;
  const semantic = detail.pairs.filter((p) => p.matchType === 'semantic').length;
  const unmatched = detail.pairs.filter((p) => p.matchType === 'unmatched').length;
  const unmeasurable = detail.pairs.filter((p) => p.matchType === 'unmeasurable').length;
  // The divisor is M minus the unmeasurable columns. Printing plain "M" when
  // those two differ would misstate what the normalisation actually divided by.
  const divisor = detail.effectiveRequiredCount ?? detail.requiredCount;

  const [openPair, setOpenPair] = useState<number | null>(null);
  const activePair = openPair != null ? detail.pairs[openPair] : undefined;
  const askRefPair = useAskRef(
    activePair ? `pasangan kompetensi "${activePair.required.name}"` : undefined,
    openPair != null ? { kind: 'technical-pair', key: openPair } : undefined,
  );
  useReopenPanel('technical-pair', (key) => {
    if (typeof key === 'number') setOpenPair(key);
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-muted-foreground">
          Normalisasi Σ/M = {detail.normalized.toFixed(3)} · Kandidat N={detail.candidateCount} · Required M=
          {divisor === detail.requiredCount
            ? detail.requiredCount
            : `${divisor} (dari ${detail.requiredCount}, ${detail.requiredCount - divisor} tidak dapat diukur)`}
        </span>
        <span className="ml-auto flex gap-1.5">
          <Badge variant="outline" className={matchTone('exact')}>
            Identitas {exact}
            {byCode > 0 ? ` (${byCode} via kamus)` : ''}
          </Badge>
          <Badge variant="outline" className={matchTone('semantic')}>Semantic {semantic}</Badge>
          <Badge variant="outline" className={matchTone('unmatched')}>Kosong {unmatched}</Badge>
          {unmeasurable > 0 && (
            <Badge variant="outline" className={matchTone('unmeasurable')}>Tak terukur {unmeasurable}</Badge>
          )}
        </span>
      </div>

      {/* The semantic tier's scale is not a raw cosine, and a reader who assumes
          it is will read every semantic pair as far stronger than it was. */}
      {detail.simFloor != null && detail.simCeil != null && semantic > 0 && (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Nilai per pasangan = kemiripan × faktor level. Kemiripan semantik direntangkan ke 0–1 dari
          cosine {detail.simFloor}–{detail.simCeil}: di bawah {detail.simFloor} tidak dianggap bukti
          cakupan, di {detail.simCeil} ke atas dianggap padanan sejati. Faktor level menghukum level
          kandidat di bawah kebutuhan dan dibatasi 1,0 untuk pasangan non-identik.
        </p>
      )}

      {/* Pairs whose level term was neutralised. Reported, never scored as a
          shortfall — an unknown is not a finding. */}
      {(detail.levelUnknownPairs ?? 0) > 0 && (
        <p className="flex items-start gap-2 rounded-md bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-700 dark:text-amber-300">
          <span>
            {detail.levelUnknownPairs} pasangan memakai faktor level netral karena proficiency
            kandidat belum diasesmen (NULL / #N/A / NOT ASSESSED). Gap level tidak dapat dihitung,
            sehingga tidak dihukum — angka ini menandakan data asesmen yang belum lengkap, bukan
            kompetensi yang kurang.
          </span>
        </p>
      )}

      {/* The reference set is not always the job profile. When it came from the
          incumbent(s), the candidate is being measured against people rather than
          a document — that has to be visible on the score, not buried in a log. */}
      {detail.requiredSource && detail.requiredSource !== 'profile' && (
        <p className="flex items-start gap-2 rounded-md bg-sky-500/10 px-3 py-2 text-[11px] leading-relaxed text-sky-700 dark:text-sky-300">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Acuan kompetensi berasal dari <b>{requiredSourceText(detail.requiredSource)}</b>, bukan job
            profile.{detail.requiredSourceDetail ? ` ${detail.requiredSourceDetail}` : ''}
          </span>
        </p>
      )}

      {/* N=0 → the Hungarian matrix has no rows at all. Say so explicitly: the
          table below would otherwise read as "matching ran and found nothing",
          when in fact the candidate carries no competency data to match. */}
      {detail.candidateCount === 0 && detail.requiredCount > 0 && (
        <p className="flex items-start gap-2 rounded-md bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-700 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Kandidat tidak memiliki data kompetensi teknis sama sekali (N=0) — pencocokan Hungarian
            tidak punya bahan pembanding, sehingga seluruh {detail.requiredCount} kompetensi required
            otomatis &quot;Tidak cocok&quot; dan skor Technical = 0. Ini kekosongan data sumber untuk employee ini,
            bukan hasil penilaian.
          </span>
        </p>
      )}

      {detail.pairs.length === 0 ? (
        <EmptyNote>Tidak ada kompetensi required untuk posisi ini.</EmptyNote>
      ) : (
        /* Reflowing pair list rather than a fixed-width table: this renders in
           narrow columns too (the Readiness tab sits beside a 12rem tab rail),
           where a 4-column table could only fit by scrolling sideways. Each
           pair wraps its own columns instead. */
        <div className="divide-y rounded-lg border text-xs">
          {detail.pairs.map((p, i) => (
            <ClickableFigure
              key={i}
              onClick={() => setOpenPair(i)}
              label={`Lihat penjabaran nilai pasangan ${p.required.name}`}
              className="flex w-full flex-wrap items-start gap-x-4 gap-y-2 px-3 py-2.5"
            >
              {/* Required ▸ candidate. basis keeps them side by side while there
                  is room, and stacks them once there isn't. */}
              <div className="min-w-0 flex-1 basis-56">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Required kompetensi posisi
                </p>
                <p className="wrap-break-word font-medium text-foreground/90">{p.required.name}</p>
                <p className="text-[10px] text-muted-foreground">
                  {levelBadge(p.required.level)}
                  {p.required.code ? ` · ${ids.code(p.required.code)}` : ' · (tanpa kamus)'}
                </p>
              </div>

              <div className="min-w-0 flex-1 basis-56">
                <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <ArrowRight className="h-3 w-3 shrink-0" />
                  Kompetensi kandidat (Hungarian)
                </p>
                {p.candidate ? (
                  <>
                    <p className="wrap-break-word font-medium text-foreground/90">{p.candidate.name}</p>
                    {/* An unreadable proficiency must not read as a level-1
                        finding — the level term was left neutral, and saying so
                        is the difference between "belum diasesmen" and "kurang". */}
                    <p className="text-[10px] text-muted-foreground">
                      {p.levelUnknown ? 'Level belum diasesmen' : levelBadge(p.candidate.level)}
                    </p>
                  </>
                ) : (
                  <p className="text-muted-foreground">—</p>
                )}
              </div>

              {/* Match type + value stay together on one line and wrap as a unit. */}
              <div className="flex shrink-0 items-center gap-2 sm:ml-auto">
                <Badge variant="outline" className={cn('text-[10px]', matchTone(p.matchType))}>
                  {matchLabel[p.matchType]}
                </Badge>
                <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn(
                      'h-full rounded-full',
                      p.matchType === 'exact' ? 'bg-emerald-500' : p.matchType === 'semantic' ? 'bg-sky-500' : 'bg-muted-foreground/40',
                    )}
                    style={{ width: `${Math.round(Math.max(0, Math.min(1, p.value)) * 100)}%` }}
                  />
                </div>
                <span
                  className="w-9 text-right tabular-nums text-foreground/80"
                  title={pairBreakdown(p)}
                >
                  {p.value.toFixed(2)}
                </span>
              </div>

              <div className="w-full text-right opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                <TapHint />
              </div>
            </ClickableFigure>
          ))}
        </div>
      )}

      {/* Surplus: candidate competencies Hungarian left unpaired (N>M). Shown so
          the full candidate inventory is visible even though they score 0. */}
      {detail.surplusCandidates && detail.surplusCandidates.length > 0 && (
        <div className="rounded-md border border-dashed border-muted-foreground/30 bg-muted/20 px-3 py-2">
          <p className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
            <Info className="h-3.5 w-3.5" />
            Kompetensi kandidat tanpa pasangan ({detail.surplusCandidates.length}) — N&gt;M, tidak masuk perhitungan (nilai 0)
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {detail.surplusCandidates.map((s, i) => (
              <Badge key={i} variant="outline" className="text-[10px] font-normal text-foreground/80">
                {s.name} · {levelBadge(s.level)}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {activePair && (
        <DerivationPanel
          open
          onOpenChange={(v) => !v && setOpenPair(null)}
          title={activePair.required.name}
          subtitle={
            activePair.matchType === 'unmeasurable' || activePair.matchType === 'unmatched'
              ? 'Pasangan ini bernilai 0 — sebabnya di bawah.'
              : `Nilai pasangan ${activePair.value.toFixed(3)} — asal angkanya.`
          }
          copy={(o) => withAskWrapper(buildTechnicalPairMarkdown(activePair, detail), null, o)}
          askRef={askRefPair}
        >
          <TechnicalPairDerivation p={activePair} detail={detail} />
        </DerivationPanel>
      )}
    </div>
  );
}

// ── Career matching table ──────────────────────────────────────────

function careerTone(s: CareerMatchStatus): string {
  if (s === 'ok') return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400';
  if (s === 'no_embedding') return 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400';
  return 'border-muted-foreground/30 bg-muted text-muted-foreground';
}
const careerLabel: Record<CareerMatchStatus, string> = {
  ok: 'Cocok',
  no_match: 'Tanpa pasangan',
  no_embedding: 'Belum di-embed',
};

// How a position resolved to a comparable representation. The first four mirror
// the Job Family Sync matcher; the last three are the profile-less fallbacks.
const careerMatchTypeLabel: Record<CareerMatchType, string> = {
  filename: 'kode file_name',
  jfm: 'job_family_matches',
  exact: 'judul sama',
  embedding: 'embedding > 98%',
  incumbent_competency: 'kompetensi incumbent',
  incumbent_position: 'posisi incumbent',
  pseudo_profile: 'dokumen sintetis',
};

// Which path actually produced the number in the Similarity column.
const basisLabel: Record<CareerScoreBasis, string> = {
  document: 'dokumen',
  incumbent_competency: 'fallback kompetensi',
  unscored: 'tidak dinilai',
};
function basisTone(b: CareerScoreBasis): string {
  if (b === 'document') return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400';
  if (b === 'incumbent_competency')
    return 'border-sky-500/40 bg-sky-500/10 text-sky-600 dark:text-sky-400';
  return 'border-muted-foreground/30 bg-muted text-muted-foreground';
}

// Why a stint contributed 0. Three different failures pointing at three
// different places to fix, so they are never collapsed into one sentence.
const unscoredReasonLabel: Record<CareerUnscoredReason, string> = {
  no_target_reference: 'posisi target tanpa acuan kompetensi',
  no_position_code: 'stint tanpa kode posisi',
  no_incumbent_competency: 'pemegang posisi tanpa data kompetensi',
};
const unscoredReasonHelp: Record<CareerUnscoredReason, string> = {
  no_target_reference:
    'Posisi target tidak punya acuan kompetensi sama sekali (job profile, daftar kompetensi posisi, incumbent, dan pemegang posisi semuanya kosong), sehingga fallback tidak dapat dijalankan untuk stint mana pun.',
  no_position_code:
    'Stint hanya tercatat sebagai judul tanpa kode posisi. Pemegang posisi dicari lewat kode, jadi tidak ada kunci untuk mencarinya — umum untuk riwayat di perusahaan luar.',
  no_incumbent_competency:
    'Kode posisinya diketahui, namun tidak ada pemegang yang dapat dipakai (posisi kosong, atau hanya kandidat itu sendiri) atau pemegangnya tidak punya baris di sync_technical_competencies.',
};

// Which assessment rows represented the incumbent, weakest evidence last.
const competencyBasisLabel: Record<CompetencyBasis, string> = {
  position_column: 'asesmen tercatat atas posisi itu',
  create_date_window: 'asesmen dibuat saat menjabat',
  active_all: 'asesmen aktif terkini (bukan periode menjabat)',
};

// Where the target's reference competency set came from.
const requiredSourceLabel: Record<RequiredSource, string> = {
  profile: 'job profile',
  critical_position: 'kompetensi posisi',
  incumbent: 'kompetensi incumbent',
  position_aggregate: 'gabungan pemegang posisi',
  none: 'tidak ada acuan',
};
/** Label lookup that tolerates older runs (field absent) and unknown values. */
function requiredSourceText(source: string | null | undefined): string {
  return requiredSourceLabel[(source ?? 'profile') as RequiredSource] ?? String(source);
}

/**
 * Where the depth yardstick came from. `pool` can only appear on runs made before
 * the yardstick became absolute, and its label has to say so — a pool-derived T
 * shrank when the bench was weak, so those scores read higher than a later run's
 * for the same person.
 */
const depthSourceLabel: Record<NonNullable<CareerDetail['targetSource']>, string> = {
  // One entry per source. This literal used to repeat `jd` and `fixed` (two
  // merged versions of the map); the later `fixed` text is the one that has
  // always rendered, so it is the one kept.
  jd: 'syarat pengalaman di job profile jabatan sasaran — absolut',
  measured: 'diukur dari pengangkatan nyata pada tingkat jabatan ini — absolut',
  fixed: 'angka tetap konfigurasi — satu-satunya yang tidak diturunkan dari data',
  inherited: 'diwarisi dari run dasar (run inkremental)',
  pool: 'aturan lama: median pool kandidat run itu (skor relatif terhadap peserta, tidak sebanding dengan run baru)',
};

type CareerPairRow = CareerDetail['pairs'][number];

/**
 * A stint's contribution to the years axis, as the ENGINE computed it.
 *
 * Never recompute this as `sim' x years`. That was right until recency decay
 * arrived and is now wrong by exactly the decay factor -- worst precisely where
 * it matters, on the old stints whose demotion is the point. The product is only
 * a fallback for runs that predate the stored field, where the two agree anyway.
 */
function stintEffectiveYears(p: CareerPairRow): number {
  return p.effectiveYears ?? (p.similarity ?? 0) * p.years;
}

/** A stint's contribution to the breadth axis: sim' after decay. */
function stintEffectiveRows(p: CareerPairRow): number {
  return (p.similarity ?? 0) * (p.recencyFactor ?? 1);
}

/** The decay factor spelled out, only when it actually cost something. */
function recencyExpr(p: CareerPairRow): string {
  if (p.recencyFactor == null || p.recencyFactor >= 0.995) return '';
  return ` x ${p.recencyFactor.toFixed(3)}`;
}

// The three cells of a history row, factored out so the wide (table) and narrow
// (stacked) layouts below render identical content instead of drifting apart.

/**
 * A stint's title as displayed. The engine titles an untitled stint with its
 * position code; demo mode shows no code, so that title is masked too.
 */
function stintTitle(p: CareerPairRow, demo: boolean): string {
  return demo && p.positionId && p.title === p.positionId ? MASKED_CODE : p.title;
}

function CareerPairTitle({ p }: { p: CareerPairRow }) {
  const ids = useIdentifierDisplay();
  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-medium wrap-break-word text-foreground/90">{stintTitle(p, ids.demo)}</span>
        {p.isCurrent && (
          <Badge variant="outline" className="border-primary/40 bg-primary/10 px-1 py-0 text-[9px] text-primary">
            saat ini
          </Badge>
        )}
      </div>
      <div className="text-[10px] wrap-break-word text-muted-foreground">
        {p.positionId ? `pos ${ids.code(p.positionId)}` : '(tanpa position_id)'}
        {p.companyId ? ` · ${ids.code(p.companyId)}` : ''}
      </div>
    </>
  );
}

function CareerPairComparator({ p, basis }: { p: CareerPairRow; basis: CareerScoreBasis }) {
  const ids = useIdentifierDisplay();
  if (basis === 'incumbent_competency') {
    // Scored from the incumbent's competencies, not a document — show whose,
    // from which assessment, and the raw coverage before calibration so the
    // number can be audited.
    return (
      <div className="min-w-0">
        <div className="font-medium wrap-break-word text-foreground/90">
          Kompetensi incumbent
          {p.fallbackEmployeeIds?.length ? ` (${p.fallbackEmployeeIds.map(ids.npk).join(', ')})` : ''}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-1">
          <Badge variant="outline" className={cn('text-[9px]', basisTone('incumbent_competency'))}>
            {basisLabel.incumbent_competency}
          </Badge>
          {p.fallbackBasis && (
            <Badge variant="outline" className="px-1 py-0 text-[9px] text-muted-foreground">
              {competencyBasisLabel[p.fallbackBasis]}
            </Badge>
          )}
          {p.fallbackRaw != null && (
            <span className="text-[10px] tabular-nums text-muted-foreground">
              Σ/M = {p.fallbackRaw.toFixed(3)} → kalibrasi
            </span>
          )}
        </div>
      </div>
    );
  }

  if (p.status === 'ok' || p.status === 'no_embedding') {
    return (
      <div className="min-w-0">
        <div className="font-medium wrap-break-word text-foreground/90">{p.jobProfileName ?? `#${p.jobProfileId}`}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-1">
          <Badge variant="outline" className={cn('text-[9px]', careerTone(p.status))}>
            {careerLabel[p.status]}
          </Badge>
          {p.matchType && (
            <Badge variant="outline" className="px-1 py-0 text-[9px] text-muted-foreground">
              {careerMatchTypeLabel[p.matchType]}
            </Badge>
          )}
        </div>
      </div>
    );
  }

  // Unscored. The status badge alone only says "no job profile" — which is also
  // true of every rescued stint — so name why the fallback could not save it.
  return (
    <div className="min-w-0 space-y-1">
      <Badge variant="outline" className={cn('text-[10px]', careerTone(p.status))}>
        {careerLabel[p.status]}
      </Badge>
      {basis === 'unscored' && p.unscoredReason && (
        <div className="text-[10px] leading-relaxed wrap-break-word text-muted-foreground">
          {unscoredReasonHelp[p.unscoredReason]}
        </div>
      )}
    </div>
  );
}

function CareerPairSimilarity({ p, basis }: { p: CareerPairRow; basis: CareerScoreBasis }) {
  return (
    <div className="min-w-0">
      {p.similarity != null ? (
        <div className="flex items-center justify-end gap-2">
          <div className="h-1.5 w-14 shrink-0 overflow-hidden rounded-full bg-muted sm:w-20">
            <div
              className={cn(
                'h-full rounded-full',
                basis === 'incumbent_competency' ? 'bg-sky-500' : 'bg-emerald-500'
              )}
              style={{ width: `${Math.round(Math.max(0, Math.min(1, p.similarity)) * 100)}%` }}
            />
          </div>
          <span className="w-9 shrink-0 text-right tabular-nums text-foreground/80">{p.similarity.toFixed(2)}</span>
        </div>
      ) : (
        <span className="block text-right text-muted-foreground">—</span>
      )}
      {/* The bar above is the RESCALED value that actually scores. The raw cosine
          it came from is kept visible so the stretch can be audited rather than
          taken on trust. */}
      {p.similarity != null && p.similarityRaw != null && (
        <div className="mt-0.5 text-right text-[10px] tabular-nums text-muted-foreground">
          cosine {p.similarityRaw.toFixed(3)}
          {p.effectiveYears != null ? ` · ${p.effectiveYears.toFixed(2)} th efektif` : ''}
        </div>
      )}
    </div>
  );
}

/**
 * One depth axis, fully derived: every scored stint's contribution summed, then
 * divided by the run's target, then compared against the OTHER axis to show why
 * this one did or did not decide the score. Both axes share this body because
 * they differ only in which quantity each stint contributes.
 */
function CareerDepthDerivation({
  detail,
  axis,
}: {
  detail: CareerDetail;
  axis: 'years' | 'rows';
}) {
  const isYears = axis === 'years';
  const eff = (isYears ? detail.effectiveYears : detail.effectiveRows) ?? 0;
  const target = (isYears ? detail.targetYears : detail.targetRows) ?? 0;
  const depth = (isYears ? detail.depthYears : detail.depthRows) ?? 0;
  const otherDepth = (isYears ? detail.depthRows : detail.depthYears) ?? 0;
  const binding = detail.binding === axis;
  // `binding` is a stored tie-break (years wins ties), so on its own it claims
  // "durasi decides" even when BOTH axes sit at the cap — where there is no
  // deciding axis at all, and advising "add more experience" contradicts a score
  // that is already 100.
  const bothSaturated = depth >= 0.9999 && otherDepth >= 0.9999;
  const tied = !bothSaturated && Math.abs(depth - otherDepth) < 1e-4;
  const scored = detail.pairs.filter((p) => p.similarity != null);
  const unscored = detail.pairs.filter((p) => p.similarity == null);
  // Present only on runs that used the multiplicative shape; its absence is how
  // an old min()-based run is recognised, and every branch below turns on it.
  const w = detail.breadthWeight;
  const lossYears = 1 - (detail.depthYears ?? 0);
  const lossRows = (w ?? 0) * (1 - (detail.depthRows ?? 0));

  // Per-stint contribution lines, so the sum is auditable rather than asserted.
  const lines = scored
    .map((p) => {
      const contrib = isYears ? stintEffectiveYears(p) : stintEffectiveRows(p);
      const expr = isYears
        ? `${(p.similarity ?? 0).toFixed(3)} × ${p.years.toFixed(2)} th${recencyExpr(p)}`
        : `${(p.similarity ?? 0).toFixed(3)}${recencyExpr(p)}`;
      return `  ${p.title.slice(0, 30).padEnd(31)}${expr.padStart(isYears ? 26 : 16)}  =  ${contrib.toFixed(3)}`;
    })
    .join('\n');

  const unscoredLines = unscored
    .map(
      (p) =>
        `  ${p.title.slice(0, 30).padEnd(31)}${'tidak dinilai'.padStart(isYears ? 18 : 8)}  =  0.000`,
    )
    .join('\n');

  return (
    <>
      <DerivStep title={`1. Kontribusi tiap periode jabatan → ${isYears ? 'tahun' : 'periode'} efektif`}>
        <p>
          {isYears
            ? 'Setiap periode menyumbang relevansinya dikalikan lama menjabat. Relevansi (sim′) adalah kemiripan yang sudah direntangkan ke 0–1 — klik baris riwayat di tabel untuk penjabarannya.'
            : 'Setiap periode menyumbang relevansinya saja, tanpa dikalikan lama menjabat. Sumbu ini mengukur SEBERAPA BANYAK periode relevan, bukan seberapa lama.'}
        </p>
        <Derivation>
          {`${lines || '  (tidak ada periode yang dapat dinilai)'}${
            unscoredLines ? `\n${unscoredLines}` : ''
          }
  ${'─'.repeat(isYears ? 62 : 52)}
  ${(isYears ? 'tahun efektif' : 'periode efektif').padEnd(31)}${''.padStart(isYears ? 18 : 8)}  =  ${eff.toFixed(3)}`}
        </Derivation>
        {unscored.length > 0 && (
          <p className="text-amber-700 dark:text-amber-300">
            {unscored.length} periode menyumbang 0 karena tidak dapat dinilai. Ini menurunkan skor
            secara nyata — periode itu tidak dikeluarkan dari pembagi, karena cakupan data yang buruk
            memang harus terlihat pada skor, bukan disembunyikan.
          </p>
        )}
      </DerivStep>

      <DerivStep title={`2. Dibandingkan target run ini (T_${isYears ? 'tahun' : 'periode'})`}>
        <Derivation>
          {`  capaian  =  min( 1 , ${isYears ? 'tahun efektif' : 'periode efektif'} ÷ T_${isYears ? 'tahun' : 'periode'} )
           =  min( 1 , ${eff.toFixed(3)} ÷ ${target.toFixed(2)} )
           =  min( 1 , ${target > 0 ? (eff / target).toFixed(4) : '—'} )
           =  ${depth.toFixed(4)}      →  ${Math.round(depth * 100)}%`}
        </Derivation>
        <p>
          <span className="font-medium text-foreground">
            T_{isYears ? 'tahun' : 'periode'} = {target.toFixed(2)}
          </span>{' '}
          berasal dari{' '}
          {detail.targetSource === 'pool' ? (
            <>
              median seluruh kandidat yang dinilai run ini, dikalikan 2 —{' '}
              <span className="font-medium text-foreground">aturan lama</span>, hanya ada pada run
              yang selesai sebelum penggaris ini dibuat absolut. Akibatnya skor Career run ini
              bergantung pada siapa saja yang ikut, dan{' '}
              <span className="font-medium text-foreground">
                tidak sebanding dengan run yang lebih baru
              </span>
              . Aturan itu diganti karena penggarisnya menyusut tepat ketika bench-nya paling lemah:
              satu pool yang relevansi rata-ratanya 0,168 menghasilkan T = 2,06 th / 1,0 periode
              (menyentuh batas bawah, jadi satu periode saja sudah menjenuhkan sumbu itu) dan
              rata-rata skor 33,1 — dengan target tetap 8/2, orang yang sama mendapat 11,3.
            </>
          ) : detail.targetSource === 'inherited' ? (
            <>
              run dasar — run ini menambah/mengurangi kandidat di atas run sebelumnya, jadi
              penggarisnya harus sama supaya kedua paruh peringkat sebanding.
            </>
          ) : detail.targetSource === 'jd' ? (
            <>
              syarat pengalaman yang tertulis di job profile jabatan sasaran
              {detail.statedExperienceText ? (
                <>
                  {' '}(&ldquo;{detail.statedExperienceText}&rdquo; ={' '}
                  {(detail.statedExperienceYears ?? 0).toFixed(1)} tahun)
                </>
              ) : null}
              {detail.statedMode === 'direct'
                ? ', dipakai langsung tanpa pengali. '
                : `, dikalikan ${detail.statedMultiplier ?? 2}. `}
              {detail.statedMode === 'direct' ? (
                <>
                  Perlu diketahui: syarat di job profile berarti tahun kalender{' '}
                  <span className="font-medium text-foreground">mentah</span> di satu jabatan
                  tertentu, sedangkan sumbu ini &ldquo;tahun efektif&rdquo; yang sudah dipotong
                  relevansi dan usia pengalaman. Rasio tengah terukur 0,398, jadi memakai angkanya
                  apa adanya berarti memakai kira-kira 40% dari yang dimaksud dokumen.
                </>
              ) : (
                <>
                  Dikalikan karena syarat tertulis adalah batas{' '}
                  <span className="font-medium text-foreground">MINIMAL untuk dianggap layak</span>,
                  bukan titik yang pantas mendapat nilai penuh, dan karena satuannya berbeda dari
                  &ldquo;tahun efektif&rdquo; yang dibandingkan di sini.
                </>
              )}{' '}
              Nilainya ABSOLUT: tidak bergantung pada peserta run.
            </>
          ) : detail.targetSource === 'measured' ? (
            <>
              {detail.statedIgnoredReason === 'mode-ignore'
                ? 'syarat pengalaman di job profile sengaja tidak dibaca pada konfigurasi ini, jadi tolok ukurnya '
                : 'job profile jabatan sasaran tidak menyebut syarat pengalaman dalam tahun yang bisa dibaca — entah tertulis "Fresh graduate", dalam bentuk lain, atau jabatan ini belum punya dokumen job profile. Tolok ukurnya karena itu '}
              <span className="font-medium text-foreground">diukur</span>: median lama bekerja
              orang-orang yang benar-benar pernah diangkat ke jabatan setingkat{' '}
              {detail.levelLabel ?? 'ini'}
              {detail.measured ? ` (${detail.measured.sampleCount} pengangkatan)` : ''}. Bukan angka
              karangan — keputusan pengangkatan yang sudah pernah diambil perusahaan ini.
            </>
          ) : detail.targetSource === 'fixed' ? (
            <>
              angka tetap konfigurasi, dipakai karena job profile jabatan sasaran tidak menyebut
              syarat pengalaman yang bisa dibaca DAN catatan pengangkatan nyata belum bisa diukur.
              Ini{' '}
              <span className="font-medium text-foreground">
                satu-satunya angka di kriteria career yang tidak diturunkan dari data
              </span>
              ; begitu riwayat jabatan terisi cukup, ia digantikan otomatis oleh median pengangkatan
              nyata per tingkat jabatan.
            </>
          ) : (
            'sumber yang tidak tercatat pada run ini.'
          )}{' '}
          Rinciannya ada di tab Konfigurasi → Career Relevance.
        </p>
      </DerivStep>

      <DerivStep title="3. Bagaimana kedua sumbu digabung">
        <Derivation>
          {w != null
            ? `  skor  =  capaian_tahun × ( ${(1 - w).toFixed(2)} + ${w.toFixed(2)} × capaian_periode )  × 100
        =  ${(detail.depthYears ?? 0).toFixed(4)} × ( ${(1 - w).toFixed(2)} + ${w.toFixed(2)} × ${(detail.depthRows ?? 0).toFixed(4)} ) × 100
        =  ${(detail.depthYears ?? 0).toFixed(4)} × ${(1 - w + w * (detail.depthRows ?? 0)).toFixed(4)} × 100
        =  ${(detail.normalized ?? 0).toFixed(4)} × 100
        =  ${detail.score}`
            : `  skor  =  min( capaian_tahun , capaian_periode )  × 100      [ATURAN LAMA]
        =  min( ${(detail.depthYears ?? 0).toFixed(4)} , ${(detail.depthRows ?? 0).toFixed(4)} ) × 100
        =  ${(detail.normalized ?? 0).toFixed(4)} × 100
        =  ${detail.score}`}
        </Derivation>
        {w != null && (
          <p>
            <span className="font-medium text-foreground">
              Kedalaman durasi memikul skor; keragaman penugasan hanya memodulasinya.
            </span>{' '}
            Kedalaman bisa menghapus seluruh skor, keragaman paling banyak{' '}
            {(w * 100).toFixed(0)}%. Jadi satu penugasan relevan yang dalam tetap memperoleh{' '}
            {((1 - w) * 100).toFixed(0)}% nilai penuh walaupun cuma satu penugasan. Sebelumnya
            dipakai <span className="font-mono">min()</span> dari kedua sumbu, dan itu membuang bukti
            terkuat yang bisa diterima kriteria ini: kandidat dengan 10,6 tahun di jabatan yang
            persis sama mendapat 47, sementara kandidat yang seluruh riwayatnya di bidang lain
            mendapat 100.
          </p>
        )}
        {bothSaturated ? (
          <p className="rounded-md bg-emerald-500/10 px-2.5 py-2 text-emerald-700 dark:text-emerald-300">
            <span className="font-semibold">Tidak ada sumbu penentu pada kandidat ini</span> —
            kedua capaian sudah jenuh di {depth.toFixed(4)}, artinya pengalaman relevannya sudah
            melampaui KEDUA target. Skor Career sudah maksimum {detail.score} dan tidak ada yang
            perlu ditingkatkan pada kriteria ini.
          </p>
        ) : tied ? (
          <p className="rounded-md bg-primary/10 px-2.5 py-2 text-foreground">
            <span className="font-semibold">Kedua sumbu seri</span> — nilainya sama besar (
            {depth.toFixed(4)}), jadi keduanya sama-sama menahan skor dan harus naik bersamaan agar
            skor bergerak.
          </p>
        ) : binding ? (
          <p className="rounded-md bg-primary/10 px-2.5 py-2 text-foreground">
            <span className="font-semibold">
              Pada kandidat ini, {isYears ? 'kedalaman durasi' : 'keragaman penugasan'} yang paling
              menekan skor
            </span>{' '}
            {w != null ? (
              <>
                — ia menghapus {(isYears ? lossYears : lossRows).toFixed(4)} poin, lebih besar
                dari sumbu satunya ({(isYears ? lossRows : lossYears).toFixed(4)}).
              </>
            ) : (
              <>
                — nilainya ({depth.toFixed(4)}) lebih kecil dari sumbu satunya (
                {otherDepth.toFixed(4)}), dan skor mengambil yang terkecil.
              </>
            )}{' '}
            {isYears
              ? 'Artinya: periode-periode yang relevan itu ada, tetapi total lamanya masih kurang dari target. Menambah waktu di jabatan yang relevan akan menaikkan skor — dan penugasan yang sedang berjalan tidak menyusut, jadi penugasan relevan SEKARANG bernilai lebih besar daripada pengalaman relevan yang sudah lama berakhir.'
              : 'Artinya: total lamanya sudah memadai, tetapi terlalu terkonsentrasi di sedikit jabatan. Pengalaman relevan yang tersebar di lebih banyak penugasan akan menaikkan skor, tetapi hanya sampai batas modulasinya.'}
          </p>
        ) : (
          <p className="rounded-md bg-muted/50 px-2.5 py-2">
            Pada kandidat ini{' '}
            <span className="font-medium text-foreground">
              sumbu ini BUKAN yang paling menekan skor
            </span>{' '}
            {w != null ? (
              <>
                — ia hanya menghapus {(isYears ? lossYears : lossRows).toFixed(4)} poin,
                sementara {isYears ? 'keragaman penugasan' : 'kedalaman durasi'} menghapus{' '}
                {(isYears ? lossRows : lossYears).toFixed(4)}.
              </>
            ) : (
              <>
                — nilainya ({depth.toFixed(4)}) lebih besar dari{' '}
                {isYears ? 'kedalaman riwayat' : 'kedalaman durasi'} ({otherDepth.toFixed(4)}), dan
                skor mengambil yang terkecil. Menaikkan sumbu ini tidak akan mengubah skor sampai
                sumbu satunya ikut naik.
              </>
            )}
          </p>
        )}
        {w != null ? (
          <p>
            <span className="font-medium text-foreground">
              Yang dibandingkan adalah poin yang HILANG, bukan capaian mentahnya.
            </span>{' '}
            Sumbu tahun kehilangan <span className="font-mono">1 − {(detail.depthYears ?? 0).toFixed(4)} = {lossYears.toFixed(4)}</span>;
            sumbu periode kehilangan{' '}
            <span className="font-mono">
              {w.toFixed(2)} × (1 − {(detail.depthRows ?? 0).toFixed(4)}) = {lossRows.toFixed(4)}
            </span>
            . Membandingkan {(detail.depthYears ?? 0).toFixed(4)} dengan{' '}
            {(detail.depthRows ?? 0).toFixed(4)} secara langsung — cara lama, waktu keduanya
            digabung dengan <span className="font-mono">min()</span> — sudah tidak sah, karena
            keragaman paling banyak hanya bisa menghapus {(w * 100).toFixed(0)}% skor sedangkan
            kedalaman bisa menghapus seluruhnya.
          </p>
        ) : (
          <p>
            Diambil <span className="font-mono">min()</span> supaya tidak ada satu sumbu pun yang
            bisa memaksimalkan skor sendirian. Aturan ini sudah diganti bentuk perkalian, karena
            paruh keduanya salah: satu periode panjang di jabatan yang persis sama tertahan oleh
            jumlah periodenya sendiri.
          </p>
        )}
        {detail.recencyDecayPerYear != null && detail.recencyDecayPerYear > 0 && isYears && (
          <p className="rounded-md bg-muted/40 px-2.5 py-2">
            <span className="font-medium text-foreground">Penyusutan usia pengalaman.</span> Tiap
            penugasan yang sudah berakhir dikali{' '}
            <span className="font-mono">
              exp(−{detail.recencyDecayPerYear} × tahun sejak berakhir)
            </span>
            , jadi &ldquo;th efektif&rdquo; di langkah 1 selalu lebih kecil dari sim′ × lama
            untuk penugasan lama. Angka {(detail.recencyDecayPerYear * 100).toFixed(1)}% per tahun
            adalah laju penyusutan keterampilan dari literatur human capital, bukan angka setelan.
            Penugasan yang masih berjalan tidak menyusut.
          </p>
        )}
      </DerivStep>
    </>
  );
}

/**
 * One history stint, fully derived. Three genuinely different bodies, because
 * the three scoring paths reach their number in three different ways — and the
 * unscored one has no number to derive, only a cause to name.
 */
function CareerPairDerivation({
  p,
  basis,
  detail,
}: {
  p: CareerPairRow;
  basis: CareerScoreBasis;
  detail: CareerDetail;
}) {
  const ids = useIdentifierDisplay();
  const sim = p.similarity;
  const contribYears = stintEffectiveYears(p);

  return (
    <>
      <DerivStep title="1. Periode jabatan ini">
        <Derivation>
          {`  Jabatan       :  ${stintTitle(p, ids.demo)}
  Kode posisi   :  ${p.positionId ? ids.code(p.positionId) : '(tidak tercatat)'}${p.companyId ? `\n  Perusahaan    :  ${ids.code(p.companyId)}` : ''}
  Lama menjabat :  ${p.years.toFixed(2)} tahun${p.isCurrent ? '   (masih menjabat — dihitung sampai hari ini)' : ''}`}
        </Derivation>
        <p>
          Lama menjabat dihitung sebagai jumlah bulan penuh dibagi 12; sisa hari yang belum genap
          sebulan dibuang. Periode yang masih berjalan dihitung sampai hari ini, bukan sampai
          tanggal akhir sentinel.
        </p>
      </DerivStep>

      {basis === 'document' && (
        <>
          <DerivStep title="2. Dokumen job profile yang dibandingkan">
            <Derivation>
              {`  Job profile jabatan ini :  ${p.jobProfileName ?? `#${p.jobProfileId}`}
  Cara dipasangkan        :  ${p.matchType ? careerMatchTypeLabel[p.matchType] : '—'}
  Job profile posisi target:  ${detail.targetJobProfileName ?? '(tidak ditemukan)'}`}
            </Derivation>
            <p>
              Kedua dokumen job profile diubah menjadi vektor oleh model teks yang sama, lalu
              diukur kemiripan arah keduanya (cosine). Jadi yang dibandingkan adalah{' '}
              <span className="font-medium text-foreground">isi uraian jabatannya</span>, bukan
              kemiripan judulnya.
            </p>
          </DerivStep>

          <DerivStep title="3. Cosine mentah direntangkan menjadi relevansi 0–1">
            <Derivation>
              {`  cosine mentah  =  ${p.similarityRaw?.toFixed(4) ?? '—'}

  sim′  =  ( cosine − batas_bawah ) ÷ ( batas_atas − batas_bawah )   dipotong 0–1
        =  ${sim?.toFixed(3) ?? '—'}`}
            </Derivation>
            <p>
              Cosine mentah <span className="font-medium text-foreground">tidak boleh dibaca
              sebagai persentase</span>: dua job profile yang sama sekali tidak berhubungan pun
              tetap terlihat cukup mirip, karena keduanya dokumen jabatan dengan struktur dan
              istilah yang sama. Karena itu nilainya direntangkan dengan dua batas yang diukur dari
              seluruh korpus dokumen job profile. Nilai kedua batas dan asalnya ada di tab
              Konfigurasi → Career Relevance.
            </p>
            {sim === 0 && (
              <p className="rounded-md bg-amber-500/10 px-2.5 py-2 text-amber-700 dark:text-amber-300">
                <span className="font-semibold">Baris ini dihitung 0.</span> Cosine-nya (
                {p.similarityRaw?.toFixed(4) ?? '—'}) berada di bawah batas bawah, artinya jabatan
                ini tidak lebih mirip dengan posisi target dibanding sepasang job profile yang
                diambil sembarang. Bukan berarti datanya hilang — perbandingannya berhasil, dan
                hasilnya memang tidak menunjukkan hubungan.
              </p>
            )}
          </DerivStep>
        </>
      )}

      {basis === 'incumbent_competency' && (
        <>
          <DerivStep title="2. Jabatan ini TIDAK punya dokumen job profile">
            <p>
              Karena itu periode ini tidak dilewati, melainkan dinilai lewat jalur pengganti:
              kompetensi orang-orang yang memegang jabatan tersebut dibandingkan dengan daftar
              kompetensi posisi target, memakai pencocokan Hungarian yang sama dengan kriteria
              Technical. Yang dibandingkan tetap{' '}
              <span className="font-medium text-foreground">jabatan lawan jabatan</span>, sehingga
              tetap mengukur hal yang sama dengan jalur dokumen — bukan menduplikasi Technical.
            </p>
            <Derivation>
              {`  Status pencocokan job profile :  ${careerLabel[p.status]}
  Pemegang jabatan yang dipakai :  ${p.fallbackEmployeeIds?.length ? p.fallbackEmployeeIds.map(ids.npk).join(', ') : '—'}
  Asal asesmen kompetensinya    :  ${p.fallbackBasis ? competencyBasisLabel[p.fallbackBasis] : '—'}`}
            </Derivation>
            <p>
              Kandidat yang sedang dinilai selalu dikeluarkan dari daftar pemegang jabatan. Tanpa
              itu, periode yang masih ia jabat akan dibandingkan dengan asesmennya sendiri dan
              memberi nilai ~1,0 untuk jabatan yang sebenarnya tidak kita ketahui apa-apa.
            </p>
            <div className="rounded-md border border-dashed px-2.5 py-2">
              <p className="mb-1 text-[10px] font-semibold text-foreground">
                Bagaimana pemegang jabatan di atas dipilih
              </p>
              <ul className="ml-3 list-disc space-y-1 text-[10px] leading-relaxed text-muted-foreground">
                <li>
                  Dicari pemegang <span className="font-medium text-foreground">kode jabatan</span>{' '}
                  periode ini, dibatasi ke perusahaan periode tersebut. Kalau perusahaan itu tidak
                  punya catatan kode tersebut, pencarian dilebarkan ke semua perusahaan — pool bisa
                  melintasi unit bisnis dan kode yang sama menamai pekerjaan yang sama.
                </li>
                <li>
                  <span className="font-medium text-foreground">Kalau ada pemegang aktif, SEMUANYA dipakai.</span>{' '}
                  Kalau tidak ada yang aktif, hanya SATU yang dipakai — yang paling akhir berhenti
                  menjabat. Jadi jabatan yang sudah lama kosong dinilai dari basis bukti yang lebih
                  sempit, dan itu terbaca pada daftar id di atas.
                </li>
                <li>
                  Kompetensi para pemegang itu{' '}
                  <span className="font-medium text-foreground">digabung dengan mengambil level tertinggi</span>{' '}
                  per nama kompetensi — bukan dijumlah dan bukan dirata-rata. Karena itu{' '}
                  <span className="font-medium text-foreground">banyaknya pemegang jabatan tidak menaikkan nilai dengan sendirinya</span>:
                  satu orang dengan cakupan penuh menghasilkan angka yang sama dengan lima orang
                  dengan cakupan penuh. Lebih banyak pemegang hanya memperlebar bukti yang tersedia.
                </li>
              </ul>
            </div>
          </DerivStep>

          <DerivStep title="3. Cakupan kompetensi → disetarakan → relevansi 0–1">
            <Derivation>
              {`  cakupan${detail.calibration?.idfWeighted ? ' (rata-rata BERBOBOT KEKHASAN)' : ' (Σ nilai pasangan ÷ M)'}  =  ${p.fallbackRaw?.toFixed(4) ?? '—'}

  disetarakan ke skala kemiripan dokumen${
    detail.calibration
      ? `
      rentang  ${detail.calibration.lo.toFixed(4)}  –  ${detail.calibration.hi.toFixed(4)}${
          detail.calibration.cap != null
            ? `   (batas atas = ${(detail.calibration.cap * 100).toFixed(0)}% rentang penuh)`
            : ''
        }`
      : ''
  }
      →  ${p.similarityRaw?.toFixed(4) ?? '—'}

  direntangkan ke 0–1
      →  sim′  =  ${sim?.toFixed(3) ?? '—'}`}
            </Derivation>
            <p>
              Penyetaraan diperlukan karena rasio cakupan 0–1 dan kemiripan dokumen hidup di skala
              yang berbeda; tanpa itu, setiap periode jalur pengganti akan terlihat jauh lebih buruk
              daripada periode mana pun yang punya dokumen.
            </p>
            {detail.calibration?.idfWeighted && (
              <p className="rounded-md bg-primary/10 px-2.5 py-2 text-[10px] leading-relaxed">
                <span className="font-semibold">Cakupan dibobot kekhasan (IDF).</span> Kompetensi
                yang diminta hampir semua job profile hampir tidak menambah nilai; yang cuma diminta
                sedikit jabatan berbobot besar. Perlu, karena kosakata kompetensinya didominasi
                entri hampir universal —{' '}
                <span className="font-mono">SOFTWARE APPLICATION OPERATION</span> ada di 92,7% dari
                275 dokumen — sehingga tanpa pembobotan{' '}
                <span className="font-medium text-foreground">
                  siapa pun yang manajer otomatis menutup ~45% syarat jabatan apa pun
                </span>
                . Terukur: median cakupan sepasang jabatan yang TIDAK berhubungan turun dari 0,286
                ke 0,104.
              </p>
            )}
            {detail.calibration?.cap != null ? (
              <p className="rounded-md bg-amber-500/10 px-2.5 py-2 text-[10px] leading-relaxed text-amber-700 dark:text-amber-300">
                <span className="font-semibold">
                  Plafon: cakupan 100% pun hanya mencapai sim′ {detail.calibration.cap.toFixed(2)}
                </span>{' '}
                — {(detail.calibration.cap * 100).toFixed(0)}% dari rentang penuh, bukan 1,000.
                Bukti dari kompetensi orang yang kebetulan menduduki jabatan itu memang lebih lemah
                daripada dokumen job profile yang benar-benar ada: ia membedakan rumpun jabatan jauh
                lebih buruk, dan 5% pasangan jabatan yang tidak berhubungan pun berbagi ≥ 75%
                kompetensi. Jadi jalur ini tidak boleh berarti &ldquo;ini persis pekerjaan yang
                sama&rdquo;.
              </p>
            ) : (
              <p className="rounded-md bg-amber-500/10 px-2.5 py-2 text-[10px] leading-relaxed text-amber-700 dark:text-amber-300">
                <span className="font-semibold">Aturan lama pada run ini.</span> Rentangnya diambil
                dari p5–p95 kemiripan dokumen run ini sendiri — dan p95 dari beberapa puluh
                periode praktis sama dengan kecocokan dokumen TERBAIK di run itu. Akibatnya cakupan
                kompetensi 100% bernilai sama dengan &ldquo;ini persis pekerjaan yang sama&rdquo;,
                dan skor jalur ini pada run lama terlalu tinggi. Aturan itu sudah diganti plafon
                absolut.
              </p>
            )}

            <div className="rounded-md border border-dashed px-2.5 py-2">
              <p className="mb-1 text-[10px] font-semibold text-foreground">
                Apa yang M itu — dan mengapa kelebihan kompetensi tidak berbonus
              </p>
              <ul className="ml-3 list-disc space-y-1 text-[10px] leading-relaxed text-muted-foreground">
                <li>
                  <span className="font-medium text-foreground">M adalah jumlah kompetensi acuan POSISI SASARAN</span>,
                  bukan jumlah kompetensi yang dimiliki pemegang jabatan. Pembaginya milik target.
                </li>
                <li>
                  Penugasannya <span className="font-medium text-foreground">satu-ke-satu</span>:
                  kolom yang tersedia hanya M. Pemegang jabatan yang punya 30 kompetensi untuk target
                  8 kompetensi{' '}
                  <span className="font-medium text-foreground">tidak mendapat tambahan apa pun</span>{' '}
                  atas kelebihan itu — kelebihannya hanya memberi pilihan yang lebih baik per kolom.
                </li>
                <li>
                  Kekurangan juga bukan hukuman tersendiri: kolom yang tidak tertutup menyumbang 0 ke
                  Σ, jadi nilainya turun{' '}
                  <span className="font-medium text-foreground">sebanding</span>. Tidak ada suku
                  penalti di mana pun.
                </li>
                <li>
                  Kolom yang <span className="font-medium text-foreground">tidak dapat diukur</span>{' '}
                  dikeluarkan dari pembagi, bukan dihitung sebagai nol yang ditanggung semua
                  kandidat — supaya satu nama kompetensi yang tak dapat dipetakan tidak menekan
                  seluruh peserta run.
                </li>
              </ul>
            </div>

            <div className="rounded-md border border-dashed px-2.5 py-2">
              <p className="mb-1 text-[10px] font-semibold text-foreground">
                Satu-satunya bonus yang ada: LEVEL, bukan jumlah
              </p>
              <Derivation>
                {`  nilai sel  =  sim′(pasangan)  ×  faktor_level

  c = level yang dimiliki      r = level yang diminta jabatan sasaran

  c ≥ r, pasangan IDENTIK    →  min( 1 + 0,75 × (c − r) ÷ 3 ,  1,75 )
  c ≥ r, pasangan SEMANTIC   →  1,00
  c < r                      →  1 − (r − c) ÷ rentang`}
              </Derivation>
              <p className="text-[10px] leading-relaxed text-muted-foreground">
                Melebihi level yang diminta hanya dibayar pada pasangan{' '}
                <span className="font-medium text-foreground">identik</span> (nama sama, atau kode
                kamus sama). Pada pasangan yang cuma mirip, melebihi target untuk kompetensi yang
                sebenarnya tidak diminta jabatan itu tidak dibayar — dan batas 1,00 itulah yang
                menjaga kecocokan identik selalu di atas kemiripan belaka.
              </p>
              <p className="rounded-md bg-amber-500/10 px-2 py-1.5 text-[10px] leading-relaxed text-amber-700 dark:text-amber-300">
                <span className="font-semibold">Di kedua kriteria bonus itu dipotong, dengan plafon
                berbeda.</span>{' '}
                Nilai per pasangan bisa mencapai 1,75, tetapi cakupan agregat dijepit ke 0–1 di
                Technical (berhenti di skor 100) maupun di sini (berhenti di batas atas rentang,
                lalu dibatasi lagi oleh plafon di atas). Dua pembatas di sini yang bersama-sama
                menjaga pengukuran pengganti (kompetensi siapa pun yang kebetulan menjabat,
                menggantikan JD yang tidak pernah ditulis) tidak bisa mengalahkan kecocokan
                dokumen yang sungguhan.
              </p>
            </div>
            {p.fallbackPairs && p.fallbackPairs.length > 0 && (
              <div className="rounded-md border border-dashed px-2.5 py-2">
                <p className="mb-1 text-[10px] font-semibold text-foreground">
                  Pasangan kompetensi yang membentuk cakupan itu
                </p>
                {/* Every column of the divisor, with the two factors that made its
                    cell — otherwise a reader can see the total but not why any
                    single row landed where it did. */}
                <div className="space-y-1">
                  {p.fallbackPairs.slice(0, 10).map((fp, i) => (
                    <div key={i} className="border-b border-dashed pb-1 last:border-0 last:pb-0">
                      <div className="flex items-baseline justify-between gap-2 text-[10px]">
                        <span className="min-w-0 truncate">
                          {fp.required.name}
                          <span className="text-muted-foreground/70">
                            {' '}
                            ← {fp.candidate?.name ?? '(tidak ada pasangan)'}
                          </span>
                        </span>
                        <span className="shrink-0 font-mono tabular-nums font-semibold">
                          {fp.value.toFixed(3)}
                        </span>
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                        <Badge variant="outline" className={cn('text-[9px]', matchTone(fp.matchType))}>
                          {matchLabel[fp.matchType]}
                        </Badge>
                        <span className="font-mono text-[9px] text-muted-foreground tabular-nums">
                          level diminta {fp.required.level}
                          {fp.candidate ? ` · dimiliki ${fp.candidate.level}` : ''}
                        </span>
                        {fp.similarity != null && fp.levelFactor != null && (
                          <span className="font-mono text-[9px] text-muted-foreground tabular-nums">
                            {fp.similarity.toFixed(3)} × {fp.levelFactor.toFixed(3)}
                          </span>
                        )}
                        {fp.levelUnknown && (
                          <span className="text-[9px] text-amber-600 dark:text-amber-400">
                            level tidak terbaca — faktor dibiarkan 1, bukan dihitung sebagai
                            kesenjangan
                          </span>
                        )}
                        {fp.matchType === 'unmeasurable' && (
                          <span className="text-[9px] text-muted-foreground">
                            di luar pembagi
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                  {p.fallbackPairs.length > 10 && (
                    <p className="text-[10px] text-muted-foreground">
                      … dan {p.fallbackPairs.length - 10} pasangan lainnya
                    </p>
                  )}
                </div>
              </div>
            )}
          </DerivStep>
        </>
      )}

      {basis === 'unscored' && (
        <DerivStep title="2. Periode ini dihitung 0 — dan inilah sebabnya">
          <p className="rounded-md bg-amber-500/10 px-2.5 py-2 text-amber-700 dark:text-amber-300">
            {p.unscoredReason
              ? unscoredReasonHelp[p.unscoredReason]
              : 'Jabatan ini tidak dapat dipasangkan ke dokumen job profile mana pun, dan jalur pengganti berbasis kompetensi pemegang jabatan juga tidak dapat dijalankan.'}
          </p>
          <Derivation>
            {`  sim′            =  tidak ada
  kontribusi      =  0.000  ke KEDUA sumbu
  lama menjabat   =  ${p.years.toFixed(2)} tahun  (tetap dihitung pada total tenur)`}
          </Derivation>
          <p>
            Periode ini <span className="font-medium text-foreground">tidak</span> dikeluarkan dari
            pembagi. Menyumbang 0 berarti cakupan data yang buruk benar-benar menurunkan skor —
            itulah bedanya dengan rata-rata tertimbang yang dulu dipakai, di mana periode tak
            terhitung diam-diam hilang dari perhitungan dan riwayat yang tipis justru diuntungkan.
          </p>
        </DerivStep>
      )}

      {sim != null && (
        <DerivStep title={`${basis === 'unscored' ? '3' : '4'}. Kontribusi baris ini ke skor`}>
          <Derivation>
            {`  ke sumbu durasi  :  sim′ × lama${recencyExpr(p) ? ' × penyusutan' : ''}  =  ${sim.toFixed(3)} × ${p.years.toFixed(2)}${recencyExpr(p)}  =  ${contribYears.toFixed(3)} th efektif
  ke sumbu riwayat :  sim′            =  ${sim.toFixed(3)} periode efektif`}
          </Derivation>
          <p>
            Kedua angka ini dijumlahkan dengan periode lainnya, lalu masing-masing dibandingkan
            targetnya. Klik kartu &ldquo;Kedalaman durasi&rdquo; atau &ldquo;Kedalaman riwayat&rdquo;
            untuk melihat penjumlahan lengkapnya.
          </p>
          <p>
            Di sinilah <span className="font-medium text-foreground">banyaknya periode</span>{' '}
            berpengaruh, dan hanya di sini: tiap periode yang berhasil dinilai menambah sim′-nya
            sendiri ke sumbu riwayat, jadi lebih banyak periode terskor menaikkan sumbu itu sampai
            jenuh di targetnya. Karena skor akhir adalah{' '}
            <span className="font-medium text-foreground">yang terkecil dari dua sumbu</span>, banyak
            periode pendek tidak bisa memaksimalkan kriteria ini — sumbu durasinya tertinggal — dan
            satu periode yang sangat panjang juga tidak, karena sumbu riwayatnya tertinggal.
          </p>
        </DerivStep>
      )}
    </>
  );
}

function CareerMatching({ detail }: { detail: CareerDetail }) {
  const ids = useIdentifierDisplay();
  const basisOf = (p: CareerDetail['pairs'][number]): CareerScoreBasis =>
    p.basis ?? (p.similarity != null ? 'document' : 'unscored');
  // Positions that resolved to NO job profile — split by whether the competency
  // fallback rescued them, so "tanpa profil" is never read as "tidak dinilai".
  const noProfile = detail.pairs.filter((p) => p.status !== 'ok');
  const rescued = noProfile.filter((p) => basisOf(p) === 'incumbent_competency');
  const unscored = detail.pairs.filter((p) => basisOf(p) === 'unscored');
  // Tallied from the pairs rather than read off a run-level block, so it is per
  // candidate. Runs before the split carry no reason and contribute nothing.
  const unscoredByReason = Object.entries(
    unscored.reduce<Partial<Record<CareerUnscoredReason, number>>>((acc, p) => {
      if (p.unscoredReason) acc[p.unscoredReason] = (acc[p.unscoredReason] ?? 0) + 1;
      return acc;
    }, {})
  ) as [CareerUnscoredReason, number][];
  const fallbackCount = detail.fallbackCount ?? detail.pairs.filter((p) => basisOf(p) === 'incumbent_competency').length;
  const documentCount = detail.documentCount ?? detail.pairs.filter((p) => basisOf(p) === 'document').length;
  const coverage = detail.coverage ?? (detail.totalYears > 0 ? detail.matchedYears / detail.totalYears : 0);
  // Runs before the depth rework stored only the weighted mean; show the old
  // formula for those rather than rendering an accumulation that isn't there.
  const hasDepth = detail.effectiveYears != null && detail.targetYears != null;

  // Which derivation popup is open. Held here rather than per-row so only one can
  // be open at a time and the row components stay presentational.
  const [openAxis, setOpenAxis] = useState<'years' | 'rows' | null>(null);
  const [openPair, setOpenPair] = useState<number | null>(null);
  const activePair = openPair != null ? detail.pairs[openPair] : undefined;
  // One panel at a time. They were modals, where that was automatic; inline they
  // would stack, and two derivations open at once leaves the reader unsure which
  // figure each belongs to.
  const showAxis = (axis: 'years' | 'rows') => {
    setOpenPair(null);
    setOpenAxis(axis);
  };
  const showPair = (i: number) => {
    setOpenAxis(null);
    setOpenPair(i);
  };
  const askRefAxis = useAskRef(
    openAxis === 'years' ? 'kedalaman durasi' : openAxis === 'rows' ? 'kedalaman riwayat' : undefined,
    openAxis ? { kind: 'career-axis', key: openAxis } : undefined,
  );
  const askRefStint = useAskRef(
    activePair ? `periode jabatan "${activePair.title}"` : undefined,
    openPair != null ? { kind: 'career-stint', key: openPair } : undefined,
  );
  useReopenPanel('career-axis', (key) => {
    if (key === 'years' || key === 'rows') showAxis(key);
  });
  useReopenPanel('career-stint', (key) => {
    if (typeof key === 'number') showPair(key);
  });

  return (
    // Container queries throughout: this block is rendered both full-width (the
    // Readiness card) and inside the breakdown-chip popup, so it has to lay out
    // against its own width rather than the viewport's.
    <div className="@container space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-muted-foreground">
          {hasDepth ? (
            <>
              Pengalaman relevan efektif {detail.effectiveYears!.toFixed(2)} th / {detail.effectiveRows?.toFixed(2) ?? '—'} stint
              {' · '}Durasi dinilai {detail.matchedYears.toFixed(1)}/{detail.totalYears.toFixed(1)} th
              {' '}({Math.round(coverage * 100)}% cakupan)
            </>
          ) : (
            <>
              Σ(sim×th)/Σth = {detail.normalized.toFixed(3)} · Durasi dinilai {detail.matchedYears.toFixed(1)}/{detail.totalYears.toFixed(1)} th
              {' '}({Math.round(coverage * 100)}% cakupan)
            </>
          )}
        </span>
        <span className="ml-auto flex flex-wrap gap-1.5">
          <Badge variant="outline" className={basisTone('document')}>Dokumen {documentCount}</Badge>
          {fallbackCount > 0 && (
            <Badge variant="outline" className={basisTone('incumbent_competency')}>Fallback {fallbackCount}</Badge>
          )}
          {unscored.length > 0 && (
            <Badge variant="outline" className={basisTone('unscored')}>Tidak dinilai {unscored.length}</Badge>
          )}
        </span>
      </div>

      {/* The score is min(depth by years, depth by stints) against the run's
          yardstick. Showing both factors — and marking the binding one — is the
          only way a reader can tell "cocok tapi terlalu sedikit" apart from
          "cukup banyak tapi tidak cocok". */}
      {hasDepth && (
        <div className="grid gap-2 @md:grid-cols-2">
          {([
            {
              axis: 'years' as const,
              label: 'Kedalaman durasi',
              value: detail.depthYears ?? 0,
              detailText: `${detail.effectiveYears!.toFixed(2)} / ${detail.targetYears!.toFixed(2)} th relevan efektif`,
            },
            {
              axis: 'rows' as const,
              label: 'Kedalaman riwayat',
              value: detail.depthRows ?? 0,
              detailText: `${detail.effectiveRows?.toFixed(2) ?? '—'} / ${detail.targetRows?.toFixed(2) ?? '—'} stint relevan efektif`,
            },
          ]).map((f) => {
            const binding = detail.binding === f.axis;
            return (
              <ClickableFigure
                key={f.axis}
                onClick={() => showAxis(f.axis)}
                label={`Lihat penjabaran ${f.label}`}
                className={cn(
                  'w-full rounded-md border px-3 py-2',
                  binding ? 'border-primary/40 bg-primary/5' : 'border-muted-foreground/20 bg-muted/20'
                )}
              >
                <div className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="font-medium text-foreground/90">{f.label}</span>
                  <span className="flex items-center gap-1.5">
                    {binding && (
                      <Badge variant="outline" className="border-primary/40 bg-primary/10 px-1 py-0 text-[9px] text-primary">
                        penentu
                      </Badge>
                    )}
                    <span className="tabular-nums text-muted-foreground">{Math.round(f.value * 100)}%</span>
                  </span>
                </div>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn('h-full rounded-full', binding ? 'bg-primary' : 'bg-muted-foreground/40')}
                    style={{ width: `${Math.min(100, Math.max(0, f.value * 100))}%` }}
                  />
                </div>
                <div className="mt-1 flex flex-wrap items-center justify-between gap-x-2 text-[10px] tabular-nums text-muted-foreground">
                  <span>{f.detailText}</span>
                  <TapHint />
                </div>
              </ClickableFigure>
            );
          })}
        </div>
      )}

      {hasDepth && (
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          {detail.meanSimilarity != null && (
            <>
              Skor diambil dari akumulasi pengalaman relevan, bukan rata-ratanya. Riwayat yang cocok tetapi sangat sedikit tidak lagi setara dengan riwayat panjang yang sama cocoknya.{' '}
            </>
          )}
          {detail.targetSource && (
            <span className="font-medium text-foreground/70">
              Tolok ukur: {depthSourceLabel[detail.targetSource]}.
            </span>
          )}
        </p>
      )}

      {/* Target has no comparable document. With a reference competency set this
          is a degraded-but-real measurement, not a zero — say which it is. */}
      {detail.targetStatus !== 'ok' && fallbackCount > 0 && (
        <p className="flex items-start gap-2 rounded-md bg-sky-500/10 px-3 py-2 text-[11px] leading-relaxed text-sky-700 dark:text-sky-300">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Posisi target tidak punya dokumen job profile ({careerLabel[detail.targetStatus].toLowerCase()}),
            sehingga seluruh riwayat dinilai lewat pencocokan kompetensi incumbent posisi terhadap acuan
            kompetensi target — bukan lewat kemiripan dokumen. Nilainya dikalibrasi; lihat diagnosa run di atas.
          </span>
        </p>
      )}

      {detail.targetStatus !== 'ok' && fallbackCount === 0 && (
        <p className="flex items-start gap-2 rounded-md bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-700 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Posisi target belum siap dibandingkan ({careerLabel[detail.targetStatus].toLowerCase()}) dan tidak
            ada acuan kompetensi untuk fallback — skor Career = 0. Lihat diagnosa run di atas.
          </span>
        </p>
      )}

      {/* Nothing at all could be scored: neither documents nor incumbent data.
          The fallback fails for three different reasons and this used to assert
          only one of them ("no recorded holder"), which pointed the reader at
          sync_employee_positions even when the real gap was the target's
          competency reference or a missing position code on the history row. */}
      {detail.matchedCount === 0 && detail.pairs.length > 0 && (
        <div className="flex items-start gap-2 rounded-md bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-700 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div className="min-w-0">
            <p>
              Tidak satu pun riwayat posisi kandidat ({detail.pairs.length} posisi,{' '}
              {detail.totalYears.toFixed(1)} th) dapat dinilai — job profile tidak ditemukan (kode
              file_name, job_family_matches, judul sama, kemiripan embedding &gt; 98%) dan fallback
              kompetensi juga tidak dapat menyelamatkannya. Skor Career = 0.
            </p>
            {unscoredByReason.length > 0 && (
              <ul className="mt-1.5 space-y-0.5">
                {unscoredByReason.map(([reason, count]) => (
                  <li key={reason}>
                    <span className="font-medium">
                      {count} stint · {unscoredReasonLabel[reason]}
                    </span>{' '}
                    — {unscoredReasonHelp[reason]}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* Positions with no job profile, and what happened to each of them. */}
      {noProfile.length > 0 && (
        <div className="rounded-md border border-dashed border-muted-foreground/30 bg-muted/20 px-3 py-2">
          <p className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
            Posisi tanpa profil job family ({noProfile.length}) — {rescued.length} dinilai lewat kompetensi
            incumbent, {noProfile.length - rescued.length} tidak masuk perhitungan
          </p>
          <ul className="mt-1.5 space-y-1">
            {noProfile.map((p, i) => (
              <li key={i} className="flex flex-wrap items-center gap-1.5 text-[11px] text-foreground/80">
                <span className="font-medium">{stintTitle(p, ids.demo)}</span>
                <span className="text-muted-foreground">
                  {p.positionId ? `pos ${ids.code(p.positionId)}` : '(tanpa position_id)'}
                  {p.isCurrent ? ' · saat ini' : ''}
                </span>
                <Badge variant="outline" className={cn('px-1 py-0 text-[9px]', careerTone(p.status))}>
                  {careerLabel[p.status]}
                </Badge>
                <Badge variant="outline" className={cn('px-1 py-0 text-[9px]', basisTone(basisOf(p)))}>
                  {basisLabel[basisOf(p)]}
                </Badge>
                {basisOf(p) === 'unscored' && p.unscoredReason ? (
                  <Badge variant="outline" className="px-1 py-0 text-[9px] text-muted-foreground">
                    {unscoredReasonLabel[p.unscoredReason]}
                  </Badge>
                ) : null}
                {basisOf(p) === 'incumbent_competency' && p.fallbackEmployeeIds?.length ? (
                  <span className="text-[10px] text-muted-foreground">
                    incumbent {p.fallbackEmployeeIds.map(ids.npk).join(', ')}
                    {p.fallbackBasis ? ` · ${competencyBasisLabel[p.fallbackBasis]}` : ''}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Two layouts over the same cells, picked by the width of the CONTAINER
          (not the viewport) so this block never scrolls sideways — it sits both
          in the full-width Readiness card and inside the narrower chip popup.
          Below @2xl the table would need ~620px it doesn't have, so the rows
          stack instead. */}
      {detail.pairs.length === 0 ? (
        <EmptyNote>Kandidat tidak memiliki riwayat posisi yang dapat dinilai.</EmptyNote>
      ) : (
        <div>
          <ul className="space-y-2 @2xl:hidden">
            {detail.pairs.map((p, i) => (
              <li key={i}>
                <ClickableFigure
                  onClick={() => showPair(i)}
                  label={`Lihat penjabaran skor periode ${stintTitle(p, ids.demo)}`}
                  className="w-full rounded-lg border p-2.5 text-xs"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <CareerPairTitle p={p} />
                    </div>
                    <span className="shrink-0 tabular-nums text-foreground/80">{p.years.toFixed(2)} th</span>
                  </div>
                  <div className="mt-2 rounded-md bg-muted/30 px-2 py-1.5">
                    <p className="mb-1 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Pembanding
                    </p>
                    <CareerPairComparator p={p} basis={basisOf(p)} />
                  </div>
                  <div className="mt-2 flex items-start justify-between gap-2">
                    <span className="pt-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {hasDepth ? 'Relevansi · th efektif' : 'Similarity'}
                    </span>
                    <CareerPairSimilarity p={p} basis={basisOf(p)} />
                  </div>
                  <div className="mt-1.5 text-right">
                    <TapHint />
                  </div>
                </ClickableFigure>
              </li>
            ))}
          </ul>

          <div className="hidden overflow-hidden rounded-lg border @2xl:block">
            {/* table-fixed + explicit widths: columns stay put and long titles
                wrap instead of forcing the table wider than its container. */}
            <table className="w-full table-fixed text-xs">
              <colgroup>
                <col className="w-[30%]" />
                <col className="w-[11%]" />
                <col className="w-[35%]" />
                <col className="w-[24%]" />
              </colgroup>
              <thead className="bg-muted/50 text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold">Riwayat Posisi Kandidat</th>
                  <th className="px-3 py-2 text-right font-semibold">Durasi</th>
                  <th className="px-3 py-2 text-left font-semibold">Pembanding (dokumen / kompetensi incumbent)</th>
                  <th className="px-3 py-2 text-right font-semibold">
                    {hasDepth ? 'Relevansi (skala) · th efektif' : 'Similarity'}
                  </th>
                </tr>
              </thead>
              <tbody>
                {/* The whole row is the affordance — clicking anywhere in it
                    opens that stint's derivation. A <tr> cannot be a <button>
                    without breaking table layout, so the row carries the handler
                    and a keyboard-reachable role instead. */}
                {detail.pairs.map((p, i) => (
                  <tr
                    key={i}
                    role="button"
                    tabIndex={0}
                    aria-label={`Lihat penjabaran skor periode ${stintTitle(p, ids.demo)}`}
                    onClick={() => showPair(i)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        showPair(i);
                      }
                    }}
                    className="group cursor-pointer border-t align-top transition-colors hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/50"
                  >
                    <td className="px-3 py-2">
                      <CareerPairTitle p={p} />
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-foreground/80">
                      {p.years.toFixed(2)} th
                    </td>
                    <td className="px-3 py-2">
                      <CareerPairComparator p={p} basis={basisOf(p)} />
                    </td>
                    <td className="px-3 py-2">
                      <CareerPairSimilarity p={p} basis={basisOf(p)} />
                      <div className="mt-0.5 text-right opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                        <TapHint />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Derivation popups ── */}
      {hasDepth && openAxis && (
        <DerivationPanel
          open
          onOpenChange={(v) => !v && setOpenAxis(null)}
          title={
            openAxis === 'years'
              ? `Kedalaman durasi — ${detail.effectiveYears?.toFixed(2)} / ${detail.targetYears?.toFixed(2)} tahun`
              : `Kedalaman riwayat — ${detail.effectiveRows?.toFixed(2)} / ${detail.targetRows?.toFixed(2)} periode`
          }
          subtitle={`Asal setiap angka, sampai skor Career ${detail.score}.`}
          copy={(o) => withAskWrapper(buildCareerDepthMarkdown(detail, openAxis), null, o)}
          askRef={askRefAxis}
        >
          <CareerDepthDerivation detail={detail} axis={openAxis} />
        </DerivationPanel>
      )}

      {activePair && (
        <DerivationPanel
          open
          onOpenChange={(v) => !v && setOpenPair(null)}
          title={activePair.title}
          subtitle={
            activePair.similarity != null
              ? `Relevansi ${activePair.similarity.toFixed(3)} · ${stintEffectiveYears(activePair).toFixed(2)} th efektif — asal angkanya.`
              : 'Periode ini menyumbang 0 — sebabnya di bawah.'
          }
          copy={(o) =>
            withAskWrapper(buildCareerPairMarkdown(activePair, basisOf(activePair), detail), null, o)
          }
          askRef={askRefStint}
        >
          <CareerPairDerivation
            p={activePair}
            basis={basisOf(activePair)}
            detail={detail}
          />
        </DerivationPanel>
      )}
    </div>
  );
}

// ── Remaining criterion blocks ─────────────────────────────────────

function KeyVal({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 rounded-md border bg-muted/20 px-3 py-1.5">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className="text-xs font-medium text-foreground/90">{value ?? '—'}</span>
    </div>
  );
}

// Provenance of the education score → badge label/tone.
const EDU_SOURCE_META: Record<string, { label: string; tone: string; icon: typeof ShieldCheck }> = {
  'exact-match': {
    label: 'Exact match (deterministik)',
    tone: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    icon: ShieldCheck,
  },
  'llm-grounded': {
    label: 'Gemini + Grounding Google Search',
    tone: 'border-violet-500/40 bg-violet-500/10 text-violet-600 dark:text-violet-400',
    icon: Sparkles,
  },
  'llm-structured': {
    label: 'Gemini structured output (tanpa grounding)',
    tone: 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400',
    icon: Sparkles,
  },
  'bert-fallback': {
    label: 'Fallback kemiripan (BERT)',
    tone: 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400',
    icon: Info,
  },
  none: {
    label: 'Tidak tersedia',
    tone: 'border-muted-foreground/30 text-muted-foreground',
    icon: Info,
  },
};

// Rubric anchors: 100 sangat relevan · 80 relevan · 60 cukup · 40 kurang · 20 tidak relevan.
function rubricLabel(score: number): string {
  if (score >= 90) return 'sangat relevan';
  if (score >= 70) return 'relevan';
  if (score >= 50) return 'cukup';
  if (score >= 30) return 'kurang';
  return 'tidak relevan';
}

function RubricBar({ label, value }: { label: string; value: number }) {
  const tone =
    value >= 80
      ? 'bg-emerald-500'
      : value >= 60
        ? 'bg-blue-500'
        : value >= 40
          ? 'bg-amber-500'
          : 'bg-rose-500';
  return (
    <div className="rounded-md border bg-muted/10 p-2">
      <div className="mb-1 flex items-center justify-between text-[10px] text-muted-foreground">
        <span className="font-semibold uppercase tracking-wider">{label}</span>
        <span className="tabular-nums">
          {value}/100 · {rubricLabel(value)}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className={cn('h-full rounded-full', tone)} style={{ width: `${Math.max(2, value)}%` }} />
      </div>
    </div>
  );
}

/**
 * Performance Appraisal, fully derived from the stored six-slot CSV.
 *
 * Everything here is rebuilt rather than read (see lib/pa-topsis.ts), so runs
 * finished before this existed get the same explanation. The three things a
 * reader cannot get from the number alone are all stated: blank slots were read
 * as C rather than ignored, the anchors are absolute so the score is comparable
 * across runs, and E sits below the negative anchor which makes all-E outrank
 * all-D.
 */
function PerformanceDerivation({
  detail,
}: {
  detail: NonNullable<CandidateProgressRow['performanceDetail']>;
}) {
  const b = computePaBreakdown(detail.grade, detail.score ?? null);
  const sumPlus = b.periods.reduce((a, p) => a + p.contribPlus, 0);
  const sumMinus = b.periods.reduce((a, p) => a + p.contribMinus, 0);

  return (
    <>
      <DerivStep title="1. Enam slot semester → angka">
        <p>
          Sumbernya satu CSV enam slot, <b>semester terbaru lebih dulu</b>. Jendelanya tiga tahun
          kalender SEBELUM tahun berjalan — tahun berjalan selalu dikecualikan, dan itulah jawaban
          atas &ldquo;kenapa PA saya masih C padahal semester ini A&rdquo;.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-75 text-[10px]">
            <thead>
              <tr className="border-b text-muted-foreground">
                <th className="py-1 text-left font-semibold">Periode</th>
                <th className="py-1 text-center font-semibold">Nilai</th>
                <th className="py-1 text-right font-semibold">Angka</th>
                <th className="py-1 text-right font-semibold">Bobot</th>
                <th className="py-1 text-right font-semibold">→ D⁺</th>
                <th className="py-1 text-right font-semibold">→ D⁻</th>
              </tr>
            </thead>
            <tbody className="text-muted-foreground">
              {b.periods.map((p) => (
                <tr key={p.index} className="border-b border-dashed last:border-0">
                  <td className="py-1">{p.label}</td>
                  <td className="py-1 text-center font-mono">
                    {p.raw || '—'}
                    {p.substituted && (
                      <span className="ml-1 text-amber-600 dark:text-amber-400">(→C)</span>
                    )}
                  </td>
                  <td className="py-1 text-right font-mono">{p.value}</td>
                  <td className="py-1 text-right font-mono">{p.weight.toFixed(4)}</td>
                  <td className="py-1 text-right font-mono">{p.contribPlus.toFixed(4)}</td>
                  <td className="py-1 text-right font-mono">{p.contribMinus.toFixed(4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Derivation>{`  A = 4 · B = 3 · C = 2 · D = 1 · E = 0`}</Derivation>
        {b.substitutedCount > 0 && (
          <p className="rounded-md bg-amber-500/10 px-2.5 py-2 text-amber-700 dark:text-amber-300">
            <b>{b.substitutedCount} slot kosong atau tidak dikenali dibaca sebagai C</b>, bukan
            diabaikan. Bedanya penting: mengabaikan akan mengecilkan pembagi, sementara membaca
            sebagai C memasukkan periode itu ke perhitungan dengan nilai tengah. Kandidat yang sama
            sekali tidak punya data PA karena itu mendapat <b>33</b> — bukan 0, dan bukan 50.
            {b.substitutedCount === b.periods.length && ' Seluruh slot kandidat ini kosong.'}
          </p>
        )}
      </DerivStep>

      <DerivStep title="2. Jarak ke dua jangkar ABSOLUT">
        <p>
          Jangkarnya <b>tetap</b>, bukan diambil dari kandidat lain: ideal = semua A (
          {PA_IDEAL_POSITIVE}), anti-ideal = semua D ({PA_IDEAL_NEGATIVE}). Inilah yang membuat skor
          PA <b>sebanding antar-run</b> — berbeda dari skor akhir yang set-relative.
        </p>
        <Derivation>
          {`  D⁺ = akar( Σ bobot × ( nilai − ${PA_IDEAL_POSITIVE} )² )   ← jarak ke "semua A"
  D⁻ = akar( Σ bobot × ( nilai − ${PA_IDEAL_NEGATIVE} )² )   ← jarak ke "semua D"

  D⁺ = akar( ${sumPlus.toFixed(4)} )  =  ${b.dPlus.toFixed(4)}
  D⁻ = akar( ${sumMinus.toFixed(4)} )  =  ${b.dMinus.toFixed(4)}`}
        </Derivation>
      </DerivStep>

      <DerivStep title="3. Kedekatan → skor">
        <Derivation>
          {`  CC = D⁻ ÷ ( D⁺ + D⁻ )
     = ${b.dMinus.toFixed(4)} ÷ ( ${b.dPlus.toFixed(4)} + ${b.dMinus.toFixed(4)} )
     = ${b.closeness.toFixed(4)}

  skor PA = bulat( CC × 100 ) = ${b.score}`}
        </Derivation>
        {!b.recomputedMatchesStored && (
          <p className="rounded-md bg-amber-500/10 px-2.5 py-2 text-amber-700 dark:text-amber-300">
            <b>
              Hasil hitung ulang ({b.score}) berbeda dari skor tersimpan ({b.storedScore}).
            </b>{' '}
            Penjabaran di atas memakai bobot periode yang berlaku SEKARANG (27,1% turun sampai
            8,9%), sementara skor tersimpan dihasilkan oleh bobot yang berlaku saat run itu
            dijalankan. Angka {b.storedScore} itulah yang membentuk peringkat run ini dan tidak
            diubah.
          </p>
        )}
        {b.uniform && (
          <p className="rounded-md bg-muted/50 px-2.5 py-2">
            Seluruh periode kandidat ini bernilai sama, sehingga{' '}
            <b>degradasi bobot tidak berpengaruh sama sekali</b> pada skornya: kedua jarak sama-sama
            berskala akar(Σbobot) = 1, dan kedekatannya identik untuk pembobotan apa pun. Bobot
            baru membedakan ketika nilai antar-periode berbeda.
          </p>
        )}
      </DerivStep>

      <DerivStep title="4. Aturan yang perlu diketahui">
        <ul className="ml-3 list-disc space-y-1">
          <li>
            <b>Periode lama sengaja didegradasi bobotnya.</b> Preferensi kebaruan{' '}
            <span className="font-mono">0,8^k</span> diubah menjadi matriks perbandingan berpasangan
            yang konsisten sempurna, lalu diambil vektor prioritas AHP-nya (CR = 0): 27,1% · 21,7%
            · 17,3% · 13,9% · 11,1% · 8,9% dari terbaru ke terlama — semester terbaru bernilai
            sekitar tiga kali yang tertua.
          </li>
          <li>
            Konsekuensinya <b>urutan nilai berpengaruh</b>, dan itu memang dimaksudkan:{' '}
            <span className="font-mono">A,C,C,C,C,C</span> mendapat 51 sementara{' '}
            <span className="font-mono">C,C,C,C,C,A</span> mendapat 41. Yang pertama membaik belakangan,
            yang kedua menurun — dua hal yang berbeda dan sengaja dinilai berbeda.
          </li>
          <li>
            Skor PA <b>sebanding antar-run</b> karena jangkarnya absolut — berbeda dari skor akhir
            TOPSIS yang bergantung pada peserta run.
          </li>
          {b.anomaly === 'below_negative_anchor' && (
            <li className="text-amber-700 dark:text-amber-300">
              <b>Anomali nyata pada rekam jejak ini:</b> nilai E = 0 berada DI BAWAH jangkar negatif
              D = 1, sehingga jaraknya ke &ldquo;semua D&rdquo; bukan nol. Akibatnya rekam jejak
              semua-E mendapat <b>20</b> sementara semua-D mendapat <b>0</b> — E dinilai lebih
              tinggi daripada D. Ini konsekuensi pemilihan jangkar, bukan penilaian.
            </li>
          )}
        </ul>
      </DerivStep>
    </>
  );
}

function PerformanceBlock({
  detail,
}: {
  detail: NonNullable<CandidateProgressRow['performanceDetail']>;
}) {
  const [open, setOpen] = useState(false);
  const b = computePaBreakdown(detail.grade, detail.score ?? null);
  const askRefPa = useAskRef(undefined, { kind: 'performance' });
  useReopenPanel('performance', () => setOpen(true));

  return (
    <div className="space-y-2">
      <KeyVal label="Grade PA enam semester (terbaru dulu)" value={detail.grade ?? '(tidak ada)'} />
      <ClickableFigure
        onClick={() => setOpen(true)}
        label="Lihat penjabaran skor Performance Appraisal"
        className="w-full rounded-md border border-dashed px-2.5 py-1.5 text-[11px]"
      >
        <span className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-muted-foreground">
            D⁺ {b.dPlus.toFixed(3)} · D⁻ {b.dMinus.toFixed(3)} · CC {b.closeness.toFixed(3)}
          </span>
          <span className="flex items-center gap-2">
            <span className="font-semibold tabular-nums text-foreground">{detail.score}/100</span>
            <TapHint />
          </span>
        </span>
      </ClickableFigure>
      {b.substitutedCount > 0 && (
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          {b.substitutedCount} dari {b.periods.length} slot kosong dan dibaca sebagai C — skor ini
          sebagian bertumpu pada nilai substitusi, bukan penilaian nyata.
        </p>
      )}
      <DerivationPanel
        open={open}
        onOpenChange={setOpen}
        title={`Skor Performance Appraisal ${detail.score}`}
        subtitle="TOPSIS jangkar absolut, bobot periode terdegradasi — asal setiap angkanya."
        copy={(o) => withAskWrapper(buildPerformanceMarkdown(detail), null, o)}
        askRef={askRefPa}
      >
        <PerformanceDerivation detail={detail} />
      </DerivationPanel>
    </div>
  );
}

/**
 * The exact-match tier for this run. Recorded when the run stored it, otherwise
 * RE-DERIVED from education vs requirement — never inferred from the score, which
 * cannot tell a tier value from a legacy flat one. Every run, old or new, is
 * therefore explained by the same rule. See lib/education-tier.ts.
 */
export function eduExactTier(
  detail: NonNullable<CandidateProgressRow['educationDetail']>,
): 'higher' | 'equal' | 'lower' | null {
  return eduTierInfo(detail)?.tier ?? null;
}

function eduTierInfo(detail: NonNullable<CandidateProgressRow['educationDetail']>) {
  return resolveEduTier({
    source: detail.source,
    score: detail.score,
    education: detail.education,
    requirement: detail.requirement,
    exactComparison: detail.exactComparison ?? null,
  });
}

/**
 * How the education score was arrived at. Two completely different paths, and
 * conflating them is precisely what produced wrong explanations: on the
 * exact-match path the score is a TIER (100/80/50) and the two rubric sub-scores
 * do not exist, while on the LLM path the score is the plain MEAN of those two
 * sub-scores. Readers seeing "exact match" beside 80 reconstructed it as a
 * weighted blend of sub-scores that were null.
 */
function EducationDerivation({
  detail,
}: {
  detail: NonNullable<CandidateProgressRow['educationDetail']>;
}) {
  const info = eduTierInfo(detail);
  const tier = info?.tier ?? null;
  const isLlm = detail.source === 'llm-grounded' || detail.source === 'llm-structured';

  return (
    <>
      <DerivStep title="1. Yang dibandingkan">
        <Derivation>
          {`  Pendidikan kandidat :  ${detail.education ?? '—'}
  Jurusan kandidat    :  ${detail.major ?? '—'}
  Syarat posisi       :  ${detail.requirement ?? '(tidak dinyatakan)'}
  Sumber syarat       :  ${detail.requirementSource ? eduRequirementSourceLabel[detail.requirementSource] : '—'}`}
        </Derivation>
        {detail.requirementSource === 'incumbent' && (
          <p className="rounded-md bg-sky-500/10 px-2.5 py-2 text-sky-700 dark:text-sky-300">
            Syarat ini <b>bukan</b> syarat resmi jabatan — job profile dan kolom pendidikan posisi
            keduanya kosong, sehingga pendidikan pemegang jabatan saat ini dipakai sebagai patokan.
            Itu pendekatan, bukan ketentuan.
          </p>
        )}
      </DerivStep>

      {tier ? (
        <>
          <DerivStep title="2. Jalur PENCOCOKAN PERSIS (deterministik, tanpa model bahasa)">
            <p>
              Jenjang <b>dan</b> bidang studi kandidat sama-sama memenuhi syarat, jadi skornya
              ditentukan langsung oleh sebuah <b>tingkatan</b> — bukan dihitung dari sub-skor apa
              pun. Kedua sub-skor (Jenjang Pendidikan / Relevansi Jurusan) memang{' '}
              <b>tidak ada</b> di jalur ini.
            </p>
            <Derivation>
              {`  TINGKATAN pencocokan persis:

      jenjang LEBIH TINGGI dari syarat   ->  100
      jenjang SETARA dengan syarat       ->   80     <-- ${tier === 'equal' ? 'kandidat ini' : ''}
      jenjang LEBIH RENDAH dari syarat   ->   50

  Kandidat ini  : ${EDU_TIER_LABEL[tier]}
  Nilai aturan  : ${info?.ruleScore}
  Skor tersimpan: ${detail.score}`.replace(/ *<-- $/gm, '')}
            </Derivation>
            {tier === 'equal' && (
              <p className="rounded-md bg-primary/10 px-2.5 py-2 text-foreground">
                <span className="font-semibold">
                  Inilah sebabnya skornya {detail.score} dan bukan 100 meskipun pencocokannya persis.
                </span>{' '}
                Pencocokan persis pada jenjang yang <b>setara</b> memang bernilai{' '}
                {info?.ruleScore} menurut aturan tingkatan.
                Nilai 100 hanya untuk kandidat yang jenjangnya <b>di atas</b> syarat — misalnya S2
                melawan syarat S1. Jadi 80 di sini berarti &ldquo;tepat memenuhi&rdquo;, bukan
                &ldquo;ada yang kurang&rdquo;.
              </p>
            )}
            {info?.basis === 'derived' && (
              <p className="rounded-md bg-muted/50 px-2.5 py-2">
                Tingkatan ini <b>diturunkan ulang</b> dari jenjang kandidat terhadap syarat posisi,
                karena run ini selesai sebelum tingkatan mulai dicatat. Aturan penurunannya sama
                persis dengan yang dipakai mesin skoring, jadi tingkatan di atas tetap sah.
              </p>
            )}
            {info?.deviates && (
              <p className="rounded-md bg-amber-500/10 px-2.5 py-2 text-amber-700 dark:text-amber-300">
                <span className="font-semibold">
                  Skor tersimpan {detail.score} berbeda dari nilai aturan {info.ruleScore}.
                </span>{' '}
                Run ini dinilai sebelum aturan tingkatan berlaku, ketika setiap pencocokan persis
                diberi satu nilai tunggal. Angka {detail.score} itulah yang benar-benar masuk ke
                TOPSIS dan membentuk peringkat run ini, jadi <b>tidak diubah</b> — mengubahnya akan
                membuat halaman ini bertentangan dengan peringkat yang dijelaskannya. Untuk
                mendapatkan nilai aturan, jalankan Scoring Ulang.
              </p>
            )}
            {tier === 'lower' && (
              <p className="rounded-md bg-amber-500/10 px-2.5 py-2 text-amber-700 dark:text-amber-300">
                Bidang studinya cocok, tetapi jenjangnya di bawah syarat — karena itu tingkatannya
                50, bukan 0. Memiliki jurusan yang tepat pada jenjang lebih rendah tetap dihargai
                separuh.
              </p>
            )}
            {(detail.matchedTokens ?? []).length > 0 && (
              <p>
                Token yang membuat pencocokan ini terjadi:{' '}
                <span className="font-mono text-foreground/80">
                  {(detail.matchedTokens ?? []).join(', ')}
                </span>
                .
              </p>
            )}
          </DerivStep>
          <DerivStep title="3. Apa yang bisa menaikkannya">
            <p>
              {tier === 'higher'
                ? 'Sudah pada tingkatan tertinggi (100) — tidak ada yang perlu ditingkatkan.'
                : tier === 'equal'
                  ? 'Hanya jenjang pendidikan yang lebih tinggi dari syarat jabatan yang akan memindahkannya ke tingkatan 100. Relevansi jurusan tidak lagi berpengaruh di sini, karena jalur ini sudah menyatakan jurusannya cocok.'
                  : 'Menaikkan jenjang pendidikan hingga setara syarat akan memindahkannya ke tingkatan 80.'}
            </p>
          </DerivStep>
        </>
      ) : info && info.basis === 'undeterminable' ? (
        <DerivStep title="2. Jalur PENCOCOKAN PERSIS — tingkatan tidak dapat ditentukan">
          <p>
            Jenjang <b>dan</b> bidang studi kandidat sama-sama memenuhi syarat, jadi kriteria ini
            tidak melibatkan model bahasa dan kedua sub-skor (Jenjang / Relevansi Jurusan) memang{' '}
            <b>tidak ada</b>.
          </p>
          <p className="rounded-md bg-amber-500/10 px-2.5 py-2 text-amber-700 dark:text-amber-300">
            Tingkatannya <b>tidak dapat ditentukan</b>: tidak ada jenjang yang dikenali pada sisi
            kandidat maupun pada syarat posisi, sehingga perbandingan jenjang tidak pernah terjadi.
            Ini berbeda dari &ldquo;tidak tercatat&rdquo; — memang tidak ada yang bisa dibandingkan.
            Tingkatannya juga <b>tidak boleh</b> disimpulkan dari besarnya skor.
          </p>
          <Derivation>
            {`  ATURAN TINGKATAN:

      jenjang LEBIH TINGGI dari syarat   ->  100
      jenjang SETARA dengan syarat       ->   80
      jenjang LEBIH RENDAH dari syarat   ->   50`}
          </Derivation>
        </DerivStep>
      ) : isLlm ? (
        <>
          <DerivStep title="2. Jalur PENILAIAN MODEL BAHASA (tidak ada pencocokan persis)">
            <p>
              Jenjang atau bidang studi kandidat <b>tidak</b> cocok persis dengan syarat posisi,
              sehingga <b>relevansinya</b> dinilai oleh model bahasa terhadap tanggung jawab dan
              indikator keberhasilan jabatan — bukan hanya terhadap syarat minimalnya.
              {detail.source === 'llm-grounded'
                ? ' Penilaiannya di-grounding ke pencarian web sehingga alasannya bisa mengutip sumber.'
                : ' Panggilan grounded gagal menghasilkan format yang valid, sehingga dipakai jalur perbaikan tanpa kutipan sumber — rubriknya sama.'}
            </p>
            {detail.reusedFrom && (
              <p className="rounded-md bg-sky-500/10 px-2.5 py-2 text-sky-700 dark:text-sky-300">
                <span className="font-semibold">Model tidak dipanggil ulang pada run ini.</span>{' '}
                Seluruh masukan yang dibaca model — jenjang dan jurusan kandidat, syarat
                pendidikan, judul posisi, tujuan jabatan, tanggung jawab beserta indikatornya,
                prompt, dan pengaturan model — <b>identik</b> dengan run terakhir posisi ini, jadi
                jawaban model dari run tersebut dipakai ulang supaya masukan yang sama selalu
                menghasilkan skor yang sama. Jawaban ini diberikan pada run{' '}
                <span className="font-mono">{detail.reusedFrom.answeredInRunId.slice(0, 8)}</span>
                {detail.reusedFrom.answeredAt
                  ? ` (${formatDateTime(detail.reusedFrom.answeredAt)})`
                  : ''}
                . Sumbu jenjang tetap dihitung ulang dengan aturan run ini.
              </p>
            )}
            <p className="rounded-md bg-primary/10 px-2.5 py-2 text-foreground">
              <span className="font-semibold">Kesesuaian JENJANG tetap ditentukan aturan tetap,</span>{' '}
              bukan oleh model. Model ditanya soal jenjang dan jurusan secara terpisah, tetapi{' '}
              <b>kedua jawabannya diakumulasikan menjadi satu sumbu relevansi</b>. Dengan begitu
              aturan &ldquo;jenjang di atas syarat minimal dihargai lebih tinggi daripada yang
              sekadar setara&rdquo; berlaku sama di jalur ini maupun di jalur pencocokan persis.
            </p>
            <Derivation>
              {`SUMBU 1 — JENJANG (aturan tetap, bukan model)

    ${
      detail.levelComparison
        ? `${EDU_TIER_LABEL[detail.levelComparison]}
    -> nilai ${detail.levelScore}`
        : 'tidak dapat ditentukan -> sumbu ini DIBUANG'
    }

    LEBIH TINGGI = 100 · SETARA = 80 · LEBIH RENDAH = 50


SUMBU 2 — RELEVANSI (akumulasi dua jawaban model)

    jawaban model, relevansi jenjang   :  ${detail.educationLevel ?? '—'}
    jawaban model, relevansi jurusan   :  ${detail.majorRelevance ?? '—'}
    akumulasi = ( ${detail.educationLevel ?? '—'} + ${detail.majorRelevance ?? '—'} ) ÷ 2
                                       =  ${detail.groundedMajorAxis ?? '—'}


SKOR AKHIR${
                detail.levelScore != null
                  ? `

    = ( sumbu jenjang + sumbu relevansi ) ÷ 2
    = ( ${detail.levelScore} + ${detail.groundedMajorAxis ?? '—'} ) ÷ 2
    = ${detail.score}`
                  : `

    sumbu jenjang dibuang, jadi skor = sumbu relevansi
    = ${detail.score}`
              }`}
            </Derivation>
            {detail.groundedMajorAxis == null && (
              <p className="rounded-md bg-amber-500/10 px-2.5 py-2 text-amber-700 dark:text-amber-300">
                Run ini selesai sebelum sumbu jenjang dipindahkan keluar dari penilaian model,
                sehingga skornya masih rata-rata dua jawaban model dan tidak memuat sumbu jenjang
                berbasis aturan. Rinciannya di atas hanya sebagian.
              </p>
            )}
          </DerivStep>
          {detail.levelScore != null && detail.groundedMajorAxis != null && (
            <DerivStep title="3. Sumbu mana yang menahan skornya">
              {(() => {
                const lv = detail.levelScore!;
                const mj = detail.groundedMajorAxis!;
                if (lv === mj) {
                  return (
                    <p>
                      Kedua sumbu sama besar ({lv}), jadi keduanya menahan skor secara seimbang.
                      Karena skornya rata-rata sederhana, setiap 2 poin pada salah satu sumbu
                      memindahkan skor akhir 1 poin.
                    </p>
                  );
                }
                const lowIsLevel = lv < mj;
                return (
                  <>
                    <p className="rounded-md bg-primary/10 px-2.5 py-2 text-foreground">
                      <span className="font-semibold">
                        {lowIsLevel ? 'Sumbu JENJANG' : 'Sumbu RELEVANSI'} ({Math.min(lv, mj)})
                        adalah yang menahan skor ini
                      </span>{' '}
                      — sumbu satunya {Math.max(lv, mj)}. Setiap 2 poin pada sumbu penahan
                      memindahkan skor akhir 1 poin.
                    </p>
                    <p>
                      {lowIsLevel
                        ? detail.levelComparison === 'lower'
                          ? 'Artinya: jenjang pendidikan kandidat berada DI BAWAH syarat minimal jabatan, dan itu dinilai 50 menurut aturan — bukan 0, karena memiliki jurusan yang relevan pada jenjang lebih rendah tetap dihargai separuh. Hanya menaikkan jenjang yang akan menggeser sumbu ini.'
                          : 'Artinya: jenjangnya tepat memenuhi syarat (80), bukan di atasnya. Hanya jenjang yang LEBIH TINGGI dari syarat minimal akan menggeser sumbu ini ke 100.'
                        : 'Artinya: jenjangnya sudah memadai menurut aturan, dan yang menahan skor adalah penilaian relevansi oleh model. Baca bagian "Alasan" di bawah — di situ model menyebut bagian tanggung jawab mana yang kurang tertutupi oleh jenjang/jurusan tersebut.'}
                    </p>
                  </>
                );
              })()}
            </DerivStep>
          )}
        </>
      ) : (
        <DerivStep title="2. Tidak dapat dinilai — skor 0">
          <p className="rounded-md bg-amber-500/10 px-2.5 py-2 text-amber-700 dark:text-amber-300">
            {detail.reason ??
              'Tidak ada pencocokan persis, dan penilaian model bahasa tidak dapat dijalankan.'}
          </p>
          <p>
            Nol di sini berarti <b>belum dinilai</b>, bukan &ldquo;pendidikannya tidak sesuai&rdquo;.
            Bedanya penting: yang pertama masalah data atau konfigurasi, yang kedua temuan tentang
            kandidat. Bila seluruh pool bernilai 0, kriteria ini dibuang dari matriks TOPSIS dan
            bobotnya dibagikan ke kriteria lain.
          </p>
        </DerivStep>
      )}

      {detail.reason && (
        <DerivStep title={tier ? '4. Alasan yang tercatat' : isLlm ? '4. Alasan dari model' : '3. Alasan yang tercatat'}>
          <p className="rounded-md border bg-muted/20 px-2.5 py-2 leading-relaxed text-foreground/80">
            {detail.reason}
          </p>
        </DerivStep>
      )}
    </>
  );
}

/** Where the education requirement came from — 'incumbent' is an approximation. */
const eduRequirementSourceLabel: Record<string, string> = {
  profile: 'dokumen job profile posisi',
  critical_position: 'kolom pendidikan pada posisi',
  incumbent: 'pendidikan pemegang jabatan saat ini (PENDEKATAN, bukan syarat resmi)',
  none: 'tidak ada syarat yang dinyatakan',
};

function EducationBlock({ detail }: { detail: NonNullable<CandidateProgressRow['educationDetail']> }) {
  const meta = EDU_SOURCE_META[detail.source] ?? EDU_SOURCE_META.none!;
  const SourceIcon = meta.icon;
  const matchedTokens = detail.matchedTokens ?? [];
  const searchQueries = detail.searchQueries ?? [];
  const sources = detail.sources ?? [];
  const items = detail.items ?? [];
  const hasRubric = detail.educationLevel != null || detail.majorRelevance != null;
  const [open, setOpen] = useState(false);
  const tier = eduExactTier(detail);
  const askRefEdu = useAskRef(undefined, { kind: 'education' });
  useReopenPanel('education', () => setOpen(true));

  return (
    <div className="space-y-2.5">
      {/* Provenance + final score */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" className={cn('gap-1 text-[10px]', meta.tone)}>
            <SourceIcon className="h-3 w-3" />
            {meta.label}
          </Badge>
          {/* The model was not asked in THIS run: identical inputs, so the last
              run's answer was reused (scoring-service/src/education-reuse.ts). */}
          {detail.reusedFrom && (
            <Badge
              variant="outline"
              className="text-[10px] border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300"
              title="Masukan identik dengan run terakhir posisi ini, jadi jawaban model dipakai ulang tanpa memanggil model lagi. Penjelasan lengkap ada di penjabaran skor."
            >
              Jawaban model dipakai ulang
            </Badge>
          )}
        </div>
        <ClickableFigure
          onClick={() => setOpen(true)}
          label="Lihat penjabaran skor edukasi"
          className="rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground"
        >
          Skor edukasi:{' '}
          <span className="font-semibold tabular-nums text-foreground">{detail.score}/100</span>{' '}
          <TapHint />
        </ClickableFigure>
      </div>

      {/* The one thing the number cannot say on its own: on the exact-match path
          80 is a TIER meaning "exactly meets", not a deduction. Stated inline
          because that misreading is the whole reason this popup exists. */}
      {tier === 'equal' && (
        <p className="rounded-md bg-primary/5 px-2.5 py-1.5 text-[10px] leading-relaxed text-muted-foreground">
          Pencocokan persis dengan jenjang <b>setara</b> syarat bernilai{' '}
          <b className="text-foreground">{detail.score}</b> menurut aturan tingkatan — bukan
          pengurangan dari 100. Nilai 100 hanya untuk jenjang yang <b>di atas</b> syarat.
        </p>
      )}

      <DerivationPanel
        open={open}
        onOpenChange={setOpen}
        title={`Skor edukasi ${detail.score} — ${meta.label}`}
        subtitle="Asal angkanya, dan apa yang menentukannya."
        copy={(o) => withAskWrapper(buildEducationMarkdown(detail), null, o)}
        askRef={askRefEdu}
      >
        <EducationDerivation detail={detail} />
      </DerivationPanel>

      {/* Candidate vs requirement */}
      <div className="grid gap-2 sm:grid-cols-3">
        <KeyVal label="Pendidikan" value={detail.education} />
        <KeyVal label="Jurusan" value={detail.major} />
        <KeyVal label="Persyaratan Posisi" value={detail.requirement ?? '—'} />
      </div>

      {/* Rubric sub-scores (grounded path) */}
      {hasRubric && (
        <div className="grid gap-2 sm:grid-cols-2">
          {detail.educationLevel != null && (
            <RubricBar label="Jenjang Pendidikan" value={detail.educationLevel} />
          )}
          {detail.majorRelevance != null && (
            <RubricBar label="Relevansi Jurusan" value={detail.majorRelevance} />
          )}
        </div>
      )}

      {/* Exact-match matched tokens */}
      {detail.source === 'exact-match' && matchedTokens.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Token cocok:
          </span>
          {matchedTokens.map((t, i) => (
            <Badge key={i} variant="secondary" className="text-[10px] font-mono">
              {t}
            </Badge>
          ))}
        </div>
      )}

      {/* Rationale (grounded/exact reason — basis for gap analysis) */}
      {detail.reason && (
        <div className="rounded-md border bg-muted/10 p-2">
          <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Alasan{detail.source === 'llm-grounded' ? ' (grounded)' : ''}
          </p>
          <p className="text-[11px] leading-relaxed text-foreground/80">{detail.reason}</p>
        </div>
      )}

      {/* Grounding provenance: search queries + cited sources */}
      {(searchQueries.length > 0 || sources.length > 0) && (
        <div className="rounded-md border border-violet-500/20 bg-violet-500/5 p-2 space-y-1.5">
          {searchQueries.length > 0 && (
            <div className="flex flex-wrap items-center gap-1">
              <Search className="h-3 w-3 shrink-0 text-violet-500" />
              {searchQueries.map((q, i) => (
                <Badge key={i} variant="outline" className="border-violet-500/30 text-[10px]">
                  {q}
                </Badge>
              ))}
            </div>
          )}
          {sources.length > 0 && (
            <div className="space-y-0.5">
              {sources.map((s, i) => (
                <a
                  key={i}
                  href={s.uri}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 truncate text-[11px] text-violet-600 hover:underline dark:text-violet-400"
                  title={s.uri}
                >
                  <ExternalLink className="h-3 w-3 shrink-0" />
                  <span className="truncate">{s.title || s.uri}</span>
                </a>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Legacy per-responsibility items (older runs only) */}
      {items.length > 0 && (
        <div className="space-y-1.5">
          {items.map((it, i) => (
            <div key={i} className="rounded-md border bg-muted/10 p-2">
              <div className="mb-0.5 flex items-center justify-between text-[10px] text-muted-foreground">
                <span>Tanggung jawab #{it.idResponsibility}</span>
                <span className="tabular-nums">{it.score}/100</span>
              </div>
              <p className="text-[11px] leading-relaxed text-foreground/80">{it.analysis}</p>
            </div>
          ))}
        </div>
      )}

      {!detail.reason && !hasRubric && items.length === 0 && (
        <EmptyNote>Tidak ada analisis pendidikan tambahan (fallback/none).</EmptyNote>
      )}
    </div>
  );
}

// ── Single-criterion detail block ──────────────────────────────────

export type CriterionKey = keyof ScoreBreakdown;

/** Ordered as they appear on the candidate card / breakdown chips. */
export const CRITERION_ORDER: CriterionKey[] = [
  'technical',
  'career',
  'behavior',
  'performance',
  'hav',
  'education',
];

/** Short labels, as used on the candidate card's summary line. */
export const CRITERION_LABELS: Record<CriterionKey, string> = Object.fromEntries(
  CRITERIA.map((cr) => [cr.key, cr.label]),
) as Record<CriterionKey, string>;

export type AspectWeights = Partial<Record<CriterionKey, number>>;

/**
 * The aspect carrying the largest AHP weight in a run. Scale-agnostic — stored
 * runs keep percentages while a matrix recomputed from `computeAhpWeights`
 * yields fractions, and only the argmax is wanted. Ties fall to the earliest
 * entry in CRITERION_ORDER so the header does not shuffle between renders.
 *
 * A run whose program ships no pairwise matrix scored under
 * DEFAULT_ASPECT_WEIGHTS — those ARE the weights in force, not an absence of
 * weights — so an empty/zero map falls back to them rather than to equal shares.
 */
export function topWeightedCriterion(weights?: AspectWeights | null): CriterionKey {
  const effective: AspectWeights =
    weights && CRITERION_ORDER.some((k) => Number(weights[k] ?? 0) > 0)
      ? weights
      : DEFAULT_ASPECT_WEIGHTS;
  let best = CRITERION_ORDER[0];
  for (const key of CRITERION_ORDER) {
    if (Number(effective[key] ?? 0) > Number(effective[best] ?? 0)) best = key;
  }
  return best;
}

export const CRITERION_TITLES: Record<CriterionKey, string> = {
  technical: 'Technical Competency',
  career: 'Career Relevance',
  behavior: 'Behavior',
  performance: 'Performance Appraisal',
  hav: 'HAV Mapping',
  education: 'Employee Profile — Pendidikan',
};

/**
 * One aspect of the AHP+TOPSIS breakdown, rendered as the same bordered section
 * used on the candidate card. Shared so the Kandidat tab's breakdown-chip popup
 * shows exactly what the Readiness tab shows for that criterion.
 */
export function CriterionDetail({ c, criterion }: { c: CandidateProgressRow; criterion: CriterionKey }) {
  const title = CRITERION_TITLES[criterion];
  // One anchor per (criterion, candidate). A chat chip scrolls back to exactly
  // this section, so both sides must derive the id the same way — hence
  // criterionAnchorId rather than a string built inline here.
  const anchor = criterionAnchorId(criterion, c.candidateId);
  // Built directly, NOT via useAskRef: this component is what PROVIDES the scope
  // to CriterionSection, so it sits outside CriterionScopeCtx itself and
  // useAskRef would read null here — which silently left all six criterion
  // header buttons copy-only while the nested panels worked.
  const { enabled: askEnabled, currentTab } = useAskAi();
  const common = {
    anchorId: anchor,
    askRef: askEnabled
      ? ({
          label: CRITERION_TITLES[criterion],
          candidate: c.name,
          origin: { tab: currentTab, anchor },
        } as AskRef)
      : null,
    scope: { candidateName: c.name, criterion, anchor } as CriterionScope,
  };

  switch (criterion) {
    case 'technical':
      return (
        <CriterionSection
          icon={Cpu}
          title={title}
          score={c.scoreBreakdown?.technical ?? c.technicalMatching?.score ?? null}
          copy={(o) => buildCriterionMarkdown(c, 'technical', o)}
          {...common}
        >
          {c.technicalMatching ? (
            <TechnicalMatching detail={c.technicalMatching} />
          ) : (
            <EmptyNote>Detail pencocokan technical belum tersedia (run lama, atau tanpa kompetensi required).</EmptyNote>
          )}
        </CriterionSection>
      );
    case 'career':
      return (
        <CriterionSection
          icon={Route}
          title={title}
          score={c.scoreBreakdown?.career ?? c.careerMatching?.score ?? null}
          copy={(o) => buildCriterionMarkdown(c, 'career', o)}
          {...common}
        >
          {c.careerMatching ? (
            <CareerMatching detail={c.careerMatching} />
          ) : (
            <EmptyNote>Detail career relevance belum tersedia (run lama sebelum fitur ini).</EmptyNote>
          )}
        </CriterionSection>
      );
    case 'behavior':
      return (
        <CriterionSection
          icon={Smile}
          title={title}
          score={c.behaviorDetail?.score ?? c.scoreBreakdown?.behavior ?? null}
          copy={(o) => buildCriterionMarkdown(c, 'behavior', o)}
          {...common}
        >
          {c.behaviorDetail ? (
            <div className="space-y-2">
              <KeyVal label="Rekomendasi asesmen" value={c.behaviorDetail.recommendation ?? '(tidak ada)'} />
              {c.behaviorDetail.notes && (
                <p className="rounded-md border bg-muted/10 p-2 text-[11px] leading-relaxed text-foreground/80">
                  {c.behaviorDetail.notes}
                </p>
              )}
            </div>
          ) : (
            <EmptyNote>Detail behavior belum tersedia.</EmptyNote>
          )}
        </CriterionSection>
      );
    case 'performance':
      return (
        <CriterionSection
          icon={BarChart2}
          title={title}
          score={c.performanceDetail?.score ?? c.scoreBreakdown?.performance ?? null}
          copy={(o) => buildCriterionMarkdown(c, 'performance', o)}
          {...common}
        >
          {c.performanceDetail ? (
            <PerformanceBlock detail={c.performanceDetail} />
          ) : (
            <EmptyNote>Detail performance belum tersedia.</EmptyNote>
          )}
        </CriterionSection>
      );
    case 'hav':
      return (
        <CriterionSection
          icon={Grid3x3}
          title={title}
          score={c.havDetail?.score ?? c.scoreBreakdown?.hav ?? null}
          copy={(o) => buildCriterionMarkdown(c, 'hav', o)}
          {...common}
        >
          {c.havDetail ? (
            <KeyVal label="Kuadran HAV" value={c.havDetail.quadrant ?? '(tidak ada)'} />
          ) : (
            <EmptyNote>Detail HAV belum tersedia.</EmptyNote>
          )}
        </CriterionSection>
      );
    case 'education':
      return (
        <CriterionSection
          icon={GraduationCap}
          title={title}
          score={c.educationDetail?.score ?? c.scoreBreakdown?.education ?? null}
          copy={(o) => buildCriterionMarkdown(c, 'education', o)}
          {...common}
        >
          {c.educationDetail ? (
            <EducationBlock detail={c.educationDetail} />
          ) : (
            <EmptyNote>Detail pendidikan belum tersedia.</EmptyNote>
          )}
        </CriterionSection>
      );
  }
}

// ── Per-candidate card ─────────────────────────────────────────────

// The sole consumer is the position run-scoring page's Readiness tab, which
// renders the per-candidate AHP+TOPSIS breakdown (see
// components/analysis/run-candidate-analysis).
export function CandidateCard({
  c,
  weights,
}: {
  c: CandidateProgressRow;
  /** This run's AHP weights — decides which aspect the sub-line summarises. */
  weights?: AspectWeights | null;
}) {
  const finalScore = c.weightedScore ?? 0;
  const topKey = topWeightedCriterion(weights);
  const topScore =
    topKey === 'technical'
      ? c.scoreBreakdown?.technical ?? c.technicalMatching?.score ?? 0
      : c.scoreBreakdown?.[topKey] ?? 0;
  const hasTopScore = c.scoreBreakdown != null || topKey === 'technical';
  const { enabled: askEnabled, currentTab } = useAskAi();
  const allAskRef: AskRef | null = askEnabled
    ? {
        label: 'Seluruh 6 kriteria',
        candidate: c.name,
        origin: { tab: currentTab, anchor: `cand-${c.candidateId}` },
      }
    : null;
  return (
    <AccordionItem
      id={`cand-${c.candidateId}`}
      value={c.candidateId}
      className="scroll-mt-4 rounded-lg border bg-card px-3"
    >
      <AccordionTrigger className="py-3 hover:no-underline">
        <div className="flex w-full items-center gap-3 pr-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
            {c.rank ?? '–'}
          </span>
          <div className="min-w-0 flex-1 text-left">
            <div className="truncate text-sm font-semibold">{c.name}</div>
            {/* The run's heaviest-weighted aspect — the one that moved this
                ranking most. The final score moved to the bar on the right. */}
            <div className="text-[11px] text-muted-foreground">
              {CRITERION_LABELS[topKey]} {hasTopScore ? topScore : '–'}{' '}
              <span className="text-muted-foreground/70">(bobot tertinggi)</span> ·{' '}
              {c.readiness ?? 'Belum dinilai'}
            </div>
          </div>
          <div className="hidden w-40 shrink-0 sm:block">
            <div className="mb-0.5 flex justify-between text-[10px] text-muted-foreground">
              <span>Skor akhir</span>
              <span className="tabular-nums">{c.weightedScore ?? '–'}/100</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(0, Math.min(100, finalScore))}%` }} />
            </div>
          </div>
        </div>
      </AccordionTrigger>
      <AccordionContent className="space-y-4 pb-4">
        {/* One paste covering all six criteria, for "explain this whole ranking
            position to me" rather than one criterion at a time. */}
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-primary/25 bg-primary/5 px-2.5 py-2">
          <CopyMarkdownButton
            build={(o) => buildAllCriteriaMarkdown(c, o)}
            askRef={allAskRef ?? undefined}
            label="Salin 6 kriteria"
          />
          <span className="text-[10px] leading-snug text-muted-foreground">
            Tempel di tab <span className="font-medium text-foreground/80">AI Assistant</span> untuk
            minta penjelasan bertahap. Tiap kriteria dan tiap angka juga punya tombol salinnya
            sendiri.
          </span>
        </div>

        {/* Aspect summary grid */}
        {c.scoreBreakdown && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {CRITERIA.map((cr) => {
              const v = c.scoreBreakdown![cr.key] ?? 0;
              return (
                <div key={cr.key} className="rounded-md border bg-muted/20 p-2">
                  <div className="mb-1 flex justify-between text-[10px] text-muted-foreground">
                    <span>{cr.label}</span>
                    <span className="tabular-nums">{v}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className={cn('h-full rounded-full', scoreBarTone(v))} style={{ width: `${Math.max(0, Math.min(100, v))}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Six criterion sections */}
        <div className="space-y-3">
          {CRITERION_ORDER.map((key) => (
            <CriterionDetail key={key} c={c} criterion={key} />
          ))}
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}
