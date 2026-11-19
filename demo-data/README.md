# Data demo: unggahan Excel dan PDF

Folder ini berisi berkas **fiktif** untuk memperagakan semua jalur *unggah → ekstrak → muat* di
**Pengaturan → Sinkronisasi**: sepuluh sumber Excel yang biasanya ditarik dari MSSQL/API HR, unggahan
HAV dan MCU, Kamus Kompetensi (PDF), dan Job Profile (PDF).

Isinya satu unit bisnis rekaan: **46 karyawan** (NPK `99001`–`99046`), **40 posisi** (kode `DM…`),
5 divisi, 8 departemen, lengkap dengan riwayat jabatan, PA lima tahun, assessment perilaku, catatan
disiplin, pendidikan, MCU, dan HAV. Semua berkas saling cocok: NPK di berkas HAV ada di berkas karyawan,
POSITION_ID di berkas penempatan ada di master jabatan, dan seterusnya. Siapa saja orangnya dan apa
yang ingin diperlihatkan dari masing-masing ada di [`ringkasan-data-demo.md`](ringkasan-data-demo.md).

> **Sel yang merujuk ke data di database Anda sengaja DIKOSONGKAN** (sel kuning). Isi dulu sebelum
> mengunggah — lihat bagian [Sel kuning dan jingga](#sel-kuning-dan-jingga).

## Isi folder

| Berkas | Kartu di Sinkronisasi | Masuk ke tabel | Baris | Sel kuning (wajib diisi) |
|---|---|---|---|---|
| `excel/01-data-karyawan.xlsx` | Data Karyawan | `sync_employees` | 46 | COMPANY_ID |
| `excel/02-level-grade.xlsx` | Level & Grade | `sync_grade_levels` | 12 | COMPANY_ID |
| `excel/03-master-jabatan.xlsx` | Master Jabatan | `sync_positions` | 40 | COMPANY_ID |
| `excel/04-hierarki-jabatan.xlsx` | Hierarki Jabatan | `sync_position_hierarchy` | 40 | COMPANY_ID (+ jingga: PARENT_POSITION_ID baris puncak) |
| `excel/05-penempatan-karyawan.xlsx` | Penempatan Karyawan | `sync_employee_positions` | 66 | COMPANY_ID |
| `excel/06-kompetensi-teknis.xlsx` | Kompetensi Teknis | `sync_technical_competencies` | 110 | COMPANY_ID, TECHNICAL_ID |
| `excel/07-penilaian-kinerja.xlsx` | Penilaian Kinerja | `sync_performance_appraisals` | 218 | COMPANY_ID |
| `excel/08-kompetensi-perilaku.xlsx` | Kompetensi Perilaku | `sync_behavior_competencies` | 45 → 43 karyawan | COMPANY_ID |
| `excel/09-catatan-disiplin.xlsx` | Catatan Disiplin | `sync_disciplinary` | 6 | COMPANY_ID |
| `excel/10-riwayat-pendidikan.xlsx` | Riwayat Pendidikan | `sync_education` | 51 | COMPANY_ID |
| `excel/11-status-mcu.xlsx` | Status MCU | `sync_mcu` | 44 | — |
| `excel/12-hav-quadrant.xlsx` | HAV Quadrant | `sync_hav` → `candidates` | 13 | — |
| `pdf/kamus-kompetensi/13-kamus-kompetensi-demo.pdf` | Kamus Kompetensi | `sync_kamus_kompetensi` | 14 kompetensi | — |
| `pdf/job-profile/*.pdf` (6 berkas) | Job Profile | `sync_job_profiles` | 6 dokumen | — |
| `sql/cek-sebelum-unggah.sql` | — | hanya membaca | | |
| `sql/hapus-data-demo.sql` | — | menghapus data demo | | |
| `ringkasan-data-demo.md` | — | daftar orang, posisi, dan hasil yang diharapkan | | |
| `generate.py`, `generator/` | — | pembuat semua berkas di atas | | |

Setiap workbook punya sheet **Petunjuk Demo** (selalu di belakang sheet data, karena MCU membaca sheet
pertama dan HAV hanya membaca sheet `ALL`). Nama sheet data dan header kolom sama persis dengan template
yang bisa diunduh dari kartunya, jadi berkas ini bisa dipakai bergantian dengan template.

## Sel kuning dan jingga

**Kuning = wajib diisi dengan nilai dari database Anda.** **Jingga = opsional.** Sel lain sudah terisi.

### COMPANY_ID (kuning, di sepuluh berkas Excel pertama)

Nilainya harus Company ID yang **aktif** di **Sinkronisasi → Pemetaan Company ID → Company**
(`sync_company_tenant_map`), karena dari situlah sistem tahu data masuk ke Company Pulse yang mana.
Pakai **satu nilai yang sama di kesepuluh berkas**.

Disarankan membuat pemetaan khusus demo, misalnya Company ID **`DEMO`** → Company tujuan (Mulia/MSO/ERRO),
supaya data demo terpisah dari company asli dan mudah dihapus. Maksimal 10 karakter.

Cara cepat: blok semua sel kuning di kolom COMPANY_ID, ketik kodenya, tekan **Ctrl+Enter**.

> **Awas di `01-data-karyawan.xlsx`.** Di sumber Data Karyawan, COMPANY_ID **bukan** kolom wajib: berkas
> dengan COMPANY_ID kosong tetap diterima ("46 baris … diproses") tetapi karyawannya masuk **tanpa company**
> sehingga tidak pernah menjadi kandidat — dan bila diunggah setelah versi yang benar, company mereka
> ikut terhapus. Sembilan berkas lainnya justru menolak baris tanpa COMPANY_ID ("… baris dilewati karena
> kolom wajib kosong (baris 2: COMPANY_ID kosong; …)"), jadi kelupaan di sana langsung terlihat.

### TECHNICAL_ID (kuning, di `06-kompetensi-teknis.xlsx`)

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
3. **Buat pemetaan Company ID** (mis. `DEMO` → Mulia) di Sinkronisasi → *Pemetaan Company ID → Company*.
4. **Isi sel kuning** di sepuluh berkas Excel pertama.

## Urutan unggah dan hasil yang diharapkan

Semua di **Pengaturan → Sinkronisasi**. Unggahan Excel diproses langsung lalu berkasnya dihapus dari server.
Pesan di bawah adalah hasil uji pada database kosong (unggahan pertama).

| # | Langkah | Pesan yang muncul |
|---|---|---|
| 1 | Kartu **Data Karyawan** ← `01-data-karyawan.xlsx` | 46 baris Data Karyawan diproses (46 baru, 0 diperbarui) |
| 2 | Tombol sinkron **Struktur Org** (kelompok Database) | divisions 5 · departments 8 (ditambah divisi/departemen company lain) |
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
| 13 | Tombol sinkron **Kandidat** (kelompok Turunan) | Populated 46 candidates and 66 position-history rows … (angka lebih besar bila company asli ikut diproses) |
| 14 | Kartu **HAV Quadrant** ← `12-hav-quadrant.xlsx` | 13 record HAV diproses (13 baru, 0 diperbarui). 13 kuadran berubah: 13 kandidat langsung diperbarui … |
| 15 | *(opsional)* Kartu **Kamus Kompetensi** ← `13-kamus-kompetensi-demo.pdf` | Kamus kompetensi synced dari 1 file PDF (toast: 14 dari 14 record) |
| 16 | *(opsional)* Kartu **Job Profile** ← 6 PDF di `pdf/job-profile/`, centang Company tujuan | Diproses di latar belakang oleh model visi (`LLM_BASE_URL`); pantau di Dokumen → Dokumen Job Profile |

Catatan urutan:

- **Status MCU sebelum Kandidat.** Status MCU baru masuk ke kandidat saat sinkronisasi Kandidat berjalan.
  Bila MCU diunggah sesudahnya, jalankan Kandidat sekali lagi.
- **HAV sesudah Kandidat** supaya pesan "N kandidat langsung diperbarui" terlihat. Diunggah sebelumnya
  juga benar: nilainya disalin saat sinkronisasi Kandidat.
- Tombol **Struktur Org** dan **Kandidat** memproses semua pemetaan company di filter Company yang dipilih
  (bawaan: semua) — sama dengan sinkronisasi mingguan, jadi aman.
- Jangan menekan tombol sinkron kelompok Database lain (Karyawan, Position Mapping, …) untuk demo ini:
  tombol itu menarik dari MSSQL, bukan dari berkas.
- Bila TECHNICAL_ID memakai kode TC 9xx, kamus demo (langkah 15) boleh diunggah kapan saja — kode tidak
  divalidasi saat unggah — tetapi kodenya baru bermakna (nama, level, embedding) setelah kamusnya ada.
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
- **Keterangan MCU tidak sampai ke kandidat.** Kolom `Keterangan`/`Kesimpulan` tersimpan di `sync_mcu`, tetapi
  sinkronisasi Kandidat saat ini tidak menyalinnya ke `candidates.mcu_note` (lihat catatan temuan di bawah).
  Status MCU-nya (fit / fit_with_note / unfit) tetap masuk.
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
python3 demo-data/generate.py                    # set ini (sel kuning kosong), tanggal acuan = hari ini
```

Tanggal yang menentukan kategori — tiga tahun PA yang dibaca sinkronisasi Kandidat dan tanggal surat
disiplin (SP aktif / < 2 tahun / > 2 tahun) — dihitung dari tanggal acuan. Set di folder ini dibuat dengan
acuan **2026-11-18**; untuk demo di tahun berikutnya, buat ulang supaya PA tahun terakhir ikut terbaca.

Varian ditulis ke folder lain (perintah menolak menimpa set ini):

```bash
# rentang NPK lain bila 99001-99046 sudah dipakai
python3 demo-data/generate.py --npk-prefix 98 --out /tmp/demo-npk98
# database demo mandiri: COMPANY_ID dan TECHNICAL_ID (kode kamus demo) langsung terisi
python3 demo-data/generate.py --company DEMO --kamus-demo-codes --out /tmp/demo-terisi
```

`sql/` dan `ringkasan-data-demo.md` ikut dibuat ulang dengan identitas varian tersebut.

## Bagaimana berkas ini diuji

Set ini dijalankan melalui **sync-service asli** (server HTTP-nya, endpoint unggah yang sama dengan halaman
Sinkronisasi) pada PostgreSQL yang dibangun dari semua migrasi `drizzle/`:

- Header dan nama sheet tiap workbook dibandingkan dengan spesifikasi `excel-sources.ts` — semua sama persis.
- Berkas dengan sel kuning kosong ditolak dengan pesan yang jelas dan tidak menulis apa pun (kecuali Data
  Karyawan, lihat peringatan di atas).
- Setelah sel kuning diisi, langkah 1–14 menghasilkan pesan di tabel di atas; 46 kandidat yang terbentuk
  dicocokkan dengan hasil yang dirancang di `ringkasan-data-demo.md` (status disiplin, `performance_grade`,
  HAV rumus lewat `lib/hav-effective.ts`, HAV berlaku, lolos/tidaknya Talent Pool): 46/46 sesuai.
- PDF kamus diurai oleh `parseKamusPdf` asli: 14 kompetensi dengan deskripsi dan empat level utuh.
- PDF Job Profile diterima endpoint unggah, masuk antrean, dan dikonversi ke gambar; ekstraksi model visi
  tidak bisa diuji di lingkungan uji karena tidak ada endpoint model.
