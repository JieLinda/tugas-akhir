# Agent Studio — rencana modul

> **⚠️ Modul ini dihapus dari `main`** dan tersimpan di branch
> `parked/agent-studio` — lihat
> [`docs/agent-studio-parked.md`](agent-studio-parked.md). Isi dokumen ini tetap
> sahih sebagai rancangan, tetapi catatan "belum ada satu pun modul di bawah yang
> terimplementasi" **sudah kedaluwarsa**: modulnya ADA, lengkap dan type-clean,
> hanya tidak berada di `main`.
>
> **Catatan 17 November 2026:** metode AI Tournament (LLM) sudah dihapus dari
> `main`; AHP + TOPSIS adalah satu-satunya metode scoring. Ikut dihapus:
> `scoring_run_feedback` (umpan balik vote beserta penyuntikannya ke system
> prompt), `prompt_versions`, `program_contexts`, `program_templates.system_prompt`,
> dan `tournament_sessions.stages` (`drizzle/0097_remove_llm_tournament.sql`).
> Bagian dokumen ini yang menyebut turnamen, umpan balik vote, atau versi prompt
> program sebagai mekanisme yang "sudah ada" menggambarkan kondisi saat rencana
> ditulis.

Workspace di mana satu perintah bahasa alami dari user ("scoring run untuk posisi A
dengan menonjolkan aspek penilaian kinerja") diterjemahkan menjadi rencana kerja,
dijalankan lintas fitur Pulse (web + sync-service + scoring-service + topic-service),
di-tuning berulang bila perlu, lalu dikembalikan sebagai jawaban + tombol ke halaman
hasil.

Dokumen ini adalah **rencana**, bukan deskripsi kode yang sudah ada. Belum ada satu pun
modul di bawah yang terimplementasi.

---

## 1. Lima kendala yang menentukan desain

Ini ditemukan dari kode yang ada dan bukan hal yang bisa ditawar — setiap modul di
bawah dibentuk oleh salah satunya.

### 1.1 Aksi aplikasi adalah Server Action, bukan HTTP API

~130 fungsi `*Action` tersebar di 30 file `lib/*-actions.ts`. Semuanya `'use server'` dan
mengambil konteks dari **cookie**: `getCurrentTenantId()` membaca cookie `pulse_tenant`,
`requirePermission()` membaca sesi NextAuth. Konsekuensinya:

> **Sebuah worker headless tidak bisa memanggil aksi-aksi ini.** Tidak ada cookie, tidak ada
> tenant, tidak ada permission → semua lempar error.

Dua jalan keluar:

| Opsi | Cara | Konsekuensi |
|---|---|---|
| **A. Tick-loop dari klien** (rekomendasi v1) | Studio UI memanggil `agentTickAction(runId)` berulang; tiap tick mengeksekusi satu langkah di dalam request user, jadi cookie + RBAC utuh | Persis pola yang sudah dipakai `configuration-client.tsx` (loop `processRebuildBatchAction`). Nol refactor RBAC. Kelemahan: tab ditutup → run berhenti (tapi state durable, bisa dilanjutkan) |
| **B. Runner headless** (`agent-service`) | Refactor tiap aksi agar menerima `ctx: {tenantId, userId, permissions}` eksplisit | Benar untuk jangka panjang (jadwal, run semalaman), tapi menyentuh 130 fungsi dan menghapus jaring pengaman "RBAC otomatis ikut" |

Ambil **A** dulu. Naikkan ke **B** hanya saat butuh run terjadwal/unattended, dan lakukan
per-domain (mulai dari scoring saja).

Catatan penting: pekerjaan **panjang** sudah aman di kedua opsi — tournament berjalan di
`scoring-service`, BERTopic di `topic-service`; keduanya punya klien DB sendiri dan jalan
tanpa cookie. Agent hanya perlu memicu lalu **polling**, bukan menunggu.

### 1.2 Operasi panjang sudah async-with-polling — executor wajib state machine

Tiga pola berbeda yang harus diadaptasi executor:

| Pekerjaan | Pemicu | Cara tahu selesai |
|---|---|---|
| Tournament scoring | `startTournamentSessionAction` → POST scoring-service | poll `GET /api/tournament/[sessionId]/status`, lalu `finalizeTournamentAction` |
| Job family (BERTopic) | `startTopicRunAction` → POST topic-service | poll `getTopicRunStatusAction(runId)` |
| Rebuild embedding | `startRebuildAction` → N batch | panggil `processRebuildBatchAction(sessionId, i)` untuk i=0..N-1 |
| Embed kamus | `startKamusEmbedAction` | `processKamusEmbedBatchAction`, pola sama |

Artinya langkah rencana **bukan** `await tool()`. Setiap langkah punya siklus
`pending → running → (external ref) → polling → done|failed`, disimpan di Postgres, dan
harus bisa dilanjutkan dari tengah.

### 1.3 Konfigurasi bersifat global — loop optimasi bisa merusak data user lain

`updateJobFamilyConfigAction` menulis `lib/job-family-config.json`; `updateScoringPromptAction`
menulis `lib/scoring-prompts.json`; `updateReadinessConfigAction` menulis
`lib/readiness-config.json`; bobot AHP ada di `program_templates.ahp_config`. Semua **global
per-tenant dan langsung berlaku**.

Agent yang menyapu 12 kombinasi parameter BERTopic dengan menulis config global 12 kali
akan mengubah perilaku aplikasi untuk semua orang, 12 kali. Karena itu M9 (Config Sandbox)
bukan fitur mewah — ia prasyarat sebelum M10 (Optimizer) boleh ada.

Kabar baik: pondasinya sudah ada. `job_family_topic_configs` menyimpan versi config dan
`job_family_topic_runs.config_id` menunjuk versi yang dipakai sebuah run — jadi sweep bisa
membuat versi tanpa mengaktifkannya, **asal** `startTopicRunAction` diberi parameter
config override (saat ini ia selalu membaca config aktif).

### 1.4 Loop umpan balik sudah ada — pakai, jangan bikin baru

`scoring_run_feedback` menyimpan vote up/down + `reason` + `scope` (`position` | `program` |
`global`), dan alasan downvote **sudah** disuntikkan ke system prompt run berikutnya.
"Smart blocks berdasarkan komentar user" adalah perluasan mekanisme ini (dari teks bebas →
constraint terstruktur), bukan sistem kedua yang bersaing.

### 1.5 Multi-tenant tanpa RLS

Setiap query difilter `tenantId` secara manual. Setiap tool call agent wajib membawa tenant
aktif, dan lintas-tenant hanya boleh lewat pintu yang memang disediakan aplikasi
(`StartTournamentInput.includedTenantIds`). Validator harus menolak rencana yang
mencampur tenant di luar itu.

---

## 2. Peta modul

Status: ✅ terbangun · 🟡 sebagian · ⬜ belum.

| # | Modul | Lapisan | Status | Inti |
|---|---|---|---|---|
| M1 | Capability Registry | Fondasi | ✅ | 48 manifest lintas domain, 36 `live`; audit kelengkapan menjaga 147 aksi tetap terpetakan |
| M2 | World-State Provider | Fondasi | 🟡 | Agent tahu kondisi sekarang — bagian job family belum diisi |
| M3 | Entity Resolver | Fondasi | ✅ | "posisi A" → UUID; nama orang dicocokkan per-token berbobot kelangkaan, dan yang tak terselesaikan menyodorkan nama terdekat alih-alih memvonis |
| M4 | Surface & Deep-Link Map | Fondasi | ✅ | Kapabilitas → URL halaman hasil (bahan tombol) |
| M5 | Workflow DSL | Perencanaan | ✅ | Format rencana: langkah, rujukan antar-langkah, gate |
| M6 | Planner + Clarifier | Perencanaan | ✅ | NL → rencana; bertanya saat parameter kurang, dengan **pilihan konkret** bila entitasnya sudah terlihat; sadar kelanjutan percakapan dan **urutan run** (aturan v6) |
| M7 | Validator & Guardrails | Perencanaan | ✅ | Cek skema/izin/prasyarat, approval gate, budget, kill switch, audit |
| M8 | Durable Executor | Eksekusi | ✅ | State machine + tiga pola adapter (tengok-layanan, batch-loop, instan) + konfirmasi per langkah |
| M9 | Config Sandbox & Proposals | Eksekusi | ✅ | Usulan ber-diff dengan penjaga basi + rollback; run percobaan BERTopic tanpa menyentuh config aktif |
| M10 | Optimizer (Smart Blocks) | Optimasi | ✅ | Tiga domain: BERTopic (objective + arah deterministik + loop percobaan sandbox), bobot AHP (objective pemisahan/gap/keseimbangan atas run selesai), dan scoring (umpan balik `scoring_run_feedback` + preferensi tersimpan, aturan v4) |
| M11 | Result Interpreter | Output | ✅ | Answer card: narasi + bukti + tombol CTA |
| M12 | Knowledge / Helpdesk | Output | ✅ | `help.explain_feature` + `analysis.explain_scoring`, berakar empat dokumen: metodologi angka (131 KB), panduan fitur per-halaman (135 KB), katalog 153 tombol (124 KB), dan rumus+percabangan enam kriteria AHP+TOPSIS |
| M13 | Studio UI | Output | ✅ | Command bar, review rencana, timeline live, riwayat |
| M14 | Recipes, Memory & Eval | Lanjutan | ✅ | Resep (replay tervalidasi-ulang), memori preferensi (terlihat & dapat dihapus), harness eval 6 suite |

---

## 3. Detail modul

### M1 — Capability Registry (`lib/agent/registry/`)

Kosakata agent. Satu manifest per aksi, dikelompokkan per domain.

```
lib/agent/registry/
  types.ts          # ToolManifest, EffectClass, Precondition
  index.ts          # registry() — gabungan + lookup + validasi duplikat
  scoring.ts        # startTournament, finalize, rerunExcluding, setExclusion, delete…
  job-family.ts     # rebuildEmbedding, startTopicRun, promoteToCategories, updateConfig…
  job-profiles.ts   # suggestProfileForPosition, setFolderMap, deleteProfile…
  governance.ts     # program template, kriteria, filter, AHP, readiness, prompt…
  positions.ts      # criticalPositions CRUD, kompetensi, picks
  candidates.ts     # kandidat CRUD, kompetensi teknis
  analysis.ts       # baca hasil run, aspek, rank shift, dossier
  sync.ts           # trigger sync per sumber, status
  admin.ts          # users, roles, tenant mapping
```

Bentuk manifest — setiap field ada alasannya:

```ts
type ToolManifest<I, O> = {
  id: 'scoring.start_tournament';           // stabil; dipakai di plan tersimpan
  title: string;                            // "Jalankan scoring run"
  domain: 'scoring' | 'job_family' | ...;

  // ── untuk LLM ──
  purpose: string;                          // apa yang dikerjakan
  whenToUse: string;                        // kapan dipilih
  effects: string;                          // apa yang BERUBAH setelah ini
  notFor: string;                           // pembatas — mencegah salah pilih
  examples: { query: string; params: I }[]; // few-shot

  // ── untuk validator & executor ──
  input: z.ZodType<I>;                      // zod 3.25 sudah ada di package.json
  output: z.ZodType<O>;
  permission: Permission;                   // dari lib/rbac.ts
  effectClass: 'read' | 'write' | 'run' | 'config' | 'destructive';
  duration: 'instant' | 'seconds' | 'long_polling';
  idempotent: boolean;
  preconditions: PreconditionId[];          // 'embeddings_ready', 'has_job_profile'…
  produces?: ArtifactKind;                  // 'scoring_run' | 'topic_run' | …
  link?: (out: O) => DeepLink;              // → M4
  handler: (input: I) => Promise<O>;        // memanggil server action apa adanya
};
```

Tiga hal yang membuat modul ini tidak sekadar daftar:

1. **`effects` + `notFor` adalah yang menentukan kualitas planner.** Deskripsi "menjalankan
   scoring" tidak cukup; yang membedakan `rerunScoringExcludingCandidatesAction` dari
   `rerunScoringFullPoolAction` adalah kalimat "membuat run BARU, run dasar tidak pernah
   diubah". Anggarkan waktu menulis deskripsi ini, bukan menulis kodenya.
2. **Audit kelengkapan.** `scripts/agent-registry-audit.ts` membaca semua `export async function *Action`
   dari `lib/*-actions.ts` dan gagal bila ada yang tidak terdaftar **dan** tidak
   ada di daftar `UNREGISTERED` beralasan. Ini yang menjaga janji "SELURUH fitur terdaftar"
   tetap benar enam bulan lagi. Jalankan di CI/lint.
3. **Overlay DB `agent_tool_settings`** (toolId, enabled, requiresApproval, catatan admin) —
   halaman Governance → Agent Registry untuk mematikan tool per tenant tanpa deploy.

Handler memanggil server action **apa adanya**. Jangan duplikasi logika: `requirePermission`
di dalam aksi tetap jadi penjaga terakhir, bahkan bila validator agent lolos.

### M2 — World-State Provider (`lib/agent/state/`)

Planner yang tidak tahu kondisi sekarang akan menyusun rencana mustahil ("cluster job
family" padahal belum ada embedding). Dua bagian:

- **`snapshot.ts`** — ringkas, murah, selalu ikut ke prompt planner: jumlah profil
  ter-embed vs total, run topic terakhir (status, #topik, %outlier, config), jumlah posisi
  kritikal & kandidat, daftar program template + metode + target finalis, sync terakhir per
  sumber, model embedding aktif.
- **`preconditions.ts`** — predikat bernama yang bisa dicek per-langkah:
  `embeddings_ready`, `topic_run_available`, `position_has_job_profile`,
  `program_has_ahp_config`, `pool_not_empty`. Registry menunjuk ke sini; validator
  mengevaluasinya sebelum eksekusi; interpreter memakainya untuk menjelaskan kegagalan
  ("gagal karena baru 12 dari 340 profil ter-embed").

Snapshot harus **kecil** (target < 2k token). Detail diambil on-demand lewat tool `read`.

### M3 — Entity Resolver (`lib/agent/resolve.ts`)

`"posisi A"` → `criticalPositions.id`. Tanpa ini planner akan mengarang UUID.

Berjenjang: exact → normalisasi (lowercase, buang gelar/kode) → trigram/`ILIKE` →
similarity embedding (sudah tersedia lewat `job_profile_embed`) sebagai jaring terakhir.
Selalu kembalikan **kandidat berperingkat + skor**, jangan satu tebakan: bila teratas
ambigu (selisih tipis) planner wajib bertanya, bukan menebak. Cakupan: posisi,
kandidat/karyawan, program template, kompetensi (kamus), unit bisnis, job family.

### M4 — Surface & Deep-Link Map (`lib/agent/links.ts`)

Rute nyata yang sudah ada, jadi bahan tombol:

| Kapabilitas | Rute |
|---|---|
| Hasil scoring sebuah posisi | `/positions/[id]` (tab analisis, `?runId=<runId>`) |
| Kartu satu job family | `/family-tree?runId=<topicRunId>&topicId=<n>` |
| Wizard scoring baru | `/scoring/new` |
| Analisis lintas posisi | `/analysis` |
| Peta job family | `/family-tree` |
| Parameter BERTopic/embedding | `/family-configuration` |
| Program, kriteria, AHP, readiness, prompt | `/governance` |
| Dokumen job profile | `/job-profiles` |
| Kamus kompetensi | `/kamus-kompetensi` |
| Sinkronisasi | `/settings/sync` |
| Detail kandidat | `/candidates/[id]` |

Tipe `DeepLink = { href, label, kind: 'result' | 'feature' | 'howto', description }`.
Dipakai dua arah: hasil eksekusi → tombol "Lihat hasil", dan mode helpdesk → tombol "Buka
halaman fitur".

### M5 — Workflow DSL (`lib/agent/plan/schema.ts`)

Rencana adalah JSON tervalidasi zod — bukan kode, bukan prosa.

```ts
type Plan = {
  goal: string;                     // parafrase niat user, untuk konfirmasi
  assumptions: string[];            // asumsi yang diambil planner (wajib ditampilkan)
  steps: Step[];
  presentation: { summarize: string; links: LinkSpec[] };
};

type Step = {
  id: 's1';
  tool: 'scoring.start_tournament';
  params: Record<string, Value>;    // Value = literal | { $ref: 's1.runId' } | { $entity: … }
  dependsOn: string[];
  gate?: 'auto' | 'confirm';        // confirm = tunggu klik user
  onFail?: 'abort' | 'continue' | 'compensate';
};
```

Konstruksi khusus yang harus ada sejak awal (menambahkannya belakangan berarti membongkar
executor):

- **`await_job`** — langkah yang menunggu referensi eksternal (sessionId/runId) sampai
  selesai; inilah pembungkus semua polling di §1.2.
- **`optimize`** — blok loop untuk M10: `{ vary: ParamSpace, run: Step[], objective, maxIterations, budget }`.
- **`ask`** — langkah yang sengaja berhenti dan bertanya ke user.

### M6 — Planner + Clarifier (`lib/agent/plan/planner.ts`)

NL + snapshot (M2) + registry (M1) → `Plan`.

- **Output terstruktur wajib.** Model default aplikasi adalah vLLM `aira` lewat
  `LLM_BASE_URL` (lihat [`app/api/chat/route.ts`](../app/api/chat/route.ts)). Kemampuan
  tool-calling-nya belum tentu memadai untuk perencanaan multi-langkah — sediakan env
  terpisah `AGENT_LLM_BASE_URL` / `AGENT_LLM_MODEL` agar planner bisa diarahkan ke model
  yang lebih kuat tanpa mengubah chatbot analisis. **Ini risiko teknis terbesar proyek ini**;
  uji lebih dulu dengan 20 query nyata sebelum membangun modul lain di atasnya.
- **Retrieval tool, bukan dump.** Dengan >130 tool, jangan kirim seluruh registry.
  Ambil top-K manifest relevan (embedding atas `purpose`+`whenToUse` — infrastrukturnya
  sudah ada) lalu kirim manifest lengkapnya saja.
- **Repair loop.** Rencana gagal validasi → kirim balik error validator (maks 2 kali)
  sebelum menyerah ke user.
- **Clarifier.** Parameter tidak tentu → keluarkan langkah `ask`, jangan menebak. Contoh
  pada query pembuka: "menonjolkan aspek penilaian kinerja" — apakah menaikkan bobot AHP
  PA (dan berapa), atau memilih program template yang memang berat di PA? Tanya.

Yang perlu dieksplisitkan ke planner: query pembuka itu sebenarnya **bukan** satu langkah.
Menonjolkan PA berarti menyentuh `ahp_config`, yang milik bersama sebuah program template →
rencana yang benar adalah *usulkan bobot alternatif* (M9) → jalankan run dengan bobot itu →
bandingkan dengan run terakhir → sajikan selisih peringkat. Bukan "ubah bobot lalu run".

### M7 — Validator & Guardrails (`lib/agent/guard/`)

**Waktu rencana:** skema input tiap langkah, `dependsOn` asiklik, `$ref` menunjuk field
yang memang ada di output tool sebelumnya, permission user (`hasPermission`) untuk **semua**
langkah — tolak seluruh rencana di depan, bukan gagal di tengah — prasyarat (M2),
konsistensi tenant (§1.5).

**Waktu jalan:** budget (maks langkah, maks panggilan LLM, maks durasi, maks iterasi
`optimize`) dengan penghentian keras; kill switch per run; `logAudit` untuk setiap langkah
`write`/`run`/`config`/`destructive` dengan penanda "dijalankan Agent Studio atas nama
<user>" — jejak agent harus bisa dibedakan dari aksi manusia di
[`governance-audit-log.tsx`](../components/governance/governance-audit-log.tsx).

**Kebijakan gate** — default yang saya sarankan:

| effectClass | Default |
|---|---|
| `read` | otomatis |
| `run` (scoring, topic, embed) | otomatis, tapi kena budget |
| `write` (data master) | konfirmasi |
| `config` (bobot AHP, prompt, readiness, param BERTopic) | konfirmasi + hanya lewat proposal M9 |
| `destructive` (delete run/posisi/kandidat) | konfirmasi, dan pertimbangkan blokir total untuk v1 |

### M8 — Durable Executor (`lib/agent/exec/`)

State machine tahan-lanjut. Tabel:

```
agent_sessions      (id, tenant_id, user_id, title, status, created_at)
agent_runs          (id, session_id, tenant_id, user_id, goal, plan jsonb,
                     status, budget jsonb, error, created_at, finished_at)
agent_run_steps     (id, run_id, step_id, tool_id, params jsonb, status,
                     attempt, external_ref jsonb, output jsonb, error,
                     started_at, finished_at)
agent_artifacts     (id, run_id, kind, ref_id, payload jsonb)   -- run scoring, topic run, laporan
agent_messages      (id, session_id, role, content, plan_id)     -- percakapan Studio
```

Loop tick (`agentTickAction(runId)`): ambil satu langkah `ready` → resolve `$ref` dari
output langkah sebelumnya → cek gate → jalankan handler → simpan output → majukan status.
Untuk `await_job`: tick memanggil adapter poll, bukan menunggu.

**Adapter** (`exec/adapters/`) menormalkan tiga pola §1.2 ke satu antarmuka
`{ start, poll, finalize?, cancel }`: `tournament.ts`, `topic-run.ts`, `batch-loop.ts`
(dipakai rebuild embedding & kamus embed).

Wajib: idempotensi (tick ganda dari dua tab tidak boleh menjalankan langkah dua kali —
kunci optimistik pada `agent_run_steps.status`), retry berbatas dengan backoff untuk
kegagalan jaringan saja, dan `cancel` yang juga membatalkan job hilir
(`cancelRebuildAction`, `cancelKamusEmbedAction`, hapus sesi tournament).

### M9 — Config Sandbox & Proposals (`lib/agent/config/`)

Konsekuensi langsung §1.3. Agent **tidak pernah** menulis config global.

```
agent_config_proposals (id, run_id, tenant_id, domain, base_version,
                        patch jsonb, rationale, status, applied_at, applied_by)
```

- `domain`: `job_family_bertopic` | `job_family_embedding` | `ahp_weights` |
  `readiness` | `scoring_prompt` | `program_filter` | `program_criteria`.
- **Run dengan override efemeral.** Untuk BERTopic ini murah: buat baris
  `job_family_topic_configs` (tanpa mengaktifkannya) lalu jalankan run yang menunjuk
  `config_id` itu. **Perubahan kode yang dibutuhkan:** `startTopicRunAction` harus menerima
  config eksplisit alih-alih selalu membaca config aktif.
- Untuk bobot AHP: `program_templates.ahp_config` global per template → v1 sebaiknya
  jalankan run pembanding memakai **template turunan** (salinan), bukan menyentuh template
  asli.
- **Promote/rollback**: diff yang terbaca manusia + satu tombol terapkan; simpan versi
  sebelumnya. Pola versi prompt yang sudah ada (`prompt_versions`,
  `listScoringPromptVersions`/`restoreScoringPromptVersionAction`) adalah preseden yang
  harus diikuti.

### M10 — Optimizer / Smart Blocks (`lib/agent/optimize/`)

Blok `optimize` dari M5. Empat bagian:

1. **Objective per domain** — angka, bukan perasaan.
   - *Job family*: %outlier (`topic -1`), jumlah topik vs target user, sebaran ukuran
     cluster, stabilitas antar seed, dan bila diminta: apakah dua posisi yang user bilang
     "harusnya sekeluarga" berakhir di topik yang sama.
   - *Scoring*: daya beda antar peringkat atas, sebaran readiness, jumlah kriteria yang
     harus di-drop karena tak terskor, kesesuaian dengan penekanan yang diminta user.
2. **Ruang parameter** — dideklarasikan, terbatas, dan aman. Untuk BERTopic ambil dari
   [`lib/job-family/config.ts`](../lib/job-family/config.ts) beserta rentang wajarnya
   (`minClusterSize`, `nNeighbors`, `clusterSelectionMethod`, `clusterSelectionEpsilon`,
   `nrTopics`, `reduceOutliers`). Batasi 2–3 parameter per sweep.
3. **Strategi** — mulai dari coordinate descent atas grid kasar. Tiap run BERTopic
   berbiaya nyata (ratusan dokumen, UMAP+HDBSCAN), jadi batasi 6–12 iterasi. Cache: config
   yang sama + korpus yang sama = hasil yang sama (`randomState` tetap), jangan jalankan ulang.
4. **Preference model** — mengubah komentar user jadi constraint. Sumbernya
   `scoring_run_feedback.reason` (§1.4) + komentar langsung di Studio. Simpan sebagai
   preferensi terstruktur bertingkat (global → program → posisi), tampilkan ke user, dan
   **bisa dihapus**. Preferensi yang tak terlihat dan tak bisa dicabut akan jadi sumber
   keluhan "kenapa hasilnya aneh".

Aturan pelaporan: optimizer wajib melaporkan **apa yang memburuk**, bukan hanya yang
membaik. Ringkasan "outlier turun 31%→12%" yang menyembunyikan "jumlah famili 24→7" adalah
laporan yang menyesatkan.

### M11 — Result Interpreter & Presenter (`lib/agent/present/`)

Output eksekusi → satu kartu jawaban terstruktur:

```ts
type AnswerCard = {
  headline: string;
  narrative: string;              // markdown; react-markdown sudah dipakai di repo
  evidence: { label: string; value: string; delta?: string }[];
  links: DeepLink[];              // ← tombol yang diminta user
  proposals?: ConfigProposalRef[];// ← "Terapkan bobot ini"
  followUps: string[];            // pertanyaan lanjutan yang disarankan
  degradations?: string[];        // ← lihat di bawah
};
```

`degradations` bukan hiasan. Engine AHP+TOPSIS sudah mencatat setiap penurunan mutu di
`tournament_sessions.final_ranked.runInfo` (posisi tanpa job profile jatuh ke kompetensi
incumbent, kriteria yang di-drop dengan bobot didistribusi ulang). Agent yang melaporkan
"selesai, ini hasilnya" tanpa meneruskan catatan itu **lebih buruk** daripada UI yang ada
sekarang, yang menampilkannya di halaman Progress Running.

### M12 — Knowledge / Helpdesk (`lib/agent/knowledge/`)

Mode kedua di command bar yang sama: "bagaimana cara mengubah bobot AHP?" → jawaban +
tombol ke `/governance`. Korpus: `CLAUDE.md`, `docs/*.md`, README tiap service, dan field
`purpose`/`whenToUse`/`effects` dari M1 — registry sekaligus jadi dokumentasi fitur.
Klasifikasi niat (lakukan / jelaskan / gabungan) ada di planner; ini penyedia isinya.

### M13 — Studio UI (`app/(dashboard)/studio/`, `components/studio/`)

- Command bar satu baris + riwayat sesi.
- **Panel review rencana** — langkah, dampak, perkiraan durasi, mana yang butuh konfirmasi;
  tombol Jalankan / Ubah / Batal. Jangan pernah jalankan rencana ber-efek tanpa langkah ini
  di v1.
- **Timeline live** — status per langkah, progres job panjang (sudah tersedia dari sumber
  polling masing-masing), tombol batal.
- **Kartu jawaban** (M11) dengan tombol CTA.
- Panel diff usulan config (M9) dengan tombol Terapkan.
- "Simpan sebagai resep" (M14).

Gunakan `react-resizable-panels`, `sonner`, `cmdk` — semuanya sudah ada di dependency.

### M14 — Recipes, Memory & Eval

- **Recipes**: `agent_recipes (name, description, param_schema, plan_template)` — rencana
  yang berhasil disimpan berparameter ("Scoring bulanan untuk semua posisi
  divisi X"). Ini yang nantinya jadi pintu ke jadwal terotomasi (butuh §1.1 opsi B).
- **Memory**: preferensi user/tenant (M10 bagian 4), terlihat dan bisa dihapus.
- **Eval**: `scripts/agent-eval.ts` + berkas emas berisi ~30 query NL → rencana yang
  diharapkan (kecocokan urutan tool, bukan kecocokan teks). Repo ini tidak punya test
  runner, jadi buat skrip `tsx` mandiri. Tanpa ini, mengganti model planner adalah judi.

---

## 4. Perubahan pada kode yang sudah ada

Sudah dikerjakan pada Fase 1:

| Berkas | Perubahan |
|---|---|
| `lib/db/schema.ts` + `drizzle/0047_agent_studio.sql` | 3 tabel `agent_sessions` / `agent_runs` / `agent_run_steps` |
| `components/sidebar-nav.tsx` | entri menu Agent Studio |
| `lib/agent/registry/fase0-tools.ts` | izin `governance.read_program_template` → `scoring.run` |

Sudah dikerjakan pada Fase 3a:

| Berkas | Perubahan |
|---|---|
| `lib/job-family-topics-actions.ts` | `startTopicRunAction` menerima `{ configOverride }` — run percobaan tanpa mengubah config global |
| `lib/job-family-actions.ts` | `ensureSandboxConfigVersionId` — versi config non-aktif untuk run percobaan |
| `lib/db/schema.ts` + `drizzle/0049` | tabel `agent_config_proposals` |

Masih menunggu fase berikutnya:

| Berkas | Perubahan | Alasan |
|---|---|---|
| `drizzle/` | tabel `agent_recipes` | M14 |
| `lib/rbac.ts` | (opsional) izin `agent.run` | agent boleh dibatasi ke peran tertentu |
| `components/governance/` | halaman Agent Registry (aktif/nonaktif per tool) | M1 overlay |
| `.env.example` | `AGENT_LLM_BASE_URL`, `AGENT_LLM_MODEL`, `AGENT_MAX_STEPS`, `AGENT_MAX_TICKS` | M6, M7 |

Tidak perlu diubah, dan memang tidak diubah: ~130 server action itu sendiri,
scoring-service, topic-service, sync-service. Handler tool memanggil aksi yang sudah ada
apa adanya, sehingga `requirePermission()` di dalamnya tetap menjadi penjaga terakhir.

Jalankan sekali sebelum memakai Studio:

```bash
pnpm exec tsx scripts/apply-sql.ts drizzle/0047_agent_studio.sql
pnpm exec tsx scripts/apply-sql.ts drizzle/0048_agent_step_approval.sql
pnpm exec tsx scripts/apply-sql.ts drizzle/0049_agent_config_proposals.sql
# Periksa konteks perencanaan terhadap data nyata (tanpa mengeksekusi apa pun):
pnpm exec tsx scripts/agent-eval/context-check.ts
# Kelengkapan registry + asersi optimizer (jalankan juga di CI):
pnpm exec tsx scripts/agent-registry-audit.ts
pnpm exec tsx scripts/agent-eval/optimize-check.ts
# Evaluasi perencanaan — garis dasar dan konfigurasi Studio saat ini:
pnpm exec tsx scripts/agent-eval/run.ts --suite=fase0 --registry=fase0 --rules=v2
pnpm exec tsx scripts/agent-eval/run.ts --suite=fase2 --registry=live --rules=v3
```

---

## 5. Urutan pengerjaan

**Fase 0 — bukti kelayakan. ✅ SELESAI — hasil: [`agent-studio-fase0.md`](agent-studio-fase0.md).**
20 query nyata, 10 tool tulis-tangan. Hasil: **100% rencana sah, 93% benar** dengan
`vllm/aira` lewat gateway yang sudah ada (function calling, ~1,8 detik). Ambang ≥70%
terlampaui — Fase 1 boleh dibangun. Tiga temuan yang mengubah rencana di bawah:

- Model in-house sudah cukup; **tidak perlu endpoint planner terpisah** (§M6 boleh dilonggarkan).
- Prompt jauh lebih menentukan daripada model — tiga aturan tambahan menaikkan 80% → 93%
  tanpa ganti model. Memperkuat §M1: anggaran terbesar registry adalah menulis deskripsi.
- Satu-satunya kegagalan yang tersisa persis pekerjaan M10 (optimizer): planner **tidak**
  menalar sendiri "outlier tinggi → ubah parameter BERTopic". Menaruh optimasi di Fase 3
  terbukti urutan yang benar.

**Fase 1 — kerangka bisa jalan. ✅ SELESAI.** Halaman `/studio` menerima satu perintah,
menyusun rencana, menampilkannya untuk ditinjau, menjalankannya langkah demi langkah, dan
menutup dengan kartu jawaban bertombol ke `/positions/[id]?runId=…`.

| Modul | Berkas |
|---|---|
| M1 registry live (5 tool) | [`lib/agent/registry/live.ts`](../lib/agent/registry/live.ts) |
| M2 snapshot nyata | [`lib/agent/state/snapshot.ts`](../lib/agent/state/snapshot.ts) |
| M3 resolver entitas | [`lib/agent/state/resolve.ts`](../lib/agent/state/resolve.ts) |
| M4 deep-link | [`lib/agent/links.ts`](../lib/agent/links.ts) |
| M6 konteks planner | [`lib/agent/plan/context.ts`](../lib/agent/plan/context.ts) |
| M7 guardrails waktu-jalan | [`lib/agent/guard/runtime.ts`](../lib/agent/guard/runtime.ts) |
| M8 executor + tabel | [`lib/agent/exec/executor.ts`](../lib/agent/exec/executor.ts), [`drizzle/0047_agent_studio.sql`](../drizzle/0047_agent_studio.sql) |
| M11 kartu jawaban | [`lib/agent/present/build-answer.ts`](../lib/agent/present/build-answer.ts) |
| M13 UI | [`app/(dashboard)/studio/`](<../app/(dashboard)/studio/>), [`components/studio/`](../components/studio/) |
| Server action | [`lib/agent-actions.ts`](../lib/agent-actions.ts) |

Lima tool berstatus `live`: `scoring.start_run`, `scoring.await_completion`,
`scoring.list_runs_for_position`, `analysis.read_run_results`,
`governance.read_program_template`. Lima sisanya tetap bermanifest sebagai `planned`
sehingga harness eval terus mengujinya, tetapi **tidak diperlihatkan kepada planner
Studio** — rencana yang berhenti di tengah, setelah scoring sungguhan berjalan, adalah
kegagalan yang lebih mahal daripada jawaban "belum bisa" di muka.

Batas yang diketahui dan disengaja:

- **Tab harus tetap terbuka selama pekerjaan berjalan.** Konsekuensi langsung §1.1 opsi A.
  Yang berhenti hanyalah pemantauan — turnamen tetap berjalan di scoring-service dan run
  dilanjutkan saat dibuka kembali.
- **Persetujuan bersifat per-rencana, bukan per-langkah.** Rencana yang seluruh langkahnya
  `read` berjalan langsung; selebihnya menunggu satu klik. Gate per langkah tetap
  ditampilkan dan sudah tersimpan di `agent_run_steps.gate`, siap dipakai Fase 2.
- **Mode bantuan (M12) belum ada.** Pertanyaan "bagaimana cara…" menghasilkan rencana tanpa
  langkah, dan jawabannya dirangkai dari rencana itu saja — tipis, tapi jujur.
- **`jobProfiles` dan `latestTopicRun` pada snapshot sengaja `null`.** Mengisinya menuntut
  perjalanan ke basis vektor yang tidak akan dipakai selama tool job family belum live.
- **Izin `governance.read_program_template` diturunkan** dari `governance.manage` ke
  `scoring.run`. Membaca program adalah bagian dari menjalankan scoring; menuntut izin tata
  kelola akan memblokir peran Analyst dari rencana yang paling lazim. Penulisan konfigurasi
  tetap `governance.manage`.

**Fase 2 — registry penuh + helpdesk. ✅ SELESAI.**

| Bagian | Berkas |
|---|---|
| Katalog 34 manifest lintas domain | [`lib/agent/registry/catalog.ts`](../lib/agent/registry/catalog.ts), [`tools/`](../lib/agent/registry/tools/) |
| Audit kelengkapan (123 aksi) | [`scripts/agent-registry-audit.ts`](../scripts/agent-registry-audit.ts) |
| Retrieval tool per-permintaan | [`lib/agent/registry/retrieve.ts`](../lib/agent/registry/retrieve.ts) |
| Helpdesk (M12) sebagai tool | [`lib/agent/knowledge/`](../lib/agent/knowledge/), manifest `help.explain_feature` |
| Gate konfirmasi per langkah | [`drizzle/0048_agent_step_approval.sql`](../drizzle/0048_agent_step_approval.sql), executor + UI |
| Handler baru (16 tool → total 21 live) | [`lib/agent/registry/handlers/`](../lib/agent/registry/handlers/) |
| Suite eval Fase 2 (15 kasus) | [`scripts/agent-eval/golden-fase2.ts`](../scripts/agent-eval/golden-fase2.ts) |

Angka pengukuran ulang (model `vllm/aira`, mode tool):

| Konfigurasi | Benar | Catatan |
|---|---|---|
| Suite Fase 0 · 10 tool · aturan v2 (garis dasar) | 95% | tidak berubah — garis dasar utuh |
| Suite Fase 0 · 34 tool · retrieval · v2 | 83% | efek skala kosakata — lihat temuan di bawah |
| **Suite Fase 2 · 21 tool live · retrieval · v3** | **100%** (15/15, stabil 2 ulangan) | konfigurasi yang dipakai Studio |

Temuan yang mengubah kode selama pengukuran:

- **Kalimat catatan retrieval terbukti menentukan.** Versi pertama menutup dengan "bila
  yang Anda butuhkan tidak ada di daftar, katakan di clarifications" — dan dua kasus yang
  sebelumnya benar berubah menjadi rencana kosong. Menyebut kemungkinan menyerah di dekat
  daftar yang baru diakui tidak lengkap membuat menyerah terasa dianjurkan. Setelah
  kalimatnya diganti menjadi instruksi mengerjakan, angka naik 80%→83%. Prompt adalah
  permukaan API yang sama rapuhnya dengan skema.
- **Penurunan 95%→83% pada suite lama BUKAN regresi kemampuan.** Rinciannya: sebagian
  kasus lama mengharapkan `config.propose_change` yang memang sengaja belum dibuka
  (menunggu M9), dan g07 ("bagaimana cara…") kini "gagal" justru karena dijawab
  `help.explain_feature` — ekspektasi lamanya ("jangan lakukan apa-apa") yang basi.
  Regresi nyata yang tersisa satu: g11 goyah (1/2). Suite Fase 2, yang ekspektasinya
  ditulis untuk kosakata sekarang, memberi 100%.
- **Dokumen rancangan internal harus keluar dari korpus bantuan.** Pada uji nyata,
  `docs/agent-studio*.md` terambil untuk pertanyaan "cara mengubah bobot AHP" dan jawaban
  ke user HR menyebut "M9" dan "planner". Korpus kini: katalog kemampuan + peta halaman +
  CLAUDE.md + README service + runbook — bukan dokumen tentang agent itu sendiri.

Keputusan desain yang perlu diketahui pembaca berikutnya:

- **Helpdesk adalah TOOL, bukan mode.** Pertanyaan "bagaimana cara…" direncanakan,
  dieksekusi, dan disajikan lewat jalur yang sama dengan pekerjaan lain — sehingga
  permintaan campuran ("jelaskan readiness lalu tunjukkan ambang sekarang") menjadi satu
  rencana dua langkah, bukan dua mode yang saling meniadakan. Aturan prompt v3
  (aturan 13–14) menjaga batas dokumentasi-vs-data.
- **Konfirmasi per langkah menunggu parameter nyata.** Langkah `write` yang parameternya
  masih rujukan (`$s1.latestRunId`) berhenti TEPAT sebelum dieksekusi dan ditampilkan
  dengan nilai yang sudah diselesaikan; yang parameternya sudah konkret saat rencana
  ditinjau dicap pada persetujuan awal, karena meminta klik kedua untuk nilai yang sama
  melatih user menyetujui tanpa membaca.
- **Satu-satunya tool `write` yang dibuka: `scoring.exclude_candidate`.** Alasan bebas
  dari user dipetakan ke kode enum; yang tidak cocok jatuh ke `other` dengan kalimat
  aslinya tersimpan sebagai catatan — memaksakannya ke kode terdekat memalsukan alasan
  yang tercatat permanen. Penulisan konfigurasi tetap menunggu M9.
- **Audit kelengkapan menuntut keputusan, bukan cakupan.** 123 aksi: 46 terbungkus tool,
  77 dikecualikan dengan alasan tertulis per kelompok (aksi agent sendiri, pemuat layar,
  kurasi manusia, penunggu M9, pengubah pagar RBAC, infrastruktur data, dst). Aksi baru
  yang belum diputuskan membuat skrip keluar kode 1 — jalankan di CI.

**Fase 3a — M9 sandbox konfigurasi. ✅ SELESAI.**

| Bagian | Berkas |
|---|---|
| Tabel usulan + snapshot basi/rollback | [`drizzle/0049_agent_config_proposals.sql`](../drizzle/0049_agent_config_proposals.sql) |
| Modul usulan (buat/diff/terapkan/tolak/rollback) | [`lib/agent/config/proposals.ts`](../lib/agent/config/proposals.ts) |
| Run percobaan BERTopic | `startTopicRunAction(scope, { configOverride })` + `ensureSandboxConfigVersionId` |
| Tool `config.propose_change` live | handler di [`live.ts`](../lib/agent/registry/live.ts), izin diturunkan ke `scoring.run` |
| Panel peninjau di Studio | [`components/studio/proposals-dialog.tsx`](../components/studio/proposals-dialog.tsx) |
| Suite eval Fase 3 (5 kasus) | [`scripts/agent-eval/golden-fase3.ts`](../scripts/agent-eval/golden-fase3.ts) |

Kontrak yang ditegakkan — masing-masing berakar pada temuan terukur:

- **Agent mengusulkan; manusia menerapkan.** `config.propose_change` terbuka bagi pemegang
  `scoring.run` (mengusulkan tidak mengubah apa pun); `applyProposal` bukan tool sama
  sekali, melainkan aksi panel yang dijaga `governance.manage`. Ini jawaban final atas §6
  no. 5, dan alasannya angka: kepatuhan konfigurasi adalah satu-satunya kemampuan agent
  di bawah 100%.
- **Penerapan menolak usulan basi.** `base` merekam nilai saat usulan dibuat; bila sudah
  bergeser saat ditinjau, penerapan berhenti — menyetujui usulan berumur seminggu tidak
  boleh diam-diam membatalkan perubahan orang lain. `previous` direkam saat penerapan,
  jadi setiap penerapan bisa dibatalkan persis; pembatalan pun menolak bila konfigurasi
  sudah berubah lagi di atasnya.
- **Run percobaan tidak menyentuh config aktif.** Override BERTopic disimpan sebagai versi
  NON-aktif (`ensureSandboxConfigVersionId`) sehingga run tetap tercatat menunjuk config
  yang benar-benar dipakainya — memakai `ensureActiveConfigVersionId` di sini berarti
  setiap eksperimen diam-diam mengganti konfigurasi semua orang.
- **Dua kebijakan sanitasi yang sengaja berbeda.** Override run percobaan MEMBUANG key tak
  dikenal (satu key salah dari LLM tidak boleh mematikan run); patch usulan MENOLAKNYA
  (usulan berisi key karangan akan "diterapkan" tanpa mengubah apa pun — kebohongan yang
  lebih buruk dari kegagalan). Celah kedua ini ditemukan evaluasi: patch
  `{ performanceGradeWeight: 0.4 }` karangan model sempat lolos sebagai usulan sah.

Angka (model `vllm/aira`): suite Fase 3 **100%** (5 kasus, stabil 3 ulangan); suite Fase 2
tetap 100%; garis dasar beku Fase 0 100% pada run terakhir. Perbaikan yang menaikkannya
dari 60% awal, keduanya di retrieval: (1) `config.propose_change` kini SELALU disertakan —
saat tersaring keluar, model tidak berhenti melainkan mengerjakan versi tanpa bagian
konfigurasinya, pelanggaran kebijakan yang tak terlihat siapa pun; (2) retrieval ikut
menskor kalimat `examples`, dan dua contoh frasa tersirat ("menonjolkan aspek…",
"outlier… perbaiki") ditambahkan ke manifest.

**Fase 3b — M10 optimizer (BERTopic). ✅ SELESAI.**

| Bagian | Berkas |
|---|---|
| Objective terukur + pelaporan regresi | [`lib/agent/optimize/objective.ts`](../lib/agent/optimize/objective.ts) |
| Ruang parameter + arah pencarian deterministik | [`lib/agent/optimize/space.ts`](../lib/agent/optimize/space.ts) |
| Tool `job_family.optimize_clustering` (state machine antar-detak) | [`lib/agent/registry/handlers/optimize.ts`](../lib/agent/registry/handlers/optimize.ts) |
| Bentuk `{ weights }` untuk usulan AHP + turunan matriks di kode | [`lib/agent/config/proposals.ts`](../lib/agent/config/proposals.ts) + `lib/ahp.ts` |
| Asersi fungsi murni (17, exit 1 bila gagal — jalankan di CI) | [`scripts/agent-eval/optimize-check.ts`](../scripts/agent-eval/optimize-check.ts) |
| Suite eval Fase 4 (5 kasus pemetaan niat) | [`scripts/agent-eval/golden-fase4.ts`](../scripts/agent-eval/golden-fase4.ts) |

Keputusan desain inti: **penalaran arah dipindahkan dari model ke kode.** Dua evaluasi
menunjukkan planner tidak konsisten menalar "outlier tinggi → geser parameter mana" —
maka M10 bukan blok `optimize` yang disusun LLM, melainkan SATU tool yang di dalamnya
loop percobaan-nilai-putuskan berjalan deterministik. Tugas planner menciut ke hal yang
terbukti bisa ia lakukan: mengenali niat ("perbaiki", "jadikan 15 famili") dan memanggil
tool dengan sasaran yang benar. Bonus dari pemindahan itu: arah yang salah ikut
terkoreksi — anggapan lama "outlier tinggi → **naikkan** minClusterSize" terbalik
(menaikkannya justru menambah outlier), dan kini ada asersi yang menjaga arah itu tetap
benar selamanya.

Bentuk loopnya: baseline (run selesai terakhir) → kandidat terurut dari
`candidatesFor()` (maks 3–5, tiap kandidat satu gagasan satu-dua parameter, berpagar
rentang keras) → tiap kandidat dijalankan lewat jalur sandbox M9 (`configOverride`,
config aktif tak tersentuh) → dinilai `scoreMetrics()` (outlier, kedekatan jumlah famili,
fragmentasi, dominasi — rumus terbuka, bukan model) → terbaik dibandingkan baseline pada
SEMUA ukuran → bila menang, ditulis sebagai **usulan** (bukan penerapan) dengan rationale
berisi angka, perbaikan, DAN regresi. Regresi mengalir sampai blok "catatan mutu" kartu
jawaban — aturan pelaporan M10: yang memburuk disebut sejajar dengan yang membaik.

Temuan yang mengubah kode selama pengukuran: kasus "bobot kinerja 40%" membongkar bahwa
menuntut matriks Saaty 6×6 dari planner adalah menuntut penalaran numerik yang salah
tempat — insting model `{ performance: 0.4 }` justru bentuk yang benar. Usulan
`ahp_weights` kini menerima bentuk `{ weights }`; matriks konsistennya (w_i/w_j, CR≈0)
diturunkan di kode saat penerapan, aspek yang tak disebut diskalakan proporsional, dan
diff yang dilihat peninjau menjadi "performance: 0.22 → 0.4" alih-alih dua matriks.

Angka: suite Fase 4 **100%** (stabil 2 ulangan); Fase 3 **100%** (3 ulangan, dengan
penilai h03 yang justru diperketat); Fase 2 100%; 17 asersi fungsi murni lolos.
Batas yang diketahui: loop eksekusi optimizer belum teruji ujung-ke-ujung terhadap
topic-service (butuh layanan + korpus ter-embed); yang terbukti adalah perencanaan,
fungsi murni, dan tiap adapter yang dipakainya (sandbox M9, polling topic run) yang
sudah hidup sejak fase sebelumnya. M10 untuk domain scoring (preference model dari
`scoring_run_feedback`) belum dibangun.

**Fase 4 — preference model, resep & memori (sisa M10 + M14). ✅ SELESAI.**

| Bagian | Berkas |
|---|---|
| Umpan balik & preferensi masuk konteks planner | [`lib/agent/state/snapshot.ts`](../lib/agent/state/snapshot.ts) + `world.ts` |
| Aturan v4 (15–18: preferensi, umpan balik, ingat-vs-sekali-jalan, batasan user menang) | [`lib/agent/plan/planner.ts`](../lib/agent/plan/planner.ts) |
| Tabel memori + resep | [`drizzle/0050_agent_memories_recipes.sql`](../drizzle/0050_agent_memories_recipes.sql) |
| Tool `memory.save` | [`lib/agent/registry/handlers/memory.ts`](../lib/agent/registry/handlers/memory.ts) |
| Replay resep tervalidasi-ulang | `createRunFromPlan` di [`lib/agent/exec/executor.ts`](../lib/agent/exec/executor.ts) |
| Panel Preferensi + panel Resep + tombol simpan resep | [`components/studio/`](../components/studio/) |
| Suite eval Fase 5 (6 kasus, dunia ber-umpan-balik) | [`scripts/agent-eval/golden-fase5.ts`](../scripts/agent-eval/golden-fase5.ts) |

Bentuk preference model, dan kenapa TIPIS itu benar: lapisan penyimpanan sudah ada sejak
lama — `scoring_run_feedback` terstruktur per scope, tampil di Governance, dapat dicabut,
dan alasannya sudah disuntikkan aplikasi ke prompt penilaian berikutnya. Yang hilang
hanyalah AGENT yang membacanya. Maka M10-scoring = umpan balik downvote + preferensi
tersimpan dirender ke KONDISI SAAT INI, dan empat aturan baru menegakkan pemakaiannya:
preferensi dipatuhi kecuali dibatalkan eksplisit (15), rencana scoring pada posisi/program
yang punya umpan balik WAJIB menanggapinya — lewat usulan atau lewat assumptions (16),
"mulai sekarang…" disimpan sedangkan "kali ini saja…" tidak (17), dan batasan yang
disebut user selalu menang atas nilai bawaan maupun preferensi (18 — lahir dari regresi
g10 yang tertangkap saat pengukuran).

Memori memenuhi dua syarat dokumen rencana secara harfiah: TERLIHAT (panel Preferensi)
dan BISA DIHAPUS (hanya oleh manusia — `memory.save` adalah tool, penghapusnya bukan,
supaya agent tidak bisa "lupa" atas inisiatifnya sendiri). Per-user, bukan per-tenant:
preferensi satu analis tidak membentuk rencana analis lain.

Resep menyimpan RENCANA yang terbukti berhasil, bukan hasilnya. Replay membuat run baru
tanpa planner (nol LLM, nol keacakan) tetapi TIDAK PERNAH tanpa validasi: rencana diperiksa
ulang terhadap registry, izin, dan prasyarat hari-ini, dan gate persetujuan tetap utuh.
Resep berumur enam bulan yang menunjuk tool yang sudah berubah gagal di muka dengan alasan
terbaca — bukan dijalankan karena "dulu pernah berhasil". Menjalankan dan menghapus resep
adalah aksi manusia dari panel; agent tidak bisa memicu resep (rantai agent-memicu-agent).

Angka: suite Fase 5 **100%** (6 kasus × 3 ulangan, stabil) — termasuk pasangan
kontrol p04/p06 yang membuktikan preferensi BUKAN borgol (permintaan eksplisit menang)
dan "kali ini saja" TIDAK disimpan. Regresi: fase2/fase3/fase4 100%; garis dasar beku
100%. Dua aturan lahir dari kegagalan terukur selama fase ini — bukti bahwa harness
masih menjalankan tugasnya sebagai alat desain, bukan sekadar rapor.

**Fase 8 — menutup 14 skenario uji nyata yang dilaporkan gagal. ✅ SELESAI.**

Fase ini berbeda asalnya dari semua fase sebelumnya: bahannya bukan kasus yang saya karang,
melainkan 14 skenario yang benar-benar dijalankan user dan gagal. Kalimat query-nya
dipertahankan apa adanya di [`golden-fase8.ts`](../scripts/agent-eval/golden-fase8.ts) —
hanya nama entitas yang disesuaikan ke fixture beku — supaya suite ini menjawab pertanyaan
yang tidak bisa dijawab suite lain: apakah kegagalan yang DILAPORKAN sudah tertutup, bukan
kegagalan yang saya bayangkan sendiri.

Temuan struktural saat mengkategorikan: **mayoritas kegagalan adalah celah KOSAKATA, bukan
celah kemampuan.** `restructureOverrides`, tabel `job_family_matches`, `hierarchy.linkage`
+ `generalTitle`, CRUD program, dan peta folder dokumen semuanya sudah ada di aplikasi —
yang tidak ada adalah manifest yang membuat agent tahu benda itu ada. Itu mengubah bentuk
pekerjaan: lima kategori, dan hanya satu di antaranya menulis mesin baru.

| Kategori | Isi | Berkas |
|---|---|---|
| 1. Dokumentasi | Panduan fitur per-halaman + katalog 153 tombol (fungsi, dampak, izin, kapan nonaktif/gagal) | [`docs/panduan-fitur-halaman.md`](panduan-fitur-halaman.md), [`docs/katalog-tombol.md`](katalog-tombol.md) |
| 2. Tool baca baru | Laporan match, syarat jabatan yang belum dikelola, job family seorang kandidat, banding antar-program | [`tools/discovery.ts`](../lib/agent/registry/tools/discovery.ts) + `handlers/discovery.ts` |
| 3. Tool tulis baru | Buat posisi, buat program penilaian, usulkan restrukturisasi dokumen | [`tools/curation.ts`](../lib/agent/registry/tools/curation.ts) + `handlers/curation.ts`, [`0051`](../drizzle/0051_agent_proposal_filter_rules.sql)/[`0052`](../drizzle/0052_agent_proposal_restructure.sql) |
| 4. Optimizer bobot AHP | Objective + kandidat deterministik + diff & pergeseran peringkat | [`lib/agent/optimize/ahp.ts`](../lib/agent/optimize/ahp.ts) |
| 5. Perbaikan cacat | Filter `method` pada daftar run, kandidat menurut PERINGKAT, hasil topik yang utuh, validasi patch saat rencana disusun | `fase0-tools.ts`, `live.ts`, `explain.ts`, `knowledge.ts`, `proposals.ts` |

Keputusan kewenangan yang diambil di sini, dan alasannya ditulis di kepala
[`tools/curation.ts`](../lib/agent/registry/tools/curation.ts): larangan "agent tidak
membuat data master" **tetap berlaku** untuk kandidat dan jabatan — keduanya berasal dari
sinkronisasi HR, jadi baris buatan agent akan bertabrakan pada sinkronisasi berikutnya.
Posisi dan program penilaian TIDAK berasal dari sinkronisasi; keduanya memang
dikurasi manusia di dalam aplikasi ini, sehingga alasan pelarangannya tidak berlaku dan
keduanya dibuka (tetap berkelas `write`, tetap lewat gate konfirmasi).

Tiga hal yang berubah karena pengukuran, bukan karena rencana:

- **`superRefine` sempat menyembunyikan seluruh parameter dari prompt.** Validasi patch
  saat rencana disusun membungkus skema jadi `ZodEffects`, dan pembaca shape lama membaca
  `_def.shape()` langsung — hasilnya tool tampil tanpa satu pun parameter. Diperbaiki
  dengan `objectShapeOf()` yang menembus pembungkus; nyaris lolos karena tidak ada yang
  gagal, prompt hanya menjadi lebih miskin diam-diam.
- **Objective AHP tidak setia pada maksudnya sendiri.** Komponen keseimbangan memakai
  entropi ternormalisasi, yang terlalu datar di ujung bawah sehingga bobot menumpuk pada
  dua aspek MENANG dari bobot seimbang. Diganti jumlah kriteria efektif `exp(entropi)`,
  yang jatuh tajam saat efektifnya tinggal dua. Asersinya kini menjaga arah itu.
- **Satu kasus emas ternyata yang salah, bukan planner-nya.** Pada x12 model menolak
  mengoptimalkan bobot AHP untuk program bermetode LLM — keberatan yang wajar, tetapi
  terlalu ketat karena metode dipilih PER-RUN, bukan oleh bawaan program. Manifest kini
  menyatakan itu eksplisit, dan kasusnya diarahkan ke program AHP+TOPSIS.

Angka: suite Fase 8 **100% TERURAI/SAH/BENAR**, 14/14 stabil pada 2 ulangan. Regresi
fase2–fase7 seluruhnya 100%; garis dasar beku Fase 0 95% (tidak berubah). Registry tumbuh
36 → 47 manifest, 24 → 35 live; audit hijau (147 aksi, 0 belum diputuskan).

**Fase 9 — sembilan temuan dari putaran uji kedua. ✅ SELESAI.**

Putaran uji kedua menghasilkan sembilan temuan, dan pengelompokannya berbeda dari Fase 8:
di sini mayoritas bukan celah kosakata melainkan **cacat nyata**, tiga di antaranya tak
berisik — berhasil, tetapi salah.

| # | Temuan | Akar masalah | Perbaikan |
|---|---|---|---|
| E2 | Usulan bobot AHP langsung berstatus "basi" | Postgres `jsonb` menormalkan urutan kunci objek; `base` selalu melewatinya, nilai berlaku selalu dibangun ulang di memori — dan keduanya dibandingkan dengan `JSON.stringify`, yang peka urutan | [`config/canonical.ts`](../lib/agent/config/canonical.ts) — pembanding kanonik, dipakai di keempat titik perbandingan |
| C3 | Tombol "Lihat hasil" membuka run teratas, bukan run yang dijawab | `runLink()` menulis `?run=`, halaman posisi membaca `runId` | [`links.ts`](../lib/agent/links.ts) + pemindaian runId per-langkah ber-daftar-putih |
| A | Restrukturisasi gagal: "Bagian tidak dikenal: organizationalStructure" | Kosakata token tidak pernah tercetak ke prompt, dan tidak punya bentuk kolektif untuk "struktur organisasi" | Enum tertutup token + **grup** di [`restructure.ts`](../lib/job-family/restructure.ts), disusun dari template yang BERLAKU |
| C1 | "NADIA" dijawab "tidak ada dalam sistem" | Skor lama membagi hit dengan jumlah token NAMA; menyebut orang DAN posisi sekaligus menenggelamkan skornya | [`state/name-match.ts`](../lib/agent/state/name-match.ts) — kelangkaan berlantai, klaim posisi, cakupan sebagai bonus |
| B | Buat posisi berbalik jadi empat pertanyaan | Agent tidak punya jalur auto-isi yang sudah dipakai form di aplikasi | [`position-management-defaults.ts`](../lib/position-management-defaults.ts) + tool `positions.preview_defaults` |
| C2 | "scoring run kedua" tidak dikenali | Riwayat run tidak punya nomor urut | Parameter `ordinal` + `selectedRunId`, dan aturan 21 |
| C2b | Klarifikasi tanpa pilihan | Rencana tidak punya tempat menaruh opsi | Field `choices` (aditif) + aturan 22 + tombol di Studio |
| D4 | Job family tanpa tombol kartu | Tidak ada rute ke satu famili | `jobFamilyLink()` + `/family-tree?runId=&topicId=` |
| E3 | Keluaran tool baca terlalu miskin | — | `compare_programs` menyertakan deskripsi, condong-bobot, statistik pemakaian, dan dimensi yang SAMA |

Tiga hal yang ditemukan sambil mengerjakan, dan tidak ada di daftar temuan:

- **Studio produksi berjalan pada aturan v3**, sementara harness eval mengukur v5.
  Delapan aturan (15–22) — preferensi, umpan balik, kelanjutan percakapan — tidak pernah
  aktif di aplikasi meski angkanya 100% di laporan. Keduanya kini v6. Ini pelajaran tentang
  harness: mengukur konfigurasi yang bukan konfigurasi produksi menghasilkan angka yang
  benar tentang sesuatu yang tidak dipakai siapa pun.
- **Komentar JSDoc pada skema tool tidak pernah sampai ke prompt.** `describeZodShape`
  hanya mencetak `nama: tipe`. Akibatnya berulang dan selalu berbentuk sama: parameter
  opsional yang punya perilaku bawaan berguna ("kosong = run terakhir dipilih otomatis")
  terbaca model sebagai sesuatu yang tidak ia ketahui, lalu ia BERTANYA alih-alih
  mengerjakan — persis kegagalan x12 yang muncul kembali di tengah fase ini. Kini
  `.describe()` ikut dicetak, dan itu memperbaiki kelasnya, bukan kasusnya.
- **Handler restrukturisasi menyusun template dari template BAWAAN**, bukan yang berlaku.
  Pada instalasi yang templatenya sudah disesuaikan — termasuk yang ini — usulan agent akan
  menambah baris yang tidak dimiliki dokumen lain sekaligus membuang baris yang dimiliki
  semuanya. Tidak ada yang gagal; hasilnya saja yang salah.

Empat asersi murni baru menjaga semuanya tetap benar tanpa test runner:
[`canonical-check`](../scripts/agent-eval/canonical-check.ts) (20 asersi, menjaga KEDUA arah
kontrak basi), [`restructure-check`](../scripts/agent-eval/restructure-check.ts) (16),
[`name-match-check`](../scripts/agent-eval/name-match-check.ts) (17, termasuk dua invarian
numerik), dan `optimize-check` yang sudah ada.

Angka: fase2–fase8 seluruhnya **100%** pada aturan v6; garis dasar beku Fase 0 tetap 95%
(g03 satu-satunya kegagalan konsisten, seperti sebelumnya); registry 48 manifest / 36 live;
audit hijau.

**Fase 10 — rumus & percabangan enam kriteria sampai tingkat mesin. ✅ SELESAI.**

Permintaannya: agent harus dapat menerangkan **dari mana persisnya** angka tiap kriteria
berasal — terutama kompetensi teknis dan relevansi karier — termasuk percabangan yang kini
bercabang (kedalaman durasi vs kedalaman stint), mekanisme cadangan untuk posisi riwayat
maupun posisi target yang tidak punya pasangan job profile, siapa penentunya, dan mengapa.

Hasilnya [`docs/rumus-kriteria-ahp-topsis.md`](rumus-kriteria-ahp-topsis.md), disusun dari
pembacaan `ahp-topsis-engine.ts` (4.375 baris) dan `config.ts` — bukan dari ringkasan dokumen
yang sudah ada. Isinya: rantai keputusan lengkap tiap kriteria, seluruh konstanta beserta
variabel lingkungannya, dua contoh perhitungan berangka, dan tabel "angka ini datang dari
mana". Yang paling dalam adalah bab relevansi karier: delapan langkah, empat tingkat
pemasangan stint, **lima** tingkat pemasangan posisi target (sampai dokumen sintetis yang
di-embed dengan model yang sama dengan `job_profile_embed`), kalibrasi p5/p95 untuk cadangan
kompetensi, dan alasan `MIN(depthYears, depthRows)` dipakai alih-alih rata-rata.

**Cacat laten yang ditemukan sambil memasangnya, dan ini yang paling berharga dari fase ini.**
Dokumen baru itu masuk korpus tetapi **tidak pernah memenangkan satu pertanyaan pun**.
Sebabnya: berkasnya tersimpan dengan akhiran baris CRLF, dan regex judul di
`chunkMarkdown` tidak cocok karena `.` tidak mencakup `
`. Akibatnya seluruh 23 potongannya
berjudul `(pembuka)` — kehilangan bobot judul (×4 per kata), sinyal pencocokan terkuat.
Tidak ada yang gagal; dokumennya sekadar tak pernah terpakai. Di Windows ini bisa menimpa
dokumen apa pun yang ditambahkan kemudian.

Tiga perbaikan, dan hanya yang pertama yang menyembuhkan kelasnya:

1. `chunkMarkdown` menormalkan akhiran baris sebelum memisah baris.
2. `corpus-check` menolak (exit 1) setiap dokumen yang SELURUH potongannya tanpa judul —
   penjaga yang membuat kegagalan senyap ini berisik.
3. `boostSource` menerima daftar, bukan satu string. Pengali 2,5 yang hanya menyasar satu
   dokumen metodologi membuat dokumen metodologi lain kalah meskipun skornya dua kali lebih
   tinggi; yang dimaksud "diutamakan" adalah JENIS bahannya, jadi seluruh anggotanya ikut.

Angka: `corpus-check` 20 pertanyaan (8 baru khusus rumus), seluruhnya mengambil potongan yang
relevan — dan kedelapan pertanyaan mendalam kini terambil dari dokumen baru, bukan dari
dokumen lama yang hanya meringkasnya. Suite fase8 naik ke 16 kasus, **100% BENAR, 16/16
stabil** pada 2 ulangan.

**Fase 11 — kosakata rentang grade & larangan pengenal basis data. ✅ SELESAI.**

Dua laporan kecil yang keduanya menyingkap hal yang sama: lapisan agent memakai bentuk
INTERNAL padahal aplikasinya sudah punya bentuk yang dipakai manusia.

| Temuan | Akar masalah | Perbaikan |
|---|---|---|
| "range grade dari staff hingga supervisor" dijawab "mohon konfirmasi ID grade" | `scoring.start_run` hanya menerima `minGradeId`/`maxGradeId` mentah, sedangkan wizard menerjemahkan nama tingkat sendiri | [`lib/grade-levels.ts`](../lib/grade-levels.ts) — modul murni, aturannya disalin persis dari wizard |
| Jawaban memuat `candidateId 2f7e9f62-…` | Tidak ada apa pun yang melarangnya; `digest` yang dikirim ke narator memuat keluaran mentah | [`present/scrub-ids.ts`](../lib/agent/present/scrub-ids.ts) + aturan narator 5b |

Aturan rentang grade yang sekarang ditegakkan, dan invariannya: satu nama tingkat memetakan
ke BEBERAPA grade, jadi batas bawah memakai grade **terkecil** tingkat itu dan batas atas
memakai grade **terbesar**. Mengambil ujung yang salah mempersempit pool kandidat tanpa ada
yang sadar — karena itu ia diuji, bukan hanya ditulis. Sebutan yang cocok ke lebih dari satu
tingkat tidak pernah dipilih diam-diam, dan sebutan yang tidak dikenal menghasilkan galat
yang MENYEBUTKAN pilihan yang tersedia — pertanyaan yang bisa dijawab user, tidak seperti
"sebutkan ID grade-nya".

Penyaringan pengenal dikerjakan pada EMPAT titik, dan sengaja tidak hanya di ujung: `digest`
yang menjadi bahan narator ikut disaring, sehingga kalimat yang bergantung pada sebuah id
tidak akan pernah tersusun. Aturan prompt tetap ada di sampingnya — aturan menurunkan
peluang, penyaring menghilangkan. Yang TIDAK disaring adalah `href` tombol: tautan memang
harus membawa id, dan ia tidak pernah dibaca sebagai teks.

Angka: suite fase8 naik ke 17 kasus, **100% BENAR, 17/17 stabil**; dua berkas asersi baru
(`presentation-check` 22 asersi termasuk tujuh kalimat yang WAJIB tetap utuh, dan
`grade-level-check` 22 asersi termasuk invarian ujung rentang). Sisi "harus tetap utuh"
sengaja diuji sebanyak sisi "harus hilang": penyaring yang terlalu rakus akan memakan
kalimatnya juga, dan kerusakan itu tidak terlihat sampai ada yang membaca jawabannya.

**Fase 12 — bobot AHP dalam satuan yang dipakai orang. ✅ SELESAI.**

"atur bobot AHP … dengan urutan dan unit kepentingan behavior 35, technical 20, hav 15, pa 10,
education 5, career 15" ditolak dengan *"Patch bobot AHP harus berupa { weights: … porsi
0–1 }"*. Dua cacat sekaligus, dan yang kedua lebih dalam dari yang dilaporkan:

1. Validator menuntut `0 < v < 1`, sehingga **unit kepentingan** — bentuk yang paling wajar
   disebut orang untuk kriteria ini — ditolak mentah-mentah, dengan pesan yang hanya
   mengulang bentuk yang diharapkan.
2. `deriveMatrixFromPartialWeights` melempar ketika `pinnedTotal >= 1`, jadi **spesifikasi
   LENGKAP keenam aspek tidak pernah bisa diterapkan** — justru bentuk yang paling jelas
   maksudnya. Ini tidak pernah muncul di suite mana pun karena setiap kasus emas yang ada
   hanya menyebut satu-dua aspek.

[`config/ahp-weight-patch.ts`](../lib/agent/config/ahp-weight-patch.ts) menjadi satu-satunya
tempat yang memutuskan arti sebuah patch bobot, dipakai oleh validasi (saat rencana
disusun), kanonikalisasi (saat usulan dibuat), dan penerapan — supaya ketiganya tidak pernah
berbeda tafsir. Tiga bentuk dikenali:

| Bentuk | Ciri | Arti |
|---|---|---|
| **Lengkap** | keenam aspek disebut | dinormalisasi terhadap jumlahnya sendiri; 35/20/15/10/5/15 dan 0,35/0,20/… berarti sama |
| **Parsial porsi** | sebagian aspek, semua < 1 dan total < 1 | arti lama: dipatok, sisanya diskalakan proporsional |
| **Parsial unit** | sebagian aspek, ada yang ≥ 1 | perbandingan DI DALAM kelompok yang disebut; **porsi gabungan kelompok dipertahankan** |

Bentuk ketiga adalah keputusan yang paling perlu dijelaskan: menormalisasi dua unit ke 1
akan menihilkan empat aspek yang tidak disebut — perubahan besar yang tidak pernah diminta
siapa pun.

Patch dikanonikalkan ke porsi **saat usulan dibuat**, bukan saat diterapkan, supaya diff yang
dilihat peninjau tidak menyandingkan satuan yang berbeda ("behavior: 0,1667 → 35") dan
perbandingan usulan basi tidak membandingkan porsi dengan unit.

**Batas optimizer vs penetapan bobot juga diperjelas** — kata "optimal" pada permintaan yang
SUDAH menyebut angkanya sempat menarik `governance.optimize_ahp_weights`, yang justru akan
mengabaikan angka itu karena mencari bobotnya sendiri. Pembedanya ditulis sebagai: siapa yang
menentukan angkanya, bukan ada-tidaknya angka.

Satu pelajaran retrieval yang mahal dan layak dicatat: menambahkan kalimat *"…bukan optimizer
bobot AHP"* ke dalam prosa `job_family.optimize_clustering` justru **menurunkan** fase4 ke
80% — menyebut nama domain lain di dalam manifest sebuah tool menarik tool itu ke retrieval.
Kalimatnya dicabut, dan yang disimpan hanya penambahan frasa konkret yang memang diketik user.

Angka: fase8 naik ke 18 kasus, **100%, 18/18 stabil pada 3 ulangan**; fase4 kembali **100%,
5/5 stabil pada 3 ulangan**; fase2/3/5/6/7 seluruhnya 100%; garis dasar beku 90–100% (baseline
95%, g03 tetap satu-satunya kegagalan konsisten). Berkas asersi baru
[`ahp-weight-check`](../scripts/agent-eval/ahp-weight-check.ts) — 25 asersi, termasuk
verifikasi bahwa matriks Saaty hasilnya konsisten sempurna (CR ≈ 0) dan bobot turunannya
kembali persis ke angka yang diminta, yaitu syarat agar usulan benar-benar dapat diterapkan
dan terbaca di Tata Kelola.

**Yang tersisa dari rencana awal (di luar cakupan semua fase sejauh ini):** runner
headless (§1.1 opsi B) untuk run terjadwal/unattended — prasyaratnya resep sudah ada;
halaman Agent Registry di Governance (M1 overlay); dan eksekusi ujung-ke-ujung terhadap
layanan nyata sebagai uji penerimaan.

---

## 6. Keputusan yang perlu diambil sekarang

Tiga dari lima sudah terjawab Fase 0 — rinciannya di
[`agent-studio-fase0.md`](agent-studio-fase0.md) §5.

1. **Konteks eksekusi** — tick-loop dari klien (cepat, tab harus terbuka) atau runner
   headless (refactor 130 aksi). *Belum terjawab; tidak diuji Fase 0.* Rekomendasi tetap
   tick-loop untuk v1.
2. ~~**Model planner**~~ — **terjawab:** `vllm/aira` lewat gateway yang ada, mode function
   calling, aturan prompt v2. Tidak perlu model atau anggaran baru.
3. ~~**Batas kewenangan agent**~~ — **terjawab:** aksi `destructive` tidak perlu masuk
   kosakata v1. Model menolak permintaan di luar kosakata dengan benar 100%, jadi tidak
   ada yang diperoleh dari menambah risiko itu.
4. **Siapa boleh memakai Studio** — semua pemegang `scoring.run`, atau izin `agent.run`
   tersendiri? Keputusan kebijakan, bukan teknis.
5. ~~**Kepemilikan usulan config**~~ — **terjawab sebagian:** pisahkan usul dan terap.
   Kepatuhan pada kebijakan konfigurasi adalah satu-satunya kemampuan di bawah 100%
   (67–75%), jadi gate manusia di sana bukan formalitas. Siapa yang memegang gate itu
   masih keputusan Anda.
