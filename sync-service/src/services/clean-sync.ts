import { execute } from "../db/postgres.js";

const TABLES_TO_CLEAN = [
  // Application tables populated by sync.
  // Deleting candidates CASCADE-deletes candidate_position_history,
  // candidate_technical_competencies, analysis_results, and position_picks.
  "candidates",

  // candidate_position_history is cascade-deleted by candidates above.

  // Sync tables — ordered roughly by dependency (child-most first).
  // sync_positions is SKIPPED because positions (master) has a NO ACTION
  // FK pointing to it, and we must not cascade-delete application data.
  // sync_company_tenant_map is SKIPPED because it is UI-managed.
  "sync_employee_positions",
  "sync_technical_competencies",
  "sync_performance_appraisals",
  "sync_disciplinary",
  "sync_education",
  "sync_employees",
  "sync_divisions",
  "sync_departments",
  "sync_position_hierarchy",
  "sync_hav",
  "sync_mcu",
  "sync_behavior_competencies",
  "sync_behavior_competency_history",
  // "sync_job_profiles",
];

const SEQUENCES_TO_RESTART = [
  "sync_employee_positions_id_seq",
  "sync_technical_competencies_id_seq",
  "sync_performance_appraisals_id_seq",
  "sync_disciplinary_id_seq",
  "sync_education_id_seq",
  "sync_employees_id_seq",
  "sync_divisions_id_seq",
  "sync_departments_id_seq",
  "sync_position_hierarchy_id_seq",
  "sync_hav_id_seq",
  "sync_mcu_id_seq",
  "sync_behavior_competencies_id_seq",
  "sync_behavior_competency_history_id_seq",
  // "sync_job_profiles_id_seq",
];

export async function cleanAllSyncData(): Promise<{ deleted: number; errors: string[] }> {
  const errors: string[] = [];
  let deleted = 0;

  for (const table of TABLES_TO_CLEAN) {
    try {
      const rows = await execute(`DELETE FROM ${table}`);
      deleted += rows;
      console.log(`[CLEAN] ${table}: ${rows} rows deleted`);
    } catch (err) {
      console.error(`[CLEAN] Failed to delete from ${table}:`, err);
      errors.push(table);
    }
  }

  for (const seq of SEQUENCES_TO_RESTART) {
    try {
      await execute(`ALTER SEQUENCE ${seq} RESTART`);
      console.log(`[CLEAN] Sequence ${seq} restarted`);
    } catch {
      // Sequence may not exist (e.g. if table uses uuid PK) — ignore
    }
  }

  return { deleted, errors };
}
