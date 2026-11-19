# Optimasi Job Family

Panduan menyetel pengelompokan job family: apa yang sebenarnya dilakukan tiap
parameter, ke arah mana ia mendorong hasil, dan apa yang harus diubah untuk
keinginan yang paling sering muncul.

Dokumen ini adalah rujukan di balik panel **Optimasi Job Family** (menu Posisi → Job Family →
tombol Pengaturan Job Family, rute /posisi/job-family/pengaturan), tempat setiap keinginan di bawah sudah menjadi tombolnya sendiri.
Setiap pernyataan di sini sudah dicocokkan dengan kode yang
benar-benar berjalan (`topic-service/app/pipeline.py`), bukan dengan perilaku
umum pustaka BERTopic — beberapa di antaranya berbeda, dan perbedaannya
disebutkan secara eksplisit.

## Cara kerja pengelompokan, dalam empat kalimat

1. Tiap dokumen job profile sudah diubah menjadi deretan angka (**embedding**)
   yang mewakili isinya. Ini dikerjakan di luar pipeline pengelompokan.
2. Deretan angka itu **dimampatkan** (UMAP) agar jabatan yang mirip benar-benar
   berdekatan dan yang berbeda benar-benar berjauhan.
3. Jabatan yang **berkerumun rapat** dijadikan satu job family (HDBSCAN).
   Jabatan yang tidak masuk kerumunan mana pun ditandai sebagai **outlier**.
4. Tiap kerumunan diberi nama otomatis dari kata-kata yang paling khas di
   dalamnya (c-TF-IDF).

> **Pengaturan ini berlaku untuk SELURUH unit bisnis.** Konfigurasi Job Family
> (template, parameter embedding, parameter BERTopic) tunggal dan global —
> Mulia, MSO, dan ERRO memakai baris yang sama. Menyimpan perubahan dari unit
> bisnis mana pun mengubahnya bagi semuanya, jadi koordinasikan sebelum
> menerapkan. Yang mengikuti unit bisnis aktif hanyalah daftar dokumen yang
> ditampilkan di layar.

Dua hal yang paling sering disalahpahami dari alur ini:

- **Mengubah parameter tidak mengubah peta.** Parameter tersimpan sebagai
  pengaturan; peta baru terbentuk hanya setelah **Bangun Ulang Peta** dijalankan.
- **Embedding ulang hampir tidak pernah diperlukan.** Ia hanya perlu bila yang
  berubah adalah *cara dokumen dibaca* (template restrukturisasi atau model
  embedding). Untuk parameter BERTopic mana pun, embedding ulang memakan puluhan
  menit dan tidak mengubah apa pun.

## Bagaimana panel memastikan hasilnya sesuai sasaran

Panel tidak menebak dari peta lama. Setiap tombol sasaran **mengukur**:

1. **Pengaturan yang berlaku diukur lebih dulu**, pada korpus yang ter-embed
   SEKARANG — bukan dibaca dari peta terakhir, yang setelah transformasi ulang
   bisa menggambarkan dokumen yang sudah berubah. topic-service menjalankan kode
   pengelompokan yang sama dengan "Bangun Ulang Peta" (`pipeline.cluster`),
   tanpa menyimpan run, sehingga peta, kalibrasi karier, dan diagnosis tidak
   tersentuh.
2. **Kandidat diukur dengan cara yang sama.** Putaran pertama adalah kandidat
   yang arahnya sudah ditetapkan untuk sasaran itu (tabel di bawah). Bila belum
   ada yang mencapai sasaran, putaran berikutnya melanjutkan dari kandidat yang
   paling mendekati, dan mencoba versi yang lebih lunak dari kandidat yang
   mencapai sasaran tetapi memperburuk ukuran lain. Paling banyak tiga putaran
   dan 16 pengaturan, semuanya di dalam rentang aman tiap parameter.
3. **Hanya kandidat yang terukur mencapai sasaran yang ditawarkan.** Bila tidak
   ada, panel menjawab "Tidak tercapai dalam rentang aman" dan tidak menawarkan
   apa pun untuk diterapkan; semua yang diukur tetap ditampilkan.
4. **Penerapan diperiksa sekali lagi.** Ditolak bila korpus berubah sejak
   diukur, atau parameter yang berlaku disimpan orang lain di antaranya.
5. **Peta yang dibangun dibandingkan dengan pengukurannya.** Pipeline ini
   deterministik (`randomState` tetap, dokumen dimuat berurutan
   `job_profile_id`), jadi pada korpus yang sama peta baru harus sama persis
   dengan yang diukur. Panel menyatakan hasilnya: sama persis, berbeda, atau
   dibangun dari korpus yang sudah berubah.

Ukuran yang dipakai menilai tiap sasaran (tertulis juga pada tombolnya):

| Sasaran | Tercapai bila |
|---|---|
| Kurangi outlier | Persentase outlier turun lebih dari 0,5 poin |
| Nol outlier | Tidak tersisa satu pun outlier |
| Sisakan yang benar-benar asing | Pada ambang yang dibaca dari sebaran korpus ini, tidak ada jabatan yang dekat sebuah rumpun tertinggal di luar, dan tidak ada jabatan yang jauh dipaksa masuk |
| Perbesar cluster / Perkecil cluster | Median anggota per famili naik / turun |
| Lebih banyak famili / Lebih sedikit famili | Jumlah famili bertambah / berkurang |
| Pecah famili raksasa | Porsi famili terbesar turun lebih dari 2 poin |
| Hapus famili kekecilan | Tidak ada famili beranggota kurang dari 3 |
| Ratakan ukuran | Koefisien variasi ukuran famili turun minimal 10% |
| Perbaiki nama & kata kunci | Keanggotaan tidak berubah sama sekali, dan bagian kata kunci yang dipakai bersama antarfamili turun lebih dari 2 poin — sebuah **proksi**, karena "nama yang jelas" tidak dapat diukur langsung |
| Rapikan seadanya | Skor mutu keseluruhan naik minimal 1 poin tanpa satu pun ukuran yang memburuk |

Ukuran lain yang memburuk (outlier, jumlah famili terhadap taksiran sehat,
famili kekecilan, dominasi famili terbesar) dilaporkan terpisah, kecuali ukuran
yang memang digerakkan sasaran itu sendiri — "Lebih banyak famili" tidak
melaporkan bertambahnya famili sebagai kemunduran.

**Batasnya, dinyatakan terus terang.** Panel tidak dapat menjamin setiap
sasaran selalu tercapai: pada sebagian korpus tidak ada pengaturan dalam rentang
aman yang mencapainya, dan pengelompokan tidak bergerak lurus menurut
parameternya. Yang dijamin adalah bahwa yang ditawarkan sudah terbukti mencapai
sasaran pada korpus yang sedang ter-embed, dan bahwa panel mengatakannya bila
tidak ada yang mencapainya. Setelah transformasi ulang, ukur ulang: angka dari
korpus lama tidak berlaku untuk korpus baru.

## Outlier: dua hal berbeda dengan satu nama

Yang dilaporkan sebagai "outlier" sebenarnya campuran dua kelompok yang sangat
berbeda:

- **Jabatan pinggiran.** Isinya jelas mirip sebuah rumpun, tetapi ia gagal masuk
  karena aturan kepadatan — tetangganya kurang rapat, atau kelompoknya kurang
  besar. Ini bukan temuan; ini efek samping aturan.
- **Jabatan yang memang sendirian.** Isinya tidak menyerupai rumpun mana pun.
  **Ini temuan yang berharga** dan tidak boleh disembunyikan.

Selama keduanya dilaporkan sebagai satu angka, pilihan yang tersedia hanya dua
dan keduanya buruk: biarkan semuanya di luar, atau paksa semuanya masuk.

### Ambang kemiripan — cara memisahkan keduanya

Setiap dokumen outlier punya satu angka: **kemiripannya ke job family
terdekat**, 0 sampai 1. Angka inilah yang dipakai parameter
`outlierThreshold`.

| `outlierThreshold` | Yang terjadi |
|---|---|
| `0` | Setiap outlier dipaksa masuk rumpun terdekat, **sejauh apa pun jaraknya**. Outlier menjadi nol — tetapi jabatan yang benar-benar tidak berhubungan ikut terselip ke rumpun yang salah, dan setelah masuk tidak ada lagi tanda bahwa penempatannya meragukan. |
| `0,4 – 0,5` | Jabatan pinggiran masuk; jabatan yang tidak menyerupai apa pun tetap di luar. **Inilah yang dimaksud "hanya job profile yang benar-benar tidak berhubungan yang boleh menjadi outlier".** |
| `0,7` ke atas | Hanya jabatan yang sangat mirip yang dipindahkan; sisanya tetap outlier. Untuk sebagian besar korpus ini terlalu ketat. |

Panel tidak menebak angka ini. Untuk sasaran "Sisakan yang benar-benar asing" ia
membaca kemiripan setiap jabatan yang tidak dapat dikelompokkan HDBSCAN pada
pengukuran pengaturan yang berlaku — yang masih di luar maupun yang sudah
ditempatkan ulang oleh pengaturan itu — mengurutkannya, lalu mencari **celah
terlebar** di antara dua nilai berurutan — tempat data memisahkan dirinya
sendiri. ("Periksa keadaan sekarang" melakukan hal yang sama atas outlier peta
terakhir.) Bila sebarannya rata dan
tidak punya celah yang berarti, panel mengatakan apa adanya alih-alih
mengarang garis di tengah data yang menerus.

### Cara mengukur "terdekat" — `outlierStrategy`

| Nilai | Mengukur apa | Kapan dipakai |
|---|---|---|
| `embeddings` **(bawaan)** | Kemiripan isi dokumen ke pusat tiap rumpun, di ruang yang sama dengan yang membentuk petanya | Hampir selalu. Angkanya sebanding dengan yang ditampilkan popup pemetaan manual. |
| `c-tf-idf` | Tumpang-tindih kata antara dokumen dan rumpun | Bila istilah tiap jabatan sangat khas |
| `distributions` | Memotong dokumen jadi jendela 4 kata lalu mencari rumpun tersering | Paling lambat; menilai potongan, bukan dokumen utuh |
| `probabilities` | Soft-membership HDBSCAN | Hanya bila `calculateProbabilities` aktif |

Bawaan kami `embeddings`, **bukan** `distributions` yang menjadi bawaan pustaka.
Alasannya satu: seluruh peta dibangun dari kemiripan embedding, sehingga outlier
yang dipindahkan atas dasar tumpang-tindih kata dapat mendarat di famili yang
menurut petanya sendiri jauh — dan itu muncul belakangan sebagai anggota famili
yang "kelihatan salah" tanpa jejak sebabnya.

`outlierCascade` mencoba sisa outlier dengan strategi berikutnya. Ia **hanya
melintasi strategi ketika ambangnya 0**, dan itu disengaja: ketiga cara di atas
mengukur pada skala yang berbeda, sehingga angka 0,45 bukan hal yang sama bagi
`embeddings` dan bagi `c-tf-idf`. Ambang di atas 0 dipilih dari sebaran kemiripan
embedding, jadi memakainya ulang pada skala lain akan diam-diam mengubah ketatnya
penyaringan — tepat pada parameter yang seluruh gunanya adalah menyatakan
ketatnya penyaringan. Pada ambang 0 tidak ada yang bisa salah kalibrasi (syaratnya
hanya "ada kemiripan positif"), sehingga cascade berjalan penuh. Bila cascade
diminta tetapi dibatasi, catatan mutu run menyebutkannya.

### Membaca alasan tiap outlier satu per satu

Tekan **"Rincian tiap outlier"** dan panel merinci **tiap** jabatan: famili terdekatnya, angka kemiripannya,
famili kedua terdekat, dan sebabnya ia tetap di luar. Sebabnya dipisah menjadi
dua hal yang sering tertukar:

**Apa yang menahannya** — soal pengaturan, hampir selalu dapat diubah:

| Kode | Artinya |
|---|---|
| `rehoming_off` | Penempatan ulang outlier tidak dinyalakan pada run itu. Ia gagal masuk karena aturan kepadatan, bukan karena isinya asing. |
| `below_threshold` | Dinyalakan, tetapi kemiripannya di bawah ambang yang Anda tetapkan. Ini **bekerja sebagaimana dimaksud**. |
| `rehoming_failed` | Dinyalakan dan kemiripannya cukup, tetapi tetap tidak tertempatkan. Biasanya karena strateginya mengukur kecocokan kata sementara angka kemiripan di atas mengukur kedekatan makna — atau dokumennya nyaris tanpa kata yang dikenali kosakata. |

**Seberapa asing isinya** — soal dokumennya, tidak berubah oleh pengaturan:

| Kode | Kemiripan ke famili terdekat | Artinya |
|---|---|---|
| `fringe` | ≥ 0,55 | Jelas menempel pada sebuah famili. Ambang yang tepat akan memasukkannya. |
| `between` | selisih ke famili kedua < 0,03 | Terjepit di antara dua famili; tidak ada yang cukup menariknya. |
| `distant` | 0,35–0,55 | Menyerupai sesuatu, tetapi jauh dari semuanya. |
| `isolated` | < 0,35 | Tidak menyerupai famili mana pun. **Ini temuan, bukan cacat.** |

Kombinasi yang paling sering muncul dan paling sering disalahpahami adalah
`rehoming_off` + `fringe`: jabatan itu bukan jabatan aneh, ia hanya belum
dipersilakan masuk. Yang benar-benar layak tetap di luar adalah `isolated`.

Panel juga menyertakan tabel "kalau ambangnya 0,3 / 0,4 / 0,5 / 0,6, berapa
yang masuk dan berapa yang tetap di luar" — supaya pilihan ambang dibaca sebagai
akibat, bukan sebagai angka yang harus dipercaya.

## Keinginan yang sering muncul, dan apa yang diubah

### "Kurangi outlier"

Turunkan `minSamples` ke 1 (paling longgar menerima dokumen ke rumpun), lalu
nyalakan `reduceOutliers`. Bila masih banyak, turunkan `minClusterSize`.

> **Arah yang sering dibalik:** menaikkan `minClusterSize` **menambah** outlier,
> tidak menguranginya — kelompok yang lebih kecil dari batas itu langsung dibuang.

### "Jangan ada outlier sama sekali"

`reduceOutliers` aktif, `outlierThreshold` = 0, `outlierCascade` aktif. Ini
satu-satunya pengaturan yang benar-benar menihilkan outlier. Konsekuensinya
disebut di tabel ambang di atas, dan sebaiknya disampaikan sebelum diterapkan.

### "Hanya jabatan yang benar-benar tidak nyambung yang boleh jadi outlier"

`reduceOutliers` aktif, `outlierStrategy` = `embeddings`, `outlierThreshold`
diisi dari sebaran nyata (biasanya 0,4–0,5). Cascade tidak dipakai di sini —
ambangnya dikalibrasi untuk skala embedding, dan strategi lain memakai skala
yang berbeda. Hasilnya bukan nol outlier, dan memang tidak seharusnya nol.

### "Perbesar cluster" / "anggotanya terlalu sedikit"

Naikkan `minClusterSize` (+3), **dan** nyalakan `reduceOutliers` — karena
menaikkannya selalu menambah outlier. Alternatif yang tidak membuang siapa pun:
naikkan `clusterSelectionEpsilon` (+0,2) agar rumpun berdekatan digabung.

### "Perkecil cluster" / "terlalu campur aduk"

Turunkan `minClusterSize` (−2) dan `minSamples` ke 1, atau ganti
`clusterSelectionMethod` ke `leaf`.

### "Job family-nya terlalu banyak"

Naikkan `clusterSelectionEpsilon`, atau isi `nrTopics` dengan jumlah yang
diinginkan, atau pakai `eom`.

> **Selisih satu yang membingungkan:** bila masih ada outlier, `nrTopics` = 10
> menghasilkan **9** job family. Keranjang outlier ikut dihitung pustaka.

### "Job family-nya terlalu sedikit"

Turunkan `minClusterSize`, ganti ke `leaf`, atau turunkan `nNeighbors` (−5) agar
struktur lokal lebih menonjol.

### "Ada satu family yang isinya hampir semua jabatan"

Ganti ke `leaf`, dan **turunkan** `clusterSelectionEpsilon` ke 0 — penggabungan
rumpun berdekatan itulah yang biasanya membentuk famili raksasa. Bila masih,
naikkan `nComponents` (+3) agar jabatan punya lebih banyak ruang untuk terpisah.

### "Banyak family yang isinya cuma 1–2 jabatan"

Naikkan `minClusterSize` (+2) dan nyalakan `reduceOutliers` (ambang 0, cascade
aktif) — supaya anggotanya ditempatkan ulang, bukan dibuang menjadi outlier.

### "Ukuran family-nya timpang"

`leaf` memberi ukuran jauh lebih seragam daripada `eom`, yang cenderung
menghasilkan satu rumpun besar dan banyak rumpun kecil.

### "Nama/kata kunci family-nya tidak jelas"

Ini **tidak** mengubah keanggotaan sama sekali — semuanya bekerja setelah rumpun
terbentuk. Nyalakan `reduceFrequentWords` dan `bm25Weighting`, turunkan `maxDf`
ke ~0,85, naikkan `minDf` sedikit, dan naikkan `nGramMax` agar frasa dua–tiga
kata boleh menjadi nama.

## Daftar parameter

### UMAP — memampatkan sebelum dikelompokkan

| Parameter | Naik | Turun |
|---|---|---|
| `nNeighbors` | Rumpun lebih luas & sedikit, outlier berkurang | Rumpun lebih halus & banyak, outlier bertambah |
| `nComponents` | Lebih banyak ruang memisahkan; di atas ~10 justru menambah outlier | Rumpun bertabrakan, jumlahnya berkurang |
| `minDist` | Titik menyebar rata, kontras kepadatan hilang → outlier bertambah | 0 adalah yang terbaik untuk pengelompokan |
| `metric` | `cosine` yang benar untuk teks | — |

> `metric` **hanya** berlaku untuk UMAP. Pengelompokannya sendiri (HDBSCAN)
> selalu memakai jarak euclidean dan tidak dapat diubah dari halaman ini.

### HDBSCAN — membentuk rumpun

| Parameter | Naik | Turun |
|---|---|---|
| `minClusterSize` | Famili lebih sedikit & besar, **outlier bertambah** | Famili lebih banyak & kecil, outlier berkurang (minimum 2) |
| `minSamples` | **Outlier bertambah**, rumpun mengerut ke intinya | Outlier berkurang, batas rumpun melebar (minimum 1) |
| `clusterSelectionEpsilon` | Rumpun berdekatan digabung → famili berkurang | 0 = nonaktif |
| `clusterSelectionMethod` | `eom` = luas & sedikit · `leaf` = halus & banyak, biasanya outlier lebih sedikit | — |

> **`minSamples` kosong bukan berarti nonaktif** — nilainya mengikuti
> `minClusterSize`. Karena itu menurunkan `minClusterSize` melonggarkan **dua**
> hal sekaligus.

### Kata kunci — tidak memengaruhi keanggotaan

`nGramMin`, `nGramMax`, `minDf`, `maxDf`, `stopwords`, `topNWords`,
`reduceFrequentWords`, `bm25Weighting` semuanya bekerja **setelah** rumpun
terbentuk. Tidak satu pun mengubah jabatan mana masuk famili mana.

Satu pengecualian: keduanya ikut menentukan kosakata, sehingga berpengaruh pada
penempatan ulang outlier bila strateginya `c-tf-idf` atau `distributions`.

`stopwords` untuk korpus ini harus `indonesian`. Dengan `none`, kata kunci tiap
famili menjadi "dan / yang / untuk".

### Model topik

| Parameter | Keterangan |
|---|---|
| `nrTopics` | Memangkas jumlah topik **setelah** pengelompokan. Tidak pernah mengurangi outlier. Kosong = tanpa pemangkasan. |
| `reduceOutliers` | Menempatkan ulang dokumen outlier — lihat bagian ambang di atas |
| `calculateProbabilities` | Mengubah **arti** kolom kekuatan keanggotaan, bukan sekadar biayanya. Tidak memengaruhi keanggotaan, dan **tidak** diperlukan oleh `reduceOutliers`. |
| `randomState` | Seed tetap → hasil yang sama persis untuk korpus, parameter, dan versi pustaka yang sama. **Dapat diulang tidak sama dengan kokoh**: seed lain bisa memberi pembagian lain — lihat "Ketergantungan pada seed" di bawah. Mengganti seed sendiri adalah perubahan peta, bukan perbaikan mutu. |
| `diversity` | **Tidak berpengaruh pada pipeline ini.** Penyusunan ulang kata kunci (MMR) membutuhkan model embedding kata di dalam topic-service, sedangkan vektor di sini datang sudah jadi dari web app. Run yang menyetelnya mencatat pengabaian ini pada catatan mutunya. |

## Ketergantungan pada seed

UMAP stokastik. Dengan `randomState` tetap, pipeline ini terbukti deterministik:
membangun ulang atas korpus yang sama (baris yang sama, urutan `job_profile_id`
yang sama), parameter yang sama, dan **versi pustaka yang sama** menghasilkan
keanggotaan, koordinat 2-D, kata kunci, dan Family Tree yang identik bit demi
bit — diuji lintas proses, jumlah thread, dan `PYTHONHASHSEED`
(`topic-service/scripts/verify_reproducibility.py`). Judul famili dari Gemini
tidak termasuk: itu label, bukan keanggotaan, dan model bahasa tidak dijamin
mengulang dirinya.

Yang **tidak** dijamin seed tetap adalah bahwa peta itu satu-satunya jawaban
yang masuk akal. Karena itu setiap build mencatat dua hal pada catatan mutunya:

- `reproducibility` — seed, aturan urutan dokumen, dan versi persis umap-learn,
  pynndescent, numba, hdbscan, bertopic, scikit-learn, numpy, scipy.
  `requirements.txt` memuat RENTANG versi, jadi image yang dibangun ulang bisa
  menggeser peta dengan seed yang sama; tanpa catatan ini perbedaan itu tidak
  dapat dibedakan dari perubahan korpus.
- `seedStability` — `cluster()` diulang dengan seed `randomState+1 …
  randomState+k` (`TOPIC_SEED_STABILITY_SEEDS`, bawaan 3, 0 = mati) dan
  dibandingkan dengan peta yang diterbitkan memakai ARI, ditambah daftar
  `job_profile_id` yang di sebagian besar seed lain kehilangan lebih dari
  separuh rekan familinya. Hanya diukur; peta yang diterbitkan tetap milik seed
  yang dikonfigurasi.

"Periksa keadaan sekarang" menyampaikannya: ARI terendah ≥ 0,90 → peta bertahan;
0,75–0,90 → batas famili di perbatasan bergeser; < 0,75 → peringatan bahwa peta
banyak ditentukan seed. Pakar yang menilai peta sebaiknya menelaah dokumen
tidak stabil itu secara manual, bukan menerima batas familinya begitu saja.

Mereproduksi run tertentu: pasang versi pustaka dari `reproducibility.versions`
run itu, lalu `python scripts/verify_reproducibility.py --db --config
'<job_family_topic_runs.config>' --seed <randomState>` dari `topic-service/`.

## Membaca catatan mutu sebuah run

Sebuah run berstatus **selesai** tidak berarti setiap permintaan terpenuhi. Tiga
langkah boleh gagal tanpa menggagalkan run: penempatan ulang outlier, pemangkasan
jumlah topik, dan penyusunan Family Tree. Ketiganya kini direkam pada catatan
mutu run, termasuk yang dilewati beserta alasannya — sehingga "sudah dinyalakan
tetapi outliernya utuh" punya jawaban, bukan hanya gejala.

## Peta sebar bukan ruang tempat rumpun dibentuk

Titik-titik pada peta digambar oleh pemampatan **kedua** yang berdiri sendiri
(2 dimensi, pengaturan tetap). Dua titik yang terlihat bertumpuk di layar belum
tentu berdekatan di ruang tempat pengelompokan sesungguhnya terjadi. Kemiripan
yang tampak pada peta bukan bukti bahwa pengelompokannya keliru.
