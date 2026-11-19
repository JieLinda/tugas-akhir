# Panduan Fitur per Halaman — Aplikasi Pulse

Dokumen ini menjelaskan **isi tiap halaman**: panel apa saja yang ada, angka apa yang ditampilkan dan artinya, serta apa yang harus dilakukan ketika sebuah angka kosong, nol, atau bertuliskan "tanpa".

Untuk penjelasan rumus dan algoritma penilaian, lihat dokumen Metodologi Laporan Hasil Scoring. Untuk fungsi tiap tombol beserta dampaknya, lihat Katalog Tombol.

---

## Pengaturan Job Family (sidebar: Posisi → seksi Job Family → tombol "Pengaturan Job Family") — rute /posisi/job-family/pengaturan; petanya sendiri di /posisi/job-family (URL lama /family-configuration dan /job-profiles/job-family dialihkan)

Halaman ini adalah "Langkah 1 dari 3" pembuatan peta Job Family. Di sini diatur bagaimana dokumen job profile diubah menjadi angka (embedding) dan bagaimana angka itu nanti dikelompokkan menjadi rumpun jabatan. Isinya tiga bagian: (1) mesin penerjemah dokumen menjadi angka beserta status gudang penyimpanannya, (2) template restrukturisasi — bagian dokumen mana saja yang dibaca mesin, termasuk template khusus untuk satu job profile tertentu, dan (3) parameter pengelompokan (BERTopic). Halaman ini TIDAK membuat petanya; setelah embedding selesai, peta dibangun di halaman Peta Job Family (Pemetaan). Catatan penting: seluruh isi halaman ini bersifat GLOBAL — konfigurasi yang disimpan dan embedding yang dibangun berlaku untuk semua business unit (Mulia/MSO/ERRO), bukan hanya BU yang sedang aktif. Yang mengikuti BU aktif hanyalah daftar job profile yang ditampilkan/dipilih di layar.

### Bar aksi atas (Langkah 1 dari 3)

Lencana urutan langkah, pengingat alur kerja ("Embed job profile dulu, lalu bangun petanya di JOB FAMILY - Pemetaan"), serta dua tombol global: Embedding Ulang Job Profile dan Simpan Semua.

Angka & status pada panel ini:

- "Langkah 1 dari 3" — hanya penanda alur, bukan angka data. Langkah berikutnya ada di halaman Peta Job Family.
- Tulisan tombol berubah menjadi "Batch 3/12…" saat embedding berjalan: angka pertama = batch yang sudah selesai, angka kedua = total batch. Satu batch berisi sejumlah dokumen sesuai isian Batch Size.
- Saat batch belum terhitung, tombol hanya bertuliskan "Membangun...".

### Peringatan pgvector belum aktif (kuning, muncul kondisional)

Muncul bila gudang penyimpanan embedding (pgvector) tidak dapat dipakai — entah ekstensinya/tabelnya belum ada, atau database vector tidak dapat dihubungi sama sekali. Statusnya dihitung saat halaman dimuat.

Angka & status pada panel ini:

- Tidak memuat angka. Selama peringatan ini tampil: konfigurasi tetap bisa disimpan, tetapi seluruh proses embedding (tombol Embedding Ulang, Sync, dan Embed satu profil) akan gagal atau dinonaktifkan.

### Panel progres embedding (biru, muncul saat proses berjalan)

Kemajuan proses embedding: fase (menyiapkan dokumen / meng-embed), bilah progres, dan empat penghitung. Angka datang langsung dari proses yang sedang berjalan, bukan dari database.

Angka & status pada panel ini:

- Batch x/y — batch keberapa yang sudah selesai dari total batch.
- Total — jumlah seluruh job profile berstatus selesai & sudah terekstrak di SELURUH business unit (bukan hanya BU aktif), karena korpus embedding memang dipakai bersama.
- Di-embed — jumlah dokumen yang benar-benar dihitung ulang vektornya pada proses ini.
- Dilewati — dokumen yang isinya tidak berubah sejak embedding terakhir (sidik jari isi + nama model sama), JADI TIDAK PERLU dihitung ulang. Dokumen yang hasil restrukturisasinya kosong juga masuk hitungan ini.
- Gagal — jumlah dokumen di dalam batch yang gagal (mis. layanan embedding mati). Angka 0 berarti tidak ada kegagalan.
- Pesan merah bermonospace di bawah penghitung = pesan galat asli dari layanan embedding; ini yang perlu disalin saat melapor ke IT.

### Ringkasan hasil (hijau/merah, muncul setelah proses selesai)

Kesimpulan proses terakhir: "Berhasil: N di-embed, M dilewati (tidak berubah)." atau "Selesai dengan K gagal…", plus rekap Total/Di-embed/Dilewati/Gagal.

Angka & status pada panel ini:

- Hijau = tidak ada kegagalan; merah = ada kegagalan atau proses berhenti karena galat.
- "Di-embed: 0, Dilewati: semua" adalah hasil NORMAL bila tidak ada perubahan template, model, maupun isi dokumen sejak terakhir kali.
- Ringkasan ini hanya tersimpan di layar; berpindah halaman menghilangkannya.

### Tab 1 — Kartu "Parameter Embedding"

Empat pengaturan mesin penerjemah dokumen menjadi angka: Sumber Model, Nama Model, Dimensi Vektor, dan Batch Size. Nilainya berasal dari konfigurasi aktif yang tersimpan (versi aktif di database; bila tabelnya belum ada, dari berkas konfigurasi).

Angka & status pada panel ini:

- Sumber Model — tiga pilihan tetap: Multilingual E5 (lewat scoring-service), Nomic — Ollama lokal, Nomic — API server (eksternal).
- Keterangan "· tidak terjangkau saat ini" pada sebuah pilihan berarti sumber itu tidak dilaporkan oleh pemeriksaan ketersediaan. Pilihan "Nomic — Ollama lokal" SELALU bertanda ini karena daftar ketersediaan memang tidak pernah melaporkannya — bukan berarti layanannya mati, dan sumber ini tetap bisa dipilih serta dipakai.
- Keterangan "· belum dikonfigurasi" berarti variabel lingkungan nama model untuk sumber itu belum diisi di server.
- Nama Model — akan terisi otomatis mengikuti default sumber saat Sumber Model diganti, tetapi tetap bisa diketik manual. Nama model ikut menjadi bagian sidik jari isi dokumen: mengubahnya membuat SEMUA dokumen dianggap berubah dan wajib di-embed ulang.
- Dimensi Vektor — angka bebas (default 768), wajib sama dengan keluaran model embedding. Jika berbeda dari dimensi kolom yang tersimpan, menekan "Embedding Ulang Job Profile" membuat ulang koleksi vektor (tabel di-drop & dibuat lagi) pada dimensi baru sebelum meng-embed ulang — jadi mengubah dimensi TIDAK perlu migrasi database, tetapi mengosongkan koleksi lalu mengisinya ulang dari nol.
- Batch Size — jumlah dokumen per satu panggilan ke layanan embedding (isian 1–256). Nilai kosong/0 diperlakukan sebagai 32 oleh server; nilai di luar 1–256 dipangkas ke rentang itu. Batch besar = lebih cepat tapi lebih berisiko timeout.

### Tab 1 — Panel "Vector Store (Penyimpanan Embedding)"

Kesehatan gudang embedding dan jumlah isinya, dibaca ulang setiap panel dimuat atau tombol muat-ulang ditekan. Berisi dua baris status kesehatan dan dua kartu koleksi (Job Profiles, Kamus Kompetensi) yang masing-masing punya tombol Sync.

Angka & status pada panel ini:

- Database pgvector — titik hijau = tabel penyimpanan embedding tersedia; titik merah = belum tersedia atau database vector tidak terhubung.
- Layanan Embedding API — titik hijau = sumber model yang sedang dipilih punya konfigurasi server eksplisit; MERAH DI SINI BERSIFAT INFORMATIF SAJA, proses embedding masih bisa berjalan karena setiap sumber punya alamat default.
- Angka pada kartu Job Profiles = jumlah dokumen job profile yang vektornya sudah tersimpan, DIHITUNG LINTAS SEMUA BUSINESS UNIT. Jadi wajar bila lebih besar dari jumlah dokumen milik BU Anda.
- Angka pada kartu Kamus Kompetensi = jumlah kompetensi kamus yang sudah punya vektor (dipakai penilaian aspek teknis AHP+TOPSIS).
- Tanda "—" pada kedua angka = status belum selesai dimuat ATAU gudang embedding belum siap (angka tidak bisa dihitung). Bukan berarti isinya nol.
- Kotak kuning berisi pesan galat muncul bila gudang belum siap; dua kemungkinan pesannya membedakan "ekstensi/tabel belum ada" dari "database vector tidak dapat dihubungi".

### Bagian "Restrukturisasi Dokumen" — "Template Restrukturisasi Dokumen", mode "Seluruh struktur dokumen" (template global)

Editor teks template global di kiri dan PRATINJAU hasilnya di kanan. Pratinjau selalu memakai job profile PERTAMA milik BU aktif (diambil saat halaman dimuat) dan dihitung langsung di browser, jadi berubah seketika saat template diketik — tanpa menyimpan apa pun.

Angka & status pada panel ini:

- Judul pratinjau selalu "Pratinjau (job profile pertama)" — ini contoh, bukan dokumen yang sedang Anda pilih.
- "Tidak ada job profile terekstrak untuk pratinjau" = BU aktif tidak punya satu pun job profile berstatus selesai dengan hasil ekstraksi.
- Template bawaan berisi 14 baris berlabel: Jabatan, Divisi/Departemen, Atasan Langsung, Bawahan Langsung, Tujuan Jabatan, Kualifikasi Pendidikan, Pengalaman, Keahlian, Kompetensi Teknis, Kompetensi Perilaku, Wewenang, Tanggung Jawab dan Indikator Keberhasilan, Hubungan Kerja Internal, Hubungan Kerja Eksternal.
- Aturan penulisan: token ditulis {{namaToken}}. Token yang tidak dikenal menjadi kosong. Baris berlabel yang nilainya kosong (baris berakhir tanda titik dua) OTOMATIS DIHAPUS, sehingga data yang tidak ada tidak meninggalkan label menggantung. Baris kosong beruntun dirapatkan.
- 15 token yang tersedia (ditampilkan sebagai lencana): positionName = nama jabatan; divisionDepartment = divisi/departemen; directSupervisor = atasan langsung; subordinates = daftar bawahan langsung (dipisah koma); jobPurpose = tujuan jabatan; education = kualifikasi pendidikan; experience = pengalaman yang disyaratkan; skills = daftar keahlian (koma); technicalCompetencies = kompetensi teknis, otomatis ditambah "(level N)" bila levelnya ada; behavioralCompetencies = kompetensi perilaku (koma); authorities = wewenang (koma); responsibilities = daftar tanggung jawab, satu baris per butir diawali tanda "-", ditambah "(Indikator: …)" bila indikator keberhasilannya ada; internalRelationships = hubungan kerja internal (koma); externalRelationships = hubungan kerja eksternal (koma); organizationChart = ringkasan struktur organisasi (TIDAK dipakai di template bawaan, harus ditambahkan sendiri bila diinginkan).
- Isi template menentukan ATAS DASAR APA jabatan dikelompokkan: menonjolkan tanggung jawab & kompetensi membentuk rumpun menurut kemiripan pekerjaan; memasukkan nama divisi/departemen cenderung membentuk rumpun mengikuti struktur organisasi.

### Bagian "Restrukturisasi Dokumen" — mode "Job profile spesifik" (OVERRIDE PER-DOKUMEN)

Pemilih job profile (dapat dicari berdasarkan nama jabatan/divisi, hanya berisi dokumen milik BU aktif yang sudah selesai & terekstrak), lencana status template, editor template khusus untuk dokumen itu, dan pratinjau khusus dokumen itu. Data mentah dokumen diambil dari server saat sebuah profil dipilih.

Angka & status pada panel ini:

- Lencana "Template khusus aktif" (berwarna) = dokumen ini memakai template sendiri, mengabaikan template global.
- Lencana "Mengikuti template global" = kotak template khusus kosong, sehingga dokumen ini memakai template global.
- Kotak template khusus KOSONG bukan kesalahan — itu keadaan normal dan berarti "pakai template global".
- Pratinjau di mode ini memakai template khusus bila terisi, dan template global bila kosong — jadi dapat dipakai untuk membandingkan sebelum menyimpan.
- "Data profil tidak tersedia untuk pratinjau" = dokumen terpilih tidak punya hasil ekstraksi yang bisa dirapikan.
- Pemilih bertuliskan "Tidak ada job profile terekstrak" dan nonaktif bila BU aktif belum punya dokumen job profile yang selesai diekstrak.
- Cara kerja override terhadap embedding & clustering: template khusus dipakai DI SEMUA tempat dokumen itu dibentuk — pratinjau, embed satu profil, DAN embedding ulang global. Karena itu embedding ulang global TIDAK PERNAH menimpa template khusus; ia justru ikut memakainya. Akibatnya, vektor dokumen itu dibentuk dari isi yang Anda pilih sendiri, sehingga posisinya pada peta job family bisa bergeser ke rumpun lain.
- Override disimpan per NOMOR DOKUMEN job profile. Bila dokumen disinkron ulang dan mendapat nomor baru, template khususnya tidak lagi menempel pada dokumen tersebut.
- Override bersifat global seperti konfigurasi lain: template khusus yang dibuat satu BU juga dipakai saat BU lain menjalankan embedding ulang.

### Bagian "Parameter Pipeline" — Kartu "Parameter Pipeline BERTopic"

Seluruh parameter mesin pengelompokan, dikelompokkan menjadi 5 tahap: 1 UMAP (reduksi dimensi), 2 HDBSCAN (clustering), 3 Tokenisasi, 4 c-TF-IDF (kata kunci topik), 5 Model topik & representasi. Semua parameter benar-benar dipakai saat pembangunan peta berikutnya — tidak ada isian hiasan.

Angka & status pada panel ini:

- n_neighbors — naik = rumpun lebih global/besar; turun = lebih lokal/detail.
- n_components — dimensi tempat pengelompokan bekerja, umum 5–10.
- min_dist — 0 = titik paling rapat (paling baik untuk clustering).
- metric — ukuran jarak (cosine/euclidean/manhattan), dipakai juga untuk tampilan peta 2 dimensi.
- min_cluster_size — ukuran job family terkecil. Naik = family lebih sedikit & besar, outlier bertambah.
- min_samples — KOSONG berarti otomatis (mengikuti min_cluster_size), bukan berarti nol atau rusak.
- cluster_selection_method — eom = rumpun luas & sedikit; leaf = rumpun halus & banyak.
- cluster_selection_epsilon — 0 = nonaktif; naik = rumpun digabung sehingga family lebih sedikit.
- n-gram min/max — 1 = kata tunggal, 2 = termasuk frasa dua kata.
- min_df — abaikan kata yang muncul di kurang dari sekian dokumen; max_df — abaikan kata yang muncul di lebih dari proporsi dokumen (0–1).
- stopwords — Indonesia (Sastrawi) / English / Tanpa stopword; job profile berbahasa Indonesia.
- top_n_words — jumlah kata kunci per rumpun.
- reduce_frequent_words & bm25_weighting — saklar untuk merapikan kata kunci (BM25 lebih tahan pada korpus kecil/timpang).
- nr_topics — KOSONG = tanpa pembatasan jumlah topik; diisi = topik dikurangi sampai maksimal sekian.
- diversity (MMR) — TIDAK BERPENGARUH pada pipeline ini. Penyusunan ulang kata kunci membutuhkan model embedding kata di dalam topic-service, sedangkan vektor di sini datang sudah jadi dari web app. Nilai apa pun yang diisi akan dicatat sebagai diabaikan pada catatan mutu run.
- random_state — benih tetap agar hasil dapat diulang pada data yang sama (bawaan 42).
- reduce_outliers — bila aktif, jabatan yang tidak masuk rumpun mana pun ditempatkan ke rumpun terdekat.
- outlier_strategy — cara mengukur "terdekat". embeddings (bawaan) = kemiripan isi dokumen, satu-satunya yang sejalan dengan cara peta dibentuk; c-tf-idf = tumpang-tindih kata; distributions = per potongan 4 kata (paling lambat); probabilities = butuh calculate_probabilities aktif.
- outlier_threshold — kemiripan minimum (0–1) agar sebuah outlier boleh dipindahkan; di bawahnya ia tetap outlier. INI parameter yang memisahkan "tidak ada outlier" dari "outlier hanya untuk jabatan yang benar-benar tidak berhubungan". Nilai 0 memaksa setiap jabatan masuk rumpun terdekat sejauh apa pun jaraknya — angka outlier memang jadi nol, tetapi jabatan yang tidak berhubungan ikut terselip ke rumpun yang salah tanpa meninggalkan tanda. Nilai 0,4–0,5 memasukkan jabatan pinggiran dan menyisakan yang memang asing. Jangan menebak angkanya: pakai tombol "Sisakan yang benar-benar asing" pada panel Optimasi — ambangnya dipilih dari sebaran korpus sekarang dan hasilnya diukur sebelum ditawarkan.
- outlier_cascade — bila aktif, sisa outlier dicoba lagi dengan cara ukur berikutnya PADA AMBANG YANG SAMA. Yang bertambah adalah sudut pandang yang dicoba, bukan kelonggarannya.
- calculate_probabilities — bila aktif, dihitung persentase keanggotaan tiap jabatan pada rumpunnya (lebih lambat). Bila nonaktif, persentase keanggotaan di halaman peta akan kosong. Parameter ini TIDAK diperlukan oleh reduce_outliers.
- Perubahan di tab ini TIDAK memerlukan embedding ulang — cukup bangun ulang peta di halaman Peta Job Family.
- Run berstatus "selesai" tidak berarti setiap permintaan terpenuhi. Penempatan ulang outlier, pemangkasan jumlah topik, dan penyusunan Family Tree boleh gagal tanpa menggagalkan run; ketiganya kini direkam pada catatan mutu run beserta alasannya.

### Bagian "Parameter Pipeline" — Panel "Optimasi Job Family"

Panel tombol di bagian atas tab Pengaturan, menggantikan kotak penjelasan statis yang dulu berdiri di sana. Gunanya satu: menerjemahkan keinginan yang dinyatakan sebagai HASIL ("outlier-nya kebanyakan", "cluster-nya kekecilan", "ada satu family yang isinya hampir semua jabatan") menjadi parameter mana yang digeser — dan MEMBUKTIKAN pada korpus sekarang bahwa geseran itu memang menghasilkannya, sebelum ditawarkan.

Tidak ada kotak teks dan tidak ada AI di panel ini. Setiap kemungkinan keinginan sudah menjadi tombolnya sendiri, dan perhitungannya seluruhnya deterministik: korpus dan pengaturan yang sama selalu menghasilkan jawaban yang sama.

**Kartu kesegaran peta** di puncak panel menyatakan apakah peta terakhir masih menggambarkan korpus yang ter-embed sekarang. Setiap run mencatat sidik korpus yang dikelompokkannya, sehingga sesudah transformasi ulang panel tahu persis bahwa petanya basi, dan alasannya (jumlah dokumen berubah, atau isi/vektornya berubah). Kartu yang sama menyebutkan bila parameter yang berlaku sudah berbeda dari parameter peta itu. Peta yang dibangun sebelum sidik ini dicatat dinilai dari jumlah dokumen dan waktu transformasi terakhir, dan kartunya mengatakan demikian.

**Tombol pemeriksaan** (boleh dipakai siapa pun yang bisa melihat halaman ini) membaca PETA terakhir:

- "Periksa keadaan sekarang" — jumlah famili, persen outlier, famili terbesar, famili beranggota kurang dari 3, beserta temuan mutu, penjelasan mengapa tiap temuan itu penting, dan sasaran yang paling sesuai dengan tombol "Ukur sasaran ini". Bila peta itu basi, kartunya mengingatkan bahwa angkanya dari korpus lama.
- "Rincian tiap outlier" — menyebut tiap jabatan yang di luar semua famili: famili terdekatnya, angka kemiripannya, famili kedua terdekat, apa yang menahannya, dan seberapa asing isinya. Yang tertahan pengaturan dipisahkan dari yang memang tidak menyerupai apa pun.

**Tombol sasaran**, dikelompokkan menurut yang ingin diubah. Menekannya TIDAK mengubah apa pun; ia MENGUKUR. Pengaturan yang berlaku dan beberapa kandidatnya dijalankan pada korpus yang ter-embed sekarang dengan kode pengelompokan yang sama dengan pembangunan peta, tanpa menyimpan run (paling banyak tiga putaran dan 16 pengaturan; progresnya tampil di panel dan dapat dihentikan):

- Outlier: "Kurangi outlier", "Nol outlier", "Sisakan yang benar-benar asing".
- Ukuran & jumlah famili: "Perbesar cluster", "Perkecil cluster", "Lebih sedikit famili", "Lebih banyak famili", "Pecah famili raksasa", "Hapus famili kekecilan", "Ratakan ukuran".
- Penamaan: "Perbaiki nama & kata kunci" — tidak boleh mengubah keanggotaan sama sekali.
- Umum: "Rapikan seadanya" — skor mutu keseluruhan naik tanpa satu pun ukuran yang memburuk.

Setiap tombol punya keterangan yang muncul saat kursor diarahkan, dan keterangan itu menyebut UKURAN yang dipakai menilai tercapai-tidaknya, misalnya "Kurangi outlier" tercapai bila persentase outlier turun lebih dari 0,5 poin. Daftar lengkapnya ada di docs/optimasi-job-family.md.

**Kartu hasil** menyatakan satu dari empat jawaban — "Sasaran tercapai — terukur", "Sasaran tercapai, tetapi ada ukuran lain yang memburuk", "Sudah tercapai dengan pengaturan sekarang", atau "Tidak tercapai dalam rentang aman" — lalu memuat ukuran sasaran sebelum → sesudah, keempat ukuran mutu lain, parameter yang berubah dalam bentuk `nilai lama → nilai baru` beserta alasannya, dan seluruh pengaturan yang diukur. Hanya bila sasaran tercapai ada dua tombol:

- "Terapkan & bangun ulang peta" — menyimpan lalu langsung menjalankan clustering, dengan progresnya tampil di dalam panel.
- "Simpan saja, bangun nanti" — menyimpan parameter saja. Peta belum berubah.

Bila tidak ada yang tercapai, tidak ada yang ditawarkan untuk diterapkan; kandidat yang paling mendekati ditampilkan sebagai keterangan saja.

**Kartu "Peta terakhir dibanding pengukuran"** muncul ketika peta dibangun dengan pengaturan yang diterapkan dari panel ini — langsung, atau belakangan dari halaman Peta. Pada korpus yang sama peta harus sama persis dengan pengukurannya, dan kartu menyatakan apakah memang demikian, apakah sasarannya tercapai, atau bahwa korpusnya sudah berubah sehingga sasaran perlu diukur ulang.

Angka & status pada panel ini:

- CAKUPAN GLOBAL: menerapkan parameter mengubahnya untuk SEMUA unit bisnis (Mulia/MSO/ERRO), dan kalimat itu tercetak tepat di samping tombolnya. Koordinasikan sebelum menekan.
- Penerapan DITOLAK bila korpus berubah sesudah diukur ("Korpus berubah sejak diukur") atau parameter disimpan orang lain di antaranya ("Parameter BERTopic sudah diubah sejak pengukuran dimulai"). Ukur ulang lalu terapkan.
- Bila kartu parameter di bawah memuat perubahan yang belum disimpan, panel menyebutkan bahwa yang diukur adalah pengaturan yang TERSIMPAN.
- Tombol chevron di pojok kanan mengecilkan panel, dan pilihan itu diingat untuk kunjungan berikutnya. Mengecilkan panel TIDAK menghentikan pengukuran maupun pembangunan peta yang sedang berjalan.
- Untuk "Sisakan yang benar-benar asing", panel menampilkan ambang yang dipilih dari sebaran nyata korpus sekarang beserta alasannya; bila sebarannya rata dan tidak punya batas alami, ia mengatakan apa adanya dan memakai ambang cadangan.
- Bila ada run lebih baru yang GAGAL, kartu pemeriksaan menyebutkannya — angka yang Anda lihat berarti bukan dari percobaan terakhir Anda.
- Pemegang izin job_profiles.view tanpa .manage dapat memeriksa dan mengukur, tetapi tombol penerapan nonaktif.
- "Run terakhir berstatus failed" tidak menghentikan panel: pemeriksaan memakai run terakhir yang SELESAI, dan pengukuran tidak memerlukan peta sama sekali.
- Bila sebuah run tertandai gagal dengan pesan tentang kolom `diagnostics`, penyebabnya adalah migrasi 0062 yang belum dijalankan. Topiknya sudah tersimpan; yang gagal hanya penulisan baris statusnya. Jalankan migrasinya, lalu bangun ulang peta sekali agar baris runnya utuh.

### Kotak penjelasan di bagian Restrukturisasi (biru muda)

Penjelasan bahasa awam yang tampil di bagian Restrukturisasi Dokumen, berisi tiga baris: Isi halaman ini, Yang dikerjakan, dan Pengaruh ke Job Family. Pada bagian Parameter Pipeline kotak ini digantikan panel Optimasi Job Family; isinya pindah ke docs/optimasi-job-family.md.

Angka & status pada panel ini:

- Tidak memuat angka. Berisi peringatan penting: mengganti sumber/nama model sama dengan mengganti alat ukur, sehingga wajib menjalankan Embedding Ulang Job Profile agar semua dokumen diukur dengan alat yang sama; mencampur dua model membuat pengelompokan kacau.

### Kalau angkanya kosong, nol, atau "tanpa" — sebab & cara mengatasi

- "Di-embed: 0, Dilewati: <semua>" setelah menekan Embedding Ulang — ini normal, bukan kegagalan. Sistem membandingkan sidik jari isi dokumen + nama model; bila keduanya sama dengan yang tersimpan, dokumen tidak dihitung ulang. Bila Anda YAKIN template sudah diubah, pastikan perubahan template benar-benar tersimpan (tombol Simpan) dan bahwa Anda mengubah bagian template yang memang menghasilkan teks berbeda. Mengganti Nama Model akan membuat semua dokumen dianggap berubah.
- Pratinjau kosong / "Tidak ada job profile terekstrak untuk pratinjau" — business unit yang sedang aktif tidak punya satu pun dokumen job profile berstatus selesai dengan hasil ekstraksi. Penyebab umum: dokumen belum disinkronkan/diekstrak, atau folder dokumen belum dipetakan ke business unit ini. Solusi: jalankan sinkronisasi job profile, lalu periksa pemetaan folder dokumen ke BU.
- Daftar "Pilih job profile…" kosong dan tidak bisa diklik — penyebabnya sama seperti di atas; daftar hanya berisi dokumen milik BU aktif yang sudah selesai diekstrak.
- Angka pada kartu Job Profiles / Kamus Kompetensi menampilkan "—" — status belum selesai dimuat atau gudang embedding belum siap sehingga jumlah tidak bisa dihitung. Tanda ini BUKAN berarti nol. Tekan tombol muat ulang; bila tetap "—", periksa peringatan kuning di panel yang sama.
- Angka Job Profiles di panel Vector Store lebih besar daripada jumlah dokumen milik BU Anda — memang begitu: penyimpanan embedding adalah korpus bersama semua business unit, karena penilaian bisa membandingkan kandidat lintas BU. Yang mengikuti BU aktif hanyalah tampilan daftar dokumen di halaman lain.
- Pilihan "Nomic — Ollama lokal" bertanda "tidak terjangkau saat ini" walaupun layanannya hidup — penanda itu muncul karena sumber tersebut memang tidak pernah dilaporkan oleh pemeriksaan ketersediaan model. Sumber ini tetap boleh dipilih dan tetap berfungsi selama alamat layanan embedding lokal benar. Tanda serupa pada Multilingual E5 berarti layanan scoring tidak menjawab saat halaman dimuat.
- Pilihan "Nomic — API server (eksternal)" bertanda "belum dikonfigurasi" — nama model belum ditetapkan pada pengaturan server. Nama model masih bisa diketik manual di kolom Nama Model, tetapi sebaiknya minta IT mengisi konfigurasinya agar konsisten.
- Muncul peringatan kuning "Ekstensi pgvector belum aktif" dan semua tombol embed mati — gudang penyimpanan vektor belum siap. Konfigurasi masih bisa disimpan. Solusi (IT): pastikan container database vector berjalan dan alamat koneksinya benar, lalu pasang ekstensi pgvector dan jalankan migrasi tabel embedding.
- Pesan "Gagal terhubung ke layanan embedding di <alamat>" — mesin penerjemah teks-ke-angka tidak menjawab. Periksa apakah layanan pada alamat tersebut hidup; bila memakai sumber Multilingual E5, pastikan alamat layanan scoring terisi. Proses berhenti pada batch itu; dokumen yang sudah selesai sebelumnya tetap tersimpan dan akan dilewati saat proses diulang.
- Pesan "Sesi rebuild kedaluwarsa atau tidak ditemukan. Mulai ulang." — rencana embedding hanya disimpan sementara di memori server selama 30 menit dan hilang bila server dimuat ulang atau permintaan jatuh ke instance server lain. Solusi: tekan Embedding Ulang Job Profile lagi; pekerjaan yang sudah selesai otomatis dilewati.
- Sudah menyimpan template tetapi peta job family tidak berubah — menyimpan template hanya mengubah ATURAN. Urutannya wajib: Simpan → Embedding Ulang Job Profile (agar dokumen dibaca ulang) → bangun ulang peta di halaman Peta Job Family. Khusus perubahan parameter BERTopic (tab ketiga), embedding ulang TIDAK diperlukan, cukup bangun ulang peta.
- Template khusus sudah dibuat tetapi jabatan itu tidak berpindah rumpun — template khusus baru berpengaruh setelah dokumen itu di-embed ulang. Gunakan "Restrukturisasi & embed profil ini" (satu dokumen) atau jalankan Embedding Ulang Job Profile, lalu bangun ulang peta.
- Khawatir Embedding Ulang global akan menghapus template khusus — tidak akan. Proses global membentuk setiap dokumen dengan template khususnya bila ada, dan hanya memakai template global untuk dokumen yang tidak punya template khusus.
- Pesan "Dokumen hasil restrukturisasi kosong — tidak ada yang di-embed." saat meng-embed satu profil — template yang berlaku untuk dokumen itu tidak menghasilkan teks apa pun. Penyebab tersering: token salah tulis (harus persis, mis. {{positionName}}, bukan {{position_name}}), template khusus hanya berisi label tanpa token, atau hasil ekstraksi dokumennya memang kosong. Perbaiki lewat pratinjau di sebelah editor — pratinjau langsung memperlihatkan hasil akhirnya sebelum disimpan.
- Pada proses global, dokumen dengan hasil restrukturisasi kosong tidak melaporkan galat — ia hanya ikut terhitung sebagai "Dilewati". Jadi bila sebuah jabatan tidak pernah muncul di peta, periksa pratinjaunya di mode "Job profile spesifik".
- Baris seperti "Atasan Langsung:" hilang dari pratinjau — memang disengaja: baris berlabel yang datanya kosong otomatis dibuang agar label kosong tidak mengotori pengelompokan. Bila baris penting hilang, artinya data pada dokumen sumbernya belum terisi, bukan template yang salah.
- Persentase keanggotaan jabatan pada rumpun tidak muncul di halaman peta — biasanya karena saklar perhitungan probabilitas (calculate_probabilities) dinonaktifkan. Aktifkan kembali lalu bangun ulang peta (prosesnya jadi lebih lambat).
- Isian min_samples / nr_topics / diversity dibiarkan kosong — kosong berarti "otomatis" atau "nonaktif", bukan nol, dan itu memang nilai bawaannya. Tidak perlu diisi kecuali ingin menyetel khusus.
- Menekan Simpan di satu kartu ternyata ikut menyimpan perubahan di tab lain — memang begitu perilakunya: konfigurasi disimpan sebagai satu kesatuan, label kartu hanya mengubah teks notifikasi. Bila ada perubahan yang belum ingin diberlakukan, muat ulang halaman dulu sebelum menekan Simpan.
- Perubahan yang saya simpan ternyata juga berlaku untuk business unit lain — benar, konfigurasi Job Family (template, template khusus, parameter model, parameter BERTopic) bersifat global dan tidak dipisahkan per business unit. Koordinasikan perubahan sebelum menyimpan.
- Muncul "Anda tidak memiliki akses untuk kelola profil job, job family & kamus kompetensi." — halaman bisa dibuka dengan izin lihat saja, tetapi semua tombol simpan/embed memerlukan izin kelola. Mintakan izin tersebut kepada admin pengguna.
- Ingin membatalkan perubahan template dan kembali ke keadaan sebelumnya — tidak ada tombol undo. Kembalikan teks templatenya secara manual (template bawaan berisi 14 baris berlabel seperti pada mode "Seluruh struktur dokumen"), simpan, lalu jalankan embedding ulang. Versi konfigurasi lama masih tersimpan sebagai riwayat di basis data dan hanya dapat dipulihkan oleh IT.

---

## Dokumen Job Profile (menu "Dokumen" → seksi Dokumen Job Profile) — rute /job-profiles; Job Profile Match di /job-profiles/match, Kamus Kompetensi di /job-profiles/kamus (URL lama /job-profiles?tab=match dialihkan; Struktur Posisi sudah dihapus — /posisi/struktur, /job-profiles/struktur dan /job-profiles?tab=hierarchy dialihkan ke Peta Job Family)

Halaman ini adalah katalog dokumen job profile / job description (JD) perusahaan yang sudah ditarik otomatis dari folder berbagi PDF dan dibaca isinya oleh AI (OCR Vision), lalu disimpan terstruktur (tujuan jabatan, tanggung jawab, kualifikasi, kompetensi). Di sini HR bisa: (1) menelusuri dan memeriksa isi tiap dokumen JD serta memastikan ekstraksinya berhasil; (2) melihat struktur/hierarki posisi hasil sinkronisasi HR; dan (3) yang paling penting untuk suksesi — di tab "Job Profile Match" — memeriksa dan menyimpan PEMETAAN antara kandidat (lewat posisi aktifnya) dengan dokumen job profile. Pemetaan inilah yang dipakai sistem di tempat lain: saran otomatis "Pilih dari Job Profile" saat membuat posisi di Position Management, peta Job Family pada hasil scoring, tampilan incumbent di Family Tree, dan bukti penilaian karier/teknis saat scoring. Kalau pemetaan belum pernah disimpan atau tersimpan dengan cakupan business unit yang salah, fitur-fitur turunan itu akan tampil kosong atau "tidak teridentifikasi".

### Empat kartu metrik dokumen (bagian paling atas, selalu tampil di semua tab)

Ringkasan status ekstraksi AI atas dokumen job profile yang TERLIHAT oleh business unit yang sedang aktif (pemilih tenant di sidebar). Cakupan kepemilikan dokumen berasal dari pemetaan folder → business unit; dokumen yang foldernya belum dipetakan sengaja ditampilkan ke semua business unit.

Angka & status pada panel ini:

- Total Dokumen = jumlah baris dokumen JD yang terlihat oleh business unit aktif (semua status). Angka ini TIDAK sama dengan angka "Job Profile" di tab Job Profile Match, karena tab tersebut menghitung seluruh korpus JD lintas business unit.
- Selesai Ekstraksi = dokumen yang berhasil dibaca AI dan datanya terstruktur (status completed). Hanya dokumen inilah yang ikut dalam pencocokan di tab Job Profile Match.
- Dalam Proses = dokumen berstatus sedang diproses atau masih mengantre. Isinya belum bisa dibuka; detailnya menampilkan pesan "Sedang Mengekstraksi Dokumen".
- Gagal Ekstraksi = dokumen yang gagal dibaca AI. Detailnya menampilkan banner merah berisi pesan galat asli. Dokumen gagal tidak pernah ikut pencocokan kandidat.
- Nilai 0 pada Total Dokumen berarti belum ada PDF tersinkron sama sekali, ATAU semua dokumen dimiliki business unit lain lewat pemetaan folder.

### Tab "Job Profile" — daftar katalog dokumen (kartu atau tabel)

Daftar dokumen JD milik business unit aktif, hasil sinkronisasi folder PDF. Tiap kartu/baris memuat kode dokumen, nama posisi, divisi/departemen, kontrol pemetaan tenant, status ekstraksi, tanggal sinkronisasi, cuplikan tujuan jabatan, plus tombol hapus. Tersedia pencarian, filter status, filter tenant, pengurutan, dan pengalihan tampilan kartu/tabel. Halaman kartu berisi 8 dokumen, tampilan tabel 15 dokumen per halaman.

Angka & status pada panel ini:

- Nomor dokumen kosong ditampilkan "N/A" — artinya AI tidak menemukan nomor JD di dalam PDF; ini tidak menghalangi pencocokan.
- "Divisi tidak tersedia" / "N/A" pada divisi = kolom divisi tidak berhasil diekstraksi dari dokumen.
- Judul yang tampil adalah nama posisi hasil ekstraksi; bila kosong, yang ditampilkan adalah nama berkas PDF-nya. Nama posisi kosong membuat dokumen tersebut TIDAK dihitung dan tidak bisa dicocokkan di tab Job Profile Match.
- Badge tenant (mis. MULIA, MSO, ERRO) = business unit yang dokumen ini dipetakan ke sana; klik untuk mengubah lewat kotak centang. Beberapa unit bisa dicentang sekaligus.
- Badge kuning "belum dipetakan" = dokumen ini belum dikaitkan ke business unit mana pun, sehingga tampil di SEMUA business unit. Klik badge tersebut untuk mencentang unit pemiliknya langsung — tidak ada halaman terpisah yang perlu dibuka.
- Teks paginasi "Menampilkan X-Y dari Z dokumen" mengikuti hasil filter/pencarian, bukan total katalog.

### Dialog Detail Job Profile (muncul saat sebuah dokumen diklik)

Isi lengkap dokumen JD hasil ekstraksi AI, dibagi ke enam tab: Informasi Utama (tujuan jabatan, bawahan langsung, ikhtisar bagan organisasi, nomor/tanggal/revisi/jumlah halaman dokumen, persetujuan, path berkas sumber, waktu diproses), Tanggung Jawab (tabel tanggung jawab + indikator keberhasilan), Spesifikasi Jabatan (pendidikan, pengalaman, gender/persyaratan tambahan, keahlian, wewenang), Kompetensi (perilaku dan teknis beserta level target), Hubungan & Pemecahan Masalah, serta Data Mentah JSON.

Angka & status pada panel ini:

- Angka pada tab "Tanggung Jawab (n)" = jumlah butir tanggung jawab yang berhasil diekstraksi; 0 berarti bagian itu tidak terbaca AI atau memang kosong di PDF.
- Tanda "-" pada field administrasi dokumen = nilainya tidak ada di hasil ekstraksi.
- "Tidak ada rincian kompetensi teknis/perilaku" = dokumen tidak memuat bagian tersebut atau AI gagal menguraikannya; akibatnya penilaian teknis pada scoring untuk posisi terkait harus memakai jalur cadangan.
- Badge level di samping kompetensi teknis = level kemahiran yang DIMINTA jabatan menurut dokumen, bukan level yang dimiliki orang.
- Untuk dokumen berstatus gagal, isi tab tidak tampil; yang muncul hanya banner galat dan pesan "Gagal Membaca Data".

### Tab "Job Profile Match" — enam kartu statistik

Hasil hitung ulang pencocokan kandidat ↔ dokumen job profile. Kandidat diambil dari business unit yang dicentang pada pemilih tenant di dalam tab ini (bukan dari sidebar), posisi aktif kandidat diambil dari data penugasan HR (penugasan yang belum berakhir), dan JD diambil dari SELURUH korpus dokumen tanpa penyaringan business unit. Pencocokan berjalan empat jalur berurutan: (1) kode posisi kandidat sama dengan kode di awal nama berkas JD; (2) judul posisi persis sama dengan nama posisi di JD; (3) kemiripan makna (embedding) di atas 98%; (4) AI — sisa jabatan yang tidak tertangani tiga jalur di atas diserahkan ke model AI lokal, yang memilih SATU JD dari sekitar 10 JD terdekat (atau menyatakan tidak ada yang cocok). Jalur AI bisa dimatikan lewat kotak centang "Cocokkan sisa dengan AI" di tab ini.

Tentang jalur AI: AI hanya boleh memilih dari daftar pendek yang sudah disaring embedding — ia tidak menelusuri seluruh korpus dan tidak bisa mengarang JD. Aturannya: fungsi dan level jabatan harus sama (Supervisor ≠ Head), singkatan dan urutan kata boleh berbeda, dan bila ragu AI WAJIB menjawab "tidak ada" — memasangkan JD yang salah lebih berbahaya daripada tidak memasangkan, karena JD dipakai menilai kompetensi teknis & relevansi karier saat scoring. Setiap keputusan AI disimpan per nama jabatan, sehingga sinkronisasi berikutnya memberi hasil yang sama dan tidak memanggil AI lagi untuk jabatan itu. Bila model AI tidak dapat dihubungi, jalur ini dilewati dan jabatan sisa tetap tercatat sebagai belum cocok — bukan dipasangkan asal.

Angka & status pada panel ini:

- Kandidat = jumlah kandidat aktif (belum diarsipkan) pada business unit yang dicentang. Keterangan di bawahnya menyebut berapa business unit yang sedang tercentang.
- Job Profile = jumlah dokumen JD berstatus selesai ekstraksi DAN punya nama posisi. Ini seluruh korpus lintas business unit, jadi wajar lebih besar dari "Total Dokumen" di atas halaman.
- Cocok = jumlah kandidat yang berhasil dipasangkan ke satu JD (satu kandidat maksimal satu JD). Persentasenya terhadap jumlah Kandidat.
- Posisi Aktif = jumlah JUDUL posisi aktif yang berbeda pada company milik business unit tercentang. Keterangannya menyebut berapa judul yang belum punya JD. Catatan penting: penilaian "tanpa profil" untuk daftar ini hanya memakai jalur judul dan kemiripan makna, tidak memakai jalur kode nama berkas — jadi sebuah posisi bisa terhitung "tanpa profil" walau JD dengan kode yang sama sebenarnya ada tetapi judulnya berbeda.
- Kandidat Tanpa Profil = kandidat yang posisi aktifnya tidak cocok dengan JD mana pun, berikut persentasenya terhadap total kandidat.
- Profil Tanpa Incumbent = JD yang tidak diduduki kandidat mana pun dari business unit tercentang, berikut persentasenya terhadap total JD. JD yang kodenya sebenarnya diduduki kandidat tercentang (tetapi kandidat itu berpasangan dengan JD kembar berkode sama) sengaja dikeluarkan dari daftar ini.
- Semua angka nol pada kartu-kartu ini biasanya berarti: belum ada kandidat di business unit tercentang, atau belum ada dokumen JD berstatus selesai.

### Tab "Job Profile Match" — daftar Pasangan Kandidat ↔ Job Profile

Kartu utama berisi seluruh pasangan hasil pencocokan: nama kandidat + kode company di kiri, nama job profile + label jalur kecocokan di kanan. Dilengkapi pemilih business unit, tombol Jalankan Sinkronisasi, tombol Simpan Pemetaan, serta filter jalur kecocokan / job profile / posisi kandidat dan kotak pencarian.

Angka & status pada panel ini:

- Badge hijau di judul = jumlah pasangan pada laporan saat ini (sama dengan kartu "Cocok").
- Badge "n tersimpan" = jumlah baris pemetaan yang SUDAH tersimpan di basis data untuk kandidat yang masih aktif. Bila angka ini 0 atau lebih kecil dari badge hijau, artinya hasil terbaru belum disimpan (atau tersimpan dengan cakupan business unit lain).
- Label "ID Posisi (nama file)" = dipasangkan karena kode posisi kandidat identik dengan kode di awal nama berkas JD — ini jalur paling meyakinkan.
- Label "Nama Posisi" = judul jabatan kandidat identik (setelah dirapikan huruf besar/kecil dan spasi) dengan nama posisi pada JD.
- Label "Embedding >98% · n%" = dipasangkan karena kemiripan makna judul melebihi 98%; angka persen adalah tingkat kemiripannya. Di bawah 98% tidak pernah dipasangkan.
- Angka dalam kurung pada filter jalur = jumlah pasangan per jalur; "n hasil" di ujung kanan = jumlah setelah filter/pencarian diterapkan (tidak mengubah apa yang akan disimpan).
- Banner kuning "Tier embedding dilewati" berarti layanan embedding tidak dapat dihubungi, sehingga jalur ketiga tidak dijalankan dan angka "Cocok" bisa lebih rendah dari biasanya.

### Modal "Kandidat tanpa job profile" (dari kartu Kandidat Tanpa Profil)

Daftar kandidat yang posisi aktifnya tidak menemukan JD. Setiap baris bisa dibuka untuk melihat diagnosis "kenapa tidak terpetakan" plus profil lengkap kandidat dan konteks posisinya (ID posisi, company, judul internal/eksternal, grade, level, atasan, jumlah bawahan, mulai menjabat, ringkasan posisi, rekan se-posisi, kompetensi teknis, riwayat posisi).

Angka & status pada panel ini:

- Badge "Tanpa posisi aktif" = kandidat tidak punya penugasan posisi yang masih berlaku pada data HR, sehingga tidak ada kode posisi untuk dicocokkan (sering karena penomoran NIK tidak cocok antar tabel atau penugasan sudah berakhir).
- Badge "Posisi tanpa JD cocok" = kandidat punya posisi aktif, tetapi kode maupun judulnya tidak menemukan JD.
- "Posisi saat ini tidak diketahui" = judul posisi kosong di kedua sumber (data posisi hasil sinkronisasi maupun kolom posisi pada data kandidat).
- Pada diagnosis: "ID cocok kode nama file: tidak" disertai daftar "ada JD berawalan sama" berarti unit kerjanya punya JD, tetapi posisi spesifik ini belum dibuatkan JD.
- Pada diagnosis: "Judul cocok position_name profil: ya" padahal kandidat masuk daftar ini menandakan kasus yang perlu ditinjau (mis. JD-nya belum berstatus selesai ekstraksi).
- Kolom profil kandidat yang bertanda "—" berarti datanya kosong di data kandidat (mis. HAV, MCU, disiplin, pendidikan belum tersinkron).
- "Jumlah Bawahan 0" = posisi tidak punya bawahan pada data hierarki, bukan berarti data gagal dimuat.

### Modal "Job profile tanpa incumbent kandidat" (dari kartu Profil Tanpa Incumbent)

Daftar JD yang tidak dipegang kandidat mana pun, dapat disaring per skenario. Mengklik satu baris membuka detail JD lengkap dengan kartu diagnosis "Kenapa profil ini tanpa incumbent?" di bagian atas.

Angka & status pada panel ini:

- Skenario "Kandidat tenant lain" = posisi tersebut memang diduduki kandidat, tetapi kandidatnya ada di business unit yang tidak dicentang. Solusi: centang business unit itu pada pemilih tenant.
- Skenario "Incumbent non-kandidat" = posisi diduduki karyawan yang belum terdaftar sebagai kandidat. Solusi: tambahkan orang tersebut ke daftar kandidat bila memang relevan untuk suksesi.
- Skenario "Tanpa incumbent aktif" = tidak ada seorang pun yang aktif menduduki posisi itu (posisi kosong / JD lama).
- Pada kartu diagnosis, baris "Kode nama file" bercentang hijau berarti kode di nama berkas JD ditemukan di data posisi dan/atau data penugasan aktif; bertanda silang merah berarti kode itu tidak dikenal sama sekali (penamaan berkas JD kemungkinan tidak sesuai pola).
- Baris "Incumbent aktif: 0 orang" = tidak ada yang menduduki posisi ini, jadi tidak mungkin ada pasangan.
- Label "kandidat @<nama unit>" pada daftar orang = orangnya kandidat, tetapi di business unit lain.
- Keterangan "hanya ada di sync_employee_positions" berarti data induk karyawannya belum lengkap tersinkron, sehingga nama/divisi tidak bisa ditampilkan.

### Modal "Posisi aktif tanpa job profile" (dari kartu Posisi Aktif)

Daftar judul posisi aktif yang berbeda — baik yang ada penghuninya maupun kosong — yang belum punya dokumen JD. Ini daftar celah cakupan JD untuk ditindaklanjuti pembuatan dokumennya.

Angka & status pada panel ini:

- Badge angka di judul = jumlah judul posisi tanpa JD; keterangan di bawah menyebut proporsinya terhadap seluruh judul posisi aktif.
- Badge "tanpa profil" pada setiap baris hanya penanda status, bukan angka.
- Isi daftar berupa JUDUL posisi yang unik, bukan jumlah orang — satu judul bisa dipegang banyak orang di beberapa company.

### Dialog detail pasangan (saat satu kartu pasangan diklik)

Penjelasan mengapa kandidat dan JD tersebut dipasangkan ("Alasan Kecocokan"), ditambah informasi kandidat dan isi lengkap job profile-nya.

Angka & status pada panel ini:

- Untuk jalur kode nama berkas: ditampilkan kode posisi, nomor JD, dan nama berkas yang cocok.
- Untuk jalur nama posisi: informasi kandidat sengaja tidak ditampilkan karena dasar kecocokannya adalah dokumen JD itu sendiri.
- Untuk jalur embedding: ditampilkan kedua teks yang dibandingkan dan bilah persentase kemiripan (selalu di atas 98%).

### Kalau angkanya kosong, nol, atau "tanpa" — sebab & cara mengatasi

- "Kenapa angka Job Profile di tab Match (mis. 480) beda jauh dengan Total Dokumen di atas halaman (mis. 210)?" — Kartu atas hanya menghitung dokumen yang dimiliki business unit yang sedang aktif (berdasarkan pemetaan tenant per dokumen), sedangkan tab Match sengaja memakai SELURUH korpus JD lintas business unit dan hanya yang berstatus selesai ekstraksi serta punya nama posisi. Ini bukan kesalahan. Kalau ingin angka atas bertambah, petakan dokumen yang relevan ke business unit di halaman Job Profiles.
- "Kenapa banyak dokumen berlabel 'belum dipetakan'?" — Dokumennya belum dikaitkan ke business unit mana pun, sehingga tampil ke semua business unit. Perbaikannya: klik badge tenant pada kartu/baris dokumen (atau di dialog detailnya), centang business unit yang benar, lalu Simpan — berlaku seketika, tidak perlu sinkronisasi ulang.
- "Kenapa angka Cocok kecil / nol padahal dokumen JD banyak?" — Tiga penyebab tersering: (1) dokumen JD-nya belum berstatus Selesai Ekstraksi atau nama posisinya kosong sehingga tidak ikut dicocokkan; (2) business unit yang tercentang di dalam tab Match bukan tempat kandidat berada; (3) kandidat tidak punya posisi aktif pada data penugasan HR. Cek kartu "Kandidat Tanpa Profil" dan buka satu baris untuk melihat diagnosisnya.
- "Kenapa peringatan kuning 'Tier embedding dilewati' muncul dan angka Cocok turun dibanding minggu lalu?" — Layanan embedding (penghitung kemiripan makna) sedang tidak dapat dihubungi, sehingga jalur ketiga pencocokan tidak dijalankan dan hanya jalur kode nama berkas serta judul persis yang dipakai. JANGAN menekan Simpan Pemetaan dalam kondisi ini, karena pemetaan yang tersimpan akan kehilangan pasangan jalur kemiripan. Minta tim IT menghidupkan/menyetel layanan embedding, jalankan sinkronisasi lagi, baru simpan.
- "Kenapa badge 'n tersimpan' lebih kecil dari angka pasangan hijau, atau tidak muncul sama sekali?" — Artinya hasil pencocokan terbaru belum disimpan, atau simpanan terakhir dilakukan dengan cakupan business unit yang berbeda. Centang semua business unit yang relevan, tekan Jalankan Sinkronisasi, lalu Simpan Pemetaan.
- "Setelah saya menyimpan pemetaan, pemetaan business unit lain hilang." — Ini perilaku bawaan: penyimpanan bersifat mengganti seluruh isi untuk kandidat yang masih aktif di semua business unit, sedangkan yang dimasukkan hanya pasangan dari business unit yang tercentang. Solusinya: centang SEMUA business unit yang perlu ikut, jalankan sinkronisasi, lalu simpan sekali saja. Tidak ada tombol pembatalan.
- "Kandidat tercatat 'Tanpa posisi aktif' padahal orangnya jelas masih bekerja." — Sistem tidak menemukan penugasan posisi yang masih berlaku untuk NIK tersebut, biasanya karena format NIK tidak seragam antar sumber data, penugasan sudah kedaluwarsa, atau company kandidat belum dipetakan aktif ke business unit-nya. Cek pemetaan company → business unit di menu Sinkronisasi dan jalankan ulang sinkronisasi karyawan/posisi.
- "Kandidat berlabel 'Posisi tanpa JD cocok' — apa yang harus dilakukan?" — Buka barisnya: bila diagnosis menyebut ada JD berawalan kode sama, berarti unit kerjanya punya JD tetapi posisi spesifik ini belum dibuatkan dokumen JD (tindak lanjut: buatkan JD-nya). Bila diagnosis menyebut judul sebenarnya cocok dengan sebuah JD, kemungkinan JD tersebut belum selesai diekstraksi atau ekstraksinya gagal — periksa statusnya di tab Job Profile.
- "Sebuah posisi muncul di daftar 'Posisi aktif tanpa job profile' padahal JD-nya ada." — Daftar tersebut menilai posisi dari JUDUL-nya saja (judul persis atau kemiripan makna), tidak lewat kode nama berkas. Jadi bila judul di data posisi berbeda dengan nama posisi di dokumen JD, posisi itu tetap terhitung tanpa profil, meskipun ada JD berkode sama. Selaraskan penamaan judul posisi atau nama posisi pada dokumen JD.
- "Kenapa sebuah job profile masuk 'Profil Tanpa Incumbent' padahal ada orang yang menjabat?" — Buka barisnya dan baca kartu diagnosis. Tiga kemungkinan: penjabatnya kandidat di business unit yang belum dicentang (centang unit tersebut), penjabatnya karyawan yang belum terdaftar sebagai kandidat (tambahkan sebagai kandidat bila relevan untuk suksesi), atau memang tidak ada penjabat aktif. Bisa juga karena ada dua JD berkode sama dan kandidatnya sudah berpasangan dengan JD kembarannya yang judulnya lebih cocok.
- "Nama posisi/divisi di kartu dokumen kosong atau bertuliskan N/A." — Kolom tersebut tidak berhasil dibaca AI dari PDF. Dampak terpentingnya: dokumen dengan nama posisi kosong sama sekali TIDAK ikut pencocokan kandidat. Perbaikannya: pastikan kualitas PDF layak dibaca lalu jalankan ulang sinkronisasi job profile dengan opsi proses ulang.
- "Dokumen berstatus Gagal Ekstraksi — bagaimana memperbaikinya?" — Buka detailnya untuk membaca pesan galat asli, perbaiki PDF-nya bila rusak/terkunci, lalu jalankan ulang sinkronisasi job profile dari menu Sinkronisasi. Dokumen gagal tidak pernah ikut dihitung dalam pencocokan maupun dipakai saat scoring.
- "Peta Job Family di hasil scoring menunjukkan finalis 'tidak teridentifikasi' / titiknya bolong." — Umumnya karena kandidat tersebut belum punya baris pemetaan tersimpan. Buka tab Job Profile Match, centang business unit yang benar, Jalankan Sinkronisasi, lalu Simpan Pemetaan. Bila kandidat memang tidak punya pasangan JD, selesaikan dulu penyebabnya lewat modal Kandidat Tanpa Profil.
- "Saya menekan tombol hapus dokumen tetapi tidak terjadi apa-apa dan tombolnya jadi mati." — Kemungkinan besar peran Anda tidak memiliki izin Kelola menu Dokumen & Posisi; penolakan terjadi di server dan pada kasus ini pesannya bisa tidak muncul. Muat ulang halaman dan minta administrator menyesuaikan peran Anda.
- "Dokumen sudah saya hapus, ternyata salah — bisa dikembalikan?" — Tidak dari aplikasi. Selama berkas PDF-nya masih ada di folder berbagi, jalankan ulang sinkronisasi job profile: dokumen masuk lagi, tetapi harus diekstraksi ulang oleh AI dan mendapat identitas internal baru, sehingga pemetaan kandidat ke dokumen itu harus disimpan ulang dan penyematan folder manual perlu diatur kembali.
- "Saya baru menambah PDF baru, tapi tab Match belum menunjukkannya." — Tombol Jalankan Sinkronisasi di tab ini tidak menarik berkas baru dari folder; penarikan PDF dilakukan di menu Sinkronisasi. Setelah sinkronisasi dokumen selesai dan statusnya Selesai Ekstraksi, kembali ke sini, muat ulang halaman atau tekan Jalankan Sinkronisasi, lalu simpan pemetaan.
- "Tab Job Profile Match lama sekali memuatnya." — Membuka seksi ini TIDAK menghitung apa pun: yang tampil adalah hasil pencocokan terakhir yang tersimpan di basis data untuk business unit aktif (lengkap dengan daftar posisi tanpa profil dan profil tanpa incumbent, plus waktu dan nama yang menjalankannya). Yang lama (±5–20 detik) hanya tombol "Jalankan Pencocokan" / "Jalankan Ulang", karena harus menghitung kemiripan makna seluruh judul posisi dan nama JD; hasilnya langsung menggantikan yang tersimpan, jadi cukup dijalankan ulang bila data posisi atau dokumen JD berubah (misalnya setelah sinkronisasi Senin). Menjalankan ulang TIDAK mengubah pemetaan yang dipakai fitur lain — itu tetap lewat tombol Simpan Pemetaan.

---

## Tata Kelola (rute /governance) — dibuka juga lewat tautan langsung /governance?tab=programs|prompts|readiness|audit (tab lama contexts → prompts, grades → readiness, feedback → programs)

Halaman ini adalah "ruang mesin" penilaian suksesi: di sinilah ditentukan aturan main yang dipakai setiap kali scoring dijalankan. Isinya: program penilaian (Talent Pool, Critical Position, Emergency, atau program buatan sendiri) beserta syarat kelayakan kandidat, bobot tiap aspek penilaian, dan jumlah finalis yang diminta; prompt model bahasa yang dipakai metode AHP + TOPSIS; ambang batas tingkat kesiapan (Short/Medium/Long/Not Ready); serta riwayat siapa mengubah apa. Perubahan di sini tidak mengubah hasil run yang sudah selesai — hasil lama tetap menjadi catatan penilaian pada tanggalnya; yang berubah adalah run berikutnya. Penting: sebagian besar pengaturan berlaku untuk business unit yang sedang aktif di pemilih unit, TETAPI dua hal bersifat lintas unit (Scoring Prompts dan Readiness) — mengubahnya ikut mengubah pengalaman unit lain. Halaman hanya bisa dibuka pemegang izin "Kelola tata kelola"; pengguna lain otomatis dilempar ke beranda.

Kepemilikan tenant dokumen job profile TIDAK lagi diatur di sini — lihat "Katalog Job Profile" di atas, kontrol pemetaan tenant ada langsung pada tiap dokumen.

### Menu bagian (kolom kiri)

Empat bagian dalam dua grup: Aturan Penilaian (Program Penilaian; Instruksi & Model AI — berisi satu blok "Prompt AHP + TOPSIS"; Kesiapan & Pensiun — berisi ambang readiness, ambang usia pensiun, dan referensi master grade per level yang bisa dibuka-tutup) dan Pemantauan (Riwayat Perubahan). Di kanan atas tiap bagian ada lencana cakupan: "Berlaku untuk Company aktif" atau "Berlaku untuk semua Company". Bagian yang terbuka pertama kali mengikuti tautan ?tab= bila ada, kalau tidak selalu Program Penilaian; berpindah bagian memperbarui ?tab= di alamat sehingga muat ulang kembali ke bagian yang sama.

Yang sudah dihapus dari halaman ini bersama metode AI Tournament (November 2026): bagian Umpan Balik AI (monitor downvote; tautan lama ?tab=feedback kini membuka Program Penilaian), Konteks Bisnis (tautan lama ?tab=contexts membuka bagian prompt), dan AI System Prompt program beserta tombol pembuat otomatis dan riwayat versinya.

### Program Penilaian — pemilih program (baris chip di atas editor)

Semua program penilaian milik business unit yang sedang aktif, urut nama. Label 'Built-in' menandai tiga program bawaan (Talent Pool, Critical Position, Emergency Position) yang otomatis dibuatkan saat unit ini pertama kali membuka halaman. Program bawaan boleh diedit, tetapi tidak boleh dihapus.

Angka & status pada panel ini:

- Daftar kosong praktis tidak pernah terjadi: begitu halaman dibuka dan unit belum punya program, tiga program bawaan langsung dibuatkan otomatis.
- Program yang dibuat di satu business unit tidak muncul di unit lain.

### Program Penilaian — detail program

Isi satu program: Nama, Target Finalis (N), Deskripsi, Aturan Filter, dan Bobot AHP. Kode program ditampilkan di bawah judul dan tidak bisa diubah dari sini. Tombol "Ubah aturan filter" hanya membuka editornya — tidak ada yang tersimpan sampai tombol **Simpan program** pada bar lengket di bawah kartu ditekan; lencana kuning "Belum disimpan" di judul dan tombol "Batalkan" menandai/membuang perubahan yang belum tersimpan. Tombol Simpan nonaktif bila tidak ada perubahan.

Angka & status pada panel ini:

- Target Finalis (N) = berapa nama teratas yang masuk daftar finalis run. Nilai dibatasi 1–50; angka di luar itu dibulatkan ke batas terdekat saat disimpan. Bila jumlah kandidat yang lolos filter lebih kecil dari N, yang dipakai adalah jumlah kandidat tersebut. Seluruh kandidat tetap dinilai; N hanya menentukan batas daftar finalis.
- Badge 'x aturan filter' = jumlah aturan filter paling dasar (baris aturan) di seluruh grup, termasuk yang berada di dalam sub-grup.
- Badge 'Matriks aktif' pada Bobot AHP muncul hanya bila bobot khusus sudah diaktifkan. Tanpa badge itu, program memakai bobot bawaan sistem.

### Aturan Filter (di dalam program)

Susunan syarat kelayakan berbentuk grup DAN/ATAU yang bisa bersarang. Setiap baris aturan terdiri dari Field (Status Disiplin, Status MCU, Performance Appraisal, HAV Quadrant, Behavior Recommendation, Masa Kerja, Pendidikan), Operator, Nilai, Label, Pesan gagal, dan **Akibat bila gagal**. Pilihan Nilai adalah gabungan daftar baku aplikasi dengan nilai yang benar-benar ada pada data kandidat unit ini.

Angka & status pada panel ini:

- 'Tidak ada filter — semua kandidat lolos' berarti belum ada satu pun aturan; seluruh kandidat dalam rentang grade akan dinilai.
- Sakelar 'Terapkan sebagai Hard-Filter (auto-gugur)' aktif = kandidat yang gagal aturan langsung gugur, tidak ikut dinilai, dan tercatat di daftar 'Tidak Lolos' beserta pesan gagalnya. Nonaktif = aturan tidak menggugurkan siapa pun; hasilnya hanya dicatat.
- 'Akibat bila gagal' berlaku PER ATURAN, berbeda dari sakelar di atas yang berlaku untuk semua aturan sekaligus. 'Menggugurkan' (bawaan) = kandidat tidak ikut dinilai. 'Hanya menandai' = kandidat tetap dinilai dan masuk peringkat, temuannya muncul di daftar 'Kandidat Ditandai' pada tab Konfigurasi Run.
- **Status MCU bawaannya 'Hanya menandai'.** Ia tidak menggugurkan siapa pun dan tidak mengubah skor maupun peringkat; kandidat yang gagal aturan itu tetap dinilai dan hanya muncul di daftar 'Kandidat Ditandai'.
- Untuk Performance Appraisal, penilaian aturan membaca semua periode penilaian 3 tahun terakhir, bukan hanya satu nilai. 'termasuk A,B' berarti cukup ada satu periode bernilai A atau B; 'tidak termasuk D,E' berarti tidak boleh ada satu periode pun bernilai D atau E. Kandidat tanpa data PA sama sekali diperlakukan seolah bernilai C.
- Nilai bersifat sensitif huruf besar/kecil — memilih dari daftar jauh lebih aman daripada mengetik bebas.

### Kriteria Penilaian (di dalam program) — tidak ada editornya

Daftar kriteria program (mis. Technical Competency Mapping, Behavior Competency Assessment, HAV Mapping, Performance Appraisal, Employee Profile - Pendidikan) masih tersimpan pada template, tetapi **tidak punya editor dan tidak dibaca mesin mana pun** — ia hanya deskriptif. Metode AHP + TOPSIS selalu menilai keenam aspek, termasuk Career Relevance, dan bobotnya hanya dari Bobot AHP (atau bobot bawaan sistem). Dulu nama kriteria menentukan aspek apa yang dinilai metode AI Tournament; metode itu sudah dihapus. Run lama tetap menyimpan daftar kriterianya di snapshot konfigurasi run.

### Bobot AHP (Metode AHP + TOPSIS)

Pengatur kepentingan enam aspek: Technical Competency, Career Relevance, Behavior Competency, Performance Appraisal, HAV Mapping, Education. **Tiga mode**, dari paling sederhana ke paling eksak: '1 Urutan' (seret kriteria dari terpenting ke paling tidak penting), '2 Slider' (satu penggeser bobot 2–65 % per aspek), dan '3 Berpasangan' (15 perbandingan dua-dua berskala Saaty, sebagai Daftar atau Matriks). Semuanya tampilan dari SATU matriks berisi penilaian skala Saaty; berpindah mode tidak mengubah apa pun, dan perubahan di satu mode langsung terlihat di mode lain. Bobot ini dipakai metode AHP + TOPSIS, satu-satunya metode scoring.

Angka & status pada panel ini:

- Persentase di sisi kanan tiap aspek = bobot prioritas hasil perhitungan, totalnya 100%.
- Mode Urutan memindahkan nilai bobot yang ada mengikuti urutan baru, lalu menulis ulang ke-15 penilaian pada skala Saaty — penilaian berpasangan sebelumnya diganti. Kriteria yang bobotnya sama setelah dibulatkan ditampilkan seri ("2 =").
- Angka pada mode Slider adalah bobot dalam persen. Saat dilepas, kelima penilaian aspek itu dibulatkan ke skala Saaty dan slider melompat ke bobot hasil hitung ulang; pratinjau "→ x%" tampil selama menggeser.
- Setiap pembulatan diumumkan per pasangan dengan nilai sebelum → sesudah, misalnya "Karier vs HAV: 1 → 2".
- Seretan pada mode Berpasangan hanya menyusun arah pertanyaan perbandingan dan tidak mengubah bobot. Hanya mode Urutan yang mengubah bobot lewat seretan.
- 'CR = 0.0xx · konsisten' adalah rasio konsistensi penilaian berpasangan, tampil di semua mode dan dihitung oleh fungsi yang sama dengan validasi simpan. Nilai ≤ 0,1 dianggap konsisten. Bila lebih dari 0,1, atau ada nilai di luar skala Saaty, penyimpanan DITOLAK dengan pesan yang menyebut pasangan dan angkanya.
- Sel diisi dengan mengetik 1–9 lalu menekan Enter atau pindah sel; mengetik ulang angka yang sama juga tersimpan.
- Matriks lama dengan nilai di luar skala Saaty (mis. 1,25) tampil apa adanya bersama banner kuning: daftar nilai yang akan dibulatkan, CR sebelum → sesudah, dan tombol 'Bulatkan ke skala Saaty'. Selama belum diperbaiki, program itu tidak dapat memulai sesi scoring baru.

### Instruksi & Model AI — Prompt AHP + TOPSIS

Satu blok berisi hanya prompt yang masih dipakai mesin, dipilih dari daftar di kiri: **AHP+TOPSIS — Education (Grounded Gemini)** (`ahp_education_grounded`, dipakai hanya bila pendidikan kandidat tidak persis sama dengan syarat job profile — model menilai kecocokan jenjang dan jurusan) dan **AHP+TOPSIS — Insight Suksesi** (`ahp_narrative_agent`, penulis narasi keunggulan, kebutuhan pengembangan, dan arahan suksesi per finalis; tidak mengubah skor, peringkat, atau kesiapan). Prompt metode AI Tournament (penilai kompetensi teknis, penilai pendidikan, penulis justifikasi) dan prompt pendidikan lama berlabel legacy sudah dihapus; daftar ini dibatasi oleh `ACTIVE_SCORING_PROMPT_KEYS` (`lib/scoring-prompt-keys.ts`), jadi berkas prompt yang disunting lokal dan masih memuat kunci lama pun tidak menampilkannya.

Angka & status pada panel ini:

- Prompt di sini TIDAK per business unit — nilainya sama untuk semua unit karena disimpan sebagai berkas konfigurasi aplikasi, bukan data per unit.
- 'Belum ada riwayat' berarti prompt tersebut belum pernah diubah/di-checkpoint. Riwayat menyimpan maksimal 50 versi terakhir per prompt; versi paling lama terdorong keluar.

### Readiness

Daftar ambang skor beserta level kesiapan dan ETA-nya, ditambah 'Default Level' untuk skor di bawah semua ambang. Bawaan: 80 → Short (0–1 tahun), 65 → Medium (1–2 tahun), 50 → Long (3–5 tahun), sisanya Not Ready.

Angka & status pada panel ini:

- Min Score = skor minimum agar masuk level tersebut. Saat disimpan, daftar otomatis diurutkan dari ambang tertinggi ke terendah dan baris dengan nilai di luar 0–100 dibuang diam-diam.
- Kolom ETA murni teks yang ditampilkan ke pengguna; tidak ikut dihitung.
- Ambang ini berlaku untuk SEMUA business unit — berpindah unit tidak memberi nilai berbeda.

### Audit Log

Riwayat perubahan konfigurasi tata kelola untuk business unit aktif: waktu, aktor, jenis aksi (create/update/delete), entitas yang tersentuh, dan ringkasan perubahan. Ada pencarian ringkasan, rentang tanggal, dan navigasi halaman 50 baris.

Angka & status pada panel ini:

- 'Menampilkan a-b dari n aktivitas' mengikuti filter yang sedang aktif, bukan total seluruh riwayat.
- Saat halaman dibuka, rentang tanggal otomatis diisi tanggal 1 bulan berjalan sampai hari ini — aktivitas yang lebih lama akan tampak 'hilang' sampai rentangnya diubah atau filter dihapus.
- Pencarian hanya mencocokkan kolom Ringkasan, bukan nama aktor atau jenis entitas.
- Perubahan pada Scoring Prompts dan Readiness TIDAK tercatat di sini karena tersimpan sebagai berkas konfigurasi aplikasi; yang tercatat adalah perubahan program dan pemetaan folder. Baris lama tentang konteks bisnis, versi prompt program, dan penghapusan umpan balik tetap tampil sebagai riwayat, meskipun fiturnya sudah dihapus.

### Kesiapan & Pensiun — Referensi master grade per level (bisa dibuka-tutup)

Tabel referensi baca-saja berisi master grade per level yang berasal dari sistem HR (Behaviour Competency): Company, Level ID, Level Name, Grade ID.

Angka & status pada panel ini:

- Tabel ini tidak disaring per business unit — semua company yang tersinkron akan muncul.
- 'Belum ada data grade. Jalankan sync terlebih dahulu.' berarti pekerjaan sinkronisasi grade level belum pernah berjalan.
- Tanda '—' pada Level Name berarti sumber HR tidak mengisi nama level untuk baris itu.

### Kalau angkanya kosong, nol, atau "tanpa" — sebab & cara mengatasi

- "Saya sudah mengubah aturan filter / bobot, tapi tidak ada yang berubah." — Penyuntingan aturan filter, kriteria & bobot, dan bobot AHP hanya tersimpan setelah menekan tombol Simpan di kepala kartu program. Menutup panel Edit atau berpindah program tanpa Simpan akan membuang perubahan tanpa peringatan. Pastikan juga muncul notifikasi 'Program berhasil disimpan.'
- "Kenapa hasil run yang lama tidak ikut berubah setelah saya perbaiki bobot?" — Memang disengaja. Run yang sudah selesai adalah catatan penilaian pada tanggal tersebut. Perubahan tata kelola berlaku untuk run berikutnya; untuk memakai aturan baru, jalankan scoring ulang pada posisi tersebut.
- "Bobot AHP tidak bisa disimpan, muncul pesan rasio konsistensi (CR) melebihi 0.1." — Penilaian berpasangan Anda saling bertentangan (mis. A lebih penting dari B, B lebih penting dari C, tetapi C lebih penting dari A). Perbaiki beberapa perbandingan yang paling ekstrem. Mode Urutan biasanya menghasilkan matriks yang konsisten (CR terukur ≤ 0,01 pada semua 720 urutan), tetapi mengganti seluruh penilaian berpasangan.
- "Di mana saya mengatur bobot kriteria?" — Di panel **Bobot AHP**, dan hanya di sana. Panel Kriteria Penilaian sudah tidak punya kolom bobot: ia hanya menentukan aspek apa saja yang dinilai. Tanpa matriks AHP aktif, program memakai bobot bawaan sistem (Behavior 35%, Technical 25%, HAV 20%, PA 10%, Career 5%, Pendidikan 5%).
- "Aspek Career Relevance tidak ada di daftar Kriteria Penilaian — kenapa nilainya tetap dihitung?" — AHP + TOPSIS selalu menilai keenam aspek, termasuk Career, dengan bobot dari matriks (bawaan 5%); daftar kriteria program hanya deskriptif dan tidak dibaca mesin.
- "Kenapa perubahan Scoring Prompts / Readiness tidak muncul di Audit Log?" — Kedua pengaturan itu disimpan sebagai berkas konfigurasi aplikasi, bukan data per business unit, sehingga tidak menghasilkan baris audit. Yang tercatat adalah perubahan program dan pemetaan folder.
- "Saya ubah ambang Readiness di unit Mulia, tapi unit MSO ikut berubah." — Benar dan memang begitu rancangannya: ambang Readiness dan Scoring Prompts berlaku untuk seluruh business unit. Bila unit membutuhkan ambang berbeda, itu bukan sesuatu yang dapat diatur dari halaman ini.
- "Prompt sudah saya simpan tapi run yang sedang berjalan masih memakai teks lama." — Layanan penilaian menyimpan salinan prompt di memori dan hanya menyegarkannya saat prompt disimpan. Run yang sudah dimulai tidak berganti prompt di tengah jalan. Bila layanan penilaian sedang mati saat Anda menyimpan, teks tetap tersimpan dan akan dipakai setelah layanan dinyalakan kembali — mulai run baru untuk memakainya.
- "Riwayat prompt kosong padahal saya sudah beberapa kali mengedit." — Versi hanya terbentuk saat prompt LAMA yang tidak kosong benar-benar tergantikan oleh teks berbeda, atau saat Anda menekan Simpan Versi. Mengetik lalu tidak menyimpan tidak membuat versi.
- "Dokumen sudah saya petakan ke tenant tapi hasil scoring tidak berubah." — Pemetaan tenant sengaja hanya mengatur TAMPILAN dan analisis. Mesin penilaian membaca seluruh dokumen agar kandidat lintas business unit dinilai atas dasar yang sama; ini bukan kelalaian.
- "Dokumen baru sudah masuk tapi belum muncul di Job Family / belum mempengaruhi penilaian karier." — Setelah dipetakan ke tenant, masih perlu membangun ulang embedding job profile dan menjalankan pencocokan job profile agar dokumen dipakai oleh analisis dan penilaian karier.
- "Audit Log tampak kehilangan aktivitas lama." — Saat dibuka, rentang tanggal otomatis diisi tanggal 1 bulan berjalan sampai hari ini. Tekan 'Hapus filter' atau mundurkan tanggal 'Dari' untuk melihat aktivitas sebelumnya. Ingat juga pencarian hanya mencocokkan kolom Ringkasan dan hanya menampilkan aktivitas business unit yang aktif.
- "Tabel Grade Levels kosong." — Data grade berasal dari sinkronisasi HR dan bukan sesuatu yang bisa diisi dari halaman ini. Jalankan pekerjaan sinkronisasi grade level dari halaman Sinkronisasi. Tabel ini juga tidak disaring per unit, jadi seluruh company yang tersinkron akan muncul.
- "Nilai yang saya butuhkan tidak ada di pilihan Nilai pada aturan filter." — Pilihan berisi daftar baku aplikasi digabung nilai yang benar-benar ada pada data kandidat business unit ini. Bila data kandidat belum tersinkron/masih kosong, hanya daftar baku yang tampil. Untuk Pendidikan Anda boleh mengetik bebas, tetapi penulisan harus persis seperti tersimpan (huruf besar/kecil berpengaruh) — kalau tidak, aturan filter tidak akan pernah cocok.
- "Saat memulai scoring muncul pesan semua kandidat gagal aturan filter." — Aturan hard-filter program terlalu ketat untuk kolam kandidat yang dipilih. Longgarkan aturan filter (mis. tambahkan grade PA atau kuadran HAV yang diterima) atau matikan sakelar hard-filter agar aturan filter tidak menggugurkan siapa pun.
- "Jumlah finalis yang keluar lebih sedikit dari Target Finalis yang saya isi." — Target Finalis dibatasi oleh jumlah kandidat yang lolos filter; bila yang lolos lebih sedikit, itulah jumlah yang keluar. Periksa juga rentang grade posisi dan aturan filter program. Pada metode AHP+TOPSIS seluruh kandidat tetap dinilai walau daftar finalis dibatasi.
- "Tombol Hapus tidak muncul pada program tertentu." — Program bawaan (berlabel Built-in) sengaja tidak bisa dihapus agar setiap unit selalu punya program dasar. Program tersebut tetap boleh diedit; bila tidak dipakai, cukup jangan dipilih saat menjalankan scoring.
- "Setelah sebuah program dihapus, nama program pada riwayat run menjadi kosong." — Menghapus program tidak menghapus run lama, tetapi kaitannya ke program ikut hilang sehingga kolom program tampil kosong di riwayat. Karena itu menghapus program sebaiknya menjadi pilihan terakhir.
- "Saya ingin menyembunyikan sebuah dokumen dari semua business unit dengan mengosongkan centang tenant." — Tidak bisa: nol centang berarti 'belum dipetakan', yang justru membuat dokumen terlihat oleh semua unit. Untuk benar-benar menghilangkannya, dokumennya yang harus dihapus.

---

## Kamus Kompetensi (/job-profiles/kamus — URL lama /kamus-kompetensi dialihkan) · Scoring Baru (/scoring/new) · Pengaturan Sinkronisasi (/settings/sync) · Keamanan & Enkripsi (/settings/security)

Empat halaman pendukung siklus suksesi Pulse. (1) Kamus Kompetensi: katalog baca-saja seluruh kompetensi teknis (kode TC) beserta definisi dan tuntutan 4 level proficiency — sumber rujukan saat membaca hasil penilaian teknis; isinya berasal dari PDF "Dictionary Technical Competency" yang diunggah di halaman Sinkronisasi, berlaku sama untuk semua unit bisnis. Kamus TIDAK memetakan kompetensi ke jabatan; untuk melihat kompetensi yang dituntut sebuah jabatan (termasuk jabatan yang belum dikelola di Position Management) gunakan halaman Job Profile. (2) Scoring Baru: wizard menjalankan satu sesi penilaian/perangkingan kandidat terhadap satu posisi — memilih program, posisi target, unit bisnis penyumbang kandidat, rentang level, dan kandidat yang dikecualikan, lalu memantau progres sampai peringkat tersimpan. (3) Pengaturan Sinkronisasi: pusat kendali masuknya data — koneksi database sumber, tombol tarik data per modul, unggah berkas PDF/Excel, riwayat eksekusi, pembangunan vektor embedding, pemetaan Company ID ke unit bisnis, dan pengosongan/pemulihan pool kandidat. (4) Keamanan & Enkripsi: mengelola kunci master yang melindungi password database sumber — inisialisasi, buka kunci, kunci, dan rotasi. Catatan akses: bila login Keycloak tidak dikonfigurasi, aplikasi berjalan sebagai satu "System User" beradmin penuh sehingga semua tombol terbuka.

### Kamus — Bilah pencarian & penghitung kompetensi

Kotak pencarian dan satu lencana jumlah. Pencarian mencocokkan kode (mis. "TC 003"), nama kompetensi, dan isi deskripsi; daftar disaring langsung di browser tanpa memanggil server ulang. Data dimuat setelah halaman tampil, bukan saat halaman dirender.

Angka & status pada panel ini:

- "X / Y kompetensi": X = jumlah kartu yang lolos pencarian saat ini, Y = total kompetensi di kamus. Tanpa kata kunci, X selalu sama dengan Y.
- "… kompetensi": data masih dimuat; kotak pencarian ikut nonaktif selama itu.
- "0 / 0": belum ada satu pun kompetensi tersimpan — PDF kamus belum pernah diunggah/diproses.
- Angka ini global, bukan per unit bisnis: kamus tidak punya kolom unit bisnis sehingga Mulia, MSO, dan ERRO melihat angka yang sama persis.

### Kamus — Grid kartu kompetensi

Satu kartu per kompetensi, terurut menurut kode. Tiap kartu memuat kode TC, nama, potongan deskripsi (maksimal 3 baris), dan chip level yang datanya terisi. Semua isi berasal dari hasil pembacaan PDF kamus.

Angka & status pada panel ini:

- "n/4 level": berapa dari empat kolom level (1 Basic, 2 Intermediate, 3 Advance, 4 Mastery) yang berhasil dibaca dari PDF. 4/4 = lengkap; kurang dari 4 berarti kolom itu kosong di PDF atau gagal terbaca, dan chip levelnya tidak ditampilkan.
- "Tidak ada deskripsi.": paragraf deskripsi kompetensi kosong di dokumen sumber — bukan berarti kompetensinya tidak dipakai.
- Chip warna (1 · Basic, 2 · Intermediate, 3 · Advance, 4 · Mastery) hanya muncul untuk level yang ada isinya.

### Kamus — Dialog detail kompetensi

Dibuka dengan mengklik satu kartu. Menampilkan kode, nama, deskripsi, dan empat kotak level berisi butir-butir tuntutan (dipecah dari tanda • pada PDF), plus baris sumber di bawah.

Angka & status pada panel ini:

- "Tidak ada rincian level ini.": kolom level tersebut kosong pada PDF sumber untuk kompetensi ini.
- "Sumber: <nama berkas>": nama file PDF yang menghasilkan baris ini; bertanda "-" bila baris lama tersimpan tanpa nama berkas.
- "Disinkron <tanggal>": kapan baris ini terakhir ditulis ulang oleh proses unggah kamus. Kompetensi yang tidak berubah tetap memakai tanggal unggah terakhir yang menyentuhnya.

### Scoring Baru — Konfigurasi Penilaian Sesi Baru (kolom kiri)

Form utama: Program Penilaian (daftar template program milik unit bisnis aktif), Posisi Target Jabatan (HANYA posisi yang didaftarkan di Position Management PADA PROGRAM YANG SEDANG DIPILIH, dengan departemen, level, dan nama pejabat saat ini), Nama Sesi opsional, pemilih Unit Bisnis Kandidat, dan panel Exclude Kandidat.

Tidak ada pilihan metode: setiap sesi dinilai dengan AHP + TOPSIS, satu-satunya metode sejak AI Tournament dihapus (November 2026).

Angka & status pada panel ini:

- Mengganti Program Penilaian akan mengganti daftar Posisi Target: posisi yang tidak terdaftar pada program baru itu hilang dari pilihan, dan posisi terpilih berpindah ke posisi pertama program tersebut.
- "Belum ada posisi pada program ini" berarti jabatan yang dicari memang belum ditambahkan pada program tersebut — tambahkan dulu di Position Management, tidak cukup mengganti program di sini.
- Daftar posisi kosong sama sekali tidak mungkin muncul: bila unit bisnis belum punya posisi, halaman langsung dialihkan ke daftar Posisi.
- "Pool mencakup N unit bisnis": jumlah unit bisnis yang kandidatnya ikut dinilai; unit yang sedang aktif selalu terhitung dan tidak bisa dilepas.
- Angka pada lencana di tombol Exclude Kandidat = jumlah kandidat yang dicentang untuk dikecualikan, termasuk pejabat saat ini yang dicentang otomatis.
- Nama Sesi kosong akan diisi otomatis menjadi "<nama program> — <nama posisi> — <tanggal hari ini>".

### Scoring Baru — Panel Exclude Kandidat

Daftar seluruh kandidat aktif dari unit bisnis yang dipilih (belum disaring rentang level maupun aturan filter program), lengkap dengan jabatan dan departemen, plus kotak pencarian nama/jabatan/departemen. Kandidat yang NPK-nya sama dengan pejabat saat ini otomatis tercentang, diberi label "Pejabat Saat Ini", dan tidak dapat dilepas.

Angka & status pada panel ini:

- "N kandidat": jumlah kandidat aktif di seluruh unit bisnis yang dipilih.
- "· M filter": jumlah baris yang cocok dengan kata kunci pencarian (hanya tampil saat mencari).
- "· K dikecualikan": jumlah kandidat yang akan dilewati pada sesi ini.
- "Tidak ada kandidat tersedia.": pool kandidat unit bisnis tersebut kosong — kandidat belum disinkron, atau seluruhnya sedang dikosongkan/dihapus.
- Daftar ini di-reset setiap kali posisi, program, atau daftar unit bisnis diubah, sehingga pengecualian yang sudah dicentang ikut hilang.

### Scoring Baru — Ringkasan Konfigurasi Sesi & Rentang Level (kolom kanan)

Ringkasan program (nama, deskripsi, Target Finalis, "Metode: AHP + TOPSIS") dan posisi terpilih, lalu dua pemilih Rentang Level (minimum s/d maksimum) yang otomatis terisi dari rentang grade posisi dan boleh ditimpa untuk sesi ini saja.

Angka & status pada panel ini:

- "Target Finalis: N": berapa kandidat teratas yang diambil sebagai finalis, diambil dari setelan program. Seluruh pool tetap dihitung dan diranking.
- "x dari y kandidat dalam rentang grade ini (z difilter)": y = seluruh kandidat aktif di unit bisnis terpilih, x = yang grade-nya masuk rentang, z = yang tersingkir. Kandidat TANPA grade, atau yang grade-nya tidak memuat angka, selalu ikut terhitung sebagai tersingkir.
- Baris pratinjau ini tidak muncul sama sekali bila kedua pemilih level dikosongkan — artinya tidak ada penyaringan level dari wizard, dan yang berlaku adalah rentang grade bawaan posisi.

### Scoring Baru — Layar Progres (fase memproses & selesai)

Bilah progres persen, dua kartu ringkasan, dan checklist tahapan metode AHP + TOPSIS. Progres dibaca berulang dari layanan scoring setiap 2 detik, jadi tetap benar walau tab ditutup lalu dibuka lagi lewat tautan sesi.

Angka & status pada panel ini:

- Kartu "Kandidat Aktif": angka besar = jumlah kandidat yang benar-benar masuk sesi setelah pengecualian dan saringan rentang level; angka kecil setelah garis miring = total kandidat yang dimuat sebelum disaring.
- "N dikecualikan (incumbent)": jumlah kandidat yang dicentang di panel Exclude; muncul "Semua kandidat siap dievaluasi" bila tidak ada.
- "N terfilter oleh rentang grade": baris ini hanya muncul bila sistem sempat menghitung selisihnya; pada sesi pertama sesudah halaman dibuka baris ini kerap tidak muncul walau ada kandidat yang tersaring level — angka yang bisa dipercaya adalah pratinjau "x dari y" di layar konfigurasi.
- Kartu tahapan menampilkan tahap berjalan (Aspek 1/6 Technical … Aspek 6/6 Education, lalu perangkingan) dan pada tahap Education menampilkan "a / b kandidat dianalisis AI".
- "Menunggu layanan scoring...": sesi sudah dibuat di database tetapi layanan scoring belum melaporkan tahap apa pun.

### Sinkronisasi — Susunan halaman (satu halaman, tanpa tab)

Urutan kartu mengikuti seberapa sering dipakai: (1) bilah status — lencana layanan online/offline, eksekusi terakhir, pemilih Filter Company, dan tombol **Jalankan Sinkronisasi Penuh**; (2) **Ringkasan Data Tersinkron** — satu baris per modul (jumlah baris, chip per Company, "terakhir berubah"; lebih dari 2 minggu ditandai kuning; baris tanpa mapping sengaja tidak ditampilkan); (3) **Pemetaan Company ID → Company** (terbuka — menentukan data tarikan masuk ke Company mana); (4) **Unggah Berkas Sumber** (job profile, kamus, HAV, MCU — terbuka, karena ini satu-satunya jalur masuk data tersebut); (5) **Sinkronisasi per Modul** (terbuka); (6) **Riwayat Sinkronisasi** (tertutup — hasil eksekusi terakhir sudah tampil di judulnya dan di bawah tiap tombol modul); (7) **Pengetahuan AI — embedding & pemetaan nama kompetensi** (tertutup; dulu tab "BERT"); (8) **Pengaturan & Pemeliharaan** — Koneksi Source Database, Unggah Excel Pengganti Sumber, Data Kandidat — semuanya tertutup dengan ringkasan satu baris di judul. Header tiap kartu diberi latar tipis dalam satu dari empat nada: utama (biru merek — status, pemetaan, unggah), netral (ringkasan, per modul, riwayat, pengetahuan AI), hati-hati (kuning — koneksi sumber, Excel pengganti), berbahaya (merah — Data Kandidat). Pilihan buka/tutup tiap kartu diingat per peramban.

### Sinkronisasi — Koneksi Database Sumber

Dua panel (DB MPMDS untuk master karyawan/jabatan/hierarki/kompetensi teknis, DB MPMHRGA untuk kinerja, grade level, kompetensi perilaku). Berisi server, port, nama database, username, password, tiga sakelar, dan kotak "Sedang dipakai layanan" yang menampilkan apa yang benar-benar dipakai layanan sinkronisasi.

Angka & status pada panel ini:

- Lencana "Environment variable": layanan masih memakai setelan dari konfigurasi server, bukan yang tersimpan di halaman ini (baris belum diisi atau sakelar "Pakai pengaturan ini" dimatikan).
- Lencana "Pengaturan tersimpan": layanan memakai baris yang disimpan di sini.
- "Password: kosong": layanan tidak memegang password sama sekali untuk sumber itu.
- "Password tersimpan tidak terpakai": ada password tersimpan tetapi layanan tidak bisa membukanya karena enkripsi terkunci, lalu diam-diam memakai password dari konfigurasi server.
- "Belum disimpan": ada perubahan yang diketik tetapi belum ditekan Simpan.
- "Pengaturan aktif tidak diketahui": layanan sinkronisasi tidak dapat dihubungi, jadi yang tampil hanya nilai tersimpan.

### Sinkronisasi — Ringkasan Data Tersinkron (tabel, dulu 13 kartu)

Jumlah baris per modul di database Pulse: Karyawan, Divisi, Departemen, Master Posisi, Emp-Pos Map, Tech Mapping, Kinerja, Kedisiplinan, Pendidikan, Data Pribadi, Kandidat, Job Profile, Kamus Kompetensi. Di bawah tiap angka ada rincian per unit bisnis.

Angka & status pada panel ini:

- Angka besar = jumlah baris hasil sinkronisasi, dihitung untuk SELURUH unit bisnis (bukan hanya unit yang sedang aktif), kecuali Kandidat.
- Kandidat dihitung hanya yang aktif — kandidat yang dikosongkan atau dihapus tidak ikut.
- Lencana "Tanpa mapping": baris yang Company ID-nya belum dipetakan ke unit bisnis mana pun, sehingga tidak akan muncul di halaman mana pun. Perbaikannya lewat tabel Pemetaan Company ID → Tenant.
- Job Profile dan Kamus Kompetensi tidak punya rincian per unit bisnis karena keduanya dokumen lintas unit.
- Angka 0 pada satu kartu berarti modul itu belum pernah berhasil ditarik/diunggah.

### Sinkronisasi — Bilah status & Sinkronisasi per Modul

Lencana status layanan (Memeriksa layanan… / online / offline), pemilih Filter Company, tombol sinkronisasi penuh (di bilah atas), dan tombol per modul (kartu tersendiri) yang dikelompokkan menurut asal data: Database (MSSQL), API Orange, dan Turunan (diolah dari data yang sudah ada).

Angka & status pada panel ini:

- Baris di bawah tiap tombol: umur eksekusi terakhir ("3 menit lalu") plus jumlah record yang tersinkron; ikon centang = berhasil, segitiga = gagal, lingkaran berputar = masih jalan.
- "Belum pernah dijalankan": belum ada catatan eksekusi untuk modul itu (atau riwayat memang belum aktif di instalasi ini).
- Pemilih Filter Tenant hanya berisi unit bisnis yang punya pemetaan Company ID aktif; bila kosong tampil "Belum ada mapping aktif".
- Ketika layanan offline, seluruh tombol sinkronisasi dan unggah di halaman ini dinonaktifkan dan alasannya ditulis di kotak kuning.

### Sinkronisasi — Unggah Berkas Sumber (PDF/Excel khusus)

Empat kotak seret-dan-lepas: Job Profile (PDF, diekstrak AI, ditandai "Lama"), Kamus Kompetensi (PDF), HAV Quadrant (Excel), Status MCU (Excel — kolom NPK, Nama, Kesimpulan, dan **Keterangan** yang opsional tapi dianjurkan untuk yang Unfit / Fit With Note; keterangan itu disimpan sebagai catatan MCU kandidat dan tampil di formulir Kandidat). Untuk keempat sumber ini, mengunggah ADALAH pemicunya — tidak ada tombol tarik dari folder bersama.

Angka & status pada panel ini:

- "Mengunggah a/b…": jumlah berkas yang sudah terkirim dari total yang dipilih.
- HAV dan MCU memperbarui per NPK: karyawan yang tidak ada di file tetap memakai nilai sebelumnya (tidak dikosongkan).
- Job Profile diproses di latar belakang sehingga hasilnya baru terlihat beberapa menit kemudian setelah halaman dimuat ulang.
- Berkas unggahan dihapus dari server begitu isinya masuk database — tidak ada salinan yang tersimpan.

### Sinkronisasi — Unggah Excel Pengganti Sumber (bagian Pengaturan & Pemeliharaan)

Sebelas kotak unggah untuk data yang biasanya ditarik dari MSSQL/API HR: Data Karyawan, Master Jabatan, Hierarki Jabatan, Penempatan Karyawan, Kompetensi Teknis, Penilaian Kinerja, Level & Grade, Kompetensi Perilaku, Catatan Disiplin, Riwayat Pendidikan. Tiap kotak menyertakan tombol unduh template.

Angka & status pada panel ini:

- Baris "Kunci baris: …" di tiap kartu menyebut kombinasi kolom yang menentukan sebuah baris diperbarui atau menjadi baris baru (mis. COMPANY_ID + EMPLOYEE_ID + TAHUN + SEQ).
- Unggahan hanya memperbarui; baris yang tidak ada di file tidak pernah dihapus.
- Berlaku sekali jalan: file dikonsumsi lalu dihapus, dan sinkronisasi terjadwal berikutnya kembali menarik dari sumber aslinya.

### Sinkronisasi — Riwayat Sinkronisasi

Tabel paginasi seluruh eksekusi sinkronisasi (termasuk yang gagal dan yang menghasilkan 0 record): modul, status, pemicu (Manual UI / API / Terjadwal / CLI beserta pelakunya), waktu mulai, jumlah record, durasi, dan keterangan/eror.

Angka & status pada panel ini:

- Kolom Record "-": eksekusi tidak melaporkan jumlah record (umumnya proses latar belakang yang masih berjalan atau gagal sebelum sempat menghitung).
- Kolom Durasi "-": eksekusi belum selesai.
- "Belum ada riwayat sinkronisasi.": belum pernah ada eksekusi tercatat di instalasi ini.
- "Halaman a dari b · N eksekusi": posisi paginasi dan total eksekusi tercatat.

### Sinkronisasi — Pengetahuan AI: Embedding Job Profile & Embedding Kamus Kompetensi (kartu tertutup, dulu tab BERT)

Dua panel kembar yang mengubah dokumen job profile dan tiap kompetensi kamus menjadi vektor, dipakai penilaian teknis & relevansi karier.

Angka & status pada panel ini:

- "a / b ter-embed": a = jumlah yang sudah punya vektor, b = jumlah dokumen/kompetensi yang tersedia. a=0 berarti belum pernah dibangun.
- Lencana "siap"/"belum siap": "belum siap" berarti tabel vektor belum tersedia atau database vektor tidak dapat dihubungi — pesan tepatnya ditulis di kotak kuning di bawahnya, dan tombol Mulai Embedding ikut mati.
- Kode model di sebelahnya adalah model embedding yang dipakai saat pembangunan terakhir; model harus sama dengan yang dipakai layanan scoring, kalau berbeda hasil kemiripan jadi tidak bermakna.
- Saat berjalan: Total / Di-embed / Dilewati (isinya tidak berubah sejak pembangunan terakhir) / Gagal.

### Sinkronisasi — Pemetaan Company ID → Company (kartu ke-3, terbuka)

Tabel yang menentukan Company ID dari database sumber (mis. MPM2) masuk ke unit bisnis Pulse yang mana, beserta status aktif dan waktu perubahan terakhir.

Angka & status pada panel ini:

- Status "Aktif"/"Nonaktif": hanya pemetaan aktif yang diproses saat sinkronisasi berjalan dan hanya unit bisnisnya yang muncul di pemilih Filter Tenant.
- "Belum ada mapping": tidak ada satu pun pemetaan — akibatnya seluruh data hasil tarikan akan berlabel "Tanpa mapping" di kartu statistik.

### Sinkronisasi — Data Kandidat (bagian Pengaturan & Pemeliharaan, tertutup)

Tiga ubin jumlah kandidat untuk unit bisnis yang sedang aktif, penjelasan bahwa mengosongkan bukan menghapus permanen, jalur pemulihan, dan tombol pengosongan massal.

Angka & status pada panel ini:

- "Aktif": kandidat yang terlihat di halaman Kandidat dan ikut dinilai saat scoring.
- "Dikosongkan": disembunyikan lewat tombol di kartu ini; muncul kembali otomatis pada sinkronisasi kandidat berikutnya, atau langsung lewat tombol Pulihkan.
- "Dihapus manual": dihapus satu per satu dari halaman Kandidat; sinkronisasi TIDAK memunculkannya kembali — harus dipulihkan per kandidat.
- Semua angka di kartu ini hanya untuk unit bisnis yang sedang aktif; unit lain tidak tersentuh.
- Daftar kandidat terhapus manual hanya menampilkan 200 penghapusan terbaru.

### Keamanan — Kartu Kunci Enkripsi

Status kunci (Belum diinisialisasi / Terkunci / Terbuka), lokasi berkas kunci di server, asal kunci (berkas / variabel lingkungan / belum ada), dan kendali sesuai status: inisialisasi, kolom buka kunci, atau tombol kunci.

Angka & status pada panel ini:

- "Belum diinisialisasi": enkripsi belum pernah diaktifkan; password sumber data tersimpan apa adanya tanpa enkripsi.
- "Terkunci": aplikasi tidak memegang kunci — nilai terenkripsi tidak terbaca dan penyimpanan password baru ditolak.
- "Terbuka" + "Dibuka pada <waktu>": aplikasi memegang kunci; waktu tersebut adalah saat kunci terakhir dibuka (termasuk pembukaan otomatis saat aplikasi start).
- "Berkas kunci belum ada": kunci belum pernah dibuat, atau berkasnya hilang/tidak ter-mount — aplikasi akan terkunci lagi setiap restart sampai berkasnya dipulihkan.
- "Kunci berasal dari environment variable PULSE_MASTER_KEY": kunci dapat dipakai, tetapi tombol Inisialisasi dan Rotasi tidak dapat bekerja dari halaman ini.

### Keamanan — Layanan pendamping

Daftar layanan lain yang perlu memegang kunci yang sama (layanan sinkronisasi), dengan status Memegang kunci / Terkunci / Tidak dapat dihubungi.

Angka & status pada panel ini:

- "Tidak ada layanan pendamping yang dikonfigurasi": alamat layanan sinkronisasi tidak diset, jadi tidak ada yang perlu dikirimi kunci.
- "Terkunci" padahal aplikasi terbuka: layanan itu akan diam-diam memakai password dari konfigurasi server, bukan password tersimpan — kunci lalu buka kembali enkripsi agar kunci terkirim ulang.
- "Tidak dapat dihubungi": layanan mati saat kunci dikirim; setelah hidup, buka kembali enkripsi.

### Keamanan — Rotasi kunci master (panel lipat)

Penjelasan bahwa rotasi hanya membungkus ulang kunci data (tidak ada nilai yang dienkripsi ulang), kolom opsional untuk kunci lama, dan tombol rotasi.

Angka & status pada panel ini:

- Kolom "Kunci master saat ini" boleh dikosongkan: kunci lama dibaca dari berkas kunci di server. Diisi hanya bila berkas kunci hilang atau tidak cocok dengan database.
- Setelah rotasi berhasil, kunci lama langsung tidak berlaku dan kunci baru hanya ditampilkan satu kali.

### Kalau angkanya kosong, nol, atau "tanpa" — sebab & cara mengatasi

- "Kamus kosong / 0 kompetensi" — belum ada PDF kamus yang diproses. Buka Pengaturan → Sinkronisasi → kartu Berkas Sumber → kotak "Kamus Kompetensi", unggah PDF Dictionary Technical Competency, tunggu notifikasi selesai, lalu buka lagi halaman Kamus. Kamus berlaku sama untuk semua unit bisnis, jadi cukup diunggah sekali.
- "Kartu bertuliskan 2/4 level atau kotak level berbunyi 'Tidak ada rincian level ini'" — kolom level itu kosong atau gagal terbaca dari PDF (dokumen aslinya hasil tata letak Word yang memecah kata, dan pembacaannya berbasis posisi kolom). Periksa halaman PDF untuk kompetensi tersebut; bila di dokumen memang ada isinya, unggah ulang berkas PDF yang lebih bersih/terbaru — baris akan ditimpa berdasarkan kode kompetensi.
- "Deskripsi kompetensi bertuliskan Tidak ada deskripsi" — paragraf deskripsi tidak ada pada dokumen sumber. Ini tidak menghalangi penilaian; yang dipakai mesin penilaian adalah teks tiap level.
- "Kolom Sumber pada detail kompetensi bertanda -" — baris tersebut tersimpan tanpa nama berkas (biasanya dari proses lama). Unggah ulang PDF kamus untuk mengisinya kembali.
- "Kompetensi lama masih muncul padahal sudah tidak ada di PDF baru" — proses kamus hanya memperbarui dan menambah berdasarkan kode; tidak pernah menghapus. Kompetensi yang benar-benar dihentikan harus dibersihkan dari database, bukan dari layar ini.
- "Bagaimana melihat kompetensi yang DITUNTUT sebuah jabatan?" — halaman Kamus sengaja tidak memetakan kompetensi ke jabatan. Jalur utamanya: buka halaman Job Profile, cari nama jabatan (kotak pencarian menerima nama posisi, divisi, atau nomor profil), buka dokumennya, dan lihat bagian "Kompetensi Teknis (Technical)" — tiap baris berisi nama kompetensi plus lencana level yang dituntut. Cara ini berlaku untuk jabatan APA PUN yang punya dokumen job profile, termasuk jabatan yang belum didaftarkan di Position Management. Sesudah itu, salin nama/kode kompetensinya ke halaman Kamus untuk membaca arti tiap levelnya.
- "Jabatan yang saya cari tidak ada di halaman Job Profile" — dokumen job profile-nya belum diunggah, atau berada di folder yang belum dipetakan ke unit bisnis Anda. Unggah PDF-nya lewat Sinkronisasi → Berkas Sumber → Job Profile (perlu beberapa menit karena diekstrak AI). Bila dokumen memang tidak ada, tuntutan kompetensi jabatan itu hanya bisa dilihat dari data Kompetensi Teknis hasil sinkronisasi — yang mencatat level yang dituntut jabatan versus level yang dicapai pemegang jabatan — dan inilah cadangan yang dipakai mesin penilaian AHP+TOPSIS ketika sebuah posisi tidak punya job profile. Untuk posisi yang sudah terdaftar, daftar kompetensi wajib juga dapat dikurasi manual pada form posisi.
- "Halaman Scoring Baru langsung melempar saya ke daftar Posisi" — unit bisnis aktif belum punya satu pun posisi. Daftarkan posisi target di Position Management lebih dulu; wizard hanya bisa menilai kandidat untuk posisi yang sudah terdaftar.

- "Posisi yang saya cari tidak ada di daftar Posisi Target, padahal sudah saya daftarkan" — posisi terikat pada satu program. Bila posisi itu didaftarkan pada program Critical Position, ia tidak akan muncul saat program Talent Pool dipilih. Buka Position Management, tambahkan jabatan yang sama sekali lagi dengan program yang diinginkan, lalu ulangi dari wizard. Posisi lama beserta seluruh riwayat run-nya tidak terpengaruh.
- "Muncul 'Tidak ada kandidat aktif untuk tenant ini.' saat Mulai Penilaian" — pool habis. Penyebab yang paling sering: (a) rentang level terlalu sempit, (b) kandidat tidak punya grade sehingga otomatis terbuang, (c) pool kandidat sedang dikosongkan di kartu Data Kandidat, (d) terlalu banyak kandidat dicentang di panel Exclude. Cek pratinjau "x dari y kandidat dalam rentang grade ini" di layar konfigurasi sebelum menekan Mulai.
- "Angka kandidat di pratinjau jauh lebih kecil dari jumlah karyawan" — kandidat tanpa grade, atau yang grade-nya tidak memuat angka, selalu dihitung tersingkir oleh saringan rentang level. Perbaiki data grade lewat sinkronisasi Karyawan (atau unggah Excel Data Karyawan), lalu jalankan sinkronisasi Kandidat.
- "Semua kandidat gagal aturan filter program" — program yang dipilih mengaktifkan hard-filter (mis. status disiplin). Longgarkan aturan filter pada template program, ubah 'Akibat bila gagal' aturan itu menjadi 'Hanya menandai', matikan penerapan hard-filter, atau perbaiki datanya lewat sinkronisasi terkait. Status MCU **bukan** lagi penyebab yang mungkin: bawaannya hanya menandai.
- "Baris 'N terfilter oleh rentang grade' tidak muncul di layar progres walau jelas ada yang tersaring" — pada sesi pertama setelah halaman dibuka, selisih itu kerap terhitung nol karena jumlah awal belum sempat tercatat. Angka yang bisa dipercaya adalah pratinjau "x dari y kandidat dalam rentang grade ini" di layar konfigurasi, dan angka "Kandidat Aktif" di layar progres.
- "Progres berhenti di 'Menunggu layanan scoring...' atau 0–10% terus" — sesi sudah tercatat tetapi layanan scoring tidak menjalankannya (layanan mati atau alamatnya belum diset). Sesi tidak hilang: setelah layanan hidup, buka kembali tautan sesi yang sama dan proses dilanjutkan. Bila layanan melaporkan gagal, jalankan ulang penilaian.
- "Pengecualian kandidat yang sudah saya centang hilang sendiri" — mengubah posisi target, program, atau daftar unit bisnis sengaja mengosongkan pilihan karena pool-nya berganti. Tetapkan ketiganya dulu, baru atur pengecualian.
- "Pejabat saat ini tidak bisa dilepas dari daftar pengecualian" — memang dikunci: ia tidak boleh dinilai sebagai kandidat pengganti dirinya sendiri. Sistem juga menyingkirkannya lagi saat membangun pool, dicocokkan lewat NPK dan nama.
- "Semua tombol sinkronisasi dan unggah abu-abu" — layanan sinkronisasi tidak dapat dihubungi (lencana merah "Sync service offline"). Kotak kuning di kartu Kontrol Sinkronisasi menyebutkan alasannya. Hidupkan kembali layanan sinkronisasi, lalu muat ulang halaman.
- "Kartu statistik menampilkan lencana 'Tanpa mapping'" — ada baris data yang Company ID-nya belum dipetakan ke unit bisnis mana pun, sehingga tidak muncul di halaman mana pun. Tambahkan pemetaan Company ID → Tenant di bagian bawah halaman, lalu jalankan sinkronisasi modul terkait.
- "Di bawah tombol modul tertulis 'Belum pernah dijalankan'" — belum ada catatan eksekusi untuk modul itu (belum pernah dijalankan sama sekali, atau pencatatan riwayat belum aktif di instalasi ini). Jalankan modulnya sekali; barisnya akan berganti menjadi umur eksekusi dan jumlah record.
- "Kolom Record atau Durasi di Riwayat Sinkronisasi bertanda -" — eksekusi belum selesai atau gagal sebelum sempat menghitung. Buka kolom Keterangan pada baris yang sama untuk melihat pesan erornya.
- "Kartu Kandidat tidak menampilkan waktu sinkron terakhir" — kandidat adalah data turunan yang tidak menyimpan cap waktu sinkron; gunakan baris "terakhir dijalankan" di bawah tombol Kandidat atau tabel Riwayat Sinkronisasi.
- "Angka kandidat menjadi 0 setelah pengosongan" — kandidat hanya disembunyikan, tidak dihapus. Tekan Pulihkan di kotak kuning kartu Data Kandidat, atau jalankan sinkronisasi Kandidat; mereka kembali dengan ID yang sama sehingga riwayat scoring tetap tersambung. Kandidat yang dihapus SATU PER SATU tidak ikut kembali dan harus dipulihkan lewat panel "Lihat kandidat yang dihapus manual".
- "Panel embedding bertuliskan 0 / N ter-embed atau berlencana 'belum siap'" — belum pernah dibangun, atau penyimpanan vektor belum tersedia / tidak dapat dihubungi (pesan tepatnya ada di kotak kuning). Bila statusnya 'siap', tekan Mulai Embedding. Bila 'belum siap', perbaiki dulu ketersediaan database vektor — tombolnya memang dimatikan agar tidak menghasilkan kegagalan berulang. Selama vektor kosong, penilaian teknis & relevansi karier pada AHP+TOPSIS jatuh ke mekanisme cadangan berbasis pemegang jabatan, dan hal itu dicatat pada halaman progres run.
- "Sudah menyimpan password database tapi layanan tetap memakai yang lama" — periksa kotak "Sedang dipakai layanan" pada panel koneksi. Lencana "Environment variable" berarti sakelar "Pakai pengaturan ini" mati atau barisnya belum tersimpan. Peringatan "Password tersimpan tidak terpakai" berarti enkripsi sedang terkunci sehingga layanan tidak dapat membaca password tersimpan — buka kunci di Pengaturan → Keamanan, lalu simpan ulang bila perlu.
- "Muncul peringatan bahwa password tersimpan tanpa enkripsi" — enkripsi belum pernah diaktifkan. Buka Pengaturan → Keamanan, jalankan Inisialisasi Enkripsi (simpan salinan kuncinya!), lalu kembali ke kartu koneksi dan simpan ulang password agar tersimpan dalam bentuk terenkripsi.
- "Status enkripsi 'Terkunci' setelah server restart" — normalnya kunci dibaca sendiri dari berkas kunci di server. Status terkunci berarti berkas kuncinya hilang/tidak ter-mount, atau seseorang menekan tombol Kunci. Tempel kunci master cadangan di kolom Buka Kunci: bila berkasnya tidak ada, sistem menuliskannya kembali sehingga restart berikutnya tidak terkunci lagi.
- "Layanan pendamping berstatus Terkunci padahal aplikasi Terbuka" — layanan itu belum menerima kunci (sempat mati saat kunci dikirim). Akibatnya ia memakai kredensial dari konfigurasi server tanpa memberi pesan gagal apa pun. Setelah layanan hidup, tekan Kunci lalu Buka Kunci agar kunci dikirim ulang.
- "Tombol Inisialisasi/Rotasi menolak dengan alasan variabel lingkungan" — kunci master di instalasi ini berasal dari variabel lingkungan PULSE_MASTER_KEY, yang tidak dapat ditulis dari halaman web. Kunci tetap dapat dipakai; pembuatan dan rotasinya harus dilakukan di luar aplikasi (atau hapus variabel itu agar beralih ke berkas kunci).

---

## Peta Job Family (menu Posisi → seksi Job Family), rute /posisi/job-family (URL lama /family-tree dan /job-profiles/job-family dialihkan)

Halaman ini memperlihatkan hasil pengelompokan otomatis seluruh dokumen job profile menjadi "job family" (rumpun jabatan). Sistem membaca dokumen job profile yang sudah diubah menjadi vektor (embedding), lalu mengelompokkan jabatan-jabatan yang isinya mirip, memberi nama umum pada tiap kelompok, menyusunnya menjadi pohon hierarki (kelompok kecil bergabung menjadi rumpun yang lebih besar), dan menempelkan nama karyawan (incumbent) yang saat ini memegang jabatan tersebut. Gunanya: melihat peta rumpun jabatan organisasi, menemukan jabatan yang berdekatan/serumpun untuk jalur karier dan suksesi, serta mengukur seberapa mirip dua jabatan. Halaman ini hanya membaca dan memetakan; ia tidak mengubah data kandidat, posisi, atau hasil scoring.

### Peringatan "Ekstensi pgvector belum aktif" (banner kuning paling atas)

Muncul hanya bila database penyimpan vektor belum siap (ekstensi/tabel vektor belum terpasang). Selama banner ini tampil, angka Ter-embed pasti 0 dan peta tidak bisa dibangun.

Angka & status pada panel ini:

- Tidak memuat angka; ini penanda kondisi teknis. Jika tampil, langkah 2 pada strip alur ditandai "TERHALANG" dan tidak punya tombol, sehingga langkah 3 ikut terkunci sampai tim IT mengaktifkan penyimpanan vektor.

### Strip "Alur pembuatan peta" (3 langkah berurutan)

Menggantikan empat kartu statistik lama (Job Profile, Ter-embed, Menunggu, Model). Angkanya sama, tetapi kini berdiri di samping tombol yang mengubahnya dan disusun menurut urutan jalannya. Aturan bacanya satu kalimat: **jalankan langkah yang tombolnya menyala (oranye penuh)**. Hanya satu langkah yang pernah menyala pada satu saat, dan langkah itu diberi label "BERIKUTNYA". Langkah yang sudah selesai ditandai centang hijau dan tombolnya menjadi garis tepi saja — boleh dijalankan ulang, tetapi bukan itu yang perlu dilakukan sekarang. Langkah yang belum bisa dijalankan tidak punya tombol sama sekali dan menyebutkan apa yang ditunggunya.

Angka & status pada panel ini:

- **Langkah 1 · Job profile terekstrak** = jumlah dokumen job profile yang sudah berhasil dibaca/diekstrak isinya dan menjadi milik unit yang sedang aktif (kepemilikan ditentukan oleh pemetaan folder dokumen → business unit di Tata Kelola). Dokumen yang foldernya belum dipetakan sengaja dianggap milik semua unit. Dokumen ditambah lewat seksi Dokumen, bukan di halaman ini; bila angkanya 0, tombolnya mengantar ke sana.
- **Langkah 2 · Transformasi jadi angka** = berapa dari dokumen itu yang sudah diubah menjadi vektor dan siap dikelompokkan, ditulis sebagai "N dari M". 0 berarti transformasi belum pernah dijalankan. Bila masih ada sisa, keterangannya menyebut berapa dokumen yang akan dilewatkan peta. Bila sudah lengkap, keterangannya menyebut nama model embedding yang dipakai — keterangan inilah yang menggantikan kartu "Model" lama.
- **Langkah 3 · Peta job family** = jumlah job family pada peta terakhir beserta tanggal pembangunannya, atau "— belum dibangun". Saat sudah ada peta, di bawah tombolnya muncul tautan "Hasil kurang pas? Ubah pengelompokannya" menuju halaman Pengaturan Job Family — tautan ini menggantikan kotak merah muda yang dulu berdiri paling atas.
- Catatan penting: angka langkah 1 dan 2 adalah porsi unit yang aktif, sedangkan transformasi dan pembangunan peta selalu bekerja atas seluruh dokumen semua unit.

### Peta Job Family — kartu utama (status proses)

Kartu inti halaman. Isinya berubah menurut keadaan proses terakhir yang terlihat oleh unit aktif: (a) ajakan menjalankan embedding bila belum pernah ada vektor; (b) petunjuk "belum ada dokumen ter-embed yang cukup"; (c) bilah progres saat proses berjalan; (d) kotak merah bila proses gagal; (e) seluruh hasil peta bila proses selesai. Yang ditampilkan selalu proses TERBARU yang boleh dilihat unit ini — yaitu proses milik unit ini sendiri atau proses global; proses milik unit lain tidak pernah tampil.

Angka & status pada panel ini:

- Bilah progres = tahap ke-berapa dari total tahap pipeline (reduksi dimensi, klasterisasi, proyeksi 2D, penyusunan kata kunci, perangkuman judul, penyimpanan). Nama fase dan pesannya dikirim langsung oleh mesin pengolah.
- "… dokumen" pada baris fase = jumlah dokumen yang ikut diproses pada run tersebut (lingkup global = seluruh korpus, bukan hanya milik unit aktif).
- Bila kotak merah tampil, isinya adalah pesan kegagalan apa adanya dari mesin pengolah (mis. layanan tidak dapat dihubungi, alamat layanan belum diatur, atau tidak ada dokumen ter-embed).

### Baris ringkasan hasil (chip hijau/biru/abu di atas peta)

Angka-angka tingkat proses (run) beserta model embedding dan waktu selesai.

Angka & status pada panel ini:

- "N job family" = jumlah kelompok nyata yang ditemukan pada proses tersebut, dihitung atas SELURUH korpus (semua unit), bukan hanya kelompok yang kartunya tampil di bawah.
- "N job profile" = jumlah dokumen yang diikutkan pada proses tersebut (juga lingkup seluruh korpus).
- "N incumbent" = jumlah karyawan yang tercocok ke job profile pada kelompok-kelompok yang TAMPIL, dan hanya karyawan dari business unit yang sedang aktif. 0 berarti pencocokan posisi ↔ job profile belum pernah disimpan untuk unit ini.
- "N outlier" = jumlah dokumen yang tidak masuk kelompok mana pun (kelompok khusus bernomor -1) yang terlihat oleh unit ini. Chip ini hilang bila 0.
- Chip terakhir = nama model embedding dan tanggal-jam selesainya proses.
- Wajar bila "N job family" lebih besar daripada jumlah kartu kelompok di bawahnya: kelompok yang tidak memuat satu pun dokumen milik unit aktif sengaja tidak ditampilkan agar tidak terbaca sebagai kelompok kosong.

### Peringatan outlier (banner kuning di dalam hasil)

Muncul otomatis bila tidak ada kelompok terbentuk sama sekali, atau bila 60% dokumen atau lebih jatuh ke kelompok outlier. Berisi saran menurunkan parameter ukuran klaster minimum di halaman Konfigurasi lalu membangun ulang.

Angka & status pada panel ini:

- "X/Y dokumen masuk ke bucket noise" = jumlah dokumen outlier dibanding total dokumen pada proses tersebut. Penyebab umum: jumlah dokumen terlalu sedikit, atau ukuran klaster minimum diatur terlalu tinggi.

### Ekspor Hasil (tombol di baris ringkasan)

Menyimpan hasil pemetaan yang sedang tampil ke berkas. Isinya diambil dari hasil di layar, bukan dari kueri baru — jadi berkas tidak akan pernah berbeda dari peta yang Anda lihat, dan ekspor tidak menambah beban basis data.

Dialognya menawarkan tiga pilihan yang perlu dibedakan menurut siapa yang akan membacanya:

- **Excel (.xlsx)** — untuk diolah sendiri. Enam sheet: *Ringkasan Proses* (metadata proses: jumlah family, dokumen, incumbent, model embedding, ID proses), *Job Family* (satu baris per kelompok: porsi korpus, jumlah profil & incumbent, divisi terbanyak, deskripsi, kata kunci), *Job Profile* (satu baris per dokumen — inilah tingkat paling rinci), *Incumbent* (satu baris per orang, lengkap dengan dasar pencocokannya), *Outlier*, dan *Sebaran Divisi* (tabel silang family × divisi).
- **Laporan cetak (HTML / PDF)** — untuk dibagikan. Terbuka di tab baru dan langsung menawarkan dialog cetak; pilih "Simpan sebagai PDF" untuk menyimpannya. Berisi ringkasan proses, grafik batang sebaran job profile per family, lalu satu halaman per job family berisi kata kunci, daftar anggota, dan nama incumbent-nya — ditutup dengan glosarium yang menjelaskan setiap angka pada laporan itu.
- **CSV datar** — satu tabel pada tingkat job profile, untuk pivot cepat atau impor ke alat lain. Berkas memakai penanda UTF-8 supaya nama dengan karakter khusus tidak rusak saat dibuka di Excel.

Pilihan lain pada dialog:

- **Cakupan** = seluruh job family, atau satu family saja. Pada ekspor satu family, sheet *Sebaran Divisi* dan bagian outlier tidak ikut — keduanya hanya bermakna bila dibandingkan antar kelompok.
- **Isi yang disertakan** = lima sakelar: Incumbent (nama orang + sheet tersendiri), Alasan penempatan (keanggotaan, kedekatan ke pusat family, family alternatif), Kata kunci family, Outlier, dan Ringkasan job profile (tujuan jabatan, tanggung jawab, kompetensi teknis — ini yang paling memperbesar berkas).
- Baris "Akan diekspor" di bawah dialog menghitung ulang isi berkas setiap kali pilihan diubah, jadi jumlah family, job profile, incumbent, dan outlier sudah terlihat sebelum tombol ditekan.

Angka & status pada panel ini:

- "Porsi korpus" pada sheet dan laporan = bagian dokumen yang jatuh ke family tersebut dari seluruh dokumen yang terpetakan pada cakupan ekspor.
- Warna titik pada laporan cetak sama persis dengan warna family di peta, supaya keduanya bisa dibaca berdampingan.
- Tombol nonaktif bila proses belum menghasilkan satu job family pun.
- Laporan cetak dibuka lewat jendela baru — bila browser memblokir pop-up, izinkan pop-up untuk situs ini lalu ulangi.

### Proyeksi 2D (UMAP) — peta sebar

Setiap titik = satu dokumen job profile milik unit aktif, diletakkan menurut kemiripan isinya (dokumen mirip berdekatan). Warna = job family; abu-abu = outlier. Teks berwarna di tengah kerumunan = nama singkat family (empat kata kunci pertama). Peta dapat digeser, di-zoom, dan disorot per family.

Angka & status pada panel ini:

- Ukuran titik sebanding dengan jumlah incumbent pada job profile tersebut; titik terkecil berarti belum ada karyawan tercocok.
- Pada mode penunjuk, kotak kecil di pojok kiri bawah menampilkan: nama jabatan, divisi/departemen, nama job family, jumlah incumbent, dan "Keanggotaan %".
- "Keanggotaan %" = seberapa kuat dokumen itu memang milik kelompoknya menurut hasil klasterisasi (100% = sangat khas; nilai rendah = berada di pinggir kelompok). Kosong bila proses tidak menghitung probabilitas.
- Jarak antar titik bersifat relatif — hanya bermakna untuk membandingkan "lebih dekat/lebih jauh", bukan satuan baku.

### Bandingkan 2 Profil Jabatan (panel selebar halaman, di bawah peta dan legenda)

Alat bantu untuk mengukur seberapa dekat dua jabatan menurut isi job profile-nya: pilih dua profil dari daftar yang bisa dicari, lalu tekan Hitung. Hasilnya juga digambarkan sebagai garis putus-putus antara dua titik di peta.

Yang membedakannya dari sekadar angka kemiripan: nilai kemiripan mentah antar dokumen job profile selalu jatuh di rentang yang sempit (kebanyakan pasangan berada di kisaran 60–90%), sehingga angka 82% sendirian nyaris tidak berarti. Karena itu panel ini membaca kemiripan **relatif terhadap seluruh dokumen di peta** — bukan terhadap ambang tetap.

Angka & status pada panel ini:

- Kalimat kesimpulan di kotak berwarna = "lebih dekat daripada N% dokumen lain di peta", yaitu berapa persen dokumen lain yang jaraknya LEBIH JAUH daripada pasangan ini. Inilah angka utama yang dibaca; batangnya menggambarkan angka yang sama. Warnanya: 95% ke atas "Sangat berdekatan" (hijau), 80–95% "Berdekatan" (hijau muda), 50–80% "Kedekatan sedang" (kuning), di bawah 50% "Berjauhan" (merah). Ditambah keterangan apakah kedua jabatan masuk satu job family atau tidak.
- "Kedekatan dokumen" = kemiripan isi kedua dokumen secara menyeluruh dalam persen (100% = praktis identik). Baris kecil di bawahnya menyebut median kedekatan profil 1 ke seluruh dokumen lain — pembanding untuk menilai apakah angka di atasnya tergolong tinggi.
- "Peringkat kedekatan" = urutan profil 2 di antara seluruh dokumen lain bila diurutkan dari yang paling mirip dengan profil 1 (#1 = tidak ada yang lebih dekat). Baris kecilnya menyebut peringkat arah sebaliknya, yang bisa berbeda: A boleh jadi tetangga terdekat B tanpa B menjadi tetangga terdekat A.
- "Jarak di peta" = jarak kedua titik pada gambar peta; makin kecil makin berdekatan. Baris kecilnya menyatakan jarak itu sebagai persen dari rentang peta. Angka yang sama juga muncul di lingkaran di tengah garis penghubung.
- "Kompetensi beririsan" = jumlah kompetensi teknis yang dituntut oleh KEDUA job profile, dibanding gabungan kompetensi keduanya. Perbandingan mengabaikan beda huruf besar/kecil dan tanda baca. Kosong berarti kompetensi teknis belum terekstrak dari dokumennya.
- Dua kartu profil = identitas masing-masing jabatan: divisi/departemen, job family beserta kekuatan keanggotaannya, jumlah dan nama incumbent, tujuan jabatan, serta daftar "Profil lain terdekat" — empat dokumen paling mirip selain pembandingnya. Daftar inilah yang memperlihatkan apakah pembanding yang dipilih memang termasuk dekat atau justru kalah oleh jabatan lain.
- "Kompetensi teknis pada job profile" dipecah tiga: dituntut keduanya, hanya profil 1, hanya profil 2 — ini bacaan paling langsung untuk menilai kesiapan perpindahan antar jabatan.
- "Kosakata job family" = kata kunci yang dimiliki bersama oleh kedua job family, dan kata kunci yang khas milik masing-masing. Bila keduanya berada di satu family, kosakatanya memang identik dan hal itu dinyatakan.
- Tombol Hitung nonaktif bila kedua pilihan menunjuk profil yang sama.
- Bila hasil tidak muncul sama sekali, salah satu profil tidak termasuk dalam proses pemetaan yang sedang ditampilkan.
- "Peringkat kedekatan" dan kalimat persentase kosong bila vektor salah satu profil tidak ditemukan; "Jarak di peta" kosong bila salah satu titik tidak punya koordinat.

### Daftar Job Family (legenda di kanan peta)

Daftar semua job family yang tampil, dengan warna yang sama seperti di peta. Mengklik satu baris menyorot kelompok itu di peta. Baris terakhir yang redup adalah kelompok outlier.

Angka & status pada panel ini:

- Nama utama pada legenda = judul umum hasil perangkuman kecerdasan buatan; label kata kunci (empat kata kunci teratas) tampil sebagai baris kecil di bawahnya. Bila perangkuman tidak tersedia, hanya label kata kunci yang tampil.
- Angka abu-abu = jumlah job profile milik unit aktif di kelompok itu.
- Angka biru dengan ikon orang = jumlah incumbent pada kelompok itu (hanya karyawan unit aktif).

### Kartu job family (grid kartu di bawah peta)

Satu kartu per job family: judul umum hasil perangkuman, label kata kunci sebagai baris kecil di bawahnya, jumlah profil dan incumbent, deskripsi singkat, tiga divisi terbanyak, dan sampai delapan kata kunci.

Angka & status pada panel ini:

- Judul besar = judul umum hasil perangkuman kecerdasan buatan atas kelompok itu. Bila perangkuman tidak tersedia, judul otomatis berisi rangkaian kata kunci teratas dan deskripsi tidak muncul.
- "N profil" = jumlah dokumen job profile milik unit aktif di kelompok ini (bukan ukuran kelompok se-korpus).
- "N incumbent" = jumlah karyawan unit aktif yang menduduki jabatan-jabatan tersebut.
- Chip divisi "Nama · N" = jumlah job profile dari divisi/departemen itu di dalam kelompok, maksimal tiga teratas di kartu (empat di dialog detail).
- Kata kunci berasal dari perhitungan kata paling khas kelompok ini dibanding kelompok lain; skornya terlihat saat kursor diarahkan.

### Dialog "Lihat detail & incumbent" per job family

Jendela detail berisi: batang skor 10 kata kunci teratas, satu contoh potongan uraian jabatan, dan daftar seluruh anggota job profile beserta incumbent-nya lengkap dengan kotak pencarian dan filter.

Angka & status pada panel ini:

- Panjang batang kata kunci relatif terhadap kata kunci tertinggi; angka di kanan adalah skor kekhasan kata tersebut.
- Persentase di kanan tiap baris anggota = probabilitas keanggotaan dokumen itu pada kelompoknya.
- "X dari Y anggota" = jumlah baris yang lolos pencarian/filter dibanding total anggota kelompok.
- Tulisan "Tidak ada incumbent tercocok" berarti belum ada karyawan unit aktif yang dipasangkan ke job profile tersebut pada hasil pencocokan posisi ↔ job profile.
- Chip nama karyawan menampilkan nama unit; saat kursor diarahkan terlihat jabatan, unit, cara pencocokan (kode berkas / judul sama / kemiripan), dan persentase kemiripan bila pencocokan memakai kemiripan.

### Outlier / belum terkelompok (panel bergaris putus-putus)

Daftar job profile yang tidak masuk kelompok mana pun. Dapat dicari dan difilter sama seperti daftar anggota kelompok. Tiap baris memiliki ikon dokumen yang membuka satu pop up gabungan: bagian informasi (kedekatan cluster terdekat, ringkasan jabatan, incumbent) DAN bagian "Petakan ke cluster" untuk pemetaan manual — seluruh cluster diurutkan dari yang paling dekat, masing-masing dengan ikon sasaran (menyorot garis outlier→cluster di peta) dan ikon plus (menetapkan keanggotaan manual). Baris juga memiliki ikon sasaran sendiri untuk menyorot posisinya di peta. Panel ini hanya tampil bila ada dokumen outlier milik unit aktif.

Angka & status pada panel ini:

- Angka pada judul = jumlah dokumen outlier yang terlihat oleh unit aktif.
- Dokumen outlier tidak memiliki nilai "kedekatan ke pusat family", dan kolom alasannya kosong — ini normal, karena memang tidak diakui sebagai anggota kelompok mana pun. Sebagai gantinya, tiap baris mencantumkan keterangan "Terdekat: NAMA CLUSTER · kedekatan N%" = cluster nyata terdekat menurut kedekatan embedding dokumen itu, dengan nama memakai judul umum hasil perangkuman AI (bukan kata kunci mentah; perhitungan dari layanan pemetaan, kosong pada hasil proses versi lama).
- Saat sebuah outlier disorot ke peta, garis putus-putus kuning menghubungkan titiknya ke pusat cluster terdekat (atau cluster yang dipilih di bagian "Petakan ke cluster"); angka di tengah garis = jarak UMAP 2D, dan keterangan di bawah peta memuat label cluster tujuan, persentase kedekatan embedding, serta jarak UMAP-nya.
- Pemetaan manual (ikon plus di bagian "Petakan ke cluster") memindahkan dokumen ke cluster pilihan pada proses yang sedang ditampilkan; membangun ulang peta mengembalikan jawaban asli algoritma. Pemetaan tidak mengubah dokumen sumber.
- Outlier banyak biasanya berarti dokumen terlalu sedikit atau ukuran klaster minimum terlalu tinggi, bukan berarti jabatannya aneh.

### Hierarki Job Family (pohon rumpun, terbuka secara default)

Pohon bertingkat: daun = satu job family, kartu bergaris putus-putus = rumpun gabungan (sub-family) yang membawahi beberapa job family. Struktur induk-anak dibentuk oleh penggabungan bertahap: dua kelompok yang profil kata kuncinya paling mirip digabung lebih dulu menjadi satu simpul induk, lalu induk-induk itu digabung lagi ke atas sampai terbentuk satu akar. Jadi sebuah family menjadi anak dari rumpun tertentu karena kosakata/isi dokumennya paling dekat dengan saudara yang digabung bersamanya pada langkah itu — bukan karena struktur organisasi. Judul dan deskripsi rumpun dihasilkan dari bawah ke atas: tiap daun dirangkum dulu dari kata kuncinya, tiga jabatan paling mewakili, dan cuplikan uraian; lalu tiap rumpun dirangkum dari gabungan kata kunci seluruh anak (ditimbang besar kelompok), jabatan perwakilan, DAN judul/deskripsi anak-anaknya yang sudah jadi — sehingga judul rumpun selalu lebih umum daripada anaknya. Jika perangkuman kecerdasan buatan tidak tersedia, judul otomatis berisi rangkaian kata kunci dan deskripsi kosong. Kelompok outlier tidak pernah masuk pohon.

Angka & status pada panel ini:

- Pada kartu rumpun: "(N job family · M profil)" = jumlah job family di bawahnya dan total job profile milik unit aktif di seluruh cabang itu.
- Pada daun: "· N profil" = jumlah job profile milik unit aktif pada family itu; angka biru dengan ikon orang = total incumbent di cabang tersebut.
- Daun yang tampil TANPA jumlah profil dan tanpa titik berwarna berarti family itu tidak memiliki satu pun dokumen milik unit aktif — namanya tetap muncul karena strukturnya berasal dari perhitungan atas seluruh korpus.
- Klik judul sub-family (kartu bergaris putus) untuk membuka/menutup anak-anaknya di hirarki; dua tingkat teratas terbuka sejak awal. Klik judul daun untuk menampilkan profil anggotanya.
- Deskripsi dipotong dua baris saat simpul tertutup dan tampil penuh saat dibuka; kata kunci ditampilkan 4 saat tertutup dan sampai 12 saat dibuka, dengan penanda "+n".
- Bila keseluruhan bagian hierarki tidak muncul: proses hanya menemukan kurang dari dua job family, atau penyusunan hierarki gagal, atau hasilnya berasal dari proses lama sebelum fitur ini ada.

### Detail anggota di dalam pohon hierarki (buka daun → buka baris jabatan)

Kartu penjelasan per job profile: alasan masuk family, jalur hirarki, ringkasan profil jabatan, dan daftar incumbent.

Angka & status pada panel ini:

- "Alasan masuk family" berisi kata kunci milik family yang benar-benar ditemukan di dokumen jabatan ini (maksimal 6). Kosong bila dokumen memakai istilah lain, bila jabatan itu outlier, atau bila hasil berasal dari proses lama sebelum penjelasan ini disimpan.
- "Kedekatan ke pusat family" dalam persen = kemiripan dokumen ini terhadap rata-rata seluruh anggota family. Makin tinggi makin khas; nilai rendah berarti jabatan ini berada di pinggir rumpun.
- "Family alternatif (…%)" = rumpun lain yang paling dekat dengan jabatan ini. Bila persentasenya hampir sama dengan kedekatan ke family sendiri, jabatan itu memang berada di perbatasan dua rumpun.
- "Jalur hirarki" = rantai nama rumpun dari atas ke bawah sampai family jabatan ini — inilah pembacaan resmi "jabatan ini masuk rumpun apa".
- "Ringkasan profil" diambil dari dokumen job profile: tujuan jabatan, sampai 5 tanggung jawab, dan sampai 8 kompetensi teknis. Bila tujuan jabatan kosong, ditampilkan cuplikan awal dokumen sebagai gantinya.

### Kalau angkanya kosong, nol, atau "tanpa" — sebab & cara mengatasi

- "Ter-embed 0 padahal jumlah Job Profile banyak." Dokumen sudah diekstrak tetapi belum pernah diubah menjadi vektor. Jalankan sinkronisasi embedding (ikon panah melingkar di kartu Ter-embed, atau tombol pada kotak kuning). Bila banner pgvector tampil, penyimpanan vektor belum aktif — mintalah tim IT mengaktifkannya lebih dulu.
- "Job Profile 0 padahal unit kami punya banyak dokumen." Kepemilikan dokumen ditentukan oleh pemetaan tenant langsung pada tiap dokumen (halaman Job Profiles). Bila dokumen unit Anda belum dipetakan ke tenant, dokumennya tidak dihitung sebagai milik unit Anda (dokumen yang belum dipetakan sengaja terlihat oleh semua unit).
- "Tombol Bangun Peta Job Family tidak bisa ditekan." Tiga sebab: dokumen ter-embed kurang dari 2, sedang ada proses berjalan, atau Anda tidak punya izin kelola (ikon sinkronisasi embedding juga tidak muncul bila izin kelola tidak dimiliki).
- "Muncul pesan proses gagal / layanan tidak dapat dihubungi." Layanan pengolah pengelompokan sedang mati atau alamatnya belum diatur. Pesan lengkapnya tampil di kotak merah. Setelah layanan hidup, tekan Bangun Ulang Peta.
- "Peta yang kemarin bagus hilang, sekarang malah kotak merah gagal." Halaman selalu menampilkan proses TERBARU yang boleh dilihat, termasuk bila yang terbaru gagal. Hasil lama tidak terhapus, hanya tidak ditampilkan — jalankan pembangunan ulang yang berhasil untuk menampilkan peta lagi.
- "Ringkasan menyebut 20 job family, tapi kartu yang tampil hanya 8." Angka pada ringkasan dihitung atas seluruh dokumen semua business unit, sedangkan kartu hanya menampilkan job family yang memuat minimal satu dokumen milik unit Anda. Kelompok tanpa dokumen milik unit Anda sengaja disembunyikan agar tidak terbaca sebagai kelompok kosong.
- "Sebagian besar dokumen jadi outlier / tidak ada job family terbentuk." Dataset terlalu kecil atau ukuran klaster minimum terlalu tinggi. Buka tombol Pengaturan Job Family di atas peta, turunkan ukuran klaster minimum (misal ke 2–3), lalu bangun ulang peta.
- "Judul job family cuma deretan kata seperti 'audit, laporan, keuangan' dan deskripsinya kosong." Judul & deskripsi umum dihasilkan oleh layanan perangkuman kecerdasan buatan. Bila kuncinya belum dikonfigurasi, panggilannya gagal, atau jumlah simpul melebihi 300, sistem otomatis memakai empat kata kunci teratas sebagai judul dan mengosongkan deskripsi. Perbaikannya di sisi konfigurasi layanan, lalu bangun ulang peta.
- "Angka incumbent 0 di seluruh peta / semua jabatan bertuliskan 'Tidak ada incumbent tercocok'." Nama karyawan berasal dari hasil pencocokan Posisi ↔ Job Profile yang harus dijalankan dan DISIMPAN lebih dulu di menu Dokumen (seksi Job Profile Match). Selain itu, karyawan yang ditampilkan hanya milik business unit yang sedang aktif — jika pemegang jabatan berada di unit lain, ia tidak akan muncul di sini.
- "Satu jabatan tidak punya incumbent padahal ada pejabatnya." Pencocokan memakai tiga cara: kode pada nama berkas dokumen, judul jabatan yang sama persis, dan kemiripan isi di atas 98%. Jika penulisan judul jabatan berbeda dan tidak ada kode berkas yang cocok, pasangannya tidak terbentuk. Perbaiki penamaan/kode dokumen atau periksa diagnosis ketidakcocokan di menu Dokumen.
- "Kolom 'Alasan masuk family' kosong." Tiga kemungkinan: jabatan itu memang outlier (tidak diakui anggota kelompok mana pun), dokumennya memakai istilah berbeda dari kata kunci kelompok, atau hasil berasal dari proses lama yang dibuat sebelum fitur penjelasan ini ada. Bangun ulang peta agar penjelasannya ikut dihitung.
- "Kedekatan ke pusat family rendah / family alternatif persentasenya hampir sama." Ini bukan kesalahan sistem: jabatan tersebut memang berada di perbatasan dua rumpun. Gunakan alat Bandingkan 2 Profil Jabatan untuk memeriksanya, dan pertimbangkan memperbaiki uraian job profile-nya agar lebih khas.
- "Bagian Hierarki Job Family tidak muncul." Pohon hanya dibuat bila ada minimal dua job family; ia juga kosong bila penyusunan hierarki gagal atau hasilnya berasal dari proses versi lama. Bangun ulang peta setelah jumlah kelompok cukup.
- "Ada job family yang saya lihat di legenda tapi tidak ada di pohon hierarki." Kelompok outlier memang tidak pernah masuk pohon, dan bila hasil penyusunan menghasilkan lebih dari satu akar, yang digambar hanya akar terbesar. Selain itu, nama simpul yang tampil tanpa jumlah profil berarti family itu tidak memiliki dokumen milik unit Anda.
- "Kenapa jabatan ini masuk rumpun itu, bukan rumpun lain?" Bacalah dari kartu penjelasan anggota: kata kunci yang cocok menunjukkan istilah bersama, 'kedekatan ke pusat family' menunjukkan seberapa khas dokumen itu di kelompoknya, dan 'jalur hirarki' menunjukkan rantai rumpunnya. Penggabungan ke rumpun yang lebih besar murni berdasarkan kemiripan kosakata/isi dokumen antar kelompok, bukan struktur organisasi — jadi jabatan dari divisi berbeda bisa berada dalam satu rumpun.
- "Angka pada kartu berbeda dengan angka di legenda atau di ringkasan." Kartu dan legenda memakai jumlah yang TERLIHAT oleh unit aktif (profil milik unit Anda dan karyawan unit Anda), sedangkan ringkasan memakai angka tingkat proses atas seluruh korpus. Perbedaan ini disengaja.
- "Tombol Hitung tidak memunculkan hasil." Salah satu jabatan yang dipilih tidak termasuk dalam hasil proses yang sedang ditampilkan, atau vektornya tidak tersedia. Pastikan kedua jabatan berasal dari daftar pilihan pada halaman ini, dan jalankan sinkronisasi embedding bila dokumennya baru.
- "Peta berubah setelah saya berpindah business unit." Halaman menampilkan proses terbaru yang boleh dilihat unit tersebut: proses khusus unit itu atau proses global. Isi peta juga dipersempit ke dokumen milik unit yang aktif, sehingga kelompok, jumlah profil, dan incumbent yang tampil ikut berubah.
- "Proses ditolak dengan pesan bahwa ada proses lain sedang berjalan." Mesin pengolah hanya menjalankan satu pembangunan peta pada satu waktu. Tunggu hingga proses berjalan selesai (bilah progres akan tampil sendiri) lalu ulangi.

---

## Position Management (/positions) dan Kandidat (/candidates + detail /candidates/[id])

Dua halaman ini menyiapkan "bahan baku" sebelum penilaian suksesi dijalankan.

Position Management (/positions): daftar jabatan yang dianggap kritikal dan perlu disiapkan penggantinya. Di sini HR mendaftarkan posisi beserta PROGRAM suksesinya, pejabat yang akan digantikan (incumbent), rentang level karyawan yang boleh jadi suksesor, serta kualifikasi dan kompetensi teknis yang dituntut jabatan itu (umumnya terisi otomatis dari dokumen Job Profile). Halaman ini juga meringkas hasil penilaian terakhir tiap posisi: berapa kandidat dinilai, berapa yang siap, siapa peringkat 1, dan siapa suksesor yang sudah dipilih.

Program yang dapat dipilih di sini adalah program suksesi untuk sebuah jabatan — Talent Pool TIDAK termasuk. Talent Pool menyaring kandidat se-business unit dan punya menunya sendiri, bukan program untuk mengisi sebuah kursi; karena itu ia juga tidak lagi muncul di Tata Kelola → Program Penilaian, dan aturan filternya diubah langsung di halaman Talent Pool.

Selain menambah satu per satu, tombol "Tambah massal" mendaftarkan SEKALIGUS semua jabatan aktif yang pemangkunya berada pada level tertentu ke atas (bawaan: Manager ke atas). Pilihan dan tampilannya memakai NAMA LEVEL (Supervisor, Manager, General Manager, Director), bukan kode grade — kode grade hanya muncul sebagai keterangan saat kursor diarahkan ke lencana. Batas grade dinilai dari GRADE PEMANGKU JABATAN, bukan grade jabatan — data grade pada master jabatan hasil sinkronisasi hampir seluruhnya kosong, sedangkan grade karyawan terisi. Jabatan yang dipegang beberapa orang dinilai dari pemangku dengan grade tertinggi, dan seluruh pemangkunya ikut tercatat. Rentang level suksesor diisi otomatis MENGIKUTI PROGRAM: program Critical Position memakai satu LEVEL di bawah pemangku jabatan (kaderisasi — mis. pemangku MANAGER grade 7 → suksesor SUPERVISOR grade 5–6), sedangkan program Emergency Position memakai level yang sama dengan pemangku sampai satu level di atasnya (orang yang siap menggantikan sekarang — mis. pemangku MANAGER grade 7 → MANAGER sampai GENERAL MANAGER, grade 7–12). Yang dimaksud "satu level" adalah satu TINGKAT JABATAN (STAFF → SUPERVISOR → MANAGER → GENERAL MANAGER → DIRECTOR), bukan satu angka grade, karena satu tingkat biasanya mencakup beberapa grade. Rentang yang akan dipakai tampil pada tiap baris di pratinjau sebelum disimpan; kualifikasi & kompetensi diambil dari job profile yang cocok bila ada. Jabatan yang sudah terdaftar pada program tersebut dilewati, jadi tombol ini aman dijalankan berulang. Sebelum dijalankan, dialog MEMBERITAHU berapa jabatan yang belum punya job profile beserta nama-namanya: scoring tetap bisa berjalan untuk jabatan itu, tetapi aspek Kompetensi Teknis dan Relevansi Karier akan memakai kompetensi pemangku jabatan sebagai pengganti tuntutan jabatan — hasilnya sah namun tidak sebanding dengan posisi yang punya JD. Ada kotak centang untuk memilih: tetap di-scoring, atau posisinya dibuat dulu dan scoring-nya ditunda sampai JD-nya dipasangkan di tab Job Profile Match. Bila pilihan "Jalankan scoring AHP + TOPSIS otomatis" dicentang, setiap posisi baru langsung diantrikan untuk dinilai di latar belakang — halaman tidak perlu dibiarkan terbuka, dan layanan scoring mengerjakannya bergiliran (beberapa run sekaligus, sisanya menunggu) supaya tidak membebani server.

Tombol "Scoring Ulang" menjalankan ulang penilaian AHP + TOPSIS untuk SELURUH posisi pada satu program sekaligus — dipakai ketika data kandidat sudah berubah (periode PA baru, hasil MCU, promosi, job profile yang baru dipasangkan) sehingga peringkat lama tidak lagi mencerminkan keadaan. Setiap posisi mendapat run BARU; hasil lama TIDAK dihapus dan tetap dapat dibuka dari riwayat run posisi tersebut. Posisi yang sedang di-scoring dilewati agar tidak ada dua run berjalan pada posisi yang sama, dan posisi tanpa job profile diberi peringatan yang sama seperti pada Tambah Batch.

Fitur "Reset Scoring" (saat ini SENGAJA DISEMBUNYIKAN dari layar) MENGHAPUS PERMANEN seluruh riwayat penilaian pada satu program — semua run, sesi, hasil peringkat, catatan pengecualian, dan percakapan analisisnya. Dipakai saat program berisi run percobaan yang dibuat ketika aturan filter, bobot, atau pemetaan job profile masih disetel, sehingga angkanya tidak layak dibaca sebagai penilaian. Posisi, kandidat, rentang level, dan pemangku jabatan TIDAK ikut terhapus — yang hilang hanya hasil penilaiannya. Suksesor terpilih dipertahankan secara bawaan (itu keputusan manusia, bukan hasil penilaian) dan hanya ikut terhapus bila kotak centangnya dipilih. Dialog menampilkan lebih dulu berapa run, sesi, dan baris hasil yang akan hilang, dan tombolnya baru aktif setelah nama program diketik ulang persis. Tidak ada pembatalan.

Satu posisi berlaku untuk SATU program. Jabatan yang sama ingin dinilai pada program lain (mis. sudah terdaftar di Successor, lalu ingin dinilai juga untuk Talent Pool) harus DITAMBAHKAN SEKALI LAGI dengan program tersebut — hasilnya dua baris posisi terpisah, masing-masing dengan bench, aturan filter, dan riwayat run sendiri. Program hanya bisa diubah selama posisi belum pernah di-scoring; setelah ada run, pilihan program terkunci karena run tersebut adalah catatan penilaian menurut aturan program itu. Lencana program tampil pada tiap baris/kartu posisi, dan tombol program di atas daftar menyaring posisi menurut programnya. Tiap baris/kartu posisi juga menandai tiga keadaan yang biasanya baru ketahuan setelah dibuka satu per satu: (1) lencana kuning "Tanpa job profile" bila belum ada JD terpetakan; (2) lencana kuning "Belum ada suksesor dipilih" bila posisi SUDAH pernah di-scoring tetapi belum ada suksesor yang ditetapkan; dan (3) lencana merah "Pensiun" bila ada pejabat yang usianya sudah mencapai ambang pensiun levelnya — nama pejabatnya disebut langsung (bila lebih dari satu, jumlahnya disebut dan namanya muncul saat kursor diarahkan). Ambang bawaannya 50 tahun untuk Staff/Supervisor/Manager dan 55 tahun untuk General Manager ke atas, dan dapat diubah per level di Tata Kelola → Readiness. Pejabat yang tanggal lahirnya belum tersinkron tidak pernah ditandai. Kolom "Top Candidate" kini diganti RTC (Replacement Table Chart) yang menampilkan JUMLAH suksesor yang sudah dipilih — peringkat teratas hanyalah keluaran run terakhir, sedangkan bench baru nyata setelah ada yang ditetapkan. Ringkasan jumlah ketiga keadaan itu tampil di atas daftar — scoring posisi tersebut tetap bisa berjalan, tetapi aspek Kompetensi Teknis dan Relevansi Karier dihitung dari kompetensi pemangku jabatan, bukan dari tuntutan JD. Perbaikannya ada di halaman Job Profile, tab Job Profile Match.

Kandidat (/candidates): daftar karyawan di business unit yang aktif — kolam calon suksesor. Sebagian besar datanya berasal dari sinkronisasi HR (NPK, usia, masa kerja, grade/level, riwayat jabatan, kompetensi teknis) dan bisa dilengkapi/dikoreksi manual (pendidikan, HAV, MCU, disiplin, nilai PA, rekomendasi behavior). Usia DIHITUNG dari tanggal lahir hasil sinkronisasi (modul Data Pribadi), bukan disimpan sebagai angka — jadi selalu benar tanpa perlu diperbarui, dan tampil '—' selama tanggal lahir karyawan tersebut belum tersinkron. Secara bawaan data kandidat DISAMARKAN — hanya nama, posisi, dan departemen yang terlihat sampai pengguna menekan "Tampilkan data".

Detail Kandidat (/candidates/[id]): profil satu orang — identitas, metrik kelayakan, grafik kompetensi teknis (current vs target), grafik nilai PA 3 tahun, riwayat jabatan, dan riwayat semua penilaian (run) yang pernah menyertakan orang tersebut.

Semua data pada kedua halaman terikat business unit yang sedang aktif. Pindah business unit berarti melihat daftar yang berbeda. Halaman Posisi butuh izin "Lihat posisi", halaman Kandidat butuh izin "Lihat kandidat"; tanpa izin itu pengguna dilempar ke beranda.

### Posisi — Kartu "Total posisi"

Jumlah posisi yang cocok dengan filter yang sedang aktif (pencarian, divisi, departemen, program, dan filter kiriman dari beranda) di business unit aktif — bukan selalu jumlah seluruh posisi.

Angka & status pada panel ini:

- Angka besar = jumlah baris hasil filter. Kosongkan semua filter untuk melihat total sebenarnya.
- 0 berarti belum ada posisi didaftarkan, atau filter terlalu sempit (perhatikan chip 'Filter dari beranda' yang mungkin masih aktif).
- Keterangan bantuannya menyebut semua posisi otomatis berstatus aktif — memang tidak ada status non-aktif yang bisa dipilih pengguna.

### Posisi — Kartu "Kesiapan suksesor"

Membagi posisi ke tiga keadaan yang saling lepas dan jumlahnya pas sama dengan total posisi yang cocok dengan pencarian/departemen/divisi/program saat ini. Menggantikan kartu "Coverage readiness" yang lama.

Tiga keadaannya:

- **Sudah ada kandidat siap** — run terakhir posisi itu punya minimal 1 kandidat Short atau Medium.
- **Dinilai, belum ada yang siap** — sudah punya run selesai, tapi semua kandidatnya Long atau Not Ready. Perlu pengembangan orang.
- **Belum pernah dinilai** — belum punya satu pun run selesai. Perlu dijalankan penilaiannya, bukan dikembangkan orangnya.

Angka & status pada panel ini:

- Dihitung SERVER-SIDE atas seluruh posisi yang cocok dengan filter, bukan hanya 20 baris di halaman aktif — jadi angkanya tidak berubah saat pindah halaman. Ini perbedaan pokok dengan kartu lama.
- Setiap kotak bisa diklik untuk menyaring daftar ke keadaan itu; klik lagi pada kotak yang sedang aktif untuk melepas filternya. Filternya tertulis di URL (`?bench=ready|not_ready|unscored`) sehingga tahan refresh dan bisa dikirim ke orang lain.
- Persentase di tiap kotak memakai penyebut jumlah tiga keadaan itu, bukan angka "Total posisi" di sebelahnya — saat sebuah kotak sedang aktif, Total posisi menunjukkan hasil penyaringan sementara kotaknya tetap menggambarkan keseluruhan.
- Kandidat dihitung 'siap' jika readiness-nya Short (skor >= 80) atau Medium (skor >= 65) menurut ambang readiness yang bisa diatur di Tata Kelola → Kesiapan & Pensiun.
- Run yang masih berjalan atau masih draf tidak dihitung, jadi posisi yang sedang discoring tetap masuk 'Belum pernah dinilai' sampai run-nya selesai.

### Posisi — Baris filter (Cari / Semua Divisi / Semua Departemen)

Pencarian bebas mencocokkan nama posisi, nama pejabat saat ini, departemen, dan divisi. Dua combobox menyaring persis berdasarkan daftar master divisi dan departemen hasil sinkronisasi.

Angka & status pada panel ini:

- Daftar divisi/departemen berasal dari data master sinkronisasi, bukan dari isi tabel posisi — bisa saja ada pilihan yang tidak memberi hasil apa pun.
- Pencarian dijalankan 0,3 detik setelah berhenti mengetik dan selalu mengembalikan tampilan ke halaman 1.

### Posisi — Tab "Programs"

Satu tombol per program yang punya template di business unit ini (mis. Talent Pool, Critical Position, Emergency Position). Menekan tab menyaring hasil run yang dipakai untuk kolom Readiness Pipeline dan Top Candidate.

Angka & status pada panel ini:

- Tab tidak muncul sama sekali kalau business unit belum punya template program.
- Menekan tab yang sudah aktif akan mematikannya (kembali ke semua program).
- Saat sebuah program dipilih, posisi yang belum pernah dinilai dengan program itu akan tampil sebagai 'Belum scoring' walau punya run program lain.

### Posisi — Chip "Filter dari beranda"

Muncul bila daftar sedang disaring oleh kartu "Kesiapan suksesor" di halaman ini, atau oleh kartu beranda (Ready now/soon atau Readiness Bands). Menjelaskan mengapa daftar jadi pendek, dan menyediakan jalan keluarnya.

Angka & status pada panel ini:

- Keadaan kesiapan yang aktif ditulis lengkap dengan aturannya, mis. 'Belum pernah dinilai · belum punya satu pun run yang selesai'.
- 'Strong bench' = coverage >= 80%, 'Watchlist' = 50–79%, 'Critical gap' = di bawah 50%.
- Tautan lama dari beranda (`?readiness=ready`) tetap berfungsi dan dibaca sebagai keadaan 'Sudah ada kandidat siap'.
- Urutan baris ikut disesuaikan: bench terkuat dulu untuk 'Sudah ada kandidat siap', dan coverage terburuk dulu untuk Critical gap serta dua keadaan bermasalah lainnya.

### Posisi — Tabel "Positions" (kolom Posisi & Holder)

Nama posisi (tautan ke halaman detail), departemen dan divisi, lencana status scoring, serta lencana 'Holder:' berisi nama pejabat saat ini yang tersimpan pada posisi tersebut.

Angka & status pada panel ini:

- 'Sudah scoring' = ada hasil run terakhir yang selesai. 'Sedang scoring...' = ada run berstatus berjalan dan belum ada hasil. 'Belum scoring' = belum ada run selesai (untuk program yang sedang difilter).
- Lencana Holder tidak muncul bila kolom nama pejabat pada posisi itu kosong.
- Angka di lencana samping judul kartu = jumlah baris di halaman ini, bukan total.

### Posisi — Baris "Hasil Run Terbaru"

Metode penilaian dan tanggal run terakhir yang selesai untuk posisi tersebut.

Angka & status pada panel ini:

- 'AHP + TOPSIS' = perhitungan deterministik berbobot, satu-satunya metode penilaian. Metode 'AI Tournament' (penilaian oleh AI) sudah dihapus beserta run-nya.
- 'Program —' berarti run dijalankan tanpa template program.
- 'belum ada run' berarti belum pernah ada penilaian yang selesai; run yang masih berjalan atau masih draf sengaja tidak dihitung sebagai run terbaru.

### Posisi — Kolom "Readiness Pipeline"

Ringkasan hasil run terakhir: berapa kandidat siap dari berapa kandidat yang dinilai, plus bar coverage.

Angka & status pada panel ini:

- 'X siap dari Y kandidat': Y = jumlah kandidat yang punya hasil pada run terakhir; X = yang readiness-nya Short atau Medium.
- Coverage % = X dibagi Y. Warna hijau >= 80%, kuning 50–79%, merah di bawah 50%.
- 0 dari 0 dan 0% berarti belum ada run selesai — bukan berarti semua kandidat gagal.

### Posisi — Kolom "Top Candidate"

Kandidat peringkat 1 pada run terakhir: nama, lencana readiness, skor akhir, dan jumlah kandidat yang ikut ditampilkan.

Angka & status pada panel ini:

- Skor ditampilkan dalam persen hasil pembulatan dari skor akhir run.
- Readiness: Short (0–1 tahun), Medium (1–2 tahun), Long (3–5 tahun), Not Ready (>5 tahun) — ambangnya bisa diubah di Tata Kelola.
- 'Rank #1 · N total kandidat': N maksimal 10, karena kartu ini hanya menyimpan 10 kandidat teratas untuk pratinjau.
- Kotak kuning 'Belum scoring' muncul bila belum ada run selesai; kotak biru muncul bila run sedang berjalan.

### Posisi — Tombol/dialog "Suksesor terpilih (n)"

Daftar kandidat yang sudah RESMI dipilih sebagai suksesor untuk posisi ini, dikelompokkan per program. Hanya muncul bila sudah ada pilihan yang disimpan dari halaman detail posisi.

Angka & status pada panel ini:

- Angka dalam kurung = jumlah pilihan yang tersimpan untuk semua program.
- Angka bulat di depan nama = urutan pilihan (mulai dari 1).
- Nama bisa tampil sebagai 'Kandidat' bila baris kandidatnya sudah tidak dapat ditemukan — keputusan pemilihannya tetap tercatat.
- Persentase = skor yang tersimpan saat pilihan dibuat, bukan skor terkini.

### Posisi — Dialog Tambah/Ubah bagian "Program suksesi"

Pilihan program penilaian untuk posisi ini, diambil dari daftar template program milik business unit aktif. Wajib diisi. Satu posisi hanya berlaku untuk satu program; untuk menilai jabatan yang sama pada program lain, tambahkan posisi tersebut sekali lagi dengan program berbeda.

Angka & status pada panel ini:

- Saat mengubah posisi yang SUDAH pernah di-scoring, pilihan berubah menjadi lencana bertanda 'terkunci' — program tidak dapat dipindah lagi.
- Bila posisi belum pernah di-scoring, program masih bebas diganti.
- Menyimpan posisi dengan kombinasi jabatan + pejabat + program yang sudah ada akan ditolak dengan pesan bahwa posisi itu sudah terdaftar pada program tersebut.

### Posisi — Dialog "Tambah posisi" bagian "Pencarian & Penentuan Jabatan Kritis"

Dua pencarian yang saling melengkapi: (1) cari karyawan, sistem menemukan jabatan aktifnya; (2) cari jabatan master, sistem menemukan pejabat aktifnya. Keduanya memakai relasi data kepegawaian, bukan tebakan kecocokan teks. Bagian ini hanya muncul saat menambah posisi baru, tidak saat mengubah.

Angka & status pada panel ini:

- Label jabatan pada pencarian nomor 2 menampilkan nama pejabatnya; '(belum ada pejabat)' berarti jabatan itu tidak punya pemangku aktif dan Nama pejabat akan tetap kosong.
- '(+n pejabat aktif lainnya)' berarti jabatan itu dipegang beberapa orang sekaligus; yang terisi adalah satu orang terpilih secara konsisten.
- Jabatan kembar (judul, departemen, divisi sama) digabung menjadi satu pilihan agar tidak membingungkan.

### Posisi — Dialog Tambah/Ubah bagian "Pejabat saat ini" dan "Detail posisi jabatan"

Daftar pejabat saat ini (bisa lebih dari satu), Nama posisi, Departemen, dan Divisi. Semua kolom ini terkunci (tidak bisa diketik manual) dan hanya terisi lewat dua pencarian di atasnya.

Satu jabatan bisa dipegang beberapa orang sekaligus (mis. SALESMAN, INSTRUCTOR, jabatan tingkat cabang). Sistem menampilkan SEMUA pejabat aktif jabatan tersebut sebagai daftar bercentang, seluruhnya tercentang secara bawaan. Setiap pejabat yang dicentang: (1) tercatat sebagai pejabat posisi ini, dan (2) dikeluarkan dari kolam kandidat posisi ini, sehingga tidak mungkin dinilai sebagai pengganti dirinya sendiri. Pejabat pertama yang tercentang ditandai "Utama" — itulah yang tampil sebagai Holder pada daftar posisi dan yang dipakai pencocokan job profile.

Angka & status pada panel ini:

- Kotak 'Informasi Tambahan Posisi' (grade/level, atasan langsung, jumlah bawahan, tujuan jabatan) hanya informasi pembanding — tidak ikut tersimpan.
- 'Jumlah Bawahan Langsung 0 orang' berarti struktur organisasi tidak mencatat bawahan aktif untuk jabatan itu.
- Tanda '-' pada Atasan Langsung berarti hierarki jabatan belum tersedia di data sinkronisasi.

### Posisi — Dialog Tambah/Ubah bagian "Kualifikasi & Kompetensi"

Pilihan Job Profile, lalu Pendidikan, Pengalaman, Job Family, Rentang Level Suksesor, dan daftar Kompetensi Teknis. Memilih Job Profile mengisi otomatis Pendidikan, Pengalaman, Job Family, kompetensi teknis, dan menyempurnakan Departemen/Divisi.

Angka & status pada panel ini:

- Rentang level dipilih dengan nama level (mis. Supervisor), tetapi yang disimpan adalah angka grade: batas bawah memakai grade terkecil level minimum, batas atas memakai grade terbesar level maksimum.
- Kandidat dengan grade di luar rentang itu otomatis tersaring saat penilaian (huruf di belakang grade diabaikan, mis. 5a dibaca 5).
- 'Pilih job profile untuk mengisi kompetensi' = belum ada job profile dipilih. 'Job profile ini tidak memiliki kompetensi teknis' = job profile-nya memang kosong.
- Lencana hijau kecil di samping nama kompetensi = level kemahiran yang dituntut jabatan.

### Kandidat — Baris filter dan tombol tampilan

Dua baris. Atas: pencarian (nama, NPK, posisi, departemen), tombol samar/tampil, dan pilihan tampilan kartu atau tabel. Bawah: filter Divisi, Departemen, Level, Status suksesor, dan pilihan urutan (Nama/Departemen).

Angka & status pada panel ini:

- **Status suksesor**: 'Sudah dipilih suksesor' hanya menampilkan kandidat yang pernah ditetapkan sebagai suksesor di posisi mana pun (data yang sama dengan tombol "Suksesor terpilih" di Manajemen Posisi); 'Belum dipilih' kebalikannya. Filter ini dihitung atas seluruh kandidat business unit ini, bukan hanya halaman yang tampil, dan tetap berlaku setelah menambah, mengubah, atau menghapus kandidat.

- Tampilan kartu memuat 8 orang per halaman, tampilan tabel 20 orang per halaman — jumlah 'Menampilkan x-y dari z' ikut berubah.
- Daftar pilihan Level hanya berisi level yang benar-benar dimiliki kandidat di business unit ini; kosong bila grade kandidat belum tersinkron.
- Filter Divisi/Departemen mencocokkan persis nilai pada data kandidat, bukan pencarian sebagian.

### Kandidat — Banner "Data kandidat disamarkan"

Peringatan bahwa mode penyamaran sedang aktif. Saat aktif, hanya nama, posisi, departemen (dan pada kartu: foto disembunyikan) yang terbaca.

Angka & status pada panel ini:

- Titik-titik (•••) BUKAN data kosong — itu nilai yang sengaja disembunyikan.
- Saat disamarkan, blok Riwayat Performance Appraisal, Riwayat Jabatan, dan Technical Competencies tidak ditampilkan sama sekali.
- Pilihan tampil/samar diingat selama tab browser masih terbuka, dan selalu kembali ke 'disamarkan' pada tab baru.

### Kandidat — Kartu karyawan

Identitas (nama sebagai tautan ke detail, posisi, departemen, level grade), tiga kotak ringkas (NPK, masa kerja, pendidikan), lencana HAV/MCU/Disiplin/Behavior, serta tiga bagian yang bisa dibuka: Riwayat PA, Riwayat Jabatan, Technical Competencies.

Angka & status pada panel ini:

- Masa kerja ditulis '12y' artinya 12 tahun; 0y berarti data masa kerja belum diisi.
- HAV ditampilkan sebagai 'nomor NAMA (KATEGORI)', mis. '1 STAR (TOP)'; tanda '—' berarti kuadran kosong atau di luar 1–16.
- MCU: Fit, Fit with note, Unfit, Expired; '-' berarti belum ada status MCU. Status MCU tidak menggugurkan kandidat dan tidak mengubah skor; aturan MCU pada program hanya menandai.
- Disiplin: 'Bersih' (clear), ST, SP Aktif, SP < 2 tahun, SP 3, SP Berat, Warning, Sanksi aktif; '-' berarti belum ada data.
- Riwayat PA: enam kotak semester untuk 3 tahun terakhir (S1 dan S2 per tahun). 'C*' berarti tidak ada nilai PA pada semester itu dan sistem menganggapnya C.
- Technical Competencies: Current Score dan Target Score berskala 0–4 (0 Not Assessed, 1 Basic, 2 Intermediate, 3 Advanced, 4 Expert); Gap negatif berarti masih di bawah target.
- Riwayat Jabatan berlencana 'Non-Primary' untuk jabatan rangkap; tanggal 'Sekarang' berarti masih berjalan.
- Lencana ungu **Suksesor** (atau 'Suksesor · N posisi' bila lebih dari satu) muncul di samping level bila kandidat sudah ditetapkan sebagai suksesor. Arahkan kursor — atau ketuk di layar sentuh — untuk melihat posisinya: nama posisi (tautan ke detail posisi), departemen, lalu program, urutan suksesornya (suksesor ke-1, ke-2, …) dan readiness saat dipilih. Satu posisi yang memilih orang yang sama lewat dua program tampil SEKALI dengan dua baris program, bukan dua posisi. Posisi milik business unit lain diberi label unitnya (mis. MSO), karena pool kandidat bisa lintas unit dan posisi itu tidak muncul di Manajemen Posisi unit yang sedang dibuka.
- Saat mode samar aktif lencananya tetap tampil — itulah yang disaring oleh filter Status suksesor — tetapi nama posisinya disembunyikan sampai data ditampilkan.

### Kandidat — Tampilan tabel

Kolom Karyawan (nama + posisi, plus lencana Suksesor bila ada), Departemen, Level, MCU, Behavior, Masa, dan Aksi.

Angka & status pada panel ini:

- Lencana Suksesor di kolom Karyawan bekerja sama persis dengan yang ada di kartu, termasuk daftar posisinya saat diarahkan kursor.

- Level '—' berarti grade karyawan kosong atau belum ada pemetaan grade ke nama level untuk business unit ini.
- Behavior '—' berarti rekomendasi behavior belum diisi.
- Saat mode samar aktif, kolom Level, MCU, Behavior, dan Masa tampil sebagai titik-titik.

### Detail Kandidat — Header profil dan 6 kartu metrik

Foto/inisial, nama, posisi, NPK, departemen, divisi, lencana level grade; lalu Masa Kerja, Pendidikan (+jurusan), HAV Kuadran, MCU, Disiplin, dan Behavior.

Angka & status pada panel ini:

- Halaman detail TIDAK menyamarkan data — semua nilai terbaca apa adanya.
- Nilai '-' pada Pendidikan/Jurusan/Departemen/Divisi/Posisi berarti kolom itu kosong di data kandidat.
- '—' pada HAV atau Behavior berarti belum diisi.
- Warna teks hanya penanda: hijau untuk kondisi baik (Fit/Bersih/READY), kuning untuk catatan/pengembangan, merah untuk sisanya.

### Detail Kandidat — Grafik Technical Competencies

Batang biru = skor saat ini, batang abu = skor target, per kompetensi teknis milik kandidat.

Angka & status pada panel ini:

- Skala 0–5 tetapi nilai riil 0–4; 0 artinya belum dinilai.
- Nama kompetensi lebih dari 20 karakter dipotong dengan '…'.
- 'Belum ada data kompetensi teknis' berarti kandidat tidak punya baris kompetensi (belum tersinkron atau NPK tidak cocok).

### Detail Kandidat — Grafik Performance Appraisal

Garis nilai PA S1 dan S2 untuk 3 tahun terakhir.

Angka & status pada panel ini:

- Sumbu Y dipetakan A=5, B=4, C=3, D=2, E=1.
- Semester tanpa nilai digambar sebagai C — jadi garis di posisi C bisa berarti 'nilai C' atau 'tidak ada nilai'. Bandingkan dengan kartu di halaman daftar yang menandai kasus ini sebagai 'C*'.

### Detail Kandidat — Position History

Riwayat jabatan dari yang terbaru, dengan titik biru untuk jabatan utama dan abu untuk jabatan rangkap.

Angka & status pada panel ini:

- 'Sekarang' berarti masa berlaku jabatan belum berakhir.
- '· Grade N' hanya muncul bila grade pada riwayat itu tercatat.
- 'Belum ada riwayat jabatan' berarti data penempatan pegawai belum tersinkron untuk NPK ini.

### Detail Kandidat — Riwayat Scoring Run

Semua penilaian di business unit aktif yang pernah memberi peringkat pada kandidat ini, dikelompokkan per posisi, terbaru dulu. Setiap baris adalah tautan langsung ke run tersebut di halaman detail posisi.

Angka & status pada panel ini:

- 'Terbaik #n' = peringkat terbaik yang pernah dicapai orang ini pada posisi tersebut.
- 'n run' = jumlah penilaian pada posisi tersebut yang menyertakan orang ini.
- 'dari N kandidat' = jumlah kandidat yang diberi peringkat pada run itu.
- Persentase = skor akhir run dibulatkan; lencana di sebelahnya adalah readiness pada run itu.
- 'Kandidat ini belum pernah masuk dalam scoring run' berarti belum ada hasil penilaian di business unit aktif — run di business unit lain tidak dihitung di sini.

### Detail Kandidat — Behavior Notes

Catatan behavior bebas milik kandidat. Kartu ini hanya muncul bila catatannya terisi.

Angka & status pada panel ini:

- Tidak muncul sama sekali = catatan kosong, bukan error.

### Kalau angkanya kosong, nol, atau "tanpa" — sebab & cara mengatasi

- "Kenapa data kandidat cuma titik-titik (•••)?" — Halaman Kandidat menyamarkan data secara bawaan; hanya nama, posisi, dan departemen yang terbaca. Tekan tombol "Data disamarkan" di kanan baris filter atau "Tampilkan data" pada banner kuning. Pilihannya hanya bertahan selama tab browser terbuka; tab baru kembali tersamar. Halaman detail kandidat tidak pernah menyamarkan.
- "Kenapa kolom Level kandidat '—' dan filter Level kosong?" — Level dihitung dari grade karyawan yang dipetakan ke nama level lewat master grade per perusahaan. Kosong berarti grade kandidat belum terisi, atau pemetaan perusahaan ke business unit / master grade belum tersinkron. Jalankan sinkronisasi data karyawan dan grade, lalu muat ulang halaman.
- "Kenapa Readiness Pipeline 0 dari 0 dan coverage 0%?" — Angka itu murni berasal dari run penilaian TERAKHIR YANG SUDAH SELESAI untuk posisi tersebut. Belum pernah dinilai berarti 0/0. Jalankan penilaian lewat ikon kalkulator pada baris posisi. Perhatikan juga tab Programs: bila sebuah program sedang dipilih, run dari program lain tidak dihitung sehingga posisi bisa terlihat 'Belum scoring'.
- "Scoring sudah jalan tapi tetap tertulis 'belum ada run' / 'Sedang scoring...'." — Run yang masih berjalan atau masih draf sengaja tidak dipakai sebagai run terbaru. Tunggu sampai selesai; setelah selesai lencananya berubah menjadi 'Sudah scoring' dan angka pipeline terisi.
- "Kenapa 'Belum pernah dinilai' besar sekali padahal Incumbent coverage di beranda 100%?" — Dua hal yang berbeda. Incumbent coverage mengukur kelengkapan data PEJABAT (setiap posisi sudah tercatat siapa yang menduduki), sedangkan kartu ini mengukur apakah posisi itu sudah pernah DINILAI. Posisi bisa lengkap pejabatnya tapi belum pernah dijalankan scoring-nya.
- "Kenapa angka Critical gap di beranda jauh lebih besar dari 'Dinilai, belum ada yang siap' di sini?" — Critical gap di beranda memakai ambang coverage < 50%, dan posisi yang belum pernah dinilai punya coverage 0% sehingga ikut masuk ke sana. Kartu di halaman ini memisahkan keduanya, jadi pakai kartu ini untuk tahu berapa yang sebenarnya perlu dikembangkan dan berapa yang cuma belum dijalankan.
- "Saya pilih jabatan master, tapi Nama pejabat tetap kosong dan tidak bisa disimpan." — Jabatan itu tidak punya pemangku aktif. Perhatikan label pilihannya: yang bertuliskan '(belum ada pejabat)' memang tidak punya incumbent. Pilih baris jabatan lain yang mencantumkan nama pejabat, atau gunakan pencarian nomor 1 (cari nama karyawan) agar jabatannya yang dicarikan sistem.
- "Muncul pesan 'Pendidikan wajib diisi.' / 'Job Family wajib diisi.' / 'Rentang level suksesor wajib diisi.'" — Ketiga hal itu wajib saat menambah posisi baru. Cara tercepat: pilih dokumen di 'Pilih dari Job Profile' sehingga Pendidikan, Pengalaman, Job Family, dan kompetensi terisi otomatis. Bila belum ada job profile-nya, ketik Pendidikan dan Job Family manual, lalu pilih Level minimum dan Level maksimum.
- "Kompetensi Teknis di dialog posisi kosong." — Bila tertulis 'Pilih job profile untuk mengisi kompetensi', belum ada dokumen yang dipilih. Bila tertulis 'Job profile ini tidak memiliki kompetensi teknis', dokumennya memang tidak memuat daftar kompetensi — periksa dokumen sumbernya di menu Dokumen. Perlu diketahui, posisi tanpa kompetensi wajib membuat metode AHP + TOPSIS bersandar pada kompetensi para pemangku jabatan sebagai cadangan.
- "Saya ubah Pendidikan / Pengalaman / Job Family / Kompetensi lewat tombol pensil di daftar posisi, tapi tidak tersimpan." — Benar: tombol simpan pada dialog itu hanya menyimpan nama posisi, departemen, divisi, nama & NPK pejabat, dan rentang grade. Kualifikasi dan kompetensi diubah dari halaman detail posisi melalui penautan Job Profile.
- "Setelah saya edit posisi, penyaringan grade jadi tidak membatasi siapa pun." — Saat dialog Ubah dibuka, rentang level hanya terisi bila angka grade tersimpan tepat berada di batas sebuah level. Bila tidak cocok, kedua pilihan tampil kosong dan menyimpan akan mengosongkan batas grade posisi. Selalu pilih ulang Level minimum dan maksimum sebelum menyimpan perubahan posisi.
- "Saya hapus satu posisi, kenapa semua riwayat penilaiannya ikut hilang?" — Penghapusan posisi bersifat permanen dan menarik serta semua data yang menempel padanya: run, hasil peringkat, suksesor terpilih, dan sesi penilaian. Tidak ada pemulihan. Untuk posisi yang sudah punya riwayat, sebaiknya dibiarkan saja daripada dihapus.
- "Kandidat tiba-tiba hilang dari daftar." — Tiga kemungkinan: (1) filter/pencarian/level masih aktif; (2) orangnya dihapus satu per satu dari halaman Kandidat; (3) seluruh kolam dikosongkan lewat Pengaturan → Sinkronisasi → Data Kandidat. Kartu itu menampilkan tiga angka: Aktif, Dikosongkan, dan Dihapus manual, sekaligus menyediakan tombol pemulihannya.
- "Dialog hapus kandidat bilang tidak bisa dibatalkan — benarkah?" — Tidak. Penghapusan kandidat hanya menyembunyikan orangnya; barisnya tetap ada dan seluruh riwayat penilaiannya utuh. Pulihkan lewat Pengaturan → Sinkronisasi → Data Kandidat → 'Lihat kandidat yang dihapus manual' → Pulihkan (hanya 200 penghapusan terbaru yang terdaftar).
- "Sudah jalan sinkronisasi, tapi kandidat yang saya hapus tidak kembali." — Memang begitu rancangannya: penghapusan satu per satu dianggap keputusan sengaja dan dihormati oleh sinkronisasi. Yang otomatis kembali setelah sinkronisasi hanyalah kandidat yang 'dikosongkan' massal. Gunakan tombol Pulihkan per kandidat.
- "Kompetensi teknis yang saya hapus dari profil kandidat muncul lagi." — Kompetensi hasil sinkronisasi diperbarui ulang dari sumber HR secara berkala, jadi penghapusannya tidak bertahan. Yang bertahan adalah perubahan Current Proficiency dan Target Score (baris itu ditandai sebagai perubahan manual) serta kompetensi yang Anda tambahkan sendiri. Untuk menghilangkannya permanen, perbaiki di sistem sumber.
- "Saya perbaiki NPK di dialog kandidat, tapi tidak berubah." — NPK sengaja dikunci karena menjadi identitas yang menyambungkan orang tersebut dengan seluruh riwayat penilaian dan data HR-nya. Untuk memperbaiki NPK yang salah, hapus kandidatnya lalu jalankan sinkronisasi kandidat agar dibuat ulang dengan NPK yang benar.
- "Kenapa nilai PA tertulis C* atau garisnya di posisi C padahal belum dinilai?" — Semester tanpa nilai PA dianggap C. Pada kartu kandidat ditandai 'C*' dengan keterangan 'Tidak ada PA (Otomatis C)', sedangkan pada grafik di halaman detail tetap digambar di garis C. Isi nilai PA lewat dialog Ubah karyawan (enam kotak: S1 dan S2 untuk tiga tahun terakhir) bila datanya ada.
- "HAV Kuadran tampil '—'." — Nilai HAV kosong atau tidak dapat dibaca sebagai angka 1–16. Isi lewat dialog Ubah karyawan dengan memilih dari daftar kuadran resmi (mis. '1 STAR (TOP)'), atau perbaiki berkas sumber HAV lalu sinkronkan.
- "Riwayat Scoring Run kandidat kosong padahal dia pernah dinilai." — Riwayat hanya menampilkan run milik business unit yang sedang aktif. Bila orang itu dinilai di business unit lain, pindah dulu business unit-nya. Kosong juga wajar bila run terakhir belum selesai atau kandidat tidak masuk daftar peringkat.
- "Riwayat Jabatan atau Technical Competencies kosong." — Keduanya bersumber dari sinkronisasi berdasarkan NPK. Kosong berarti NPK kandidat tidak cocok dengan data kepegawaian, atau sinkronisasi belum dijalankan. Cek NPK-nya, lalu jalankan sinkronisasi karyawan/kompetensi.
- "Muncul pesan 'Anda tidak memiliki akses untuk ...'." — Peran pengguna belum mencakup Kelola posisi atau Kelola kandidat. Peran Viewer dan Analyst hanya bisa melihat. Minta administrator mengubah peran di Pengaturan → Manajemen Peran.
- "Data yang muncul bukan milik unit saya." — Semua isi kedua halaman mengikuti business unit yang sedang aktif di pemilih business unit (Mulia / MSO / ERRO). Ganti business unit terlebih dahulu; menambah, mengubah, mengosongkan, atau memulihkan hanya berdampak pada business unit yang sedang aktif.

---
