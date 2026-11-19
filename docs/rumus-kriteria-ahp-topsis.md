# Rumus lengkap & percabangan enam kriteria AHP + TOPSIS

Dokumen ini menjawab satu pertanyaan sampai tuntas: **dari mana persisnya angka tiap
kriteria berasal, rumus apa yang dipakai, percabangan mana yang dipilih, siapa yang
menentukan percabangan itu, dan mengapa demikian.**

Bedanya dengan [`metodologi-laporan-scoring.md`](metodologi-laporan-scoring.md): dokumen
itu menerangkan **apa yang tampil di layar** halaman `/positions/[id]` dan bagaimana
membacanya. Dokumen ini menerangkan **mesinnya** — setiap rumus, setiap ambang, setiap
tingkat cadangan, dengan angka konstanta yang benar-benar dipakai. Keduanya harus sejalan;
bila berbeda, kode adalah yang benar.

Sumber kebenaran: [`scoring-service/src/ahp-topsis-engine.ts`](../scoring-service/src/ahp-topsis-engine.ts)
(4.375 baris), [`scoring-service/src/config.ts`](../scoring-service/src/config.ts),
[`scoring-service/src/topsis.ts`](../scoring-service/src/topsis.ts),
[`scoring-service/src/hungarian.ts`](../scoring-service/src/hungarian.ts), dan
[`scoring-service/src/ahp.ts`](../scoring-service/src/ahp.ts).

> **AHP + TOPSIS adalah satu-satunya metode penilaian.** Metode AI Tournament (LLM), yang
> menilai lewat model bahasa dan tidak memakai rumus di bawah, dihapus pada November 2026
> beserta run-nya (`drizzle/0097_remove_llm_tournament.sql`).

---

## Peta enam kriteria AHP TOPSIS dan bobot bawaannya

| Kunci | Label di layar | Cara dihitung | Butuh LLM? | Rentang mentah |
|---|---|---|---|---|
| `technical` | Technical Competency Mapping | Penugasan satu-lawan-satu Hungarian atas kompetensi | Tidak | 0–125 |
| `career` | Career Relevance | Akumulasi pengalaman relevan, dua sumbu jenuh | Tidak | 0–100 |
| `behavior` | Behavior Competency Assessment | Kategorisasi ordinal berpasangan 6..0 | Tidak | 0–100 |
| `performance` | Performance Appraisal | TOPSIS solusi absolut dinamis | Tidak | 0–100 |
| `hav` | HAV Mapping | Aturan kuadran lima tingkat | Tidak | 20–100 |
| `education` | Employee Profile - Pendidikan | Kecocokan token → Gemini ter-grounding | Ya (sebagian) | 0–100 |

Urutan ini (`AHP_CRITERIA_ORDER`) adalah urutan baris dan kolom matriks perbandingan
berpasangan AHP. Menukar urutannya akan menukar arti seluruh matriks tersimpan.

> **Kriterianya ENAM, dan MCU bukan yang ketujuh.** Status medical check-up tidak
> lagi menggugurkan kandidat — aturan MCU hanya menandai (`severity: 'advisory'`)
> — tetapi ia juga TIDAK masuk matriks ini dan tidak pernah menyentuh
> `analysis_results.final_score` (lihat `docs/metodologi-laporan-scoring.md`
> Bab 22.10). Dua alasan menolak menjadikannya kriteria ke-7: kompetensi dan
> keterlaksanaan adalah pertanyaan berbeda — temuan medis tidak membuat seseorang
> kurang kompeten — dan menambah satu kunci ke urutan ini akan membuat SETIAP
> matriks 6x6 yang sudah tersimpan gagal `isValidPairwise()` lalu diam-diam jatuh
> ke bobot bawaan, termasuk matriks yang di-pin sebuah run turunan justru supaya
> bobotnya tidak bergerak.

**Bobot bawaan** bila program tidak punya matriks AHP maupun kriteria warisan yang terpakai:
technical 25, career 10, behavior 25, performance 15, hav 15, education 10.

---

## Rumus Technical Competency Mapping (kompetensi teknis) — langkah demi langkah

### Kompetensi kandidat vs kompetensi yang dituntut jabatan — level mana yang dipakai

| Sisi | Isinya | Level yang dipakai |
|---|---|---|
| Kandidat (N) | Kompetensi teknis yang dimiliki orangnya | **Level yang DICAPAI** (`current_proficiency_name`) |
| Acuan target (M) | Kompetensi yang dituntut jabatan sasaran | **Level yang DITUNTUT JABATAN** (`proficiency_name` / `score`) |

Pembedaan kolom ini bukan detail teknis: memakai kolom "dicapai" di sisi acuan berarti
mengukur kandidat terhadap **seorang pribadi**, dan standarnya ikut bergeser setiap kali
pemangku jabatannya berganti. Kolom "dituntut" mengukur mereka terhadap **jabatannya**.

### Dari mana acuan kompetensi posisi target diambil — empat tingkat cadangan (profile, critical_position, incumbent, position_aggregate)

Yang pertama menghasilkan daftar tidak kosong, itulah yang dipakai. Tingkat yang terpakai
selalu dicatat sebagai `requiredSource` dan tampil di diagnostik run.

| # | `requiredSource` | Sumber | Level target | Kapan dipakai |
|---|---|---|---|---|
| 1 | `profile` | `technicalCompetencies` pada dokumen job profile jabatan | Dari dokumen | Dokumen job profile ketemu dan memuat kompetensi |
| 2 | `critical_position` | Daftar kompetensi wajib yang dikurasi pada posisi | **Diasumsikan 2 (Intermediate)** — level tidak tercatat | Tidak ada dokumen, tetapi admin mengisi daftar kompetensi |
| 3 | `incumbent` | Asesmen pemangku jabatan saat ini | `proficiency_name`/`score` orang itu | Tidak ada dokumen & daftar kurasi, tetapi `holder_employee_id` terisi |
| 4 | `position_aggregate` | Gabungan **semua** pemegang kode jabatan yang sama, diambil **level maksimum** antar-pemegang | Maksimum antar-pemegang | Pemangku sekarang belum punya asesmen memadai |
| — | `none` | — | — | Keempatnya kosong → **kriteria technical DIBUANG** dari perhitungan |

Tingkat 4 ada untuk kasus nyata: pemangku jabatan yang baru menjabat asesmennya masih tipis,
sedangkan pemegang-pemegang sebelumnya punya rekam lengkap. Mengambil maksimum antar-pemegang
membaca jabatannya sebagai "pekerjaan ini pernah menuntut sampai level segini".

### Rumus nilai sel matriks: exact match, surplus over-kualifikasi (langit-langit 1,75), dan cosine semantik

Untuk pasangan (kompetensi kandidat `c`, kompetensi acuan `r`):

```
BILA nama ternormalisasi c == nama ternormalisasi r        → "exact"
    bila level_c >= level_r :
        nilai = min( 1 + 0,75 × (level_c − level_r) / 3 , 1,75 )
    bila level_c <  level_r :
        nilai = max( 0 , 1 − (level_r − level_c) / 4 )

SELAIN ITU                                                  → "semantic"
    nilai = max( 0 , cosine( vektor[kode_c : level_c] , vektor[kode_r : level_r] ) )
    bila salah satu kode tidak ada di kamus → nilai = 0
```

**Penjelasan surplus over-kualifikasi.** Memenuhi level yang dituntut bernilai penuh 1,0.
Melampauinya menambah bonus terbatas: selisih maksimum yang mungkin adalah 3 (level 1 → 4),
dan seluruh bonus itu bernilai **+0,75**. Jadi selisih 1 = +0,25, selisih 2 = +0,50, selisih 3
= +0,75, dengan langit-langit **1,75**. Ada bonusnya supaya kecocokan persis yang berlebih dapat
mengungguli kecocokan semantik; ada batasnya supaya satu kompetensi tidak bisa mendominasi
seluruh kriteria.

Bonus ini **dinaikkan dari +0,25 (langit-langit 1,25)**: pada +0,25 kandidat yang tiga level di
atas tuntutan hanya bernilai 1,25 — nyaris tak berbeda dari yang sekadar memenuhi — sehingga
kedalaman penguasaan hampir tidak terlihat pada skor. Pada +0,75, melampaui tuntutan bernilai
kira-kira sebanding dengan satu kompetensi tambahan yang terpenuhi. Bonus **hanya** berlaku untuk
pasangan yang identitasnya sama (nama sama persis atau kode kamus sama); pasangan yang cuma mirip
tetap diplafon 1,0, jadi menaikkannya sekaligus melebarkan jarak antara benar-benar menguasai dan
sekadar menyerupai. Konsekuensinya `Σ/M` **mentah** dapat mencapai ~1,75 — dan justru karena itu
agregatnya **dijenuhkan pada 1** sebelum menjadi skor, sehingga skor Technical tetap 0–100.
Surplusnya bersifat kompensatoris: boleh menutup kekurangan level pada kompetensi lain, tidak
boleh membuat kandidat lebih dari "memenuhi seluruh tuntutan". Diatur lewat
`TECHNICAL_OVERQUALIFICATION_SURPLUS`.

**Vektor level bersifat kumulatif.** `kamus_kompetensi_level_embed` menyimpan satu vektor per
(kode kompetensi, level), yang meng-embed deskripsi level 1 sampai level tersebut — bukan
deskripsi level itu saja. Dengan begitu kemiripan antar-level membawa makna berjenjang.

### Penugasan Hungarian satu-lawan-satu — kenapa bukan ambil pasangan terbaik per kolom

Matriks N×M diselesaikan dengan **Kuhn–Munkres** (`hungarianMaxAssignment`) untuk memaksimalkan
**total** nilai, dengan syarat satu-lawan-satu: setiap kompetensi acuan berpasangan dengan
tepat satu kompetensi kandidat, dan sebaliknya.

- N > M → sisa kompetensi kandidat **tidak berpasangan**, menyumbang 0, tetapi tetap
  ditampilkan sebagai `surplusCandidates` agar inventaris kompetensinya terlihat utuh.
- N < M → ada kolom acuan yang **tidak terisi**, menyumbang 0.

Mengambil pasangan terbaik per kolom secara serakah akan membiarkan satu kompetensi kandidat
yang kuat "dipakai ulang" untuk beberapa kolom acuan sekaligus, dan itu menaikkan skor tanpa
dasar. Hungarian memberi optimum global, bukan hasil satu lintasan serakah.

### Rumus skor akhir kompetensi teknis, dan kenapa ia dijenuhkan pada 100

```
normalizedRaw = Σ nilai kolom / M              (0 .. 1,75)   ← diagnostik
normalized    = min( normalizedRaw , 1 )       (0 .. 1)      ← masukan TOPSIS
skor          = round( normalized × 100 )      (0 .. 100)
```

Skor **tidak melebihi 100**. `normalizedRaw` di atas 1 berarti kandidat melampaui level yang
dituntut pada cukup banyak pasangan identitas; itu **temuan tentang kedalaman penguasaan**, bukan
skor yang lebih tinggi, dan tetap dilaporkan apa adanya di panel rincian.

Alasan penjenuhan: surplus over-kualifikasi bersifat **kompensatoris**. Ia boleh menutup
kekurangan level pada kompetensi lain — itulah gunanya rata-rata — tetapi tidak bisa membuat
seseorang lebih dari "memenuhi seluruh tuntutan", karena kriteria ini menanyakan *bisakah orang
ini melakukan yang diminta jabatan*, dan pertanyaan itu jenuh di "ya, semuanya".

Aturan yang sama sudah lebih dulu dipakai konsumen lain dari matcher ini: `applyCalibration`
(fallback Career) memang sengaja menjepit surplus itu ke 1 agar cakupan penuh berhenti di batas
atas rentangnya "dan tidak lebih". Technical adalah satu-satunya pemanggil yang belum
melakukannya, sehingga keduanya sempat berbeda pendapat tentang arti "cakupan penuh".

Run yang selesai sebelum perubahan ini masih menyimpan skor di atas 100 (terukur: 6 baris,
semuanya **113**). Nilainya tidak ditulis ulang — sebuah run adalah catatan penilaian pada
tanggal tertentu — jadi skor Technical run lama tidak sebanding langsung dengan run sesudahnya.

### Contoh perhitungan kompetensi teknis dengan angka

Acuan target M = 3: `Network Security (4)`, `Routing (3)`, `Project Management (2)`.
Kandidat N = 3: `Network Security (4)`, `Routing (2)`, `Data Analysis (3)`.

| Kolom acuan | Pasangan | Jenis | Nilai |
|---|---|---|---|
| Network Security (4) | Network Security (4) | exact, pas | `min(1 + 0,25×0/3 ; 1,25)` = **1,000** |
| Routing (3) | Routing (2) | exact, kurang | `2/3` = **0,667** |
| Project Management (2) | Data Analysis (3) | semantic | cosine ≈ **0,180** |

```
Σ = 1,000 + 0,667 + 0,180 = 1,847
normalized = 1,847 / 3 = 0,616
skor Technical = 62
```

### Kapan kriteria kompetensi teknis dibuang dari perhitungan

Hanya ketika acuan target kosong sama sekali (`requiredSource = none`). Kriteria dibuang dari
matriks TOPSIS dan bobot AHP-nya dibagi ulang — **bukan** dibiarkan sebagai kolom nol.
Kolom nol tetap menghabiskan jatah bobotnya dan menyeret turun semua skor kedekatan tanpa
membedakan siapa pun.

---

## Rumus Career Relevance (relevansi jejak karier) — delapan langkah lengkap

Kriteria yang paling banyak percabangannya. Delapan langkah, dijelaskan berurutan.

### Kenapa career relevance mengakumulasi pengalaman, bukan merata-ratakan kemiripan

Rumus lama adalah rata-rata tertimbang durasi: `Σ(sim × tahun) / Σ(tahun)`. Di dalamnya
**durasi saling meniadakan**, dan akibatnya nyata:

> Satu stint enam bulan dengan kemiripan 0,5 mendapat skor yang **sama persis** dengan karier
> dua puluh tahun berisi lima stint yang seluruhnya berkemiripan 0,5. Lebih buruk lagi,
> riwayat yang tipis justru **diuntungkan**, karena ia tidak punya stint lemah yang
> mengencerkan rata-ratanya.

Rumus sekarang mengakumulasi pengalaman relevan pada **dua sumbu**, masing-masing jenuh pada
targetnya sendiri. Rumus lama tetap dihitung sebagai `meanSimilarity` — hanya diagnostik,
tidak lagi memengaruhi skor — karena ia berguna memisahkan "cocok tetapi terlalu sedikit"
dari "banyak tetapi tidak cocok".

### Durasi tiap riwayat jabatan (stint) dihitung berapa tahun

```
bulan penuh = (tahun_akhir − tahun_awal) × 12 + (bulan_akhir − bulan_awal)
              (dikurangi 1 bila tanggal akhir < tanggal awal dalam bulan itu)
tahun_i     = bulan penuh / 12
```

Hari yang kurang dari satu bulan penuh **dibuang ke bawah**. Stint yang masih berjalan
dihitung sampai hari ini.

### Riwayat jabatan (stint) dipasangkan ke dokumen job profile — empat tingkat: filename, jfm, exact, embedding 0,98

Empat jalur, dicoba **berurutan**; yang pertama berhasil menang. Persis jalur yang dipakai
laporan Job Family Sync, supaya angka di dua tempat tidak pernah berbeda.

| # | `matchType` | Aturan | Kenapa urutannya begini |
|---|---|---|---|
| 1 | `filename` | `position_id` sama dengan kode di awal nama berkas dokumen | Kode pada nama berkas adalah pernyataan eksplisit manusia — paling otoritatif |
| 2 | `jfm` | Baris pasangan di `job_family_matches` (`position_id` → `job_profile_id`) | Hasil pemetaan yang sudah ditinjau |
| 3 | `exact` | Judul ternormalisasi sama persis dengan `position_name` dokumen | Kesamaan harfiah, tanpa tafsir |
| 4 | `embedding` | Kemiripan cosine judul ↔ `position_name` **> 0,98** | Terakhir, dan ambangnya sengaja nyaris identik |

Ambang 0,98 sangat tinggi dengan sengaja: jalur ini hanya untuk menangkap beda tik dan beda
ejaan, bukan untuk menebak jabatan yang mirip-mirip.

Bila keempatnya gagal → stint berstatus `no_match` dan turun ke **cadangan kompetensi**
(§3.5). Bila dokumennya ketemu tetapi vektornya belum ada di `job_profile_embed` → status
`no_embedding`, perlakuannya sama.

### Posisi target dipasangkan ke dokumen job profile — lima tingkat, termasuk kode jabatan incumbent dan dokumen sintetis (pseudo profile)

Lima tingkat. Ini bagian yang paling sering menentukan bentuk seluruh perhitungan, karena
tanpa dokumen target tidak ada yang bisa dibandingkan.

| # | `targetMatchType` | Aturan |
|---|---|---|
| 1 | `jfm` | Pasangan otoritatif `job_family_matches` untuk posisi ini |
| 2 | `filename` / `exact` / `embedding` | Empat jalur §3.3 diterapkan pada deskriptor posisi target |
| 3 | `incumbent_position` | Dokumen dicari lewat **kode jabatan pemangkunya sendiri** (`sync_employee_positions`, `primary_position` dulu, maksimum 5 kode) |
| 4 | `pseudo_profile` | **Dokumen sintetis dirangkai** lalu di-embed (lihat di bawah) |
| — | `no_match` / `no_embedding` | Semua gagal → seluruh stint lewat cadangan kompetensi |

**Tingkat 3 menyelesaikan kasus nyata:** sebuah posisi boleh jadi tidak tertaut ke
baris `positions` mana pun, atau kodenya memang tak punya dokumen, sementara **orang yang
duduk di kursi itu** tercatat pada kode yang punya dokumen.

**Tingkat 4 — dokumen sintetis.** Dirangkai dengan **bentuk label yang sama persis** dengan
template yang menulis `job_profile_embed`, lalu di-embed dengan **model yang sama** yang
mengisi tabel itu — kalau tidak, cosine-nya tidak bermakna:

```
Jabatan: <judul posisi>
Divisi/Departemen: <divisi / departemen>
Tujuan Jabatan: <summary sync_positions, atau jobPurpose posisi>
Kualifikasi Pendidikan: <education posisi>
Pengalaman: <experience posisi>
Kompetensi Teknis: <nama (level N), ...>   ← acuan kompetensi §2.2
```

Baris yang nilainya kosong **dibuang seluruhnya**, persis seperti template aslinya, supaya
dokumen sintetis tidak punya label menggantung yang tak dimiliki dokumen sungguhan.

Tingkat 4 **dilewati** ketika tidak ada satu pun stint yang punya vektor dokumen — tidak ada
yang bisa dibandingkan dengannya, dan semua stint toh akan lewat cadangan. Menghemat satu
panggilan embedding.

### Fallback stint tanpa dokumen job profile: kompetensi incumbent posisi itu, dan kalibrasi p5/p95

Stint yang tidak punya dokumen dinilai dengan mencocokkan **kompetensi pemangku posisi
riwayat itu** melawan **acuan kompetensi target** (§2.2) — memakai **matcher Hungarian yang
sama persis** dengan kriteria technical.

Ini penting dan sering disalahpahami: cadangan ini **posisi lawan posisi**, bukan orang lawan
posisi. Karena itu ia mengukur hal yang sama dengan jalur dokumen (seberapa dekat pekerjaan
itu dengan pekerjaan sasaran), bukan menduplikasi kriteria technical (seberapa siap orangnya).

Hasilnya rasio cakupan 0..1(,25) — **skala yang berbeda** dari cosine dokumen. Maka ia
dikalibrasi:

```
BILA jumlah stint terpasangkan-dokumen < 3            → anchor TETAP
BILA (p95 − p5) < 0,02                                → anchor TETAP
SELAIN ITU                                            → anchor EMPIRIS
    lo = persentil-5  similarity dokumen run ini
    hi = persentil-95 similarity dokumen run ini

similarity_cadangan = clamp01( lo + clamp01(rasio) × (hi − lo) )
```

Anchor tetap: **0,45–0,85** untuk keluarga model Nomic, **0,75–0,95** untuk keluarga E5.

Kenapa dikalibrasi: cosine antar-dokumen job profile itu **mampat dan tinggi** — sepasang
dokumen yang sama sekali tak berhubungan sudah bernilai ~0,45 pada Nomic. Rasio cakupan
mentah 0,3 karenanya akan tampak jauh lebih buruk daripada dokumen mana pun, padahal artinya
tidak begitu.

Bila **tidak ada acuan kompetensi** sama sekali, cadangan tidak tersedia; stint berstatus
`unscored` dan menyumbang **0 ke kedua sumbu**.

### Rescale kemiripan: kenapa cosine 0,60 tidak berarti 60% (simFloor / simCeil)

Satu rescale untuk **kedua jalur**, dikenakan **setelah** cadangan dikalibrasi ke skala
dokumen, supaya keduanya tetap sebanding:

```
sim'_i = clamp01( ( sim_i − simFloor ) / ( simCeil − simFloor ) )
```

| Keluarga model | `simFloor` | `simCeil` |
|---|---|---|
| Nomic (bawaan) | 0,45 | 0,85 |
| E5 | 0,75 | 0,95 |

Anchor ini **tetap dari konfigurasi, bukan persentil per-run**, dan itu keputusan yang
disengaja: sebuah skor Career harus berarti sama antar-run dan antar-posisi. Bila
`simCeil <= simFloor` (salah konfigurasi), rescale jatuh ke identitas supaya kriteria tidak
lenyap diam-diam.

**Inilah jawaban "kenapa cosine 0,60 tidak berarti 60%".** Pada Nomic: `(0,60 − 0,45) /
(0,85 − 0,45)` = **0,375**.

### Akumulasi dua sumbu: tahun relevan efektif (effectiveYears) dan stint relevan efektif (effectiveRows)

```
Per stint:  penyusutan_i  = exp( -0,043 × tahun sejak stint i BERAKHIR )
                            ( stint yang masih berjalan: penyusutan = 1 )
            tahun efektif_i = sim'_i × tahun_i × penyusutan_i

effectiveYears = Σ ( sim'_i × tahun_i × penyusutan_i )   "tahun relevan efektif"
effectiveRows  = Σ ( sim'_i × penyusutan_i )             "stint relevan efektif"
```

Stint yang tidak dapat dinilai menyumbang **0 ke keduanya** — tidak dikeluarkan dari penyebut.
Jadi cakupan yang buruk benar-benar memotong skor, bukan disembunyikan.

**Penyusutan karena usia pengalaman (`CAREER_RECENCY_DECAY`, bawaan 0,043).** Relevansi
menyusut begitu pekerjaannya berhenti dilakukan. Sebelum ini tidak ada penyusutan sama
sekali: stint yang berakhir tahun 2006 dihitung sama besar dengan yang sedang dijalani, dan
`CareerPair.isCurrent` tercatat tanpa pernah masuk ke skor. Angka 4,3% per tahun adalah laju
penyusutan keterampilan dari literatur human capital, bukan konstanta setelan. Diterapkan ke
**kedua sumbu** — penugasan yang sudah lama berakhir juga lebih lemah sebagai *bukti
penugasan*, bukan cuma lebih sedikit tahun relevannya. Terukur: memperlebar jarak antara
relevansi asli dan relevansi palsu dari +34 menjadi +39, karena yang didemosikan tepat
kandidat yang relevansinya hanya berasal dari masa lalu. Faktornya disimpan per stint sebagai
`CareerPair.recencyFactor`. Setel 0 untuk mematikannya.

### Tolok ukur kedalaman bersifat ABSOLUT — jd, fixed, atau inherited (dulu: median pool × 2)

Sejak `CAREER_DEPTH_STATED_MULTIPLIER` = **1**, syarat pengalaman di job profile dipakai **apa adanya** sebagai titik nilai penuh, dan job profile boleh menurunkan tolok ukur (bukan hanya menaikkannya). Setiap run menyimpan pengalinya sendiri di `runInfo.career.depth.statedExperienceMultiplier`; run lama yang tidak menyimpannya dibaca sebagai 2, karena itulah aturan saat run tersebut dinilai.

| Sumber | Kapan | Nilai T |
|---|---|---|
| `inherited` | Run inkremental / turunan | **Dipatok ke run dasar** |
| `jd` | Job profile jabatan sasaran menyebut syarat pengalaman yang bisa dibaca | `syarat tertulis × pengali` (pengali = 1), dijepit 3–20 tahun |
| `fixed` | Selain itu | **8 tahun / 2 stint** |
| `pool` | **ATURAN LAMA** — hanya ada pada run yang selesai sebelum perubahan ini | `median pool × 2` |

**Kenapa aturan `pool` diganti.** Alasan lamanya ("pengalaman relevan yang cukup hanya
berarti sesuatu relatif terhadap orang yang benar-benar bersaing") punya akibat yang fatal:
penggaris menyusut tepat ketika bench-nya paling lemah, sehingga pool yang tidak punya
siapa-siapa justru menghasilkan skor bagus. Terukur pada run yang masih tersimpan:

| Jabatan sasaran | T yang dipakai | Rata-rata Career | Dengan T tetap 8/2 |
|---|---|---|---|
| LEARNING & DEVELOPMENT DEPT HEAD (relevansi rata-rata pool 0,168) | 2,06 th / **1,0** stint — menyentuh batas bawah, jadi **satu** stint sudah menjenuhkan sumbu itu | 33,1 | **11,3** |
| IT APPLICATION DEVELOPMENT DEPT HEAD | 6,71 / 1,80 | 50,2 | 35,9 |
| IT APPLICATION DEVELOPMENT DEPT HEAD | 9,0 / 2,71 | 48,8 | 47,4 |

Inflasinya 1,4× pada pool normal dan 3× pada pool buruk, selalu ke arah membuat bench yang
lemah tampak layak. Career juga DULU satu-satunya besaran yang relatif terhadap peserta di
antara enam aspek, dan satu-satunya yang dua run program sama tidak sebanding. Sekarang
seluruh enam aspek absolut.

**Kenapa syarat tertulis dikali 2 (`CAREER_DEPTH_STATED_MULTIPLIER`).** `jobSpecification.experience`
pada job profile ("Min 5 tahun sebagai Application Developer" — terbaca pada 182 dari 275
profil) adalah batas **MINIMAL untuk dianggap layak**, bukan titik yang pantas mendapat nilai
penuh. Kalau T disamakan dengan syarat minimal, semua yang memenuhi syarat langsung mendapat
100 dan kriteria ini berhenti membedakan siapa pun. `Fresh graduate` (75 profil) menghasilkan
null, bukan 0: syarat "tidak perlu pengalaman" bukan pernyataan bahwa tanpa pengalaman pun
sudah pantas jadi kandidat terkuat.

**Kenapa `inherited` selalu menang.** Kandidat yang dibawa dari run sebelumnya sudah dinilai
dengan penggaris run dasar; mengukur kandidat baru dengan penggaris lain membuat kedua
paruhnya tidak sebanding.

**Median pool masih diukur, tetapi hanya sebagai diagnostik.** "Median pengalaman relevan
bench ini cuma 0,37 stint efektif" adalah kalimat paling berguna tentang bench yang skornya
jelek, jadi angkanya tetap dihitung dan ditampilkan — ia hanya tidak lagi menentukan skala.
Karena itu mesin tetap menjalankan dua lintasan (2a mengukur, 2b memberi skor).

**Konsekuensi yang harus disebut ke user:** ketika `targetSource` sebuah run masih `pool`,
skor Career-nya **relatif terhadap siapa yang ikut dinilai** dan **tidak sebanding** dengan
run yang lebih baru. `targetSource` disimpan **per kandidat**, bukan hanya di tingkat run,
supaya peringatan itu ikut ke mana pun angkanya dibawa.

### Penggabungan dua sumbu: kedalaman MENENTUKAN, keragaman hanya MEMODULASI (dulu: MIN)

```
depthYears = min( 1 , effectiveYears / targetYears )
depthRows  = min( 1 , effectiveRows  / targetRows  )

w = 0,25                                              (CAREER_DEPTH_BREADTH_WEIGHT)
normalized = clamp01( depthYears × ( 1 - w + w × depthRows ) )
skor Career = round( normalized × 100 )

penentu = (1 - depthYears) >= w × (1 - depthRows) ? "years" : "rows"
```

**Kenapa bukan MIN lagi.** Alasan lamanya: "supaya tidak ada satu sumbu pun yang dapat
memaksimalkan kriteria sendirian — banyak stint pendek dibatasi sumbu tahun, satu stint
panjang dibatasi sumbu stint." Paruh pertama benar; paruh kedua adalah cacat yang berkedok
alasan. **Satu penugasan panjang di jabatan sasaran itu sendiri adalah bukti terkuat yang bisa
diterima kriteria ini**, dan `MIN()` membuangnya. Terukur pada run nyata: kandidat dengan 10,6
tahun sebagai *IT Application Development Analyst* mendapat **47**, sementara kandidat yang
seluruh riwayatnya IT support mendapat **100**.

Dari lima bentuk penggabungan yang diuji, bentuk perkalian ini memberi jarak terlebar antara
relevansi asli dan relevansi palsu: **+22** poin, dibanding +2 untuk `MIN()` dan +16 untuk
rata-rata geometrik. Dengan `w = 0,25`, satu penugasan relevan yang dalam tetap memperoleh 75%
nilai penuh, dan keragaman penugasan masih menambah 25%.

**Penentu dibandingkan dari poin yang HILANG, bukan dari capaian mentah.** Di bawah bentuk
perkalian, kedua kerugian tidak setara — kedalaman bisa menghapus seluruh skor, keragaman
paling banyak hanya `w` bagian darinya — sehingga membandingkan `depthYears` dengan
`depthRows` langsung (seperti dulu, ketika keduanya digabung dengan `MIN`) sudah tidak sah.

**Pelandaian bentuk Mincer (`CAREER_DEPTH_CONCAVITY`) TERSEDIA tetapi BAWAANNYA MATI.** Teori
human capital mengatakan imbal hasil pengalaman itu konkaf — itulah sebabnya fungsi pendapatan
Mincer memakai suku pengalaman kuadratik. Nilai di atas 1 menerapkan `x^(1/γ)`. Ia mati secara
bawaan karena sudah diukur dan **memperburuk** tujuan di sini: imbal hasil yang melandai
menaikkan bagian TENGAH skala, dan bagian tengah itulah tempat karier yang panjang tapi tidak
relevan berada. Jaraknya turun dari +39 pada γ=1 menjadi +30 pada 1,5 dan +24 pada 2, dan
rata-rata korpus naik dari 29 ke 42. Bentuk Mincer tepat untuk memodelkan apa yang pengalaman
HASILKAN, salah untuk memutuskan apakah pengalaman itu RELEVAN.

### Contoh perhitungan career relevance lengkap dengan angka

Kandidat dengan empat riwayat, target punya dokumen, model Nomic (floor 0,45 / ceil 0,85):

| Stint | Durasi | Jalur | sim mentah | sim' (rescale) | tahun efektif |
|---|---|---|---|---|---|
| Network Engineer | 6,0 th | `filename` | 0,81 | (0,81−0,45)/0,40 = **0,900** | 5,400 |
| IT Support Spv | 3,5 th | `jfm` | 0,67 | **0,550** | 1,925 |
| Admin Gudang | 4,0 th | cadangan, rasio 0,22 → kalibrasi ke 0,52 | 0,52 | **0,175** | 0,700 |
| Staf di perusahaan luar | 2,5 th | tidak ketemu, tak ada pemegang | — | — (unscored) | 0,000 |

```
effectiveYears = 5,400 + 1,925 + 0,700 + 0 = 8,025
effectiveRows  = 0,900 + 0,550 + 0,175 + 0 = 1,625
```

Pool 30 kandidat, median 4,1 tahun efektif / 1,4 stint efektif → sumber `pool`:

```
targetYears = 4,1 × 2 = 8,20
targetRows  = 1,4 × 2 = 2,80

depthYears = min(1 ; 8,025 / 8,20) = 0,979
depthRows  = min(1 ; 1,625 / 2,80) = 0,580   ← lebih kecil

normalized  = 0,580
skor Career = 58        penentu = "rows"
```

Bacanya: pengalamannya **cukup dalam durasinya** (hampir menyentuh target tahun), tetapi
**terlalu terkonsentrasi** — hanya setara 1,6 stint relevan dari target 2,8. Diagnostik
`meanSimilarity` = 8,025 / 13,5 tahun terpasangkan = 0,594; cakupan = 13,5 / 16,0 = 84%.

### Dari mana batas bawah dan batas atas kemiripan career berasal

Keduanya **diukur**, bukan ditetapkan sebagai konstanta — nilai **TENGAH dari tiga cara
pengukuran yang saling bebas** (`scoring-service/src/career-anchors.ts`, disimpan di
`job_profile_similarity_calibration`, drizzle/0066 + drizzle/0068):

| Cara | Yang diukur | Terukur di sini |
|---|---|---|
| `corpus` | persentil 25 kemiripan antar dokumen sembarang / persentil 99 kemiripan kembar terdekat tiap dokumen. Tidak butuh label apa pun, jadi selalu tersedia. | 0,519 – 0,998 |
| `family` | titik di mana peluang dua jabatan benar-benar serumpun turun ke 50% dan ke 95%, atas pengelompokan Job Family terakhir yang berhasil DAN punya isi. Agak berputar: rumpunnya dibentuk dari vektor yang sama. | 0,672 – 0,878 |
| `transitions` | persentil 10 dan 75 kemiripan **mutasi jabatan yang benar-benar pernah terjadi**, dibaca dari `candidate_position_history`. Satu-satunya yang tidak diturunkan dari kemiripan teks. | 0,633 – 0,892 (102 mutasi) |
| **hasil** | nilai tengah | **0,633 – 0,892** |

Alasannya sama dengan anchor technical: kedua batas itu adalah *pernyataan tentang satu
korpus*. Embed ulang seluruh JD, tambah/kurangi dokumen, atau ganti model, dan sebaran yang
digambarkannya berpindah — sementara setiap cosine tetap terhitung. Tidak ada yang gagal;
hanya *arti* skornya yang bergeser, dan itu bentuk kesalahan yang paling sulit terdeteksi.

**MEKANISME PERBAIKAN DIRI.** Ketiga cara di atas sama-sama membaca kemiripan dokumen job
profile, tetapi dua di antaranya juga bergantung pada data lain yang bisa berubah tanpa
vektornya berubah. Karena itu sidik jarinya mencakup **empat** hal:

```
md5(job_profile_id, content_hash …) : model : t<topicRun>/<n>/h<hashRiwayat> : METHOD_VERSION
```

| Komponen | Berubah ketika | Melindungi cara |
|---|---|---|
| `md5(job_profile_id, content_hash)` | dokumen ditambah, dihapus, atau teksnya berubah | `corpus`, dan seluruh cosine yang dibaca ketiganya |
| `model` | model teks berganti — dokumen sama, ruang berbeda | ketiganya |
| `t<topicRun>/<n>` | Job Family **dikelompokkan ulang** (deployment ini sudah punya 8 pengelompokan selesai) | `family` |
| `h<hashRiwayat>` | riwayat jabatan bertambah atau tanggalnya diperbaiki — sinkronisasi HR mingguan | `transitions` |
| `METHOD_VERSION` | cara pengukurannya sendiri berubah | ketiganya |

Begitu salah satu berubah, run berikutnya menghitung ulang **dengan sendirinya** — tidak ada
tombol yang harus ditekan dan tidak ada jalur penulisan di `lib/job-family-actions.ts` yang
perlu tahu tabel ini ada.

Versi sebelumnya hanya melacak dua yang pertama, dengan alasan kedua acuan berlabel itu
"stabil secara agregat". Alasan itu salah pada bagian yang penting: satu pengelompokan ulang
mengganti **seluruh** nomor rumpun, dan kegagalannya tidak terlihat — respons 200, run
selesai, skala dikalibrasi terhadap pengelompokan yang sudah tidak ada. Perbaikannya cuma satu
query agregat, jadi pertukaran itu memang tidak pernah layak. Riwayat di-**hash** atas
himpunan terurut `(kandidat, posisi, valid_from)`, bukan cuma dihitung jumlahnya, karena
tanggal yang diperbaiki mengubah urutan karier seseorang sehingga mengubah pasangan mana yang
terhitung sebagai perpindahan.

`measureFamily` dan sidik jarinya memilih pengelompokan dengan **aturan yang sama** —
pengelompokan selesai terbaru **yang punya isi**, karena status "selesai" bukan bukti ada
isinya. Menyebut satu pengelompokan di sidik jari lalu membaca yang lain akan membuat hasil
lama dipakai selamanya.

**SATU perubahan yang tidak bisa dideteksi otomatis:** embed ulang yang menghasilkan **vektor
berbeda** dari teks dan model yang **sama** — layanan embedding disetel ulang, atau proses
sebelumnya berhenti di tengah. `content_hash` hanya mencakup teks + nama model, dan justru
itulah sebabnya `rebuildJobProfileEmbeddings` meng-embed ulang semua dokumen tanpa
mempercayai hash itu. Anchor harus memakai asumsi yang sama, jadi tombol "Bangun Ulang
Embedding" memanggil `POST /api/embed/career-anchors/refresh?force=1`. Tanpa `force`, embed
ulang yang justru **memperbaiki** vektor akan meninggalkan skala yang menggambarkan vektor
yang baru saja diganti.

Ini **bukan** persentil per-run yang justru ditolak untuk skala career: persentil per-run
ikut berubah mengikuti siapa yang kebetulan ada di pool — sifat run-nya. Yang ini hanya
berubah mengikuti alat ukurnya. Setiap run tetap mencatat anchor yang dipakainya di
`runInfo.career.scale`.

Sensus pada korpus saat ini — 275 dokumen, 75.350 pasangan silang,
`nomic-embed-text-v2-moe`:

| Sebaran | p05 | p25 | p50 | p75 | p95 | p99 |
|---|---|---|---|---|---|---|
| Pasangan antar-dokumen **sembarang** | 0,461 | **0,519** | 0,562 | 0,612 | 0,709 | — |
| **Kembar terdekat** tiap dokumen (duplikat dibuang) | — | 0,879 | 0,905 | — | 0,991 | **0,998** |

- **Batas bawah = p25 pasangan sembarang.** Sengaja p25 dan bukan mediannya: sebaran
  "pasangan sembarang" ini tidak murni tak-berhubungan — 275 job profile satu perusahaan
  memuat banyak pasangan yang memang berkerabat, dan pasangan itu menumpuk di ujung atasnya.
  Mengambil median atau lebih tinggi akan menghapus sinyal nyata (dua jabatan Sales berbeda)
  bersama derunya.
- **Batas atas = p99 kembar terdekat, setelah duplikat (≥ 0,999) dibuang.** p99 bukan
  maksimum, karena satu pasangan nyaris identik akan menarik plafon ke ~1,0 dan memampatkan
  seluruh skala. Dan duplikat harus dibuang lebih dulu: korpus ini memang memuat 46 pasangan
  pada 37 dokumen di cosine ≥ 0,999 — dokumen yang sama diunggah dua kali atau menghasilkan
  teks identik. Itu **jabatan yang sama**, bukan dua jabatan yang mirip, dan jumlahnya lebih
  dari 1% korpus sehingga ikut mencapai p99.

Nilai lama (0,45–0,85, dipilih per keluarga model dan tidak pernah diukur) salah di **kedua**
ujungnya pada korpus ini:

| Kemiripan mentah | sim' lama (0,45–0,85) | sim' terukur (0,519–0,998) |
|---|---|---|
| p05 pasangan sembarang 0,461 | 0,028 | 0,000 |
| p25 pasangan sembarang 0,519 | 0,173 | 0,000 |
| **p50 pasangan sembarang 0,562** | **0,280** | 0,089 |
| p75 pasangan sembarang 0,612 | 0,405 | 0,194 |
| p95 pasangan sembarang 0,709 | 0,646 | 0,396 |
| p50 kembar sejati 0,905 | **1,000** | 0,807 |
| p95 kembar sejati 0,991 | **1,000** | 0,987 |

Batas bawah 0,45 berada di bawah persentil 5 pasangan sembarang, sehingga pasangan **median
yang tidak berhubungan apa pun** masih bernilai 0,280 — dan karena career mengalikan `sim'`
dengan lama menjabat lalu mengakumulasinya, kebocoran itu masuk ke total tahun-relevan setiap
kandidat. Batas atas 0,85 berada di bawah kembar sejati dokumen median (0,905), sehingga lebih
dari separuh korpus jenuh di 1,000 dan puncak skala berhenti membedakan.

Konstanta lama tetap dipertahankan **hanya** sebagai cadangan terakhir bila korpusnya belum
ada, kurang dari 30 dokumen, atau sebarannya degenerat — dan run melaporkan mana yang dipakai
lewat `runInfo.career.scale.source` (`measured` / `env` / `fallback`).

### Seluruh konstanta dan variabel lingkungan kriteria career relevance

| Konstanta | Nilai bawaan | Variabel lingkungan |
|---|---|---|
| `simFloor` | **diukur** — nilai tengah tiga cara pengukuran (0,633 pada korpus saat ini) — cadangan 0,45 (Nomic) / 0,75 (E5) | `CAREER_SIM_FLOOR` (menyematkan) |
| `simCeil` | **diukur** — nilai tengah tiga cara pengukuran (0,892 pada korpus saat ini) — cadangan 0,85 (Nomic) / 0,95 (E5) | `CAREER_SIM_CEIL` (menyematkan) |
| Ambang cocok judul via embedding | 0,98 | — (tetap di kode) |
| `fixedTargetYears` / `fixedTargetRows` | **8 / 2** | `CAREER_DEPTH_TARGET_YEARS` / `_ROWS` |
| Pengali syarat pengalaman job profile | 2 | `CAREER_DEPTH_STATED_MULTIPLIER` |
| Pakai syarat pengalaman job profile | ya | `CAREER_DEPTH_USE_STATED` |
| Jepitan target tahun | 3 – 20 | `CAREER_DEPTH_MIN/MAX_TARGET_YEARS` |
| Jepitan target stint | 1 – 8 | `CAREER_DEPTH_MIN/MAX_TARGET_ROWS` |
| Bobot keragaman penugasan (`w`) | 0,25 | `CAREER_DEPTH_BREADTH_WEIGHT` |
| Pelandaian Mincer (`γ`) | 1 (mati) | `CAREER_DEPTH_CONCAVITY` |
| Penyusutan usia pengalaman per tahun | 0,043 | `CAREER_RECENCY_DECAY` |
| Anchor kalibrasi cadangan | mengikuti `simFloor`–`simCeil` run tersebut | `CAREER_FALLBACK_ANCHOR_LO` / `_HI` (menyematkan) |
| Batas atas jalur kompetensi (`cap`) | 0,50 dari rentang penuh | `CAREER_FALLBACK_CAP` |
| Bobot kekhasan kompetensi (IDF) | aktif | `CAREER_FALLBACK_IDF` |

### Semua kondisi career relevance dan akibatnya, termasuk riwayat di perusahaan luar yang tidak dinilai (unscored)

| Kondisi | Akibat |
|---|---|
| Target punya dokumen, stint punya dokumen | Jalur normal, `basis = document` |
| Target punya dokumen, stint tidak | Cadangan kompetensi, `basis = incumbent_competency` |
| Target punya dokumen, stint tidak & posisinya tak punya pemegang | `unscored`, menyumbang 0 |
| Target tanpa dokumen, tetapi ada acuan kompetensi | Dokumen sintetis dicoba; gagal → **seluruh** stint lewat cadangan |
| Target tanpa dokumen **dan** tanpa acuan kompetensi | **Kriteria Career dibuang**, bobotnya dibagi ulang |
| Tidak satu pun stint kandidat dapat dinilai | Skor 0 — kriterianya sendiri **tidak** dibuang |
| Pool < 5 kandidat | Tolok ukur `fixed` (5 th / 3 stint) |
| Run turunan / inkremental | Tolok ukur `inherited` dari run dasar |

Setiap penurunan mutu ini **dinyatakan**, tidak pernah tersirat: per stint lewat `status` dan
`basis`, per kandidat lewat hitungan cakupan, per run lewat `CareerRunInfo`, dan tampil di
halaman Progress Running.

---

## Rumus Behavior Competency Assessment (kompetensi perilaku) — kategorisasi ordinal berpasangan

Sumbernya rekomendasi asesmen behavior **terbaru** karyawan. Kategorinya dinilai
**berpasangan**: dua kategori berbagi satu nilai ordinal.

| Nilai | Kategori (pasangan) | Skor |
|---|---|---|
| 6 | VERY HIGH · STRENGTH | 100 |
| 5 | HIGH · READY | 83 |
| 4 | MIDDLE HIGH · PENGEMBANGAN JANGKA PENDEK | 67 |
| 3 | READY WITH DEVELOPMENT · POTENSI | 50 |
| 2 | NEED DEVELOPMENT (9 MONTHS - 2 YEARS) · MIDDLE LOW | 33 |
| 1 | FOCUS ON OPTIMIZATION IN CURRENT POSITION · LOW | 17 |
| 0 | BELUM ADA POTENSI · VERY LOW · NOT READY | 0 |

```
skor Behavior = round( nilai × 100 / 6 )
```

**Pencocokan teks bertingkat**, karena data lapangan berisi variasi penulisan: sama persis →
kategori **terpanjang** yang terkandung di dalam nilai (nilai berhias) → kategori
**terpendek** yang mengandung nilai (nilai terpotong). Tidak dikenali atau kosong → **0**,
sebab tidak ada bukti positif untuk diperingkat.

---

## Rumus Performance Appraisal (nilai kinerja) — TOPSIS absolut dinamis dan bobot tiap periode semester

Memakai **TOPSIS solusi absolut dinamis**, bukan TOPSIS klasik.

- **Absolut** — solusi ideal positif dan negatif adalah jangkar **tetap**: semua-A dan
  semua-D. Bukan diturunkan dari kandidat lain, sehingga skornya sebanding antar-run.
- **Dinamis** — tiap periode punya bobot berbeda menurut kebaruannya.

```
Nilai huruf : A=4  B=3  C=2  D=1  E=0
Slot kosong dibaca sebagai C (konvensi parser lama)
Ideal positif = 4 (A)      Ideal negatif = 1 (D)
Maksimum 6 periode, terbaru lebih dulu
```

**Bobot periode diturunkan dengan AHP.** Vektor preferensi kebaruan `0,8^k` diubah menjadi
matriks perbandingan berpasangan yang konsisten, lalu vektor prioritasnya diambil sebagai
bobot. CR = 0 menurut konstruksinya.

| Periode | 1 (terbaru) | 2 | 3 | 4 | 5 | 6 (terlama) |
|---|---|---|---|---|---|---|
| Preferensi `0,8^k` | 1,0000 | 0,8000 | 0,6400 | 0,5120 | 0,4096 | 0,3277 |
| **Bobot** | **27,11%** | **21,68%** | **17,35%** | **13,88%** | **11,10%** | **8,88%** |

```
D+ = sqrt( Σ w_k × (nilai_k − 4)² )
D− = sqrt( Σ w_k × (nilai_k − 1)² )
skor PA = round( D− / (D+ + D−) × 100 )
```

Bobot **dinormalisasi ulang atas slot yang benar-benar ada**, sehingga karyawan dengan tiga
periode tidak dirugikan dibanding yang punya enam.

---

## Rumus HAV Mapping — skor tiap kuadran HAV

Aturan tabel murni atas nomor kuadran HAV, lima tingkat:

| Skor | Kuadran | Makna |
|---|---|---|
| 100 | 1 | Star |
| 80 | 2, 3, 4, 7, 8 | Direkomendasikan |
| 60 | 5, 6, 9, 13, 14 | Belum bisa direkomendasikan / kontributor solid |
| 40 | 10, 11, 12, 15 | Tidak direkomendasikan |
| 20 | 16 | Bottom |

Kuadran **13 dan 14** tidak ada pada tabel dokumen tata kelola; keduanya adalah kontributor
solid (Maximal Contributor / Contributor) dan ditempatkan setingkat 5/6/9.

Data **kosong atau tidak terbaca → 40**, bukan 20: tidak adanya data tidak sama dengan
terbukti berada di kuadran terbawah.

---

## Rumus Employee Profile - Pendidikan — kecocokan token lalu Gemini ter-grounding

Satu-satunya kriteria yang menyentuh LLM, dan sengaja dipagari dua lapis.

### Dari mana syarat pendidikan posisi diambil — tiga tingkat

1. `educationRequirement` pada dokumen job profile
2. Kolom `education` posisi
3. **Pendidikan pemangku jabatan sendiri** — ketika tak ada yang menyatakan syaratnya, orang
   yang mengerjakan pekerjaan itulah tolok ukurnya

Tanpa tingkat 3, posisi tanpa dokumen akan menilai setiap kandidat terhadap `null`, dan tidak
ada kecocokan persis yang mungkin terjadi.

### Kecocokan pendidikan deterministik tanpa model — skor tetap 90

```
Jenjang cocok BILA:
    syarat memuat kata "minimal/min/setidaknya/paling rendah"
        → peringkat kandidat >= peringkat terendah yang disebut syarat
    selain itu
        → peringkat kandidat termasuk salah satu yang disebut syarat

Jurusan cocok BILA:
    syarat memuat "semua/any/all" (mis. "semua jurusan")
    ATAU token jurusan kandidat beririsan dengan token jurusan syarat

Keduanya cocok → skor TETAP 90, tanpa memanggil model sama sekali
```

Peringkat jenjang: SD 1 · SMP 2 · SMA/SMK/STM/MAN 3 · D1 4 · D2 5 · D3 6 · D4 7 · S1 8 ·
S2 9 · S3 10 (sinonim dilipat: sarjana=S1, magister/master=S2, doktor/PhD=S3).

### Penilaian pendidikan oleh Gemini ter-grounding bila tidak ada kecocokan persis

Bila tidak ada kecocokan persis, penilaian dilakukan Gemini **dengan Grounding Google Search**,
`temperature = 0`, `topP = 0`, rubrik tetap, keluaran JSON divalidasi dan diulang sampai 2 kali.

Yang dinilai adalah kesesuaian pendidikan terhadap **tanggung jawab dan indikator keberhasilan**
jabatan — bukan sekadar syarat minimal tertulis.

```
Rubrik jangkar: 100 sangat sesuai · 80 relevan · 60 cukup · 40 kurang · 20 tidak relevan
skor Education = round( (education_level + major_relevance) / 2 )
```

Grounding wajib supaya alasannya **mengutip sumber yang dapat diperiksa** — itu syarat untuk
keperluan gap analysis.

### Kenapa pendidikan bisa berstatus tidak dinilai, dan kenapa cadangan BERT dihapus

Kemiripan BERT dulu dipakai sebagai cadangan, lalu **dihapus** karena ia memberi nilai terlalu
tinggi kepada jurusan yang tidak relevan (contoh nyata: "Ekonomi Studi Pembangunan" terhadap
"S1 Manajemen Informatika"). Jadi bila Gemini tidak terkonfigurasi atau tak pernah lolos
validasi, pendidikan dilaporkan **"tidak dinilai" (0)** — angka yang jujur, bukan angka yang
terlihat masuk akal tetapi salah.

Bila **tidak satu pun** kandidat dapat dinilai pendidikannya, kriteria ini dibuang dan
bobotnya dibagi ulang.

---

## Setelah keenam skor: kriteria dibuang, bobot AHP dinormalisasi ulang, lalu TOPSIS akhir

### Kriteria mana yang dibuang dari perhitungan dan syaratnya

| Kriteria | Dibuang bila |
|---|---|
| `technical` | Acuan kompetensi target kosong (`requiredSource = none`) |
| `career` | Target tak punya dokumen **dan** tak ada acuan kompetensi |
| `education` | **Setiap** kandidat berstatus "tidak dinilai" |

Dinilai atas **seluruh kandidat yang diperingkat**, bukan hanya yang baru dinilai — pada run
inkremental atau re-rank pengecualian, himpunan yang baru dinilai bisa kosong.

Pengaman: bila semuanya terbuang, himpunan penuh dipakai kembali — tanpa kriteria tidak ada
yang bisa diperingkat.

### Bobot AHP dinormalisasi ulang setelah kriteria dibuang

```
bobot_efektif_k = bobot_k / Σ bobot kriteria AKTIF        (0 untuk yang dibuang)
```

Bobot AHP sendiri berasal dari dua sumber berurutan: matriks perbandingan berpasangan yang
disunting di Tata Kelola (`ahp-matrix`) → bobot bawaan (`default`: behavior 35, technical 25,
HAV 20, PA 10, career 5, pendidikan 5). Daftar kriteria program **tidak** ikut menentukan bobot
— ia hanya deskriptif, tanpa editor, dan tidak dibaca mesin — sehingga setiap run tanpa matriks
memakai bobot yang sama persis. Rasio konsistensi CR dihitung dan dicatat; CR > 0,1 berarti matriksnya
kurang konsisten (bobot bawaan selalu CR = 0 karena matriksnya dibangun sebagai w_i/w_j).

### Rumus TOPSIS akhir: normalisasi, solusi ideal, jarak, closeness

```
1. Normalisasi vektor : r_ij = x_ij / sqrt( Σ_i x_ij² )
2. Pembobotan         : v_ij = w_j × r_ij
3. Solusi ideal       : A+ = max_i v_ij   ,  A− = min_i v_ij     (semua benefit)
4. Jarak              : D+_i = sqrt( Σ_j (v_ij − A+_j)² )
                        D−_i = sqrt( Σ_j (v_ij − A−_j)² )
5. Kedekatan          : C_i = D−_i / (D+_i + D−_i)
```

Keenam kriteria bersifat **benefit** (makin tinggi makin baik). `C_i` inilah skor akhir yang
menentukan peringkat.

**TOPSIS bersifat relatif terhadap himpunan.** Ideal positif dan negatif diturunkan dari
kandidat yang ikut dinilai, jadi mengeluarkan satu orang mengubah skor semua orang. Itulah
alasan re-rank pengecualian **wajib** menghitung ulang TOPSIS, dan alasan run dasar tidak
pernah diubah — sebuah peringkat yang selesai adalah catatan penilaian pada satu tanggal.

---

## Tabel ringkas: angka kriteria ini datang dari mana

| Yang ditanyakan user | Jawabannya ada di |
|---|---|
| "Kenapa skor technical-nya 62?" | §2.5–2.6 — Σ nilai kolom / M, lihat detail pasangan Hungarian |
| "Acuan kompetensinya dari mana?" | §2.2 — empat tingkat, cek `requiredSource` pada detail run |
| "Kenapa skor career-nya kecil padahal pengalamannya panjang?" | §3.9 — periksa penentu; kemungkinan dibatasi sumbu **stint** |
| "Kenapa cosine 0,60 hanya bernilai 0,375?" | §3.6 — rescale dengan anchor tetap |
| "Riwayat di perusahaan luar dihitung tidak?" | §3.5 — tidak ada dokumen & tidak ada pemegang → `unscored`, menyumbang 0 |
| "Posisi targetnya tidak punya job profile, lalu bagaimana?" | §3.4 tingkat 3–4 — kode jabatan pemangku, lalu dokumen sintetis |
| "Kenapa skornya berubah padahal orangnya sama?" | §3.8 — tolok ukur `pool` bersifat relatif terhadap peserta |
| "Kenapa nilai PA periode lama kurang berpengaruh?" | §5 — bobot AHP kebaruan, 27,11% turun ke 8,88% |
| "Kenapa pendidikannya 'tidak dinilai'?" | §7.4 — Gemini tak terkonfigurasi atau gagal validasi; cadangan BERT sengaja dihapus |
| "Kenapa salah satu kriteria hilang dari perhitungan?" | §8.1 — dibuang karena tak terukur, bobotnya dibagi ulang |
