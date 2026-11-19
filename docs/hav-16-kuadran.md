# HAV 16 Kuadran: Otomasi & Terjemahan ke 5-Box

Bagaimana setiap karyawan mendapat kuadran HAV (1–16) **tanpa upload Excel**,
dari dua data yang sudah tersinkron — Performance Appraisal dan rekomendasi
kompetensi behavioral — dan bagaimana ke-16 kuadran itu dibaca sebagai 5-Box.

> Nama dan warna kelima box dulu dipinjam dari modul Talent Matrix
> (`components/talent/box-meta.ts`). Modul itu **dihapus dari `main`** (branch
> `parked/talent-5box`, lihat [`docs/talent-5box-parked.md`](talent-5box-parked.md));
> `BOX_META` dipindah ke [`lib/hav-box-meta.ts`](../lib/hav-box-meta.ts) supaya
> panel ini tidak ikut terhapus. Rollup di halaman ini tidak pernah membaca
> `talent_data_staging`, jadi tidak ada perhitungan yang berubah.

Mesinnya murni (tanpa I/O) di [`lib/hav-quadrant-derive.ts`](../lib/hav-quadrant-derive.ts);
kosakata kuadran (nomor, nama, kategori) tetap milik
[`lib/hav-quadrant.ts`](../lib/hav-quadrant.ts).

Rumus ini adalah tier ketiga dari **HAV yang berlaku**
([`lib/hav-effective.ts`](../lib/hav-effective.ts), [`docs/talent-mapping.md`](talent-mapping.md)):
penempatan manual Talent Mapping → upload HAV → rumus. Satu nilai itu dibaca oleh
semua pembaca — aturan filter, scoring (lewat salinan di
`scoring-service/src/hav-effective.ts`), profil kandidat, Beranda, dan Talent
Mapping sendiri — sehingga satu orang tidak bisa berada di dua kuadran di dua
layar karena alasan kode. Salinan ketiga ada di
`sync-service/src/services/hav-effective.ts`: sync-service perlu rumus ini untuk
tahu kapan PA/BA baru dari MSSQL **menggeser** HAV otomatis seseorang (lihat
§ Urutan waktu di bawah).

## Kenapa ada

`candidates.hav_quadrant` diisi dari upload Excel HAV (`sync_hav`). Selama itu
satu-satunya sumber, HAV Heat Grid menggambarkan **seberapa lengkap satu
spreadsheet**, bukan kondisi organisasi: karyawan yang PA dan assessment
center-nya sudah tersinkron tetap terbaca "tanpa kuadran" sampai ada orang yang
mengetikkan nomornya. Kedua sumbu grid itu sudah ada di Postgres, jadi kuadrannya
bisa dihitung.

## Presedensi: HAV yang berlaku

| Urutan | Sumber | Catatan |
|---|---|---|
| 1 | Penempatan manual Talent Mapping | Keputusan reviewer, wajib alasan, diaudit |
| 2 | `candidates.hav_quadrant` (upload HAV) | Hasil kalibrasi HR — sumber utama |
| 3 | Turunan PA × kompetensi behavioral | Dihitung saat baca, tidak disimpan |
| 4 | — | Dilaporkan sebagai "tanpa data", bukan ditebak |

**Urutan waktu menentukan antara 1 dan sisanya: yang terakhir menang.**
Penempatan manual berlaku selama ia lebih baru dari sync terakhir yang
**mengubah** HAV otomatis (2, atau 3 bila tanpa 2) orang itu —
`candidates.hav_auto_changed_at`, drizzle/0080. Sync itu bisa upload HAV (kapan
pun diunggah), HAV.xlsx di folder bersama, atau Sync Kandidat yang membawa PA/BA
baru dari MSSQL sehingga hasil rumus bergeser. Sync yang tidak mengubah HAV
otomatis — membaca ulang Excel yang sama, data yang hilang dari sumber, salinan
ulang nilai upload lama — tidak menyentuh penempatan. Sejak 2026-11 setiap
perubahan PA atau Behavior (edit di Kandidat, upload Excel PA/BA, sync) dan
tombol "Hitung kuadran HAV" menempatkan HAV menurut rumus, juga di atas upload
HAV yang lebih lama (`candidates.hav_auto_tier`, drizzle/0098). Rinciannya di
[`docs/talent-mapping.md`](talent-mapping.md#urutan-waktu-peristiwa-yang-menempatkan-ulang-hav).
**Rumus tidak membatalkan keputusan manusia secara diam-diam**: ia hanya
menggantikan penempatan bila datanya benar-benar berubah setelah penempatan itu
dibuat, dan setiap penggantian tercatat.

## Turunan rumus kini ikut dinilai — keputusan sadar (2026-10)

Bagian ini dulu bernama *Yang TIDAK dilakukan*, dan alasannya tetap benar:
`scoring-service/src/ahp-topsis-engine.ts` menilai HAV sebagai aspek tersendiri
berbobot 20%, berdampingan dengan behavior (35%) dan PA (10%). HAV turunan rumus
adalah fungsi murni PA dan behavior, jadi untuk kandidat yang HAV-nya berasal
dari rumus, **65% bobot AHP bertumpu pada dua input yang sama**.

Konsekuensi itu diajukan ke HR, dan HR memilih memakainya: HAV yang berlaku —
termasuk tier rumus, di bawah upload — dipakai aturan filter **dan** scoring.
Yang dilakukan agar keputusan itu tetap terlihat:

- Turunannya tetap **tidak disimpan** ke `candidates.hav_quadrant`; kolom itu
  tetap berarti "nilai upload", dan HAV yang berlaku dihitung saat baca di setiap
  deployable (`tests/talent-mapping/hav-parity.test.ts` menjaga ketiga salinan
  sama). Yang disimpan hanya **kapan** hasilnya berubah karena sync
  (`hav_auto_changed_at`), bukan nilainya.
- Setiap run mencatat sumber HAV per kandidat (`rawInputs.havSource`) dan
  rekapnya (`runInfo.hav.sources`), sehingga berapa kandidat yang HAV-nya dari
  rumus dapat dibaca dari run itu sendiri.
- Diukur pada data lokal saat perubahan: **0** kandidat memakai tier rumus —
  setiap kandidat yang PA × BA-nya dapat dihitung sudah punya upload HAV. Data
  produksi bisa berbeda; angka per run ada di `runInfo.hav`.

## Sumbu 1 — Performance (dari `candidates.performance_grade`)

Kolom itu CSV enam slot yang ditulis `sync-service/src/services/candidate-populate.ts`,
terbaru dulu, dua slot per tahun:

```
[thn-1 S2, thn-1 S1, thn-2 S2, thn-2 S1, thn-3 S2, thn-3 S1]
```

Rumusnya — "PA 1 tahun terakhir atau 2 periode terakhir" — memakai **dua
jendela** (`readPerformance()`):

| Jendela | Isi | Dipakai untuk |
|---|---|---|
| **2 periode terakhir yang bernilai** | dua semester terbaru yang terisi | band High / Mid High / Mid Low |
| **2 tahun terakhir** (slot 1–4) | yr-1 S2, yr-1 S1, yr-2 S2, yr-2 S1 | aturan Low |

| `performance_score` | Band |
|---|---|
| `AA`, `AB`, `BA`, `BB` | **High** |
| `CA`, `CB`, `AC`, `BC` | **Mid High** |
| `CC` | **Mid Low** |
| **pernah ada** `D`, `E`, `C-` dalam 2 tahun terakhir | **Low** |

Aturan Low dicek **lebih dulu** dan mengalahkan dua periode terbaru: `A,A,D,B`
adalah Low walaupun tahun terakhirnya AA — "khusus jika pernah ada D, E, C- pada
2 tahun terakhir". Huruf di bawah C pada tahun ke-3 **tidak** memicunya
(`A,A,B,B,D,E` tetap High). Pasangan yang terpaksa mundur sampai tahun ke-3 dan
memuat D tetap Low — tabel band tidak punya sel lain untuk D.

Pasangan dievaluasi atas **himpunan**, bukan urutan — setiap pasangan di daftar
muncul dalam dua arah, jadi `AC` dan `CA` memang satu band:

- keduanya ∈ {A, B} → **High**
- satu C + satu ∈ {A, B} → **Mid High**
- keduanya C → **Mid Low**

"Bernilai" penting ke dua arah. Slot kosong **dilewati**, bukan dibaca sebagai
nilai: `sync_performance_appraisals` rutin belum berisi tahun berjalan, dan
membaca slot pertama saja akan menaruh seluruh karyawan di "tanpa PA". Dan
pasangannya adalah dua periode bernilai **terbaru meski melintasi batas tahun**:
dengan semester terbaru kosong, `–,B,C,C` dibaca `B` dan `C` (Mid High), bukan `B`
tunggal yang digandakan (High).

Satu-satunya periode bernilai di seluruh jendela dibaca seolah berulang (`C`
sendiri → `CC` → Mid Low) — bacaan konservatif yang tidak pernah menaikkan orang
atas setengah bukti.

`splitPerformanceSlots()` sengaja **tidak** membuang slot kosong (berbeda dari
`parsePerformancePeriods` di `lib/programs.ts`): kedua jendela perlu tahu satu
huruf milik slot mana, dan daftar yang sudah difilter tidak lagi bisa membedakan
satu semester hilang dari satu tahun hilang. `readPerformance()` juga
mengembalikan **slot mana** yang menentukan (`periodSlots`, `lowTrigger`), supaya
Talent Mapping bisa menunjuk huruf yang memutuskan band — termasuk D di luar
pasangan terbaru, kasus yang paling perlu dijelaskan.

> **Perubahan 2026-10.** Sebelumnya grid membaca **satu tahun** (tahun terbaru
> yang punya nilai) dan Low hanya dipicu D/E di tahun itu. Spesifikasi Talent
> Mapping HR mengganti keduanya: Low melihat 2 tahun, band lain membaca 2 periode
> bernilai terakhir. Diukur pada data lokal saat perubahan: 0 dari 821 kandidat
> berpindah kuadran (data uji tidak memuat D/E maupun semester bolong), tetapi
> data produksi bisa berbeda — Beranda ikut berubah karena memakai fungsi yang sama.
> Dipaku oleh `tests/talent-mapping/hav-formula.test.ts`.

## Sumbu 2 — Kompetensi (dari `candidates.behavior_recommendation`)

Sumbernya `sync_behavior_competencies.rekomendasi_name` (kosakata
DVP_MASTER_REKOMENDASI, didaftar di `lib/candidate-field-values.ts`).

| Band | Kategori |
|---|---|
| **High** | STRENGTH |
| **Mid High** | VERY HIGH, PENGEMBANGAN JANGKA PENDEK |
| **Mid Low** | NEED TARGETED DEVELOPMENT, HIGH, READY, POTENSI, MIDDLE HIGH, READY WITH DEVELOPMENT |
| **Low** | LOW, MIDDLE LOW, FOCUS ON OPTIMILIZATION |

Empat nilai ada di kosakata repo tapi tidak di daftar metodologi. Penempatannya
mengikuti peringkat di `BEHAVIOR_RANKING` (`scoring-service/src/ahp-topsis-engine.ts`),
peringkat yang sudah dipakai penilai behavior AHP:

| Nilai | Band | Alasan |
|---|---|---|
| `NEED DEVELOPMENT (9 MONTHS - 2 YEARS)` | Mid Low | "NEED TARGETED DEVELOPMENT" metodologi; seperingkat POTENSI |
| `BELUM ADA POTENSI` | Low | dasar peringkat (nilai ordinal 0) |
| `VERY LOW` | Low | dasar peringkat |
| `NOT READY` | Low | dasar peringkat |

Pencocokan: normalisasi (huruf besar, spasi tunggal, en/em dash → hyphen) →
cocok persis → baru fallback containment (menyerap bentuk berhias seperti
`READY WITH DEVELOPMENT (2024)` dan bentuk terpotong). Nilai yang tetap tak
dikenali menghasilkan **null**, bukan band tebakan — band salah berarti kuadran
salah berarti box salah.

## Matriks output

`HAV_QUADRANT_MATRIX[kompetensi][performance]` → nomor kuadran. Ke-16 sel
ditulis eksplisit, tidak dihitung dari indeks: penomorannya bukan pemindaian
baris grid melainkan menyusuri diagonal (Q1 di sudut, lalu Q2/Q3/Q4 mengitarinya)
persis seperti dokumen metodologi menomorinya.

| Kompetensi ↓ / Perf → | High | Mid High | Mid Low | Low |
|---|---|---|---|---|
| **High** | **Q1** STAR · TOP | **Q4** FUTURE STAR · STRONG | **Q6** RAW DIAMOND · SOLID | **Q10** MOST UNFIT EMPLOYEE · BORDER |
| **Mid High** | **Q2** FUTURE STAR · STRONG | **Q3** POTENTIAL CANDIDATE · STRONG | **Q5** CANDIDATE · SOLID | **Q11** UNFIT EMPLOYEE · BORDER |
| **Mid Low** | **Q7** TOP PERFORMER · STRONG | **Q8** STRONG PERFORMER · SOLID | **Q9** CAREER PERSON · SOLID | **Q12** PROBLEM EMPLOYEE · BORDER |
| **Low** | **Q13** MAXIMAL CONTRIBUTOR · STRONG | **Q14** CONTRIBUTOR · SOLID | **Q15** MINIMAL CONTRIBUTOR · BORDER | **Q16** DEADWOOD · BOTTOM |

Nama dan kategori tiap sel diambil dari `HAV_QUADRANTS`, bukan diulang di sini.

Talent Mapping **menggambar** grid ini dengan orientasi metodologi
(`HAV_GRID_ROWS` / `HAV_GRID_COLUMNS`): BA High di atas, PA High di **kanan** —
jadi barisnya terbaca `Q10 | Q6 | Q4 | Q1` dari kiri. Tabel di atas menulis PA
dari High ke Low; isinya sama, hanya arah kolomnya yang terbalik.

## Kalau kuadran tidak bisa diturunkan

`deriveHavQuadrant()` mengembalikan alasannya, bukan sel default — grid tidak
punya sel untuk "setengah diketahui":

| Gap | Arti |
|---|---|
| `performance-missing` | Tidak ada satu pun semester bernilai di jendela 3 tahun |
| `competency-missing` | `behavior_recommendation` kosong |
| `competency-unrecognized` | Ada isinya, tapi bukan kategori yang dikenali |

Satu karyawan bisa kena lebih dari satu gap, dan Beranda menghitung semuanya —
supaya pembaca tahu sync mana yang harus dikejar, bukan hanya bahwa ada yang
kosong.

## 16 kuadran → 5-Box

`talentBoxFromQuadrant(n)` adalah **lookup ke kolom `category` milik
`HAV_QUADRANTS`**, bukan aturan kedua. Kolom itu sudah memuat TOP / STRONG /
SOLID / BORDER / BOTTOM untuk setiap kuadran, jadi menurunkan box lagi dari
band akan menciptakan jawaban kedua atas pertanyaan yang tabelnya sudah jawab.

| Box | Kuadran |
|---|---|
| TOP | 1 |
| STRONG | 2, 3, 4, 7, 13 |
| SOLID | 5, 6, 8, 9, 14 |
| BORDER | 10, 11, 12, 15 |
| BOTTOM | 16 |

Q13 dulu berkategori SOLID. Dokumen metodologi tidak mencantumkan kuadran 13 dan
14, jadi keduanya pernah diisi SOLID sebagai tebakan implementasi; spesifikasi
Talent Mapping HR (2026-10) menetapkan **Q13 STRONG** dan Q14 SOLID. Ini hanya
kategori 5-Box — tier **skor** HAV di AHP+TOPSIS (`HAV_GROUP_SCORES`,
scoring-service) adalah bacaan terpisah dan Q13 tetap di tier 60 di sana.

## Aturan 5-Box versi metodologi (jendela 3 tahun)

`talentBoxFromRules()` menyatakan 5-Box **langsung**, bukan lewat kuadran, dari
jendela PA tiga tahun penuh dan tier assessment center:

| Box | PA (6 periode) | Assessment center |
|---|---|---|
| TOP | semua A atau B | STRENGTH, VERY HIGH |
| STRONG | campuran A, B, C | HIGH, PENGEMBANGAN JANGKA PENDEK, READY |
| SOLID | semua C | BUTUH PENGEMBANGAN, POTENSI, MIDDLE HIGH, READY WITH DEVELOPMENT |
| BORDER | ada di bawah C | LOW, MIDDLE LOW, VERY LOW, FOCUS ON OPTIMALIZATION, NOT READY |
| BOTTOM | ada di bawah C | sisa terbawahnya (mis. BELUM ADA POTENSI) |

Setiap aturan memasangkan tier PA dengan tier assessment center pada level yang
sama, jadi ketika kedua sumbu berbeda **yang lebih lemah menentukan** — PA TOP
dengan assessment MIDDLE LOW bukan talenta TOP, dan daftar aturannya tidak punya
sel yang berkata lain. Perlu kedua sumbu; satu saja → null.

**Ini bacaan yang berbeda dari `talentBoxFromQuadrant`, dan bedanya memang ada,
bukan bug.** Grid mem-band **satu** tahun, aturan ini mengkuantifikasi **tiga**.
Orang dengan satu C di tahun-3 lalu A/B sejak itu adalah STRONG di sini, tapi
masih bisa Q1 di grid. Belum ada yang mengonsumsi fungsi ini — ia ada supaya
kedua bacaan bisa dibandingkan eksplisit (dan selisihnya ditampilkan) alih-alih
salah satunya diam-diam dianggap menyiratkan yang lain.

Perhatikan juga bahwa keduanya **bukan** `talent_data_staging.system_recommended_box`,
yang dihitung dari skor numerik (PA berbobot + assessment center + kompetensi
teknis) — lihat [`docs/talent-5box-data-sources.md`](talent-5box-data-sources.md).
Tiga cara membaca "5-Box" hidup bersama di repo ini dengan sengaja; yang salah
adalah menyalin angka salah satunya ke tempat yang mengharapkan yang lain.

## Apa yang ditampilkan Beranda

`getDashboardOverview` (`lib/pulse-data.ts`) mengembalikan tiga hal untuk grid:

| Field | Isi |
|---|---|
| `havDistribution[]` | Per kuadran HAV yang berlaku: `employees`, `manual`, `stored`, `derived` — **dipisah**, karena "43 kandidat di Q9" berarti lain kalau 40 di antaranya hasil inferensi, dan lain lagi kalau 3 dipindah tangan |
| `havCoverage` | `manual` / `stored` / `derived` / `unknown` / `total` + rincian `gaps` |
| `havBoxRollup[]` | Grid dalam kosakata 5-Box, lengkap dengan nomor kuadran penyusunnya |

Di kartunya: warna sel adalah **5-Box kuadran itu**, bukan populasinya. Heat ramp
lama mewarnai sudut terpadat merah — sudut mana pun itu — padahal Q1 dan Q16
adalah hasil yang berlawanan; populasi tetap terbaca dari lebar bar. Sel yang
sebagian angkanya turunan ditandai `~`, dan tooltip-nya memecah stored vs
otomatis. Di bawah grid ada strip 5-Box dan satu baris asal angka.

## Kenapa tidak dipersistensi ke `candidates.hav_quadrant`

Ketika HAV turunan akhirnya dipakai scoring (lihat
[keputusan 2026-10](#turunan-rumus-kini-ikut-dinilai--keputusan-sadar-2026-10)),
caranya **bukan** menulis turunan ke `candidates.hav_quadrant`, karena tiga
alasan yang dulu tercatat di sini tetap berlaku:

1. **Bobot AHP.** HAV, behavior dan PA tidak lagi tiga aspek independen untuk
   baris turunan — keputusan itu diambil sadar, dan dicatat per run lewat
   `rawInputs.havSource` / `runInfo.hav`.
2. **Kolom terpisah.** Menulis ke kolom yang sama membuat nilai upload dan nilai
   turunan tidak bisa dibedakan lagi setelah satu sync — dan `ON CONFLICT` di
   `candidate-populate.ts` menimpa `hav_quadrant` setiap Senin 01:00. Maka kolom
   itu tetap "nilai upload", penempatan manual punya tabelnya sendiri, dan HAV
   yang berlaku dihitung saat baca.
3. **Run yang sudah selesai tidak boleh berubah.** `scoring_runs.config_snapshot`
   membekukan konfigurasi, bukan atribut kandidat — run yang sudah selesai
   menyimpan HAV yang dipakainya sendiri dan tidak dihitung ulang.
