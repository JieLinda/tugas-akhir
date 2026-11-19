# Inventaris mode re-run scoring — kondisi SEBELUM perombakan

Catatan audit Fase 1 (2026-10-29, cabang `mcdm`, commit `2db9853`). Dokumen ini
menggambarkan kode **sebelum** fitur re-run disederhanakan menjadi satu mode
(`incremental_add`, "Tambah Kandidat Pembanding"). Semua rujukan `path:baris`
mengacu ke commit di atas. Lampiran inventaris yang menyertai permintaan
(commit `a39a436`, masuk ke cabang setelah audit ini ditulis) disimpan apa
adanya sebagai Lampiran B, dan setiap klaimnya diverifikasi terhadap kode di
Lampiran A.

Ringkasan satu paragraf: ada **lima jalur** yang membuat run turunan, tiga di
antaranya memakai mesin bersama `startRerunAction`, dua fungsi lama tidak
punya pemanggil sama sekali, dan jalur pengecualian punya mesinnya sendiri.
Mode `incremental_add` yang ada sekarang **tidak** benar-benar beku: bobot
efektif, himpunan kriteria aktif, jangkar kalibrasi, dan tanggal acuan semuanya
dibaca ulang saat run turunan dihitung, dan kandidat yang dipilih tetapi sudah
ada di pool induk dinilai ulang dengan data hari ini.

> **Catatan 17 November 2026.** Metode AI Tournament (LLM) sudah dihapus;
> AHP + TOPSIS adalah satu-satunya metode. Setiap rujukan di dokumen ini ke run
> LLM, induk LLM, wizard LLM, atau cache `candidate_aspect_scores` menggambarkan
> kondisi pada tanggal audit, bukan sistem hari ini. Run LLM yang tersimpan dan
> tabel cache itu dihapus oleh `drizzle/0097_remove_llm_tournament.sql`.

---

## 0. Baseline tes dan typecheck

Dijalankan sebelum ada perubahan apa pun (`pnpm install --frozen-lockfile` di
root dan `scoring-service/`; `sync-service/` tidak di-install).

| Suite | Perintah | Hasil |
|---|---|---|
| web scoring | `node --import tsx --test tests/scoring/*.test.ts` | 35 tes: 34 lulus, 0 gagal, 1 `todo` (TC-PAR-07, DEFECT-04) |
| scoring-service | `cd scoring-service && node --import tsx --test test/*.test.ts` | 172 tes: 169 lulus, 0 gagal, 3 `todo` (TC-PA-09 DEFECT-01, TC-CAR-EXP-03 DEFECT-03, TC-TEC-17 DEFECT-02) |
| job family | `node --import tsx --test tests/job-family/*.test.ts` | 15 lulus |
| talent mapping | `node --import tsx --test tests/talent-mapping/*.test.ts` | 64 lulus |
| tsc web | `npx tsc --noEmit -p .` | **74 error** (32 `lib/talent-data.ts`, 9 `components/analysis/aspect-derivations.tsx`, 17 di `sync-service/src/**` karena dependensinya tidak ter-install, sisanya tunggal-tunggal) |
| tsc scoring-service | `cd scoring-service && npx tsc --noEmit` | 0 error |
| lint | `pnpm lint` | rusak sejak awal (tidak ada `eslint.config.*`, eslint tidak terpasang — lihat CLAUDE.md) |

Keempat `todo` adalah defek yang sudah tercatat sebelumnya, bukan kegagalan.

---

## 1. Jalur pembuatan run turunan dan pemanggilnya

| Fungsi | Lokasi | Mode yang ditulis | Pemanggil di UI | Pemanggil di luar fitur re-run |
|---|---|---|---|---|
| `startRerunAction` | `lib/scoring-engine.ts:2820` | kelima mode (`RERUN_MODES[input.mode]`, `:2832`) | `components/position-run-table-client.tsx:154` (dialog `RerunDialog`, `components/rerun-dialog.tsx:322`) | tidak ada |
| `rerunScoringWithCandidatesAction` | `lib/scoring-engine.ts:1230` | `incremental_add` (`:1462`), menulis kunci lama `final_ranked.ahpAugment` (`:1400`) | **tidak ada** — kode mati | tidak ada |
| `rerunScoringExcludingCandidatesAction` | `lib/scoring-engine.ts:1779` | `exclude` lewat `createExclusionRerank` | `components/exclude-candidate-dialog.tsx:344` (tombol "Hitung ulang peringkat tanpa N kandidat ini" di `ExclusionSummaryBar`, `:314`) | tidak ada |
| `rerunScoringFullPoolAction` | `lib/scoring-engine.ts:2040` | `refresh_add` / `refresh_full` (`:2317`), menulis `final_ranked.ahpAlwaysInclude` (`:2284`) | **tidak ada** — kode mati | tidak ada |
| `setRunExclusionAction` (`rerank=true`) | `lib/scoring-engine.ts:1619`, cabang `:1696–1756` | `exclude` lewat `createExclusionRerank` | `components/exclude-candidate-dialog.tsx:120` (checkbox "Hitung ulang peringkat tanpa kandidat ini", `:233`) | **ya, tetapi hanya cabang non-rerank**: fungsi yang sama menulis/menghapus penanda pengecualian (`:1660–1692`). Yang dihapus hanya cabang `rerank`; fungsinya tetap. |
| `createExclusionRerank` | `lib/scoring-engine.ts:1812` | `exclude` (`:1963`), menulis kunci lama `final_ranked.ahpExclude` (`:1922`) | lewat dua fungsi di atas | tidak ada (tidak diekspor) |
| `searchAddableCandidatesAction` | `lib/scoring-engine.ts:1154` | — (pencarian) | `components/rerun-dialog.tsx:401` | tidak ada |

Kesimpulan untuk kondisi berhenti: **tidak ada fungsi yang akan dihapus yang
dipakai di luar fitur re-run.** `setRunExclusionAction` dipakai juga untuk
penandaan tanpa rerank, tetapi fungsinya tidak dihapus — hanya cabang
`rerank=true`.

Tidak ada pemanggil lain di `app/`, `sync-service/`, `scripts/` (selain
`scripts/audit-run-label-stamps.ts`, yang hanya membaca tabel mode untuk
validasi label), maupun di agent tools (`lib/agent/` sudah tidak ada di main).

---

## 2. Pembaca `RERUN_MODES` / `rerunSpec()` dan cabang per mode

### 2a. Dipakai untuk MEMBUAT run

| Lokasi | Yang dibaca | Cabang per mode |
|---|---|---|
| `lib/rerun-modes.ts:191` `RERUN_MODE_ORDER` | daftar lima mode yang boleh dibuat | — |
| `lib/scoring-engine.ts:2830–2840` | `isRerunMode`, `RERUN_MODE_ORDER`, `requiresAdded`, `requiresExcluded` | validasi |
| `lib/scoring-engine.ts:2855` | `spec.freshness === 'carried_over'` | tolak induk LLM hanya untuk mode beku |
| `lib/scoring-engine.ts:2883–2967` | `spec.pool` | empat cabang pool: `base_pool_plus`, `base_pool_minus`, `finalists`, `rebuilt` |
| `lib/scoring-engine.ts:3020–3029` | `spec.pool` | jumlah finalis per mode |
| `lib/scoring-engine.ts:3031–3037` | `spec.delta`, `spec.chip` | label run |
| `lib/scoring-engine.ts:3042–3050` | `freshness`, `inheritAhp` → `AhpRerunSpec` | spec untuk scoring-service |
| `lib/scoring-engine.ts:3110–3118` | `spec.pool === 'rebuilt'` | snapshot live vs warisan |
| `lib/scoring-engine.ts:3150–3155` | `spec.label`, `spec.expectation` | kalimat audit log |
| `components/rerun-dialog.tsx:687–702` | `RERUN_MODE_ORDER`, `rerunSpec` | kartu pemilih lima mode |
| `components/rerun-dialog.tsx:96–132` | `spec.pool`, `freshness`, `inheritAhp` | kalimat pool/data/AHP per kartu |
| `components/rerun-dialog.tsx:379` | `freshness === 'carried_over'` | nonaktifkan mode beku untuk induk LLM |
| `lib/run-label.ts:52` `DELTA_SEGMENT`, `:153` `assertDeltaSegmentCoversRerunModes`, `:187` `buildDerivedRunLabel` | `spec.delta` | membuat label turunan |
| `scoring-service/src/ahp-topsis-engine.ts:296` `AhpRerunSpec` (salinan) | kontrak `final_ranked.ahpRerun` | — |
| `scoring-service/src/ahp-topsis-engine.ts:5528–5572` | `ahpRerun`, kunci lama `ahpAugment` / `ahpExclude` / `ahpAlwaysInclude` | `reuseAspects`, `inheritAhp`, `augment`, `exclude`, `excludedIds` |
| `scoring-service/src/ahp-topsis-engine.ts:5632` | `reuseAspects`, `addedIds` | siapa dinilai ulang |
| `scoring-service/src/ahp-topsis-engine.ts:5851–5859` | `reuseAspects` | bekukan behavior/PA/HAV |
| `scoring-service/src/ahp-topsis-engine.ts:5870–5883` | `reuseAspects` → `CachedAspects.baseRaw` | string mentah yang ditampilkan |
| `scoring-service/src/ahp-topsis-engine.ts:5893–5962` | `reuseAspects` | laporan `freshness` (`policy: frozen/live`) |
| `scoring-service/src/ahp-topsis-engine.ts:6519–6587` | `exclude`, `augment.poolSource` | `buildExcludeInfo` / `buildAugmentInfo` |
| `scoring-service/src/ahp-topsis-engine.ts:6589–6593` | `exclude` | warisi diagnostik run dasar |
| `scoring-service/src/ahp-topsis-engine.ts:6620–6629` | `rerun` | `runInfo.rerun` |
| `scoring-service/src/ahp-topsis-engine.ts:371–410` `CachedAspects` (+ `baseRaw` `:404`), `:437` `loadCachedAspects` | aspek + string mentah run dasar | — |

### 2b. Hanya MEMBACA atau MENAMPILKAN run lama

| Lokasi | Yang dibaca |
|---|---|
| `lib/rerun-modes.ts:208` `rerunSpec()` | nilai apa pun → spec; tidak dikenal → `baseline` |
| `lib/run-tree-actions.ts:83–89, :117` | `rerunSpec(r.mode)` untuk node pohon dan label ringkas |
| `components/analysis/run-tree.tsx:78–79` | `rerunSpec`, `RERUN_TONE` (chip mode pada node) |
| `components/analysis/run-ancestry.tsx:86, :211, :275` | `rerunSpec(...).expectation`, `RERUN_TONE` (breadcrumb silsilah) |
| `components/position-detail-tabs.tsx:584–610` | jalur leluhur dari pohon run |
| `components/analysis/rank-shift-panel.tsx:75–143` | `runInfo.augment` / `.exclude` / `.freshness`, `poolSource === 'finalists_only'` |
| `components/analysis/run-configuration-panel.tsx:968–1035` | `origin.kind` (`exclude`/`augment`/`full`), `freshness`, `augment.poolSource` |
| `lib/progress-running-actions.ts:505–570` (tipe), `:1603–1610` (`origin`) | `runInfo.augment` / `.exclude` / `.freshness` |
| `lib/run-label.ts:127` `runLabelCore` | delta lama di label |
| `scripts/audit-run-label-stamps.ts:104` | `RERUN_MODES` untuk validasi label nyata |
| `tests/scoring/parity-and-reruns.test.ts:113–150, :155, :172–183` | TC-RRN-01..05, TC-LBL-01/03 |

Catatan: teks penjelasan di `rank-shift-panel.tsx:66–70` dan
`run-configuration-panel.tsx:976–982` masih menyebut behavior/PA/HAV "dibaca
ulang dari data kandidat saat ini". Itu sudah tidak benar untuk mode beku sejak
keenam aspek dibekukan (`ahp-topsis-engine.ts:5851`).

---

## 3. Audit pembekuan `incremental_add` saat ini

Alur: `startRerunAction` (`lib/scoring-engine.ts:2820`) menulis
`final_ranked.ahpRerun` → `runAhpTopsisSession`
(`scoring-service/src/ahp-topsis-engine.ts:5507`) membacanya.

### 3a. Enam skor aspek dan `baseRaw` kandidat lama — **dari induk, dengan tiga lubang**

- Kandidat lama yang bukan "tambahan" mengambil keenam aspek dari induk:
  `loadCachedAspects` (`ahp-topsis-engine.ts:437`) membaca
  `analysis_results.details.ahpTopsis` lalu `scoring_run_pool_aspects`;
  reuse di `:5632`, technical `:5767`, career `:5823`, behavior/PA/HAV `:5851`,
  education `:5984`. String mentah dari `baseRaw` (`:5870`) dan ditulis ulang ke
  `scoring_run_pool_aspects.details.rawInputs` (`:6247`) sehingga rantai tetap
  membawa nilai root.
- Lubang 1: kandidat yang dipilih pengguna tetapi **sudah ada di pool induk**
  dinilai ulang dengan data hari ini, karena `addedIds` menang atas
  `reuseAspects` (`:5632`) — lihat butir 4.
- Lubang 2: kandidat lama yang sejak induk di-*soft-delete* atau kini menjadi
  pejabat posisi itu **hilang diam-diam** dari pool: `buildPoolFromCandidateIds`
  memfilter `liveCandidate()` dan pejabat (`lib/scoring-engine.ts:573, :656–662`),
  dan `loadAhpCandidates` memfilter `deleted_at IS NULL`
  (`ahp-topsis-engine.ts:1071`). TOPSIS lalu dihitung atas himpunan yang lebih
  kecil dari induk tanpa dilaporkan.
- Lubang 3: induk yang dibuat sebelum `rawInputs` disimpan tidak punya
  `baseRaw`; skornya tetap beku tetapi string yang ditampilkan adalah data hari
  ini (`from: 'live'`, `:5874`).

### 3b. Matriks AHP dan bobot akhir setelah pembagian ulang — **matriks dari induk (dibulatkan); bobot akhir live**

- Matriks: `loadBaseAhpPairwise` (`ahp-topsis-engine.ts:636`) membaca
  `run_info.ahp.pairwise` induk, lalu `resolveAhpWeights` menghitung ulang
  eigenvektornya (`ahp-weights.ts:117`, sumber `inherited`). Matriks yang
  disimpan **sudah dibulatkan 4 desimal** (`ahp-topsis-engine.ts:6716`), jadi
  bobot child bisa berbeda ~1e-5 dari bobot induk, cukup untuk mengubah koefisien
  kedekatan melebihi toleransi 1e-9.
- Bila induk tidak punya `run_info` (run lama yang sesinya terhapus), child
  diam-diam memakai matriks **live** program (`ahp-weights.ts:121–135`).
- Bobot akhir (Pers. 2.12) dihitung ulang di child dari himpunan kriteria yang
  ditentukan ulang di child (`:6080–6086`, `rankCandidatesByTopsis` `:5443`),
  jadi ikut berubah bila 3c berubah. Status: **live**.

### 3c. Himpunan kriteria aktif — **live**

`droppedCriteria` dihitung ulang dari nol di child (`ahp-topsis-engine.ts:6033–6078`):

- technical dibuang bila acuan kompetensi posisi (dibaca live, `:5693`) kosong
  atau tak terukur;
- career dibuang bila posisi tidak punya job profile maupun acuan (`:6058`);
- education dibuang hanya bila **semua** kandidat di child bersumber `none`
  (`:6069–6078`).

Akibatnya, bila induk membuang education karena tak satu pun kandidat bisa
dinilai, lalu kandidat tambahan ternyata punya data pendidikan, **child
mengaktifkan kembali education**. Bobotnya ditarik dari kriteria lain dan semua
koefisien kedekatan kandidat lama bergeser karena alasan yang bukan
penambahan kandidat.

### 3d. Jangkar kalibrasi — **sebagian dari induk, sebagian live**

| Jangkar | Status | Bukti |
|---|---|---|
| L/U kompetensi (technical `simFloor`/`simCeil`) | **live** | `resolveTechnicalAnchors()` dipanggil tanpa melihat induk (`ahp-topsis-engine.ts:5686`); induk menyimpannya di `run_info.technical.simFloor/simCeil` (dibulatkan 4 desimal, `:6678`) tetapi tidak dibaca |
| L/U career (`simFloor`/`simCeil`) | **live** | `resolveCareerAnchors()` (`:5691`); induk menyimpannya di `run_info.career.scale` (`:4309`) tetapi tidak dibaca |
| T_tahun / T_stint (target kedalaman) | **dari induk** bila ada | `pinnedCareerDepth` dibaca dari `careerMatching.targetYears/targetRows` kandidat yang di-reuse (`:5777–5787`); null bila tidak ada kandidat reuse yang menyimpannya → live |
| Pita kalibrasi fallback karier | **dari induk** bila ada | `pinnedCareerCalibration` (`:5795–5803`) |

Jangkar hanya memengaruhi kandidat yang dinilai baru, tetapi itu justru yang
membuat skor kandidat tambahan bisa tidak sebanding dengan kandidat lama.

### 3e. Tanggal acuan peluruhan usia stint (Pers. 2.5) — **live**

`recencyFactor` memakai `Date.now()` (`ahp-topsis-engine.ts:2900–2909`) dan
`stintYears` memakai `new Date()` untuk stint yang masih berjalan
(`:2912–2922`); keduanya dipanggil untuk kandidat yang dinilai baru (`:3919`,
`:4224`). Kandidat tambahan diluruhkan sampai "hari ini", sementara kandidat
lama diluruhkan sampai tanggal induk dihitung. Tanggal acuan induk tidak
disimpan di mana pun; yang tersedia hanya `scoring_runs.created_at` /
`completed_at`.

### 3f. Aturan filter untuk `forceIncluded` kandidat tambahan — **dari induk bila snapshot ada, live bila tidak**

`evaluateAddedAgainstFilters` (`lib/scoring-engine.ts:2786`) memakai
`config_snapshot.template.filterTree` induk (`:2796–2800`); bila induk dibuat
sebelum kolom snapshot, memakai template live dan melaporkan `source:
'live_template'`. Data kandidat yang dinilai tentu data hari ini. Satu
inkonsistensi: bila `programTemplateId` diganti (3g), snapshot child memakai
template baru (`buildDerivedRunConfigSnapshot`, `:528–545`) sedangkan
`forceIncluded` tetap dihitung dengan aturan induk.

### 3g. `programTemplateId` — **bisa diganti saat re-run**

`startRerunAction` menerima `input.programTemplateId` (`lib/scoring-engine.ts:2826, :2861–2864`)
dan UI selalu mengirim template program **posisi** saat ini
(`components/position-run-table-client.tsx:159`), yang bisa berbeda dari
template induk untuk run yang dibuat sebelum drizzle/0056. Bila berbeda:
`syncTemplateCriteriaToPosition` **mengubah baris posisi** sebagai efek samping,
child memakai template lain, dan snapshotnya ditangkap live (`:3117`).
`rerunScoringWithCandidatesAction` (`:1315`) dan `rerunScoringFullPoolAction`
(`:2079`) punya parameter yang sama.

### Ringkasan 3a–3g

| Butir | Status | Bisa dikunci tanpa mengubah data lama / migrasi non-aditif? |
|---|---|---|
| 3a aspek + baseRaw | dari induk (3 lubang) | ya — pool child = id pool induk apa adanya; kandidat lama tidak pernah dinilai ulang |
| 3b matriks + bobot akhir | matriks dibulatkan; bobot akhir live | ya — warisi `run_info.ahp.weights` presisi penuh + himpunan aktif; run lama tanpa `run_info` → fallback live yang ditandai |
| 3c kriteria aktif | live | ya — warisi `run_info.ahp.droppedCriteria/activeCriteria` |
| 3d jangkar | sebagian live | ya — warisi dari `run_info.technical`/`.career` induk; bila tidak ada → `live_fallback` yang ditandai |
| 3e tanggal acuan | live | ya — tanggal acuan dicatat di run baru; untuk induk lama dipakai `scoring_runs.created_at`, ditandai |
| 3f aturan filter | dari induk / live | ya — snapshot induk; tanpa snapshot → fallback live yang ditandai |
| 3g template | bisa diganti | ya — hapus parameter |

**Tidak ada butir yang memerlukan perubahan data lama atau migrasi
non-aditif**, jadi kondisi berhenti kedua juga tidak terpenuhi.

---

## 4. Kandidat yang dipilih sudah ada di pool induk ("1a")

- UI menyembunyikan kandidat yang punya baris `analysis_results` di induk dari
  pencarian (`lib/position-detail-actions.ts:259` → `excludeIds`
  `components/rerun-dialog.tsx:404`), jadi **finalis induk tidak bisa dipilih
  lewat UI**, tetapi kandidat pool non-finalis bisa.
- Server **tidak** menolak finalis maupun anggota pool. Pool digabung tanpa
  duplikasi (`lib/scoring-engine.ts:2884`), kandidat dilaporkan di
  `addedAlreadyInPool` (`:2999`), lalu dikirim sebagai `addedCandidateIds`
  (`:3045`). Di engine, `addedIds` menang atas `reuseAspects`
  (`ahp-topsis-engine.ts:5632`), sehingga kandidat itu **dinilai ulang dengan
  data hari ini** (keenam aspek, termasuk panggilan Gemini untuk education) dan
  dijamin dapat baris hasil (`:6116`). Ini melanggar prinsip pembekuan:
  pool tidak berubah, tetapi skor satu kandidat lama berubah.
- Finalis induk yang dipilih lewat API diperlakukan sama: dinilai ulang dan
  dihitung dua kali dalam `targetFinalists` (`:3023`).

## 5. Penawaran re-run per kondisi induk

| Kondisi induk | Server (`startRerunAction`) | UI |
|---|---|---|
| belum selesai / gagal (`status ≠ completed`; sesi gagal meninggalkan run `in_progress`, `scoring-service/src/runner.ts:126–135`) | **tidak dicek** | tombol "Jalankan Ulang" tampil untuk run apa pun yang terpilih (`components/position-run-table.tsx:404`) |
| metode LLM | mode beku ditolak (`lib/scoring-engine.ts:2855`); `refresh_add`, `finalists_rematch`, `refresh_full` **diterima** | mode beku dinonaktifkan dengan tooltip (`components/rerun-dialog.tsx:379, :674–684`); mode lain tetap bisa |
| tanpa `scoring_run_pool_aspects` | diterima; jatuh ke finalis (`poolSource: 'finalists_only'`, `:2753–2774`) | toast peringatan setelah run dibuat (`rerun-dialog.tsx:548–556`) |
| tenant lain | ditolak (`eq(tenantId)`, `:2847`) | — |

Pengecualian + rerank: `setRunExclusionAction` menolak rerank untuk LLM
(`:1706`) tetapi tidak mengecek status; `createExclusionRerank` jatuh ke
finalis bila tidak ada snapshot (`:1864–1867`).

## 6. Tampilan perbandingan / selisih antar run (UC-13)

- **Panel "Pergeseran Peringkat"** (`components/analysis/rank-shift-panel.tsx`,
  dipasang di `components/position-detail-tabs.tsx:1829`). Isinya per kandidat
  di baris hasil child: peringkat induk → child, Δperingkat, skor 0–100
  (koefisien ×100, dibulatkan) induk → child, readiness induk → child, penanda
  "kandidat baru" / "naik dari pool", ditambah chip ringkasan dan peringatan
  drift. Sumbernya `run_info.augment.shifts` / `run_info.exclude.shifts` yang
  ditulis engine (`ahp-topsis-engine.ts:6495–6517`).
- Batasannya: hanya terhadap **induk langsung**; tidak ada perbandingan ke root;
  tidak ada koefisien kedekatan presisi penuh maupun Δkoefisien; tidak ada
  ideal positif/negatif per kriteria, pembagi normalisasi, atau kalimat
  penjelasan; **tidak bisa membandingkan dua root** dari posisi yang sama
  (panel kosong untuk run root, `:197–199`).
- `getAhpRunDetailAction` (`lib/progress-running-actions.ts:1108`) menghitung
  `predecessor` (run AHP sebelumnya menurut waktu, `:1204–1232`) beserta
  konfigurasi AHP-nya untuk perbandingan berdampingan, tetapi **tidak ada
  komponen yang merendernya** (grep `predecessor` di `components/`, `app/`
  kosong).
- `RunAncestry` (`components/analysis/run-ancestry.tsx`) dan bagian asal-usul di
  `run-configuration-panel.tsx:968` hanya menjelaskan asal run, bukan selisih.

## 7. Penanda pengecualian tanpa rerank

- Disimpan di `scoring_run_exclusions` (`lib/db/schema.ts:825`), ditulis
  `setRunExclusionAction` (`lib/scoring-engine.ts:1660–1680`), dibaca
  `getRunExclusionsAction` (`:1551`) lewat `lib/position-detail-actions.ts:242`.
- Ditampilkan sebagai baris dicoret dengan alasan dan pelaku
  (`components/position-detail-tabs.tsx:1248–1505`) dan ringkasan
  `ExclusionSummaryBar` (`:1213`, `components/exclude-candidate-dialog.tsx:314`).
- **Tidak memengaruhi peringkat**: `rank` dan `final_score` tetap; hanya hitungan
  turunan yang melewatinya (`qualifiedCount`, `lib/position-detail-actions.ts:249`).
- Mode `exclude` lewat dialog re-run **tidak** menulis baris penanda ini, jadi
  run induk tidak menunjukkan siapa yang dikeluarkan dengan cara itu.

## 8. Cache hasil Gemini untuk pendidikan

**Tidak ada cache per (kandidat, jabatan target) di engine AHP.**
`scoreEducationAspect` (`scoring-service/src/ahp-topsis-engine.ts:5120`)
memanggil exact-match deterministik lalu Gemini grounded untuk setiap kandidat
yang dinilai baru. Satu-satunya "pemakaian ulang" adalah reuse aspek pada run
turunan (`loadCachedAspects`). Cache `candidate_aspect_scores` (kunci kandidat ×
posisi × aspek + hash input, `scoring-service/src/scoring-engine.ts:1243–1280`)
hanya dipakai engine AI Tournament (LLM), bukan AHP. Engine dan tabel itu sudah
dihapus (lihat catatan di awal dokumen).

## 9. Audit data (SELECT saja)

**Tidak dapat dijalankan dari lingkungan audit ini**: kontainer sesi tidak punya
`DATABASE_URL`/`POSTGRES_URL` dan tidak ada Postgres yang menjawab di
`localhost:5432`/`5433`. Kuerinya dicatat di sini agar bisa dijalankan apa
adanya (hanya SELECT, aman untuk produksi):

```sql
-- 9.1 Jumlah run per rerun_mode dan per metode
SELECT COALESCE(rerun_mode, '(null)') AS rerun_mode, method, status, COUNT(*) AS runs
  FROM scoring_runs
 GROUP BY 1, 2, 3
 ORDER BY 1, 2, 3;

-- 9.2 Run AHP (selesai) tanpa scoring_run_pool_aspects
SELECT COUNT(*) AS ahp_runs_without_pool_snapshot
  FROM scoring_runs sr
 WHERE sr.method = 'AHP_TOPSIS'
   AND sr.status = 'completed'
   AND NOT EXISTS (SELECT 1 FROM scoring_run_pool_aspects p WHERE p.run_id = sr.id);

-- 9.3 Root yatim: run yang mengaku turunan tetapi induknya tidak ada lagi
--     (FK ON DELETE SET NULL membuat parent_run_id NULL, jadi yatim terlihat
--      sebagai rerun_mode turunan tanpa parent_run_id)
SELECT COUNT(*) AS orphan_roots
  FROM scoring_runs
 WHERE parent_run_id IS NULL
   AND rerun_mode IS NOT NULL
   AND rerun_mode <> 'baseline';
--     … dan induk lintas tenant, yang di pohon run juga tampil sebagai yatim:
SELECT COUNT(*) AS cross_tenant_parent
  FROM scoring_runs c JOIN scoring_runs p ON p.id = c.parent_run_id
 WHERE p.tenant_id <> c.tenant_id;

-- 9.4 Child yang programTemplateId-nya berbeda dari induknya
SELECT COUNT(*) AS child_template_differs
  FROM scoring_runs c JOIN scoring_runs p ON p.id = c.parent_run_id
 WHERE c.program_template_id IS DISTINCT FROM p.program_template_id;
```

### Kueri tambahan Q5–Q8 (audit kebutuhan re-run dan perbandingan run)

Ditambahkan pada sesi audit kebutuhan (`docs/rerun-requirements-audit.md`). Sama
seperti 9.1–9.4, keempatnya **hanya SELECT** dan aman dijalankan di produksi.
Keempatnya sudah diuji sintaksis dan hasilnya terhadap Postgres lokal berisi
fixture `scripts/seed-rerun-fixtures.ts` (bukan terhadap data produksi): Q5, Q7,
dan Q8 mengembalikan 0 baris di sana, dan Q6 menyebut kunci yang memang belum
ditulis run lama.

```sql
-- Q5a Run turunan "Tambah Kandidat Pembanding" yang aspek kandidat
--     `existing_pool`-nya (sudah ada di pool induk, tidak boleh dinilai ulang)
--     berbeda dari induk. Harapan: 0 baris.
SELECT c.id AS child_run_id, c.parent_run_id, pc.candidate_id
  FROM scoring_runs c
  JOIN scoring_run_pool_aspects pc ON pc.run_id = c.id
  JOIN scoring_run_pool_aspects pp ON pp.run_id = c.parent_run_id AND pp.candidate_id = pc.candidate_id
  JOIN LATERAL jsonb_array_elements(c.config_snapshot #> '{rerun,added}') a(item)
       ON a.item->>'candidateId' = pc.candidate_id::text AND a.item->>'classification' = 'existing_pool'
 WHERE c.rerun_mode = 'incremental_add'
   AND pc.aspects IS DISTINCT FROM pp.aspects;

-- Q5b Versi yang lebih ketat: SEMUA kandidat yang ada di pool induk dan pool
--     turunan (dibawa, termasuk existing_pool) wajib beraspek identik.
--     Harapan: 0 baris.
SELECT c.id AS child_run_id, COUNT(*) AS carried_rows_differing
  FROM scoring_runs c
  JOIN scoring_run_pool_aspects pc ON pc.run_id = c.id
  JOIN scoring_run_pool_aspects pp ON pp.run_id = c.parent_run_id AND pp.candidate_id = pc.candidate_id
 WHERE c.rerun_mode = 'incremental_add'
   AND pc.aspects IS DISTINCT FROM pp.aspects
 GROUP BY c.id;

-- Q6 Run AHP+TOPSIS selesai yang belum menyimpan kunci snapshot FR-SN-01
--     tertentu, dikelompokkan per kunci. Run lama memang tidak punya kunci
--     baru; yang dicari adalah run BARU (dibuat setelah perubahan) yang masih
--     muncul di sini. Nilai JSON `null` dihitung sebagai tidak tersimpan:
--     run lama dapat memuat kuncinya dengan isi null.
--     Untuk hanya memeriksa run baru, tambahkan misalnya
--       AND sr.created_at > '<tanggal deploy>'
--     sebelum GROUP BY.
SELECT k.key, COUNT(*) AS runs_missing
  FROM scoring_runs sr
  CROSS JOIN LATERAL (VALUES
    ('config_snapshot.template',          sr.config_snapshot -> 'template'),
    ('config_snapshot.readiness',         sr.config_snapshot -> 'readiness'),
    ('filter_summary',                    sr.filter_summary),
    ('run_info',                          sr.run_info),
    ('run_info.ahp.pairwise',             sr.run_info #> '{ahp,pairwise}'),
    ('run_info.ahp.consistencyRatio',     sr.run_info #> '{ahp,consistencyRatio}'),
    ('run_info.frozen.ahp.weights',       sr.run_info #> '{frozen,ahp,weights}'),
    ('run_info.frozen.anchors.technical', sr.run_info #> '{frozen,anchors,technical}'),
    ('run_info.frozen.anchors.career',    sr.run_info #> '{frozen,anchors,career}'),
    ('run_info.frozen.anchors.depth',     sr.run_info #> '{frozen,anchors,depth}'),
    ('run_info.frozen.referenceDate',     sr.run_info #> '{frozen,referenceDate}'),
    -- Basis posisi tersimpan di dalam basis beku (Fase B), bukan di akar run_info.
    ('run_info.frozen.positionBasis',     sr.run_info #> '{frozen,positionBasis}'),
    ('run_info.frozen.models',            sr.run_info #> '{frozen,models}'),
    ('run_info.positionBasisStatus',      sr.run_info -> 'positionBasisStatus'),
    ('run_info.readiness',                sr.run_info -> 'readiness'),
    ('run_info.dataVersions',             sr.run_info -> 'dataVersions'),
    ('run_info.models',                   sr.run_info -> 'models'),
    ('run_info.timings',                  sr.run_info -> 'timings')
  ) AS k(key, value)
 WHERE sr.status = 'completed'
   AND sr.method = 'AHP_TOPSIS'
   AND COALESCE(jsonb_typeof(k.value), 'null') = 'null'
 GROUP BY k.key
 ORDER BY k.key;

-- Q7 Keputusan forum (`position_picks`) yang merujuk run yang tidak ada, run
--     milik posisi lain, atau kandidat yang tidak ada di pool run itu.
SELECT pp.id AS pick_id, pp.position_id, pp.run_id, pp.candidate_id,
       CASE
         WHEN pp.run_id IS NULL THEN 'keputusan tanpa run (run_id NULL / run terhapus)'
         WHEN sr.id IS NULL THEN 'run tidak ditemukan'
         WHEN sr.position_id <> pp.position_id THEN 'run milik posisi lain'
         ELSE 'kandidat tidak ada di pool run tersebut'
       END AS masalah
  FROM position_picks pp
  LEFT JOIN scoring_runs sr ON sr.id = pp.run_id
 WHERE pp.run_id IS NULL
    OR sr.id IS NULL
    OR sr.position_id <> pp.position_id
    OR (NOT EXISTS (SELECT 1 FROM scoring_run_pool_aspects a
                     WHERE a.run_id = pp.run_id AND a.candidate_id = pp.candidate_id)
        AND NOT EXISTS (SELECT 1 FROM analysis_results r
                         WHERE r.run_id = pp.run_id AND r.candidate_id = pp.candidate_id));

-- Q8 Run turunan yang posisi target atau tenant-nya berbeda dari induknya.
--     Harapan: 0 baris.
SELECT c.id AS child_run_id, c.parent_run_id,
       c.position_id, p.position_id AS parent_position_id,
       c.tenant_id, p.tenant_id AS parent_tenant_id
  FROM scoring_runs c
  JOIN scoring_runs p ON p.id = c.parent_run_id
 WHERE c.position_id <> p.position_id
    OR c.tenant_id <> p.tenant_id;
```

---

## Temuan sampingan

- Komentar `lib/rerun-modes.ts:257–260` menyatakan kunci lama tidak ditulis
  lagi, padahal `rerunScoringWithCandidatesAction` (`ahpAugment`) dan
  `createExclusionRerank` (`ahpExclude`) masih menulisnya (yang pertama tidak
  punya pemanggil).
- `targetFinalists` mode tambah memakai `max(finalis induk + tambahan,
  targetFinalists program)` (`lib/scoring-engine.ts:3023`), jadi untuk induk yang
  finalisnya kurang dari target program, child bisa menampilkan lebih banyak
  finalis daripada "yang Anda punya, ditambah ini".
- `finalistIds` induk dihitung dari `analysis_results` (`:2765`), yang juga
  memuat baris tambahan di bawah garis potong; hitungan "finalis" yang tepat ada
  di `scoring_run_pool_aspects.is_finalist`.

---

## Lampiran A — verifikasi lampiran inventaris (commit `a39a436`)

Setiap klaim lampiran diperiksa terhadap kode di commit `2db9853` (sebelum
perombakan). **Benar** = sesuai kode; **sebagian** = arah benar, rinciannya
perlu dikoreksi; **salah** = bertentangan dengan kode.

| Klaim lampiran | Status | Bukti / koreksi |
|---|---|---|
| Semua root ditulis lewat `startTournamentSessionAction` (`lib/scoring-engine.ts:940`) | benar | `:940` adalah `rerunMode: "baseline"` di dalam fungsi itu (`:726`). |
| A1/A2 — pool: semua unit terpilih, rentang level, pejabat dikeluarkan, lalu filter program | benar | `lib/scoring-engine.ts:756–858`. |
| A2 — "hanya root jenis ini yang bisa punya kelima jenis child" | sebagian | Root AHP dari A3 (`position-bulk-actions.ts:643`) dan A4 (`:875`) juga AHP+TOPSIS, jadi sama-sama bisa punya kelima jenis child. |
| A3 — satu sesi AHP per posisi baru; pool kosong dilaporkan lalu dilewati | benar | `lib/position-bulk-actions.ts:643`. |
| A4 — "Scoring Ulang" program menghasilkan root baru; posisi yang sedang berjalan dilewati | benar | `lib/position-bulk-actions.ts:875`. |
| A5 — run sebelum drizzle/0069: `rerun_mode` kosong dibaca baseline; induknya hanya di jsonb, jadi tampil sebagai root | sebagian | drizzle/0069 mem-*backfill* `parent_run_id` dan `rerun_mode` dari `run_info.{augment,exclude}.baseRunId` bila ada, lalu mengisi `'baseline'` untuk sisanya. Yang tetap root hanya run yang `run_info`-nya tidak ada (sesi terhapus) — dan run "pool penuh" lama, yang tidak pernah mencatat induknya. |
| A6 — induk dihapus → child menjadi root dan pohon run menandainya `orphaned` | **salah** | FK `ON DELETE SET NULL` mengosongkan `parent_run_id`, sedangkan `getRunTreeAction` hanya menandai `orphaned` bila `parent_run_id` berisi id yang tidak ada di baris tenant (`lib/run-tree-actions.ts:141–145`). Child dari induk terhapus tampil sebagai root **tanpa** penanda. (Diperbaiki pada perombakan: `buildRunForest` kini juga menandai run ber-mode turunan yang tidak punya induk.) |
| B — semua child lewat `startRerunAction` plus tiga jalur lama | sebagian | Benar, tetapi `rerunScoringWithCandidatesAction` dan `rerunScoringFullPoolAction` **tidak punya pemanggil sama sekali** (kode mati); hanya `rerunScoringExcludingCandidatesAction` dan `setRunExclusionAction(rerank)` yang dipanggil UI. |
| Tabel B1–B5 (pool, freshness, bobot, metode) | benar | Sesuai `RERUN_MODES` (`lib/rerun-modes.ts:81–188`). |
| B1/B3 menolak induk LLM dengan error | sebagian | Benar untuk `startRerunAction` (`:2855`). Jalur `setRunExclusionAction` tidak melempar error: ia menyimpan penandaan lalu mengembalikan `rerunSkippedReason` (`:1706–1715`). |
| 1a — himpunan alternatif tidak bertambah; peringkat bergerak karena data orang itu dinilai ulang | benar | `addedIds` mengalahkan `reuseAspects` (`ahp-topsis-engine.ts:5632`). |
| 1b — kandidat baru yang gagal filter tetap masuk, dicatat `forceIncluded` (`source: 'added'`) | benar | `lib/scoring-engine.ts:3005–3013`. |
| Kandidat tambahan selalu mendapat baris hasil, ditempel di bawah dengan peringkat pool penuh | benar | `ahp-topsis-engine.ts:6116–6120`, `:6274`. |
| Tanpa `scoring_run_pool_aspects` → pool jatuh ke finalis, `poolSource: 'finalists_only'` | benar | `lib/scoring-engine.ts:2753–2774`. |
| Ganti program: child bisa di bawah program lain, "snapshot-nya ditandai bahwa template berbeda" | sebagian | Program bisa diganti (`:2861–2864`) dan `syncTemplateCriteriaToPosition` ikut mengubah baris posisi. Tetapi tidak ada penanda "template berbeda": snapshot hanya ditangkap live (`templateSource: 'live'`, `:528–545`). |
| B4 menerima `addedCandidateIds` | benar | `lib/scoring-engine.ts:2896`. |
| Ukuran finalis B1/B2 = finalis induk + tambahan | sebagian | Kode memakai `max(finalis induk + tambahan, targetFinalists program)`, dibatasi ukuran pool (`:3020–3023`); bisa lebih besar dari "yang Anda punya, ditambah ini". |
| Ukuran finalis B3 = finalis induk tetap | sebagian | `max(finalis induk, targetFinalists program)` (`:3024–3025`). |
| Ukuran finalis B4 = semua yang ditandingkan; B5 = target program | benar | `:3026–3028`. |
| B6 — penandaan disimpan lebih dulu; re-rank mencakup semua pengecualian; tiga pengecualian satu per satu → tiga child bersaudara | benar | `lib/scoring-engine.ts:1660–1680`, `:1719–1730`. |
| B6 — run LLM hanya penandaan | benar | `:1706–1715`. |
| C — tidak ada batas kedalaman maupun matriks larangan mode | benar | Tidak ada pemeriksaan apa pun atas mode induk selain metode. |
| C — rantai bekuan: "semua nilai di rantai ini berasal dari tanggal root" | sebagian | Hanya keenam aspek dan `baseRaw`. Bobot efektif, kriteria aktif, jangkar teknis/karier, dan tanggal acuan peluruhan stint dibaca live di setiap generasi (lihat butir 3b–3e di atas). |
| C — bobot AHP terkunci sepanjang rantai pewaris | sebagian | Matriksnya disematkan, tetapi dari salinan yang dibulatkan 4 desimal, jadi vektor bobotnya bergeser ~1e-5 dari root; bobot efektifnya bergantung pada kriteria aktif yang dihitung ulang. |
| C — `refresh_full` di tengah rantai memakai matriks live dan menjadi patokan baru | benar | `inheritAhp: false`. |
| C — child induk LLM hanya B2, B4, B5 | benar | `:2855` dan `rerun-dialog.tsx:379`. |
| D — server tidak memeriksa status induk; "belum memastikan apakah UI menawarkannya" | benar; dipastikan | UI menawarkannya: tombol "Jalankan Ulang" tampil untuk run apa pun yang terpilih (`components/position-run-table.tsx:404`). |
| D — semua dikecualikan → ditolak | benar | `:2890–2891`. |
| D — kandidat tambahan di-soft-delete sebelum submit diam-diam keluar | benar | `:2985–2987`. |
| D — rebuild `refresh_full` kosong → error | benar | `:2965–2966`. |
| D — layanan scoring mati → `queued`, diambil orphan sweeper | benar | `notifyScoringService`. |
| D — reset scoring program menghapus seluruh pohon run program itu; dialog tidak dirender | benar | `resetProgramScoringAction`; lihat CLAUDE.md. |
| D — pohon run tidak difilter tanggal/program; node tersaring diredupkan | benar | `lib/run-tree-actions.ts`, `components/analysis/run-tree.tsx`. |

---

## Lampiran B — lampiran inventaris asli (commit `a39a436`)

Disimpan apa adanya sebagai titik awal; koreksinya ada di Lampiran A.

Saya sudah menelusuri lib/rerun-modes.ts, lib/scoring-engine.ts, lib/run-tree-actions.ts dan pemanggilnya. Tidak ada file yang saya ubah. Berikut semua jenis perulangan penilaian yang bisa terjadi, baik sebagai root maupun child.

Model dasarnya

Setiap run punya dua kolom silsilah: parent_run_id dan rerun_mode. Keduanya ditulis oleh web app saat run dibuat, bukan saat selesai. Akibatnya, run yang gagal pun tetap tahu induknya. Run disebut root bila parent_run_id kosong. Run disebut child bila mode-nya salah satu dari lima mode di RERUN_MODES.

Setiap mode dibedakan oleh dua hal:

POOL: siapa saja yang masuk TOPSIS.
FRESHNESS: siapa yang dinilai dari data hari ini.
A. Run sebagai ROOT (rerun_mode = 'baseline')

Semua root ditulis lewat startTournamentSessionAction (lib/scoring-engine.ts:940). Ada enam cara sebuah run menjadi root:

#	Use case	Pemicu	Catatan
A1	Run awal dari wizard, AI Tournament (LLM)	components/scoring/scoring-wizard.tsx	Pool: kandidat semua unit bisnis terpilih, disaring rentang level, pejabat yang sedang menjabat dikeluarkan, lalu filter program.
A2	Run awal dari wizard, AHP+TOPSIS	sama	Sama seperti A1, tetapi metodenya deterministik. Hanya root jenis ini yang nantinya bisa punya kelima jenis child.
A3	Auto-scoring saat tambah massal posisi	lib/position-bulk-actions.ts:643	Satu sesi AHP+TOPSIS per posisi baru. Posisi yang pool-nya kosong dilaporkan lalu dilewati.
A4	“Scoring Ulang” satu program	rescoreProgramPositionsAction, position-bulk-actions.ts:875	Walaupun namanya “ulang”, hasilnya root baru, bukan child. Run lama tidak disentuh dan tidak dijadikan induk. Posisi yang sedang berjalan dilewati.
A5	Run lama sebelum drizzle/0069	data historis	rerun_mode kosong dibaca sebagai baseline oleh rerunSpec(). Hubungannya dengan induk hanya tersisa di runInfo.{augment,exclude}.baseRunId (jsonb), jadi di pohon run ia tampil sebagai root.
A6	Root yatim (orphan)	induknya dihapus	FK bersifat ON DELETE SET NULL. Child tetap ada dan menjadi root, dan pohon run menandainya orphaned. Ini root secara struktur, tetapi mode-nya tetap mode child, misalnya exclude.

Mengulang posisi yang sama lewat wizard juga menghasilkan root baru (A1/A2), bukan child. Child hanya lahir dari aksi “re-run” atas run yang sudah ada.

B. Run sebagai CHILD (lima mode)

Semua child dibuat lewat startRerunAction, plus tiga jalur lama yang masih ada (lihat B6).

#	Mode	Pool	Freshness	Bobot AHP	Metode
B1	incremental_add: Tambah kandidat (inkremental)	pool induk + kandidat yang ditambahkan	dibekukan: keenam aspek kandidat lama diambil dari induk, hanya kandidat tambahan yang dinilai baru	mewarisi matriks induk	khusus AHP
B2	refresh_add: Tambah kandidat + data terbaru	pool induk + kandidat yang ditambahkan	semua dinilai ulang	mewarisi	AHP & LLM
B3	exclude: Kecualikan kandidat	pool induk dikurangi kandidat yang dikecualikan	dibekukan	mewarisi	khusus AHP
B4	finalists_rematch: Tanding ulang finalis	finalis induk saja	semua dinilai ulang	mewarisi	AHP & LLM
B5	refresh_full: Hitung ulang dengan data terbaru	dibangun ulang dari data hari ini dengan filter induk	semua dinilai ulang	memakai matriks live, dengan snapshot konfigurasi live	AHP & LLM

Pada B1 dan B3, run berbasis LLM ditolak dengan error. Alasannya, skor LLM berasal dari stage berpasangan yang tidak bisa diputar ulang untuk sebagian kandidat saja.

Variasi di dalam mode yang memengaruhi hasil:

B1/B2, kandidat yang sudah ada di pool induk (“1a”): himpunan alternatif tidak bertambah. Peringkat hanya bergerak karena data orang itu sendiri dinilai ulang.
B1/B2, kandidat yang benar-benar baru (“1b”): pool melebar dan TOPSIS bergeser. Kalau orang itu gagal filter, ia tetap dimasukkan dan dicatat di filterSummary.forceIncluded (source: 'added').
Kandidat yang ditambahkan selalu mendapat baris hasil, meski peringkatnya di bawah batas finalis. Barisnya ditempel di bawah dengan peringkat pool penuh.
Pool snapshot vs finalis saja: kalau induk tidak punya scoring_run_pool_aspects (run lama), pool jatuh ke finalis induk. Ini dicatat sebagai poolSource: 'finalists_only', dan peringkatnya tidak sebanding dengan induk.
Ganti program saat re-run: programTemplateId boleh diganti. Child bisa berada di bawah program lain dari induknya, dan snapshot-nya ditandai bahwa template berbeda.
B4 boleh menambah kandidat: kode menerima addedCandidateIds pada mode finalis, jadi variasi “finalis + orang tambahan” bisa terjadi.
Ukuran daftar finalis per mode:
B1/B2: jumlah finalis induk + kandidat tambahan.
B3: jumlah finalis induk tetap, kursi kosong diisi dari peringkat N+1.
B4: semua kandidat yang ditandingkan.
B5: target finalis program.
B6. Jalur lama yang masih menulis silsilah
setRunExclusionAction dengan rerank=true meneruskan ke createExclusionRerank dan menghasilkan child exclude.
Baris pengecualian disimpan lebih dulu dan berdiri sendiri. Kalau re-rank gagal, pengecualiannya tetap tersimpan, tetapi tidak ada child.
Re-rank ini selalu mencakup semua pengecualian yang tercatat pada run induk. Mengecualikan tiga orang satu per satu menghasilkan tiga child bersaudara di bawah induk yang sama, dan anak terakhir memuat ketiganya. Hasilnya bukan rantai tiga generasi.
Untuk run LLM, yang terjadi hanya penandaan pengecualian, tanpa child.
rerunScoringExcludingCandidatesAction adalah pemicu manual dengan hasil yang sama.
rerunScoringWithCandidatesAction menghasilkan child incremental_add.
rerunScoringFullPoolAction menghasilkan refresh_add kalau ada kandidat yang ditambahkan, dan refresh_full kalau tidak.
C. Kombinasi bertingkat (child dari child)

Tidak ada batasan kedalaman maupun matriks “mode X tidak boleh di atas mode Y”. Batasan yang ada hanya: base run harus satu tenant dengan pengguna, dan mode beku hanya untuk induk AHP. Jadi semua kombinasi berikut mungkin terjadi:

Rantai bekuan: baseline → incremental_add → exclude → incremental_add …. Aspek dibekukan dari induk langsung, yang aspeknya sendiri dibekukan dari induknya. Nilai mentah ikut terbawa (CachedAspects.baseRaw), sehingga semua nilai di rantai ini berasal dari tanggal root.
Rantai bekuan yang terputus oleh refresh: misalnya … → refresh_add/refresh_full → exclude. Mulai dari node refresh itu, tanggal data berganti, dan child sesudahnya membekukan data tanggal refresh tersebut.
Bobot AHP antar generasi: bobot terkunci sepanjang rantai mode pewaris. refresh_full di tengah rantai memakai matriks live dan menjadi patokan baru bagi turunannya.
Finalis dari finalis: finalists_rematch → finalists_rematch membuat pool makin sempit dan makin tidak sebanding dengan root.
Child dari run berbasis finalis saja: turunan dari B4 atau dari run lama tanpa snapshot pool membawa pool sempit itu terus ke bawah.
Bersaudara: satu induk bisa punya banyak child dengan mode berbeda, misalnya satu exclude dan satu refresh_full. Di pohon run, child diurutkan dari yang terlama.
Child dari induk LLM: hanya B2, B4 dan B5 yang bisa dipilih. Child-nya tetap LLM, dan turunan berikutnya juga terbatas pada tiga mode itu.
D. Kasus tepi
Kasus	Yang terjadi
Re-run atas induk yang belum selesai atau gagal	Server tidak memeriksa status induk. Kalau UI menawarkannya, pool diambil dari scoring_run_pool_aspects/analysis_results yang mungkin kosong. Hasilnya error (“tidak ada finalis”, “tidak ada kandidat aktif”) atau finalists_only. Saya hanya membaca server action, jadi belum memastikan apakah UI memang menawarkannya.
Semua kandidat dikecualikan	Ditolak: “Semua kandidat dikecualikan — tidak ada yang tersisa”.
Kandidat tambahan di-soft-delete sebelum submit	Diam-diam keluar dari pool dan tidak dilaporkan sebagai tambahan.
refresh_full dan pool hasil rebuild kosong	Error “Tidak ada kandidat yang lolos filter”.
Layanan scoring mati saat child dibuat	Baris child tetap tercatat (dispatch.status = 'queued') dan diambil alih oleh orphan sweeper. Di pohon run, child sudah tampil walau belum dinilai.
Hapus induk	Child menjadi root yatim (A6), dan hasil penilaiannya tetap utuh.
Reset scoring program	Seluruh pohon run program itu terhapus, root maupun child. Dialog ini sengaja tidak dirender di UI.
Child berada di tahun atau program lain dari induk	Pohon run sengaja tidak difilter tanggal atau program. Node yang tersaring hanya diredupkan, supaya tidak muncul kesan putus silsilah.
E. Ringkasan cepat
Root (baseline): wizard LLM, wizard AHP, auto-scoring tambah massal, “Scoring Ulang” program, run lama sebelum drizzle/0069, dan root yatim.
Child:
Lima mode: incremental_add, refresh_add, exclude, finalists_rematch, refresh_full.
Variasi di dalamnya: kandidat yang sudah ada vs benar-benar baru, pool snapshot vs finalis saja, ganti program, dan finalis + tambahan.
Bisa bertingkat tanpa batas, bisa bersaudara, dan refresh_* memutus rantai bekuan.
Induk LLM hanya bisa punya child B2, B4 dan B5.
