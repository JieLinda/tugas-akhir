# Audit pemenuhan kebutuhan — "Tambah Kandidat Pembanding" dan Perbandingan Run 1:1

> Catatan (2026-11): tab "Perbandingan Run" yang dirujuk dokumen ini kini bernama **"Komparasi Versi"** (`?tab=komparasi-versi`; tautan lama `?tab=perbandingan-run` tetap dialihkan), berada di bawah tab "Konfigurasi", dan isinya disusun ulang menjadi lima bagian (Ringkasan, Peringkat, Analisis, Konfigurasi & Pool, Keputusan forum). Dokumen ini adalah catatan pada waktunya dan sengaja tidak ditulis ulang.

Dokumen ini memeriksa apakah kode memenuhi setiap kebutuhan §5 prompt sesi
"Audit pemenuhan kebutuhan dan penyempurnaan fitur Tambah Kandidat Pembanding
serta Perbandingan Run 1:1". Statusnya:

- **Terpenuhi**: kode memenuhi pernyataan dan kriteria terimanya.
- **Sebagian**: arahnya benar, tetapi ada bagian kriteria terima yang belum dipenuhi.
- **Belum**: belum ada di kode.
- **Konflik**: bertentangan dengan aturan desain di `CLAUDE.md`.

Kolom **Bukti** menunjuk `file:fungsi` dan nama tes (`TC-…`). Kolom **Rencana**
menyebut fase yang menanganinya.

> **Status dokumen.** §1–§4 adalah **status awal** (Fase A, sebelum perubahan
> apa pun). Status akhir setelah Fase B–E ada di §6, yang diperbarui pada Fase E.
> Fitur Keyakinan Penempatan (MCU) dihapus pada 2026-11-05; penyebutannya di
> §1–§4 menggambarkan keadaan saat itu, dan butir audit yang gugur dicatat di §6.12.
>
> Metode AI Tournament (LLM) dihapus pada 2026-11-17; AHP + TOPSIS kini satu-satunya
> metode, run LLM yang tersimpan dihapus oleh `drizzle/0097_remove_llm_tournament.sql`,
> dan fixture **M1** (run LLM) tidak lagi dibuat `scripts/seed-rerun-fixtures.ts`.
> Penyebutan run LLM, induk LLM, dan M1 di seluruh dokumen ini (termasuk hasil ukur
> di §6) adalah catatan pada waktunya.

---

## 0. Baseline dan lingkungan

### 0.1 Tes dan typecheck (sebelum perubahan, commit `3b6a8e7`)

| Rangkaian | Perintah | Hasil |
|---|---|---|
| Tes web — scoring | `node --import tsx --test tests/scoring/*.test.ts` | 48 tes: 47 lulus, 1 todo, 0 gagal |
| Tes web — job family | `node --import tsx --test tests/job-family/*.test.ts` | 15 lulus |
| Tes web — talent mapping | `node --import tsx --test tests/talent-mapping/*.test.ts` | 64 lulus |
| Tes scoring-service | `cd scoring-service && node --import tsx --test test/*.test.ts` | 172 tes: 169 lulus, 3 todo, 0 gagal |
| `tsc --noEmit` web | `npx tsc --noEmit -p .` | **74 error** — baseline yang tidak boleh bertambah |
| `tsc --noEmit` scoring-service | `cd scoring-service && npx tsc --noEmit` | 0 error |
| `tsc --noEmit` sync-service | `cd sync-service && npx tsc --noEmit` | 20 error, semuanya karena `sync-service/node_modules` tidak terpasang di kontainer ini (`Cannot find module 'mssql'/'express'`, `@types/pg`) |

Angka ini sama dengan baseline yang dilaporkan sesi sebelumnya (47+1 todo, 169+3
todo, 15, 64, tsc web 74, tsc scoring-service 0). Dari 74 error tsc web, 20
berasal dari berkas `sync-service/src/**` yang ikut tercakup `tsconfig.json`
root, dengan sebab yang sama (modul sync-service tidak terpasang).

### 0.2 Database lokal

`DATABASE_URL` tidak ada di lingkungan ini. Database lokal **berhasil
disediakan**:

1. Postgres 16 sudah terpasang di kontainer (cluster `16/main`, berhenti).
   pgvector dipasang lewat paket sistem `postgresql-16-pgvector` (0.6.0).
2. Cluster dinyalakan, role dan database `pulse` dibuat, ekstensi `vector` dan
   `pgcrypto` diaktifkan, `TimeZone` database disetel `Asia/Bangkok` (sama
   dengan produksi, lihat CLAUDE.md § Localization).
3. Ke-91 berkas `drizzle/*.sql` diterapkan berurutan, **termasuk 0086**. Error
   yang muncul hanya "already exists" dari migrasi bernomor ganda yang saling
   menimpa (0007, 0009, 0010, 0015, 0017, 0055), serta 0006-drop yang
   berjalan sebelum tabelnya ada (diulang setelahnya: no-op). Hasilnya 90 tabel,
   dan `scoring_runs` memiliki kolom `rerun_reason`.
4. Fixture diisi dengan skrip baru `scripts/seed-rerun-fixtures.ts`
   (idempoten): satu posisi `FIXTURE IT APPLICATION DEVELOPMENT DEPARTMENT HEAD`
   dengan **R1** (root, bobot bawaan), **C1** (Tambah Kandidat Pembanding dari
   R1: +1 baru, +1 sudah di pool induk), **F1** (turunan R1 yang gagal), **R2**
   (root kedua dengan matriks AHP lain, pool berubah, satu data kandidat
   berubah), **L1** (mode lama `refresh_add`), **O1** (mode lama `exclude`
   yang induknya dihapus), dan **M1** (run LLM). Setiap peringkat dihitung
   dengan `rankCandidatesByTopsis` milik scoring-service, dan basis beku C1
   dengan `resolveFrozenBasis` milik web.

Kueri audit Q5–Q8 (§9 `docs/rerun-modes-inventory.md`) sudah diuji pada
database lokal itu. Database produksi tetap tidak terjangkau dari sini (G-9).

---

## 1. Status per kebutuhan — status awal (Fase A)

### A. Eksekusi re-run (FR-RR)

| ID | Prio | Status | Bukti | Catatan | Rencana |
|---|---|---|---|---|---|
| FR-RR-01 Titik masuk | WAJIB | Sebagian | `lib/rerun-freeze.ts:validateRerunRequest`, `lib/scoring-engine.ts:getRerunPreviewAction`, `components/position-run-table.tsx` ("… tidak tersedia: {reason}"); TC-RRF-06 | Alasan spesifik sudah ada untuk run belum selesai, run LLM, dan run tanpa snapshot pool. Kekurangannya: (1) tombol **disembunyikan**, tidak dinonaktifkan (yang tampil teks); (2) bila aksi pratinjau melempar galat (mis. kolom 0086 belum ada), UI menampilkan "Status run tidak dapat diperiksa." yang tidak menyebut penyebabnya; (3) pratinjau dan aksi kirim membaca seluruh baris `scoring_runs`, sehingga keduanya galat di database yang belum menerapkan 0086. | B (kebal kolom), D (tombol nonaktif) |
| FR-RR-02 Pemilihan lintas unit | WAJIB | Sebagian | `lib/scoring-engine.ts:searchAddableCandidatesAction`, `components/rerun-dialog.tsx` | Pencarian hanya mencocokkan nama, jabatan, dan departemen — **tidak** NPK. Baris hasil tidak menampilkan grade maupun rumpun jabatan. Pencarian tidak dibatasi divisi (sesuai kebutuhan), tetapi juga **tidak dibatasi tenant**: `tenantId` kosong berarti seluruh business unit (lihat NFR-RR-07). Pilih banyak sekaligus: ada. | B (aksi), D (tampilan) |
| FR-RR-03 Pratinjau = server | WAJIB | Sebagian | `getRerunCandidateStatusesAction` vs `startRerunAction` + `classifyAddedCandidates` | Pratinjau memakai pembantu yang sama (`loadParentPool`, `incumbentMatcher`, `evaluateAgainstParentRules`), tetapi **klasifikasinya ditulis ulang** di loop tersendiri, bukan memanggil fungsi klasifikasi server. Status "perlu konfirmasi (Excluded)" dan "ditolak karena aturan Rejected" belum ada, karena server sendiri belum membedakannya (FR-RR-05). Belum ada tes yang membandingkan pratinjau dengan hasil server. | B |
| FR-RR-04 Alasan wajib | WAJIB | Sebagian | `validateRerunRequest` (trim, wajib); `scoring_runs.rerun_reason` (drizzle/0086); pohon run dan breadcrumb menampilkannya | Belum ada batas 1.000 karakter, baik di klien maupun di server. Alasan belum tampil di halaman perbandingan (halamannya belum ada). | B, D |
| FR-RR-05 Rejected / Excluded / Reconsidered | WAJIB | **Belum** | `startRerunAction` → `evaluateAgainstParentRules` → `forceIncluded` | Perilaku sekarang: kandidat baru yang gagal aturan **apa pun** dari induk (disiplin, PA, HAV, BA, grade, unit) **tetap ditambahkan** dan dicatat di `forceIncluded`. Ini berbeda dari keputusan bawaan: Rejected harus ditolak (`skipped` beserta aturannya); Excluded (grade) baru boleh masuk setelah konfirmasi per kandidat; Reconsidered (MCU advisory) ikut dinilai. Ini **perubahan perilaku**, bukan konflik: bagian "aturan desain" CLAUDE.md tidak mengatur hal ini, dan kalimat deskriptif CLAUDE.md tentang `forceIncluded` diperbarui di Fase E. | B |
| FR-RR-06 Daftar yang dibekukan | WAJIB | Sebagian | `lib/rerun-freeze.ts:resolveFrozenBasis`, `deriveChildSnapshot`; `scoring-service/src/rerun-freeze.ts:planFrozenRerun`, `frozenWeights`, `frozenDroppedCriteria`, `buildFrozenRecord`; TC-RRF-01, -01b, -02, -03, -04, -08, TC-REF-01 | **Beku**: program, posisi, rentang level, aturan filter, vektor bobot presisi penuh, kriteria aktif, jangkar teknis dan karier, target kedalaman, tanggal acuan, serta enam aspek dan `baseRaw`. **Belum beku**: (1) CR/λmax turunan dihitung ulang dari matriks induk yang **dibulatkan 4 desimal** (`resolveAhpWeights(…, frozen.ahp.pairwise)`), sehingga CR turunan bisa berbeda ~1e-5 dari induk; (2) label readiness ditulis engine dengan ambang **live** (`determineReadiness`), padahal snapshot turunan mewarisi ambang induk; (3) faktor keyakinan MCU kandidat lama tidak diwarisi, karena dinilai per (run, kandidat) dan run turunan mulai tanpa penilaian (butir ini gugur 2026-11-05 bersama fiturnya, §6.12); (4) ID model tidak dicatat dan tidak dibekukan, kecuali model narasi. "Penanda skor sementara" tidak ada sebagai konsep di kode (lihat §2 temuan 9). | B |
| FR-RR-07 Basis posisi kandidat baru | WAJIB | **Belum** | `ahp-topsis-engine.ts:runAhpTopsisSession` → `findJobProfileForPosition`, `resolveTargetRequiredSet`, `incumbentEducationRequirement`, `scoreCareerAspect` (`findMatchedJobProfileId`, `embedPseudoProfile`) | Kandidat baru di turunan dinilai terhadap job profile, acuan kompetensi, syarat pendidikan, dan vektor dokumen target **hari ini**. Perubahannya hanya dilaporkan di `runInfo.rerun.positionBasis` (nama job profile, sumber dan jumlah acuan). Fallback karier memakai pemegang posisi yang aktif **hari ini** (G-7). Penelusuran menunjukkan semua titik itu adalah **masukan** fungsi penilaian (`targetRequired`, `jobProfile`, `targetVec`, `targetStatedExperience`, persyaratan pendidikan), sehingga pembekuannya cukup mengganti sumber masukan **tanpa** mengubah rumus atau pipeline embedding. Kondisi berhenti §8 tidak terpicu. | B |
| FR-RR-08 Kandidat existing_pool | WAJIB | Terpenuhi | `planFrozenRerun` (kandidat yang bukan "new" selalu dibawa); `assembleAspectScores`; TC-RRF-02, TC-RRF-05 | Kesamaan per aspek dengan toleransi 0 sudah diuji (TC-RRF-02 untuk semua kandidat yang dibawa, TC-RRF-05 untuk permintaan yang hanya berisi existing_pool). Kueri Q5a/Q5b ditambahkan ke inventaris §9. | — |
| FR-RR-09 Isi daftar hasil turunan | WAJIB | **Belum** | `lib/rerun-freeze.ts:childFinalistTarget` (= finalis induk + jumlah diterima); `ahp-topsis-engine.ts` (`cutoff` + `appended`) | Rumus sekarang **memunculkan kandidat yang tidak diminta**: N naik sebesar k, jadi kandidat peringkat N+1…N+k induk ikut tampil hanya karena kuota bertambah. Rumus ini juga **tidak menjamin** finalis induk tetap terlihat. TOPSIS relatif terhadap himpunan, jadi peringkat sesama kandidat lama bisa bertukar (rank reversal), dan finalis induk bisa jatuh di bawah N+k tanpa diminta siapa pun. Kandidat tambahan tidak pernah terpotong, karena selalu ditempel di bawah garis. | B |
| FR-RR-10 Kandidat ditolak tersimpan | WAJIB | Sebagian | `config_snapshot.rerun.skipped` (`RunRerunSnapshot`); `StartRerunResult.skipped`; TC-RRF-07 | Sudah tersimpan di run turunan, tetapi **tidak ditampilkan** di header run turunan. Saat ini hanya muncul di respons aksi. | D |
| FR-RR-11 Setelah dikirim | SEBAIKNYA | Sebagian | `components/position-run-table-client.tsx` (`router.push(?runId=)`) | Pengguna sudah diarahkan ke run turunan, tetapi perbandingan dengan induk tidak terbuka otomatis. Status bertahap juga belum ada, padahal engine sudah mencatat `ahpProgress` per fase. | D |
| FR-RR-12 Kegagalan | WAJIB | **Belum** | `scoring-service/src/runner.ts:processLoop` (catch), `cancelSessionProcessing`; `parseRerunSpec` (TC-RRF-09 untuk penolakan mode lama) | Turunan yang gagal memang tidak mengubah induk. Masalahnya ada dua. (1) Bila engine melempar galat, hanya `tournament_sessions.status` yang menjadi `failed`; baris `scoring_runs` **tetap `in_progress` selamanya**, dan pesan galatnya hanya tercetak di log. Akibatnya pohon run menampilkannya "berjalan" dan tidak pernah "gagal". (2) `cancelSessionProcessing` menulis `scoring_runs.status = 'failed'`, padahal **constraint `scoring_runs_status_check` tidak mengizinkan `failed`**. Pernyataan itu selalu galat (dibuktikan di DB lokal). Penolakan sesi mode lama sudah jelas pesannya (TC-RRF-09). | B |
| FR-RR-13 Pengiriman ganda | SEBAIKNYA | Belum | `startRerunAction` | Tidak ada kunci idempoten. Dua klik membuat dua turunan. | B |
| FR-RR-14 Narasi model bahasa | WAJIB | Sebagian | `ahp-topsis-engine.ts` (`runAhpNarrativeAgent` hanya dipanggil saat run dihitung; disimpan di `analysis_results.details`); `run_info.narrative.model`; `lib/run-diff.ts` (kalimat dari angka) | Narasi sudah disimpan per run dan tidak dibuat ulang saat dibuka, dan kalimat selisih tidak memakainya. Yang belum: label "Narasi model bahasa, tidak memengaruhi angka" di UI (kotak "Insight" tidak menyebutnya). | D |
| FR-RR-15 Run lama | WAJIB | Sebagian | `lib/rerun-modes.ts:rerunSpec`, `LEGACY_RERUN_MODES`; `lib/run-tree.ts:buildRunForest`; TC-RRF-09, TC-RRN-01 | Run lama dapat dibuka dan tampil di pohon dengan badge "mode lama", tetapi **nama modenya tidak disebut** ("Mode lama: <nama mode>"). Run lama belum dapat dibandingkan dengan run sembarang (perbandingannya belum ada). Run lama yang punya snapshot pool sudah dapat menjadi induk, karena validator tidak memeriksa mode. | D |

### B. Snapshot konfigurasi (FR-SN)

| ID | Prio | Status | Bukti | Catatan | Rencana |
|---|---|---|---|---|---|
| FR-SN-01 Isi snapshot minimum | WAJIB | Sebagian | `RunConfigSnapshot` (`lib/db/schema.ts`), `run_info` dari engine, `filter_summary`; Q6 | **Ada**: identitas (kolom run), pool, hasil penyaringan per karyawan (`filter_summary.disqualified`), `forceIncluded`, aturan filter dan rentang grade, matriks pairwise presisi penuh (`run_info.frozen.ahp.pairwise`, sejak sesi lalu), CR, sumber bobot, bobot nominal presisi penuh, kriteria aktif dan alasan kriteria yang dibuang, bobot efektif, jangkar L/U, T_tahun dan sumbernya, T_stint, tanggal acuan, ambang readiness, jumlah finalis, dan model narasi. **Belum ada**: durasi per tahap (`timings`), basis posisi (FR-RR-07), versi data (waktu sinkronisasi per sumber, versi korpus job profile, versi kamus), ID model embedding, pendidikan, dan MCU, serta penanda bahwa matriks terbaru ditolak karena CR. Untuk yang terakhir, penolakan terjadi **saat disimpan** di Tata Kelola (`lib/program-actions.ts`, CR > 0,1 ditolak), bukan saat run berjalan; run hanya mencatat `inconsistent`. Belum ada tes yang memeriksa semua kunci. | B |
| FR-SN-02 Panel Konfigurasi run | WAJIB | Sebagian | `components/analysis/run-configuration-panel.tsx`, `lib/progress-running-actions.ts:getRunConfigurationAction` | Panelnya luas: matriks 6×6, CR/λmax/CI/RI, sumber bobot, jangkar beserta sumbernya, dan label `live-fallback` untuk template. Yang belum: penanda asal per butir dengan kosakata I-3, frasa "Tidak tersimpan pada run ini" yang seragam untuk butir yang hilang, bobot dua desimal dengan rincian enam desimal, serta butir-butir FR-SN-01 yang belum tersimpan. | B (data), D |
| FR-SN-03 Unduh snapshot mentah | SEBAIKNYA | Belum | — | Tidak ada tombol unduh JSON. | D |
| FR-SN-04 Label readiness dari snapshot | WAJIB | Sebagian | `analysis_results.details.readiness` ditulis per baris oleh engine; `lib/pulse-data.ts:readinessFromScore` (5 pemanggil) | Label per baris **tersimpan**, tetapi: (1) engine menghitungnya dengan ambang **live** saat itu, bukan ambang snapshot run, jadi pada turunan ambangnya bukan ambang induk; (2) beberapa pembaca **menghitung ulang dari skor dengan ambang live** — `getReadinessStatsByPosition`, statistik daftar posisi, dan pratinjau kandidat teratas (`lib/pulse-data.ts`) — sehingga mengubah ambang di Tata Kelola mengubah label run lama di layar itu. Belum ada tes. | B |
| FR-SN-05 Kekekalan | WAJIB | Belum | — | Tidak ada guard di lapisan data. Jalur yang menulis ke run berstatus `completed`: (1) engine sendiri menulis `run_info` dan mengisi `config_snapshot.rerun.frozen` **sesudah** `status = 'completed'`; (2) `analysis_results.manual_rank` (urutan seri manual; kolom penanda manusia, bukan angka hasil). Belum ditemukan jalur yang mengubah `final_score`, `rank`, `details`, `scoring_run_pool_aspects`, atau `config_snapshot` run selesai dari web app. | B |
| FR-SN-06 Kontribusi kriteria satu run | WAJIB | Belum | `components/analysis/aspect-derivations.tsx` (D⁺/D⁻ hanya untuk aspek PA) | Rincian TOPSIS akhir per kandidat (nilai ternormalisasi, nilai terbobot, sumbangan per kriteria ke D⁺/D⁻) belum ada di halaman run. | C (hitung), D |

### C. Riwayat dan pohon run (FR-RH)

| ID | Prio | Status | Bukti | Catatan | Rencana |
|---|---|---|---|---|---|
| FR-RH-01 Halaman riwayat posisi | WAJIB | Sebagian | `lib/run-tree-actions.ts:getRunTreeAction`, `lib/run-tree.ts`, `components/analysis/run-tree.tsx` ("Silsilah") | Pohon lengkap per posisi dengan banyak root, run lama, alasan (dipotong dua baris), dan penanda yatim. Belum ada: pembuat, jumlah kandidat tambahan, status "gagal" yang benar (lihat FR-RR-12), serta badge Di luar rentang grade, Nilai hari ini, Skor sementara, Ada keputusan forum, dan "Mode lama: <nama>". | B (data), D |
| FR-RH-02 Induk dihapus | WAJIB | Terpenuhi | `lib/run-tree.ts:buildRunForest` (mode turunan tanpa induk = `orphaned`); TC-RRF-09 | Diperbaiki sesi lalu (temuan A6). | — |
| FR-RH-03 Memilih dua run | WAJIB | Belum | `components/analysis/rank-shift-panel.tsx` (induk/root saja) | Belum ada pemilih dua run dan pintasan "run sebelumnya". | C, D |
| FR-RH-04 Penilaian baru konfigurasi baru | WAJIB | Belum | Wizard scoring dan "Scoring Ulang" program ada di tempat lain | Belum ada aksi dari halaman riwayat posisi, maupun tawaran membandingkan dengan root sebelumnya. | D |

### D. Perbandingan 1:1 (FR-CMP)

| ID | Prio | Status | Bukti | Catatan | Rencana |
|---|---|---|---|---|---|
| FR-CMP-01 Dua run mana pun | WAJIB | Belum | `lib/run-diff-actions.ts:getRunDiffAction(runId, 'parent'\|'root')` | Hanya pasangan induk/root. Belum ada pemilih A/B, tombol tukar, maupun penolakan posisi berbeda di server. | C, D |
| FR-CMP-02 Hubungan A dan B | WAJIB | Belum | — | — | C |
| FR-CMP-03 Ringkasan sumber S1–S5 | WAJIB | Belum | — | — | C |
| FR-CMP-04 Perbandingan konfigurasi | WAJIB | Belum | — | — | C, D |
| FR-CMP-05 Keanggotaan pool | WAJIB | Belum | `lib/run-diff.ts:diffRuns` (menandai kandidat "baru" saja) | — | C |
| FR-CMP-06 Peringkat dan skor | WAJIB | Sebagian | `lib/run-diff.ts:diffRuns`, `components/analysis/rank-shift-panel.tsx` | Sudah ada peringkat dan kedekatan sebelum → sesudah dengan Δ, untuk induk/root. Belum ada: status keanggotaan, skor setelah faktor MCU, status finalis A/B, label readiness A/B, keputusan forum, penanda, saringan, serta format "▲2 (naik)". | C, D |
| FR-CMP-07 Per kriteria | WAJIB | Sebagian | `lib/run-diff.ts:topsisBreakdown` (pembagi, ideal +/− dan pemegangnya) | Sudah ada untuk induk/root. Normalisasinya **vektor** (`sqrt(Σx²)`, `scoring-service/src/topsis.ts:topsisRank`), jadi istilah "pembagi normalisasi" tepat. **Pelanggaran I-7**: `topsisBreakdown` adalah **salinan** rumus TOPSIS (komentarnya menulis "MIRRORS topsisRank"; TC-RDF-01 menguji kesamaan bitnya). Harus diganti dengan fungsi scoring-service. | C |
| FR-CMP-08 Rincian kandidat A vs B | WAJIB | Belum | — | — | C, D |
| FR-CMP-09 Kalimat deterministik | WAJIB | Sebagian | `lib/run-diff.ts:explainDiff`; TC-RDF-02 | Satu kalimat templat (setara T-02/T-03/T-04 untuk induk–turunan). Katalog T-01…T-11 dan ambang penyebutan belum ada. | C |
| FR-CMP-10 Atribusi bertahap | SEBAIKNYA | Belum | — | — | C |
| FR-CMP-11 Tautan perbandingan | SEBAIKNYA | Belum | — | — | D |
| FR-CMP-12 Ekspor XLSX | WAJIB | Belum | Mekanisme ekspor yang ada: `xlsx` (SheetJS 0.18) lewat `await import('xlsx')` di browser — `lib/analysis-export.ts`, `lib/chat-export.ts`, `lib/job-family-export.ts` | Ekspor perbandingan akan memakai mekanisme yang sama. | D |
| FR-CMP-13 Tanpa hitung ulang aspek | WAJIB | Terpenuhi (untuk panel yang ada) | `lib/run-diff-actions.ts` hanya membaca `scoring_run_pool_aspects` dan `run_info` | Halaman perbandingan baru harus mempertahankannya. | C |

### E. Penandaan pengecualian (FR-MRK)

| ID | Prio | Status | Bukti | Catatan | Rencana |
|---|---|---|---|---|---|
| FR-MRK-01 Penandaan tanpa mengubah angka | WAJIB | Sebagian | `lib/scoring-engine.ts:setRunExclusionAction` (alasan berkode, keterangan wajib untuk "Lainnya", pelaku dan waktu di `scoring_run_exclusions` + `audit_log`, batal = hapus baris + audit) | Angka tidak berubah. Penandaan belum tampil di halaman perbandingan. | C, D |
| FR-MRK-02 Istilah | WAJIB | **Belum** | `components/position-detail-tabs.tsx` (tooltip), `components/exclude-candidate-dialog.tsx` | Label UI masih "tidak dipertimbangkan". Tooltip tombol pada run AHP **masih menjanjikan** "lalu hitung ulang peringkat sebagai run baru", padahal jalur itu sudah dihapus. Audit kode: `setRunExclusionAction` tidak lagi membuat run (tidak ada `insert(scoringRuns)`/`tournamentSessions` di dalamnya). | D |
| FR-MRK-03 Konfirmasi memilih kandidat ditandai | SEBAIKNYA | Belum | — | — | D |

### F. Keputusan forum (FR-DEC)

| ID | Prio | Status | Bukti | Catatan | Rencana |
|---|---|---|---|---|---|
| FR-DEC-01 Keputusan melekat pada run | WAJIB | Sebagian | `lib/position-pick-actions.ts:savePositionPickAction` (`run_id`, `notes`) | `run_id` tersimpan. **Justifikasi (`notes`) tidak wajib.** Keputusan belum tampil sebagai badge di pohon run maupun di perbandingan. `savePositionPickAction` dan `updatePickNotesAction` **tidak memeriksa tenant** posisi/pick, dan perubahan justifikasi lewat `updatePickNotesAction` tidak tercatat di audit. | B, D |
| FR-DEC-02 Rekomendasi vs keputusan | WAJIB | Belum | — | — | C (data), D |
| FR-DEC-03 Pejabat tidak dapat dipilih | SEBAIKNYA | Belum | `savePositionPickAction` | Tidak ada pemeriksaan pejabat. Pejabat memang tidak masuk pool scoring, tetapi aksi simpan tidak menolaknya bila dipanggil langsung. | B |

### G. Non-fungsional (NFR-RR)

| ID | Prio | Status | Bukti | Catatan | Rencana |
|---|---|---|---|---|---|
| NFR-RR-01 Keterulangan dari data tersimpan | WAJIB | Belum | TC-RDF-01 (hanya kesamaan salinan rumus) | Belum ada `verifyRunReproducibility` maupun skrip. Kedekatan tersimpan di `scoring_run_pool_aspects.closeness` dan `analysis_results.final_score` berpresisi `numeric(10,6)`, jadi replay dibandingkan pada presisi itu. Untuk run baru, kedekatan presisi penuh ikut disimpan. | B (simpan presisi penuh), C |
| NFR-RR-02 Determinisme re-run | WAJIB | Sebagian | TC-RRF-01, -05, -08 | Kandidat lama identik. Belum ada tes eksplisit "dua turunan dari induk yang sama dengan kandidat tambahan yang sama → angka identik" dengan panggilan model bahasa di-mock. | B |
| NFR-RR-03 Kekekalan | WAJIB | Belum | — | Lihat FR-SN-05. | B |
| NFR-RR-04 Keterjelasan | WAJIB | Sebagian | `lib/run-diff.ts:topsisBreakdown` | Angka di panel selisih dapat diurai ke ideal dan pembagi. Rincian per kandidat belum ada. | C, D |
| NFR-RR-05 Responsivitas (pengukuran) | WAJIB | Belum | — | `run_info.timings` belum ada. Narasi berjalan **sebelum** penulisan hasil, jadi peringkat menunggu narasi selesai. | B |
| NFR-RR-06 Kompatibilitas mundur | WAJIB | Sebagian | `lib/run-tree-actions.ts` (`to_jsonb(sr)->>'rerun_reason'`), `rerunSpec()` untuk mode lama, `resolveFrozenBasis` membaca `run_info` lama | Run lama tetap terbaca. Aksi pratinjau dan kirim re-run memakai `select()` penuh, sehingga galat di database tanpa 0086 (pesan "Status run tidak dapat diperiksa."). | B |
| NFR-RR-07 Isolasi tenant | WAJIB | Sebagian | Run tree, pratinjau, kirim, dan selisih memfilter `tenant_id` | Pencarian kandidat pembanding tidak memfilter tenant, dan `savePositionPickAction` tidak memeriksa tenant posisi. Belum ada tes lintas tenant. | B |
| NFR-RR-08 Jejak audit | WAJIB | Sebagian | `startRerunAction` → `logAudit` (pelaku, waktu, alasan); `setRunExclusionAction` → `logAudit`; `position_picks.created_by` | Perubahan justifikasi keputusan (`updatePickNotesAction`) tidak diaudit, dan alasan penghapusan pick tidak diminta. | B |
| NFR-RR-09 Keterbacaan | WAJIB | Sebagian | — | Beberapa istilah teknis masih tampil (mis. "tidak dipertimbangkan", angka Δ tanpa panah teks). Lihat §6 prompt. | D |

---

## 2. Temuan utama (dijelaskan)

1. **Run gagal tidak pernah tampil gagal (FR-RR-12).** `processLoop` hanya
   menandai sesi `failed`. Run tetap `in_progress`, tanpa pesan. Jalur batal
   menulis `status='failed'` yang ditolak constraint, sehingga **jalur batal
   sendiri galat**. Constraint itu hanya menerima `draft/in_progress/completed/
   archived`. Perbaikan yang aman tanpa migrasi non-aditif: catat kegagalan di
   `run_info.failure` (jsonb, aditif) dan biarkan pembaca menurunkan status
   tampilan "gagal" dari situ, atau dari sesi yang `failed`.
2. **Rumus TOPSIS disalin (I-7).** `lib/run-diff.ts:topsisBreakdown` menyalin
   `topsisRank` + `rankCandidatesByTopsis`. Build context web
   (`.dockerignore`) mengecualikan `scoring-service/`, jadi web app tidak bisa
   mengimpor modul scoring-service begitu saja. Pilihan berisiko terkecil
   dibahas di Fase C.
3. **Engine menulis ke run yang sudah `completed` (I-1).** `status='completed'`
   ditulis sebelum `run_info` dan sebelum pengisian
   `config_snapshot.rerun.frozen`. Guard kekekalan di lapisan data hanya
   mungkin dipasang setelah urutan itu dibalik: semua tulisan selesai dulu,
   status `completed` paling akhir.
4. **Readiness live (FR-SN-04, G-5).** Lihat tabel. Dampaknya: mengubah
   ambang di Tata Kelola mengubah hitungan "siap" untuk run yang sudah selesai
   di daftar posisi dan statistik.
5. **Kandidat Rejected dapat masuk (FR-RR-05).** Lihat tabel. Ini
   perubahan perilaku yang dicatat di laporan akhir.
6. **Daftar hasil turunan (FR-RR-09).** Lihat tabel.
7. **CR turunan dihitung ulang dari matriks bulat (FR-RR-06).** Bobotnya sudah
   presisi penuh, tetapi CR/λmax/CI turunan berasal dari matriks 4 desimal. Bila
   induk mencatat matriks presisi penuh (sejak sesi lalu), CR-nya identik. Bila
   induknya run lama, CR-nya bisa bergeser. Rencana: catat CR/λmax/CI induk di
   basis beku dan pakai itu.
8. **Keputusan forum (FR-DEC).** Justifikasi tidak wajib, tenant tidak
   diperiksa, perubahan justifikasi tidak diaudit, dan pejabat tidak ditolak.
9. **"Skor sementara" tidak ada sebagai konsep.** Satu-satunya keadaan di kode
   yang angkanya **bukan pengukuran** adalah kolom terenkripsi yang tidak
   terbaca: engine mencatatnya di `run_info.encryption`, dan empat aspek
   menjadi konstanta. Rencana: tandai baris seperti itu `provisional` (per
   kandidat), tampilkan sebagai "Skor sementara", dan jadikan S4. Penanda ini
   **tidak** mengubah angka. (Faktor MCU yang semula direncanakan ikut di S4
   sudah dihapus: data MCU tidak boleh menghitung ulang skor dalam bentuk apa
   pun.)
10. **Narasi menahan peringkat (NFR-RR-05).** Narasi LLM dijalankan sebelum
    hasil ditulis. Rencana Fase B: tulis peringkat dan pool lebih dulu, baru
    narasi; catat durasi tiap tahap.
11. **Pencarian kandidat lintas tenant (NFR-RR-07).** `searchAddableCandidatesAction`
    tanpa `tenantId` mengembalikan kandidat dari semua business unit. Untuk re-run,
    pencarian akan dibatasi ke business unit yang dicakup run induk
    (`filter_summary.includedTenantIds`, atau tenant run bila kosong). Ini konsisten
    dengan prinsip "turunan identik dengan induk kecuali himpunan kandidat",
    karena cakupan unit adalah bagian dari aturan induk.

## 3. Konflik dengan `CLAUDE.md`

Tidak ditemukan kebutuhan yang bertentangan dengan **aturan desain re-run**
(bagian "Re-run scoring — aturan desain"). Ada dua catatan:

- **FR-RR-05 dan FR-RR-09 mengubah perilaku yang DIDESKRIPSIKAN di CLAUDE.md**
  (bagian deskriptif "Adding candidates to a finished run …": kandidat baru yang
  gagal aturan tetap ditambahkan, dan garis finalis turunan = finalis induk +
  kandidat diterima). Itu deskripsi implementasi, bukan aturan desain. Prompt
  menandai keduanya sebagai keputusan bawaan, jadi keduanya ditangani sebagai
  perubahan perilaku, dan teks CLAUDE.md diperbarui di Fase E.
- **I-1 dan `analysis_results.manual_rank`.** I-1 meminta catatan manusia
  disimpan di tabel terpisah. Urutan seri manual (didokumentasikan di CLAUDE.md
  sebagai "recorded manual tie-order control") justru kolom di baris hasil.
  Kolom itu bukan "angka hasil": `rank` dan `final_score` tidak berubah.
  Memindahkannya ke tabel lain akan menuntut migrasi data, jadi guard kekekalan
  sengaja **mengizinkan** kolom itu saja, dan hal ini dicatat.

## 4. Rencana tata letak

### L-1 Riwayat posisi (di halaman posisi, tab Scoring / Silsilah)

```
┌─ Riwayat penilaian — FIXTURE IT APPLICATION DEVELOPMENT DEPARTMENT HEAD ────────────────┐
│ [Penilaian baru (konfigurasi hari ini)]  [Tambah Kandidat Pembanding]  [Bandingkan (0/2)] │
│                                                                                           │
│ ☐ ● R2  Root · 2026-10-01 · System User · Selesai · 13 kandidat · Ada keputusan forum     │
│ ☐ ● R1  Root · 2026-09-01 · System User · Selesai · 12 kandidat · Ada keputusan forum     │
│ │   ├ ☐ ◐ C1  Tambah Kandidat Pembanding · 2026-09-15 · +2 kandidat · Di luar rentang …    │
│ │   │       "Forum Talent Committee 2026-09-15: Kepala Divisi meminta …" [selengkapnya]   │
│ │   │       [Bandingkan dengan induk] [Bandingkan dengan root] [… run sebelumnya]          │
│ │   ├ ☐ ✕ F1  Tambah Kandidat Pembanding · Gagal: "Run induk tidak menyimpan skor …"      │
│ │   └ ☐ ◌ L1  Mode lama: Tambah + data terbaru · 2026-09-05                                │
│ ☐ ● O1  Mode lama: Kecualikan · Induk dihapus                                             │
│ ☐ ○ M1  AI Tournament (LLM) · tidak dapat dibandingkan secara terstruktur                 │
├───────────────────────────────────────────────────────────────────────────────────────────┤
│ Rekomendasi sistem vs keputusan forum                                                     │
│  Run dasar keputusan: R1 · 2026-09-01                                                     │
│  #1 Budi Santoso   82,4%   │  Keputusan forum: Andi Pratama (peringkat 2)                  │
│  #2 Andi Pratama   80,1%   │  ⚠ Alasan berbeda dari rekomendasi:                           │
│  #3 …                      │    "Forum TC 2026-09-10: dipilih karena …"                    │
└───────────────────────────────────────────────────────────────────────────────────────────┘
```

### L-4 Perbandingan dua run

```
┌─ Perbandingan run ──────────────────────────────────────────────────────────── [Ekspor XLSX] ┐
│ A (pembanding): [R1 · 2026-09-01 ▾]   ⇄   B (dibandingkan): [C1 · 2026-09-15 ▾]                │
│ Hubungan: B turunan langsung A · Jalur: R1 → C1 · Alasan B: "Forum Talent Committee …"         │
├────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Sumber perubahan                                                                               │
│  Perubahan data atau himpunan            │  Perubahan konfigurasi atau pertimbangan            │
│   S1 Pool: Berbeda — +1 kandidat, −0     │   S2 Bobot & kriteria aktif: Sama                   │
│   S3 Nilai aspek: Sama                   │   S5 Aturan, ambang, jumlah finalis: Sama           │
│   S4 Penanda skor sementara: Sama                                                              │
│  Ringkasan: "Peringkat Budi turun dari 1 ke 2. Sari, kandidat pembanding, kini memegang …"     │
├────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Pergeseran peringkat finalis (slope chart)                                                     │
│   A            B                                                                               │
│   1 Budi ───╮  1 Sari (baru)                                                                   │
│   2 Andi ─╮ ╰─ 2 Budi                                                                          │
│   …       ╰─── 3 Andi                                                                          │
├────────────────────────────────────────────────────────────────────────────────────────────────┤
│ [Peringkat] [Kriteria] [Rincian kandidat] [Konfigurasi] [Pool]                                 │
│  Saring: ( ) semua  (•) hanya yang berubah  ( ) hanya finalis  ( ) hanya kandidat pembanding  │
│  Nama   Unit  Status    Peringkat A→B   Δ          Kecocokan A→B      Finalis   Readiness  … │
│  Budi   IT    keduanya  1 → 2           ▼1 (turun)  82,4% → 79,0% −3,4 pp  tetap   Short→Med │
└────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Kueri audit yang ditambahkan

Q5–Q8 ditambahkan ke `docs/rerun-modes-inventory.md` §9. Q5 memeriksa kesamaan
aspek kandidat `existing_pool` (dan semua kandidat yang dibawa), Q6 memeriksa
kunci snapshot FR-SN-01 yang belum ada, Q7 memeriksa keputusan forum yang
merujuk run atau kandidat di luar pool, dan Q8 memeriksa turunan yang posisi
atau tenant-nya berbeda dari induk.

## 5a. Keputusan I-7 (Fase C): satu implementasi TOPSIS untuk dua deployable

Perbandingan run dan pemeriksaan keterulangan harus menghitung ulang TOPSIS
dengan fungsi yang sama dengan yang dipakai scoring-service. Tiga jalan
ditimbang:

1. **Mengimpor berkas scoring-service langsung dari web app (dipilih).** Langkah
   peringkat akhir dipindahkan ke tiga berkas tanpa ketergantungan —
   `scoring-service/src/ahp-criteria.ts`, `topsis.ts` (kini dengan
   `topsisDetailed`, yang membuka pembagi, ideal, dan sumbangan per kriteria),
   dan `topsis-ranking.ts` (`rankCandidatesByTopsis`, dipindahkan dari
   `ahp-topsis-engine.ts`, yang kini mengekspornya ulang). Web app mengimpor
   `topsis-ranking.ts` dari `lib/run-compare.ts`, dan `.dockerignore` web
   mengecualikan ketiga berkas itu dari pengecualian `scoring-service`. Risikonya
   paling kecil: tidak ada ketergantungan runtime, tidak ada perubahan struktur
   workspace, dan berkas yang menghitung peringkat tetap satu.
2. **Endpoint di scoring-service.** Ditolak: halaman baca-saja menjadi bergantung
   pada layanan yang sedang hidup, menambah jalur gagal (timeout, layanan mati)
   pada sesuatu yang secara hakikat hanya aritmetika atas data tersimpan.
3. **Paket bersama (workspace).** Ditolak untuk sesi ini: menuntut perubahan
   struktur tiga deployable, lockfile, dan Dockerfile, untuk tiga berkas murni.

Penjaganya ada di tes, bukan di komentar (`tests/scoring/run-compare.test.ts`,
TC-CMP-STRUCT): modul perbandingan tidak boleh memuat `Math.sqrt`/`Math.hypot`,
ketiga berkas bersama hanya boleh saling mengimpor, ketiganya harus ada di
whitelist `.dockerignore`, dan engine harus mengimpor `rankCandidatesByTopsis`
dari `topsis-ranking`, bukan mendefinisikannya sendiri. Salinan rumus yang
tersisa hanya oracle di tes (diizinkan I-7). `lib/run-diff.ts:topsisBreakdown`
kini dibangun di atas `rankPool` dan tidak lagi menyalin rumus (temuan §2 butir 2).

Satu hal yang belum terverifikasi pada fase ini: build Next.js produksi
(`pnpm build`) dan build Docker web yang benar-benar menyertakan ketiga berkas.
Keduanya diperiksa di Fase D/E.

## 6. Status akhir (Fase E)

### 6.1 Cara membaca kolom Verifikasi

- **tes** — tes otomatis yang dijalankan `node --test` (nama tes disebut).
- **E2E** — `scripts/verify-rerun-requirements.ts`, yang menjalankan engine
  scoring yang sebenarnya pada database lokal berfixture; 24 cek, semuanya lulus
  pada Fase E. Sejak 2026-11-05 skrip itu berisi 22 cek: dua cek Keyakinan
  Penempatan (MCU) dihapus bersama fiturnya (§6.12).
- **browser** — dilihat sendiri lewat Playwright pada database lokal; nomor
  merujuk tangkapan layar di `docs/screenshots/rerun/`.
- **kode** — hanya diperiksa dengan membaca kode; belum ada tes otomatis.
- **typecheck** — lulus `tsc --noEmit` (web 74 galat = baseline, scoring-service 0).

Semua angka berasal dari database lokal dengan fixture. Database produksi tidak
terjangkau dari lingkungan ini (G-9), jadi kueri Q5–Q8 belum dijalankan di sana.

### 6.2 Eksekusi re-run (FR-RR)

| ID | Status akhir | Bukti | Verifikasi | Catatan |
|---|---|---|---|---|
| FR-RR-01 | Terpenuhi | `lib/rerun-freeze.ts:validateRerunRequest`, `lib/scoring-engine.ts:getRerunPreviewAction`, `components/position-run-table.tsx` (tombol nonaktif + alasan) | tes TC-RRF-06 (setiap alasan); browser 22, 23 | Fase E mengganti teks "tidak tersedia" dengan tombol nonaktif yang alasannya tertulis di bawahnya. |
| FR-RR-02 | Terpenuhi | `lib/scoring-engine.ts:searchRerunCandidatesAction`, `components/rerun-dialog.tsx` | browser 05 | Nama atau NPK; unit, jabatan, grade, dan rumpun per baris; saringan unit, posisi, departemen, grade, rumpun. Dibatasi ke business unit yang dicakup run induk (NFR-RR-07). Kueri pencarian tidak punya tes otomatis karena membutuhkan sesi Next.js. |
| FR-RR-03 | Terpenuhi | `classifyRerunCandidates` lewat `classifyAgainstParent`, dipakai dialog, pencarian, dan kirim | tes TC-REQ-RR03; browser 05 lalu 02 | Status di dialog (05) sama dengan yang dicatat server pada run turunan (02). |
| FR-RR-04 | Terpenuhi | `validateRerunRequest` (trim, wajib, ≤ 1.000 karakter), penghitung karakter di dialog | tes TC-REQ-RR04; browser 01, 02, 07, 08 | Tampil di pohon, banner run turunan, snapshot, dan header perbandingan. |
| FR-RR-05 | Terpenuhi — **perubahan perilaku** | `classifyAgainstParent`, `filter_summary.forceIncluded` | tes TC-REQ-RR05; browser 05, 02, 08 | Rejected ditolak beserta aturannya; Excluded (grade) baru diterima setelah konfirmasi per kandidat dan diberi badge; Reconsidered dinilai. Sebelumnya semua kandidat baru dimasukkan apa pun aturan yang dilanggarnya. |
| FR-RR-06 | Sebagian | `resolveFrozenBasis`, `planFrozenRerun` | tes TC-RRF-01…05, TC-RRF-08, TC-REF-01, TC-REQ-RR06, TC-REQ-RR07a–c; E2E (CR/λmaks/CI, readiness) | Semua butir dibekukan **kecuali ID model**: penyedia model tidak dapat dipaksa memakai versi lama, sehingga kandidat baru dinilai dengan model yang berlaku saat turunan dibuat. Perbedaan model dicatat (`runInfo.rerun.modelsChanged`) dan tampil sebagai peringatan di banner. Butir pewarisan keyakinan MCU kandidat lama — beserta `lib/mcu-confidence-lineage.ts` dan cek E2E-nya — **dihapus 2026-11-05** bersama fitur Keyakinan Penempatan (§6.12). |
| FR-RR-07 | Terpenuhi | `run_info.frozen.positionBasis`, `runInfo.positionBasisStatus`, `basisCaveats` | tes TC-REQ-RR07a–c; E2E FR-RR-07a–d; browser 02, 07, 25 | (a) root menyimpan basis sebagai nilai; (b) turunan memakainya; (c) induk lama → `live_fallback` per butir, peringatan di banner (02) dan, sejak Fase E, di halaman perbandingan (25); (d) kamus berubah dicatat sebagai catatan; (e) pemegang "aktif" dinilai pada tanggal acuan beku. Pembekuan hanya mengganti sumber masukan; rumus dan pipeline embedding tidak berubah. |
| FR-RR-08 | Terpenuhi | `planFrozenRerun`, `assembleAspectScores` | tes TC-RRF-02, TC-RRF-05; E2E (Q5b = 0 baris) | |
| FR-RR-09 | Terpenuhi — **perubahan perilaku** | `scoring-service/src/rerun-freeze.ts:composeChildResultList`, `childFinalistTarget` | tes TC-REQ-RR09; E2E; browser 03, 08 | N tidak lagi bertambah sebanyak kandidat pembanding. Daftar = N besar menurut peringkat baru ∪ semua finalis induk ∪ semua kandidat pembanding, dengan penanda. Aturan ditulis di `CLAUDE.md`. |
| FR-RR-10 | Terpenuhi | `config_snapshot.rerun.skipped`, banner, snapshot | tes TC-RRF-07; browser 02, 07 | |
| FR-RR-11 | Sebagian | `components/position-run-table-client.tsx`, `components/run-progress-stages.tsx`, banner | browser (regresi Fase E), 06 | Pengguna diarahkan ke run turunan dan melihat tahapan. Perbandingan dengan induk satu klik dari banner, **tidak terbuka otomatis**. Peringkat sudah tersimpan sebelum narasi, tetapi halaman baru menampilkannya setelah status `completed`, yang ditulis sesudah narasi. Fase E juga memperbaiki balapan `router.push` + `router.refresh` yang bisa meninggalkan pengguna di run lama. |
| FR-RR-12 | Terpenuhi | `run_info.failure`, `parseRunSummary`, kartu "Penilaian Gagal", `parseRerunSpec` | tes TC-REQ-RR12, TC-RRF-09; E2E FR-RR-12 (dua cek); browser 18, 22 | Jalur batal tidak lagi menulis `status = 'failed'` yang ditolak constraint. |
| FR-RR-13 | Terpenuhi | kunci permintaan + advisory lock transaksi (jendela dua menit) | tes TC-REQ-RR13 (kunci) | Penguncian serentak belum diuji dengan dua klik nyata di browser. |
| FR-RR-14 | Terpenuhi | `narrativeSource` di `details.ahpTopsis`, label di `components/analysis/diagnostic-dossier.tsx` | tes TC-CMP-STRUCT; browser (label templat dan label run lama) | Varian label "Narasi model bahasa, tidak memengaruhi angka" belum terlihat di browser karena lingkungan ini tidak punya model bahasa. Run turunan menulis narasi untuk peringkatnya sendiri (G-6); narasi tidak dibuat ulang saat run dibuka dan tidak pernah dipakai kalimat perbandingan. |
| FR-RR-15 | Terpenuhi | `rerunSpec`, `LEGACY_RERUN_MODES`, `buildRunForest` | tes TC-RRF-09, TC-RRN-01; browser 01, 17 | "Mode lama: <nama>" di pohon; dapat dibandingkan; menjadi induk hanya bila FR-RR-01 terpenuhi. |

### 6.3 Snapshot (FR-SN)

| ID | Status akhir | Bukti | Verifikasi | Catatan |
|---|---|---|---|---|
| FR-SN-01 | Terpenuhi | `run_info.{frozen, models, dataVersions, readiness, positionBasisStatus, timings}`, `config_snapshot`, `filter_summary` | E2E FR-SN-01, FR-RR-07a, NFR-RR-05; Q6 | Q6 (dikoreksi pada Fase E, lihat 6.10) mengembalikan 0 run baru yang kurang kunci. Matriks dengan CR > 0,1 ditolak **saat disimpan** di Tata Kelola; snapshot menyatakan hal itu. Pemeriksaan kunci tersebar di beberapa cek E2E, bukan satu tes. |
| FR-SN-02 | Terpenuhi | `components/analysis/run-snapshot-panel.tsx`, `getRunSnapshotAction` | browser 07 | Sembilan bagian, label asal per butir, matriks 6×6 dengan CR/λmaks/CI, bobot dua desimal dengan rincian enam desimal, "Tidak tersimpan pada run ini". |
| FR-SN-03 | Terpenuhi | tombol "Unduh snapshot (JSON)" | browser (unduhan diuji pada Fase E) | Berkas memuat `configSnapshot`, `runInfo`, `filterSummary` apa adanya. |
| FR-SN-04 | Terpenuhi | `lib/readiness-label.ts`, `determineReadiness` dengan ambang run di engine | tes TC-REQ-SN04a, TC-REQ-SN04b; E2E | |
| FR-SN-05 | Terpenuhi | `drizzle/0087_completed_run_immutability.sql`; engine menulis `completed` paling akhir | E2E FR-SN-05 (dua cek) | Pengecualian yang disengaja: `analysis_results.manual_rank` dan SET NULL dari FK. Tidak ditemukan bukti bahwa angka run selesai pernah berubah di data lokal. |
| FR-SN-06 | Terpenuhi | `components/analysis/run-compare/topsis-breakdown.tsx`, `getRunTopsisBreakdownAction` | browser 04, 12 | Dipakai ulang di tab Rincian kandidat. |

### 6.4 Riwayat (FR-RH)

| ID | Status akhir | Bukti | Verifikasi | Catatan |
|---|---|---|---|---|
| FR-RH-01 | Terpenuhi | `components/analysis/run-tree.tsx`, `lib/run-tree-actions.ts` | tes TC-REQ-RH01; browser 01 | |
| FR-RH-02 | Terpenuhi | `buildRunForest` (`orphaned`) | tes TC-RRF-09; browser 01 | |
| FR-RH-03 | Terpenuhi | pilih dua simpul + "Bandingkan", pintasan induk/root/run sebelumnya, `lib/run-history.ts:runNeighbours` | browser 01 | |
| FR-RH-04 | Terpenuhi | `components/new-root-run-dialog.tsx`, `lib/run-history-actions.ts:startNewRootRunAction`, banner tawaran banding | browser 20, 26 | Pada Fase E sebuah root baru benar-benar dibuat dari halaman riwayat, selesai di scoring-service lokal, dan menawarkan perbandingan dengan root sebelumnya. |

### 6.5 Perbandingan (FR-CMP)

| ID | Status akhir | Bukti | Verifikasi | Catatan |
|---|---|---|---|---|
| FR-CMP-01 | Terpenuhi | `lib/run-compare.ts:comparabilityError`, `getRunComparisonAction` | tes TC-CMP-GUARD; E2E NFR-RR-07; browser 16, 17 | Penjaga dipisah menjadi fungsi murni pada Fase E agar dapat diuji. |
| FR-CMP-02 | Terpenuhi | `relationOf` | tes TC-CMP-REL; browser 08, 17 | |
| FR-CMP-03 | Terpenuhi | `sources`, `freezeViolations`, `SourceSummary` | tes TC-CMP-PROP-ii; browser 08, 09, 17, 25 | |
| FR-CMP-04 | Terpenuhi | `configDiff`, `ConfigCompare` | tes TC-CMP-CFG; browser 13 | Sejak Fase E, butir yang tidak tersimpan di kedua run berstatus "Tidak tercatat", bukan "Sama" (I-6). |
| FR-CMP-05 | Terpenuhi | `membershipReason`, `PoolTable` | tes TC-CMP-POOL; browser 14 | |
| FR-CMP-06 | Terpenuhi | `ComparisonRankingTable` | browser 10, 24 | |
| FR-CMP-07 | Terpenuhi | `CriteriaTable`, `topsisDetailed` | tes TC-CMP-HAND; browser 11 | Normalisasi modul TOPSIS adalah normalisasi vektor; istilah "pembagi normalisasi" tepat. |
| FR-CMP-08 | Terpenuhi | `CandidateBreakdownCompare` | browser 12 | Dua kriteria dengan perubahan sumbangan terbesar disorot. |
| FR-CMP-09 | Terpenuhi | `lib/run-compare-explain.ts` | tes TC-CMP-TPL | Katalog: `docs/rerun-explanation-templates.md`. |
| FR-CMP-10 | Terpenuhi | `attribute` | tes TC-CMP-PROP-ii, TC-CMP-PROP-iii; browser 15 | |
| FR-CMP-11 | Terpenuhi | `/positions/[id]/compare?a=&b=`, `compareHref` | browser (setiap tangkapan layar perbandingan dibuka lewat URL) | |
| FR-CMP-12 | Terpenuhi (XLSX) | `lib/run-compare-export.ts` | tes TC-CMP-XLSX; browser (unduhan diuji pada Fase E) | Delapan lembar. Fase E memperbaiki lembar Konfigurasi yang masih menulis bobot, CR, dan N sebagai teks berformat. Tampilan cetak (SEBAIKNYA) belum dibuat. |
| FR-CMP-13 | Terpenuhi | `compareRuns` hanya membaca data tersimpan | tes TC-CMP-STRUCT | |

### 6.6 Penandaan dan keputusan forum (FR-MRK, FR-DEC)

| ID | Status akhir | Bukti | Verifikasi | Catatan |
|---|---|---|---|---|
| FR-MRK-01 | Terpenuhi | `setRunExclusionAction` (pembatalan wajib beralasan, keduanya diaudit) | browser 21, 24 | Tidak ada tes otomatis untuk aksi server ini. |
| FR-MRK-02 | Terpenuhi | label "Ditandai dikecualikan (tidak memengaruhi angka)" | kode (tidak ada `insert` run di aksi penandaan); browser | |
| FR-MRK-03 | Terpenuhi | kotak konfirmasi di dialog pilih suksesor | browser 21 | |
| FR-DEC-01 | Terpenuhi | `savePositionPickAction` (`requireJustification`, run harus milik posisi dan tenant ini) | kode; browser 21 (simpan nonaktif sampai justifikasi terisi) | Penolakan di server belum punya tes otomatis. |
| FR-DEC-02 | Terpenuhi | `components/analysis/decision-summary.tsx`, `getDecisionSummaryAction` | browser 01, 18 | |
| FR-DEC-03 | Terpenuhi | `isIncumbentOf` di `savePositionPickAction`; UI menampilkan "Pejabat posisi ini" | kode | |

### 6.7 Non-fungsional (NFR-RR)

| ID | Status akhir | Bukti | Verifikasi | Catatan |
|---|---|---|---|---|
| NFR-RR-01 | Terpenuhi | `verifyRunReproducibility`, `scripts/verify-run-reproducibility.ts`, tombol "Periksa keterulangan" | tes TC-CMP-PROP-i; skrip `--all`: 9 run lokal terulang, 1 run LLM dilewati beserta sebabnya | Belum dijalankan di database produksi. |
| NFR-RR-02 | Terpenuhi | | tes TC-REQ-NFR02; E2E NFR-RR-02 | Panggilan model bahasa tidak terjangkau di lingkungan uji, setara dengan di-mock. |
| NFR-RR-03 | Terpenuhi | drizzle/0087 | E2E FR-SN-05 | |
| NFR-RR-04 | Terpenuhi | rincian TOPSIS satu run dan A vs B | browser 04, 12 | |
| NFR-RR-05 | Terpenuhi (pengukuran) | `run_info.timings`, `scripts/measure-rerun-durations.ts` | E2E NFR-RR-05; pengukuran 6.8 | Tidak ada ambang yang diklaim. |
| NFR-RR-06 | Terpenuhi | kolom bernama, `to_jsonb`, penjaga `fx()` di panel konfigurasi | browser (run lama dan mode lama terbuka, 17) | |
| NFR-RR-07 | Sebagian | filter tenant di setiap kueri pemilihan, riwayat, dan perbandingan | E2E (3 cek lintas tenant); tes TC-CMP-GUARD | Pemuat perbandingan, riwayat posisi untuk pemilih, dan penjaga perbandingan diuji lintas tenant. Aksi server pencarian kandidat, pohon run, ringkasan garis keturunan, dan ringkasan keputusan memfilter tenant di SQL (bukti kode), tetapi belum punya tes lintas tenant karena membaca tenant dari sesi Next.js. Cek keempat, garis keturunan MCU, **dihapus 2026-11-05** bersama fitur Keyakinan Penempatan (§6.12). |
| NFR-RR-08 | Terpenuhi | `logAudit` pada re-run (alasan), penandaan dan pembatalannya (alasan), keputusan forum dan perubahan justifikasinya | kode | |
| NFR-RR-09 | Terpenuhi | label bahasa Indonesia, tanpa nama teknis, panah + teks, format angka §6 | browser 01–26 | Fase E mengganti sisa istilah teknis di panel snapshot ("inherited", "none", nama tahap) dan notasi "0.0e+0". |

### 6.8 Durasi re-run (NFR-RR-05)

Diukur dengan `scripts/measure-rerun-durations.ts --reps 5` pada fixture
(engine sebenarnya, di dalam proses, database lokal). Median (min–maks) dalam
milidetik:

| Skenario | Jam dinding | Total engine | Sampai peringkat tersimpan |
|---|---|---|---|
| Root (12 kandidat, semua dinilai) | 80 (63–181) | 71 (55–148) | 69 (52–144) |
| Turunan, 1 kandidat sudah di pool induk | 66 (52–92) | 56 (44–79) | 53 (42–75) |
| Turunan, k = 1 kandidat baru | 62 (52–74) | 52 (46–65) | 49 (44–62) |
| Turunan, k = 2 kandidat baru | 52 (47–63) | 45 (41–57) | 43 (39–55) |
| Turunan, k = 4 kandidat baru | 56 (52–69) | 48 (44–59) | 46 (42–57) |

Turunan yang dikirim lewat dialog di browser mencatat validasi web 12–39 ms dan
total engine 141–229 ms (scoring-service dalam mode pengembangan).

**Angka ini batas bawah, bukan durasi produksi.** Di lingkungan ini tidak ada
model yang terjangkau: narasi model bahasa dimatikan, Gemini tidak punya kunci,
dan endpoint embedding menolak sambungan, sehingga aspek pendidikan, teknis, dan
karier memakai jalur cadangan deterministiknya. Di produksi, tahap-tahap itu
menunggu panggilan model untuk setiap kandidat baru, dan narasi menunggu model
bahasa. Yang dapat disimpulkan hanyalah bentuknya: kandidat lama tidak dihitung
ulang, dan peringkat sudah tersimpan sebelum narasi ditulis.

### 6.9 Tes dan typecheck akhir dibanding baseline

| Rangkaian | Baseline (Fase A, commit `3b6a8e7`) | Akhir (Fase E) |
|---|---|---|
| Tes web — scoring | 48 tes: 47 lulus, 1 todo | 98 tes: 97 lulus, 1 todo (todo yang sama, TC-PAR-07/DEFECT-04), 0 gagal |
| Tes web — job family | 15 lulus | 15 lulus |
| Tes web — talent mapping | 64 lulus | 64 lulus |
| Tes scoring-service | 172 tes: 169 lulus, 3 todo | 172 tes: 169 lulus, 3 todo, 0 gagal |
| `tsc --noEmit` web | 74 galat | 74 galat, sebaran per berkas identik dengan baseline |
| `tsc --noEmit` scoring-service | 0 | 0 |
| `tsc --noEmit` sync-service | 20 (modul tidak terpasang di kontainer) | 20, sebab yang sama |
| E2E `scripts/verify-rerun-requirements.ts` | belum ada | 24 cek, semuanya lulus |
| `scripts/verify-run-reproducibility.ts --all` | belum ada | 9 run terulang, 1 run LLM dilewati beserta sebabnya |

Tes web bertambah 50: rangkaian TC-REQ (Fase B), TC-CMP (Fase C, ditambah TC-CMP-GUARD, TC-CMP-XLSX, dan dua tes konfigurasi pada Fase E), dan TC-RDF yang dipindahkan ke TC-CMP pada Fase D.

### 6.10 Perubahan dan temuan pada Fase E

1. **FR-RR-01:** tombol "Tambah Kandidat Pembanding" kini tampil nonaktif dengan
   alasannya, bukan diganti teks.
2. **FR-RR-07(c):** halaman perbandingan menampilkan peringatan "Ada nilai yang
   tidak dibekukan dari run induk" (basis posisi `live_fallback`, bagian basis
   yang dibaca hari ini, dan catatan seperti kamus berubah).
3. **FR-RR-11:** `router.refresh()` yang langsung menyusul `router.push()`
   membatalkan navigasi ke run baru pada dialog Penilaian Baru (terlihat di
   browser: run baru dibuat, tetapi pengguna tetap di run lama). Dihapus di
   dialog itu dan di dialog Tambah Kandidat Pembanding.
4. **FR-CMP-01:** syarat keterbandingan dipindah ke `comparabilityError` (murni,
   teruji).
5. **FR-CMP-04, I-6:** butir konfigurasi yang tidak tersimpan di kedua run kini
   "Tidak tercatat", bukan "Sama".
6. **FR-CMP-12:** lembar Konfigurasi menulis bobot, CR, dan N sebagai angka;
   tes ekspor ditambahkan (sebelumnya komentar menyebut fungsi itu teruji padahal
   belum ada tesnya).
7. **Q6 dikoreksi.** Kueri Fase A mencari basis posisi di `run_info.positionBasis`,
   padahal engine menyimpannya di `run_info.frozen.positionBasis`, dan
   menghitung nilai JSON `null` sebagai tersimpan. Q6 versi Fase A akan
   melaporkan setiap run baru kekurangan basis posisi dan melewatkan run lama yang
   kuncinya berisi null.
8. **Fixture run LLM (M1)** kini memakai bentuk baris hasil yang ditulis engine
   LLM sebenarnya. Bentuk lama yang terlalu ringkas membuat halaman run itu galat;
   data LLM nyata selalu memuat `scoreBreakdown` dan `primaryFilter`, jadi ini
   kekurangan fixture, bukan bug produk.
9. **Kalimat T-08** tidak lagi memuat tanda kurung bersarang untuk kandidat di
   luar rentang grade.

### 6.11 Setelah Fase E: perbandingan dan keputusan forum dalam satu tab

Atas permintaan pengguna, halaman perbandingan (L-4) dan ringkasan
"Rekomendasi sistem dan keputusan forum" (FR-DEC-02) dipindah ke satu tab baru
di halaman hasil scoring, **"Perbandingan Run"**, tepat di bawah tab Kandidat.
Kebutuhannya tetap terpenuhi; yang berubah adalah tempat dan cara memakainya.

| Kebutuhan | Dulu | Sekarang |
|---|---|---|
| FR-CMP-01..13 | Halaman tersendiri `/positions/[id]/compare?a=&b=`, run dipilih dari dua daftar tarik-turun | Tab "Perbandingan Run" (`run-compare-workspace.tsx`); run dipilih dari pohon silsilah (`lineage-navigator.tsx`) atau dari bilah A \| B; mesin `compareRuns` tidak berubah |
| FR-CMP-11 | Pasangan di URL halaman perbandingan | Tab dan pasangan di URL halaman posisi (`?tab=perbandingan-run&a=&b=`, `compareHref`); alamat lama dialihkan oleh `app/(dashboard)/positions/[id]/compare/page.tsx` |
| FR-RH-03 | Centang dua run di Silsilah lalu "Bandingkan" membuka halaman perbandingan | Centang dan pintasan yang sama membuka tab "Perbandingan Run" di halaman yang sama, tanpa memuat ulang (`compare-nav.tsx`); centang tetap di tampilan Silsilah pada kartu Riwayat Scoring |
| FR-DEC-02 | Kartu di atas semua tab | Bagian "Keputusan forum" di tab itu, dengan tombol "Jadikan A" / "Jadikan B" per run, ditambah ringkasan "Suksesor yang dipilih forum, di run A dan B" di bagian Ringkasan |

Yang ditambahkan untuk keterbacaan:

- **Pohon silsilah untuk root dengan banyak turunan.** Generasi digambar
  sebagai kolom, setiap turunan satu baris; kartu induk menempel di atas
  kolomnya selama turunannya digulir; B dapat dipindah ke saudara sebelumnya
  atau berikutnya ("saudara 6/12"); "Lipat cabang lain" menyisakan cabang A
  dan B; jalur A–B digambar tebal; run yang tidak dapat dibandingkan tetap
  tergambar bergaris putus-putus dengan alasannya. Tata letaknya murni dan
  teruji (`lib/run-lineage-layout.ts`, TC-LIN, 19 tes).
- **Ringkasan dengan angka kunci** (peringkat teratas A → B, kandidat dinilai,
  kandidat pembanding, peringkat bergeser, N besar masuk dan keluar termasuk
  kandidat pembanding, sumber perubahan), dibaca langsung dari DTO yang sama
  dengan tabel (`lib/run-compare-overview.ts`, TC-CMP-OVERVIEW).
- **Pohon dimuat sekali** di `PositionRunSection` dan dipakai bersama oleh
  tampilan Silsilah, jejak leluhur, dan tab ini; sebelumnya dua komponen
  membacanya masing-masing.

Verifikasi: tes (TC-LIN 19, TC-CMP-OVERVIEW 2, seluruh rangkaian web 118 lulus
+ 1 todo lama), typecheck web tetap 74 galat dengan himpunan yang sama,
`pnpm build` lulus, E2E 24/24, keterulangan 33 run (0 tidak terulang). Dilihat
di browser pada fixture `scripts/seed-wide-lineage.ts` (satu root dengan 12
turunan, rantai cucu–cicit, run gagal, root kedua, dua keputusan forum):
tangkapan layar 27–32 di `docs/screenshots/rerun/`, termasuk centang Silsilah
yang membuka tab. Pengalihan alamat lama diperiksa dengan skrip browser yang
membaca alamat akhir, tanpa tangkapan layar. Tangkapan layar 01–26 tetap
menunjukkan halaman perbandingan lama seperti saat Fase D dan E diverifikasi.

### 6.12 Setelah Fase E: fitur Keyakinan Penempatan (MCU) dihapus (2026-11-05)

Atas permintaan pengguna, seluruh fitur Keyakinan Penempatan (MCU) dihapus:
tabel `mcu_confidence_assessments` dijatuhkan oleh
`drizzle/0095_drop_mcu_confidence.sql`, dan prompt `ahp_mcu_confidence` dihapus
bersama modul dan endpoint penilaiannya di scoring-service, panel modelnya di
Tata Kelola, serta lencana, chip, dialog, dan tombolnya di halaman hasil
scoring. Angka keyakinan tidak pernah masuk
`final_score`, matriks keputusan, maupun peringkat, sehingga tidak ada run
selesai yang angkanya berubah, dan I-1 tetap berlaku. Yang tetap ada: status MCU
kandidat, aturan filter MCU yang hanya menandai (`severity: 'advisory'`, yaitu
kategori Reconsidered pada FR-RR-05), dan kolom keterangan MCU kandidat.

Butir audit yang gugur:

| Kebutuhan | Butir | Status |
|---|---|---|
| FR-RR-06 | Kandidat lama mewarisi keyakinan MCU run induk (`lib/mcu-confidence-lineage.ts`; cek E2E "a carried candidate inherits the parent's MCU confidence") | Dihapus 2026-11-05 — fitur Keyakinan Penempatan dihapus. Butir FR-RR-06 lainnya tidak berubah (§6.2). |
| NFR-RR-07 | Cek E2E "the MCU lineage read is tenant-scoped" | Dihapus 2026-11-05 — fitur Keyakinan Penempatan dihapus. Tiga cek lintas tenant lainnya tetap (§6.7). |
| FR-SN-01, FR-SN-02, FR-CMP-04 | Model MCU di `run_info.models`, baris "Model bahasa — MCU" di panel snapshot, dan model MCU pada butir "Model yang dipakai" di perbandingan konfigurasi | Dihapus 2026-11-05 — fitur Keyakinan Penempatan dihapus. `run_info.models` kini mencatat embedding, pendidikan, dan narasi, dan `runInfo.rerun.modelsChanged` tidak lagi membandingkan model MCU. Run lama yang menyimpan model MCU tetap terbaca; kuncinya diabaikan. |
| — | Tes TC-PAR-05, TC-PAR-06, TC-PAR-07 (paritas aturan MCU antara web dan scoring-service) dan TC-CMP-ADJ (perbandingan tanpa skor yang disesuaikan MCU) | Dihapus 2026-11-05 bersama kode yang diujinya. TC-PAR-07 adalah todo DEFECT-04 yang tercatat di §6.9. |

Angka verifikasi sesudahnya: `scripts/verify-rerun-requirements.ts` berisi 22
cek (dari 24); rangkaian tes web — scoring berisi 111 tes, semuanya lulus, tanpa
todo (diukur 2026-11-05). Angka di §6.9 dan §6.11 adalah catatan saat itu dan
tidak diubah.
