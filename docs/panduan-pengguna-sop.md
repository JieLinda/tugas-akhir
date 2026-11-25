# Panduan Pengguna & SOP — AI Pulse

Platform perencanaan suksesi talenta MPM Motor

| | |
|---|---|
| Versi dokumen | 1.7 |
| Tanggal | 25 November 2026 (versi 1.6: 17 November 2026; versi 1.5 dan 1.4: 5 November 2026; versi 1.3: 30 Oktober 2026; versi 1.2 dan 1.1: 29 Oktober 2026; versi 1.0: 30 September 2026) |
| Perubahan versi 1.7 | 25 November 2026: enkripsi data di tingkat aplikasi dihapus. Menu Keamanan (/settings/security) beserta kunci master, Buka Kunci, Kunci, dan Rotasi hilang dari aplikasi; alamat lamanya kini membuka Sinkronisasi. Seksi 6.11 dan baris kunci master di 8.1 ikut dihapus. Data tersimpan tanpa enkripsi di database, sehingga perlindungannya bergantung pada pembatasan akses ke database. |
| Perubahan versi 1.6 | 17 November 2026: metode AI Tournament (LLM) dihapus dari aplikasi; AHP + TOPSIS menjadi satu-satunya metode penilaian, dan kartu "Metode Scoring" di wizard hilang. Ikut dihapus dari Tata Kelola: editor kriteria, AI System Prompt program beserta riwayat versinya, Konteks Bisnis, dan seksi Umpan Balik AI, beserta izin "Umpan balik scoring" (izin kini sebelas). Run AI Tournament yang tersimpan dihapus dari basis data; suksesor yang dipilih dari run itu tetap ada. |
| Perubahan versi 1.5 | 5 November 2026: fitur Simulasi penempatan dihapus dari aplikasi, beserta bilah "Simulasi penempatan", tombol "Simulasikan semua (N)" dan "Simulasikan ulang (N)", baris peringkat yang dapat diklik untuk membuat simulasi, dan kartu catatannya. Langkah 4 lama di SOP modul Penilaian ikut dihapus sehingga Langkah 5–7 menjadi Langkah 4–6. Peringkat, skor, dan readiness tidak berubah |
| Perubahan versi 1.4 | 5 November 2026: fitur Keyakinan Penempatan (MCU) dihapus dari aplikasi, beserta lencana, dialog, tombol, dan panel pengaturannya. Status MCU, aturan filter MCU yang hanya menandai, dan "Keterangan MCU" kandidat tetap ada |
| Cakupan | Seluruh modul aplikasi web AI Pulse |
| Dasar penyusunan | Verifikasi langsung ke kode sumber aplikasi |
| Bahasa antarmuka | Indonesia |

Seluruh nama menu, label tombol, dan teks peringatan yang dikutip dalam dokumen ini disalin persis dari antarmuka aplikasi.

---

## 1. Tentang aplikasi

AI Pulse adalah platform perencanaan suksesi talenta MPM Motor. Aplikasi ini
mengelola kursi jabatan yang relevan untuk suksesi, mengumpulkan kandidat yang
memenuhi syarat, lalu menjalankan penilaian untuk memeringkat calon penerus
terhadap aturan program yang dapat dikonfigurasi.

Aplikasi berjalan multi-Company: Mulia, MSO, dan ERRO berbagi satu pemasangan.
Company aktif dipilih lewat pemilih Company dan tersimpan pada cookie
`pulse_tenant`; bila belum pernah dipilih, sistem memakai Mulia.

Empat komponen yang berjalan di belakang layar:

- Aplikasi web — seluruh antarmuka yang Anda pakai.
- Layanan sinkronisasi — menarik data karyawan dan HR dari sumber.
- Layanan penilaian — menjalankan penilaian panjang di luar peramban.
- Layanan job family — pengelompokan rumpun jabatan.

## 2. Alur besar

1. Sinkronisasi data HR masuk ke sistem.
2. Kurasi posisi dan kandidat.
3. Jalankan penilaian.
4. Baca hasil peringkat.
5. Pilih suksesor.

Setiap penilaian yang selesai adalah catatan penilaian pada satu tanggal.
Sistem tidak pernah menimpanya; perubahan selalu menghasilkan penilaian baru.

## 3. Konsep dasar

**Company** — unit bisnis. Hampir seluruh data disaring per Company.

**Program** — aturan penilaian: aturan filter kelayakan, matriks bobot AHP,
dan target jumlah finalis. Satu posisi
dimiliki tepat satu program, dan program itu terkunci begitu posisi punya
hasil penilaian. Menilai kursi yang sama di bawah program kedua berarti
menambahkan posisinya lagi dengan program tersebut.

**Talent Pool bukan program posisi.** Talent Pool menjawab "siapa di unit ini
yang lolos ambang", bukan mengisi kursi. Karena itu Talent Pool tidak muncul
di pemilih program Tata Kelola dan tidak pernah dijalankan sebagai penilaian.

**Posisi** — kursi yang dikurasi untuk suksesi, lengkap dengan rentang grade
suksesor dan pemangku jabatan aktif. Satu kursi boleh punya beberapa pemangku
aktif sekaligus, dan semuanya dikecualikan dari kumpulan calon penggantinya.

**Kandidat** — kumpulan calon. Kandidat tidak pernah dihapus permanen,
melainkan ditandai terhapus.

**Run** — satu penilaian yang selesai, beserta seluruh diagnostiknya.

**Satu metode penilaian: AHP + TOPSIS** — deterministik, enam aspek: teknis,
relevansi karier, perilaku, penilaian kinerja, HAV, dan pendidikan. Metode
AI Tournament (penilaian oleh model bahasa) sudah dihapus beserta run-nya.

**Pembobotan hanya dari satu tempat.** Porsi tiap aspek berasal dari matriks
berpasangan AHP program, atau dari bobot bawaan sistem bila program belum
punya matriks. Keenam aspek selalu dinilai; daftar kriteria program hanya
bersifat deskriptif.

**MCU hanya menandai.** Status pemeriksaan kesehatan (MCU) diperiksa lewat
aturan filter yang hanya menandai: ia tidak menggugurkan kandidat, bukan
kriteria penilaian, dan tidak pernah mengubah skor maupun peringkat.

## 4. Peran & hak akses

Autentikasi lewat Keycloak hanya menentukan identitas. Peran dan izin
sepenuhnya diatur di dalam Pulse.

Seorang pengguna memegang tepat satu peran. Pengguna baru yang belum diberi
peran tidak memperoleh izin apa pun dan berstatus "Menunggu penetapan peran" —
peran Viewer memang ditandai bawaan, tetapi tidak pernah diterapkan otomatis.
Seorang admin harus menetapkannya.

### Empat peran bawaan

| Peran | Untuk siapa | Ringkasan |
|---|---|---|
| Administrator | Pengelola sistem | Akses penuh, termasuk tata kelola, sinkronisasi, dan manajemen pengguna & peran. |
| HR / Talent | Tim HR | Kelola data master (kandidat, posisi, job profile) dan jalankan scoring. |
| Analyst | Analis | Jalankan scoring & analisis; data master hanya baca. |
| Viewer | Umum | Hanya melihat data — tidak dapat mengubah apa pun. |

### Sebelas izin

| Izin | Arti di layar |
|---|---|
| candidates.view | Lihat kandidat |
| candidates.manage | Kelola kandidat |
| positions.view | Lihat Manajemen Posisi |
| positions.manage | Kelola Manajemen Posisi |
| job_profiles.view | Lihat menu Dokumen & Posisi |
| job_profiles.manage | Kelola menu Dokumen & Posisi |
| scoring.run | Jalankan scoring |
| analysis.manage | Kelola hasil analisis |
| governance.manage | Kelola tata kelola |
| sync.manage | Kelola sinkronisasi |
| users.manage | Kelola pengguna & peran |

Izin "kelola" otomatis mencakup izin "lihat" pasangannya untuk tiga pasang:
kandidat, Manajemen Posisi, serta Dokumen & Posisi.

Menu Dokumen (dokumen job profile, Job Profile Match, Kamus Kompetensi) dan
menu Posisi (Job Family) adalah satu paket izin dan tidak
dapat diberikan terpisah. Jangan tertukar dengan izin Manajemen Posisi, yang
mengatur menu Manajemen Posisi di Alur Kerja.

Peran Administrator selalu mempertahankan izin "Kelola pengguna & peran";
antarmuka tidak dapat mencabutnya. Ini pengaman agar sistem tidak terkunci.

### Dua catatan penting

Jika izin kurang untuk membuka sebuah halaman, pengguna **dialihkan diam-diam
ke Beranda** tanpa pesan kesalahan. Jadi "menu tidak ada" dan "halaman
memantul ke Beranda" adalah gejala yang sama: peran belum memuatnya.

Jika izin kurang untuk sebuah aksi, muncul pesan "Anda tidak memiliki akses
untuk ..." diikuti nama izin.

## 5. Peta menu

Menu diambil dari satu daftar induk, sehingga label di sidebar, judul halaman,
dan jejak navigasi tidak mungkin berbeda.

Dua pintasan di atas menu berkelompok:

| Pintasan | Rute | Izin |
|---|---|---|
| Mulai Scoring | /scoring/new | scoring.run |
| Talent Pool | /talent-pool | candidates.view |

### Alur Kerja

| Menu | Rute | Izin |
|---|---|---|
| Beranda | / | tanpa izin khusus |
| Manajemen Posisi | /positions | positions.view |
| Kandidat | /candidates | candidates.view |

### Data Referensi

| Menu | Rute | Izin |
|---|---|---|
| Dokumen | /job-profiles | job_profiles.view |
| Posisi | /posisi | job_profiles.view |

### Administrasi

| Menu | Rute | Izin |
|---|---|---|
| Tata Kelola | /governance | governance.manage |
| Sinkronisasi | /settings/sync | sync.manage |
| Pengguna & Akses | /settings/users | users.manage |

Peran HR / Talent melihat dua kelompok pertama secara utuh dan tidak melihat
kelompok Administrasi sama sekali.

### Seksi di dalam menu Dokumen dan Posisi

Menu "Profil Job" yang dulu berisi lima seksi kini dipecah menjadi dua menu.
Seluruh seksi kedua menu berada di bawah satu izin, yaitu job_profiles.view.

Menu **Dokumen** — dokumen job profile dan yang dibaca langsung darinya:

| Seksi | Rute | Judul halaman |
|---|---|---|
| Dokumen Job Profile | /job-profiles | Dokumen Job Profile |
| Job Profile Match | /job-profiles/match | Job Profile Match |
| Kamus Kompetensi | /job-profiles/kamus | Kamus Kompetensi Teknis |

Menu **Posisi** — yang dibangun dari dokumen itu tentang posisi:

| Seksi | Rute | Judul halaman |
|---|---|---|
| Job Family | /posisi/job-family | Peta Job Family |
| (tanpa pil) Pengaturan Job Family | /posisi/job-family/pengaturan | Pengaturan Job Family |

Menu Posisi hanya berisi Peta Job Family, jadi tidak ada deretan seksi di
bawah judulnya. Pengaturan Job Family dibuka dari tombol pada halaman peta.
Seksi Struktur Posisi sudah dihapus; alamat lamanya mengalihkan ke peta.

Penjelasan fungsi tiap halaman, tab, dan seksi tidak lagi dicetak sebagai
paragraf. Arahkan kursor ke ikon tanda tanya dalam lingkaran di samping
judulnya untuk membacanya; klik ikonnya agar penjelasan tetap terbuka.

Alamat lama tetap hidup dan dialihkan otomatis: /kamus-kompetensi,
/family-configuration, /family-tree, /job-profiles/job-family,
/job-profiles/struktur, dan /settings/roles.

## 6. Daftar kegiatan per modul

Bagian ini memerinci apa saja yang dapat dilakukan pengguna pada tiap modul, beserta alasan di balik perilaku yang mudah disalahpahami.

### 6.1 Beranda

Izin: terbuka untuk semua pengguna yang sudah punya peran.

Kegiatan yang bisa dilakukan:

- Membaca Bench coverage — kandidat ber-readiness Short atau Medium dibagi
  seluruh kandidat yang pernah diberi skor, dihitung dari run terakhir yang
  sudah selesai di setiap posisi. Yang dihitung adalah baris hasil scoring,
  bukan jumlah orang: satu kandidat yang masuk tiga posisi terhitung tiga
  kali. Posisi yang belum pernah dinilai tidak masuk pembilang maupun
  penyebut.
- Membaca Ready now / soon dengan definisi yang sama.
- Membaca Incumbent coverage — posisi yang punya nama pejabat aktif dibagi
  seluruh posisi terdaftar. Ini soal kelengkapan data pejabat, bukan soal
  suksesor: 100% tidak berarti setiap posisi sudah punya calon pengganti.
- Membaca Readiness Bands — penyebutnya jumlah posisi, bukan kandidat. Strong
  bench minimal 80%, Watchlist 50 sampai 79%, Critical gap di bawah 50%.
  Posisi yang belum pernah dinilai ikut terhitung dengan coverage 0% sehingga
  jatuh ke Critical gap.
- Membuka popover tanda tanya di tiap angka untuk melihat rumus, pembilang,
  dan penyebutnya. Tidak satu pun angka di halaman ini tersimpan sebagai kolom
  database; semuanya diturunkan saat halaman dibuka, jadi pertanyaan "angka
  ini dari mana" memang tidak terjawab dari database.
- Melihat distribusi coverage successor dan daftar posisi dengan coverage
  readiness terendah.
- Melihat HAV 16 Grid — kuadran hasil penilaian kinerja dikali kompetensi
  perilaku.
- Melihat jumlah Talent Pool terkualifikasi, yaitu kandidat yang lolos aturan
  filter program Talent Pool. Angka ini sengaja memakai hasil evaluasi, bukan
  jumlah kandidat mentah, supaya tidak berselisih dengan halaman yang
  ditautkannya.
- Melihat jumlah posisi yang pemangkunya sudah mencapai ambang pensiun.
- Membaca Audit Trail aktivitas terbaru.

Catatan ambang: readiness diturunkan dari skor akhir run — minimal 80 Short,
minimal 65 Medium, minimal 50 Long, sisanya Not Ready. Ambang ini diatur di
Tata Kelola sehingga angka Beranda ikut berubah bila ambangnya diubah.

### 6.2 Manajemen Posisi

Izin lihat: positions.view. Izin ubah: positions.manage.

Kegiatan yang bisa dilakukan:

- Menambah posisi satu per satu lewat tombol "Tambah", memilih program
  suksesi, rentang level suksesor, dan pemangku jabatan aktif.
- Menambah posisi secara batch lewat tombol "Tambah Batch", berdasarkan grade
  pemangku jabatan minimum. Rentang
  suksesor mengikuti tujuan program: Critical Position mengambil satu tingkat
  di bawah pemangku untuk penyiapan kader, Emergency Position mengambil
  tingkat pemangku sendiri ditambah satu tingkat di atasnya untuk orang yang
  bisa langsung menggantikan hari ini, dan program lain memakai rentang
  konservatif satu tingkat di bawah sampai setingkat. "Satu tingkat" berarti
  satu nama jenjang, bukan satu angka grade.
- Menyalakan penilaian otomatis pada penambahan massal. Posisi yang kumpulan
  calonnya kosong dilaporkan dan dilewati, bukan menggagalkan seluruh batch.
- Melihat peringatan sebelum batch berjalan untuk kursi yang belum punya job
  profile. Penilaian tetap bisa berjalan, tetapi aspek teknis dan karier akan
  dinilai dari kompetensi pemangku jabatan, bukan dari tuntutan jabatan. Itu
  angka yang berbeda dengan label yang sama, sehingga harus dipilih secara
  sadar.
- Menyaring daftar posisi lewat chip program.
- Menyaring lewat status bench: sudah ada yang siap, belum ada yang siap, dan
  belum dinilai. Ketiganya saling lepas dan berjumlah persis sebanyak posisi.
  Ketiganya dihitung atas seluruh himpunan tersaring, bukan hanya baris yang
  tampak di halaman.
- Menjalankan penilaian dari satu posisi.
- Menjalankan penilaian ulang untuk seluruh posisi dalam satu program lewat
  tombol "Scoring Ulang". Ini tidak pernah mengubah atau menghapus run yang
  sudah ada. Posisi yang sedang dinilai dilewati agar riwayatnya tidak terisi
  dua run sekaligus.
- Melihat daftar suksesor yang sudah ditetapkan lewat tombol "Suksesor
  terpilih", yang dapat disaring per program.
- Membaca tiga keadaan yang tidak terlihat dari baris biasa: kursi yang job
  profile-nya tidak ditemukan, kursi yang sudah dinilai tetapi belum ada
  suksesor dipilih, dan pemangku yang sudah mencapai ambang pensiun. Yang
  terakhir menyebut namanya, karena jumlah saja membuat pembaca harus mencari
  sendiri. Pemangku yang tanggal lahirnya belum tersinkron tidak pernah
  ditandai, sebab ketidaktahuan bukan temuan.
- Membaca RTC, yaitu jumlah suksesor yang benar-benar dipilih. Ini
  menggantikan pratinjau kandidat teratas, sebab kandidat teratas hanya
  keluaran run terakhir sedangkan bangku cadangan baru nyata setelah ada yang
  memilih.

Catatan: penghapusan seluruh riwayat penilaian satu program sudah dibangun di
dalam kode, tetapi sengaja TIDAK ditampilkan di halaman ini karena merupakan
satu-satunya aksi yang tidak dapat dibatalkan. Pengguna tidak dapat
melakukannya dari antarmuka.

### 6.3 Penilaian

Izin: scoring.run.

Kegiatan yang bisa dilakukan:

- Menjalankan penilaian dengan metode AHP + TOPSIS, satu-satunya metode.
- Memilih program dan posisi. Wizard hanya menawarkan posisi yang terdaftar di
  bawah program yang dipilih, dan menolak run yang programnya tidak cocok
  dengan program posisi.
- Mengecualikan kandidat sebelum penilaian dimulai.
- Meninjau ringkasan konfigurasi sesi dan rentang jenjang sebelum memulai.
- Memantau progres.
- Membaca pemberitahuan pengiriman. Bila layanan penilaian tidak menjawab,
  pesan yang muncul berwarna kuning dan menyebutkan bahwa sesinya sudah
  tersimpan dan tidak perlu dijalankan ulang. Ini penting: sesi dan barisnya
  sudah tersimpan, dan penyapu sesi terlantar akan mengambilnya begitu ada
  slot kosong. Menjalankan ulang hanya menumpuk sesi kedua pada kursi yang
  sama.

Tiga sebab berbeda dibedakan dengan sengaja: layanan tidak terjangkau,
layanan menjawab dengan galat, dan alamat layanan belum dikonfigurasi. Layanan
yang menjawab dengan galat tetap hidup, sehingga melaporkannya sebagai "tidak
merespons" akan menyesatkan operator.

### 6.4 Analisis Hasil

Izin: analysis.manage untuk mengubah, candidates.view dan positions.view untuk
membaca.

Kegiatan yang bisa dilakukan:

- Membaca peringkat finalis beserta skor tiap aspek.
- Menandai kandidat pada run yang sudah selesai sebagai "Ditandai dikecualikan
  (tidak memengaruhi angka)" dengan alasan tertulis. Penandaan tidak mengubah
  skor, peringkat, maupun snapshot run, dan tidak membuat run baru. Membatalkan
  tanda juga wajib beralasan; keduanya tercatat di riwayat audit.
- Menambah kandidat pembanding ke run yang sudah selesai ("Tambah Kandidat
  Pembanding"), lihat di bawah.
- Menjalankan penilaian baru dengan data dan konfigurasi hari ini lewat tombol
  "Penilaian Baru" di kartu Riwayat Scoring. Hasilnya run root baru, yang
  setelah selesai menawarkan perbandingan dengan run root sebelumnya.
- Melihat silsilah run (tombol "Silsilah"), dan jejak leluhur di atas peringkat
  sehingga tidak ada yang mempelajari peringkat turunan tanpa diberi tahu bahwa
  itu turunan. Silsilah menandai run yang gagal beserta pesannya, run bermode
  lama, induk yang dihapus, kandidat di luar rentang grade, nilai yang dibaca
  hari ini, skor sementara, dan run yang punya keputusan forum.
- Membandingkan dua run mana pun pada posisi yang sama di tab "Perbandingan
  Run". Tab ini menggambar seluruh run posisi sebagai pohon silsilah (root di
  kiri, turunannya di kolom berikutnya), dan dua run dipilih langsung dari
  pohon: klik kartu run untuk menjadikannya B (yang dibandingkan), tekan
  tombol A pada kartu untuk menjadikannya A (pembanding). Root dengan banyak
  turunan tetap terlihat di atas kolomnya selama turunannya digulir, dan
  tombol panah di samping B memindahkan B ke saudara sebelumnya atau
  berikutnya, sehingga root dapat dibandingkan dengan setiap turunannya
  satu per satu. Bagian "Ringkasan" menampilkan angka kunci (peringkat
  teratas, kandidat dinilai, kandidat pembanding, peringkat yang bergeser,
  N besar yang masuk dan keluar, sumber perubahan), posisi suksesor yang
  dipilih forum di run A dan B, kalimat "Mengapa A dan B berbeda", grafik
  pergeseran peringkat, dan lima sumber perubahan. Bagian lain: Peringkat,
  Kriteria, Rincian kandidat, Konfigurasi, Pool, Atribusi, dan Keputusan
  forum. Tombol "Ekspor XLSX" menyimpan seluruhnya; "Salin tautan" menyalin
  alamat yang membuka pasangan yang sama.
- Mencentang dua run pada tampilan "Silsilah" di kartu Riwayat Scoring lalu
  mengklik "Bandingkan", atau memakai pintasan "Bandingkan dengan induk",
  "Bandingkan dengan root", dan "Bandingkan dengan run sebelumnya". Ketiganya
  membuka tab "Komparasi Versi" dengan pasangan tersebut tanpa memuat ulang
  halaman.
- Membaca "Rekomendasi sistem dan keputusan forum" pada bagian "Keputusan
  forum" di tab "Komparasi Versi": untuk setiap run yang dirujuk keputusan,
  peringkat 1–N sistem berdampingan dengan kandidat yang dipilih forum,
  peringkatnya di run itu, dan justifikasinya. Setiap blok run punya tombol
  "Jadikan A" dan "Jadikan B" untuk langsung membandingkan run tersebut.
- Membuka panel "Snapshot run" (tab Konfigurasi) untuk melihat konfigurasi yang
  dibekukan saat run dibuat beserta asal setiap butirnya: aturan filter,
  matriks AHP dan bobot, jangkar, basis posisi, versi data, model, ambang
  kesiapan, dan jumlah finalis. Butir yang tidak disimpan run lama ditulis
  "Tidak tersimpan pada run ini". Tombol "Periksa keterulangan" menghitung ulang
  TOPSIS dari data tersimpan, dan "Unduh snapshot (JSON)" menyimpan snapshot
  apa adanya. Program dapat diubah kapan saja, sehingga menjelaskan peringkat
  lama dengan aturan hari ini akan menampilkan aturan yang mungkin tidak pernah
  berlaku untuknya.
- Mengklik "Unduh trace perhitungan (XLSX)" (di samping "Unduh snapshot
  (JSON)", khusus run AHP + TOPSIS) untuk verifikasi dan penelusuran manual.
  Workbook memuat setiap angka antara data mentah kandidat dan peringkat akhir
  — pembentukan pool, parameter, sebaran sensus di balik jangkar teknis dan
  karier, pasangan kompetensi, setiap stint riwayat jabatan, enam skor
  kriteria, AHP, dan TOPSIS — sebagai RUMUS EXCEL yang hidup, termasuk rumus IF
  yang menentukan apakah sumbu tahun atau sumbu stint yang mengikat skor
  karier. Di samping setiap rumus ada angka yang disimpan engine; lembar
  "Ringkasan" menghitung jumlah selisih per tahap, dan "SEMUA COCOK" berarti
  rumusnya menghasilkan angka run itu sendiri. Parameter dirujuk lewat nama
  sel (P_…) di lembar "Parameter", sehingga mengubah satu nilai menghitung
  ulang seluruh rantai. Butuh Excel 2019 / Microsoft 365 atau LibreOffice ≥ 6.
  Run yang selesai sebelum fitur ini tidak menyimpan jejak lengkapnya: lembar
  "Panduan" menyebut apa saja yang tidak tercatat, dan langkah itu memakai angka
  tersimpan yang dibulatkan. Workbook memuat data kandidat, jadi perlakukan
  seperti data personalia; setiap unduhan dicatat di Riwayat Perubahan.
- Membaca sumber acuan dan penyesuaian: asal himpunan acuan, jangkar kemiripan
  teknis dan karier, kriteria yang digugurkan beserta bobot efektifnya, dan
  hitungan kandidat dinilai serta finalis.
- Membaca laporan pergeseran data. Sistem membandingkan nilai perilaku,
  kinerja, dan HAV hari ini terhadap nilai yang tersimpan pada run dasar, lalu
  melaporkan berapa yang bergeser per aspek, dan menyatakan apakah pergeseran
  itu diterapkan atau sengaja tidak.
- Bertanya lewat panel percakapan dan mengekspor percakapan ke PDF, Word, atau
  Excel.

#### Tambah Kandidat Pembanding

Penilaian ulang kini hanya satu: "Tambah Kandidat Pembanding". Run baru dibuat
di bawah run yang sedang dibuka (run induk), dan run induk dibekukan apa
adanya. Yang dibekukan:

- keenam skor aspek dan data mentah setiap kandidat lama;
- bobot AHP setelah pembagian ulang beserta CR-nya, dan himpunan kriteria
  aktif — kriteria yang dibuang di induk tetap dibuang;
- program, posisi, rentang level, dan aturan filter;
- jangkar kalibrasi;
- tanggal acuan penilaian (usia penugasan diukur sampai tanggal ini);
- basis posisi: job profile, acuan kompetensi, syarat pendidikan, dan dokumen
  target karier yang dipakai run induk;
- ambang kesiapan dan jumlah finalis;
- skala TOPSIS: pembagi kolom dan titik ideal run induk;
- tanda "Ditandai dikecualikan" pada run induk (berlabel "diwarisi";
  membatalkannya di run turunan tidak mengubah run induk).

Yang dihitung baru hanyalah keenam aspek kandidat yang belum ada di pool
induk, dan dihitung terhadap basis posisi induk. Karena skala TOPSIS induk
juga dibekukan, kecocokan dan urutan kandidat lama sama persis dengan run
induk: kandidat pembanding hanya disisipkan di antara mereka, dan peringkat
kandidat lama hanya turun sebanyak kandidat pembanding yang masuk di atasnya.
Bila nilai kandidat pembanding pada suatu kriteria berada di luar rentang run
induk, nilainya dihitung pada ujung rentang itu: di atas nilai terbaik
dihitung setara nilai terbaik, di bawah nilai terendah dihitung setara nilai
terendah. Barisnya diberi penanda "Di luar skala induk", dan tooltip-nya
menyebut kriteria serta arahnya. Bila induknya run lama yang tidak menyimpan
sebagian butir itu, nilai hari ini dipakai dan disebut terang-terangan di
banner run turunan dan di tab "Komparasi Versi".

Hasil run turunan memuat N besar menurut peringkat baru (N sama dengan jumlah
finalis induk), seluruh finalis induk, dan seluruh kandidat pembanding, dengan
peringkat pool penuh masing-masing. Penanda "Kandidat pembanding", "Baru masuk
N besar", dan "Keluar dari N besar" menunjukkan siapa yang bergeser. Penanda
keluar menyebut penyebabnya: "disalip kandidat pembanding", atau — hanya pada
run turunan lama yang menghitung ulang TOPSIS atas gabungannya — "bergeser
karena pool berubah". Banner di
atas daftar menyebut induknya, alasan forum, kandidat yang ditolak beserta
alasannya, dan tautan "Lihat perbandingan dengan induk". Panel "Selisih
Peringkat" menunjukkan pergeserannya terhadap induk langsung atau terhadap
root, lengkap dengan kalimat penjelasannya.

Aksi ini hanya tersedia pada run AHP + TOPSIS yang sudah selesai dan
menyimpan snapshot pool. Pada run lain, tombolnya tampil nonaktif dengan
alasannya. Bila data HR atau konfigurasi berubah, buat run baru dengan
"Penilaian Baru" atau dari wizard scoring, bukan run pembanding.

Run lama yang dibuat dengan mode yang sudah dihapus (tambah + data terbaru,
kecualikan, tanding ulang finalis, hitung ulang dengan data terbaru) tetap
tampil di silsilah dengan label "mode lama" dan tetap bisa dibuka.

### 6.5 Talent Pool

Izin buka: candidates.view. Izin sunting aturan: governance.manage.

Kegiatan yang bisa dilakukan:

- Melihat daftar kandidat yang lolos aturan filter.
- Menyunting aturan filter langsung di halaman itu, dengan pratinjau dampak
  sebelum disimpan. Daftar di halaman itu adalah keluaran dari aturan
  tersebut, sedangkan aturannya dulu berada satu halaman jauhnya, sehingga
  menyetel satu ambang berarti sunting, simpan, pindah halaman, hitung, lalu
  kembali. Pratinjau dan hasil tersimpan berasal dari satu jalur kode yang
  sama, jadi angka pratinjau dan angka akhir tidak mungkin berbeda.

Membuka halaman ini hanya butuh izin lihat kandidat, tetapi menyuntingnya
butuh izin tata kelola, sebab aturan yang sama juga menentukan siapa yang
diterima sebuah penilaian. Server menolak berdasarkan izin, apa pun yang
ditampilkan antarmuka.

Dua kendali sengaja tidak ada di panel ini: sakelar penegakan aturan dan
tingkat keparahan per aturan. Keduanya menentukan apa yang dilakukan sebuah
run terhadap kandidat yang gagal, sedangkan tidak ada run yang pernah
dijalankan di bawah Talent Pool. Keduanya tetap ada di Tata Kelola.

### 6.6 Kandidat

Izin lihat: candidates.view. Izin ubah: candidates.manage.

Kegiatan yang bisa dilakukan:

- Melihat, mencari, dan menyaring daftar kandidat.
- Menambah dan menyunting kandidat.
- Mengisi "Keterangan MCU" saat menambah atau menyunting kandidat. Isian ini
  tersimpan terpisah dari keterangan hasil sinkronisasi, tidak pernah ditimpa
  sinkronisasi mingguan, dan bila diisi menimpa keterangan dari sinkronisasi.
  Seperti status MCU, keterangan ini tidak menggugurkan kandidat dan tidak
  mengubah skor.
- Menghapus kandidat. Penghapusan bersifat penandaan, bukan penghapusan
  permanen, sebab penghapusan sungguhan akan diam-diam menulis ulang setiap
  peringkat yang pernah memuat orang tersebut. Penghapusan manual dipertahankan
  dari sinkronisasi mingguan; penghapusan massal sebelum impor ulang akan
  dipulihkan oleh sinkronisasi dengan identitas yang sama.
- Melihat lencana bagi orang yang sudah dipilih sebagai suksesor, dibaca dari
  data pemilihan yang sama dengan yang dibaca Manajemen Posisi, sehingga kedua
  halaman tidak mungkin berselisih. Kursi dikelompokkan per posisi, bukan per
  baris pemilihan. Pemilihan di kursi milik Company lain tetap ditampilkan dan
  diberi label, sebab kumpulan calon memang lintas unit dan menyembunyikan
  keputusan nyata akan membuat lencana berbohong.
- Menyaring berdasarkan status suksesor. Filter ini diselesaikan atas seluruh
  Company sebelum halaman dipotong, sehingga yang dihitung sama dengan yang
  dipilih.
- Membuka dan menutup penyamaran data.

Nomor induk karyawan adalah identitas dan tidak pernah diubah oleh penyuntingan.
Dulu perubahan nomor itu dibuang diam-diam sementara pesan sukses tetap muncul.
Sekarang perubahan ditolak sebelum penulisan apa pun, dengan dua kasus
dibedakan karena tindak lanjutnya berbeda: nomor sudah dipakai orang lain, atau
nomor bebas tetapi tidak dapat diubah dari sini.

### 6.7 Dokumen dan Posisi

Izin: job_profiles.view untuk melihat, job_profiles.manage untuk mengubah.
Menu Dokumen (Dokumen Job Profile, Job Profile Match, Kamus Kompetensi) dan
menu Posisi (Job Family) adalah satu paket izin dan tidak
dapat diberikan terpisah. Keduanya dulu satu menu bernama "Profil Job".

Seluruh seksi berada di bawah satu penjagaan izin yang sama, dipasang sekali
di tingkat kerangka halaman tiap menu.

#### Seksi Dokumen Job Profile (menu Dokumen)

- Menelusuri katalog job profile hasil ekstraksi PDF oleh AI.
- Membaca empat kartu metrik: Total Dokumen, Selesai Ekstraksi, Dalam Proses,
  dan Gagal Ekstraksi.
- Memahami kartu "Dalam Proses". Angkanya adalah dokumen yang belum punya
  hasil ekstraksi yang dapat dipakai, bukan seluruh antrean. Baris di bawahnya
  memerinci berapa yang sedang diekstrak dan berapa yang menunggu giliran.
  Bila ada pembacaan ulang terjadwal, jumlahnya disebut terpisah sebagai
  "sekian baca ulang terjadwal", sebab dokumen itu sudah punya isi yang dapat
  dibaca sekarang dan sudah terhitung di Selesai.
- Membaca lencana status: Proses, Antre, Selesai, Gagal.
- Menyaring berdasarkan status, Company, dan urutan; mencari lewat kotak
  pencarian; berpindah antara tampilan kartu dan tabel.
- Membuka dialog detail sebuah dokumen, menyalin JSON-nya, atau membacanya
  ulang dari PDF. Pembacaan ulang mengganti hasil ekstraksi yang sekarang dan
  memanggil model AI sekali untuk seluruh halaman, sehingga bisa memakan waktu
  beberapa menit.
- Mencoba ulang seluruh dokumen yang gagal lewat tombol "Coba Lagi Semua".
  Tombol ini hanya muncul bila ada yang gagal. Prosesnya berjalan di latar
  belakang dan dapat dipantau lewat kartu Dalam Proses. Dokumen yang berkas
  PDF-nya sudah tidak ada di server akan dilewati; itu hanya bisa diperbaiki
  dengan mengunggah ulang.
- Menetapkan Company pemilik tiap dokumen. Dokumen yang belum dipetakan tampil
  di semua Company, dan itu memang disengaja.
- Menghapus baris hasil ekstraksi. Berkas PDF-nya sendiri tidak ikut terhapus,
  sehingga dokumen itu akan terbaca lagi sebagai entri baru pada sinkronisasi
  berikutnya.

Tidak ada kendali unggah di halaman ini. PDF job profile masuk lewat kartu
"Unggah Berkas Sumber" pada halaman Sinkronisasi.

#### Seksi Job Profile Match (menu Dokumen)

- Menjalankan pencocokan posisi aktif kandidat dengan job profile lewat tombol
  "Jalankan Pencocokan". Prosesnya sekitar lima sampai dua puluh detik.
- Membuka halaman dan langsung melihat hasil pencocokan terakhir. Hasil setiap
  run tersimpan, satu baris per Company, sehingga kunjungan berikutnya tidak
  perlu menunggu.
- Menjalankan ulang lewat tombol "Jalankan Ulang" bila data posisi atau job
  profile berubah.
- Membaca enam kartu statistik: Kandidat, Job Profile, Cocok, Posisi Aktif
  tanpa Profil, Kandidat Tanpa Profil, dan Profil Tanpa Incumbent. Tiga yang
  terakhir dapat diklik untuk melihat rinciannya.
- Membaca jalur kecocokan tiap pasangan: ID Posisi (nama file), Nama Posisi,
  Nama Berkas, Embedding di atas 98 persen, Manual, atau AI. Dua yang terakhir
  menyertakan persentasenya.
- Menyalakan "Cocokkan sisa dengan AI" agar jabatan yang tidak cocok lewat
  jalur deterministik dipasangkan AI dari daftar job profile terdekat.
- Menyaring per jalur, per job profile, per posisi kandidat, dan lewat
  pencarian bebas.
- Membuka detail sebuah pasangan, memasangkan manual, menimpa pemetaan
  otomatis, atau melepas pemetaan manual. Pemetaan manual tidak akan ditimpa
  pencocokan otomatis.
- Menyimpan hasilnya lewat "Simpan Pemetaan" agar dipakai fitur lain, yaitu
  saran job profile posisi dan peta job family hasil penilaian.

Perbedaan yang penting: menjalankan pencocokan tidak sama dengan menyimpan
pemetaan. Run adalah laporan; pemetaan adalah keputusan. Menjalankan ulang
tidak pernah diam-diam menulis ulang pemetaan yang sudah disimpan.

Bila yang tampil hanyalah pemetaan tersimpan tanpa run, halaman mengatakannya,
dua kartu yang hanya bisa dijawab sebuah run diisi tanda hubung, dan tombol
simpan dinonaktifkan.

Bila layanan embedding atau model AI tidak dapat dihubungi, halaman
mengatakannya. Jabatan sisa tetap tampil sebagai belum cocok, bukan
dipasangkan asal.

#### Seksi Kamus Kompetensi (menu Dokumen)

Seksi ini bersifat baca saja.

- Mencari kompetensi berdasarkan kode, nama, atau isi definisi.
- Membaca definisi dan tuntutan tiap level: Basic, Intermediate, Advance, dan
  Mastery.

Tombol pemetaan nama kompetensi tidak berada di sini, melainkan di halaman
Sinkronisasi, di dalam kartu "Pengetahuan AI".

#### Seksi Job Family (menu Posisi)

Halaman ini menyatakan pipelinenya sebagai tiga langkah berurutan, dan hanya
langkah yang perlu dikerjakan sekarang yang tombolnya menyala penuh.

1. Job profile terekstrak — sumber peta. Ditambah lewat menu Dokumen, bukan
   di sini.
2. Transformasi jadi angka — tombol "Jalankan Transformasi", atau "Jalankan
   Ulang" bila semuanya sudah jadi angka. Peta dibangun dari angka ini, bukan
   dari teks dokumen.
3. Peta job family — tombol "Bangun Peta", atau "Bangun Ulang" bila peta sudah
   ada.

Langkah yang sudah selesai tetap punya tombol, hanya tidak menyala; langkah
yang belum bisa dijalankan tidak punya tombol sama sekali, hanya keterangan
apa yang ditunggunya.

Kegiatan lain:

- Menelusuri anggota tiap rumpun jabatan dan meninjau outlier.
- Memetakan sebuah dokumen ke sebuah cluster.
- Membuka Pengaturan Job Family lewat tombol pada halaman peta.

#### Pengaturan Job Family (menu Posisi)

Halaman ini mengubah pengaturan dan tidak pernah mengubah peta. Itu
kesalahpahaman paling umum di halaman ini: menyimpan, kembali, lalu menemukan
peta yang sama. Kedua bagiannya diberi nomor sesuai langkah yang dilayaninya.

Panel optimasi adalah deretan tombol, bukan kotak percakapan. Tidak ada model
bahasa yang dipakai di sini sama sekali, dan itu memang disengaja: hal yang
mungkin diinginkan pengguna dari sebuah pengelompokan sudah terbatas dan sudah
terdaftar, sehingga kotak teks hanya akan menyisipkan tebakan di depan jawaban
yang sudah pasti.

Di puncak panel ada kartu yang menyatakan apakah peta terakhir masih sesuai
dengan korpus yang ter-embed sekarang. Setelah transformasi ulang, peta lama
menggambarkan dokumen atau vektor yang sudah berubah, dan kartu itu
menyebutkannya beserta alasannya. Kartu yang sama juga menyebutkan bila
parameter yang berlaku sudah berbeda dari parameter peta itu.

Langkah 1, memeriksa keadaan sekarang, lewat "Periksa keadaan sekarang" dan
"Rincian tiap outlier". Keduanya membaca peta terakhir. "Periksa keadaan
sekarang" juga menyebutkan sasaran yang paling sesuai, dengan tombol "Ukur
sasaran ini".

Langkah 2, memilih hasil yang diinginkan. Dua belas sasaran dikelompokkan
menjadi empat:

| Kelompok | Sasaran |
|---|---|
| Outlier | Kurangi outlier · Nol outlier · Sisakan yang benar-benar asing |
| Ukuran & jumlah famili | Perbesar cluster · Perkecil cluster · Lebih sedikit famili · Lebih banyak famili · Pecah famili raksasa · Hapus famili kekecilan · Ratakan ukuran |
| Penamaan | Perbaiki nama & kata kunci |
| Umum | Rapikan seadanya |

Menekan sebuah sasaran MENGUKUR, bukan menebak. Pengaturan yang berlaku dan
beberapa kandidatnya dijalankan pada korpus yang ter-embed sekarang, dengan
kode pengelompokan yang sama dengan pembangunan peta, tanpa menyimpan apa pun.
Arahkan kursor ke sebuah tombol sasaran untuk melihat ukuran yang dipakai
menilainya, misalnya "Kurangi outlier" tercapai bila persentase outlier turun
lebih dari 0,5 poin. Jawabannya salah satu dari empat:

| Jawaban | Artinya |
|---|---|
| Sasaran tercapai — terukur | Ada pengaturan yang mencapai sasaran tanpa memperburuk ukuran lain. |
| Sasaran tercapai, tetapi ada ukuran lain yang memburuk | Sasaran tercapai, dan kartu menyebutkan apa yang memburuk. |
| Sudah tercapai dengan pengaturan sekarang | Tidak ada yang perlu diubah. |
| Tidak tercapai dalam rentang aman | Tidak satu pun pengaturan dalam rentang amannya mencapai sasaran pada korpus ini. Tidak ada yang ditawarkan untuk diterapkan. |

Hanya pengaturan yang tercapai yang dapat diterapkan, lewat "Terapkan & bangun
ulang peta" atau "Simpan saja, bangun nanti". Tombol utama sengaja menyebutkan
pembangunan ulang, sebab menerapkan saja meninggalkan peta tidak berubah.
Penerapan ditolak bila korpus atau parameter berubah sesudah diukur; ukur ulang
lalu terapkan.

Setelah peta dibangun ulang dengan pengaturan itu, panel membandingkannya dengan
pengukuran. Pada korpus yang sama hasilnya harus sama persis, dan kartu "Peta
terakhir dibanding pengukuran" menyatakannya.

Penerapan berlaku untuk semua unit bisnis, dan halaman menyatakannya tepat di
samping tombol.

### 6.8 Sinkronisasi

Izin: sync.manage.

Sinkronisasi terjadwal berjalan otomatis setiap Senin pukul 01.00. Halaman ini
untuk menjalankannya lebih awal, mengunggah berkas, dan memeriksa apakah
datanya masih segar.

Kegiatan yang bisa dilakukan:

- Menjalankan sinkronisasi penuh untuk semua Company atau satu Company.
  Berkas tidak ikut; berkas diunggah lewat kartu tersendiri.
- Menjalankan satu modul saja, saat satu modul gagal atau datanya baru
  diperbaiki di sumber. Modulnya terbagi tiga kelompok.

| Kelompok | Modul |
|---|---|
| Database | Karyawan · Struktur Org · Position Mapping · Penilaian Kinerja · Grade Level · Kompetensi Perilaku |
| API Orange | Kedisiplinan · Pendidikan · Data Pribadi |
| Turunan | Kandidat |

  Kedisiplinan dan Pendidikan ditandai berjalan lama. Data Pribadi hanya
  menyimpan tanggal lahir, yang menjadi sumber usia kandidat.

- Membangun ulang data turunan kandidat dari nol. Record kandidat sendiri
  tetap dipertahankan beserta identitasnya, sehingga hasil penilaian, suksesor
  terpilih, dan cache skor aspek tidak hilang.
- Mengunggah berkas sumber yang tidak ditarik dari mana pun: job profile dan
  kamus kompetensi berupa PDF, serta HAV dan MCU berupa Excel. Mengunggah di
  sini adalah satu-satunya cara memasukkannya. Berkas dihapus dari server
  begitu isinya masuk database.
- Mengunggah Excel sebagai pengganti sumber untuk sepuluh modul yang biasanya
  ditarik dari database atau API. Ini berlaku sekali jalan: hanya memperbarui
  baris yang ada di berkas, lalu sinkronisasi terjadwal berikutnya kembali ke
  sumber aslinya. Setiap jenis punya templatnya sendiri lewat "Unduh template
  Excel".
- Mengelola koneksi database sumber.
- Memetakan Company ID sumber ke Company Pulse.
- Menjalankan pemetaan nama kompetensi ke kode kamus lewat tombol "Petakan",
  di dalam kartu Pengetahuan AI. Hasilnya dilaporkan per jalur: sama persis,
  deterministik, AI, dan belum dipetakan. Bila model tidak dapat dihubungi,
  halaman menegaskan bahwa itu bukan berarti tidak ada padanan; nama yang
  belum diputuskan tetap menunggu, bukan ditolak.
- Menjalankan embedding job profile dan kamus kompetensi.
- Membaca riwayat sinkronisasi, termasuk eksekusi yang gagal atau menghasilkan
  nol record.
- Mengosongkan seluruh data kandidat Company aktif sebelum mengunggah data
  sumber yang sudah diperbaiki. Ini bukan penghapusan permanen: riwayat
  penilaian tetap utuh dan kandidat muncul kembali dengan identitas yang sama
  setelah sinkronisasi kandidat berikutnya. Konfirmasinya mengharuskan
  mengetik HAPUS dengan huruf besar.
- Memulihkan kandidat yang baru dikosongkan tanpa menunggu sinkronisasi
  berikutnya.

Empat data tidak dapat diunggah karena diturunkan dari data yang sudah ada,
bukan ditarik dari mana pun: kandidat, divisi, departemen, dan tahap populasi
posisi.

Bila layanan sinkronisasi tidak dapat dihubungi, seluruh tombol sinkronisasi
dan unggah dinonaktifkan dan halaman mengatakannya.

### 6.9 Tata Kelola

Izin: governance.manage.

Halaman ini berisi empat seksi dalam dua kelompok. Setiap seksi menyatakan
cakupan berlakunya, sebab sebagian tersimpan per Company dan sebagian berlaku
untuk seluruh pemasangan. Pertanyaan "saya mengubah di Mulia, kenapa MSO ikut
berubah" berulang cukup sering sehingga jawabannya dipasang permanen.

| Seksi | Kelompok | Cakupan |
|---|---|---|
| Program Penilaian | Aturan Penilaian | Berlaku untuk Company aktif |
| Instruksi & Model AI | Aturan Penilaian | Berlaku untuk semua Company |
| Kesiapan & Pensiun | Aturan Penilaian | Berlaku untuk semua Company |
| Riwayat Perubahan | Pemantauan | Berlaku untuk Company aktif |

Perubahan di halaman ini berlaku untuk run berikutnya. Run yang sudah selesai
menyimpan aturannya sendiri dan tidak berubah.

#### Program Penilaian

- Memilih program lewat baris chip. Program bawaan sistem diberi lencana
  Built-in: boleh diubah, tidak bisa dihapus.
- Mengubah nama, deskripsi, dan Target Finalis.
- Mengubah aturan filter lewat "Ubah aturan filter": menambah aturan, menambah
  sub-grup, mengatur penghubung DAN atau ATAU, mengurutkan, dan menghapus.
  Setiap aturan punya Field, Operator, Nilai, Label, Pesan gagal, dan Akibat
  bila gagal, yaitu Menggugurkan atau Hanya menandai.
- Menyalakan atau mematikan penggugur otomatis. Bila mati, aturan filter tidak
  menggugurkan kandidat; hasilnya hanya dicatat.
- Mengatur bobot AHP. Bila program belum punya matriks sendiri, halaman
  menyatakan bahwa bobot bawaan sistem yang dipakai, menyebut angkanya, dan
  menjelaskan bahwa karena sebagian besar program memakai bobot yang sama,
  hasil antar-program tetap sebanding. Aktifkan hanya bila program ini memang
  perlu bobot berbeda. Tersedia tiga cara mengisinya: Urutan, Slider, dan
  Berpasangan, dengan indikator konsistensi.
- Membuat program baru dan menghapus program non-sistem. Run yang sudah
  selesai di bawah program yang dihapus tetap tersimpan beserta aturannya.

Semua perubahan disimpan lewat satu bilah lengket "Simpan program". Tombol
"Ubah" hanya membuka editor, dan tombol simpan mati bila tidak ada yang
berubah.

Talent Pool sengaja tidak muncul di pemilih program di halaman ini, sebab
tidak ada run yang pernah dijalankan di bawahnya sehingga tidak ada pembaca
untuk matriks maupun target finalisnya. Satu setelannya
yang benar-benar hidup, yaitu aturan filter, disunting di halaman Talent Pool.

#### Instruksi & Model AI

- Mengubah dua prompt di blok "Prompt AHP + TOPSIS", menyimpan versi, dan
  memulihkan versi lama: prompt kriteria Pendidikan (dipakai hanya bila
  pendidikan kandidat tidak persis sama dengan syarat job profile) dan prompt
  insight finalis (narasi keunggulan, kebutuhan pengembangan, dan arahan
  suksesi; tidak mengubah skor, peringkat, maupun kesiapan). Prompt lain tidak
  ditampilkan karena tidak ada yang membacanya lagi.

Yang sudah dihapus dari halaman ini: AI System Prompt per program, Konteks
Bisnis, dan seksi Umpan Balik AI. Tautan lama `?tab=contexts` membuka seksi
ini, dan `?tab=feedback` membuka Program Penilaian.

#### Kesiapan & Pensiun

- Mengubah ambang skor tingkat kesiapan: Short, Medium, Long, dan Not Ready.
- Mengubah ambang usia pensiun per level jabatan.
- Membuka referensi master grade per level, yang bersifat baca saja.

Pejabat yang tanggal lahirnya belum tersinkron tidak pernah ditandai. Bila
usianya masih kosong, jalankan sinkronisasi Data Pribadi lebih dulu.

#### Riwayat Perubahan

- Membaca siapa mengubah apa. Perubahan prompt dan ambang tidak tercatat di
  sini karena tersimpan sebagai berkas konfigurasi, bukan data Company.

### 6.10 Pengguna & Akses

Izin: users.manage.

- Menetapkan peran untuk tiap pengguna pada tab "Pengguna".
- Mengatur izin tiap peran pada tab "Peran & Akses".

Semuanya dikelola di dalam aplikasi ini. Keycloak hanya untuk login.

Peran Administrator selalu mempertahankan izin mengelola pengguna dan peran;
antarmuka tidak dapat mencabutnya.

## 7. SOP klik-per-klik: modul Penilaian

Modul ini dipilih untuk diuraikan terperinci karena merupakan alur inti
aplikasi dan satu-satunya yang menyentuh hampir semua modul lain.

Izin minimum: "Jalankan scoring" untuk menjalankan, "Kelola posisi" untuk
mendaftarkan kursi, "Kelola hasil analisis" untuk menindaklanjuti hasil.
Peran HR / Talent dan Analyst keduanya memenuhi syarat menjalankan; hanya
HR / Talent yang dapat mendaftarkan posisi baru.

### Langkah 0 — Prasyarat

1. Pastikan Company yang aktif sudah benar. Seluruh daftar disaring per
   Company.
2. Pastikan data HR sudah tersinkron. Bila belum, minta pemegang izin
   sinkronisasi menjalankannya lebih dulu.
3. Pastikan kursi yang akan dinilai sudah punya job profile. Cek di Manajemen
   Posisi: kursi tanpa job profile membawa lencana "Tanpa job profile", dan
   baris peringatan "N posisi belum punya job profile" di atas tabel dapat
   diklik untuk menyaring.

Jika kursi belum punya job profile, pasangkan lebih dulu lewat Dokumen →
Job Profile Match. Penilaian tetap bisa berjalan tanpa itu, tetapi aspek
Kompetensi Teknis dan Relevansi Karier akan dihitung dari kompetensi pemangku
jabatan, bukan dari tuntutan jabatan. Hasilnya sah, namun tidak sebanding
dengan posisi yang punya job profile.

### Langkah 1 — Pastikan posisi sudah terdaftar pada program yang benar

1. Buka menu "Manajemen Posisi".
2. Cari kursinya. Gunakan kotak "Cari posisi, current holder, departemen, atau
   divisi", atau saring lewat baris chip "Program posisi".
3. Bila kursi sudah ada, periksa lencana programnya. Satu posisi hanya bisa
   berada di satu program, dan program itu terkunci begitu posisi punya hasil
   penilaian. Untuk menilai jabatan yang sama di bawah program lain,
   tambahkan posisinya sekali lagi dengan program tersebut.
4. Bila kursi belum ada, klik "Tambah".

#### Mengisi dialog "Tambah posisi"

1. Pada "Program penilaian *", pilih programnya.
2. Pada "1. Cari berdasarkan Karyawan (Person) *", pilih nama pemangku
   jabatannya. Sistem akan mencari relasi datanya.
3. Pada "2. Cari berdasarkan Jabatan Master *", pilih nama jabatannya.
   Nama posisi, departemen, divisi, dan job profile akan terisi otomatis.
4. Periksa blok "Informasi Tambahan Posisi" yang bersifat baca saja.
5. Pada "Pilih dari Job Profile *", pastikan job profile yang tepat terpilih.
   Bila belum ada yang dipilih, muncul catatan kuning: kualifikasi dan
   kompetensi teknis akan terisi otomatis bila job profile dipilih, dan hasil
   penilaian AHP + TOPSIS menjadi lebih akurat.
6. Pada "Rentang Level Suksesor *", tetapkan "Level minimum" dan "Level
   maksimum". Kandidat dengan grade di luar rentang ini akan tersaring
   otomatis saat penilaian. Huruf pada grade diabaikan, misalnya 5a dibaca 5.
7. Klik "Simpan posisi".

#### Alternatif: mendaftarkan banyak kursi sekaligus

1. Klik "Tambah Batch".
2. Isi "Level pemangku jabatan minimum".
3. Isi "Program suksesi *". Rentang level suksesor akan ditampilkan mengikuti
   tujuan program.
4. Tinjau daftar "Jabatan yang akan ditambahkan". Perhatikan lencana "tanpa
   JD" dan "terdaftar".
5. Bila ingin langsung menilai, centang "Jalankan scoring AHP + TOPSIS
   otomatis". Satu run per posisi akan dikerjakan bergiliran di latar
   belakang; halaman ini tidak perlu dibiarkan terbuka.
6. Bila sebagian kursi belum punya job profile, muncul peringatan
   "N dari M jabatan belum punya job profile" beserta pilihan "Tetap jalankan
   scoring untuk N jabatan tanpa job profile". Bila tidak dicentang, posisinya
   tetap dibuat dan hanya penilaiannya yang ditunda sampai job profile-nya
   ada.
7. Klik tombol "Tambahkan N posisi + M scoring".

### Langkah 2 — Menjalankan penilaian

Ada dua pintu masuk. Dari Manajemen Posisi, klik ikon kalkulator pada baris
kursinya; posisinya akan terisi otomatis. Atau klik pintasan "Mulai Scoring"
di atas menu.

Halaman yang terbuka berjudul "Penilaian Talent". Prosesnya tiga fase:
konfigurasi, pemrosesan, selesai.

#### Fase konfigurasi

1. Pada "Program Penilaian *", pilih programnya.
2. Pada "Posisi Target Jabatan *", pilih kursinya. Hanya posisi yang terdaftar
   pada program tersebut yang ditampilkan. Bila kursi yang dicari tidak ada,
   berarti ia terdaftar di program lain, dan harus ditambahkan lebih dulu di
   Manajemen Posisi.
3. Tidak ada pilihan metode: setiap sesi dinilai dengan AHP + TOPSIS — enam
   aspek dihitung deterministik lalu diperingkat, dan hasilnya dapat
   direproduksi.
4. Isi "Nama Sesi (opsional)" bila ingin menandai sesi ini.
5. Pada "Unit Bisnis Kandidat", secara bawaan hanya unit saat ini yang
   disertakan. Pilih unit lain untuk menyertakan kandidat lintas unit; filter
   grade dan kelayakan tetap berlaku sama.
6. Bila ada yang perlu dikeluarkan sejak awal, klik "Atur" pada "Exclude
   Kandidat", lalu centang namanya. Pemangku jabatan saat ini sudah ditandai
   "Pejabat Saat Ini" dan tidak dapat dicentang, sebab ia memang dikecualikan
   dari kumpulan penggantinya sendiri.
7. Periksa panel kanan "Ringkasan Konfigurasi Sesi": target finalis, metode
   ("AHP + TOPSIS"), dan "Rentang Level". Pratinjau akan menyebutkan berapa kandidat berada
   dalam rentang grade dan berapa yang tersaring.
8. Klik "Mulai Penilaian".

#### Fase pemrosesan

Judul kartu berubah menjadi "Sedang memproses..." dengan bilah kemajuan.

Daftar tahapan "Tahapan Metode AHP + TOPSIS" berjalan
berurutan: memuat data kandidat dan job profile, lalu enam aspek satu per satu
(Technical Competency, Career Relevance, Behavior Competency, Performance
Appraisal, HAV Mapping, Education), lalu penghitungan bobot AHP dan
perangkingan TOPSIS, penulisan insight suksesi per finalis, penyimpanan hasil,
dan selesai.

#### Bila muncul kotak kuning "Sesi tersimpan dan menunggu layanan scoring"

Ini bukan kegagalan. Sesi dan barisnya sudah tersimpan, dan penilaian akan
mulai otomatis begitu layanan hidup kembali.

- Bila pesannya menyebut layanan tidak merespons, cukup tunggu, lalu buka
  kembali halaman ini.
- Bila pesannya menyebut layanan menolak permintaan beserta kode HTTP,
  layanannya sendiri hidup. Laporkan kode itu kepada admin.

Dalam kedua kasus, jangan memulai sesi baru. Membuat sesi baru hanya menambah
antrean untuk posisi yang sama.

#### Fase selesai

Klik "Lihat Hasil Peringkat" untuk membuka halaman posisi pada run tersebut.
Tombol "Ulangi Penilaian" mengembalikan wizard ke konfigurasi.

### Langkah 3 — Membaca hasil

Halaman detail posisi memiliki tujuh tab di sisi kiri: "Kandidat",
"Readiness", "Analisis Visual", "Komparasi", "Peta Job Family",
"Konfigurasi", dan "Komparasi Versi". "Konfigurasi" hanya muncul untuk run
AHP + TOPSIS. "Komparasi" membandingkan kandidat di dalam satu run;
"Komparasi Versi" (dulu "Perbandingan Run") membandingkan dua run dan memuat
keputusan forum. Tab "AI Assistant" saat ini disembunyikan. Tab yang dibuka
tersimpan di alamat halaman, sehingga memuat ulang halaman atau membagikan
tautannya membuka tab yang sama; tautan lama berisi `tab=perbandingan-run`
tetap membuka "Komparasi Versi".

1. Buka tab "Kandidat" untuk melihat peringkat, skor, dan rincian per aspek.
2. Pada kartu "Riwayat Scoring", pastikan run yang dibuka memang yang
   dimaksud. Gunakan tombol "Daftar" dan "Silsilah" untuk berpindah tampilan.
   Tampilan silsilah menampilkan seluruh keturunan run dan sengaja tidak
   mengikuti filter tanggal atau program, supaya tidak ada cabang yang tampak
   terputus padahal tidak.
3. Bila run yang dibuka adalah turunan, jejak "Silsilah" di atas peringkat
   akan menyebutkan mode dan satu kalimat tentang apa yang boleh menggeser
   peringkatnya. Bacalah kalimat itu sebelum menyimpulkan.
4. Buka tab "Readiness" untuk melihat "Pipeline Kesiapan Suksesi". Tanda
   plus sekian persen menunjukkan tambahan skor yang dibutuhkan untuk naik ke
   tingkat berikutnya.
5. Buka tab "Konfigurasi" untuk melihat aturan yang benar-benar berlaku pada
   run tersebut: aturan filter, kriteria, matriks AHP, target finalis, dan
   ambang kesiapan. Yang ditampilkan adalah konfigurasi yang dibekukan saat
   run dibuat, bukan konfigurasi hari ini. Bagian atasnya meringkas lima angka
   kunci (kandidat dinilai, finalis, konsistensi AHP, sumber bobot, tanggal
   acuan); klik salah satunya, atau chip pada bilah navigasi, untuk melompat ke
   seksi yang menjelaskannya. Seksinya berurutan: Identitas, Kandidat, Aturan
   filter, Bobot AHP, Kesiapan, Basis & parameter, Data & model, dan Cara
   dinilai.

### Langkah 4 — Menindaklanjuti temuan

#### Menandai kandidat yang sudah tidak relevan

1. Klik "Tandai dikecualikan" pada baris kandidat.
2. Pilih "Alasan": Pensiun, Resign, Sudah dipromosikan, Konflik kepentingan,
   atau Lainnya. Bila memilih Lainnya, "Keterangan" wajib diisi.
3. Klik "Tandai dikecualikan". Baris kandidat dicoret, diberi label "Ditandai
   dikecualikan (tidak memengaruhi angka)", dan dilewati oleh hitungan kandidat
   siap. Skor dan peringkat run tidak berubah, dan tidak ada run baru yang
   dibuat. Tidak ada kandidat yang otomatis naik menggantikannya; untuk
   memunculkan kandidat berikutnya (peringkat N+1 run ini), tambahkan ia lewat
   "Tambah Kandidat Pembanding" — karena ia sudah ada di pool, ia tidak dinilai
   ulang dan urutan run tidak berubah.
4. Untuk membatalkannya, klik "Batalkan tanda" dan tulis alasan pembatalan.
5. Tanda ini ikut ke setiap run "Tambah Kandidat Pembanding" yang dibuat dari
   run ini sesudahnya, berlabel "diwarisi". Membatalkannya di run turunan tidak
   mengubah run ini. Hanya kandidat yang ada di run ini yang dapat ditandai.

#### Menambah kandidat pembanding

1. Pilih run yang sudah selesai, lalu klik "Tambah Kandidat Pembanding" pada
   kartu "Riwayat Scoring". Bila tombolnya nonaktif, alasannya tertulis di
   bawahnya.
2. Cari karyawan dengan nama atau NPK. Pencarian mencakup seluruh divisi pada
   business unit run induk, dan dapat disaring menurut unit, posisi,
   departemen, grade, dan rumpun jabatan.
3. Pilih satu atau beberapa orang. Setiap orang menunjukkan status yang akan
   diterimanya dari server: "Akan dinilai baru", "Sudah ada di pool induk ·
   peringkat N · tidak dinilai ulang", "Perlu konfirmasi · di luar rentang
   grade", atau
   "Ditolak" beserta sebabnya (finalis run induk, data dihapus, kini pemegang
   jabatan target, tidak ditemukan, atau gagal aturan filter beserta aturannya).
4. Untuk orang yang perlu konfirmasi, centang "Tetap tambahkan walaupun
   grade-nya di luar rentang posisi target" bila forum memang memintanya.
5. Isi "Alasan / permintaan forum". Isian ini wajib, paling panjang 1.000
   karakter.
6. Baca ringkasannya: "Yang dipakai dari run induk" dan "Yang dinilai baru".
7. Klik "Tambah Kandidat Pembanding". Anda diarahkan ke run turunan, yang
   menampilkan tahapan prosesnya. Setelah selesai, banner di atas daftar
   menyebut kandidat yang ditambahkan, kandidat yang ditolak beserta
   alasannya, dan tautan perbandingan dengan induk.

#### Membandingkan dua run

1. Buka tab "Komparasi Versi". Bila alamat halaman belum menyebut pasangan,
   tab ini membuka run yang sedang dibuka sebagai B dan induknya sebagai A
   (atau root-nya, atau run sebelumnya bila tidak punya induk).
   Cara lain: pada kartu "Riwayat Scoring", klik "Silsilah", centang dua run,
   lalu klik "Bandingkan"; atau klik "Bandingkan dengan induk", "Bandingkan
   dengan root", atau "Bandingkan dengan run sebelumnya". Run yang lebih lama
   menjadi Run A (pembanding), dan halaman langsung berpindah ke tab ini.
2. Pilih pasangan lewat bilah A | B (kedua kartunya adalah pemilih run), atau
   klik "Pilih dari silsilah" untuk membuka pohon "Silsilah run" — pohon ini
   tertutup dengan sendirinya begitu pasangan sudah dipilih. Pada pohon, klik
   kartu untuk menjadikannya B, tekan tombol A pada kartu untuk menjadikannya
   A. Memilih run yang
   sudah ada di posisi lain menukar keduanya. Jalur A–B digambar tebal. Run
   gagal dan run yang masih berjalan bergaris putus-putus dan tidak dapat
   dipilih; arahkan kursor untuk melihat alasannya.
3. Untuk pohon besar: "Lipat cabang lain" menyisakan cabang yang memuat A dan
   B, "Buka semua" membuka kembali, dan "Perbesar" menambah tinggi area pohon.
   Pada bilah A | B, tombol panah di samping B memindahkan B ke saudara
   sebelumnya atau berikutnya (misalnya turunan 3 dari 12), dan "Jadikan A:
   Induk B / Root B / Run sebelumnya" mengganti pembandingnya. Bilah ini
   tetap terlihat saat halaman digulir.
4. Baca bagian "Ringkasan" lebih dulu. Paling atas adalah putusannya: siapa
   peringkat 1 di A dan B, jumlah kandidat dinilai A → B, dan empat fakta yang
   dapat diklik (peringkat bergeser, masuk/keluar N besar, kandidat pembanding,
   sumber perubahan). Di bawahnya "Mengapa A dan B berbeda", posisi suksesor
   yang dipilih forum di A dan B, grafik pergeseran, lalu lima sumber
   perubahan. Pada pasangan induk dan run pembanding, hanya komposisi pool
   (S1) yang boleh berbeda; bila sumber lain berbeda, tab menampilkan
   peringatan pelanggaran pembekuan di paling atas.
5. Telusuri bagian yang diperlukan: "Peringkat"; "Analisis" (pilih lensa Per
   kriteria, Per kandidat, atau Atribusi bertahap); "Konfigurasi & Pool"
   (pilih lensa Konfigurasi atau Pool); dan "Keputusan forum". Lalu klik
   "Ekspor XLSX" untuk arsip forum.
   "Salin tautan" menyalin alamat halaman berisi pasangan ini (parameter a
   dan b), yang selalu membuka isi yang sama. Tautan lama
   `/positions/[id]/compare?a=…&b=…` tetap bekerja dan dialihkan ke tab ini.

### Langkah 5 — Menetapkan suksesor

1. Pada baris kandidat terpilih, klik "Pilih Kandidat". Pejabat posisi ini
   tidak dapat dipilih.
2. Pada dialog "Tetapkan sebagai Suksesor", pilih "Program".
3. Isi "Justifikasi keputusan (wajib)", terutama bila kandidat yang dipilih
   bukan peringkat pertama run ini. Bila kandidat itu ditandai dikecualikan,
   centang konfirmasinya.
4. Klik "Simpan". Keputusan tersimpan bersama run yang menjadi dasarnya, dan
   tampil di "Rekomendasi sistem dan keputusan forum" pada tab "Perbandingan
   Run" (bagian "Keputusan forum"); bila bukan peringkat pertama,
   justifikasinya tampil sebagai "Alasan berbeda dari rekomendasi". Kartu run
   tersebut di pohon silsilah mendapat tanda keputusan forum.
5. Beberapa kandidat boleh ditetapkan untuk satu program yang sama.
6. Pada kartu "Kandidat Terpilih", atur urutan prioritas dengan ikon panah,
   sunting catatan, atau cetak daftarnya lewat "Cetak Kandidat".

Setelah ini, lencana "Suksesor" akan muncul pada orang tersebut di menu
Kandidat, dan kolom RTC pada Manajemen Posisi akan bertambah. Keduanya membaca
data pemilihan yang sama, jadi tidak mungkin berselisih.

### Langkah 6 — Mengarsipkan pembahasan

Tab "AI Assistant" saat ini disembunyikan, sehingga percakapan dan ekspornya
tidak tersedia di halaman posisi. Untuk arsip forum, pakai "Ekspor XLSX" pada
tab "Komparasi Versi" dan "Cetak Kandidat" pada kartu "Kandidat Terpilih".

Bila tab itu diaktifkan kembali: pada tab "AI Assistant", tanyakan hal yang
perlu didalami, lalu klik "Ekspor" untuk menyimpan percakapannya sebagai PDF,
Word, atau Excel. Jawaban yang sedang ditulis belum termasuk; tunggu sampai
selesai.

Berkas hasil ekspor memuat prosa tentang orang bernama dan berada di luar
kendali aplikasi. Dokumen itu mencantumkan run asalnya.

### Pemecahan masalah yang sering ditemui

**Posisi yang dicari tidak muncul di wizard.** Wizard hanya menampilkan posisi
yang terdaftar pada program yang dipilih. Tambahkan posisinya lebih dulu di
Manajemen Posisi dengan program tersebut.

**Program tidak bisa diubah pada posisi.** Program terkunci begitu posisi
punya hasil penilaian. Tambahkan posisinya sekali lagi dengan program lain.

**Penilaian tampak berhenti.** Periksa apakah muncul kotak kuning. Bila ya,
sesi sedang mengantre dan akan berjalan sendiri. Jangan memulai ulang.

**Semua kandidat gagal aturan filter.** Periksa aturan filter program di Tata
Kelola, dan rentang level suksesor pada posisi.

**Aspek teknis dan karier terasa aneh.** Periksa apakah kursi itu membawa
lencana "Tanpa job profile". Bila ya, kedua aspek itu dihitung dari kompetensi
pemangku jabatan, bukan dari tuntutan jabatan.

**Menu yang dibutuhkan tidak terlihat, atau halaman memantul ke Beranda.**
Peran Anda belum memuat izinnya. Hubungi administrator.

## 8. Hal yang permanen, tidak dapat dibatalkan, atau sering disalahpahami

### 8.1 Yang tidak dapat dibatalkan

| Tindakan | Akibat |
|---|---|
| Menghapus baris job profile | Baris hasil ekstraksi hilang permanen. Berkas PDF-nya tidak ikut terhapus, jadi dokumen akan terbaca lagi sebagai entri baru pada sinkronisasi berikutnya. |
| Membaca ulang job profile | Hasil ekstraksi yang sekarang diganti. |
| Menghapus posisi | Tidak dapat dibatalkan. |
| Menghapus program non-sistem | Tidak dapat dibatalkan. Run yang sudah selesai di bawahnya tetap tersimpan. |

Mengosongkan data kandidat terlihat berbahaya tetapi **bukan** penghapusan
permanen: riwayat penilaian tetap utuh dan kandidat kembali dengan identitas
yang sama setelah sinkronisasi berikutnya.

### 8.2 Yang terkunci setelah dipakai

Program sebuah posisi terkunci begitu posisi itu punya hasil penilaian. Sebuah
peringkat adalah penilaian yang dibuat di bawah aturan satu program, sehingga
memindahkannya akan mengubah arti riwayat itu. Untuk menilai jabatan yang sama
di bawah program lain, tambahkan posisinya sekali lagi dengan program
tersebut.

Nomor induk karyawan tidak dapat diubah lewat penyuntingan kandidat. Bila
memang salah, hapus kandidatnya dan biarkan sinkronisasi membuatnya kembali.

### 8.3 Yang tidak pernah berubah diam-diam

- Run yang sudah selesai tidak pernah diubah; basis data menolak setiap
  perubahan atasnya. Penambahan kandidat pembanding dan penilaian baru
  menghasilkan run baru. Penandaan dikecualikan dan keputusan forum disimpan
  terpisah dan tidak mengubah angka.
- Konfigurasi sebuah run dibekukan saat run dibuat. Mengubah program hari ini
  tidak mengubah penjelasan run kemarin.
- Menjalankan ulang pencocokan job profile tidak menulis ulang pemetaan yang
  sudah disimpan.
- Status MCU hanya menandai: ia tidak menggugurkan kandidat dan tidak
  mengubah skor maupun peringkat.

### 8.4 Kesalahpahaman yang paling sering terjadi

**"Penilaian gagal."** Kotak kuning bukan kegagalan. Sesi sudah tersimpan dan
akan berjalan sendiri. Membuat sesi baru hanya menambah antrean untuk posisi
yang sama.

**"Bench coverage di Beranda dan di Manajemen Posisi seharusnya sama."**
Keduanya memang berbeda ukuran. Beranda menghitung kandidat siap dibagi
kandidat yang pernah dinilai; Manajemen Posisi melaporkan keadaan bangku
cadangan dalam tiga keadaan yang saling lepas.

**"Incumbent coverage 100 persen berarti suksesi aman."** Tidak. Itu ukuran
kelengkapan data pejabat, bukan ketersediaan pengganti.

**"Critical gap terlalu besar."** Posisi yang belum pernah dinilai ikut
terhitung dengan coverage nol. Periksa dulu berapa posisi yang memang belum
punya run sama sekali.

**"Saya menyimpan pengaturan Job Family tetapi petanya sama saja."** Halaman
pengaturan memang tidak pernah mengubah peta. Gunakan tombol yang menyebutkan
pembangunan ulang.

**"Saya mengubah pengaturan di Mulia tetapi MSO ikut berubah."** Sebagian
pengaturan memang berlaku untuk seluruh pemasangan. Lencana cakupan di tiap
seksi Tata Kelola menyatakannya.

**"Menu yang saya butuhkan hilang."** Izin yang kurang membuat menu tidak
tampil dan halaman memantul ke Beranda tanpa pesan. Hubungi administrator.

**"Kandidat yang saya hapus muncul lagi."** Penghapusan massal dipulihkan oleh
sinkronisasi; penghapusan satu per satu dari halaman Kandidat tidak.

### 8.5 Kapan hasil penilaian tidak sebanding

- Kursi tanpa job profile. Aspek Kompetensi Teknis dan Relevansi Karier
  dihitung dari kompetensi pemangku jabatan, bukan dari tuntutan jabatan.
- Run ber-label "mode lama" "Tanding ulang finalis". Himpunan alternatifnya
  jauh lebih sempit dan seragam tinggi, sehingga beda kecil ikut membesar.
- Run yang dibuat sebelum sebuah perubahan metodologi. Setiap run menyimpan
  acuannya sendiri, dan tampilan menandai acuan yang sudah tidak berlaku
  sebagai aturan lama alih-alih menampilkannya seolah masih berlaku.
- Program dengan matriks bobot AHP sendiri. Sebagian besar program memakai
  bobot bawaan yang sama, dan justru itulah yang membuat hasil antar-program
  sebanding.

## Lampiran A — Matriks peran dan izin

Tanda centang berarti izin tersebut melekat pada peran itu.

| Izin | Administrator | HR / Talent | Analyst | Viewer |
|---|---|---|---|---|
| Lihat kandidat | ya | ya | ya | ya |
| Kelola kandidat | ya | ya | tidak | tidak |
| Lihat Manajemen Posisi | ya | ya | ya | ya |
| Kelola Manajemen Posisi | ya | ya | tidak | tidak |
| Lihat menu Dokumen & Posisi | ya | ya | ya | ya |
| Kelola menu Dokumen & Posisi | ya | ya | tidak | tidak |
| Jalankan scoring | ya | ya | ya | tidak |
| Kelola hasil analisis | ya | ya | ya | tidak |
| Kelola tata kelola | ya | tidak | tidak | tidak |
| Kelola sinkronisasi | ya | tidak | tidak | tidak |
| Kelola pengguna & peran | ya | tidak | tidak | tidak |

Izin kelola otomatis mencakup izin lihat pasangannya untuk kandidat,
Manajemen Posisi, serta Dokumen & Posisi.

Pengguna baru yang belum diberi peran tidak memperoleh izin apa pun. Peran
Viewer ditandai sebagai bawaan tetapi tidak pernah diterapkan otomatis.

## Lampiran B — Matriks menu dan izin

| Menu | Rute | Izin | Administrator | HR / Talent | Analyst | Viewer |
|---|---|---|---|---|---|---|
| Beranda | / | — | ya | ya | ya | ya |
| Manajemen Posisi | /positions | positions.view | ya | ya | ya | ya |
| Kandidat | /candidates | candidates.view | ya | ya | ya | ya |
| Talent Pool | /talent-pool | candidates.view | ya | ya | ya | ya |
| Mulai Scoring | /scoring/new | scoring.run | ya | ya | ya | tidak |
| Dokumen | /job-profiles | job_profiles.view | ya | ya | ya | ya |
| Posisi | /posisi | job_profiles.view | ya | ya | ya | ya |
| Tata Kelola | /governance | governance.manage | ya | tidak | tidak | tidak |
| Sinkronisasi | /settings/sync | sync.manage | ya | tidak | tidak | tidak |
| Pengguna & Akses | /settings/users | users.manage | ya | tidak | tidak | tidak |

Peran HR / Talent melihat kelompok Alur Kerja dan Data Referensi secara utuh,
dan tidak melihat kelompok Administrasi sama sekali.

Catatan untuk Talent Pool: membuka halaman hanya butuh izin lihat kandidat,
tetapi menyunting aturan filternya butuh izin kelola tata kelola. Jadi HR /
Talent, Analyst, dan Viewer dapat membuka halaman itu, sementara hanya
Administrator yang dapat mengubah aturannya.

## Lampiran C — Dokumen terkait di dalam repositori

Panduan ini melengkapi, bukan menggantikan, dokumen berikut.

| Dokumen | Isi |
|---|---|
| docs/kebutuhan-fungsional.md | Daftar 282 kebutuhan fungsional yang dipenuhi sistem, dengan telusur ke komponen pelaksananya |
| docs/panduan-fitur-halaman.md | Penjelasan tiap kartu dan angka pada Pengaturan Job Family, Katalog Job Profile, Tata Kelola, Kamus, Scoring Baru, dan Sinkronisasi |
| docs/katalog-tombol.md | Katalog tombol beserta dampaknya, dengan penanda khusus untuk tombol berdampak luas |
| docs/metodologi-laporan-scoring.md | Metodologi pelaporan hasil penilaian |
| docs/rumus-kriteria-ahp-topsis.md | Rumus tiap kriteria AHP dan TOPSIS |
| docs/optimasi-job-family.md | Arti tiap parameter BERTopic dan arah pengaruhnya |
| docs/hav-16-kuadran.md | Penurunan grid 16 kuadran HAV |
| docs/job-profile-tenant-scope.md | Kepemilikan dokumen job profile per Company |

Dua dokumen pertama tidak mencakup Beranda, Manajemen Posisi, Kandidat, Talent
Pool, dan halaman hasil analisis. Panduan inilah yang menutup bagian tersebut.

