-- Domain usulan baru: template restrukturisasi dokumen job profile.
--
-- Mekanismenya sudah ada di aplikasi (override template per-dokumen pada
-- konfigurasi Job Family), tetapi hanya dapat disunting satu per satu lewat UI.
-- Usulan memungkinkan agent memilih sekumpulan dokumen menurut rumpun/kata
-- kunci dan menyusun templatenya sekaligus — tetap sebagai usulan, karena
-- restrukturisasi mengubah dokumen yang dipakai penilaian teknis, relevansi
-- karier, DAN pengelompokan job family.
--
-- Idempoten: aman dijalankan ulang.
--   tsx scripts/apply-sql.ts drizzle/0052_agent_proposal_restructure.sql

ALTER TABLE agent_config_proposals
  DROP CONSTRAINT IF EXISTS agent_config_proposals_domain_check;
--> statement-breakpoint

ALTER TABLE agent_config_proposals
  ADD CONSTRAINT agent_config_proposals_domain_check
  CHECK (domain IN ('bertopic', 'ahp_weights', 'readiness', 'scoring_prompt', 'program_criteria', 'program_filter_rules', 'restructure_template'));
