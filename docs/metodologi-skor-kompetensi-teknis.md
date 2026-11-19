# Metodologi Skor Kriteria Kompetensi Teknis (AHP + TOPSIS)

Dokumen ini menjabarkan cara skor aspek **Technical Competency** dihitung oleh
kode yang sedang berjalan, beserta alasan di balik setiap rumus. Semua yang
tertulis di sini ditelusuri langsung dari kode, bukan dari spesifikasi lama.

| Bagian | Berkas sumber |
|---|---|
| Orkestrasi aspek, acuan kompetensi, matcher dua tahap | `scoring-service/src/ahp-topsis-engine.ts` (`resolveTargetRequiredSet`, `scoreTechnicalAspect`, `matchCompetencySets`, `competencyCell`) |
| Faktor level & rescale kemiripan | `scoring-service/src/competency-level.ts` |
| Hungarian (Kuhn–Munkres) | `scoring-service/src/hungarian.ts` |
| Jangkar kemiripan (floor/ceil) | `scoring-service/src/technical-anchors.ts`, tabel `kamus_similarity_calibration` |
| Nama kompetensi → kode kamus | `scoring-service/src/kamus-codes.ts` (baca), `lib/kamus-name-match.ts` (resolver, web app) |
| Dokumen embedding level kumulatif | `lib/job-family/embed.ts::kamusLevelDocuments`, `lib/kamus-embed-actions.ts` |
| Bobot & TOPSIS akhir | `scoring-service/src/ahp-weights.ts`, `scoring-service/src/topsis.ts` |

---

## 0. Gambaran besar

```
Acuan jabatan (M kompetensi, level r)      Kompetensi kandidat (N kompetensi, level c)
            │                                            │
            └──────── resolusi nama → KODE KAMUS ────────┘
                                 │
          TAHAP 1 — IDENTITAS (kode sama / nama ternormalisasi sama)
                 dipasangkan langsung, tidak dioptimasi
                                 │
          TAHAP 2 — KEMIRIPAN untuk sisa yang belum berpasangan
                 matriks sel = sim′ × levelFactor  →  Hungarian (maks. total)
                                 │
          Agregat: min( Σ nilai sel / M_efektif , 1 ) × 100   →  skor 0..100
                                 │
          Masuk TOPSIS akhir sebagai satu kolom, bobot AHP (default 25%)
```

Perbedaan utama terhadap ringkasan legacy:

1. "Sama" berarti **kode kamus yang sama**, bukan nama yang sama.
2. Pasangan identitas **dikeluarkan dari matriks sebelum Hungarian** dijalankan.
3. Kemiripan embedding **tidak dipakai mentah** — di-*rescale* dengan jangkar
   yang diukur dari korpus kamus.
4. **Selisih level** dihitung eksplisit, untuk pasangan identitas maupun
   pasangan kemiripan.
5. Skor akhir **dijenuhkan di 100**, dan kolom yang mustahil diukur
   **dikeluarkan dari pembagi**.

---

## 1. Menentukan acuan kompetensi jabatan (himpunan M)

`resolveTargetRequiredSet` mencoba empat sumber dari yang paling otoritatif, lalu
mencatat sumber yang terpakai di `runInfo.technical.requiredSource`:

| Tier | Sumber | Level yang dipakai |
|---|---|---|
| `profile` | `technicalCompetencies` dari job profile hasil ekstraksi PDF | dari profil (1..4; tidak terbaca → 2) |
| `critical_position` | `critical_positions.required_competencies` | tidak tercatat → **2 (Intermediate)** |
| `incumbent` | `sync_technical_competencies` milik pejabat aktif | **`proficiency_name` / `score`** = level yang **dituntut jabatan** |
| `position_aggregate` | semua pemegang kode posisi yang sama | sama dengan di atas, digabung pada **level maksimum** |

Job profile untuk jabatan target dicari secara berurutan: pemetaan Job Family
(`job_family_matches`), judul persis, substring judul, lalu kemiripan embedding
judul (ambang 0,80; 0,98 untuk model keluarga E5).

**Justifikasi.**
- Tier incumbent memakai level **target jabatan** (`proficiency_name`), bukan
  level yang dicapai orangnya (`current_*`). Kalau memakai level capaian, acuan
  akan bergeser mengikuti siapa pun yang sedang duduk di kursi itu; yang ingin
  diukur adalah tuntutan jabatan.
- Gabungan antar-pemegang memakai level maksimum (`unionMaxLevel`) karena
  tuntutan jabatan adalah batas tertinggi yang pernah diminta, bukan rata-rata
  pemegangnya.
- Satu himpunan acuan ini juga menjadi acuan *fallback* aspek Karier, sehingga
  kedua aspek benar-benar memakai ukuran yang sama, bukan sekadar mirip.

Bila keempat tier kosong, aspek teknis **dibuang dari matriks TOPSIS** dan bobot
AHP-nya dibagi ulang secara proporsional ke kriteria lain (lihat §8).

---

## 2. Menyiapkan kompetensi kandidat (himpunan N)

Diambil dari `candidate_technical_competencies`. Level kandidat adalah
`current_proficiency_name ?? proficiency_name`, lalu dipetakan dengan
`proficiencyToLevel`:

| Teks sumber | Level |
|---|---|
| `MASTERY`, `EXPERT` | 4 |
| `ADVANCE`, `ADVANCED` | 3 |
| `INTERMEDIATE` | 2 |
| `BASIC`, `NOVICE` | 1 |
| digit 1–4 di dalam teks | angka itu |
| `NULL`, `#N/A`, `NOT ASSESSED`, `-`, kosong | **tidak diketahui** |

Level yang tidak diketahui tetap diberi angka 1 **hanya untuk mencari vektor
embedding**, tetapi ditandai `levelKnown = false` sehingga faktor levelnya
**netral (1)**. Pasangan seperti itu dihitung di `levelUnknownPairs` dan tampil
sebagai "level belum diasesmen".

**Justifikasi.** Sekitar 17% baris `candidate_technical_competencies` tidak
punya level yang terbaca. Kalau dibaca sebagai level 1, kekosongan data akan
dilaporkan sebagai temuan kekurangan kompetensi, padahal data tidak pernah
menyatakan itu.

---

## 3. Identitas kompetensi = KODE kamus

Sebelum dicocokkan, setiap nama di kedua sisi dinormalisasi
(`UPPER`, `&` → `AND`, tanda baca → spasi, spasi dirapatkan) lalu dipetakan ke
kode `sync_kamus_kompetensi`:

| Tier | Aturan | Disimpan di cache? |
|---|---|---|
| exact | nama ternormalisasi sama dengan nama di kamus | tidak (dihitung ulang tiap run) |
| fuzzy | jumlah token sama; tiap token berpasangan dengan prefiks bersama ≥ 5 huruf dan sisa ≤ 3 huruf di tiap sisi; **tepat satu** entri kamus yang lolos | ya |
| AI | koreksi ejaan saja, atas seluruh kamus; hanya boleh "ya" bila kata kuncinya sama (beda typo/jamak/urutan/tanda baca), keyakinan ≥ 0,9 | ya, termasuk penolakan |

Resolver ada di web app (`lib/kamus-name-match.ts`) dan hasilnya disimpan di
`kamus_competency_match_cache`. Scoring-service **hanya membaca** cache itu.

Kunci identitas = `C:<kode>` bila nama terpetakan ke kode, selain itu
`N:<nama ternormalisasi>`.

**Justifikasi.**
- Nama acuan berasal dari PDF yang diekstrak LLM dan sering berbeda ejaan dari
  kamus (`Business Process Analyst` vs `BUSINESS PROCESS ANALYSIS`). Di data ini
  34 dari 102 nama acuan tidak cocok persis dengan entri kamus mana pun.
- Akibat nama yang tidak terpetakan **bukan** sekadar vektor yang hilang, tetapi
  **pasangan yang salah**: kolomnya bernilai 0 semua, sehingga Hungarian
  (yang memaksimalkan total) memakai kompetensi kandidat yang seharusnya
  menutup kolom itu untuk kolom lain.
- Tier AI dibatasi pada kesetaraan ejaan karena menebak singkatan atau sinonim
  berarti mengarang pasangan.
- Resolver dipisah dari scoring agar scoring tetap bisa jalan tanpa model AI
  (orphan sweeper bisa me-restart sesi tanpa ada yang mengawasi).

---

## 4. Tahap 1 — Pasangan identitas (sebelum Hungarian)

Untuk setiap kompetensi acuan j, dicari kompetensi kandidat dengan kunci
identitas yang sama. Bila ditemukan dan belum dipakai, keduanya langsung
dipasangkan dan **dikeluarkan dari matriks Hungarian**.

- Kandidat punya duplikat untuk satu kunci → diambil yang **levelnya tertinggi**.
- Jabatan mencantumkan satu kompetensi dua kali → kemunculan kedua tidak
  mendapat pasangan identitas dan masuk ke Tahap 2.
- `matchType`: `exact` (nama literal sama) atau `code` (ejaan berbeda, kode
  kamus sama).

Nilai sel identitas: **sim′ = 1** (tanpa embedding), sehingga

```
nilai_identitas = levelFactor(c, r, identitas = true)
```

**Justifikasi.** Identitas adalah fakta yang **ditemukan**, bukan diputuskan
oleh optimasi. Kalau diserahkan ke Hungarian, pasangan yang benar bisa ditukar
demi total yang lebih besar:

```
            A_req   B_req
A_kand      0.00    0.60      A→A, Z→B = 0.30
Z           0.20    0.30      A→B, Z→A = 0.80  ← Hungarian memilih ini
```

Akibatnya kompetensi `A` milik kandidat dilaporkan menutup `B`. Pemicunya
biasanya pasangan identitas dengan level kandidat jauh di bawah tuntutan, karena
sel bernilai kecil hampir tidak berpengaruh dalam penjumlahan.

---

## 5. Tahap 2 — Matriks kemiripan untuk sisa pasangan

### 5.1 Embedding level kumulatif

Tiap entri kamus di-embed menjadi **empat dokumen kumulatif**
(`kamusLevelDocuments`), disimpan di `kamus_kompetensi_level_embed`:

```
dokumen(L) = "<kode> — <nama>"
           + deskripsi
           + "Basic: …" + … sampai deskriptor level L
```

Level L memuat deskriptor 1..L, karena level adalah tangga ordinal: menguasai
Advance berarti juga menguasai Basic dan Intermediate.

### 5.2 Kemiripan mentah lalu di-*rescale*

Untuk kandidat i dan acuan j yang belum berpasangan, dengan vektor
`v(kode, level)`:

```
raw_ij  = max(0, cos( v(kode_i, c_i), v(kode_j, r_j) ))
sim′_ij = clamp( (raw_ij − simFloor) / (simCeil − simFloor), 0, 1 )
```

Bila salah satu sisi tidak punya kode kamus (artinya tidak punya vektor),
sel = 0.

### 5.3 Jangkar `simFloor` / `simCeil` diukur dari korpus kamus

`technical-anchors.ts` menjalankan **sensus**: untuk setiap baris (kode, level)
dihitung kemiripan tertingginya terhadap baris **berkode lain** (*best wrong
match*). Kemudian:

```
simFloor = persentil-25 dari distribusi best-wrong-match
simCeil  = persentil-99 dari distribusi yang sama
```

Hasilnya disimpan di `kamus_similarity_calibration` dengan **fingerprint**
`md5(kode:level:content_hash …) : model_embedding`. Kalau isi kamus, vektor,
atau model berubah, fingerprint ikut berubah dan run berikutnya mengkalibrasi
ulang.

Urutan prioritas: env `TECHNICAL_SIM_FLOOR` + `TECHNICAL_SIM_CEIL` (dipin
operator) → kalibrasi tersimpan yang fingerprint-nya cocok → sensus baru → nilai
cadangan di `config.ts` (0,72 / 0,89; E5: 0,88 / 0,96) bila korpus kosong atau
kurang dari 20 kode. Jangkar yang dipakai beserta sumbernya dicatat di
`runInfo.technical` (`simFloor`, `simCeil`, `simAnchorSource`).

**Justifikasi.**
- **Cosine mentah bukan persentase.** Di kamus ini setiap kompetensi selalu
  punya kompetensi *lain* di kisaran 0,72–0,86 (p25 0,723; median 0,758;
  p95 0,859), dan pasangan berbeda yang paling mirip di seluruh kamus hanya
  0,892. Memakai nilai mentah memberi 72–86 poin untuk pasangan yang sepenuhnya
  salah. Karena Hungarian selalu mengambil kecocokan salah *terbaik* yang
  tersedia, distribusi best-wrong-match adalah ukuran yang tepat.
- **Floor p25**: pada atau di bawah titik ini, "kompetensi paling mirip di
  kamus" bukan bukti bahwa kompetensi itu tertutup.
- **Ceil p99, bukan maksimum**: maksimum hanya satu titik, sehingga satu
  kompetensi hampir-duplikat yang ditambahkan ke kamus akan menarik ceil ke
  ~0,99 dan menekan semua skor kemiripan. Di korpus rancangan keduanya hampir
  sama (0,8905 vs 0,8917).
- **Tetap antar-run, bukan persentil per run**: jangkar ini mengikuti alat
  ukurnya (korpus kamus), bukan siapa yang ikut dalam pool, sehingga skor teknis
  bermakna sama di semua run dan posisi.
- Contoh hasil rescale (jangkar 0,72/0,89): SALES MGMT (DEALER) ↔ (RETAILER)
  0,882 → 0,95; LOGISTIC ↔ SUPPLY CHAIN 0,847 → 0,75; BRAND MGMT ↔ MARKETING
  STRATEGY 0,799 → 0,47; median best-wrong 0,758 → 0,22.

### 5.4 Nilai sel kemiripan

```
nilai_ij = sim′_ij × levelFactor(c_i, r_j, identitas = false)
```

**Justifikasi faktor level juga dipakai di sini.** Embedding kumulatif nyaris
tidak membedakan level: kompetensi yang sama level 1 vs 4 = cosine 0,958;
Advance vs Mastery = 0,997; kompetensi yang berbeda ≈ 0,571. Identitas lebih
dominan sekitar 10× dibanding level, jadi cosine saja tidak bisa melihat selisih
level, dan karena simetris juga tidak bisa tahu arahnya (kurang atau lebih).

---

## 6. Faktor level (`competencyLevelFactor`)

`c` = level kandidat, `r` = level yang dituntut (minimal 1).

| Kondisi | Pasangan identitas | Pasangan kemiripan |
|---|---|---|
| level kandidat tidak diketahui | 1 (netral, ditandai) | 1 (netral, ditandai) |
| c ≥ r | `min(1 + 0,75 × (c − r)/3, 1,75)` | **1** (tanpa bonus) |
| c < r | `max(0, 1 − (r − c)/4)` | sama |

Parameter: `TECHNICAL_OVERQUALIFICATION_SURPLUS` = 0,75 (plafon 1,75),
`TECHNICAL_LEVEL_GAP_SPAN` = 4.

| Selisih | c < r: kekurangan | c > r: kelebihan (identitas) |
|---|---|---|
| 1 | 0,75 | 1,25 |
| 2 | 0,50 | 1,50 |
| 3 | 0,25 | 1,75 |

**Justifikasi.**
- **Selisih, bukan rasio.** Level adalah tangga ordinal
  (Basic → Intermediate → Advance → Mastery), jadi yang bermakna hanyalah
  jaraknya. Rasio `c/r` sama saja dengan menyatakan Mastery "dua kali"
  Intermediate, padahal kamus tidak pernah menyatakan itu.
- **SPAN 4, bukan 3.** Kekurangan terbesar (level 1 terhadap tuntutan Mastery)
  tetap menyisakan 25% kredit. Memegang kompetensinya tetapi kurang dalam
  berbeda dengan tidak memegangnya sama sekali. Dengan span 3 kasus ini menjadi
  0, yang terbaca sebagai "tidak punya".
- **Bonus kelebihan hanya untuk identitas.** Melampaui level pada kompetensi
  yang hanya *mirip* (bukan yang diminta jabatan) tidak layak dibayar. Plafon ini
  juga menjaga pasangan identitas selalu di atas pasangan kemiripan.
- **Surplus 0,75 (dinaikkan dari 0,25).** Pada +25%, kandidat yang tiga level di
  atas tuntutan nyaris tidak berbeda dengan yang sekadar memenuhi, sehingga
  kedalaman penguasaan hampir tidak terlihat. Pada +75%, melampaui tuntutan
  bernilai kira-kira sama dengan memenuhi satu kompetensi tambahan. Ini angka
  kebijakan, bukan hasil pengukuran, dan bisa diatur lewat env.

---

## 7. Hungarian dan agregasi skor

### 7.1 Penugasan

Matriks yang tersisa (kandidat terbuka × acuan terbuka) diselesaikan dengan
`hungarianMaxAssignment`: Kuhn–Munkres dalam formulasi potensial, dikonversi ke
min-cost (`cost = maks − nilai`) dan ditranspos bila baris > kolom. Hasilnya
optimum global (sudah diverifikasi terhadap brute force hingga 6×6), bukan
pencarian *greedy*. Hasilnya `min(N′, M′)` pasangan satu-ke-satu.

- N > M → kompetensi kandidat sisa tidak berpasangan (`surplusCandidates`),
  ditampilkan tetapi bernilai 0.
- N < M → kolom acuan tanpa pasangan = `unmatched`, bernilai 0.

### 7.2 Kolom yang tidak terukur

Kolom acuan j disebut **tidak terukur** (`unmeasurable`) bila **tidak punya kode
kamus** DAN **tidak ada kompetensi kandidat dengan kunci identitas yang sama**.
Kolom seperti ini pasti 0 untuk semua kandidat, jadi:

```
M_efektif = M − jumlah kolom tidak terukur
```

Kolomnya tetap ditampilkan di rincian sebagai temuan tata kelola (jabatan
menuntut sesuatu yang tidak ada di kamus, misalnya `Leadership` atau
`Communication`, yang merupakan kompetensi perilaku).

**Justifikasi.** Kolom yang mustahil bernilai lebih dari 0 menurunkan semua
kandidat secara sama besar akibat kamus yang tidak lengkap, bukan akibat apa pun
tentang kandidatnya.

### 7.3 Rumus skor

```
                Σ_{j terukur} nilai_j
normalizedRaw = ───────────────────────          (0 .. 1,75)
                     M_efektif

normalized    = min(normalizedRaw, 1)            (0 .. 1)

Skor Teknis   = round(normalized × 100)          (0 .. 100)
```

`nilai_j` adalah nilai sel pasangan identitas (Tahap 1), nilai sel Hungarian
(Tahap 2), atau 0 bila tidak berpasangan. Aspek teknis **tidak memakai bobot
IDF** (semua kolom berbobot 1). Bobot IDF hanya dipakai oleh fallback aspek
Karier lewat parameter opsional `weightFor` pada matcher yang sama.

**Justifikasi.**
- **Pembagi = jumlah tuntutan, bukan jumlah pasangan.** Tuntutan yang tidak
  tertutup harus mengurangi skor.
- **Saturasi di 1.** Surplus kelebihan level bersifat **kompensatoris**:
  kelebihan pada satu kompetensi boleh menutup kekurangan pada kompetensi lain,
  karena memang itu fungsi rata-rata. Tetapi kandidat tidak bisa lebih dari
  "memenuhi seluruh tuntutan". Pertanyaan kriteria ini adalah "apakah orang ini
  mampu mengerjakan yang dituntut JD", dan jawabannya jenuh di "ya, semuanya".
  Sebelum aturan ini ada, 6 dari 4.198 baris mencapai 113. Pembatasan tidak
  menimbulkan seri baru dan tidak mengubah urutan teknis di run mana pun.
  `normalizedRaw` tetap disimpan agar "tepat memenuhi" (1,0) bisa dibedakan dari
  "jauh melampaui" (hingga 1,75).
- **Alternatif yang ditolak**: membagi dengan plafon yang bisa dicapai
  `Σ(1 + surplus × (4 − r_j)/3)`. Cara ini membuat pembagi bergantung pada
  seberapa rendah level yang diminta JD, sehingga kandidat yang sama mendapat
  skor lebih rendah di jabatan yang lebih mudah (JD level 1 mentok di 57). Diukur
  di data ini, cara itu mengubah 66,7% baris dan mengacak urutan teknis di 84
  dari 154 run.
- **Tanpa IDF di teknis**: kompetensi yang umum tetap merupakan tuntutan;
  "kompetensi ini dimiliki banyak jabatan" tidak membuat kekurangannya bisa
  dimaafkan. (Di Karier IDF dipakai karena pertanyaannya berbeda: apakah dua
  jabatan sejenis.)

---

## 8. Dari skor aspek ke peringkat

1. Skor teknis 0..100 menjadi satu kolom di matriks keputusan TOPSIS (6 kriteria,
   semua bertipe *benefit*).
2. Bobot berasal dari matriks AHP program (`program_templates.ahp_config`),
   atau bobot sistem bila program tidak punya matriks: **technical 25%**,
   behavior 35, HAV 20, PA 10, career 5, education 5.
3. TOPSIS klasik: normalisasi vektor `r_ij = x_ij / √Σx²` → dikali bobot →
   ideal positif/negatif diambil dari himpunan kandidat → jarak Euclid →
   `closeness = D⁻ / (D⁺ + D⁻)`.
4. **Kriteria dibuang, bukan dinolkan**: bila tidak ada acuan sama sekali, atau
   tidak ada satu pun kolom acuan yang terukur (`effectiveRequiredCount = 0`),
   kolom teknis dikeluarkan dan bobotnya dibagi ulang secara proporsional
   (`runInfo.ahp.droppedCriteria` / `effectiveWeights`). Kolom yang isinya 0
   semua tetap memakan bobot dan menurunkan closeness semua kandidat tanpa
   membedakan siapa pun.

Catatan: karena TOPSIS relatif terhadap himpunan kandidat, kontribusi efektif
kolom teknis terhadap peringkat bergantung pada sebaran skor teknis dalam pool,
bukan hanya pada bobot 25%-nya.

---

## 9. Contoh perhitungan

Jangkar: simFloor 0,72, simCeil 0,89. Jabatan menuntut 5 kompetensi:

| Acuan (r) | Pasangan kandidat (c) | Jenis | sim′ | levelFactor | Nilai |
|---|---|---|---|---|---|
| BUDGETING (3) | BUDGETING (4) | identitas `exact` | 1 | 1 + 0,75×1/3 = 1,25 | **1,25** |
| BUSINESS PROCESS ANALYSIS (3) | "Business Process Analyst" (1), kode sama | identitas `code` | 1 | 1 − 2/4 = 0,50 | **0,50** |
| SUPPLY CHAIN (2) | LOGISTIC (3) | kemiripan, raw 0,847 | (0,847−0,72)/0,17 = 0,747 | 1 (tanpa bonus) | **0,747** |
| WAREHOUSE MGMT (2) | — | `unmatched` | — | — | **0** |
| Leadership (2) | — (tanpa kode, tidak dimiliki) | `unmeasurable` | — | — | dikeluarkan dari pembagi |

```
M = 5, M_efektif = 4
normalizedRaw = (1,25 + 0,50 + 0,747 + 0) / 4 = 0,624
Skor Teknis   = round(min(0,624, 1) × 100) = 62
```

---

## 10. Jejak yang disimpan per kandidat

`analysis_results.details.ahpTopsis.technicalMatching` (`TechnicalDetail`):
`score`, `normalized`, `normalizedRaw`, `requiredCount` (M),
`effectiveRequiredCount`, `candidateCount` (N), `identityPairs`,
`levelUnknownPairs`, `unmeasurableCount`, `pairs[]` (per kolom: acuan,
pasangan, `matchType`, `similarityRaw`, `similarity`, `levelFactor`, `value`,
`levelUnknown`), `surplusCandidates`, `requiredSource`, `requiredSourceDetail`.

Tingkat run: `runInfo.technical` (jangkar, sumber jangkar, alasan, sumber acuan,
jumlah pasangan dengan level tidak diketahui).

---

## 11. Catatan dari penelusuran kode

Dua hal ini ditemukan saat menelusuri kode. Keduanya **tidak** diubah, hanya
dicatat di sini:

1. **Fallback level kandidat.** Level kandidat dibaca dari
   `current_proficiency_name ?? proficiency_name`. Bila `current_proficiency_name`
   bernilai `NULL`, yang terbaca adalah `proficiency_name`, yaitu level yang
   dituntut **jabatan kandidat saat ini**. Level itu lalu diperlakukan sebagai
   level yang diketahui, bukan netral. Hanya teks non-NULL yang tidak terbaca
   (`#N/A`, `NOT ASSESSED`, `-`) yang benar-benar menghasilkan faktor netral.
   Ini tidak sejalan dengan aturan "yang tidak diketahui bukan temuan" di §2.
2. **`simFloor`/`simCeil` di rincian per kandidat** diisi dari
   `config.ahpTopsis.technical` (nilai cadangan), bukan dari jangkar terukur yang
   benar-benar dipakai run (`technicalAnchors`). Perhitungannya sendiri memakai
   jangkar yang benar. Angka yang benar ada di `runInfo.technical`. Akibatnya,
   rincian per kandidat bisa menampilkan jangkar yang berbeda dari jangkar yang
   menghasilkan skornya.

---

## 12. Ringkasan (format ringkas)

Skor kesesuaian kompetensi teknis antara tuntutan jabatan (*required*) dan
capaian kandidat (*actual*) dihitung melalui tahapan berikut:

1. **Penentuan acuan jabatan (M kompetensi + level tuntutan)**, berurutan:
   job profile → daftar kompetensi critical position (level diasumsikan 2) →
   kompetensi incumbent (level tuntutan jabatan, bukan capaian orangnya) →
   gabungan semua pemegang posisi (level maksimum).
2. **Resolusi identitas**: semua nama kompetensi di kedua sisi dipetakan ke
   **kode kamus kompetensi** (exact → fuzzy → AI koreksi ejaan, hasilnya
   di-cache). "Kompetensi yang sama" berarti kode yang sama, atau nama
   ternormalisasi yang sama bila tidak ada kode.
3. **Tahap identitas (sebelum optimasi)**: kompetensi yang identik langsung
   dipasangkan dan dikeluarkan dari matriks. Nilainya = faktor level:
   - di bawah tuntutan: `1 − selisih/4` (0,75 / 0,50 / 0,25),
   - di atas tuntutan: `1 + 0,75 × selisih/3` (maksimum 1,75).
4. **Tahap kemiripan untuk kompetensi yang belum berpasangan**:
   1. Pemetaan vector embedding **kumulatif** definisi level profisiensi kamus
      (level L = deskripsi + deskriptor level 1..L) sesuai kompetensi tuntutan
      jabatan.
   2. Pemetaan vector embedding kumulatif yang sama sesuai kompetensi dan level
      kandidat.
   3. Cosine similarity dihitung dalam matriks N′×M′ lalu di-*rescale* ke 0..1
      dengan jangkar yang diukur dari korpus kamus (floor = p25, ceil = p99 dari
      kemiripan "kecocokan salah terbaik"; dikalibrasi ulang otomatis bila kamus
      atau model embedding berubah).
   4. Nilai sel = similarity hasil rescale × faktor level (kekurangan dipotong
      `selisih/4`, kelebihan tidak diberi bonus).
5. **Hungarian Assignment** (Kuhn–Munkres, optimum global) pada matriks sisa
   untuk menemukan pasangan satu-ke-satu dengan total nilai tertinggi.
   Kompetensi tuntutan yang tidak berpasangan bernilai 0. Kompetensi tuntutan
   yang mustahil diukur (tanpa kode kamus dan tidak dimiliki kandidat)
   dikeluarkan dari pembagi.
6. **Skor kriteria** = `min(Σ nilai pasangan / M_efektif, 1) × 100`. Skor ini
   lalu masuk ke TOPSIS sebagai satu kriteria dengan bobot AHP (default 25%).
   Bila tidak ada satu pun acuan yang terukur, kriteria dibuang dan bobotnya
   dibagi ulang ke kriteria lain.
