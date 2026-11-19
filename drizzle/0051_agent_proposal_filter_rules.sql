-- Domain usulan baru: aturan filter kelayakan program.
--
-- Aturan filter menentukan siapa yang BOLEH dinilai (hard disqualifier);
-- kriteria & bobot menentukan URUTAN. Keduanya sering disamakan user dalam satu
-- kalimat ("utamakan relevansi karier"), jadi agent perlu domain terpisah agar
-- usulannya menyasar hal yang benar — dan agar penolakannya terbaca jelas saat
-- ia menyasar yang keliru.
--
-- Idempoten: aman dijalankan ulang.
--   tsx scripts/apply-sql.ts drizzle/0051_agent_proposal_filter_rules.sql

ALTER TABLE agent_config_proposals
  DROP CONSTRAINT IF EXISTS agent_config_proposals_domain_check;
--> statement-breakpoint

ALTER TABLE agent_config_proposals
  ADD CONSTRAINT agent_config_proposals_domain_check
  CHECK (domain IN ('bertopic', 'ahp_weights', 'readiness', 'scoring_prompt', 'program_criteria', 'program_filter_rules'));
