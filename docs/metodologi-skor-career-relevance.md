# Metodologi Skor Kriteria Career Relevance (AHP + TOPSIS)

Dokumen ini menjabarkan cara skor aspek **Career Relevance** dihitung oleh kode
yang sedang berjalan, beserta alasan di balik setiap rumus. Semua isinya
ditelusuri dari kode. Bila README atau komentar kode berbeda dengan perilakunya,
yang ditulis di sini adalah perilaku kodenya (lihat §11).

| Bagian | Berkas sumber |
|---|---|
| Orkestrasi aspek, pemasangan stint, akumulasi, skor | `scoring-service/src/ahp-topsis-engine.ts` (`scoreCareerAspect`, `deriveDepthTargets`, `recencyFactor`, `stintYears`, `calibrateFallback`, `applyCalibration`, `rescaleSim`) |
| Jangkar kemiripan dokumen (floor/ceil) | `scoring-service/src/career-anchors.ts`, tabel `job_profile_similarity_calibration` |
| Tolok ukur tahun hasil ukur per jenjang | `scoring-service/src/career-depth-anchors.ts` |
| Bobot IDF untuk fallback kompetensi | `scoring-service/src/competency-idf.ts` |
| Matcher kompetensi (dipakai bersama aspek teknis) | `matchCompetencySets` di `ahp-topsis-engine.ts` |
| Parameter | `scoring-service/src/config.ts` → `ahpTopsis.career`, `ahpTopsis.careerFallback` |

---

## 0. Gambaran besar

```
Jabatan target ──► dokumen job profile (embedding)           Riwayat kandidat: stint 1..K
                                                              (judul, kode posisi, tanggal)
                                    │                                     │
                                    │        tiap stint → job profile ────┤
                                    │                                     │
              ┌─────────────────────┴───────────── ada dokumen? ──────────┤
              │ YA: cos(dok target, dok stint)                            │ TIDAK: fallback
              │                                     cakupan kompetensi pejabat posisi stint
              │                                     vs acuan kompetensi target (Hungarian, IDF)
              │                                     → dipetakan ke pita yang DIBATASI 50%
              └───────────────► sim′ = rescale ke 0..1 (jangkar terukur dari korpus JD)
                                    │
           per stint:  sim′ × tahun × peluruhan usia  → tahun relevan efektif
                       sim′ × peluruhan usia          → stint relevan efektif
                                    │
           skor = min(1, tahunEf / T_tahun) × (0,75 + 0,25 × min(1, stintEf / T_stint)) × 100
```

Perbedaan utama terhadap ringkasan legacy:

1. Cosine **tidak dipakai mentah**. Nilainya di-*rescale* dengan jangkar yang
   diukur dari korpus job profile.
2. Skor **bukan rata-rata kemiripan**. Yang dihitung adalah **akumulasi
   pengalaman relevan** (kemiripan × lama menjabat) terhadap tolok ukur absolut.
3. Pengalaman lama **meluruh** 4,3% per tahun sejak stint berakhir.
4. Stint tanpa job profile tetap dinilai lewat **fallback kompetensi pejabat**,
   tetapi nilai maksimumnya dibatasi setengah skala.

---

## 1. Dokumen job profile jabatan target

Urutan pencarian job profile untuk jabatan target:

1. pemetaan Job Family (`job_family_matches`) untuk posisi itu;
2. resolusi deskriptor posisi target lewat tier yang sama dengan stint (§2);
3. **kode posisi incumbent** (`incumbent_position`): job profile yang terhubung
   ke kode posisi pejabat aktif;
4. **dokumen sintetis** (`pseudo_profile`): bila tidak ada job profile sama
   sekali, dirangkai dokumen berbentuk job profile dari data posisi (nama,
   divisi/departemen, tujuan jabatan, pendidikan, pengalaman) ditambah acuan
   kompetensi target. Dokumen ini di-embed dengan **model yang sama** dengan
   yang mengisi `job_profile_embed`, termasuk konvensi prefiksnya.

Vektor dokumen diambil dari `job_profile_embed`. Bila semua tier gagal, semua
stint dinilai lewat fallback kompetensi (§4). Bila acuan kompetensi target juga
kosong, kriteria Career dibuang dari TOPSIS (§9).

**Justifikasi.** Dokumen sintetis memakai bentuk label dan model embedding yang
sama agar jatuh di ruang vektor yang sama dengan dokumen asli. Kalau tidak,
cosine-nya tidak bisa dibandingkan.

---

## 2. Stint riwayat kandidat dan pemasangannya ke job profile

**Daftar stint** diambil dari `candidate_position_history`, dengan tanggal
dilengkapi dari `sync_employee_positions`. Posisi kandidat saat ini ikut
ditambahkan bila belum ada di riwayat.

**Lama stint** = bulan kalender utuh ÷ 12. Stint yang masih berjalan (tanpa
tanggal akhir, atau tanggal akhir tahun 9999) dihitung sampai hari ini. Stint
tanpa tanggal mulai dihitung 1 tahun.

**Pemasangan stint ke job profile**, berurutan:

| Tier | Aturan |
|---|---|
| `filename` | kode posisi stint = kode di awal nama berkas JD (bila beberapa JD berbagi kode, dipilih yang judulnya paling cocok) |
| `jfm` | kode posisi stint tercatat di `job_family_matches` |
| `exact` | judul ternormalisasi sama dengan `position_name` JD |
| `embedding` | cosine judul ↔ `position_name` > **0,98** |
| (posisi kini) | stint saat ini memakai pasangan Job Family kandidat sendiri bila tier lain gagal |

**Justifikasi.** Tiernya sama dengan laporan Job Family Sync, sehingga stint
yang terpasang di laporan juga terpasang di scoring. Ambang 0,98 sengaja ketat:
JD yang salah lebih buruk daripada tidak ada JD, karena kemiripan yang keliru
akan diam-diam terhitung sebagai pengalaman relevan.

---

## 3. Kemiripan dokumen dan rescale

### 3.1 Kemiripan mentah

Untuk stint yang terpasang ke job profile ber-embedding:

```
raw_k = max(0, cos(vektor dokumen target, vektor dokumen stint k))
```

Jalur dokumen **selalu didahulukan**. Fallback hanya dipakai bila stint tidak
punya kemiripan dokumen.

### 3.2 Rescale ke 0..1

```
sim′_k = clamp( (raw_k − simFloor) / (simCeil − simFloor), 0, 1 )
```

Rescale yang sama berlaku untuk jalur dokumen **dan** jalur fallback (setelah
fallback dipetakan ke skala dokumen, §4.3), sehingga keduanya sebanding.

### 3.3 Jangkar diukur oleh tiga estimator, lalu diambil mediannya

`career-anchors.ts` menghitung tiga perkiraan atas korpus `job_profile_embed`:

| Estimator | Floor | Ceil | Terukur di data ini |
|---|---|---|---|
| `corpus` | p25 kemiripan pasangan dokumen sembarang | p99 kemiripan "kembaran terbaik" tiap dokumen (pasangan ≥ 0,999 dibuang) | 0,519 – 0,998 |
| `family` | cosine saat presisi "sama job family" turun melewati 50% | … melewati 95% | 0,672 – 0,878 |
| `transitions` | p10 cosine perpindahan jabatan internal yang benar-benar terjadi | p75 | 0,633 – 0,892 (102 perpindahan) |
| **hasil** | **median** dari estimator yang tersedia | **median** | **0,633 – 0,892** |

Hasilnya disimpan dengan fingerprint
`md5(job_profile_id, content_hash …) : model : t<topicRun>/<n>/h<historyHash> : METHOD_VERSION`,
sehingga dihitung ulang otomatis bila isi JD, model embedding, hasil clustering
job family, riwayat jabatan, atau metode estimatornya berubah.

Prioritas: env `CAREER_SIM_FLOOR` + `CAREER_SIM_CEIL` (dipin operator) →
kalibrasi tersimpan yang fingerprint-nya cocok → hitung baru → nilai cadangan
`config.ts` (0,45/0,85; E5 0,75/0,95) bila dokumen kurang dari 30 atau korpusnya
tidak layak. Dicatat di `runInfo.career.scale`.

**Justifikasi.**
- **Cosine mentah bukan persentase.** Dua dokumen JD sembarang di korpus ini
  sudah bernilai sekitar 0,56. Kalau dipakai langsung, "56% mirip" bernilai 56
  poin padahal artinya tidak ada hubungan.
- **Estimator `corpus` saja terlalu longgar.** Pada cosine 0,519, peluang dua
  profil berada di job family yang sama hanya 10%. Floor setinggi itu membuat
  90% pasangan yang tidak berhubungan tetap memperoleh relevansi positif. Karena
  Career mengalikan sim′ dengan tahun lalu menjumlahkannya, karier 12 tahun yang
  tidak relevan sempat terhitung sekitar 4,7 tahun relevan.
- **`transitions` adalah satu-satunya estimator yang tidak sirkular**, karena
  mengukur perpindahan yang benar-benar dilakukan orang. Median perpindahan
  nyata = 0,827, sedangkan pasangan sembarang = 0,562. Floor lama 0,519 berada di
  bawah persentil-10 perpindahan nyata.
- **Median** dipakai supaya tidak ada satu estimator yang bisa menggeser skala
  sendirian, estimator yang tidak tersedia cukup tidak ikut dihitung, dan
  estimator yang keliru kalah suara.
- **Tetap antar-run, bukan persentil per run.** Jangkar ini mengikuti alat ukur
  dan riwayat yang tercatat, bukan siapa yang ikut dalam pool.

---

## 4. Fallback: stint tanpa job profile

Stint yang tidak punya kemiripan dokumen (tidak terpasang ke JD, JD-nya belum
ter-embed, atau jabatan target tidak punya vektor dokumen) dinilai dengan
membandingkan **posisi dengan posisi**: kompetensi pejabat posisi stint
dibandingkan dengan acuan kompetensi target.

### 4.1 Kompetensi posisi stint

- **Pemegang yang dipakai**: semua pemegang aktif posisi itu (dibatasi pada
  perusahaan stint bila ada datanya). Bila posisinya kosong, dipakai pemegang
  terakhir. **Kandidat yang sedang dinilai selalu dikeluarkan.**
- **Baris kompetensi pemegang**, dari yang paling spesifik: baris yang
  `position_id`-nya posisi itu → baris yang dibuat selama masa jabatan pemegang
  → baris aktif saat ini.
- **Level** yang dipakai = level yang **dituntut jabatan** (`proficiency_name` /
  `score`), lalu digabung antar-pemegang pada level maksimum.

### 4.2 Cakupan (coverage)

Memakai matcher yang **sama persis** dengan aspek teknis (identitas kode kamus →
Hungarian atas `sim′ × levelFactor`), dengan satu perbedaan: rata-ratanya
**berbobot IDF**:

```
w_j      = max(0,15 ; ln(N_JD / df_j))         df_j = jumlah JD yang menuntut kompetensi j
coverage = min(1, Σ w_j × nilai_j / Σ w_j)     (0..1)
```

### 4.3 Pemetaan ke skala dokumen, dengan batas atas

```
lo = simFloor
hi = simFloor + cap × (simCeil − simFloor)        cap = CAREER_FALLBACK_CAP = 0,5
raw_fallback = lo + coverage × (hi − lo)
```

Setelah rescale §3.2 hasilnya menjadi **sim′ = 0,5 × coverage**. Cakupan 100%
setara setengah relevansi penuh, dan aturan ini sama di semua run. Pada run
inkremental, pita ini diwarisi dari run dasar.

**Justifikasi.**
- **Dikeluarkannya kandidat sendiri**: tanpa itu, stint yang masih ia duduki
  akan dicocokkan dengan asesmennya sendiri dan mendapat nilai ~1,0 secara
  cuma-cuma.
- **Bobot IDF**: kosakata kompetensi didominasi entri yang hampir universal
  (`SOFTWARE APPLICATION OPERATION` ada di 92,7% dari 275 JD). Tanpa bobot,
  manajer yang bidangnya tidak berhubungan tetap mencakup ~45% tuntutan jabatan
  manajer mana pun. Dengan `ln(N/df)`, median cakupan pasangan yang tidak
  berhubungan turun dari 0,286 ke 0,104. Batas bawah 0,15 memastikan kompetensi
  umum diperkecil tetapi tidak dihapus. Aspek teknis sengaja **tidak** memakai
  IDF karena pertanyaannya lain: di sana kompetensi umum tetap merupakan
  tuntutan.
- **Batas 50%**: bukti dari kompetensi pejabat lebih lemah daripada dokumen
  (AUC 0,743 vs 0,874 dalam membedakan job family, dan 5% pasangan jabatan yang
  tidak berhubungan berbagi ≥ 75% kompetensi). Aturan lama memetakan cakupan ke
  p5..p95 kemiripan dokumen dalam run itu, sehingga cakupan penuh setara dengan
  klaim "ini pekerjaan yang sama". Hasilnya, kandidat yang dinilai lewat
  fallback rata-rata 66,7 sementara yang dinilai lewat dokumen hanya 35,1: skor
  justru mengukur seberapa banyak riwayat yang **tidak** punya JD.

Stint yang lolos semua jalur tetap **tidak dinilai** dan bernilai 0. Alasannya
dicatat: `no_target_reference`, `no_position_code`, atau
`no_incumbent_competency`.

---

## 5. Peluruhan usia pengalaman

```
rec_k = exp(−δ × tahun sejak stint k berakhir)     δ = CAREER_RECENCY_DECAY = 0,043
rec_k = 1  bila stint masih berjalan
```

| Berakhir sejak | 1 th | 3 th | 5 th | 10 th | 20 th |
|---|---|---|---|---|---|
| rec | 0,958 | 0,879 | 0,807 | 0,651 | 0,423 |

**Justifikasi.** 4,3%/tahun adalah laju depresiasi keterampilan dari literatur
human capital (Dinerstein, Megalokonomou & Yannelis, *AER* 2022), dan
diperkuat de Grip & van Loo (2002) di kisaran ~5%/tahun. Batas penerapannya
perlu dicatat: kedua studi tidak mengukur kasus "keterampilan meluruh saat
bekerja di bidang lain", jadi angka ini acuan orde besaran, bukan replikasi.
Karena itu nilainya bisa diatur lewat env. Sebelum aturan ini, stint yang
berakhir tahun 2006 bernilai sama dengan jabatan yang sedang diduduki. Diukur
di run acuan, peluruhan ini memperlebar selisih antara relevansi asli dan
relevansi semu dari +34 ke +39.

---

## 6. Akumulasi pengalaman relevan

```
tahunEf = Σ_k  sim′_k × tahun_k × rec_k        (tahun relevan efektif)
stintEf = Σ_k  sim′_k × rec_k                  (stint relevan efektif)
```

Stint yang tidak dinilai menyumbang 0 ke kedua jumlah.

**Justifikasi.** Rumus lama adalah rata-rata tertimbang durasi
`Σ(sim × tahun)/Σ(tahun)`, dan pada rumus itu durasinya saling menghapus: satu
stint enam bulan dengan sim′ 0,5 bernilai sama dengan karier 20 tahun di lima
stint dengan sim′ 0,5. Riwayat yang tipis malah diuntungkan karena tidak punya
stint lemah yang menurunkan rata-rata. Dengan akumulasi, cakupan yang buruk
benar-benar mengurangi poin.

---

## 7. Tolok ukur T (absolut, bukan dari pool)

`T_stint` = **2** (dibatasi 1..8).

`T_tahun` diambil dari sumber pertama yang tersedia (`deriveDepthTargets`):

| Sumber | Aturan | Kondisi |
|---|---|---|
| `inherited` | T dari run dasar | run inkremental |
| `jd` | syarat pengalaman tertulis di JD target (`jobSpecification.experience`, misalnya "Min 5 tahun") × **1** | JD menyebut angka tahun yang terbaca |
| `measured` | **median masa kerja sebelum diangkat** dari orang yang benar-benar diangkat ke jabatan **setingkat** (dari `candidate_position_history`) | JD tidak menyebut angka |
| `fixed` | 8 tahun | sensus pengangkatan tidak menghasilkan angka |

Hasilnya dibatasi ke rentang **3..20 tahun**.

Jenjang ditebak dari judul jabatan target: Division Head/GM/Director →
Department Head/Manager → Section Head/Supervisor/Coordinator →
Officer/Analyst/Specialist/Engineer → Staff. Sebuah jenjang perlu minimal 10
data pengangkatan. Bila jenjang senior hasilnya lebih rendah dari jenjang di
bawahnya, nilainya dinaikkan (*monotonic*). Terukur di data ini: staff 5,7 ·
officer 7,0 · section head 8,0 · department head 9,25 · division head 15,5 tahun.

**Justifikasi.**
- **Absolut, bukan median pool × 2 seperti dulu.** Tolok ukur yang mengikuti
  pool menyusut tepat ketika pool paling lemah. Pada run L&D Department Head
  (rata-rata relevansi pool 0,168), T jatuh ke 2,06 tahun / 1,0 stint dan
  rata-rata skor 33,1. Dengan tolok ukur tetap, orang-orang yang sama hanya
  mendapat 11,3. Inflasinya 1,4× pada pool normal dan 3× pada pool buruk, selalu
  ke arah yang membuat bench lemah terlihat layak.
- **JD × 1**: syarat yang tertulis dipakai apa adanya. Pengali ×2 sebelumnya
  berarti kode mengoreksi JD (jabatan yang meminta 3 tahun diam-diam dipasang 6).
- **`measured`** memakai bukti preferensi yang terungkap (berapa lama masa kerja
  orang yang benar-benar diangkat), bukan konstanta yang dipilih karena terasa
  pas.
- **T_stint = 2, bukan 3**: dengan 3, satu dekade di jabatan yang persis sama
  sebagai satu penugasan hanya mencapai 1,4 stint efektif.

---

## 8. Rumus skor

```
dTahun = min(1, tahunEf / T_tahun)
dStint = min(1, stintEf / T_stint)
w      = CAREER_DEPTH_BREADTH_WEIGHT = 0,25

Skor Career = round( dTahun × (1 − w + w × dStint) × 100 )
            = round( dTahun × (0,75 + 0,25 × dStint) × 100 )      (0..100)
```

`min(1, x)` bisa diganti kurva cekung `x^(1/γ)` lewat `CAREER_DEPTH_CONCAVITY`
(default γ = 1, artinya tidak aktif).

**Justifikasi.**
- **Kedalaman menentukan, keragaman hanya memodulasi.** Rumus ini menggantikan
  `min(dTahun, dStint)`, yang memotong bukti terkuat yang bisa diterima kriteria
  ini. Di run acuan, kandidat dengan 10,6 tahun sebagai *IT Application
  Development Analyst* hanya mendapat 47, sementara kandidat yang pengalamannya
  hanya di fungsi support mendapat 100. Dari lima bentuk rumus yang diuji, bentuk
  perkalian ini memisahkan relevansi asli dan semu sebesar +22 poin, sedangkan
  `min()` hanya +2. Keragaman paling banyak bisa mengurangi 25% skor.
- **Kurva cekung dimatikan** karena sudah diuji dan hasilnya lebih buruk untuk
  tujuan ini. Kurva cekung mengangkat bagian tengah skala, dan bagian tengah
  itulah tempat karier yang panjang tetapi tidak relevan berada (selisih asli vs
  semu turun dari +39 ke +24 pada γ = 2).

---

## 9. Dari skor aspek ke peringkat

- Skor Career menjadi satu kolom di matriks TOPSIS. Bobot sistemnya **5%**,
  kecuali program punya matriks AHP sendiri.
- **Dibuang, bukan dinolkan**: bila jabatan target tidak punya dokumen **dan**
  tidak punya acuan kompetensi, kolom Career dikeluarkan dan bobotnya dibagi
  ulang ke kriteria lain.

---

## 10. Contoh perhitungan

Jangkar: 0,633 – 0,892. JD target menyebut "Min 5 tahun" → T_tahun = 5,
T_stint = 2.

| Stint | Lama | Jalur | raw / coverage | sim′ | rec | tahunEf | stintEf |
|---|---|---|---|---|---|---|---|
| A (masih berjalan) | 4 th | dokumen | raw 0,86 | (0,86−0,633)/0,259 = 0,876 | 1 | 3,506 | 0,876 |
| B (berakhir 3 th lalu) | 5 th | fallback | coverage 0,60 | 0,5 × 0,60 = 0,300 | 0,879 | 1,319 | 0,264 |
| C (berakhir 8 th lalu) | 2 th | tidak dinilai | — | — | — | 0 | 0 |

```
tahunEf = 4,825    →  dTahun = min(1, 4,825/5) = 0,965
stintEf = 1,140    →  dStint = min(1, 1,140/2) = 0,570
Skor    = 0,965 × (0,75 + 0,25 × 0,570) × 100 = 0,965 × 0,8925 × 100 ≈ 86
```

---

## 11. Catatan dari penelusuran kode

Hal-hal berikut hanya dicatat, tidak diubah:

1. **README tertinggal dari kode.** Tabel aspek di `scoring-service/README.md`
   masih menulis T = "8 yr / 2 stints, or the target JD's stated requirement ×
   2", dan bagian *Depth* menyebut JD hanya dipakai "when it exceeds the
   default". Kode sekarang memakai pengali **1**, JD dipakai **naik atau turun**
   (gerbang "hanya boleh menaikkan" default **mati**), dan ada sumber `measured`
   per jenjang sebelum konstanta 8.
2. **Komentar `config.ts` bertentangan dengan nilainya sendiri.** Komentar di
   `statedExperienceMultiplier` menjelaskan panjang lebar mengapa 2,0 adalah
   angka yang tepat, padahal default di baris yang sama adalah `"1"`, dan
   komentar sebelumnya menjelaskan mengapa 1 dipilih. Komentar `statedMode`
   (`scaled`) juga menyebut "×1 implements ~40% of the document". Perilaku yang
   berlaku: `scaled × 1`, yang hasilnya sama dengan `direct`.
3. **Jalur dokumen selalu menang atas fallback**, berapa pun nilainya. Stint
   yang JD-nya terpasang tetapi kemiripannya rendah tidak akan dinilai ulang
   lewat kompetensi.

---

## 12. Ringkasan (format ringkas)

Skor kesesuaian riwayat karier (jabatan) kandidat dengan jabatan target
dihasilkan melalui tahapan berikut:

1. **Dokumen job profile jabatan target** dicari berurutan: pemetaan Job Family →
   kode berkas / judul / kemiripan judul → kode posisi incumbent. Bila tetap
   tidak ada, dirangkai **dokumen sintetis** dari data posisi dan acuan
   kompetensinya, lalu di-embed dengan model yang sama.
2. **Setiap stint riwayat jabatan kandidat** (termasuk jabatan saat ini) dihitung
   lamanya dalam tahun (bulan utuh ÷ 12) dan dipasangkan ke job profile lewat
   kode berkas JD → pemetaan Job Family → judul sama → kemiripan judul > 0,98.
3. **Kedekatan makna semantik** dihitung dengan cosine similarity antara vector
   embedding dokumen job profile target dan dokumen job profile setiap stint.
   Nilainya kemudian **di-rescale ke 0..1** dengan jangkar yang diukur dari
   korpus JD: median dari tiga estimator (sebaran antar-dokumen, presisi job
   family, dan perpindahan jabatan yang benar-benar terjadi), saat ini
   0,633–0,892.
4. **Stint tanpa job profile** dinilai dari kecocokan kompetensi pejabat posisi
   tersebut (kandidat sendiri dikeluarkan) dengan acuan kompetensi target,
   memakai matcher Hungarian yang sama dengan aspek teknis tetapi **berbobot
   IDF**. Hasilnya dipetakan ke skala yang **dibatasi 50%**
   (sim′ = 0,5 × cakupan), karena bukti ini lebih lemah daripada dokumen.
5. **Peluruhan usia**: relevansi stint yang sudah berakhir dikalikan
   `exp(−0,043 × tahun sejak berakhir)`.
6. **Akumulasi**, bukan rata-rata: tahun relevan efektif = Σ(sim′ × tahun ×
   peluruhan), stint relevan efektif = Σ(sim′ × peluruhan).
7. **Tolok ukur absolut**: T_tahun = syarat pengalaman yang tertulis di JD
   target; bila tidak ada, median masa kerja orang yang pernah diangkat ke
   jenjang yang sama; bila tidak ada juga, 8 tahun (dibatasi 3..20). T_stint = 2.
8. **Skor kriteria** = `min(1, tahunEf/T_tahun) × (0,75 + 0,25 × min(1,
   stintEf/T_stint)) × 100`. Kedalaman pengalaman menentukan skor, sedangkan
   keragaman penugasan hanya memodulasi paling banyak 25%. Skor ini masuk ke
   TOPSIS dengan bobot AHP (default 5%). Bila jabatan target tidak punya dokumen
   maupun acuan kompetensi, kriteria ini dibuang dan bobotnya dibagi ulang ke
   kriteria lain.
