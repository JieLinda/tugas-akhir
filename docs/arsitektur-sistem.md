# Arsitektur Sistem — AI Pulse

Struktur tingkat tinggi, komponen utama, dan alur interaksi

| | |
|---|---|
| Versi dokumen | 1.7 |
| Tanggal | 25 November 2026 (versi 1.6: 17 November 2026; versi 1.5 dan 1.4: 5 November 2026; versi 1.3: 30 Oktober 2026; versi 1.2 dan 1.1: 29 Oktober 2026; versi 1.0: 30 September 2026) |
| Perubahan versi 1.7 | 25 November 2026: enkripsi tingkat aplikasi dihapus dari sistem — enkripsi amplop AES-256-GCM, berkas kunci master (`PULSE_MASTER_KEY_FILE` / `PULSE_MASTER_KEY`), halaman Keamanan (`/settings/security`, kini dialihkan ke Sinkronisasi), dan tabel `app_encryption_keys` (dibuang `drizzle/0099_drop_app_encryption.sql`, sehingga hitungan tabel turun satu). Data tersimpan sebagai teks biasa; data lama dikonversi sekali oleh `scripts/decrypt-all-sealed.ts` sebelum migrasi itu dijalankan. §1, §2.1, §2.2, §2.3, §2.6, §4.1, §4.2, §5.3, §5.4, §5.6, §5.7, dan Lampiran A disesuaikan |
| Perubahan versi 1.6 | 17 November 2026: metode AI Tournament (LLM) dihapus dari sistem; AHP + TOPSIS menjadi satu-satunya mesin penilaian. Ikut dihapus: subagen aspek, agen justifikasi, cache skor aspek LLM, prompt sistem program beserta riwayat versinya, Konteks Bisnis, dan umpan balik suara run beserta izin `scoring.feedback` (izin turun dari 12 menjadi 11). `drizzle/0097_remove_llm_tournament.sql` menghapus run LLM yang tersimpan dan empat tabel khusus LLM (`candidate_aspect_scores`, `scoring_run_feedback`, `prompt_versions`, `program_contexts`), sehingga hitungan tabel turun empat. §2.1, §2.2, §2.4, §2.6, §3.3, §4.1, §5.3–§5.5, §5.7, dan Lampiran A disesuaikan |
| Perubahan versi 1.5 | 5 November 2026: fitur Simulasi penempatan (simulasi kecocokan peran) dihapus dari sistem — berkas action-nya beserta empat server action, modul prompt, komponen antarmukanya di tab Kandidat, dan tabel `candidate_simulations` (dibuang drizzle/0096). Hitungan tabel dan server action turun sebanyak yang dihapus. Endpoint LLM (`LLM_BASE_URL`/`LLM_MODEL`) tetap ada karena dipakai fitur lain |
| Perubahan versi 1.4 | 5 November 2026: fitur Keyakinan Penempatan (MCU) dihapus dari sistem — modulnya di web dan scoring-service, lima endpoint, berkas konfigurasi, panel Tata Kelola, dan tabel `mcu_confidence_assessments` (dibuang drizzle/0095). Subbagian 3.5 lama ikut dihapus sehingga 3.6 menjadi 3.5. Status MCU, aturan filter MCU yang hanya menandai, dan kolom catatan MCU kandidat tetap ada |
| Cakupan | Empat unit deployable, satu basis data bersama |
| Metode | Pembacaan langsung atas kode sumber, berkas konfigurasi, dan definisi skema |
| Status | Menggambarkan arsitektur sistem pada tanggal di atas |

---

## 1. Tentang dokumen ini

Dokumen ini menjelaskan **bagaimana AI Pulse disusun**: bagian-bagian apa yang
membentuknya, ke mana data mengalir di antara bagian-bagian itu, apa yang masuk
dan apa yang keluar, serta bagian mana yang bergantung pada bagian mana.

Dokumen ini sengaja berhenti sebelum tingkat detail kode. Yang dijelaskan adalah
peran sebuah modul dan kepada siapa ia berbicara, bukan bagaimana isi fungsinya
bekerja. Nama berkas tetap disebut agar pembaca yang ingin turun lebih dalam
tahu harus membuka apa — jadi dokumen ini sekaligus berfungsi sebagai peta
navigasi kode.

Satu hal perlu dinyatakan di depan, karena ia menjelaskan hampir semua keputusan
arsitektur yang menyusul. **AI Pulse bukan aplikasi CRUD dengan tempelan AI.**
Ia adalah sistem yang menghasilkan *penilaian terhadap manusia* — peringkat
suksesor untuk sebuah jabatan — dan penilaian semacam itu harus bisa
dipertanggungjawabkan setelah bertahun-tahun. Konsekuensinya muncul di mana-mana:
proses penilaian dipisah ke proses sendiri karena ia panjang, konfigurasi
dibekukan per penilaian karena aturan boleh berubah sedangkan riwayat tidak
boleh ikut berubah, hasil tidak pernah ditimpa melainkan diberi versi, dan
kandidat tidak pernah benar-benar dihapus.

### Ringkasan satu paragraf

AI Pulse adalah platform perencanaan suksesi talenta untuk MPM Motor. Sistem
mengelola jabatan kritikal, mengumpulkan kandidat yang memenuhi syarat, lalu
menjalankan penilaian berbasis kecerdasan buatan untuk memeringkat calon
suksesor. Ia melayani tiga unit bisnis (Mulia, MSO, ERRO) dalam satu instalasi.
Secara teknis ia terdiri atas satu aplikasi web Next.js, tiga layanan latar
(sinkronisasi data, penilaian, pemodelan topik), dan dua basis data PostgreSQL.

### Angka pokok

| Ukuran | Nilai |
|---|---|
| Unit deployable | 4 (web, sync-service, scoring-service, topic-service) |
| Tabel basis data utama | 66 |
| Tabel basis data vektor | 3 |
| Migrasi skema | 82 berkas, berawalan `0000`–`0077` |
| Berkas server action | 38 (`lib/*-actions.ts`), 154 action terekspor |
| Rute halaman | 20 berkas `page.tsx` (18 di dalam cangkang terotentikasi) |
| Rute API web | 6 |
| Endpoint sync-service | 36 + `/health` |
| Endpoint scoring-service | 12 + `/health` |
| Endpoint topic-service | 4 + `/health` |
| Baris kode, aplikasi web | ± 110.000 (`app/` + `components/` + `lib/`) |
| Baris kode, layanan | ± 28.500 (sync + scoring + topic) |

---

## 2. Komponen dan Subsistem Utama

### 2.1 Peta tingkat tertinggi

Sistem terbagi menjadi lima blok yang berjalan terpisah, ditambah lapisan
penyimpanan yang mereka bagi bersama.

```
                        ┌──────────────── PENGGUNA ────────────────┐
                        │  Peramban — HR, Talent, Manajemen, Admin │
                        └────────────────────┬─────────────────────┘
                                             │ HTTPS
                        ┌────────────────────v─────────────────────┐
                        │   WEB  ·  Next.js 16 / React 19          │
                        │   Antarmuka · Server Action · Orkestrasi │
                        │   Port 3360                              │
                        └───┬────────────┬─────────────┬───────────┘
                            │ proxy      │ fire-and-   │ fire-and-
                            │ /api/sync  │ forget      │ forget
                            │            │             │
        ┌───────────────────v──┐  ┌──────v────────┐  ┌─v──────────────┐
        │  SYNC-SERVICE        │  │ SCORING-      │  │ TOPIC-SERVICE  │
        │  Node · Express      │  │ SERVICE       │  │ Python·FastAPI │
        │  Penarikan data HR   │  │ Node·Express  │  │ BERTopic       │
        │  Port 8001           │  │ AHP + TOPSIS  │  │ Port 8003      │
        └──────────┬───────────┘  │ Port 8002     │  └───────┬────────┘
                   │              └───────┬───────┘          │
                   │                      │                  │
        ┌──────────v──────────────────────v──────────────────v────────┐
        │            PostgreSQL utama  ·  66 tabel                    │
        │  (skema dimiliki aplikasi web melalui Drizzle ORM)          │
        └─────────────────────────────┬───────────────────────────────┘
                                      │
        ┌─────────────────────────────v───────────────────────────────┐
        │     PostgreSQL + pgvector  ·  3 tabel embedding             │
        │     job_profile_embed · kamus_kompetensi_(level_)embed      │
        └─────────────────────────────────────────────────────────────┘
```

Pemisahan ini tidak dilakukan demi kerapian. Setiap garis pemisah menjawab satu
kendala nyata:

- **scoring-service terpisah** karena satu run penilaian dapat berlangsung
  lama — satu panggilan Gemini per kandidat yang pendidikannya tidak cocok
  persis, satu panggilan LLM per finalis untuk narasi, panggilan embedding, dan
  sensus kalibrasi saat korpus berubah — yang akan melampaui batas waktu server
  action Next.js. Pemisahan inilah yang membuat penilaian dapat berjalan tanpa tab
  peramban tetap terbuka.
- **sync-service terpisah** karena ia satu-satunya yang butuh driver MSSQL,
  akses folder jaringan, dan penjadwal cron — tiga ketergantungan yang tidak ada
  urusannya dengan penyajian halaman.
- **topic-service terpisah dan berbahasa Python** karena BERTopic, UMAP, dan
  HDBSCAN hanya hidup di ekosistem Python.
- **basis data vektor terpisah** karena pgvector adalah kebutuhan ekstensi yang
  tidak perlu dipaksakan pada basis data transaksional.

### 2.2 Aplikasi web — antarmuka, logika bisnis, orkestrasi

Aplikasi web berada di akar repositori. Ia memikul tiga peran sekaligus: ia
adalah **antarmuka pengguna**, ia adalah **tempat sebagian besar logika bisnis
berada**, dan ia adalah **pengorkestrasi** yang membangunkan ketiga layanan lain.

#### Lapisan antarmuka (`app/`, `components/`)

Aplikasi memakai App Router Next.js dengan pengelompokan rute. Kelompok
`app/(dashboard)/` adalah cangkang aplikasi yang memerlukan otentikasi;
`app/auth/signin` adalah halaman masuk Keycloak; `app/api/` menampung penangan
NextAuth dan rute proksi tipis ke layanan latar.

| Rute | Halaman | Izin |
|---|---|---|
| `/` | Beranda — ringkasan eksekutif | semua pengguna |
| `/positions`, `/positions/[id]` | Manajemen Posisi dan detail jabatan; `?tab=komparasi-versi&a=&b=` membuka tab "Komparasi Versi" (perbandingan dua run dan keputusan forum; dulu "Perbandingan Run", `?tab=perbandingan-run` tetap dialihkan ke tab ini). `/positions/[id]/compare` hanya mengalihkan ke sana | `positions.view` |
| `/candidates`, `/candidates/[id]` | Daftar dan profil kandidat | `candidates.view` |
| `/talent-pool` | Kolam talenta beserta panel aturan filternya | `candidates.view` |
| `/scoring/new` | Wisaya penilaian | `scoring.run` |
| `/analysis` | Analisis hasil penilaian | `analysis.manage` |
| `/job-profiles`, `/job-profiles/match`, `/job-profiles/kamus` | Menu Dokumen — dokumen job profile, Job Profile Match, Kamus Kompetensi | `job_profiles.view` |
| `/posisi/job-family` (+ `/pengaturan`) | Menu Posisi — Peta Job Family (satu halaman, tanpa deretan sub-tab); `/posisi`, alamat lama `/job-profiles/job-family`, dan Struktur Posisi yang sudah dihapus (`/posisi/struktur`, `/job-profiles/struktur`) mengalihkan ke peta | `job_profiles.view` |
| `/governance` | Tata Kelola — empat seksi konfigurasi | `governance.manage` |
| `/settings/sync` | Sinkronisasi | `sync.manage` |
| `/settings/users` | Pengguna & Akses | `users.manage` |

Komponen dikelompokkan per domain di bawah `components/{analysis, governance,
scoring, job-family, job-profiles, settings, activity-thread}`,
dengan primitif shadcn/ui gaya "new-york" di `components/ui/`. Tailwind v4
dipakai tanpa berkas konfigurasi.

Satu keputusan struktural pantas disorot. **Menu adalah registri, bukan
komponen.** Berkas `lib/navigation.ts` adalah satu-satunya sumber kebenaran
untuk href, label, dan izin setiap rute tingkat atas. Komponen
`components/sidebar-nav.tsx` hanya menambahkan ikon di atasnya. Sebelum registri
ini ada, tiga tempat menulis label rute secara terpisah — bilah sisi, label
pengalihan pada utas aktivitas, dan judul tiap halaman — dan ketiganya sudah
menyimpang satu sama lain.

#### Lapisan logika bisnis (`lib/`)

Logika bisnis tinggal di `lib/`, bukan di sebelah rutenya. Terdapat 41 berkas
`lib/*-actions.ts` yang mengekspor 161 server action, satu berkas per domain.
Pengelompokan menurut fungsi:

| Kelompok | Berkas utama | Tanggung jawab |
|---|---|---|
| **Penilaian** | `scoring-engine.ts`, `scoring-wizard-actions.ts`, `rerun-modes.ts`, `rerun-freeze.ts`, `run-tree-actions.ts`, `run-history*.ts`, `run-compare*.ts`, `run-label.ts` | Pembuatan sesi, pembangunan kolam kandidat, pengiriman ke scoring-service, penilaian ulang satu mode (Tambah Kandidat Pembanding; empat mode lama hanya dibaca), silsilah run, perbandingan dua run |
| **Metode & bobot** | `ahp.ts`, `scoring-criteria.ts`, `pa-topsis.ts`, `criterion-weight-order.ts` | Matriks perbandingan berpasangan AHP, bobot aspek baku, TOPSIS untuk aspek kinerja |
| **Data inti** | `pulse-data.ts` (2.771 baris), `pulse-crud-actions.ts`, `position-*-actions.ts`, `talent-pool-*.ts` | Pembacaan agregat untuk halaman, operasi jabatan dan kandidat |
| **Profil jabatan** | `job-profile-actions.ts`, `job-profile-tenant-scope.ts`, `sync-actions.ts` | Katalog dokumen, cakupan kepemilikan per unit bisnis, snapshot hierarki |
| **Job Family** | `lib/job-family/` (12 modul + 3 di `optimize/`) dan 7 berkas action | Pencocokan jabatan↔profil, embedding, pemodelan topik, pengelompokan kompetensi |
| **Keamanan** | `auth.ts`, `rbac.ts`, `tenant.ts` | Otentikasi, 11 izin, multi-tenant |
| **Tata kelola** | `program-actions.ts`, `program-defaults.ts`, `readiness-config-actions.ts`, `retirement-config-actions.ts`, `scoring-prompt-actions.ts` | Templat program, ambang kesiapan dan pensiun, prompt model (kriteria pendidikan dan narasi AHP) |
| **Utilitas lintas** | `datetime.ts`, `audit.ts`, `navigation.ts`, `candidate-visibility.ts`, `filter-rules.ts` | Format waktu terpaku Asia/Jakarta, jejak audit, penyaring tombstone |

#### Lapisan data (`lib/db/`)

Skema dimiliki aplikasi web dan didefinisikan dengan Drizzle ORM di
`lib/db/schema.ts` (66 tabel). Migrasi tinggal di `drizzle/`.

Empat modul kecil di `lib/db/` menangani hal-hal yang mudah salah:

- `index.ts` — klien Postgres; menerima `DATABASE_URL` maupun `POSTGRES_URL`.
- `vector-db.ts` — koneksi terpisah untuk basis data pgvector, mengikuti
  `VECTOR_DATABASE_URL` dan jatuh kembali ke `DATABASE_URL`.
- `pg-time.ts` dan `drizzle-time.ts` — memaku penafsiran kolom
  `timestamp without time zone`. Basis data menyimpan waktu dinding WIB pada 55
  kolom; tanpa pemakuan ini kontainer UTC membaca nilai yang sama sebagai
  instant yang berbeda tujuh jam.

### 2.3 sync-service — gerbang data masuk

Layanan Express bertugas menarik data dari dunia luar ke dalam Postgres. Ia
tidak punya otentikasi sendiri dan tidak boleh diekspos; aplikasi web
memproksikannya dan memaksakan izin `sync.manage` di depan.

Strukturnya: 28 modul layanan di `sync-service/src/services/`, tiga router
(36 endpoint), satu penjadwal, dan sebuah CLI.

| Subsistem | Modul | Fungsi |
|---|---|---|
| Sumber MSSQL | `employee-sync`, `org-sync`, `position-sync`, `performance-sync`, `behavior-sync`, `grade-sync` | Menarik karyawan, struktur organisasi, jabatan, penilaian kinerja, kompetensi perilaku, jenjang grade |
| Sumber REST | `disciplinary-sync`, `education-sync`, `employee-personal-sync` | Catatan disiplin, riwayat pendidikan, data pribadi |
| Sumber berkas | `job-profile-sync`, `llm-processor`, `hav-sync`, `mcu-sync`, `kamus-sync` | Ekstraksi PDF profil jabatan dengan model visi; Excel HAV dan MCU |
| Unggahan Excel | `excel-sources`, `excel-ingest`, `excel-template`, `upload-store` | Registri deklaratif 10 sumber yang dapat digantikan unggahan sekali jalan |
| Turunan | `candidate-populate`, `clean-sync` | Menyusun baris `candidates` dari data tersinkron |
| Infrastruktur | `db-settings`, `token`, `sync-audit`, `sync-summary`, `network-share` | Koneksi sumber tersimpan, token OAuth, jejak audit |

**Registri Excel adalah satu sumber kebenaran untuk tiga hal sekaligus** —
pengurai, templat yang dapat diunduh, dan pernyataan upsert. Sepuluh sumber
terdaftar: karyawan, empat sumber jabatan, kinerja, level & grade, kompetensi
perilaku, catatan disiplin, dan riwayat pendidikan. Kandidat, divisi,
departemen, dan langkah populasi jabatan sengaja **tidak** dapat diunggah —
keempatnya diturunkan dari Postgres, bukan ditarik dari mana pun.

### 2.4 scoring-service — mesin penilaian

Layanan Express berumur panjang yang menjalankan penilaian sesungguhnya. Ia ada
sebagai proses tersendiri semata-mata karena durasi: satu run dapat berarti
puluhan sampai ratusan panggilan model dan embedding.

Satu mesin penilaian hidup di dalamnya: **AHP + TOPSIS**
(`ahp-topsis-engine.ts`, ± 7.800 baris). Metode deterministik yang menghitung
enam skor aspek lalu memeringkat dengan bobot AHP dan TOPSIS klasik.

Mesin kedua yang dulu hidup berdampingan — **AI Tournament** (LLM), dengan
subagen aspek, agen justifikasi, dan tahap *replace-worst* — **dihapus pada
November 2026**. Sesi yang masih membawa metode itu tidak dinilai: runner
menggagalkannya dengan pesan bahwa metodenya sudah dihapus. `scoring-engine.ts`
kini hanya memuat pemuat bersama (sesi, posisi, pencocokan job profile), pita
kesiapan, dan skor kuadran HAV; `tournament-evidence.ts` dihapus.

| Aspek | Cara dihitung | Modul pendukung |
|---|---|---|
| Teknis | Penugasan satu-ke-satu Hungarian atas embedding level kompetensi kumulatif, dua tahap (identitas lebih dulu, sisanya Hungarian) | `hungarian.ts`, `technical-anchors.ts`, `competency-level.ts` |
| Relevansi karier | Akumulasi pengalaman relevan — kemiripan dokumen dikalikan masa kerja, jenuh pada dua sumbu | `career-anchors.ts`, `career-depth-anchors.ts`, `competency-idf.ts` |
| Perilaku | Kategorisasi ordinal berpasangan 6..0 | `ahp-topsis-engine.ts` |
| Kinerja (PA) | TOPSIS solusi absolut dengan jangkar all-A/all-D dan bobot periode dari AHP | `pa-score.ts`, `topsis.ts` |
| HAV | Aturan kuadran lima tingkat | `scoring-engine.ts` (`computeHavScore`) |
| Pendidikan | Pencocokan tepat deterministik, lalu Gemini dengan grounding Google Search | `gemini.ts` |

Satu-satunya model bahasa yang ikut membentuk angka adalah Gemini, pada aspek
pendidikan yang tidak cocok persis. LLM lain menulis narasi insight per finalis
(`ahp-narrative.ts`) setelah peringkat tersimpan, dan narasi itu tidak pernah
dibaca kembali menjadi angka; pada run **mode demo** penulis ini
tidak dipanggil sama sekali, sehingga finalisnya memakai narasi templat
deterministik.

Dua subsistem pendukung melengkapinya:

- **Runner** (`runner.ts`) — memelihara peta sesi yang sedang diproses, dibatasi
  `SCORING_MAX_CONCURRENT` (baku 2). Penolakan karena batas **bukan kegagalan**:
  sesi tetap `running` tanpa pekerja, yang persis dicari penyapu sesi yatim, dan
  penyapu itulah yang menguras antrean saat slot kosong. Inilah alasan
  penilaian massal tidak memerlukan tabel antrean.
- **Embedding** (`embeddings.ts`, `embed-routes.ts`) — menyediakan endpoint
  embedding yang juga dipakai aplikasi web untuk sumber model `multilingual`.

### 2.5 topic-service — pengelompokan job family

Layanan FastAPI berbahasa Python. Ia menjalankan pipeline BERTopic (UMAP →
HDBSCAN → c-TF-IDF) atas embedding dokumen profil jabatan yang **sudah dihitung
sebelumnya** dan tersimpan di Postgres. Layanan ini tidak pernah melakukan
embedding sendiri.

Empat endpoint kerja, ditambah `/health`: `POST /topics/build` (menerima 202
seketika lalu memproses di latar) dan `GET /topics/{run_id}/status` untuk membangun
peta, serta `POST /topics/trials` dan `GET /topics/trials/{trial_id}` untuk
MENGUKUR pengaturan calon tanpa menyimpan run — dipakai panel Optimasi Job Family
agar hanya pengaturan yang terukur mencapai sasarannya yang ditawarkan. Pengukuran
dan pembangunan memakai fungsi pengelompokan yang sama (`pipeline.cluster`), dan
pipeline-nya deterministik, sehingga pengaturan yang diukur menghasilkan peta yang
sama ketika dibangun pada korpus yang sama. Setiap run mencatat sidik korpus yang
dikelompokkannya (`diagnostics.corpus`), dihitung dengan rumus yang sama dengan
`lib/job-family/corpus.ts` di aplikasi web, sehingga web dapat mengetahui kapan
peta tidak lagi menggambarkan korpus yang ter-embed. Eksekusi diserialkan dengan
kunci utas — UMAP dan HDBSCAN boros memori; build kedua ditolak 409, sedangkan
build yang datang di tengah pengukuran didahulukan dan pengukurannya berhenti.

### 2.6 Lapisan penyimpanan

**PostgreSQL utama** menampung 66 tabel. Ketiga layanan Node terhubung ke basis
data yang sama; skema dimiliki aplikasi web, sedangkan sync-service dan
scoring-service memakai klien ringan mereka sendiri dengan SQL tulisan tangan.

| Kelompok tabel | Contoh | Pemilik penulisan |
|---|---|---|
| Penyewa & akses | `tenants`, `users`, `app_roles`, `app_role_permissions` | web |
| Data tersinkron | `sync_employees`, `sync_positions`, `sync_job_profiles`, `sync_performance_appraisals`, `sync_hav`, `sync_mcu`, `sync_kamus_kompetensi` (23 tabel) | sync-service |
| Kurasi pengguna | `critical_positions`, `critical_position_holders`, `candidates`, `program_templates` | web |
| Penilaian | `tournament_sessions`, `scoring_runs`, `analysis_results`, `scoring_run_pool_aspects`, `scoring_run_exclusions` | web membuat, scoring-service mengisi |
| Keputusan | `position_picks` | web |
| Job Family | `job_family_topic_runs`, `_topics`, `_assignments`, `job_family_matches`, `job_family_optimization_expectations` | web + topic-service |
| Kalibrasi | `kamus_similarity_calibration`, `job_profile_similarity_calibration`, `job_family_title_embed` | scoring-service + web |
| Jejak | `audit_log`, `sync_runs`, `chat_messages` | semua |

**PostgreSQL + pgvector** menampung tiga tabel embedding: `job_profile_embed`,
`kamus_kompetensi_embed`, dan `kamus_kompetensi_level_embed`. Basis data ini
mengikuti `VECTOR_DATABASE_URL` dan tidak harus berada pada instans yang sama.
Konsekuensinya bersifat mengikat: apa pun yang perlu menyaring vektor menurut
tabel non-vektor — kepemilikan penyewa, misalnya — **harus** mengoper daftar id,
bukan melakukan join SQL melintasi batas itu.

---

## 3. Alur Data dan Sinyal

### 3.1 Alur besar: dari sumber HR sampai peringkat suksesor

```
  SUMBER LUAR                 SYNC-SERVICE            POSTGRES
  ───────────                 ────────────            ────────
  MSSQL DB MPMDS      ──┐
  MSSQL DB MPMHRGA    ──┤
  REST API gateway    ──┼──>  28 modul sync  ──>  sync_* (23 tabel)
  Folder PDF bersama  ──┤     + model visi              │
  Excel HAV / MCU     ──┘                               │
                                                        v
                                              candidate-populate
                                                        │
                                                        v
  PENGGUNA (kurasi)  ────────────────────────>   candidates
        │                                        critical_positions
        │                                        program_templates
        v                                               │
  WEB: wisaya penilaian                                 │
        │                                               │
        │ 1. bangun kolam (filter grade, aturan filter,  │
        │    kecualikan pemangku jabatan)  <─────────────┘
        │ 2. tulis tournament_sessions + scoring_runs
        │ 3. bekukan config_snapshot
        │ 4. POST /api/scoring/start   ── fire-and-forget
        v
  SCORING-SERVICE
        │ mengubah baris basis data sendiri sambil berjalan
        v
  analysis_results  ──>  WEB menyurvei status  ──>  PENGGUNA
                                                     │
                                                     v
                                              position_picks
                                           (keputusan manusia)
```

### 3.2 Alur satu: sinkronisasi data

**Pemicu.** Tiga jalan masuk, semuanya berujung pada modul layanan yang sama:
cron mingguan (baku Senin 01:00 WIB, zona waktu Asia/Jakarta), CLI
(`npm run cli -- <job>`), atau HTTP (`POST /sync/*`) yang diproksikan aplikasi
web.

**Urutan sinkronisasi penuh.** Urutan ini bukan pilihan bebas — setiap langkah
membaca hasil langkah sebelumnya:

1. `syncEmployees` — karyawan dari `DVP_PERSON_CURRENT` dan
   `dbo.MPMDS_ORANGE_DATA`
2. `syncOrgStructure` — divisi dan departemen
3. `syncPositionBundle` — master jabatan, hierarki, penempatan karyawan,
   kompetensi teknis (empat pekerjaan dalam satu bundel)
4. `syncPerformance` — penilaian kinerja dari `dbo.DVP_PA_HISTORY_DTL`
5. `syncAllDisciplinary` — catatan disiplin lewat REST
   `/employeeV6/edp/EmployeeDisciplinary`
6. `syncAllEducation` — riwayat pendidikan lewat REST
   `/employeeV6/edp/EmployeeEducation`
7. `syncAllEmployeePersonal` — data pribadi lewat REST
   `/employeeV1/employee/Information`
8. `populateCandidates` — **langkah turunan**: menyusun baris `candidates` dari
   semua yang di atas
9. `syncJobProfiles` — ekstraksi PDF dengan model visi
10. `syncGradeLevels`, `syncBehaviorCompetencies`

**Dua sifat aliran yang menentukan perilaku sistem.**

*Pertama, penarikan bersifat memperbarui dan tidak pernah menghapus.* Kedua
upsert pada jalur data pribadi mempertahankan tanggal lahir yang sudah ada bila
sumber tidak mengembalikan apa pun, karena pekerjaan ini berjalan tanpa
pengawasan pada cron Senin dan satu respons kosong dari hulu tidak boleh
menghapus umur semua orang.

*Kedua, ekstraksi profil jabatan punya antrean sendiri.* Kolom
`sync_job_profiles.queued_at` memisahkan dua pertanyaan yang sebelumnya
tercampur: `status` berarti *keadaan isi hasil ekstraksi*, `queued_at` berarti
*berkas ini menunggu diekstraksi ulang*. Pemisahan ini wajib karena sembilan
tempat memilih baris dengan `status = 'completed'`; menandai seluruh batch
sebagai `pending` di awal akan mengosongkan korpus profil jabatan selama satu
jam yang dibutuhkan ekstraksi 280 berkas — secara diam-diam, dengan setiap
pembaca jatuh ke jalur cadangan.

### 3.3 Alur dua: penilaian (jalur paling panjang)

Ini adalah alur inti sistem dan pantas diurai per sinyal.

**Langkah 1 — Pengguna memulai.** Wisaya di `/scoring/new` mengumpulkan jabatan
sasaran dan program. Tidak ada pilihan metode: setiap run memakai AHP + TOPSIS.

**Langkah 2 — Aplikasi web membangun kolam.** `startTournamentSessionAction`
menyaring kandidat menurut rentang grade, aturan filter program, dan pengecualian
pemangku jabatan. Semua pemangku jabatan aktif dikecualikan — bukan hanya yang
utama — karena satu jabatan dapat dipangku banyak orang sekaligus dan pemangku
yang duduk di kursi itu tidak boleh diperingkat sebagai penggantinya sendiri.

**Langkah 3 — Aplikasi web menulis tiga fakta ke basis data.** Baris
`tournament_sessions` (dengan `current_pool` dan `pending_pool` sebagai larik id
kandidat), baris `scoring_runs` sebagai penampung, dan `config_snapshot` yang
membekukan templat program beserta ambang kesiapan **sekali** pada saat
pembuatan dan tidak pernah diperbarui. Pembekuan ini yang membuat peringkat
lama tetap dapat dijelaskan setelah aturan berubah.

**Langkah 4 — Pengiriman.** `notifyScoringService` mem-POST ke
`SCORING_SERVICE_URL`. Sinyal balik dari langkah ini adalah sebuah
`ScoringDispatch`, bukan pengecualian:

| `status` | `reason` | Arti | Yang ditampilkan |
|---|---|---|---|
| `dispatched` | — | Layanan menerima dan mulai bekerja | "penilaian dimulai" |
| `queued` | `unreachable` | Fetch gagal — koneksi ditolak, DNS, atau batas waktu 5 detik | "tunggu" |
| `queued` | `rejected` | Layanan menjawab dengan galat HTTP (jadi ia hidup) | kode status, "laporkan" |
| `queued` | `unconfigured` | `SCORING_SERVICE_URL` tidak diatur | pesan konfigurasi |

Ketiga varian `queued` sengaja **bukan** pengecualian yang dilempar: barisnya
sudah tersimpan, dan melempar setelah commit akan meninggalkan sesi yatim
*sekaligus* pesan galat. Keempat kemungkinan ini dirender amber, bukan merah,
disertai kalimat "sesinya sudah tersimpan, jangan jalankan ulang" — karena
menjalankan ulang persis yang dilakukan pengguna terhadap batch yang tampak
gagal, dan itu hanya menumpuk sesi kedua pada kursi yang sama.

**Langkah 5 — scoring-service bekerja.** Layanan mengubah
`tournament_sessions` dan `scoring_runs` secara langsung sambil maju. Kemajuan
dilaporkan lewat `tournament_sessions.final_ranked.ahpProgress`. Hasil ditulis
lebih dulu, diagnosis run (`run_info`) sesudahnya, dan `status = 'completed'`
paling akhir. Sesi yang `scoring_method`-nya bukan `ahp_topsis` tidak dinilai:
ia gagal dengan pesan bahwa AI Tournament sudah dihapus.

**Langkah 6 — Aplikasi web menyurvei.** Rute
`app/api/tournament/[sessionId]/status` menjadi sumber kemajuan bagi wisaya.
Survei ini **kemudahan antarmuka belaka**, bukan bagian dari mekanisme: runner
menulis `analysis_results` sendiri, sehingga penilaian selesai dengan atau tanpa
tab peramban yang terbuka.

**Langkah 7 — Finalisasi cadangan.** Run selesai dengan sendirinya; langkah 5
sudah menyimpan seluruh hasil. `finalizeTournamentAction` hanya jalur cadangan
bila survei wisaya habis (satu jam): ia memanggil
`POST /api/scoring/:sessionId/finalize`, yang menjalankan ulang engine AHP +
TOPSIS secara idempoten, lalu menyurvei sampai layanan melaporkan `completed`.

**Langkah 8 — Keputusan manusia.** Peringkat bukan keputusan. Baris
`position_picks` mencatat siapa yang benar-benar dipilih, dan ia adalah keputusan
yang dibuat **dari** peringkat, bukan bagian dari peringkat itu. Karena itu
relasinya `ON DELETE SET NULL`, dan karena itu pula daftar Manajemen Posisi
mengganti pratinjau "Top Candidate" dengan RTC — jumlah suksesor yang
sungguh-sungguh dipilih.

### 3.4 Alur tiga: Job Family (tiga langkah bernomor)

Halaman peta menyatakan pipeline-nya sebagai tiga langkah bernomor, dan tepat
satu langkah berstatus `current` dengan tombol terisi. Pertanyaan "mana dulu"
dijawab oleh satu-satunya tombol terisi di layar.

```
  1. Profil jabatan diekstraksi     sync-service · model visi
     sync_job_profiles                        │
                                              v
  2. Diubah menjadi vektor          web · lib/job-family/embed.ts
     job_profile_embed (pgvector)             │
                                              v
  3. Peta dibangun                  topic-service · BERTopic
     job_family_topic_runs/_topics/_assignments
```

Aplikasi web membuat baris `job_family_topic_runs`, mem-POST `/topics/build`,
menerima 202 seketika, lalu mengawasi baris itu — pola *fire-and-forget* yang
sama persis dengan scoring-service.

Di samping pipeline BERTopic berjalan **pencocokan jabatan↔profil** dengan
empat tingkat otomatis ditambah satu penyematan manual: kode jabatan pada nama
berkas → judul identik → kosinus embedding di atas 0,98 → AI. Tingkat AI hanya
boleh memilih dari daftar pendek ±10 profil terdekat, "tidak ada" adalah jawaban
kelas satu, dan setiap keputusan disimpan per judul ternormalisasi termasuk
penolakannya.

### 3.5 Sinyal-sinyal yang bukan data

Beberapa aliran penting membawa isyarat, bukan muatan:

| Sinyal | Dari → Ke | Makna |
|---|---|---|
| Penyapu sesi yatim | scoring-service → dirinya sendiri, tiap 10 detik | Sesi `running` tanpa pekerja berarti ada slot yang bisa diisi |
| `x-pulse-actor` | web → sync-service | Siapa yang memicu sinkronisasi; layanan tidak punya sesi untuk mengetahuinya |
| `POST /_reload-prompts` | web → scoring-service | Suntingan prompt di Tata Kelola berlaku tanpa restart |
| `POST /embed/technical-anchors/refresh` | web → scoring-service | Kamus baru saja di-embed ulang; hitung ulang jangkar sekarang |
| `POST /embed/career-anchors/refresh` | web → scoring-service | Korpus profil jabatan berubah |
| `revalidatePath` | server action → cache Next.js | Halaman perlu dirender ulang |

---

## 4. Masukan (Input) dan Keluaran (Output)

### 4.1 Sumber masukan

Sistem menerima masukan dari lima jenis sumber yang berbeda sifatnya.

#### A. Basis data korporat (MSSQL, tarik terjadwal)

| Basis data | Tabel sumber | Isi |
|---|---|---|
| `DB MPMDS` | `DVP_PERSON_CURRENT`, `dbo.MPMDS_ORANGE_DATA` | Karyawan induk |
| `DB MPMDS` | `dbo.DVP_POSITION_TBL`, `dbo.DVP_POSITION_STRUCTURE_TBL`, `dbo.DVP_EMPLOYEE_POSITION_TBL` | Master jabatan, hierarki, penempatan |
| `DB MPMDS` | `dbo.DVP_TECH_COMPETENCY_MAP_SUBDTL` | Kompetensi teknis yang dituntut jabatan |
| `DB MPMDS` | `DVP_ASSESSMENT_CENTER_HDR/DTL`, `DVP_MASTER_BEHAVIOUR_COMPETENCY_HDR` | Assessment center, kompetensi perilaku |
| `DB MPMHRGA` | `dbo.DVP_PA_HISTORY_DTL` | Riwayat penilaian kinerja |

Kredensial diselesaikan **per koneksi**, bukan sebagai snapshot tingkat modul.
Baris aktif pada `sync_source_connections` mengalahkan variabel lingkungan
`DB_MPMDS_*`/`DB_MPMHRGA_*`. Sifat per-koneksi ini wajib: mode kegagalan
sebaliknya tidak terlihat sama sekali — baris diperbarui, API menjawab 200, dan
layanan terus menyambung ke server lama selamanya.

#### B. API REST korporat (tarik terjadwal, OAuth client-credentials)

| Endpoint | Isi | Bentuk |
|---|---|---|
| `/employeeV6/edp/EmployeeDisciplinary` | Catatan disiplin | per karyawan |
| `/employeeV6/edp/EmployeeEducation` | Riwayat pendidikan | per karyawan |
| `/employeeV1/employee/Information` | Data pribadi | **daftar** |

Endpoint ketiga berbentuk daftar, dan dari muatan yang juga membawa NIK, NPWP,
BPJS, nomor telepon, dan surel, hanya **tanggal lahir dan nama tampilan** yang
disimpan. Tidak ada yang membaca sisanya, dan menyimpannya hanya akan
memperbesar kerugian bila basis data bocor. Umur kandidat karena itu **selalu
diturunkan, tidak pernah disimpan**.

#### C. Berkas pada folder bersama dan unggahan

| Sumber | Bentuk | Pemroses |
|---|---|---|
| `LOCAL_PDF_FOLDER` | PDF profil jabatan | PDF→PNG lalu panggilan model visi; hasil JSON terstruktur |
| `LOCAL_HAV_FOLDER` | Excel kuadran HAV | `hav-sync` |
| `LOCAL_MCU_FOLDER` | Excel status medis | `mcu-sync` |
| `LOCAL_UPLOAD_FOLDER` | Unggahan dari halaman Sinkronisasi | 10 jenis sumber Excel |

Ekstraksi PDF mencoba ulang hingga tiga kali dengan mundur eksponensial
berjitter, dan **percobaan ulang itu hanya berguna karena ia mengubah
temperatur**. Percobaan pertama tetap pada 0 agar ekstraksi normal dapat
direproduksi; percobaan berikutnya naik sampai 0,6. Pada temperatur 0
mengirim ulang gambar yang identik mengembalikan token yang identik — mengulang
kegagalan JSON yang cacat akan mereproduksi JSON cacat yang sama, dengan biaya
satu panggilan visi multi-halaman lagi.

#### D. Masukan pengguna

| Masukan | Halaman | Bentuk |
|---|---|---|
| Kurasi jabatan kritikal | Manajemen Posisi | Satu per satu atau massal menurut grade pemangku |
| Kurasi kandidat | Kandidat | Penambahan, penyuntingan, penghapusan bertombstone |
| Templat program | Tata Kelola | Pohon aturan filter, daftar kriteria, matriks AHP, target finalis |
| Pemilihan suksesor | Detail jabatan | `position_picks` |
| Pengecualian kandidat | Detail run | Penandaan beralasan saja; angka dan peringkat run tidak berubah, tidak ada run baru |
| Ambang kesiapan dan pensiun | Tata Kelola | Berkas JSON, dibaca `readFileSync` |
| Catatan MCU manual | Kandidat (isian "Keterangan MCU") | Kolom terpisah dari yang tersinkron |
| Pertanyaan ke asisten | Panel chat | Aliran jawaban |

#### E. Layanan kecerdasan buatan luar

| Layanan | Dipakai untuk | Pemanggil |
|---|---|---|
| Endpoint kompatibel-OpenAI (`LLM_BASE_URL`) | Narasi insight AHP (tidak pada run mode demo), pencocokan judul tingkat AI, pemetaan nama kompetensi, asisten chat | web + scoring-service |
| Model visi (`VISI_MODEL`) | Ekstraksi PDF profil jabatan | sync-service |
| Gemini + grounding Google Search | Aspek pendidikan | scoring-service |
| Endpoint embedding (Nomic lokal/jauh, atau E5 multilingual in-process) | Semua vektor | web + scoring-service |

Satu aturan mengikat keempatnya: **konsistensi ruang embedding**.
scoring-service harus memakai model dan transport yang sama dengan pembangunan
ulang Job Family aplikasi web, karena ia membandingkan terhadap vektor *yang
ditulis aplikasi itu*. Mengubah `EMBEDDING_MODEL` di satu sisi saja membuat
setiap kosinus tak bermakna **tanpa menggagalkan apa pun**.

### 4.2 Bentuk keluaran

#### Keluaran utama — peringkat suksesor

Produk akhir sistem adalah daftar terperingkat calon suksesor untuk sebuah
jabatan, tersimpan di `analysis_results`, disertai seluruh perkakas untuk
menjelaskannya:

| Keluaran | Isi |
|---|---|
| Peringkat | Skor akhir, urutan, band kesiapan (Short/Medium/Long/Not Ready) |
| Rincian enam aspek | Skor per aspek dengan penurunannya |
| Bobot yang berlaku | Dari matriks AHP program, atau bawaan sistem |
| Konfigurasi run | Snapshot beku: pohon aturan, kriteria, matriks, ambang |
| Diagnostik run | Jangkar kemiripan, target kedalaman karier, kriteria yang dijatuhkan, jumlah kolam |
| Silsilah run | Pohon induk-anak beserta mode penilaian ulang |

#### Keluaran sekunder

| Keluaran | Bentuk | Modul |
|---|---|---|
| Ringkasan Beranda | Kartu metrik, masing-masing dengan popover "?" yang menyebut pembilang dan penyebutnya | `dashboard-page-client.tsx` |
| Ekspor analisis | `.xlsx` (SheetJS), `.pdf` (jsPDF) | `lib/analysis-export.ts` |
| Ekspor percakapan | `.pdf`, `.docx` (OOXML asli), `.xlsx` | `lib/chat-export.ts` |
| Peta Job Family | Visualisasi klaster, silsilah, sebaran | `components/analysis/`, `components/job-family/` |
| Laporan pencocokan | Pasangan jabatan↔profil beserta tingkat pencocokannya | `job_profile_match_runs` |
| Jejak audit | Siapa mengubah apa, kapan | `audit_log` |
| Templat Excel | Berkas unduhan per jenis sumber | `excel-template.ts` |

Ekspor percakapan pantas dicatat satu hal: ia berjalan sepenuhnya di peramban
dari riwayat yang sudah dimuat panel, sehingga tidak menambah permukaan
server maupun salinan kedua aturan izin — tetapi ia **memindahkan prosa tentang
orang bernama ke berkas di luar kustodi aplikasi**. Karena itu dokumennya
menyebut run yang memilikinya.

---

## 5. Hubungan dan Ketergantungan Antar-Modul

### 5.1 Ketergantungan antar-deployable

```
   web ──── HTTP (proksi, sinkron) ─────> sync-service
   web ──── HTTP (fire-and-forget) ─────> scoring-service
   web ──── HTTP (fire-and-forget) ─────> topic-service
   web ──── HTTP (embedding, sinkron) ──> scoring-service

   web ─────────────┐
   sync-service ────┼──── SQL ──> PostgreSQL utama
   scoring-service ─┤
   topic-service ───┘

   web ─────────────┬──── SQL ──> PostgreSQL vektor
   scoring-service ─┘

   x sync-service tidak pernah memanggil scoring-service
   x scoring-service tidak pernah memanggil sync-service
   x topic-service tidak memanggil siapa pun
```

Ketiga layanan latar **tidak pernah saling memanggil**. Koordinasi apa pun
antar-mereka terjadi melalui basis data bersama atau melalui aplikasi web. Ini
menjaga setiap layanan dapat dijalankan, di-restart, dan gagal sendiri-sendiri.

### 5.2 Sifat tiap sambungan

| Dari → Ke | Sifat | Bila putus |
|---|---|---|
| web → sync-service | Sinkron, diproksikan, wajib `sync.manage` | Halaman Sinkronisasi melaporkan galat; tidak ada yang lain terpengaruh |
| web → scoring-service | Asinkron, fire-and-forget | Sesi tetap tersimpan dan **berstatus antre**; penyapu yatim mengambilnya saat layanan kembali |
| web → topic-service | Asinkron, fire-and-forget | Run ditandai gagal dengan pesan eksplisit |
| web → scoring-service (embedding) | Sinkron | Sumber model `multilingual` tidak tersedia; dua sumber Nomic tetap jalan |
| Semua → Postgres | Sinkron, wajib | Sistem berhenti |
| web/scoring → pgvector | Sinkron | Pencocokan embedding jatuh ke tingkat deterministik; laporan menyatakan degradasinya |

Pola *fire-and-forget* pada dua sambungan itu adalah keputusan arsitektur
terpenting dalam sistem ini. Ia berarti **basis data, bukan panggilan HTTP, yang
menjadi kontrak**. Aplikasi web melakukan commit atas barisnya lebih dulu; POST
hanyalah bisikan "ada pekerjaan". Kalau bisikan itu hilang, pekerjaan tetap ada,
dan penyapu akan menemukannya.

### 5.3 Berkas yang sengaja digandakan

Karena ketiga layanan Node adalah deployable terpisah tanpa `lib/` bersama,
beberapa modul hidup dua kali. Ini disengaja, dan setiap pasangan punya
konsekuensi bila menyimpang.

| Modul | Salinan | Bila menyimpang |
|---|---|---|
| Matematika AHP | `lib/ahp.ts` ↔ `scoring-service/src/ahp.ts` | Bobot berbeda antara yang ditampilkan dan yang dipakai |
| Bobot aspek bawaan | `lib/scoring-criteria.ts` ↔ `scoring-service/src/ahp-weights.ts` | Sama |
| Pemakuan waktu pg | `lib/db/pg-time.ts` ↔ salinan di kedua layanan | Pergeseran tujuh jam yang senyap |
| Normalisasi nama kompetensi | `lib/kamus-name-match.ts` ↔ `scoring-service/src/ahp-topsis-engine.ts` dan `sync-service/src/services/job-profile-competencies.ts` | Keputusan tersimpan di `kamus_competency_match_cache` tidak pernah ditemukan |

Satu modul sengaja **tidak** digandakan: langkah peringkat akhir TOPSIS.
`scoring-service/src/ahp-criteria.ts`, `topsis.ts`, dan `topsis-ranking.ts`
tidak memiliki ketergantungan apa pun dan diimpor langsung oleh aplikasi web
(`lib/run-compare.ts`) untuk perbandingan run (tab "Komparasi Versi" di
halaman posisi), rincian TOPSIS per kandidat, dan pemeriksaan keterulangan. `.dockerignore` web mengecualikan ketiga berkas itu
dari pengecualian `scoring-service/`. Salinan rumus di web akan membuat
perhitungan ulang dapat berbeda dari angka yang dihitung engine; penjaganya tes
`TC-CMP-STRUCT` di `tests/scoring/run-compare.test.ts`.

Beberapa pasangan diikat oleh skrip verifikasi, bukan hanya oleh disiplin:
`scripts/verify-mcu-advisory.ts`, `scripts/verify-drizzle-time.ts`, dan
`scripts/audit-run-label-stamps.ts`.

### 5.4 Modul yang menjadi titik kumpul

Beberapa modul dibaca dari banyak tempat sekaligus, dan karenanya perubahan di
dalamnya menjalar paling jauh.

| Modul | Dibaca oleh | Perannya |
|---|---|---|
| `lib/db/schema.ts` | Ketiga layanan (secara tak langsung), seluruh `lib/` | Bentuk baris; mengubah nama kolom memutus SQL tulisan tangan di dua layanan lain |
| `lib/navigation.ts` | Bilah sisi, judul halaman, label utas aktivitas | Registri menu; sengaja aman untuk klien |
| `lib/rbac.ts` | Setiap halaman dan hampir setiap action | 11 izin; `server-only` |
| `lib/tenant.ts` | Hampir setiap kueri | Penyewa; tidak ada RLS, jadi penyaringan harus eksplisit |
| `lib/scoring-criteria.ts` | Editor tata kelola, panel konfigurasi run, penjelas | Nama kriteria kanonik dan bobot bawaan |
| `lib/datetime.ts` | Setiap tempat yang mencetak waktu | Satu-satunya pemformat; `YYYY-MM-DD HH:mm` terpaku Asia/Jakarta |
| `lib/candidate-visibility.ts` | Setiap kueri kandidat | Penyaring tombstone, dengan tiga kategori pemakaian |
| `lib/rerun-modes.ts` | Dialog, pohon, log audit, panel konfigurasi | Tabel mode penilaian ulang: satu yang dapat dibuat, empat mode lama yang hanya dibaca |
| `lib/run-label.ts` | Setiap pembuatan dan penampilan label run | Pengupas label; harus mengenali **setiap** bentuk yang pernah ditulis |

### 5.5 Ketergantungan yang sengaja dihindari

Sama pentingnya dengan apa yang saling berbicara adalah apa yang sengaja
**tidak**.

- **Penyelesai nama kompetensi tinggal di aplikasi web; scoring-service hanya
  membaca cache-nya.** Penilaian harus tetap dapat dijalankan tanpa model apa
  pun yang terjangkau, karena penyapu sesi yatim menjalankan ulang sesi tanpa
  pengawasan.
- **MCU tidak pernah menyentuh `final_score`.** Status MCU diperiksa lewat
  aturan filter *advisory* yang hanya menandai: ia tidak menggugurkan kandidat,
  bukan kriteria, dan tidak dikirim ke prompt model mana pun. Menambahkan kunci
  AHP ketujuh adalah alternatif yang jelas dan justru yang harus terus ditolak:
  `AHP_CRITERIA_ORDER` adalah urutan baris dan kolom setiap matriks
  **tersimpan**, sehingga menumbuhkannya menjadi 7 membuat tiap matriks 6×6
  tersimpan gagal validasi dan jatuh **secara senyap** ke bobot bawaan.
- **Penilaian sengaja mengabaikan cakupan penyewa dokumen profil jabatan.**
  Mesin AHP+TOPSIS dan pembangunan ulang embedding membaca seluruh korpus, sebab
  satu run penilaian boleh memuat kandidat dari unit lain; menerapkan cakupan di sana
  akan menjatuhkan kriteria karier dan teknis mereka dan diam-diam
  mendistribusikan ulang bobot AHP.

### 5.6 Kustodi konfigurasi bersama

Beberapa berkas dimiliki aplikasi web tetapi dibaca layanan lain. Ini
ketergantungan lewat sistem berkas, bukan lewat jaringan, dan `docker-compose.yml`
memasangnya sebagai bind mount agar suntingan benar-benar sampai.

| Berkas | Pemilik | Pembaca | Mekanisme muat ulang |
|---|---|---|---|
| `lib/scoring-prompts.json` | web (Tata Kelola) | scoring-service | `POST /api/scoring/_reload-prompts` |
| `lib/readiness-config.json` | web (Tata Kelola) | web + scoring-service | `POST /api/scoring/_reload-readiness` |
| `lib/retirement-config.json` | web (Tata Kelola) | web | dibaca `readFileSync` tiap permintaan |

Satu jebakan tercatat di komentar compose dan pantas diulang: tanpa bind mount
itu, scoring-service berjalan **secara senyap** di atas prompt dan ambang
kesiapan cadangan yang ter-hardcode, dan suntingan Tata Kelola tidak pernah
sampai kepadanya.

### 5.7 Keamanan sebagai lapisan lintas

Keamanan tidak berdiri sebagai modul melainkan memotong setiap lapisan.

**Otentikasi.** NextAuth dengan penyedia Keycloak, tetapi Keycloak **opsional**:
bila `KEYCLOAK_CLIENT_ID/SECRET/ISSUER` tidak diatur, aplikasi berjalan sebagai
satu "System User" ter-hardcode berhak admin. Saat Keycloak terkonfigurasi,
callback JWT mengambil data organisasi dari `PORTAL_API_URL` dan menyimpannya di
memori selama lima menit. Peran **tidak** diambil dari Keycloak — ia dikelola
sepenuhnya di dalam aplikasi.

**Otorisasi.** Sebelas izin di `lib/rbac.ts` (izin `scoring.feedback` ikut dihapus bersama umpan balik run). Setiap halaman dijaga, setiap
server action memeriksa ulang. Pemisahan yang patut dicatat: halaman Talent Pool
hanya butuh `candidates.view` untuk dilihat, tetapi menyunting aturannya butuh
`governance.manage` — templat yang sama juga menentukan siapa yang diterima
sebuah penilaian, jadi memunculkannya tidak boleh memperlebar siapa yang boleh
mengubahnya.

**Multi-tenant.** Tiga penyewa ter-hardcode di `lib/tenant.ts`, dipilih lewat
cookie `pulse_tenant`. **Tidak ada RLS**; hampir setiap kueri menyaring
`tenantId` secara eksplisit. Dokumen profil jabatan adalah satu-satunya hal yang
bercakupan tidak langsung, lewat tabel banyak-ke-banyak `job_profile_tenants`.

**Penyimpanan data.** Tidak ada enkripsi tingkat aplikasi. Data kandidat
(termasuk kedua kolom catatan MCU dan tanggal lahir), isi pesan chat,
penempatan Talent Mapping beserta jejak auditnya, jejak perhitungan run, dan
kata sandi koneksi basis data sumber tersimpan sebagai teks biasa di
PostgreSQL. Perlindungannya bergantung pada kendali akses basis data — akun dan
hak aksesnya, jaringan yang dapat menjangkaunya, serta penanganan cadangan —
ditambah izin aplikasi di atas: siapa pun yang memegang akses baca langsung ke
basis data dapat membaca seluruh isinya, jadi akses itu harus dibatasi sesempit
mungkin.

---

## 6. Pola arsitektur yang berulang

Menutup dokumen, beberapa pola muncul berkali-kali dan lebih mudah dikenali
sekali daripada ditemukan ulang tiap kali.

**Basis data adalah kontrak, bukan panggilan HTTP.** Penilaian, pemodelan topik,
dan penyapu yatim semuanya mengikuti pola yang sama: tulis baris, kirim bisikan,
biarkan pembaca menemukan pekerjaannya. Bisikan yang hilang tidak merugikan
apa-apa.

**Yang selesai tidak pernah ditimpa.** Run tidak pernah diedit; penilaian ulang
menghasilkan run **baru**. Kandidat di-tombstone, tidak dihapus. Build
kompetensi dibangun ulang, tidak disunting. Alasannya satu: peringkat yang
selesai adalah catatan sebuah penilaian pada sebuah tanggal.

**Konfigurasi dibekukan bersama hasilnya.** Kolom `config_snapshot` menyimpan
templat program dan ambang kesiapan seperti adanya saat run dibuat. Templat
tetap dapat disunting selamanya; menjelaskan peringkat lama dengan pembacaan
langsung akan memperlihatkan aturan yang mungkin tidak pernah berlaku baginya.

**Degradasi dilaporkan, bukan disembunyikan.** Jabatan tanpa profil jabatan
mendapat lencana; run yang memakai kolam cadangan mencatat `poolSource`;
pengesampingan kelayakan mencatat siapa dan aturan mana yang dilewati; model
yang tak terjangkau melaporkan `aiAvailable: false` alih-alih jawaban kosong.
Aturannya konsisten: skor yang berubah makna harus menyatakan perubahannya.

**Satu tabel, bukan lima fungsi.** Lima mode penilaian ulang adalah satu tabel
dengan dua tombol (kolam dan kesegaran). Sepuluh sumber Excel adalah satu
registri yang melayani pengurai, templat, dan upsert sekaligus. Menu adalah satu
registri. Setiap kalinya, penyebab kebingungan sebelumnya adalah hal yang sama:
beberapa salinan dari satu keputusan, tanpa apa pun yang memaksanya sepakat.

---

## Lampiran A — Inventaris berkas kunci

| Berkas | Baris | Peran |
|---|---|---|
| `scoring-service/src/ahp-topsis-engine.ts` | ± 7.800 | Mesin enam aspek + AHP + TOPSIS — satu-satunya mesin penilaian |
| `lib/db/schema.ts` | ± 3.100 | Definisi 66 tabel |
| `lib/scoring-engine.ts` | ± 2.600 | Pembuatan sesi, kolam, pengiriman, penilaian ulang |
| `lib/pulse-data.ts` | 2.771 | Pembacaan agregat untuk halaman |
| `scoring-service/src/scoring-engine.ts` | ± 300 | Pemuat bersama (sesi, posisi, pencocokan job profile), pita kesiapan, skor kuadran HAV. Mesin turnamen LLM yang dulu tinggal di sini sudah dihapus |

## Lampiran B — Perintah operasional

| Perintah | Konteks | Fungsi |
|---|---|---|
| `pnpm dev` / `pnpm build` / `pnpm start` | akar | Aplikasi web |
| `pnpm db:generate` / `db:migrate` / `db:push` / `db:studio` / `db:seed` | akar | Drizzle |
| `npx tsc --noEmit` | tiap deployable | **Gerbang tipe yang sesungguhnya** |
| `npm run cli -- all` / `-- <job>` | `sync-service/` | Menjalankan sinkronisasi dari CLI |
| `pnpm dev` / `pnpm start` | `scoring-service/` | Layanan penilaian |
| `docker compose up` | akar | Seluruh tumpukan; web pada 3360 |

Dua catatan yang mudah menjebak. Skrip `pnpm lint` **rusak** — tidak ada
`eslint.config.*` dan eslint tidak terpasang. Dan `next.config.mjs` menyetel
`typescript.ignoreBuildErrors: true`, sehingga `pnpm build` yang berhasil
**tidak** berarti tipenya bersih. Gerbang yang sesungguhnya adalah
`npx tsc --noEmit` per deployable: aplikasi web memiliki ±63 galat bawaan yang
harus diperlakukan sebagai garis dasar, sementara `sync-service` dan
`scoring-service` keduanya nol dan harus tetap nol.

Tidak ada suite pengujian di repositori ini. Verifikasi dilakukan dengan
menjalankan layanan terkait, ditambah skrip verifikasi bertarget di `scripts/`
yang memaku invarian yang tidak terlihat dari pembacaan kode biasa.
