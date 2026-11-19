# Katalog kalimat penjelasan perbandingan run (T-01 sampai T-11)

Dokumen ini menjelaskan setiap kalimat yang dapat muncul di bagian "Mengapa A
dan B berbeda" pada tab "Komparasi Versi" (dulu "Perbandingan Run") di halaman posisi (dulu halaman `/positions/[id]/compare`, yang kini mengalihkan ke tab itu), di
panel "Selisih Peringkat" pada halaman run, dan di lembar "Kalimat penjelasan"
pada ekspor XLSX. Kebutuhan yang dijawab adalah FR-CMP-09 dan NF-2.

Implementasinya ada di `lib/run-compare-explain.ts` (`explainComparison`).
Setiap templat memiliki tes di `tests/scoring/run-compare.test.ts`, kelompok
`TC-CMP-TPL`. Bila kode dan dokumen ini berbeda, kode yang berlaku dan dokumen
ini yang harus diperbarui.

## 1. Aturan umum

1. **Tidak ada model bahasa.** Setiap kalimat adalah templat yang diisi fakta
   hasil `compareRuns(a, b)`: peringkat, kecocokan, bobot efektif, nilai
   aspek, pemegang nilai tertinggi dan terendah, pembagi normalisasi, dan
   rincian jarak per kriteria. Narasi model bahasa yang tersimpan pada sebuah
   run tidak pernah dibaca sebagai sumber kalimat (FR-RR-14).
2. **Keterulangan.** Perbandingan yang sama selalu menghasilkan kalimat yang
   sama, dalam urutan yang sama (NF-2). Tes `the catalog is complete, and the
   same comparison always yields the same sentences` memeriksanya pada 42
   pasangan run.
3. **Istilah.** Kalimat memakai istilah pengguna. "Nilai tertinggi di pool"
   adalah ideal positif, "nilai terendah di pool" adalah ideal negatif,
   "kecocokan" adalah koefisien kedekatan TOPSIS, dan "pembagi normalisasi"
   adalah akar jumlah kuadrat satu kolom kriteria. Normalisasi yang dipakai
   modul TOPSIS (`scoring-service/src/topsis.ts`) memang normalisasi vektor,
   sehingga istilah "pembagi" tepat.
4. **Format angka (id-ID).** Kecocokan ditulis sebagai persen satu desimal
   ("82,4%"), selisih kecocokan dalam poin persen dengan tanda ("+1,3 pp",
   "−2,7 pp"), bobot sebagai persen dua desimal ("25,00%"), nilai aspek pada
   skala aslinya dengan satu desimal ("74,5"), dan rasio pembagi dengan dua
   desimal ("1,08 kali"). Tanda minus adalah karakter "−" (U+2212).
5. **Daftar.** Dua butir digabung dengan "dan", tiga butir atau lebih dengan
   koma dan "dan" sebelum butir terakhir. Butir yang memuat koma desimal
   dipisah dengan titik koma, supaya "70,0" tidak terbaca sebagai dua butir.
   Daftar dipotong pada lima nama, lalu ditutup dengan "dan N lainnya".
6. **Urutan keluaran.** Kalimat ringkasan muncul dalam urutan T-10, T-01,
   T-08, T-06, T-09, T-07, T-11, kemudian T-02 dan T-03 per kriteria, lalu
   T-04. Kalimat T-05 dibuat per kandidat dan tampil pada baris kandidat itu.

## 2. Ambang penyebutan

Perubahan di bawah ambang tetap nyata dan tetap terlihat di tabel; yang
diputuskan ambang hanyalah apakah perubahan itu layak menjadi kalimat.
Nilainya ada di konstanta `MENTION_THRESHOLDS`.

| Ambang | Nilai | Dipakai oleh | Alasan |
|---|---|---|---|
| Kecocokan | 5 × 10⁻⁷ | T-01 | Presisi kecocokan yang tersimpan adalah `numeric(10,6)`. Selisih di bawah setengah digit terakhir bukan perubahan. |
| Rasio pembagi | \|r − 1\| ≥ 0,005 (0,5%) | T-04 | Pergeseran pembagi di bawah 0,5% tidak mengubah besar sumbangan kriteria secara berarti. |
| Bobot efektif | ≥ 0,005 pp | T-06 | Bobot ditampilkan dengan dua desimal persen; perubahan yang tidak terlihat pada dua desimal tidak disebut. |
| Nilai aspek | ≥ 0,05 poin (skala 0–100) | T-07, T-02, T-03 | Aspek ditampilkan dengan satu desimal; perubahan di bawah setengah digit tidak terlihat. Ambang yang sama mencegah T-02/T-03 menyebut "pemegang baru" untuk nilai ekstrem yang tidak bergeser. |
| Sumbangan per kriteria | ≥ 1% dari (D⁺² + D⁻²) kandidat di run B | T-05 | Jarak terbobot kuadrat adalah bilangan kecil (umumnya 10⁻⁵ sampai 10⁻³), sehingga ambang mutlak akan menyembunyikan hampir semuanya. Ambang relatif menjawab apakah kriteria itu berarti bagi kandidat ini. |
| Panjang daftar | 5 nama | semua | Kalimat tetap dapat dibaca di forum; nama selebihnya ada di tabel. |

## 3. Katalog

Contoh di bawah berasal dari dua sumber. Contoh bertanda **(tes)** adalah
keluaran yang dipastikan oleh tes dengan fixture hitung tangan (kandidat X, Y,
Z, W, V). Contoh bertanda **(fixture)** adalah keluaran nyata pada database
lokal yang diisi `scripts/seed-rerun-fixtures.ts`: R1 dan R2 adalah dua run
root, C1 adalah turunan "Tambah Kandidat Pembanding" dari R1, dan L1 adalah run
mode lama.

### T-01 — Tidak ada perubahan angka

- **Muncul bila:** semua kandidat ada di kedua run, tidak ada peringkat yang
  berubah, dan tidak ada kecocokan yang bergeser melebihi ambang.
- **Bentuk:** "Tidak ada perubahan angka: peringkat dan kecocokan setiap
  kandidat sama di A dan B." Pada pasangan induk dan turunan Tambah Kandidat
  Pembanding ditambahkan ", karena semua kandidat yang diminta sudah ada di
  pool induk".
- **Contoh (tes):** "Tidak ada perubahan angka: peringkat dan kecocokan setiap
  kandidat sama di A dan B, karena semua kandidat yang diminta sudah ada di pool
  induk."
- **Tes:** `T-01 + T-10: nothing moved — and why, on a child whose candidates
  were all in the pool already`.

### T-02 — Pemegang baru nilai tertinggi

- **Muncul bila:** pada kriteria yang aktif di kedua run, nilai tertinggi di
  pool bergeser sedikitnya 0,05 poin dan dipegang kandidat yang tidak
  memegangnya di run A. Kandidat yang sekadar ikut memegang nilai tertinggi yang
  tidak berubah tidak disebut, karena hal itu tidak menggeser ideal.
- **Bentuk:** "{nama}[, kandidat pembanding,] kini memegang nilai tertinggi
  {kriteria} ({nilai B}; sebelumnya {nilai A} milik {pemegang A})." Penanda
  "kandidat pembanding" hanya dipakai pada pasangan induk dan turunan.
- **Contoh (fixture, R1 → C1):** "Sari Wulandari, kandidat pembanding, kini
  memegang nilai tertinggi Kompetensi Teknis (88,0; sebelumnya 80,0 milik Budi
  Santoso)."
- **Tes:** `T-02, T-04, T-05, T-08, T-10 on the hand fixture`.

### T-03 — Pemegang baru nilai terendah

- **Muncul bila:** sama seperti T-02, untuk nilai terendah di pool.
- **Bentuk:** "{nama}[, kandidat pembanding,] kini memegang nilai terendah
  {kriteria} ({nilai B}; sebelumnya {nilai A} milik {pemegang A})."
- **Contoh (tes):** "V, kandidat pembanding, kini memegang nilai terendah
  Kompetensi Teknis (10,0; sebelumnya 20,0 milik X)."
- **Tes:** `T-03: a comparison candidate now holds the lowest value`.

### T-04 — Pembagi normalisasi berubah

- **Muncul bila:** pada kriteria yang aktif di kedua run, rasio pembagi B/A
  menyimpang dari 1 sedikitnya 0,5%. Kriteria dikelompokkan menurut arah:
  satu kalimat untuk yang naik dan satu untuk yang turun.
- **Bentuk:** "Pembagi normalisasi {naik|turun} pada {kriteria (r kali), …},
  sehingga selisih pada kriteria itu menyumbang lebih {kecil|besar} terhadap
  jarak." Bila lebih dari satu kriteria, dipakai "kriteria-kriteria itu".
- **Contoh (fixture, R1 → C1):** "Pembagi normalisasi naik pada Kompetensi
  Teknis (1,08 kali), Relevansi Karier (1,06 kali), Behavior (1,04 kali),
  Performance Appraisal (1,04 kali), HAV (1,06 kali), dan Pendidikan (1,04
  kali), sehingga selisih pada kriteria-kriteria itu menyumbang lebih kecil
  terhadap jarak."
- **Catatan:** inilah wujud sifat relatif TOPSIS. Menambah satu kandidat
  menaikkan akar jumlah kuadrat setiap kolom, sehingga nilai ternormalisasi
  semua kandidat lama mengecil walaupun nilai mentahnya tetap.
- **Tes:** `T-02, T-04, T-05, T-08, T-10 on the hand fixture`.

### T-05 — Pergeseran peringkat satu kandidat

- **Muncul bila:** kandidat ada di kedua run dan peringkatnya berubah, atau
  status finalisnya berubah (masuk atau keluar dari N besar).
- **Bentuk:** "Peringkat {nama} {naik|turun} {n} tingkat, dari {A} ke {B}
  (kecocokan {A} → {B}, {Δ pp})[ dan kini masuk N besar | dan kini keluar dari
  N besar]. Penyumbang terbesar: {kriteria} ({arah}); {kriteria} ({arah})."
  Bila peringkat tetap tetapi status finalis berubah, kalimatnya dimulai dengan
  "Peringkat {nama} tetap {B}".
- **Penyumbang:** dua kriteria dengan perubahan sumbangan terbesar terhadap
  jarak kuadrat, |Δ(v − ideal⁺)²| + |Δ(v − ideal⁻)²|, yang lolos ambang 1%.
  Bila tidak ada yang lolos, bagian "Penyumbang terbesar" tidak ditulis.
- **Arah**, dari tanda perubahan jarak kuadrat ke nilai tertinggi (D⁺) dan ke
  nilai terendah (D⁻):

  | D⁺ | D⁻ | Frasa |
  |---|---|---|
  | naik | turun | menurunkan kecocokan: lebih jauh dari nilai tertinggi dan lebih dekat ke nilai terendah |
  | turun | naik | menaikkan kecocokan: lebih dekat ke nilai tertinggi dan lebih jauh dari nilai terendah |
  | turun | turun | selisih pada kriteria ini menyempit: lebih dekat ke nilai tertinggi maupun terendah |
  | naik | naik | selisih pada kriteria ini melebar: lebih jauh dari nilai tertinggi maupun terendah |
  | naik | tetap | menurunkan kecocokan: lebih jauh dari nilai tertinggi |
  | turun | tetap | menaikkan kecocokan: lebih dekat ke nilai tertinggi |
  | tetap | turun | menurunkan kecocokan: lebih dekat ke nilai terendah |
  | tetap | naik | menaikkan kecocokan: lebih jauh dari nilai terendah |

  "Menyempit" dan "melebar" berarti rentang kriteria itu sendiri berubah
  (pembagi atau ideal bergeser), bukan nilai kandidatnya.
- **Contoh (fixture, R1 → C1):** "Peringkat Gita Permata turun 1 tingkat, dari
  6 ke 7 (kecocokan 66,1% → 63,1%, −2,9 pp) dan kini keluar dari N besar.
  Penyumbang terbesar: Kompetensi Teknis (menurunkan kecocokan: lebih jauh dari
  nilai tertinggi dan lebih dekat ke nilai terendah); Behavior (menurunkan
  kecocokan: lebih dekat ke nilai terendah)."
- **Tes:** `T-02, T-04, T-05, T-08, T-10 on the hand fixture` (memuat
  perhitungan tangan di komentarnya).

### T-06 — Bobot efektif berubah

- **Muncul bila:** bobot efektif sesudah pembagian ulang (Pers. 2.12) suatu
  kriteria berubah sedikitnya 0,005 poin persen. Pada pasangan induk dan
  turunan Tambah Kandidat Pembanding kalimat ini tidak boleh muncul; bila
  muncul, halaman juga menampilkan peringatan pelanggaran pembekuan.
- **Bentuk:** "Bobot efektif berubah: {kriteria} {A} → {B} ({Δ pp}); …."
- **Contoh (fixture, R1 → R2):** "Bobot efektif berubah: Kompetensi Teknis
  25,00% → 40,00% (+15,00 pp); Relevansi Karier 5,00% → 10,00% (+5,00 pp);
  Behavior 35,00% → 25,00% (−10,00 pp); dan HAV 20,00% → 10,00% (−10,00 pp)."
- **Tes:** `T-06: the weights changed between roots`.

### T-07 — Nilai aspek berubah

- **Muncul bila:** kandidat yang ada di kedua run memiliki nilai aspek yang
  berbeda sedikitnya 0,05 poin. Ini terjadi antar-root atau terhadap run mode
  lama, karena turunan Tambah Kandidat Pembanding membekukan keenam aspek
  kandidat lama.
- **Bentuk:** "Nilai aspek {n} kandidat berubah — {nama}: {kriteria} {A} →
  {B}, …; …."
- **Contoh (fixture, R1 → L1):** "Nilai aspek 1 kandidat berubah — Eko
  Nugroho: Performance Appraisal 67,0 → 100,0."
- **Tes:** `T-07: aspect values changed between roots`.

### T-08 — Keanggotaan pool berubah

- **Muncul bila:** ada kandidat yang hanya ada di salah satu run.
- **Bentuk:** "Keanggotaan pool berubah — +{n} di B: {nama} ({sebab}); …;
  −{m} dari A: …." Sebab hanya ditulis bila dapat ditentukan dari data
  tersimpan: kandidat pembanding yang ditambahkan, kandidat pembanding di luar
  rentang grade yang ditambahkan dengan konfirmasi, tidak lolos aturan filter
  di run lain (beserta aturannya, dan catatan bila aturan kedua run berbeda),
  data kini dihapus, atau kini pejabat. Bila tidak dapat ditentukan, sebab
  tidak ditulis; tabel Pool menyatakan "Sebab tidak tercatat pada data
  tersimpan".
- **Contoh (fixture, R1 → C1):** "Keanggotaan pool berubah — +1 di B: Sari
  Wulandari (kandidat pembanding yang ditambahkan di run B)."
- **Contoh (fixture, R1 → R2):** "Keanggotaan pool berubah — +2 di B: Sari
  Wulandari dan Teguh Prakoso; −1 dari A: Lukman Hakim."
- **Tes:** `T-02, T-04, T-05, T-08, T-10 on the hand fixture`, serta
  `TC-CMP-POOL`.

### T-09 — Kriteria aktif berbeda

- **Muncul bila:** suatu kriteria aktif di satu run dan dibuang di run lain
  (misalnya karena tidak ada kandidat yang dapat dinilai pada kriteria itu).
- **Bentuk:** "Kriteria aktif berbeda: {kriteria} {aktif di A tetapi dibuang
  di B | dibuang di A tetapi aktif di B}; …, sehingga bobotnya dibagi ulang di
  antara kriteria yang aktif (Pers. 2.12)."
- **Contoh (tes):** "Kriteria aktif berbeda: HAV dibuang di A tetapi aktif di
  B, sehingga bobotnya dibagi ulang di antara kriteria yang aktif (Pers.
  2.12)."
- **Tes:** `T-09: the active criteria differ, so the weights were
  redistributed`.

### T-10 — Ringkasan sumber perubahan

- **Selalu muncul**, sebagai kalimat pertama.
- **Bentuk:** "Perbedaan A dan B bersumber dari perubahan data atau himpunan
  ({S1, S3, S4 yang berbeda}) dan perubahan konfigurasi atau pertimbangan ({S2,
  S5 yang berbeda})." Bila tidak ada sumber yang berbeda: "Tidak ada sumber
  perubahan: pool, bobot, nilai aspek, penanda skor sementara, dan konfigurasi penyajian A
  dan B sama."
- **Pengelompokan:** S1 (komposisi pool), S3 (nilai enam aspek), dan S4
  (penanda skor sementara) dibaca sebagai perubahan data atau himpunan; S2
  (bobot dan kriteria aktif) dan S5 (aturan filter, ambang readiness, jumlah
  finalis) sebagai perubahan konfigurasi atau pertimbangan.
- **Contoh (fixture, R1 → R2):** "Perbedaan A dan B bersumber dari perubahan
  data atau himpunan (komposisi pool dan nilai enam aspek) dan perubahan
  konfigurasi atau pertimbangan (bobot dan kriteria aktif)."
- **Tes:** tes T-01 dan tes T-06 di atas.

### T-11 — Penanda skor sementara berbeda

- **Muncul bila:** untuk kandidat yang ada di kedua run, penanda skor sementara
  berbeda.
- **Bentuk:** "Penanda skor sementara berbeda untuk {n} kandidat: {nama}
  ({terukur|sementara} di A, {terukur|sementara} di B); …."
- **Contoh (tes):** "Penanda skor sementara berbeda untuk 1 kandidat: X
  (terukur di A, sementara di B)."
- **Tes:** `T-11: the provisional flag differs`.

## 4. Yang sengaja tidak dijelaskan dengan kalimat

- **Atribusi bertahap** (FR-CMP-10) disajikan sebagai tabel di tab Atribusi,
  bukan kalimat, karena besar pengaruh tiap langkah bergantung pada urutan
  langkahnya. Urutannya tetap (bobot dan kriteria aktif → nilai aspek →
  keanggotaan pool) dan dinyatakan di halaman.
- **Narasi model bahasa** per kandidat tetap tersimpan pada run asalnya dan
  diberi label sumbernya, tetapi tidak pernah menjadi bahan kalimat di atas.
