'use client';

import { useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { InfoHint } from '@/components/ui/info-hint';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Save,
  Loader2,
  Network,
  FileText,
  SlidersHorizontal,
} from 'lucide-react';
import {
  getJobFamilyConfig,
  saveBertopicConfigAction,
  type EmbeddingModelOption,
  type JobProfileOption,
  type RestructureSample,
} from '@/lib/job-family-actions';
import {
  isBertopicDirty,
  rebaseConfigDraft,
  type JobFamilyConfig,
  type BertopicConfig,
} from '@/lib/job-family/config';
import { OptimizerPanel } from '@/components/job-family/optimizer-panel';
import { RestructureTemplateCard } from '@/components/job-family/restructure-template-card';

// Every BERTopic parameter, grouped by pipeline stage, with a one-line help
// string explaining WHAT it does + WHICH WAY it pushes results. Each key maps to
// a real knob in topic-service/app/pipeline.py — nothing here is decorative.
type FieldDef = {
  key: keyof BertopicConfig;
  label: string;
  help: string;
  type: 'num' | 'numNull' | 'select' | 'switch';
  step?: string;
  placeholder?: string;
  options?: { value: string; label: string }[];
};
type ParamGroup = { title: string; blurb: string; fields: FieldDef[] };

const BERTOPIC_GROUPS: ParamGroup[] = [
  {
    title: '1 · UMAP — Reduksi Dimensi',
    blurb: 'Mengurangi dimensi pada angka berdimensi tinggi sebelum clustering.',
    fields: [
      { key: 'nNeighbors', label: 'n_neighbors', type: 'num', help: 'Struktur lokal vs global. ↑ = klaster lebih global/besar; ↓ = lebih lokal/detail.' },
      { key: 'nComponents', label: 'n_components', type: 'num', help: 'Dimensi tempat HDBSCAN bekerja. Umum 5–10.' },
      { key: 'minDist', label: 'min_dist', type: 'num', step: '0.01', help: 'Kerapatan titik. 0 = paling rapat (terbaik untuk clustering).' },
      {
        key: 'metric', label: 'metric', type: 'select',
        help: 'Metrik jarak UMAP (dipakai juga untuk proyeksi 2D).',
        options: [
          { value: 'cosine', label: 'cosine' },
          { value: 'euclidean', label: 'euclidean' },
          { value: 'manhattan', label: 'manhattan' },
        ],
      },
    ],
  },
  {
    title: '2 · HDBSCAN — Clustering',
    blurb: 'Mengelompokkan vektor menjadi job family; sisanya jadi outlier (topik -1).',
    fields: [
      { key: 'minClusterSize', label: 'min_cluster_size', type: 'num', help: 'Ukuran job family terkecil. ↑ = family lebih sedikit & besar, outlier bertambah.' },
      { key: 'minSamples', label: 'min_samples', type: 'numNull', placeholder: '(auto)', help: 'Kekonservatifan/noise. Kosong = auto (= min_cluster_size). ↑ = outlier bertambah.' },
      {
        key: 'clusterSelectionMethod', label: 'cluster_selection_method', type: 'select',
        help: 'eom = klaster luas & lebih sedikit; leaf = lebih halus & banyak.',
        options: [
          { value: 'eom', label: 'eom (broad)' },
          { value: 'leaf', label: 'leaf (fine-grained)' },
        ],
      },
      { key: 'clusterSelectionEpsilon', label: 'cluster_selection_epsilon', type: 'num', step: '0.01', help: 'Gabungkan klaster berjarak < nilai ini. 0 = nonaktif. ↑ = family lebih sedikit.' },
    ],
  },
  {
    title: '3 · Tokenisasi — CountVectorizer',
    blurb: 'Menyusun kosakata per klaster sebelum penilaian c-TF-IDF.',
    fields: [
      { key: 'nGramMin', label: 'n-gram min', type: 'num', help: 'N-gram terkecil (1 = kata tunggal).' },
      { key: 'nGramMax', label: 'n-gram max', type: 'num', help: 'N-gram terbesar (2 = termasuk frasa dua kata).' },
      { key: 'minDf', label: 'min_df', type: 'num', help: 'Abaikan kata yang muncul di < sekian dokumen. ↑ = buang kata langka.' },
      { key: 'maxDf', label: 'max_df', type: 'num', step: '0.01', help: 'Abaikan kata di > proporsi dokumen ini (0–1). ↓ = buang kata terlalu umum.' },
      {
        key: 'stopwords', label: 'stopwords', type: 'select',
        help: 'Daftar stopword yang dibuang. Job profile berbahasa Indonesia.',
        options: [
          { value: 'indonesian', label: 'Indonesia (Sastrawi)' },
          { value: 'english', label: 'English' },
          { value: 'none', label: 'Tanpa stopword' },
        ],
      },
    ],
  },
  {
    title: '4 · c-TF-IDF — Kata Kunci Topik',
    blurb: 'Menilai kata paling khas tiap topik dibanding topik lain.',
    fields: [
      { key: 'topNWords', label: 'top_n_words', type: 'num', help: 'Jumlah kata kunci per topik.' },
      { key: 'reduceFrequentWords', label: 'reduce_frequent_words', type: 'switch', help: 'Kurangi bobot kata yang sering muncul di semua topik (label lebih bersih).' },
      { key: 'bm25Weighting', label: 'bm25_weighting', type: 'switch', help: 'Pembobotan BM25 — lebih tahan untuk korpus kecil/timpang.' },
    ],
  },
  {
    title: '5 · Model Topik & Representasi',
    blurb: 'Pasca-clustering: reduksi topik, outlier, probabilitas, diversitas kata kunci.',
    fields: [
      { key: 'nrTopics', label: 'nr_topics', type: 'numNull', placeholder: '(auto)', help: 'Kurangi hingga maksimal N topik setelah clustering. Kosong = tanpa reduksi.' },
      { key: 'diversity', label: 'diversity (MMR)', type: 'numNull', step: '0.05', placeholder: '(off)', help: 'TIDAK berpengaruh pada pipeline ini — MMR butuh model embedding kata di topic-service, sedangkan vektor datang sudah jadi. Dicatat pada catatan mutu run.' },
      {
        key: 'outlierStrategy', label: 'outlier_strategy', type: 'select',
        help: 'Cara mengukur "terdekat". embeddings = kemiripan isi (bawaan, paling sejalan dengan peta).',
        options: [
          { value: 'embeddings', label: 'embeddings (kemiripan isi)' },
          { value: 'c-tf-idf', label: 'c-tf-idf (tumpang-tindih kata)' },
          { value: 'distributions', label: 'distributions (per potongan)' },
          { value: 'probabilities', label: 'probabilities (butuh calculate_probabilities)' },
        ],
      },
      { key: 'outlierThreshold', label: 'outlier_threshold', type: 'num', step: '0.05', help: 'Kemiripan minimum agar outlier boleh dipindahkan. 0 = paksa semua masuk; 0,4–0,5 = sisakan yang benar-benar tidak berhubungan.' },
      { key: 'randomState', label: 'random_state', type: 'num', help: 'Seed tetap → hasil reproducible untuk data yang sama.' },
      { key: 'reduceOutliers', label: 'reduce_outliers', type: 'switch', help: 'Tempatkan ulang outlier (topik -1) ke topik terdekat.' },
      { key: 'outlierCascade', label: 'outlier_cascade', type: 'switch', help: 'Coba lagi sisa outlier dengan cara ukur berikutnya, pada ambang yang sama.' },
      { key: 'calculateProbabilities', label: 'calculate_probabilities', type: 'switch', help: 'Hitung probabilitas topik per dokumen (lebih lambat; menjadi % keanggotaan).' },
    ],
  },
];

function ParamField({
  label,
  help,
  children,
}: {
  label: string;
  help: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs font-medium">{label}</Label>
      {children}
      <p className="text-[10px] leading-snug text-muted-foreground">{help}</p>
    </div>
  );
}

/**
 * Pengaturan Job Family — the settings page under the Peta Job Family section
 * (/posisi/job-family/pengaturan). Two stacked sections, not tabs: the
 * page used to be a third tab row under the sidebar and the hub strip, and the
 * inner tabs were the ones users could not find. The map itself lives on the
 * parent route (FamilyTreeView), so this component owns only the configuration.
 */
export function ConfigurationClient({
  initialConfig,
  initialSample,
  profileOptions,
  pgvectorReady,
  availableModels,
  showGuidance = false,
  showOptimizer = false,
  canManage = false,
}: {
  initialConfig: JobFamilyConfig;
  initialSample: RestructureSample | null;
  profileOptions: JobProfileOption[];
  pgvectorReady: boolean;
  availableModels: EmbeddingModelOption[];
  showGuidance?: boolean;
  /**
   * Tampilkan panel optimasi. Terpisah dari `showGuidance` dengan sengaja:
   * `showGuidance` mengatur penjelasan BACA-SAJA, yang justru paling berguna bagi
   * pembaca tanpa hak sunting, sedangkan panel optimasi menuntut
   * job_profiles.manage untuk separuh tombolnya. Menyatukan keduanya berarti
   * menyembunyikan penjelasan dari orang yang paling membutuhkannya.
   */
  showOptimizer?: boolean;
  /** Boleh menerapkan parameter & menjalankan pipeline (job_profiles.manage). */
  canManage?: boolean;
}) {
  // `config` is the DRAFT every control edits; `saved` is what the server holds.
  // Each save button writes one part and hands back the whole saved config,
  // which `adoptSaved` carries the draft over to without touching any other
  // part's unsaved edits (rebaseConfigDraft).
  const [config, setConfig] = useState<JobFamilyConfig>(initialConfig);
  const [saved, setSaved] = useState<JobFamilyConfig>(initialConfig);
  const savedRef = useRef(initialConfig);
  const [saving, startSaving] = useTransition();

  function adoptSaved(next: JobFamilyConfig) {
    const before = savedRef.current;
    savedRef.current = next;
    setSaved(next);
    setConfig((draft) => rebaseConfigDraft(draft, before, next));
  }

  const bertopicDirty = isBertopicDirty(config, saved);

  function setBertopic<K extends keyof JobFamilyConfig['bertopic']>(
    key: K,
    value: JobFamilyConfig['bertopic'][K],
  ) {
    setConfig((c) => ({ ...c, bertopic: { ...c.bertopic, [key]: value } }));
  }

  function renderBertopicField(f: FieldDef) {
    const v = config.bertopic[f.key];
    if (f.type === 'switch') {
      return (
        <div key={f.key} className="flex items-start justify-between gap-3 rounded-lg border p-3">
          <div className="space-y-0.5">
            <Label className="text-xs font-medium">{f.label}</Label>
            <p className="text-[10px] leading-snug text-muted-foreground">{f.help}</p>
          </div>
          <Switch checked={Boolean(v)} onCheckedChange={(val) => setBertopic(f.key, val as never)} />
        </div>
      );
    }
    if (f.type === 'select') {
      return (
        <ParamField key={f.key} label={f.label} help={f.help}>
          <Select value={String(v ?? '')} onValueChange={(val) => setBertopic(f.key, val as never)}>
            <SelectTrigger className="h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {f.options!.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </ParamField>
      );
    }
    return (
      <ParamField key={f.key} label={f.label} help={f.help}>
        <Input
          type="number"
          step={f.step}
          placeholder={f.placeholder}
          value={v === null || v === undefined ? '' : (v as number)}
          onChange={(e) => {
            const raw = e.target.value;
            setBertopic(
              f.key,
              (f.type === 'numNull' ? (raw === '' ? null : Number(raw)) : Number(raw)) as never,
            );
          }}
          className="h-8 text-sm"
        />
      </ParamField>
    );
  }

  /**
   * Baca ulang config dari server setelah panel optimasi menyimpannya.
   *
   * Tanpa ini kartu parameter tetap memajang nilai lama. Hasilnya diadopsi
   * lewat `adoptSaved`, jadi template yang belum disimpan di seksi 1 tidak
   * ikut hilang, dan perubahan parameter yang belum disimpan tetap ditandai
   * sebagai perubahan, bukan ditimpa diam-diam.
   */
  function resyncConfigFromServer() {
    const paramsEdited = bertopicDirty;
    void getJobFamilyConfig()
      .then((fresh) => {
        adoptSaved(fresh);
        if (paramsEdited) {
          toast.info(
            'Parameter hasil optimasi sudah berlaku. Kartu parameter di bawah masih memuat perubahan Anda yang belum disimpan.',
          );
        }
      })
      .catch(() => {
        toast.warning(
          'Parameter berhasil diterapkan, tetapi tampilan di bawah belum tersegarkan. Muat ulang halaman sebelum menekan Simpan.',
        );
      });
  }

  function saveBertopic() {
    startSaving(async () => {
      try {
        adoptSaved(await saveBertopicConfigAction(config.bertopic));
        toast.success('Parameter BERTopic tersimpan.');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Gagal menyimpan.');
      }
    });
  }

  return (
    <div className="space-y-10">
      <SettingsSection
        id="restrukturisasi"
        n={1}
        icon={FileText}
        title="Restrukturisasi Dokumen"
        description={
          <>
            <p>
              Bagian dokumen job profile mana yang dibaca mesin sebelum diubah menjadi angka —
              satu template global, plus template khusus per dokumen bila perlu. Berpengaruh pada
              langkah 2 (transformasi).
            </p>
            {/* The read-only guidance that used to be a boxed intro above the
                card; still gated on showGuidance, now inside the hint. */}
            {showGuidance && (
              <>
                <p>
                  <strong>Isi halaman ini.</strong> Template yang mengatur{' '}
                  <strong>bagian mana</strong> dari dokumen job profile yang diambil (tujuan
                  jabatan, tanggung jawab, kompetensi, dan lainnya) serta bagaimana bagian-bagian
                  itu disusun ulang menjadi satu ringkasan.
                </p>
                <p>
                  <strong>Yang dikerjakan.</strong> Sebelum diubah menjadi angka, tiap job profile
                  dirapikan dulu mengikuti template ini. Hasilnya adalah &ldquo;bahan baku&rdquo;
                  yang benar-benar dibaca mesin — bagian dokumen yang tidak masuk template tidak
                  akan ikut diperhitungkan.
                </p>
                <p>
                  <strong>Pengaruh ke Job Family.</strong> Template ini menentukan{' '}
                  <strong>atas dasar apa</strong> jabatan dikelompokkan. Bila yang ditonjolkan
                  adalah tanggung jawab dan kompetensi teknis, job family akan terbentuk menurut
                  kemiripan pekerjaan. Bila nama divisi/departemen ikut dimasukkan, kelompoknya
                  cenderung mengikuti struktur organisasi, bukan isi pekerjaan. Perubahan template
                  baru berlaku setelah <strong>langkah 2 (Jalankan Transformasi)</strong>{' '}
                  dijalankan ulang di halaman peta, lalu <strong>langkah 3 (Bangun Ulang)</strong>.
                </p>
              </>
            )}
          </>
        }
      >
      <RestructureTemplateCard
        config={config}
        setConfig={setConfig}
        saved={saved}
        onSaved={adoptSaved}
        profileOptions={profileOptions}
        initialSample={initialSample}
        pgvectorReady={pgvectorReady}
        canManage={canManage}
      />
      </SettingsSection>

      <SettingsSection
        id="parameter"
        n={2}
        icon={SlidersHorizontal}
        title="Parameter Pipeline"
        description={
          <p>
            Cara angka tadi dikelompokkan menjadi job family. Ubah lewat panel optimasi (pilih
            tujuan; pengaturannya diukur pada korpus sekarang sebelum ditawarkan) atau langsung
            pada parameter BERTopic di bawahnya. Berpengaruh pada langkah 3 (bangun peta).
          </p>
        }
      >
      {/* Dulu di sini berdiri kotak penjelasan statis berjudul "Mengatur cara
          jabatan dikelompokkan menjadi job family". Ia digantikan panel
          optimasi, bukan sekadar dipercantik: penjelasan sebaik apa pun
          tetap meninggalkan pekerjaan tersulitnya kepada pembaca — menerjemahkan
          "hasilnya kurang pas" menjadi parameter mana yang digeser, ke arah
          mana, seberapa jauh. Isi penjelasan lamanya tidak hilang; ia pindah
          ke docs/optimasi-job-family.md. */}
      {showOptimizer && (
        <OptimizerPanel
          canManage={canManage}
          unsavedParams={bertopicDirty}
          onConfigApplied={resyncConfigFromServer}
        />
      )}
      <Card className="p-6">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Network className="h-4 w-4 text-primary" />
            <h3 className="flex items-center gap-1.5 text-sm font-semibold">
              Parameter Pipeline BERTopic
              <InfoHint title="Parameter Pipeline BERTopic">
                <p>
                  Parameter di bawah dipakai pipeline saat <strong>langkah 3 (Bangun Ulang)</strong>{' '}
                  berikutnya di halaman peta — menyimpan di sini tidak mengubah peta yang sekarang.
                </p>
                <p>Urutan internal pipeline: UMAP → HDBSCAN → Tokenisasi → c-TF-IDF.</p>
              </InfoHint>
            </h3>
          </div>
          <div className="flex items-center gap-2">
            {bertopicDirty && (
              <span className="text-[11px] text-amber-600 dark:text-amber-400">Belum disimpan</span>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={saveBertopic}
              disabled={saving || !bertopicDirty || !canManage}
            >
              {saving ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="mr-1.5 h-3.5 w-3.5" />
              )}
              Simpan
            </Button>
          </div>
        </div>
        <div className="space-y-5">
          {BERTOPIC_GROUPS.map((g, gi) => {
            const inputs = g.fields.filter((f) => f.type !== 'switch');
            const toggles = g.fields.filter((f) => f.type === 'switch');
            return (
              <div key={g.title} className="space-y-3">
                <h4 className="flex items-center gap-1.5 text-xs font-semibold text-foreground/90">
                  {g.title}
                  <InfoHint title={g.title} size="xs">
                    <p>{g.blurb}</p>
                  </InfoHint>
                </h4>
                {inputs.length > 0 && (
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {inputs.map((f) => renderBertopicField(f))}
                  </div>
                )}
                {toggles.length > 0 && (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {toggles.map((f) => renderBertopicField(f))}
                  </div>
                )}
                {gi < BERTOPIC_GROUPS.length - 1 && <Separator />}
              </div>
            );
          })}
        </div>
      </Card>
      </SettingsSection>
    </div>
  );
}

function SettingsSection({
  id,
  n,
  icon: Icon,
  title,
  description,
  children,
}: {
  id: string;
  /** Position in the pipeline these settings feed — see the page intro. */
  n: number;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  /** What this section is for — shown behind the "?" beside the title. */
  description: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="space-y-4">
      <div className="flex items-center gap-3 border-b pb-3">
        <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="h-4.5 w-4.5" />
          <span className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[9px] font-bold text-primary-foreground">
            {n}
          </span>
        </div>
        {/* The hint is a sibling of the heading, not inside it, so the
            section's aria-labelledby name stays the title alone. */}
        <div className="flex min-w-0 items-center gap-1.5">
          <h2 id={`${id}-title`} className="text-base font-semibold leading-tight">
            {title}
          </h2>
          <InfoHint title={title}>{description}</InfoHint>
        </div>
      </div>
      {children}
    </section>
  );
}
