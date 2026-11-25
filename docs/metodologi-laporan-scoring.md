# Metodologi Laporan Hasil Scoring — Halaman Detail Posisi (`/positions/[id]`)

Dokumen ini menjelaskan **setiap angka, badge, dan grafik** yang muncul pada halaman detail posisi: apa artinya, rumus persisnya, parameter yang memengaruhinya, kondisi/fallback saat data tidak lengkap, dan di mana angka itu tampil. Ditulis untuk menjawab pertanyaan seperti *"kenapa skor saya segini?"*, *"rumusnya apa?"*, *"parameter apa yang dipakai?"*.

---

## 0. Cara membaca dokumen ini

Tiga prinsip yang berlaku di seluruh halaman:

1. **Hanya ada satu metode penilaian: AHP + TOPSIS** (deterministik). Metode AI Tournament (LLM) dihapus pada November 2026, dan run-nya dihapus dari basis data oleh `drizzle/0097_remove_llm_tournament.sql` — tidak ada lagi run LLM yang bisa dibuka. Lihat Bab 1.
2. **Skor aspek yang tampil adalah skor yang disimpan run** — chip, Dossier, Komparasi, ekspor Excel, dan cetakan memakai angka yang sama dengan yang membentuk peringkat. Kuadran HAV yang tampil juga **kuadran yang dinilai run**, bukan HAV kandidat hari ini. Yang masih dibaca dari data kandidat **saat ini** hanyalah beberapa label dan riwayat (badge readiness, disiplin/MCU, rekomendasi behavior, grafik/tabel riwayat PA); ini dijelaskan di setiap bagian dan diringkas di Bab 30.
3. **Beberapa angka relatif terhadap peserta run.** Skor akhir (TOPSIS) dan sebagian tolok ukur Career bersifat *set-relative*: menambah/mengeluarkan satu kandidat mengubah skor semua orang.

---

## 1. Metode penilaian: AHP + TOPSIS

### Apa artinya
Label metode ada di sub-teks tiap baris run pada kartu **Riwayat Scoring**.

| Kode metode | Label yang tampil | Sifat |
|---|---|---|
| `AHP_TOPSIS` | **AHP + TOPSIS** | Deterministik, dapat direproduksi, seluruh rumus terbuka |

Kode metode lain ditampilkan apa adanya (kode mentahnya).

> **AI Tournament (LLM) sudah dihapus.** Metode kedua yang dulu ada — skor aspek Technical & Education dinilai sub-agen model bahasa, lalu finalis diberi justifikasi oleh agen lain — dihapus pada November 2026 beserta seluruh run-nya (`drizzle/0097_remove_llm_tournament.sql`). Wizard tidak lagi menawarkan pilihan metode, dan scoring-service menolak sesi bermetode lain dengan pesan *"Metode AI Tournament (LLM) sudah dihapus; sesi ini tidak dinilai. Mulai scoring baru dengan AHP + TOPSIS."* Keputusan suksesor (`position_picks`) yang dulu diambil dari run LLM tetap ada, tanpa tautan ke run-nya. Karena itu semua chip, tab, dan rumus di dokumen ini berlaku untuk setiap run yang masih bisa dibuka.

*Catatan teknis: `components/position-run-table.tsx`, `components/position-detail-tabs.tsx`, `scoring-service/src/ahp-topsis-engine.ts`, `scoring-service/src/runner.ts`.*

---

## 2. Memilih run yang sedang dibaca (kartu "Riwayat Scoring")

### 2.1 Run mana yang sedang ditampilkan (badge "Aktif")

**Aturan pemilihan, berurutan:**
1. Bila URL punya `?runId=…` **dan** run itu memang milik posisi ini → run itu yang dipakai.
2. Bila tidak → run yang cocok dengan `runId` di daftar yang tersaring.
3. Bila tidak ada → **run TERBARU** dalam rentang tanggal & program aktif (daftar diurutkan waktu dibuat, terbaru di atas).
4. Bila tidak ada run sama sekali → seluruh panel diganti kartu *"Belum ada scoring untuk posisi ini…"* + kartu job qualification saja.

**Kondisi:** `runId` yang menunjuk run posisi lain diabaikan. Run yang berada di luar rentang tanggal filter **tetap bisa dibuka lewat `?runId=`**, tetapi tidak muncul di daftar.

### 2.2 Filter tanggal & program

- **Default rentang = tahun berjalan penuh** (1 Januari – 31 Desember tahun ini). Batas akhir dibaca sampai jam 23:59:59.999.
- Default program = kosong (semua program).
- Tombol **Reset** muncul bila filter tidak default.
- Setiap kali filter berubah, paginasi kembali ke halaman 1.

> Sebelumnya default-nya bulan berjalan, yang membuat run bulan sebelumnya "terlihat terhapus" — sekarang satu tahun penuh.

### 2.3 Judul & sub-teks baris run

- **Judul** = label run; bila kosong → `Run {tanggal & jam}`.
- **Sub-teks** = `{tanggal & jam} · {label metode} · {N} kandidat[ · rentang grade]`.
- **Label program**: nama template milik tenant → bila tidak ada, label bawaan `talent` = *Talent Pool*, `successor` = *Critical Position*, `emergency` = *Emergency Position* → bila tidak ada juga, kode mentahnya. Warna badge: talent = biru langit, successor = hijau zamrud, emergency = kuning, lainnya = abu.
- **Rentang grade**: ada min & max → `{namaMin} – {namaMax}` (satu nama bila sama); hanya min → `≥ nama`; hanya max → `≤ nama`; keduanya kosong → tidak ditampilkan.
- **Nama level grade** diambil dari master grade level; ID grade dicari dua kali (ID mentah, lalu prefiks angkanya, karena ID kadang bersufiks huruf seperti `5a`). Tidak ketemu → `Level {id}`.

### 2.4 Badge status run

| Badge | Kondisi |
|---|---|
| **Memuat hasil…** (spinner) | Run sedang dibuka/di-navigasi |
| **Aktif** | Run yang sedang ditampilkan |
| **Berjalan** (kuning, berkedip) | Status run masih `in_progress` |

Saat run terpilih berstatus **Berjalan**, kartu Ringkasan Run Aktif diganti panel *"Scoring Sedang Berjalan"* dan seluruh isi ringkasan disembunyikan.

### 2.5 Paginasi & hapus run

- **5 run per halaman.** Paginasi hanya muncul bila jumlah run lebih dari 5.
- Menghapus run menghapus **seluruh hasil scoring + riwayat chat** run itu secara permanen; bila yang dihapus adalah run yang sedang dibuka, halaman dialihkan ke posisi tanpa `runId`.

*Catatan teknis: `app/(dashboard)/positions/[id]/page.tsx`, `components/position-run-table.tsx`, `lib/scoring-engine.ts`, `lib/utils.ts`.*

---

## 3. Angka utama: **Skor akhir kandidat** (angka persen besar di kartu kandidat)

### Apa artinya
Nilai 0–100 yang menentukan urutan kandidat dan menentukan badge kesiapan.

### Rumus

```
Skor = round(closeness × 100)
closeness (Ci) = D⁻ / (D⁺ + D⁻)
```
`closeness` adalah *closeness coefficient* TOPSIS: makin mendekati 1 makin dekat ke solusi ideal. Bila `D⁺ + D⁻ = 0` → closeness dipaksa **0.5** (lihat Bab 15 untuk detail).

Nilai mentah disimpan dengan presisi 6 desimal.

### Kondisi & fallback penting

- **Skor bisa berisi desimal** (bukan bulat) bila baris hasil kandidat rusak/kosong dan sistem membangun kandidat pengganti dari skor mentah — dalam kasus itu nama tampil `Kandidat`, dan breakdown Behavior/HAV/Edu = 0.
- **Run AHP dengan hanya SATU kandidat** → solusi ideal = anti-ideal → `D⁺ = D⁻ = 0` → closeness 0.5 → **skor 50 → readiness "Long"**. Ini konsekuensi nyata dari nilai fallback 0.5, bukan penilaian.
- Bila semua kandidat punya vektor aspek identik → semuanya juga mendapat 0.5 (skor 50).
- **Skor tidak sebanding antar-run.** Ia relatif terhadap himpunan kandidat dan rentang skor pada run itu.

### Tampil di
Angka `{n}%` besar di kartu kandidat (tab Kandidat), lane pipeline (tab Readiness), *"Skor akhir …"* pada akordeon Analisis per Kandidat, kartu Skor Tertinggi, gauge Diagnostic Dossier, leaderboard Komparasi, kolom Weighted Score pada ekspor.

### Urutan tampilan
Kandidat **diurutkan ulang di klien berdasarkan skor menurun**, bukan berdasarkan kolom peringkat yang tersimpan. Nomor `#1, #2, …` adalah nomor urut hasil pengurutan ini (lalu disesuaikan oleh penataan seri skor manual, lihat Bab 6).

*Catatan teknis: `scoring-service/src/ahp-topsis-engine.ts`, `scoring-service/src/scoring-engine.ts`, `scoring-service/src/topsis.ts`, `lib/scoring-engine.ts`, `components/position-detail-tabs.tsx`.*

---

## 4. **Tingkat Kesiapan / Readiness** (badge Short / Medium / Long / Not Ready)

### 4.1 Ambang yang berlaku

Konfigurasi **global** (berlaku untuk semua business unit, tidak ada versi per tenant), dapat diedit di halaman Governance:

| Tingkat | Skor minimum | Estimasi waktu | Deskripsi |
|---|---|---|---|
| **Short** | ≥ 80 | 0 – 1 tahun | Siap untuk suksesi dalam waktu dekat — sudah memenuhi threshold skor dan persyaratan filter |
| **Medium** | ≥ 65 | 1 – 2 tahun | Siap dengan pengembangan tambahan — perlu akselerasi di beberapa aspek |
| **Long** | ≥ 50 | 3 – 5 tahun | Potensi tinggi namun perlu pengembangan intensif sebelum siap suksesi |
| **Not Ready** | ≥ 0 | > 5 tahun | Belum memenuhi threshold minimal — perlu intervensi pengembangan signifikan |

Tingkat default (bila tidak ada ambang yang cocok) = **Not Ready**.

### 4.2 Rumus pemetaan

```
untuk setiap ambang, berurutan dari atas:
    bila skor >= ambang.minScore → pakai tingkat itu, berhenti
bila tidak ada yang cocok → pakai tingkat default ("Not Ready")
```
Perbandingan memakai **≥** (inklusif di batas bawah). Karena baris "Not Ready" punya ambang 0 dan selalu cocok, jalur "tingkat default" praktis tidak pernah tercapai dengan konfigurasi saat ini.

### 4.3 Rentang persen yang ditampilkan di kartu "Threshold Level"

```
baris pertama          → ">= {minScore}%"
baris dengan minScore 0 → "< {minScore baris sebelumnya}%"
baris lain             → "{minScore}% - {minScore baris sebelumnya − 1}%"
```
Dengan konfigurasi saat ini: `>= 80%`, `65% - 79%`, `50% - 64%`, `< 50%`.

### 4.4 Kondisi & jebakan yang sering ditanyakan

- **Badge readiness di daftar kandidat DIHITUNG ULANG saat halaman dibuka**, dari skor kandidat + konfigurasi ambang **saat ini** — bukan nilai readiness yang tersimpan pada run. **Bila ambang diubah di Governance setelah run selesai, run lama akan tampil dengan tingkat kesiapan yang berbeda dari yang tercatat.** UI menyatakan ini secara eksplisit di tab Konfigurasi.
- Nilai readiness yang **tersimpan** masih dipakai oleh: hitungan *"{N} lolos readiness"*, kartu posisi/dashboard, dan sebagian narasi rekomendasi. Jadi dua angka pada halaman yang sama bisa berasal dari dua sumber readiness berbeda.
- **Ambang tidak di-snapshot per run.** Run lama bisa dinilai dengan ambang berbeda dari yang ditampilkan.
- Editor ambang di Governance: nilai minScore di luar 0–100 **dibuang diam-diam**; daftar disimpan urut menurun; tidak ada validasi bahwa tingkat unik atau bahwa ada baris yang mencakup skor 0 (daftar kosong sah → semua kandidat jatuh ke tingkat default).
- Layanan scoring **meng-cache** ambang di memori. Setelah menyimpan di Governance sistem mengirim sinyal muat-ulang (batas waktu 5 detik, best-effort). Bila alamat layanan tidak dikonfigurasi atau sinyal gagal, ambang baru baru berlaku setelah layanan direstart — tampilan web berubah lebih dulu daripada nilai yang dipersist pada run berikutnya.
- Bila berkas konfigurasi hilang/rusak, dipakai ambang bawaan **80 / 65 / 50** + "Not Ready" (tanpa ETA/deskripsi; ETA jatuh ke `> 5 tahun`).

### 4.5 Estimasi waktu (ETA) per kandidat

```
ETA = eta dari ambang yang tingkatnya sama dengan readiness kandidat
bila tidak ketemu → "> 5 tahun"
```
Pencarian berdasarkan **nama tingkat**, bukan indeks. (Catatan: ada jalur tampilan lain yang memakai teks Inggris hardcode: `0 - 1 Year`, `1 - 2 Years`, `3 - 5 Years`, `> 5 Years`.)

### 4.6 Pipeline Kesiapan Suksesi (tab Readiness)

- Satu kolom per tingkat, disusun mengikuti urutan ambang (diasumsikan menurun).
- Kandidat masuk kolom sesuai tingkat kesiapannya; **tingkat tak dikenal jatuh ke kolom terakhir**.
- Lebar bar = `jumlah kandidat di kolom / total kandidat × 100%`.
- Selisih ke tingkat berikutnya: `max(0, minScore tingkat di atasnya − skor kandidat)` → tampil `+{N}%`. Kolom teratas menampilkan *"Tingkat kesiapan tertinggi"*.
- Kolom kosong → *"Tidak ada kandidat"*.
- **Kandidat yang dikecualikan tetap ikut dihitung** di kolom dan di bar proporsi.

### 4.7 Warna badge readiness TIDAK konsisten antar-panel

| Panel | Short | Medium | Long | Not Ready |
|---|---|---|---|---|
| Tab Kandidat | biru | kuning | hijau zamrud | merah mawar |
| Pipeline Readiness | biru langit | kuning | hijau limau | merah mawar |
| Dossier / Peta Orbit | hijau zamrud (#10b981) | kuning (#f59e0b) | biru langit (#0ea5e9) | merah mawar (#f43f5e) |

Jadi warna Short dan Long **bertukar** antara tab Kandidat dan Peta Orbit/Dossier. Ini murni tema, bukan perbedaan data.

*Catatan teknis: `lib/readiness-config.json`, `lib/readiness-config-actions.ts`, `lib/pulse-data.ts`, `lib/scoring-engine.ts`, `scoring-service/src/scoring-engine.ts`, `components/position-detail-tabs.tsx`, `components/governance/readiness-editor.tsx`.*

---

## 5. Kartu ringkasan di atas daftar kandidat

### 5.1 "Kandidat Diranking" + "{N} lolos readiness"

- **Angka besar** = jumlah kandidat yang tercatat pada run (kolom jumlah kandidat run; untuk AHP ini = jumlah **finalis**).
- **Sub-teks hijau** = `qualifiedCount` = jumlah kandidat dengan **readiness TERSIMPAN ≠ "Not Ready"** **dan** tidak sedang dikecualikan.
  - Artinya **Long ikut dihitung "lolos"**.
  - Kandidat yang dikecualikan dikurangkan di sini.

### 5.2 "Coverage readiness {N}%" + "{M} kandidat qualified"

```
coverage = round( jumlah kandidat "ready" / total kandidat × 100 )
"ready"  = readiness ∈ { Short, Medium }        ← Long TIDAK dihitung
```

**PENTING — sumber datanya berbeda:**
- Coverage **tidak dihitung dari run yang sedang dipilih**, melainkan dari **run terakhir posisi ini yang statusnya bukan "sedang berjalan" dan bukan draft**.
- Coverage memakai skor mentah ×100 **tanpa pembulatan**, sedangkan badge kandidat memakai skor yang sudah dibulatkan. Contoh nyata: closeness 0.7960 → coverage memakai 79.60 (Medium) sementara badge memakai 80 (Short).
- **Pengecualian kandidat TIDAK dikurangkan dari coverage** (hanya dari `qualifiedCount`).
- Definisi "ready" (Short+Medium) pada kartu ini **berbeda** dari definisi "lolos" (Short+Medium+Long) pada sub-teksnya sendiri. Kedua angka pada kartu yang sama karena itu bisa terlihat tidak konsisten.

Band yang dipakai dashboard: `≥ 80` = *Strong bench*; `50–79` = *Watchlist*; `< 50` = *Critical gap*.

### 5.3 Empat kartu di tab Kandidat: "Kandidat / Lolos / Tidak Lolos / Skor Tertinggi"

| Kartu | Rumus |
|---|---|
| **Kandidat** | jumlah baris kandidat yang tampil |
| **Lolos** | `qualifiedCount` dari ringkasan penyaringan run → **fallback**: jumlah kandidat dengan readiness ≠ Not Ready |
| **Tidak Lolos** | `disqualifiedCount` dari ringkasan penyaringan run → **fallback**: jumlah kandidat dengan readiness = Not Ready |
| **Skor Tertinggi** | `max(skor semua kandidat, 0)`, nilai tidak valid dianggap 0, ditampilkan dengan `%` |

**Ambiguitas semantik yang wajib dijelaskan ke user:** label *"Lolos / Kandidat qualified"* dan *"Tidak Lolos / Gagal primary filter"* sebenarnya berasal dari **corong penyaringan pool** (lolos hard filter program), **bukan** dari tingkat kesiapan kandidat yang tampil. Karena itu:
- **"Lolos" bisa jauh lebih besar** daripada jumlah baris kandidat (pool bisa ratusan, finalis hanya 10).
- Bila run tidak menyimpan ringkasan penyaringan, angka yang sama berubah arti menjadi hitungan readiness — dua definisi berbeda pada kartu yang sama.

*Catatan teknis: `lib/position-detail-actions.ts`, `lib/pulse-data.ts`, `components/position-run-table.tsx`, `components/position-detail-tabs.tsx`.*

---

## 6. Peringkat, urutan baris, dan badge "Tied"

### 6.1 Nomor urut

Baris diurutkan **skor menurun** (bukan kolom peringkat), lalu nomor `#1, #2, …` diberikan berdasarkan urutan itu. Urutan tampilan karena itu **bisa berbeda dari kolom peringkat tersimpan** bila keduanya tidak konsisten.

Di sisi mesin AHP, peringkat ditentukan murni oleh closeness menurun, **tanpa tie-break eksplisit** — seri diselesaikan oleh kestabilan pengurutan atas urutan pemuatan kandidat.

### 6.2 Badge "Tied" & tombol ↑/↓ (penataan seri manual)

- Kandidat dikelompokkan berdasarkan **nilai skor yang sama persis** (perbandingan teks). Grup dengan ≥ 2 anggota mendapat badge kuning **Tied** + tooltip *"{n} kandidat memiliki skor yang sama…"*.
- Tombol panah menukar dua anggota grup lalu menyimpan urutan manual (peringkat manual = posisi 1-based di dalam grup skor itu).
- Tombol ↑ nonaktif untuk anggota pertama grup, ↓ untuk anggota terakhir.
- Urutan manual hanya direkonstruksi untuk grup skor yang punya ≥ 2 baris ber-peringkat-manual. Kandidat baru yang belum ada di urutan manual ditambahkan di akhir grup.

### 6.3 Berapa kandidat yang tersimpan?

- Hanya **top-N finalis** yang ditulis sebagai hasil kandidat; N = target finalis sesi (dibatasi jumlah kandidat yang benar-benar dinilai). Target bawaan template sistem = **10**.
- **Seluruh pool** yang dinilai juga disimpan sebagai snapshot terpisah (dipakai untuk backfill saat pengecualian).
- Jumlah kandidat run di-update menjadi **jumlah finalis**, sedangkan ringkasan penyaringan mencatat ukuran pool — dua angka ini memang berbeda.

*Catatan teknis: `components/position-detail-tabs.tsx`, `lib/position-detail-actions.ts`, `scoring-service/src/ahp-topsis-engine.ts`.*

---

## 7. Chip breakdown "Tech / Career / Beh / PA / HAV / Edu" — gambaran umum

### Apa artinya
Baris chip berwarna di badan kartu kandidat, didahului label **"Breakdown:"**. Ini adalah skor per aspek, skala 0–100 (kecuali Technical yang bisa >100, dan chip HAV yang bukan skor).

| Chip | Isi | Warna |
|---|---|---|
| **Tech** | skor Technical | biru langit |
| **Beh** | skor Behavior | fuchsia |
| **HAV** | **BUKAN skor** — `#{nomor} {NAMA} ({KATEGORI})`, mis. `HAV #6 RAW DIAMOND (SOLID)` | ungu |
| **PA** | skor Performance Appraisal | hijau zamrud |
| **Edu** | skor Education | kuning |
| **Career** | skor Career | teal |

### Kondisi
- Chip skor adalah **tombol** (garis bawah putus-putus, membuka popup analisis kriteria).
- Urutan kriteria kanonik: **technical, career, behavior, performance, hav, education** (juga urutan baris/kolom matriks AHP).

### Angka chip = angka yang disimpan run

Setiap chip skor menampilkan nilai aspek yang **disimpan run** (`details.scoreBreakdown`), yaitu nilai yang dipakai menghitung peringkat. Angka yang sama dipakai Dossier, Komparasi, ekspor Excel, dan cetakan, dan sama dengan angka di popup kriteria.

Dua penimpaan lama sudah dihapus:
- **Chip PA** dulu **selalu dihitung ulang dari grade PA kandidat saat ini**. Setelah sinkronisasi membawa grade baru, chip, ekspor, dan cetakan run lama menampilkan PA yang tidak pernah dipakai peringkatnya (sementara popup menampilkan nilai tersimpan). Lebih lama lagi, rumusnya pun berbeda (huruf terbaru, A=100…E=0).
- **Chip Technical** bernilai tersimpan 0 dulu diganti rata-rata skor kompetensi kandidat saat ini (50 bila tidak punya kompetensi). Technical 0 adalah hasil yang sah — tidak ada kompetensi yang cocok dengan tuntutan posisi — dan itulah yang masuk peringkat, jadi sekarang tampil 0.

Hanya baris hasil yang **tidak menyimpan rincian skor sama sekali** (data contoh dari seeder demo lama) yang masih dihitung dari data kandidat saat ini, karena tidak ada nilai tersimpan untuk ditampilkan. Mesin AHP + TOPSIS selalu menyimpan rincian ini. (`lib/run-score-breakdown.ts`, tes `tests/scoring/run-score-breakdown.test.ts`.)

### Nilai default aspek saat data tidak ada (masuk ke perhitungan, tanpa penanda apa pun)
`technical → 0`, `career → 0`, `behavior → 0`, `performance → 50`, `hav → 40`, `education → 0`.
Jadi **skor Performance 50 atau HAV 40 bisa berarti "data tidak ada"**, bukan hasil pengukuran.

*Catatan teknis: `lib/scoring-engine.ts`, `components/position-detail-tabs.tsx`, `components/analysis/ahp-criterion-popup.tsx`, `lib/hav-quadrant.ts`.*

---

## 8. Chip **"Tech"** — Technical Competency (kecocokan kompetensi teknis)

### Apa artinya
Seberapa jauh kompetensi teknis kandidat menutup daftar kompetensi yang **dibutuhkan posisi target**, dicocokkan satu-ke-satu.

### Rumus akhir
```
M = jumlah kompetensi acuan (required) posisi target
Normalisasi Σ/M = ( Σ nilai sel hasil penugasan ) / M      (0 bila M = 0)
Skor Technical = round( Normalisasi × 100 )                 (rentang praktis 0..125)
```
Header pada detail menampilkan: `Normalisasi Σ/M = {x.xxx} · Kandidat N={N} · Required M={M}`.

### Cara satu pasangan dinilai (nilai sel)

**(a) Nama kompetensi SAMA PERSIS (setelah normalisasi) → "Exact"**
```
level kandidat ≥ level target :  nilai = min( 1 + 0.75 × (levelKandidat − levelTarget) / 3 , 1.75 )
level kandidat <  level target :  nilai = max( 0 , 1 − (levelTarget − levelKandidat) / 4 )
```
Contoh: L4 vs target L1 → **1.75**; L3 vs L1 → **1.50**; L3 vs L2 → **1.25**; L2 vs L4 → **0.5**; L1 vs L4 → **0.25**.
Bonus over-qualification maksimum **+75%**, plafon **1.75** — dinaikkan dari +25%/1.25 karena pada
+25% kandidat yang tiga level di atas tuntutan hampir tidak berbeda nilainya dari yang sekadar
memenuhi, sehingga kedalaman penguasaan nyaris tidak terlihat pada skor. Bonus ini **hanya** untuk
pasangan yang identitas kompetensinya sama; pasangan yang cuma mirip tetap diplafon 1.00, jadi
menaikkannya sekaligus melebarkan jarak antara benar-benar menguasai dan sekadar menyerupai.
Diatur lewat `TECHNICAL_OVERQUALIFICATION_SURPLUS`.

**(b) Nama berbeda → "Semantic"**
```
nilai = max( 0 , cosine( vektor kompetensi kandidat pada levelnya , vektor kompetensi required pada level target ) )
```
Vektor diambil dari kamus kompetensi yang sudah di-embed **per level kumulatif** (level 3 = teks Basic + Intermediate + Advance digabung). Vektor tidak ada / kompetensi di luar kamus → **0**. Cosine negatif dipangkas ke 0.
**Tidak ada ambang minimum kemiripan pada jalur AHP** — nilai sekecil apa pun tetap dipakai.

**(c) Tidak dapat pasangan → "Tidak cocok" → nilai 0.**

### Penugasan satu-ke-satu
Menggunakan algoritma **Hungarian (Kuhn–Munkres) maksimum**: total nilai dimaksimalkan secara **global**, bukan serakah. Setiap kompetensi required mendapat **tepat satu** kompetensi kandidat. Jumlah pasangan = min(N, M).

- **N > M** → sisa kompetensi kandidat menjadi **"Kompetensi kandidat tanpa pasangan"**, ditampilkan sebagai chip terpisah, **bernilai 0** (tidak menaikkan skor sama sekali).
- **N < M** → sebagian kolom required "Tidak cocok" (nilai 0).
- Jumlah baris tabel selalu = **M**, satu baris per kompetensi required.

### Level kompetensi
Skala 1–4: **1 Basic, 2 Intermediate, 3 Advance, 4 Mastery**.
Pembacaan teks proficiency: mengandung `MASTERY`/`EXPERT` → 4; `ADVANCE(D)` → 3; `INTERMEDIATE` → 2; `BASIC`/`NOVICE` → 1; kalau tidak, digit 1–4 pertama dalam teks; `#N/A` / `NOT ASSESSED` / `-` / kosong → tidak diketahui.

- **Sisi kandidat**: level tidak diketahui → **default 1 (Basic)**. Jadi kandidat dengan data proficiency kosong otomatis dinilai Basic, yang menurunkan sel exact menjadi rasio `1 / levelTarget`.
- **Sisi kandidat** memakai kolom **level yang DICAPAI** (nilai saat ini) lebih dulu, baru nilai target.

### Dari mana daftar "kompetensi yang dibutuhkan" diambil (5 tingkat)

Berurutan, yang pertama berisi menang:

| Tingkat | Sumber | Catatan level |
|---|---|---|
| 1. **profile** | Kompetensi teknis pada dokumen **Job Profile** posisi | Level dari dokumen; bila tidak tercatat → **2 (Intermediate)** |
| 2. **critical_position** | Daftar kompetensi wajib pada posisi | **Level SELALU diasumsikan 2 (Intermediate)** |
| 3. **incumbent** | Kompetensi **pemegang jabatan saat ini** | Level = **yang DITUNTUT JABATAN** |
| 4. **position_aggregate** | Gabungan **seluruh pemegang kode posisi** target | Level **maksimum** antar-pemegang |
| 5. **none** | Tidak ada acuan sama sekali | Kriteria Technical **dibuang** dari perhitungan |

Level yang dituntut jabatan dibaca berurutan: `proficiency_name` → `score` → (baru sebagai upaya terakhir) `current_proficiency_name` → `current_score` → **default 2**. Urutan ini disengaja: acuan dari kolom "yang dicapai" akan mengukur kandidat terhadap **seorang pribadi**, dan standarnya ikut bergeser mengikuti siapa yang duduk di kursi.

**Sumber "incumbent" atau "position_aggregate" berarti posisi target TIDAK punya dokumen job profile** — kandidat diukur terhadap ORANG. Ini wajib disampaikan ke user; UI menampilkan banner biru *"Acuan kompetensi berasal dari {label}, bukan job profile"*.

Tingkat bukti asesmen incumbent yang dipakai (ditulis sebagai "basis"):
1. `position_column` — asesmen tercatat atas posisi itu (paling kuat);
2. `create_date_window` — asesmen dibuat saat menjabat;
3. `active_all` — asesmen aktif terkini (bukan periode menjabat) — **aproksimasi untuk mantan pemegang jabatan**, dicatat, bukan disembunyikan.

Semakin banyak pemegang posisi, semakin tinggi level target (karena diambil maksimum) → skor kandidat cenderung **lebih ketat**.

### Kondisi & fallback

- **Kandidat tanpa data kompetensi sama sekali (N=0) dengan M>0** → seluruh required "Tidak cocok" → **skor 0**. UI menampilkan banner kuning: *"…ini kekosongan data sumber untuk employee ini, bukan hasil penilaian."*
- **Tidak ada acuan sama sekali (M=0)** → SEMUA kandidat diberi 0 dan **kriteria Technical dibuang dari matriks TOPSIS**, bobotnya dibagi ulang ke kriteria lain. Jadi "Tech 0" pada kandidat tidak berarti bobot Technical tetap terpakai.
- Kolom Technical yang seluruhnya nol **karena tidak ada kandidat berkompetensi** TIDAK menyebabkan kriteria dibuang — pembuangan hanya terjadi bila **acuannya** kosong.
- Bila kamus kompetensi gagal dimuat atau tabel vektor tidak tersedia → **semua sel semantik = 0**, penilaian mundur menjadi "exact-match saja", **tanpa pesan galat ke pengguna**.
- Skor Technical **tidak pernah melebihi 100**. Nilai per pasangan bisa mencapai 1,75 (bonus over-qualification), sehingga `Σ/M` mentah bisa di atas 1 — tetapi agregatnya **dijenuhkan pada 1** sebelum menjadi skor dan sebelum masuk TOPSIS. Surplusnya bersifat **kompensatoris**: boleh menutup kekurangan level pada kompetensi lain, tidak boleh membuat kandidat lebih dari "memenuhi seluruh tuntutan". Kelebihannya tetap dilaporkan (`normalizedRaw`, dan `faktor level`/`nilai` per pasangan) sebagai temuan kedalaman penguasaan.
  Run yang selesai **sebelum** pembatasan ini masih menyimpan skor di atas 100 (terukur: 6 baris, semuanya **113**, maksimum teoretis lama **175** — bukan 125, yang berasal dari masa plafon bonus masih 1,25). Nilai itu tidak ditulis ulang, jadi skor Technical run lama **tidak sebanding langsung** dengan run sesudahnya.
- Pada run turunan (penambahan kandidat / pengecualian), skor Technical bisa **dipakai ulang** dari run dasar, bukan dihitung ulang.

### Tampil di
Chip **Tech**; bar & badge `{n}/100` pada seksi TECHNICAL COMPETENCY di tab Readiness; sumbu Technical pada radar Komparasi; bar "Technical Competence" di Dossier; kolom Tech Score pada ekspor; tabel pasangan lengkap di popup chip / akordeon Analisis per Kandidat.

### Isi tabel pencocokan yang tampil
Kolom **Required** (nama + `L{level} · {label}` + kode kamus atau "(tanpa kamus)"), kolom **Kandidat (Hungarian)**, kolom **Tipe** (Exact hijau / Semantic biru / Tidak cocok abu), kolom **Nilai** (2 desimal + bar yang dipotong 0–1). Ringkasan: `Exact {n} · Semantic {n} · Kosong {n}`.

*Catatan teknis: `scoring-service/src/ahp-topsis-engine.ts`, `scoring-service/src/hungarian.ts`, `lib/job-family/embed.ts`, `components/analysis/aspect-derivations.tsx`.*

---

## 9. Chip **"Career"** — Career Relevance (relevansi jejak karier)

### Apa artinya
Bukan rata-rata kemiripan, melainkan **akumulasi pengalaman relevan** kandidat terhadap posisi target, yang dibandingkan dengan tolok ukur kedalaman.

### Rumus akhir
```
Per riwayat jabatan (stint) i:
    sim'_i        = rescale( kemiripan mentah_i )        → 0..1
    tahun efektif = sim'_i × durasi_i (tahun)

Akumulasi kandidat:
    effectiveYears = Σ ( sim'_i × durasi_i )      ("tahun relevan efektif")
    effectiveRows  = Σ ( sim'_i )                 ("stint relevan efektif")

Dua sumbu kejenuhan:
    depthYears = min( 1 , effectiveYears / targetYears )
    depthRows  = min( 1 , effectiveRows  / targetRows  )

Skor Career = round( max(0, min(1, MIN(depthYears, depthRows) )) × 100 )
penentu (binding) = depthYears ≤ depthRows ? "years" : "rows"
```
**MIN** dipakai agar tidak ada satu sumbu pun yang bisa memaksimalkan kriteria sendirian: banyak stint pendek dibatasi oleh sumbu tahun, satu stint sangat panjang dibatasi oleh sumbu stint.

Riwayat yang **tidak bisa dinilai menyumbang 0 ke KEDUA sumbu** — tidak dikeluarkan dari penyebut. Jadi cakupan buruk benar-benar memotong skor.

### Rescale kemiripan (kenapa cosine 0.60 tidak berarti 60%)
```
sim' = clamp01( (cosine − simFloor) / (simCeil − simFloor) )
```
| Parameter | Default (model non-E5, mis. Nomic) | Default (keluarga E5) |
|---|---|---|
| `simFloor` | **0.45** | 0.75 |
| `simCeil` | **0.85** | 0.95 |

Contoh: cosine 0.60 dengan anchor Nomic → `(0.60−0.45)/(0.85−0.45)` = **0.375** → 37.5% relevansi, bukan 60%.

- Anchor **TETAP** (bukan persentil per-run) supaya skor sebanding antar-run dan antar-posisi.
- Cosine di bawah `simFloor` → 0 (dianggap tidak relevan sama sekali); di atas `simCeil` → 1.
- Bila `simCeil ≤ simFloor` (salah konfigurasi) → tidak ada rescale, hanya dipotong 0–1.
- Pemilihan pasangan default mengikuti **model embedding DOKUMEN**, bukan model utama. (Catatan akurasi: teks alasan yang ditampilkan mencetak nama model utama, sehingga bila kedua pengaturan berbeda teksnya bisa menyebut model yang bukan penentu anchor.)

### Tolok ukur kedalaman (targetYears / targetRows)

Ditampilkan sebagai *"{X} tahun · {Y} stint (sumber: pool | fixed | inherited)"*.

```
1. Run turunan (tambah kandidat) → target DIWARISI dari run dasar     → sumber "inherited"
2. Pool < 5 kandidat                                                  → sumber "fixed"  (5 tahun / 3 stint)
3. Median pengalaman relevan pool < 0.05                              → sumber "fixed"  (5 tahun / 3 stint)
4. Selain itu                                                         → sumber "pool":
      targetYears = clamp( median(effectiveYears) × 2 , 0.5 , 20 )
      targetRows  = clamp( median(effectiveRows)  × 2 , 1   , 8  )
```

| Parameter | Nilai default |
|---|---|
| Target tetap (absolut) | **8 tahun / 2 stint** |
| Pengali syarat pengalaman job profile | **2** (syarat tertulis adalah batas minimal untuk layak, bukan titik nilai penuh) |
| Batas target tahun | **3 – 20** |
| Batas target stint | **1 – 8** |
| Bobot keragaman penugasan (`w`) | **0,25** |
| Penyusutan usia pengalaman | **0,043 / tahun** sejak penugasan berakhir |
| Pelandaian Mincer (`γ`) | **1** (mati secara bawaan) |

- **`T` bersifat ABSOLUT.** Dulu ia diturunkan dari median pool × 2, dan itu punya akibat fatal: penggaris menyusut tepat ketika bench-nya paling lemah, sehingga pool tanpa siapa-siapa justru menghasilkan skor bagus. Terukur pada run yang masih tersimpan — pool Learning & Development dengan relevansi rata-rata 0,168 menghasilkan `T` = 2,06 tahun / **1,0** stint (menyentuh batas bawah, jadi satu stint saja sudah menjenuhkan sumbu itu) dan rata-rata skor 33,1; dengan target tetap 8/2 orang yang sama mendapat 11,3. Inflasinya 1,4× pada pool normal dan 3× pada pool buruk.
- **Sumber "pool" hanya ada pada run yang selesai sebelum perubahan itu.** Bila sebuah run masih menunjukkannya, skor Career-nya RELATIF terhadap peserta run tersebut dan **tidak sebanding** dengan run yang lebih baru. Ini dicatat per kandidat, bukan hanya di ringkasan run, supaya peringatannya ikut ke mana pun angkanya dibawa.
- **Median pool masih diukur, tetapi hanya sebagai diagnostik** — "median pengalaman relevan bench ini cuma 0,37 stint efektif" adalah kalimat paling berguna tentang bench yang skornya jelek.
- **Kedalaman menentukan, keragaman hanya memodulasi:** skor = `capaian_tahun × (0,75 + 0,25 × capaian_periode)`. Dulu dipakai `min()` dari kedua sumbu, dan itu membuang bukti terkuat kriteria ini — kandidat dengan 10,6 tahun di jabatan yang persis sama mendapat 47 sementara kandidat yang seluruh riwayatnya di bidang lain mendapat 100.
- Clamp bisa **memotong** di kedua ujung: syarat 24 tahun → dipotong ke 20; syarat 1–2 tahun → dinaikkan ke 3 (59 job profile menyebut 1 tahun dan 38 menyebut 2, jadi ujung bawah ini sering terpakai).
- Bila target = 0 pada salah satu sumbu → sumbu itu 0 → skor 0.

### Durasi tiap riwayat jabatan (stint)
```
bulan penuh = (tahunAkhir−tahunAwal)×12 + (bulanAkhir−bulanAwal); bila tanggal akhir < tanggal awal → −1 bulan
durasi (tahun) = max(0, bulan penuh) / 12
tanpa tanggal mulai            → dianggap 1 tahun
stint berjalan (tanggal akhir kosong atau tahun ≥ 9999) → dihitung sampai HARI INI
tanggal akhir di masa depan    → dipotong ke hari ini
```
Hari yang belum genap satu bulan dibuang. **Stint berjalan dihitung sampai hari ini** — artinya skor bisa berubah bila run diulang di kemudian hari.

### Bagaimana satu riwayat jabatan dipasangkan ke job profile (4 tingkat)

1. **`kode file_name`** — kode posisi dicocokkan ke token pertama nama berkas job profile. Bila satu kode punya banyak profil: judul persis menang, lalu substring terpanjang, lalu elemen pertama.
2. **`job_family_matches`** — pemasangan posisi ↔ profil yang tersimpan.
3. **`judul sama`** — nama posisi profil sama setelah dinormalisasi.
4. **`embedding > 98%`** — judul di-embed dan dibandingkan; diterima bila kemiripan **> 0.98**.

Bila stint tanpa kode **dan** tanpa judul → langsung tidak terpasangkan. Bila layanan embedding gagal → seluruh judul yang tersisa menjadi "tanpa pasangan". Untuk stint "posisi saat ini" yang belum cocok, dipakai pemasangan job family milik kandidat itu sendiri.

### Bagaimana **posisi target** dipasangkan (5 tingkat)

1. Pemasangan job family posisi (paling otoritatif).
2. Resolusi deskriptor posisi target lewat 4 tingkat di atas (kode berkas → pemasangan → judul sama → embedding > 98%).
3. **Kode posisi milik incumbent** (maksimal 5 baris posisi incumbent, diutamakan posisi primer & terbaru) → tipe `posisi incumbent`.
4. **Dokumen sintetis (`pseudo_profile`)** — bila tetap tidak ada vektor dokumen, sistem merangkai dokumen sendiri dari data posisi:
   `Jabatan / Divisi-Departemen / Tujuan Jabatan / Kualifikasi Pendidikan / Pengalaman / Kompetensi Teknis (nama + level)`, lalu di-embed memakai model yang mengisi bank vektor dokumen. Hanya dicoba bila ada minimal satu vektor dokumen untuk dibandingkan. Bila gagal (dokumen kosong, model tidak diketahui, layanan tidak membalas, dimensi berbeda), alasannya dicatat dan seluruh riwayat jatuh ke fallback kompetensi.
5. Tidak ketemu → status target `no_match`.

**Status posisi target:**

| Status | Arti | Akibat |
|---|---|---|
| `ok` | Ada dokumen + vektornya | Riwayat dinilai lewat kemiripan dokumen |
| `no_match` | Tidak ada dokumen job profile yang cocok | **Semua** riwayat lewat fallback kompetensi |
| `no_embedding` | Profil ketemu tetapi belum di-embed | Sama seperti `no_match` + pesan *jalankan "Bangun Ulang Embedding" di Configuration* |

### Fallback: pencocokan **kompetensi incumbent** (bila tidak ada dokumen)

Untuk riwayat jabatan yang tidak punya kemiripan dokumen:
1. Ambil pemegang posisi tersebut (filter perusahaan; bila kosong → semua perusahaan; **kandidat sendiri selalu dikecualikan** agar tidak mendapat nilai ~1.0 gratis; ambil semua pemegang aktif, kalau tidak ada ambil satu pemegang terakhir).
2. Gabungkan kompetensi mereka (level maksimum per nama).
3. Cocokkan satu-ke-satu (Hungarian, rumus sel sama persis dengan aspek Technical) terhadap **acuan kompetensi posisi target yang SAMA dengan aspek Technical**.
4. Hasil `Σ/M` (0..1.75) **dikalibrasi** ke skala kemiripan dokumen, lalu di-rescale dengan anchor yang sama.

**Kalibrasi:**
```
kumpulkan semua kemiripan dokumen pada run ini, urut naik
jumlah sampel < 3          → pakai anchor tetap (sumber "fixed")
lo = persentil 5%, hi = persentil 95%
(hi − lo) < 0.02           → pakai anchor tetap (sumber "fixed")
selain itu                 → lo/hi empiris (sumber "empirical")

nilai_terkalibrasi = clamp01( lo + clamp01(rasio) × (hi − lo) )
```
Anchor tetap = **0.45 – 0.85** (non-E5) atau **0.75 – 0.95** (E5). Rentang empiris diambil dari **seluruh run** (semua kandidat), bukan per kandidat. Bonus over-qualification di atas 1.0 hilang saat kalibrasi (dipotong 0–1).

Fallback hanya bisa berjalan bila posisi target punya acuan kompetensi (jumlah > 0). Riwayat **tanpa kode posisi** tidak bisa difallback.

### Status per riwayat & artinya di layar

| Badge status | Arti |
|---|---|
| **Cocok** | Terpasangkan ke job profile dan vektornya ada |
| **Belum di-embed** | Terpasangkan tetapi vektor dokumen belum dibangun |
| **Tanpa pasangan** | Tidak terpasangkan ke job profile mana pun |

Badge **basis** menjelaskan bagaimana angkanya benar-benar diperoleh: `dokumen` / `fallback kompetensi` / `tidak dinilai`. Sebuah riwayat bisa berstatus **Cocok** tetapi tetap dinilai lewat fallback (ketika posisi target yang tidak punya dokumen).

### Yang ditampilkan pada detail Career

- Header (run baru): `Pengalaman relevan efektif {X} th / {Y} stint · Durasi dinilai {A}/{B} th ({C}% cakupan)`
- Header (run lama, tanpa data kedalaman): `Σ(sim×th)/Σth = {x.xxx}` — ini **rumus lama** yang kini hanya diagnostik.
- Dua kartu **Kedalaman durasi** dan **Kedalaman riwayat** dengan bar persen; kartu yang menjadi **penentu** diberi badge *"penentu"*.
- Per riwayat: durasi (2 desimal), kemiripan **hasil rescale** (2 desimal) + baris kecil `cosine {x.xxx} · {y} th efektif`.
- Badge cakupan: `Dokumen {n}` / `Fallback {n}` / `Tidak dinilai {n}`.
- Blok *"Posisi tanpa profil job family (n) — x dinilai lewat kompetensi incumbent, y tidak masuk perhitungan"*.
- `coverage = durasi yang dinilai / total durasi` (0 bila total 0). **Cakupan tidak mengurangi skor secara langsung** — pengaruhnya sudah masuk lewat akumulasi (riwayat tak dinilai = 0).

### Banner peringatan yang mungkin muncul

- **Biru** — posisi target tidak punya dokumen, seluruh riwayat dinilai lewat kompetensi incumbent; nilainya dikalibrasi.
- **Kuning** — posisi target tidak punya dokumen **dan** tidak ada acuan kompetensi → **skor Career = 0**.
- **Kuning panjang** — tidak satu pun riwayat kandidat dapat dinilai (job profile tak ditemukan lewat 4 jalur, dan posisinya tak tercatat pemegangnya) → Career = 0. *"Umum terjadi untuk riwayat di perusahaan luar."*

### Kondisi khusus

- **Kriteria Career dibuang dari perhitungan** bila status target ≠ `ok` **dan** tidak ada acuan kompetensi sama sekali. Career **tidak** dibuang hanya karena semua kandidat kebetulan bernilai 0.
- `meanSimilarity` (rumus lama `Σ(sim×th)/Σth` atas riwayat yang dinilai saja) tetap dicatat sebagai diagnostik, **tidak lagi memengaruhi skor** — gunanya memisahkan "cocok tapi terlalu sedikit" dari "banyak tapi tidak cocok".
- Pada run turunan, tolok ukur kedalaman **dipatok ke run dasar** supaya kandidat lama & baru diukur dengan penggaris yang sama.

*Catatan teknis: `scoring-service/src/ahp-topsis-engine.ts`, `scoring-service/src/config.ts`, `components/analysis/aspect-derivations.tsx`, `components/analysis/run-configuration-panel.tsx`.*

---

## 10. Chip **"Beh"** — Behavior Competency Assessment

### Sumber data
Rekomendasi asesmen behavior karyawan (hasil assessment center), **hanya asesmen TERBARU** per karyawan (tanggal pelaksanaan terbesar). Tidak ada agregasi historis. Karyawan tanpa baris asesmen → rekomendasi kosong.

### Rumus — kategorisasi ordinal berpasangan

```
Skor = round( nilai_ordinal × 100 / 6 )
```
Nilai ordinal per kategori (dua kategori berbagi satu nilai — "berpasangan"):

| # | Kategori | Ordinal | **Skor** |
|---|---|---|---|
| 1 | VERY HIGH | 6 | **100** |
| 2 | STRENGTH | 6 | **100** |
| 3 | HIGH | 5 | **83** |
| 4 | READY | 5 | **83** |
| 5 | MIDDLE HIGH | 4 | **67** |
| 6 | PENGEMBANGAN JANGKA PENDEK | 4 | **67** |
| 7 | READY WITH DEVELOPMENT | 3 | **50** |
| 8 | POTENSI | 3 | **50** |
| 9 | NEED DEVELOPMENT (9 MONTHS - 2 YEARS) | 2 | **33** |
| 10 | MIDDLE LOW | 2 | **33** |
| 11 | FOCUS ON OPTIMIZATION IN CURRENT POSITION | 1 | **17** |
| 12 | LOW | 1 | **17** |
| 13 | BELUM ADA POTENSI | 0 | **0** |
| 14 | VERY LOW | 0 | **0** |
| 15 | NOT READY | 0 | **0** |

Hanya **7 nilai skor** yang mungkin: 100, 83, 67, 50, 33, 17, 0.

**Data kosong / `-` / kategori tak dikenal → skor 0.** Tidak ada nilai netral 50. Konsekuensinya: **kandidat yang belum pernah diases terlihat sama buruknya dengan kandidat yang dinilai "NOT READY"**.

### Cara teks kategori dicocokkan
Normalisasi: huruf besar semua, tanda hubung panjang → `-`, spasi dirapatkan. Lalu:
1. **Cocok persis** → dipakai.
2. **Nilai berdekorasi** — bila teks mengandung sebuah kategori, ambil kategori **TERPANJANG**. (Contoh: "SANGAT VERY HIGH" → VERY HIGH, bukan HIGH.)
3. **Nilai terpotong** — bila sebuah kategori mengandung teks, ambil kategori **TERPENDEK**. (Contoh: "NEED DEVELOPMENT" → "NEED DEVELOPMENT (9 MONTHS - 2 YEARS)".)
4. Aturan 2 menang atas aturan 3. Tidak ada yang cocok → 0.

Karena cocok-persis dijalankan lebih dulu, **"NOT READY" tidak pernah salah dibaca sebagai "READY"**.

### Behavior juga menjadi **filter kelayakan** (terpisah dari skor)
Aturan bawaan di ketiga program: `Behavior Recommendation` **tidak boleh** termasuk `NOT READY`, `VERY LOW`, `BELUM ADA POTENSI`. Perbandingan ini **persis huruf demi huruf** (bukan fuzzy). Jadi variasi penulisan bisa lolos filter walaupun skornya 0 lewat pencocokan fuzzy — dua mekanisme berbeda.

### Kondisi
- Behavior **selalu dihitung ulang** untuk semua kandidat pada run turunan (tidak pernah dipakai ulang dari run dasar) — karena itu, run pengecualian bisa menghasilkan skor Behavior berbeda bila data HR sudah berubah.
- Behavior **tidak pernah** dibuang dari matriks perhitungan.

### Tampil di
Chip **Beh**; bar Behavior pada grid aspek; seksi **BEHAVIOR** (badge `{n}/100`) berisi `Rekomendasi asesmen` + catatan; bar *"Leadership behavior review"* di Dossier; sumbu Behavior pada radar.
Bila run bukan AHP → *"Detail behavior belum tersedia."*

*Catatan teknis: `scoring-service/src/ahp-topsis-engine.ts`, `scoring-service/src/scoring-engine.ts`, `sync-service/src/services/behavior-sync.ts`, `lib/program-defaults.ts`, `lib/programs.ts`.*

---

## 11. Chip **"PA"** — Performance Appraisal (nilai kinerja)

### 11.1 Bentuk data sumber: CSV 6 slot semester

```
[0] = tahun−1 Semester 2   [1] = tahun−1 Semester 1
[2] = tahun−2 Semester 2   [3] = tahun−2 Semester 1
[4] = tahun−3 Semester 2   [5] = tahun−3 Semester 1
```
- **Selalu 6 slot** (5 koma), slot kosong = string kosong.
- Jendela = **tiga tahun kalender SEBELUM tahun berjalan** — tahun berjalan **selalu dikecualikan**. Jadi "kenapa PA saya masih C padahal semester ini A" terjawab di sini.
- Tahun acuan ditentukan **saat sinkronisasi dijalankan**, bukan saat halaman dibuka.
- Difilter per perusahaan → PA lintas business unit (karyawan pindah BU) tidak ikut terhitung.
- Karena jendela relatif, isi CSV **bergeser tiap pergantian tahun**; sinkronisasi ulang mengubah skor PA run berikutnya.

### 11.2 Skor PA — TOPSIS jangkar absolut, bobot periode terdegradasi

```
1. Ubah tiap slot jadi angka: A=4, B=3, C=2, D=1, E=0
   slot kosong / huruf tak dikenal → nilai C = 2
2. Bobot periode (terdegradasi ke belakang), dinormalisasi ulang atas slot yang ada
3. D⁺ = sqrt( Σ w_k × (x_k − 4)² )      ← jangkar ABSOLUT "all-A"
   D⁻ = sqrt( Σ w_k × (x_k − 1)² )      ← jangkar ABSOLUT "all-D"
4. CC = D⁻ / (D⁺ + D⁻); bila keduanya 0 → 0.5
5. Skor = round( CC × 100 )
```

**Bobot periode — terdegradasi ke belakang.** Diturunkan dengan metode AHP dari
preferensi `decay^k` dengan `decay = 0.8` (`PA_RECENCY_DECAY`): preferensi itu
menjadi matriks perbandingan berpasangan yang konsisten sempurna (CR = 0) dan
vektor prioritasnya dipakai sebagai bobot.

| Slot | 0 (terbaru) | 1 | 2 | 3 | 4 | 5 (terlama) |
|---|---|---|---|---|---|---|
| Bobot | **0.271056** | 0.216844 | 0.173476 | 0.138780 | 0.111024 | 0.088819 |

Semester terbaru bernilai ~3x yang tertua. Ini keputusan kebijakan, bukan
kebetulan: semester tiga tahun lalu adalah bukti yang lebih lemah tentang
kemampuan sekarang. Setel `PA_RECENCY_DECAY=1` untuk bobot rata (TOPSIS absolut
tanpa suku kebaruan); tidak ada kode lain yang berubah.

**Seberapa jauh bobot ini benar-benar berpengaruh.** Dari 156 kandidat yang punya
PA, **147 (94%) bernilai seragam di keenam periode**, dan pada kondisi itu bobot
**tidak berpengaruh sama sekali** — kedua jarak berskala `√(Σw) = 1` sehingga
kedekatannya identik untuk pembobotan apa pun. Degradasi bobot karena itu hanya
membedakan 9 kandidat (5,8%) yang rekam jejaknya memang bergerak — tepat sasaran
yang dimaksud. Selisihnya di sana rata-rata 4,4 poin, terbesar 7 poin.

**Contoh terverifikasi:**

| CSV | Skor |
|---|---|
| `A,A,A,A,A,A` | **100** |
| `B,B,B,B,B,B` | **67** |
| `C,C,C,C,C,C` | **33** |
| `D,D,D,D,D,D` | **0** |
| `E,E,E,E,E,E` | **20** |
| `,,,,,` (kosong semua) | **33** |
| `A,B,B,C,C,C` | 61 |
| `A,C,C,C,C,C` | 51 |
| `C,C,C,C,C,A` | 41 |
| `B,A,B,A,B,A` | 77 |
| `A,A,B,B,C,C` | 70 |

Perhatikan `A,C,C,C,C,C` = **51** lawan `C,C,C,C,C,A` = **41**: enam nilai yang
sama, urutan berbeda, skor berbeda. Itu bacaan yang **dimaksudkan** — yang pertama
membaik belakangan, yang kedua menurun. Baris yang nilainya seragam
(100/67/33/0/20/33) tidak terpengaruh pembobotan apa pun.

**Karakteristik & anomali:**
- Karena jangkarnya **absolut**, skor PA **sebanding antar-run** — berbeda dari skor akhir yang set-relative.
- **Slot kosong dibaca sebagai C**, bukan diabaikan. Kandidat tanpa data PA sama sekali menghasilkan **33**, bukan 0 dan bukan 50.
- **ANOMALI NON-MONOTONIK NYATA:** karena nilai E = 0 berada **di bawah** jangkar negatif D = 1, rekam jejak **semua E mendapat 20** sedangkan **semua D mendapat 0**. Jadi E dinilai lebih tinggi daripada D.
- **Urutan nilai BERPENGARUH** — periode lama berbobot lebih kecil, jadi tren naik dan tren turun dinilai berbeda meski himpunan nilainya identik.
- Bila CSV punya lebih dari 6 slot, slot ke-7 dan seterusnya memakai bobot terakhir (0.088819).
- Bobot periode ini **terpisah** dari bobot AHP antar-kriteria; tidak bisa diubah per program.
- Perhitungan ini dibangun ulang untuk tampilan oleh `lib/pa-topsis.ts`, sehingga **setiap run — termasuk yang selesai sebelum fitur penjabaran ada — tetap bisa dijelaskan per periode**. Bila hasil hitung ulang berbeda dari skor tersimpan, keduanya ditampilkan dan skor tersimpan tidak ditimpa: angka itulah yang membentuk peringkat run tersebut.

### 11.3 Yang tampil di chip PA

- Aturan lama (hanya huruf semester terbaru, A=100 B=80 C=60 D=20 E=0, tanpa data → 60) sudah tidak dipakai di mana pun; run lama yang dinilai dengan aturan itu tetap menyimpan angkanya sendiri.
- **Chip PA menampilkan skor PA yang disimpan run** — angka yang membentuk peringkat, sama dengan popup kriteria dan seksi PERFORMANCE APPRAISAL (lihat Bab 7). Chip ini tidak lagi dihitung ulang dari grade PA kandidat saat ini, jadi sinkronisasi PA baru tidak mengubah run yang sudah selesai.

### 11.4 PA sebagai **filter kelayakan** — semantik jendela, bukan satu nilai

```
periode = pecah CSV → trim → huruf besar → simpan hanya A/B/C/D/E   (slot kosong DIBUANG)
'in'    → ADA satu periode yang termasuk daftar          (eksistensial)
'notIn' → TIDAK ADA satu pun periode yang termasuk       (universal)
'eq'    → ADA satu periode yang sama
'neq'   → SEMUA periode berbeda
operator angka (≥/≤/>/<) → selalu gagal
```
Aturan bawaan: **Talent Pool** `in [A,B]`; **Critical Position** `in [A,B]`; **Emergency** `in [A,B,C]`.

**Konsekuensi:** satu semester bernilai A sudah **meloloskan** aturan "PA min B dalam 3 tahun terakhir" walaupun lima semester lain C/D. Filter menentukan **siapa masuk pool**; skor menentukan **peringkat** — dua hal terpisah.

Kandidat tanpa satu pun huruf valid dianggap "data hilang" dan (pada jalur scoring) tetap dievaluasi setelah disuntik nilai `C`.

### Tampil di
Chip **PA**; bar Performance pada grid aspek; seksi **PERFORMANCE APPRAISAL** dengan `Grade PA terkini` (catatan: yang ditampilkan sebenarnya **seluruh CSV 6 semester**, bukan grade terakhir saja); bar *"Performance appraisal logs"* di Dossier; grafik garis Riwayat PA; tabel PA pada cetakan HTML; kolom PA Score pada ekspor.

*Catatan teknis: `scoring-service/src/ahp-topsis-engine.ts`, `scoring-service/src/topsis.ts`, `scoring-service/src/scoring-engine.ts`, `lib/scoring-engine.ts`, `lib/programs.ts`, `sync-service/src/services/candidate-populate.ts`.*

---

## 12. Chip **"HAV"** — HAV Mapping (kuadran talenta)

### Apa yang tampil di chip
Chip HAV **bukan skor**, melainkan `#{nomor} {NAMA} ({KATEGORI})`, mis. **`HAV #6 RAW DIAMOND (SOLID)`**.

Peta 16 kuadran:

| # | Nama | Kategori | | # | Nama | Kategori |
|---|---|---|---|---|---|---|
| 1 | STAR | TOP | | 9 | CAREER PERSON | SOLID |
| 2 | FUTURE STAR | STRONG | | 10 | MOST UNFIT EMPLOYEE | BORDER |
| 3 | POTENTIAL CANDIDATE | STRONG | | 11 | UNFIT EMPLOYEE | BORDER |
| 4 | FUTURE STAR | STRONG | | 12 | PROBLEM EMPLOYEE | BORDER |
| 5 | CANDIDATE | SOLID | | 13 | MAXIMAL CONTRIBUTOR | STRONG |
| 6 | RAW DIAMOND | SOLID | | 14 | CONTRIBUTOR | SOLID |
| 7 | TOP PERFORMER | STRONG | | 15 | MINIMAL CONTRIBUTOR | BORDER |
| 8 | STRONG PERFORMER | SOLID | | 16 | DEADWOOD | BOTTOM |

Format: kosong → `—`; teks tanpa angka → dikembalikan apa adanya; angka di luar 1–16 → hanya angkanya.

### Rumus **skor** HAV (yang benar-benar masuk perhitungan)

```
kuadran kosong → 40
ambil semua digit dari teks kuadran → cari di tabel tier
tidak ada di tabel → 40
```

| Tier | Kuadran | **Skor** |
|---|---|---|
| 5 — Highly Recommended | **1** | **100** |
| 4 — Recommended | **2, 3, 4, 7, 8** | **80** |
| 3 — Belum Bisa Direkomendasikan | **5, 6, 9, 13, 14** | **60** |
| 2 — Tidak Direkomendasikan | **10, 11, 12, 15** | **40** |
| 1 — Bottom | **16** | **20** |

Hanya 5 nilai yang mungkin (plus 40 untuk data hilang).

### Kondisi & catatan
- **Kuadran 13 dan 14 tidak ada di tabel dokumen metodologi**; sistem menempatkannya di tier 60 (Maximal Contributor / Contributor) — keputusan implementasi yang didokumentasikan.
- **Kategori Q13 adalah STRONG** (sebelumnya tertulis SOLID — tebakan atas celah yang sama). Spesifikasi Talent Mapping HR (2026-10) menetapkan matriks lengkap: Q13 STRONG, Q14 SOLID. Yang berubah hanya **label kategori** di chip; **skor tier Q13 tetap 60**, karena tier skor adalah bacaan terpisah (lihat butir di bawah) dan memindahkannya adalah keputusan kebijakan scoring tersendiri.
- **Data hilang atau tidak terparse → 40** (tier "Tidak Direkomendasikan"), sengaja **tidak** disamakan dengan kuadran 16 (20).
- Kategori teks (TOP/STRONG/SOLID/BORDER/BOTTOM) **tidak identik** dengan 5 tier skor. Contoh: kuadran 8 berkategori SOLID tetapi bernilai 80 (tier Recommended), sedangkan 5/6/9 juga SOLID tetapi bernilai 60.
- Seksi **HAV MAPPING** pada detail kandidat menampilkan **angka kuadran mentah** saja (tanpa nama/kategori).
- HAV **selalu dihitung ulang** untuk semua kandidat; **tidak pernah** dibuang dari matriks.
- Sumber: **HAV yang berlaku** (sejak 2026-10, [`talent-mapping.md`](talent-mapping.md)) — penempatan manual di Talent Mapping, kalau tidak ada **berkas Excel HAV**, kalau tidak ada **rumus PA × Behavioral Assessment** ([`hav-16-kuadran.md`](hav-16-kuadran.md)). Upload HAV yang mengubah kuadran seseorang menggantikan penempatan manualnya. Nilai valid 1–16; tidak ada sumber → skor 40. Baris Excel tanpa NPK atau tanpa kuadran valid dibuang (karyawan tetap memakai kuadran dari unggahan sebelumnya). Setiap run mencatat sumber HAV tiap kandidat (`rawInputs.havSource`, rekap di `runInfo.hav.sources`); kandidat bersumber rumus berarti PA dan behavior ikut terbaca lagi lewat aspek HAV — keputusan sadar HR.
- **Aturan filter HAV** (lihat di bawah) menilai nilai yang sama, jadi pool dan skor HAV sebuah run tidak pernah membaca dua HAV berbeda.

### HAV sebagai **filter kelayakan**
Aturan bawaan seluruh program: kuadran **tidak boleh 16**. Ditambah per program:

| Program | Kuadran yang diizinkan |
|---|---|
| Talent Pool | 1, 2, 3, 4, 7 |
| Critical Position | 1, 2, 3, 4, 7, 8, 13, 14 |
| Emergency Position | 1, 2, 3, 4, 7, 8 |

**Kuadran kosong/tidak valid → gagal aturan "termasuk" → kandidat tersaring keluar pada ketiga program.** Filter kuadran per program lebih ketat daripada skor: kandidat kuadran 5/6/9 (skor 60) tidak lolos filter program mana pun.

### Tampil di
Chip HAV; seksi HAV MAPPING; baris "HAV Kuadran" di Dossier (tanpa bar, karena bukan skor); sumbu **HAV pada radar Komparasi memakai SKOR** (bukan nomor kuadran); kolom HAV Quadrant dan HAV Score pada ekspor; kartu dan tabel Score Breakdown pada cetakan.

### Kuadran mana yang tampil pada baris hasil run
**Kuadran yang dinilai run itu**, bukan HAV yang berlaku hari ini. Penempatan Talent Mapping atau unggahan HAV setelah run selesai **tidak** mengubah kuadran yang tampil di chip, Dossier, Komparasi, ekspor, cetakan, atau konteks AI Assistant, sehingga kuadran selalu cocok dengan skor HAV di sebelahnya.

| Baris | Yang tampil |
|---|---|
| Run AHP + TOPSIS | Kuadran yang dicatat mesin saat menilai; `—` bila kandidat tidak punya HAV saat itu |
| Cetak Kandidat Terpilih untuk kandidat yang tidak ada di run yang sedang dibuka | HAV profil, berlabel **(data terkini)** |

Sebelumnya, baris hasil run menampilkan HAV yang berlaku **hari ini** (penempatan manual › unggahan › rumus), sehingga kuadran di chip bisa tidak cocok dengan skor HAV run. (`recordedHavQuadrant` di `lib/run-score-breakdown.ts`, `runHavText` di `lib/analysis-utils.ts`.)

*Catatan teknis: `scoring-service/src/scoring-engine.ts`, `lib/hav-quadrant.ts`, `sync-service/src/services/hav-sync.ts`, `lib/program-defaults.ts`.*

---

## 13. Chip **"Edu"** — Employee Profile / Pendidikan

### 13.1 Persyaratan pendidikan posisi — 3 tingkat sumber

```
1. Job Profile posisi → spesifikasi pendidikan (verbatim, mis. "S1 / D3 Semua Jurusan")
2. Kolom pendidikan pada posisi
3. Pendidikan + jurusan INCUMBENT (digabung jadi satu teks)
kalau ketiganya kosong → tidak ada persyaratan
```
Bila persyaratan tidak ada, **pencocokan persis selalu gagal** dan semua kandidat masuk jalur penilaian model.

> Catatan: sumber persyaratan **disimpan tetapi TIDAK ditampilkan** — pengguna tidak melihat bahwa persyaratan berasal dari incumbent, bukan dari job profile.

### 13.2 Jalur A — **Exact match** (deterministik, skor tetap **100**)

```
Tokenisasi: huruf kecil, "strata 1" → "strata1", non-alfanumerik → spasi
isMinimum = persyaratan mengandung "minimal" / "min" / "setidaknya" / "paling rendah"
anyMajor  = persyaratan mengandung "semua" / "any" / "all"

CEK JENJANG:
  bila isMinimum  → jenjang kandidat >= jenjang terendah pada persyaratan
  bila TIDAK      → jenjang kandidat HARUS PERSIS SAMA dengan salah satu jenjang persyaratan

CEK JURUSAN:
  lolos bila anyMajor, atau persyaratan tidak menyebut bidang studi,
  atau ada IRISAN TOKEN antara jurusan kandidat dan persyaratan

kedua-duanya lolos → skor = 100 (TETAP), sumber "exact-match", tanpa panggilan model
```

Peringkat jenjang: `sd 1 | smp,sltp 2 | sma,smk,slta,stm,man,sederajat 3 | d1 4 | d2 5 | d3,diploma,ahlimadya 6 | d4 7 | s1,sarjana,bachelor,strata1 8 | s2,magister,master,pascasarjana 9 | s3,doktor,doctoral,phd 10`

Kata yang diabaikan pada sisi jurusan: *minimal, min, pendidikan, jenjang, atau, dan, and, or, semua, jurusan, all, any, sederajat, diutamakan, preferably, dari, bidang, yang, relevan, terkait, sesuai, dengan.*

**Jebakan penting:**
- Skor exact-match **selalu 100**, tidak bergantung seberapa cocok.
- Tanpa kata "minimal", jenjang harus **persis sama**: kandidat **S2 GAGAL** exact-match terhadap persyaratan "S1 Teknik" dan dilempar ke penilaian model.
- Kecocokan jurusan adalah **irisan token apa adanya**, tanpa sinonim: "informatika" vs "ilmu komputer" **tidak cocok**.
- Kata "sederajat" dihitung sebagai jenjang SLTA di sisi jenjang, tetapi diabaikan di sisi jurusan.

### 13.3 Jalur B — penilaian **Gemini dengan Grounding Google Search**

```
Skor = round( (education_level + major_relevance) / 2 )     ← rata-rata dua sub-skor 0..100
```
- Prompt berisi: nama kandidat, `Pendidikan (jenjang | jurusan)`, syarat minimal pendidikan (atau "(tidak dinyatakan eksplisit)"), tujuan jabatan, dan **maksimal 10 tanggung jawab utama** beserta indikator keberhasilannya.
- **Rubrik anchor di prompt:** `100 = sangat sesuai/relevan · 80 = relevan · 60 = cukup · 40 = kurang · 20 = tidak relevan`. Rubrik hanya anchor — model boleh mengembalikan nilai apa pun 0–100; hasilnya dipotong 0–100 lalu dibulatkan.
- Parameter model: **temperature 0, top-p 0** (greedy, reproducible), batas waktu **60 detik**, model bawaan `gemini-2.5-flash`.
- Grounding dan pemaksaan bentuk JSON **saling eksklusif** di API, sehingga bentuk jawaban hanya dipaksa lewat prompt → model kadang menjawab prosa (dasar adanya percobaan ulang).
- Yang disimpan & ditampilkan: **kueri pencarian** dan **daftar tautan sumber** (maks 8).
- Posisi dengan lebih dari 10 tanggung jawab dinilai atas subset. Job profile tidak ketemu → prompt tanpa blok tanggung jawab (dasar penilaian jauh lebih lemah), tetapi tetap dijalankan.

### 13.4 Jalur C — percobaan ulang & **perbaikan bentuk** (`llm-structured`)

```
maksimum 3 percobaan grounded (1 + 2 percobaan ulang)
semua gagal → SATU kali "repair pass": grounding DIMATIKAN sehingga bentuk JSON dijamin API
   berhasil → sumber "llm-structured" (badge kuning), skor = rata-rata dua sub-skor
   gagal    → skor tidak tersedia (0)
```
Repair pass tidak menghasilkan kueri/sumber grounding — alasan tanpa sitasi. Alasannya ditulis eksplisit: *"skor rubrik tanpa sitasi lebih baik daripada 'tidak dinilai' (0), yang justru akan menyeret posisi TOPSIS kandidat turun hanya karena kesalahan format."*

### 13.5 Jalur D — **"Tidak tersedia"** (skor 0)

Terjadi bila bukan exact-match **dan**: tidak ada data pendidikan/jurusan, **atau** kunci API model tidak diset, **atau** semua percobaan gagal. Alasan yang ditampilkan salah satu dari:
- *"Kandidat tidak memiliki data pendidikan/jurusan untuk dinilai."*
- *"Skor edukasi tidak tersedia: seluruh percobaan penilaian Gemini (grounded + structured output) gagal. Penyebab terakhir: …"*
- *"Skor edukasi tidak tersedia: GEMINI_API_KEY belum diset…"*

**Tidak ada lagi fallback kemiripan BERT** — jalur itu dihapus karena memberi skor terlalu tinggi untuk jurusan tak relevan. Badge "Fallback kemiripan (BERT)" hanya muncul pada run lama.

### 13.6 Yang ditampilkan pada detail Pendidikan

| Badge sumber | Arti |
|---|---|
| **Exact match (deterministik · 100)** — hijau | Jalur A |
| **Gemini + Grounding Google Search** — ungu | Jalur B |
| **Gemini structured output (tanpa grounding)** — kuning | Jalur C |
| **Fallback kemiripan (BERT)** — kuning | Run lama saja |
| **Tidak tersedia** — abu | Jalur D |

Dua bar rubrik (**Jenjang Pendidikan** dan **Relevansi Jurusan**, 0–100) dengan label: `≥90 sangat relevan · ≥70 relevan · ≥50 cukup · ≥30 kurang · selain itu tidak relevan`; warna bar: `≥80 hijau · ≥60 biru · ≥40 kuning · selain itu merah`. Bar hanya muncul pada jalur model. **Token cocok** hanya untuk exact-match. Blok grounding (kueri + tautan) hanya bila ada.

> Ambang label rubrik di layar (90/70/50/30) berbeda dari anchor rubrik di prompt (100/80/60/40/20).

Badge tambahan **"Jawaban model dipakai ulang"** (biru) muncul di samping badge Jalur B/C bila model **tidak dipanggil** pada run ini (lihat §13.8). Penjabaran skornya menyebut run dan waktu model benar-benar menjawab.

### 13.7 Kondisi lain

- **Kriteria Education dibuang** dari perhitungan bila **SETIAP** kandidat berstatus "tidak tersedia". Evaluasi dilakukan atas seluruh kandidat yang diperingkat, bukan hanya yang baru dinilai.
- Education termasuk aspek yang **dipakai ulang** pada run turunan (bersama Technical & Career) — nilainya bisa berasal dari penilaian tanggal yang lebih lama.

*Catatan teknis: `scoring-service/src/ahp-topsis-engine.ts`, `scoring-service/src/gemini.ts`, `scoring-service/src/config.ts`, `lib/scoring-prompts.json`, `components/analysis/aspect-derivations.tsx`.*


### 13.8 Jawaban model dipakai ulang dari run terakhir posisi

Sebelum memanggil Gemini untuk seorang kandidat (Jalur B), mesin memeriksa **run AHP + TOPSIS terakhir yang selesai pada posisi yang sama**. Bila run itu sudah menanyakan pertanyaan yang **persis sama** tentang kandidat tersebut, jawabannya dipakai ulang dan model tidak dipanggil. Masukan yang sama dengan begitu selalu menghasilkan skor yang sama, dan token grounding tidak terpakai ulang.

- "Persis sama" = kunci masukan (SHA-256) atas **seluruh** teks yang dikirim ke model kecuali nama kandidat: jenjang & jurusan kandidat, syarat pendidikan, judul posisi, tujuan jabatan, 10 tanggung jawab pertama beserta indikatornya, prompt sistem, serta model dan pengaturan grounding/temperature/topP. Bila job profile diekstrak ulang atau prompt diedit, kandidat dinilai ulang.
- Yang dipakai ulang adalah **jawaban model** (dua sub-skor, alasan, kueri, sumber). **Sumbu jenjang tetap dihitung dengan aturan run ini**, lalu skor disusun ulang.
- Exact match (Jalur A) selalu dihitung ulang (deterministik). Hasil gagal (Jalur D) **tidak pernah** dipakai ulang.
- Run yang selesai sebelum fitur ini tidak menyimpan kunci, jadi kandidatnya ditanya ulang sekali; run berikutnya baru bisa memakai ulang.
- Ringkasan per run ada di tab Konfigurasi → Education (`run_info.education.reuse`): berapa kandidat yang memerlukan model, berapa yang memakai ulang, berapa panggilan yang dilakukan. Dapat dimatikan dengan `AHP_EDUCATION_REUSE=false`.

Rincian lengkap: [`metodologi-skor-education.md`](metodologi-skor-education.md) §4.5.

---

## 14. Bobot penilaian: **Matriks Perbandingan Berpasangan (AHP)** & konsistensi

> Seluruh bagian ini tampil di tab **Konfigurasi**.

### 14.1 Enam kriteria & urutannya
Urutan kanonik (baris/kolom matriks, urutan bar bobot, urutan chip breakdown):
**technical, career, behavior, performance, hav, education**

| Kunci | Label lengkap |
|---|---|
| technical | Technical Competency Mapping |
| career | Career Relevance |
| behavior | Behavior Competency Assessment |
| performance | Performance Appraisal |
| hav | HAV Mapping |
| education | Employee Profile - Pendidikan |

### 14.2 Dari mana bobot berasal (2 tingkat)

| Urutan | Kondisi | Label sumber yang tampil |
|---|---|---|
| 1 | Template program punya **matriks perbandingan** yang valid | *"Matriks perbandingan dari Governance"* |
| 2 | Selain itu | *"Bobot bawaan sistem (program tanpa matriks AHP)"* |

> **Tingkat "Kriteria & Bobot" sudah dihapus.** Dulu ada tingkat di antara keduanya yang
> menurunkan matriks dari daftar Kriteria & Bobot program. Daftar itu adalah konfigurasi
> metode **AI Tournament** (kini sudah dihapus), sehingga suntingan yang dimaksudkan untuk mesin tersebut diam-diam
> menggeser bobot setiap run AHP + TOPSIS program yang sama — dan program yang daftarnya
> kebetulan tidak memuat satu aspek mendapat campuran bobot yang lain lagi. Sekarang run tanpa
> matriks selalu memakai bobot bawaan yang sama, jadi hasil antar-program sebanding. Run yang
> selesai sebelum perubahan tetap menyimpan sumber `criteria-weights` pada catatannya sendiri
> dan ditandai *(aturan lama)* di layar Konfigurasi Run.
>
> Langkah kedua menyusul di `drizzle/0074`: kolom bobot pada daftar kriteria dihapus seluruhnya,
> dan AI Tournament ikut memakai kedua tingkat di atas. Tidak ada lagi panel bobot selain AHP.
> AI Tournament sendiri dihapus pada November 2026 (`drizzle/0097_remove_llm_tournament.sql`).

**Bobot bawaan sistem:** behavior **35**, technical **25**, hav **20**, performance **10**, career **5**, education **5** (total 100). Karena tidak ada program yang dikirim dengan matriks, inilah konfigurasi yang sesungguhnya berlaku — bukan sekadar cadangan. Satu sumber angka: `DEFAULT_ASPECT_WEIGHTS` (`lib/scoring-criteria.ts`), disalin ke `DEFAULT_WEIGHTS` di scoring-service dan dipakai sebagai titik awal editor matriks AHP.

**Daftar kriteria program kini hanya deskriptif.** Ia tidak punya editor di Tata Kelola dan tidak dibaca mesin mana pun: AHP + TOPSIS selalu menilai keenam aspek, dan bobotnya hanya dari matriks atau bobot bawaan. Dulu nama kriteria dipetakan ke kunci aspek (`Technical Competency Mapping → technical`, dst.) untuk memutuskan aspek apa yang dinilai AI Tournament; pemetaan itu ikut dihapus bersama metodenya. Run lama tetap menyimpan daftar kriterianya di `config_snapshot`.

Pada tingkat 2 dan 3, matriks dibangun dari vektor bobot: `a_ij = w_i / w_j` — matriks **konsisten sempurna** (CR = 0 secara konstruksi). Vektor tidak perlu berjumlah 100; hanya rasionya yang dipakai.

### 14.3 Rumus vektor prioritas (bobot yang tampil sebagai persen)

**Metode rata-rata geometrik (BUKAN eigenvector sejati):**
```
g_i = ( Π_j a_ij )^(1/n)          dengan a_ij ≤ 0 diganti 1e-9
w_i = g_i / Σ_k g_k               Σ w = 1
```
Ditampilkan `(w × 100)` dengan 1 desimal; lebar bar = `round(w × 100)%`.
Deskripsi di layar: *"Vektor prioritas hasil rata-rata geometrik tiap baris matriks, dinormalisasi hingga totalnya 100%"*.

> Persentase yang tampil **bukan** bobot mentah 25/10/… melainkan vektor prioritas hasil matriks.

### 14.4 Koefisien Kelayakan Bobot (konsistensi)

```
λ maks = (1/n) × Σ_i [ (A · w)_i / w_i ]
CI     = (λ maks − n) / (n − 1)          untuk n > 1, selain itu 0
RI     = tabel Saaty berdasarkan n
CR     = CI / RI                          (0 bila RI = 0)
Verdikt: TIDAK konsisten bila CR > 0,1
```
Tabel Random Index Saaty (indeks = n): `n=1:0, 2:0, 3:0.58, 4:0.9, 5:1.12, 6:1.24, 7:1.32, 8:1.41, 9:1.45, 10:1.49`; n > 10 → 1.49. **Untuk 6 kriteria, RI = 1.24.**

Format tampilan: λ maks & CI 4 desimal, RI 2 desimal, CR 4 desimal.

**Kondisi:**
- λ maks dihitung dari vektor rata-rata geometrik, jadi λ maks/CI/CR adalah **aproksimasi berbasis rata-rata geometrik**, bukan eigenvector sejati.
- Untuk matriks yang dibangun dari vektor bobot tanpa pembulatan (bobot bawaan sistem, `pairwiseFromWeights`), λ maks = n = 6 persis → **CI = 0, CR = 0**. Matriks yang diisi dari editor Tata Kelola tidak lagi demikian: semua penulisnya (Urutan, Slider, Berpasangan, "Atur Bobot AHP") membulatkan ke skala Saaty, sehingga CR-nya kecil tetapi umumnya bukan 0 (docs/ahp-input-sync.md).
- **CR > 0,1 → peringkat TETAP dihitung** (run tidak dibatalkan), tetapi ditandai badge merah *"TIDAK konsisten — bobot perlu ditinjau"* + peringatan bahwa perbandingannya saling bertentangan (A>B, B>C, tetapi C>A), dengan saran memperbaiki di Governance.
- **Menyimpan template di Governance DITOLAK** bila matriksnya berisi nilai di luar skala Saaty, tidak resiprokal, atau ber-CR > 0,1 (`validateAhpPairwise`), dan **sesi scoring baru tidak dapat dimulai** dari program yang matriks tersimpannya gagal pemeriksaan itu. Mesin scoring sendiri tidak menolak: bila matriks seperti itu tetap sampai ke run (data lama), run mencatat `run_info.ahp.inputCheck` dan lembar AHP trace menampilkannya sebagai penanda. Bobot bawaan sistem selalu ditandai *wajar*, karena dibentuk dari vektor bobot, bukan dari penilaian pakar.
- λ maks dan CI bisa kosong (`—`) pada run lama, tetapi RI dan CR tetap dihitung/ditampilkan (RI dihitung ulang di sisi tampilan dari jumlah kriteria).

### 14.5 Cara menulis nilai matriks di layar
```
nilai ≤ 0 atau tidak valid → "—"
nilai ≥ 0.999             → ditulis bulat / 2 desimal   (mis. "5")
nilai < 0.999             → ditulis pecahan "1/{n}"     (mis. 0.2 → "1/5")
```
Warna sel: diagonal abu, nilai > 1 hijau tebal, nilai < 1 merah.

### 14.6 Skala Saaty & dua mode editor (Governance)

Pilihan nilai: **9** (mutlak lebih penting), **7** (sangat lebih penting), **5** (lebih penting), **3** (sedikit lebih penting), **1** (sama penting), dan kebalikannya 1/3, 1/5, 1/7, 1/9. Editor menjaga resiprositas: mengisi `a_ij` otomatis mengisi `a_ji = 1/a_ij`.

- **Mode Sederhana**: slider poin 1–10 per kriteria (tengah/default 5) → matriks dibangun dari rasio bobot → **CR selalu 0**. Aktivasi pertama mengisi semua poin = 5 → matriks semua-1 → bobot merata **16,7%** per kriteria.
- **Mode Berpasangan (advanced)**: mengisi rasio Saaty langsung. Matriks dibuka di mode advanced bila CR > 0,01.
- Kedua mode menyimpan bentuk yang sama.

### 14.7 Validasi matriks
Diterima bila: berbentuk persegi n×n, setiap elemen berupa angka berhingga dan **> 0**. **Resiprositas dan diagonal = 1 TIDAK diperiksa** — matriks non-resiprokal tetap lolos dan tetap menghasilkan bobot. Bila kosong, bobot diturunkan dari kriteria saat scoring.

### 14.8 Badge asal konfigurasi yang tampil

| Badge | Arti |
|---|---|
| **Tersimpan pada run ini** (hijau) | Matriks & urutan kriteria memang tersimpan pada run (keduanya harus berukuran 6) |
| **Direkonstruksi dari template program saat ini** (kuning) | Run tidak menyimpannya (run lama) — **bisa berbeda dari yang benar-benar dipakai run** |
| **Tidak tersedia** (abu) | Tidak tersimpan dan tidak bisa direkonstruksi; bobot yang dipakai run tetap ditampilkan |

### 14.9 Kriteria yang **dibuang** & redistribusi bobot ("kolom Efektif")

Hanya **tiga** kriteria yang bisa dibuang:

| Kriteria | Kondisi pembuangan | Alasan yang ditampilkan |
|---|---|---|
| **technical** | Tidak ada acuan kompetensi sama sekali | *"Tidak ada acuan kompetensi untuk posisi target (job profile, posisi, incumbent, dan pemegang posisi kosong)."* |
| **career** | Status posisi target ≠ `ok` **dan** tidak ada acuan kompetensi untuk fallback | *"Posisi target tidak punya dokumen job profile maupun acuan kompetensi…"* |
| **education** | **SETIAP** kandidat berstatus "tidak tersedia" | *"Tidak satu pun kandidat dapat dinilai pendidikannya…"* |

**behavior, performance, dan hav TIDAK PERNAH dibuang.**

```
kriteria aktif = 6 kriteria minus yang dibuang
   (pengaman: bila SEMUA akan dibuang, set penuh dipakai kembali)
bobot efektif  = bobot kriteria aktif / Σ bobot kriteria aktif
   (bila Σ ≤ 0 → merata 1/jumlah kriteria aktif); dibulatkan 6 desimal
kriteria yang dibuang → bobot efektif 0
```
Alasan desain: kolom mati yang seluruhnya nol akan tetap **memakan jatah bobot** dan menyeret seluruh skor turun tanpa memisahkan siapa pun.

Di layar: kriteria yang dibuang **dicoret** dengan bar abu; muncul kolom kanan **"Efektif"**; kotak kuning *"{N} kriteria dikeluarkan dari matriks TOPSIS — bobotnya dibagi ulang ke kriteria yang tersisa (kolom kanan), bukan dibiarkan bernilai nol"*; dan baris *"Kriteria aktif dalam TOPSIS ({n}): … — semuanya diperlakukan sebagai kriteria benefit (makin tinggi makin baik)."*
Kolom "Efektif" hanya ditampilkan bila ada kriteria yang dibuang.

*Catatan teknis: `lib/ahp.ts`, `scoring-service/src/ahp.ts`, `scoring-service/src/ahp-topsis-engine.ts`, `lib/program-actions.ts`, `lib/program-defaults.ts`, `components/governance/governance-ahp-editor.tsx`, `components/analysis/run-configuration-panel.tsx`.*

---

## 15. Cara peringkat dihitung: **TOPSIS**

### 15.1 Matriks keputusan
Baris = kandidat, kolom = **kriteria aktif**. Isi sel = skor aspek 0–100 (Technical bisa >100 dan **tidak dipangkas** sebelum masuk). Semua kriteria bertipe **benefit** (makin tinggi makin baik) — tidak ada kriteria "cost".

### 15.2 Lima langkah

```
1. Normalisasi vektor per kolom:
      r_ij = x_ij / sqrt( Σ_i x_ij² )          (penyebut minimal 1e-9)

2. Pembobotan:
      v_ij = w_j × r_ij                        (w = bobot efektif, Σ w = 1)

3. Solusi ideal (semua kriteria benefit):
      A⁺_j = max_i v_ij      A⁻_j = min_i v_ij

4. Jarak Euclidean:
      D⁺_i = sqrt( Σ_j (v_ij − A⁺_j)² )
      D⁻_i = sqrt( Σ_j (v_ij − A⁻_j)² )

5. Kedekatan:
      C_i = D⁻_i / (D⁺_i + D⁻_i)               (0.5 bila keduanya 0)
```
`D⁺` dan `D⁻` disimpan dengan 6 desimal sebagai jejak audit, **tidak ditampilkan di UI mana pun**, dan hanya disimpan untuk finalis.

### 15.3 Sifat penting: **relatif terhadap peserta run**

- Normalisasi kolom **dan** solusi ideal/anti-ideal diturunkan dari kumpulan kandidat pada run itu.
- **Menambah atau mengeluarkan satu kandidat mengubah skor SEMUA orang**, walaupun skor aspek tiap orang tidak berubah. Ini perilaku metode, bukan kesalahan — karena itu panel Pergeseran Peringkat mencatat perubahannya.
- Kolom yang seluruhnya nol → norma kolom dipaksa 1e-9 → semua nilai 0 (tidak menghasilkan nilai tak valid), tidak memisahkan siapa pun, tetapi tetap memakai porsi bobotnya (karena itu ada mekanisme pembuangan kriteria).
- Aspek dengan variasi nol di seluruh pool (mis. semua HAV 60) menyumbang jarak nol ke A⁺ maupun A⁻.

### 15.4 Pemotongan finalis
```
target finalis = min( target finalis sesi , jumlah kandidat yang dinilai )
   (bila target tidak diset / 0 → semua kandidat menjadi finalis)
peringkat = urutan closeness MENURUN, TANPA tie-break eksplisit
```
Target bawaan template sistem = **10**. Sebelum menulis hasil, hasil lama run itu dihapus lebih dulu (membersihkan percobaan yang terputus).

### 15.5 Varian khusus untuk PA
Aspek Performance Appraisal memakai **TOPSIS absolut-dinamis** yang berbeda: jangkarnya **angka absolut** (bukan turunan himpunan), bobot per slot mencerminkan kebaruan, dan tidak ada normalisasi per kolom. Karena itu **skor PA sebanding antar-run**, berbeda dari skor akhir. (Detail di Bab 11.)

*Catatan teknis: `scoring-service/src/topsis.ts`, `scoring-service/src/ahp-topsis-engine.ts`.*

---

## 16. **Insight**, Keunggulan, Kebutuhan Pengembangan, dan Rekomendasi

### 16.1 Blok "Insight" (kotak kuning berikon bohlam)

Kalimat deterministik tanpa AI:
> *"Peringkat #N berdasarkan metode AHP + TOPSIS dengan closeness coefficient 0.XXXX (semakin mendekati 1 semakin dekat ke solusi ideal). Aspek terkuat: … Aspek yang perlu dikembangkan: … Seluruh skor aspek dihitung secara deterministik (BERT similarity, aturan peringkat, dan TOPSIS) sehingga hasil dapat direproduksi."*

- Menyebut **2 aspek tertinggi** dan **2 aspek terendah** beserta skornya; closeness ditulis 4 desimal.
- **Narasi memakai skor aspek MENTAH (0–100), bukan kontribusi terbobot** — jadi "aspek terkuat" tidak memperhitungkan bobot AHP-nya.


### 16.2 Ambang narasi mesin (AHP)

| Daftar | Ambang | Maksimum butir |
|---|---|---|
| Kekuatan | skor aspek **≥ 70** (urut menurun) | 4 |
| Kelemahan | skor aspek **< 50** (urut menaik) | 3 |
| Rekomendasi | skor aspek **< 60** (urut menaik) | 4 |

Teks bawaan bila kosong: *"Profil dinilai lengkap tanpa aspek menonjol di atas ambang 70."* / *"Pertahankan kinerja dan kesiapan pada seluruh aspek."*
Alasan pendidikan hasil grounding ditambahkan ke daftar kekuatan bila skornya ≥ 70 dan slot masih tersisa.

> **Narasi templat vs narasi model.** Daftar di atas adalah narasi templat yang selalu tersimpan lebih dulu (`narrativeSource = template`). Di **mode asli**, penulis insight AHP (prompt `ahp_narrative_agent`) lalu menulis ulang ketiga daftar — Keunggulan Kompetitif, Kebutuhan Pengembangan, dan Arahan Langkah Suksesi & Penugasan — untuk setiap baris hasil (`narrativeSource = llm`); prosa itu tidak pernah mengubah angka, dan kandidat yang panggilannya gagal tetap memakai templat. **Run mode demo tidak pernah memanggil penulis itu**: semua finalisnya memakai narasi templat, `run_info.narrative` mencatat `llmEnabled: false` dan `disabledBy: 'demo'`, dan tab Konfigurasi tidak menampilkan banner "narasi templat" untuknya.

Contoh kalimat per aspek:
- **Career** kuat: *"Jejak karier (posisi saat ini & riwayat jabatan) sangat relevan dengan profil pekerjaan posisi target — skor {n}/100."*; lemah: *"Relevansi jejak karier … masih rendah — skor {n}/100."*; rekomendasi: *"Berikan penugasan/rotasi yang mendekatkan pengalaman kandidat ke lingkup posisi target."*
- **Behavior**: *"Hasil asesmen behavior berada pada kategori peringkat atas"* / *"…peringkat bawah atau belum tersedia"* / *"Jadwalkan (ulang) asesmen behavior dan program coaching kepemimpinan"*.
- **Performance**: *"Rekam jejak Performance Appraisal konsisten mendekati ideal (grade A/B terkini)"* / *"…masih jauh dari solusi ideal positif"* / *"Susun target kinerja terukur dan review berkala untuk memperbaiki tren PA"*.
- **HAV**: *"Posisi kuadran HAV berada di kelompok yang direkomendasikan"* / *"…kelompok prioritas rendah"* / *"Validasi ulang pemetaan HAV dan susun rencana pengembangan potensi"*.
- **Education**: *"Latar belakang pendidikan berkorelasi kuat dengan tanggung jawab pekerjaan"* / *"Korelasi … masih rendah"* / *"Dorong pendidikan lanjutan/sertifikasi yang relevan…"*.

### 16.3 Daftar yang tampil di Dossier & Komparasi

Halaman ini **hanya memakai kalimat Insight** dari mesin. Daftar **Keunggulan / Kebutuhan Pengembangan / Arahan Suksesi** **dibangun ulang di sisi tampilan**:

**Keunggulan** — bila daftar dari mesin ada dan tidak kosong → dipakai apa adanya. Bila tidak, aturan fallback (maks 3, dedupe):
- `technical ≥ 3` → *"Technical competency matches target level."*
- `behavior ≥ 3` atau rekomendasi behavior mengandung "READY" → *"Proven strong leadership behaviors."*
- disiplin `qualified` → *"Cleared the discipline filter."* (MCU tidak dipakai di sini)
- jumlah program berstatus Qualified ≥ 2 → *"Qualified for multiple pipeline pools."*
- *(dihapus)* `jobMatch ≥ 85` → *"Excellent profile-to-role match score."* — `jobMatch` hanya skor akhir dikurangi 5 (lihat §17), jadi kalimat itu tidak pernah menilai kecocokan dengan job profile.

**Kebutuhan Pengembangan** — fallback (maks 3): teks Insight (bila bukan *"Tidak ada constraint mayor."*); `behavior < 3` → *"Leadership exposure needs acceleration."*; `education < 3` → *"Educational fit lags target preference."*; ada catatan behavior → *"Behaviour competency requires follow-up."* Kosong → *"No material constraint flagged."*

**Arahan Suksesi** — per readiness:
- Short → *"Ready for direct succession (0-1 year window)."* + *"Assign as primary active successor with rotation exposure."*
- Medium → *"Candidate in readiness transition (1-2 years)."* + *"Initiate leadership development tracks and stretch goals."*
- Long → *"Pipeline placement (3-5 years timeline)."* + *"Target technical depth and divisional assignment goals."*
- Lainnya → *"Not ready for vacancy nominations."* + *"Resolve core filter failures and skill gaps first."*

**Dua catatan penting:**
1. **Bug skala:** ambang `3` dibandingkan terhadap skor **0–100**, sehingga hampir semua kandidat lolos syarat "technical ≥ 3" / "behavior ≥ 3" dan hampir tidak ada yang kena "education < 3". Fallback ini praktis selalu positif.
2. **Aturan "Qualified for multiple pipeline pools." adalah aturan MATI** — daftar program pada profil kandidat selalu kosong di halaman ini, sehingga syarat ≥ 2 tidak pernah terpenuhi.
3. Kalimat fallback berbahasa **Inggris**, sedangkan narasi mesin berbahasa Indonesia. Karena mesin AHP selalu menyimpan narasi (templat atau tulisan model), fallback jarang terpakai.

*Catatan teknis: `scoring-service/src/ahp-topsis-engine.ts`, `scoring-service/src/scoring-engine.ts`, `lib/analysis-utils.ts`, `components/analysis/diagnostic-dossier.tsx`.*

---

## 17. **Quality Score** dan **Match Fit / Job Match** — dihapus dari tampilan dan ekspor

```
Job Match (Match Fit) = min( 95 , max( 30 , Skor akhir − 5 ) )
Quality Score         = round( Skor akhir × 0.55 + Job Match × 0.45 )
```

- Job Match ditulis oleh mesin ke `analysis_results.details`. Asalnya angka pengganti dari data contoh prototipe.
- Quality Score dulu dihitung di sisi tampilan.
- **Keduanya murni turunan aritmetik dari skor akhir — bukan pengukuran.** Untuk skor 35–100, Quality Score = Skor akhir − 2,25 (dibulatkan); di bawah 35 Job Match terkunci di 30, sehingga Quality Score justru **lebih tinggi** dari skor akhir (skor 20 → Quality 25).
- Nama "Job Match" menjanjikan kecocokan dengan job profile, padahal yang mengukurnya adalah **Career Relevance** (`scoreBreakdown.career`, hanya AHP + TOPSIS). Pengguna membandingkan kolom Job Match di ekspor dengan skor karier di layar dan wajar menemukan angka yang berbeda.

**Status sekarang:** tidak lagi tampil atau diekspor di mana pun — tile di Diagnostic Dossier dihapus, metrik di Komparasi dihapus, *Avg Quality* di Peta Orbit diganti *Avg Score* (rata-rata skor akhir), kolom ekspor Excel diganti *Career Relevance*, dan baris "Job Match" di konteks AI Assistant dihapus. Field `jobMatch` tetap ada di data run yang tersimpan (run selesai tidak boleh diubah) dan tetap ditulis mesin, tetapi tidak dibaca.

*Catatan teknis: `scoring-service/src/ahp-topsis-engine.ts`, `lib/talent-data.ts` (`PositionCandidate.jobMatch`, `@deprecated`), `lib/analysis-utils.ts`.*

---

## 18. **Diagnostic Dossier** (kartu kandidat di tab Analisis Visual)

### 18.1 Header, medali peringkat, gauge

- Peringkat pada medali = posisi kandidat di daftar + 1.
- Badge `{readiness} · {estimasi waktu}`.
- Gauge lingkaran: `Skor = round(skor akhir)`; busur diisi sebanding `skor/100` (dipotong 0–100), dianimasikan 1,1 detik.

### 18.2 Blok "Breakdown Kompetensi Evaluasi"

Baris yang dirender: **Technical Competence**, **Leadership behavior review**, **Career relevance (AHP+TOPSIS)**, **HAV Kuadran**, **Performance appraisal logs**.
- Tiap baris menampilkan `{round(skor)}%` + bar.
- **Baris HAV tidak memakai skor** — menampilkan `#{nomor kuadran + nama + kategori}` tanpa bar.
- Baris **Career hanya muncul** pada run AHP + TOPSIS.
- **Education TIDAK ditampilkan pada blok ini** (hanya di chip, radar, dan ekspor).

### 18.3 Behavior Assessment
Menampilkan rekomendasi asesmen (dari data kandidat, fallback ke profil) + catatan. Bila rekomendasi kosong/`-` **dan** tidak ada catatan → blok tidak dirender; bila rekomendasi kosong tetapi ada catatan → badge *"Tidak ada data asesmen"*.

### 18.4 Kompetensi teknis kandidat
Hanya dirender bila profil punya daftar kompetensi (tinggi maksimum, bisa di-scroll).
- Proficiency yang ditampilkan = level **yang dicapai**, fallback level target.
- Kolom target = level yang dituntut.
- **Gap** hanya ditampilkan bila berupa angka dan ≠ 0; hijau bila > 0, merah bila < 0.

### 18.5 Grafik Riwayat Performance Appraisal (3 tahun)

```
Data dibaca dari CSV grade PA profil kandidat.
hasPaData = CSV ada, bukan "-", dan MENGANDUNG KOMA
Pemetaan tampilan: A=5, B=4, C=3, D=2, E=1 ; default 3 (C)
Baris tahun: tahun−3 → S2 = slot[4], S1 = slot[5]
             tahun−2 → S2 = slot[2], S1 = slot[3]
             tahun−1 → S2 = slot[0], S1 = slot[1]
Sumbu Y: rentang 0.5–5.5, label ['', E, D, C, B, A]
```
Judul grafik berlabel **(data terkini)**: grafik membaca grade PA kandidat **hari ini**, bukan grade yang dipakai run, sedangkan skor PA di blok Breakdown adalah skor run (Bab 7).

**Peringatan:** bila CSV grade PA **tidak mengandung koma**, SELURUH grafik memakai default `C`/3 — grafik tetap digambar dan bisa disalahartikan sebagai data nyata. Grafik selalu memplot **3 tahun terakhir relatif tahun berjalan** (jam sistem saat render).

> Skala tampilan grafik (A=5…E=1) **berbeda** dari skala yang dipakai menghitung skor PA (A=4…E=0).

### 18.6 Riwayat pekerjaan
Diurutkan menurun berdasarkan tanggal akhir (atau tanggal mulai bila akhir kosong). Tanggal dengan tahun ≥ 9999 dirender **"Sekarang"**. Badge **"Non-Primary"** untuk baris yang bukan posisi primer.

### 18.7 Riwayat Asesmen (tabel di dossier) — kolom yang selalu kosong
Tabel ini **disintesis** dari CSV grade PA: 6 baris berlabel `{tahun−1} S2`, `{tahun−1} S1`, `{tahun−2} S2`, `{tahun−2} S1`, `{tahun−3} S2`, `{tahun−3} S1`.
- Kolom **Teknis** dan **Perilaku** selalu `-` (tidak pernah diisi).
- Kolom readiness pada tabel ini selalu `Medium` (placeholder).
- Label tahun diturunkan dari **jam sistem saat halaman dirender**, sedangkan isi CSV dari **saat sinkronisasi** — bila sinkronisasi terakhir tahun lalu, label dan isi bisa bergeser satu tahun.

### 18.8 Kandidat dari business unit lain
Profil kandidat hanya dimuat untuk **tenant aktif**. Kandidat lintas business unit pada run lintas-BU **tidak punya profil**, sehingga: dossier (kompetensi teknis, grafik PA, riwayat jabatan, pendidikan) kosong, kolom Komparasi kosong, dan konteks AI Assistant kehilangan data profilnya. **Tidak ada penanda apa pun di UI untuk degradasi ini.**

*Catatan teknis: `components/analysis/diagnostic-dossier.tsx`, `lib/pulse-data.ts`, `lib/position-detail-actions.ts`.*

---

## 19. Tab **Komparasi**

### 19.1 Radar (spider chart)
Sumbu, semua dibulatkan, skala 0–100:
**Technical · Behavior · HAV (SKOR, bukan nomor kuadran) · Performance · Education · Career Relevance**

- Maksimum **5 kandidat** dibandingkan sekaligus.
- Warna seri: kuning, biru langit, hijau zamrud, ungu, merah mawar.
- Sumbu **Career Relevance hanya digambar bila SEMUA kandidat yang dibandingkan punya nilai career**.
- Daftar pembanding otomatis diisi peringkat 1 & 2 setiap kali daftar kandidat atau run berubah.

### 19.2 Rail "Peringkat Skor"
Diurutkan skor menurun; mahkota untuk peringkat 1; bar + teks `{skor}%`.

### 19.3 Penanda bintang "unggul per aspek"
Aspek yang dibandingkan: core (skor akhir), technical, behavior, performance, education, career, service (masa kerja). Kartu tiap kandidat menampilkan satu indikator utama, **Core**; Quality dan Match dihapus (§17).
```
untuk tiap aspek: cari nilai maksimum; bila HANYA SATU kandidat mencapainya → dia diberi bintang
bila SERI → tidak ada bintang untuk aspek itu
```
- Blok **Executive Recommendation** hanya muncul bila ≥ 2 kandidat dibandingkan: *"{nama} memimpin komparasi dengan Weighted Core Score tertinggi ({n}%)…"*

### 19.4 Kartu "Benchmark · Pejabat Saat Ini"
- Incumbent dicari dari nama & NIK pemegang jabatan pada posisi; NIK dicocokkan baik apa adanya maupun setelah ditambahi nol di depan (5 digit). Pencocokan persis diprioritaskan, lalu varian ber-nol, lalu ID (deterministik).
- Menampilkan: level grade, masa kerja, pendidikan · jurusan, kuadran HAV, disiplin, MCU, behavior, dan daftar kompetensi teknis incumbent (level dicapai / level target + skor).
- Tanpa NIK → hanya nama.
- Profil tidak ditemukan → *"Data profil incumbent tidak tersedia di database kandidat — hanya nama & ID pegawai yang diketahui."*
- Kandidat yang sudah dihapus (soft-delete) **dikecualikan di sini** agar incumbent tidak mendapat benchmark basi.
- **Incumbent tidak ikut di radar/leaderboard** — hanya panel referensi.

*Catatan teknis: `components/analysis/multi-comparison.tsx`, `lib/pulse-data.ts`.*

---

## 20. **Peta Orbit Suksesi** (tab Analisis Visual)

### Apa artinya
Posisi target di pusat; kandidat mengorbit; makin tinggi skor makin **dekat ke pusat**; cincin menandai zona kesiapan.

### Rumus posisi
```
zona   = zona yang tingkat kesiapannya sama dengan kandidat (tak dikenal → zona "Not Ready")
span   = max(1, zona.max − zona.min)
t      = clamp( (skor − zona.min) / span , 0 , 1 )
radius = zona.outer − t × (zona.outer − zona.inner)     ← skor makin tinggi → radius makin kecil
sudut  = dibagi rata BERDASARKAN PANJANG BUSUR pada elips, mulai dari atas (−90°)
```

| Zona | Label | radius dalam | radius luar | rentang skor |
|---|---|---|---|---|
| Short | **Ready Now** | 11 | 18 | 80 – 100 |
| Medium | **1–2 Tahun** | 20.5 | 27 | 65 – 80 |
| Long | **3–5 Tahun** | 29.5 | 35 | 50 – 65 |
| Not Ready | **Not Ready** | 37.5 | 42 | 0 – 50 |

Konstanta lain: batas cincin `[19.25, 28.25, 36.25, 43.5]`; eksentrisitas maks 1.75; radius hub 48 px, radius node 24 px, ruang label 34 px, padding tepi 10 px, jarak aman hub 14 px; sampel busur 1440; keliling cincin skor pada avatar = `2π × 26`. Zoom 0,5–2,5 (roda tetikus × 0,0015; tombol ±0,25).

### Kondisi & jebakan

- **Hanya 10 kandidat teratas yang digambar.** Kandidat peringkat 11 dan seterusnya **tidak muncul**, sedangkan footer *"Shortlist Pool"* menghitung **seluruh** kandidat run.
- **Ambang 80/65/50 di-hardcode** pada peta ini dan **tidak dibaca dari konfigurasi Governance**. Bila ambang diubah (mis. Short jadi 75), badge readiness kandidat berubah tetapi **posisi orbitnya tetap** — kandidat bisa ber-badge "Short" namun digambar di cincin Medium. Label zona ("Ready Now", "1–2 Tahun", "3–5 Tahun") juga hardcode, terpisah dari ETA di konfigurasi.
- `Avg Score` = rata-rata skor akhir **seluruh** kandidat run (bukan hanya 10 yang digambar), dibulatkan. (Dulu `Avg Quality`, rata-rata Quality Score — lihat §17.)
- Hub menampilkan *"{N} Ready"* = jumlah Short + Medium dari **run TERAKHIR posisi**, bukan run yang sedang dipilih.
- Bila area plot terlalu pendek, radius dalam dipaksa 0,42 × radius luar agar band tidak terbalik, dan diameter hub dikecilkan.
- Node yang di-hover/dipilih diberi prioritas; node lain diredupkan.
- Warna: Short `#10b981`, Medium `#f59e0b`, Long `#0ea5e9`, Not Ready `#f43f5e`.

*Catatan teknis: `components/analysis/talent-network-map.tsx`.*

---

## 21. Tab **Peta Job Family** — jarak & kedekatan kandidat ke posisi target

### 21.1 Dari mana peta berasal
Peta berasal dari **satu run topic modelling terbaru yang berstatus selesai** — **bukan** properti run scoring. Titik = job profile; koordinat = hasil proyeksi UMAP; warna = job family (topik); ukuran titik ∝ jumlah incumbent profil itu.

Proyeksi ke kanvas (760 × 440 px, padding 30):
```
x_layar = PAD + ((x − minX)/spanX) × (W − 2·PAD)
y_layar = PAD + (1 − (y − minY)/spanY) × (H − 2·PAD)     ← sumbu Y DIBALIK
radius titik = 3.5 + min(6, jumlahIncumbent × 1.3)        (+2 saat hover)
opacity: noise (topik −1) 0.3 · se-family dengan target 0.85 · lainnya 0.5
```
Koordinat target ikut dimasukkan ke perhitungan batas agar tidak keluar bingkai. Finalis yang berbagi satu job profile disebar melingkar (radius 20 bila ≤ 4 orang, 26 bila lebih).

Warna: 12 warna kategorikal berdasarkan urutan ukuran topik (menurun); topik noise `#94a3b8`; penanda target `#ea580c`.

### 21.2 Rumus jarak & kedekatan

```
distance  = jarak Euclidean di ruang UMAP 2-D antara titik kandidat dan titik target
diagonal  = panjang diagonal kotak pembatas SELURUH titik peta (bukan jarak maksimum antar-titik)
proximity = clamp( (1 − distance / diagonal) × 100 , 0 , 100 )
sameFamily = target punya topik ? (topik kandidat === topik target) : tidak diketahui
distanceRank = urutan menaik distance (1 = terdekat)
```
Format: jarak 2 desimal (`{n} unit` / `{n} unit UMAP`), kedekatan tanpa desimal (`{n}%` / `{n}% dekat`).

### 21.3 Empat StatChip di atas peta
`Job Family` = jumlah topik non-noise · `Job Profile` = jumlah titik · `Finalis Terpetakan` = jumlah finalis yang punya titik (dengan hint "dari {total finalis}") · `Job Family Target` = label topik target atau `—`.

### 21.4 Kondisi & jebakan

- **Finalis ditempatkan pada job profile yang dipasangkan ke POSISI SAAT INI-nya** lewat tabel pemasangan job family — **bukan hasil scoring**.
- **Tiga sebab finalis tidak terpetakan:** `no-match` (tidak ada baris pemasangan), `not-in-map` (profil tidak ikut run topik terakhir), `no-coords` (ikut run tetapi koordinatnya kosong). Dua kelompok pertama ditampilkan di blok kuning terpisah dengan tautan ke halaman pemasangan job profile.
- **Dua banner kuning:** (a) posisi target belum berpasangan dengan satu job profile → titik acuan tidak digambar; (b) profil target belum ikut run topic modelling terakhir → jarak tidak dapat dihitung.
- **SELURUH kandidat run diplot** (bukan top-10) — berbeda dari Peta Orbit.
- **Resolusi target di peta ini BERBEDA dari resolusi target aspek Career.** Peta memakai tiga tingkat (pemasangan lewat incumbent → pemasangan lewat posisi master → pencocokan judul dengan substring dua arah, nama terpanjang menang). Aspek Career memakai rantai berbeda (kode berkas → pemasangan → judul → embedding > 98% → kode posisi incumbent → dokumen sintetis). **Marker oranye karena itu bisa menunjuk job profile lain daripada dokumen yang dipakai menghitung skor Career** — jarak di peta tidak wajib selaras dengan skor Career.
- Badge `match: {tipe} {n}%` menampilkan asal pemasangan posisi ↔ profil.
- Peta ini **lintas business unit** (tidak difilter tenant).
- Bila belum ada run topik yang selesai / titik kosong / skema belum dimigrasi → seluruh peta diganti kartu pesan.

### 21.5 Parameter pipeline yang membentuk koordinat
Koordinat dihasilkan pipeline BERTopic (UMAP → HDBSCAN → c-TF-IDF) dengan parameter bawaan: UMAP `nNeighbors 15, nComponents 5, minDist 0.0, metric cosine`; HDBSCAN `minClusterSize 5, clusterSelectionMethod eom, epsilon 0.0`; tokenisasi `n-gram 1–2, stopwords indonesian`; c-TF-IDF `topNWords 10`; `randomState 42`; embedding 768 dimensi, batch 32.

> **Menjalankan ulang "Bangun Peta Job Family" MENGUBAH koordinat**, sehingga jarak/kedekatan/peringkat jarak pada laporan run yang SAMA bisa berubah tanpa run scoring disentuh sama sekali. Menambah/menghapus job profile juga menggeser seluruh proyeksi.

*Catatan teknis: `lib/position-family-map-actions.ts`, `components/analysis/job-family-position-map.tsx`, `lib/job-family/config.ts`, `lib/job-family-config.json`.*

---

## 22. Tab **Konfigurasi** — dari mana angka run berasal

### 22.1 Ringkasan Run
KeyVal: Label / Posisi / Program / Mulai / Selesai / **Mode Eksekusi** (`Perhitungan deterministik (satu tahap)`), plus banner asal run:

| Jenis run | Banner |
|---|---|
| **full** | (tidak ada banner) |
| **augment** (tambah kandidat) | *"{N} kandidat dinilai baru, {M} kandidat memakai nilai aspek run dasar, lalu TOPSIS dihitung ulang atas gabungannya."* |
| **exclude** (peringkat ulang) | *"…peringkat ulang setelah pengecualian dari run {label}. Tidak ada aspek yang dinilai ulang — {M} kandidat memakai nilai aspek run dasar[, {K} kandidat dinilai ulang karena tidak punya snapshot] — yang dihitung ulang hanya TOPSIS, dengan {X} kandidat dikeluarkan…"* |

Bila run dasar milik business unit lain atau sudah dihapus, yang tampil adalah ID run dasar mentah.

### 22.2 Penyaringan Kandidat (corong)

| Stat | Isi | Hint |
|---|---|---|
| **Lolos gerbang awal** | jumlah kandidat sebelum hard filter | *"Setelah rentang level & incumbent"* |
| **Lolos filter program** | jumlah setelah hard filter | *"{N} kandidat gugur"* |
| **Dinilai (TOPSIS)** | jumlah yang masuk matriks keputusan | *"Masuk matriks keputusan"* |
| **Finalis** | jumlah baris hasil | *"Target {N} finalis"* |

Ditambah: **Rentang Level (Grade)** (`{namaMin} – {namaMax} ({idMin}…{idMax})` atau *"Tanpa batas level"*), **Business Unit Pool**, **Incumbent (dikecualikan)** (atau *"Posisi tanpa pemegang tercatat"*).

### 22.3 Gerbang pool yang sebenarnya (urutan)

1. **Cakupan business unit** — tenant aktif **selalu ikut** dan berada di urutan pertama; unit lain dapat ditambahkan.
2. **Kandidat aktif saja** — kandidat yang sudah dihapus (soft-delete) tidak pernah masuk pool.
3. **Eksklusi incumbent** — kandidat dibuang bila NIK-nya beririsan dengan NIK pemegang jabatan (dicocokkan apa adanya, hanya digit, tanpa nol depan, dan setelah ditambah nol jadi 5 digit) **atau** namanya sama persis setelah dinormalisasi (huruf kecil, spasi dirapatkan). Pencocokan nama bukan fuzzy → homonim bisa ikut terbuang.
4. **Rentang grade** — angka grade diambil dari **digit pertama** teks grade (`"5a"` → 5, `"Level 12"` → 12). Lolos bila `grade ≥ min` dan `grade ≤ max`. **Bila gerbang aktif dan grade kandidat tidak berisi angka sama sekali → kandidat DIBUANG.** Bila min & max keduanya kosong → gerbang dilewati.
5. **Hard filter program** (bila template mengaktifkannya).

Pool kosong setelah gerbang → *"Tidak ada kandidat aktif untuk tenant ini."*
Semua kandidat gugur hard filter → *"Semua kandidat gagal aturan filter program \"X\". Longgarkan aturan filter atau nonaktifkan penerapan hard-filter."*

### 22.4 Pohon Aturan Filter

- **Dibaca DARI TEMPLATE SAAT INI, bukan snapshot run.** Bila template disimpan ulang setelah run selesai → peringatan kuning *"Template program disimpan ulang setelah run ini selesai ({tanggal})…"* Aturan yang ditampilkan adalah konfigurasi sekarang; daftar kandidat gugur tetap hasil run yang sebenarnya.
- Badge: **"Hard filter — kandidat gagal tidak dinilai"** vs **"Tidak ditegakkan — hanya referensi"**.
- Tanpa template → *"Run ini dijalankan tanpa template program, sehingga tidak ada aturan filter."*; tanpa aturan → *"Program ini tidak mendefinisikan aturan filter."*
- **Run turunan** → catatan bahwa penyaringan dilakukan di run dasar; daftar gugur ada di run dasar.

**Kosakata yang tampil:**

| Field | Label |
|---|---|
| disciplineStatus | Status Disiplin |
| mcuStatus | Status MCU |
| performanceGrade | Performance Appraisal |
| havQuadrant | HAV Quadrant |
| behaviorRecommendation | Behavior Recommendation |
| yearsExperience | Masa Kerja |
| education | Pendidikan |

| Operator | Label |
|---|---|
| eq / neq | sama dengan / tidak sama dengan |
| in / notIn | termasuk / tidak termasuk |
| gte / lte / gt / lt | ≥ / ≤ / > / < |
| notExpired / isExpired | belum kadaluarsa / sudah kadaluarsa |

Nilai array ditulis dijoin koma (`termasuk fit, fit_with_note`). **Nilai disembunyikan** untuk operator kadaluarsa. Grup aturan kosong tidak membatasi apa pun (tampil `(kosong)`).

### 22.5 Cara mesin filter memperlakukan data kosong (**penting**)

Kebijakan pada jalur scoring: **"evaluate"** — field kosong **dinilai apa adanya**, bukan dilewati. Hasilnya **asimetris**:

| Data kosong | Aturan | Hasil |
|---|---|---|
| Kuadran HAV kosong | `termasuk [1,2,…]` | **GUGUR** |
| Status disiplin kosong | `termasuk [CLEAR, ST]` | **GUGUR** |
| Rekomendasi behavior kosong | `tidak termasuk […]` | **LOLOS** |
| Grade PA kosong | apa pun | disuntik `C` lalu dievaluasi |
| Masa kerja kosong | `≥ 5` | **GUGUR** (bukan angka) |

> Jadi *"kenapa orang ini gugur"* seringkali berarti **"datanya kosong"**, bukan "nilainya jelek".

Catatan lain: `eq/neq/in/notIn` adalah perbandingan **persis huruf demi huruf** tanpa normalisasi huruf besar/kecil — satu-satunya field yang dinormalisasi adalah kuadran HAV (`"Kuadran #6"` → `"6"`). Operator `sudah kadaluarsa` mengembalikan **benar** untuk nilai kosong; `belum kadaluarsa` mengembalikan **salah**. Aturan `termasuk`/`tidak termasuk` yang nilainya bukan daftar selalu gagal (menggugurkan semua orang).

### 22.6 Aturan filter bawaan tiga program sistem

**Berlaku untuk ketiganya:**
- Status disiplin **termasuk** `CLEAR`, `ST`
- Status MCU **termasuk** `fit`, `fit_with_note` — **HANYA MENANDAI, tidak menggugurkan** (`severity: "advisory"`, drizzle/0071). Lihat Bab 22.9.
- Kuadran HAV **tidak termasuk** `16` — *"Berada pada kuadran 16 (Bottom)."*
- Rekomendasi behavior **tidak termasuk** `NOT READY`, `VERY LOW`, `BELUM ADA POTENSI`

**Tambahan per program:**

| Program | PA | Kuadran HAV | Lain |
|---|---|---|---|
| **Talent Pool** | termasuk A, B | 1, 2, 3, 4, 7 | — |
| **Critical Position** | termasuk A, B | 1, 2, 3, 4, 7, 8, 13, 14 | Masa kerja ≥ 5 |
| **Emergency Position** | termasuk A, B, C | 1, 2, 3, 4, 7, 8 | — |

**Bobot kriteria bawaan:** Technical 25, Behavior 40, HAV 20, Performance Appraisal 10, Pendidikan 5. **Emergency menimpa**: Performance Appraisal 20, Technical 30, Pendidikan 0.
Target finalis ketiga template = **10**.

Template sistem di-seed otomatis per business unit saat daftar program pertama kali dibuka dan tenant belum punya baris apa pun.

### 22.7 Daftar "Kandidat Gugur Filter"
Alasan ditulis `{Label aturan}: {pesan}`. Untuk grup **DAN** yang gagal, hanya anak yang gagal dilaporkan; untuk grup **ATAU** yang gagal (tidak ada anak yang lolos), **semua** anaknya dilaporkan. Alasan yang kosong/placeholder (mis. hanya `": "`) dibuang; bila semuanya kosong → *"Alasan tidak tercatat."*

**Kandidat yang gugur hard-filter TIDAK PERNAH dinilai** — tidak ada baris hasil untuk mereka.

### 22.8 Sumber Acuan & Penyesuaian
- **Job Profile Posisi** = nama job profile yang dipasangkan, atau nama profil target dari diagnostik Career, atau *"Tidak ditemukan"*.
- **Acuan Kompetensi Teknis** = `{N} kompetensi (sumber: profile | critical_position | incumbent | position_aggregate | none)` + paragraf detail.
- **Skala Kemiripan Career** = `{simFloor} – {simCeil} ({alasan})`.
- **Target Kedalaman Career** = `{X} tahun · {Y} stint (sumber: pool | fixed | inherited)`.
- Blok **"Career: …"** memuat seluruh kalimat degradasi yang berlaku (lihat Bab 9). Kalimat penutup **selalu** ada: *"Similarity direntangkan ke 0..1 dengan anchor tetap {a}–{b} (cosine mentah bukan persentase). Skor = min(kedalaman tahun, kedalaman stint) × 100. …"*
- **Ambang Readiness** ditampilkan dengan badge *"Konfigurasi saat ini"* + peringatan bahwa ambang **tidak disimpan per run**.

### 22.9 Severity aturan: menggugurkan vs hanya menandai

Setiap aturan filter punya `severity`:

| severity | akibat bila gagal |
|---|---|
| `hard` (bawaan; **aturan tanpa field ini juga `hard`**) | kandidat gugur, tidak pernah dinilai, masuk daftar "Kandidat Gugur Filter" |
| `advisory` | kandidat **tetap dinilai dan masuk peringkat**; temuannya masuk daftar "Kandidat Ditandai" |

Ini berbeda dari sakelar **"Terapkan sebagai Hard-Filter"** (`enforce_filter_rules`), yang mematikan SELURUH aturan program sekaligus. Melunakkan MCU lewat sakelar itu berarti ikut melunakkan disiplin dan HAV; `severity` adalah satu-satunya cara melunakkan tepat satu aturan.

**Aturan advisory DIBUANG dari pohon sebelum penentuan kelulusan, bukan dianggap selalu lulus.** Di dalam grup `ATAU`, aturan yang selalu benar memuaskan seluruh grup dan melumpuhkan alternatif di sebelahnya. Grup yang kehilangan seluruh anaknya karena pembuangan ini menjadi kosong, dan grup kosong — `DAN` maupun `ATAU` — bernilai lulus. Kedua sifat itu dijaga oleh `scripts/verify-mcu-advisory.ts`.

Aturan dievaluasi kapan pun program punya aturan, termasuk saat `enforce_filter_rules` mati: aturan advisory tidak menggugurkan siapa pun, jadi tidak ada yang perlu dijaga, dan melewatkannya hanya akan membuang penandanya.

### 22.10 MCU: hanya menandai, bukan kriteria

Status MCU tidak menggugurkan kandidat. Aturan MCU pada ketiga program sistem bersifat `advisory` (Bab 22.9): kandidat `unfit` tetap dinilai dan masuk peringkat, dan temuannya hanya muncul di daftar "Kandidat Ditandai".

MCU **bukan** kriteria ke-7. `AHP_CRITERIA_ORDER` tetap enam, dan tidak ada data MCU yang masuk ke `analysis_results.final_score`. Dua alasan: temuan medis tidak membuat seseorang kurang kompeten, dan menambah kunci ke urutan itu akan membuat SETIAP matriks perbandingan 6x6 tersimpan gagal `isValidPairwise()` lalu diam-diam jatuh ke bobot bawaan — termasuk matriks yang di-pin run turunan.

Data MCU juga **tidak pernah dipakai menghitung ulang, mendiskon, atau menafsirkan ulang skor maupun peringkat**, tidak pula sebagai tampilan pembanding. Skor kriteria, skor akhir, peringkat, dan readiness sepenuhnya berasal dari enam aspek AHP + TOPSIS.

> **Dihapus 2026-11-05 — Keyakinan Penempatan (MCU).** Bagian ini dulu menerangkan angka kedua di samping peringkat, yaitu keyakinan bahwa penempatan bisa dijalankan, yang dinilai model bahasa dari keterangan medis dan tuntutan jabatan. Seluruh lapisan itu sudah dihapus: tabelnya (`mcu_confidence_assessments`, dijatuhkan drizzle/0095), lencana dan chip MCU pada baris peringkat beserta dialog analisisnya, tombol "Nilai keyakinan penempatan" / "Hitung ulang keyakinan", dan panel modelnya di Tata Kelola. Angka itu tidak pernah masuk skor maupun peringkat, sehingga tidak ada hasil run yang berubah. Status MCU, aturan MCU yang hanya menandai, dan keterangan MCU kandidat (Bab 29.2) tetap ada.

### 22.11 Diagnostik yang **diwarisi** dari run dasar
Pada run pengecualian yang **tidak menilai ulang kandidat mana pun**, blok Career dan Technical yang ditampilkan diambil dari **run dasar**, bukan run turunan — karena pada run turunan tidak ada penilaian yang dijalankan, sehingga diagnostik run itu menggambarkan proses kosong. Bila ada satu saja kandidat yang dinilai ulang, diagnostik run turunan yang dipakai (yang menggambarkan subset kecil itu saja).
Blok **AHP tidak pernah diwarisi** — selalu dari resolusi run itu sendiri.

*Catatan teknis: `lib/progress-running-actions.ts`, `components/analysis/run-configuration-panel.tsx`, `lib/scoring-engine.ts`, `lib/programs.ts`, `lib/program-defaults.ts`.*

---

## 23. **Mengecualikan kandidat** & **Hitung ulang peringkat**

> **Kedaluwarsa (29 Oktober 2026).** Bagian 23 dan 24 menjelaskan perilaku
> sebelum penilaian ulang disederhanakan menjadi satu mode. Kini mengecualikan
> kandidat hanyalah penandaan "Ditandai dikecualikan (tidak memengaruhi angka)"
> tanpa run baru, dan satu-satunya run turunan adalah "Tambah Kandidat
> Pembanding" yang membekukan run induknya. Perilaku terkini: bagian "Re-run
> scoring — aturan desain" di `CLAUDE.md`, `docs/alur-proses-scoring.md` (J1,
> J2), dan `docs/rerun-requirements-audit.md` §6. Teks di bawah dipertahankan
> karena run lama yang dibuat dengan mode itu masih tersimpan dan dapat dibuka.

### 23.1 Apa itu pengecualian ("tidak dipertimbangkan")

Penandaan **lunak** per run. **Run dasar tidak pernah diubah** — peringkat, skor, dan detail tetap seperti saat run selesai; ranking yang sudah selesai adalah catatan asesmen pada tanggal tertentu.

**Alasan yang tersedia:**

| Kode | Label |
|---|---|
| retired | Pensiun |
| resigned | Resign *(default pilihan di dialog)* |
| promoted | Sudah dipromosikan |
| conflict_of_interest | Konflik kepentingan |
| other | Lainnya |

**Validasi:** alasan "Lainnya" **wajib** disertai keterangan.

**Sifat:** pengecualian bersifat **per-run**, bukan per-kandidat global — mengecualikan seseorang pada run A tidak memengaruhi run B pada posisi yang sama. Membatalkan pengecualian **menghapus** barisnya (tidak ada tombstone); satu-satunya jejak historis adalah pasangan entri audit log.

### 23.2 Efek di layar

- Baris kandidat **tetap ada dengan nomor, peringkat, dan skor aslinya**, tetapi berlatar abu dengan opacity 60% dan **namanya dicoret**.
- Badge **"Dikecualikan"** dengan tooltip: `{label alasan}[ — {keterangan}][ (oleh {nama})]. Peringkat dan skor run ini tidak diubah.`
- Tombol **"Pilih Kandidat"** disembunyikan; tombol berubah menjadi **"Kembalikan"**.
- Bar kuning **ExclusionSummaryBar** di atas daftar: *"{N} kandidat dikecualikan dari hasil"* + chip nama tercoret & alasan + tombol undo per chip.
- **Yang menyaring kandidat dikecualikan hanya:** hitungan *"{N} lolos readiness"* dan tombol pilih kandidat.
- **Yang TIDAK menyaringnya:** pipeline readiness, distribusi, coverage readiness, peta job family, dan nomor urut.

### 23.3 Kapan pengecualian memicu **hitung ulang peringkat**

```
hitung ulang berjalan bila:  dicentang
```
- Checkbox *"Hitung ulang peringkat tanpa kandidat ini"* **default tercentang**, dan di-reset setiap kali kandidat berbeda dipilih.
- **Hitung ulang selalu mencakup SELURUH pengecualian yang ada pada run dasar**, bukan hanya kandidat yang baru ditandai. Mengecualikan tiga orang satu per satu bermuara pada **satu** peringkat akhir, bukan rantai tiga run turunan.
- **Penandaan di-commit lebih dulu dan tidak pernah dibatalkan** bila hitung ulang gagal — keputusan HR tidak boleh hilang karena kegagalan teknis. Kegagalan dilaporkan sebagai peringatan (toast 12 detik).

### 23.4 Pool yang dipakai saat hitung ulang

```
pool = SELURUH kandidat yang DINILAI run dasar  −  yang dikecualikan
target finalis = min( max(jumlah finalis run dasar, 1) , ukuran pool )
```
Alasan memakai seluruh pool (bukan hanya finalis yang tersisa):
1. Memeringkat hanya penyintas mempertemukan sekumpulan skor tinggi yang seragam → solusi ideal dan anti-ideal saling mendekat → koefisien kedekatan berubah makna;
2. Slot finalis yang kosong tidak akan pernah terisi → daftar hanya memendek.

**Sumber pool (`poolSource`):**

| Nilai | Kondisi | Konsekuensi |
|---|---|---|
| **pool_snapshot** | Run dasar menyimpan snapshot aspek seluruh pool | Slot finalis yang kosong **diisi dari peringkat berikutnya (backfill)** |
| **finalists_only** | Run dasar tidak menyimpan snapshot (dibuat sebelum fitur ini, atau penulisannya gagal) | **Tanpa backfill** — daftar finalis memendek; himpunan alternatif terpotong (semua skor tinggi) |

Alasan ini ditampilkan apa adanya di panel Pergeseran Peringkat.

**Degradasi lain yang tidak dilaporkan terpisah:** kandidat yang sudah dihapus atau menjadi incumbent posisi sejak run dasar akan **hilang** dari pool turunan walau tidak dikecualikan. Filter keras program (disiplin/MCU) dan rentang grade **tidak dijalankan ulang**.

### 23.5 Apa yang benar-benar dihitung ulang

| Aspek | Perlakuan |
|---|---|
| **Technical, Career, Education** | **Dipakai ulang** dari snapshot run dasar (tidak dinilai ulang) |
| **Behavior, Performance, HAV** | **SELALU dihitung ulang** untuk semua kandidat (murni pembacaan kolom kandidat) |
| **Seluruh pipeline TOPSIS** | Dijalankan ulang atas himpunan alternatif baru |
| **Bobot AHP & pemilihan kriteria aktif** | **Dihitung ulang dari template SAAT INI** |

**Konsekuensi yang harus dijelaskan ke user:**
- UI mengatakan *"tidak ada aspek yang dinilai ulang"*, tetapi Behavior/PA/HAV **membaca baris kandidat SAAT INI** — bila data HR berubah sejak run dasar, ketiga skor itu ikut berubah.
- Bila template AHP diubah setelah run dasar, **bobot pada run turunan bisa berbeda**.
- Kandidat yang **tidak punya snapshot** akan dinilai ulang penuh → nilainya bisa memakai **data HR yang lebih baru** daripada kandidat lain. Ini ditampilkan sebagai peringatan kuning tebal.
- Tolok ukur kedalaman Career **dipatok** ke run dasar (sumber `inherited`) supaya penggarisnya tidak berubah di tengah jalan.

### 23.6 Panel **"Pergeseran Peringkat"** (tab Readiness)

Hanya muncul pada run **AHP + TOPSIS hasil pengecualian**. Bila run bukan hasil pengecualian → panel tidak dirender sama sekali. Gagal memuat → panel disembunyikan (bukan menampilkan galat).

**Badge ringkasan** (hanya muncul bila > 0):
- `{N} kandidat dikecualikan`
- `{N} kandidat naik dari pool` (backfill)
- `{N} peringkat bergeser`
- `{N} readiness berubah`

**Tabel per finalis:**

| Kolom | Isi |
|---|---|
| **Peringkat** | `{peringkat lama} → {peringkat baru}`; lama kosong → `—` |
| **Δ** | `lama − baru`; > 0 = panah naik hijau; < 0 = panah turun merah; 0 = *"tetap"*; lama kosong = *"baru"* |
| **Skor** | `{skor lama} → {skor baru}` |
| **Readiness** | ditulis **merah tebal** bila berubah |

**Catatan penting:**
- Peringkat lama = peringkat di **SELURUH pool** run dasar (bukan di dalam potongan finalis).
- Tabel hanya mencakup **finalis run turunan**, bukan seluruh pool yang diperingkat ulang.
- Readiness lama **dihitung ulang** dari skor run dasar memakai **ambang saat ini** — bila ambang diubah di antara kedua run, kolom "readiness berubah" bisa menyala karena perubahan konfigurasi, bukan karena pengecualian.
- Bila run dasar tidak punya snapshot pool, semua kolom "lama" kosong, Δ berbunyi *"baru"* untuk semua orang, dan jumlah pergeseran = 0 — bukan berarti tidak ada yang bergeser, datanya memang tidak ada.
- Paragraf tetap menjelaskan bahwa **tidak ada aspek yang dinilai ulang; yang dihitung ulang hanya TOPSIS** (norma kolom + solusi ideal/anti-ideal berubah).

### 23.7 Setelah hitung ulang
- Menghasilkan **run BARU**; browser diarahkan ke run baru tersebut.
- Toast berbeda tergantung ketersediaan backfill: dengan backfill (6 detik) *"…Slot finalis yang kosong diisi kandidat peringkat berikutnya."*; tanpa backfill (12 detik) *"…run dasar tidak menyimpan snapshot seluruh pool, jadi hanya finalis tersisa yang diranking ulang."*
- Label run baru: `Re-ranking (−{N} kandidat) — {inti label run dasar} — {tanggal & jam}`. Segmen delta di depan dan stempel waktu di belakang dibuang saat mengambil "inti", supaya label tidak bertumpuk setiap kali di-rerank. Batas 255 karakter — bila lewat, **inti**-nya yang dipotong.
- Aktivitas dicatat di audit log dengan ringkasan: *"Perangkingan ulang AHP+TOPSIS tanpa {N} kandidat: {M} kandidat diranking ulang memakai skor aspek run {label} (tidak ada aspek yang dihitung ulang)."*

*Catatan teknis: `lib/scoring-engine.ts`, `lib/db/schema.ts`, `scoring-service/src/ahp-topsis-engine.ts`, `components/exclude-candidate-dialog.tsx`, `components/analysis/rank-shift-panel.tsx`.*

---

## 24. **Menambah kandidat ke run** & menjalankan ulang

> **Kedaluwarsa (29 Oktober 2026).** Lihat catatan di awal bagian 23.

### 24.1 Dialog "Tambah Kandidat"

- Hasil pencarian dibatasi **50 teratas**; bila mencapai batas muncul tanda `+` dan baris peringatan *"Menampilkan 50 teratas — persempit dengan pencarian atau filter unit."* Pencarian di-debounce 300 ms.
- Panel *"Kandidat Run Saat Ini"* menampilkan **seluruh** kandidat run (tidak dipotong).
- Label tombol: `Buat Run Baru ({total} kandidat)`.

- Isi run baru: **seluruh** kandidat run ini + kandidat tambahan. Deskripsi dialog: *"Run baru berisi seluruh kandidat run ini + kandidat tambahan"*. Pesan hasil: *"— N kandidat baru dihitung, lalu TOPSIS di-recompute"*.

### 24.2 Mode "Run Pool Penuh"
Label tombol: `Buat Run Pool Penuh (±{ukuran pool dasar + tambahan} kandidat)`. Setelah selesai, sistem membandingkan jumlah kandidat yang dievaluasi dengan run dasar:
- Sama → toast sukses *"perbandingan setara"*.
- Berbeda → toast peringatan 10 detik *"pool tidak persis sama dengan run dasar (X vs Y kandidat dievaluasi)…"*

Bila run dasar tidak mencatat ukuran pool, teks `±N kandidat` hilang dan sistem **tidak dapat mengklaim kesetaraan pool**.

### 24.3 Perbedaan perlakuan filter pada jalur re-run

| Jalur | Rentang grade | Hard filter program |
|---|---|---|
| **Re-scoring "lanjutan"** (kandidat run dasar + tambahan) | **Dilewati** | **Tidak dijalankan** (kandidat sudah divetting di run dasar) → kartu "Tidak Lolos" **selalu 0** |
| **Run pool penuh** | Rentang run dasar | **Dijalankan ulang**, tetapi kandidat run dasar + tambahan **dipaksa masuk** dan dikeluarkan dari daftar gugur |

Pada re-run pool penuh, business unit yang dipakai adalah unit **run dasar**, bukan unit kandidat tambahan (agar pool tidak membengkak).

Kedua aksi menolak bila tidak ada kandidat tambahan. Metode re-run **selalu mewarisi metode run dasar**.

### 24.4 Target finalis pada re-run "lanjutan"
```
target = min( ukuran pool , max( jumlah kandidat run dasar + jumlah tambahan , target template (10) ) )
```

*Catatan teknis: `components/add-candidates-dialog.tsx`, `components/position-run-table-client.tsx`, `lib/scoring-engine.ts`.*

---

## 25. Kartu **"Kandidat Terpilih"** (picks)

- Kartu hijau di atas tab, **hanya dirender bila sudah ada pilihan**; satu tab per program.
- Baris bernomor sesuai urutan pilihan, dengan nama, posisi, catatan inline, tombol lihat run / naik / turun / hapus, dan tombol **"Cetak Kandidat"**.
- Label program: `talent` = Talent Pool, `successor` = Critical Position, `emergency` = Emergency Position. Program bawaan pada dialog = program run yang sedang dibuka.
- **Skor dan readiness yang tersimpan adalah SNAPSHOT saat pemilihan**, bukan nilai run terkini.
- Kandidat yang sudah dipilih mendapat badge **"Dipilih"** di daftar. Tombol "Pilih Kandidat" disembunyikan pada baris yang dikecualikan.
- Baris pilihan tetap ditampilkan meskipun kandidatnya sudah dihapus (nama diambil dari data kandidat atau dari nama yang tersimpan pada pilihan).
- Menyimpan pilihan menandai milestone terminal pada alur aktivitas posisi.

*Catatan teknis: `components/position-detail-tabs.tsx`, `lib/position-pick-actions.ts`.*

---

## 26. **Ekspor & Cetak**

### 26.1 Export Run (Excel `.xlsx`)
Nama berkas: `pulse-analysis-{judul posisi di-slug}.xlsx` (huruf kecil, non-alfanumerik → `-`).

**Tiga sheet:**

| Sheet | Kolom |
|---|---|
| **Summary** | Position, Department, Division, Scoring Method, Qualified Candidates, Rejected Candidates, Top Score (`{n}%`), Primary Focus Candidate, Comparison Candidate, Candidate Count |
| **Candidates** | Rank, Candidate, Current Position, Department, Readiness, Weighted Score, Tech Score, Behavior Score, HAV Quadrant, HAV Score, PA Score, Edu Score, Career Relevance, Ditandai Dikecualikan, Constraint |
| **Programs** | Candidate, Program (kode), Status, Note |

**Kondisi:**
- Baris dan **Rank** sama dengan yang tampil di tab Kandidat: urutan baris mengikuti urutan layar (termasuk urutan seri yang diatur manual), dan Rank pada run AHP + TOPSIS adalah **peringkat di seluruh pool yang dinilai** (`ahpTopsis.poolRank`), bukan nomor baris — kandidat pembanding di bawah batas finalis tercatat mis. 23, bukan 12. Run lama tanpa `poolRank` memakai nomor baris.
- **HAV Quadrant** adalah kuadran yang dinilai run, ditulis persis seperti chip HAV di layar (nomor, nama, kategori — lihat Bab 12); **HAV Score** adalah angka yang dipakai peringkat.
- **Career Relevance** = `scoreBreakdown.career`. Kolom ini menggantikan *Job Match*; *Quality Score* dihapus (§17).
- **Ditandai Dikecualikan** berisi `Ya — {alasan}[ — {catatan}]` untuk kandidat yang ditandai dikecualikan di run ini, kosong bila tidak. Tanda ini tidak mengubah skor atau peringkat.
- Nilai skor lain yang tidak ada ditulis `-`.
- **"Comparison Candidate" selalu `-`** pada ekspor dari tab Kandidat (kandidat pembanding tidak diteruskan dari tab itu).
- **Sheet "Programs" selalu berisi header saja** — daftar program pada profil kandidat memang tidak pernah diisi.
- **Skor yang diekspor adalah skor yang disimpan run** — sama dengan chip di layar dan dengan angka yang membentuk peringkat (lihat Bab 7).

### 26.2 Cetak Run (HTML)
Isi: kartu ringkas (Total Kandidat, Lolos, Tidak Lolos, Skor Tertinggi) + distribusi readiness (Short `0-1 thn` hijau, Medium `1-2 thn` kuning, Long `3-5 thn` biru, Not Ready `>5 thn` abu) + **satu halaman per kandidat** berisi header peringkat/skor/readiness, identitas, catatan "Ditandai dikecualikan" (bila ada), tabel Score Breakdown, kartu HAV/MCU/Behavior, tabel kompetensi (Current/Target/Gap), tabel PA 3 tahun, Position History (maks 8 baris, urut menurun), dan paragraf Insight. Halaman baru mulai kandidat ke-2. Header menyebut tanggal cetak dan metode scoring run. Urutan kandidat dan nomor peringkat sama dengan layar (lihat §26.1).

**Tabel Score Breakdown** — enam baris dengan urutan technical → career → behavior → performance → HAV → education:

| Aspek | Keterangan |
|---|---|
| Technical Competency | Pencocokan kompetensi teknis terhadap acuan posisi (deterministik) |
| Career Relevance | Pengalaman relevan: kemiripan job profile × lama menjabat (deterministik) |
| Behavior Competency | Kategori rekomendasi asesmen perilaku (deterministik) |
| Performance Appraisal | TOPSIS atas riwayat grade PA, berbobot per periode (deterministik) |
| HAV Mapping | `Kuadran {nomor nama (kategori)}`, persis seperti di layar; *Kuadran tidak tersedia* bila kosong |
| Education | Kecocokan pendidikan dengan syarat posisi: pencocokan persis, lalu penilaian AI |

> Sebelumnya keterangan ini tetap ("Evaluasi sub-agent AI" untuk technical/behavior/education, "A=100, B=80, C=60, D=20" untuk PA), memakai pengelompokan HAV sendiri tanpa label untuk Q13/Q14, dan tidak memuat baris Career.

Tabel PA menampilkan `—` bila CSV grade PA tidak mengandung koma.

### 26.3 Cetak Kandidat Terpilih
Hanya mencetak pilihan pada **tab program yang sedang aktif**.
```
Skor tercetak     = skor kandidat pada run yang sedang dibuka, bila ada
                    → bila TIDAK ada: SNAPSHOT saat pilihan disimpan
Readiness tercetak= readiness kandidat pada run, bila ada
                    → bila tidak: snapshot pilihan
                    → bila tidak juga: "Medium" (nilai default)
```
> Ini penyebab paling umum **angka cetakan berbeda dari layar**: kandidat yang dipilih tidak ada di run yang sedang dibuka.
Riwayat PA pada cetakan diambil dari **profil (data terkini)**, bukan dari snapshot run, dan judul tabelnya menyatakan itu (*Riwayat Performance Appraisal (3 Tahun, data terkini)*, juga pada §26.2) — skor PA di tabel Score Breakdown tetap skor run. Tabel Score Breakdown sama dengan §26.2.

### 26.4 PDF
Fungsi ekspor PDF **ada di sistem tetapi tidak dirender di menu Ekspor**. Menu hanya memuat **Export Run (Excel)** dan **Cetak Run (HTML)**. Jadi tidak ada opsi PDF yang bisa dipicu dari halaman ini.

*Catatan teknis: `lib/analysis-export.ts`, `components/analysis/export-buttons.tsx`.*

---

## 27. Tab **AI Assistant** (chatbot)

> Tab ini saat ini **disembunyikan** dari halaman posisi (`AI_ASSISTANT_TAB_ENABLED` di `lib/position-result-tabs.ts`), begitu pula tombol "Tanya AI" pada panel turunan skor. Uraian di bawah berlaku bila tab diaktifkan kembali.

### 27.1 Apa yang dikirim ke model

Untuk tiap pertanyaan, sistem merangkai prompt berisi:
1. Kalimat pembuka menyebut judul posisi, departemen, divisi.
2. **INFO SCORING RUN** — metode, program, label, status, tanggal dibuat/selesai, jumlah kandidat dinilai, lolos filter, gugur filter, rentang grade pool, unit bisnis kandidat.
3. **DAFTAR KANDIDAT (DIRANKING)** — per kandidat: peringkat (sama dengan layar, §26.1), nama, NIK, jabatan, departemen/divisi, level & grade, masa kerja, pendidikan (jurusan), disiplin, MCU, kuadran HAV, behavior + catatan, program, riwayat asesmen, kompetensi teknis (skor saat ini/target/gap/level), riwayat jabatan, skor, readiness, Insight, keunggulan, kebutuhan pengembangan, rekomendasi, dan breakdown enam aspek (Career hanya bila ada).

Parameter model: **temperature 0.3** (hardcode), streaming aktif. Butuh izin `analysis.manage`.

### 27.2 Batasan yang wajib diketahui

- **TIDAK ADA MEMORI ANTAR-PERTANYAAN.** Setiap pertanyaan dikirim sebagai percakapan baru berisi tepat dua pesan (instruksi sistem + pertanyaan). Riwayat chat **ditampilkan** dan disimpan per run, sehingga *tampak* seperti percakapan, **tetapi model tidak pernah melihat pertanyaan/jawaban sebelumnya**. Pertanyaan lanjutan bergaya *"kalau dia bagaimana?"* akan gagal.
- **Temperature 0.3 → jawaban tidak deterministik.** Pertanyaan yang sama bisa dijawab berbeda.
- **Konteks TIDAK memuat detail metodologi AHP** — matriks pairwise, bobot, CR, detail pencocokan kompetensi, dan detail Career **tidak dikirim**. Asisten tidak melihat metodologi per-kriteria.
- **"Tingkat Risiko" tidak pernah terisi.** Field risiko selalu kosong, sehingga bagian "Risiko" tidak pernah muncul di prompt. (Rumus yang ada tetapi tidak pernah dipanggil: `Not Ready` → High; `Long` atau ada constraint → Moderate; selain itu Low.)
- **"Program: -" dan "Riwayat Asesmen: Teknis=-, Perilaku=-" BUKAN data hilang** — kolom-kolom itu memang tidak pernah diisi sistem.
- Kandidat lintas business unit dikirim tanpa data profil sama sekali.
- Input dinonaktifkan bila belum ada run terpilih (*"Pilih scoring run untuk mengaktifkan chat"*).
- Kegagalan izin muncul sebagai pesan gagal generik, bukan "tidak punya izin".
- Blok **KONTEKS BISNIS** yang dulu ikut dikirim (dokumen konteks program milik business unit aktif) sudah dihapus bersama fitur Konteks Bisnis di Tata Kelola.
- Model diberi instruksi *"Jangan mengarang data yang tidak ada"* dan *"Jika ditanya di luar konteks data ini, arahkan kembali ke hasil scoring"* — hanya instruksi prompt, tanpa penegakan program.

*Catatan teknis: `app/api/chat/route.ts`, `components/analysis/chatbot-panel.tsx`, `lib/analysis-utils.ts`.*

---

## 28. **Umpan Balik AI** (👍 / 👎) — dihapus

Tombol suara 👍 / 👎 pada riwayat run, monitor "Umpan Balik AI" di Tata Kelola, dan izin `scoring.feedback` **dihapus** bersama AI Tournament (November 2026). Umpan balik itu hanya tersedia untuk run metode LLM dan hanya dipakai sebagai "pembelajaran" di instruksi sistem run LLM berikutnya; tabelnya (`scoring_run_feedback`) dibuang oleh `drizzle/0097_remove_llm_tournament.sql`. Run AHP + TOPSIS deterministik, jadi tidak ada yang bisa dipelajari dari suara semacam itu.

---

## 29. Dari mana data HR kandidat berasal (hasil sinkronisasi)

### 29.1 Status Disiplin
Kode `WARNING_LEVEL` dibaca sesuai kode sumber HR (dicocokkan dengan teks `SANCTION_GIVEN`, 2026-11-25): **1 = SP1, 2 = SP2, 3 = SP3, 4 = ST (Surat Teguran), 5 = SP Pertama & Terakhir**. Satu orang bisa punya beberapa catatan; **catatan terberat yang menentukan**. Urutan dari yang paling ringan ke paling berat (keputusan HR):

| # | Status | Kondisi |
|---|---|---|
| 1 | `CLEAR` — Bersih | tidak ada catatan (atau hanya kode di luar 1–5) |
| 2 | `ST` — Surat Teguran | tingkat **4** |
| 3 | `SP_OVER_2_YEARS` — SP1/SP2 tidak aktif ≥ 2 tahun | tingkat **1 atau 2**, berakhir **2 tahun lalu atau lebih** |
| 4 | `SP_UNDER_2_YEARS` — SP1/SP2 tidak aktif < 2 tahun | tingkat **1 atau 2**, berakhir **kurang dari 2 tahun** lalu |
| 5 | `ACTIVE_SP` — SP1/SP2 aktif | tingkat **1 atau 2**, `EXPIRY_DATE` hari ini atau sesudahnya (atau kosong) |
| 6 | `SP3` / `SP_FIRST_LAST` | tingkat **3** / **5**, tanpa batas waktu |

- **Siapa yang lolos tidak ditentukan di sini**, tetapi oleh aturan filter disiplin program (halaman Talent Pool → Aturan Filter, atau Tata Kelola). Aturan bawaan meloloskan `CLEAR`, `ST`, dan `SP_OVER_2_YEARS`. Pilihan nilai di editor tampil dalam urutan di atas, jadi "lolos sampai tingkat X" berarti memilih tingkat 1 sampai X. Aturan disiplin Talent Pool juga menentukan siapa yang tampil di Talent Mapping.
- **SP1 diperlakukan sama dengan SP2.** Sebelum 2026-11-25 sinkronisasi membaca tingkat 1 sebagai ST (lolos) dan tidak mengenali tingkat 4 (jadi `CLEAR`). Akibatnya setiap SP1 tercatat "ST", dan setiap Surat Teguran tercatat "Bersih".
- `SP_OVER_2_YEARS` adalah status baru. Dulu orang dengan SP yang sudah berakhir 2 tahun atau lebih tercatat `CLEAR`. `drizzle/0101` menambahkan nilai ini ke setiap aturan disiplin tersimpan yang memuat `CLEAR`, supaya keputusan untuk orang tersebut tidak berubah.
- Sumber kode: `DISCIPLINE_STATUS_SQL` di `sync-service/src/services/candidate-populate.ts`. Urutan dan label ada di `lib/discipline.ts`.

> **Huruf besar/kecil (sudah diperbaiki).** Nilai bawaan kolom dulu `clear` (huruf kecil), sedangkan sinkronisasi menulis `CLEAR`, dan aturan filter membandingkan persis. Akibatnya kandidat yang dibuat di luar sinkronisasi gagal filter disiplin padahal labelnya "Bersih". `drizzle/0101` menyeragamkan semua nilai ke huruf besar dan mengubah nilai bawaan kolom menjadi `CLEAR`.

### 29.2 Status MCU
`fit` / `fit_with_note` / `unfit` (teks yang mengandung "unfit" → unfit; mengandung "fit" → fit_with_note bila juga ada "note", selain itu fit; selain itu kosong).
**Karyawan TANPA baris MCU sama sekali mendapat nilai bawaan `fit`** dan **lolos** filter — inilah jawaban untuk *"kenapa MCU-nya fit padahal belum MCU"*.

> Karena aturan MCU hanya menandai (Bab 22.10), bawaan `fit` ini hanya menentukan apakah kandidat **ditandai**, bukan apakah ia dinilai atau berapa skornya: orang yang belum pernah diperiksa tidak ditandai, sama seperti orang yang sudah diperiksa dan dinyatakan sehat.

**Keterangan medisnya kini disimpan.** Kolom `Kesimpulan` dulu dimampatkan menjadi satu token lalu dibuang — `"FIT (dengan note tekanan darah)"` menjadi `fit_with_note` dan *"tekanan darah"* hilang. Sekarang teks aslinya masuk `sync_mcu.kesimpulan_raw`, ditambah kolom baru opsional `Keterangan` pada templat Excel. Di sisi kandidat ada DUA kolom:

| kolom | sumber | ditimpa sinkronisasi? |
|---|---|---|
| `candidates.mcu_note` | Excel MCU | ya, tiap Senin (dengan COALESCE — berkas tanpa kolom itu tidak menghapus yang lama) |
| `candidates.mcu_note_manual` | diketik di halaman Kandidat | **tidak pernah** |

Keduanya tampil di formulir Kandidat: isian manual pada kolom **Keterangan MCU**, dan di bawahnya keterangan hasil sinkronisasi (*"Dari sinkronisasi: …"*); isian manual didahulukan bila diisi, dan kolom hasil sinkronisasi tidak pernah diubah dari formulir itu. Keterangan ini catatan kandidat semata — tidak dibaca oleh aturan filter maupun oleh perhitungan skor dan peringkat.
Label yang tampil: `fit` → **Fit**, `fit_with_note` → **Fit with note**, `unfit` → **Unfit**, `expired` → **Expired**, lainnya → `-`.
> Nilai `expired` punya label di aplikasi tetapi **tidak pernah diproduksi** oleh sinkronisasi.

### 29.3 Masa kerja
```
masa kerja (tahun) = FLOOR( jumlah hari sejak tanggal masuk / 365.25 )
tanpa tanggal masuk → kosong
```
Masa kerja kosong → aturan `Masa Kerja ≥ 5` **gagal** (bukan angka) → kandidat gugur.

### 29.4 Pendidikan & jurusan
Hanya baris dengan **peringkat jenjang TERTINGGI** yang dipakai (baris tanpa peringkat jenjang tidak pernah terpilih). Jadi *"kenapa jurusan yang dipakai bukan S1 saya"* biasanya karena ada jenjang lain yang peringkatnya lebih tinggi.

### 29.5 Kuadran HAV
Diambil dari berkas Excel HAV; disimpan sebagai angka `1`–`16`. Di luar rentang → kosong. Baris Excel tanpa NIK atau tanpa kuadran valid dibuang.

### 29.6 Rekomendasi & catatan behavior
Dari asesmen **terbaru** per karyawan (assessment center). Karyawan tanpa asesmen → kosong.

### 29.7 Grade PA
CSV 6 slot, jendela 3 tahun kalender sebelum tahun sinkronisasi (lihat Bab 11.1).

### 29.8 Syarat menjadi kandidat
Karyawan hanya menjadi kandidat bila punya penempatan posisi **primer yang masih berlaku** (tanggal mulai sudah lewat, tanggal akhir kosong atau belum lewat). Karyawan tanpa penempatan primer aktif **tidak pernah** menjadi kandidat, sebagus apa pun profilnya.

### 29.9 Foto
URL foto dirakit dari NIK karyawan — **tidak diverifikasi**. Bila gambar gagal dimuat, elemen disembunyikan (fallback inisial).

*Catatan teknis: `sync-service/src/services/candidate-populate.ts`, `sync-service/src/services/mcu-sync.ts`, `sync-service/src/services/hav-sync.ts`, `sync-service/src/services/behavior-sync.ts`, `lib/pulse-data.ts`, `lib/db/schema.ts`.*

---

## 30. Daftar ketidakcocokan angka yang paling sering ditanyakan

| Gejala | Penjelasan |
|---|---|
| **"Chip PA / ekspor PA beda dari grade PA saya sekarang"** | Chip, ekspor, dan cetakan menampilkan PA yang **disimpan run** — dihitung dari grade PA pada saat run dijalankan. Grafik/tabel *Riwayat PA* berlabel *data terkini* menampilkan grade hari ini. Keduanya bisa berbeda setelah sinkronisasi PA; yang membentuk peringkat adalah angka chip. (Sebelum perbaikan, chip PA dihitung ulang dari grade terkini sehingga bisa berbeda dari popup kriteria.) |
| **"Technical saya 0"** | Angka ini disimpan run dan dipakai peringkat: tidak ada kompetensi kandidat yang cocok dengan tuntutan posisi. (Sebelum perbaikan, tampilan mengganti 0 dengan rata-rata kompetensi kandidat saat ini, padahal yang masuk peringkat tetap 0.) |
| **"Kuadran HAV di run beda dari Talent Mapping sekarang"** | Baris hasil run menampilkan kuadran yang **dinilai run** (cocok dengan skor HAV-nya). Penempatan atau unggahan HAV sesudah run tidak mengubahnya — hasilnya baru terlihat di run berikutnya (Bab 12). |
| **"Coverage 60% tapi tertulis 8 kandidat qualified"** | Coverage hanya menghitung **Short + Medium**, sedangkan "qualified" menghitung **Short + Medium + Long**. Selain itu coverage diambil dari **run terakhir posisi**, bukan run yang sedang dibuka, dan **tidak mengurangkan kandidat yang dikecualikan**. |
| **"Kartu Lolos 143 tapi kandidatnya cuma 10"** | Kartu Lolos/Tidak Lolos berasal dari **corong penyaringan pool** (lolos hard filter program), bukan dari tingkat kesiapan kandidat yang tampil. Daftar kandidat hanya berisi finalis (target bawaan 10). |
| **"Kartu Lolos angkanya berubah arti"** | Bila run tidak menyimpan ringkasan penyaringan, kartu jatuh ke hitungan readiness — dua definisi berbeda pada kartu yang sama. |
| **"Badge readiness berubah padahal run lama"** | Badge **dihitung ulang** dari skor + ambang **saat ini**. Bila ambang diubah di Governance, run lama tampil dengan tingkat berbeda dari yang tercatat. |
| **"Kartu bilang 4 lolos readiness, tapi badge non-Not-Ready cuma 2"** | Kartu memakai readiness **tersimpan**, badge memakai ambang **saat ini**. Ditambah: kandidat yang dikecualikan dikurangkan di kartu tetapi tetap tampil di daftar. |
| **"Badge Short tapi orbitnya di cincin Medium"** | Peta Orbit memakai ambang **80/65/50 yang hardcode**, tidak membaca konfigurasi Governance. |
| **"Kandidat saya tidak ada di Peta Orbit"** | Peta Orbit hanya menggambar **10 kandidat teratas**, sedangkan footer "Shortlist Pool" menghitung semuanya. (Peta Job Family memplot semua.) |
| **"Skor 50 tepat, kenapa?"** | Bisa berarti: (a) run AHP hanya berisi **satu** kandidat → closeness dipaksa 0.5; (b) semua kandidat identik. |
| **"Warna Short/Long beda antar tab"** | Tema warna memang tidak konsisten: tab Kandidat memakai Short=biru/Long=hijau, sedangkan Dossier & Peta Orbit memakai Short=hijau/Long=biru. |
| **"Jam run beda di tiga tempat"** | Tiga aturan format waktu berbeda dipakai pada satu halaman (lihat Bab 31.4). |
| **"Di mana mengubah bobot kriteria?"** | Hanya di **matriks perbandingan AHP di Tata Kelola**. Panel Kriteria Penilaian sudah tidak punya kolom bobot sejak `drizzle/0074`; ia hanya menentukan aspek apa saja yang dinilai. |
| **"Bobot Pendidikan sudah saya nolkan, tetap terpakai"** | Bobot 0 sudah tidak ada. Untuk mengeluarkan sebuah aspek, HAPUS kriterianya dari daftar Kriteria Penilaian — porsi bobotnya dibagi ulang ke kriteria yang tersisa. |
| **"Peringkat berubah padahal skor aspeknya sama"** | TOPSIS bersifat relatif terhadap peserta run: menambah/mengeluarkan kandidat mengubah normalisasi kolom & solusi ideal. |
| **"Katanya tidak ada aspek yang dinilai ulang, tapi skor Behavior/PA/HAV saya berubah"** | Ketiganya **selalu** dihitung ulang dari data kandidat saat ini pada setiap run turunan. |
| **"Skor Career saya 0 padahal saya banyak pengalaman"** | Kemungkinan: riwayat tidak terpasangkan ke job profile mana pun (umum untuk riwayat di perusahaan luar), atau posisi target tidak punya dokumen **dan** tidak ada acuan kompetensi untuk fallback. |
| **"Kemiripan cosine 0.60 kok cuma 37%?"** | Kemiripan direntangkan dengan anchor tetap `0.45–0.85` (atau `0.75–0.95`). Cosine mentah **bukan persentase**. |
| **"Behavior saya 0 padahal belum diases"** | Pada AHP, data behavior kosong/tak dikenal = **0**, sama dengan kategori terburuk. |
| **"Rekam jejak semua D kok 0 tapi semua E jadi 20?"** | Anomali nyata: nilai E berada **di bawah** jangkar negatif D, sehingga E memperoleh jarak positif dari jangkar. |
| **"Saya S2 tapi Education tidak exact-match"** | Tanpa kata "minimal" pada persyaratan, jenjang harus **persis sama**. S2 vs "S1 Teknik" gagal exact-match dan dilempar ke penilaian model. |
| **"Kenapa Education saya 100 pas?"** | 100 adalah skor **tetap** exact-match, tidak bergantung seberapa cocok. |
| **"Dossier kandidat ini kosong semua"** | Kandidat dari business unit lain tidak punya profil (profil hanya dimuat untuk unit aktif). Tidak ada penanda di UI. |
| **"Grafik PA saya lurus di C semua"** | Bila CSV grade PA tidak mengandung koma, seluruh grafik memakai default C. |
| **"Riwayat Asesmen kolom Teknis & Perilaku kosong"** | Kolom itu memang tidak pernah diisi — bukan data hilang. |
| **"Sheet Programs di Excel kosong"** | Daftar program pada profil kandidat selalu kosong di halaman ini. |
| **"Angka di cetakan beda dari layar"** | Cetak Kandidat Terpilih memakai **snapshot saat pilihan disimpan** bila kandidat itu tidak ada di run yang sedang dibuka; bila readiness juga tidak ada → dicetak "Medium". |
| **"Kuadran 13/14 tidak ada namanya di cetakan"** | Lubang pemetaan label pada berkas cetak; skornya tetap 60. |
| **"Kenapa saya gugur filter padahal nilai saya bagus"** | Kemungkinan besar **datanya kosong**: kuadran HAV kosong, status disiplin kosong, atau masa kerja kosong → otomatis gagal aturan. |
| **"Status disiplin saya Bersih tapi tetap gugur"** | Nilai bawaan basis data huruf kecil (`clear`) tidak sama dengan nilai sinkronisasi (`CLEAR`), sedangkan filter membandingkan persis. Label yang tampil tetap "Bersih". |
| **"MCU saya fit padahal belum MCU"** | Karyawan tanpa baris MCU mendapat nilai bawaan `fit`. Karena aturan MCU hanya menandai, bawaan ini hanya berarti kandidat itu tidak ditandai — lihat Bab 29.2. |
| **"Kenapa kandidat unfit ikut muncul di peringkat?"** | Sejak drizzle/0071 MCU **tidak lagi menggugurkan**: aturannya hanya menandai, jadi kandidat `unfit` tetap dinilai dan temuannya muncul di daftar "Kandidat Ditandai" (Bab 22.10). |
| **"Bisakah MCU mengubah peringkat?"** | Tidak. Data MCU tidak dipakai menghitung skor atau peringkat dalam bentuk apa pun — tidak tersimpan, dan tidak pula sebagai tampilan pembanding. Peringkat, skor, dan readiness hanya berasal dari enam aspek. |
| **"PA saya semester ini A, kenapa tidak terhitung"** | Jendela PA hanya 3 tahun kalender **sebelum** tahun berjalan; tahun berjalan selalu dikecualikan. |
| **"Filter PA min B tapi saya banyak C kok lolos"** | Semantik `termasuk` bersifat **eksistensial**: satu semester A/B sudah meloloskan. |
| **"Jarak di Peta Job Family tidak cocok dengan skor Career"** | Peta memakai **resolusi job profile target yang berbeda** dari aspek Career; marker oranye bisa menunjuk profil lain. |
| **"Jarak di peta berubah padahal run tidak dijalankan ulang"** | Koordinat berasal dari run topic modelling terakhir. Membangun ulang peta job family mengubah semua jarak. |
| **"Chatbot tidak ingat pertanyaan saya sebelumnya"** | Setiap pertanyaan dikirim sebagai percakapan baru; tidak ada memori antar-pertanyaan. |
| **"Chatbot tidak bisa menjelaskan bobot AHP"** | Konteks yang dikirim tidak memuat matriks, bobot, CR, maupun detail pencocokan per kriteria. |
| **"Chatbot menjawab beda untuk pertanyaan sama"** | Temperature 0.3 → tidak deterministik. |
| **"Run bulan lalu hilang dari daftar"** | Filter tanggal bawaan adalah tahun berjalan penuh; run di luar rentang tetap bisa dibuka lewat tautan langsung dengan `runId`. |
| **"Skor Technical lebih dari 100"** | Hanya mungkin pada run yang selesai sebelum agregat Technical dijenuhkan pada 1 (terukur: 6 baris, semuanya 113). Bonus over-qualification masih ada **per pasangan** (plafon 1,75), tetapi `Σ/M` kini dijepit ke 1, jadi run baru maksimum 100. |
| **"Tech 0 apakah bobot Technical hangus?"** | Bila **acuan kompetensinya** kosong, kriteria Technical dibuang dan bobotnya dibagi ulang. Bila acuannya ada tetapi kandidat tidak punya data, kolomnya tetap ada dengan nilai 0. |

---

## 31. Konstanta, ambang, dan istilah — ringkasan

### 31.1 Ambang & nilai default utama

| Besaran | Nilai |
|---|---|
| Ambang readiness | Short ≥ 80 · Medium ≥ 65 · Long ≥ 50 · Not Ready ≥ 0 |
| ETA readiness | 0–1 tahun · 1–2 tahun · 3–5 tahun · > 5 tahun |
| Bobot AHP bawaan | technical 25 · career 10 · behavior 25 · performance 15 · hav 15 · education 10 |
| Target finalis bawaan | 10 |
| Ambang konsistensi AHP (CR) | 0,1 |
| Random Index untuk 6 kriteria | 1,24 |
| Skala kemiripan Career | **diukur** — nilai tengah tiga cara pengukuran (0,633 – 0,892 pada korpus saat ini); cadangan 0,45–0,85 non-E5 · 0,75–0,95 E5 |
| Target kedalaman Career (absolut) | 8 tahun · 2 stint, atau syarat pengalaman job profile apa adanya (dijepit 3–20 th) bila job profile menyebutkannya |
| Batas target Career | 3–20 tahun dan 1–8 stint |
| Bobot keragaman penugasan Career | 0,25 (kedalaman menentukan, keragaman memodulasi) |
| Penyusutan usia pengalaman Career | 0,043 per tahun sejak penugasan berakhir |
| Kalibrasi fallback Career | rentang dibatasi 50% dari rentang penuh, cakupan kompetensi dibobot kekhasan (IDF) |
| Ambang embedding pencocokan judul Career | > 0,98 |
| Bonus over-qualification kompetensi | maks +25%, plafon nilai sel 1,25 |
| Level kompetensi | 1 Basic · 2 Intermediate · 3 Advance · 4 Mastery (default sisi kandidat 1, sisi acuan 2) |
| Skor Behavior | 100 · 83 · 67 · 50 · 33 · 17 · 0 (tanpa data → 0) |
| Nilai PA | A=4 B=3 C=2 D=1 E=0; jangkar +4 / −1; kosong → C |
| Bobot periode PA | 0,271056 · 0,216844 · 0,173476 · 0,138780 · 0,111024 · 0,088819 |
| Skor HAV | Q1=100 · Q2,3,4,7,8=80 · Q5,6,9,13,14=60 · Q10,11,12,15=40 · Q16=20 · kosong=40 |
| Skor Education exact-match | 100 (tetap) |
| Percobaan ulang Education | 3 percobaan grounded + 1 perbaikan bentuk |
| Nilai default aspek saat kosong | technical 0 · career 0 · behavior 0 · performance 50 · hav 40 · education 0 |
| Job Match (hanya tersimpan, tidak ditampilkan — §17) | clamp(skor − 5, 30, 95) |
| Ambang narasi mesin | kekuatan ≥ 70 (maks 4) · kelemahan < 50 (maks 3) · rekomendasi < 60 (maks 4) |
| Run per halaman | 5 |
| Kandidat maksimum di Peta Orbit | 10 |
| Kandidat maksimum di Komparasi | 5 |
| Hasil pencarian dialog Tambah Kandidat | 50 |
| Batas waktu penilaian Pendidikan (Gemini) | 60 detik |
| Sumber grounding disimpan | maks 8 tautan |

### 31.2 Enam kriteria & urutannya
`technical → career → behavior → performance → hav → education`
Hanya **technical, career, education** yang bisa dibuang dari perhitungan. **behavior, performance, hav tidak pernah dibuang.**

### 31.3 Aspek mana yang segar dan mana yang dipakai ulang (run turunan)

| Aspek | Run turunan |
|---|---|
| Technical, Career, Education | **Dipakai ulang** (snapshot run dasar) |
| Behavior, Performance, HAV | **Selalu dihitung ulang** dari data kandidat saat ini |

### 31.4 Satu aturan format waktu untuk seluruh aplikasi

| Butuh | Format | Contoh |
|---|---|---|
| Tanggal + jam | `YYYY-MM-DD HH:mm` | `2026-08-24 11:05` |
| Tanggal saja | `YYYY-MM-DD` | `2026-08-24` |
| Batas riwayat jabatan | idem, tahun ≥ 9999 → `Sekarang`, kosong → `—` | `2023-01-01 → Sekarang` |

Semua waktu dirender pada zona **Asia/Jakarta (WIB)** — zona bisnis, bukan zona
browser pembaca. Alasannya: timestamp di sini adalah **bukti kapan sebuah
penilaian dibuat**, jadi dua orang yang membaca run yang sama harus melihat jam
yang sama. Satu-satunya sumber kebenaran adalah `lib/datetime.ts` (salinannya di
scoring-service, `scoring-service/src/datetime.ts`, dihapus bersama AI Tournament,
satu-satunya pemakainya).

**Ini menggantikan tiga aturan berbeda yang dulu hidup di satu halaman**: baris
Riwayat Scoring dibaca sebagai UTC apa adanya, Tab Konfigurasi Run mengikuti zona
browser, dan blok INFO SCORING RUN pada chatbot memakai tanggal-saja UTC. Selisih
+7 jam antara dua baris di halaman yang sama **bukan lagi perilaku yang benar** —
kalau masih terlihat, itu bug.

Akar masalahnya bukan format, tapi pembacaan: 55 kolom pada skema ini bertipe
`timestamp without time zone` dan menyimpan jam dinding WIB (`TimeZone` database
adalah Asia/Bangkok, jadi `DEFAULT now()` mencatat waktu lokal). node-postgres
menafsirkan nilai tanpa offset memakai zona **proses yang membacanya**, sehingga
kontainer UTC mengubah 11:04 WIB menjadi 11:04Z — instan yang 7 jam terlambat —
lalu render ke Asia/Jakarta mencetak 18:04. Di laptop pengembang yang sudah WIB
kedua kesalahan itu saling menghapus, jadi tampak benar di dev dan salah di
produksi tanpa satu pun log. Pembacaan sekarang dipatok di `lib/db/pg-time.ts`,
sehingga nilai berarti instan yang sama di mana pun kode berjalan.

### 31.5 Nilai yang selalu tetap / tidak bermakna pada run AHP + TOPSIS
Mesin AHP menulis nilai TETAP untuk: `foto = kosong`, `disiplin = "-"`, `MCU = "-"`, `PA (teks) = "-"`, dan **status filter primer = "qualified" untuk semua**. Karena itu:
- Badge status filter primer pada run AHP **tidak membawa informasi**.
- Nilai disiplin/MCU/PA yang tampil **selalu berasal dari data kandidat TERKINI**, bukan kondisi saat run dijalankan.

Lima field ini (disiplin, MCU, PA teks, rekomendasi behavior, catatan behavior) **selalu ditimpa dari data kandidat saat ini** ketika laporan dibaca. Jadi run **bukan snapshot murni** untuk field-field tersebut.

### 31.6 Glosarium singkat

| Istilah | Arti dalam laporan ini |
|---|---|
| **Closeness coefficient (Ci)** | Kedekatan ke solusi ideal, 0–1. Skor akhir = Ci × 100. |
| **Solusi ideal (A⁺) / anti-ideal (A⁻)** | Nilai terbaik/terburuk per kriteria **di antara peserta run itu**. |
| **Benefit** | Kriteria yang makin tinggi makin baik. Semua enam kriteria bersifat benefit. |
| **CR (Consistency Ratio)** | Ukuran kewajaran perbandingan berpasangan. > 0,1 = tidak konsisten. |
| **Hungarian** | Algoritma penugasan satu-ke-satu yang memaksimalkan total kecocokan kompetensi secara global. |
| **Exact / Semantic / Tidak cocok** | Cara satu kompetensi required dipasangkan: nama sama persis / kemiripan makna / tidak dapat pasangan. |
| **Stint** | Satu periode menjabat pada riwayat jabatan kandidat. |
| **effectiveYears / effectiveRows** | Akumulasi pengalaman relevan dalam satuan tahun dan dalam satuan stint. |
| **binding / penentu** | Sumbu (tahun atau stint) yang menjadi pembatas skor Career. |
| **basis: dokumen / fallback kompetensi / tidak dinilai** | Bagaimana angka relevansi satu riwayat jabatan benar-benar diperoleh. |
| **Snapshot pool** | Simpanan skor aspek SELURUH kandidat yang dinilai — syarat agar backfill mungkin saat hitung ulang. |
| **Backfill** | Mengisi slot finalis yang kosong dengan kandidat peringkat berikutnya dari pool. |
| **Kriteria di-drop** | Kriteria yang tidak bisa dinilai siapa pun, dikeluarkan dari perhitungan; bobotnya dibagi ulang. |
| **Bobot efektif** | Bobot AHP setelah redistribusi ke kriteria yang tersisa. |
| **Run turunan** | Run baru hasil penambahan kandidat (augment) atau pengecualian (exclude). |
| **Hard filter / Aturan Filter** | Aturan gugur-tidaknya kandidat masuk pool. Terpisah dari skor. |

---

## 32. Ringkasan prinsip yang harus selalu disampaikan ke user

1. **Filter menentukan siapa yang dinilai; skor menentukan urutan.** Dua mekanisme berbeda, sering memakai field yang sama dengan aturan yang berbeda.
2. **Skor akhir tidak sebanding antar-run**, karena TOPSIS relatif terhadap peserta. Skor PA **sebanding** antar-run karena jangkarnya absolut.
3. **Setiap penurunan mutu data dicatat, tidak disembunyikan** — di tab Konfigurasi (Sumber Acuan & Penyesuaian, kriteria yang dibuang) dan di banner pada detail kriteria. Bila user bertanya "kenapa skor saya rendah", cek dulu bagian ini: seringkali jawabannya adalah **acuan posisi target yang tidak lengkap**, bukan kualitas kandidat.
4. **Skor aspek dan kuadran HAV selalu dari run; beberapa label dibaca ulang saat dibuka** (readiness, disiplin/MCU/behavior, riwayat PA) — jadi skornya beku, tetapi label di sekitarnya bisa mencerminkan data hari ini.
5. **Run dasar tidak pernah diubah.** Pengecualian menganotasi; hitung ulang menghasilkan run baru. Peringkat yang sudah selesai adalah catatan asesmen pada tanggalnya.
6. **Nilai kosong bukan nilai netral.** Pada beberapa aspek data kosong bernilai 0 (Behavior/Technical/Career/Education pada AHP), pada aspek lain bernilai default yang cukup tinggi (PA 50/33/60, HAV 40) — dan pada filter, data kosong bisa langsung menggugurkan.
