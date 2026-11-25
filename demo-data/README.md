# Data demo: unggahan Excel dan PDF

Folder ini berisi berkas **fiktif** untuk memperagakan semua jalur *unggah → ekstrak → muat* di
**Pengaturan → Sinkronisasi**: sepuluh sumber Excel yang biasanya ditarik dari MSSQL/API HR, unggahan
HAV dan MCU, Kamus Kompetensi (PDF), dan Job Profile (PDF).

Isinya satu unit bisnis rekaan: **46 karyawan** (NPK `99001`–`99046`), **40 posisi** (kode `DM…`),
5 divisi, 8 departemen, lengkap dengan riwayat jabatan, PA lima tahun, assessment perilaku, catatan
disiplin, pendidikan, MCU, dan HAV. Siapa saja orangnya dan apa yang ingin diperlihatkan dari
masing-masing ada di [`ringkasan-data-demo.md`](ringkasan-data-demo.md).

**Set ini lengkap dan saling merujuk — tidak ada sel yang perlu diisi.** Semua kunci asing terisi dan
menunjuk ke berkas lain di set ini: COMPANY_ID = **`DEMO`** di kesepuluh berkas ber-company, NPK di
berkas penempatan/kompetensi/PA/perilaku/disiplin/pendidikan/MCU/HAV ada di Data Karyawan, POSITION_ID
dan atasan di hierarki ada di Master Jabatan, GRADE_ID ada di Level & Grade, TECHNICAL_ID (`TC 901`–`TC 914`)
didefinisikan oleh PDF kamus demo, dan nama berkas Job Profile diawali kode posisi dari Master Jabatan.
Semua NPK sudah dalam bentuk baku (5 digit, `LPAD`), jadi cocok di tabel yang menyimpan NPK berpadding
maupun yang tidak. Kesesuaian itu dicek otomatis — lihat [Bagaimana berkas ini diuji](#bagaimana-berkas-ini-diuji).
Yang perlu Anda lakukan hanya satu: **memetakan Company ID `DEMO` ke sebuah Company** (langkah 3 di bawah).

## Isi folder

| Berkas | Kartu di Tambah Data | Masuk ke tabel | Baris | Merujuk ke |
|---|---|---|---|---|
| `excel/01-data-karyawan.xlsx` | Data Karyawan | `sync_employees` | 46 | Company ID `DEMO`, grade (02), jabatan (03) |
| `excel/02-level-grade.xlsx` | Level & Grade | `sync_grade_levels` | 12 | `DEMO` |
| `excel/03-master-jabatan.xlsx` | Master Jabatan | `sync_positions` | 40 | `DEMO`, grade (02) |
| `excel/04-hierarki-jabatan.xlsx` | Hierarki Jabatan | `sync_position_hierarchy` | 40 | `DEMO`, posisi + atasan (03) |
| `excel/05-penempatan-karyawan.xlsx` | Penempatan Karyawan | `sync_employee_positions` | 66 | `DEMO`, NPK (01), posisi (03) |
| `excel/06-kompetensi-teknis.xlsx` | Kompetensi Teknis | `sync_technical_competencies` | 110 | `DEMO`, NPK (01), posisi (03), grade (02), kode kamus (13) |
| `excel/07-penilaian-kinerja.xlsx` | Penilaian Kinerja | `sync_performance_appraisals` | 218 | `DEMO`, NPK (01) |
| `excel/08-kompetensi-perilaku.xlsx` | Kompetensi Perilaku | `sync_behavior_competencies` | 45 → 43 karyawan | `DEMO`, NPK (01) |
| `excel/09-catatan-disiplin.xlsx` | Catatan Disiplin | `sync_disciplinary` | 6 | `DEMO`, NPK (01) |
| `excel/10-riwayat-pendidikan.xlsx` | Riwayat Pendidikan | `sync_education` | 51 | `DEMO`, NPK (01) |
| `excel/11-status-mcu.xlsx` | Status MCU | `sync_mcu` | 44 | NPK (01) |
| `excel/12-hav-quadrant.xlsx` | HAV Quadrant | `sync_hav` → `candidates` | 13 | NPK (01) |
| `pdf/kamus-kompetensi/13-kamus-kompetensi-demo.pdf` | Kamus Kompetensi | `sync_kamus_kompetensi` | 14 kompetensi | — |
| `pdf/job-profile/*.pdf` (6 berkas) | Job Profile | `sync_job_profiles` | 6 dokumen | — |
| `sql/cek-sebelum-unggah.sql` | — | hanya membaca | | |
| `sql/hapus-data-demo.sql` | — | menghapus data demo | | |
| `ringkasan-data-demo.md` | — | daftar orang, posisi, dan hasil yang diharapkan | | |
| `generate.py`, `generator/` | — | pembuat semua berkas di atas | | |

Setiap workbook punya sheet **Petunjuk Demo** (selalu di belakang sheet data, karena MCU membaca sheet
pertama dan HAV hanya membaca sheet `ALL`). Nama sheet data dan header kolom sama persis dengan template
yang bisa diunduh dari kartunya, jadi berkas ini bisa dipakai bergantian dengan template.

## Company ID `DEMO` dan Company tujuan

`DEMO` hanya kode; Company Pulse tempat datanya tampil ditentukan oleh pemetaan di **Tambah Data →
Pemetaan Company ID → Company**. Tujuannya boleh Company bawaan (Mulia/MSO/ERRO) **atau Company yang
Anda tambahkan sendiri** lewat tanda **+** di dropdown Company — perilakunya sama. Disarankan Company
tersendiri (mis. "Demo") supaya data demo terpisah dan mudah dihapus.

Pencocokan Company ID tidak peka huruf besar/kecil dan spasi: unggahan menyimpannya dalam huruf besar
(`demo ` menjadi `DEMO`), sama seperti pemetaan. NPK juga dibakukan saat unggah — tabel yang menyimpan
NPK berpadding 5 digit (penempatan, kompetensi, PA, perilaku) dan yang mengikuti ejaan Data Karyawan
(karyawan, disiplin, pendidikan) masing-masing ditulis dalam bentuknya, sehingga `370`, `0370`, dan
`00370` tetap satu orang.

Bila sesuatu belum terhubung, unggahan tetap menyimpan barisnya tetapi menampilkan **peringatan**
(toast kuning): Company ID belum dipetakan, NPK tidak ada di Data Karyawan, kode posisi tidak ada di
Master Jabatan, atau TECHNICAL_ID tidak ada di Kamus Kompetensi. Berkas dengan header yang tidak sesuai
template **ditolak** dan tidak menulis apa pun.

## Varian dengan sel kuning (untuk database asli)

Untuk memakai kode company asli atau kamus asli Anda, buat varian dengan generator:
`--company KODE` (mis. `MPM9`) atau `--blank` (COMPANY_ID dan TECHNICAL_ID dikosongkan dan diwarnai
kuning, untuk diisi dari database Anda). Penjelasan sel kuning di bawah berlaku untuk varian `--blank`.


**Kuning = wajib diisi dengan nilai dari database Anda.** **Jingga = opsional.** Sel lain sudah terisi.

### COMPANY_ID (kuning, di sepuluh berkas Excel pertama — varian `--blank`)

Nilainya harus Company ID yang **aktif** di **Sinkronisasi → Pemetaan Company ID → Company**
(`sync_company_tenant_map`), karena dari situlah sistem tahu data masuk ke Company Pulse yang mana.
Pakai **satu nilai yang sama di kesepuluh berkas**.

Disarankan membuat pemetaan khusus demo, misalnya Company ID **`DEMO`** → Company tujuan (Mulia/MSO/ERRO),
supaya data demo terpisah dari company asli dan mudah dihapus. Maksimal 10 karakter.

Cara cepat: blok semua sel kuning di kolom COMPANY_ID, ketik kodenya, tekan **Ctrl+Enter**.

Kesepuluh berkas menolak baris tanpa COMPANY_ID ("… baris dilewati karena kolom wajib kosong (baris 2:
COMPANY_ID kosong; …)"), termasuk Data Karyawan — dulu kolom itu tidak wajib di sana, sehingga karyawan
tanpa company diam-diam tidak pernah menjadi kandidat.

### TECHNICAL_ID (kuning, di `06-kompetensi-teknis.xlsx` — varian `--blank`)

Kode kompetensi di Kamus Kompetensi database Anda (`sync_kamus_kompetensi.code`, mis. `TC 012`). Baris
tanpa kode **dilewati**. Sheet **Kode Kompetensi** di berkas itu mendaftar 14 nama kompetensi yang dipakai
beserta jumlah barisnya. Dua pilihan:

1. **Kamus asli Anda** — isi kolom `KODE_DI_KAMUS_ANDA` di sheet Kode Kompetensi dengan kode yang paling
   sesuai (`SELECT code, name FROM sync_kamus_kompetensi ORDER BY code;`), lalu di sel `H2` sheet data ketik
   `=VLOOKUP(I2,'Kode Kompetensi'!A:C,3,FALSE)`, isi ke bawah, lalu **Salin → Tempel Spesial → Nilai**.
   Pilihan ini yang cocok untuk memperagakan scoring, karena kode asli sudah punya embedding.
2. **Kamus demo** — pakai kolom `KODE_DI_KAMUS_DEMO` (`TC 901`–`TC 914`) dengan rumus yang sama tetapi
   `…A:B,2,FALSE)`, dan unggah juga `13-kamus-kompetensi-demo.pdf`.

### PARENT_POSITION_ID (jingga, di `04-hierarki-jabatan.xlsx`)

Lima division head adalah puncak pohon demo, sehingga atasannya kosong. Biarkan kosong (lima pohon
terpisah di Struktur Posisi), atau isi dengan POSITION_ID atasan asli di database Anda bila struktur demo
ingin digantung di bawah posisi nyata.

HAV, MCU, dan kedua jenis PDF tidak punya kolom yang merujuk ke database.

## Sebelum mulai

1. **Pilih databasenya.** Unggahan bersifat *memperbarui, tidak pernah menghapus*: data demo tetap ada
   setelah demo sampai dihapus dengan `sql/hapus-data-demo.sql`. Sepuluh berkas Excel, HAV, dan MCU aman di
   database berisi data asli selama identitasnya tidak bentrok (langkah 2). **Kamus dan Job Profile demo
   sebaiknya hanya di database demo/staging**: keduanya ikut masuk korpus yang dipakai peta Job Family,
   kalibrasi skor karier/teknis, dan pencocokan job profile untuk semua karyawan.
2. **Cek bentrok** (hanya membaca):

   ```bash
   psql "$DATABASE_URL" -f demo-data/sql/cek-sebelum-unggah.sql
   ```

   Bagian 2 dan 3 harus kosong. Bila NPK `99001`–`99046` sudah dipakai, buat set berkas dengan rentang
   lain (lihat [Membuat ulang berkas](#membuat-ulang-berkas)).
3. **Buat pemetaan Company ID `DEMO`** → Company tujuan di Tambah Data → *Pemetaan Company ID → Company*
   (Company bawaan atau yang Anda tambahkan lewat **+** di dropdown Company).
4. Pilih Company tujuan itu di dropdown Company supaya hasilnya langsung terlihat.

## Urutan unggah dan hasil yang diharapkan

Semua di **Tambah Data**. Unggahan diproses langsung lalu berkasnya dihapus dari server, dan **perubahannya
langsung diteruskan ke Company**: setiap unggahan menjalankan sendiri sinkronisasi posisi, kandidat, dan
kompetensi teknis kandidat yang bergantung padanya — tidak perlu menekan tombol Kandidat atau menunggu
sinkronisasi Senin. Pesan di bawah adalah hasil uji pada database tanpa data demo (unggahan pertama).

| # | Langkah | Pesan yang muncul |
|---|---|---|
| 1 | Kartu **Data Karyawan** ← `01-data-karyawan.xlsx` | 46 baris Data Karyawan diproses (46 baru, 0 diperbarui) |
| 2 | *(opsional)* Tombol sinkron **Struktur Org** (kelompok Database) | Menarik divisi/departemen dari MSSQL; tidak diperlukan — kandidat membaca divisi dan departemen dari Data Karyawan |
| 3 | Kartu **Level & Grade** ← `02-level-grade.xlsx` | 12 baris Level & Grade diproses (12 baru, 0 diperbarui) |
| 4 | Kartu **Master Jabatan** ← `03-master-jabatan.xlsx` | 40 baris Master Jabatan diproses (40 baru, 0 diperbarui) |
| 5 | Kartu **Hierarki Jabatan** ← `04-hierarki-jabatan.xlsx` | 40 baris Hierarki Jabatan diproses (40 baru, 0 diperbarui) |
| 6 | Kartu **Penempatan Karyawan** ← `05-penempatan-karyawan.xlsx` | 66 baris Penempatan Karyawan diproses (66 baru, 0 diperbarui) |
| 7 | Kartu **Kompetensi Teknis** ← `06-kompetensi-teknis.xlsx` | 110 baris Kompetensi Teknis diproses (110 baru, 0 diperbarui) |
| 8 | Kartu **Penilaian Kinerja** ← `07-penilaian-kinerja.xlsx` | 218 baris Penilaian Kinerja diproses (218 baru, 0 diperbarui) |
| 9 | Kartu **Kompetensi Perilaku** ← `08-kompetensi-perilaku.xlsx` | 43 baris … diproses (43 baru, 0 diperbarui, **2 baris duplikat digabung**) |
| 10 | Kartu **Catatan Disiplin** ← `09-catatan-disiplin.xlsx` | 6 baris Catatan Disiplin diproses (6 baru, 0 diperbarui) |
| 11 | Kartu **Riwayat Pendidikan** ← `10-riwayat-pendidikan.xlsx` | 51 baris Riwayat Pendidikan diproses (51 baru, 0 diperbarui) |
| 12 | Kartu **Status MCU** ← `11-status-mcu.xlsx` | 44 record MCU diproses (44 baru, 0 diperbarui) |
| 13 | *(tidak perlu lagi)* Tombol sinkron **Kandidat** | Kandidat sudah terbentuk sejak langkah 1 dan diperbarui di setiap unggahan; pesan tiap unggahan menyertakan "Populated … candidates" |
| 14 | Kartu **HAV Quadrant** ← `12-hav-quadrant.xlsx` | 13 record HAV diproses (13 baru, 0 diperbarui). 13 kuadran berubah: 13 kandidat langsung diperbarui … |
| 15 | *(opsional)* Kartu **Kamus Kompetensi** ← `13-kamus-kompetensi-demo.pdf` | Kamus kompetensi synced dari 1 file PDF (toast: 14 dari 14 record) |
| 16 | *(opsional)* Kartu **Job Profile** ← 6 PDF di `pdf/job-profile/`, centang Company tujuan | Diproses di latar belakang oleh model visi (`LLM_BASE_URL`); pantau di Dokumen → Dokumen Job Profile |

Catatan urutan:

- **Urutan tidak lagi menentukan hasil akhir**: setiap unggahan langsung meneruskan perubahannya ke kandidat
  dan posisi Company. Urutan di tabel tetap yang paling sedikit memunculkan peringatan sementara — misalnya
  Kompetensi Teknis sebelum Kamus memperingatkan bahwa kode TC 9xx belum dikenal, sampai kamusnya diunggah.
- **HAV sesudah Data Karyawan** supaya pesan "N kandidat langsung diperbarui" terlihat.
- Tombol **Struktur Org** dan **Kandidat** memproses semua pemetaan company di filter Company yang dipilih
  (bawaan: semua) — sama dengan sinkronisasi mingguan, jadi aman.
- Jangan menekan tombol sinkron kelompok Database lain (Karyawan, Position Mapping, …) untuk demo ini:
  tombol itu menarik dari MSSQL, bukan dari berkas.
- Kamus demo (langkah 15) boleh diunggah kapan saja; sebelum ada, unggahan Kompetensi Teknis menyimpan
  barisnya dengan peringatan, dan kodenya baru bermakna (nama, level, embedding) setelah kamusnya ada.
- Mengunggah ulang berkas yang sama menghasilkan "0 baru, N diperbarui"; HAV yang sama: "0 kuadran berubah".

## Yang bisa diperagakan sesudahnya

Dengan aturan bawaan program (bila aturan di Tata Kelola sudah diubah, angkanya ikut berubah):

- **Kandidat** — 46 kandidat baru dengan riwayat posisi; Data Pribadi (tanggal lahir) memang tidak bisa
  diunggah, jadi usia kosong.
- **Talent Pool** — **25** lolos. Yang gugur punya alasan berbeda: HAV di luar 1/2/3/4/7, PA tanpa A/B,
  kategori perilaku terbawah (NOT READY / VERY LOW / BELUM ADA POTENSI), disiplin (SP aktif, SP < 2 tahun,
  SP3), atau HAV belum ada. Eko Purnomo (99016) lolos walau MCU **Unfit** — aturan MCU hanya menandai.
- **Talent Mapping** — **43** orang di peta (yang lolos aturan disiplin), 4 di antrean *Belum terpetakan*
  (tanpa PA, tanpa assessment, atau PA hanya di luar jendela 3 tahun). HAV bersumber dari unggahan (13 orang,
  termasuk 4 yang dikalibrasi berbeda dari rumus) dan dari rumus PA × perilaku (sisanya).
- **Posisi → Struktur Posisi** — lima pohon `DM…`, termasuk jabatan lama *Programmer* (berlaku s.d. 2021).
- **Manajemen Posisi + scoring** — misalnya tambahkan *IT Application Development Department Head*
  (`DM04060001`, grade 8) atau kursi kosong *Treasury & Tax Department Head* (`DM02040001`, Plt. Ratna Sari
  Dewi) ke program Critical Position: kandidat suksesornya level SUPERVISOR (grade 5–6) — 11 supervisor demo,
  10 di antaranya lolos aturan Critical Position. Aspek teknis butuh embedding kamus untuk kode yang dipakai.
- **Dokumen → Job Profile Match** — setelah Job Profile demo diekstrak, kandidat demo cocok dengan
  dokumennya lewat kode posisi di nama berkas (`DM04060001 JD-DMO-001 …`).

## Keterbatasan yang perlu diketahui

- **Tanggal lahir** tidak termasuk sumber yang bisa diunggah, sehingga usia dan penanda pensiun tidak muncul
  untuk karyawan demo.
- **Foto** kandidat menunjuk ke server HR (`…/EmployeePersonalInfo/99001.jpg`) yang tidak punya foto mereka;
  aplikasi menampilkan avatar pengganti.
- **Job Profile** butuh model visi yang aktif; tanpa itu dokumen berstatus gagal ("Connection error").

## Membersihkan data demo

```bash
# uji coba: menampilkan apa yang akan dihapus, lalu ROLLBACK
psql "$DATABASE_URL" -v company=DEMO -f demo-data/sql/hapus-data-demo.sql
# benar-benar menghapus
psql "$DATABASE_URL" -v company=DEMO -v commit=1 -f demo-data/sql/hapus-data-demo.sql
```

Skrip hanya menyentuh baris berkunci identitas demo (daftar NPK, kode posisi, kode kamus, dan nama berkas
yang tertulis eksplisit di skrip). Kandidat demo **di-tombstone**, bukan dihapus, sesuai aturan aplikasi —
hasil scoring dan pilihan suksesor yang sempat dibuat saat demo tetap utuh. Setelahnya nonaktifkan pemetaan
Company ID demo di Sinkronisasi. Vektor job profile di database vektor dibangun ulang dari halaman Job Family.

## Membuat ulang berkas

Semua berkas dibuat oleh `generate.py` dari `generator/dataset.py` (orang, posisi, PA, dst.) dan
`generator/content.py` (teks kamus dan job profile). Hasilnya deterministik: tanggal acuan yang sama
menghasilkan byte yang sama.

```bash
pip install openpyxl reportlab
python3 demo-data/generate.py --as-of 2026-11-18   # set ini (COMPANY_ID=DEMO, kode kamus TC 9xx)
python3 demo-data/generate.py --skip-pdf           # Excel saja (tanpa reportlab)
```

Tanggal yang menentukan kategori — tiga tahun PA yang dibaca sinkronisasi Kandidat dan tanggal surat
disiplin (SP aktif / < 2 tahun / > 2 tahun) — dihitung dari tanggal acuan. Set di folder ini dibuat dengan
acuan **2026-11-18**; untuk demo di tahun berikutnya, buat ulang supaya PA tahun terakhir ikut terbaca.

Varian ditulis ke folder lain (perintah menolak menimpa set ini):

```bash
# rentang NPK lain bila 99001-99046 sudah dipakai
python3 demo-data/generate.py --npk-prefix 98 --out /tmp/demo-npk98
# Company ID lain
python3 demo-data/generate.py --company MPM9 --out /tmp/demo-mpm9
# COMPANY_ID dan TECHNICAL_ID dikosongkan (kuning), untuk diisi dari database asli
python3 demo-data/generate.py --blank --out /tmp/demo-kosong
```

`sql/` dan `ringkasan-data-demo.md` ikut dibuat ulang dengan identitas varian tersebut.

## Bagaimana berkas ini diuji

Dua skrip di `sync-service/scripts/`, jalankan ulang setiap kali set dibuat ulang:

```bash
cd sync-service
# 1. statis (tanpa database): kontrak template + SEMUA kunci asing antar-berkas
npx tsx scripts/verify-demo-data.ts ../demo-data
# 2. ujung ke ujung, ke sync-service yang berjalan (butuh SYNC_SYSTEM_USER_ID di service itu)
DATABASE_URL=… npx tsx scripts/verify-demo-upload.ts --sync http://localhost:8000 --web http://localhost:3000
```

`verify-demo-data.ts` membaca berkas seperti pengunggah membacanya (header dan nama sheet terhadap
`excel-sources.ts`, NPK lewat `npkKey`, kamus lewat `parseKamusPdf`) dan memeriksa setiap rujukan: satu
COMPANY_ID huruf besar, NPK unik dan sudah baku, setiap NPK/POSITION_ID/GRADE_ID/TECHNICAL_ID ada di
berkas sumbernya, penempatan primer terbuka tiap karyawan sesuai jabatannya, dan setiap PDF Job Profile
diawali kode posisi yang ada serta memuat kompetensi yang dituntut untuk kursinya.

`verify-demo-upload.ts` membuat Company **bukan bawaan** khusus untuk uji, mengunggah semua berkas
dengan dua permintaan yang sama seperti kartu Tambah Data, lalu memastikan: berkas ber-header salah
ditolak tanpa menulis apa pun; peringatan muncul untuk Company ID belum dipetakan, NPK di luar Data
Karyawan, posisi di luar Master Jabatan, dan kode di luar kamus; `demo ` tersimpan sebagai `DEMO`; NPK
`8999` tersimpan `08999` di tabel berpadding dan `8999` di tabel berejaan karyawan, dan keduanya terhubung
ke kandidat yang sama; kandidat, posisi, riwayat jabatan, kompetensi teknis, HAV, MCU, kamus, dan Job
Profile masuk ke Company itu; **46/46 kandidat sesuai hasil yang dirancang** di `ringkasan-data-demo.md`;
halaman Kandidat, detail kandidat, dan Dokumen menampilkannya di Company tersebut dan tidak di Mulia;
kandidat Company bawaan tidak berubah. Tanpa `--keep` semuanya dibersihkan lagi.

Uji yang lebih awal (sebelum set terisi) dijalankan melalui **sync-service asli** pada PostgreSQL yang
dibangun dari semua migrasi `drizzle/`:

- Header dan nama sheet tiap workbook dibandingkan dengan spesifikasi `excel-sources.ts` — semua sama persis.
- Berkas dengan sel kuning kosong ditolak dengan pesan yang jelas dan tidak menulis apa pun (kecuali Data
  Karyawan, lihat peringatan di atas).
- Setelah sel kuning diisi, langkah 1–14 menghasilkan pesan di tabel di atas; 46 kandidat yang terbentuk
  dicocokkan dengan hasil yang dirancang di `ringkasan-data-demo.md` (status disiplin, `performance_grade`,
  HAV rumus lewat `lib/hav-effective.ts`, HAV berlaku, lolos/tidaknya Talent Pool): 46/46 sesuai.
- PDF kamus diurai oleh `parseKamusPdf` asli: 14 kompetensi dengan deskripsi dan empat level utuh.
- PDF Job Profile diterima endpoint unggah, masuk antrean, dan dikonversi ke gambar; ekstraksi model visi
  tidak bisa diuji di lingkungan uji karena tidak ada endpoint model.
