# Ringkasan data demo

> Berkas ini DIBUAT OTOMATIS oleh `demo-data/generate.py` dari `generator/dataset.py`. Jangan diedit
> manual; ubah datasetnya lalu jalankan ulang generator.

Tanggal acuan: **2026-11-18** — tahun PA yang dibaca sinkronisasi Kandidat adalah 2023-2025.

| Angka | Nilai |
|---|---|
| Karyawan (NPK 99001-99046) | 46 |
| Posisi (aktif / jabatan lama) | 39 / 1 |
| Divisi / departemen | 5 / 8 |
| Lolos aturan disiplin = populasi peta Talent Mapping | 43 |
| Belum terpetakan (tanpa HAV) | 4 (99008, 99009, 99019, 99039) |
| Lolos Talent Pool (aturan bawaan program Talent Pool) | 25 |
| HAV dari unggahan (12-hav-quadrant.xlsx) | 13 |

Kolom *PA* ditulis seperti `performance_grade` kandidat: enam periode, terbaru dulu (2025 S2, 2025 S1, 2024 S2, …). *HAV rumus* = PA × assessment perilaku (`lib/hav-quadrant-derive.ts`); *HAV berlaku* = unggahan bila ada, selain itu rumus. Kolom *Talent Pool* memakai aturan bawaan program Talent Pool; bila aturan di Tata Kelola sudah diubah, hasilnya ikut berubah.

| NPK | Nama | Jabatan saat ini | Grade | Masa kerja | PA | Assessment perilaku | HAV rumus | HAV unggahan | HAV berlaku | Disiplin | MCU | Talent Pool | Yang diperagakan |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 99001 | Hendra Wijaya | Sales & Marketing Division Head | 10 | 23 th | `A,A,B,A,A,A` | STRENGTH | 1 | 1 | 1 | CLEAR | Fit With Note | Lolos | Division head berkinerja puncak; HAV unggahan = rumus (Q1). |
| 99002 | Rina Kusumawati | Retail Sales Department Head | 8 | 18 th | `B,A,A,B,B,B` | VERY HIGH | 2 | 2 | 2 | CLEAR | Fit | Lolos | Karier naik dari Sales Counter -> Area Sales Supervisor -> Dept Head (3 baris riwayat jabatan). |
| 99003 | Agus Setiawan | Area Sales Supervisor Surabaya | 6 | 14 th | `A,A,A,A,A,B` | STRENGTH | 1 | — | 1 | CLEAR | Fit | Lolos | Supervisor bintang; HAV dari rumus (Q1). Punya 2 baris assessment -> yang terbaru dipakai. |
| 99004 | Dewi Paramitha | Area Sales Supervisor Malang | 5 | 11 th | `B,C,C,B,B,B` | PENGEMBANGAN JANGKA PENDEK | 3 | — | 3 | CLEAR | Fit | Lolos | PA terakhir B+C -> Mid High; BA Mid High -> Q3 (lolos Talent Pool). |
| 99005 | Fajar Nugroho | Sales Counter Staff Surabaya | 2 | 7 th | `C,B,B,B,B,B` | READY | 8 | — | 8 | CLEAR | Fit | Tidak | Q8 (BA Mid Low x PA Mid High): masuk peta, tidak lolos Talent Pool. |
| 99006 | Siti Rahmawati | Sales Counter Staff Surabaya | 2 | 5 th | `C,B,A,B,B,B` | NEED TARGETED DEVELOPMENT | 8 | — | 8 | CLEAR | Fit | Tidak | Pemegang kedua kursi Sales Counter Surabaya (jabatan multi-pemegang). Q8. |
| 99007 | Yoga Prasetyo | Sales Counter Staff Malang | 2 | 9 th | `C,C,C,C,C,C` | MIDDLE LOW | 15 | — | 15 | CLEAR | Fit With Note | Tidak | PA C semua (tanpa A/B) dan BA Low -> Q15. Tidak lolos Talent Pool. |
| 99008 | Nanda Putri Maharani | Sales Counter Staff Malang | 2 | 0 th | `—` | — | — | — | — | CLEAR | — (bawaan fit) | Tidak | Karyawan baru: belum ada PA, BA, maupun MCU -> 'Belum terpetakan' di Talent Mapping. |
| 99009 | Bayu Saputra | Sales Administration Staff | 3 | 10 th | `B,B,B,B,B,B` | — | — | — | — | CLEAR | Fit | Tidak | PA lengkap (High) tetapi belum pernah assessment perilaku -> belum terpetakan. |
| 99010 | Indra Gunawan | Marketing Communication Department Head | 7 | 17 th | `B,B,B,B,B,A` | HIGH | 7 | 4 | 4 | CLEAR | Fit With Note | Lolos | Rumus memberi Q7, HR mengkalibrasi ke Q4 lewat unggahan HAV -> unggahan yang berlaku. |
| 99011 | Maya Anggraini | Marketing Communication Supervisor | 5 | 12 th | `A,B,B,A,A,A` | VERY HIGH | 2 | 2 | 2 | CLEAR | Fit | Lolos | Kandidat suksesor kuat (Q2). |
| 99012 | Rizky Ramadhan | Digital Marketing Officer | 3 | 6 th | `A,A,A,A,A,B` | POTENSI | 7 | — | 7 | CLEAR | Fit | Lolos | Staf muda berkinerja tinggi (Q7) -> lolos Talent Pool. |
| 99013 | Lia Permata Sari | Event & Promotion Officer | 3 | 8 th | `B,C,C,C,C,B` | NEED TARGETED DEVELOPMENT | 8 | — | 8 | ST | Fit | Tidak | Punya Surat Teguran (warning level 1 = ST): tetap memenuhi aturan disiplin. Q8. |
| 99014 | Wahyu Hidayat | Finance & Accounting Division Head | 10 | 25 th | `B,A,A,A,A,A` | STRENGTH | 1 | 1 | 1 | CLEAR | Fit | Lolos | Naik ke Division Head; kursi lamanya (Treasury & Tax Dept Head) kini KOSONG. |
| 99015 | Ratna Sari Dewi | Accounting Department Head | 8 | 20 th | `B,C,B,B,B,B` | READY WITH DEVELOPMENT | 8 | — | 8 | CLEAR | Fit | Tidak | Plt. Treasury & Tax Dept Head (baris PRIMARY_POSITION = N). Q8. |
| 99016 | Eko Purnomo | Accounting Supervisor | 6 | 15 th | `A,B,B,B,B,A` | PENGEMBANGAN JANGKA PENDEK | 2 | — | 2 | CLEAR | Unfit | Lolos | MCU Unfit -> hanya DITANDAI (aturan MCU bersifat advisory), tetap lolos Talent Pool (Q2). |
| 99017 | Putri Ayu Ningsih | Accounting Staff | 3 | 11 th | `C,C,B,A,B,B` | MIDDLE HIGH | 9 | — | 9 | CLEAR | Fit | Tidak | PA terakhir C+C -> Mid Low; BA Mid Low -> Q9. |
| 99018 | Dimas Aditya | Accounting Staff | 3 | 7 th | `C,B,C,D,C,C` | BUTUH PENGEMBANGAN | 12 | — | 12 | SP_UNDER_2_YEARS | Fit | Tidak | SP berakhir < 2 tahun lalu -> SP_UNDER_2_YEARS: gugur aturan disiplin dan TIDAK masuk peta Talent Mapping. |
| 99019 | Anisa Fitriani | Accounts Payable Staff | 2 | 4 th | `A,B,B,B,B,B` | — | — | — | — | CLEAR | Fit | Tidak | Belum pernah assessment perilaku -> belum terpetakan; masa kerja < 5 tahun. |
| 99020 | Hadi Santoso | Tax Supervisor | 5 | 13 th | `C,C,B,B,B,B` | HIGH | 9 | — | 9 | CLEAR | Fit | Tidak | Supervisor dengan PA terakhir C+C -> Q9; tidak lolos program suksesi. |
| 99021 | Arief Kurniawan | Treasury Staff | 3 | 9 th | `B,B,C,B,B,B` | MIDDLE HIGH | 7 | — | 7 | CLEAR | Fit | Lolos | SP lama yang berakhir > 2 tahun lalu -> CLEAR; tetap lolos Talent Pool (Q7). |
| 99022 | Sri Astuti | Human Capital Division Head | 9 | 22 th | `B,B,A,A,B,A` | VERY HIGH | 2 | 2 | 2 | CLEAR | Fit | Lolos | Division head (Q2). |
| 99023 | Bambang Supriyadi | People Development Department Head | 7 | 16 th | `B,B,B,B,B,B` | READY | 7 | 7 | 7 | CLEAR | Fit With Note | Lolos | HAV unggahan sama dengan rumus (Q7): unggah ulang tidak dihitung sebagai perubahan. |
| 99024 | Novi Handayani | Learning & Development Supervisor | 5 | 12 th | `A,A,A,B,A,A` | STRENGTH | 1 | — | 1 | CLEAR | Fit | Lolos | Supervisor bintang (Q1) - kandidat kuat untuk People Development Dept Head. |
| 99025 | Fadli Rahman | Learning & Development Officer | 3 | 7 th | `C,B,B,B,B,B` | LOW | 14 | — | 14 | CLEAR | Fit | Tidak | BA Low x PA Mid High -> Q14. |
| 99026 | Dian Puspitasari | Talent Management Officer | 4 | 10 th | `B,A,A,A,B,A` | PENGEMBANGAN JANGKA PENDEK | 2 | — | 2 | CLEAR | Fit | Lolos | Staf siap promosi (Q2). |
| 99027 | Teguh Wibowo | Information Technology Division Head | 10 | 21 th | `A,A,B,A,B,B` | STRENGTH | 1 | 1 | 1 | CLEAR | Fit With Note | Lolos | Division head (Q1). |
| 99028 | Yudi Hartono | IT Application Development Department Head | 8 | 17 th | `B,A,A,B,A,A` | HIGH | 7 | 4 | 4 | CLEAR | Fit | Lolos | Pernah menjabat 'Programmer' (jabatan lama, VALID_TO 2021). Rumus Q7, unggahan Q4. |
| 99029 | Galih Pratama | IT Application Development Supervisor | 6 | 13 th | `A,B,A,A,B,A` | VERY HIGH | 2 | — | 2 | CLEAR | Fit | Lolos | Suksesor terkuat untuk IT Application Development Dept Head (Q2). |
| 99030 | Andika Wirawan | IT Application Development Analyst | 4 | 10 th | `B,A,B,B,B,B` | READY | 7 | — | 7 | CLEAR | Fit | Lolos | Analis (Q7) -> lolos Talent Pool. |
| 99031 | Citra Melati | IT Application Development Analyst | 4 | 8 th | `C,C,B,C,C,B` | POTENSI | 9 | — | 9 | CLEAR | Fit | Tidak | PA terakhir C+C -> Q9. |
| 99032 | Reza Firmansyah | IT Application Development Analyst | 4 | 3 th | `A,A,A,A,B,B` | STRENGTH | 1 | — | 1 | CLEAR | Fit | Lolos | Q1 tetapi masa kerja < 5 tahun: lolos Talent Pool, gugur aturan masa kerja Critical Position. |
| 99033 | Fikri Maulana | System Integrator Analyst | 4 | 9 th | `B,B,A,B,B,B` | MIDDLE HIGH | 7 | — | 7 | SP3 | Fit | Tidak | Pindah lintas fungsi (Accounting -> IT). Kinerja baik (Q7) tetapi SP3 -> gugur disiplin, keluar dari peta. |
| 99034 | Joko Susilo | After Sales Service Division Head | 9 | 24 th | `B,C,B,B,B,B` | READY | 8 | — | 8 | CLEAR | Fit | Tidak | Division head Q8. |
| 99035 | Sugeng Riyadi | Technical Service Department Head | 7 | 19 th | `C,C,C,B,B,C` | FOCUS ON OPTIMIZATION IN CURRENT POSITION | 15 | — | 15 | CLEAR | Unfit | Tidak | Dept head Q15 dan MCU Unfit (ditandai saja). |
| 99036 | Wulan Kartika | Service Quality Supervisor | 6 | 14 th | `B,C,B,B,B,A` | STRENGTH | 4 | — | 4 | CLEAR | Fit | Lolos | BA High x PA Mid High -> Q4. |
| 99037 | Taufik Nurhadi | Technical Instructor | 3 | 12 th | `B,B,B,B,B,B` | NOT READY | 13 | — | 13 | CLEAR | Fit | Tidak | BA 'NOT READY' (kategori terbawah) -> gugur aturan Behavior walau PA bagus (Q13). |
| 99038 | Rudi Hermawan | Technical Instructor | 3 | 6 th | `C,E,C,D,C,C` | BELUM ADA POTENSI | 16 | 16 | 16 | CLEAR | Fit | Tidak | PA D/E dan BA terbawah -> Q16 (Bottom), gugur aturan HAV dan Behavior. |
| 99039 | Lukman Suryadi | Warranty Claim Officer | 3 | 14 th | `—` | READY | — | — | — | CLEAR | Fit | Tidak | PA hanya ada sampai 5 tahun lalu (di luar jendela 3 tahun) -> belum terpetakan; antrean menunjukkan PA lama. |
| 99040 | Bagus Haryanto | Spare Parts Department Head | 7 | 18 th | `B,B,B,B,A,B` | PENGEMBANGAN JANGKA PENDEK | 2 | 3 | 3 | CLEAR | Fit | Lolos | Rumus Q2, HR mengkalibrasi turun ke Q3 lewat unggahan. |
| 99041 | Yuliana Safitri | Spare Parts Planning Supervisor | 5 | 13 th | `B,B,B,A,B,B` | READY | 7 | — | 7 | CLEAR | Fit | Lolos | Naik dari Warehouse Staff ke Supervisor (Q7). |
| 99042 | Doni Saputro | Warehouse Staff | 2 | 7 th | `C,B,B,B,B,C` | MIDDLE LOW | 14 | — | 14 | ACTIVE_SP | Fit | Tidak | SP masih berlaku (ACTIVE_SP) -> gugur aturan disiplin, keluar dari peta. |
| 99043 | Ahmad Fauzi | Sales Operation Supervisor | 6 | 15 th | `A,A,B,A,A,A` | VERY HIGH | 2 | Kuadran 2 | 2 | CLEAR | Fit | Lolos | HAV ditulis 'Kuadran 2' (teks): sistem mengambil angkanya -> Q2. |
| 99044 | Ika Wulandari | Service Training Supervisor | 5 | 11 th | `B,C,B,B,B,B` | READY WITH DEVELOPMENT | 8 | 7 | 7 | CLEAR | Fit | Lolos | Rumus Q8 (tidak lolos), HR mengkalibrasi ke Q7 -> lolos Talent Pool karena unggahan HAV. |
| 99045 | Sandi Gunadi | Warehouse Staff | 2 | 3 th | `B,B,B,B,C,` | VERY LOW | 13 | — | 13 | CLEAR | — (bawaan fit) | Tidak | BA 'VERY LOW' (kategori terbawah) -> gugur aturan Behavior; belum ada MCU (status default Fit). |
| 99046 | Mega Anjani | Learning & Development Officer | 3 | 2 th | `B,A,B,,,` | POTENSI | 7 | — | 7 | CLEAR | Fit | Lolos | Karyawan 2 tahun (Q7): lolos Talent Pool, belum memenuhi masa kerja Critical Position. |

## Posisi

| POSITION_ID | Jabatan | Grade | Atasan | Pemegang saat ini | Job profile demo |
|---|---|---|---|---|---|
| DM01000001 | Sales & Marketing Division Head | 10 | — (puncak) | Hendra Wijaya (99001) |  |
| DM01010001 | Retail Sales Department Head | 8 | Sales & Marketing Division Head | Rina Kusumawati (99002) | JD-DMO-003 |
| DM01010011 | Area Sales Supervisor Surabaya | 6 | Retail Sales Department Head | Agus Setiawan (99003) |  |
| DM01010012 | Area Sales Supervisor Malang | 5 | Retail Sales Department Head | Dewi Paramitha (99004) |  |
| DM01010013 | Sales Operation Supervisor | 6 | Retail Sales Department Head | Ahmad Fauzi (99043) |  |
| DM01010021 | Sales Counter Staff Surabaya | 2 | Area Sales Supervisor Surabaya | Fajar Nugroho (99005), Siti Rahmawati (99006) |  |
| DM01010022 | Sales Administration Staff | 3 | Sales Operation Supervisor | Bayu Saputra (99009) |  |
| DM01010023 | Sales Counter Staff Malang | 2 | Area Sales Supervisor Malang | Yoga Prasetyo (99007), Nanda Putri Maharani (99008) |  |
| DM01020001 | Marketing Communication Department Head | 7 | Sales & Marketing Division Head | Indra Gunawan (99010) |  |
| DM01020011 | Marketing Communication Supervisor | 5 | Marketing Communication Department Head | Maya Anggraini (99011) |  |
| DM01020021 | Digital Marketing Officer | 3 | Marketing Communication Supervisor | Rizky Ramadhan (99012) |  |
| DM01020022 | Event & Promotion Officer | 3 | Marketing Communication Supervisor | Lia Permata Sari (99013) |  |
| DM02000001 | Finance & Accounting Division Head | 10 | — (puncak) | Wahyu Hidayat (99014) |  |
| DM02030001 | Accounting Department Head | 8 | Finance & Accounting Division Head | Ratna Sari Dewi (99015) |  |
| DM02030011 | Accounting Supervisor | 6 | Accounting Department Head | Eko Purnomo (99016) |  |
| DM02030021 | Accounting Staff | 3 | Accounting Supervisor | Putri Ayu Ningsih (99017), Dimas Aditya (99018) |  |
| DM02030022 | Accounts Payable Staff | 2 | Accounting Supervisor | Anisa Fitriani (99019) |  |
| DM02040001 | Treasury & Tax Department Head | 7 | Finance & Accounting Division Head | **KOSONG** — Plt. Ratna Sari Dewi (99015) | JD-DMO-002 |
| DM02040011 | Tax Supervisor | 5 | Treasury & Tax Department Head | Hadi Santoso (99020) |  |
| DM02040021 | Treasury Staff | 3 | Treasury & Tax Department Head | Arief Kurniawan (99021) |  |
| DM03000001 | Human Capital Division Head | 9 | — (puncak) | Sri Astuti (99022) |  |
| DM03050001 | People Development Department Head | 7 | Human Capital Division Head | Bambang Supriyadi (99023) | JD-DMO-004 |
| DM03050011 | Learning & Development Supervisor | 5 | People Development Department Head | Novi Handayani (99024) |  |
| DM03050021 | Learning & Development Officer | 3 | Learning & Development Supervisor | Fadli Rahman (99025), Mega Anjani (99046) |  |
| DM03050022 | Talent Management Officer | 4 | Learning & Development Supervisor | Dian Puspitasari (99026) |  |
| DM04000001 | Information Technology Division Head | 10 | — (puncak) | Teguh Wibowo (99027) |  |
| DM04060001 | IT Application Development Department Head | 8 | Information Technology Division Head | Yudi Hartono (99028) | JD-DMO-001 |
| DM04060011 | IT Application Development Supervisor | 6 | IT Application Development Department Head | Galih Pratama (99029) | JD-DMO-006 |
| DM04060021 | IT Application Development Analyst | 4 | IT Application Development Supervisor | Andika Wirawan (99030), Citra Melati (99031), Reza Firmansyah (99032) |  |
| DM04060022 | System Integrator Analyst | 4 | IT Application Development Supervisor | Fikri Maulana (99033) |  |
| DM04060099 | Programmer | 3 | IT Application Development Supervisor | — (jabatan lama, berlaku s.d. 2021-12-31) |  |
| DM05000001 | After Sales Service Division Head | 9 | — (puncak) | Joko Susilo (99034) |  |
| DM05070001 | Technical Service Department Head | 7 | After Sales Service Division Head | Sugeng Riyadi (99035) |  |
| DM05070011 | Service Quality Supervisor | 6 | Technical Service Department Head | Wulan Kartika (99036) |  |
| DM05070012 | Service Training Supervisor | 5 | Technical Service Department Head | Ika Wulandari (99044) |  |
| DM05070021 | Technical Instructor | 3 | Service Training Supervisor | Taufik Nurhadi (99037), Rudi Hermawan (99038) |  |
| DM05070022 | Warranty Claim Officer | 3 | Service Quality Supervisor | Lukman Suryadi (99039) |  |
| DM05080001 | Spare Parts Department Head | 7 | After Sales Service Division Head | Bagus Haryanto (99040) | JD-DMO-005 |
| DM05080011 | Spare Parts Planning Supervisor | 5 | Spare Parts Department Head | Yuliana Safitri (99041) |  |
| DM05080021 | Warehouse Staff | 2 | Spare Parts Planning Supervisor | Doni Saputro (99042), Sandi Gunadi (99045) |  |

## Kompetensi teknis (kamus demo)

| Kode di kamus demo | Nama | Dipakai di 06-kompetensi-teknis.xlsx |
|---|---|---|
| TC 901 | MOTORCYCLE RETAIL SALES PLANNING | 10 baris |
| TC 902 | DEALER NETWORK RELATIONSHIP MANAGEMENT | 9 baris |
| TC 903 | INTEGRATED MARKETING CAMPAIGN PLANNING | 4 baris |
| TC 904 | FINANCIAL CLOSING AND REPORTING | 8 baris |
| TC 905 | CORPORATE TAX COMPLIANCE | 4 baris |
| TC 906 | TREASURY AND CASH FLOW MANAGEMENT | 3 baris |
| TC 907 | LEARNING PROGRAM DESIGN AND EVALUATION | 8 baris |
| TC 908 | TALENT REVIEW AND SUCCESSION PLANNING | 4 baris |
| TC 909 | APPLICATION DEVELOPMENT LIFE CYCLE | 7 baris |
| TC 910 | ENTERPRISE SYSTEM INTEGRATION | 4 baris |
| TC 911 | MOTORCYCLE SERVICE QUALITY ASSURANCE | 7 baris |
| TC 912 | SPARE PART DEMAND AND INVENTORY PLANNING | 5 baris |
| TC 913 | OPERATIONAL BUDGET PLANNING AND CONTROL | 13 baris |
| TC 914 | BUSINESS DATA ANALYSIS AND REPORTING | 24 baris |
