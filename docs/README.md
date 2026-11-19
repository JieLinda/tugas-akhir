# Folder docs

Dokumen di folder ini ditulis dalam Markdown. Berkas `.md` adalah sumber
kebenarannya; berkas `.docx` di sampingnya hanyalah salinan untuk pembaca yang
bekerja di Word.

## Salinan Word (.docx)

| Dokumen | Salinan Word | Status salinan |
|---|---|---|
| `kebutuhan-fungsional.md` | `kebutuhan-fungsional.docx` | Dibuat ulang dari `.md` pada 17 November 2026 (versi 1.6) |
| `alur-proses-scoring.md` | `alur-proses-scoring.docx` | Dibuat ulang dari `.md` pada 17 November 2026 (versi 1.5) |
| `panduan-pengguna-sop.md` | `panduan-pengguna-sop.docx` | Dibuat ulang dari `.md` pada 18 November 2026 (versi 1.6) |
| `arsitektur-sistem.md` | `arsitektur-sistem.docx` | Dibuat ulang dari `.md` pada 18 November 2026 (versi 1.6) |

Dokumen lain tidak memiliki salinan Word.

**Aturan.** Setiap kali sebuah `.md` yang memiliki salinan Word diubah, buat
ulang salinannya dalam commit yang sama:

```bash
npx tsx scripts/docs-to-docx.ts docs/kebutuhan-fungsional.md docs/alur-proses-scoring.md docs/panduan-pengguna-sop.md docs/arsitektur-sistem.md
```

Skrip itu memakai pustaka `docx` yang sudah menjadi dependensi aplikasi, dengan
gaya yang sama dengan salinan sebelumnya: Calibri 10,5 pt pada A4, judul biru
tua, daftar isi dari judul `##` dan `###`, tabel dengan baris kepala berwarna dan
baris berselang, kotak kode monospace, serta footer berisi judul dokumen dan
nomor halaman. Bila sebuah salinan Word tidak dibuat ulang, tandai di tabel di
atas sebagai **kedaluwarsa** beserta tanggal `.md` terakhir diubah, agar tidak
ada yang membaca versi lama tanpa sadar.

## Dokumen penilaian ulang dan perbandingan run

| Dokumen | Isi |
|---|---|
| `rerun-modes-inventory.md` | Kondisi lima mode re-run sebelum perombakan, verifikasi lampiran inventaris, dan kueri audit baca-saja (9.1–9.4 dan Q5–Q8). Rujukannya ke run dan induk AI Tournament (LLM) menggambarkan masa itu; metode itu dihapus pada 17 November 2026 |
| `rerun-requirements-audit.md` | Status setiap kebutuhan re-run dan perbandingan run, dari audit awal (Fase A) sampai status akhir (Fase E, §6), beserta durasi terukur |
| `rerun-explanation-templates.md` | Katalog kalimat penjelasan perbandingan T-01 sampai T-11, contoh, dan ambang penyebutannya |
| `ta-sync-rerun.md` | Sinkronisasi klaim naskah tugas akhir (K-01 sampai K-14) dengan perilaku kode, beserta kalimat pengganti dan Tabel 3.4 pengganti |
| `screenshots/rerun/` | Tangkapan layar verifikasi browser (Playwright, database lokal berfixture) yang dirujuk dokumen audit |

## Mode aplikasi

| Dokumen | Isi |
|---|---|
| `mode-demo.md` | Mode demo dan mode asli: cara beralih lewat kata kunci URL, Edit / Turnoff / Reload kandidat, pemisahan run dan keputusan, apa yang disamarkan, apa yang ditolak, dan urutan deploy |
