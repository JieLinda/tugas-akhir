# Sinkronisasi naskah TA dengan implementasi re-run dan perbandingan run

> Catatan (2026-11): tab "Perbandingan Run" yang dirujuk dokumen ini kini bernama **"Komparasi Versi"** (`?tab=komparasi-versi`; tautan lama `?tab=perbandingan-run` tetap dialihkan), berada di bawah tab "Konfigurasi", dan isinya disusun ulang menjadi lima bagian (Ringkasan, Peringkat, Analisis, Konfigurasi & Pool, Keputusan forum). Dokumen ini adalah catatan pada waktunya dan sengaja tidak ditulis ulang.

Dokumen ini membandingkan empat belas klaim naskah tugas akhir (K-01 sampai
K-14) tentang penilaian ulang dengan perilaku kode setelah fitur "Tambah
Kandidat Pembanding" dan "Perbandingan Run 1:1" disempurnakan (Fase A–E, cabang
`mcdm`). Setiap klaim diberi status:

- **Benar** — naskah sudah sesuai dengan kode; usulan kalimat hanya mempertegas.
- **Perlu revisi** — naskah menyatakan sesuatu yang tidak lagi, atau tidak pernah,
  dilakukan kode; usulan kalimat menggantikannya.

Naskahnya sendiri tidak tersimpan di repositori. Klaim di bawah dikutip
sebagaimana dirangkum dalam brief sesi, sehingga usulan kalimat perlu
disesuaikan dengan penomoran persamaan, tabel, dan gambar pada naskah. Bukti
setiap perilaku ada di `docs/rerun-requirements-audit.md` §6, dan aturan desain
yang mengikat ada di bagian "Re-run scoring — aturan desain" pada `CLAUDE.md`.

## Ringkasan

| Kode | Bagian naskah | Status |
|---|---|---|
| K-01 | Subbab 1.4.3 butir g | Perlu revisi |
| K-02 | Subbab 1.4.4 butir f | Benar |
| K-03 | Subbab 2.6 butir 4 | Perlu revisi |
| K-04 | Subbab 2.6.2 (peluruhan stint) | Perlu revisi |
| K-05 | Tabel 3.3, F-9 | Perlu revisi |
| K-06 | Tabel 3.3, F-10 | Perlu revisi |
| K-07 | Tabel 3.4 dan uraiannya | Perlu revisi |
| K-08 | Uraian Gambar 3.4 | Perlu revisi |
| K-09 | Subbab 2.12 (analisis sensitivitas) | Perlu revisi |
| K-10 | UC-13 | Benar |
| K-11 | UC-14 | Benar |
| K-12 | Tabel 2.4 | Perlu revisi |
| K-13 | Diagram aktivitas UC-5 | Perlu revisi |
| K-14 | Tabel 3.5 (NF-1, NF-2) | Benar |

Dua perubahan menjadi akar sebagian besar revisi. Pertama, penilaian ulang kini
hanya satu mode, yaitu Tambah Kandidat Pembanding, dan perubahan data atau
konfigurasi tidak lagi menghasilkan run turunan, melainkan run root baru.
Kedua, run yang sudah selesai tidak dapat diubah sama sekali; penandaan,
keputusan forum, dan catatan lain disimpan di tabel terpisah.

---

## K-01 — Subbab 1.4.3 butir g: kapan penilaian dijalankan ulang

**Klaim naskah.** Penilaian dijalankan ulang "ketika terdapat usulan nama baru
atau perubahan konfigurasi".

**Status: Perlu revisi.**

**Perilaku sebenarnya.** Kedua pemicu itu kini menempuh jalur yang berbeda.
Usulan nama baru ditangani oleh Tambah Kandidat Pembanding, yang membuat run
turunan dari run yang sudah selesai: run turunan sama dengan induknya kecuali
himpunan kandidatnya (`lib/rerun-freeze.ts`, `scoring-service/src/rerun-freeze.ts`).
Perubahan konfigurasi (matriks AHP, aturan filter, ambang readiness, job
profile) atau data terbaru menghasilkan run root baru untuk posisi yang sama,
lewat wizard scoring, "Scoring Ulang" program, atau tombol "Penilaian Baru" di
riwayat posisi. Dua run root dibandingkan dengan perbandingan 1:1.

**Usulan kalimat pengganti.**

> g. Penilaian dapat diulang melalui dua jalur yang dibedakan menurut sebabnya.
> Bila forum mengusulkan nama baru, sistem membuat run turunan dari run yang
> sudah selesai dengan mekanisme Tambah Kandidat Pembanding. Run turunan
> mewarisi seluruh konfigurasi dan nilai kandidat lama dari run induknya, dan
> hanya menilai kandidat yang belum pernah dinilai, sehingga pergeseran
> peringkat dapat ditelusuri ke kandidat yang ditambahkan. Bila yang berubah
> adalah data atau konfigurasi penilaian, misalnya bobot AHP, aturan
> penyaringan, ambang readiness, atau job profile, sistem membuat run root baru
> untuk jabatan yang sama, lalu hasilnya dibandingkan dengan run root
> sebelumnya melalui perbandingan dua run.

---

## K-02 — Subbab 1.4.4 butir f: riwayat dan selisih antarpenilaian

**Klaim naskah.** Sistem menyediakan riwayat penilaian beserta konfigurasi
pembentuk dan selisih hasil antarpenilaian.

**Status: Benar.**

**Perilaku sebenarnya.** Setiap run menyimpan snapshot konfigurasinya saat dibuat
(`scoring_runs.config_snapshot`, `run_info.frozen`, `filter_summary`): matriks
perbandingan berpasangan AHP, CR, bobot nominal dan efektif, kriteria aktif,
aturan penyaringan, rentang grade, jangkar kalibrasi, tanggal acuan, basis
posisi, ID model, versi data, ambang readiness, dan jumlah finalis. Riwayat
tampil sebagai pohon run per posisi, dan dua run mana pun pada posisi yang sama
dapat dibandingkan berdampingan (tab "Perbandingan Run" di halaman posisi; alamat lama `/positions/[id]/compare` dialihkan ke sana).

**Usulan kalimat pengganti (mempertegas).**

> f. Sistem menyimpan riwayat penilaian setiap jabatan dalam bentuk pohon run.
> Setiap run membekukan konfigurasi pembentuknya pada saat dibuat, yaitu matriks
> perbandingan berpasangan AHP beserta rasio konsistensinya, bobot akhir,
> kriteria aktif, aturan penyaringan, ambang readiness, dan basis jabatan yang
> dipakai, sehingga hasil sebuah run selalu dapat dijelaskan dengan aturan yang
> benar-benar berlaku saat itu. Dua run pada jabatan yang sama dapat
> dibandingkan untuk menunjukkan selisih peringkat, skor, dan konfigurasinya,
> beserta sumber perubahannya.

---

## K-03 — Subbab 2.6 butir 4: perulangan yang dapat dibandingkan dan dimodifikasi

**Klaim naskah.** Mekanisme perulangan yang "dapat dibandingkan dan dimodifikasi
konfigurasi dan hasilnya".

**Status: Perlu revisi.**

**Perilaku sebenarnya.** Run yang sudah selesai tidak dapat dimodifikasi, baik
konfigurasinya maupun hasilnya. Larangan ini dijaga di lapisan basis data
(`drizzle/0087_completed_run_immutability.sql`): setiap perubahan atas run
berstatus selesai, baris hasilnya, dan pool-nya ditolak. Modifikasi dilakukan
dengan membuat run baru: run turunan bila himpunan kandidat yang berubah, run
root baru bila konfigurasi atau data yang berubah. Catatan manusia, yaitu
penandaan pengecualian dan keputusan forum, disimpan di tabel terpisah dan tidak
mengubah angka.

**Usulan kalimat pengganti.**

> 4. Mekanisme perulangan penilaian yang dapat dibandingkan dan ditelusuri.
> Run yang sudah selesai diperlakukan sebagai catatan penilaian pada suatu
> tanggal dan tidak dapat diubah. Perubahan himpunan kandidat atau konfigurasi
> menghasilkan run baru yang terhubung dengan run sebelumnya, sehingga setiap
> versi penilaian tetap tersedia dan dua versi mana pun dapat dibandingkan.
> Catatan yang ditambahkan sesudahnya, seperti penandaan kandidat dan keputusan
> forum, disimpan terpisah beserta pelaku, waktu, dan alasannya.

---

## K-04 — Subbab 2.6.2: peluruhan stint pada run turunan

**Klaim naskah.** "Run turunan dengan mode frozen memakai ulang skor run
dasarnya, sedangkan mode data terbaru menghitung ulang dengan tanggal penilaian
yang baru", dengan rujukan ke "desain solusi 2.6.4".

**Status: Perlu revisi.**

**Perilaku sebenarnya.** Mode "data terbaru" tidak ada lagi; satu-satunya run
turunan adalah Tambah Kandidat Pembanding. Run turunan memakai ulang enam skor
aspek kandidat lama dari induknya, dan menilai kandidat baru dengan **tanggal
acuan induk**, bukan tanggal hari ini. Faktor peluruhan relevansi stint (Pers.
2.5) untuk kandidat baru dihitung terhadap tanggal acuan yang dibekukan itu
(`recencyFactor` dan `stintYears` menerima `asOf`), sehingga kandidat baru dan
kandidat lama diukur pada titik waktu yang sama. Untuk induk lama yang tidak
mencatat tanggal acuannya, tanggal itu diturunkan dari waktu selesai induk dan
ditandai sebagai turunan. Tanggal penilaian yang baru hanya dipakai oleh run
root baru.

**Usulan kalimat pengganti.**

> Tanggal acuan peluruhan pada Pers. 2.5 ditetapkan sekali saat run root dibuat
> dan disimpan dalam snapshot run. Run turunan yang dibuat melalui Tambah
> Kandidat Pembanding memakai ulang enam skor aspek kandidat lama dari run
> induknya, dan menghitung relevansi karier kandidat tambahan dengan tanggal
> acuan yang sama, sehingga kedua kelompok kandidat diukur pada titik waktu yang
> sama dan peringkat gabungannya sebanding. Penilaian dengan tanggal acuan yang
> baru dilakukan dengan membuat run root baru (lihat subbab 2.6.4).

*Catatan:* rujukan "desain solusi 2.6.4" perlu menunjuk uraian satu mode re-run
pada K-07, bukan uraian lima mode.

---

## K-05 — Tabel 3.3, F-9: re-run dengan beberapa pilihan pengaturan

**Klaim naskah.** Re-run "dengan beberapa pilihan pengaturan" dan struktur
pohon.

**Status: Perlu revisi** (struktur pohon benar; "beberapa pilihan pengaturan"
tidak lagi benar).

**Perilaku sebenarnya.** Re-run hanya punya satu mode. Masukan pengguna hanya
himpunan kandidat yang ditambahkan dan alasan atau permintaan forum (wajib,
paling panjang 1.000 karakter). Struktur pohon tetap: setiap posisi dapat
memiliki beberapa run root, setiap root dapat memiliki turunan, dan run bermode
lama tetap tampil dengan label "Mode lama: <nama mode>".

**Usulan isi sel F-9 pengganti.**

> F-9. Sistem menyediakan penilaian ulang Tambah Kandidat Pembanding atas run
> yang sudah selesai, dengan masukan berupa kandidat tambahan dan alasan atau
> permintaan forum. Run hasil penilaian ulang tersusun sebagai pohon per
> jabatan (run root → run turunan). Perubahan data atau konfigurasi dijalankan
> sebagai run root baru pada jabatan yang sama.

---

## K-06 — Tabel 3.3, F-10: isi snapshot konfigurasi

**Klaim naskah.** Snapshot berisi matriks AHP, bobot akhir, dan aturan filter.

**Status: Perlu revisi** (benar tetapi tidak lengkap).

**Perilaku sebenarnya.** Snapshot setiap run mencakup sembilan kelompok
(`docs/rerun-requirements-audit.md` FR-SN-01): identitas run; himpunan kandidat
dan hasil penyaringan per karyawan; aturan penyaringan dan rentang grade;
pembobotan AHP (matriks sebagaimana diisikan, CR, sumber bobot, bobot nominal
presisi penuh, kriteria aktif, bobot sesudah pembagian ulang); jangkar dan
parameter (L dan U kompetensi teknis serta relevansi karier, target kedalaman,
tanggal acuan); basis posisi; versi data; ID model; serta ambang readiness dan
jumlah finalis. Setiap butir memiliki label asal.

**Usulan isi sel F-10 pengganti.**

> F-10. Sistem menyimpan snapshot konfigurasi setiap run saat run dibuat, yang
> terdiri atas matriks perbandingan berpasangan AHP beserta rasio konsistensinya,
> bobot akhir sesudah pembagian ulang, kriteria aktif, aturan penyaringan dan
> rentang grade, jangkar kalibrasi, tanggal acuan, basis jabatan, versi data,
> model yang dipakai, ambang readiness, dan jumlah finalis. Setiap butir
> menyatakan asalnya: dibekukan saat run dibuat, diwarisi dari run induk, atau
> dibaca dari kondisi saat itu karena run induk tidak menyimpannya.

---

## K-07 — Tabel 3.4 dan uraiannya: lima mode

**Klaim naskah.** Tabel 3.4 memuat lima mode penilaian ulang, termasuk
force-include pada mode refresh penuh.

**Status: Perlu revisi.**

**Perilaku sebenarnya.** Hanya satu mode yang dapat dibuat, yaitu Tambah Kandidat
Pembanding (`incremental_add`). Empat mode lama (tambah kandidat dengan data
terbaru, kecualikan kandidat, tanding ulang finalis, dan hitung ulang dengan data
terbaru) tidak dapat dibuat lagi, tetapi run yang sudah dibuat dengan mode itu
tetap dapat dibuka, tampil di pohon, dan dibandingkan. Force-include tidak lagi
berlaku umum: kandidat tambahan yang gagal aturan berkategori Rejected ditolak,
dan hanya kandidat berkategori Excluded (grade di luar rentang posisi) yang dapat
dimasukkan setelah konfirmasi per kandidat, lalu dicatat dengan penanda "Di luar
rentang grade".

**Usulan Tabel 3.4 pengganti.**

| Mode | Isi pool | Yang dibekukan dari run induk | Yang dihitung baru | Syarat run induk |
|---|---|---|---|---|
| Tambah Kandidat Pembanding | Seluruh pool run induk apa adanya (termasuk kandidat yang sejak itu dihapus datanya atau kini menjadi pejabat), ditambah kandidat pembanding yang diterima | Enam skor aspek dan nilai mentah kandidat lama; matriks AHP, CR, dan bobot akhir sesudah pembagian ulang (Pers. 2.12) pada presisi penuh; kriteria aktif; program, jabatan, rentang grade, dan aturan penyaringan; jangkar kalibrasi teknis dan karier serta target kedalaman; tanggal acuan peluruhan (Pers. 2.5); basis jabatan (job profile, acuan kompetensi, syarat pendidikan, dokumen target karier); ambang readiness dan jumlah finalis; penanda skor sementara kandidat lama | Enam skor aspek kandidat pembanding yang belum ada di pool induk, dinilai terhadap basis jabatan dan tanggal acuan induk; lalu TOPSIS atas pool gabungan | Berstatus selesai; metode AHP + TOPSIS; menyimpan skor aspek seluruh pool; berada di business unit pengguna. Kandidat yang sudah menjadi finalis induk, datanya dihapus, kini pejabat posisi target, atau gagal aturan Rejected ditolak beserta alasannya |

**Usulan uraian pengganti.**

> Tabel 3.4 menunjukkan satu-satunya mode penilaian ulang. Run turunan identik
> dengan run induknya kecuali himpunan kandidatnya, sehingga setiap pergeseran
> peringkat dapat ditelusuri ke kandidat yang ditambahkan. Walaupun skor aspek
> kandidat lama dibekukan, kedekatan relatif (koefisien kedekatan) mereka
> tetap dihitung ulang, karena TOPSIS bersifat relatif terhadap himpunan
> alternatif di dua tempat. Pertama, pembagi normalisasi vektor setiap kriteria,
> yaitu akar jumlah kuadrat nilai pada kolom itu, bertambah ketika kandidat
> baru masuk, sehingga nilai ternormalisasi seluruh kandidat lama mengecil.
> Kedua, solusi ideal positif dan negatif diambil dari nilai terbaik dan
> terburuk di pool, sehingga dapat berpindah kepada kandidat baru. Karena itu,
> urutan dua kandidat lama dapat bertukar walaupun nilai mereka tidak berubah
> (rank reversal). Sistem menyatakan sumber pergeseran itu secara eksplisit,
> misalnya kandidat pembanding yang kini memegang nilai tertinggi suatu kriteria
> atau pembagi normalisasi yang naik sekian kali, dan menampilkan daftar hasil
> yang terdiri atas N besar menurut peringkat baru, seluruh finalis run induk,
> dan seluruh kandidat pembanding, dengan peringkat pool penuh masing-masing.

---

## K-08 — Uraian Gambar 3.4: durasi dan jumlah finalis

**Klaim naskah.** Re-run "selesai dalam hitungan detik" dan forum "selalu memiliki
10 finalis bawaan".

**Status: Perlu revisi.**

**Perilaku sebenarnya.** Durasi belum dapat diklaim. Setiap run kini mencatat
durasi per tahap (`run_info.timings`), dan pengukuran pada fixture laboratorium
memberi waktu engine sekitar 45–70 milidetik per run
(`docs/rerun-requirements-audit.md` §6.8). Angka itu adalah batas bawah karena
di lingkungan uji tidak ada model yang terjangkau; di produksi, penilaian setiap
kandidat baru menunggu panggilan model embedding dan model bahasa (pendidikan),
dan narasi menunggu model bahasa. Ambang durasi disepakati dengan praktisi HC
berdasarkan pengukuran di lingkungan produksi. Jumlah finalis tidak selalu 10:
nilai bawaan program sistem memang 10, tetapi target finalis dapat diatur per
program di Tata Kelola, dibatasi ukuran pool, dan pada run turunan mengikuti
jumlah finalis induk. Daftar hasil run turunan dapat lebih panjang dari N karena
memuat juga finalis induk dan kandidat pembanding.

**Usulan kalimat pengganti.**

> Setelah forum mengusulkan nama tambahan, sistem membuat run turunan yang hanya
> menilai kandidat baru, sedangkan kandidat lama memakai nilai yang dibekukan
> dari run induk. Durasi setiap tahap dicatat pada run itu sendiri, sehingga
> waktu tunggu forum dapat diukur dan dibandingkan dengan ambang yang disepakati
> bersama praktisi Human Capital. Jumlah finalis mengikuti target yang
> ditetapkan program penilaian (nilai bawaan sepuluh) dan, pada run turunan,
> jumlah finalis run induknya; daftar hasil run turunan juga memuat seluruh
> finalis run induk dan seluruh kandidat pembanding.

---

## K-09 — Subbab 2.12: analisis sensitivitas dan CR

**Klaim naskah.** Bobot baru dipakai hanya bila CR < 0,1; bila tidak, dipakai
bobot sebelumnya atau bobot bawaan.

**Status: Perlu revisi** (hasil akhirnya serupa, mekanismenya berbeda).

**Perilaku sebenarnya.** Pemeriksaan CR terjadi **saat matriks disimpan** di Tata
Kelola, bukan saat penilaian dijalankan. Matriks dengan CR lebih dari 0,1
ditolak dengan pesan dan tidak tersimpan (`lib/program-actions.ts`), sehingga
matriks yang berlaku tetap matriks sebelumnya, atau bobot bawaan sistem bila
program belum pernah memiliki matriks. Batasnya inklusif: CR tepat 0,1 diterima,
sedangkan naskah menulis "< 0,1". Saat penilaian, engine memakai matriks yang
tersimpan tanpa memeriksa ulang CR, dan setiap run mencatat CR, λmaks, dan CI
dari matriks yang dipakainya. Analisis sensitivitas dilakukan dengan menyimpan
matriks lain, menjalankan run root baru untuk jabatan yang sama, lalu
membandingkan kedua run root; perbandingan memisahkan pengaruh bobot dari
pengaruh perubahan data melalui tab Atribusi.

**Usulan kalimat pengganti.**

> Matriks perbandingan berpasangan yang baru hanya dapat disimpan bila rasio
> konsistensinya tidak melebihi 0,1. Matriks yang tidak konsisten ditolak saat
> disimpan, sehingga penilaian berikutnya tetap memakai matriks terakhir yang
> konsisten, atau bobot bawaan sistem bila program belum memiliki matriks. Setiap
> run mencatat rasio konsistensi matriks yang dipakainya. Analisis sensitivitas
> dilakukan dengan menjalankan penilaian baru (run root) memakai matriks yang
> berbeda pada jabatan yang sama, lalu membandingkan kedua run; sistem
> menghitung atribusi bertahap untuk memisahkan pengaruh perubahan bobot dari
> pengaruh perubahan data dan himpunan kandidat.

*Catatan:* bila naskah ingin mempertahankan batas ketat "< 0,1", kode perlu
diubah dari `cr > 0.1` menjadi `cr >= 0.1`. Perubahan itu tidak dilakukan pada
sesi ini karena di luar lingkup (mengubah aturan tata kelola, bukan re-run).

---

## K-10 — UC-13: isi tampilan hasil run

**Klaim naskah.** Tampilan hasil run memuat peringkat, skor, kontribusi kriteria,
aturan penyaringan, bobot dan matriks AHP, riwayat versi, dan keputusan forum.

**Status: Benar.**

**Perilaku sebenarnya.** Peringkat dan skor ada di tab Kandidat; kontribusi
kriteria terhadap D⁺ dan D⁻ per kandidat ada di "Rincian perhitungan TOPSIS per
kandidat" (tab Readiness); aturan penyaringan, bobot, dan matriks AHP 6×6 ada di
panel Snapshot run (tab Konfigurasi); riwayat versi ada di pohon run dan di
tab "Perbandingan Run"; keputusan forum tampil di daftar suksesor terpilih, di
"Rekomendasi sistem dan keputusan forum" (bagian Keputusan forum tab
"Perbandingan Run"), sebagai lencana di pohon, sebagai posisi setiap suksesor
terpilih di run A dan B pada ringkasan perbandingan, dan sebagai kolom
keputusan A dan B di tabel peringkat perbandingan.

**Usulan kalimat (mempertegas).**

> UC-13 menampilkan hasil sebuah run: peringkat dan koefisien kedekatan setiap
> kandidat, rincian kontribusi setiap kriteria terhadap jarak ke solusi ideal
> positif dan negatif, snapshot konfigurasi yang berlaku (aturan penyaringan,
> matriks AHP dan bobot akhir, jangkar, dan ambang readiness), posisi run itu
> dalam riwayat versi jabatan, serta keputusan forum yang dibuat berdasarkan run
> tersebut.

---

## K-11 — UC-14: keputusan wajib berjustifikasi

**Klaim naskah.** Keputusan wajib berjustifikasi dan disimpan ke `position_picks`.

**Status: Benar.**

**Perilaku sebenarnya.** `savePositionPickAction` menolak keputusan tanpa
justifikasi, memeriksa bahwa posisi dan run dasarnya milik business unit
pengguna, menolak pejabat posisi itu sebagai suksesornya sendiri, dan menyimpan
`run_id` run dasar keputusan. Perubahan justifikasi dicatat di log audit. Bila
kandidat terpilih bukan peringkat pertama, justifikasinya ditampilkan menonjol
sebagai "Alasan berbeda dari rekomendasi".

**Usulan kalimat (mempertegas).**

> Keputusan forum disimpan pada tabel `position_picks` bersama run yang menjadi
> dasarnya dan justifikasi yang wajib diisi. Pejabat yang sedang menduduki
> jabatan sasaran tidak dapat dipilih sebagai suksesornya sendiri. Bila kandidat
> yang dipilih bukan peringkat pertama rekomendasi sistem, justifikasi
> ditampilkan sebagai alasan perbedaan dari rekomendasi, dan setiap perubahan
> justifikasi tercatat pada jejak audit.

---

## K-12 — Tabel 2.4: Rejected, Excluded, Reconsidered dalam re-run

**Klaim naskah.** Makna kategori Rejected, Excluded, dan Reconsidered.

**Status: Perlu revisi** (perlu ditambahkan maknanya pada penilaian ulang).

**Perilaku sebenarnya.** Pada Tambah Kandidat Pembanding, kategori aturan
penyaringan run induk diterapkan kepada kandidat tambahan sebagai berikut.
Rejected (sanksi disiplin, PA, HAV, atau BA yang tidak memenuhi syarat): kandidat
tidak dapat ditambahkan dan dicatat sebagai ditolak beserta aturan yang gagal.
Excluded (grade di luar rentang posisi): kandidat dapat ditambahkan setelah
konfirmasi per kandidat, dicatat beserta aturan yang dilanggar, dan diberi
penanda "Di luar rentang grade" di setiap tampilan. Reconsidered (MCU fit
dengan catatan): kandidat dinilai seperti biasa; aturan MCU hanya menandainya
dan tidak pernah mengubah skor TOPSIS. Sebelum perubahan ini, kandidat tambahan
dimasukkan apa pun aturan yang dilanggarnya.

**Usulan kalimat tambahan setelah Tabel 2.4.**

> Pada penilaian ulang Tambah Kandidat Pembanding, kategori pada Tabel 2.4
> diterapkan kepada kandidat tambahan dengan aturan run induk. Kandidat
> berkategori Rejected tidak memenuhi syarat untuk run mana pun, sehingga tidak
> dapat ditambahkan; sistem mencatat penolakan beserta aturan yang tidak
> dipenuhi. Kandidat berkategori Excluded memenuhi syarat tetapi berada di luar
> rentang grade jabatan sasaran, sehingga baru dapat ditambahkan setelah
> dikonfirmasi satu per satu dan selalu ditandai "Di luar rentang grade".
> Kandidat berkategori Reconsidered dinilai seperti kandidat lain; temuan
> MCU-nya hanya ditandai dan tidak mengubah skor TOPSIS.

---

## K-13 — Diagram aktivitas UC-5: pemicu dan cabang penilaian ulang

**Klaim naskah.** Pemicu "re-score program, re-run, atau re-rank setelah
eksklusi", dan cabang "run turunan mode frozen".

**Status: Perlu revisi.**

**Perilaku sebenarnya.** Re-rank setelah eksklusi sudah dihapus: mengecualikan
kandidat kini hanya penandaan ("Ditandai dikecualikan, tidak memengaruhi
angka") tanpa run baru. "Scoring Ulang" program dan "Penilaian Baru" di riwayat
posisi menghasilkan run root baru, bukan run turunan. Satu-satunya cabang run
turunan adalah Tambah Kandidat Pembanding, yang selalu membekukan run induknya,
sehingga sebutan "mode frozen" tidak lagi membedakan apa pun.

**Usulan uraian pengganti untuk diagram.**

> Diagram aktivitas UC-5 memiliki dua pemicu penilaian ulang. Pemicu pertama
> adalah usulan nama oleh forum: pengguna memilih run yang sudah selesai,
> memilih kandidat pembanding, dan mengisi alasan atau permintaan forum; sistem
> memeriksa setiap kandidat terhadap aturan run induk, menolak yang tidak
> memenuhi syarat beserta alasannya, meminta konfirmasi untuk kandidat di luar
> rentang grade, lalu membuat run turunan yang hanya menilai kandidat baru. Pemicu
> kedua adalah perubahan data atau konfigurasi: pengguna menjalankan penilaian
> baru untuk jabatan yang sama, atau penilaian ulang seluruh jabatan dalam satu
> program, dan sistem membuat run root baru. Kedua cabang berakhir pada tawaran
> membandingkan run baru dengan run sebelumnya. Mengecualikan kandidat dari hasil
> sebuah run hanyalah penandaan dan tidak memicu penilaian ulang.

---

## K-14 — Tabel 3.5: NF-1 dan NF-2

**Klaim naskah.** Bagian NF-1 (informasi dapat dibawa ke arsip pengguna) dan NF-2
(keterulangan) yang dipenuhi fitur ini.

**Status: Benar.**

**Perilaku sebenarnya.** NF-1 dipenuhi oleh ekspor perbandingan ke XLSX (delapan
lembar: Ringkasan, Konfigurasi, Pool, Peringkat, Kriteria, Rincian kandidat,
Kalimat penjelasan, Atribusi; angka disimpan sebagai angka), unduhan snapshot run
dalam JSON, dan ekspor hasil run yang sudah ada. NF-2 dipenuhi dalam dua arti
yang perlu dibedakan. Pertama, keterulangan dari data tersimpan dijamin: TOPSIS
yang dihitung ulang dari skor aspek, bobot, dan kriteria aktif yang tersimpan
menghasilkan koefisien kedekatan dan peringkat yang sama dengan yang tersimpan
(selisih paling besar 10⁻⁹), yang dapat diperiksa dengan tombol "Periksa
keterulangan" atau skrip `scripts/verify-run-reproducibility.ts`. Kedua,
penilaian ulang dari nol tidak dijamin menghasilkan angka yang sama untuk bagian
yang memakai model bahasa (pendidikan), karena model bahasa tidak
deterministik; itulah alasan respons mentahnya disimpan. Dua run turunan dari
induk yang sama dengan kandidat tambahan yang sama menghasilkan angka identik
untuk kandidat lama, dan untuk kandidat baru bila aspeknya tidak memakai model
bahasa. Kalimat penjelasan perbandingan disusun dari templat tanpa model bahasa,
sehingga perbandingan yang sama selalu menghasilkan kalimat yang sama.

**Usulan kalimat (mempertegas).**

> NF-1 dipenuhi dengan ekspor perbandingan dua run ke berkas XLSX yang menyimpan
> angka sebagai angka, serta unduhan snapshot konfigurasi setiap run. NF-2
> dipenuhi dalam arti keterulangan dari data tersimpan: perhitungan ulang TOPSIS
> dari skor aspek, bobot, dan kriteria aktif yang tersimpan selalu menghasilkan
> peringkat dan koefisien kedekatan yang sama. Penilaian ulang dari nol tidak
> dijamin identik untuk aspek yang dinilai model bahasa, sehingga respons mentah
> model disimpan bersama run. Kalimat penjelasan selisih antarrun disusun secara
> deterministik dari templat, tanpa model bahasa.
