-- Menyimpan keterangan medis yang selama ini dibuang.
--
-- `sync_mcu` hanya menyimpan satu kata: fit / fit_with_note / unfit. Prosa yang
-- dikirim HR di kolom "Kesimpulan" dimampatkan menjadi token itu oleh
-- normalizeMcuStatus() lalu hilang. Templat MCU sendiri sudah menyatakan prosa
-- diterima — petunjuknya mencontohkan "FIT (dengan note tekanan darah)" —
-- sehingga "tekanan darah" memang dikirim, dibaca, dan dibuang.
--
-- Lapisan Keyakinan Penempatan perlu membandingkan kondisi medis dengan
-- tuntutan pekerjaan pada job profile. Tanpa teks itu tidak ada yang bisa
-- dibandingkan, dan model hanya akan menebak dari kata "unfit" — persis jenis
-- tebakan yang di repo ini selalu ditolak (bandingkan AI_MATCH_MIN_CONFIDENCE
-- dan aturan "job profile yang salah lebih buruk daripada tidak ada").
--
-- DUA kolom di sisi kandidat, bukan satu, dan itu disengaja:
--
--   mcu_note        berasal dari sinkronisasi. Ditimpa tiap Senin 01:00.
--   mcu_note_manual diisi manusia lewat halaman Kandidat. TIDAK PERNAH disentuh
--                   sinkronisasi, karena cron tanpa pengawasan yang menimpa
--                   keterangan yang diketik orang adalah cara paling senyap
--                   untuk menghilangkan satu-satunya sumber data yang ada.
--
-- Pembacanya memilih manual lebih dulu dan MENYEBUTKAN sumber mana yang dipakai,
-- mengikuti kebiasaan `displayRaw`-nya mesin AHP (`from: 'base_run' | 'live'`):
-- satu nilai yang tidak mengaku dari mana asalnya adalah nilai yang tidak bisa
-- diperiksa.
--
-- Kedua kolom kandidat DIENKRIPSI (envelope AES-256-GCM, lihat
-- lib/crypto/envelope.ts) seperti mcu_status. Ini keterangan medis atas nama
-- orang — kolom paling sensitif di aplikasi ini. `text`, bukan varchar, karena
-- panjangnya tidak diketahui dan ciphertext jauh lebih panjang dari plaintext.
--
-- `sync_mcu` sendiri tetap plaintext, mengikuti seluruh tabel `sync_*` di repo
-- ini (termasuk disciplinary_records, yang setara sensitif). Enkripsi terjadi
-- saat data masuk `candidates`, yang merupakan chokepoint tunggalnya.
--
-- Idempoten: aman dijalankan ulang.
--   tsx scripts/apply-sql.ts drizzle/0072_mcu_medical_note.sql

-- Verbatim dari kolom "Kesimpulan" — termasuk baris yang statusnya tidak
-- terbaca, supaya "kenapa orang ini tidak punya status" bisa dijawab dengan
-- melihat apa yang sebenarnya tertulis.
ALTER TABLE sync_mcu
  ADD COLUMN IF NOT EXISTS kesimpulan_raw text;
--> statement-breakpoint

-- Kolom terpisah dan opsional pada templat, untuk keterangan yang lebih panjang
-- daripada yang pantas ditulis di sel kesimpulan.
ALTER TABLE sync_mcu
  ADD COLUMN IF NOT EXISTS keterangan text;
--> statement-breakpoint

ALTER TABLE candidates
  ADD COLUMN IF NOT EXISTS mcu_note text;
--> statement-breakpoint

ALTER TABLE candidates
  ADD COLUMN IF NOT EXISTS mcu_note_manual text;
