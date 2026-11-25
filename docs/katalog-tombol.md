# Katalog Tombol — Aplikasi Pulse

Setiap tombol yang dapat ditekan user: apa yang dikerjakannya, **apa dampaknya** (data apa yang berubah, seberapa luas cakupannya, dapat dibatalkan atau tidak), izin yang dibutuhkan, dan kapan ia gagal atau nonaktif.

Tanda **⚠ BERDAMPAK LUAS** menandai tombol yang mengubah data bagi seluruh unit bisnis, menjalankan proses panjang, atau tidak dapat dibatalkan.

---

## Pengaturan Job Family (menu Posisi → seksi Job Family → tombol "Pengaturan Job Family") — rute /posisi/job-family/pengaturan (URL lama /family-configuration dan /job-profiles/job-family/pengaturan dialihkan)

Halaman ini hanya mengubah PENGATURAN, tidak pernah peta. Seksi 1 (Restrukturisasi Dokumen) baru berlaku setelah "Jalankan Transformasi" di halaman peta, seksi 2 (Parameter Pipeline) setelah "Bangun Ulang". Setiap tombol simpan di halaman ini menyimpan HANYA bagiannya sendiri — template global, template khusus satu job profile, atau parameter BERTopic. Server membaca versi konfigurasi aktif, mengganti bagian itu saja, lalu menyimpannya sebagai versi aktif baru; perubahan yang belum disimpan di bagian lain tetap di layar dan tetap bertanda "Belum disimpan".

### Tombol "Visual / Teks (pengalih di kanan atas kartu Template Restrukturisasi Dokumen)"

**Yang dikerjakan.** Mengganti cara menyunting template. **Visual** menampilkan satu kartu per bagian dokumen, dikelompokkan menjadi enam grup. **Teks** menampilkan template mentah apa adanya untuk diketik bebas.

**Dampak.** Hanya tampilan. Kedua mode menyunting draf yang sama, jadi berpindah mode tidak menghapus apa pun.

**Izin.** job_profiles.view

**Kapan nonaktif / gagal:**

- Selalu tersedia.

### Tombol "Template Global / Profil Spesifik (tab di kartu Template Restrukturisasi Dokumen)"

**Yang dikerjakan.** Memilih template mana yang disunting: template global (berlaku untuk semua job profile yang tidak punya template sendiri) atau template khusus satu job profile.

**Dampak.** Hanya tampilan. Perubahan yang belum disimpan di tab yang ditinggalkan tetap ada.

**Izin.** job_profiles.view

**Kapan nonaktif / gagal:**

- Selalu tersedia.

### Kontrol per bagian di editor Visual — sakelar, panah naik/turun, gagang seret, kotak teks bagian, dan "Sisipkan token"

**Yang dikerjakan.** Mengubah DRAF template, tidak menyimpan apa pun:

- **Sakelar mati** membuang bagian itu beserta baris judul di atasnya. **Sakelar hidup** menambahkan bagian itu di urutan paling akhir dengan teks bawaannya (`Label: {{token}}`).
- **Panah naik/turun** dan **gagang seret** memindahkan bagian beserta baris judulnya.
- **Kotak teks bagian** mengganti teks bagian itu saja, termasuk baris judul di atasnya.
- **Sisipkan token** menyisipkan `{{token}}` di posisi kursor pada kotak teks bagian itu.

Di tab Profil Spesifik, suntingan pertama membuat template khusus profil itu sebagai salinan template global yang sedang tampil, lalu menyunting salinannya. Template global tidak pernah berubah dari tab ini.

**Dampak.** Tidak ada sampai disimpan. Pratinjau di sebelah kanan langsung menampilkan hasilnya.

**Izin.** job_profiles.view untuk menyunting draf; menyimpannya butuh job_profiles.manage.

**Kapan nonaktif / gagal:**

- Panah dan gagang hanya ada pada bagian yang aktif.
- Teks tanpa token di atas sebuah bagian dianggap judul bagian itu dan ikut berpindah bersamanya. Teks tanpa token setelah bagian terakhir tetap di akhir. Tidak ada teks yang dibuang oleh operasi visual.
- Baris kosong dihapus oleh setiap operasi visual. Pembentuk dokumen membuang baris kosong berlebih juga, jadi hasil dokumennya tidak berubah karenanya.
- Baris yang memuat token yang sudah dipakai di atasnya, atau token yang tidak dikenal, diperlakukan sebagai teks biasa milik bagian di bawahnya. Token ganda tetap terbaca dua kali; token tak dikenal terbaca kosong.

### Tombol "Default (tab Template Global)"

**Yang dikerjakan.** Mengganti draf template global dengan template bawaan: 14 bagian berlabel, semua bagian kecuali ringkasan posisi dalam bagan organisasi.

**Dampak.** Hanya draf. Belum tersimpan sampai "Simpan Template" ditekan.

**Izin.** job_profiles.view

**Kapan nonaktif / gagal:**

- Selalu tersedia di tab Template Global.

### Tombol "Aktifkan Semua"

**Yang dikerjakan.** Menghidupkan setiap bagian yang masih mati: bagian-bagian itu ditambahkan di urutan paling akhir, dalam urutan baku, dengan teks bawaan. Bagian yang sudah aktif tetap pada urutan dan teksnya. Di tab Profil Spesifik tombol ini bekerja pada template khusus profil terpilih (membuatnya bila belum ada).

**Dampak.** Hanya draf.

**Izin.** job_profiles.view

**Kapan nonaktif / gagal:**

- Tidak berbuat apa-apa bila semua bagian sudah aktif.

### Tombol "Simpan Template (tab Template Global)" — ⚠ BERDAMPAK LUAS

**Yang dikerjakan.** Menyimpan HANYA template global. Template khusus yang belum disimpan dan parameter BERTopic yang belum disimpan tidak ikut. Server membaca versi konfigurasi aktif, mengganti template globalnya, lalu menyimpan hasilnya sebagai versi aktif baru (tidak membuat versi baru bila isinya sama). Notifikasi "Template global tersimpan."

**Dampak.** CAKUPAN GLOBAL: template ini menjadi dasar dokumen bagi SEMUA job profile yang tidak punya template khusus, di semua business unit. Profil yang punya template khusus tidak terpengaruh, termasuk yang template khususnya kebetulan sama dengan template global lama. Peta dan vektor belum berubah sampai "Jalankan Transformasi" lalu "Bangun Ulang" dijalankan; setelah transformasi, relevansi karier pada penilaian AHP+TOPSIS juga membaca dokumen baru ini. Tidak ada undo di layar; versi lama tetap tersimpan sebagai versi nonaktif di basis data.

**Izin.** job_profiles.manage

**Kapan nonaktif / gagal:**

- Nonaktif bila draf template global sama dengan yang tersimpan (tidak ada tulisan "Belum disimpan").
- Nonaktif selama penyimpanan atau embed lain di kartu ini berjalan, dan tanpa izin kelola.
- Ditolak dengan pesan "Template global harus memuat minimal satu token bagian, misalnya {{positionName}}." bila template kosong atau hanya berisi token yang tidak dikenal.

### Tombol "Pemilih "Pilih job profile…" (tab Profil Spesifik)"

**Yang dikerjakan.** Membuka daftar job profile yang dapat dicari berdasarkan nama jabatan atau divisi, lalu mengambil data hasil ekstraksi dokumen terpilih untuk pratinjau dan editor template khususnya.

**Dampak.** Hanya membaca. Suntingan yang belum disimpan pada profil yang ditinggalkan tetap ada di draf dan muncul lagi, bertanda "Belum disimpan", saat profil itu dipilih kembali.

**Izin.** job_profiles.view

**Kapan nonaktif / gagal:**

- Daftar dibatasi pada dokumen milik business unit aktif yang berstatus selesai dan sudah terekstrak; bertuliskan "Tidak ada job profile terekstrak" bila tidak ada.
- Nonaktif selama penyimpanan atau embed di kartu ini berjalan.
- Saat memuat tampil "Memuat data profil…"; bila gagal muncul "Gagal memuat data profil."

### Tombol "Simpan template khusus (tab Profil Spesifik)" — ⚠ BERDAMPAK LUAS

**Yang dikerjakan.** Menyimpan HANYA template khusus profil terpilih. Bila editornya berisi teks, teks itu menjadi template profil ini ("Template khusus tersimpan."). Bila dikosongkan, template khususnya dihapus dan profil ini kembali mengikuti template global. Template global, template profil lain, dan parameter BERTopic tidak ikut tersimpan.

**Dampak.** CAKUPAN: satu dokumen job profile, tetapi lintas business unit karena template khusus disimpan pada konfigurasi global (dikunci pada nomor dokumen). Sejak tersimpan, dokumen ini selalu dibentuk dengan templatenya sendiri — di pratinjau, saat embed satu profil, dan saat Jalankan Transformasi — dan tidak lagi mengikuti perubahan template global. Tidak meng-embed apa pun.

**Izin.** job_profiles.manage

**Kapan nonaktif / gagal:**

- Nonaktif bila template profil ini tidak punya perubahan yang belum disimpan.
- Nonaktif selama penyimpanan atau embed lain di kartu ini berjalan, dan tanpa izin kelola.
- Ditolak bila template berisi teks tetapi tidak memuat satu pun token bagian yang dikenal.

### Tombol "Hapus template khusus (tab Profil Spesifik)" — ⚠ BERDAMPAK LUAS

**Yang dikerjakan.** Menghapus template khusus profil terpilih, baik yang tersimpan maupun yang masih draf, dan LANGSUNG menyimpan penghapusannya (tanpa dialog konfirmasi). Notifikasi "Template khusus dihapus; profil ini kembali mengikuti template global."

**Dampak.** CAKUPAN: satu dokumen, lintas business unit. Vektor yang sudah tersimpan tidak berubah sampai dokumen itu di-embed ulang. Tidak ada undo di layar.

**Izin.** job_profiles.manage

**Kapan nonaktif / gagal:**

- Hanya muncul bila profil ini punya template khusus, tersimpan atau draf.
- Nonaktif selama penyimpanan atau embed lain di kartu ini berjalan, dan tanpa izin kelola.

### Tombol "Restrukturisasi & Embed (tab Profil Spesifik)" — ⚠ BERDAMPAK LUAS

**Yang dikerjakan.** 1) Bila template khusus profil ini punya perubahan yang belum disimpan, menyimpan template itu SAJA lebih dulu, supaya vektor dan template yang tersimpan cocok. 2) Membentuk dokumen profil ini dengan template khususnya, atau template global yang tersimpan bila tidak punya. 3) Meng-embed dokumen itu dan menimpa vektornya. Bila dokumen sumbernya sudah tidak ada, vektornya dihapus.

**Dampak.** CAKUPAN: satu baris pada penyimpanan vektor bersama, jadi berlaku bagi semua business unit dan bagi relevansi karier pada penilaian AHP+TOPSIS. Tidak membangun ulang peta. Tidak ada bagian konfigurasi lain yang ikut tersimpan.

**Izin.** job_profiles.manage

**Kapan nonaktif / gagal:**

- Nonaktif bila penyimpanan vektor (pgvector) belum siap — catatan "Embed profil butuh pgvector aktif."
- Nonaktif bila profil ini mengikuti template global SEDANGKAN template global punya perubahan yang belum disimpan. Embed memakai template global yang tersimpan, sehingga hasilnya akan berbeda dari pratinjau; simpan template global lebih dulu.
- Nonaktif selama penyimpanan atau embed lain di kartu ini berjalan, dan tanpa izin kelola.
- Gagal dengan pesan "Dokumen hasil restrukturisasi kosong — tidak ada yang di-embed." bila template menghasilkan teks kosong.
- Gagal dengan pesan alamat layanan bila layanan embedding tidak dapat dihubungi.

### Panel "Optimasi Job Family" (seksi 2 Pengaturan) — tombol sasaran, "Ukur sasaran ini", "Terapkan & bangun ulang peta", "Simpan saja, bangun nanti"

**Yang dikerjakan.** Di puncak panel ada kartu kesegaran peta: apakah peta terakhir masih menggambarkan korpus yang ter-embed sekarang (dibandingkan lewat sidik korpus yang dicatat setiap run), dan apakah peta itu dibangun dengan parameter yang berlaku. Bila sebuah peta dibangun dengan setelan yang diterapkan panel ini, ada pula kartu "Peta terakhir dibanding pengukuran". Sesudahnya panel dibaca dalam dua tahap bernomor. **Langkah 1 · Lihat keadaan peta sekarang** berisi dua tombol yang murni membaca PETA terakhir: "Periksa keadaan sekarang" (temuan mutu dan sasaran yang paling sesuai, dengan tombol "Ukur sasaran ini") dan "Rincian tiap outlier". **Langkah 2 · Pilih hasil yang Anda inginkan** berisi dua belas tombol sasaran ("Kurangi outlier", "Perbesar cluster", "Pecah famili raksasa", dan seterusnya). Menekan sebuah sasaran MENGUKUR, tanpa model bahasa: topic-service menjalankan kode pengelompokan yang sama dengan pembangunan peta pada korpus yang ter-embed sekarang, lebih dulu untuk pengaturan yang berlaku lalu untuk kandidatnya, paling banyak tiga putaran dan 16 pengaturan, tanpa menyimpan run apa pun. Kartu hasil menyatakan salah satu dari empat jawaban: "Sasaran tercapai — terukur", "Sasaran tercapai, tetapi ada ukuran lain yang memburuk", "Sudah tercapai dengan pengaturan sekarang", atau "Tidak tercapai dalam rentang aman". Kartu memuat ukuran yang dipakai menilai sasaran (sebelum → sesudah), keempat ukuran mutu lain, parameter yang berubah (nilai lama → nilai baru) beserta alasannya, dan seluruh pengaturan yang diukur. Hanya bila sasaran tercapai muncul dua tombol: "Terapkan & bangun ulang peta" (menyimpan lalu langsung membangun ulang peta global, dengan progres di panel) dan "Simpan saja, bangun nanti" (hanya menyimpan).

**Dampak.** Mengukur tidak menyimpan apa pun dan tidak mengubah peta. Menerapkan menyimpan HANYA parameter BERTopic yang diukur, berlaku GLOBAL untuk semua business unit, dan kalimat itu tercetak di samping tombolnya. Template dan pengaturan lain tidak ikut tersimpan. Pengukurannya ikut dicatat (`job_family_optimization_expectations`), sehingga peta yang kemudian dibangun dengan setelan itu, langsung maupun belakangan dari halaman Peta, dibandingkan dengan pengukurannya: sama persis, berbeda, atau dibangun dari korpus yang sudah berubah. Bila kartu Parameter Pipeline BERTopic di bawahnya memuat perubahan yang belum disimpan, panel menyebutkan bahwa yang diukur adalah pengaturan yang TERSIMPAN; perubahan itu tetap tampil bertanda "Belum disimpan" sesudah penerapan. Membangun ulang peta menggantikan hasil clustering yang dipakai seluruh aplikasi. Tanpa pembatalan di antarmuka; peta lama dapat diperoleh kembali hanya dengan membangun ulang memakai parameter sebelumnya.

**Izin.** Memeriksa dan mengukur: job_profiles.view. Menerapkan dan membangun ulang: job_profiles.manage (tombolnya nonaktif tanpa izin ini, dan alasannya tertulis di panel).

**Kapan nonaktif / gagal:**

- Semua tombol nonaktif selama satu aksi, satu pengukuran, atau pembangunan peta berjalan. Pengukuran dapat dihentikan dengan "Hentikan".
- "Belum ada run pengelompokan yang selesai" pada Langkah 1 — bangun peta lebih dulu. Tombol sasaran tetap dapat dipakai tanpa peta, karena mengukur korpus, bukan peta.
- Penerapan DITOLAK dengan pesan "Korpus berubah sejak diukur" bila ada transformasi yang selesai sesudah pengukuran, dan dengan "Parameter BERTopic sudah diubah sejak pengukuran dimulai" bila parameter disimpan orang lain di antaranya. Ukur ulang lalu terapkan.
- "Hasil pengukuran sudah kedaluwarsa atau topic-service dimulai ulang" — hasil pengukuran disimpan topic-service 30 menit. Ukur ulang.
- "Peta sedang dibangun ulang. Ukur setelah pembangunan selesai." — topic-service mengukur dan membangun peta bergantian. Pembangunan peta yang dimulai di tengah pengukuran didahulukan: pengukuran berhenti dengan pesan "Pengukuran dihentikan karena peta sedang dibangun ulang."
- Menutup tab menghentikan PEMANTAUAN, bukan pembangunan petanya; prosesnya tetap berjalan di layanan dan dapat dilihat di halaman Peta.

### Tombol "Simpan (kartu Parameter Pipeline BERTopic)" — ⚠ BERDAMPAK LUAS

**Yang dikerjakan.** Menyimpan HANYA parameter pengelompokan di kartu ini. Template global dan template khusus yang belum disimpan tidak ikut. Notifikasi "Parameter BERTopic tersimpan."

**Dampak.** CAKUPAN GLOBAL: menjadi versi aktif untuk semua business unit. Tidak mengubah embedding maupun peta yang sudah ada; hasilnya baru terlihat setelah peta dibangun ulang di halaman Peta Job Family. Perubahan di sini TIDAK memerlukan Jalankan Transformasi. Tanpa pembatalan di antarmuka.

**Izin.** job_profiles.manage

**Kapan nonaktif / gagal:**

- Nonaktif bila parameter di kartu sama dengan yang tersimpan (tidak ada tulisan "Belum disimpan"), selama menyimpan, dan tanpa izin kelola.
- Isian kosong pada min_samples, nr_topics, dan diversity disimpan sebagai "otomatis/nonaktif", bukan sebagai nol.
- Ditolak seluruhnya bila ada nilai yang tipenya salah atau bukan angka; tidak ada parameter yang tersimpan separuh.

## Dokumen Job Profile (menu "Dokumen" → seksi Dokumen Job Profile) — rute /job-profiles; Job Profile Match di /job-profiles/match, Kamus Kompetensi di /job-profiles/kamus (URL lama /job-profiles?tab=match dialihkan; Struktur Posisi sudah dihapus — /posisi/struktur, /job-profiles/struktur dan /job-profiles?tab=hierarchy dialihkan ke Peta Job Family)

### Tombol "Dokumen Job Profile / Job Profile Match / Kamus Kompetensi (seksi menu Dokumen)"

**Yang dikerjakan.** Mengganti tampilan antara katalog dokumen, pemetaan kandidat ↔ job profile, dan kamus kompetensi. Seksi Job Profile Match membuka HASIL PENCOCOKAN TERAKHIR untuk business unit aktif (tersimpan di basis data, lengkap dengan daftar posisi tanpa profil dan profil tanpa incumbent) tanpa menghitung apa pun; bila belum pernah ada pencocokan, yang tampil adalah pemetaan tersimpan (hanya pasangan) atau tombol "Jalankan Pencocokan". Menjalankan pencocokan (±20 detik, muncul "Menyiapkan laporan pencocokan…") MENGGANTI hasil tersimpan itu, jadi kunjungan berikutnya langsung memperlihatkan hasil baru. Seksi bisa dibuka langsung lewat tautan dari halaman lain.

**Dampak.** Hanya tampilan. Tidak ada data yang berubah.

**Izin.** Lihat menu Dokumen & Posisi (job_profiles.view) — sama dengan izin masuk halaman

**Kapan nonaktif / gagal:**

- Seksi Job Profile Match membuka hasil pencocokan terakhir yang tersimpan tanpa menghitung ulang; pencocokan baru hanya berjalan dari tombol "Jalankan Pencocokan" / "Jalankan Ulang". Jika gagal, muncul kartu "Gagal memuat pencocokan" dengan tombol Coba Lagi, dan hasil tersimpan sebelumnya tidak berubah.
- Pemuatannya bisa terasa lama pada percobaan pertama karena harus menghitung kemiripan makna seluruh judul.

### Tombol "Kotak "Cari posisi, divisi, nomor profil..." + filter Semua Status / Semua Folder / urutan (Terbaru Sinc, Nama Posisi, Divisi/Dep)"

**Yang dikerjakan.** Menyaring dan mengurutkan daftar dokumen di tab Job Profile. Penyaringan dilakukan di layar atas data yang sudah dimuat, dan selalu mengembalikan tampilan ke halaman 1.

**Dampak.** Hanya tampilan pada sesi pengguna ini. Tidak tersimpan dan tidak memengaruhi pengguna lain.

**Izin.** Lihat menu Dokumen & Posisi (job_profiles.view)

**Kapan nonaktif / gagal:**

- Pencarian mencocokkan nama berkas, nama posisi, divisi/departemen, dan nomor profil.
- Pilihan folder hanya berisi folder yang benar-benar ada pada dokumen yang terlihat oleh business unit aktif.
- Bila hasilnya kosong, muncul kartu "Tidak ada job profile ditemukan".

### Tombol "Ikon tampilan kartu / tampilan tabel"

**Yang dikerjakan.** Mengubah bentuk daftar dokumen antara grid kartu (8 per halaman) dan tabel (15 per halaman).

**Dampak.** Hanya tampilan; tidak disimpan antar kunjungan.

**Izin.** Lihat menu Dokumen & Posisi (job_profiles.view)

**Kapan nonaktif / gagal:**

- Mengubah mode selalu kembali ke halaman 1.

### Tombol "Kartu dokumen / tombol "Lihat" / tombol "Detail""

**Yang dikerjakan.** Membuka dialog detail dokumen job profile: isi ekstraksi terstruktur dalam enam tab, termasuk data mentah JSON dan path berkas sumber.

**Dampak.** Hanya membaca. Tidak ada perubahan data.

**Izin.** Lihat menu Dokumen & Posisi (job_profiles.view)

**Kapan nonaktif / gagal:**

- Untuk dokumen yang masih diproses, isi tidak tampil (pesan "Sedang Mengekstraksi Dokumen").
- Untuk dokumen gagal, hanya banner galat dan pesan "Gagal Membaca Data" yang tampil.

### Tombol "Salin JSON (di dialog detail)"

**Yang dikerjakan.** Menyalin seluruh data hasil ekstraksi dokumen ke papan klip dalam format JSON, lalu menampilkan notifikasi "JSON berhasil disalin".

**Dampak.** Tidak mengubah data apa pun; hanya menyalin ke papan klip komputer pengguna.

**Izin.** Lihat menu Dokumen & Posisi (job_profiles.view)

**Kapan nonaktif / gagal:**

- Tidak melakukan apa-apa bila dokumen belum punya data hasil ekstraksi (mis. status gagal atau masih diproses).

### Tombol "Hapus (ikon tempat sampah — pada kartu, baris tabel, dan dialog detail)" — ⚠ BERDAMPAK LUAS

**Yang dikerjakan.** Menampilkan konfirmasi "Apakah Anda yakin ingin menghapus data job profile ini?", lalu MENGHAPUS PERMANEN baris dokumen job profile dari basis data (bukan sekadar menyembunyikan), mencatatnya di log audit, dan menyegarkan halaman.

**Dampak.** Penghapusan bersifat GLOBAL / LINTAS BUSINESS UNIT — walaupun ditekan dari satu business unit, dokumen hilang untuk semua business unit. Ikut terhapus otomatis: kepemilikan folder dokumen tersebut, dan SEMUA baris pemetaan kandidat ↔ job profile yang menunjuk ke dokumen ini (sehingga saran otomatis job profile pada Position Management dan peta Job Family pada hasil scoring bisa kehilangan acuannya). TIDAK dapat dibatalkan dari aplikasi. Berkas PDF-nya sendiri tetap ada di folder berbagi, jadi pemulihan hanya bisa lewat menjalankan ulang sinkronisasi job profile — dokumen akan masuk lagi tetapi harus diekstraksi ulang oleh AI dan mendapat identitas internal BARU, sehingga pemetaan harus disimpan ulang dan penyematan folder manual (bila ada) perlu diatur ulang.

**Izin.** Kelola menu Dokumen & Posisi (job_profiles.manage)

**Kapan nonaktif / gagal:**

- Wajib melewati kotak konfirmasi peramban terlebih dahulu.
- Tombol dinonaktifkan selama proses hapus berjalan.
- Bagi pengguna tanpa izin kelola, tombol tetap terlihat tetapi aksinya ditolak di server; pada kasus ini pesan galat bisa tidak muncul dan tombol baris tersebut tetap nonaktif sampai halaman dimuat ulang.
- Pada tampilan kartu, tombol ini baru terlihat saat kursor diarahkan ke kartu.

### Tombol "Tutup Katalog (di dialog detail)"

**Yang dikerjakan.** Menutup dialog detail dokumen dan kembali ke daftar.

**Dampak.** Tidak ada perubahan data.

**Izin.** Lihat menu Dokumen & Posisi (job_profiles.view)

### Tombol "Sebelumnya / Selanjutnya (paginasi)"

**Yang dikerjakan.** Berpindah halaman daftar dokumen pada tab Job Profile.

**Dampak.** Hanya tampilan.

**Izin.** Lihat menu Dokumen & Posisi (job_profiles.view)

**Kapan nonaktif / gagal:**

- Hanya muncul di tab Job Profile dan hanya bila hasil filter lebih dari satu halaman.
- "Sebelumnya" nonaktif di halaman pertama, "Selanjutnya" nonaktif di halaman terakhir.

### Tombol "Pemilih business unit / tenant (tombol bergambar gedung di tab Job Profile Match)"

**Yang dikerjakan.** Membuka daftar centang business unit beserta jumlah kandidatnya dan kode company-nya. Mencentang atau melepas centang satu business unit LANGSUNG menjalankan ulang perhitungan pencocokan untuk gabungan business unit yang tercentang.

**Dampak.** Hanya mengubah cakupan laporan di layar (baca-saja) — tidak ada yang ditulis ke basis data. TETAPI cakupan ini menentukan isi laporan yang nantinya akan ditulis oleh tombol Simpan Pemetaan, jadi salah cakupan di sini berujung pada pemetaan tersimpan yang tidak lengkap.

**Izin.** Lihat menu Dokumen & Posisi (job_profiles.view)

**Kapan nonaktif / gagal:**

- Minimal satu business unit harus tetap tercentang — melepas centang yang terakhir diabaikan.
- Nonaktif selama perhitungan sedang berjalan.
- Pemilih ini tidak muncul bila daftar business unit gagal dimuat; laporan lalu memakai cakupan awal (business unit aktif di sidebar).
- Saat pertama dibuka, yang tercentang hanya business unit aktif di sidebar.

### Tombol "Jalankan Sinkronisasi (tab Job Profile Match)"

**Yang dikerjakan.** Menghitung ULANG seluruh pencocokan untuk business unit yang sedang tercentang: mengambil kandidat aktif beserta posisi aktifnya, mengambil dokumen JD yang sudah selesai diekstraksi, lalu menjalankan empat jalur pencocokan (kode nama berkas → judul persis → kemiripan makna di atas 98% → AI) dan menyusun ulang semua angka statistik serta ketiga daftar rinciannya. Menampilkan notifikasi "Sinkronisasi pencocokan selesai."

**Dampak.** Menulis SATU hal ke basis data: hasil pencocokan ini disimpan sebagai "hasil terakhir" business unit aktif (tabel `job_profile_match_runs`, satu baris per business unit, menggantikan hasil sebelumnya), sehingga kunjungan berikutnya ke seksi ini langsung memperlihatkannya tanpa menghitung ulang. Yang TIDAK disentuh adalah pemetaan yang dipakai sistem lain (`job_family_matches`) — itu tetap hanya berubah lewat Simpan Pemetaan, jadi menjalankan ulang tidak pernah diam-diam mengubah saran job profile atau peta job family. Tidak ada yang perlu dibatalkan: menjalankan lagi cukup menimpa hasil tersimpan. Tombol yang sama muncul sebagai "Jalankan Ulang" pada banner hasil terakhir di atas laporan.

**Izin.** Lihat menu Dokumen & Posisi (job_profiles.view)

**Kapan nonaktif / gagal:**

- Nonaktif selama proses berjalan (tombol berubah menjadi "Menjalankan...").
- Bila layanan embedding tidak dapat dihubungi, muncul peringatan "pencocokan embedding (>98%) dilewati" dan hasil hanya memakai dua jalur pertama — jumlah "Cocok" bisa turun dibanding biasanya.
- Bila terjadi galat lain, muncul notifikasi merah dan laporan lama tetap ditampilkan.
- Tidak menarik PDF baru dari folder berbagi — penambahan dokumen baru dilakukan lewat menu Sinkronisasi, bukan tombol ini.

### Tombol "Kotak centang "Cocokkan sisa dengan AI" (tab Job Profile Match)"

**Yang dikerjakan.** Menyalakan/mematikan jalur AI, lalu langsung menjalankan ulang pencocokan. Saat menyala, jabatan yang tidak tertangani jalur kode berkas / judul persis / embedding >98% diserahkan ke model AI lokal (LLM_BASE_URL), yang memilih satu JD dari sekitar 10 JD terdekat atau menyatakan tidak ada yang cocok.

**Dampak.** Tidak menulis pemetaan apa pun — pemetaan tersimpan lewat tombol "Simpan Pemetaan". Yang ditulis jalur AI hanyalah CATATAN KEPUTUSANNYA per nama jabatan, supaya sinkronisasi berikutnya memberi hasil sama dan AI tidak dipanggil ulang untuk jabatan itu. Keputusan berkeyakinan rendah dicatat sebagai "tidak ada yang cocok".

**Izin.** Lihat menu Dokumen & Posisi (menjalankan); menyimpan hasilnya tetap menuntut Kelola menu Dokumen & Posisi.

**Kapan nonaktif / gagal:**

- Nonaktif selama sinkronisasi berjalan.
- Bila LLM_BASE_URL/LLM_MODEL belum diatur atau layanan model mati, muncul peringatan kuning dan jalur AI dilewati — jabatan sisa tetap tercatat belum cocok.
- Bila jabatan yang perlu dinilai AI sangat banyak, sebagian ditunda ke sinkronisasi berikutnya dan jumlahnya diberitahukan lewat notifikasi.
- Pin manual tidak pernah ditimpa jalur AI; koreksi hasil AI lewat "Timpa manual" pada dialog detail pasangan.

### Tombol "Simpan Pemetaan (tab Job Profile Match)" — ⚠ BERDAMPAK LUAS

**Yang dikerjakan.** Menulis hasil pencocokan yang sedang tampil ke tabel pemetaan permanen. Prosesnya dalam satu transaksi: pertama MENGHAPUS seluruh baris pemetaan lama yang pemiliknya adalah kandidat yang masih aktif (baris milik kandidat yang sudah diarsipkan sengaja dipertahankan sebagai riwayat), lalu memasukkan satu baris untuk setiap pasangan pada laporan — berisi kandidat, business unit, company, posisi kandidat, kode posisi, dokumen JD, jalur kecocokan, nilai kemiripan, nomor JD, dan nama berkas. Menampilkan notifikasi "Tersimpan N pemetaan ke database" dan memperbarui badge "n tersimpan".

**Dampak.** Menulis data lintas business unit dan bersifat MENGGANTI (bukan menambah). Karena penghapusan awal mencakup semua kandidat aktif dari SEMUA business unit sementara yang dimasukkan hanya pasangan dari business unit yang sedang tercentang, menyimpan dengan hanya satu business unit tercentang akan MENGHAPUS pemetaan tersimpan milik business unit lain. Satu kandidat hanya boleh punya satu baris pemetaan. Hasil simpanan langsung dipakai di tempat lain: saran otomatis "Pilih dari Job Profile" pada Position Management dan form Tambah/Edit Posisi, peta Job Family pada halaman hasil scoring, daftar incumbent pada Family Tree, serta bukti karier/keluarga jabatan saat penilaian scoring. TIDAK ada riwayat versi dan TIDAK dapat dibatalkan; pemulihannya adalah mencentang kembali semua business unit yang diperlukan, menjalankan sinkronisasi, lalu menyimpan ulang.

**Izin.** Kelola menu Dokumen & Posisi (job_profiles.manage)

**Kapan nonaktif / gagal:**

- Nonaktif bila laporan belum punya satu pun pasangan, dan selama proses simpan berjalan.
- Yang disimpan adalah SELURUH pasangan pada laporan, bukan hanya yang sedang lolos filter/pencarian di layar.
- Bila tabel pemetaan belum pernah dimigrasikan, muncul pesan bahwa tabelnya belum ada dan tidak ada yang tersimpan.
- Pengguna tanpa izin kelola akan menerima notifikasi merah berisi pesan penolakan akses.
- Tidak ada konfirmasi tambahan — sekali diklik, pemetaan lama langsung digantikan.

### Tombol "Kartu statistik "Posisi Aktif" (dapat diklik)"

**Yang dikerjakan.** Membuka modal "Posisi aktif tanpa job profile" berisi daftar judul posisi aktif yang belum punya dokumen JD, dengan kotak pencarian.

**Dampak.** Hanya membaca; data sudah ada di laporan yang dimuat.

**Izin.** Lihat menu Dokumen & Posisi (job_profiles.view)

**Kapan nonaktif / gagal:**

- Isi daftar mengikuti business unit yang tercentang pada saat laporan terakhir dijalankan.

### Tombol "Kartu statistik "Kandidat Tanpa Profil" (dapat diklik)"

**Yang dikerjakan.** Membuka modal daftar kandidat yang tidak menemukan JD, dengan filter skenario (Tanpa posisi aktif / Posisi tanpa JD cocok) dan pencarian.

**Dampak.** Hanya membaca.

**Izin.** Lihat menu Dokumen & Posisi (job_profiles.view)

**Kapan nonaktif / gagal:**

- Bila tidak ada kandidat bermasalah, tampil pesan "Semua kandidat cocok dengan job profile."

### Tombol "Kartu statistik "Profil Tanpa Incumbent" (dapat diklik)"

**Yang dikerjakan.** Membuka modal daftar dokumen JD yang tidak dipegang kandidat mana pun, dengan filter skenario (Kandidat tenant lain / Incumbent non-kandidat / Tanpa incumbent aktif) dan pencarian.

**Dampak.** Hanya membaca.

**Izin.** Lihat menu Dokumen & Posisi (job_profiles.view)

**Kapan nonaktif / gagal:**

- Bila kosong, tampil pesan "Semua job profile punya kandidat incumbent."

### Tombol "Baris kandidat pada modal "Kandidat tanpa job profile" (klik untuk membentang)"

**Yang dikerjakan.** Membentangkan baris dan mengambil dua hal sekaligus: kartu diagnosis "Kenapa kandidat ini tanpa job profile?" (menelusuri kode posisi, judul posisi, kecocokan kode nama berkas, kecocokan judul, plus daftar JD berkode awalan sama) dan detail lengkap kandidat beserta konteks posisinya.

**Dampak.** Hanya membaca; tidak ada data yang berubah.

**Izin.** Lihat menu Dokumen & Posisi (job_profiles.view)

**Kapan nonaktif / gagal:**

- Data diambil satu kali saat pertama dibentangkan.
- Bila gagal, muncul teks "Gagal memuat detail kandidat."; bila diagnosis gagal, bagian detail tetap tampil tanpa kartu diagnosis.

### Tombol "Baris job profile pada modal "Job profile tanpa incumbent kandidat""

**Yang dikerjakan.** Membuka dialog detail dokumen JD tersebut, dengan kartu diagnosis "Kenapa profil ini tanpa incumbent?" di bagian atas — memuat penelusuran kode nama berkas, nama posisi, daftar orang yang benar-benar menduduki posisi itu beserta statusnya (kandidat business unit terpilih / kandidat business unit lain / non-kandidat), dan daftar alasan berbahasa manusia.

**Dampak.** Hanya membaca.

**Izin.** Lihat menu Dokumen & Posisi (job_profiles.view)

**Kapan nonaktif / gagal:**

- Diagnosis dihitung terhadap business unit yang tercentang pada laporan terakhir — mencentang business unit lain dapat mengubah kesimpulannya.
- Bila dokumen tidak ditemukan, muncul notifikasi "Job profile tidak ditemukan."

### Tombol "Kartu pasangan Kandidat ↔ Job Profile (klik untuk membuka detail)"

**Yang dikerjakan.** Membuka dialog berisi alasan kecocokan sesuai jalurnya (kode nama berkas / judul persis / kemiripan makna), informasi kandidat, dan isi lengkap job profile yang dipasangkan.

**Dampak.** Hanya membaca.

**Izin.** Lihat menu Dokumen & Posisi (job_profiles.view)

**Kapan nonaktif / gagal:**

- Untuk pasangan lewat jalur judul persis, blok informasi kandidat sengaja tidak ditampilkan karena dasar kecocokannya adalah dokumen JD.
- Bagian yang gagal dimuat ditampilkan sebagai "Detail kandidat tidak tersedia" atau "Job profile tidak ditemukan".

### Tombol "Filter jalur kecocokan / Semua Job Profile / Semua Posisi Kandidat + kotak "Cari..." (tab Job Profile Match)" — ⚠ BERDAMPAK LUAS

**Yang dikerjakan.** Menyaring daftar pasangan yang ditampilkan; jumlah hasilnya tampil sebagai "n hasil".

**Dampak.** Hanya tampilan. PENTING: filter ini tidak memengaruhi apa yang ditulis tombol Simpan Pemetaan — yang tersimpan tetap seluruh pasangan pada laporan.

**Izin.** Lihat menu Dokumen & Posisi (job_profiles.view)

**Kapan nonaktif / gagal:**

- Angka dalam kurung pada tiap pilihan menunjukkan jumlah pasangan untuk pilihan tersebut.
- Bila hasil kosong, muncul "Tidak ada hasil untuk filter ini."

### Tombol "Muat Ulang (pada kartu "Gagal memuat pencocokan")"

**Yang dikerjakan.** Mencoba lagi mengambil laporan pencocokan awal beserta daftar business unit.

**Dampak.** Hanya membaca; tidak menulis data.

**Izin.** Lihat menu Dokumen & Posisi (job_profiles.view)

**Kapan nonaktif / gagal:**

- Hanya muncul saat pemuatan awal tab Job Profile Match gagal.

## Tata Kelola (rute /governance) — dibuka juga lewat tautan langsung /governance?tab=programs|prompts|readiness|audit (tab lama contexts → prompts, grades → readiness, feedback → programs)

**Tombol yang sudah dihapus** bersama metode AI Tournament (November 2026), sehingga tidak dikatalogkan lagi: editor Kriteria Penilaian ("Edit / Tutup + Tambah kriteria" — daftar kriteria program kini tanpa editor dan tidak dibaca mesin mana pun), semua tombol AI System Prompt program ("Generate → Buat Prompt / Buat dengan Gemini", "Preview / Edit", "Simpan Versi", "Riwayat", "Gunakan", hapus versi), semua tombol Konteks Bisnis ("Tambah", sunting, hapus), dan semua tombol Umpan Balik AI (kartu filter koreksi dan hapus koreksi), beserta izin `scoring.feedback`.

### Tombol "Buat program baru → Buat Program" — ⚠ BERDAMPAK LUAS

**Yang dikerjakan.** Membuka formulir berisi Kode, Nama, Target Finalis, dan Deskripsi, lalu membuat satu program baru untuk business unit yang sedang aktif. Program baru dibuat tanpa aturan filter, tanpa kriteria, tanpa matriks AHP, dengan hard-filter dalam keadaan aktif dan metode bawaan SAW. Pembuatannya dicatat di Audit Log.

**Dampak.** Menambah satu program yang langsung dapat dipilih semua pengguna business unit ini saat memulai scoring. Cakupan: satu business unit. Dapat dibatalkan dengan menghapus program tersebut (program buatan sendiri boleh dihapus).

**Izin.** Kelola tata kelola

**Kapan nonaktif / gagal:**

- Kode dan Nama wajib diisi; kosong akan ditolak dengan pesan kesalahan.
- Kode harus unik di dalam business unit — memakai kode yang sudah ada akan gagal.
- Target Finalis dibatasi 1–50; nilai di luar rentang dipangkas ke batas terdekat.
- Aturan filter dan bobot AHP baru bisa diatur setelah program terbentuk.

### Tombol "Simpan (di kepala kartu program)"

**Yang dikerjakan.** Menyimpan sekaligus SELURUH perubahan program yang sedang dibuka: nama, deskripsi, target finalis, seluruh susunan aturan filter, sakelar hard-filter, dan matriks bobot AHP. Perubahan dicatat di Audit Log beserta daftar bagian yang berubah.

**Dampak.** Mengubah satu baris program. Semua run scoring BERIKUTNYA di business unit ini yang memakai program tersebut akan mengikuti aturan baru; run yang sudah selesai tidak berubah. Cakupan: satu business unit. Aturan filter dan matriks AHP tidak punya riwayat versi, sehingga nilai lama harus diketik ulang secara manual bila ingin dikembalikan.

**Izin.** Kelola tata kelola

**Kapan nonaktif / gagal:**

- Program harus milik business unit yang sedang aktif.
- Ditolak bila matriks AHP yang DIUBAH tidak lolos validasi: ada nilai di luar skala Saaty, tidak resiprokal, atau rasio konsistensi (CR) lebih dari 0,1 — pesan kesalahan menyebutkan pasangan dan angkanya. Matriks yang tidak diubah (dibandingkan dengan yang tersimpan di basis data) dibiarkan apa adanya, sehingga program dengan matriks lama tetap bisa disimpan untuk perubahan lain.
- Program bawaan (Built-in) tetap boleh disimpan/diubah.
- Semua penyuntingan aturan filter dan bobot AHP baru benar-benar tersimpan setelah tombol ini ditekan.

### Tombol "Hapus (program)" — ⚠ BERDAMPAK LUAS

**Yang dikerjakan.** Meminta konfirmasi di browser, lalu menghapus program secara permanen. Penghapusan dicatat di Audit Log.

**Dampak.** Program hilang dari pilihan saat memulai scoring bagi seluruh pengguna business unit ini. Run scoring lama TIDAK ikut terhapus, tetapi kehilangan kaitan ke program sehingga nama programnya tampil kosong di riwayat. Cakupan: satu business unit. TIDAK dapat dibatalkan.

**Izin.** Kelola tata kelola

**Kapan nonaktif / gagal:**

- Tombol hanya muncul untuk program buatan sendiri; program bawaan (Built-in) tidak menampilkannya dan tetap ditolak bila dicoba.
- Program harus milik business unit yang sedang aktif.

### Tombol "Edit / Tutup (Aturan Filter)"

**Yang dikerjakan.** Membuka atau menutup mode penyuntingan susunan aturan. Tidak menyimpan apa pun.

**Dampak.** Tidak ada perubahan data. Cakupan: tampilan layar Anda saja.

**Izin.** Kelola tata kelola (untuk membuka halaman)

**Kapan nonaktif / gagal:**

- Perubahan yang dilakukan di dalam mode edit baru tersimpan setelah menekan Simpan di kepala kartu program; meninggalkan halaman akan membuangnya.

### Tombol "Terapkan sebagai Hard-Filter (auto-gugur) — sakelar" — ⚠ BERDAMPAK LUAS

**Yang dikerjakan.** Menentukan apakah aturan filter menggugurkan kandidat secara otomatis. Aktif: kandidat yang gagal aturan filter dikeluarkan dari penilaian dan masuk daftar 'Tidak Lolos' dengan pesan alasannya. Nonaktif: aturan tidak menggugurkan siapa pun; hasilnya hanya dicatat.

**Dampak.** Mengubah komposisi kandidat yang dinilai pada run berikutnya bagi seluruh pengguna business unit ini. Cakupan: satu program di satu business unit. Dapat dibatalkan dengan mengembalikan sakelar dan menyimpan lagi.

**Izin.** Kelola tata kelola

**Kapan nonaktif / gagal:**

- Baru berlaku setelah menekan Simpan di kepala kartu program.
- Bila aturan terlalu ketat sehingga tidak ada satu pun kandidat lolos, memulai scoring akan gagal dengan pesan yang menyarankan melonggarkan aturan atau menonaktifkan sakelar ini.

### Tombol "Tambah aturan / Tambah sub-grup / DAN-ATAU / panah naik-turun / ikon hapus (editor filter)" — ⚠ BERDAMPAK LUAS

**Yang dikerjakan.** Menyusun struktur syarat kelayakan: menambah baris aturan, menambah grup bersarang, mengganti penghubung grup antara DAN dan ATAU, mengurutkan, atau membuang aturan/grup. Semua hanya mengubah tampilan sementara di layar.

**Dampak.** Belum ada data yang berubah sampai Simpan ditekan; setelah disimpan, susunan ini menentukan siapa yang lolos ke penilaian bagi seluruh pengguna business unit. Cakupan: satu program di satu business unit. Dapat diubah kembali kapan saja.

**Izin.** Kelola tata kelola

**Kapan nonaktif / gagal:**

- Grup kosong dianggap tidak memberi syarat apa pun (semua lolos).
- Operator 'belum kadaluarsa'/'sudah kadaluarsa' tidak memerlukan nilai.
- Pilihan nilai berasal dari daftar baku aplikasi digabung nilai nyata pada data kandidat unit ini; mengetik nilai bebas berisiko tidak pernah cocok karena penulisan huruf harus persis.

### Tombol "Atur Bobot AHP"

**Yang dikerjakan.** Mengaktifkan bobot khusus program dengan kondisi awal mengikuti bobot bawaan sistem yang **dibulatkan ke skala Saaty**, lalu membuka mode Slider. Karena dibulatkan, bobot awalnya tidak persis 35/25/20/10/5/5, melainkan Teknis 26,09 % · Karier 4,97 % · Behavior 34,37 % · PA 9,43 % · HAV 20,17 % · Pendidikan 4,97 % (CR 0,0054). Program yang tidak pernah menekan tombol ini tetap memakai bobot bawaan persis.

**Dampak.** Belum menyentuh data sampai Simpan ditekan. Setelah disimpan, bobot inilah yang dipakai run AHP + TOPSIS berikutnya, menggantikan bobot bawaan sistem. Cakupan: satu program di satu business unit. Dapat dibatalkan lewat tombol menonaktifkan bobot khusus.

**Izin.** Kelola tata kelola

**Kapan nonaktif / gagal:**

- Tombol hanya muncul bila bobot khusus belum aktif.

### Tombol "1 Urutan / 2 Slider / 3 Berpasangan (peralihan mode bobot AHP)"

**Yang dikerjakan.** Berpindah antara tampilan satu matriks yang sama. Isinya selalu 15 penilaian pada skala Saaty (1/9 … 1 … 9); bobot, CR, posisi slider, dan urutan selalu dihitung dari matriks itu (docs/ahp-input-sync.md):

1. **Urutan** — seret keenam kriteria dari terpenting (atas) ke paling tidak penting (bawah). Nilai bobot yang ada dipindahkan mengikuti urutan baru, lalu ke-15 penilaian ditulis ulang pada skala Saaty dan bobotnya dihitung ulang. Pembulatan dapat membuat dua kriteria **seri** (ditandai "2 =" dan "seri"), tetapi tidak pernah membalik urutan yang diseret.
2. **Slider** — satu penggeser bobot per aspek dalam persen, 2–65 % (batas yang dapat dicapai skala Saaty). Saat dilepas, hanya kelima penilaian aspek itu yang dibulatkan ke skala Saaty; slider lalu melompat ke bobot hasil hitung ulang. Bila posisi yang dipilih tidak mengubah satu penilaian pun, slider maju ke titik terdekat yang mengubahnya.
3. **Berpasangan** — 15 perbandingan dua-dua (tampilan Daftar atau Matriks), diketik 1–9 lalu Enter atau pindah sel; 1 = sama penting. Segitiga kiri-bawah Matriks adalah kebalikan yang tersimpan (2 tertulis "2", 1/2 tertulis "1/2").

**Dampak.** Semua mode menyimpan satu bentuk yang sama, dan berpindah mode tidak mengubah apa pun. **Urutan** mengganti seluruh penilaian berpasangan; **Slider** hanya penilaian aspek yang digeser. Setiap pembulatan diumumkan per pasangan, misalnya "Karier vs HAV: 1 → 2". Cakupan: satu program di satu business unit, dan baru berlaku setelah Simpan.

**Izin.** Kelola tata kelola

**Kapan nonaktif / gagal:**

- Urutan dan Slider TIDAK lagi dijamin CR = 0, karena nilainya dibulatkan ke skala Saaty. Pada 720 kemungkinan urutan, CR maksimum yang terukur 0,0097; Slider di atas penilaian pakar yang sudah tidak konsisten dapat melewati 0,1. Lencana CR di semua mode menunjukkannya, dan `scripts/verify-ahp-modes.ts` memeriksa invariannya.
- Tombol Simpan nonaktif di mode mana pun bila matriks tidak lolos validasi (nilai di luar skala Saaty, tidak resiprokal, atau CR > 0,1).
- Matriks lama yang tersimpan dengan nilai di luar skala Saaty (mis. 1,25) ditampilkan apa adanya dengan banner yang menyebut CR sebelum dan sesudah dibulatkan, dan tombol **Bulatkan ke skala Saaty**. Program seperti itu tidak bisa memulai sesi scoring baru sampai matriksnya diperbaiki.
- Seretan pada mode Berpasangan hanya menyusun arah pertanyaan, TIDAK mengubah bobot. Yang mengubah bobot lewat seretan hanya mode Urutan.

### Tombol "Nonaktifkan bobot khusus (kembali ke bobot bawaan sistem)"

**Yang dikerjakan.** Menghapus matriks bobot AHP dari program sehingga penilaian kembali memakai bobot bawaan sistem (Behavior 35%, Technical 25%, HAV 20%, PA 10%, Career 5%, Pendidikan 5%). Bukan kembali ke daftar kriteria — daftar itu tidak menyimpan bobot.

**Dampak.** Setelah Simpan, matriks tersimpan benar-benar dikosongkan. Cakupan: satu program di satu business unit. Dapat dibatalkan hanya dengan menyusun ulang bobotnya — angka lama tidak disimpan di mana pun.

**Izin.** Kelola tata kelola

**Kapan nonaktif / gagal:**

- Hanya berlaku setelah menekan Simpan di kepala kartu program.

### Tombol "Simpan Perubahan (Scoring Prompts)" — ⚠ BERDAMPAK LUAS

**Yang dikerjakan.** Menyimpan isi prompt yang sedang dipilih di blok "Prompt AHP + TOPSIS" — hanya ada dua: pendidikan (`ahp_education_grounded`) dan insight finalis (`ahp_narrative_agent`). Isi lama otomatis diarsipkan sebagai versi baru bila berbeda dan tidak kosong, lalu layanan scoring diberi tahu agar membuang salinan prompt lamanya dari memori.

**Dampak.** Berlaku LINTAS BUSINESS UNIT — prompt ini dipakai semua unit (Mulia, MSO, ERRO). Run yang dimulai setelah ini memakai teks baru. Cakupan: seluruh aplikasi. Dapat dibatalkan dengan memulihkan versi lama dari Riwayat. Perubahan ini TIDAK muncul di Audit Log.

**Izin.** Kelola tata kelola

**Kapan nonaktif / gagal:**

- Gagal bila kunci prompt bukan salah satu dari dua prompt yang masih dipakai (`ACTIVE_SCORING_PROMPT_KEYS`). Penyimpanan menulis ulang `lib/scoring-prompts.json` dengan kedua kunci itu saja, sehingga kunci prompt AI Tournament yang masih tersisa di berkas yang pernah disunting lokal ikut terbuang.
- Pemberitahuan ke layanan scoring bersifat upaya terbaik; bila layanan sedang mati, teks tetap tersimpan dan berlaku saat layanan berikutnya dinyalakan.
- Run yang sedang berjalan tidak berubah di tengah jalan.
- Riwayat menyimpan maksimal 50 versi per prompt.

### Tombol "Simpan Versi (Scoring Prompts)" — ⚠ BERDAMPAK LUAS

**Yang dikerjakan.** Meminta catatan opsional, lalu menyimpan isi editor sebagai versi baru sekaligus menjadikannya prompt aktif.

**Dampak.** Sama dengan Simpan Perubahan — berlaku lintas business unit dan langsung dipakai run berikutnya, dengan tambahan catatan penanda di riwayat. Dapat dibatalkan lewat pemulihan versi. Tidak tercatat di Audit Log.

**Izin.** Kelola tata kelola

**Kapan nonaktif / gagal:**

- Tombol nonaktif bila editor kosong.
- Kunci prompt harus dikenali.

### Tombol "Riwayat + Gunakan + Hapus (Scoring Prompts)" — ⚠ BERDAMPAK LUAS

**Yang dikerjakan.** Riwayat menampilkan versi tersimpan (terbaru di atas). 'Gunakan' memulihkan versi lama menjadi prompt aktif — dan sebelum menimpa, isi yang sedang aktif diarsipkan lebih dulu sehingga pemulihan bisa dibalik. Ikon tong sampah menghapus satu versi dari riwayat secara permanen setelah konfirmasi.

**Dampak.** 'Gunakan' mengubah prompt yang dipakai SEMUA business unit pada run berikutnya (dapat dibalik). 'Hapus' menghilangkan satu catatan versi selamanya dan TIDAK dapat dibatalkan; prompt aktif tidak ikut berubah. Tidak tercatat di Audit Log.

**Izin.** Kelola tata kelola

**Kapan nonaktif / gagal:**

- Versi yang dituju harus masih ada di riwayat.
- Riwayat kosong bila prompt belum pernah diubah.

### Tombol "+ Tambah Threshold / Hapus (baris ambang readiness)"

**Yang dikerjakan.** Menambah satu baris ambang baru (nilai minimum otomatis 15 poin di bawah baris terakhir, level awal Long) atau membuang satu baris. Hanya mengubah tampilan sampai disimpan.

**Dampak.** Belum ada perubahan data. Cakupan: layar Anda saja sampai Simpan Threshold ditekan.

**Izin.** Kelola tata kelola

**Kapan nonaktif / gagal:**

- Tidak ada pengecekan tumpang tindih antar-ambang; baris yang saling menimpa akan diurutkan dari nilai tertinggi dan yang pertama cocok yang dipakai.

### Tombol "Simpan Threshold" — ⚠ BERDAMPAK LUAS

**Yang dikerjakan.** Menyimpan seluruh daftar ambang beserta Default Level; baris dengan nilai di luar 0–100 dibuang dan sisanya diurutkan dari ambang tertinggi. Layanan scoring diberi tahu agar memuat ulang ambang dari memorinya.

**Dampak.** Berlaku LINTAS BUSINESS UNIT — label kesiapan (Short/Medium/Long/Not Ready) di seluruh aplikasi dan pada penilaian berikutnya mengikuti angka baru ini. Hasil run yang sudah tersimpan tidak dihitung ulang. Cakupan: seluruh aplikasi. Dapat dibatalkan dengan mengetik ulang angka lama (tidak ada riwayat versi). Tidak tercatat di Audit Log.

**Izin.** Kelola tata kelola

**Kapan nonaktif / gagal:**

- Baris dengan Min Score di bawah 0 atau di atas 100 dihapus diam-diam saat disimpan.
- Pemberitahuan ke layanan scoring bersifat upaya terbaik; bila layanan tidak terjangkau, nilai baru berlaku saat layanan dinyalakan berikutnya.

### Tombol "Badge tenant / kotak centang business unit (Job Profiles)"

**Yang dikerjakan.** Badge pada kartu/baris/dialog detail sebuah dokumen membuka popover kotak centang tenant. Menandai unit pemilik dokumen tersebut secara langsung. Hanya mengubah tampilan sampai tombol Simpan di dalam popover ditekan.

**Dampak.** Belum ada perubahan data. Cakupan: layar Anda saja.

**Izin.** Lihat menu Dokumen & Posisi (untuk membuka halaman); penyimpanan butuh Kelola menu Dokumen & Posisi

**Kapan nonaktif / gagal:**

- Daftar unit yang tersedia adalah unit yang terdaftar di aplikasi; menambah unit baru sama sekali memerlukan perubahan sistem oleh tim teknis.

### Tombol "Simpan (popover tenant, Job Profiles)" — ⚠ BERDAMPAK LUAS

**Yang dikerjakan.** Mengganti seluruh pemetaan tenant dokumen tersebut dengan unit-unit yang dicentang, berlaku SEKETIKA (tanpa menunggu sinkronisasi berikutnya). Perubahan dicatat di Audit Log business unit yang sedang aktif.

**Dampak.** Berdampak LINTAS BUSINESS UNIT: menentukan apakah dokumen ini terlihat di halaman Job Profiles, Job Family, dan hasil pencocokan bagi tiap unit. Mencentang satu unit membuat dokumen itu berhenti terlihat oleh unit lain. Mengosongkan seluruh centang mengembalikan status 'belum dipetakan' sehingga dokumen kembali terlihat oleh SEMUA unit (bukan disembunyikan dari semua). Perhitungan scoring sengaja tidak terpengaruh. Cakupan: satu dokumen, lintas unit. Dapat dibatalkan dengan menyimpan ulang pilihan sebelumnya.

**Izin.** Kelola menu Dokumen & Posisi

**Kapan nonaktif / gagal:**

- Tombol tidak aktif bila belum ada perubahan pada baris tersebut.
- Gagal dengan pesan 'Tenant tidak dikenali' bila unit yang dikirim tidak terdaftar di aplikasi.
- Untuk mendaftarkan dokumen unit baru: letakkan PDF pada subfolder share (atau unggah dari halaman Sinkronisasi), jalankan sinkronisasi job profile agar foldernya muncul di tabel ini, centang unitnya lalu Simpan, kemudian bangun ulang embedding dan jalankan pencocokan job profile agar dokumen dipakai analisis.
- Untuk business unit yang benar-benar baru (unit keempat), unit tersebut harus didaftarkan lebih dulu oleh tim teknis — daftar unit tidak bisa ditambah dari halaman ini.
- Menyembunyikan dokumen dari semua unit tidak mungkin lewat pemetaan; dokumen harus dihapus.

### Tombol "Terapkan (Audit Log)"

**Yang dikerjakan.** Mengambil ulang daftar aktivitas sesuai kata kunci dan rentang tanggal yang dipilih, mulai dari halaman pertama.

**Dampak.** Hanya membaca. Tidak ada data yang berubah.

**Izin.** Kelola tata kelola

**Kapan nonaktif / gagal:**

- Tanggal 'Sampai' sudah mencakup seluruh hari tersebut hingga tengah malam, jadi aktivitas hari ini tetap tampil.
- Pencarian hanya mencocokkan kolom Ringkasan.
- Hanya aktivitas business unit yang sedang aktif yang ditampilkan.

### Tombol "Hapus filter (Audit Log)"

**Yang dikerjakan.** Mengosongkan kata kunci dan kedua tanggal, lalu memuat ulang daftar dari halaman pertama tanpa batas tanggal.

**Dampak.** Hanya membaca; tidak ada catatan aktivitas yang terhapus meskipun tombolnya bertuliskan 'Hapus filter'. Tidak ada data yang berubah.

**Izin.** Kelola tata kelola

**Kapan nonaktif / gagal:**

- Tombol hanya muncul bila ada filter yang sedang aktif.
- Gunakan ini untuk melihat aktivitas sebelum tanggal 1 bulan berjalan.

### Tombol "Panah kiri / kanan (Audit Log)"

**Yang dikerjakan.** Berpindah halaman daftar aktivitas, 50 baris per halaman, dengan filter yang sedang aktif tetap dipertahankan.

**Dampak.** Hanya membaca. Tidak ada data yang berubah.

**Izin.** Kelola tata kelola

**Kapan nonaktif / gagal:**

- Navigasi hanya muncul bila hasil lebih dari satu halaman.
- Panah nonaktif di halaman pertama/terakhir.

## Kamus Kompetensi (/job-profiles/kamus — URL lama /kamus-kompetensi dialihkan) · Scoring Baru (/scoring/new) · Pengaturan Sinkronisasi (/settings/sync)

### Tombol "Kartu kompetensi (mis. "TC 003 — ASSET QUALITY MANAGEMENT")"

**Yang dikerjakan.** Halaman Kamus Kompetensi. Membuka jendela detail kompetensi: deskripsi lengkap dan empat kotak level berisi butir-butir tuntutan, plus nama berkas sumber dan tanggal sinkron.

**Dampak.** Tidak ada. Murni menampilkan data yang sudah dimuat di browser; tidak ada yang ditulis ke database.

**Izin.** job_profiles.view

**Kapan nonaktif / gagal:**

- Kartu hanya ada bila kamus sudah terisi; bila kosong yang tampil adalah ajakan menjalankan sinkronisasi Kamus Kompetensi.
- Kotak level yang datanya tidak ada di PDF akan berbunyi "Tidak ada rincian level ini."

### Tombol "Coba lagi"

**Yang dikerjakan.** Halaman Kamus Kompetensi, muncul hanya saat pemuatan gagal. Mengambil ulang seluruh daftar kompetensi dari database.

**Dampak.** Tidak ada perubahan data; hanya memuat ulang tampilan.

**Izin.** job_profiles.view

**Kapan nonaktif / gagal:**

- Hanya muncul bila terjadi kesalahan pemuatan.
- Bila kegagalan disebabkan hak akses atau database yang mati, mengulang tidak akan menolong sampai penyebabnya diperbaiki.

### (Dihapus) Tombol "AI Tournament (LLM) / AHP + TOPSIS"

Halaman Scoring Baru tidak lagi punya pilihan metode. Metode AI Tournament (LLM) dihapus pada November 2026; setiap sesi dinilai dengan AHP + TOPSIS, yang menghitung enam aspek secara deterministik lalu meranking dengan bobot AHP (hasil dapat direproduksi). AHP + TOPSIS bergantung pada transformasi job profile & kamus menjadi angka; bila belum ditransform, sebagian aspek jatuh ke mekanisme cadangan dan dicatat pada halaman progres.

### Tombol "Chip unit bisnis (mis. "MSO", "ERRO")"

**Yang dikerjakan.** Halaman Scoring Baru. Menambah/mengeluarkan unit bisnis lain sebagai penyumbang kandidat ke pool penilaian. Unit bisnis yang sedang aktif selalu ikut dan tidak dapat dilepas.

**Dampak.** Mengubah isi pool untuk sesi ini saja. Setiap perubahan otomatis mengosongkan pratinjau kandidat dan MEMBATALKAN semua pengecualian yang sudah dicentang, sehingga perlu diatur ulang. Tidak mengubah data unit bisnis mana pun.

**Izin.** scoring.run

**Kapan nonaktif / gagal:**

- Baris ini hanya muncul bila ada lebih dari satu unit bisnis terdaftar.
- Aturan saringan level dan kelayakan berlaku sama untuk semua unit yang dipilih.

### Tombol "Exclude Kandidat (Atur / Tutup)"

**Yang dikerjakan.** Halaman Scoring Baru. Membuka panel daftar kandidat. Saat pertama dibuka, sistem memuat seluruh kandidat aktif dari unit bisnis terpilih dan otomatis mencentang pejabat saat ini pada posisi target.

**Dampak.** Hanya memuat daftar untuk ditampilkan; tidak ada penulisan data. Centang yang dibuat di sini baru berdampak ketika sesi dijalankan, dan hanya untuk sesi tersebut.

**Izin.** scoring.run

**Kapan nonaktif / gagal:**

- Butuh program penilaian sudah dipilih.
- Pejabat saat ini tidak dapat dilepas centangnya — ia tidak boleh bersaing menjadi penggantinya sendiri.
- Daftar kosong bila pool kandidat unit bisnis tersebut kosong.

### Tombol "Pilih semua / Hapus semua (di panel Exclude)"

**Yang dikerjakan.** Halaman Scoring Baru. Mencentang atau melepas centang seluruh kandidat yang sedang tampil sesuai kata kunci pencarian — bukan seluruh daftar.

**Dampak.** Hanya mengubah pilihan di layar untuk sesi yang akan dijalankan; tidak ada data yang ditulis. Dapat dibatalkan kapan saja sebelum sesi dimulai.

**Izin.** scoring.run

**Kapan nonaktif / gagal:**

- Kedua tombol hanya muncul ketika kotak pencarian di panel Exclude terisi.
- Pejabat saat ini tetap tercentang meskipun "Hapus semua" ditekan.

### Tombol "Batalkan semua (pada daftar kandidat dikecualikan)"

**Yang dikerjakan.** Halaman Scoring Baru. Melepas seluruh pengecualian kecuali pejabat saat ini.

**Dampak.** Hanya mengubah pilihan di layar; tidak ada data yang ditulis.

**Izin.** scoring.run

**Kapan nonaktif / gagal:**

- Hanya muncul bila ada pengecualian selain pejabat saat ini.

### Tombol "Mulai Penilaian" — ⚠ BERDAMPAK LUAS

**Yang dikerjakan.** Halaman Scoring Baru. Menjalankan seluruh rangkaian: memuat kandidat unit bisnis terpilih, MENYALIN kriteria penilaian dari template program ke posisi target bila posisi itu belum punya kriteria sama sekali, membuang kandidat yang dikecualikan, menyaring menurut rentang level (kandidat tanpa grade ikut terbuang), mengeluarkan pejabat saat ini, menerapkan aturan filter keras bila program mengaktifkannya, lalu membuat satu sesi penilaian dan satu baris hasil penilaian berstatus "sedang berjalan" pada posisi tersebut. Terakhir memberi tahu layanan scoring untuk mulai bekerja dan memantau progresnya.

**Dampak.** MENULIS: satu sesi penilaian baru, satu baris riwayat penilaian pada posisi target (langsung terlihat di halaman posisi walau belum selesai), dan — hanya jika posisi belum punya kriteria — sekumpulan baris kriteria penilaian pada posisi tersebut. Alamat halaman ikut diberi nomor sesi supaya proses dapat dilanjutkan setelah reload. Cakupan: satu posisi pada unit bisnis aktif, namun kandidat yang dinilai bisa lintas unit bisnis sesuai pilihan. Tidak ada data kandidat/karyawan yang diubah. Membatalkan: hasil penilaian dapat dihapus dari halaman posisi; kriteria yang tersalin tetap menempel pada posisi.

**Izin.** scoring.run

**Kapan nonaktif / gagal:**

- Mati bila program penilaian atau posisi target belum dipilih, dan selama satu proses masih berjalan.
- Gagal dengan pesan "Tidak ada kandidat aktif untuk tenant ini." bila seluruh pool habis oleh saringan level/pengecualian.
- Gagal bila seluruh kandidat tidak lolos aturan filter program — pesannya menyarankan melonggarkan aturan filter atau mematikan penerapan hard-filter.
- Bila layanan scoring tidak dapat dihubungi, sesi tetap tercatat dan dapat dilanjutkan; progres tidak akan bergerak sampai layanan hidup.

### Tombol "Lihat Hasil Peringkat"

**Yang dikerjakan.** Halaman Scoring Baru, muncul setelah penilaian selesai. Membuka halaman posisi target dan langsung menampilkan hasil run yang baru selesai.

**Dampak.** Tidak ada perubahan data; hanya berpindah halaman.

**Izin.** scoring.run

**Kapan nonaktif / gagal:**

- Hanya muncul bila penilaian menghasilkan run (tidak muncul bila proses gagal atau dibatalkan).

### Tombol "Ulangi Penilaian"

**Yang dikerjakan.** Halaman Scoring Baru. Mengembalikan wizard ke layar konfigurasi kosong untuk menyusun sesi baru.

**Dampak.** Hanya membersihkan tampilan. Hasil penilaian yang sudah tersimpan TIDAK dihapus — menekan tombol ini lalu menjalankan penilaian lagi akan menghasilkan run baru yang berdiri sendiri di samping run sebelumnya.

**Izin.** scoring.run

**Kapan nonaktif / gagal:**

- Hanya muncul pada layar akhir (selesai atau gagal).

### Tombol "Simpan (kartu Koneksi Database Sumber)" — ⚠ BERDAMPAK LUAS

**Yang dikerjakan.** Halaman Sinkronisasi. Menyimpan setelan server, port, nama database, username, sakelar TLS/sertifikat/aktif untuk satu sumber database. Password hanya ikut tersimpan bila kolomnya diisi — kolom kosong berarti "pertahankan password lama". Setelah tersimpan, layanan sinkronisasi diminta memuat ulang konfigurasinya.

**Dampak.** MENULIS satu baris setelan koneksi (satu sumber database) dan satu catatan audit. Berdampak GLOBAL lintas unit bisnis: semua unit menarik data dari server yang sama. Dapat dibatalkan dengan menyimpan kembali nilai lama, tetapi password lama tidak dapat dipulihkan dari layar ini karena tidak pernah ditampilkan.

**Izin.** sync.manage

**Kapan nonaktif / gagal:**

- Gagal bila server, nama database, atau username kosong, atau port di luar 1–65535.
- Password tersimpan tanpa enkripsi di database aplikasi; siapa pun yang punya akses baca ke database itu dapat membacanya.
- Bila layanan sinkronisasi tidak dapat dihubungi, setelan tetap tersimpan tetapi baru berlaku saat layanan berikutnya start.

### Tombol "Test Koneksi"

**Yang dikerjakan.** Halaman Sinkronisasi. Meminta layanan sinkronisasi mencoba menyambung ke database sumber memakai setelan yang SUDAH TERSIMPAN — bukan yang sedang diketik di form.

**Dampak.** Tidak menulis apa pun; hanya membuka koneksi percobaan dan menampilkan hasilnya.

**Izin.** sync.manage

**Kapan nonaktif / gagal:**

- Hasil hijau tidak memvalidasi perubahan yang belum disimpan — simpan dahulu, baru uji.
- Melaporkan "Layanan sinkronisasi tidak dapat dihubungi" bila layanan mati.
- Nonaktif selama ada penyimpanan/pengujian koneksi lain berjalan.

### Tombol "Batalkan perubahan"

**Yang dikerjakan.** Halaman Sinkronisasi, kartu koneksi. Mengembalikan isian form ke nilai terakhir yang tersimpan.

**Dampak.** Hanya membuang ketikan di layar; tidak menyentuh data tersimpan.

**Izin.** sync.manage

**Kapan nonaktif / gagal:**

- Hanya muncul saat ada perubahan yang belum disimpan.

### Tombol "Jalankan Sinkronisasi Penuh" — ⚠ BERDAMPAK LUAS

**Yang dikerjakan.** Halaman Sinkronisasi. Memicu seluruh modul sinkronisasi berjalan berurutan di latar belakang pada layanan sinkronisasi.

**Dampak.** MENULIS ke banyak tabel sumber sekaligus (karyawan, struktur organisasi, posisi & hierarki, penempatan, kompetensi teknis, kinerja, grade level, kompetensi perilaku, kedisiplinan, pendidikan, kandidat). Cakupan: seluruh unit bisnis, kecuali Filter Tenant diisi — maka hanya unit itu. Bersifat pembaruan (upsert), bukan penghapusan massal. Tidak dapat dibatalkan setelah dimulai; jalan keluarnya adalah memperbaiki data sumber lalu menyinkron ulang.

**Izin.** sync.manage

**Kapan nonaktif / gagal:**

- Nonaktif ketika layanan sinkronisasi offline atau masih dicek.
- Berjalan di latar belakang — halaman perlu dimuat ulang beberapa menit kemudian untuk melihat angka terbaru.
- Company ID yang belum dipetakan tetap masuk sebagai "Tanpa mapping" dan tidak akan terlihat di aplikasi.

### Tombol "Karyawan / Struktur Org / Position Mapping / Penilaian Kinerja / Grade Level / Kompetensi Perilaku" — ⚠ BERDAMPAK LUAS

**Yang dikerjakan.** Halaman Sinkronisasi, kelompok Database. Menarik satu modul dari MSSQL: master karyawan; divisi & departemen (diturunkan dari data karyawan yang sudah tersinkron); master posisi + hierarki + penempatan + kompetensi teknis sekaligus; rekap penilaian kinerja; master grade/level; hasil assessment perilaku terakhir.

**Dampak.** MENULIS ke tabel modul terkait, memperbarui baris yang sudah ada dan menambah yang baru; baris yang tidak ada di sumber tidak dihapus. Cakupan seluruh unit bisnis, kecuali Filter Tenant dipakai. Satu catatan riwayat eksekusi ditulis. Tidak dapat dibatalkan.

**Izin.** sync.manage

**Kapan nonaktif / gagal:**

- Nonaktif ketika layanan sinkronisasi offline atau modul yang sama sedang berjalan.
- Gagal bila koneksi database sumber salah.
- "Struktur Org" tidak menarik dari mana pun bila data karyawan belum tersinkron.

### Tombol "Kedisiplinan / Pendidikan" — ⚠ BERDAMPAK LUAS

**Yang dikerjakan.** Halaman Sinkronisasi, kelompok API Orange. Menarik catatan disiplin dan riwayat pendidikan dari gateway REST eksternal. Ditandai "Lama" karena berjalan lama.

**Dampak.** MENULIS ke tabel kedisiplinan / pendidikan (pembaruan, tanpa penghapusan). Status disiplin ini yang kemudian menentukan kelayakan kandidat pada aturan filter program. Cakupan seluruh unit bisnis kecuali Filter Tenant dipakai. Tidak dapat dibatalkan.

**Izin.** sync.manage

**Kapan nonaktif / gagal:**

- Dikirim sebagai proses latar belakang: notifikasi sukses berarti "sudah dimulai", bukan "sudah selesai".
- Nonaktif ketika layanan sinkronisasi offline.
- Hasilnya baru terlihat setelah halaman dimuat ulang beberapa menit kemudian.

### Tombol "Data Pribadi"

**Yang dikerjakan.** Halaman Sinkronisasi, kelompok API Orange. Menarik data pribadi karyawan dari gateway REST eksternal dan menyimpan TANGGAL LAHIR-nya — sumber angka Usia pada halaman Kandidat dan Talent Pool. Berbeda dari Kedisiplinan/Pendidikan, endpoint ini mendaftar seluruh karyawan sekaligus sehingga selesai cepat.

**Dampak.** MENULIS ke tabel data pribadi (pembaruan, tanpa penghapusan). Hanya tanggal lahir dan nama tampilan yang disimpan; nomor identitas, NPWP, BPJS, telepon, dan email yang ikut dikirim endpoint sengaja TIDAK disimpan. Usia baru muncul di kartu kandidat setelah tombol "Kandidat" (kelompok Turunan) dijalankan, karena tanggal lahir disalin ke baris kandidat pada langkah itu. Tanggal lahir yang sudah tersimpan tidak akan tertimpa kosong bila sumber sedang tidak mengembalikan datanya. Cakupan seluruh unit bisnis kecuali Filter Tenant dipakai.

**Izin.** sync.manage

**Kapan nonaktif / gagal:**

- Nonaktif ketika layanan sinkronisasi offline.
- Bila API gagal, baris yang sudah ada dipertahankan — usia kandidat tidak hilang karena satu run yang gagal.

### Tombol "Kandidat"

**Yang dikerjakan.** Halaman Sinkronisasi, kelompok Turunan. Menyusun ulang daftar kandidat dari seluruh data yang sudah tersinkron, dalam mode perbarui (upsert).

**Dampak.** MENULIS/memperbarui baris kandidat beserta data turunannya. Kandidat yang sebelumnya "dikosongkan" akan muncul kembali dengan ID yang sama sehingga riwayat scoring-nya tetap tersambung; kandidat yang "dihapus manual" tetap tidak dimunculkan. Cakupan mengikuti pemetaan Company ID aktif (atau satu unit bila Filter Tenant dipakai).

**Izin.** sync.manage

**Kapan nonaktif / gagal:**

- Nonaktif ketika layanan sinkronisasi offline.
- Bergantung pada modul lain: kandidat hanya selengkap data karyawan/posisi/kinerja yang sudah masuk.

### Tombol "Ikon panah melingkar di samping tombol Kandidat (Bangun ulang data turunan)" — ⚠ BERDAMPAK LUAS

**Yang dikerjakan.** Halaman Sinkronisasi. Setelah konfirmasi, menjalankan sinkronisasi kandidat dalam mode bangun ulang: MENGHAPUS lalu menyusun ulang dari nol riwayat jabatan kandidat dan kompetensi teknis hasil sinkronisasi.

**Dampak.** MENGHAPUS data turunan kandidat (riwayat jabatan, kompetensi teknis hasil sync) lalu membangunnya kembali dari tabel sumber. Kompetensi yang diinput MANUAL tidak dihapus. Baris kandidat sendiri beserta ID-nya dipertahankan, sehingga hasil scoring, successor terpilih, dan cache skor aspek tidak hilang. Cakupan mengikuti pemetaan Company ID aktif / Filter Tenant. Data turunan lama tidak dapat dikembalikan selain dengan membangun ulang lagi dari sumber.

**Izin.** sync.manage

**Kapan nonaktif / gagal:**

- Meminta konfirmasi yang menyebutkan persis apa yang dihapus.
- Nonaktif ketika layanan sinkronisasi offline atau modul kandidat sedang berjalan.
- Jika data sumber sedang tidak lengkap, membangun ulang akan menghasilkan riwayat yang lebih miskin daripada sebelumnya.

### Tombol "Seret berkas ke sini, atau pilih berkas (kartu Berkas Sumber: Job Profile, Kamus Kompetensi, HAV Quadrant, Status MCU)" — ⚠ BERDAMPAK LUAS

**Yang dikerjakan.** Halaman Sinkronisasi. Mengunggah berkas lalu LANGSUNG menjalankan sinkronisasi untuk sumber itu. Job Profile & Kamus menerima banyak PDF sekaligus; HAV & MCU hanya satu berkas Excel (berkas berikutnya diabaikan dengan peringatan). Job Profile diproses AI di latar belakang.

**Dampak.** MENULIS ke tabel sumbernya: dokumen job profile hasil ekstraksi, kamus kompetensi (diperbarui per kode kompetensi — kompetensi lama yang tidak ada di PDF baru TIDAK dihapus), kuadran HAV per NPK, status MCU **beserta keterangan medisnya** per NPK. Berlaku LINTAS SEMUA UNIT BISNIS. Berkas unggahan dihapus dari server setelah isinya masuk database. Tidak ada tombol batal: pembatalan berarti mengunggah berkas yang benar lagi.

**Izin.** sync.manage

**Kapan nonaktif / gagal:**

- Nonaktif ketika layanan sinkronisasi offline.
- Berkas dengan ekstensi yang tidak cocok ditolak sebelum dikirim.
- Job Profile: notifikasi hanya berarti "sedang diproses"; hasil baru terlihat beberapa menit kemudian.
- HAV & MCU memperbarui per NPK — karyawan yang tidak ada di file tetap memakai nilai lamanya.

### Tombol "Seret berkas ke sini, atau pilih berkas (kartu Unggah Data via Excel)" — ⚠ BERDAMPAK LUAS

**Yang dikerjakan.** Halaman Sinkronisasi. Mengunggah satu workbook Excel sebagai pengganti sekali-jalan untuk data yang biasanya ditarik dari MSSQL/API HR (Data Karyawan, Master Jabatan, Hierarki Jabatan, Penempatan Karyawan, Kompetensi Teknis, Penilaian Kinerja, Level & Grade, Kompetensi Perilaku, Catatan Disiplin, Riwayat Pendidikan), lalu langsung memprosesnya.

**Dampak.** MENULIS/memperbarui baris pada tabel terkait memakai kunci baris yang tertulis di tiap kartu; baris yang tidak ada di file TIDAK pernah dihapus. Berlaku lintas unit bisnis sesuai isi kolom COMPANY_ID di file. Berkas dihapus setelah diproses dan sinkronisasi terjadwal berikutnya kembali menarik dari sumber aslinya — ini koreksi sementara, bukan pemindahan sumber. Membatalkan berarti mengunggah data yang benar lagi.

**Izin.** sync.manage

**Kapan nonaktif / gagal:**

- Nonaktif ketika layanan sinkronisasi offline.
- Susunan kolom harus mengikuti template; gunakan tombol unduh template pada kartu yang sama.
- Hanya satu berkas per unggahan.
- Baris dengan kunci yang salah ketik akan menciptakan baris BARU, bukan memperbarui yang lama.

### Tombol "Unduh template Excel"

**Yang dikerjakan.** Halaman Sinkronisasi. Mengunduh workbook contoh dengan susunan kolom yang persis sama dengan yang dibaca sistem saat memproses unggahan.

**Dampak.** Tidak ada perubahan data.

**Izin.** sync.manage

**Kapan nonaktif / gagal:**

- Template HAV & MCU diambil dari berkas statis aplikasi; template sumber Excel lain dihasilkan oleh layanan sinkronisasi, sehingga gagal diunduh bila layanan mati.

### Tombol "Muat ulang (kartu Riwayat Sinkronisasi) & Sebelumnya / Selanjutnya"

**Yang dikerjakan.** Halaman Sinkronisasi. Mengambil ulang daftar eksekusi sinkronisasi sesuai filter status yang dipilih, atau berpindah halaman tabel (25 baris per halaman).

**Dampak.** Tidak ada perubahan data; hanya membaca riwayat.

**Izin.** sync.manage

**Kapan nonaktif / gagal:**

- Tombol halaman mati di ujung daftar dan selama pemuatan.
- Tabel bisa kosong sama sekali pada instalasi yang pencatatan riwayatnya belum aktif.

### Tombol "Simpan (kartu Parameter BERT, tab Embedding)" — ⚠ BERDAMPAK LUAS

**Yang dikerjakan.** Halaman Sinkronisasi. Menyimpan HANYA pengaturan embedding: Sumber Model, Nama Model, Dimensi Vektor, dan Batch Size. Server membaca versi konfigurasi Job Family yang aktif, mengganti bagian embedding-nya saja, lalu menyimpannya sebagai versi aktif baru. Template restrukturisasi dan parameter BERTopic tidak ikut tersimpan, sehingga halaman yang dibuka sebelum orang lain mengubah template tidak mengembalikan template lama. Notifikasi "Parameter BERT tersimpan."

**Dampak.** CAKUPAN GLOBAL untuk semua business unit. Vektor yang ada tidak berubah sampai dokumen di-embed ulang. Mengganti sumber atau nama model sama dengan mengganti alat ukur: semua dokumen job profile dan kamus harus di-embed ulang dengan model yang sama, karena penilaian AHP+TOPSIS membandingkan vektor keduanya. Dimensi yang berbeda dari kolom tersimpan membuat pembangunan ulang berikutnya MEMBUAT ULANG SEMUA tabel vektor (job profile dan kamus), sehingga isinya terhapus.

**Izin.** job_profiles.manage

**Kapan nonaktif / gagal:**

- Nonaktif selama menyimpan atau membangun ulang.
- Ditolak seluruhnya bila sumber tidak dikenal, nama model kosong, atau dimensi/batch bukan bilangan bulat positif.

### Tombol "Bangun Ulang Job Profile (tab Embedding)" — ⚠ BERDAMPAK LUAS

**Yang dikerjakan.** Halaman Sinkronisasi. 1) Menyimpan pengaturan embedding di kartu Parameter BERT (hanya bagian itu). 2) Menyusun rencana: setiap job profile berstatus selesai dan terekstrak dibentuk menjadi dokumen memakai template khususnya bila ada, atau template global yang tersimpan; vektor milik dokumen yang sudah tidak ada dihapus. 3) Meng-embed SEMUA dokumen itu batch demi batch dengan penunjuk kemajuan, bukan hanya yang berubah. Dokumen yang hasil restrukturisasinya kosong dilewati.

**Dampak.** CAKUPAN GLOBAL / LINTAS BUSINESS UNIT: menimpa vektor seluruh korpus job profile, karena korpus ini dipakai bersama oleh penilaian lintas business unit. Tidak dapat dibatalkan; vektor lama ditimpa. Peta job family tidak berubah sampai dibangun ulang.

**Izin.** job_profiles.manage

**Kapan nonaktif / gagal:**

- Nonaktif selama menyimpan atau membangun ulang.
- Gagal seluruhnya bila penyimpanan vektor (pgvector) belum siap.
- Berhenti dengan pesan galat bila layanan embedding tidak dapat dihubungi (pesan memuat alamat layanan).
- Rencana disimpan di memori server dan kedaluwarsa setelah 30 menit; bila server dimuat ulang di tengah proses muncul "Sesi rebuild kedaluwarsa atau tidak ditemukan. Mulai ulang."

### Tombol "Ikon panah melingkar di sudut panel Vector Store (tab Embedding, tanpa teks)"

**Yang dikerjakan.** Membaca ulang status penyimpanan vektor: ketersediaannya, konfigurasi layanan embedding, nama model yang tercatat, serta jumlah dokumen job profile dan kompetensi yang tersimpan.

**Dampak.** Hanya membaca — tidak mengubah data apa pun.

**Izin.** job_profiles.view

**Kapan nonaktif / gagal:**

- Berputar dan nonaktif selama status sedang dimuat.
- Bila gagal, muncul pesan "Gagal memuat status vector store." dan angka tetap menampilkan "—".

### Pembatalan proses embedding — TIDAK ADA TOMBOL "Batalkan"

**Yang dikerjakan.** Pembatalan berjalan otomatis, bukan lewat tombol: ketika satu batch gagal, halaman berhenti memproses batch berikutnya dan memerintahkan server melepaskan sisa rencana. Bila halaman ditutup di tengah proses, sisa rencana tidak diproses dan dibersihkan server setelah 30 menit.

**Dampak.** Hanya membatalkan SISA pekerjaan. Dokumen yang sudah di-embed sebelum penghentian tetap tersimpan, jadi korpus bisa setengah diperbarui. Cara memulihkannya adalah menjalankan pembangunan ulang lagi; semua dokumen job profile diproses ulang dari awal.

**Izin.** job_profiles.manage

**Kapan nonaktif / gagal:**

- Tidak dapat dipicu manual.
- Setelah rencana dilepas atau kedaluwarsa, proses lama tidak dapat dilanjutkan dan harus dimulai dari awal.

### Tombol "Mulai Embedding (panel Embedding Job Profile dan panel Embedding Kamus Kompetensi)" — ⚠ BERDAMPAK LUAS

**Yang dikerjakan.** Halaman Sinkronisasi. Menyusun teks tiap dokumen job profile / tiap kompetensi kamus (dokumen penuh + empat dokumen level kumulatif) lalu mengubahnya menjadi vektor secara bertahap sambil menampilkan progres per batch. Panel Job Profile meng-embed SEMUA dokumen job profile setiap kali, karena model yang sama bisa menghasilkan vektor berbeda untuk teks yang sama. Panel Kamus membandingkan sidik isinya dengan yang tersimpan dan hanya meng-embed kompetensi yang berubah.

**Dampak.** MENULIS/menimpa baris vektor pada penyimpanan vektor: seluruh korpus job profile, atau kompetensi kamus yang berubah saja. Berlaku GLOBAL untuk semua unit bisnis. Tidak menyentuh data kandidat, posisi, maupun hasil scoring — namun vektor inilah yang dipakai penilaian teknis & relevansi karier, sehingga penilaian sesudahnya bisa berubah nilainya. Membatalkan berarti menjalankan pembangunan ulang lagi.

**Izin.** job_profiles.manage

**Kapan nonaktif / gagal:**

- Mati selama status "belum siap" (tabel vektor belum tersedia atau database vektor tidak dapat dihubungi).
- Gagal bila layanan embedding tidak online — pesan aslinya ditampilkan, bukan sekadar "gagal".
- Sesi pembangunan kedaluwarsa setelah 30 menit menganggur dan harus dimulai ulang.
- Model embedding harus sama dengan yang dipakai layanan scoring; bila diganti sebelah, seluruh perhitungan kemiripan jadi tidak bermakna tanpa pesan galat apa pun.

### Tombol "Tambah Mapping" — ⚠ BERDAMPAK LUAS

**Yang dikerjakan.** Halaman Sinkronisasi. Membuka form lalu menyimpan satu pemetaan Company ID (mis. MPM2) ke satu unit bisnis Pulse, langsung berstatus aktif.

**Dampak.** MENULIS satu baris pemetaan dan satu catatan audit. Berdampak besar: mulai sinkronisasi berikutnya, seluruh data ber-Company ID tersebut dihitung sebagai milik unit bisnis itu — angka statistik, daftar kandidat, dan pool penilaian ikut berubah. Dapat dibatalkan dengan menonaktifkan atau menghapus pemetaan.

**Izin.** sync.manage

**Kapan nonaktif / gagal:**

- Company ID dan Tenant wajib diisi; Company ID otomatis dijadikan huruf kapital.
- Company ID ganda akan gagal disimpan karena bentrok dengan baris yang sudah ada.

### Tombol "Ikon pensil (Edit mapping)" — ⚠ BERDAMPAK LUAS

**Yang dikerjakan.** Halaman Sinkronisasi. Mengubah Company ID, unit bisnis tujuan, atau label sebuah pemetaan.

**Dampak.** MENGUBAH satu baris pemetaan dan menulis catatan audit. Memindahkan pemetaan ke unit bisnis lain memindahkan kepemilikan seluruh data ber-Company ID itu pada sinkronisasi berikutnya — data yang sudah terlanjur tersimpan tidak otomatis berpindah. Dapat dibatalkan dengan mengedit kembali.

**Izin.** sync.manage

**Kapan nonaktif / gagal:**

- Company ID dan Tenant wajib diisi.

### Tombol "Lencana Aktif / Nonaktif (klik untuk mengubah status mapping)"

**Yang dikerjakan.** Halaman Sinkronisasi. Mengaktifkan atau menonaktifkan satu pemetaan Company ID.

**Dampak.** MENGUBAH satu baris pemetaan dan menulis catatan audit. Pemetaan nonaktif tidak diproses saat sinkronisasi dan unit bisnisnya hilang dari pemilih Filter Tenant; data yang sudah masuk tetap ada. Dapat dibalik kapan saja dengan klik ulang.

**Izin.** sync.manage

**Kapan nonaktif / gagal:**

- Nonaktif sementara ketika proses penyimpanan lain sedang berjalan.

### Tombol "Ikon tong sampah (Hapus mapping) → Hapus" — ⚠ BERDAMPAK LUAS

**Yang dikerjakan.** Halaman Sinkronisasi. Setelah konfirmasi, menghapus permanen satu baris pemetaan Company ID → unit bisnis.

**Dampak.** MENGHAPUS satu baris pemetaan dan menulis catatan audit. Sinkronisasi data perusahaan itu tidak berjalan lagi, dan datanya yang sudah ada akan tampil sebagai "Tanpa mapping" pada kartu statistik. Tidak dapat dibatalkan — pemetaan harus dibuat ulang secara manual.

**Izin.** sync.manage

**Kapan nonaktif / gagal:**

- Selalu meminta konfirmasi di dialog terpisah.
- Menghapus pemetaan TIDAK menghapus data karyawan/kandidat yang sudah tersinkron.

### Tombol "Kosongkan Data Kandidat → Kosongkan (ketik HAPUS)" — ⚠ BERDAMPAK LUAS

**Yang dikerjakan.** Halaman Sinkronisasi, kartu Data Kandidat. Menandai seluruh kandidat aktif pada unit bisnis yang sedang aktif sebagai "dikosongkan" sekaligus.

**Dampak.** MENGUBAH seluruh baris kandidat aktif milik unit bisnis aktif menjadi tersembunyi (bukan dihapus dari database) dan menulis satu catatan audit. Riwayat scoring, hasil analisis, successor terpilih, dan cache skor aspek TETAP UTUH. Kandidat muncul kembali dengan ID yang sama setelah sinkronisasi kandidat berikutnya, atau langsung lewat tombol Pulihkan. Cakupan: HANYA unit bisnis yang sedang aktif — pool unit lain tidak tersentuh. Dapat dibatalkan.

**Izin.** candidates.manage

**Kapan nonaktif / gagal:**

- Tombol mati bila jumlah kandidat aktif 0 atau statistik belum termuat.
- Dialog hanya membuka tombol Kosongkan setelah kata HAPUS diketik persis dengan huruf besar.
- Halaman Kandidat, Analisis, dan Dashboard ikut menjadi kosong sampai kandidat dipulihkan atau disinkron ulang.

### Tombol "Pulihkan (kotak kuning "N kandidat sedang dikosongkan")"

**Yang dikerjakan.** Halaman Sinkronisasi, kartu Data Kandidat. Mengembalikan semua kandidat yang dikosongkan massal tanpa menunggu sinkronisasi.

**Dampak.** MENGUBAH baris kandidat berstatus "dikosongkan" pada unit bisnis aktif menjadi aktif kembali, dan menulis satu catatan audit. Kandidat yang dihapus satu per satu TIDAK ikut dipulihkan — itu keputusan sengaja yang dihormati. Cakupan: unit bisnis aktif saja. Dapat dibalik dengan mengosongkan lagi.

**Izin.** candidates.manage

**Kapan nonaktif / gagal:**

- Hanya muncul bila ada kandidat berstatus dikosongkan.
- Nonaktif selama statistik dimuat atau ada proses lain berjalan.

### Tombol "Lihat kandidat yang dihapus manual (N) → Pulihkan (per baris)" — ⚠ BERDAMPAK LUAS

**Yang dikerjakan.** Halaman Sinkronisasi, kartu Data Kandidat. Membuka daftar kandidat yang dihapus satu per satu dari halaman Kandidat (maksimal 200 penghapusan terbaru), lalu memulihkan satu kandidat yang dipilih.

**Dampak.** MENGUBAH satu baris kandidat menjadi aktif kembali dan menulis catatan audit. Ini satu-satunya jalan kembali bagi kandidat yang dihapus manual, karena sinkronisasi sengaja tidak memunculkannya lagi. Cakupan: satu kandidat pada unit bisnis aktif. Dapat dibalik dengan menghapusnya lagi dari halaman Kandidat.

**Izin.** candidates.manage (daftar: candidates.view)

**Kapan nonaktif / gagal:**

- Panel hanya muncul bila ada kandidat berstatus dihapus manual.
- Daftar dibatasi 200 baris terbaru; bila mentok, ada pemberitahuan bahwa masih ada yang lain di luar daftar.
- Baris yang gagal dipulihkan tetap ditampilkan agar bisa dicoba lagi.

### Tombol "Muat ulang (kartu Koneksi Database Sumber / kartu Data Kandidat)"

**Yang dikerjakan.** Halaman Sinkronisasi. Mengambil ulang setelan koneksi beserta laporan "sedang dipakai layanan", atau mengambil ulang tiga angka kandidat.

**Dampak.** Tidak ada perubahan data. Pada kartu koneksi, ketikan yang belum disimpan pada panel yang sedang diedit tetap dipertahankan.

**Izin.** sync.manage / candidates.view

**Kapan nonaktif / gagal:**

- Nonaktif selama proses penyimpanan atau pemuatan berlangsung.

## Peta Job Family (menu Posisi → seksi Job Family), rute /posisi/job-family (URL lama /family-tree dan /job-profiles/job-family dialihkan)

### Tombol "Bangun Peta — langkah 3 pada strip Alur pembuatan peta (berubah menjadi "Bangun Ulang" bila sudah pernah ada hasil, dan "Sedang berjalan…" saat proses berlangsung)" — ⚠ BERDAMPAK LUAS

**Yang dikerjakan.** Menghitung dulu berapa dokumen ter-embed di SELURUH korpus; bila kurang dari 2 atau penyimpanan vektor belum siap, tombol hanya memunculkan pesan dan tidak membuat apa-apa. Bila cukup, sistem mengambil parameter pengelompokan yang aktif dari halaman Konfigurasi, mencatat satu baris proses baru berstatus menunggu (lengkap dengan salinan parameter dan jumlah dokumen), lalu mengirim perintah ke layanan pengolah untuk mengerjakannya di latar belakang. Layanan itu membaca semua vektor, menyusutkan dimensinya, mengelompokkan (menyisakan dokumen tak terkelompok sebagai outlier), menyusun kata kunci khas tiap kelompok, membuat koordinat peta 2D, menghitung alasan tiap dokumen masuk kelompoknya, menyusun pohon hierarki, merangkum judul & deskripsi umum tiap simpul, lalu menyimpan seluruh hasil. Halaman memeriksa kemajuannya setiap 2 detik dan menampilkan hasilnya begitu selesai. Bila pengiriman perintah gagal atau alamat layanan belum diatur, proses langsung ditandai gagal dengan pesan penyebabnya.

**Dampak.** Membuat data baru: satu baris proses beserta seluruh kelompok, keanggotaan dokumen, dan pohon hierarkinya. Dari halaman ini proses selalu dijalankan dalam lingkup GLOBAL (seluruh dokumen semua business unit), sehingga hasil terbaru inilah yang akan dilihat oleh semua business unit — dampaknya lintas tenant. Tidak mengubah data job profile, kandidat, posisi, maupun hasil scoring yang sudah ada. Hasil lama tetap tersimpan di basis data tetapi tidak lagi ditampilkan, karena halaman selalu menampilkan proses terbaru yang boleh dilihat. Tidak ada tombol pembatalan/undo: untuk kembali ke pengelompokan sebelumnya, parameter harus dikembalikan lalu peta dibangun ulang.

**Izin.** Kelola menu Dokumen & Posisi (job_profiles.manage). Untuk sekadar melihat halaman cukup izin lihat (job_profiles.view).

**Kapan nonaktif / gagal:**

- Nonaktif bila dokumen ter-embed milik unit aktif kurang dari 2, atau selagi ada proses yang berjalan, atau selagi permintaan sedang dikirim.
- Bila belum pernah ada transformasi sama sekali, langkah 3 ditandai menunggu dan tidak punya tombol; yang menyala adalah langkah 2.
- Gagal bila alamat layanan pengolah belum diatur, layanan tidak dapat dihubungi/tidak merespons dalam 15 detik, atau layanan menolak karena sudah ada proses lain berjalan.
- Gagal bila penyimpanan vektor atau tabel pemetaan belum dipasang — pesannya menyebutkan migrasi yang harus dijalankan.
- Judul & deskripsi umum hanya terisi bila layanan perangkuman kecerdasan buatan dikonfigurasi dan jumlah simpul tidak melebihi 300; jika tidak, judul otomatis berisi rangkaian kata kunci.

### Tombol "Ekspor Hasil (baris ringkasan di atas peta)"

**Yang dikerjakan.** Membuka dialog ekspor hasil pemetaan job family: pilih format (Excel, laporan cetak HTML/PDF, atau CSV datar), cakupan (seluruh job family atau satu family), dan isi yang disertakan (incumbent, alasan penempatan, kata kunci, outlier, ringkasan job profile). Baris "Akan diekspor" menghitung ulang jumlah family, job profile, incumbent, dan outlier setiap kali pilihan diubah.

**Dampak.** Hanya membaca — seluruh isi berkas diambil dari hasil yang sudah tampil di layar, tanpa kueri baru dan tanpa menulis apa pun ke basis data.

**Izin.** Lihat menu Dokumen & Posisi (job_profiles.view)

**Kapan nonaktif / gagal:**

- Nonaktif bila proses pemetaan belum menghasilkan satu job family pun.
- Laporan cetak dibuka di tab baru; bila browser memblokir pop-up, laporan tidak muncul — izinkan pop-up untuk situs ini lalu ulangi.

### Tombol "Unduh / Buka laporan (tombol utama di dialog Ekspor Hasil)"

**Yang dikerjakan.** Membuat berkasnya. Pada Excel dan CSV berkas langsung diunduh; pada laporan cetak sebuah tab baru terbuka dan dialog cetak browser muncul sendiri, sehingga laporan dapat disimpan sebagai PDF. Nama berkas memuat business unit aktif, nama family (bila cakupannya satu family), dan tanggal ekspor.

**Dampak.** Hanya membaca.

**Izin.** Lihat menu Dokumen & Posisi (job_profiles.view)

**Kapan nonaktif / gagal:**

- Nonaktif selama berkas sedang dibuat, dan bila cakupan yang dipilih tidak memuat satu job family pun.
- Label tombol berubah menjadi "Buka laporan" ketika format laporan cetak dipilih, karena hasilnya memang dibuka, bukan diunduh.

### Tombol "Jalankan Transformasi — langkah 2 pada strip Alur pembuatan peta (berbunyi "Jalankan Ulang" bila semua dokumen sudah selesai)" — ⚠ BERDAMPAK LUAS

**Yang dikerjakan.** Menjalankan pembangunan ulang embedding job profile secara bertahap: sistem menyusun ulang setiap dokumen job profile yang berstatus selesai dan sudah terekstrak menjadi teks terstruktur — memakai template khusus dokumen itu bila ada, atau template global yang TERSIMPAN — lalu mengirim SEMUA dokumen itu ke layanan embedding dan menyimpannya (menimpa) sebagai vektor. Tidak ada dokumen yang dilewati karena isinya tidak berubah: sidik isi tetap dicatat, tetapi tidak dipakai untuk melewati dokumen, karena model yang sama bisa menghasilkan vektor berbeda untuk teks yang sama. Yang dilewati hanya dokumen yang hasil restrukturisasinya kosong. Vektor milik dokumen yang sudah tidak ada dihapus. Prosesnya dijalankan batch demi batch dengan penunjuk kemajuan; bila satu batch gagal, sisanya dihentikan dan sesi dibatalkan agar tidak menggantung. Setelah selesai, angka statistik di halaman dimuat ulang.

**Dampak.** Menulis/menimpa teks dokumen dan vektor job profile pada penyimpanan vektor. Lingkupnya GLOBAL — seluruh dokumen semua business unit, bukan hanya unit aktif. Vektor ini juga dipakai oleh penilaian kandidat (relevansi karier pada AHP+TOPSIS), sehingga penggantian isi dokumen atau model dapat mengubah hasil penilaian di kemudian hari; hasil scoring yang sudah tersimpan tidak ikut berubah. Peta job family yang sudah jadi juga tidak berubah sampai peta dibangun ulang. Tidak ada undo — pemulihan hanya dengan mengembalikan template/model lalu meng-embed ulang.

**Izin.** Kelola menu Dokumen & Posisi (job_profiles.manage) — tombol ini hanya muncul bagi pemilik izin tersebut, dan hanya bila penyimpanan vektor sudah siap.

**Kapan nonaktif / gagal:**

- Tidak bisa ditekan selagi berjalan (teks tombol berubah menjadi "Batch x/y…").
- Template yang belum disimpan di halaman Pengaturan tidak dipakai; simpan dulu.
- Gagal bila layanan embedding tidak online (pesan "Gagal terhubung ke layanan embedding") atau penyimpanan vektor belum dipasang.
- Sesi pembangunan kedaluwarsa setelah 30 menit; bila itu terjadi prosesnya harus dimulai ulang.

### Tombol "Baris job family pada legenda "Daftar Job Family""

**Yang dikerjakan.** Menyorot job family tersebut di peta sebar (titik lain diredupkan) dan menandai kartunya. Menekan baris yang sama sekali lagi membatalkan sorotan.

**Dampak.** Hanya tampilan di layar pengguna sendiri; tidak menyimpan apa pun dan hilang saat halaman dimuat ulang.

**Izin.** Lihat menu Dokumen & Posisi (job_profiles.view)

**Kapan nonaktif / gagal:**

- Hanya tersedia setelah ada hasil proses yang selesai.
- Baris outlier di bagian bawah legenda bukan tombol — hanya keterangan warna.

### Tombol "Titik pada peta sebar (klik)"

**Yang dikerjakan.** Menyorot job family pemilik titik tersebut, sama seperti mengklik baris legenda; klik ulang pada family yang sama membatalkan sorotan.

**Dampak.** Hanya tampilan; tidak ada penyimpanan data.

**Izin.** Lihat menu Dokumen & Posisi (job_profiles.view)

**Kapan nonaktif / gagal:**

- Pada mode geser, menyeret peta tidak dianggap klik.
- Titik abu-abu adalah outlier; mengkliknya menyorot kelompok outlier.

### Tombol "Tampilkan semua (tautan kecil di kanan atas peta)"

**Yang dikerjakan.** Menghapus sorotan sehingga seluruh job family tampil dengan warna penuh kembali.

**Dampak.** Hanya tampilan.

**Izin.** Lihat menu Dokumen & Posisi (job_profiles.view)

**Kapan nonaktif / gagal:**

- Hanya muncul ketika ada job family yang sedang disorot.

### Tombol "Mode geser (ikon telapak tangan, pojok kanan atas peta)"

**Yang dikerjakan.** Mengubah perilaku peta menjadi geser: menarik peta memindahkan tampilan. Kotak informasi titik disembunyikan.

**Dampak.** Hanya tampilan; tidak tersimpan.

**Izin.** Lihat menu Dokumen & Posisi (job_profiles.view)

**Kapan nonaktif / gagal:**

- Mode aktif ditandai dengan latar berwarna.
- Zoom dengan gulir tetap bekerja pada kedua mode.

### Tombol "Mode penunjuk (ikon kursor, pojok kanan atas peta)"

**Yang dikerjakan.** Mengaktifkan pemeriksaan titik: mengarahkan kursor ke sebuah titik menampilkan kotak detail (nama jabatan, divisi, job family, jumlah incumbent, persentase keanggotaan) di pojok kiri bawah peta.

**Dampak.** Hanya tampilan; tidak tersimpan.

**Izin.** Lihat menu Dokumen & Posisi (job_profiles.view)

**Kapan nonaktif / gagal:**

- Kotak detail berisi ajakan mengarahkan kursor selama belum ada titik yang disentuh.

### Tombol "Perbesar / Perkecil / Atur ulang tampilan (tiga ikon di pojok kanan atas peta)"

**Yang dikerjakan.** Memperbesar, memperkecil, atau mengembalikan posisi dan skala peta ke keadaan awal.

**Dampak.** Hanya tampilan; tidak tersimpan dan kembali normal saat halaman dimuat ulang.

**Izin.** Lihat menu Dokumen & Posisi (job_profiles.view)

**Kapan nonaktif / gagal:**

- Selalu tersedia ketika peta tampil.

### Tombol "Pilih profil pertama… / Pilih profil kedua… (dua kotak pilihan pada panel "Bandingkan 2 Profil Jabatan")"

**Yang dikerjakan.** Membuka daftar seluruh job profile yang ikut pada peta lengkap dengan kolom pencarian — ketik sebagian nama jabatan, divisi, atau nama job family untuk menyaring. Tiap baris menampilkan titik warna job family, divisi/departemen, dan jumlah incumbent. Profil yang dipilih langsung diberi lingkaran ungu di peta.

**Dampak.** Hanya pilihan sementara di layar; tidak menyimpan apa pun. Mengganti pilihan menghapus hasil perbandingan yang sedang tampil, supaya angka lama tidak terbaca sebagai hasil pasangan yang baru.

**Izin.** Lihat menu Dokumen & Posisi (job_profiles.view)

**Kapan nonaktif / gagal:**

- Daftar hanya berisi jabatan yang ada pada hasil proses yang sedang ditampilkan.

### Tombol "Hitung (pada panel "Bandingkan 2 Profil Jabatan")"

**Yang dikerjakan.** Membandingkan kedua job profile terhadap SELURUH dokumen di peta: menghitung kemiripan isi kedua dokumen, peringkat masing-masing profil di antara tetangganya, median kedekatan sebagai pembanding, jarak kedua titik di peta, irisan kompetensi teknis kedua dokumen, serta kosakata bersama dan kosakata khas kedua job family. Hasilnya tampil sebagai kalimat kesimpulan berwarna, empat kotak angka, dua kartu profil berisi incumbent dan daftar profil terdekat, lalu rincian kompetensi dan kata kunci. Menggambar juga garis putus-putus berlabel jarak di peta.

**Dampak.** Hanya membaca data — tidak menulis apa pun ke basis data.

**Izin.** Lihat menu Dokumen & Posisi (job_profiles.view)

**Kapan nonaktif / gagal:**

- Nonaktif sebelum kedua profil dipilih, bila kedua pilihan menunjuk profil yang sama, dan selama perhitungan berjalan.
- Memberi pesan gagal bila salah satu profil tidak ada pada hasil proses yang ditampilkan.
- Persentase kemiripan dan peringkat kosong bila vektor salah satu profil tidak ditemukan atau tidak dapat dibaca; jarak peta kosong bila salah satu titik tidak punya koordinat.

### Tombol "Tukar (pada panel "Bandingkan 2 Profil Jabatan")"

**Yang dikerjakan.** Menukar posisi profil 1 dan profil 2. Berguna karena peringkat kedekatan tidak simetris — A bisa menjadi tetangga terdekat B tanpa B menjadi tetangga terdekat A.

**Dampak.** Hanya tampilan; hasil perbandingan dikosongkan dan perlu dihitung ulang.

**Izin.** Lihat menu Dokumen & Posisi (job_profiles.view)

**Kapan nonaktif / gagal:**

- Hanya muncul ketika kedua profil sudah dipilih.

### Tombol "Bersihkan (pada panel "Bandingkan 2 Profil Jabatan")"

**Yang dikerjakan.** Mengosongkan kedua pilihan profil, menghapus hasil perbandingan, dan menghilangkan garis penghubung di peta.

**Dampak.** Hanya tampilan.

**Izin.** Lihat menu Dokumen & Posisi (job_profiles.view)

**Kapan nonaktif / gagal:**

- Hanya muncul ketika sedikitnya satu profil sudah dipilih.

### Tombol "Ikon sasaran "Sorot di peta" (pojok kanan atas tiap kartu job family)"

**Yang dikerjakan.** Menyorot job family kartu tersebut di peta sebar; menekan lagi membatalkan sorotan.

**Dampak.** Hanya tampilan.

**Izin.** Lihat menu Dokumen & Posisi (job_profiles.view)

**Kapan nonaktif / gagal:**

- Tersedia pada setiap kartu job family.

### Tombol "Lihat detail & incumbent (pita di bawah tiap kartu job family)"

**Yang dikerjakan.** Membuka jendela detail berisi batang skor kata kunci, contoh uraian jabatan, serta daftar seluruh anggota job profile dan incumbent-nya yang dapat dicari dan difilter. Semua datanya sudah dimuat bersama halaman, jadi tidak ada pengambilan data tambahan.

**Dampak.** Hanya membaca/menampilkan; tidak ada perubahan data.

**Izin.** Lihat menu Dokumen & Posisi (job_profiles.view)

**Kapan nonaktif / gagal:**

- Judul jendela memakai label kata kunci job family, bukan judul umum.
- Bagian "Contoh uraian" tidak muncul bila dokumen anggota teratas tidak punya cuplikan teks.

### Tombol "Filter Semua / Ada incumbent / Tanpa (tiga tombol kecil di daftar anggota)"

**Yang dikerjakan.** Menyaring daftar anggota job profile: semuanya, hanya yang sudah punya karyawan tercocok, atau hanya yang belum punya karyawan tercocok. Bekerja bersama kotak pencarian di sebelahnya (mencari nama jabatan, divisi, nama karyawan, jabatan karyawan, dan nama unit).

**Dampak.** Hanya tampilan daftar; tidak menyimpan apa pun.

**Izin.** Lihat menu Dokumen & Posisi (job_profiles.view)

**Kapan nonaktif / gagal:**

- "Tanpa" adalah nama filter ("tanpa incumbent"), bukan nilai data yang bermasalah.
- Bila tidak ada yang cocok muncul "Tidak ada anggota untuk filter ini".
- Tersedia baik di jendela detail job family maupun di panel outlier.

### Tombol "Outlier / belum terkelompok (judul panel bergaris putus-putus)"

**Yang dikerjakan.** Membuka atau menutup daftar job profile yang tidak masuk kelompok mana pun.

**Dampak.** Hanya tampilan.

**Izin.** Lihat menu Dokumen & Posisi (job_profiles.view)

**Kapan nonaktif / gagal:**

- Panel hanya ada bila terdapat dokumen outlier milik unit aktif.

### Tombol "Ikon dokumen "Info profil pekerjaan" (tiap baris pada panel outlier)"

**Yang dikerjakan.** Membuka satu pop up gabungan untuk baris tersebut — bagian informasi DAN bagian pemetaan manual: kedekatan dengan cluster terdekat (judul umum hasil perangkuman AI — bukan kata kunci mentah — plus persentase kedekatan embedding sebagai angka besar dengan bilah kemajuan), ringkasan profil jabatan (tujuan jabatan, tanggung jawab, kompetensi teknis), daftar incumbent, dan di bagian bawah daftar "Petakan ke cluster" — seluruh cluster diurutkan dari yang paling dekat (persentase kedekatan embedding + jarak UMAP 2D tiap cluster). Pop up ini NON-modal sehingga peta di belakangnya tetap terlihat.

**Dampak.** Menampilkan informasi; pemetaan manual hanya terjadi bila tombol plus pada salah satu baris cluster ditekan (lihat tombol berikut).

**Izin.** Lihat menu Dokumen & Posisi (job_profiles.view)

**Kapan nonaktif / gagal:**

- Bagian "Kedekatan dengan cluster terdekat" kosong pada hasil proses versi lama yang belum menyimpan penjelasan per dokumen.
- Ringkasan profil kosong bila dokumen job profile tidak punya tujuan jabatan/kompetensi terekstraksi.

### Tombol "Ikon plus pada tiap baris cluster di bagian Petakan ke cluster" — ⚠ BERDAMPAK LUAS

**Yang dikerjakan.** MENULIS pemetaan manual: memindahkan dokumen outlier itu dari kelompok -1 ke cluster baris tersebut di tabel hasil proses yang sedang ditampilkan. Sistem sekaligus mencatat kedekatan embedding dokumen ke pusat cluster tujuan dan cluster alternatif terdekat berikutnya. Setelah berhasil, daftar pada halaman dimuat ulang sehingga dokumen pindah dari panel outlier ke anggota cluster tujuannya.

**Dampak.** Mengubah data hasil proses job family yang ditampilkan (bukan dokumen sumbernya). Terbatas pada proses itu; membangun ulang peta (Bangun Ulang Peta) mengembalikan jawaban asli algoritma. Pada proses GLOBAL hanya dokumen milik unit aktif yang boleh dipetakan — dokumen unit lain ditolak. Tidak mengubah kandidat maupun hasil scoring.

**Izin.** Kelola menu Dokumen & Posisi (job_profiles.manage)

**Kapan nonaktif / gagal:**

- Hanya tersedia di dalam pop up info profil pekerjaan pada panel outlier.
- Bila dokumen bukan outlier lagi (sudah dipetakan), pesan "Hanya dokumen outlier yang dapat dipetakan manual" muncul.

### Tombol "Ikon sasaran pada tiap baris cluster di bagian Petakan ke cluster"

**Yang dikerjakan.** Menggambar garis sorotan kuning di peta dari titik outlier ke pusat cluster baris itu (mengganti garis cluster terdekat bawaan); angka di tengah garis = jarak UMAP 2D, dan keterangan di bawah peta memuat cluster tujuan, persentase kedekatan embedding, dan jarak UMAP. Saat pop up dibuka, cluster terdekat otomatis disorot.

**Dampak.** Hanya tampilan.

**Izin.** Lihat menu Dokumen & Posisi (job_profiles.view)

**Kapan nonaktif / gagal:**

- Bila dokumen outlier tidak punya koordinat peta (hasil proses lama), garis tidak dapat digambar.

### Tombol "Ikon sasaran "Sorot posisi di peta" (tiap baris pada panel outlier)"

**Yang dikerjakan.** Menyorot titik outlier tersebut di peta sebar: titiknya diberi cincin berdenyut, digambar garis putus-putus menuju pusat cluster terdekatnya dengan angka jarak UMAP 2D di tengah garis, titik lain diredupkan, dan di bawah peta muncul keterangan lengkap (cluster terdekat — namanya memakai judul umum hasil perangkuman AI, persentase kedekatan embedding, jarak UMAP). Halaman ikut menggulir ke peta bila baris berada di bawah. Menekan ikon lagi (atau "Batalkan sorotan") menghapus sorotan.

**Dampak.** Hanya tampilan; tidak menyimpan apa pun.

**Izin.** Lihat menu Dokumen & Posisi (job_profiles.view)

**Kapan nonaktif / gagal:**

- Ikon hanya muncul bila dokumen outlier punya koordinat peta (hasil proses versi lama tanpa koordinat tidak bisa disorot).
- Bila cluster terdekat tidak tersimpan (hasil proses lama), sorotan tetap muncul tetapi tanpa garis dan keterangan cluster.

### Tombol "Hierarki Job Family (judul yang bisa dilipat)"

**Yang dikerjakan.** Membuka atau menutup seluruh pohon rumpun jabatan. Secara bawaan terbuka.

**Dampak.** Hanya tampilan.

**Izin.** Lihat menu Dokumen & Posisi (job_profiles.view)

**Kapan nonaktif / gagal:**

- Bagian ini tidak ada bila proses tidak menghasilkan pohon hierarki (kurang dari dua job family, penyusunan gagal, atau hasil dari proses versi lama).

### Tombol "Judul simpul di pohon hierarki (nama rumpun atau nama job family)"

**Yang dikerjakan.** Membuka atau menutup simpul: deskripsi ditampilkan penuh (tidak lagi dipotong dua baris), kata kunci ditampilkan sampai 12, dan — pada simpul rumpun — anak-anaknya ikut dibuka/ditutup di hirarki. Pada simpul daun, ikut terbuka daftar job profile anggotanya.

**Dampak.** Hanya tampilan.

**Izin.** Lihat menu Dokumen & Posisi (job_profiles.view)

**Kapan nonaktif / gagal:**

- Judul simpul rumpun selalu bisa diklik (isi detailnya adalah anak-anaknya). Judul daun hanya bisa diklik bila daunnya punya deskripsi, kata kunci, atau anggota; jika tidak, judul tampil sebagai teks biasa.
- Simpul daun yang familynya tidak punya dokumen milik unit aktif tidak bisa dibuka dan tidak menampilkan jumlah profil.

### Tombol "Baris jabatan di dalam simpul daun pohon hierarki" — ⚠ BERDAMPAK LUAS

**Yang dikerjakan.** Membuka kartu penjelasan job profile tersebut: alasan masuk family (kata kunci yang cocok, kedekatan ke pusat family, family alternatif), jalur hirarki dari rumpun teratas sampai familynya, ringkasan profil (tujuan jabatan, tanggung jawab, kompetensi), dan daftar incumbent.

**Dampak.** Hanya membaca/menampilkan; seluruh datanya sudah ikut dimuat bersama halaman.

**Izin.** Lihat menu Dokumen & Posisi (job_profiles.view)

**Kapan nonaktif / gagal:**

- Hanya tersedia setelah simpul daun dibuka.
- Bagian alasan bisa kosong pada dokumen outlier atau pada hasil proses versi lama sebelum penjelasan ini disimpan.

## Position Management (/positions) dan Kandidat (/candidates + detail /candidates/[id])

### Tombol "Tambah (di kanan atas halaman Position Management)"

**Yang dikerjakan.** Membuka dialog "Tambah posisi". Dialog memuat daftar Job Profile yang boleh dilihat business unit aktif, lalu menunggu pengguna memilih karyawan atau jabatan master.

**Dampak.** Belum mengubah data apa pun — hanya membuka formulir.

**Izin.** Membuka dialog: pemegang izin "Lihat Manajemen Posisi" bisa melihat tombolnya, tetapi pencarian di dalamnya dan penyimpanan menuntut izin "Kelola Manajemen Posisi". Daftar Job Profile menuntut izin "Lihat menu Dokumen & Posisi".

**Kapan nonaktif / gagal:**

- Blok pencarian karyawan/jabatan hanya muncul bila data karyawan atau jabatan master tersedia.
- Bila pengguna tidak punya izin Kelola Manajemen Posisi, pencarian akan gagal dengan pesan tidak punya akses.

### Tombol "Simpan ambang pensiun (Tata Kelola → Readiness)"

**Yang dikerjakan.** Menyimpan usia minimum per level jabatan yang membuat seorang pejabat ditandai "mendekati pensiun" di Position Management, beserta satu nilai cadangan untuk level yang tidak tercantum.

**Dampak.** MENULIS berkas konfigurasi (bukan tabel database) yang dibaca ulang setiap halaman dimuat, sehingga perubahannya langsung terlihat tanpa deploy. Berlaku GLOBAL untuk semua business unit. Tidak mengubah data kandidat, posisi, maupun hasil scoring — hanya menentukan kapan lencana pensiun muncul. Dapat diubah kembali kapan saja; tidak ada riwayat versi.

**Izin.** Kelola tata kelola.

**Kapan nonaktif / gagal:**

- Gagal bila semua kolom dikosongkan (minimal satu level harus punya batas usia).
- Nilai di luar rentang wajar (≤ 0 atau ≥ 120 tahun) diabaikan dan diganti nilai bawaan.
- Pejabat yang tanggal lahirnya belum tersinkron tidak akan tertandai berapa pun ambangnya — jalankan sinkronisasi "Data Pribadi" lebih dulu.

### Tombol "Tambah massal (di kanan atas halaman Position Management)" — ⚠ BERDAMPAK LUAS

**Yang dikerjakan.** Membuka dialog "Tambah posisi massal": pilih level pemangku jabatan minimum (bawaan Manager ke atas), program suksesi, dan apakah scoring AHP + TOPSIS langsung dijalankan. Dialog menampilkan lebih dulu daftar jabatan yang akan ditambahkan beserta jumlahnya, plus jabatan yang sudah terdaftar dan akan dilewati. Tombol konfirmasinya MENDAFTARKAN seluruh jabatan aktif yang pemangkunya berada pada grade tersebut ke atas.

**Dampak.** MENULIS banyak baris posisi sekaligus pada business unit aktif — beserta seluruh pemangku jabatannya, rentang level suksesor sesuai programnya (Critical Position: satu level di bawah pemangku; Emergency Position: level pemangku sampai satu level di atasnya), dan kualifikasi/kompetensi dari job profile yang cocok bila ada. Bila scoring otomatis dicentang, juga membuat SATU sesi penilaian + satu baris riwayat penilaian per posisi, yang dikerjakan layanan scoring di latar belakang secara bergiliran. Jabatan yang sudah terdaftar pada program itu dilewati, sehingga menjalankan ulang tidak menggandakan data. Membatalkan berarti menghapus posisi satu per satu dari daftar.

**Izin.** Kelola Manajemen Posisi; bila scoring otomatis dicentang juga menuntut izin Jalankan scoring.

**Kapan nonaktif / gagal:**

- Mati bila tidak ada jabatan baru yang memenuhi batas level tersebut (angka "0 baru" pada pratinjau).
- Program Talent Pool tidak tersedia di sini — sama seperti pada form posisi biasa.
- Posisi yang tersimpan tetapi kolam kandidatnya kosong (rentang grade terlalu sempit, semua kandidat tersaring) dilaporkan sebagai gagal scoring; posisinya sudah terdaftar dan bisa di-scoring manual kemudian.
- Posisi tanpa job profile tetap dibuat, dengan catatan bahwa kualifikasi & kompetensinya kosong dan perlu dilengkapi.
- Sebelum dijalankan, dialog menampilkan peringatan kuning berisi jumlah dan nama jabatan yang belum punya job profile, beserta kotak centang "Tetap jalankan scoring untuk jabatan tanpa job profile". Bila dilepas, jabatan tersebut tetap didaftarkan tetapi scoring-nya tidak dijalankan — angkanya dilaporkan pada ringkasan hasil.

### Tombol "Reset Scoring" — ⚠ BERDAMPAK LUAS & TIDAK DAPAT DIBATALKAN · SAAT INI DISEMBUNYIKAN

**Catatan.** Tombol ini sengaja TIDAK ditampilkan pada halaman Position Management saat ini; dialog dan aksinya tetap ada di kode dan dapat dimunculkan kembali bila diperlukan.

**Yang dikerjakan.** Membuka dialog "Reset hasil scoring satu program". Setelah program dipilih, dialog menampilkan jumlah run, sesi, baris hasil peringkat, dan posisi terdampak yang akan dihapus. Tombol hapusnya baru aktif setelah nama program diketik ulang persis. Menjalankannya MENGHAPUS PERMANEN seluruh riwayat penilaian program tersebut.

**Dampak.** MENGHAPUS baris riwayat penilaian (run) dan sesi penilaian pada semua posisi program tersebut, beserta seluruh data yang menempel padanya: hasil peringkat, catatan pengecualian kandidat, rekaman skor aspek per run, dan percakapan analisis (chat) atas run itu. Run yang sedang berjalan dihentikan lebih dulu. TIDAK menghapus posisi, kandidat, rentang level, maupun pemangku jabatan. Suksesor terpilih dipertahankan kecuali kotak centangnya dipilih. Cakupan: satu program pada business unit aktif. TIDAK ADA PEMBATALAN — satu-satunya jalan kembali adalah menjalankan scoring lagi, dan hasilnya akan bertanggal hari ini, bukan tanggal aslinya.

**Izin.** Jalankan scoring DAN Kelola Manajemen Posisi.

**Kapan nonaktif / gagal:**

- Mati selama nama program belum diketik persis sama.
- Mati bila program tersebut memang tidak punya run atau sesi apa pun.
- Bila layanan scoring tidak dapat dihubungi, run yang sedang berjalan tetap dihapus dari database; proses yang terlanjur berjalan akan gagal sendiri karena barisnya sudah tidak ada.

### Tombol "Scoring Ulang (di kanan atas halaman Position Management)" — ⚠ BERDAMPAK LUAS

**Yang dikerjakan.** Membuka dialog "Scoring ulang satu program": pilih program, lihat daftar posisinya beserta tanggal run terakhir, lalu jalankan ulang penilaian AHP + TOPSIS untuk SEMUA posisi pada program tersebut.

**Dampak.** MEMBUAT satu sesi penilaian + satu baris riwayat penilaian BARU pada setiap posisi, dikerjakan layanan scoring di latar belakang secara bergiliran. TIDAK menghapus atau menimpa hasil lama — run sebelumnya tetap tersimpan dan bisa dibuka dari riwayat run tiap posisi. Rentang level dan aturan filter mengikuti yang sudah tersimpan pada masing-masing posisi. Cakupan: satu program pada business unit aktif.

**Izin.** Jalankan scoring.

**Kapan nonaktif / gagal:**

- Mati bila program tersebut belum punya posisi, atau semua posisinya sedang di-scoring.
- Posisi yang sedang berjalan dilewati (ditandai "sedang scoring") supaya tidak ada dua run pada posisi yang sama.
- Posisi tanpa job profile diberi peringatan kuning dengan kotak centang yang sama seperti Tambah Batch; bila dilepas, posisi tersebut tidak ikut dijalankan.
- Posisi yang kolam kandidatnya kosong dilaporkan gagal satu per satu; posisi lain tetap berjalan.

### Tombol "Pilih program... (Program suksesi di dialog Tambah/Ubah posisi)"

**Yang dikerjakan.** Menentukan program penilaian yang menaungi posisi ini. Daftarnya adalah template program milik business unit aktif. Pilihan ini menentukan aturan filter, kriteria, dan bench posisi tersebut, serta menentukan di program mana posisi ini muncul saat menjalankan Scoring Baru.

**Dampak.** Hanya mengisi formulir sampai tombol simpan ditekan. Sesudah tersimpan: satu posisi hanya berlaku untuk satu program — jabatan yang sama pada program lain adalah posisi terpisah yang harus ditambahkan sendiri.

**Izin.** Kelola Manajemen Posisi.

**Kapan nonaktif / gagal:**

- Wajib diisi; menyimpan tanpa program memunculkan pesan "Program suksesi wajib dipilih.".
- Talent Pool tidak muncul di daftar ini: Talent Pool menyaring kandidat dan punya menunya sendiri, bukan program untuk mengisi sebuah kursi.
- Pada dialog Ubah, bila posisi SUDAH pernah di-scoring, pilihan diganti lencana bertanda 'terkunci' dan program tidak dapat dipindah lagi.
- Menyimpan kombinasi jabatan + pejabat + program yang sudah terdaftar ditolak dengan pesan bahwa posisi itu sudah ada pada program tersebut.

### Tombol "Kotak centang pejabat saat ini (dialog Tambah/Ubah posisi)"

**Yang dikerjakan.** Menentukan siapa saja pejabat aktif yang akan digantikan oleh posisi ini. Daftarnya diisi otomatis dari SELURUH pemangku aktif jabatan yang dipilih — satu jabatan bisa dipegang beberapa orang sekaligus — dan seluruhnya tercentang secara bawaan.

**Dampak.** Hanya mengisi formulir sampai disimpan. Setelah tersimpan: setiap pejabat yang dicentang tercatat pada posisi ini dan DIKELUARKAN dari kolam kandidatnya, jadi tidak akan pernah dinilai sebagai pengganti dirinya sendiri, dan tidak bisa ditambahkan lewat "Tambah kandidat" pada hasil run. Pejabat pertama yang tercentang menjadi "Utama" — nama itulah yang tampil sebagai Holder di daftar posisi dan dipakai saran job profile.

**Izin.** Kelola Manajemen Posisi.

**Kapan nonaktif / gagal:**

- Minimal satu pejabat harus tercentang; jika tidak, muncul pesan "Pilih minimal satu pejabat saat ini." dan dialog tetap terbuka.
- Daftar kosong berarti jabatan tersebut tidak punya pemangku aktif pada data sinkronisasi — pilih karyawan lewat pencarian nomor 1 sebagai gantinya.
- Menghapus centang seorang pejabat pada dialog Ubah mengeluarkannya dari posisi; ia kembali menjadi kandidat biasa pada run berikutnya (hasil run yang sudah selesai tidak berubah).

### Tombol "Pilih nama karyawan... (pencarian nomor 1 di dialog Tambah posisi)"

**Yang dikerjakan.** Mengisi Nama pejabat, NPK, Departemen, dan Divisi dari data karyawan; lalu mencari jabatan aktif orang itu lewat relasi penempatan pegawai dan mengisi Nama posisi; lalu menyarankan satu Job Profile yang cocok dan mengisi Pendidikan, Pengalaman, Job Family, serta daftar kompetensi teknis; terakhir menampilkan info tambahan posisi (grade, atasan, jumlah bawahan).

**Dampak.** Hanya mengisi formulir di layar. Tidak ada data yang tersimpan sampai tombol simpan ditekan.

**Izin.** Kelola Manajemen Posisi (untuk pencarian relasi dan saran Job Profile).

**Kapan nonaktif / gagal:**

- Nonaktif sementara saat proses pencarian berjalan.
- Bila relasi penempatan gagal dibaca, muncul peringatan dan sistem memakai posisi cadangan dari data kandidat.
- Kandidat yang sudah dihapus tidak akan ditemukan sebagai pemangku jabatan.
- Saran Job Profile bersifat terbaik-usaha: bila gagal, kolom kualifikasi dibiarkan apa adanya.

### Tombol "Pilih nama jabatan... (pencarian nomor 2 di dialog Tambah posisi)"

**Yang dikerjakan.** Mengisi Nama posisi, Departemen, Divisi dari jabatan master; mencari pemangku aktif jabatan itu dan mengisi Nama pejabat + NPK; lalu menjalankan saran Job Profile dan info tambahan posisi yang sama seperti jalur pencarian karyawan.

**Dampak.** Hanya mengisi formulir di layar. Belum ada penyimpanan.

**Izin.** Kelola Manajemen Posisi.

**Kapan nonaktif / gagal:**

- Bila jabatan tidak punya pemangku aktif, Nama pejabat dan NPK dikosongkan — penyimpanan nanti akan ditolak dengan pesan "Nama pejabat wajib diisi.".
- Memilih jalur ini mengosongkan pilihan pencarian karyawan, dan sebaliknya.
- Jabatan yang sudah kedaluwarsa dan tanpa pemangku aktif tidak muncul di daftar.

### Tombol "Pilih dari Job Profile (combobox di bagian Kualifikasi & Kompetensi)"

**Yang dikerjakan.** Mengganti isi Pendidikan, Pengalaman, Job Family, dan daftar Kompetensi Teknis dengan isi dokumen Job Profile yang dipilih; juga memperbaiki Departemen/Divisi bila dokumen menyebutkannya.

**Dampak.** Menimpa isian kualifikasi di formulir (bukan di database). Pilihan manual mematikan label "disarankan otomatis".

**Izin.** Lihat menu Dokumen & Posisi untuk daftarnya; Kelola Manajemen Posisi untuk menyimpan hasilnya.

**Kapan nonaktif / gagal:**

- Daftar hanya berisi dokumen job profile yang menjadi milik business unit aktif, ditambah dokumen yang foldernya belum dipetakan ke business unit mana pun.
- Job profile tanpa data hasil ekstraksi tidak akan mengubah apa pun.

### Tombol "x (tanda silang pada lencana Kompetensi Teknis di dialog posisi)"

**Yang dikerjakan.** Menghapus satu kompetensi dari daftar kompetensi wajib pada formulir.

**Dampak.** Hanya di formulir. Saat menambah posisi baru, kompetensi yang dibuang tidak ikut tersimpan. Saat MENGUBAH posisi, perubahan daftar kompetensi ini tidak disimpan sama sekali (lihat catatan pada tombol Simpan perubahan).

**Izin.** Kelola Manajemen Posisi.

**Kapan nonaktif / gagal:**

- Tidak ada konfirmasi; untuk mengembalikannya, pilih ulang Job Profile.

### Tombol "Level minimum... / Level maksimum... (Rentang Level Suksesor)"

**Yang dikerjakan.** Menentukan rentang level karyawan yang boleh menjadi suksesor. Memilih level minimum akan otomatis menyamakan level maksimum bila belum diisi, dan mengosongkan level maksimum bila ternyata lebih rendah dari minimum.

**Dampak.** Menentukan dua angka batas grade yang tersimpan pada posisi dan dipakai menyaring kandidat setiap kali penilaian dijalankan.

**Izin.** Kelola Manajemen Posisi.

**Kapan nonaktif / gagal:**

- Daftar level berasal dari master grade business unit aktif; kosong bila pemetaan perusahaan ke business unit belum ada.
- Kedua batas wajib terisi saat menambah posisi baru, jika tidak muncul pesan "Rentang level suksesor wajib diisi.".

### Tombol "Simpan posisi (tombol submit dialog Tambah posisi)" — ⚠ BERDAMPAK LUAS

**Yang dikerjakan.** Memvalidasi isian wajib lalu MEMBUAT satu posisi baru berisi: program suksesi, nama posisi, departemen, divisi, status aktif, nama pejabat + NPK pejabat, pendidikan, pengalaman, job family, batas grade minimum dan maksimum, serta daftar kompetensi teknis wajib. Mencatat jejak audit "Posisi ... dibuat pada program ..." dan menyegarkan daftar posisi, kandidat, dan beranda.

**Dampak.** Menambah SATU baris posisi di business unit yang sedang aktif. Business unit lain tidak tersentuh. Dapat dibatalkan hanya dengan menghapus posisi itu (dan selama belum ada penilaian, penghapusannya tidak merusak apa-apa). Perlu diketahui: kaitan ke jabatan master yang dipilih tidak ikut disimpan, sehingga pencocokan Job Profile di kemudian hari mengandalkan NPK pejabat dan nama posisi.

**Izin.** Kelola Manajemen Posisi.

**Kapan nonaktif / gagal:**

- Wajib terisi: Program suksesi, Nama posisi, Nama pejabat, Pendidikan, Job Family, Level minimum, Level maksimum. Kalau kosong, muncul pesan '<nama kolom> wajib diisi.' dan dialog tetap terbuka.
- Nama posisi dan Nama pejabat hanya bisa terisi lewat dua pencarian di atas — tidak bisa diketik manual.
- Pendidikan dan Job Family boleh diketik manual bila tidak memakai Job Profile.
- Duplikat dicegah PER PROGRAM: jabatan/pejabat yang sama pada program yang sama ditolak, tetapi pada program berbeda justru memang cara mendaftarkannya.

### Tombol "Ikon pensil pada baris posisi (Ubah posisi)"

**Yang dikerjakan.** Membuka dialog "Ubah posisi" berisi data posisi saat ini. Blok pencarian karyawan/jabatan tidak ditampilkan pada mode ubah, sehingga nama posisi dan nama pejabat praktis terkunci pada nilai lama.

**Dampak.** Belum mengubah data; hanya membuka formulir.

**Izin.** Kelola Manajemen Posisi.

**Kapan nonaktif / gagal:**

- Rentang level diisi ulang dengan mencocokkan angka grade tersimpan ke batas level; bila tidak ada level yang cocok persis, kedua combobox tampil kosong.

### Tombol "Simpan perubahan (tombol submit dialog Ubah posisi)"

**Yang dikerjakan.** Memperbarui posisi: nama posisi, departemen, divisi, status dikembalikan ke aktif, nama pejabat, NPK pejabat, serta batas grade minimum dan maksimum. Mencatat jejak audit "Posisi ... diperbarui" dan menyegarkan daftar serta halaman detail posisi.

**Dampak.** Mengubah SATU baris posisi. PENTING: Pendidikan, Pengalaman, Job Family, dan daftar Kompetensi Teknis TIDAK ikut tersimpan lewat tombol ini walaupun terlihat bisa diedit — ubah lewat halaman detail posisi (menautkan Job Profile). Perubahan batas grade langsung mempengaruhi siapa yang lolos saring pada penilaian BERIKUTNYA; hasil penilaian yang sudah selesai tidak berubah. Tidak ada riwayat versi, jadi membatalkan berarti mengetik/memilih ulang nilai lama.

**Izin.** Kelola Manajemen Posisi.

**Kapan nonaktif / gagal:**

- Nama posisi wajib terisi.
- Program hanya ikut tersimpan bila posisi belum pernah di-scoring. Mengubah program pada posisi yang sudah punya run ditolak dengan pesan agar menambahkan posisi baru pada program yang diinginkan.
- Bila rentang level tampil kosong saat dialog dibuka dan langsung disimpan, batas grade posisi akan dikosongkan — artinya penyaringan grade tidak lagi membatasi kandidat.
- Aksi ini mencocokkan posisi hanya berdasarkan identitasnya, jadi selalu pastikan sedang berada di business unit yang benar.

### Tombol "Ikon tempat sampah pada baris posisi → "Hapus posisi"" — ⚠ BERDAMPAK LUAS

**Yang dikerjakan.** Meminta konfirmasi, lalu MENGHAPUS PERMANEN posisi tersebut dari database dan mencatat jejak audit "Posisi dihapus".

**Dampak.** Sangat besar dan TIDAK DAPAT DIBATALKAN. Karena semua data penilaian menempel pada posisi, penghapusan ikut menghapus permanen: seluruh riwayat run penilaian posisi itu, seluruh hasil analisis/peringkatnya, seluruh suksesor terpilih, sesi penilaian, dan kriteria untuk posisi tersebut. Cakupan: satu posisi beserta seluruh turunannya, di dalam business unit ini. Tidak ada tombol pulihkan.

**Izin.** Kelola Manajemen Posisi.

**Kapan nonaktif / gagal:**

- Teks konfirmasi memang menyatakan tindakan tidak bisa dibatalkan — itu benar.
- Jangan gunakan untuk sekadar 'menyembunyikan' posisi; tidak ada opsi non-aktif, jadi posisi yang sudah punya riwayat penilaian sebaiknya dibiarkan.

### Tombol "Ikon kalkulator pada baris posisi (Mulai Scoring)"

**Yang dikerjakan.** Berpindah ke wizard penilaian dengan posisi tersebut sudah terpilih.

**Dampak.** Hanya berpindah halaman; penilaian baru berjalan setelah dikonfirmasi di wizard.

**Izin.** Jalankan scoring (halaman wizard akan menolak dan melempar ke beranda tanpa izin ini).

**Kapan nonaktif / gagal:**

- Bila business unit belum punya satu pun posisi, wizard mengembalikan pengguna ke halaman Posisi.

### Tombol "Nama posisi (tautan) / "Buka detail posisi""

**Yang dikerjakan.** Membuka halaman detail posisi: daftar run, hasil peringkat, suksesor terpilih, dan penautan Job Profile.

**Dampak.** Hanya navigasi.

**Izin.** Lihat Manajemen Posisi.

**Kapan nonaktif / gagal:**

- Tidak ada.

### Tombol "Suksesor terpilih (n)"

**Yang dikerjakan.** Membuka dialog berisi daftar suksesor yang sudah dipilih, dengan penyaring per program.

**Dampak.** Hanya menampilkan; tidak mengubah apa pun.

**Izin.** Lihat Manajemen Posisi.

**Kapan nonaktif / gagal:**

- Tombol tidak muncul bila belum ada suksesor terpilih untuk posisi itu.

### Tombol "Tiga kotak pada kartu Kesiapan suksesor"

**Yang dikerjakan.** Menyaring daftar posisi ke satu keadaan kesiapan — "Sudah ada kandidat siap", "Dinilai, belum ada yang siap", atau "Belum pernah dinilai" — lalu memuat ulang dari halaman 1. Keadaannya dituliskan ke alamat halaman (`?bench=ready|not_ready|unscored`) supaya tahan penyegaran dan bisa dikirim ke orang lain. Menekan kotak yang sedang aktif akan melepaskan filternya.

**Dampak.** Hanya tampilan; tidak ada data yang berubah.

**Izin.** Lihat Manajemen Posisi.

**Kapan nonaktif / gagal:**

- Kotaknya tidak muncul bila tidak ada satu pun posisi yang cocok dengan filter pencarian/departemen/divisi/program saat ini.
- Angka pada kotak dihitung atas seluruh posisi hasil filter (bukan hanya 20 baris di layar), jadi setelah satu kotak ditekan angka "Total posisi" di sebelahnya akan mengecil sementara angka pada kotak tetap.

### Tombol "Tampilkan semua posisi (pada chip "Daftar sedang disaring")"

**Yang dikerjakan.** Mematikan penyaring kesiapan maupun kiriman beranda, memuat ulang daftar dari halaman 1, dan membersihkan alamat halaman agar penyegaran tidak memunculkan filter itu lagi.

**Dampak.** Hanya tampilan; tidak ada data yang berubah.

**Izin.** Lihat Manajemen Posisi.

**Kapan nonaktif / gagal:**

- Chip hanya muncul bila daftar sedang disaring oleh kartu Kesiapan suksesor atau oleh kartu beranda.

### Tombol "Ikon ? pada angka di Beranda"

**Yang dikerjakan.** Membuka popover berisi rumus angka itu — pembilang, penyebut, dan apa yang sengaja tidak ikut dihitung. Tersedia pada Bench coverage, Ready now / soon, Incumbent coverage, dan Readiness Bands.

**Dampak.** Hanya tampilan.

**Izin.** Tidak ada (mengikuti izin halaman Beranda).

**Kapan nonaktif / gagal:**

- Tidak pernah nonaktif. Pada kartu "Ready now / soon" ikonnya sengaja diletakkan di luar tautan kartu, sehingga menekannya membuka penjelasan dan tidak ikut berpindah halaman.

### Tombol "Panah kiri / kanan (paginasi Posisi dan Kandidat)"

**Yang dikerjakan.** Memuat halaman berikutnya atau sebelumnya dengan filter dan urutan yang sedang aktif.

**Dampak.** Hanya tampilan.

**Izin.** Lihat Manajemen Posisi / Lihat kandidat.

**Kapan nonaktif / gagal:**

- Nonaktif di halaman pertama dan terakhir.
- Panah tidak muncul sama sekali bila hasil hanya satu halaman.

### Tombol "Tambah (di kanan atas halaman Kandidat)"

**Yang dikerjakan.** Membuka dialog "Tambah kandidat" dengan status disiplin awal Clear dan MCU awal Fit.

**Dampak.** Belum mengubah data.

**Izin.** Kelola kandidat (untuk menyimpan).

**Kapan nonaktif / gagal:**

- Pilihan Posisi, Divisi, dan Departemen berasal dari data master hasil sinkronisasi.

### Tombol "Simpan kandidat (submit dialog Tambah kandidat)" — ⚠ BERDAMPAK LUAS

**Yang dikerjakan.** Membuat satu baris kandidat baru berisi nama, NPK, email, posisi saat ini, departemen, divisi, masa kerja, status disiplin, status MCU, keterangan MCU, enam nilai PA, HAV, rekomendasi behavior, catatan behavior, pendidikan, jurusan; lalu menulis ulang daftar kompetensi teknis kandidat sesuai isi formulir. Mencatat jejak audit "Karyawan ... ditambahkan".

**Dampak.** Menambah SATU kandidat di business unit aktif; ia langsung ikut diperhitungkan pada penilaian berikutnya. Dapat dibatalkan dengan menghapus kandidat itu (penghapusan bersifat menyembunyikan, bukan memusnahkan).

**Izin.** Kelola kandidat.

**Kapan nonaktif / gagal:**

- Wajib: Nama lengkap, ID Karyawan (NPK), Posisi saat ini, Masa kerja, Divisi, Departemen, Pendidikan, Jurusan, HAV Quadrant, Behavior Recommendation.
- NPK yang sudah dipakai akan ditolak dengan pesan "NPK sudah terdaftar.".
- Masa kerja harus angka >= 0.
- Kandidat yang dibuat manual bisa tertimpa/terlengkapi oleh sinkronisasi bila NPK-nya cocok dengan data HR.

### Tombol "Ikon pensil pada kartu/baris kandidat, dan tombol Edit di halaman detail kandidat"

**Yang dikerjakan.** Membuka dialog "Ubah karyawan" berisi data orang tersebut, termasuk enam kotak nilai PA dan daftar kompetensi teknis yang bisa diubah.

**Dampak.** Belum mengubah data.

**Izin.** Kelola kandidat.

**Kapan nonaktif / gagal:**

- Di halaman daftar, dialog ini juga menyegarkan daftar setelah tersimpan; di halaman detail, halaman dimuat ulang.

### Tombol "Simpan perubahan (submit dialog Ubah karyawan)" — ⚠ BERDAMPAK LUAS

**Yang dikerjakan.** Memperbarui kandidat: nama, email, posisi saat ini, departemen, divisi, masa kerja, nilai PA, HAV, rekomendasi behavior, catatan behavior, pendidikan, jurusan, dan (bila dipilih) status disiplin serta MCU. Sesudahnya menghapus seluruh baris kompetensi teknis kandidat lalu menuliskannya kembali persis seperti isi formulir. Mencatat jejak audit "Karyawan ... diperbarui".

**Dampak.** Mengubah SATU kandidat di business unit aktif. Nilai yang dikosongkan benar-benar menjadi kosong (mis. HAV, rekomendasi behavior, atau Keterangan MCU bisa terhapus). Status disiplin dan MCU tidak bisa dikosongkan — bila tidak dipilih, nilai lama dipertahankan. Kolom "Keterangan MCU" hanya menulis keterangan MANUAL; keterangan dari sinkronisasi ditampilkan terpisah dan tidak pernah ditimpa dari sini. NPK TIDAK pernah ikut berubah walau kolomnya bisa diketik, karena NPK adalah identitas yang menyambungkan orang ini dengan seluruh riwayat penilaiannya. Perubahan tidak memengaruhi hasil penilaian yang sudah selesai, tetapi memengaruhi penilaian berikutnya. Tidak ada riwayat versi.

**Izin.** Kelola kandidat.

**Kapan nonaktif / gagal:**

- Wajib: Nama lengkap (dan kolom bertanda bintang lain agar formulir bisa dikirim).
- Menghapus kompetensi teknis hasil sinkronisasi tidak bertahan: sinkronisasi berikutnya akan menuliskannya kembali. Yang bertahan adalah perubahan proficiency/target, karena baris tersebut menjadi bertanda manual.
- Untuk memperbaiki NPK yang salah, kandidat harus dihapus lalu dimunculkan kembali lewat sinkronisasi.

### Tombol "Tambah kompetensi teknis... / ikon tempat sampah kecil di kartu kompetensi (dalam dialog kandidat)" — ⚠ BERDAMPAK LUAS

**Yang dikerjakan.** Menambah atau membuang satu kompetensi pada daftar di formulir. Kompetensi baru default target 3 (Advanced) dan current 2 (Intermediate).

**Dampak.** Baru tersimpan setelah tombol simpan ditekan; saat disimpan seluruh daftar kompetensi kandidat ditulis ulang mengikuti formulir.

**Izin.** Kelola kandidat.

**Kapan nonaktif / gagal:**

- Pilihan kompetensi berasal dari kamus kompetensi teknis hasil sinkronisasi.
- Kompetensi yang sudah ada tidak bisa ditambahkan dua kali.

### Tombol "Ikon tempat sampah pada kartu/baris kandidat → "Hapus karyawan"" — ⚠ BERDAMPAK LUAS

**Yang dikerjakan.** Meminta konfirmasi, lalu MENANDAI kandidat sebagai dihapus (jenis: manual) beserta waktu dan pelakunya. Kandidat langsung hilang dari daftar Kandidat, dari kolam calon pada penilaian berikutnya, dan tidak lagi dipakai sebagai pemangku jabatan pada formulir posisi. Mencatat jejak audit "Karyawan ... dihapus (data historis dipertahankan)".

**Dampak.** Barisnya TIDAK dimusnahkan: seluruh riwayat penilaian, peringkat, dan status suksesor terpilih tetap utuh dan tetap menampilkan namanya. Cakupan: satu orang, di business unit aktif saja. DAPAT DIBATALKAN — walau teks dialog menyebut sebaliknya — lewat Pengaturan → Sinkronisasi → kartu "Data Kandidat" → buka "Lihat kandidat yang dihapus manual" → tombol Pulihkan. Penting: penghapusan jenis manual dianggap keputusan sengaja, sehingga sinkronisasi kandidat TIDAK akan memunculkannya kembali.

**Izin.** Kelola kandidat.

**Kapan nonaktif / gagal:**

- Menghapus kandidat yang sudah dihapus tidak menimbulkan error, hanya tidak melakukan apa-apa.
- Hanya berlaku pada kandidat milik business unit aktif.
- Daftar pemulihan hanya menampilkan 200 penghapusan terbaru.

### Tombol "Data disamarkan / Data terlihat (dan tombol "Tampilkan data" pada banner)"

**Yang dikerjakan.** Menyalakan atau mematikan penyamaran data kandidat pada halaman daftar, dan mengingat pilihan itu selama tab browser masih terbuka.

**Dampak.** Hanya tampilan di perangkat pengguna; tidak ada data yang berubah dan tidak ada catatan audit. Selalu kembali ke kondisi tersamar pada tab baru.

**Izin.** Lihat kandidat.

**Kapan nonaktif / gagal:**

- Bila penyimpanan sesi browser diblokir (mode privat/kebijakan cookie ketat), tombol tetap berfungsi tetapi pilihannya tidak diingat.
- Halaman detail kandidat tidak mengikuti penyamaran ini.

### Tombol "Filter Status suksesor (halaman Kandidat)"

**Yang dikerjakan.** Menyaring daftar kandidat menjadi yang sudah pernah ditetapkan sebagai suksesor ('Sudah dipilih suksesor') atau yang belum ('Belum dipilih'), lalu memuat ulang dari halaman 1. Sumbernya sama dengan tombol "Suksesor terpilih" di Manajemen Posisi.

**Dampak.** Hanya tampilan.

**Izin.** Lihat kandidat.

**Kapan nonaktif / gagal:**

- Tidak pernah nonaktif. Dihitung atas seluruh kandidat business unit aktif, termasuk yang dipilih untuk posisi di business unit lain.

### Tombol "Lencana Suksesor (kartu dan tabel Kandidat)"

**Yang dikerjakan.** Menampilkan daftar posisi tempat kandidat ini ditetapkan sebagai suksesor saat kursor diarahkan atau lencana diketuk: nama posisi (tautan ke halaman detail posisi), departemen, program, urutan suksesor, dan readiness saat dipilih.

**Dampak.** Hanya tampilan; tidak mengubah pilihan suksesor. Menambah atau melepas suksesor tetap dilakukan dari halaman detail posisi.

**Izin.** Lihat kandidat.

**Kapan nonaktif / gagal:**

- Lencana tidak muncul bila kandidat belum pernah dipilih.
- Saat data disamarkan, daftarnya hanya menyebut jumlah posisi; nama posisi baru terlihat setelah menekan "Data disamarkan".

### Tombol "Ikon kotak-kotak / ikon daftar (tampilan kartu atau tabel di halaman Kandidat)"

**Yang dikerjakan.** Mengganti bentuk tampilan dan memuat ulang dari halaman 1 (kartu 8 baris per halaman, tabel 20 baris per halaman).

**Dampak.** Hanya tampilan.

**Izin.** Lihat kandidat.

**Kapan nonaktif / gagal:**

- Menekan mode yang sedang aktif tidak melakukan apa-apa.

### Tombol "Riwayat Performance Appraisal / Riwayat Jabatan / Technical Competencies (tombol lipat pada kartu kandidat)"

**Yang dikerjakan.** Membuka atau menutup rincian pada satu kartu kandidat. Hanya satu kartu yang bisa terbuka pada satu waktu per jenis rincian.

**Dampak.** Hanya tampilan.

**Izin.** Lihat kandidat.

**Kapan nonaktif / gagal:**

- Tidak tersedia sama sekali saat mode penyamaran aktif.
- Blok Riwayat Jabatan dan Technical Competencies hanya muncul bila datanya ada.

### Tombol "Nama kandidat (tautan) / Kembali (di halaman detail)"

**Yang dikerjakan.** Membuka halaman detail kandidat, atau kembali ke daftar Kandidat.

**Dampak.** Hanya navigasi.

**Izin.** Lihat kandidat.

**Kapan nonaktif / gagal:**

- Membuka detail kandidat yang sudah dihapus akan menampilkan halaman tidak ditemukan.

### Tombol "Baris pada "Riwayat Scoring Run" (halaman detail kandidat)"

**Yang dikerjakan.** Membuka halaman detail posisi dengan run tersebut langsung terpilih.

**Dampak.** Hanya navigasi.

**Izin.** Lihat Manajemen Posisi (halaman tujuan).

**Kapan nonaktif / gagal:**

- Hanya menampilkan run milik business unit yang sedang aktif.

### Tombol "Kosongkan Data Kandidat (Pengaturan → Sinkronisasi → kartu "Data Kandidat")" — ⚠ BERDAMPAK LUAS

**Yang dikerjakan.** Setelah pengguna mengetik kata HAPUS dengan huruf besar, menandai SEMUA kandidat aktif di business unit ini sebagai dikosongkan (jenis: bulk), lengkap dengan waktu dan pelakunya, lalu mencatat jejak audit berisi jumlahnya.

**Dampak.** Seluruh kolam kandidat business unit ini hilang dari halaman Kandidat dan dari penilaian berikutnya. Baris datanya tetap ada: riwayat penilaian, hasil analisis, dan suksesor terpilih tetap utuh. Business unit lain sama sekali tidak tersentuh. DAPAT DIBATALKAN dua cara: tombol Pulihkan di kartu yang sama, atau menjalankan sinkronisasi kandidat sehingga semua orang kembali dengan identitas yang sama seperti sebelumnya.

**Izin.** Kelola kandidat.

**Kapan nonaktif / gagal:**

- Tombol mati bila tidak ada kandidat aktif, atau saat proses lain sedang berjalan.
- Konfirmasi harus persis HAPUS huruf besar.
- Tidak menyentuh kandidat yang sebelumnya dihapus satu per satu.

### Tombol "Pulihkan (kartu "Data Kandidat", untuk pengosongan massal)" — ⚠ BERDAMPAK LUAS

**Yang dikerjakan.** Mengembalikan semua kandidat yang berstatus dikosongkan massal di business unit aktif menjadi aktif lagi, dan mencatat jejak audit berisi jumlahnya.

**Dampak.** Kandidat kembali muncul di halaman Kandidat dan kembali ikut penilaian, dengan identitas dan seluruh riwayat lamanya tetap tersambung. Cakupan: business unit aktif saja. Sengaja TIDAK menyentuh kandidat yang dihapus satu per satu, karena itu dianggap keputusan sengaja.

**Izin.** Kelola kandidat.

**Kapan nonaktif / gagal:**

- Tombol hanya muncul bila ada kandidat berstatus dikosongkan.
- Bila tidak ada yang dikosongkan, hasilnya berupa pesan bahwa tidak ada data untuk dipulihkan.

### Tombol "Pulihkan (per baris, di panel "Lihat kandidat yang dihapus manual")" — ⚠ BERDAMPAK LUAS

**Yang dikerjakan.** Mengaktifkan kembali satu kandidat yang tadinya dihapus dari halaman Kandidat, dan mencatat jejak audit "Karyawan ... dipulihkan".

**Dampak.** Satu orang kembali muncul di halaman Kandidat dan kembali ikut penilaian berikutnya, dengan seluruh riwayatnya tetap tersambung. Cakupan: satu baris di business unit aktif. Bisa dibalik lagi dengan menghapusnya kembali.

**Izin.** Kelola kandidat.

**Kapan nonaktif / gagal:**

- Panel hanya muncul bila ada kandidat yang dihapus satu per satu, dan daftarnya dibatasi 200 penghapusan terbaru.
- Jika gagal, baris tetap ditampilkan agar bisa dicoba lagi.
