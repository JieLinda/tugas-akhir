# Mode demo dan mode asli

Aplikasi punya dua mode. **Mode asli** adalah aplikasi seperti biasa. **Mode
demo** dipakai untuk memperagakan aplikasi tanpa menyentuh data kandidat asli dan
tanpa menampilkan NPK, kode posisi, kode kompetensi, foto profil, nama kandidat
(tampil sebagai inisial unik), isi job profile (tiga kata pertama per poin), atau
isi kamus kompetensi (hanya 20% awal dan 20% akhir).

## Cara beralih

Tidak ada tombol, menu, atau penanda mode di UI. Mode dialihkan dengan kata kunci
di URL halaman mana pun:

| Kata kunci | Hasil |
|---|---|
| `?mode=demo` | Mode demo menyala |
| `?mode=asli` (juga `real`, `normal`) | Kembali ke mode asli |

Contoh: `https://pulse.example/candidates?mode=demo`. Kata kunci boleh digabung
dengan parameter lain (`/positions/…?mode=demo&tab=readiness`).

`proxy.ts` mengubah kata kunci itu menjadi cookie sesi `pulse_mode` (HttpOnly,
SameSite=Lax, Secure di https, tanpa masa berlaku), lalu mengalihkan (307) ke URL
yang sama tanpa kata kunci, sehingga alamat di browser tetap bersih. Akibatnya:

- Mode berlaku **per browser** sampai browser ditutup atau `?mode=asli` dibuka.
  Pengguna lain tidak terpengaruh.
- Mode berlaku di semua Company (tenant) yang dibuka browser itu.
- Kata kunci hanya dibaca pada halaman, bukan pada `/api/*` atau berkas statis.

### Mode bawaan per deployment

Tanpa pengaturan apa pun, browser yang belum memakai kata kunci berada di **mode
asli**. Sebuah deployment bisa mengubahnya lewat dua variabel lingkungan web app,
dibaca saat **runtime** (bukan saat build), sehingga satu image bisa dipakai
untuk deployment demo dan deployment asli:

| Variabel | Nilai | Arti |
|---|---|---|
| `PULSE_DEFAULT_MODE` | `demo` atau `asli` (bawaan `asli`) | Mode untuk browser yang belum beralih. |
| `PULSE_MODE_LOCKED` | `1` / `true` | Kata kunci `?mode=` diabaikan: semua browser selalu di mode bawaan. Tanpa ini, `?mode=asli` tetap membuka mode asli di deployment yang bawaannya demo. |

Cookie hanya mencatat **penyimpangan** dari mode bawaan: di deployment
ber-bawaan demo, `?mode=asli` menyimpan `pulse_mode=real`, dan `?mode=demo`
menghapus cookie. Pada deployment terkunci, kata kunci tetap dihapus dari URL
dan cookie lama ikut dihapus. Skrip dan cron (tanpa request browser) selalu
berjalan di mode asli, apa pun bawaannya.

Untuk deployment demo yang tidak boleh dibuka ke data asli lewat URL, pasang
keduanya: `PULSE_DEFAULT_MODE=demo` dan `PULSE_MODE_LOCKED=1`. Setelah
mengubahnya, cukup restart container web (`docker compose up -d web`); tidak
perlu build ulang.

## Kandidat di mode demo

Di halaman Kandidat, aksi **Ubah / Hapus** diganti **Edit / Turnoff / Reload**,
tombol **Tambah** disembunyikan, dan ada filter **Semua / On / Off** serta bilah
pilih massal (Pilih semua di halaman ini, Reload, Turnoff).

| Aksi | Arti |
|---|---|
| **Edit** | Semua isian formulir bisa diubah, termasuk yang terkunci di mode asli (ID Karyawan, HAV). Perubahan **tidak** ditulis ke `candidates`; disimpan sebagai salinan demo di `candidates_dupp` (upsert per kandidat) beserta daftar isian yang **benar-benar diubah**. Menyimpan juga menyalakan kandidat. ID Karyawan yang dikosongkan mempertahankan nilai sebelumnya. |
| **Turnoff** | Kandidat tidak ikut filter, Talent Pool, Talent Mapping, maupun penilaian apa pun, seolah-olah sudah dihapus. Ia tetap tercantum di halaman Kandidat agar bisa dinyalakan lagi. |
| **Reload** | Salinan demo dihapus (data asli tampil lagi) dan kandidat dinyalakan. Bila ada perubahan yang akan dibuang, aplikasi meminta konfirmasi. |

**Semua kandidat OFF secara bawaan.** Status on/off ada di
`candidate_demo_states`; tidak ada baris berarti off. Jadi sebelum memakai fitur
lain di mode demo, pilih kandidat yang ingin ditampilkan dan dinilai, lalu Reload
(atau Edit) mereka.

### Nilai yang dipakai: isian yang diedit + nilai asli untuk sisanya

Kandidat di mode demo = **isian yang diedit di mode demo**, ditambah **nilai asli
terkini** untuk semua isian yang tidak diedit. Salinan bukan potret seluruh
formulir: formulir membandingkan isian saat disimpan dengan yang tampil saat
dibuka, dan hanya isian yang berbeda yang dicatat sebagai diedit. Isian yang
pernah diedit tetap dianggap diedit sampai **Reload**.

Akibatnya:

- **HAV yang tidak diedit dihitung ulang** dari PA dan Behavior hasil gabungan
  (urutan biasa: penempatan manual › upload › rumus PA × BA). Mengubah PA saja
  menggeser HAV seperti pada kandidat asli. HAV yang **diedit** selalu menang,
  juga atas penempatan manual asli.
- Isian yang tidak diedit tetap mengikuti sinkronisasi (mis. Departemen yang
  berubah di sync).
- Kompetensi teknis yang tidak diubah tetap memakai kompetensi asli.
- Memindahkan kandidat ke kotak **otomatis** di Talent Mapping membatalkan edit
  HAV (HAV kembali dihitung dari data gabungan).
- Salinan yang dibuat sebelum aturan ini menebak isian yang diedit: isian yang
  berbeda dari nilai asli. HAV yang sama dengan upload asli atau dengan hasil
  rumus atas data asli **tidak** dianggap diedit (itu salinan HAV yang tampil).

Nilai gabungan ini yang dipakai oleh evaluasi aturan filter (termasuk pilihan
nilai di editor aturan, yang di mode demo hanya berisi nilai kandidat ON), Talent
Pool, Talent Mapping, dan kedua engine penilaian. Kandidat OFF tidak ikut di
mana pun; scoring-service juga membuang kandidat yang di-OFF-kan setelah sesi
dibuat (mis. sesi yang masih antre), kecuali kandidat yang dibawa dari run induk.

Salinan demo dibaca sebagai pengganti data asli oleh: daftar dan detail kandidat,
evaluasi aturan filter (`loadFilterableCandidates*`), Talent Pool, Talent Mapping
(HAV salinan menggantikan penempatan manual; memindahkan kandidat di peta menulis
HAV salinan), pembangunan pool penilaian, kedua engine di scoring-service
(termasuk kompetensi teknis bila salinan menyimpannya), nama di laporan
Pencocokan Job Profile, dan nama di perbandingan run serta keputusan
forum.

NPK yang diketik di salinan hanya disimpan di salinan. Semua penggabungan data
(`LPAD(employee_id, 5, '0')`) dan pengecualian pejabat tetap memakai NPK asli.

**Batas yang diketahui:** bukti asesmen di antrean "Belum terpetakan" Talent
Mapping (riwayat BA, PA di luar jendela rumus) dibaca dari data sinkronisasi,
bukan dari salinan — kecuali kandidat yang Behavior-nya diedit: yang tampil
hanya nilai hasil edit, tanpa riwayat asli bertanggal di sampingnya.

## Run dan keputusan

- Run, sesi, dan pilihan suksesor yang dibuat di mode demo ditandai `is_demo`
  (`scoring_runs`, `tournament_sessions`, `position_picks`). Mode demo hanya
  menampilkan dan membuka run demo; mode asli hanya run asli. Membuka run mode
  lain lewat URL berisi id-nya menghasilkan halaman tanpa run (atau 404 untuk
  unduhan).
- Run turunan ("Tambah Kandidat Pembanding") dari run demo juga run demo.
- **Run demo tidak memanggil penulis insight AHP + TOPSIS** (prompt
  `ahp_narrative_agent`, yang menulis Keunggulan Kompetitif, Kebutuhan
  Pengembangan, dan Arahan Langkah Suksesi & Penugasan). Finalis run demo tetap
  memakai narasi templat deterministik yang disimpan engine sebelum langkah
  narasi, jadi data demo tidak pernah dikirim ke model untuk ditulisi prosa;
  peringkat, skor, dan kesiapan tidak terpengaruh karena narasi memang tidak
  pernah dibaca kembali menjadi angka. `run_info.narrative` mencatat
  `llmEnabled: false` dan `disabledBy: 'demo'` (berbeda dari `'config'`, yaitu
  penulis yang dimatikan lewat `AHP_NARRATIVE_LLM=false`), dan tab Konfigurasi
  Run tidak menampilkan banner "narasi templat" untuk run demo, karena templat
  di sana adalah keluaran yang dimaksud dan mode demo tidak membawa penanda di
  halaman. Di mode asli penulis itu tetap berjalan seperti biasa.
- Aksi yang hanya menyentuh data demo (pilihan suksesor, penandaan, hapus run,
  urutan seri, scoring ulang program, unduhan trace) tidak masuk Riwayat
  Perubahan bersama.

## Yang disamarkan

Di mode demo tidak ada NPK, kode posisi, kode kompetensi, atau foto profil di
tampilan mana pun, termasuk hasil penilaian dan keluaran fitur lain:

- **Di server** (data tidak pernah keluar): profil kandidat, lookup, pejabat
  posisi, Talent Pool dan Talent Mapping, panel Konfigurasi Run, pratinjau
  kandidat di wizard (pejabat dikenali lewat id kandidat),
  detail kandidat di Pencocokan Job Profile, daftar kandidat terhapus, dan konteks
  AI Assistant.
- **Di tampilan**: kode kamus dan kode posisi di penjabaran aspek, halaman Kamus,
  daftar dan detail Job Profile (nama berkas tanpa kode dan nomor JD), Struktur
  Posisi, dan Pencocokan Job Profile. Teks "Salin data" dan "Tanya AI" ikut
  disamarkan.
- **Di engine**: run demo menulis keterangan asal acuan kompetensi tanpa NPK dan
  kode posisi. Narasi AI tidak perlu disamarkan karena run demo tidak memanggil
  penulis narasi (lihat "Run dan keputusan"); penyamar teks scoring-service yang
  dulu dipakai untuk itu (`demoTextMasker` di
  `scoring-service/src/demo-overlay.ts`) sudah dihapus.
- **Di berkas**: trace perhitungan (XLSX) dan snapshot (JSON) memakai nama samaran
  yang konsisten (`NPK-0001`, `KODE-001`), bukan satu tanda yang sama, karena
  rumus workbook membandingkan dan mencari berdasarkan nilai-nilai itu. Workbook
  demo tetap dihitung ulang menjadi **SEMUA COCOK**.
- Pencarian tidak mencocokkan NPK atau kode, dan petunjuk pencarian tidak
  menyebut NPK.

### Nama kandidat: inisial unik

Di mode demo **setiap nama kandidat tampil sebagai inisial**: kandidat ON maupun
OFF, nama dari salinan demo (`candidates_dupp`) maupun nama asli yang dibaca
langsung, di data yang tersimpan (hasil run, snapshot, laporan) maupun yang
dibaca seketika. Tombol "Data disamarkan / Data terlihat" di
halaman Kandidat, Talent Pool, dan Talent Mapping tidak mengubahnya.

Aturan inisial (`lib/demo/initials.ts`):

1. Ambil **huruf** pertama setiap kata nama. Budi Santoso → **BS**.
2. Inisial tidak boleh kembar. Kandidat berikutnya yang inisialnya persis sama
   dengan kandidat sebelumnya memakai **huruf kedua dari kata terakhir** sebagai
   huruf inisial terakhirnya. Bambang Sutrisno → **BU**.
3. Bila masih bentrok, langkah yang sama dilanjutkan ke huruf ketiga, keempat,
   dan seterusnya (Bayu Sugianto → BS dan BU terpakai → **BG**). Bila semua
   huruf kata terakhir terpakai, inisial diberi nomor (**BS2**, **BS3**). Jadi
   tidak pernah ada inisial kembar, berapa pun jumlah kandidatnya.
4. "Kandidat sebelumnya" ditentukan oleh urutan **seluruh** kandidat di semua
   business unit, termasuk yang ditombstone: `created_at`, lalu NPK, lalu id.
   Kandidat baru tidak pernah menggeser inisial kandidat lama, dan ranking lintas
   unit tidak bisa menampilkan inisial kembar.
5. Inisial dihitung dari nama yang **berlaku** di mode demo: nama salinan demo
   bila ada, selain itu nama asli. Nama asli tetap dikenali (mis. di run yang
   selesai sebelum nama itu diedit) dan diganti dengan inisial yang sama.
6. Gelar setelah koma diabaikan (Budi Santoso, S.Kom. → BS); tanda baca bukan
   huruf (M. Rizki → MR). Dua orang dengan nama sama tetap mendapat inisial
   berbeda, karena pengenalnya id kandidat.

Fungsinya diterapkan pada **data**, bukan pada tampilan: `demoScrub()`
(`lib/demo/names.ts`) dijalankan pada props halaman, nilai balik server action,
riwayat chat, dan bundel trace XLSX/snapshot, sebelum data keluar dari server.
(Route status sesi, `/api/tournament/[sessionId]/status`, tidak lagi membawa
nama: sejak AI Tournament dihapus ia hanya mengembalikan status dan kemajuan
AHP + TOPSIS, tanpa catatan tahap turnamen.) Database tidak pernah ditulisi
inisial. Cara nama dikenali (`lib/demo/name-scrub.ts`), dari yang paling pasti:

- **Lewat id.** Objek yang merupakan kandidat (`id`) atau merujuk kandidat
  (`candidateId`) diganti namanya dengan inisial kandidat itu, dan email-nya
  disamarkan (biasanya berisi nama).
- **Nama dua kata atau lebih**, di teks mana pun, tanpa memandang huruf
  besar/kecil dan tanda baca.
- **Nama satu kata** selalu diganti bila seluruh teks adalah nama itu. Di dalam
  kalimat ("X naik 2 tingkat", "X (skor 61) tidak masuk 3 besar"), nama satu
  kata hanya diganti bila data yang sama merujuk kandidat itu lewat id, atau
  kandidat itu ada di konteksnya (misalnya kandidat run untuk riwayat AI
  Assistant), dan ditulis berhuruf kapital.
- **Di baris kandidat itu sendiri** (narasi, kekuatan, catatan), setiap bagian
  nama yang berhuruf kapital ikut diganti ("Budi menunjukkan…" → "BS
  menunjukkan…"). Kata biasa berhuruf kecil ("budi pekerti") tidak disentuh,
  begitu pula isian jabatan, departemen, dan divisi.
- Nama business unit (Mulia, MSO, ERRO) tidak pernah dibaca sebagai nama orang.

Pencarian di daftar Kandidat dan di pencarian kandidat pembanding (re-run)
memakai inisial, sehingga mengetik nama asli tidak menemukan siapa pun. Trace
XLSX menamai kandidat dengan inisialnya; karena inisial unik, rumus yang
mencocokkan nama tetap menemukan tepat satu baris.

Batas: pejabat yang bukan kandidat (tidak ada di tabel `candidates`) tetap
tampil dengan namanya, dan nama depan di prosa tanpa konteks kandidat (mis.
ringkasan audit yang hanya menyebut nama depan) tidak dikenali. Nama lengkap
tetap diganti.

### Isi job profile: tiga kata pertama per poin

Di Profil Job (daftar dan detail dokumen, juga tampilan yang sama di Pencocokan
Job Profile), bagian berikut hanya menampilkan **tiga kata pertama setiap poin**,
lalu tanda `▒▒▒▒`:

| Tab | Bagian |
|---|---|
| Informasi Utama | Tujuan Jabatan (Job Purpose), Ikhtisar Bagan Organisasi, Persetujuan & Otorisasi |
| Tanggung Jawab | Tanggung Jawab Utama, Indikator Keberhasilan (KPI) |
| Spesifikasi Jabatan | Wewenang Posisi (Authorities) |
| Hubungan & Pemecahan Masalah | Hubungan Kerja Internal, Hubungan Kerja Eksternal, Pemecahan Masalah & Pengambilan Keputusan |

- Poin yang hanya terdiri dari **tiga kata atau kurang tidak pernah tampil
  utuh**: yang tampil satu kata lebih sedikit dari jumlah katanya (tiga kata →
  dua, dua → satu, satu kata → hanya tanda).
- Setiap baris dalam satu sel adalah poin tersendiri; penanda daftar di awal
  (`1.`, `-`, `a)`) dipertahankan dan tidak dihitung sebagai kata.
- Tab **Data Mentah JSON** dikosongkan dan tombol **Salin JSON** dinonaktifkan.
- Bagian lain (identitas jabatan, kualifikasi, keahlian, kompetensi) tidak
  diubah. Form posisi tetap bisa mengambil kompetensi dan kualifikasi dari job
  profile.
- Tujuan Jabatan juga disamarkan di ringkasan anggota peta Job Family,
  pratinjau Restrukturisasi, dan saran job profile di form posisi.

Penyamaran ini dilakukan di server (`lib/demo/content.ts`), jadi teks yang
disembunyikan tidak ada di halaman maupun di DevTools.

### Kamus kompetensi: 60% kalimat di tengah disembunyikan

Untuk deskripsi kompetensi dan setiap butir definisi level, yang tampil hanya
**20% kata pertama dan 20% kata terakhir**, dengan `floor(n / 5)` kata di
setiap ujung. Jadi tidak pernah lebih dari 20% yang tampil di tiap ujung, dan
yang tersembunyi selalu minimal 60%. Teks di bawah lima kata disembunyikan
seluruhnya. Contoh: deskripsi 15 kata menampilkan 3 kata pertama dan 3 kata
terakhir; butir level 9 kata menampilkan 1 kata di awal dan 1 di akhir.

## Yang ditolak dan yang tetap berlaku

Ditolak di mode demo dengan pesan "Aksi ini tidak tersedia.": tambah, hapus,
pulihkan, kosongkan, dan pulihkan-massal kandidat; tambah, ubah, dan hapus posisi
(termasuk kualifikasi dan kompetensi) serta Tambah massal; memicu sinkronisasi
(`POST /api/sync/*`); dan menyimpan pemetaan Job Family (Simpan Pemetaan,
pin/lepas pin manual).

**Tidak diisolasi**: Tata Kelola dan pengaturan (program, prompt, kesiapan,
kamus, job profile, pengaturan aplikasi). Perubahan di sana berlaku untuk kedua
mode dan tercatat di Riwayat Perubahan seperti biasa.

## Deploy

Terapkan migrasi sebelum web app dan scoring-service baru:

```bash
pnpm exec tsx scripts/apply-sql.ts drizzle/0093_demo_mode.sql
```

Skema Drizzle memilih `scoring_runs.is_demo` dan `tournament_sessions.is_demo`
pada setiap `select().from(...)`, dan scoring-service membaca
`tournament_sessions.is_demo` untuk setiap sesi.

## Verifikasi

```bash
pnpm test:demo
```

TC-DEMO menguji kata kunci mode, penyamaran, overlay salinan demo (termasuk
kesamaan overlay web dengan scoring-service), dan nama samaran berkas (setiap
kesamaan yang diuji rumus workbook harus tetap berlaku). Uji kesamaan penyamar
teks web dengan scoring-service dihapus bersama `demoTextMasker`. TC-DEMO-INI
mengunci aturan inisial unik, TC-DEMO-SCR pengenalan nama di dalam data
(termasuk nama salinan demo dan nama asli), dan TC-DEMO-TXT penyamaran isi job
profile dan kamus.

Catatan verifikasi manual: periksa di build produksi (`pnpm build` lalu
`pnpm start`), bukan `pnpm dev`. Di mode dev, React mengirim nilai query yang
di-`await` sebagai debug info untuk DevTools, sehingga nama asli tetap terlihat
di payload walaupun data yang dirender sudah berupa inisial.
