import cron from "node-cron";
import { config } from "./config.js";
import { runFullSync } from "./routes/sync.js";
import { finishRun, startRun } from "./services/sync-audit.js";

let task: cron.ScheduledTask | null = null;

export function startScheduler() {
  if (!config.sourceSyncEnabled) {
    console.log("[SCHEDULER] Weekly sync NOT registered: SOURCE_SYNC_ENABLED=false");
    return;
  }
  const expression = config.syncCronExpression;

  if (!cron.validate(expression)) {
    console.error(`[SCHEDULER] Invalid cron expression: ${expression}`);
    return;
  }

  task = cron.schedule(
    expression,
    async () => {
      console.log("[SCHEDULER] Starting scheduled full sync");
      // Cron bypasses Express, so it records its own run row.
      const runId = await startRun({ jobKey: "all", triggerSource: "cron" });
      try {
        const result = await runFullSync();
        await finishRun(runId, {
          status: "success",
          synced: result.candidates?.synced ?? null,
          message: `Cron full sync: emp=${result.employees.synced} cands=${result.candidates.synced} jp=${result.jobProfiles.synced}`,
        });
        console.log(
          `[SCHEDULER] Complete – emp=${result.employees.synced} pos=${result.positionMaster.synced} hier=${result.positionHierarchy.synced} empPos=${result.employeePositions.synced} tech=${result.technicalCompetencies.synced} popPos=${result.positionsPopulated.synced} perf=${result.performance.synced} disc=${result.disciplinary.synced} edu=${result.education.synced} cands=${result.candidates.synced} jp=${result.jobProfiles.synced} grd=${result.gradeLevels.synced} bhv=${result.behaviorCompetencies.synced}`
        );
      } catch (err) {
        console.error("[SCHEDULER] Scheduled sync failed:", err);
        await finishRun(runId, { status: "failed", error: String(err) });
      }
    },
    { timezone: "Asia/Jakarta" }
  );

  console.log(`[SCHEDULER] Registered weekly sync: ${expression} (Asia/Jakarta)`);
}

export function stopScheduler() {
  if (task) {
    task.stop();
    task = null;
    console.log("[SCHEDULER] Stopped");
  }
}
