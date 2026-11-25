# Sinkronisasi input bobot AHP — rancangan

Status: **disetujui dan diimplementasikan** (Fase 3–4). Rancangan disetujui
beserta ketujuh butir §12, dengan dua syarat tambahan dari persetujuan:
pemberitahuan pembulatan menyebut pasangan beserta nilai sebelum → sesudah
("Karier vs HAV: 1 → 2"), dan sesi scoring baru ditolak bila matriks program
gagal validasi (§7). Dasarnya adalah audit Fase 1 (tes reproduksi di
`tests/governance/`, commit 49d0ddb) dan sembilan keputusan di §0.

Rumus AHP **tidak berubah** (`computeAhpWeights` di `scoring-service/src/ahp.ts`):
bobot = rata-rata geometrik baris yang dinormalisasi; λmaks = rata-rata
(A·w)ᵢ / wᵢ; CI = (λmaks − n)/(n − 1); RI(6) = 1,24; CR = CI/RI; matriks diterima
bila CR ≤ 0,10. Bobot efektif w′ (normalisasi ulang atas kriteria aktif) juga
tidak berubah. Yang diubah hanya **representasi input**: apa yang boleh masuk
ke matriks, bagaimana tiap mode membaca dan menulisnya, dan bagaimana nilainya
ditampilkan.

## 0. Keputusan yang mengikat rancangan ini

| # | Keputusan | Bagian |
|---|---|---|
| 1 | Satu fungsi validasi bersama `validateAhpPairwise` untuk lencana CR, `saveAhpConfigAction`, dan `updateProgramTemplateAction`. `isValidPairwise` diperbaiki agar sesuai komentarnya, atau digantikan | §3, §7 |
| 2 | Jalur scoring tidak berubah. Run hanya diberi penanda bila matriksnya ber-CR > 0,10 atau berisi nilai di luar S | §8 |
| 3 | UI tab Daftar dipertahankan; "Sama" = 1 | §4.2 |
| 4 | Jaminan CR = 0 untuk Urutan/Slider dilepas. Semua penulis lewat snap ke S, lalu semua tampilan diturunkan ulang (snap-back). `verify-ahp-modes.ts` diganti | §4, §10 |
| 5 | Bobot bawaan engine tidak di-snap; trace-nya didokumentasikan berisi nilai bukan-Saaty | §8.3 |
| 6 | `snapInteger` dihapus sebagai pembulatan tampilan | §4.1, §4.2 |
| 7 | Commit sel saat blur/Enter walau nilainya sama | §6 |
| 8 | `run_info.ahp.pairwise` presisi penuh, dengan label Saaty | §8.2 |
| 9 | Skrip audit data lama: read-only, CSV + Markdown | §9 |

## 1. Masalah yang diselesaikan (ringkasan audit)

- **Satu matriks, penulis tanpa batasan skala.** `value.pairwise` sudah menjadi
  satu-satunya sumber. Masalahnya, tiga penulis tidak dibatasi ke skala Saaty:
  - Slider: aᵢⱼ = pᵢ/pⱼ, misalnya 5/4 = 1,25.
  - Urutan: rasio rank-sum.
  - `activate()`: `pairwiseFromWeights([5,1,7,2,4,1])`.
- **Tampilan membulatkan.** Tab Berpasangan menampilkan `snapInteger` (=
  `Math.round`), jadi 1,25 tampil 1 dan 1,5 tampil 2. Lencana dan server
  memvalidasi nilai aslinya, sehingga pada run 622af32e pakar melihat
  matriks ber-CR 0,1118 sedangkan sistem menyimpan dan menerima CR 0,0995.
- **Segitiga bawah tidak resiprokal di layar.** Teksnya dibangun dari
  `"1/" + snapInteger(sel_atas)`, padahal `snapInteger` selalu ≥ 1. Akibatnya
  sel bawah yang bernilai 2 tertulis "1/2".
- **Nilai tersembunyi tidak bisa ditimpa.** Mengetik ulang digit yang sudah
  tampil tidak memicu `onChange`, jadi 1,25 di belakang angka "1" bertahan.

## 2. Model kanonik

### 2.1 Skala

S = {1/9, 1/8, 1/7, 1/6, 1/5, 1/4, 1/3, 1/2, 1, 2, 3, 4, 5, 6, 7, 8, 9}, berisi 17
nilai. Disimpan sebagai tabel konstanta `SAATY_SCALE` yang terurut naik. Kebalikan
anggota ke-k adalah anggota ke-(16 − k), sehingga resiprokal selalu diambil dari
tabel, bukan dihitung dengan `1 / x`. Dengan begitu sel bawah dari 1/3 adalah
`3` persis, bukan 3,0000000000000004.

### 2.2 Sumber kebenaran

- **Isinya** adalah 15 nilai segitiga atas aᵢⱼ (i < j) ∈ S, dalam urutan
  `AHP_CRITERIA_ORDER` (technical, career, behavior, performance, hav,
  education).
- **Bentuk simpanannya tetap** `ahp_config = { pairwise: number[][] }` 6×6, dengan
  diagonal 1 dan segitiga bawah resiprokal dari tabel. Bentuk ini dipertahankan
  karena engine (`resolveAhpWeights`), `config_snapshot`, trace, perbandingan
  run, dan pembekuan run turunan membaca bentuk itu; mengubahnya berarti
  mengubah jalur scoring (keputusan 2). Matriks 6×6 tersebut sepenuhnya
  ditentukan oleh 15 nilai atas: `pairwiseFromUpper(upper)` adalah satu-satunya
  cara editor membentuknya.
- **Turunan:** bobot, λmaks, CI, CR, posisi slider, dan urutan **selalu
  diturunkan** dari matriks ini dengan `computeAhpWeights`. Tidak ada mode yang
  menyimpan bobot atau poinnya sendiri (§5).

## 3. Fungsi inti bersama

### 3.1 Lokasi

Berkas baru: `scoring-service/src/ahp-saaty.ts`.
- Bebas dependensi, dengan impor relatif tanpa ekstensi.
- Diimpor langsung oleh web app dan di-whitelist di `.dockerignore` bersama
  `scoring-service/src/ahp.ts`.
- `lib/ahp.ts` me-re-export fungsinya, jadi pemanggil di web tetap mengimpor
  dari `@/lib/ahp`.

Ini pola yang sama dengan TOPSIS (I-7: `topsis.ts` / `topsis-ranking.ts`
diimpor web secara langsung). Alasannya: fungsi yang menentukan "nilai ini sah"
tidak boleh punya salinan yang bisa menyimpang, karena drift seperti itulah yang
menghasilkan bug ini. Lencana editor, kedua aksi server, penanda engine, panel
Konfigurasi Run, dan skrip audit akan memanggil kode yang **sama persis**.

### 3.2 Fungsi

```ts
export const SAATY_SCALE: readonly number[];          // 17 nilai, naik

/** Anggota S terdekat dalam ruang log: argmin |ln x − ln s|.
 *  Bila dua anggota sama dekat (selisih ≤ 1e-12), pilih yang |ln s|-nya lebih
 *  kecil (lebih dekat ke 1). x di luar [1/9, 9] dijepit ke ujung skala.
 *  x ≤ 0 atau tidak berhingga → error (bukan rasio). */
export function snapToSaaty(x: number): number;

/** |ln x − ln s| ≤ tol untuk suatu s ∈ S (default tol = 1e-6). */
export function isSaatyValue(x: number, tol?: number): boolean;

/** "3", "1", "1/3" untuk anggota S; desimal "1,25" untuk yang di luar S. */
export function saatyLabel(x: number): string;

export function reciprocalSaaty(s: number): number;  // dari tabel

export type AhpIssue =
  | { code: 'shape'; n: number }
  | { code: 'not_positive'; row: number; col: number; value: unknown }
  | { code: 'diagonal'; row: number; value: number }
  | { code: 'not_reciprocal'; row: number; col: number; product: number }
  | { code: 'off_scale'; row: number; col: number; value: number; nearest: number }
  | { code: 'inconsistent'; cr: number };

export type AhpValidation = {
  ok: boolean;
  issues: AhpIssue[];
  /** Dari computeAhpWeights; null bila struktur gagal (bukan persegi / tidak positif). */
  result: { weights: number[]; lambdaMax: number; ci: number; cr: number } | null;
};

export function validateAhpPairwise(
  matrix: unknown,
  opts?: { n?: number; scaleTolerance?: number; crMax?: number },
): AhpValidation;

/** Pesan Indonesia untuk satu isu, dengan label kriteria dari pemanggil. */
export function describeAhpIssue(issue: AhpIssue, labels: readonly string[]): string;
```

### 3.3 Aturan `validateAhpPairwise` (keputusan 1)

Diperiksa berurutan; semua isu dikumpulkan, bukan berhenti di isu pertama.

| Pemeriksaan | Aturan | Isu |
|---|---|---|
| Ukuran | n×n dengan n = 6 | `shape` |
| Angka | setiap sel berhingga dan > 0 | `not_positive` |
| Diagonal | \|aᵢᵢ − 1\| ≤ 1e-9 | `diagonal` |
| Resiprokal | \|aᵢⱼ · aⱼᵢ − 1\| ≤ 1e-9 untuk i < j | `not_reciprocal` |
| Skala | \|ln aᵢⱼ − ln s\| ≤ 1e-6 untuk suatu s ∈ S, pada **semua 30** sel non-diagonal | `off_scale` (dengan `nearest = snapToSaaty`) |
| Konsistensi | CR ≤ 0,10 (dari `computeAhpWeights`) | `inconsistent` |

- `ok` bernilai benar hanya bila tidak ada isu.
- CR tetap dihitung untuk matriks yang lolos ukuran dan angka, walaupun ada isu
  lain, supaya lencana selalu punya angka. **CR yang tampil dan CR yang
  divalidasi berasal dari satu pemanggilan fungsi ini.**
- Pesan `inconsistent` mempertahankan teks yang ada sekarang ("Rasio konsistensi
  (CR) matriks AHP = 0.112 melebihi 0.1 — …"), karena dokumen pengguna mengutipnya.

### 3.4 `isValidPairwise`: tetap struktural

Fungsi ini adalah **gerbang engine** (`resolveAhpWeights`), dan juga dipakai
panel tampilan (`scoring-criteria.ts`, `position-detail-actions.ts`,
`progress-running-actions.ts`).

Membuatnya menolak matriks tidak resiprokal atau di luar S akan membuat engine
**diam-diam beralih ke bobot bawaan** untuk konfigurasi lama. Itu mengubah jalur
scoring yang dilarang keputusan 2, dan merupakan jenis fallback diam-diam yang
dihindari di seluruh repo ini.

Karena itu yang diperbaiki adalah **komentarnya**, agar menyatakan apa yang
benar-benar diperiksa ("persegi, berhingga, positif; untuk validasi masukan
pakai `validateAhpPairwise`"). Pemeriksaan masukan pindah ke
`validateAhpPairwise` di kedua jalur simpan. Komentar salinan web
(`lib/ahp.ts:128`) memang yang keliru; salinan scoring-service sudah benar.

**Usulan tambahan, perlu persetujuan:** `lib/ahp.ts` me-re-export
`computeAhpWeights`, `RANDOM_INDEX`, `randomConsistencyIndex`, `isValidPairwise`,
dan `pairwiseFromWeights` dari `scoring-service/src/ahp.ts`, lalu salinan
duplikatnya dihapus.
- Kodenya identik baris per baris, jadi rumus tidak berubah.
- Yang hilang hanyalah kemungkinan drift antara dua salinan.
- Tes paritas yang ada menjadi pembuktiannya.
- Bila tidak disetujui, kedua salinan tetap ada, dan `validateAhpPairwise`
  memakai salinan scoring-service.

## 4. Proyeksi per mode

Notasi: `A` = matriks kanonik, `w = computeAhpWeights(A).weights`.

**Aturan umum penulisan.** Setiap penulisan dari mode mana pun:
1. Mengkanonisasi seluruh matriks terlebih dahulu: setiap sel atas di luar S
   di-snap, dan segitiga bawah dibangun ulang dari tabel.
2. Baru kemudian menerapkan perubahannya.

Jadi **setelah penulisan apa pun, ke-15 sel ∈ S** (invarian INV-1, §10).
Pembulatan yang terjadi dilaporkan dalam pemberitahuan (§5.3).

**Berpindah mode tidak menulis.** Keempat tampilan hanya membaca `A`, sehingga
perpindahan mode tidak pernah membulatkan apa pun. Pembulatan hanya mungkin
terjadi saat Slider atau Urutan menulis (rasio kontinu → S), saat `activate()`,
dan saat data lama dikanonisasi (§4.6).

### 4.1 Matriks ↔ kanonik

| Arah | Aturan |
|---|---|
| kanonik → sel atas (urutan tampil `pairOrder`) | Teks `saatyLabel(a_rc)`. Bila a < 1, tampil "1/" + input berisi n = 1/a; bila a ≥ 1, input berisi a |
| kanonik → sel bawah | `saatyLabel(a_rc)` dari nilai **sel itu sendiri**, yaitu kebalikan sel atas yang diambil dari tabel. Sel bawah Karier/Teknis yang bernilai 2 tertulis "2". Ini memperbaiki `governance-ahp-editor.tsx:748-754` |
| sel atas → kanonik | Digit v ∈ 1..9 di sel yang tampil "1/" berarti a_rc = 1/v; di sel lain a_rc = v. Pasangannya a_cr = `reciprocalSaaty` |

Sel bawah tetap hanya-baca, seperti sekarang. Urutan tampil `pairOrder` tetap
murni tampilan dan tidak memengaruhi bobot.

### 4.2 Daftar (UI yang ada) ↔ kanonik

| Arah | Aturan |
|---|---|
| kanonik → baris | Untuk pasangan (kiri = kriteria grup, kanan): bila a ≥ 1, `hi` = kiri; bila a < 1, `hi` = kanan. Intensitas v = a ≥ 1 ? a : 1/a, yang **bulat persis** karena kanonik. Bila v = 1, baris tetap "X lebih penting 1× dibanding Y" dengan keterangan kecil *(sama penting)* |
| baris → kanonik | Mengetik v → a_hi,lo = v dan a_lo,hi = 1/v (tabel). "Sama" = v = 1. Tombol tukar → a_lo,hi = v |

Pemetaan ini **lossless** untuk matriks kanonik: baris → kanonik → baris
menghasilkan baris yang sama persis.

### 4.3 Slider ↔ kanonik

**Kanonik → slider.** Posisi = wᵢ dalam persen, dihitung dengan
`computeAhpWeights`. Rentang slider 2–65 %, langkah 0,1. Batas ini adalah bobot
yang bisa dicapai di skala Saaty untuk n = 6:
- minimum 2,17 %: baris berisi semua 1/9, baris lain 1;
- maksimum 64,29 %: baris berisi semua 9.

Nilai 1–10 "poin kepentingan" dihapus, karena itu state kedua yang tidak bisa
diturunkan dari matriks.

**Slider → kanonik**, saat dilepas (`onValueCommit`); selama digeser yang ada
hanya pratinjau:
1. Kriteria i diberi bobot target t. Kriteria lain diskalakan proporsional:
   w′ₖ = wₖ · (1 − t)/(1 − wᵢ), sehingga Σ = 1.
2. Untuk setiap j ≠ i: aᵢⱼ = `snapToSaaty`(t / w′ⱼ), dan aⱼᵢ diambil dari tabel.
3. Bobot dihitung ulang dari matriks hasil snap, lalu slider **melompat** ke bobot
   hasil hitung ulang itu (snap-back). Yang tampil = yang dipakai.
4. Bila tidak satu pun penilaian berubah, slider **maju ke titik terdekat searah
   geseran yang mengubah minimal satu penilaian**, dibatasi rentang. Tanpa aturan
   ini slider bisa macet: dari bobot bawaan hasil snap, Behavior 34,4 % baru
   mengubah satu penilaian di 36,1 %. Setiap tekan tombol panah akan memantul
   kembali selamanya.
5. Selama digeser, di samping slider tampil pratinjau "setelah dibulatkan ke
   skala Saaty: 35,2 %". Fungsinya murni dan murah, jadi bisa dihitung per frame.

> **Perlu persetujuan: langkah 2 hanya menulis baris/kolom kriteria i (5
> penilaian), bukan ke-15.** Spesifikasi awal menulis aᵢⱼ = snap(wᵢ/wⱼ) untuk
> semua pasangan. Saya mengusulkan hanya baris/kolom yang digeser, karena:
> - Rasio antar-kriteria lain tidak berubah oleh penskalaan proporsional, jadi
>   tidak ada alasan menyentuh penilaiannya.
> - Menulis ulang ke-15 nilai dari bobot menghapus penilaian pakar yang tidak
>   terkait, seberapa pun kecil geserannya, karena bobot dari matriks yang tidak
>   konsisten bukan rasio penilaiannya. Pada Acuan A, menaikkan HAV 2 % relatif
>   (13,9 % → 14,2 %) dengan tulis-ulang penuh mengubah **7 dari 10** penilaian
>   yang tidak melibatkan HAV.
>
> Konsekuensinya: Slider di atas matriks pakar yang tidak konsisten tetap tidak
> konsisten. Diukur pada implementasinya (`scripts/verify-ahp-modes.ts`, sapuan
> 2–65 % langkah 0,5 per kriteria): dari Acuan A sapuan slider mencapai
> CR 0,1239, sedangkan dari matriks `activate()` maksimum CR 0,0495. (Prototipe
> rancangan memberi 0,149 / 0,0835 dengan langkah dan basis yang berbeda.)
> Lencana dan validasi menunjukkannya dengan jujur.

### 4.4 Urutan (drag-and-drop) ↔ kanonik

**Kanonik → urutan.** Kriteria diurutkan menurun menurut w. Bobot yang seri
(|wₐ − w_b| ≤ 1e-12) ditampilkan sebagai **seri**: nomor peringkat sama ("2 =")
dan lencana "seri". Di dalam satu kelompok seri, urutan mengikuti seretan
terakhir, lalu indeks kanonik, supaya daftar tidak teracak di antara render.

**Urutan → kanonik**, saat dilepas:
1. Nilai bobot yang ada, diurutkan menurun, dipermutasikan ke urutan baru: bobot
   terbesar ke posisi pertama, dan seterusnya.
2. **Ke-15** penilaian ditulis ulang: aᵢⱼ = `snapToSaaty`(wᵢ/wⱼ). Untuk mode ini
   memang harus semuanya, karena mengubah urutan mengubah setiap perbandingan.
3. Bobot dihitung ulang, lalu daftar diurutkan ulang menurut bobot hasil snap.

Pemberitahuan menyatakan bahwa ke-15 penilaian berpasangan diganti.

**Sifat yang dijamin dan dites:** urutan hasil snap tidak pernah membalik urutan
yang diseret, tetapi boleh menjadi seri. Alasannya, `snapToSaaty` monoton tidak
turun. Bila wₐ ≥ w_b, maka a_aj ≥ a_bj untuk setiap j, sehingga gₐ ≥ g_b.
Hasil ukur pada 720 permutasi:

| Vektor bobot dasar | Pembalikan | CR maks | Seri berdampingan |
|---|---|---|---|
| bawaan sistem | 0 | 0,0054 | 720 (Karier = Pendidikan = 5 %, seri sejak awal) |
| Acuan A | 0 | 0,0097 | 0 |
| rank-sum | 0 | 0,0080 | 0 |

Tidak ada satu pun yang melewati CR 0,10.

### 4.5 `activate()` ("Atur Bobot AHP")

Matriks awal = snap dari bobot bawaan sistem (35/25/20/10/5/5), melalui aturan
yang sama dengan Urutan (tulis-ulang penuh dari bobot):

| | Teknis | Karier | Behavior | PA | HAV | Pendidikan |
|---|---|---|---|---|---|---|
| Teknis | 1 | 5 | 1 | 3 | 1 | 5 |
| Karier | | 1 | 1/7 | 1/2 | 1/4 | 1 |
| Behavior | | | 1 | 4 | 2 | 7 |
| PA | | | | 1 | 1/2 | 2 |
| HAV | | | | | 1 | 4 |

- Bobot hasilnya: Teknis **26,09 %**, Karier **4,97 %**, Behavior **34,37 %**,
  PA **9,43 %**, HAV **20,17 %**, Pendidikan **4,97 %**.
- λmaks = 6,0332; CI = 0,0066; **CR = 0,0054**.
- Sesuai keputusan 4, bobot ini tidak persis 35/25/20/10/5/5. Program yang tidak
  pernah menekan "Atur Bobot AHP" tetap memakai bobot bawaan persis (§8.3).

### 4.6 Data lama (matriks tersimpan di luar S atau tidak resiprokal)

Editor **tidak** mengkanonisasi diam-diam saat dibuka. Kalau dilakukan, draf
akan berbeda dari yang tersimpan tanpa sepengetahuan pakar.

- **Banner.** Isinya: "Matriks tersimpan berisi N nilai di luar skala Saaty",
  daftar sel beserta nilai tersimpan → nilai snap (mis. "Karier/HAV 1,25 → 1"),
  serta CR tersimpan → CR setelah dibulatkan (untuk 622af32e: 0,0995 → **0,1118,
  akan ditolak**). Tombol **"Bulatkan ke skala Saaty"** mengkanonisasi draf.
- **Tampilan** menunjukkan nilai tersimpan apa adanya ("1,25"), dengan penanda
  kuning dan tooltip "di luar skala Saaty; terdekat 1". Prinsipnya: yang tampil
  = yang tersimpan, juga untuk data lama.
- **Menulis** apa pun (mengetik sel, slider, urutan) menjalankan kanonisasi
  penuh lebih dulu (§4, aturan umum), dan kanonisasi itu dilaporkan.
- **Simpan** tetap nonaktif selama `validateAhpPairwise` tidak `ok`.

## 5. State editor dan sinkronisasi

### 5.1 State yang tersisa

| State | Jenis | Catatan |
|---|---|---|
| `value.pairwise` (prop, milik `ProgramDetailEditor`) | **data, satu-satunya** | tidak berubah |
| `mode`, `viewMode` | tampilan | |
| `pairOrder` | tampilan | urutan pertanyaan / kolom, tidak memengaruhi bobot |
| draf slider selama digeser | sementara | dibuang saat dilepas |
| urutan selama diseret | sementara | dibuang saat dilepas |
| draf digit di sel | sementara | §6 |
| `notice` (pemberitahuan pembulatan terakhir) | tampilan | |

`points` dan `rankOrder` sebagai state yang bertahan **dihapus**. Posisi slider
dan urutan dihitung dari `A` pada setiap render (`useMemo`).

Konsekuensinya, setiap perubahan di satu mode langsung tampil di ketiga mode
lain dan di lencana CR. Tidak ada jalur sinkronisasi yang perlu dijaga, karena
tidak ada yang perlu disinkronkan.

### 5.2 Modul proyeksi

`lib/ahp-input.ts`: murni, aman untuk klien, dan bisa dites tanpa browser.

```ts
canonicalize(m): { matrix, changes: SnapChange[] }         // §4 aturan umum, §4.6
pairwiseFromUpper(upper15): number[][]
setJudgment(m, hi, lo, v): { matrix, changes }             // Daftar & Matriks
sliderPositions(m): number[]                               // persen
applySlider(m, i, targetPct, direction): { matrix, changes, reachedPct }
rankGroups(m, tieBreak?): { criteria: number[]; rank: number }[]
applyOrder(m, order): { matrix, changes }
activationMatrix(): number[][]                             // §4.5
type SnapChange = { row, col, requested: number, stored: number }
```

### 5.3 Pemberitahuan

Setelah penulisan yang membulatkan, tampil satu baris yang bisa ditutup.
Contoh:
- "2 rasio dibulatkan ke skala Saaty: Karier/HAV 1,25 → 1; Behavior/HAV 1,5 → 2."
- "Behavior 36,0 % → 35,2 % setelah dibulatkan; 2 penilaian berubah."

Bila tidak ada pembulatan, tidak ada pemberitahuan.

### 5.4 Lencana, tombol Simpan, mode awal

- **Lencana** `CR = x.xxx · konsisten / TIDAK konsisten` tampil **di semua mode**,
  bersumber dari `validateAhpPairwise(A)`. Label "CR = 0 · selalu konsisten"
  dihapus karena sudah tidak benar. Bila ada isu selain CR, lencana menyebutnya
  ("2 nilai di luar skala Saaty").
- **Tombol "Simpan Bobot AHP"** nonaktif di **semua mode** bila hasil validasi
  tidak `ok`. Sekarang tombol ini hanya nonaktif di mode Berpasangan.
- **Mode awal:** Berpasangan bila matriks ada, karena hanya mode itu yang
  menampilkan penilaian sebagaimana tersimpan. Bila matriks belum ada, layar
  "Atur Bobot AHP" seperti sekarang. Aturan lama "CR > 0,01 → Berpasangan" tidak
  bermakna lagi, sebab matriks hasil snap jarang ber-CR 0.

## 6. Commit sel (keputusan 7)

`PairwiseValueInput` memegang draf lokalnya sendiri. Ketikan hanya mengubah
draf; `onChange` tidak lagi melakukan commit.

- **Commit** terjadi pada **blur** atau **Enter**, **selalu**, juga bila digitnya
  sama dengan yang tampil. Dengan begitu nilai lama 1,25 yang tampil "1,25"
  (§4.6) berubah menjadi 1 saat pakar mengetik 1 lalu keluar dari sel.
- **Escape** mengembalikan draf ke nilai tersimpan.
- Isi bukan digit 1–9 juga dikembalikan.
- Commit lewat blur terjadi sebelum `click` tombol Simpan, karena keduanya event
  diskrit yang terpisah. Urutan ini dites di browser (§10).

## 7. Penyimpanan dan validasi server

- **`saveAhpConfigAction`** (tombol "Simpan Bobot AHP") memanggil
  `validateAhpPairwise` dan menolak bila tidak `ok`. Pesannya menggabungkan
  `describeAhpIssue` untuk setiap isu.
- **`updateProgramTemplateAction`** (bar "Simpan program") memanggil fungsi yang
  sama, **dengan satu aturan tambahan yang perlu disetujui:** bila `ahpConfig`
  yang dikirim **identik** dengan yang tersimpan, validasi dilewati dan nilainya
  dibiarkan.
  - Bar ini **selalu** mengirim `ahpConfig` bersama nama, filter, dan prompt.
  - Tanpa aturan ini, program yang menyimpan matriks lama di luar S tidak bisa
    lagi menyimpan perubahan apa pun yang tidak terkait, misalnya mengganti
    nama, sampai bobot AHP-nya diperbaiki.
  - Membiarkan nilai yang tidak diubah bukan migrasi. Begitu matriksnya diubah,
    validasi penuh berlaku.
- **Yang tersimpan** adalah `{ pairwise }` 6×6 kanonik, yang ditentukan oleh 15
  nilai atas (§2.2). `config_snapshot.template.ahpConfig` menyalinnya saat run
  dibuat, seperti sekarang.

## 8. Engine, catatan run, dan trace (keputusan 2, 5, 8)

### 8.1 Penanda

Jalur scoring **tidak berubah**: `resolveAhpWeights`, `computeAhpWeights`, dan
TOPSIS tetap sama, dan CR > 0,10 tetap hanya dicatat log. Setelah
`resolveAhpWeights`, engine AHP+TOPSIS menjalankan
`validateAhpPairwise(ahpPairwise)` (fungsi yang sama) dan menulis hasilnya ke
`run_info.ahp.inputCheck` dan `trace.ahp.inputCheck`:

```ts
inputCheck: {
  ok: boolean;                       // false bila ada isu apa pun
  matrixSource: 'ahp-matrix' | 'default' | 'inherited';
  offScale: { row: string; col: string; value: number; nearest: number }[];
  reciprocal: boolean;
  crExceeded: boolean;
  cr: number;
  expected: boolean;                 // true hanya untuk 'default' (§8.3)
}
```

**Run lama** (sebelum penanda ada) tidak ditulis ulang, sesuai I-1. Pembacanya
(panel Konfigurasi Run dan lembar AHP trace) menghitung pemeriksaan yang sama
**saat dibaca**, dari matriks yang tersimpan, dan memberinya label "diperiksa
saat ditampilkan".

Bila sumbernya `run_info.ahp.pairwise` yang berpresisi 4 desimal, toleransi
skala dilonggarkan menjadi 1e-3 di ruang log dan hal itu dinyatakan. Pembulatan
4 desimal menggeser nilai Saaty paling jauh 3,0e-4 di ruang log (pada 1/7 →
0,1429), sedangkan 1,25 berjarak 0,22 dari anggota S terdekat. Jadi pelonggaran ini tidak
menyembunyikan nilai di luar S.

### 8.2 Presisi `run_info.ahp.pairwise`

Sekarang nilainya dibulatkan dengan `toFixed(4)` (`ahp-topsis-engine.ts:7600`),
sehingga 1/3 tercatat 0,3333. Untuk run baru:
- matriks disimpan **presisi penuh**;
- ditambah `pairwiseLabels: string[][]` ("1/3", "2", atau "1,25");
- ditambah `pairwisePrecision: 'full'`.

Pembaca yang sekarang mengompensasi pembulatan (`pairwiseRounded` di
`lib/run-trace/sections/ranking.ts`, `rerun-freeze`) memakai `pairwisePrecision`
untuk mengetahui bahwa kompensasi tidak diperlukan. Run lama tetap terbaca
seperti sekarang.

### 8.3 Bobot bawaan engine tidak di-snap (keputusan 5)

Program tanpa matriks memakai `pairwiseFromWeights(DEFAULT_WEIGHTS)`, sumber
`default`, dengan CR = 0 dan bobot persis 35/25/20/10/5/5. Matriks itu memuat
rasio seperti 1,4 dan 0,7143, yang **bukan** anggota S. Ini benar dan
disengaja: matriks tersebut dibentuk dari vektor bobot, bukan dari penilaian
pakar. Penandanya berisi `ok: false` dengan `expected: true`. Panel dan trace
menampilkannya sebagai *"Bobot bawaan sistem: matriks dibentuk dari vektor
bobot (wᵢ/wⱼ), bukan masukan pakar; nilai di luar skala Saaty pada matriks ini
wajar"*, bukan sebagai peringatan.

### 8.4 Tampilan penanda

- **Panel Konfigurasi Run.** Lencana "Matriks di luar skala Saaty (N sel)"
  dan/atau "CR > 0,10", beserta daftar selnya. Tampilan "Skala Saaty" memakai
  `saatyLabel`, sehingga 1,25 tetap tertulis 1,25, tidak dibulatkan.
- **Lembar AHP workbook trace.**
  - Blok "Pemeriksaan masukan matriks" berisi tabel S (17 sel). Untuk setiap
    sel atas ada label Saaty dan rumus hidup
    `=IF(SUMPRODUCT(--(ABS(LN(sel)-LN(S))<=1E-6))>0,"∈ S","di luar S")`, plus
    baris resiprokal dan CR ≤ 0,10.
  - Hasil `inputCheck` dari engine ditulis di sampingnya, dengan sel selisih.
- **AI Tournament** dulu tidak mencatat blok AHP di `run_info` (hanya log),
  sehingga tidak ada tempat untuk penanda. Metode itu beserta run-nya sudah
  dihapus (`drizzle/0097_remove_llm_tournament.sql`), jadi setiap run kini
  mencatat blok ini.

## 9. Skrip audit data lama (keputusan 9)

Berkas `scripts/audit-ahp-saaty.ts`. Ditulis di Fase 3, karena memakai fungsi
§3 yang belum ada.

```bash
DATABASE_URL=postgres://… npx tsx scripts/audit-ahp-saaty.ts --out ./audit-ahp
```

- **Hanya baca.** Semua kueri berjalan di dalam `BEGIN READ ONLY` … `ROLLBACK`,
  sehingga Postgres sendiri menolak penulisan apa pun. Skrip tidak memuat
  `INSERT`, `UPDATE`, atau `DELETE`, dan tidak mengimpor `lib/db` (yang
  memasang hook waktu).
- **Sumber (a):** `program_templates` dengan `ahp_config IS NOT NULL`. Kolom:
  `id`, tenant, `code`, nama, `updated_at`.
- **Sumber (b):** `scoring_runs` dengan
  `config_snapshot->'template'->'ahpConfig'->'pairwise'` ada. Kolom: `id`,
  label, `created_at`, status, metode, program. Bila tersedia, juga
  `run_info->'frozen'->'ahp'->'pairwise'` sebagai "matriks yang dipakai engine",
  dengan penanda bila berbeda dari snapshot. Engine membaca template saat
  scoring, bukan snapshot, sehingga keduanya bisa berbeda bila governance diubah
  di antara pembuatan run dan scoring.
- **Kolom hasil, per baris:**
  - sel di luar S, ditulis sebagai `Karier/HAV=1.25→1; …`;
  - resiprokal (ya/tidak, beserta deviasi maksimum);
  - diagonal (ya/tidak);
  - CR asli dan status lolos/tidak;
  - CR setelah snap dan status lolos/tidak;
  - 6 bobot sebelum snap dan 6 bobot sesudah snap;
  - Δ bobot terbesar.
- **Keluaran:** `ahp-audit-programs.csv`, `ahp-audit-runs.csv`, dan
  `ahp-audit.md`. Berkas Markdown berisi ringkasan jumlah per kategori: kanonik,
  di luar S tetapi tetap lolos setelah snap, di luar S dan **gagal** setelah
  snap (kasus 622af32e), serta tidak resiprokal. Disusul tabel baris yang
  bermasalah.
- **Matriks bawaan** tidak ikut diaudit, karena tidak tersimpan di
  `program_templates` dan memang bukan masukan pakar.

## 10. Invarian dan pengujian (Fase 4)

Invarian yang dijaga:

- **INV-1** Setelah setiap penulisan dari editor, ke-30 sel non-diagonal ∈ S.
- **INV-2** Matriks resiprokal secara eksak (dari tabel) dan diagonalnya 1.
- **INV-3** Nilai tampil = nilai tersimpan = nilai yang divalidasi, di keempat
  tampilan.
- **INV-4** Bobot, CR, posisi slider, dan urutan = turunan matriks dengan rumus
  baku (snap-back).
- **INV-5** Satu perubahan di satu mode langsung terlihat di tiga mode lain dan
  di lencana.
- **INV-6** Berpindah mode tidak mengubah matriks.

| Kebutuhan | Tempat |
|---|---|
| Unit: snap (1,25 → 1; 1,5 → 2; √2 → 1 karena seri; 2,45 → 3 di ruang log; 12 → 9; 0,05 → 1/9), resiprositas, `validateAhpPairwise` untuk setiap isu, bobot/λ/CR Acuan A dan B (tol. 1e-4), snap(B) = A | `tests/governance/ahp-input.test.ts` (baru) |
| Round-trip: Daftar → matriks → Daftar identik; matriks → slider → matriks identik untuk matriks kanonik; 720 urutan tanpa pembalikan; INV-1/INV-2 untuk setiap penulis | sama |
| `scripts/verify-ahp-modes.ts` **ditulis ulang** dengan invarian INV-1…INV-6 secara exhaustive: 720 urutan, sapuan slider per kriteria dari tiga matriks awal, setiap judgment 1–9 di setiap sel, kanonisasi Acuan B | skrip |
| Browser: perubahan di Urutan, Slider (mouse dan panah), Daftar, dan sel Matriks memperbarui tiga tampilan lain dan lencana dari matriks yang sama; commit saat blur/Enter walau digitnya sama; blur sebelum klik Simpan; tes Fase 1 berubah hijau | `tests/governance/*.browser.test.ts` |
| Ujung ke ujung: simpan dari UI → scoring → lembar AHP trace = nilai yang tampil di UI, semua sel ∈ S, bobot engine = bobot rumus (Δ = 0) | lihat di bawah |
| Regresi: `test:scoring`, tes scoring-service, `tsc` web (baseline 52) dan scoring-service (0) | yang ada |

**Catatan uji ujung ke ujung.** Container ini tidak punya akses ke basis data
Anda, tetapi Postgres 16 terpasang. Rencananya:
1. Membuat klaster lokal sementara, menjalankan migrasi Drizzle, dan seed fixture.
2. Menyimpan dari editor lewat server dev Next (Keycloak tidak dikonfigurasi,
   jadi berjalan sebagai System User).
3. Menjalankan scoring-service terhadapnya.

Tanpa model yang bisa dihubungi, aspek berbasis model terdegradasi, tetapi
bobot AHP dan trace tidak bergantung pada model. Bila salah satu langkah
ternyata tidak bisa dijalankan di sini, saya laporkan langkah mana dan apa yang
sudah terbukti, bukan mengklaim lulus.

Tes baru didaftarkan sebagai `pnpm test:governance` (tes murni dan SSR) dan
`pnpm test:governance:browser` (butuh Chromium Playwright yang sudah terpasang).

## 11. Berkas yang akan diubah di Fase 3

| Berkas | Perubahan |
|---|---|
| `scoring-service/src/ahp-saaty.ts` (baru) | §3 |
| `scoring-service/src/ahp.ts` | komentar `isValidPairwise`; perilaku tetap |
| `lib/ahp.ts` | re-export §3; komentar `isValidPairwise`; (opsional §3.4) re-export rumus; `rankSumWeights` dan `pairwiseFromRankOrder` dihapus karena tidak dipakai lagi |
| `lib/ahp-input.ts` (baru) | proyeksi §5.2 |
| `components/governance/governance-ahp-editor.tsx` | state §5, proyeksi §4, tampilan §4.1–4.2, input §6, banner §4.6 |
| `lib/program-actions.ts` | kedua aksi memakai `validateAhpPairwise`; aturan "tidak diubah" §7 |
| `scoring-service/src/ahp-topsis-engine.ts` | `inputCheck`; presisi penuh dan label §8.2 |
| `scoring-service/src/run-trace-types.ts` | tipe `inputCheck` dan label |
| `lib/run-trace/sections/ranking.ts` | blok pemeriksaan §8.4; `pairwisePrecision` |
| `components/analysis/run-configuration-panel.tsx` | lencana dan daftar sel §8.4; pemeriksaan saat dibaca untuk run lama |
| `.dockerignore` | whitelist `ahp-saaty.ts`, `ahp.ts` |
| `scripts/verify-ahp-modes.ts` | ditulis ulang (§10) |
| `scripts/audit-ahp-saaty.ts` (baru) | §9 |
| `tests/governance/*` | §10; `package.json`: `test:governance`, `test:governance:browser` |
| `docs/katalog-tombol.md`, `docs/panduan-fitur-halaman.md` | klaim "Urutan/Slider selalu CR = 0", angka rank-sum 28,6 %…, dan slider 1–10 sudah tidak benar |
| `docs/metodologi-laporan-scoring.md` §AHP | "mode Sederhana yang selalu konsisten" diganti. Klaim CR = 0 untuk matriks dari vektor bobot tetap benar untuk bobot bawaan (§8.3) |
| `CLAUDE.md` | satu paragraf: matriks kanonik di S, satu fungsi validasi, penanda engine |

Keempat dokumen yang punya salinan Word tidak menyebut mekanisme mode secara
rinci. Bila ada yang ikut diubah, `.docx`-nya diregenerasi di commit yang sama.

## 12. Butir yang menunggu persetujuan

1. **Slider menulis hanya baris/kolom kriteria yang digeser** (§4.3), bukan
   ke-15 penilaian.
2. **Aturan "tidak diubah → tidak divalidasi" di `updateProgramTemplateAction`**
   (§7), agar program dengan matriks lama tetap bisa menyimpan perubahan lain.
3. **Satu implementasi lintas deployable**: `scoring-service/src/ahp-saaty.ts`
   diimpor web, dan (opsional) `lib/ahp.ts` me-re-export rumus dari
   scoring-service (§3.1, §3.4).
4. **`isValidPairwise` tetap struktural, komentarnya yang diperbaiki** (§3.4),
   karena memperketatnya akan membuat engine diam-diam memakai bobot bawaan.
5. **Slider dalam persen 2–65 %, commit saat dilepas, maju ke titik berubah
   berikutnya** (§4.3); poin 1–10 dihapus.
6. **Mode awal Berpasangan bila matriks ada** (§5.4).
7. **Uji ujung ke ujung di Postgres lokal sementara** (§10).
