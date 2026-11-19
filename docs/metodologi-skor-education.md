# Metodologi Skor Kriteria Education (AHP + TOPSIS)

Dokumen ini menjabarkan cara skor aspek **Education** dihitung oleh kode yang
sedang berjalan, beserta alasan di balik setiap rumus. Semua isinya ditelusuri
dari kode.

| Bagian | Berkas sumber |
|---|---|
| Orkestrasi aspek, sumber syarat, jalur penilaian | `scoring-service/src/ahp-topsis-engine.ts` (`scoreEducationAspect`) |
| Tangga jenjang & perbandingan level | `ahp-topsis-engine.ts` (`EDU_LEVEL_RANK`, `eduTokens`, `compareEducationLevel`) |
| Exact match jenjang + jurusan | `ahp-topsis-engine.ts` (`exactEducationMatch`, `MAJOR_SYNONYM`) |
| Prompt & pemanggilan Gemini, penggabungan skor | `ahp-topsis-engine.ts` (`EDUCATION_PROMPT_DEFAULT`, `evaluateEducationWithGemini`, `composeEducationScore`) |
| Klien Gemini + Grounding, parser JSON | `scoring-service/src/gemini.ts` |
| Prompt yang bisa diedit | `lib/scoring-prompts.json` → `ahp_education_grounded` (Tata Kelola → Prompt Scoring) |
| Penurunan ulang tier untuk run lama | `lib/education-tier.ts` (salinan aturan di web app) |

---

## 0. Gambaran besar

```
Syarat pendidikan jabatan (teks)          Pendidikan kandidat (jenjang | jurusan)
                │                                         │
                └──────────── SUMBU JENJANG (aturan) ─────┘
                       tangga SD … S3 → lebih tinggi 100 · setara 80 · lebih rendah 50
                                        │
            ┌──── jenjang memenuhi DAN jurusan exact match? ────┐
            │ YA                                                │ TIDAK
   Skor = tier jenjang                    Gemini + Grounding with Google Search
   (100 / 80)                             menilai relevansi terhadap tanggung jawab,
   tanpa panggilan model                  indikator keberhasilan & tujuan jabatan
                                          → sumbu relevansi = (jenjang_LLM + jurusan_LLM)/2
                                          Skor = (tier jenjang + sumbu relevansi) / 2
                                                │
                                gagal semua / tidak ada data → 0 "tidak dinilai"
```

Perbedaan utama terhadap ringkasan legacy:

1. **Jenjang selalu dinilai dengan aturan**, di kedua jalur, dan tidak pernah
   oleh model. Jawaban model soal jenjang masuk ke sumbu **relevansi**.
2. **Exact match tidak memakai Gemini.** Grounding hanya dipakai bila exact match
   gagal.
3. **Tabel 2.6 adalah kasus khusus** dari rumus `(tier jenjang + sumbu
   relevansi)/2`. Sumbu relevansinya kontinu (0..100), bukan hanya 100 atau 40,
   dan ada baris ketiga untuk jenjang **lebih rendah**.
4. **Gemini tidak dipanggil ulang untuk pertanyaan yang sudah terjawab.** Bila run
   terakhir posisi yang sama sudah menanyakan hal yang persis sama tentang kandidat
   itu, jawabannya dipakai ulang (§4.5), sehingga masukan yang sama selalu
   menghasilkan skor yang sama.

---

## 1. Sumber syarat pendidikan jabatan

Diambil dari sumber pertama yang tersedia:

| Urutan | Sumber |
|---|---|
| 1 | `jobSpecification.education` job profile target, misalnya "Minimal S1 Teknik Informatika / Sistem Informasi" |
| 2 | `critical_positions.education`, yaitu field Pendidikan di form posisi (biasanya disalin dari job profile, dan bisa diedit) |
| 3 | **pendidikan + jurusan incumbent** (dari tabel `candidates`, termasuk yang sudah dihapus dari daftar Kandidat) |

Job profile target dicari dengan `findJobProfileForPosition`: pemetaan Job
Family → judul persis → substring judul → kemiripan embedding judul (≥ 0,80;
0,98 untuk model E5). Dari job profile yang sama juga diambil **tujuan jabatan**
dan **tanggung jawab beserta indikator keberhasilannya** untuk jalur Gemini.

**Justifikasi tier incumbent.** Bila tidak ada yang menyatakan syaratnya, orang
yang sedang menjalankan pekerjaan itu adalah satu-satunya tolok ukur. Tanpa tier
ini, posisi tanpa job profile akan menilai semua kandidat terhadap syarat kosong
yang mustahil di-exact-match. Kandidat yang sudah dihapus tetap dibaca, karena
incumbent justru orang yang paling sering dihapus dari daftar Kandidat. Bila
tolok ukurnya hilang, education bisa jatuh menjadi "tidak dinilai" untuk semua
orang, dan bobot AHP-nya akan dibagi ulang.

---

## 2. Sumbu jenjang (selalu dengan aturan)

### 2.1 Normalisasi teks

`eduTokens` menyeragamkan penulisan sebelum teks dipecah menjadi token:
`S-1` / `S 1` / `S.1` → `s1`; `Strata 1` → `strata1`; `Ahli Madya` →
`ahlimadya`; `Sarjana Terapan` → `d4`; `SENIOR HIGH SCHOOL` → `sma`;
`JUNIOR HIGH SCHOOL` → `smp`; `VOCATIONAL SCHOOL` → `smk`;
`ELEMENTARY SCHOOL` → `sd`.

### 2.2 Tangga jenjang (`EDU_LEVEL_RANK`)

| Peringkat | Token |
|---|---|
| 1 | sd, elementary |
| 2 | smp, sltp, mts |
| 3 | sma, smk, slta, stm, man, smea, aliyah |
| 4 | d1 |
| 5 | d2 |
| 6 | d3, diploma, ahlimadya |
| 7 | *(sengaja kosong)* |
| **8** | **d4, s1**, sarjana, bachelor, strata1 |
| 9 | s2, magister, master, pascasarjana |
| 10 | s3, doktor, doctoral, phd |

Peringkat kandidat = token jenjang **tertinggi** yang muncul di teks
pendidikannya.

### 2.3 Perbandingan (`compareEducationLevel`)

- Syarat dibaca sebagai **minimum** bila mengandung kata `minimal`, `min`,
  `setidaknya`, atau `paling rendah`. Kandidat lalu dibandingkan dengan jenjang
  **terendah** yang disebut syarat: lebih tinggi / setara / lebih rendah.
- Syarat **bukan minimum**: kandidat dihitung setara bila peringkatnya termasuk
  salah satu jenjang yang disebut, lebih tinggi bila di atas jenjang tertinggi,
  dan lebih rendah selain itu.
- Bila syarat atau kandidat tidak menyebut jenjang yang dikenali, **tidak ada
  perbandingan** dan sumbu jenjang dibuang (§5).

| Hasil | Skor tier |
|---|---|
| lebih tinggi | **100** |
| setara | **80** |
| lebih rendah | **50** |

**Justifikasi.**
- **Jenjang dinilai dengan aturan, bukan model.** Ini sekadar perbandingan
  tangga atas data yang sudah dinormalisasi; tidak ada yang perlu ditafsirkan
  model. Dulu aturan ini hanya berlaku bila jurusannya juga exact match.
  Kandidat yang masuk jalur Gemini dinilai jenjangnya oleh model, sehingga
  prinsip "di atas syarat minimum lebih bernilai daripada sekadar setara"
  berlaku di satu jalur dan diam-diam ditimpa di jalur lain. Penentu jalurnya
  pun hal yang tidak berhubungan, yaitu cocok tidaknya jurusan.
- **Setara = 80, bukan potongan nilai.** 80 adalah nilai penuh untuk "tepat
  memenuhi syarat". 100 disediakan untuk jenjang di atas syarat.
- **D4 = S1** karena keduanya berada di KKNI level 6. Dulu D4 diberi peringkat 7,
  sehingga setiap pemegang D4 dikirim ke Gemini untuk ~60 job profile yang
  meminta S1.
- **Label bahasa Inggris** ditambahkan karena sumber HR menyimpan `SENIOR HIGH
  SCHOOL` dan sejenisnya. Sebelumnya 318 dari 806 kandidat aktif (39%) mendapat
  peringkat 0.
- **`sederajat` tidak diberi peringkat.** Dulu kata ini diberi peringkat 3,
  sehingga "Minimal S1 atau sederajat" menghasilkan [8, 3]. Karena cabang
  minimum mengambil yang terendah, lulusan SMA dianggap memenuhi syarat S1.

---

## 3. Jalur 1 — Exact match (tanpa model)

Exact match terjadi bila **keduanya** terpenuhi:

1. **Jenjang memenuhi**: hasil §2.3 adalah lebih tinggi atau setara. Jenjang
   lebih rendah tidak pernah exact match.
2. **Jurusan memenuhi**, dengan salah satu kondisi berikut:
   - syarat menyebut `semua` / `any` / `all` (jurusan), **atau**
   - syarat hanya menyebut jenjang tanpa jurusan, **atau**
   - **seluruh token** dari **salah satu alternatif** jurusan di syarat ada di
     jurusan kandidat.

Cara memecah jurusan di syarat:
- klausa dalam kurung dibuang terlebih dahulu (misalnya "(diutamakan X)");
- pemisah alternatif: `/`, `,`, `;`, `atau`, `or`;
- token jenjang dan stopword dibuang (`minimal`, `jurusan`, `bidang`,
  `relevan`, `terkait`, dan sejenisnya);
- istilah bahasa Inggris dan variasi ejaan diseragamkan dengan `MAJOR_SYNONYM`
  (`accounting` → `akuntansi`, `management` → `manajemen`, `economic` →
  `ekonomi`, `engineering` → `teknik`, `information` → `informasi`, dan
  seterusnya).

**Skor exact match = tier jenjang**: 100 bila lebih tinggi, 80 bila setara. Model
tidak dipanggil.

**Justifikasi.**
- **Semua token dari satu alternatif, bukan cukup satu token.** Aturan lama
  menerima satu token yang beririsan, sehingga "Manajemen Informatika" vs
  "Teknik Informatika" dianggap identik karena sama-sama memuat `informatika`.
  Sekarang pasangan itu dikirim ke Gemini. Sebaliknya "Sistem Informasi" vs
  "Manajemen Informatika" tetap dinilai benar oleh Gemini walaupun tidak berbagi
  token sama sekali.
- **Per alternatif**, karena "S1 Ekonomi / Manajemen / Akuntansi" berarti salah
  satu dari tiga, bukan ketiganya sekaligus.
- **Arahnya disengaja**: token syarat harus ada di jurusan kandidat, bukan
  sebaliknya. Syarat "Informatika" dipenuhi oleh "Manajemen Informatika", tetapi
  syarat "Manajemen Informatika" tidak dipenuhi oleh "Informatika" saja.
- **Kurung dibuang** karena semua klausa dalam kurung di korpus ini adalah
  preferensi. Kalau ikut dihitung, aturan "semua token" akan membuat preferensi
  itu menjadi wajib.
- **Sinonim** dibutuhkan karena sumber HR menyimpan jurusan dalam bahasa Inggris
  (`ACCOUNTING` 61 kandidat, `MANAGEMENT` 57, `ECONOMIC` 28), sedangkan JD
  ditulis dalam bahasa Indonesia. Yang diseragamkan hanya terjemahan kata per
  kata dan salah eja yang benar-benar teramati; bidang yang hanya terdengar mirip
  tetap dibedakan (`informatika` ≠ `sistem informasi`).
- Diukur atas 806 kandidat × 113 syarat: aturan satu-token memberi exact match
  40,0%, aturan semua-token 37,4% (selisih 2,6 poin adalah positif palsu yang
  terkoreksi), dan dengan sinonim 38,9%.

---

## 4. Jalur 2 — Gemini dengan Grounding with Google Search

Dipakai bila exact match gagal, kandidat punya data pendidikan **atau** jurusan,
dan `GEMINI_API_KEY` terpasang.

### 4.1 Masukan ke model

- **System prompt**: rubrik tetap (`ahp_education_grounded`).
- **User prompt** berisi:
  - judul jabatan dan **nama kandidat**;
  - pendidikan kandidat (`jenjang | jurusan`);
  - syarat pendidikan, **hanya sebagai konteks tambahan**;
  - **tujuan jabatan** dari job profile;
  - **tanggung jawab utama beserta indikator keberhasilannya**, maksimal 10;
  - catatan bahwa `education_level` *tidak* menentukan pemenuhan syarat minimum
    (itu sudah diputuskan aturan) dan hanya dibaca sebagai relevansi.

### 4.2 Rubrik dan keluaran

Rubrik (titik acuan): 100 sangat sesuai · 80 relevan · 60 cukup · 40 kurang ·
20 tidak relevan.

Keluaran wajib berupa JSON:

```
{"education_level": 0..100, "major_relevance": 0..100, "reason": "... (mengutip sumber grounding)"}
```

Kedua angka dibulatkan dan dibatasi ke 0..100 oleh parser.

Model diwajibkan memakai Grounding with Google Search dan mengutip sumbernya di
`reason`. Kueri pencarian dan daftar sumbernya disimpan.

### 4.3 Konfigurasi pemanggilan

| Parameter | Nilai |
|---|---|
| Model | `GEMINI_MODEL`, default `gemini-2.5-flash` |
| temperature / topP | **0 / 0** |
| Tool grounding | `google_search` |
| Timeout | 60 detik |
| Konkurensi | 4 kandidat paralel (`EDUCATION_LLM_CONCURRENCY`) |
| Percobaan grounded | 1 + `EDUCATION_LLM_MAX_RETRIES` (default 2) = **3 kali** |

### 4.4 Bila jawabannya tidak bisa dibaca

1. Grounded dicoba hingga 3 kali. Parser memeriksa setiap objek JSON lengkap di
   jawaban, karena saat grounding aktif model kadang menjawab dalam bentuk prosa.
2. **Repair pass**: rubrik dan prompt yang sama dikirim ulang, kali ini dengan
   grounding **mati** dan *structured output* (`responseSchema`), yang tidak
   mungkin dijawab dengan prosa. Hasilnya diberi sumber `llm-structured` (tanpa
   kutipan).
3. Bila tetap gagal, skornya **0** dengan sumber `none`, dan pesan kesalahan
   aslinya dikutip.

**Justifikasi.**
- **Dasar penilaiannya tanggung jawab dan indikator keberhasilan**, bukan
  sekadar teks syarat minimum. Yang ditanyakan adalah apakah lulusan dengan
  jenjang dan jurusan itu mampu mengerjakan pekerjaan ini. Syarat yang tertulis
  hanyalah ringkasan dari jawaban tersebut.
- **Grounding** dipakai agar alasan penilaian bisa ditelusuri ke sumber nyata
  untuk gap analysis.
- **temperature 0 / topP 0** menghilangkan keacakan sampling, sehingga run yang
  sama memberi jawaban yang sama sejauh layanannya mengizinkan.
- **Repair pass** ada karena Gemini tidak bisa menggabungkan grounding dengan
  mode JSON native. Skor rubrik tanpa kutipan masih lebih baik daripada 0, yang
  akan menurunkan posisi TOPSIS kandidat hanya karena kesalahan format.
- **Tidak ada fallback BERT/embedding.** Fallback itu dihapus karena memberi
  nilai terlalu tinggi untuk jurusan yang tidak relevan (contohnya "Ekonomi
  Studi Pembangunan" vs "S1 Manajemen Informatika").

### 4.5 Memakai ulang jawaban model dari run terakhir posisi

Pendidikan adalah data kandidat yang paling jarang berubah, tetapi justru satu-satunya
kriteria yang dinilai lewat panggilan model ber-grounding. temperature 0 menghilangkan
keacakan sampling, tetapi hasil pencarian Google tidak diam di tempat. Akibatnya dua run
atas data yang sama bisa berbeda di kriteria ini tanpa alasan yang bisa dijelaskan dari
datanya, dan setiap run membayar ulang token grounding untuk pertanyaan yang sudah
terjawab.

Karena itu, **sebelum memanggil Gemini** untuk seorang kandidat, mesin memeriksa **run
AHP + TOPSIS terakhir yang selesai pada posisi yang sama** (mode demo/asli yang sama).
Bila run itu sudah menanyakan **pertanyaan yang persis sama** tentang kandidat tersebut,
jawabannya dipakai ulang dan model tidak dipanggil.

"Pertanyaan yang persis sama" diukur dengan **kunci masukan** (`educationInputKey`,
`scoring-service/src/education-reuse.ts`): sidik jari SHA-256 atas seluruh teks yang
dikirim ke model, yaitu:

| Termasuk kunci | Alasan |
|---|---|
| Jenjang dan jurusan kandidat | Data pendidikan kandidat |
| Syarat pendidikan posisi | Syarat yang dibandingkan |
| Judul posisi, tujuan jabatan, 10 tanggung jawab pertama beserta indikator keberhasilannya | Dasar penilaian relevansi (§4.1); bila job profile diekstrak ulang, jawaban lama menjawab pertanyaan lain |
| Prompt sistem | Mengedit prompt di Tata Kelola harus memicu penilaian baru |
| Model, grounding (dan tool-nya), temperature, topP | Pengaturan model lain = jawaban lain |
| **Tidak** termasuk: nama kandidat | Nama mengidentifikasi, bukan bukti; di mode demo nama disamarkan |

Teks prompt dan kunci dibangun oleh **satu fungsi yang sama** (`buildEducationUserPrompt`),
jadi tidak mungkin keduanya berbeda.

Aturan pemakaian ulang:

1. Yang dipakai ulang adalah **jawaban model** (`education_level`, `major_relevance`,
   `reason`, kueri pencarian, sumber), **bukan skor akhirnya**. Sumbu jenjang tetap
   dihitung dengan aturan run yang sedang berjalan, lalu skor disusun ulang dengan
   `composeEducationScore`. Perubahan aturan jenjang tetap berlaku.
2. Hanya jawaban dari jalur model (`llm-grounded` / `llm-structured`) yang dipakai ulang.
   Jalur exact match deterministik dan selalu dihitung ulang. Hasil **gagal** (`none`)
   **tidak pernah** dipakai ulang, supaya gangguan sesaat tidak terbawa ke run berikutnya.
3. Run yang selesai **sebelum** fitur ini tidak menyimpan kunci, jadi tidak bisa dibuktikan
   pertanyaannya sama. Kandidatnya ditanya ulang **sekali**; run berikutnya baru bisa memakai
   ulang.
4. Rantai pemakaian ulang tetap menyebut run tempat model **benar-benar** menjawab
   (`answeredInRunId`), bukan hanya run sebelumnya.
5. Bila run sebelumnya gagal dibaca, semua kandidat ditanya seperti biasa (dicatat di log
   `ahpTopsis.educationReuseLoadFailed`), jadi run tidak pernah gagal karena fitur ini.
6. Dapat dimatikan dengan `AHP_EDUCATION_REUSE=false` (bawaan menyala).

Di layar, kandidat yang jawabannya dipakai ulang diberi badge **"Jawaban model dipakai
ulang"** pada detail Pendidikan, beserta run dan waktu model menjawab. Tab Konfigurasi →
Education menampilkan ringkasan per run: berapa kandidat yang memerlukan model, berapa yang
memakai ulang, dan berapa panggilan yang benar-benar dilakukan (`run_info.education.reuse`).

---

## 5. Rumus skor

### Jalur exact match

```
Skor = tier jenjang            (100 bila lebih tinggi · 80 bila setara)
```

### Jalur Gemini

```
sumbu relevansi = round( (education_level_LLM + major_relevance_LLM) / 2 )

bila jenjang bisa dibandingkan:
    Skor = round( (tier jenjang + sumbu relevansi) / 2 )
bila jenjang tidak bisa dibandingkan:
    Skor = sumbu relevansi
```

Matriks hasilnya, dengan baris = tier jenjang (aturan) dan kolom = sumbu
relevansi (Gemini):

| | relevansi 100 | 80 | 60 | **40** | 20 |
|---|---|---|---|---|---|
| **Lebih tinggi (100)** | 100 | 90 | 80 | **70** | 60 |
| **Setara (80)** | 90 | 80 | 70 | **60** | 50 |
| **Lebih rendah (50)** | 75 | 65 | 55 | **45** | 35 |

Kolom 100 dan 40 pada dua baris teratas adalah isi **Tabel 2.6**. Kolom lain dan
baris "lebih rendah" juga berlaku, karena sumbu relevansi adalah rata-rata dua
angka kontinu dari model.

Satu catatan: kandidat setara dengan relevansi 100 mendapat **90** di jalur
Gemini, tetapi kandidat setara yang lolos exact match mendapat **80**.

### Tidak dinilai

```
Skor = 0   (source = "none")
```

Penyebabnya: kandidat tidak punya data pendidikan maupun jurusan,
`GEMINI_API_KEY` tidak ada, atau semua percobaan gagal.

**Justifikasi.**
- **Dua sumbu dengan bobot setara**, meniru bentuk jalur exact match. Pada
  relevansi yang sama, jenjang lebih tinggi selalu mengungguli jenjang setara di
  kedua jalur (contoh relevansi 60: lebih tinggi 80, setara 70).
- **Tier "lebih rendah = 50" baru bisa tercapai sekarang.** Jalur exact match
  selalu menolak kandidat di bawah syarat, sehingga tier itu tadinya tidak
  pernah terpakai. Di jalur Gemini, justru kandidat inilah yang membutuhkannya.
- **Sumbu jenjang dibuang, bukan ditebak**, bila tidak ada yang menyebut
  jenjang. Aturannya sama dengan yang dipakai engine untuk kriteria yang tidak
  bisa dinilai.

---

## 6. Dari skor aspek ke peringkat

- Skor Education menjadi satu kolom di matriks TOPSIS. Bobot sistemnya **5%**,
  kecuali program punya matriks AHP sendiri.
- **Dibuang hanya bila semua kandidat** bersumber `none`. Kolomnya dikeluarkan
  dan bobotnya dibagi ulang ke kriteria lain.
- Bila hanya **sebagian** kandidat yang `none`, mereka tetap ikut dengan nilai
  **0** dan posisinya di TOPSIS turun.

---

## 7. Contoh perhitungan

Syarat: **"Minimal S1 Teknik Informatika / Sistem Informasi"** (syarat minimum,
peringkat 8; alternatif jurusan [teknik, informatika] dan [sistem, informasi]).

| Kandidat | Jenjang | Exact match? | Gemini (level, jurusan) | Perhitungan | Skor |
|---|---|---|---|---|---|
| A: S2 Teknik Informatika | lebih tinggi (100) | ya | — | tier | **100** |
| B: S1 Teknik Informatika | setara (80) | ya | — | tier | **80** |
| C: S1 Manajemen Informatika | setara (80) | tidak (tidak ada alternatif yang lengkap) | 80, 60 → 70 | (80 + 70)/2 | **75** |
| D: D3 Teknik Informatika | lebih rendah (50) | tidak (jenjang kurang) | 60, 80 → 70 | (50 + 70)/2 | **60** |
| E: tanpa data | — | — | — | tidak dinilai | **0** |

---

## 8. Jejak yang disimpan per kandidat

`analysis_results.details.ahpTopsis.educationDetail`:
- `score`, `source` (`exact-match` / `llm-grounded` / `llm-structured` / `none`);
- `levelScore`, `levelComparison`, `exactComparison`;
- `educationLevel`, `majorRelevance`, `groundedMajorAxis`;
- `reason`, `matchedTokens`, `searchQueries`, `sources`
  (kutipan hasil grounding);
- `inputKey` (jalur model): kunci masukan pertanyaan yang diajukan ke model (§4.5);
- `reusedFrom` (jalur model): `{ runId, answeredInRunId, answeredAt }` bila jawaban
  model dipakai ulang dan model tidak dipanggil pada run ini.

Objek evaluasi yang sama juga disimpan untuk **setiap** kandidat yang dinilai (finalis
maupun bukan) di `scoring_run_pool_aspects.details.educationEval`. Dari baris inilah run
berikutnya membaca jawaban yang bisa dipakai ulang.

Data ini ditampilkan di halaman Progress Running. Untuk run lama yang belum
menyimpan tier, `lib/education-tier.ts` menurunkannya ulang dari teks pendidikan
dan syarat, tanpa mengubah skor yang tersimpan.

---

## 9. Catatan dari penelusuran kode

Hal-hal berikut hanya dicatat, tidak diubah:

1. **Nama kandidat dikirim ke Gemini**, dan grounding meneruskan konteks prompt
   ke Google Search. Penilaian ini sama sekali tidak membutuhkan nama. Lapisan
   MCU di proyek yang sama sengaja *tidak punya parameter* untuk nama, NPK, atau
   departemen karena alasan ini. Mengirim data kandidat ke Gemini memang
   keputusan desain, tetapi nama adalah tambahan yang bisa dihapus tanpa
   kehilangan apa pun.
2. **Jalur exact match dan jalur Gemini tidak sejajar untuk jenjang setara.**
   Kandidat setara yang jurusannya exact match mendapat 80, sedangkan kandidat
   setara yang jurusannya *tidak* exact match tetapi dinilai Gemini sangat
   relevan bisa mendapat 90. Jadi lolos exact match bisa menghasilkan skor lebih
   rendah daripada tidak lolos.
3. **Deskripsi prompt di `lib/scoring-prompts.json` sudah usang.** Deskripsinya
   masih menulis "an exact match short-circuits to a fixed 100", padahal sekarang
   exact match bernilai 100 atau 80 sesuai tier. Isi prompt-nya sendiri sama
   dengan default di kode.
4. **Komentar `educationMaxRetries` di `config.ts` usang.** Komentarnya masih
   menyebut "falling back to the deterministic BERT scorer", padahal fallback
   BERT sudah dihapus; penggantinya adalah repair pass dengan structured output.
5. **Cabang syarat minimum dan bukan-minimum menghitung `requiredRank` dengan
   ekspresi yang sama** (`Math.min` di kedua sisi). Ini tidak memengaruhi skor,
   karena cabang bukan-minimum memakai daftar jenjangnya langsung, tetapi angka
   `requiredRank` yang dilaporkan untuk syarat bukan-minimum adalah jenjang
   terendahnya.

---

## 10. Ringkasan (format ringkas)

Skor kesesuaian bidang dan jenjang pendidikan kandidat terhadap persyaratan
pendidikan jabatan target dihasilkan melalui tahapan berikut:

1. **Syarat pendidikan jabatan** diambil berurutan dari job profile target
   (`jobSpecification.education`) → field pendidikan pada posisi → pendidikan dan
   jurusan incumbent.
2. **Sumbu jenjang selalu dinilai dengan aturan**, tidak pernah oleh model.
   Jenjang kandidat dan syarat dipetakan ke tangga SD (1) … SMA/SMK (3) … D3 (6) …
   D4 = S1 (8) … S2 (9) … S3 (10), lalu dibandingkan: **lebih tinggi = 100,
   setara = 80, lebih rendah = 50**.
3. **Jalur 1 — exact match (tanpa Gemini)**: bila jenjang kandidat setara atau
   lebih tinggi **dan** seluruh kata dari salah satu alternatif jurusan di syarat
   ada di jurusan kandidat (setelah istilah Inggris–Indonesia diseragamkan),
   skor = tier jenjang (100 atau 80).
4. **Jalur 2 — Grounded Gemini**, dipakai hanya bila exact match gagal dan
   kandidat punya data pendidikan atau jurusan. Gemini (temperature 0, Grounding
   with Google Search) menilai kesesuaian jenjang dan jurusan kandidat terhadap
   **tanggung jawab dan indikator keberhasilan (maksimal 10) serta tujuan
   jabatan** di job profile target, dengan rubrik 100/80/60/40/20, dan wajib
   mengutip sumber. Kedua jawabannya dirata-rata menjadi **sumbu relevansi**.
   Bila jawabannya tidak terbaca, model dicoba ulang hingga 3 kali, lalu dicoba
   sekali lagi tanpa grounding dengan output terstruktur.
5. **Skor akhir jalur Gemini** = (tier jenjang + sumbu relevansi) / 2. Hasilnya
   menurut Tabel 2.6 yang diperluas:

   | | Sesuai bidang (100) | Kurang sesuai bidang (40) |
   |---|---|---|
   | Jenjang lebih tinggi (100) | 100 | 70 |
   | Jenjang setara (80) | 90 | 60 |
   | Jenjang lebih rendah (50) | 75 | 45 |

   Sumbu relevansi bersifat kontinu, sehingga nilai di antara baris dan kolom ini
   juga mungkin. Bila jenjang tidak bisa dibandingkan, skor = sumbu relevansi.
6. **Tidak dinilai = 0** bila kandidat tidak punya data pendidikan, Gemini tidak
   terkonfigurasi, atau semua percobaan gagal. Skor masuk ke TOPSIS dengan bobot
   AHP (default 5%). Kriteria ini dibuang dan bobotnya dibagi ulang hanya bila
   **tidak ada satu pun** kandidat yang bisa dinilai.
