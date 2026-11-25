# Daftar Kebutuhan Fungsional — AI Pulse

Hasil analisis balik dari sistem yang berjalan

| | |
|---|---|
| Versi dokumen | 1.7 |
| Tanggal | 25 November 2026 (versi 1.6: 17 November 2026; versi 1.5 dan 1.4: 5 November 2026; versi 1.3: 30 Oktober 2026; versi 1.2 dan 1.1: 29 Oktober 2026; versi 1.0: 30 September 2026) |
| Perubahan versi 1.7 | 25 November 2026: enkripsi tingkat aplikasi dihapus dari sistem beserta kunci utama, berkas kuncinya, dan halaman Keamanan. Data tersimpan tanpa enkripsi di PostgreSQL dan perlindungannya bergantung pada kendali akses basis data. FR-SEC-01–15 dihapus (barisnya tetap dicantumkan agar penomoran stabil) dan domain FR-SEC kini bernama "Keamanan data"; bagian 5 mencatat enkripsi tingkat aplikasi sebagai hal yang tidak dipenuhi. Jumlah butir tetap 282 dalam 14 domain, termasuk butir yang ditandai dihapus |
| Perubahan versi 1.6 | 17 November 2026: metode AI Tournament (LLM) dihapus dari sistem; AHP + TOPSIS menjadi satu-satunya metode penilaian. Ikut dihapus: instruksi model per program beserta riwayat versinya, Konteks Bisnis, umpan balik suara atas penilaian beserta izin `scoring.feedback`, dan prompt khusus turnamen (run LLM yang tersimpan dihapus oleh `drizzle/0097_remove_llm_tournament.sql`). FR-PRG-11, 12, 14, 18, 22, FR-SCR-02, FR-ANL-28, FR-MCU-21, dan FR-AUD-04 dihapus; FR-AUT-04, FR-PRG-01, 10, 19, FR-SCR-01, 12, 20, dan FR-AUD-05 dirumuskan ulang; domain FR-AUD kini bernama "Audit dan riwayat". Daftar ini kini memuat 282 butir dalam 14 domain |
| Perubahan versi 1.5 | 5 November 2026: fitur Simulasi penempatan (simulasi peran) dihapus dari sistem beserta tabelnya. Domain FR-SIM dihapus seluruhnya (FR-SIM-01–07), sehingga daftar ini kini memuat 291 butir dalam 14 domain |
| Perubahan versi 1.4 | 5 November 2026: fitur Keyakinan Penempatan (MCU) dihapus dari sistem. Domain FR-MCU kini hanya memuat MCU sebagai data kandidat dan aturan yang hanya menandai; FR-MCU-02, 03, 05–10, 12–19, dan 22–26 serta FR-SIM-08 dihapus, sedangkan FR-MCU-01, 04, 20, 21 dan FR-SIM-06 dirumuskan ulang |
| Jumlah kebutuhan | 282 butir dalam 14 domain |
| Metode | Pembacaan mundur dari kode sumber, antarmuka, dan basis data |
| Status | Menggambarkan perilaku sistem pada tanggal di atas |

---

## 1. Tentang dokumen ini

Dokumen ini adalah daftar kebutuhan fungsional yang **dipenuhi** oleh aplikasi
AI Pulse. Penyusunannya membalik arah analisis yang lazim: biasanya kebutuhan
fungsional ditulis lebih dulu lalu diterjemahkan menjadi fitur, sedangkan di
sini sistem yang sudah berjalan dibaca mundur menjadi pernyataan kebutuhan.

Konsekuensi dari arah tersebut perlu dinyatakan terus terang. Daftar ini
menggambarkan **apa yang sistem lakukan sekarang**, bukan apa yang pernah
diminta dan bukan pula apa yang seharusnya ada. Kebutuhan yang pernah
dirumuskan tetapi tidak pernah dibangun tidak akan muncul di sini, dan
ketiadaannya dalam dokumen ini bukan bukti bahwa kebutuhan itu tidak ada.

Sebaliknya, dokumen ini memuat sejumlah kebutuhan yang kemungkinan besar tidak
pernah ditulis sebagai kebutuhan, melainkan lahir dari keputusan rancangan saat
pembangunan. Kebutuhan semacam itu tetap dicantumkan, sebab bagi pengguna ia
berperilaku persis seperti kebutuhan: sistem bertindak dengan cara tertentu dan
dapat diuji apakah ia benar bertindak demikian.

### Dasar penyusunan

| Sumber | Yang diambil |
|---|---|
| 189 server action pada 44 berkas `lib/*-actions.ts` | Inventaris kapabilitas sistem |
| `lib/navigation.ts` | Rute, label menu, dan izin tiap halaman |
| `lib/rbac.ts` | Daftar izin, peran bawaan, dan aturan pewarisan izin |
| Komponen antarmuka tiap modul | Aksi yang benar-benar tersedia bagi pengguna |
| `CLAUDE.md` dan dokumen `docs/` | Alasan rancangan dan aturan bisnis |

### Cara membaca

Setiap kebutuhan diberi pengenal berpola `FR-XXX-nn`, dengan `XXX` menandai
domainnya. Kolom **Komponen pelaksana** menyebut berkas atau modul yang
memenuhinya, sehingga daftar ini sekaligus berfungsi sebagai matriks telusur.

Kata **harus** dipakai untuk perilaku yang wajib ada. Kata **tidak boleh**
dipakai untuk perilaku yang sistem tolak secara sengaja; penolakan itu sama
pentingnya dengan kemampuan, dan pada sistem ini sebagian besar keputusan
rancangan justru berbentuk penolakan.

## 2. Aktor

| Aktor | Keterangan |
|---|---|
| Administrator | Akses penuh, termasuk tata kelola, sinkronisasi, dan manajemen pengguna |
| HR / Talent | Mengelola data master dan menjalankan penilaian |
| Analyst | Menjalankan penilaian dan analisis; data master hanya baca |
| Viewer | Hanya melihat data |
| Pengguna belum berperan | Tidak memperoleh izin apa pun sampai peran ditetapkan |
| Penjadwal sistem | Proses terjadwal Senin pukul 01.00 yang menjalankan sinkronisasi tanpa operator |
| Layanan penilaian | Proses terpisah yang mengeksekusi penilaian di luar peramban |
| Layanan sinkronisasi | Proses terpisah yang menarik data dari sumber |
| Model bahasa | Penyedia penilaian naratif dan ekstraksi dokumen |

Tiga aktor terakhir bukan manusia, tetapi dicantumkan karena sejumlah kebutuhan
hanya bermakna bila pelakunya bukan pengguna — misalnya kebutuhan bahwa
penilaian tetap berjalan meski peramban ditutup.

## 3. Ringkasan cakupan

| Kode | Domain | Jumlah |
|---|---|---|
| FR-AUT | Autentikasi, otorisasi, dan multi-Company | 18 |
| FR-SYN | Sinkronisasi dan integrasi data | 21 |
| FR-JPR | Profil jabatan dan kamus kompetensi | 23 |
| FR-JFM | Job family dan pemetaan jabatan | 29 |
| FR-CAN | Manajemen kandidat | 21 |
| FR-POS | Manajemen posisi | 30 |
| FR-PRG | Tata kelola program dan aturan penilaian | 23 |
| FR-SCR | Penilaian | 30 |
| FR-ANL | Analisis dan tindak lanjut hasil | 39 |
| FR-MCU | Data pemeriksaan kesehatan (MCU) | 4 |
| FR-SUC | Penetapan suksesor | 10 |
| FR-DSH | Dasbor dan pelaporan | 13 |
| FR-SEC | Keamanan data | 15 |
| FR-AUD | Audit dan riwayat | 6 |
| | **Total** | **282** |

## 4. Daftar kebutuhan fungsional

### FR-AUT — Autentikasi, otorisasi, dan multi-Company

| ID | Kebutuhan | Komponen pelaksana |
|---|---|---|
| FR-AUT-01 | Sistem harus mengautentikasi pengguna melalui penyedia identitas tunggal (Keycloak / SSO). | `lib/auth.ts` |
| FR-AUT-02 | Sistem harus tetap dapat dijalankan tanpa penyedia identitas, dengan satu pengguna lokal berhak penuh, agar pemasangan baru dan lingkungan pengembangan tidak terkunci. | `getCurrentUser()` |
| FR-AUT-03 | Otorisasi harus ditentukan di dalam aplikasi ini, bukan oleh penyedia identitas. Penyedia identitas hanya menyatakan siapa pengguna, bukan apa yang boleh dilakukannya. | `lib/rbac.ts` |
| FR-AUT-04 | Sistem harus menyediakan sebelas izin bernama yang dapat dirakit menjadi peran. | `ALL_PERMISSIONS` |
| FR-AUT-05 | Seorang pengguna harus memegang tepat satu peran. | `users.role_id` |
| FR-AUT-06 | Pengguna yang belum diberi peran tidak boleh memperoleh izin apa pun, dan harus diarahkan ke halaman tunggu. | `getCurrentUserAccess()` |
| FR-AUT-07 | Peran yang ditandai bawaan tidak boleh diterapkan secara otomatis kepada pengguna baru. Penetapan peran harus merupakan tindakan sadar seorang administrator. | `lib/rbac.ts` |
| FR-AUT-08 | Izin mengelola harus dengan sendirinya mencakup izin melihat pada domain yang sama, untuk kandidat, posisi, dan profil job. | `IMPLIED_BY` |
| FR-AUT-09 | Peran administrator harus selalu mempertahankan izin mengelola pengguna dan peran; antarmuka tidak boleh dapat mencabutnya. | `LOCKED_ADMIN_PERMISSIONS` |
| FR-AUT-10 | Sistem harus menyediakan jalur pemulihan akses melalui daftar surel administrator yang ditetapkan di lingkungan, agar kesalahan konfigurasi peran tidak mengunci seluruh organisasi. | `RBAC_ADMIN_EMAILS` |
| FR-AUT-11 | Halaman yang izinnya tidak dipenuhi harus dialihkan ke Beranda, bukan menampilkan halaman galat. | `requirePagePermission()` |
| FR-AUT-12 | Aksi yang izinnya tidak dipenuhi harus ditolak di sisi server dengan pesan yang menyebutkan izin yang kurang, terlepas dari apa yang ditampilkan antarmuka. | `requirePermission()` |
| FR-AUT-13 | Seluruh butir menu, label, rute, dan izinnya harus berasal dari satu registri tunggal, sehingga sidebar, judul halaman, dan jejak navigasi tidak dapat saling berbeda. | `lib/navigation.ts` |
| FR-AUT-14 | Sistem harus melayani beberapa Company dalam satu pemasangan, dengan Company aktif dipilih pengguna dan bertahan antar sesi. | `lib/tenant.ts`, `switchTenantAction` |
| FR-AUT-15 | Setiap pembacaan data harus disaring per Company secara eksplisit pada kuerinya, bukan mengandalkan penyaringan di lapisan basis data. | Seluruh `lib/*-actions.ts` |
| FR-AUT-16 | Administrator harus dapat membuat, mengubah, dan menghapus peran, menetapkan izinnya, dan menetapkan peran bawaan. | `lib/role-management-actions.ts` |
| FR-AUT-17 | Administrator harus dapat menetapkan dan mencabut peran seorang pengguna, serta melihat jumlah pengguna per peran sebelum mengubahnya. | `lib/user-management-actions.ts` |
| FR-AUT-18 | Pengguna yang masuk melalui SSO harus tercatat otomatis sehingga muncul pada manajemen pengguna tanpa pendaftaran manual, namun pencatatan itu tidak boleh memberinya peran. | `recordUserLogin()` |

### FR-SYN — Sinkronisasi dan integrasi data

| ID | Kebutuhan | Komponen pelaksana |
|---|---|---|
| FR-SYN-01 | Sistem harus menarik data karyawan dan data HR dari basis data sumber, antarmuka REST, berkas PDF, dan berkas Excel ke dalam basis datanya sendiri. | `sync-service` |
| FR-SYN-02 | Sinkronisasi harus berjalan terjadwal tanpa operator, secara bawaan setiap Senin pukul 01.00. | `sync-service/src/scheduler.ts` |
| FR-SYN-03 | Pengguna berwenang harus dapat menjalankan sinkronisasi penuh lebih awal, untuk seluruh Company atau satu Company. | Halaman Sinkronisasi |
| FR-SYN-04 | Pengguna harus dapat menjalankan satu modul saja, agar satu sumber yang gagal atau baru diperbaiki tidak memaksa penarikan ulang seluruh data. | Kartu `Sinkronisasi per Modul` |
| FR-SYN-05 | Sinkronisasi harus dapat dipicu melalui antarmuka, baris perintah, dan panggilan HTTP. | `sync-service`, `app/api/sync/[...sync]` |
| FR-SYN-06 | Sistem harus menerima unggahan Excel sebagai pengganti sumber untuk sepuluh modul, berlaku sekali jalan, lalu kembali ke sumber aslinya pada sinkronisasi terjadwal berikutnya. | `sync-service/src/services/excel-sources.ts` |
| FR-SYN-07 | Setiap sumber yang dapat diunggah harus menyediakan berkas templat yang dapat diunduh, dan templat itu harus dihasilkan dari spesifikasi yang sama dengan pengurainya. | `excel-template.ts` |
| FR-SYN-08 | Penyerapan data unggahan harus bersifat memperbarui saja dan tidak boleh menghapus baris yang tidak ada di berkas. | `excel-ingest.ts` |
| FR-SYN-09 | Berkas yang telah berhasil diserap harus dihapus dari server, agar sinkronisasi berikutnya tidak diam-diam memakai berkas lama. | `sync-service` |
| FR-SYN-10 | Sistem harus menerima unggahan berkas sumber yang tidak ditarik dari mana pun: profil jabatan dan kamus kompetensi berupa PDF, serta kuadran HAV dan status pemeriksaan kesehatan berupa Excel. | Kartu `Unggah Berkas Sumber` |
| FR-SYN-11 | Empat kumpulan data yang diturunkan dari data lain, yaitu kandidat, divisi, departemen, dan tahap populasi posisi, tidak boleh dapat diunggah. | `excel-sources.ts` |
| FR-SYN-12 | Sistem harus menurunkan catatan kandidat dari seluruh data yang telah tersinkron. | Modul `Kandidat` |
| FR-SYN-13 | Pengguna harus dapat membangun ulang data turunan kandidat dari nol tanpa kehilangan identitas kandidat, sehingga hasil penilaian, suksesor terpilih, dan cache skor aspek tetap utuh. | Tombol bangun ulang |
| FR-SYN-14 | Pembaruan yang tidak memuat suatu nilai tidak boleh menghapus nilai yang sudah ada, agar satu respons sumber yang kosong tidak menghapus data seluruh organisasi. | Pola `COALESCE` pada upsert |
| FR-SYN-15 | Setiap eksekusi sinkronisasi harus dicatat, termasuk eksekusi yang gagal dan yang menghasilkan nol catatan. | `listSyncRunsAction` |
| FR-SYN-16 | Pengaturan koneksi basis data sumber harus dapat diubah dari antarmuka, dan pengaturan tersimpan harus mengalahkan nilai dari lingkungan. | `lib/sync-connection-actions.ts` |
| FR-SYN-17 | Koneksi sumber harus dapat diuji sebelum disimpan. | `testSourceConnectionAction` |
| FR-SYN-18 | Konfigurasi koneksi harus dibaca ulang setiap kali koneksi dibuat, tidak boleh dibekukan saat proses dimulai, agar perubahan pengaturan benar-benar berlaku. | `sync-service/src/db/mssql.ts` |
| FR-SYN-19 | Pengenal Company pada sistem sumber harus dapat dipetakan ke Company pada aplikasi ini. | `lib/sync-actions.ts` |
| FR-SYN-20 | Bila layanan sinkronisasi tidak dapat dihubungi, seluruh kendali sinkronisasi dan unggah harus dinonaktifkan dan sebabnya dinyatakan, bukan dibiarkan gagal saat ditekan. | `app/api/sync/health` |
| FR-SYN-21 | Sistem harus dapat mengosongkan seluruh kandidat Company aktif sebagai penyiapan impor ulang, dengan konfirmasi ketik, dan mengembalikannya tanpa menunggu sinkronisasi berikutnya. | `lib/candidate-lifecycle-actions.ts` |

### FR-JPR — Profil jabatan dan kamus kompetensi

| ID | Kebutuhan | Komponen pelaksana |
|---|---|---|
| FR-JPR-01 | Sistem harus mengekstraksi profil jabatan dari dokumen PDF menjadi data terstruktur menggunakan model visi. | `sync-service` |
| FR-JPR-02 | Ekstraksi yang gagal harus dicoba ulang beberapa kali dengan jeda yang meningkat dan acak, bukan langsung dinyatakan gagal permanen. | `extractWithRetries` |
| FR-JPR-03 | Percobaan ulang harus mengubah parameter pemanggilan model, sebab pengulangan dengan masukan dan parameter identik akan menghasilkan kegagalan yang identik pula. | `getModel` berkunci suhu |
| FR-JPR-04 | Kegagalan penguraian harus merekam bukti yang cukup untuk didiagnosis, yaitu panjang keluaran, cuplikan di sekitar titik gagal, dan apakah keluaran terputus di akhir atau rusak di tengah. | Penangan galat ekstraksi |
| FR-JPR-05 | Sistem harus menyediakan antrean ekstraksi yang dapat dilihat, terpisah dari status isi dokumen. | `sync_job_profiles.queued_at` |
| FR-JPR-06 | Dokumen yang sedang diekstraksi ulang harus tetap dapat dibaca dengan hasil ekstraksi sebelumnya sampai penggantinya siap. | Pemisahan `status` dan `queued_at` |
| FR-JPR-07 | Penghitung dokumen dalam proses harus menghitung dokumen yang belum punya hasil ekstraksi terpakai, dan melaporkan pembacaan ulang terjadwal secara terpisah. | Kartu `Dalam Proses` |
| FR-JPR-08 | Halaman katalog harus memperbarui diri secara berkala selama antrean belum kosong. | Klien katalog |
| FR-JPR-09 | Pengguna harus dapat menelusuri katalog dokumen dengan pencarian, penyaringan status, penyaringan Company, pengurutan, dan dua mode tampilan. | `job-profile-documents-client.tsx` |
| FR-JPR-10 | Pengguna harus dapat membuka rincian sebuah dokumen dan menyalin datanya. | Dialog detail |
| FR-JPR-11 | Pengguna harus dapat memerintahkan pembacaan ulang satu dokumen dari PDF-nya. | `reextractJobProfileAction` |
| FR-JPR-12 | Pengguna harus dapat mengantrekan ulang seluruh dokumen yang gagal dalam satu tindakan, dan tindakan itu harus kembali begitu antrean tersusun, bukan menunggu seluruh ekstraksi selesai. | `retryFailedJobProfilesAction` |
| FR-JPR-13 | Dokumen yang berkas PDF-nya tidak lagi ada di server harus dilaporkan terpisah dan tidak diantrekan ulang, sebab perbaikannya adalah pengunggahan ulang. | `retryFailedJobProfiles` |
| FR-JPR-14 | Menghapus hasil ekstraksi tidak boleh menghapus berkas PDF-nya. | `deleteJobProfileAction` |
| FR-JPR-15 | Kepemilikan dokumen terhadap Company harus dapat ditetapkan, satu dokumen dapat dimiliki lebih dari satu Company. | `job_profile_tenants` |
| FR-JPR-16 | Dokumen yang belum ditetapkan kepemilikannya harus tampil pada seluruh Company. | `lib/job-profile-tenant-scope.ts` |
| FR-JPR-17 | Cakupan kepemilikan dokumen harus berlaku untuk tampilan dan analisis saja, dan tidak boleh diterapkan pada penilaian, sebab satu penilaian dapat memuat kandidat dari unit lain dan penerapan cakupan akan menggugurkan kriteria mereka. | `ahp-topsis-engine.ts` |
| FR-JPR-18 | Sistem harus menyediakan kamus kompetensi teknis yang dapat ditelusuri, dengan definisi dan tuntutan untuk empat tingkat penguasaan. | `components/kamus-page-client.tsx` |
| FR-JPR-19 | Nama kompetensi dari sumber yang berbeda harus dipetakan ke kode kamus sebelum dipasangkan, sebab identitas kompetensi adalah kodenya dan bukan tulisannya. | `lib/kamus-name-match.ts` |
| FR-JPR-20 | Pemetaan nama harus berjenjang: sama persis, lalu pencocokan token deterministik yang hanya diterima bila unik, lalu model bahasa yang dibatasi pada kesetaraan ejaan. | `lib/kamus-name-match.ts` |
| FR-JPR-21 | Keputusan pemetaan harus disimpan, dan layanan penilaian hanya boleh membaca simpanan itu, agar penilaian tetap dapat berjalan tanpa model yang dapat dihubungi. | `kamus_competency_match_cache` |
| FR-JPR-22 | Model yang tidak dapat dihubungi harus dilaporkan sebagai ketidaktersediaan, bukan sebagai ketiadaan padanan. | Panel pemetaan nama |
| FR-JPR-23 | Kompetensi yang dituntut tetapi tidak dapat diukur harus dikeluarkan dari pembagi, bukan dihitung sebagai nol yang dimiliki semua orang. | `ahp-topsis-engine.ts` |

### FR-JFM — Job family dan pemetaan jabatan

| ID | Kebutuhan | Komponen pelaksana |
|---|---|---|
| FR-JFM-01 | Sistem harus memasangkan posisi aktif dengan profil jabatan melalui beberapa jalur berjenjang, dari yang paling pasti ke yang paling menafsir. | `lib/job-family/match.ts` |
| FR-JFM-02 | Nama berkas dokumen harus diperlakukan sebagai judul kedua, sebab judul di dalam dokumen dan judul pada nama berkasnya kerap berbeda dan nama berkas sering menyebut jabatan yang sebenarnya dituju. | `parseJobProfileFileName` |
| FR-JFM-03 | Nama alias yang diklaim lebih dari satu dokumen harus dibuang seluruhnya, sebab profil jabatan yang keliru lebih merugikan daripada ketiadaan profil jabatan. | `buildDeterministicMatcher` |
| FR-JFM-04 | Jalur model bahasa hanya boleh memilih dari daftar pendek calon terdekat, dan pilihan di luar daftar itu harus ditolak. | `lib/job-family/ai-match.ts` |
| FR-JFM-05 | Jawaban "tidak ada padanan" harus merupakan jawaban yang sah, dan keyakinan di bawah ambang harus dibuang. | `AI_MATCH_MIN_CONFIDENCE` |
| FR-JFM-06 | Keputusan model bahasa harus disimpan per judul, termasuk penolakannya, agar laporan yang sama tidak berubah susunan di antara dua kali pembukaan. | `job_family_ai_match_cache` |
| FR-JFM-07 | Model yang tidak dapat dihubungi harus dilaporkan sebagai ketidaktersediaan, dan jabatan sisa tetap ditampilkan sebagai belum cocok, bukan dipasangkan sembarangan. | `aiAvailable: false` |
| FR-JFM-08 | Pengguna harus dapat menyematkan pasangan secara manual, dan sematan manual harus mengalahkan seluruh jalur otomatis. | `setManualMatchAction` |
| FR-JFM-09 | Hasil setiap kali pencocokan dijalankan harus disimpan, satu baris per Company, sehingga kunjungan berikutnya menampilkan hasil terakhir tanpa menjalankan ulang. | `job_profile_match_runs` |
| FR-JFM-10 | Menjalankan pencocokan dan menyimpan pemetaan harus merupakan dua tindakan terpisah, sehingga menjalankan ulang tidak pernah diam-diam menulis ulang pemetaan yang sudah dipakai fitur lain. | `saveMatchesToDbAction` |
| FR-JFM-11 | Bila belum ada hasil pencocokan tersimpan, sistem harus menyusun tampilan dari pemetaan yang tersimpan, menyatakan bahwa itu bukan hasil perhitungan baru, dan menonaktifkan tombol simpan. | `getSavedMatchReportAction` |
| FR-JFM-12 | Vektor judul harus disimpan agar penyusunan laporan tidak mengulang pemanggilan layanan embedding pada setiap pembukaan halaman. | `job_family_title_embed` |
| FR-JFM-13 | Vektor yang baru dihitung harus melalui pembulatan yang sama dengan vektor tersimpan, agar sebuah judul tidak jatuh di sisi ambang yang berbeda tergantung apakah proses ini sudah pernah menghitungnya. | `embedTitles` |
| FR-JFM-14 | Sistem harus mengelompokkan profil jabatan menjadi rumpun jabatan melalui pemodelan topik. | `topic-service` |
| FR-JFM-15 | Alur pembangunan peta harus dinyatakan sebagai langkah berurutan, dengan tepat satu langkah ditonjolkan sebagai yang harus dikerjakan sekarang. | `pipeline-steps.tsx` |
| FR-JFM-16 | Penyetelan pengelompokan harus ditawarkan sebagai sasaran yang sudah terdaftar, bukan sebagai masukan bebas, sebab himpunan hal yang dapat diinginkan dari sebuah pengelompokan sudah terbatas dan dapat disebutkan. | `OPTIMIZE_GOALS` |
| FR-JFM-17 | Penyetelan tidak boleh memakai model bahasa sama sekali. | `optimizer-panel.tsx` |
| FR-JFM-18 | Sebuah setelan hanya boleh ditawarkan untuk diterapkan bila setelan itu telah DIUKUR mencapai sasarannya pada korpus yang ter-embed saat itu. Bila tidak ada setelan dalam rentang aman yang mencapainya, sistem harus menyatakannya dan tidak menawarkan penerapan. Setelan yang ditawarkan dapat diterapkan sekaligus membangun ulang peta, atau disimpan tanpa membangun ulang, dan tombol utamanya harus menyebutkan pembangunan ulang. | `startOptimizationSearchAction`, `applyMeasuredOptimizationAction` |
| FR-JFM-19 | Diagnosis mutu harus dibaca dari agregat seluruh run, sedangkan rincian yang menyebut nama jabatan harus dibatasi pada Company aktif. | `getRunQualityInputAction`, `getOutlierExplanationsAction` |
| FR-JFM-20 | Pembacaan hasil harus memakai run terakhir yang berstatus selesai, bukan baris terbaru apa pun statusnya. | `getLatestCompletedTopicRunAction` |
| FR-JFM-21 | Penerapan parameter berlaku untuk seluruh Company, dan halaman harus menyatakannya di samping tombolnya. Setiap tombol simpan hanya menyimpan bagiannya sendiri (template global, template khusus satu dokumen, parameter BERTopic, atau pengaturan embedding); bagian lain tidak ikut tersimpan. | `saveConfigPart` |
| FR-JFM-22 | Pengguna harus dapat memetakan sebuah jabatan di luar rumpun ke rumpun terdekat secara manual. | `assignOutlierToClusterAction` |
| FR-JFM-24 | Sistem harus menyediakan penataan ulang isi dokumen sebelum diubah menjadi vektor, dengan templat global dan penimpaan per dokumen. | `lib/job-family/restructure.ts` |
| FR-JFM-25 | Pembangunan ulang vektor harus dapat dijalankan bertahap, dipantau, dan dibatalkan. | `startRebuildAction`, `cancelRebuildAction` |
| FR-JFM-26 | Pengukuran setelan harus menjalankan kode pengelompokan yang sama dengan pembangunan peta, dan tidak boleh menyimpan run, sebab run terakhir dibaca peta, kalibrasi karier, dan diagnosis. | `POST /topics/trials`, `pipeline.cluster` |
| FR-JFM-27 | Setiap sasaran harus dinilai dengan satu ukuran yang dinyatakan kepada pengguna, dan ukuran lain yang memburuk harus dilaporkan terpisah, bukan dilebur ke dalam penilaian sasaran. | `goalVerdict`, `sideEffects` |
| FR-JFM-28 | Penerapan setelan terukur harus ditolak bila korpus yang ter-embed atau parameter yang berlaku berubah sejak pengukuran. | `applyMeasuredOptimizationAction`, `saveBertopicConfigAction` |
| FR-JFM-29 | Panel optimasi harus menyatakan apakah peta terakhir masih menggambarkan korpus yang ter-embed sekarang, dan apakah peta itu dibangun dengan parameter yang berlaku. | `getMapFreshnessAction`, `diagnostics.corpus` |
| FR-JFM-30 | Peta yang dibangun dengan setelan terukur harus dibandingkan dengan pengukurannya, dan panel harus menyatakan apakah hasilnya sama persis, berbeda, atau dibangun dari korpus yang sudah berubah, serta apakah sasarannya tercapai. | `getOptimizationVerificationAction`, `job_family_optimization_expectations` |
### FR-CAN — Manajemen kandidat

| ID | Kebutuhan | Komponen pelaksana |
|---|---|---|
| FR-CAN-01 | Sistem harus menurunkan kumpulan kandidat dari data yang telah tersinkron, bukan meminta pengguna memasukkannya ulang. | `candidate-populate` |
| FR-CAN-02 | Pengguna harus dapat menelusuri kandidat dengan pencarian nama, nomor induk, jabatan, dan departemen, serta menyaring per divisi, departemen, dan jenjang. | `candidates-page-client.tsx` |
| FR-CAN-03 | Pengguna berwenang harus dapat menambah, mengubah, dan menghapus kandidat. | `lib/pulse-crud-actions.ts` |
| FR-CAN-04 | Penghapusan kandidat harus berupa penandaan, tidak boleh penghapusan baris, sebab penghapusan sungguhan akan merambat ke hasil penilaian, suksesor terpilih, cache skor, dan pemetaan, serta meninggalkan pengenal menggantung di dalam data sesi penilaian. | `candidates.deleted_at` |
| FR-CAN-05 | Sistem harus membedakan penghapusan massal dari penghapusan satuan, sebab keduanya berbeda maksud: yang massal dipulihkan oleh sinkronisasi berikutnya, yang satuan tidak boleh dibatalkan oleh proses terjadwal. | `candidates.deleted_mode` |
| FR-CAN-06 | Kandidat yang ditandai terhapus harus dapat dipulihkan. | `restoreCandidateAction` |
| FR-CAN-07 | Nomor induk karyawan harus diperlakukan sebagai identitas dan tidak boleh diubah melalui penyuntingan kandidat. | `assertNpkUnchanged` |
| FR-CAN-08 | Upaya mengubah nomor induk harus ditolak sebelum penulisan apa pun, dengan membedakan dua keadaan, yaitu nomor sudah dipakai orang lain dan nomor bebas tetapi tidak dapat diubah dari sini, sebab tindak lanjut penggunanya berbeda. | `assertNpkUnchanged` |
| FR-CAN-09 | Pembandingan nomor induk harus menyamakan nomor yang hanya berbeda angka nol di depan, dan tidak boleh melakukan penyamaan itu pada pengenal non-numerik. | `npkIdentity` |
| FR-CAN-10 | Nomor induk yang dipegang kandidat bertanda terhapus harus tetap dihitung sebagai terpakai. | Indeks unik total |
| FR-CAN-11 | Daftar, pemilihan calon, dan penyelesaian identitas harus menyaring kandidat bertanda terhapus, sedangkan penampilan riwayat tidak boleh menyaringnya, agar peringkat yang sudah selesai tidak tampil berlubang. | `lib/candidate-visibility.ts` |
| FR-CAN-12 | Layanan penilaian harus menerapkan penyaringan yang sama, sebab bila hanya aplikasi web yang menyaring maka kandidat bertanda terhapus tetap akan dinilai. | `scoring-service` |
| FR-CAN-13 | Data kandidat harus disamarkan secara bawaan, dan pengungkapannya merupakan tindakan sadar. | Kendali `Tampilkan data` |
| FR-CAN-14 | Saat disamarkan, hanya nama, jabatan, dan departemen yang boleh tampil; riwayat penilaian kinerja, riwayat jabatan, dan kompetensi teknis harus disembunyikan. | `candidates-page-client.tsx` |
| FR-CAN-15 | Sistem harus menandai kandidat yang telah dipilih sebagai suksesor, dibaca dari data pemilihan yang sama dengan yang dibaca Manajemen Posisi. | `getSuccessorSeatsByCandidate` |
| FR-CAN-16 | Kursi harus dikelompokkan per posisi, bukan dirinci per baris pemilihan, agar satu kursi yang tercatat di bawah dua kode program tidak terbaca sebagai dua posisi. | `getSuccessorSeatsByCandidate` |
| FR-CAN-17 | Pemilihan pada kursi milik Company lain harus tetap ditampilkan dan diberi label, sebab menyembunyikan keputusan yang nyata akan membuat penandanya berbohong. | `candidate-successor-badge.tsx` |
| FR-CAN-18 | Penyaringan status suksesor harus diselesaikan atas seluruh Company sebelum halaman dipotong, agar yang dihitung sama dengan yang dipilih. | `getCandidateProfiles` |
| FR-CAN-19 | Usia kandidat harus diturunkan dari tanggal lahir pada saat ditampilkan, dan tidak boleh disimpan sebagai angka usia. | `lib/age.ts` |
| FR-CAN-20 | Dari muatan data pribadi sumber, sistem hanya boleh menyimpan tanggal lahir dan nama tampilan, dan tidak boleh menyimpan nomor identitas kependudukan, nomor pajak, jaminan sosial, telepon, maupun surel. | `sync_employee_personal` |
| FR-CAN-21 | Pengguna harus dapat melihat riwayat penilaian yang pernah melibatkan seorang kandidat. | `candidate-run-history-actions.ts` |

### FR-POS — Manajemen posisi

| ID | Kebutuhan | Komponen pelaksana |
|---|---|---|
| FR-POS-01 | Pengguna berwenang harus dapat mendaftarkan kursi jabatan yang relevan untuk suksesi, lengkap dengan program, rentang jenjang suksesor, kualifikasi, dan kompetensi teknis. | `createPositionAction` |
| FR-POS-02 | Satu posisi harus dimiliki tepat satu program suksesi. | `critical_positions.program_template_id` |
| FR-POS-03 | Program sebuah posisi harus terkunci begitu posisi itu memiliki hasil penilaian, sebab sebuah peringkat adalah penilaian yang dibuat di bawah aturan satu program dan memindahkannya akan mengubah arti riwayat tersebut. | `updatePositionAction` |
| FR-POS-04 | Menilai kursi yang sama di bawah program lain harus dilakukan dengan mendaftarkan kursi itu sekali lagi, sehingga bangku cadangan, penyaring, dan riwayat tiap program tetap merupakan daftar yang terpisah. | Rancangan `critical_positions` |
| FR-POS-05 | Sistem harus dapat mendaftarkan banyak kursi sekaligus berdasarkan jenjang pemangku jabatannya. | `bulkAddPositionsAction` |
| FR-POS-06 | Rentang jenjang suksesor pada pendaftaran massal harus mengikuti tujuan programnya, bukan satu aturan seragam. | `lib/position-bulk-actions.ts` |
| FR-POS-07 | Satu jenjang harus berarti satu nama jenjang, bukan satu angka grade, sebab satu jenjang mencakup beberapa angka grade. | `buildLevelBands` |
| FR-POS-08 | Pendaftaran massal harus menampilkan pratinjau kursi yang akan dibuat beserta yang sudah terdaftar sebelum dijalankan. | `previewBulkPositionsAction` |
| FR-POS-09 | Pendaftaran massal harus dapat langsung menjalankan penilaian, dikerjakan di latar belakang sehingga peramban tidak perlu dibiarkan terbuka. | `bulkAddPositionsAction` |
| FR-POS-10 | Kursi yang kumpulan calonnya kosong harus dilaporkan dan dilewati, tidak boleh menggagalkan seluruh rangkaian. | `bulkAddPositionsAction` |
| FR-POS-11 | Kursi yang belum punya profil jabatan harus disebutkan namanya sebelum rangkaian berjalan, dan melanjutkannya harus merupakan pilihan sadar, sebab penilaian tanpa profil jabatan menghasilkan angka yang berbeda di bawah label yang sama. | `scoreWithoutJobProfile` |
| FR-POS-12 | Sistem harus dapat menjalankan penilaian ulang untuk seluruh posisi dalam satu program. | `rescoreProgramPositionsAction` |
| FR-POS-13 | Penilaian ulang seprogram tidak boleh mengubah atau menghapus penilaian yang sudah ada. | `rescoreProgramPositionsAction` |
| FR-POS-14 | Posisi yang sedang dinilai harus dilewati, agar riwayat satu kursi tidak diisi dua penilaian sekaligus. | `previewProgramRescoreAction` |
| FR-POS-15 | Satu posisi harus dapat memiliki beberapa pemangku jabatan aktif sekaligus, sebab sejumlah jabatan memang diduduki banyak orang pada saat yang sama. | `critical_position_holders` |
| FR-POS-16 | Seluruh pemangku jabatan aktif harus dikeluarkan dari kumpulan calon penggantinya, bukan hanya yang tercatat sebagai pemangku utama. | `loadPositionRow` |
| FR-POS-17 | Sistem harus menandai kursi yang profil jabatannya tidak dapat ditemukan. | `getJobProfileByPosition` |
| FR-POS-18 | Sistem harus menandai kursi yang sudah dinilai tetapi belum ada suksesor yang ditetapkan. | `getPositionFlagSets` |
| FR-POS-19 | Sistem harus menandai kursi yang pemangkunya telah mencapai ambang usia pensiun, dengan menyebut namanya, sebab jumlah saja memaksa pembaca mencari sendiri. | `lib/retirement-config.json` |
| FR-POS-20 | Pemangku jabatan yang tanggal lahirnya belum tersinkron tidak boleh pernah ditandai mendekati pensiun, sebab ketidaktahuan bukan temuan. | `getPositionFlagSets` |
| FR-POS-21 | Ambang usia pensiun harus dapat diubah tanpa penggelaran ulang aplikasi. | Pembacaan berkas saat jalan |
| FR-POS-22 | Keadaan bangku cadangan harus dilaporkan sebagai tiga keadaan yang saling lepas dan berjumlah persis sebanyak posisi, bukan sebagai satu persentase, sebab "belum ada yang siap" dan "belum ada yang dinilai" adalah temuan berbeda dengan tindak lanjut yang berlawanan. | `benchStateFor` |
| FR-POS-23 | Penghitungan keadaan bangku cadangan dan penanda harus dilakukan atas seluruh himpunan tersaring, bukan atas baris yang tampak di halaman. | `getPositionFlagSets` |
| FR-POS-24 | Setiap penanda dan keadaan bangku cadangan harus dapat diklik untuk menyaring daftar. | `positions-page-client.tsx` |
| FR-POS-25 | Daftar posisi harus melaporkan jumlah suksesor yang benar-benar dipilih, bukan kandidat berperingkat teratas, sebab yang pertama adalah keputusan dan yang kedua hanya keluaran perhitungan. | Kolom RTC |
| FR-POS-26 | Penyelesaian profil jabatan untuk satu halaman harus dilakukan dalam sejumlah kecil kueri berbasis himpunan, bukan satu kueri per baris. | `getJobProfileByPosition` |
| FR-POS-27 | Bagan struktur posisi harus deterministik, sehingga dua kali pembukaan halaman menghasilkan susunan yang sama meski data sumber memuat relasi rangkap. | `getPositionHierarchySnapshot` |
| FR-POS-28 | Relasi induk yang menunjuk diri sendiri harus dibuang dan lingkaran relasi harus diputus, sebab lingkaran membuat seluruh anggotanya beserta cabangnya hilang dari bagan. | `getPositionHierarchySnapshot` |
| FR-POS-29 | Sistem harus menyarankan profil jabatan yang sesuai saat posisi didaftarkan. | `suggestJobProfileForPositionAction` |
| FR-POS-30 | Kemampuan menghapus seluruh riwayat penilaian satu program harus tersedia di dalam sistem dengan konfirmasi nama program yang diperiksa di sisi server, namun sengaja tidak ditampilkan pada antarmuka. | `resetProgramScoringAction` |

### FR-PRG — Tata kelola program dan aturan penilaian

| ID | Kebutuhan | Komponen pelaksana |
|---|---|---|
| FR-PRG-01 | Sistem harus menyediakan templat program per Company yang memuat aturan kelayakan, bobot, target finalis, dan daftar kriteria deskriptif. | `program_templates` |
| FR-PRG-02 | Templat program bawaan sistem harus disemai otomatis pada penggunaan pertama tiap Company. | `autoSeedSystemTemplates` |
| FR-PRG-03 | Templat bawaan sistem boleh diubah tetapi tidak boleh dapat dihapus. | `deleteProgramTemplateAction` |
| FR-PRG-04 | Aturan kelayakan harus dapat disusun sebagai pohon bersyarat dengan penghubung DAN dan ATAU serta sub-grup. | `governance-filter-editor.tsx` |
| FR-PRG-05 | Setiap aturan harus dapat ditetapkan akibatnya bila gagal, yaitu menggugurkan atau sekadar menandai. | `FilterRule.severity` |
| FR-PRG-06 | Aturan yang tidak menyebutkan akibatnya harus diperlakukan sebagai menggugurkan, sehingga aturan yang ditulis sebelum kemampuan ini ada berperilaku tidak berubah. | `FilterRule.severity` |
| FR-PRG-07 | Aturan yang hanya menandai harus dikeluarkan dari pohon sebelum penilaian kelayakan, dan tidak boleh dinilai sebagai selalu lolos, sebab aturan yang selalu lolos akan memenuhi setiap grup ATAU yang memuatnya dan melumpuhkan alternatif di sebelahnya. | `scripts/verify-mcu-advisory.ts` |
| FR-PRG-08 | Grup yang menjadi kosong setelah pengeluaran tersebut harus tetap dianggap terpenuhi, agar program yang aturannya berdiri sendiri di sebuah grup tidak menggugurkan semua orang. | `scripts/verify-mcu-advisory.ts` |
| FR-PRG-09 | Sistem harus menyediakan sakelar untuk menonaktifkan penggugur otomatis pada seluruh aturan sebuah program sekaligus. | `enforceFilterRules` |
| FR-PRG-10 | Daftar kriteria program hanya bersifat deskriptif: ia tidak punya editor, tidak boleh menentukan bobot, dan tidak dibaca mesin penilai, sebab metode AHP + TOPSIS selalu menilai keenam aspek. | `program_templates.default_criteria` |
| FR-PRG-13 | Bobot tiap aspek harus berasal dari satu permukaan saja, yaitu matriks perbandingan berpasangan program, atau bobot bawaan sistem bila program belum memilikinya. | `scoring-service/src/ahp-weights.ts` |
| FR-PRG-15 | Pengisian matriks harus ditawarkan dalam beberapa cara, dari yang paling sederhana sampai perbandingan berpasangan penuh, dengan indikator konsistensi. | `governance-ahp-editor.tsx` |
| FR-PRG-16 | Bobot khusus harus dapat dinonaktifkan sehingga program kembali memakai bobot bawaan sistem. | `governance-ahp-editor.tsx` |
| FR-PRG-17 | Halaman harus menyatakan bahwa sebagian besar program memakai bobot yang sama dan justru itulah yang membuat hasil antar-program sebanding. | `governance-ahp-editor.tsx` |
| FR-PRG-19 | Instruksi model yang dipakai metode AHP + TOPSIS — penilaian kriteria pendidikan dan penulis insight finalis — berlaku untuk seluruh Company dan harus dapat disunting, diversikan, dan dipulihkan; hanya instruksi yang masih dibaca mesin yang boleh ditampilkan dan disimpan. | `lib/scoring-prompt-actions.ts`, `ACTIVE_SCORING_PROMPT_KEYS` |
| FR-PRG-20 | Perubahan instruksi harus dapat berlaku tanpa memulai ulang layanan penilaian. | Endpoint muat ulang |
| FR-PRG-21 | Ambang tingkat kesiapan harus dapat diubah dan berlaku tanpa penggelaran ulang. | `lib/readiness-config-actions.ts` |
| FR-PRG-23 | Setiap bagian tata kelola harus menyatakan cakupan berlakunya, yaitu Company aktif atau seluruh Company. | `SCOPE_LABEL` |
| FR-PRG-24 | Perubahan tata kelola hanya boleh berlaku untuk penilaian berikutnya, dan tidak boleh mengubah penilaian yang sudah selesai. | `config_snapshot` |
| FR-PRG-25 | Program yang tidak pernah dijalankan sebagai penilaian tidak boleh muncul pada pemilih program tata kelola, sebab tidak ada pembaca bagi konfigurasinya. | `positionProgramTemplates()` |
| FR-PRG-26 | Label program harus tetap dibangun dari seluruh daftar templat, sehingga posisi yang terdaftar di program yang tidak lagi ditawarkan tetap menampilkan nama sebenarnya. | `lib/programs.ts` |
| FR-PRG-27 | Aturan kelayakan program Talent Pool harus dapat disunting dari halaman Talent Pool, dengan pratinjau dampaknya sebelum disimpan, dan penyuntingan itu harus tetap menuntut izin tata kelola. | `lib/talent-pool-actions.ts` |
| FR-PRG-28 | Pratinjau dan hasil tersimpan harus berasal dari satu jalur perhitungan yang sama, agar angka pratinjau dan angka akhir tidak dapat berbeda. | `getTalentPoolData(overrideTree)` |
### FR-SCR — Penilaian

| ID | Kebutuhan | Komponen pelaksana |
|---|---|---|
| FR-SCR-01 | Setiap penilaian harus memakai metode deterministik AHP dengan TOPSIS, dan layanan penilaian harus menggagalkan sesi bermetode lain dengan pesan bahwa metode turnamen berbasis model bahasa sudah dihapus. | `scoring-service/src/runner.ts` |
| FR-SCR-03 | Metode deterministik harus menilai enam aspek: kompetensi teknis, relevansi karier, kompetensi perilaku, penilaian kinerja, HAV, dan pendidikan. | `ahp-topsis-engine.ts` |
| FR-SCR-04 | Kumpulan calon harus dibangun dari rentang jenjang, penyingkiran pemangku jabatan, dan aturan kelayakan program. | `startTournamentSessionAction` |
| FR-SCR-05 | Wizard hanya boleh menawarkan posisi yang terdaftar pada program yang dipilih, dan harus menolak penilaian yang programnya tidak cocok dengan program posisinya. | `startTournamentSessionAction` |
| FR-SCR-06 | Pengguna harus dapat menyertakan kandidat dari Company lain ke dalam kumpulan calon, dengan penyaring jenjang dan kelayakan tetap berlaku sama. | Pemilih unit bisnis |
| FR-SCR-07 | Pengguna harus dapat mengecualikan kandidat tertentu sebelum penilaian dimulai. | Panel exclude |
| FR-SCR-08 | Pemangku jabatan saat ini harus ditampilkan sebagai sudah dikecualikan dan tidak dapat dipilih kembali. | Panel exclude |
| FR-SCR-09 | Rentang jenjang harus dapat ditimpa per penilaian, dengan pratinjau jumlah kandidat yang termasuk dan yang tersaring. | `previewGradeFilterCountAction` |
| FR-SCR-10 | Sistem harus menampilkan pratinjau dampak aturan kelayakan sebelum penilaian dimulai. | `previewProgramFilterAction` |
| FR-SCR-11 | Sesi penilaian dan baris hasilnya harus tersimpan sebelum pekerjaan dikirim ke layanan penilaian. | `startTournamentSessionAction` |
| FR-SCR-12 | Eksekusi penilaian harus berjalan pada proses terpisah, sebab satu penilaian dapat berupa puluhan sampai ratusan pemanggilan model dan embedding yang melampaui batas waktu permintaan web. | `scoring-service` |
| FR-SCR-13 | Penilaian harus tetap berjalan sampai selesai meski peramban ditutup. | `scoring-service/src/runner.ts` |
| FR-SCR-14 | Jumlah penilaian yang diproses bersamaan harus dibatasi, dan penilaian yang melampaui batas harus menunggu tanpa memerlukan tabel antrean tersendiri. | `SCORING_MAX_CONCURRENT` |
| FR-SCR-15 | Sesi yang tidak dikerjakan pekerja mana pun harus diambil kembali secara berkala, dan sesi yang terputus harus dilanjutkan saat layanan dinyalakan. | Penyapu sesi terlantar |
| FR-SCR-16 | Hasil pengiriman pekerjaan harus dilaporkan kepada pengguna sebagai dua keadaan berbeda, yaitu terkirim dan mengantre, sebab keduanya menuntut tindakan berbeda. | `ScoringDispatch` |
| FR-SCR-17 | Penyebab antrean harus dibedakan antara layanan tidak terjangkau, layanan menjawab dengan galat, dan alamat layanan belum dikonfigurasi, sebab layanan yang menjawab dengan galat tetap hidup sehingga melaporkannya sebagai tidak merespons akan menyesatkan operator. | `ScoringDispatch.reason` |
| FR-SCR-18 | Kegagalan pengiriman tidak boleh dilemparkan sebagai galat setelah data tersimpan, sebab hal itu akan meninggalkan sesi terlantar sekaligus pesan kesalahan. | `notifyScoringService` |
| FR-SCR-19 | Pesan antrean harus menyatakan bahwa sesinya sudah tersimpan dan tidak perlu dijalankan ulang, sebab menjalankan ulang adalah tindakan yang wajar dilakukan pengguna terhadap sesuatu yang tampak gagal. | Pemberitahuan antrean |
| FR-SCR-20 | Kemajuan penilaian harus dilaporkan sebagai tahapan bernama. | `scoring-wizard.tsx` |
| FR-SCR-21 | Konfigurasi yang berlaku atas sebuah penilaian harus dibekukan pada saat penilaian dibuat dan tidak boleh diperbarui sesudahnya. | `scoring_runs.config_snapshot` |
| FR-SCR-22 | Diagnostik penilaian harus disimpan pada baris hasil, bukan hanya pada sesi kerjanya, sebab sesi kerja bersifat sementara sedangkan peringkat yang selesai bersifat permanen. | `scoring_runs.run_info` |
| FR-SCR-23 | Kriteria yang tidak dapat dinilai pada siapa pun harus dikeluarkan dari perhitungan dengan bobotnya dibagikan ulang, bukan dibiarkan sebagai kolom bernilai nol. | `ahp-topsis-engine.ts` |
| FR-SCR-24 | Setiap nilai aspek harus berada pada skala 0 sampai 100, dan agregat kompetensi teknis harus dibatasi pada batas atas itu, sebab kelebihan kualifikasi pada satu kompetensi dapat mengimbangi kekurangan pada kompetensi lain tetapi tidak dapat membuat seseorang lebih dari sepenuhnya memenuhi syarat. | `matchCompetencySets` |
| FR-SCR-25 | Nilai tersimpan yang melampaui batas itu pada penilaian lama tidak boleh ditulis ulang, dan harus dijelaskan sebagai aturan yang sudah tidak berlaku. | `lib/scoring-explainer.ts` |
| FR-SCR-26 | Skala kemiripan harus diukur dari korpusnya sendiri dan dihitung ulang bila korpus atau modelnya berubah, bukan ditetapkan sebagai angka tetap. | `technical-anchors.ts`, `career-anchors.ts` |
| FR-SCR-27 | Skala relevansi karier harus ditetapkan dari beberapa penaksir yang saling bebas dengan nilai tengahnya yang dipakai, sehingga satu penaksir tidak dapat menggeser skala sendirian dan penaksir yang tidak tersedia tidak menggagalkan perhitungan. | `career-anchors.ts` |
| FR-SCR-28 | Setiap penilaian harus mencatat skala dan acuan yang dipakainya sendiri, sehingga peringkat yang selesai di bawah aturan lama tetap dapat dijelaskan dan tampak tidak sebanding. | `runInfo.career.scale` |
| FR-SCR-29 | Setiap penurunan mutu perhitungan harus dicatat dan ditampilkan, bukan dibiarkan mengubah arti sebuah angka secara diam-diam. | `runInfo` |
| FR-SCR-30 | Urutan hasil harus deterministik pada nilai yang sama persis, sehingga dua penilaian dengan masukan identik tidak menghasilkan urutan yang berbeda. | `loadAhpCandidates` |
| FR-SCR-31 | Posisi tanpa profil jabatan harus tetap dapat dinilai dengan mengambil tuntutan dari kompetensi pemangku jabatannya, dan penggantian itu harus dinyatakan. | `ahp-topsis-engine.ts` |

### FR-ANL — Analisis dan tindak lanjut hasil

| ID | Kebutuhan | Komponen pelaksana |
|---|---|---|
| FR-ANL-01 | Pengguna harus dapat melihat peringkat finalis beserta nilai tiap aspek dan penjelasan penurunannya. | `position-detail-tabs.tsx` |
| FR-ANL-02 | Seluruh penilaian sebuah posisi harus tersimpan sebagai riwayat yang dapat dipilih. | `position-run-table.tsx` |
| FR-ANL-03 | Penilaian yang sudah selesai tidak boleh pernah diubah; setiap tindak lanjut harus menghasilkan penilaian baru. | Rancangan `scoring_runs` |
| FR-ANL-04 | Hubungan induk dan turunan antar penilaian harus tersimpan sebagai kolom yang dapat ditelusuri dua arah, bukan sebagai catatan di dalam data bebas. | `scoring_runs.parent_run_id` |
| FR-ANL-05 | Menghapus sebuah penilaian tidak boleh menghapus penilaian yang diturunkan darinya; turunannya menjadi akar baru dan silsilahnya harus menyatakan hal itu. | `ON DELETE SET NULL` |
| FR-ANL-06 | Silsilah penilaian harus ditampilkan tanpa mengikuti penyaring tanggal atau program, sebab penyaringan akan memunculkan pemutusan silsilah yang sebenarnya tidak ada. | `getRunTreeAction` |
| FR-ANL-07 | Peringkat turunan harus menampilkan jejak leluhurnya di atas daftar, agar tidak ada yang mempelajari peringkat turunan tanpa diberi tahu bahwa itu turunan. | `run-ancestry.tsx` |
| FR-ANL-08 | Pengguna harus dapat menandai seorang kandidat "Ditandai dikecualikan (tidak memengaruhi angka)", dengan alasan terpilih dan keterangan; pembatalan tanda juga wajib beralasan, dan keduanya tercatat beserta pelaku dan waktunya. Hanya kandidat yang ada di run itu yang dapat ditandai. Run "Tambah Kandidat Pembanding" mewarisi tanda run induknya (pelaku, waktu, dan alasan asli; berlabel "diwarisi"), dan pembatalan di run turunan tidak mengubah run induk. | `setRunExclusionAction`, `startRerunAction` |
| FR-ANL-09 | Penandaan itu hanya mencatat: skor dan peringkat run tidak berubah, dan tidak ada run turunan yang dibuat. | `scoring_run_exclusions` |
| FR-ANL-10 | *(Dihapus.)* Penandaan tidak lagi memicu perhitungan ulang peringkat; run lama ber-mode `exclude` tetap terbaca. | — |
| FR-ANL-11 | *(Dihapus bersama FR-ANL-10.)* | — |
| FR-ANL-12 | Run pembanding harus memeringkat seluruh kumpulan calon induk apa adanya ditambah kandidat baru, dengan skala TOPSIS run induk (pembagi kolom dan titik ideal induk dibekukan; nilai kandidat baru di luar rentang induk dihitung pada ujung rentang itu — di atas nilai terbaik setara terbaik, di bawah nilai terendah setara terendah — dan ditandai "Di luar skala induk" beserta arahnya), sehingga kecocokan dan urutan kandidat lama sama persis dengan run induk dan kandidat pembanding hanya disisipkan. Daftar hasilnya adalah gabungan tanpa duplikasi dari N besar menurut peringkat baru (N = jumlah finalis induk), seluruh finalis induk, dan seluruh kandidat pembanding, masing-masing dengan peringkat pool penuh dan penanda "Kandidat pembanding", "Baru masuk N besar", atau "Keluar dari N besar" beserta penyebabnya ("disalip kandidat pembanding" atau, pada run lama, "bergeser karena pool berubah"). | `composeChildResultList`, `childFinalistTarget`, `rankCandidatesByTopsis` (anchored), `leftTopNCauseOf` |
| FR-ANL-13 | Dua run mana pun pada posisi dan tenant yang sama harus dapat dibandingkan berdampingan — hubungan pohon, sumber perubahan S1–S5, konfigurasi, keanggotaan pool, peringkat dan skor, per kriteria, rincian kandidat, atribusi bertahap, dan kalimat penjelasan dari templat T-01 sampai T-11 — dihitung secara deterministik dari data tersimpan dengan fungsi TOPSIS yang sama dengan scoring-service, tanpa model bahasa. Panel "Selisih Peringkat" di halaman run memakai mesin yang sama untuk induk langsung dan root. | `lib/run-compare.ts`, tab "Komparasi Versi" (`run-compare-workspace.tsx`) |
| FR-ANL-14 | Re-run hanya berlaku untuk run AHP+TOPSIS yang sudah selesai dan menyimpan snapshot pool; pada run lain tombolnya nonaktif dengan alasan spesifik. | `validateRerunRequest`, `getRerunPreviewAction` |
| FR-ANL-15 | Penilaian ulang hanya boleh dibuat dalam satu mode, "Tambah Kandidat Pembanding" (`incremental_add`); empat mode lama tetap terbaca, tampil di silsilah dengan label "mode lama", dan bisa dibuka. | `CREATABLE_RERUN_MODES`, `LEGACY_RERUN_MODES` |
| FR-ANL-16 | Setiap mode harus membawa satu kalimat yang menyebutkan apa yang dapat menggeser peringkatnya, dan seluruh tampilan harus memakai kalimat yang sama itu. | `RERUN_MODES[*].expectation` |
| FR-ANL-17 | Mode yang membekukan data harus membekukan keenam aspek beserta teks mentah asal perhitungannya, bukan sebagian aspek saja. | `CachedAspects.baseRaw` |
| FR-ANL-18 | Sistem harus mengukur pergeseran data antara penilaian dasar dan hari ini, dan menyatakan apakah pergeseran itu diterapkan atau sengaja tidak. | `runInfo.freshness` |
| FR-ANL-19 | Penilaian turunan harus mewarisi dari induknya: vektor bobot setelah pembagian ulang (presisi penuh), himpunan kriteria aktif, program/posisi/rentang level/aturan filter, jangkar kalibrasi, dan tanggal acuan. | `resolveFrozenBasis`, `AhpRerunSpec.frozen` |
| FR-ANL-20 | Data terbaru atau konfigurasi baru harus menghasilkan run akar baru (wizard atau "Scoring Ulang" program), bukan run turunan. | wizard scoring |
| FR-ANL-21 | Kandidat yang diminta secara khusus harus dijamin muncul di hasil dengan peringkat aslinya terhadap seluruh kumpulan calon, termasuk bila ia berada di luar batas finalis. | `AhpRerunSpec.newCandidateIds` / `.existingPoolCandidateIds` |
| FR-ANL-22 | Kandidat pembanding yang gagal aturan berkategori Rejected harus ditolak beserta aturannya; kandidat di luar rentang grade (Excluded) hanya boleh ditambahkan setelah konfirmasi per kandidat, dan penerobosan itu harus direkam beserta aturan yang dilanggarnya serta ditandai "Di luar rentang grade" di setiap tampilan. | `classifyAgainstParent`, `filterSummary.forceIncluded` |
| FR-ANL-23 | Run induk yang tidak menyimpan kumpulan calon lengkapnya harus ditolak sebagai induk, dengan saran membuat run baru dari wizard. | `validateRerunRequest` |
| FR-ANL-24 | Pengguna harus dapat mengurutkan secara manual kandidat yang nilainya sama persis. | `reorderTiedCandidatesAction` |
| FR-ANL-25 | Panel konfigurasi penilaian harus membaca potret yang dibekukan, dan hanya boleh membaca konfigurasi yang berlaku sekarang untuk penilaian yang dibuat sebelum potret itu ada, dengan menandainya sebagai bukan konfigurasi penilaian tersebut. | `run-configuration-panel.tsx` |
| FR-ANL-26 | Pengguna harus dapat bertanya kepada asisten mengenai sebuah penilaian, dan riwayat percakapannya tersimpan. | `lib/chat-actions.ts` |
| FR-ANL-27 | Percakapan harus dapat diekspor ke PDF, Word, dan Excel, dengan menyebutkan penilaian asalnya dan menandai pesan yang tidak dapat dibuka. | `lib/chat-export.ts` |
| FR-ANL-29 | Setiap run pembanding wajib menyimpan "Alasan / permintaan forum" (tidak kosong, paling panjang 1.000 karakter), divalidasi di klien dan server, dan ditampilkan di silsilah, banner run turunan, snapshot, dan halaman perbandingan. | `scoring_runs.rerun_reason` |
| FR-ANL-30 | Setiap kandidat yang diminta harus diklasifikasikan: akan dinilai baru, sudah di pool induk (tidak dinilai ulang), perlu konfirmasi (di luar rentang grade), atau ditolak beserta alasannya; pratinjau di dialog dan server memakai klasifikasi yang sama, dan tidak ada yang hilang diam-diam. | `classifyRerunCandidates` |
| FR-ANL-31 | Kandidat pembanding harus dinilai terhadap basis posisi run induk — job profile, acuan kompetensi, syarat pendidikan, dan dokumen target karier — yang disimpan sebagai nilai saat run root dibuat; bila induk tidak menyimpannya, nilai saat itu dipakai dan ditandai di banner run turunan dan di tab "Komparasi Versi". | `run_info.frozen.positionBasis` |
| FR-ANL-32 | Setiap run harus menyimpan snapshot konfigurasi lengkap dan menampilkannya dalam panel yang terbaca, dengan asal setiap butir, matriks AHP 6×6, bobot dua desimal (rincian enam desimal), "Tidak tersimpan pada run ini" untuk butir yang tidak ada, dan unduhan JSON. | `run-snapshot-panel.tsx` |
| FR-ANL-33 | Basis data harus menolak setiap perubahan atas run berstatus selesai, baris hasilnya, dan pool-nya; satu-satunya pengecualian adalah urutan seri manual dan pengosongan kunci asing. | drizzle/0087 |
| FR-ANL-34 | Pengguna harus dapat memeriksa bahwa TOPSIS yang dihitung ulang dari data tersimpan sebuah run menghasilkan peringkat dan koefisien kedekatan yang sama dengan yang tersimpan. | `verifyRunReproducibility` |
| FR-ANL-35 | Dari riwayat posisi, pengguna harus dapat menjalankan penilaian baru (run root) dengan data dan konfigurasi hari ini, dan sistem menawarkan perbandingan dengan run root sebelumnya. | `startNewRootRunAction` |
| FR-ANL-36 | Perbandingan dua run harus dapat diekspor ke XLSX dengan lembar Ringkasan, Konfigurasi, Pool, Peringkat, Kriteria, Rincian kandidat, Kalimat penjelasan, dan Atribusi, dengan angka disimpan sebagai angka. | `lib/run-compare-export.ts` |
| FR-ANL-37 | Setiap run harus mencatat durasi setiap tahap, dan peringkatnya harus tersimpan sebelum narasi model bahasa ditulis. | `run_info.timings` |
| FR-ANL-38 | Run yang gagal harus tampil gagal beserta pesannya di silsilah dan ringkasan run, tanpa mengubah run induknya. | `run_info.failure` |
| FR-ANL-39 | Halaman hasil scoring harus memiliki tab "Komparasi Versi" yang menggambar seluruh run posisi sebagai pohon silsilah dan memungkinkan dua run mana pun dipilih langsung dari pohon sebagai A dan B, termasuk root dengan banyak turunan: induk tetap terlihat selama turunannya digulir, B dapat dipindah ke saudara sebelumnya atau berikutnya, cabang dapat dilipat, dan run yang tidak dapat dibandingkan tetap tergambar dengan alasannya. | `lineage-navigator.tsx`, `lib/run-lineage-layout.ts` |
| FR-ANL-40 | Tab yang dibuka dan pasangan A dan B harus tersimpan di alamat halaman (`?tab=komparasi-versi&a=…&b=…`; tautan lama `?tab=perbandingan-run` tetap membuka tab ini); centang dua run pada tampilan Silsilah di riwayat scoring, pintasan "Bandingkan dengan …", banner run turunan, dan panel Selisih Peringkat membuka tab itu tanpa memuat ulang halaman, dan tautan lama `/positions/[id]/compare` dialihkan ke sana. | `compareHref`, `compare-nav.tsx` |

### FR-MCU — Data pemeriksaan kesehatan (MCU)

| ID | Kebutuhan | Komponen pelaksana |
|---|---|---|
| FR-MCU-01 | Status pemeriksaan kesehatan tidak boleh menjadi penggugur kelayakan; aturan MCU hanya menandai, sebab temuan medis tidak membuat seseorang kurang kompeten untuk sebuah jabatan. | drizzle/0071 |
| FR-MCU-04 | MCU tidak boleh ditambahkan sebagai kriteria ketujuh, sebab urutan kriteria adalah urutan baris dan kolom setiap matriks bobot tersimpan, dan menambahnya akan membuat matriks tersimpan gagal dibaca lalu diam-diam kembali ke bobot bawaan. | `AHP_CRITERIA_ORDER` |
| FR-MCU-11 | Catatan medis harus disimpan pada dua kolom terpisah, yaitu hasil sinkronisasi dan isian manual, dan isian manual tidak boleh pernah ditimpa sinkronisasi. | `mcu_note`, `mcu_note_manual` |
| FR-MCU-20 | Data MCU tidak boleh dipakai untuk menghitung ulang skor kriteria, skor akhir, maupun peringkat — tidak tersimpan dan tidak pula sebagai tampilan pembanding. | (tidak ada — fitur pembanding dihapus) |

### FR-SUC — Penetapan suksesor

| ID | Kebutuhan | Komponen pelaksana |
|---|---|---|
| FR-SUC-01 | Pengguna berwenang harus dapat menetapkan seorang kandidat sebagai suksesor sebuah posisi pada sebuah program, disertai justifikasi yang wajib diisi dan run yang menjadi dasar keputusan; pejabat posisi itu tidak dapat dipilih sebagai suksesornya sendiri. | `savePositionPickAction` |
| FR-SUC-02 | Beberapa kandidat harus dapat ditetapkan untuk satu program yang sama pada satu posisi. | `position_picks` |
| FR-SUC-03 | Urutan prioritas suksesor harus dapat diatur. | `reorderPicksAction` |
| FR-SUC-04 | Justifikasi pemilihan harus dapat disunting setelah disimpan, dan setiap perubahannya tercatat di jejak audit. | `updatePickNotesAction` |
| FR-SUC-05 | Penetapan suksesor harus dapat dibatalkan. | `deletePositionPickAction` |
| FR-SUC-06 | Penetapan suksesor harus bertahan meski penilaian asalnya dihapus, sebab keputusan manusia yang diambil dari sebuah peringkat bukan bagian dari peringkat itu. | `position_picks.run_id` bernilai kosong saat dihapus |
| FR-SUC-07 | Daftar suksesor terpilih harus dapat dilihat dari sisi posisi maupun dari sisi kandidat, dan keduanya harus membaca data yang sama. | `listPositionPicks`, `getSuccessorSeatsByCandidate` |
| FR-SUC-08 | Daftar suksesor terpilih harus dapat dicetak. | `position-detail-tabs.tsx` |
| FR-SUC-09 | Tab "Komparasi Versi" harus menampilkan rekomendasi sistem (peringkat 1–N run dasar keputusan) berdampingan dengan keputusan forum, dan posisi setiap suksesor terpilih di run A dan B yang sedang dibandingkan; bila kandidat terpilih bukan peringkat pertama, justifikasinya ditampilkan menonjol sebagai "Alasan berbeda dari rekomendasi". | `decision-summary.tsx` |
| FR-SUC-10 | Memilih kandidat yang ditandai dikecualikan sebagai suksesor harus meminta konfirmasi tambahan. | `position-detail-tabs.tsx` |
### FR-DSH — Dasbor dan pelaporan

| ID | Kebutuhan | Komponen pelaksana |
|---|---|---|
| FR-DSH-01 | Dasbor harus menyajikan ringkasan keadaan suksesi Company aktif. | `getDashboardOverview` |
| FR-DSH-02 | Seluruh angka dasbor harus diturunkan pada saat halaman dibuka dan tidak boleh disimpan sebagai kolom, sehingga tidak ada dua sumber kebenaran untuk satu angka. | `getDashboardOverview` |
| FR-DSH-03 | Setiap angka harus menyediakan penjelasan pembilang, penyebut, dan apa yang dikecualikannya, dapat dibuka pada layar sentuh maupun tetikus. | `MetricHelp` |
| FR-DSH-04 | Cakupan bangku cadangan harus dihitung dari baris hasil penilaian, bukan dari jumlah orang, dan harus dinyatakan demikian. | `COVERAGE_HELP` |
| FR-DSH-05 | Perhitungan harus memakai penilaian terakhir yang berstatus selesai pada setiap posisi, dan mengabaikan yang masih berjalan. | `getDashboardOverview` |
| FR-DSH-06 | Cakupan pemangku jabatan harus dinyatakan sebagai ukuran kelengkapan data, bukan ukuran ketersediaan pengganti. | `INCUMBENT_HELP` |
| FR-DSH-07 | Pita kesiapan harus memakai jumlah posisi sebagai penyebut, dan posisi yang belum pernah dinilai ikut terhitung dengan cakupan nol. | `BANDS_HELP` |
| FR-DSH-08 | Angka Talent Pool pada dasbor harus merupakan hasil evaluasi aturan kelayakan, bukan jumlah kandidat mentah, sebab dasbor yang berselisih dengan halaman yang ditautkannya lebih buruk daripada tidak ada kartu sama sekali. | `getDashboardOverview` |
| FR-DSH-09 | Kegagalan menghitung angka itu harus menurunkannya menjadi nol, tidak boleh menjatuhkan seluruh dasbor. | `getDashboardOverview` |
| FR-DSH-10 | Dasbor harus melaporkan jumlah posisi yang pemangkunya telah mencapai ambang pensiun. | `positionsNeedingChange` |
| FR-DSH-11 | Kuadran HAV harus dapat diturunkan dari penilaian kinerja dikali kompetensi perilaku bila tidak ada unggahan HAV, dan nilai turunan itu tidak boleh disimpan, sebab penyimpanannya akan menghitung ganda perilaku dan kinerja di dalam aspek HAV. | `docs/hav-16-kuadran.md` |
| FR-DSH-12 | Tautan menuju daftar posisi dari dasbor harus tetap bermakna sama setelah penyaringnya berubah bentuk. | `getPositionManagementPage` |
| FR-DSH-13 | Sistem harus menyediakan halaman pemantauan penilaian yang sedang berjalan beserta seluruh penurunan mutu perhitungannya. | `lib/progress-running-actions.ts` |

### FR-SEC — Keamanan data

Sejak 25 November 2026 sistem tidak lagi mengenkripsi data di tingkat
aplikasi. Data kandidat, isi percakapan, penempatan Talent Mapping, jejak
perhitungan penilaian, dan kata sandi koneksi basis data sumber tersimpan tanpa
enkripsi di PostgreSQL; perlindungannya bergantung pada kendali akses basis data
(akun, jaringan, dan cadangan) serta izin aplikasi (FR-AUT). Kelima belas butir
domain ini tetap dicantumkan agar penomorannya stabil.

| ID | Kebutuhan | Komponen pelaksana |
|---|---|---|
| FR-SEC-01 | *(Dihapus 2026-11-25 bersama enkripsi tingkat aplikasi.)* Data sensitif tidak lagi disimpan terenkripsi; data tersimpan sebagai teks biasa di PostgreSQL dan dilindungi oleh kendali akses basis data. | — |
| FR-SEC-02 | *(Dihapus 2026-11-25 bersama enkripsi tingkat aplikasi.)* Tidak ada lagi kunci utama maupun berkas kunci di server. | — |
| FR-SEC-03 | *(Dihapus 2026-11-25 bersama enkripsi tingkat aplikasi.)* Halaman Keamanan sudah tidak ada; alamatnya dialihkan ke Sinkronisasi. | — |
| FR-SEC-04 | *(Dihapus 2026-11-25 bersama enkripsi tingkat aplikasi.)* Tidak ada lagi kunci yang dapat dibuat, dibuka, dikunci, atau dirotasi. | — |
| FR-SEC-05 | *(Dihapus 2026-11-25 bersama enkripsi tingkat aplikasi.)* | — |
| FR-SEC-06 | *(Dihapus 2026-11-25 bersama enkripsi tingkat aplikasi.)* | — |
| FR-SEC-07 | *(Dihapus 2026-11-25 bersama enkripsi tingkat aplikasi.)* | — |
| FR-SEC-08 | *(Dihapus 2026-11-25 bersama enkripsi tingkat aplikasi.)* | — |
| FR-SEC-09 | *(Dihapus 2026-11-25 bersama enkripsi tingkat aplikasi.)* | — |
| FR-SEC-10 | *(Dihapus 2026-11-25 bersama enkripsi tingkat aplikasi.)* Proses terjadwal menulis data kandidat tanpa membuka kunci apa pun. | — |
| FR-SEC-11 | *(Dihapus 2026-11-25 bersama enkripsi tingkat aplikasi.)* Setiap penulisan menyimpan teks biasa. | — |
| FR-SEC-12 | *(Dihapus 2026-11-25 bersama enkripsi tingkat aplikasi.)* | — |
| FR-SEC-13 | *(Dihapus 2026-11-25 bersama enkripsi tingkat aplikasi.)* | — |
| FR-SEC-14 | *(Dihapus 2026-11-25 bersama enkripsi tingkat aplikasi.)* Kata sandi koneksi basis data sumber tersimpan tanpa enkripsi dan dibaca langsung oleh layanan sinkronisasi. | — |
| FR-SEC-15 | *(Dihapus 2026-11-25 bersama enkripsi tingkat aplikasi.)* | — |

### FR-AUD — Audit dan riwayat

| ID | Kebutuhan | Komponen pelaksana |
|---|---|---|
| FR-AUD-01 | Perubahan tata kelola harus tercatat beserta pelakunya. | `lib/audit-actions.ts` |
| FR-AUD-02 | Riwayat perubahan harus menyatakan bahwa perubahan instruksi model dan ambang tidak tercatat di sana, sebab keduanya tersimpan sebagai berkas konfigurasi dan bukan data Company. | Seksi Riwayat Perubahan |
| FR-AUD-03 | Setiap eksekusi sinkronisasi harus tercatat beserta pemicunya, yaitu manual, terjadwal, baris perintah, atau panggilan antarmuka. | `listSyncRunsAction` |
| FR-AUD-05 | Instruksi model harus berversi dengan riwayat yang dapat dipulihkan. | `lib/scoring-prompt-actions.ts` |
| FR-AUD-06 | Seluruh penanggalan yang ditampilkan harus memakai satu format dan satu zona waktu bisnis, sebab penanggalan di sini adalah bukti kapan sebuah penilaian dibuat dan dua pembaca harus melihat waktu dinding yang sama. | `lib/datetime.ts` |
| FR-AUD-07 | Label penilaian harus tetap terbaca lintas seluruh bentuk penamaan yang pernah dipakai sistem, sehingga penilaian turunan tidak menumpuk penanda sampai melampaui batas panjang kolom dan gagal tersimpan. | `lib/run-label.ts` |

## 5. Kebutuhan yang sengaja TIDAK dipenuhi

Bagian ini mencatat perilaku yang mungkin diharapkan ada tetapi memang
ditolak. Penolakan-penolakan ini sengaja didaftar, sebab pada sistem ini
sebagian besar keputusan rancangan justru berbentuk penolakan, dan sebuah
permintaan perubahan yang tidak menyadarinya akan membatalkan alasan yang
melatarbelakanginya.

| Yang tidak dipenuhi | Alasan |
|---|---|
| Mengubah hasil penilaian yang sudah selesai | Sebuah peringkat adalah catatan penilaian pada satu tanggal |
| Memindahkan posisi yang sudah dinilai ke program lain | Akan mengubah arti riwayat penilaiannya |
| Menghapus kandidat secara permanen | Akan menulis ulang setiap peringkat yang pernah memuatnya |
| Mengubah nomor induk karyawan lewat penyuntingan | Nomor induk adalah identitas dan kunci penggabungan di banyak tempat |
| Menambahkan MCU sebagai kriteria ketujuh | Akan membuat setiap matriks bobot tersimpan gagal dibaca dan diam-diam kembali ke bobot bawaan |
| Mengurutkan ulang daftar berdasarkan data MCU | Satu catatan medis akan mengalahkan setiap selisih kompetensi |
| Memberi bobot pada daftar kriteria | Pembobotan harus berasal dari satu permukaan saja |
| Memakai model bahasa untuk menyetel pengelompokan rumpun jabatan | Himpunan hal yang dapat diinginkan sudah terbatas dan sudah terdaftar |
| Menerapkan cakupan kepemilikan dokumen pada penilaian | Akan menggugurkan kriteria kandidat dari unit lain dan membagi ulang bobot secara diam-diam |
| Menggugurkan kandidat karena status pemeriksaan kesehatan | Temuan medis tidak membuat seseorang kurang kompeten |
| Menampilkan kendali penghapusan seluruh riwayat penilaian satu program | Satu-satunya tindakan yang tidak dapat dibatalkan pada halaman tersebut |
| Mengunggah data kandidat, divisi, departemen | Ketiganya diturunkan dari data lain, bukan ditarik dari sumber |
| Mengenkripsi data di tingkat aplikasi | Dihapus 2026-11-25. Data tersimpan tanpa enkripsi di PostgreSQL; perlindungannya bergantung pada kendali akses basis data |

## 6. Batas cakupan dokumen ini

Daftar ini menggambarkan perilaku sistem pada saat dokumen disusun. Empat hal
berada di luar cakupannya.

**Kebutuhan non-fungsional tidak dicantumkan.** Kinerja, ketersediaan,
kapasitas, dan batas waktu respons tidak dirumuskan di sini, kecuali bila
perilaku fungsional memang bergantung padanya, misalnya keharusan penilaian
berjalan pada proses terpisah.

**Aturan perhitungan tidak diuraikan sampai tingkat rumus.** Rumus tiap
kriteria, penurunan bobot, dan metodologi pelaporan sudah dimuat pada dokumen
tersendiri di dalam repositori.

**Kebutuhan yang pernah dirumuskan tetapi tidak dibangun tidak akan muncul.**
Ketiadaan sebuah butir di sini bukan bukti bahwa kebutuhannya tidak pernah ada.

**Sebagian butir tidak pernah ditulis sebagai kebutuhan.** Butir-butir itu
lahir dari keputusan rancangan saat pembangunan, dan dicantumkan karena bagi
pengguna ia berperilaku persis seperti kebutuhan: sistem bertindak dengan cara
tertentu dan dapat diuji apakah ia benar bertindak demikian.
