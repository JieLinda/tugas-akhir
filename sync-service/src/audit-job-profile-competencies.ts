/**
 * Report which already-extracted job profiles have a damaged competency split.
 *
 *   cd sync-service && npx tsx src/audit-job-profile-competencies.ts
 *
 * Reads `sync_job_profiles.extracted_data` and applies the SAME reconciliation
 * the sync now applies at write time, then reports what it WOULD change. It
 * writes nothing — re-extraction is a separate, deliberate act
 * (`npm run cli -- job-profiles --force`), because it costs a vision-model call
 * per document.
 *
 * This exists because the damage is otherwise invisible: the detail page drops a
 * non-string silently, and a missing level becomes a plausible `2` inside the
 * scoring engine. "The extraction is broken sometimes" is not actionable; a list
 * of file names is.
 */
import { query, closePool } from "./db/postgres.js";
import {
  loadKamusNameKeys,
  reconcileCompetencies,
  normalizeCompetencyName,
  isKnownBehavioral,
} from "./services/job-profile-competencies.js";

type Row = {
  id: number;
  file_name: string;
  position_name: string | null;
  status: string;
  extracted_data: unknown;
};

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

async function main() {
  const kamusKeys = await loadKamusNameKeys();
  console.log(`Kamus teknis: ${kamusKeys.size} nama\n`);

  const rows = await query<Row>(
    `SELECT id, file_name, position_name, status, extracted_data
       FROM sync_job_profiles
      WHERE extracted_data IS NOT NULL
      ORDER BY file_name`,
  );

  let clean = 0;
  const affected: { file: string; issues: string[] }[] = [];
  const totals = new Map<string, number>();
  const bump = (k: string, n = 1) => totals.set(k, (totals.get(k) ?? 0) + n);

  for (const row of rows) {
    const data = (row.extracted_data ?? {}) as Record<string, unknown>;
    const rawBeh = asArray(data.behavioralCompetencies);
    const rawTech = asArray(data.technicalCompetencies);
    const issues: string[] = [];

    // Objects in the behavioural list are the unambiguous fingerprint of a
    // side-by-side row read: the UI drops these entirely, so they are invisible
    // damage rather than a wrong value on screen.
    const objectsInBehavioral = rawBeh.filter((x) => x && typeof x === "object").length;
    if (objectsInBehavioral > 0) {
      issues.push(`${objectsInBehavioral} objek di behavioralCompetencies (hilang di layar)`);
      bump("objects-in-behavioral", objectsInBehavioral);
    }

    // Behavioural names sitting among the technical competencies.
    const behavioralInTech = rawTech.filter((x) => {
      const n = typeof x === "string" ? x : String((x as Record<string, unknown>)?.competency ?? "");
      return n && isKnownBehavioral(n);
    }).length;
    if (behavioralInTech > 0) {
      issues.push(`${behavioralInTech} kompetensi perilaku di technicalCompetencies`);
      bump("behavioral-in-technical", behavioralInTech);
    }

    // Kamus (technical) names sitting among the behavioural competencies.
    const techInBehavioral = rawBeh.filter((x) => {
      const n = typeof x === "string" ? x : String((x as Record<string, unknown>)?.competency ?? "");
      return n && kamusKeys.has(normalizeCompetencyName(n));
    }).length;
    if (techInBehavioral > 0) {
      issues.push(`${techInBehavioral} kompetensi teknis (ada di kamus) di behavioralCompetencies`);
      bump("technical-in-behavioral", techInBehavioral);
    }

    // Missing levels. Every one of these is currently scoring as level 2.
    const reconciled = reconcileCompetencies(rawBeh, rawTech, kamusKeys);
    const missingLevel = reconciled.technical.filter((t) => t.level == null).length;
    if (missingLevel > 0) {
      issues.push(`${missingLevel} kompetensi teknis tanpa level (dinilai sebagai 2)`);
      bump("missing-level", missingLevel);
    }

    if (rawTech.length === 0 && row.status === "completed") {
      issues.push("technicalCompetencies KOSONG");
      bump("empty-technical");
    }

    if (issues.length === 0) clean++;
    else affected.push({ file: `${row.file_name}${row.position_name ? ` — ${row.position_name}` : ""}`, issues });
  }

  console.log(`${rows.length} profil diperiksa: ${clean} bersih, ${affected.length} bermasalah\n`);

  if (affected.length > 0) {
    console.log("PROFIL YANG PERLU DIEKSTRAK ULANG");
    console.log("=".repeat(70));
    for (const a of affected) {
      console.log(`\n  ${a.file}`);
      for (const i of a.issues) console.log(`    · ${i}`);
    }
    console.log("\n" + "=".repeat(70));
    console.log("\nRINGKASAN");
    for (const [k, n] of [...totals.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${k.padEnd(26)} ${n}`);
    }
    console.log(
      "\nEkstrak ulang dengan:  npm run cli -- job-profiles --force" +
        "\n(satu panggilan vision-model per dokumen — jalankan saat jam sepi)",
    );
  }

  await closePool();
  process.exit(0);
}

main().catch(async (err) => {
  console.error("Audit gagal:", err instanceof Error ? err.message : String(err));
  await closePool().catch(() => {});
  process.exit(1);
});
