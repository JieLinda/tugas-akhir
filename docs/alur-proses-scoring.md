# Alur Proses Scoring — AI Pulse

Apa saja yang terjadi sejak tombol "Mulai Penilaian" ditekan sampai peringkat suksesor tersimpan: siapa yang mengerjakan, apa yang dikerjakan, tabel mana yang disentuh, dan apa hasilnya

| | |
|---|---|
| Versi dokumen | 1.5 |
| Tanggal | 17 November 2026 (versi 1.4 dan 1.3: 5 November 2026; versi 1.2 dan 1.1: 29 Oktober 2026; versi 1.0: 14 Oktober 2026) |
| Perubahan versi 1.5 | 17 November 2026: metode AI Tournament (LLM) dihapus dari sistem; AHP + TOPSIS menjadi satu-satunya metode. Fase 5B diringkas menjadi catatan penghapusan. Rujukan metode LLM di Ringkasan, Fase 0, 2.8, 2.10–2.14, 3.1, 4.3, 4.4, 6.2, 6.4, 6.6, Fase 7, tabel kegagalan, Temuan no. 3 dan 17, serta Lampiran A–D disesuaikan. Run LLM yang tersimpan dan tabel/kolom khusus LLM dihapus oleh `drizzle/0097_remove_llm_tournament.sql`. Narasi AHP tidak lagi ditulis model pada run mode demo (5A.20) |
| Perubahan versi 1.4 | 5 November 2026: fitur Simulasi penempatan (simulasi peran) dihapus dari sistem beserta tabelnya. Rujukannya di 6.6, Fase 7, dan Lampiran A disesuaikan dengan kode pada commit `024d4a6` |
| Perubahan versi 1.3 | 5 November 2026: fitur Keyakinan Penempatan (MCU) dihapus dari sistem beserta tabelnya. Rujukannya di 5A.2, 6.6, Fase 7, J1, Temuan no. 21, dan Lampiran A disesuaikan dengan kode pada commit `8f8f62b` |
| Cakupan | Satu run scoring dari wizard sampai hasil tersimpan, dengan metode AHP + TOPSIS (satu-satunya metode sejak AI Tournament/LLM dihapus pada versi 1.5). Juga jalur pemantauan, pembatalan, pemulihan, dan jalur start lain (rerun, tambah massal, scoring ulang program) |
| Metode | Pembacaan langsung kode sumber branch `mcdm` pada commit `8e72dd5`. Setiap klaim merujuk berkas dan nomor baris pada commit itu. Versi 1.1 memperbarui jalur penilaian ulang dan urutan penulisan hasil (5A.1, 5A.2, 5A.14, 5A.16–5A.22, J1, J2, J2b) sesuai kode setelah perombakan re-run; bagian itu merujuk nama fungsi, bukan nomor baris |
| Pembaca | Pengembang, admin sistem, dan auditor yang perlu tahu siapa menyentuh tabel apa, kapan, dan mengapa |
| Status | Menggambarkan perilaku kode pada tanggal di atas. Bagian *Catatan dan temuan* mencatat ketidaksesuaian yang ditemukan selama penelusuran |

---

## Tentang dokumen ini

Dokumen ini menjawab satu pertanyaan secara rinci: **apa saja yang terjadi ketika sebuah scoring dimulai**. Setiap proses diuraikan dalam empat hal:

1. **Pelaku** — deployable yang menjalankannya (web app, scoring-service, sync-service, atau topic-service), lengkap dengan berkas dan fungsinya.
2. **Kegiatan** — apa yang dikerjakan dan aturan apa yang berlaku.
3. **Aktivitas basis data** — tabel yang dibaca, ditulis, diubah, atau dihapus, di basis data mana, dan untuk keperluan apa.
4. **Hasil** — keluaran langkah itu: data baru, nilai yang dipakai langkah berikutnya, atau perubahan status.

Bila langkah itu juga memanggil layanan di luar basis data (LLM, Gemini, layanan embedding, atau layanan lain), panggilan itu dicatat di butir tersendiri.

Tiga dokumen lain menjawab pertanyaan yang berbeda, dan isinya sengaja tidak diulang di sini:

| Dokumen | Menjawab |
|---|---|
| `docs/arsitektur-sistem.md` | Bagaimana sistem disusun secara keseluruhan |
| `docs/rumus-kriteria-ahp-topsis.md` | Rumus setiap kriteria AHP + TOPSIS |
| `docs/metodologi-laporan-scoring.md` | Cara membaca laporan hasil di halaman posisi |

### Notasi

- **DB utama**: PostgreSQL aplikasi (`DATABASE_URL` / `POSTGRES_URL`). Skemanya dimiliki web app (`lib/db/schema.ts`).
- **DB vektor**: PostgreSQL + pgvector (`VECTOR_DATABASE_URL`). Isinya `job_profile_embed`, `kamus_kompetensi_embed`, dan `kamus_kompetensi_level_embed`. DB vektor tidak harus berada di instans yang sama dengan DB utama, jadi **tidak pernah ada join lintas keduanya**. Yang dikirim melintasi batas itu selalu berupa daftar id.
- Jenis operasi: **BACA** (SELECT), **TULIS** (INSERT/UPSERT), **UBAH** (UPDATE), **HAPUS** (DELETE).
- **Berkas** berarti berkas di disk, bukan basis data: kunci master, `lib/readiness-config.json`, dan `lib/scoring-prompts.json`.
- Langkah diberi nomor `F.n` (fase F, urutan n), misalnya **2.11** untuk langkah ke-11 Fase 2 atau **5A.6** untuk langkah ke-6 Fase 5A. Jalur start lain diberi nomor **J1–J5**, dan temuan di bagian akhir dirujuk sebagai **Temuan no. N**. Rujukan kode ditulis `berkas:baris`.
- **Peramban** adalah bagian web app yang berjalan di browser pengguna (wizard). **Server web** adalah proses Next.js.

---

## Ringkasan

### Secara singkat

Tombol "Mulai Penilaian" memanggil satu server action di web app, yaitu `startTournamentSessionAction`. Action ini memeriksa izin lalu menyusun kolam kandidat dengan urutan: business unit terpilih → kandidat yang masih hidup → keluarkan semua pemegang jabatan → saring grade → saring aturan filter program. Setelah itu ia menulis dua baris ke DB utama:

- `tournament_sessions` sebagai ruang kerja, berstatus `running`;
- `scoring_runs` sebagai rekaman penilaian, berstatus `in_progress`, yang membekukan konfigurasi program di `config_snapshot`.

Sebelum memberi tahu scoring-service, web app memetakan nama-nama kompetensi ke kode kamus dan menyimpan keputusannya. Pemberitahuannya sendiri hanya `POST /api/scoring/start` yang berisi `sessionId`. **Kontraknya adalah basis data, bukan panggilan HTTP itu**: kalau POST-nya hilang, penyapu sesi yatim di scoring-service tetap akan menemukan sesinya.

scoring-service kemudian membaca semua masukan dari DB utama dan DB vektor, menghitung skor, lalu menulis hasilnya sendiri ke `analysis_results`, `scoring_run_pool_aspects`, `scoring_runs`, dan `tournament_sessions`. Selama itu peramban hanya menyurvei status setiap 2 detik.

**sync-service dan topic-service tidak dipanggil sama sekali selama run.** Peran keduanya selesai sebelum run dimulai, yaitu mengisi data yang kemudian dibaca run.

### Siapa melakukan apa

| Deployable | Peran dalam satu run scoring | Dipanggil selama run? |
|---|---|---|
| **Web app** (Next.js, akar repo) | Memeriksa izin, menyusun kolam, menulis sesi dan run, memetakan nama kompetensi, memberi sinyal ke scoring-service, melayani survei status, menampilkan hasil | **Ya**: memulai dan memantau |
| **scoring-service** (Express, `scoring-service/`) | Mengalibrasi skala kemiripan, menghitung skor aspek, memeringkat, menulis narasi, menyimpan hasil | **Ya**: mengerjakan |
| **sync-service** (Express, `sync-service/`) | Tidak ada selama run. Sebelumnya mengisi data HR yang dibaca run (Fase 0) | **Tidak** |
| **topic-service** (FastAPI, `topic-service/`) | Tidak ada selama run. Hasil pengelompokan job family-nya dibaca run sebagai masukan kalibrasi dan bukti (Fase 0) | **Tidak** |

### Gambaran alur

```
PERAMBAN (wizard)        SERVER WEB (Next.js)            SCORING-SERVICE              BASIS DATA
─────────────────        ────────────────────            ───────────────              ──────────
Fase 1 konfigurasi ────▶ baca posisi, program, kandidat ─────────────────────────────▶ BACA (utama)
[Mulai Penilaian]
      │ server action
      ▼
                         Fase 2 startTournamentSessionAction
                           izin, kolam, filter ──────────────────────────────────────▶ BACA (utama)
                           sesi  (running) ──────────────────────────────────────────▶ TULIS tournament_sessions
                           run   (in_progress) ──────────────────────────────────────▶ TULIS scoring_runs
                           tautan sesi ↔ run ────────────────────────────────────────▶ UBAH tournament_sessions
                         Fase 3 notifyScoringService
                           petakan nama kompetensi ──────────────────────────────────▶ BACA/TULIS cache kamus
                           POST /api/scoring/start ─────▶ Fase 4 terima, cek kapasitas
      ◀── sessionId, runId, dispatch                     processLoop (latar)
                                                         Fase 5 engine AHP+TOPSIS
                                                           baca masukan ─────────────▶ BACA (utama + vektor)
                                                           progres ──────────────────▶ UBAH final_ranked
                                                           hasil ────────────────────▶ TULIS analysis_results, …
                                                           selesai ──────────────────▶ UBAH status = completed
Fase 6 survei /2 dtk ──▶ GET /api/tournament/:id/status ─────────────────────────────▶ BACA tournament_sessions
status completed
Fase 7 halaman posisi ─▶ baca run & hasil ───────────────────────────────────────────▶ BACA (utama)
```

### Koneksi yang dipakai

| Koneksi | Pemakai | Konfigurasi | Dipakai untuk |
|---|---|---|---|
| DB utama | Web app | `lib/db/index.ts`: Drizzle ORM di atas `pg.Pool` (ukuran bawaan 10). URL: `DATABASE_URL`, atau `POSTGRES_URL` | Semua baca/tulis web app |
| DB utama | scoring-service | `scoring-service/src/db/postgres.ts`: `pg.Pool` maks. 10, SQL ditulis tangan. URL: `POSTGRES_URL`, atau `DATABASE_URL` | Semua baca/tulis engine |
| DB vektor | scoring-service | `vectorPool` maks. 10. URL: `VECTOR_DATABASE_URL`, lalu `VECTOR_POSTGRES_URL`, lalu `POSTGRES_URL` | Vektor kamus dan job profile, sensus kalibrasi |
| DB vektor | Web app | `lib/db/vector-db.ts` | **Tidak dipakai** selama run |
| HTTP web → scoring | Web app | `SCORING_SERVICE_URL`, batas waktu 5 detik | `POST /api/scoring/start` |
| LLM (kompatibel OpenAI) | Web app | `LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY` | Tingkat AI pada pemetaan nama kompetensi (langkah 3.1) |
| LLM (kompatibel OpenAI) | scoring-service | `LLM_BASE_URL` (bawaan `http://localhost:8001/v1`), `LLM_MODEL`, `LLM_TIMEOUT_MS` (bawaan 120 detik) | Narasi AHP per finalis (tidak dipanggil pada run mode demo) |
| Gemini | scoring-service | `GEMINI_API_KEY`, `GEMINI_MODEL` (bawaan `gemini-2.5-flash`), grounding `google_search` | Aspek pendidikan pada AHP + TOPSIS |
| Embedding | scoring-service | `EMBEDDING_PROVIDER` (bawaan `openai`), `EMBEDDING_API_BASE`, `EMBEDDING_MODEL` (bawaan `nomic-embed-text-v2-moe:latest`) | Mencocokkan judul jabatan ke job profile; dokumen sintetis posisi |
| Berkas | Web app + scoring-service | `secrets/master.key`, `lib/readiness-config.json`, `lib/scoring-prompts.json` | Kunci dekripsi data kandidat; ambang readiness; prompt pendidikan (Gemini) dan narasi AHP |

Di `docker-compose.yml`, ketiga berkas itu di-*mount* dari host ke kontainer web (baca-tulis) dan ke kontainer scoring (baca saja). Dengan begitu, isi yang diubah lewat Tata Kelola juga terbaca oleh scoring-service.

### Fase dan pelakunya

| Fase | Nama | Pelaku |
|---|---|---|
| 0 | Data prasyarat (jauh sebelum run) | sync-service, topic-service, web app |
| 1 | Persiapan di wizard | Web app (peramban + server) |
| 2 | Membuka sesi | Web app (server) |
| 3 | Dispatch | Web app (server) |
| 4 | Penerimaan dan penjadwalan | scoring-service |
| 5A | Engine AHP + TOPSIS | scoring-service |
| 5B | *(Dihapus pada versi 1.5)* Engine AI Tournament (LLM) | — |
| 6 | Pemantauan, pembatalan, finalisasi cadangan | Web app (peramban + server), scoring-service |
| 7 | Membaca hasil | Web app |

---

## Fase 0 — Data yang harus sudah ada sebelum run

Run scoring **tidak mengambil data dari sistem sumber** (MSSQL, REST, berkas PDF). Ia hanya membaca isi Postgres pada saat run berjalan, sehingga kesegaran hasilnya ditentukan oleh kapan tabel-tabel di bawah ini terakhir diisi. Dari tabel-tabel masukan ini, hanya dua kelompok yang **ikut ditulis karena** run berjalan, dan keduanya dijelaskan di fase berikutnya: cache pemetaan nama kompetensi (langkah 3.1) dan dua tabel kalibrasi (langkah 5A.6–5A.7). Semua tabel lain di bawah ini hanya dibaca oleh run.

Pemeriksaan kode memastikan bahwa **web app maupun scoring-service tidak pernah memanggil sync-service atau topic-service selama run**. `lib/scoring-engine.ts` hanya memanggil `SCORING_SERVICE_URL`. scoring-service hanya keluar ke layanan embedding, LLM, dan Gemini. `SYNC_SERVICE_URL` dan `TOPIC_SERVICE_URL` hanya dipakai di halaman Sinkronisasi, Keamanan, Job Profile, dan Job Family. Ketiga layanan latar terhubung melalui tabel bersama, bukan melalui panggilan.

### 0.1 Data HR — ditulis sync-service

sync-service menulis data ini lewat tiga jalur:

- **cron mingguan**: Senin 01:00 WIB (`sync-service/src/scheduler.ts`, memanggil `runFullSync` di `sync-service/src/routes/sync.ts:506`);
- **CLI**: `npm run cli -- <job>`;
- **HTTP**: `POST /sync/*`, yang diproksikan web app lewat `/api/sync/*` dengan izin `sync.manage`.

| Tabel | Ditulis oleh (sync-service) | Pemicu | Dibaca scoring untuk |
|---|---|---|---|
| `sync_employee_positions` | `services/position-sync.ts` (dari `DVP_EMPLOYEE_POSITION_TBL`) | cron (bundel posisi), CLI `employee-positions` | tanggal mulai/selesai setiap jabatan; pemegang suatu kode jabatan (acuan kompetensi gabungan, cadangan karier); kode jabatan pemegang posisi sasaran |
| `sync_positions` | `services/position-sync.ts` (`DVP_POSITION_TBL`) | cron, CLI `positions` | ringkasan jabatan untuk dokumen sintetis (5A.11) |
| `positions` | `services/position-sync.ts` (`populatePositions`) | cron (bundel posisi) | kode jabatan master posisi sasaran; pemetaan Job Family |
| `sync_technical_competencies` | `services/position-sync.ts` (`DVP_TECH_COMPETENCY_MAP_SUBDTL`) | cron, CLI `tech-competencies` | acuan kompetensi dari pemegang jabatan; sumber salinan `candidate_technical_competencies` |
| `sync_job_profiles` | `services/job-profile-sync.ts` (PDF di `LOCAL_PDF_FOLDER`, diekstrak LLM vision) | cron, CLI `job-profiles`, unggah, "Ekstrak ulang" / "Coba Lagi Semua" | tujuan jabatan, tanggung jawab, kompetensi wajib, syarat pendidikan dan pengalaman |
| `sync_kamus_kompetensi` | `services/kamus-sync.ts` | **hanya** CLI `kamus-kompetensi` atau `POST /kamus-kompetensi`; tidak ikut cron | kode dan definisi kompetensi |
| `candidates` | `services/candidate-populate.ts` (juga form Kandidat di web) | cron, CLI `candidates`, `POST /candidates` | seluruh atribut kandidat (tabel berikut) |
| `candidate_position_history` | `services/candidate-populate.ts` | sama dengan `candidates` | riwayat jabatan (karier), sensus kedalaman, estimator *transitions* |

Kolom `candidates` yang dibaca scoring berasal dari:

| Kolom | Asal | Dipakai di |
|---|---|---|
| `employee_id`, `name` | `sync_employees` | pengecualian pemegang jabatan (2.8), tampilan |
| `grade` | `sync_employees.grade_id` | saringan grade (2.8), prompt narasi AHP |
| `current_position` | judul `sync_positions` untuk jabatan utama yang aktif | karier, narasi |
| `years_experience` | tahun sejak `entry_date`; hanya sumber DVP yang mengisinya | aturan filter, narasi |
| `performance_grade` | `sync_performance_appraisals` | aspek PA, aturan filter |
| `behavior_recommendation`, `behavior_notes` | `sync_behavior_competencies`. Pada cron, tabel ini diisi **setelah** `candidates`, jadi nilainya tertinggal satu siklus | aspek behavior |
| `hav_quadrant` | `sync_hav`; **tidak ikut cron** | aspek HAV |
| `mcu_status` | `sync_mcu`, bawaan `fit`; **tidak ikut cron** | aturan advisory MCU |
| `discipline_status` | `sync_disciplinary` (REST) | aturan filter |
| `education`, `major` | `sync_education` jenjang tertinggi (REST) | aspek pendidikan |

Kolom-kolom itu dienkripsi saat ditulis sync-service (19 kolom, `CANDIDATE_ENCRYPTED_KEYS` di `lib/candidate-crypto.ts`). Kuncinya diambil dari berkas master key yang di-*mount* hanya-baca ke kontainer sync. Karena itu web app maupun scoring-service harus membuka kunci yang sama sebelum dapat membacanya.

### 0.2 Data kurasi dan konfigurasi — ditulis web app

| Tabel / berkas | Ditulis oleh | Kapan | Dibaca scoring untuk |
|---|---|---|---|
| `critical_positions`, `critical_position_holders` | Manajemen Posisi (`lib/pulse-crud-actions.ts`), tambah massal | posisi ditambah/diubah | posisi sasaran, program, rentang grade, pemegang jabatan |
| `program_templates` | Tata Kelola (`lib/program-actions.ts`); template sistem disemai otomatis per tenant | program diubah | aturan filter, target finalis, matriks AHP, nama kriteria |
| `candidate_technical_competencies` | **web app**, bukan sync-service. `syncCandidateTechnicalCompetenciesForTenant` (`lib/pulse-data.ts:292`) menghapus lalu mengisi ulang salinan baris aktif `sync_technical_competencies` per tenant, paling sering sekali per 5 menit per proses | saat halaman kandidat atau daftar kandidat di halaman posisi dibuka | kompetensi kandidat (aspek teknis). **Start scoring tidak menyegarkannya**, jadi run memakai salinan terakhir |
| `job_family_matches` | halaman Pencocokan ("Simpan Pemetaan", pin manual) | operator menyimpan | pasangan posisi/kandidat → job profile |
| `app_encryption_keys` + berkas `secrets/master.key` | Keamanan (`/settings/security`) | inisialisasi/rotasi kunci | membuka kunci data kandidat |
| berkas `lib/readiness-config.json`, `lib/scoring-prompts.json` | Tata Kelola | ambang/prompt diubah | ambang readiness; prompt pendidikan (Gemini) dan narasi AHP |

### 0.3 Data Job Family dan embedding — ditulis topic-service dan web app

| Tabel | Ditulis oleh | Pemicu | Dibaca scoring untuk |
|---|---|---|---|
| `job_family_topic_runs`, `job_family_topics`, `job_family_topic_assignments` | **topic-service**, langsung ke DB utama (psycopg). Web app membuat baris run `pending` lalu `POST {TOPIC_SERVICE_URL}/topics/build` (`lib/job-family-topics-actions.ts`) | tombol bangun peta Job Family atau "Terapkan & bangun ulang peta" | estimator *family* pada kalibrasi karier (5A.7) |
| `job_profile_embed` (DB vektor) | web app (`lib/job-family-actions.ts`) | Job Family langkah 2, tab Embedding | vektor dokumen (karier), kalibrasi karier |
| `kamus_kompetensi_level_embed` (DB vektor) | web app (`lib/kamus-embed-actions.ts`), empat dokumen level kumulatif per kompetensi | tombol embedding kamus | vektor level (teknis), kalibrasi teknis |
| `kamus_similarity_calibration`, `job_profile_similarity_calibration` | scoring-service. Web app juga memanggil endpoint *refresh* scoring-service setelah embed ulang | run pertama setelah korpus berubah, atau *refresh* | anchors kemiripan (5A.6, 5A.7) |

**Catatan kesegaran:**

- Cron mingguan tidak menjalankan sinkronisasi HAV, MCU, maupun kamus. Ketiganya berubah hanya bila dijalankan manual.
- Kompetensi kandidat disalin ulang saat halaman dibuka, bukan saat sync.
- Embedding job profile dan kamus tidak dibangun ulang otomatis setelah sync. Tanpa embed ulang, dokumen baru tidak punya vektor.

---

## Fase 1 — Persiapan di wizard (sebelum sesi dibuat)

### 1.1 Membuka halaman `/scoring/new`

- **Pelaku:** server web, `app/(dashboard)/scoring/new/page.tsx`. Halaman ini dibungkus layout dasbor (`app/(dashboard)/layout.tsx`).
- **Kegiatan:**
  - **Layout dasbor** melakukan empat hal setiap kali halaman di-render:
    - memeriksa sesi login (Keycloak, bila dikonfigurasi);
    - mencatat login;
    - menentukan akses pengguna;
    - memanggil `isLocked()`, yang membuka kunci enkripsi dari berkas master key bila belum terbuka.
  - **Halaman** dijaga `requirePagePermission('scoring.run')`; pengguna tanpa izin dialihkan ke `/`. Halaman lalu memuat tiga hal secara paralel: daftar program, daftar posisi, dan tangga grade. Bila tidak ada posisi, pengguna dialihkan ke `/positions?empty=1`.
- **Aktivitas basis data (DB utama):**
  - Layout:
    - BACA `app_roles`, `app_role_permissions`, `users`;
    - TULIS `users` (catat login);
    - BACA `app_encryption_keys` dan **berkas** master key, hanya bila kunci belum terbuka di proses ini.
  - `listProgramTemplates` (`lib/programs.ts:95`): BACA `program_templates` milik tenant. TULIS template sistem bila tenant belum punya (penyemaian otomatis).
  - `getPositionManagementList` (`lib/pulse-data.ts:2043`). Pembacaan ini berat, padahal wizard hanya memakai sekitar 10 kolom hasilnya. Ia membaca:
    - BACA `critical_positions` dan `program_templates`;
    - BACA `scoring_runs` semua posisi, dan `analysis_results` (termasuk `details`) dari run terakhir tiap posisi;
    - BACA `candidates` (nama), `critical_position_holders`, dan tangga grade;
    - BACA `job_family_matches`, `positions`, `sync_job_profiles` untuk resolusi job profile tiap posisi.
  - `getGradeLevelsForTenant` (`lib/pulse-data.ts:2734`): BACA `sync_company_tenant_map` dan `sync_grade_levels`.
- **Hasil:** wizard berisi:
  - program yang menilai kursi (Talent Pool disembunyikan oleh `positionProgramTemplates`);
  - posisi beserta programnya, rentang grade, dan pemegang jabatan;
  - tangga grade;
  - daftar business unit (konstanta `TENANTS`, bukan dari DB).

### 1.2 Pratinjau jumlah kandidat per rentang grade

- **Pelaku:** peramban memanggil server web, `previewGradeFilterCountAction` (`lib/scoring-wizard-actions.ts:151`). Aksi ini berjalan otomatis setiap kali rentang grade atau business unit berubah, termasuk saat wizard pertama tampil (`scoring-wizard.tsx:353-380`).
- **Kegiatan:** menghitung kandidat yang grade-nya masuk rentang. Membutuhkan izin `scoring.run`.
- **Aktivitas basis data (DB utama):** BACA `candidates` (id, grade) untuk **semua** kandidat hidup di tenant terpilih. Grade-nya didekripsi dan dihitung di aplikasi, karena kolom terenkripsi tidak bisa disaring di SQL.
- **Hasil:** angka total, lolos grade, dan tersaring. Hanya ditampilkan, tidak disimpan.

### 1.3 Panel pengecualian kandidat (opsional)

- **Pelaku:** peramban memanggil server web, `previewProgramFilterAction` (`lib/scoring-wizard-actions.ts:37`), saat panel dibuka (`scoring-wizard.tsx:390-411`).
- **Kegiatan:** menampilkan semua kandidat agar pengguna dapat memilih siapa yang dikecualikan. Meskipun namanya "preview filter", aksi ini **tidak mengevaluasi aturan filter**: semua kandidat hidup dikembalikan.
- **Aktivitas basis data (DB utama):**
  - BACA `program_templates`, hanya untuk memastikan program ada;
  - BACA `candidates` untuk kolom filter (lewat `loadFilterableCandidates`);
  - BACA `candidates` sekali lagi untuk NPK, jabatan, departemen, dan tenant.
  - Semua hasilnya didekripsi.
- **Hasil:** daftar kandidat di panel. Pilihan pengguna dikirim sebagai `excludedCandidateIds` pada langkah 2.7.

### 1.4 Setelah tombol ditekan, sebelum sesi dibuat

Wizard (`scoring-wizard.tsx:715-787`) menjalankan **dua server action persiapan** sebelum memanggil Fase 2. Di sela-selanya bilah progres dinaikkan 10% → 30% → 45% → 55% → 65%.

1. **`previewProgramFilterAction`** dipanggil lagi, dengan aktivitas DB yang sama seperti di 1.3. Wizard lalu menampilkan *"Seluruh N kandidat akan dinilai…"*. N di sini adalah **semua** kandidat hidup, dihitung sebelum saringan grade, pengecualian pemegang jabatan, dan aturan filter. Karena itu angkanya biasanya lebih besar dari ukuran kolam yang benar-benar dinilai.
2. **`prepareMatrixAction`** (`lib/scoring-wizard-actions.ts:88`), dengan izin `scoring.run`. Aktivitas DB:
   - `syncTemplateCriteriaToPosition`, sama seperti langkah 2.6: bisa TULIS `criteria`;
   - BACA `criteria` berkategori `score`;
   - BACA `candidates` (nama, jabatan, departemen) untuk semua id dari langkah 1, lalu didekripsi.

   Dari semua itu, wizard hanya memakai `criteriaCount` untuk pesan *"N aspek penilaian disiapkan"*.
3. **`startTournamentSessionAction`**: Fase 2.

**Hasil:** belum ada data penilaian, hanya baris log aktivitas. Saat sesi akhirnya dibuat, tabel `candidates` sudah dibaca dan didekripsi sekitar lima kali dalam satu start: dua kali di sini, dan tiga kali di langkah 2.7–2.9.

---

## Fase 2 — Web app membuka sesi

**Titik masuk:** `startTournamentSessionAction` (`lib/scoring-engine.ts:725`), sebuah server action Next.js yang dipanggil wizard di `components/scoring/scoring-wizard.tsx:774`. Fungsi ini berjalan di proses server web. Seluruh akses basis datanya lewat Drizzle ke DB utama. Penulisan di fase ini **tidak dibungkus satu transaksi**, sehingga setiap pernyataan langsung ter-*commit*.

### 2.1 Pemeriksaan izin

- **Pelaku:** server web. `requirePermission('scoring.run')` (`lib/scoring-engine.ts:728`) memanggil `hasPermission` dan `getCurrentUserAccess` (`lib/rbac.ts:346`, `:275`).
- **Kegiatan:** menentukan peran pengguna yang sedang masuk, lalu memastikan peran itu memegang izin `scoring.run`. Pengguna *bootstrap admin* lolos tanpa membaca basis data. Yang termasuk: `system@pulse.local` (saat Keycloak tidak dikonfigurasi) dan setiap email di `RBAC_ADMIN_EMAILS`. Pengguna tanpa peran tidak mendapat izin apa pun (*fail closed*).
- **Aktivitas basis data (DB utama):**
  - BACA `app_roles` dan `app_role_permissions` untuk daftar peran dan izinnya (`loadRoles`, `lib/rbac.ts:187`). Hasilnya di-cache di memori proses selama 15 detik.
  - BACA `users.role_id` berdasarkan email (`getUserRoleId`, `lib/rbac.ts:249`).
  - TULIS `app_roles` / `app_role_permissions`, hanya sekali per proses dan hanya bila tabel peran masih kosong. Ini penyemaian peran bawaan (`ensureRolesSeeded`, `lib/rbac.ts:147`).
- **Hasil:** proses berlanjut, atau berhenti dengan galat *"Anda tidak memiliki akses untuk …"* yang tampil sebagai toast. Belum ada data penilaian yang ditulis.

### 2.2 Validasi masukan

- **Pelaku:** server web (`lib/scoring-engine.ts:729-750`).
- **Kegiatan:**
  - `positionId` wajib berupa UUID. Posisi berformat mock lama ditolak dengan pesan *"Posisi ini masih memakai ID mock lama…"*.
  - `programTemplateId` yang bukan UUID diabaikan.
  - Label dipangkas.
  - Daftar kandidat yang dikecualikan di wizard disaring menjadi daftar string.
- **Aktivitas basis data:** tidak ada.
- **Hasil:** masukan yang sudah bersih.

### 2.3 Identitas pelaku dan business unit

- **Pelaku:** server web. `ensureLocalUser()` (`lib/pulse-data.ts:2566`) dan `getCurrentTenantId()` (`lib/tenant.ts:28`) dijalankan paralel.
- **Kegiatan:**
  - Memastikan pengguna punya baris di `users`. Id baris itu menjadi `created_by` pada sesi dan run.
  - Membaca business unit aktif dari cookie `pulse_tenant`, bukan dari basis data. Daftar tenant di-*hardcode* di `lib/tenant.ts`.
  - Menyusun `includedTenantIds` (`lib/scoring-engine.ts:754`): tenant aktif selalu pertama, ditambah tenant lain yang dipilih di wizard asalkan dikenal `TENANTS`. Daftarnya tanpa duplikat.
- **Aktivitas basis data (DB utama):**
  - TULIS/UBAH `users`: *upsert* berdasarkan email (`ON CONFLICT (email) DO UPDATE`). Nama diperbarui hanya bila penyedia identitas mengirimkannya. Id dikembalikan.
  - Untuk pengguna sistem: BACA baris `system@pulse.local`, lalu TULIS baris itu bila belum ada.
- **Hasil:** `userId` dan `includedTenantIds`.

### 2.4 Muat posisi sasaran

- **Pelaku:** server web, `loadPositionRow` (`lib/scoring-engine.ts:700`).
- **Kegiatan:** memuat posisi beserta **semua** pemegang jabatannya. Jabatan non-unik (misalnya SALESMAN) dipangku banyak orang sekaligus, dan semuanya harus dikeluarkan dari kolam penggantinya sendiri.
- **Aktivitas basis data (DB utama):**
  - BACA `critical_positions` berdasarkan id.
  - BACA `critical_position_holders` berdasarkan `position_id`.
- **Hasil:** baris posisi beserta daftar `holders`, atau galat *"Posisi sasaran tidak ditemukan."*.

### 2.5 Muat program dan cek kecocokan

- **Pelaku:** server web. `getProgramTemplate` (`lib/programs.ts:144`), dicek di `lib/scoring-engine.ts:773`.
- **Kegiatan:** memuat template program yang dipilih. Satu posisi terdaftar pada tepat satu program (drizzle/0056). Bila `program_templates.code` berbeda dari `critical_positions.program_code`, run ditolak.
- **Aktivitas basis data (DB utama):** BACA `program_templates` berdasarkan id.
- **Hasil:**
  - `template`, yang berisi pohon aturan filter, `target_finalists`, `enforce_filter_rules`, `ahp_config`, dan kriteria.
  - Atau galat *"Posisi … terdaftar pada program lain…"*.
  - Bila tanpa program, `template = null`: tidak ada filter dan jumlah finalis bawaan 10.

### 2.6 Salin kriteria program ke posisi (sekali per posisi)

- **Pelaku:** server web, `syncTemplateCriteriaToPosition` (`lib/programs.ts:658`), dipanggil di `lib/scoring-engine.ts:780`.
- **Kegiatan:** bila posisi belum punya baris kriteria, kriteria program disalin. Nama dipetakan ke aspek kanonik, dan bobot diisi dengan bobot AHP program dalam persen. Kriteria yang namanya tidak cocok dengan aspek mana pun dilewati. Engine scoring **tidak membaca** tabel ini. Bobot selalu datang dari AHP (langkah 5A.14).
- **Aktivitas basis data (DB utama):**
  - BACA `criteria` untuk memeriksa apakah posisi sudah punya baris (`LIMIT 1`).
  - BACA `program_templates` (lagi).
  - TULIS `criteria`, satu baris per kriteria dengan `source_template_id` dan `category = 'score'`. Ini terjadi **hanya** bila posisi belum punya kriteria.
- **Hasil:** baris `criteria` untuk posisi yang belum pernah dinilai. Pada posisi yang sudah pernah dinilai, tidak ada yang ditulis.

### 2.7 Ambil calon anggota kolam

- **Pelaku:** server web (`lib/scoring-engine.ts:782-795`).
- **Kegiatan:** mengambil semua kandidat yang masih hidup dari business unit terpilih, lalu membuang kandidat yang dikecualikan pengguna di wizard. "Hidup" berarti `liveCandidate()`, yaitu `deleted_at IS NULL`. Kandidat yang di-*tombstone* tidak pernah masuk kolam.
- **Aktivitas basis data (DB utama):** BACA `candidates` (semua kolom) `WHERE tenant_id IN (…) AND deleted_at IS NULL`.
- **Hasil:** daftar id kandidat.

### 2.8 Susun kolam kandidat

- **Pelaku:** server web, `buildPoolFromCandidateIds` (`lib/scoring-engine.ts`).
- **Kegiatan:**
  1. Memuat ulang baris kandidat untuk id tersebut. Kompetensi teknis dan riwayat jabatan **tidak** dimuat di sini lagi: keduanya dulu hanya diringkas menjadi teks untuk prompt AI Tournament, dan engine AHP + TOPSIS membacanya sendiri (5A.2).
  2. Mendekripsi kolam kandidat (`decryptCandidateRows`, `lib/candidate-crypto.ts:122`). Hampir semua kolom kandidat tersimpan sebagai ciphertext `v1:…`, termasuk nama, grade, status MCU, PA, HAV, pendidikan, dan tanggal lahir. Kunci data sudah terbuka di memori proses web, karena layout dasbor memanggil `isLocked()` → `ensureUnlocked()` pada setiap render halaman (`app/(dashboard)/layout.tsx:37`, `lib/crypto/key-store.ts:98`). Pemanggilan itu membaca berkas kunci master dan baris `app_encryption_keys` yang aktif.
  3. Mengeluarkan **semua** pemegang jabatan. Pencocokannya lewat NPK (dalam beberapa varian padding nol) dan lewat nama yang dinormalisasi.
  4. Menyaring grade. Grade kandidat dibaca sebagai angka setelah huruf di belakangnya dibuang ("5a" → 5), dan harus berada di antara batas minimum dan maksimum. Batas dari wizard didahulukan; bila tidak ada, dipakai `min_grade_id` / `max_grade_id` milik posisi. Kandidat yang grade-nya tidak terbaca ikut gugur.
- **Aktivitas basis data (DB utama):**
  - BACA `candidates` berdasarkan id, tenant, dan status hidup.
- **Hasil:** `pool`, yaitu daftar kandidat yang lolos gerbang. Bila kosong, muncul galat *"Tidak ada kandidat aktif untuk Company ini."* (`:808`) dan tidak ada yang ditulis.

### 2.9 Terapkan aturan filter program

- **Pelaku:** server web. `loadFilterableCandidates` (`lib/programs.ts:588`) dan `applyProgramFilters` (`lib/programs.ts:512`), di blok `lib/scoring-engine.ts:818-858`.
- **Kegiatan:** langkah ini dijalankan bila program punya aturan, terlepas dari nilai `enforce_filter_rules`. Setiap anggota kolam dievaluasi terhadap pohon aturan program:
  - Aturan **advisory** (misalnya MCU, drizzle/0071) dilepas dari pohon sebelum keputusan lolos/gugur dibuat, lalu dinilai sendiri sebagai **tanda** (`flagged`). Aturan ini tidak pernah mengeluarkan siapa pun.
  - Aturan **hard** menentukan `qualified`. Grup yang kosong dianggap terpenuhi.
  - Bila `enforce_filter_rules` aktif, kandidat yang gagal dikeluarkan dan dicatat di `disqualified` dengan alasan berbentuk *"label: pesan"*. Bila tidak aktif, tidak ada yang dikeluarkan dan hanya tanda yang dicatat.
- **Aktivitas basis data (DB utama):** BACA `candidates` untuk kolom-kolom filter (status disiplin, status MCU, PA, kuadran HAV, rekomendasi behavior, masa kerja, pendidikan) dari semua tenant terpilih, lalu didekripsi. Ini adalah pembacaan **ketiga** atas `candidates` di fase ini.
- **Hasil:** `workingPool`, `disqualified[]`, dan `flagged[]`. Bila tidak tersisa satu kandidat pun, muncul galat *"Semua kandidat gagal aturan filter program …"* dan tidak ada yang ditulis.

### 2.10 Tentukan jumlah finalis dan urutan kolam

- **Pelaku:** server web (`lib/scoring-engine.ts`).
- **Kegiatan:**
  - Metodenya selalu `AHP_TOPSIS`. Wizard tidak lagi menawarkan pilihan metode, karena AI Tournament (LLM) sudah dihapus (lihat Fase 5B).
  - `targetFinalists = min(template.targetFinalists ?? 10, ukuran kolam)`.
  - Kolam diurutkan menurut `candidate.id` agar hasilnya deterministik. Kolam **tidak** diacak, berbeda dengan yang tertulis di CLAUDE.md (Temuan no. 16).
  - Seluruh kolam masuk `current_pool` dan `pending_pool` kosong.
- **Aktivitas basis data:** tidak ada.
- **Hasil:** larik id kandidat kolam.

### 2.11 Tulis baris sesi

- **Pelaku:** server web (`lib/scoring-engine.ts:891-907`).
- **Aktivitas basis data (DB utama):** TULIS `tournament_sessions`:

| Kolom | Nilai |
|---|---|
| `id` | UUID baru (bawaan DB) |
| `tenant_id` | business unit aktif |
| `position_id` | posisi sasaran |
| `program_template_id` | program, atau NULL |
| `label` | label dari wizard |
| `target_finalists` | hasil langkah 2.10 |
| `current_pool` | seluruh id kolam |
| `pending_pool` | `[]` |
| `scoring_method` | `ahp_topsis` (juga nilai bawaan kolom sejak `drizzle/0097_remove_llm_tournament.sql`, yang menghapus kolom peninggalan turnamen `stages` dan `carryover_losers`) |
| `status` | `running` |
| `final_ranked` | NULL (nanti diisi progres oleh scoring-service) |
| `run_id` | NULL (diisi di langkah 2.13) |
| `created_by` | `userId` |
| `created_at`, `updated_at` | waktu sekarang |

- **Hasil:** `session.id`. Sejak saat ini sesi sudah terlihat oleh penyapu sesi yatim karena statusnya `running`, tetapi masih terlindung masa tenggang 15 detik (langkah 4.4).

### 2.12 Tulis run penampung

- **Pelaku:** server web (`lib/scoring-engine.ts:912-947`).
- **Aktivitas basis data (DB utama):** TULIS `scoring_runs`:

| Kolom | Nilai |
|---|---|
| `id` | UUID baru |
| `position_id`, `tenant_id`, `program_template_id` | sama dengan sesi |
| `method` | `AHP_TOPSIS` |
| `program` | kode program (kolom cermin lama) |
| `label` | label wizard, atau `<nama program> — YYYY-MM-DD` bila kosong, dipotong maksimal 255 karakter (`clampRunLabel`) |
| `status` | `in_progress` |
| `rerun_mode` | `baseline` |
| `parent_run_id` | NULL |
| `candidate_count` | ukuran kolam setelah filter (diganti jumlah hasil saat run selesai) |
| `filter_summary` | `templateId`, `totalEvaluated`, `qualifiedCount`, `disqualifiedCount`, `disqualified[]` (id, nama, alasan), `minGradeId` / `maxGradeId` yang benar-benar dipakai, `includedTenantIds`, `flagged[]` |
| `config_snapshot` | dari `buildRunConfigSnapshot` (`:491`). Berisi salinan template program (pohon aturan, kriteria, matriks AHP, target finalis, `enforceFilterRules`, `updatedAt`) dan ambang readiness yang **dibaca langsung dari berkas** `lib/readiness-config.json`. Ditulis sekali dan tidak pernah diubah |
| `run_info` | NULL (diisi scoring-service saat selesai) |
| `created_by`, `created_at` | pengguna, waktu sekarang |
| `completed_at` | NULL |

- **Hasil:** `run.id`. Run langsung tampil di riwayat halaman posisi dengan status `in_progress`.

### 2.13 Tautkan sesi ke run

- **Pelaku:** server web (`lib/scoring-engine.ts:949-952`).
- **Aktivitas basis data (DB utama):** UBAH `tournament_sessions` SET `run_id`, `updated_at`.
- **Hasil:** sesi lengkap dan siap dikerjakan.

### 2.14 Dispatch, lalu kembalikan hasil ke peramban

- **Pelaku:** server web (`lib/scoring-engine.ts:971-983`).
- **Kegiatan:** memanggil `notifyScoringService` (Fase 3), lalu mengembalikan `{ sessionId, runId, positionId, programTemplateId, targetFinalists, totalCandidates, dispatch }`.
- **Aktivitas basis data:** tidak ada di langkah ini. Run baseline **tidak menulis `audit_log`** dan tidak memanggil `revalidatePath`. Kedua hal itu hanya dilakukan jalur rerun (bagian *Jalur start lain*).
- **Hasil:** wizard menerima `sessionId` dan status dispatch.

### Ringkasan Fase 2

| Langkah | Tabel yang dibaca | Tabel yang ditulis |
|---|---|---|
| 2.1 Izin | `app_roles`, `app_role_permissions`, `users` | (`app_roles`, `app_role_permissions` sekali, bila kosong) |
| 2.3 Identitas | `users` | `users` (upsert) |
| 2.4 Posisi | `critical_positions`, `critical_position_holders` | — |
| 2.5 Program | `program_templates` | — |
| 2.6 Kriteria | `criteria`, `program_templates` | `criteria` (sekali per posisi) |
| 2.7–2.9 Kolam & filter | `candidates` (3×) | — |
| 2.11–2.13 Sesi & run | — | `tournament_sessions` (TULIS, lalu UBAH), `scoring_runs` |
| Berkas | `lib/readiness-config.json` | — |

---

## Fase 3 — Dispatch ke scoring-service

**Titik masuk:** `notifyScoringService` (`lib/scoring-engine.ts:995`). Fungsi ini dipanggil oleh **semua** jalur yang memulai scoring: wizard, rerun, eksklusi, tambah massal, dan scoring ulang program.

### 3.1 Pemetaan nama kompetensi ke kode kamus

- **Pelaku:** server web. `primeCompetencyNames` (`lib/kamus-name-match-actions.ts:78`) memanggil `resolveCompetencyNames` (`lib/kamus-name-match.ts:374`).
- **Kegiatan:** identitas sebuah kompetensi adalah **kode kamus**, bukan namanya. Nama dari PDF job profile yang diekstrak LLM sering berbeda ejaan dari kamus. Langkah ini mengumpulkan **semua** nama kompetensi di sistem, bukan hanya milik posisi ini, lalu mencoba memetakan setiap nama yang belum punya kode secara berjenjang:
  1. sama persis dengan nama di kamus (setelah dinormalisasi);
  2. ada keputusan lama di cache;
  3. kecocokan token deterministik yang **unik** di kamus; hasilnya disimpan ke cache;
  4. LLM, yang hanya boleh menyatakan kesetaraan **ejaan** dengan keyakinan minimal 0,9 (`KAMUS_AI_MIN_CONFIDENCE`). Tingkat ini dibatasi `KAMUS_AI_MAX_NAMES_PER_RUN` (bawaan 12) nama per start, dengan konkurensi 4 dan batas waktu 30 detik per panggilan. Jawaban "tidak ada padanan" juga di-cache, supaya nama yang sama tidak menghabiskan panggilan lagi pada run berikutnya. Nama yang melewati batas tidak hilang; ia tetap menunggu run berikutnya atau tombol "Petakan" di `/settings/sync`.

  Pemetaan ini sengaja dilakukan di web app, bukan di scoring-service. Alasannya, scoring harus tetap bisa berjalan tanpa model apa pun, sebab penyapu sesi yatim memulai ulang sesi tanpa ada orang yang menunggu. scoring-service hanya **membaca** cache-nya.
- **Aktivitas basis data (DB utama):**
  - BACA, dalam satu kueri `UNION ALL` + `DISTINCT`:
    - `sync_job_profiles.extracted_data → technicalCompetencies`
    - `candidate_technical_competencies.technical_name`
    - `sync_technical_competencies.technical_name`
    - `critical_positions.required_competencies`
  - BACA `sync_kamus_kompetensi` (kode, nama).
  - BACA `kamus_competency_match_cache` untuk nama yang belum cocok persis.
  - TULIS `kamus_competency_match_cache` (upsert per keputusan: `name_key`, `name`, `code`, `tier`, `confidence`, `reason`, `model`).
- **Panggilan luar:** `POST {LLM_BASE_URL}/chat/completions` (`temperature 0`, `response_format: json_object`), satu panggilan per nama di tingkat 4.
- **Hasil:** cache pemetaan yang lebih lengkap. scoring-service membacanya di langkah 5A.5. Langkah ini **tidak pernah menggagalkan start**: semua galat ditelan dan hanya dicatat di log. Bila tabel cache belum dimigrasi, hanya tingkat 1 yang berlaku.

### 3.2 Kirim sinyal ke scoring-service

- **Pelaku:** server web (`lib/scoring-engine.ts:1007-1062`).
- **Kegiatan:** mengirim `POST {SCORING_SERVICE_URL}/api/scoring/start` dengan body `{"sessionId": "…"}` dan batas waktu 5 detik (`AbortController`). Fungsi ini **tidak pernah melempar galat**, karena sesi dan run sudah tersimpan. Hasilnya berupa `ScoringDispatch`:

| Kondisi | `status` | `reason` | Pesan di layar |
|---|---|---|---|
| Layanan membalas 2xx | `dispatched` | — | Progres diperbarui otomatis |
| `SCORING_SERVICE_URL` kosong | `queued` | `unconfigured` | Layanan belum dikonfigurasi; sesi masuk antrean |
| Layanan membalas non-2xx (misalnya 404, 409, 500) | `queued` | `rejected` | Layanan menolak (HTTP n); layanannya hidup, laporkan kodenya |
| Koneksi ditolak, DNS gagal, atau lewat 5 detik | `queued` | `unreachable` | Layanan tidak merespons; sesi masuk antrean, tidak perlu dimulai ulang |

  Hanya kode status HTTP yang diperiksa. Isi respons (`queued`, `alreadyRunning`, `capacity`) **tidak dibaca**, sehingga sesi yang ditolak scoring-service karena kapasitas penuh tetap dilaporkan sebagai `dispatched` (Temuan no. 5).
- **Aktivitas basis data:** tidak ada.
- **Hasil:** objek `dispatch` dikembalikan bersama `sessionId` dan `runId`.

---

## Fase 4 — scoring-service menerima dan menjadwalkan

### 4.1 Rute `POST /api/scoring/start`

- **Pelaku:** scoring-service (`scoring-service/src/routes.ts:30`).
- **Kegiatan:**
  - Memvalidasi body dengan zod (`sessionId` harus UUID); bila tidak valid, membalas 400.
  - Memuat sesi; bila tidak ada, membalas 404.
  - Bila sesi `completed`, membalas 200 `alreadyComplete`. Bila `failed`, membalas 409.
  - Selain itu memanggil `startSessionProcessing`.
- **Aktivitas basis data (DB utama):** BACA `tournament_sessions` berdasarkan id (`loadSession`, `scoring-service/src/scoring-engine.ts`).
- **Hasil:** 200 `{ accepted, alreadyRunning, queued, capacity }`.

### 4.2 Penjadwalan di dalam proses

- **Pelaku:** scoring-service, `startSessionProcessing` (`scoring-service/src/runner.ts:27`).
- **Kegiatan:** proses menyimpan peta `inflight` (sessionId → `AbortController`) **di memori**.
  - Bila sesi sudah ada di peta, tidak terjadi apa-apa.
  - Bila jumlah sesi yang sedang berjalan sudah mencapai `SCORING_MAX_CONCURRENT` (bawaan 2), permintaan ditolak. Sesi tetap `running` tanpa pekerja, dan inilah yang dimaksud dengan "antre". Tidak ada tabel antrean.
  - Selain itu sesi didaftarkan dan `processLoop` dijalankan di latar tanpa ditunggu.
- **Aktivitas basis data:** tidak ada.
- **Hasil:** pekerjaan berjalan di latar, dan respons HTTP langsung kembali ke web app.

### 4.3 `processLoop`

- **Pelaku:** scoring-service (`scoring-service/src/runner.ts:101`).
- **Kegiatan:**
  - Memuat sesi. Bila `scoring_method = 'ahp_topsis'`, dijalankan Fase 5A. Sesi bermetode lain (misalnya `sequential`, yang masih bisa diantrekan web app versi lama sebelum `drizzle/0097_remove_llm_tournament.sql` dijalankan) **tidak dinilai**: ia langsung gagal dengan pesan *"Metode AI Tournament (LLM) sudah dihapus; sesi ini tidak dinilai. Mulai scoring baru dengan AHP + TOPSIS."*, alih-alih tertahan `running` dan dipungut penyapu tanpa henti.
  - Bila engine melempar galat, sesi ditandai `failed`.
  - Pada akhirnya sesi selalu dihapus dari `inflight`, sehingga slotnya bebas.
- **Aktivitas basis data (DB utama):**
  - BACA `tournament_sessions`.
  - Bila gagal, UBAH `tournament_sessions` SET `status = 'failed'`. **Hanya sesi** yang diubah; baris `scoring_runs` dibiarkan `in_progress` (Temuan no. 1).
- **Hasil:** sesi `completed` atau `failed`.

### 4.4 Penyapu sesi yatim dan pemulihan saat menyala

- **Pelaku:** scoring-service (`scoring-service/src/runner.ts:154-203`, dipasang di `scoring-service/src/index.ts:32-39`).
- **Kegiatan:**
  - Saat proses menyala, `resumeInterruptedSessions()` mengambil **semua** sesi `running` tanpa masa tenggang. Pada saat itu `inflight` masih kosong, jadi semuanya memang yatim.
  - Sesudahnya, setiap `ORPHAN_SWEEP_INTERVAL_MS` (bawaan 10 detik), penyapu mengambil sesi `running` yang `updated_at`-nya lebih tua dari `ORPHAN_SWEEP_GRACE_MS` (bawaan 15 detik) dan tidak ada di `inflight`. Sesi itu lalu dijalankan lewat `startSessionProcessing`, tetap tunduk pada batas konkurensi.
  - Engine memperbarui `updated_at` setiap kali menulis progres, sehingga sesi yang sedang dikerjakan biasanya tidak tampak yatim.
- **Aktivitas basis data (DB utama):** BACA `tournament_sessions` `WHERE status = 'running' AND updated_at < NOW() − masa_tenggang`.
- **Hasil:** sesi yang sinyalnya hilang, yang ditolak karena kapasitas penuh, atau yang terputus karena restart, tetap dikerjakan. Hanya status `running` yang dipungut.

---

## Fase 5A — Engine AHP + TOPSIS

**Titik masuk:** `runAhpTopsisSession` (`scoring-service/src/ahp-topsis-engine.ts:5423`). Sejak versi 1.5 ini satu-satunya engine scoring.

Peringkat metode ini dihitung secara deterministik dari enam skor aspek. Model bahasa hanya dipakai di dua tempat: Gemini menilai aspek pendidikan bila jenjang dan jurusan tidak cocok persis (hasilnya ikut menjadi skor pendidikan), dan LLM menulis narasi finalis (tidak memengaruhi skor; tidak dipanggil pada run mode demo). Model embedding dipakai untuk mencocokkan judul jabatan ke job profile.

Progres setiap fase ditulis oleh `setAhpProgress` (`:5313`) dengan pernyataan `UPDATE tournament_sessions SET final_ranked = final_ranked || {ahpProgress}, updated_at = NOW()`. Penggabungan `||` dipakai agar spesifikasi rerun yang tersimpan di kunci yang sama tidak terhapus. Penulisan progres ini juga memperbarui `updated_at`, sehingga penyapu tidak memungut sesi yang sedang dikerjakan.

| Fase progres | Label di wizard | Persentase |
|---|---|---|
| `load` | Memuat data kandidat & job profile | 10% |
| `technical` | Aspek 1/6 — Technical Competency | 25% |
| `career` | Aspek 2/6 — Career Relevance | 40% |
| `behavior` | Aspek 3/6 — Behavior (sekaligus PA dan HAV) | 50% |
| `education` | Aspek 6/6 — Education | 60–91% |
| `topsis` | Menghitung bobot AHP & perangkingan TOPSIS | 92% |
| `narrative` | Menulis insight suksesi per finalis (LLM) | 94% |
| `persist` | Menyimpan hasil peringkat | 96% |
| `completed` | Selesai | 100% |

Wizard juga punya label `performance` dan `hav`, tetapi engine tidak pernah melaporkan keduanya secara terpisah. Ketiganya dihitung dalam fase `behavior`.

### 5A.1 Muat sesi dan spesifikasi run

- **Pelaku:** scoring-service (`:5427-5490`).
- **Kegiatan:**
  - Bila sesi sudah `completed`, engine langsung selesai (idempoten). Bila sesi tidak punya `run_id`, muncul galat *"Sesi tidak memiliki run ID."*.
  - Spesifikasi rerun dibaca dari `final_ranked.ahpRerun` (`parseRerunSpec`, `scoring-service/src/rerun-freeze.ts`). Sesi yang membawa mode lama atau kunci lama `ahpAugment`, `ahpExclude`, atau `ahpAlwaysInclude` ditolak dengan pesan yang menyuruh membuat ulang lewat "Tambah Kandidat Pembanding". Pada run baseline spesifikasinya kosong.
  - Kandidat yang dikecualikan dibuang dari kolam.
- **Aktivitas basis data (DB utama):** BACA `tournament_sessions`, lalu UBAH `final_ranked.ahpProgress = load`.
- **Hasil:** daftar id kandidat yang akan dinilai.

### 5A.2 Muat posisi, kandidat, dan bahan rerun (paralel)

- **Pelaku:** scoring-service (`:5497-5517`).
- **Kegiatan dan aktivitas basis data (DB utama):**
  - **Posisi:** `loadPositionRow` (`scoring-service/src/scoring-engine.ts`).
    - BACA `critical_positions` (judul, departemen, divisi, pendidikan, pengalaman, `required_competencies`, pemegang jabatan utama).
    - Pencarian job profile versi ringan: BACA pemetaan Job Family lewat `critical_positions` ⋈ `candidates` ⋈ `job_family_matches`, digabung dengan `critical_positions` ⋈ `positions` ⋈ `job_family_matches` (`findMatchedJobProfileId`). Lalu BACA `sync_job_profiles` (berstatus `completed`) berdasarkan id hasil pemetaan, atau semuanya bila harus dicocokkan lewat judul.
    - BACA `sync_kamus_kompetensi` (seluruh baris) untuk definisi kompetensi.
  - **Kandidat:** `loadAhpCandidates` (`ahp-topsis-engine.ts:1040`).
    - `ensureUnlocked()` membuka kunci data sekali per proses (`scoring-service/src/services/crypto.ts:168`). Ia membaca **berkas** `secrets/master.key` (atau `PULSE_MASTER_KEY`) dan BACA `app_encryption_keys` yang aktif.
    - BACA `candidates` berdasarkan id, `deleted_at IS NULL`, `ORDER BY id`. Kolom yang dibaca: nama, NPK, jabatan saat ini, masa kerja, pendidikan, jurusan, status disiplin, status MCU, PA, rekomendasi dan catatan behavior, kuadran HAV. Semuanya didekripsi; nilai yang gagal didekripsi menjadi NULL.
    - BACA `candidate_technical_competencies`.
    - BACA `candidate_position_history` LEFT JOIN `sync_employee_positions`, untuk melengkapi tanggal mulai dan selesai tiap jabatan.
  - **Bahan rerun** (hanya bila ada run dasar):
    - BACA `analysis_results` dan `scoring_run_pool_aspects` milik run dasar (`loadCachedAspects`; `loadBasePoolEntries`).
    - Basis beku dibawa oleh sesi itu sendiri (`ahpRerun.frozen`, disusun web app dengan `resolveFrozenBasis`): vektor bobot induk presisi penuh beserta CR/λmax/CI-nya, kriteria aktif, jangkar teknis dan karier, target kedalaman, tanggal acuan, model, dan **basis posisi** (`run_info.frozen.positionBasis` induk: job profile, acuan kompetensi, syarat pendidikan, dokumen target karier). Kandidat baru dinilai terhadap basis itu, bukan terhadap job profile hari ini. Bagian yang tidak disimpan induk lama dibaca saat itu dan ditandai `live_fallback`.
- **Hasil:** objek posisi dan kandidat lengkap. Galat *"Sesi tidak memiliki kandidat aktif."* muncul bila tidak ada kandidat. Pada run baseline semua kandidat masuk daftar "dinilai baru" (`toScore`).

### 5A.3 Cari job profile posisi sasaran (versi AHP)

- **Pelaku:** scoring-service, `findJobProfileForPosition` (`ahp-topsis-engine.ts:1174`).
- **Kegiatan:** mencari dokumen job profile dalam empat tingkat:
  1. pemetaan Job Family (`job_family_matches`);
  2. judul sama persis;
  3. judul saling memuat (nama profil terpanjang didahulukan);
  4. embedding: kemiripan kosinus antara judul posisi dan semua nama profil, dengan ambang 0,98 untuk model E5 dan 0,8 untuk model lain.

  Hasilnya adalah tujuan jabatan, tanggung jawab beserta indikator keberhasilannya, kompetensi wajib beserta levelnya, syarat pendidikan, dan tantangan jabatan.
- **Aktivitas basis data (DB utama):**
  - BACA `sync_job_profiles` (semua berstatus `completed` yang punya `position_name`).
  - BACA `critical_positions`, `candidates`, `job_family_matches`, dan `positions` (pemetaan tingkat 1).
- **Panggilan luar:** layanan embedding (`embedTexts`, `scoring-service/src/embeddings.ts:174`), **hanya** bila tingkat 1–3 gagal. Satu permintaan per 32 teks, berisi judul posisi ditambah semua nama profil.
- **Hasil:** `JobProfileMatch`, atau `null` bila tidak ada yang cocok.

### 5A.4 Kode jabatan posisi sasaran

- **Pelaku:** scoring-service (`:5582-5596`).
- **Aktivitas basis data (DB utama):** BACA `critical_positions` LEFT JOIN `positions` untuk mendapatkan `positions.position_id` (kode jabatan master).
- **Hasil:** kode jabatan yang sudah dinormalisasi (huruf besar, tanpa spasi), dipakai di aspek teknis dan karier.

### 5A.5 Peta nama kompetensi ke kode kamus

- **Pelaku:** scoring-service, `loadKamusNameToCode` (`scoring-service/src/kamus-codes.ts:48`).
- **Aktivitas basis data (DB utama):**
  - BACA `sync_kamus_kompetensi` (kode, nama).
  - BACA `kamus_competency_match_cache` yang `code IS NOT NULL`. Inilah hasil langkah 3.1. Nama yang persis ada di kamus selalu menang atas isi cache.
- **Hasil:** peta "nama ternormalisasi → kode kamus", ditambah hitungan `kamusResolvedByCache` untuk diagnosis.

### 5A.6 Kalibrasi skala kemiripan teknis

- **Pelaku:** scoring-service, `resolveTechnicalAnchors` (`scoring-service/src/technical-anchors.ts:213`).
- **Kegiatan:** menentukan `simFloor` dan `simCeil`, yaitu batas untuk merentangkan kosinus antar-kompetensi ke skala 0..1.
  - Bila `TECHNICAL_SIM_FLOOR` dan `TECHNICAL_SIM_CEIL` diset, nilainya dipakai apa adanya.
  - Bila tidak, dihitung **sidik jari** korpus kamus: md5 atas `(code, level, content_hash)` seluruh baris ditambah nama model. Bila sidik jari sama dengan yang tersimpan, nilai lama dipakai.
  - Bila berbeda, dijalankan **sensus**: untuk setiap baris, dicari kemiripan terbaik dengan kompetensi lain (kode berbeda). Floor = persentil 25 dan ceil = persentil 99 dari sebaran itu. Hasilnya disimpan.
  - Bila korpus terlalu kecil atau sebarannya terlalu sempit, dipakai konstanta cadangan.
- **Aktivitas basis data:**
  - DB vektor: BACA `kamus_kompetensi_level_embed` untuk sidik jari dan, bila perlu, sensus (*self-join* `<=>`).
  - DB utama: BACA `kamus_similarity_calibration`. TULIS (upsert) `kamus_similarity_calibration` hanya bila sensus dijalankan ulang.
- **Hasil:** `technicalAnchors`, yaitu floor, ceil, sumber (`env` / `measured` / `fallback`), dan alasannya. Wadah vektor level dibuat di sini (`createLevelVectorStore`, `:1422`); vektornya baru diambil saat dibutuhkan.

### 5A.7 Kalibrasi skala kemiripan karier

- **Pelaku:** scoring-service, `resolveCareerAnchors` (`scoring-service/src/career-anchors.ts:671`).
- **Kegiatan:** sama seperti 5A.6, tetapi atas korpus dokumen job profile, dan menggunakan **tiga estimator** yang diambil nilai tengahnya.
  - Bila `CAREER_SIM_FLOOR` dan `CAREER_SIM_CEIL` diset, nilainya dipakai apa adanya.
  - Bila tidak, dihitung sidik jari gabungan dari empat hal: md5 isi `job_profile_embed`, model, identitas run pengelompokan job family terakhir, dan hash riwayat jabatan karyawan, ditambah `METHOD_VERSION`.
  - Bila sidik jari berubah, ketiga estimator diukur ulang:
    - **corpus**: sebaran kemiripan antar-dokumen;
    - **family**: ambang presisi terhadap label job family hasil topic-service;
    - **transitions**: kemiripan perpindahan jabatan yang benar-benar terjadi.

    Label diambil dari DB utama, lalu dikirim ke DB vektor sebagai larik id lewat `unnest`, bukan lewat join.
- **Aktivitas basis data:**
  - DB vektor: BACA `job_profile_embed` (sidik jari, sensus corpus, pasangan family, pasangan transitions).
  - DB utama:
    - BACA `job_family_topic_runs` dan `job_family_topic_assignments`, yaitu hasil topic-service.
    - BACA `candidate_position_history` (hash dan urutan perpindahan).
    - BACA `sync_job_profiles` (kode berkas dan judul).
    - BACA `job_profile_similarity_calibration`.
    - TULIS (upsert baris tunggal) `job_profile_similarity_calibration`, hanya bila diukur ulang.
- **Hasil:** `careerAnchors`, berisi floor, ceil, rincian ketiga estimator, dan alasannya.

### 5A.8 Set kompetensi acuan posisi sasaran

- **Pelaku:** scoring-service, `resolveTargetRequiredSet` (`ahp-topsis-engine.ts:2147`).
- **Kegiatan:** memilih acuan kompetensi dari tingkat paling berwenang, dan berhenti di tingkat pertama yang berisi:
  1. `profile`: kompetensi teknis di job profile, lengkap dengan level;
  2. `critical_position`: daftar kompetensi wajib posisi, levelnya dianggap Intermediate (2);
  3. `incumbent`: hasil asesmen pemegang jabatan, pada level yang dituntut jabatan;
  4. `position_aggregate`: gabungan semua pemegang kode jabatan itu, dengan level maksimum.
- **Aktivitas basis data (DB utama):**
  - Tingkat 3: BACA `sync_technical_competencies` milik pemegang jabatan.
  - Tingkat 4: BACA `sync_employee_positions` (para pemegang kode jabatan), lalu BACA `sync_technical_competencies` milik mereka.
  - Tingkat 1 dan 2 tidak membaca basis data lagi.
- **Hasil:** daftar kompetensi acuan beserta sumbernya (`requiredSource`). Bila semua tingkat kosong, sumbernya `none` dan kriteria teknis nanti dibuang (5A.15).

### 5A.9 Pendidikan pemegang jabatan sebagai acuan cadangan

- **Pelaku:** scoring-service (`:5634-5673`).
- **Aktivitas basis data (DB utama):** BACA `candidates` (pendidikan dan jurusan pemegang jabatan, dicocokkan lewat `LPAD(employee_id, 5, '0')`), lalu didekripsi.
- **Hasil:** teks syarat pendidikan cadangan, dipakai bila job profile maupun posisi tidak menyatakannya.

### 5A.10 Aspek 1 — kompetensi teknis

- **Pelaku:** scoring-service, `scoreTechnicalAspect` (`ahp-topsis-engine.ts:2280`), dengan progres `technical`.
- **Kegiatan:** untuk setiap kandidat, kompetensinya dipasangkan dengan kompetensi acuan.
  - Pasangan **identitas** (kode kamus sama, atau nama sama bila keduanya tak berkode) diselesaikan lebih dahulu.
  - Sisanya dipasangkan dengan algoritma Hungarian, dengan nilai sel `sim′ × levelFactor`.
  - Skor = rata-rata nilai pasangan, dijenuhkan pada 1, lalu × 100.

  Rumus lengkapnya ada di `docs/rumus-kriteria-ahp-topsis.md`.
- **Aktivitas basis data:**
  - DB vektor: BACA `kamus_kompetensi_level_embed` untuk semua kode yang dibutuhkan, dalam **satu kueri**.
  - DB utama: UBAH progres setiap 5 kandidat.
  - Tidak ada panggilan model.
- **Hasil:** skor teknis 0–100 per kandidat beserta rincian pemasangan (`TechnicalDetail`). Rincian ini disimpan di 5A.19 dan 5A.20, lalu ditampilkan di tab Readiness halaman posisi (Fase 7). Bila vektor tidak tersedia, pasangan semantik bernilai 0 dan hanya pasangan identitas yang dihitung.

### 5A.11 Aspek 2 — relevansi karier

- **Pelaku:** scoring-service, `scoreCareerAspect` (`ahp-topsis-engine.ts:3469`), dengan progres `career`.
- **Kegiatan:**
  1. Setiap jabatan dalam riwayat kandidat dipasangkan ke dokumen job profile. Tingkatnya: kode jabatan di nama berkas → pemetaan Job Family → judul persis → embedding (≥ 0,98).
  2. Posisi sasaran dipasangkan dengan cara yang sama, ditambah dua tingkat: kode jabatan pemegang jabatan, dan **dokumen sintetis** bila posisi tak punya job profile.
  3. Kemiripan kosinus direntangkan dengan anchors dari 5A.7.
  4. Kemiripan itu dikalikan lama menjabat dan faktor peluruhan usia (`exp(−0,043 × tahun sejak berakhir)`), lalu diakumulasi dan dibandingkan dengan target kedalaman `T`. Urutan sumber `T`: pernyataan pengalaman di JD → median pengangkatan nyata per tingkat jabatan → konstanta.
  5. Jabatan yang tak punya dokumen dinilai dari kompetensi para pemegangnya, berbobot IDF, dengan batas atas.
- **Aktivitas basis data:**
  - DB utama:
    - BACA `sync_job_profiles` (id, judul, nama berkas).
    - BACA `job_family_matches` LEFT JOIN `candidates`.
    - BACA `critical_positions`, `candidates`, `job_family_matches`, dan `positions` (pemetaan posisi sasaran).
    - BACA `sync_employee_positions` (kode jabatan pemegang jabatan, bila posisi sasaran belum terpasang).
    - BACA `sync_job_profiles` (`jobSpecification.experience` milik JD sasaran).
    - BACA `sync_positions.summary` (bahan dokumen sintetis).
    - BACA `sync_job_profiles` (hitungan, lalu sensus IDF bila hitungannya berubah; disimpan di memori proses).
    - BACA `sync_employee_positions` dan `sync_technical_competencies` (cadangan berbasis kompetensi pemegang).
    - BACA `candidate_position_history` (hitungan, lalu sensus kedalaman bila berubah; disimpan di memori proses).
    - UBAH progres.
  - DB vektor:
    - BACA `job_profile_embed` untuk vektor dokumen yang dibutuhkan, dan untuk model embedding yang paling banyak dipakai (keperluan dokumen sintetis).
    - BACA `kamus_kompetensi_level_embed` (kode tambahan untuk cadangan).
- **Panggilan luar:** layanan embedding untuk judul jabatan yang tidak terpasang lewat tingkat deterministik (satu batch). Satu panggilan lagi untuk dokumen sintetis posisi sasaran, dengan model yang sama dengan model yang mengisi `job_profile_embed`.
- **Hasil:** skor karier 0–100 per kandidat, rincian per jabatan (`CareerDetail`), dan diagnosis tingkat run (`runInfo.career`: skala, kedalaman, kalibrasi, sumber target).

### 5A.12 Aspek 3–5 — behavior, kinerja (PA), dan HAV

- **Pelaku:** scoring-service, dengan progres `behavior`.
  - `scoreBehaviorAspect` (`:4560`): kategorisasi ordinal rekomendasi behavior.
  - `scorePerformanceAspect` (`scoring-service/src/pa-score.ts`): TOPSIS solusi absolut atas riwayat grade PA.
  - `computeHavScore` (`scoring-service/src/scoring-engine.ts`): skor per kelompok kuadran HAV. Data kosong diberi 40.
- **Kegiatan:** dihitung murni dari kolom kandidat yang sudah dimuat di 5A.2.
  - Pada rerun yang membekukan aspek, nilai dari run dasar dipakai.
  - Pada rerun, `freshness` juga dihitung: berapa kandidat yang nilai behavior, PA, atau HAV-nya berubah sejak run dasar.
- **Aktivitas basis data:** hanya UBAH progres.
- **Hasil:** tiga skor 0–100 per kandidat, ditambah teks mentah yang dipakai (`rawInputs`).

### 5A.13 Aspek 6 — pendidikan

- **Pelaku:** scoring-service, `scoreEducationAspect` (`ahp-topsis-engine.ts:5109`), dengan progres `education`.
- **Kegiatan:**
  - Syarat pendidikan diambil dari job profile, atau dari posisi, atau dari pendidikan pemegang jabatan (5A.9).
  - Bila jenjang dan jurusan cocok persis, skornya tetap: 100 (di atas syarat), 80 (setara), atau 50 (di bawah).
  - Bila tidak cocok persis, kandidat dinilai Gemini dengan grounding Google Search — **kecuali** run AHP + TOPSIS terakhir yang selesai pada posisi yang sama sudah menanyakan pertanyaan yang persis sama tentang kandidat itu (kunci masukan atas seluruh teks yang dikirim ke model, tanpa nama). Jawaban model itu dipakai ulang dan model tidak dipanggil; sumbu jenjang tetap dihitung dengan aturan run ini (`scoring-service/src/education-reuse.ts`, `AHP_EDUCATION_REUSE`, bawaan menyala).
  - Bila `GEMINI_API_KEY` kosong atau semua percobaan gagal, sumbernya `none` dan skornya 0. Hasil gagal tidak pernah dipakai ulang.
- **Aktivitas basis data:** BACA run terakhir posisi (`scoring_runs`) dan evaluasi pendidikannya (`scoring_run_pool_aspects.details.educationEval`) sekali sebelum penilaian; selebihnya hanya UBAH progres (setiap 5 kandidat).
- **Panggilan luar:** Gemini (`callGeminiGrounded`, `scoring-service/src/gemini.ts:35`), satu panggilan per kandidat yang tidak cocok persis dan jawabannya tidak bisa dipakai ulang. Konkurensinya `EDUCATION_LLM_CONCURRENCY` (bawaan 4), dengan maksimal `EDUCATION_LLM_MAX_RETRIES` (bawaan 2) percobaan ulang. Parameternya `temperature 0` dan `topP 0`.
- **Hasil:** skor pendidikan beserta penilaiannya (`EducationEvaluation`: sumber, perbandingan jenjang, relevansi jurusan, kueri pencarian, sumber kutipan).

### 5A.14 Bobot AHP

- **Pelaku:** scoring-service, `resolveAhpWeights` (`scoring-service/src/ahp-weights.ts:81`), dengan progres `topsis`.
- **Kegiatan:** pada run turunan, bobot **tidak dihitung ulang**: vektor bobot induk dipakai pada presisi penuh, beserta CR, λmax, dan CI induk (`frozenWeights`). Pada run root ada dua sumber:
  - `program_templates.ahp_config` milik program;
  - bobot bawaan sistem: behavior 35, technical 25, HAV 20, PA 10, career 5, education 5.

  Lalu dihitung bobot, λmax, CI, dan CR. Matriks dengan CR > 0,1 tidak dapat disimpan di Tata Kelola sejak awal; engine tidak memeriksa ulang CR, tetapi mencatat matriks yang tidak konsisten bila ada.
- **Aktivitas basis data (DB utama):** BACA `program_templates.ahp_config`.
- **Hasil:** bobot per aspek dan sumbernya (`inherited` / program / bawaan).

### 5A.15 Buang kriteria yang tak terukur, lalu TOPSIS

- **Pelaku:** scoring-service (`:5935-6043`).
- **Kegiatan:**
  - Kriteria yang tidak bisa diukur siapa pun **dibuang**, lalu bobotnya dinormalisasi ulang:
    - teknis, bila tidak ada acuan atau tak satu pun acuan terukur;
    - karier, bila posisi tak punya dokumen maupun acuan kompetensi;
    - pendidikan, bila tak satu kandidat pun bisa dinilai.
  - TOPSIS klasik dijalankan atas **seluruh kolam**, dengan semua kriteria bersifat benefit.
  - Kandidat diurutkan berdasarkan *closeness* menurun; bila sama, berdasarkan `id`.
- **Aktivitas basis data:** tidak ada.
- **Hasil:** *closeness*, d+, d−, dan peringkat kolam (`poolRank`) untuk setiap kandidat.

### 5A.16 Potongan finalis dan daftar hasil

- **Pelaku:** scoring-service, `composeChildResultList` (`scoring-service/src/rerun-freeze.ts`).
- **Kegiatan:** pada run root, daftar hasil adalah `target_finalists` teratas. Pada run turunan, daftar hasil adalah gabungan tanpa duplikasi dari N besar menurut peringkat baru (N = jumlah finalis induk), seluruh finalis induk, dan seluruh kandidat pembanding; setiap baris memakai peringkat kolam penuhnya dan diberi penanda kandidat pembanding, baru masuk N besar, atau keluar dari N besar.
- **Aktivitas basis data:** tidak ada.
- **Hasil:** daftar `ranked` (baris hasil) dan `rankedAll` (seluruh kolam).

### 5A.17 Bersihkan hasil lama run ini

- **Pelaku:** scoring-service, dengan progres `persist`.
- **Aktivitas basis data (DB utama):**
  - HAPUS `analysis_results` `WHERE run_id = run ini`.
  - HAPUS `scoring_run_pool_aspects` `WHERE run_id = run ini`.
- **Hasil:** run ini bersih dari hasil percobaan sebelumnya. Inilah yang membuat engine aman dijalankan ulang setelah restart. Langkah ini hanya mungkin selama run belum `completed`; setelah itu basis data menolak setiap perubahan (drizzle/0087).

### 5A.18 Simpan aspek seluruh kolam

- **Pelaku:** scoring-service.
- **Aktivitas basis data (DB utama):** TULIS `scoring_run_pool_aspects`, per 50 baris, satu baris per kandidat yang dinilai (bukan hanya finalis). Kolom yang diisi:
  - `pool_rank`
  - `closeness` (6 desimal)
  - `is_finalist`
  - `aspects` (enam skor)
  - `details`: `technicalMatching`, `careerMatching`, `educationEval`, `rawInputs`, serta kedekatan, d+, dan d− presisi penuh

  Pernyataannya memakai `ON CONFLICT (run_id, candidate_id) DO NOTHING`. Galat tulis hanya dicatat di log.
- **Hasil:** "foto" seluruh kolam. Inilah yang dipakai run turunan untuk memakai ulang skor kandidat lama, dan yang dipakai perbandingan run untuk menghitung ulang TOPSIS.

### 5A.19 Simpan baris hasil

- **Pelaku:** scoring-service.
- **Aktivitas basis data (DB utama):** TULIS `analysis_results`, satu baris per baris daftar hasil:

| Kolom | Nilai |
|---|---|
| `run_id`, `position_id`, `candidate_id` | — |
| `method` | `AHP_TOPSIS` |
| `final_score` | *closeness* (0..1, 6 desimal) |
| `rank` | peringkat dalam **seluruh kolam**, bukan nomor baris |
| `manual_rank` | NULL (diisi kemudian oleh penataan seri manual) |
| `details` | JSON berbentuk teks: `scoreBreakdown` enam aspek; `weightedScore = round(closeness × 100)`; `readiness` dari ambang **snapshot run itu** (pada run turunan: ambang induk), bukan dari ambang hari ini; narasi templat deterministik dengan `narrativeSource = template`; serta blok `ahpTopsis` yang memuat bobot, bobot efektif, kriteria yang dibuang, CR, d+/d−, rincian keenam aspek, sumber job profile, `poolRank`, `finalistCut`, `poolSize`, dan penanda baris turunan |
| `calculated_by` | `tournament_sessions.created_by` |
| `calculated_at` | `NOW()` |

- **Hasil:** peringkat sudah tersimpan (`rankingReadyAt`). Narasi model bahasa menyusul dan tidak dapat menahan peringkat.

### 5A.20 Narasi per baris

- **Pelaku:** scoring-service, `runAhpNarrativeAgent` (`scoring-service/src/ahp-narrative.ts`), dengan progres `narrative`.
- **Kegiatan:** satu panggilan LLM untuk setiap baris hasil, menghasilkan kekuatan, kelemahan, dan rekomendasi, dengan skor akhir sebagai konteks baca-saja.
  - Prompt diambil dari berkas `lib/scoring-prompts.json` (kunci `ahp_narrative_agent`), dengan prompt bawaan sebagai cadangan.
  - Langkah ini dilewati bila `AHP_NARRATIVE_LLM=false`, **dan selalu dilewati pada run mode demo** (`tournament_sessions.is_demo`). Data demo adalah salinan sandbox orang sungguhan, jadi tidak dikirim ke model untuk ditulisi prosa; finalis run demo tetap memakai narasi templat deterministik yang sudah tersimpan di 5A.19. `run_info.narrative` mencatat `llmEnabled: false` dan `disabledBy: 'demo'` (atau `'config'` bila dimatikan lewat `AHP_NARRATIVE_LLM`). Tab Konfigurasi Run tidak menampilkan banner "narasi templat" untuk run demo, karena templat di sana memang keluaran yang dimaksud dan mode demo tidak membawa penanda di halaman.
  - Bila narasi gagal, narasi templat yang sudah tersimpan tetap dipakai. Kegagalan ini tidak menggagalkan run.
- **Aktivitas basis data:** UBAH `analysis_results.details` untuk baris yang narasinya ditulis LLM (`narrativeSource = llm`); UBAH progres.
- **Panggilan luar:** `POST {LLM_BASE_URL}/chat/completions`, dengan konkurensi `INSIGHT_LLM_CONCURRENCY` (bawaan 3) dan temperatur `LLM_INSIGHT_TEMPERATURE` (bawaan 0,7). Tidak ada panggilan pada run mode demo.
- **Hasil:** narasi untuk setiap baris. Antarmuka menandainya "Narasi model bahasa, tidak memengaruhi angka"; narasi tidak pernah menjadi bahan kalimat perbandingan run.

### 5A.21 Susun dan simpan diagnosis run (`runInfo`)

- **Pelaku:** scoring-service.
- **Kegiatan:** menyusun `runInfo`. Isinya:
  - job profile yang dipakai dan status basis posisi (`positionBasisStatus`: dari induk, milik sendiri, atau `live_fallback`, beserta catatannya);
  - basis beku run ini (`frozen`: bobot, kriteria aktif, jangkar, tanggal acuan, basis posisi, model), yang akan diwarisi turunannya;
  - jumlah kandidat yang dinilai dan jumlah finalis;
  - ringkasan rerun dan *freshness*;
  - status narasi (berapa yang ditulis LLM dan berapa yang memakai templat, serta `disabledBy` bila penulis narasi tidak dipanggil);
  - peringatan enkripsi bila ada kolom kandidat yang tidak terbaca, dan penanda skor sementara;
  - diagnosis karier dan teknis (sumber acuan, anchors, kompetensi tak terukur);
  - blok AHP (sumber bobot, CR, λmax, matriks, kriteria aktif dan yang dibuang, bobot efektif);
  - model yang dipakai, versi data (sinkronisasi terakhir per sumber, sidik korpus job profile dan kamus), sumber ambang readiness, dan durasi setiap tahap (`timings`).
- **Aktivitas basis data (DB utama):** UBAH `scoring_runs` SET `run_info`; pada run turunan, lengkapi `config_snapshot.rerun.frozen` untuk bagian yang tadinya `live_fallback`.
- **Hasil:** diagnosis tersimpan di run sebagai rekaman permanen. Bila engine gagal di langkah mana pun, kegagalan dicatat di `run_info.failure`, dan run tampil "Gagal" beserta pesannya.

### 5A.22 Tandai run selesai (tulisan terakhir)

- **Pelaku:** scoring-service.
- **Aktivitas basis data (DB utama):**
  - UBAH `scoring_runs` SET `status = 'completed'`, `candidate_count` = jumlah baris hasil, `completed_at = NOW()`.
  - UBAH `tournament_sessions` SET `status = 'completed'`, `final_ranked = final_ranked || { ahpProgress: completed, runInfo }`, `updated_at`.
- **Hasil:** run selesai. `completed` sengaja ditulis paling akhir, karena sejak saat itu trigger drizzle/0087 menolak setiap perubahan atas run, baris hasilnya, dan kolamnya (I-1).

### Ringkasan Fase 5A

| Kelompok | DB utama — BACA | DB utama — TULIS/UBAH/HAPUS | DB vektor — BACA |
|---|---|---|---|
| Sesi dan progres | `tournament_sessions` | UBAH `tournament_sessions` (progres, status, `runInfo`) | — |
| Kandidat | `candidates`, `candidate_technical_competencies`, `candidate_position_history`, `sync_employee_positions`, `app_encryption_keys` | — | — |
| Posisi dan job profile | `critical_positions`, `positions`, `sync_job_profiles`, `job_family_matches`, `sync_positions`, `sync_kamus_kompetensi` | — | `job_profile_embed` |
| Kompetensi | `kamus_competency_match_cache`, `sync_technical_competencies`, `sync_employee_positions` | — | `kamus_kompetensi_level_embed` |
| Kalibrasi | `kamus_similarity_calibration`, `job_profile_similarity_calibration`, `job_family_topic_runs`, `job_family_topic_assignments`, `candidate_position_history` | TULIS kedua tabel kalibrasi (hanya bila korpus berubah) | `kamus_kompetensi_level_embed`, `job_profile_embed` |
| Bobot | `program_templates` | — | — |
| Hasil | — | HAPUS lalu TULIS `scoring_run_pool_aspects` dan `analysis_results`; UBAH `scoring_runs` | — |

---

## Fase 5B — Engine AI Tournament (dihapus)

Engine AI Tournament (LLM) **dihapus pada versi 1.5** (17 November 2026); AHP + TOPSIS (Fase 5A) adalah satu-satunya metode. Yang hilang bersamanya: subagen aspek teknis dan pendidikan, agen justifikasi, tahap *replace-worst*/bracket, penilaian LLM sekali jalan, cache skor aspek LLM (`candidate_aspect_scores`), serta prompt `aspect_subagent_technical`, `aspect_subagent_education`, dan `justification_agent` (bersama prompt lama tak terpakai `ahp_education_correlation`; Tata Kelola kini hanya menampilkan `ahp_education_grounded` dan `ahp_narrative_agent`). Variabel `STAGE_BATCH_SIZE`, `FIRST_ROUND_MULTIPLIER`, `ASPECT_SCORE_CACHE`, dan `ASPECT_LLM_CONCURRENCY` tidak dibaca lagi; `scoring-service/src/tournament-evidence.ts` dihapus, dan `scoring-service/src/scoring-engine.ts` kini hanya memuat pemuat bersama (`loadSession`, `loadPositionRow`, `findMatchedJobProfileId`), pita readiness, dan skor kuadran HAV.

Sesi yang masih membawa `scoring_method` selain `ahp_topsis` gagal dengan pesan penghapusan (langkah 4.3). Run LLM yang tersimpan dihapus oleh `drizzle/0097_remove_llm_tournament.sql` (dijalankan **setelah** web app dan scoring-service baru berjalan): semua sesi non-`ahp_topsis` (sesi lebih dulu, agar penyapu tidak memungut sisa sesi `running`) dan semua run `method = 'LLM'` dihapus, beserta kaskadenya (`analysis_results`, `scoring_run_exclusions`, `scoring_run_pool_aspects`, `scoring_run_traces`, dan `chat_messages` milik run); `position_picks` tetap ada dengan `run_id` menjadi NULL, run turunan dari run yang dihapus tetap ada dengan `parent_run_id` NULL, dan `audit_log` tidak disentuh. Penghapusan ini tidak dapat dibalik, jadi ambil cadangan lebih dulu bila peringkat LLM mungkin masih dibutuhkan. Migrasi yang sama menghapus tabel `candidate_aspect_scores`, `scoring_run_feedback`, `prompt_versions`, dan `program_contexts`, kolom `program_templates.system_prompt`, `tournament_sessions.stages`, dan `tournament_sessions.carryover_losers`, serta menjadikan `ahp_topsis` nilai bawaan `tournament_sessions.scoring_method`.

---

## Fase 6 — Pemantauan dari peramban

Pemantauan adalah **kemudahan tampilan**, bukan bagian dari mekanisme penilaian. scoring-service menulis hasilnya sendiri, sehingga run tetap selesai walaupun tab peramban ditutup.

### 6.1 Cabang "masuk antrean"

- **Pelaku:** peramban (`scoring-wizard.tsx:796-818`).
- **Kegiatan:** bila `dispatch.status = 'queued'`, wizard **tidak** menyurvei. Ia menampilkan pemberitahuan amber berisi pesan dispatch, termasuk kalimat bahwa sesi sudah tersimpan dan tidak perlu dimulai ulang. `?sessionId=` ditambahkan ke URL agar pemantauan bisa dilanjutkan nanti.
- **Aktivitas basis data:** tidak ada.
- **Hasil:** sesi tetap `running` di DB dan akan dikerjakan saat scoring-service tersedia: lewat pemulihan saat menyala, atau lewat penyapu (langkah 4.4).

### 6.2 Survei status

- **Pelaku:** peramban (`pollServiceUntilComplete`, `scoring-wizard.tsx:556`) memanggil server web di rute `GET /api/tournament/[sessionId]/status` (`app/api/tournament/[sessionId]/status/route.ts`).
- **Kegiatan:** survei berjalan setiap **2 detik**, paling lama **1 jam** (1.800 kali). Rute ini membaca baris sesi dari DB; ia **tidak** bertanya ke scoring-service. Isi responsnya: status, ukuran kolam, `runId`, dan `ahpProgress`. Wizard menerjemahkan fase menjadi persentase dan baris log (tabel fase di Fase 5A). Respons ditangani sebagai berikut:
  - HTTP ≥ 500: survei berhenti dengan pesan galat.
  - Galat jaringan: survei terus mencoba.
  - **404: survei juga terus mencoba**, karena penanganannya dikomentari (`:571-576`).
- **Aktivitas basis data (DB utama):** BACA `tournament_sessions`, seluruh kolom termasuk `final_ranked` dan kedua kolam kandidat, setiap 2 detik untuk setiap tab yang memantau.
- **Keamanan:** rute ini tidak memeriksa login, izin, maupun tenant; yang diperiksa hanya format UUID (Temuan no. 8).
- **Hasil:** tampilan progres. Tidak ada yang ditulis.

### 6.3 Selesai atau gagal

- **Pelaku:** peramban dan server web (`scoring-wizard.tsx:833-880`).
- **Kegiatan:**
  - **`completed`:** wizard membaca status sekali lagi untuk mengambil `runId` dan jumlah finalis, lalu menampilkan tombol menuju hasil. Baris sesi **sengaja tidak dihapus**, karena `runInfo` juga tersimpan di sana dan sesi yang sudah selesai tidak berpengaruh apa-apa.
  - **`failed`:** wizard menampilkan *"Scoring gagal dijalankan di layanan. Silakan coba lagi."* (merah).
- **Aktivitas basis data:** BACA `tournament_sessions`. Tidak ada `audit_log` saat run selesai: wizard maupun scoring-service tidak pernah menulisnya.
- **Hasil:** pengguna diarahkan ke halaman posisi (Fase 7).

### 6.4 Finalisasi cadangan (bila survei 1 jam habis)

- **Pelaku:** server web, `finalizeTournamentAction` (`lib/scoring-engine.ts:1065`, izin `scoring.run`), yang memanggil scoring-service di rute `POST /api/scoring/:id/finalize` (`scoring-service/src/routes.ts:121`).
- **Kegiatan:**
  1. Web app membaca sesi. Bila sudah `completed`, langsung kembali.
  2. Bila belum, web app mengirim `POST /finalize` tanpa batas waktu. Rute ini **menjalankan engine secara langsung** di dalam permintaan HTTP: `runAhpTopsisSession`. Sesi bermetode selain `ahp_topsis` ditolak dengan 409 dan pesan penghapusan AI Tournament (langkah 4.3).
  3. Web app lalu menyurvei `GET /api/scoring/:id/status` di scoring-service setiap 2 detik, paling lama 4 menit.
  4. Terakhir, `revalidatePath` untuk halaman posisi dan daftar posisi.

  Hanya di jalur ini wizard mencatat run ke utas aktivitas (`recordThreadRun`). Catatan itu hanya disimpan di `localStorage` peramban (`pulse:activity-thread:v3`), bukan di DB.
- **Aktivitas basis data:**
  - Web: BACA `tournament_sessions`.
  - Service: seluruh aktivitas Fase 5A. Rute status scoring-service sendiri juga BACA `tournament_sessions`.
- **Hasil:** `runId`. Rute `/finalize` tidak memeriksa apakah engine masih berjalan untuk sesi yang sama (Temuan no. 4).

### 6.5 Membuka kembali wizard dengan `?sessionId=`

- **Pelaku:** peramban (`scoring-wizard.tsx:415-498`).
- **Kegiatan:** wizard mengirim satu permintaan status.
  - Bila `completed` atau `failed`: hanya muncul baris log, dan wizard tetap di layar konfigurasi.
  - Bila masih berjalan: wizard mulai menyurvei (6.2).

  Dua kelemahan dicatat sebagai Temuan no. 10 dan 11:
  - permintaan ini memakai `/api/tournament/...` **tanpa** `NEXT_PUBLIC_BASE_PATH`, sementara survei biasa memakainya;
  - respons status tidak memuat `positionId`.
- **Aktivitas basis data:** BACA `tournament_sessions`.
- **Hasil:** pemantauan dilanjutkan.

### 6.6 Pembatalan

Wizard **tidak punya tombol "Batalkan"**, dan tidak ada server action khusus untuk pembatalan. Sesi yang sedang berjalan hanya dibatalkan sebagai bagian dari **menghapus run**:

- **Pelaku:** server web, `deleteScoringRunAction` (`lib/scoring-engine.ts:2466`; izin `scoring.run`; tenant run harus sama dengan tenant aktif). Ia memanggil scoring-service di rute `POST /api/scoring/:id/cancel` (`routes.ts:102`) dan `cancelSessionProcessing` (`runner.ts:69`).
- **Urutan dan aktivitas basis data:**
  1. Web: BACA `scoring_runs` (run yang akan dihapus), lalu BACA `tournament_sessions` berdasarkan `run_id`.
  2. Untuk setiap sesi `running` atau `finalizing`, web mengirim `POST /cancel`. Galatnya ditelan.
  3. Service menghentikan pekerja lewat `AbortController`. Engine berhenti di pemeriksaan pembatalan berikutnya.
  4. Bila sesinya `running`: service UBAH `tournament_sessions` SET `status = 'failed'`, lalu UBAH `scoring_runs` SET `status = 'failed'`. Pernyataan kedua ini **ditolak constraint** (Temuan no. 2).
  5. Web: HAPUS `tournament_sessions` berdasarkan `run_id`, lalu HAPUS `scoring_runs`. Kaskade FK ikut menghapus `analysis_results`, `scoring_run_pool_aspects`, `scoring_run_exclusions`, dan `chat_messages` milik run. `position_picks.run_id` menjadi NULL.
  6. Web: TULIS `audit_log` (`scoring_run` / `delete`), lalu `revalidatePath`.
- **Hasil:** run dan semua turunannya hilang. Jalur lain yang juga membatalkan adalah `resetProgramScoringAction` (J5), tetapi dialognya tidak ditampilkan di halaman.

---

## Fase 7 — Setelah selesai: apa yang dibaca halaman posisi

Hasil run dibaca di halaman `/positions/[id]` (`app/(dashboard)/positions/[id]/page.tsx`, gerbang `positions.view`). Semua pembacaan dilakukan **web app** dari DB utama. scoring-service tidak terlibat sama sekali.

Halaman ini **tidak menyurvei** run yang belum selesai. Run `in_progress` memang menampilkan pesan bahwa hasilnya akan muncul otomatis, tetapi halaman baru berubah setelah dimuat ulang atau setelah pengguna melakukan tindakan.

Halaman yang dulu bernama "Progress Running", yang masih disebut CLAUDE.md, **sudah tidak ada sebagai rute**. Isinya sekarang ada di tab Readiness: `components/analysis/aspect-derivations.tsx` dan `lib/progress-running-actions.ts`.

| Bagian halaman | Fungsi (web app) | Dibaca dari DB utama | Catatan |
|---|---|---|---|
| Kerangka halaman (server) | `getScoringRun`, `getPositionDetail`, `getScoringRunsForPosition`, `listPositionPicks`, `getPositionIncumbentProfile`, `getGradeLevelsForTenant` | `scoring_runs`; `critical_positions` dan seluruh bacaan `getPositionManagementList`; `analysis_results`; `position_picks` ⟕ `candidates`; `candidates`, `candidate_technical_competencies`, `candidate_position_history`; `sync_company_tenant_map`, `sync_grade_levels`; berkas readiness | Filter tanggal riwayat run bawaannya tahun berjalan |
| Daftar peringkat | `loadPositionRunViewDataAction` (`lib/position-detail-actions.ts:211`) → `getScoringRunResults` (`lib/scoring-engine.ts:2565`), `getRunExclusionsAction` | `analysis_results` (`final_score`, `rank`, `manual_rank`, `details`), `candidates`, `candidate_technical_competencies`, `scoring_run_exclusions` ⟕ `users`, urutan kriteria dari `scoring_runs.run_info` / `config_snapshot` ⟕ `tournament_sessions.final_ranked` | `manual_rank` mengembalikan penataan seri manual |
| Profil kandidat | `loadCandidateProfilesForAnalysisAction` → `getCandidateProfiles` | `candidates`, kompetensi, riwayat | **Menulis saat dibaca**: menyalin ulang `candidate_technical_competencies` dari `sync_technical_competencies` (HAPUS lalu TULIS, maksimal sekali per 5 menit per tenant per proses) |
| Silsilah run | `getRunTreeAction` (`lib/run-tree-actions.ts:90`) | `scoring_runs` ⋈ `critical_positions` | Dipanggil dua kali, dari dua komponen |
| Tab Readiness | `getAhpRunDetailAction` (`lib/progress-running-actions.ts:1108`, izin **`job_profiles.view`**) | run ⋈ posisi ⟕ sesi, `program_templates.ahp_config`, `config_snapshot` / `final_ranked` / `run_info` semua run AHP posisi itu, `analysis_results.details`, berkas readiness | Dipanggil dua kali (panel pergeseran peringkat dan analisis kandidat), ditambah saat chip aspek dibuka |
| Tab Konfigurasi (AHP) | `getRunConfigurationAction` + `getRunSnapshotAction` | run ⋈ posisi ⟕ sesi, `sync_grade_levels`, template live (hanya untuk run tanpa `config_snapshot`), label run dasar, berkas readiness | Menampilkan konfigurasi **yang dibekukan** di 2.12 dan diagnosis 5A.22 |
| Tab AI Assistant (saat ini disembunyikan, `AI_ASSISTANT_TAB_ENABLED` di `lib/position-result-tabs.ts`) | `chat-actions.ts` (izin `analysis.manage`) | `chat_messages` (didekripsi) | Tidak dimuat selama tab disembunyikan |
| Tab Peta Job Family | `position-family-map-actions.ts` (izin `job_profiles.view`) | `job_family_topic_*`, `job_family_matches`, `critical_positions` | — |

**Hasil:** peringkat ditampilkan beserta rincian enam aspek, readiness, narasi, konfigurasi yang dibekukan, dan diagnosis run. Keputusan manusia yang diambil **dari** peringkat ini (memilih suksesor, mengecualikan kandidat) ditulis ke tabel lain dan tidak mengubah run.

---

## Jalur start lain

Semua jalur di bawah ini mengikuti pola yang sama dengan run baseline:

1. menulis baris sesi dan baris run;
2. memanggil `notifyScoringService`, **termasuk** pemetaan nama kompetensi (langkah 3.1);
3. scoring-service mengerjakannya lewat Fase 4–5.

Perbedaannya ada pada empat hal: cara kolam disusun, isi `final_ranked` yang menjadi instruksi bagi engine, kolom silsilah run, dan penulisan `audit_log`.

### J1 Tambah Kandidat Pembanding (satu-satunya re-run)

- **Pelaku:** server web, `startRerunAction` (`lib/scoring-engine.ts`, izin `scoring.run`), dari dialog `components/rerun-dialog.tsx`. Hanya mode `incremental_add` yang dapat dibuat; empat mode lama (`refresh_add`, `exclude`, `finalists_rematch`, `refresh_full`) tetap terbaca lewat `rerunSpec()` tetapi ditolak bila diminta. Aturan desainnya ada di bagian "Re-run scoring — aturan desain" pada `CLAUDE.md`; kondisi sebelum perombakan ada di `docs/rerun-modes-inventory.md`, dan status setiap kebutuhan di `docs/rerun-requirements-audit.md`.
- **Validasi di server** (`validateRerunRequest`, `lib/rerun-freeze.ts`): run induk ada di tenant yang sama, berstatus `completed`, metode AHP+TOPSIS, punya `scoring_run_pool_aspects`; minimal satu kandidat; `rerun_reason` terisi, paling panjang 1.000 karakter. Pada run yang tidak memenuhi, tombol di halaman posisi tampil nonaktif dengan alasan yang sama (`getRerunPreviewAction`).
- **Pencarian dan klasifikasi kandidat** (`searchRerunCandidatesAction`, `classifyRerunCandidates` → `classifyAgainstParent`): pencarian nama atau NPK, dibatasi ke business unit yang dicakup run induk. Klasifikasi yang sama dipakai pratinjau dialog dan server:
  - `new` — belum ada di pool induk; satu-satunya yang dinilai;
  - `existing_pool` — sudah di pool induk tetapi bukan finalis; tidak dinilai ulang, tetapi diberi baris hasil;
  - perlu konfirmasi — memenuhi syarat tetapi grade di luar rentang posisi (Excluded); diterima hanya bila dicentang per kandidat, lalu dicatat di `filter_summary.forceIncluded` dan diberi penanda "Di luar rentang grade";
  - ditolak beserta alasannya — finalis induk, tidak ditemukan, soft-deleted, pejabat posisi, atau gagal aturan Rejected (disiplin, PA, HAV, BA) beserta aturan yang gagal. Kandidat berkategori Reconsidered (MCU dengan catatan) dinilai biasa.
  Bila tidak ada yang tersisa, request ditolak. Permintaan identik dalam dua menit menghasilkan satu run saja (kunci permintaan dan advisory lock).
- **Aktivitas basis data (DB utama):**
  - BACA run induk (`scoring_runs`, dibatasi tenant, kolom bernama), pool induk (`scoring_run_pool_aspects`), `critical_positions` + `critical_position_holders`, kandidat yang dipilih (termasuk yang soft-deleted, agar bisa dilaporkan), dan `config_snapshot` induk untuk menilai kandidat baru terhadap aturan induk.
  - TULIS `tournament_sessions` dengan `final_ranked = { ahpRerun: { mode: 'incremental_add', baseRunId, newCandidateIds, existingPoolCandidateIds, frozen } }`. `frozen` (`resolveFrozenBasis`) berisi vektor bobot induk presisi penuh beserta CR/λmax/CI-nya, kriteria aktif, jangkar teknis/karier, target kedalaman, tanggal acuan, model, dan basis posisi induk.
  - TULIS `scoring_runs` dengan `parent_run_id`, `rerun_mode = 'incremental_add'`, `rerun_reason`, `program_template_id` induk, `config_snapshot` warisan induk (termasuk ambang readiness) + blok `rerun` (`RunRerunSnapshot`: klasifikasi setiap kandidat, daftar yang ditolak, basis beku), dan `filter_summary.forceIncluded` (warisan induk + kandidat di luar rentang grade yang dikonfirmasi).
  - UBAH tautan sesi ke run; TULIS `audit_log` (`run_scoring`, berisi alasan).
- **Perbedaan di scoring-service (5A):**
  - sesi dengan mode/kunci lama ditolak (`parseRerunSpec`);
  - keenam aspek dan teks mentah setiap kandidat bawaan diambil dari induk (`planFrozenRerun`, `assembleAspectScores`), termasuk kandidat yang sejak itu di-soft-delete; penanda skor sementara kandidat lama ikut terbawa;
  - hanya kandidat `new` yang dinilai, terhadap basis posisi induk, dengan jangkar induk dan tanggal acuan induk (`recencyFactor`/`stintYears` menerima `asOf`; pemegang jabatan "aktif" pada fallback karier dinilai pada tanggal acuan itu);
  - bobot (`frozenWeights`) dan kriteria aktif (`frozenDroppedCriteria`) induk dipakai apa adanya;
  - `runInfo.frozen` ditulis untuk setiap run AHP; `runInfo.rerun` mencatat silsilah, klasifikasi, sumber bobot/jangkar, `criteriaLiveDisagrees`, `carriedDeleted`, `positionBasis`, dan model yang berubah;
  - daftar hasil disusun `composeChildResultList` (5A.16).
- **Setelah dikirim:** pengguna diarahkan ke run turunan, yang menampilkan tahapan proses selama berjalan, lalu banner "Turunan dari Run #X — k kandidat pembanding ditambahkan" beserta alasan, kandidat yang ditolak, nilai yang tidak dibekukan, dan tautan ke perbandingan dengan induk, yang membuka tab "Komparasi Versi" di halaman yang sama (`?tab=komparasi-versi&a=&b=`; tautan lama `?tab=perbandingan-run` dan `/positions/[id]/compare?a=&b=` dialihkan ke sana).

### J2 Penandaan "Ditandai dikecualikan"

- **Pelaku:** server web, `setRunExclusionAction` (`lib/scoring-engine.ts`, izin `scoring.run`).
- **Aktivitas basis data (DB utama):** TULIS atau HAPUS `scoring_run_exclusions` (alasan, catatan, pelaku), lalu TULIS `audit_log`. Membatalkan tanda juga wajib beralasan, dan alasannya tercatat di audit.
- **Hasil:** hanya penandaan, berlabel "Ditandai dikecualikan (tidak memengaruhi angka)". Skor, peringkat, dan run tidak berubah, dan tidak ada run turunan yang dibuat. Peringkat ulang tanpa kandidat tertentu (`createExclusionRerank`) sudah dihapus; run lama ber-mode `exclude` tetap terbaca. Memilih kandidat yang ditandai sebagai suksesor meminta konfirmasi tambahan.

### J2b Penilaian baru dari riwayat posisi

- **Pelaku:** server web, `startNewRootRunAction` (`lib/run-history-actions.ts`, izin `scoring.run`), dari tombol "Penilaian Baru" di kartu Riwayat Scoring.
- **Kegiatan:** menolak bila posisi ini masih punya sesi yang berjalan; memakai business unit run root terakhir posisi itu; lalu memanggil jalur yang sama dengan wizard (`startTournamentSessionAction`, metode AHP+TOPSIS). Hasilnya run root baru dengan data dan konfigurasi tata kelola hari ini.
- **Aktivitas basis data:** sama dengan wizard (fase 2–4), ditambah TULIS `audit_log`.
- **Hasil:** setelah selesai, run root baru menawarkan perbandingan dengan run root sebelumnya ("Bandingkan dengan root sebelumnya"), yang membuka tab "Komparasi Versi".

### J3 Tambah posisi massal dengan scoring otomatis

- **Pelaku:** server web, `bulkAddPositionsAction` (`lib/position-bulk-actions.ts:454`). Izinnya `positions.manage`, ditambah `scoring.run` bila scoring otomatis dipilih.
- **Aktivitas basis data (DB utama):**
  - BACA `positions`, `sync_positions`, `sync_employee_positions`, `sync_employees`, `candidates`, `critical_positions`, tangga grade, dan `program_templates`.
  - TULIS `critical_positions`, `critical_position_holders`, dan `audit_log` (`position` / `create`).
  - Kemudian, **untuk setiap posisi baru**, memanggil `startTournamentSessionAction`. Panggilan ini adalah run baseline penuh (Fase 2–5) dengan metode AHP + TOPSIS, label `Auto AHP — YYYY-MM-DD`, dan hanya tenant aktif.
- **Hasil:** posisi baru berikut run-nya. Posisi yang kolamnya kosong dilaporkan gagal tanpa menghentikan batch. Status dispatch dihitung per posisi (dimulai / antre).

### J4 Scoring ulang semua posisi satu program

- **Pelaku:** server web, `rescoreProgramPositionsAction` (`lib/position-bulk-actions.ts:823`, izin `scoring.run`).
- **Aktivitas basis data (DB utama):**
  - BACA `critical_positions` ⟕ `scoring_runs`. Posisi yang punya run `in_progress` **dilewati**, agar tidak ada dua run bersamaan pada satu posisi.
  - Untuk setiap posisi lainnya: `startTournamentSessionAction` (baseline, AHP + TOPSIS, label `Rescore <program> — YYYY-MM-DD`, hanya tenant aktif).
  - TULIS `audit_log` (`position` / `update`).
- **Hasil:** satu run baru per posisi. Run lama tetap utuh, dan run baru **tidak** ditautkan ke run lama lewat `parent_run_id`.

### J5 Reset scoring satu program (tersedia tetapi tidak ditampilkan)

- **Pelaku:** server web, `resetProgramScoringAction` (`lib/position-bulk-actions.ts:1022`). Izinnya `scoring.run` dan `positions.manage`, dan nama program harus diketik ulang (diperiksa di server).
- **Urutan:**
  1. `POST /cancel` untuk setiap sesi yang masih hidup.
  2. HAPUS `tournament_sessions` **lebih dulu**. Kalau tidak, penyapu akan menjalankan ulang sesi `running` yang tersisa.
  3. HAPUS `scoring_runs` beserta kaskadenya (langkah 6.6).
  4. Bila diminta, HAPUS `position_picks`.
  5. TULIS `audit_log`.
- **Hasil:** riwayat scoring program itu kosong. Dialognya tidak dirender di halaman Manajemen Posisi.

---

## Kegagalan, pembatalan, dan pemulihan

| Kejadian | Terdeteksi di | Yang terjadi di basis data | Yang dilihat pengguna | Pemulihan |
|---|---|---|---|---|
| Tidak punya izin `scoring.run` | web, 2.1 | Tidak ada tulisan | Toast *"Anda tidak memiliki akses…"* | Beri peran yang sesuai |
| Program run berbeda dari program posisi | web, 2.5 | Tidak ada tulisan | Galat *"…terdaftar pada program lain…"* | Tambahkan posisi pada program itu |
| Kolam kosong, atau semua kandidat gugur filter | web, 2.8 / 2.9 | Tidak ada tulisan | Galat | Longgarkan grade atau aturan filter |
| `SCORING_SERVICE_URL` kosong | web, 3.2 | Sesi `running` dan run `in_progress` sudah tersimpan | Amber: belum dikonfigurasi | Isi variabelnya; sesi diambil saat scoring-service menyala |
| scoring-service mati atau lewat 5 detik | web, 3.2 | Sama | Amber: tidak merespons | Jangan mulai ulang; sesi diambil saat layanan hidup |
| scoring-service membalas galat HTTP | web, 3.2 | Sama | Amber disertai kode HTTP | Laporkan kodenya; penyapu tetap mengambil sesi `running` |
| Kapasitas penuh (`SCORING_MAX_CONCURRENT`) | service, 4.2 | Sesi `running` tanpa pekerja | Dilaporkan "diproses"; progres diam di awal | Penyapu memulainya saat slot kosong |
| scoring-service restart di tengah run AHP | service, 4.4 | Sesi tetap `running`; mungkin ada hasil parsial | Progres berhenti, lalu mulai lagi | Pemulihan saat menyala menjalankan ulang engine dari awal; 5A.17 menghapus hasil parsial, jadi aman diulang |
| Sesi AI Tournament (LLM) dari web app lama, sebelum `drizzle/0097` dijalankan | service, 4.3 | Sesi `failed`; pesannya dicatat di `run_info.failure` | Run tampil "Gagal" dengan pesan *"Metode AI Tournament (LLM) sudah dihapus; sesi ini tidak dinilai…"* | Mulai scoring baru dengan AHP + TOPSIS |
| Engine melempar galat | service, 4.3 | Sesi `failed`; **run tetap `in_progress`** | Merah: *"Scoring gagal dijalankan…"* | Hapus run, lalu mulai run baru (Temuan no. 1) |
| Kunci enkripsi tidak tersedia di scoring-service | service, 5A.2 | Kolom kandidat terenkripsi terbaca NULL | Run selesai, tetapi behavior, pendidikan, HAV, dan PA tidak terukur; `runInfo.encryption` mencatatnya | Perbaiki *mount* berkas master key |
| DB vektor tidak terjangkau | service, 5A.6 / 5A.10 / 5A.11 | Kueri vektor mengembalikan kosong (galat ditelan) | Run selesai; pasangan teknis hanya dari identitas; anchors bersumber `fallback`; karier memakai cadangan kompetensi | Pulihkan DB vektor, lalu jalankan run baru |
| Layanan embedding mati | service, 5A.3 / 5A.11 | — | Tingkat embedding dilewati; dokumen sintetis gagal dan dicatat di `runInfo.career` | Pulihkan layanan embedding |
| Gemini tidak dikonfigurasi atau gagal | service, 5A.13 | — | Pendidikan yang tidak cocok persis bersumber `none` (skor 0). Bila semua kandidat `none`, kriteria pendidikan dibuang | Isi `GEMINI_API_KEY` |
| LLM narasi mati | service, 5A.20 | — | Narasi templat; dicatat di `runInfo.narrative.templateFallback` | — |
| LLM web mati saat pemetaan nama | web, 3.1 | Nama tetap belum terpetakan | Tidak terlihat | Run memakai isi cache yang ada; tombol "Petakan" di `/settings/sync` |
| Tab peramban ditutup | — | Tidak berpengaruh | — | Buka posisi atau wizard `?sessionId=` |
| Run dihapus saat sedang disurvei | peramban, 6.2 | Sesi dan run hilang | Survei berlanjut sampai 1 jam (404 diabaikan), lalu finalisasi cadangan gagal: *"Sesi turnamen tidak ditemukan."* | — |

---

## Catatan dan temuan selama penelusuran

Temuan berikut muncul saat menelusuri kode untuk dokumen ini. Semuanya ditulis berdasarkan kode di commit `8e72dd5`. Temuan yang menyangkut skema perlu dicocokkan dengan basis data produksi, karena constraint bisa saja pernah diubah langsung di sana. Dokumen ini hanya mencatat temuan; tidak ada yang diperbaiki.

### Status dan konsistensi data

1. **Engine yang gagal meninggalkan run `in_progress` selamanya.** Blok `catch` di `processLoop` (`scoring-service/src/runner.ts:132`) hanya menandai sesi `failed`, sedangkan baris `scoring_runs` tidak disentuh. Akibatnya:
   - riwayat posisi terus menampilkan run itu sebagai sedang berjalan;
   - Manajemen Posisi menghitung posisi itu sebagai sedang dinilai (`lib/pulse-data.ts:1877`);
   - "Scoring Ulang" program **melewati posisi itu selamanya** (`lib/position-bulk-actions.ts:751`, `:862`) sampai run tersebut dihapus.
2. **Pembatalan menulis status yang dilarang constraint.** `cancelSessionProcessing` menjalankan `UPDATE scoring_runs SET status = 'failed'` (`runner.ts:89`). Padahal `scoring_runs_status_check` hanya mengizinkan `draft`, `in_progress`, `completed`, dan `archived` (`lib/db/schema.ts:713`, `drizzle/0006_uneven_ben_parker.sql:979`). Pernyataan itu gagal setelah sesi telanjur ditandai `failed`, dan endpoint `/cancel` membalas galat. Saat ini dampaknya kecil karena pembatalan hanya dipakai tepat sebelum run dihapus, tetapi akan menjadi nyata begitu tombol "Batalkan" ditambahkan.
3. *(Tidak berlaku lagi sejak versi 1.5.)* Temuan ini menyangkut sesi LLM yang terputus saat `finalizing` dan `finalizeSession` yang tidak menghapus hasil lama. Metode LLM beserta kedua fungsinya sudah dihapus; engine AHP + TOPSIS tidak memakai status `finalizing` dan membersihkan hasil lamanya sendiri (5A.17).
4. **Rute `/api/scoring/:id/finalize` tidak memeriksa apakah engine sedang berjalan** (`routes.ts:121`). Bila survei 1 jam habis padahal engine masih bekerja (misalnya antre lama karena kapasitas penuh), finalisasi cadangan menjalankan engine kedua pada run yang sama.
5. **"Dispatched" tidak membedakan "langsung dikerjakan" dari "antre karena kapasitas penuh".** `notifyScoringService` hanya memeriksa `res.ok` (`lib/scoring-engine.ts:1032`), padahal scoring-service membalas 200 dengan `queued: true` saat kapasitas penuh (`routes.ts:60`). Pada penambahan massal, posisi yang sebenarnya antre ikut terhitung "dimulai".
6. **Pemetaan nama kompetensi bisa kalah cepat dari penyapu.** Sesi sudah berstatus `running` (2.11–2.13) sebelum pemetaan di 3.1 dimulai. Bila pemetaan memakan lebih dari masa tenggang penyapu (15 detik + interval 10 detik), misalnya karena tingkat AI menunggu model, scoring-service dapat mulai menilai sebelum cache selesai diisi. Nama yang baru terpetakan baru berlaku pada run berikutnya.
7. **Penulisan sesi → run → tautan tidak dibungkus satu transaksi.** Bila proses web mati di antaranya, sesi tanpa `run_id` akan diambil penyapu, lalu gagal dengan *"Sesi tidak memiliki run ID."*. Selain itu, `startTournamentSessionAction` tidak memeriksa bahwa `critical_positions.tenant_id` sama dengan tenant aktif, sehingga `scoring_runs.tenant_id` bisa berbeda dari tenant posisinya.

### Keamanan

8. **Rute status `GET /api/tournament/[sessionId]/status` tidak diautentikasi.**
   - Rute ini tidak memeriksa login, izin, maupun tenant; yang diperiksa hanya format UUID.
   - Repo tidak punya `middleware.ts`, dan gerbang login di layout dasbor tidak melindungi `app/api`.
   - Risikonya rendah karena perlu menebak UUID sesi, tetapi tidak konsisten dengan rute API lain: chat memeriksa `analysis.manage`, dan proksi sync memeriksa `sync.manage`.
9. **Endpoint scoring-service tidak diautentikasi dan dipublikasikan ke host.** `/api/scoring/*` (termasuk `start`, `cancel`, `finalize`, `_resume`, dan `_reload-*`) tidak punya autentikasi, dan `docker-compose.yml` memetakan port `3362:8002`. Siapa pun yang dapat menjangkau port itu dapat membatalkan atau menjalankan ulang sesi. Port tersebut sebaiknya hanya terjangkau dari jaringan internal kontainer.

### Wizard

10. **Pemantauan lanjutan dengan `?sessionId=` dan pembacaan `runId` sesudah selesai memanggil `/api/tournament/...` tanpa `NEXT_PUBLIC_BASE_PATH`** (`scoring-wizard.tsx:420`, `:848`), padahal survei biasa memakainya (`:568`). Bila aplikasi dipasang di bawah *base path*, pemantauan lanjutan diam-diam tidak berjalan.
11. **Respons status tidak memuat `positionId`.** Wizard yang dilanjutkan tanpa `?positionId=` dapat menautkan tombol hasil ke posisi yang salah.
12. **404 diabaikan saat survei** (`scoring-wizard.tsx:572`, dikomentari). Sesi yang sudah dihapus tetap disurvei sampai satu jam.
13. **Angka *"Seluruh N kandidat akan dinilai"* menghitung semua kandidat hidup.** `previewProgramFilterAction` tidak mengevaluasi aturan filter, jadi angkanya diambil sebelum saringan grade, pengecualian pemegang jabatan, dan filter program.
14. **Label progres usang.** *"Technical Competency (BERT + Mean Pooling)"* (`scoring-wizard.tsx:102`) tidak lagi menggambarkan metodenya. Fase `performance` dan `hav` juga tidak pernah dilaporkan engine, karena keduanya dihitung di fase `behavior`.

### Efisiensi

15. **Satu start membaca dan mendekripsi tabel `candidates` sekitar lima kali** (1.4 dua kali, 2.7, 2.8, 2.9), ditambah pratinjau grade di 1.2 yang berjalan pada setiap perubahan rentang. Selain itu:
    - Wizard memuat `getPositionManagementList` secara penuh, padahal hanya sekitar 10 kolomnya yang dipakai.
    - Rute status membaca seluruh baris sesi (termasuk `final_ranked`) setiap 2 detik.
    - `tournament_sessions.run_id` tidak berindeks, padahal beberapa pembacaan halaman posisi melakukan join lewat kolom itu.

### Dokumentasi dan komentar yang tidak lagi sesuai kode

16. **CLAUDE.md**, bagian *Data flow* langkah 3–5:
    - masih menyebut kolam "diacak" (*shuffles*), turnamen bertahap dengan `STAGE_MAX`, dan finalisasi sebagai langkah normal (turnamen dan `STAGE_MAX` sendiri sudah tidak ada di kode sejak versi 1.5);
    - masih merujuk halaman "Progress Running", yang sudah tidak ada;
    - di bagian *What cannot be encrypted*, menyebut `name`, `mcu_status`, dan `hav_quadrant` tidak dapat dienkripsi, padahal ketiganya kini termasuk 19 kolom terenkripsi.
17. *(Sudah diselesaikan.)* `docs/arsitektur-sistem.md` dulu menggambarkan AI Tournament sebagai turnamen *replace-worst* bertahap dan finalisasi sebagai langkah normal. AI Tournament sudah dihapus (versi 1.5), dan dokumen itu kini hanya menggambarkan AHP + TOPSIS dengan finalisasi sebagai jalur cadangan (langkah 6.4).
18. *(Sudah diselesaikan.)* Kunci lama `ahpAugment`/`ahpExclude`/`ahpAlwaysInclude` tidak lagi ditulis oleh siapa pun dan ditolak oleh scoring-service (`parseRerunSpec`).
19. **Narasi AHP hanya diberi pemegang jabatan utama** (`ahp-topsis-engine.ts:6135`), padahal kolam sudah mengecualikan semua pemegang jabatan.
20. **Run baseline tidak meninggalkan jejak di `audit_log`**, baik saat dimulai maupun saat selesai. Sebaliknya, rerun, eksklusi, dan penghapusan run dicatat.

### Temuan sampingan pada data hulu

21. **`candidates.mcu_note` tidak pernah diisi sync.** `sync-service/src/services/candidate-populate.ts` menghitung `mcu_note` di CTE `derived` (`:124-132`), tetapi `SELECT` terluarnya (`:156-163`) tidak memilih kolom itu. Nilainya menjadi NULL, dan `COALESCE` saat upsert mempertahankan isi lama. Akibatnya, catatan "Dari sinkronisasi" yang tampil di formulir Kandidat hanyalah catatan yang sudah ada sebelumnya.
22. **Cron mingguan tidak menjalankan sinkronisasi HAV, MCU, maupun kamus.** Selain itu, sinkronisasi behavior berjalan **setelah** `candidates` diisi, sehingga nilai behavior kandidat selalu tertinggal satu siklus cron.
23. **scoring-service memakai endpoint embedding-nya sendiri saat membuat embedding seketika.** Ia hanya membaca `EMBEDDING_PROVIDER` dan `EMBEDDING_API_BASE` miliknya, bukan konfigurasi sumber embedding web app (`job_family_topic_configs`, misalnya `nomic-remote`). Dampaknya berbeda per penggunaan:
    - **Pencocokan judul** aman, karena kedua sisi di-embed ulang dengan model yang sama.
    - **Dokumen sintetis** di-embed dengan nama model yang tercatat di `job_profile_embed`, tetapi lewat endpoint scoring-service. Bila endpoint itu tidak melayani model tersebut, embedding gagal dan karier jatuh ke cadangan kompetensi. Kegagalan ini tercatat di `runInfo.career`, bukan terjadi diam-diam.

---

## Lampiran A — Matriks tabel × langkah

Kolom "Dibaca di" dan "Ditulis di" merujuk nomor langkah dokumen ini. Angka 7 saja berarti Fase 7, dan J1–J5 merujuk bagian *Jalur start lain*. "Penulis hulu" adalah pihak yang mengisi tabel itu **sebelum** run.

### A.1 DB utama — tabel yang disentuh run

| Tabel | Dibaca di | Ditulis / diubah / dihapus di | Penulis hulu |
|---|---|---|---|
| `tournament_sessions` | 4.1, 4.3, 4.4, 5A.1, 6.2–6.6, 7 | 2.11 (TULIS), 2.13 (UBAH), progres 5A (UBAH), 5A.22 (UBAH status), 4.3 (UBAH `failed`), 6.6 (HAPUS) | — (lahir di run ini) |
| `scoring_runs` | 1.1, 5A.2 dan 5A.22 (hanya rerun), 6.6, 7, J1–J5 | 2.12 (TULIS), 4.3 (UBAH `run_info.failure`), 5A.21, 5A.22 (UBAH), 6.6 (HAPUS) | — (lahir di run ini) |
| `analysis_results` | 1.1, 5A.2 (hanya rerun), 7, J1, J2 | 5A.17 (HAPUS), 5A.19 (TULIS), 5A.20 (UBAH narasi) | — |
| `scoring_run_pool_aspects` | 5A.2 (hanya rerun), J1, J2 (sebagai run dasar) | 5A.17 (HAPUS), 5A.18 (TULIS) | — |
| `kamus_competency_match_cache` | 3.1, 5A.5 | 3.1 (TULIS/UPSERT) | web app (start sebelumnya, tombol "Petakan") |
| `kamus_similarity_calibration` | 5A.6 | 5A.6 (UPSERT, hanya bila korpus kamus berubah) | scoring-service |
| `job_profile_similarity_calibration` | 5A.7 | 5A.7 (UPSERT, hanya bila korpus/label berubah) | scoring-service |
| `criteria` | 1.4, 2.6 | 1.4 / 2.6 (TULIS, sekali per posisi) | web app |
| `users` | 1.1, 2.1 | 1.1 (catat login), 2.3 dan 6.6 (upsert pelaku) | web app |
| `app_roles`, `app_role_permissions` | 1.1, 2.1 dan setiap server action berizin | 2.1 (penyemaian, sekali, bila kosong) | web app |
| `app_encryption_keys` | 1.1, 5A.2 | — | web app (Keamanan) |
| `program_templates` | 1.1, 1.3, 1.4, 2.5, 2.6, 5A.14 | 1.1 (semai template sistem bila tenant belum punya) | web app (Tata Kelola) |
| `critical_positions` | 1.1, 2.4, 3.1, 5A.2–5A.4, 5A.11, 7 | — | web app |
| `critical_position_holders` | 1.1, 2.4 | — | web app |
| `candidates` | 1.1–1.4, 2.7–2.9, 5A.2, 5A.3, 5A.9, 5A.11, 7 | — | sync-service (+ form web) |
| `candidate_technical_competencies` | 3.1, 5A.2, 7 | 7 (salin ulang saat halaman dibuka) | web app |
| `candidate_position_history` | 5A.2, 5A.7, 5A.11 | — | sync-service |
| `sync_employee_positions` | 5A.2, 5A.8, 5A.11 | — | sync-service |
| `sync_positions` | 5A.11 | — | sync-service |
| `positions` | 1.1, 5A.2, 5A.4, 5A.11 | — | sync-service |
| `sync_technical_competencies` | 3.1, 5A.8, 5A.11 | — | sync-service |
| `sync_job_profiles` | 1.1, 3.1, 5A.2, 5A.3, 5A.7, 5A.11 | — | sync-service |
| `sync_kamus_kompetensi` | 3.1, 5A.2, 5A.5 | — | sync-service |
| `job_family_matches` | 1.1, 5A.2, 5A.3, 5A.11, 7 | — | web app |
| `job_family_topic_runs`, `job_family_topic_assignments` | 5A.7, 7 | — | topic-service |
| `job_family_topics` | 7 | — | topic-service |
| `sync_company_tenant_map`, `sync_grade_levels` | 1.1, 7 | — | data referensi |
| `audit_log` | — | hanya jalur J1–J5 dan langkah 6.6 (run baseline tidak menulis) | web app |

Tabel keputusan **sesudah** run tidak ditulis oleh run. Tabel-tabel itu adalah `position_picks`, `scoring_run_exclusions`, dan `chat_messages`. Halaman posisi membacanya di Fase 7, dan semuanya terhapus berantai (atau menjadi NULL untuk `position_picks`) saat run dihapus.

### A.2 DB vektor

| Tabel | Dibaca di | Ditulis oleh (sebelum run) |
|---|---|---|
| `kamus_kompetensi_level_embed` | 5A.6 (sidik jari, sensus), 5A.10, 5A.11 | web app (`lib/kamus-embed-actions.ts`) |
| `job_profile_embed` | 5A.7 (sidik jari, tiga estimator), 5A.11 (vektor dokumen, model tersimpan) | web app (`lib/job-family-actions.ts`) |
| `kamus_kompetensi_embed` | tidak dibaca scoring | web app |

### A.3 Berkas

| Berkas | Dibaca di | Pengelola |
|---|---|---|
| `secrets/master.key` (atau `PULSE_MASTER_KEY`) | 1.1 dan setiap render dasbor (web), 5A.2 (scoring-service; sekali per proses) | Keamanan (`/settings/security`) |
| `lib/readiness-config.json` | 2.12 (dibekukan ke `config_snapshot`), 5A.19 (penentuan readiness; di-cache di memori scoring-service), 7 | Tata Kelola → Kesiapan & Pensiun |
| `lib/scoring-prompts.json` | 5A.13 (`ahp_education_grounded`), 5A.20 (`ahp_narrative_agent`); di-cache, dimuat ulang lewat `POST /api/scoring/_reload-prompts` | Tata Kelola → Instruksi & Model AI |

---

## Lampiran B — Panggilan ke layanan di luar basis data

| Panggilan | Dari → ke | Langkah | Endpoint | Frekuensi per run | Pengaturan |
|---|---|---|---|---|---|
| Pemetaan nama kompetensi | web → LLM | 3.1 | `{LLM_BASE_URL}/chat/completions` | 0–12 nama | `KAMUS_AI_MAX_NAMES_PER_RUN` (12); konkurensi 4; 30 detik; temperatur 0 |
| Dispatch | web → scoring-service | 3.2 | `{SCORING_SERVICE_URL}/api/scoring/start` | 1 | batas waktu 5 detik |
| Job profile posisi (tingkat 4) | scoring-service → embedding | 5A.3 | `{EMBEDDING_API_BASE}/embeddings` (atau `/api/embed`) | 0–1 batch | `EMBEDDING_PROVIDER`, `EMBEDDING_MODEL`; `transformers` = model ONNX di dalam proses, tanpa HTTP |
| Judul jabatan riwayat | scoring-service → embedding | 5A.11 | sama | 0–1 batch (32 teks per permintaan) | sama |
| Dokumen sintetis posisi | scoring-service → embedding | 5A.11 | sama, dengan model dari `job_profile_embed` | 0–1 | sama |
| Pendidikan | scoring-service → Gemini | 5A.13 | `{GEMINI_BASE_URL}/models/{GEMINI_MODEL}:generateContent`, alat `google_search` | 1 per kandidat yang tidak cocok persis dan tidak bisa memakai ulang jawaban run terakhir posisi (+ percobaan ulang) | `GEMINI_*`, `EDUCATION_LLM_CONCURRENCY` (4), `EDUCATION_LLM_MAX_RETRIES` (2), `AHP_EDUCATION_REUSE` (menyala) |
| Narasi AHP | scoring-service → LLM | 5A.20 | `{LLM_BASE_URL}/chat/completions` | 1 per finalis (+1 percobaan ulang); 0 pada run mode demo | `AHP_NARRATIVE_LLM`, `INSIGHT_LLM_CONCURRENCY` (3), `LLM_INSIGHT_TEMPERATURE` (0,7) |
| Survei status | peramban → web | 6.2 | `/api/tournament/:id/status` | setiap 2 detik, ≤ 1 jam | — |
| Finalisasi cadangan | web → scoring-service | 6.4 | `/api/scoring/:id/finalize`, lalu `/status` | hanya bila survei habis | survei 4 menit |
| Pembatalan | web → scoring-service | 6.6 | `/api/scoring/:id/cancel` | saat run dihapus | galat ditelan |

---

## Lampiran C — Variabel lingkungan yang memengaruhi proses

| Variabel | Deployable | Bawaan | Pengaruh |
|---|---|---|---|
| `DATABASE_URL` / `POSTGRES_URL` | web, scoring | — | DB utama |
| `VECTOR_DATABASE_URL` (/ `VECTOR_POSTGRES_URL`) | web, scoring | jatuh ke `POSTGRES_URL` | DB vektor |
| `SCORING_SERVICE_URL` | web | — | tujuan dispatch; bila kosong, sesi masuk antrean |
| `KAMUS_AI_MAX_NAMES_PER_RUN` | web | 12 | batas tingkat AI pemetaan nama (3.1) |
| `LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY` | web, scoring | scoring: `http://localhost:8001/v1`, `default` | resolver kamus (web); narasi AHP (scoring) |
| `LLM_TEMPERATURE`, `LLM_SEED`, `LLM_INSIGHT_TEMPERATURE`, `LLM_TIMEOUT_MS` | scoring | 0; 42; 0,7; 120000 | bawaan panggilan LLM; variasi narasi; batas waktu |
| `INSIGHT_LLM_CONCURRENCY` | scoring | 3 | konkurensi narasi AHP (5A.20) |
| `AHP_NARRATIVE_LLM` | scoring | aktif | narasi AHP via LLM atau templat; run mode demo selalu templat |
| `SCORING_MAX_CONCURRENT` | scoring | 2 | jumlah sesi yang dikerjakan bersamaan |
| `ORPHAN_SWEEP_INTERVAL_MS`, `ORPHAN_SWEEP_GRACE_MS` | scoring | 10000; 15000 | penyapu sesi yatim (4.4) |
| `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_ENABLE_GROUNDING`, `GEMINI_TIMEOUT_MS` | scoring | —; `gemini-2.5-flash`; aktif; 60000 | aspek pendidikan (5A.13) |
| `EDUCATION_LLM_CONCURRENCY`, `EDUCATION_LLM_MAX_RETRIES` | scoring | 4; 2 | aspek pendidikan |
| `EMBEDDING_PROVIDER`, `EMBEDDING_API_BASE`, `EMBEDDING_MODEL`, `DOCUMENT_EMBEDDING_MODEL` | scoring | `openai`; `http://localhost:11434/v1`; `nomic-embed-text-v2-moe:latest` | embedding seketika (5A.3, 5A.11) |
| `TECHNICAL_SIM_FLOOR` / `_CEIL`, `CAREER_SIM_FLOOR` / `_CEIL` | scoring | — | menyematkan anchors dan melewati pengukuran (5A.6, 5A.7) |
| `CAREER_DEPTH_*`, `CAREER_FALLBACK_*`, `CAREER_RECENCY_DECAY` | scoring | lihat `scoring-service/src/config.ts` | aspek karier (5A.11) |
| `PULSE_MASTER_KEY_FILE` / `PULSE_MASTER_KEY` | web, scoring | `secrets/master.key` | kunci dekripsi data kandidat |
| `SCORING_PROMPTS_PATH`, `READINESS_CONFIG_PATH` | scoring | dicari di tata letak repo/kontainer | lokasi berkas bersama |
| `NEXT_PUBLIC_BASE_PATH` | web | kosong | *base path* aplikasi (Temuan no. 10) |
| `RBAC_ADMIN_EMAILS` | web | — | email *bootstrap admin* |
| `TZ` | semua | `Asia/Jakarta` (docker-compose) | arti stempel waktu tanpa zona |

---

## Lampiran D — Berkas kunci

| Berkas | Deployable | Isi yang relevan |
|---|---|---|
| `app/(dashboard)/scoring/new/page.tsx` | web | halaman wizard dan data awalnya (1.1) |
| `components/scoring/scoring-wizard.tsx` | web (peramban) | konfigurasi, persiapan, survei, lanjut-memantau, finalisasi cadangan |
| `lib/scoring-wizard-actions.ts` | web | pratinjau grade, pratinjau kandidat, persiapan matriks |
| `lib/scoring-engine.ts` | web | `startTournamentSessionAction`, `notifyScoringService`, `finalizeTournamentAction`, jalur rerun dan eksklusi, hapus run |
| `lib/programs.ts` | web | template program, evaluasi aturan filter, penyalinan kriteria |
| `lib/kamus-name-match.ts`, `lib/kamus-name-match-actions.ts` | web | pemetaan nama kompetensi ke kode kamus |
| `lib/rbac.ts`, `lib/tenant.ts`, `lib/crypto/key-store.ts`, `lib/candidate-crypto.ts` | web | izin, tenant, kunci, dekripsi kandidat |
| `app/api/tournament/[sessionId]/status/route.ts` | web | rute survei status |
| `lib/position-bulk-actions.ts`, `lib/rerun-modes.ts` | web | tambah massal, scoring ulang program, reset, tabel mode rerun |
| `scoring-service/src/index.ts`, `routes.ts`, `runner.ts` | scoring | rute HTTP, penjadwalan, penyapu sesi yatim |
| `scoring-service/src/ahp-topsis-engine.ts` | scoring | engine AHP + TOPSIS (Fase 5A) |
| `scoring-service/src/scoring-engine.ts` | scoring | pemuat bersama (`loadSession`, `loadPositionRow`, `findMatchedJobProfileId`), pita readiness, skor kuadran HAV. Engine LLM dan `tournament-evidence.ts` sudah dihapus (Fase 5B) |
| `scoring-service/src/technical-anchors.ts`, `career-anchors.ts`, `career-depth-anchors.ts`, `competency-idf.ts`, `kamus-codes.ts` | scoring | kalibrasi dan sensus |
| `scoring-service/src/ahp-weights.ts`, `ahp.ts`, `topsis.ts`, `pa-score.ts`, `hungarian.ts` | scoring | bobot AHP, TOPSIS, PA, penugasan |
| `scoring-service/src/llm.ts`, `gemini.ts`, `embeddings.ts`, `ahp-narrative.ts`, `prompts.ts` | scoring | panggilan model dan prompt |
| `scoring-service/src/db/postgres.ts`, `services/crypto.ts` | scoring | dua pool koneksi; dekripsi |
| `sync-service/src/services/candidate-populate.ts`, `position-sync.ts`, `job-profile-sync.ts`, `kamus-sync.ts` | sync | penulis data hulu (Fase 0) |
| `topic-service/app/` | topic | pengelompokan job family (Fase 0) |
