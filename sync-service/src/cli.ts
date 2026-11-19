#!/usr/bin/env node

/**
 * CLI to run sync operations without the API server.
 *
 * Usage:
 *   npx tsx src/cli.ts all                  # Full sync
 *   npx tsx src/cli.ts employees            # Employees only
 *   npx tsx src/cli.ts org                  # Divisions + departments
 *   npx tsx src/cli.ts positions            # Position mapping bundle
 *   npx tsx src/cli.ts divisions            # Divisions only
 *   npx tsx src/cli.ts departments          # Departments only
 *   npx tsx src/cli.ts position-master      # Position master only
 *   npx tsx src/cli.ts position-hierarchy   # Position hierarchy only
 *   npx tsx src/cli.ts employee-positions   # Employee-position mapping only
 *   npx tsx src/cli.ts tech-competencies    # Technical competency mapping only
 *   npx tsx src/cli.ts performance          # Performance appraisals
 *   npx tsx src/cli.ts disciplinary         # Disciplinary (all)
 *   npx tsx src/cli.ts education            # Education (all)
 *   npx tsx src/cli.ts personal             # Employee personal info (birth date → age)
 *   npx tsx src/cli.ts candidates           # Populate candidates
 *   npx tsx src/cli.ts job-profiles         # Job profiles from SharePoint
 *   npx tsx src/cli.ts hav                  # HAV Excel sync
 *   npx tsx src/cli.ts mcu                  # MCU Excel sync
 *   npx tsx src/cli.ts grades                # Grade levels from MPMHRGA
 *   npx tsx src/cli.ts behavior-competencies # Behavior competencies from MPMHRGA
 *   npx tsx src/cli.ts disciplinary <id>    # Disciplinary for one employee
 *   npx tsx src/cli.ts education <id>       # Education for one employee
 *   npx tsx src/cli.ts personal <id>        # Personal info for one employee
 *   npx tsx src/cli.ts grades               # Grade levels
 */

import "./config.js"; // load .env
import { syncEmployees } from "./services/employee-sync.js";
import { syncPerformance } from "./services/performance-sync.js";
import { syncAllDisciplinary, syncDisciplinaryForEmployee } from "./services/disciplinary-sync.js";
import { syncAllEducation, syncEducationForEmployee } from "./services/education-sync.js";
import {
  syncAllEmployeePersonal,
  syncEmployeePersonalForEmployee,
} from "./services/employee-personal-sync.js";
import { populateCandidates } from "./services/candidate-populate.js";
import { syncDivisions, syncDepartments, syncOrgStructure } from "./services/org-sync.js";
import { syncJobProfiles } from "./services/job-profile-sync.js";
import { syncKamusKompetensi } from "./services/kamus-sync.js";
import { syncGradeLevels } from "./services/grade-sync.js";
import { syncBehaviorCompetencies } from "./services/behavior-sync.js";
import { syncHav } from "./services/hav-sync.js";
import { syncMcu } from "./services/mcu-sync.js";
import {
  syncEmployeePositions,
  syncPositionBundle,
  syncPositionHierarchy,
  syncPositionMaster,
  syncTechnicalCompetencyMappings,
} from "./services/position-sync.js";
import { cleanAllSyncData } from "./services/clean-sync.js";
import { closePools } from "./db/mssql.js";
import { closePool } from "./db/postgres.js";
import type { SyncResult } from "./types.js";

const args = process.argv.slice(2);
const nonFlagArgs = args.filter((a) => !a.startsWith("--"));
const cmd = nonFlagArgs[0];
const cleanFlag = args.includes("--clean");
// --force: job-profiles only — re-run LLM extraction for unchanged files
// (rows are updated in place, nothing is deleted).
const forceFlag = args.includes("--force");
const arg = nonFlagArgs[1];

function print(label: string, r: SyncResult) {
  const icon = r.success ? "✓" : "✗";
  console.log(`${icon} ${label}: ${r.message} (${r.synced}/${r.total})`);
}

async function main() {
  if (!cmd) {
    console.log(
      "Usage: npx tsx src/cli.ts <all|employees|org|divisions|departments|performance|disciplinary|education|candidates> [employeeId]\n       Use --clean with 'all' to clear sync tables before a full re-sync"
    );
    process.exit(1);
  }

  try {
    switch (cmd.toLowerCase()) {
      case "all": {
        if (cleanFlag) {
          console.log("🧹 Cleaning all sync data before full sync...");
          const clean = await cleanAllSyncData();
          if (clean.errors.length) {
            console.error(`⚠ Clean completed with errors on: ${clean.errors.join(", ")}`);
          } else {
            console.log(`✅ Clean complete (${clean.deleted} rows removed)`);
          }
        }
        console.log("🔄 Running full sync...");
        print("Employees", await syncEmployees());
        const org = await syncOrgStructure();
        print("Divisions", org.divisions);
        print("Departments", org.departments);
        const pos = await syncPositionBundle();
        print("Position Master", pos.positionMaster);
        print("Position Hierarchy", pos.positionHierarchy);
        print("Employee Positions", pos.employeePositions);
        print("Technical Competencies", pos.technicalCompetencies);
        print("Performance", await syncPerformance());
        print("Disciplinary", await syncAllDisciplinary());
        print("Education", await syncAllEducation());
        print("Personal Info", await syncAllEmployeePersonal());
        print("HAV", await syncHav());
        print("MCU", await syncMcu());
        print("Grade Levels", await syncGradeLevels());
        print("Behavior Competencies", await syncBehaviorCompetencies());
        print("Candidates", await populateCandidates());
        // print("Job Profiles", await syncJobProfiles());
        console.log("✅ Full sync complete");
        break;
      }
      case "employees":
        console.log("🔄 Syncing employees...");
        print("Employees", await syncEmployees());
        break;
      case "org": {
        console.log("🔄 Syncing org structure...");
        const org = await syncOrgStructure();
        print("Divisions", org.divisions);
        print("Departments", org.departments);
        break;
      }
      case "positions": {
        console.log("🔄 Syncing position mapping bundle...");
        const pos = await syncPositionBundle();
        print("Position Master", pos.positionMaster);
        print("Position Hierarchy", pos.positionHierarchy);
        print("Employee Positions", pos.employeePositions);
        print("Technical Competencies", pos.technicalCompetencies);
        break;
      }
      case "divisions":
        console.log("🔄 Syncing divisions...");
        print("Divisions", await syncDivisions());
        break;
      case "departments":
        console.log("🔄 Syncing departments...");
        print("Departments", await syncDepartments());
        break;
      case "position-master":
        console.log("🔄 Syncing position master...");
        print("Position Master", await syncPositionMaster());
        break;
      case "position-hierarchy":
        console.log("🔄 Syncing position hierarchy...");
        print("Position Hierarchy", await syncPositionHierarchy());
        break;
      case "employee-positions":
        console.log("🔄 Syncing employee-position mapping...");
        print("Employee Positions", await syncEmployeePositions());
        break;
      case "tech-competencies":
        console.log("🔄 Syncing technical competency mapping...");
        print("Technical Competencies", await syncTechnicalCompetencyMappings());
        break;
      case "performance":
        console.log("🔄 Syncing performance appraisals...");
        print("Performance", await syncPerformance());
        break;
      case "disciplinary":
        if (arg) {
          console.log(`🔄 Syncing disciplinary for ${arg}...`);
          print("Disciplinary", await syncDisciplinaryForEmployee("MPM2", arg));
        } else {
          console.log("🔄 Syncing disciplinary for all employees...");
          print("Disciplinary", await syncAllDisciplinary());
        }
        break;
      case "education":
        if (arg) {
          console.log(`🔄 Syncing education for ${arg}...`);
          print("Education", await syncEducationForEmployee("MPM2", arg));
        } else {
          console.log("🔄 Syncing education for all employees...");
          print("Education", await syncAllEducation());
        }
        break;
      case "personal":
        if (arg) {
          console.log(`🔄 Syncing personal information for ${arg}...`);
          print("Personal Info", await syncEmployeePersonalForEmployee("MPM2", arg));
        } else {
          console.log("🔄 Syncing personal information for all employees...");
          print("Personal Info", await syncAllEmployeePersonal());
        }
        break;
      case "candidates": {
        // --rebuild re-derives the child tables from scratch; candidate rows are
        // always upserted (ids preserved) so scoring history survives.
        const mode = args.includes("--rebuild") ? "rebuild" as const : "upsert" as const;
        console.log(`🔄 Populating candidates from sync tables... (mode=${mode})`);
        print("Candidates", await populateCandidates(null, { mode }));
        break;
      }
      case "job-profiles":
        console.log(`🔄 Syncing job profiles from SharePoint...${forceFlag ? " (force reprocess)" : ""}`);
        print("Job Profiles", await syncJobProfiles(null, { force: forceFlag }));
        break;
      case "kamus-kompetensi":
        console.log(`🔄 Syncing kamus kompetensi teknis dari folder PDF...${forceFlag ? " (force reprocess)" : ""}`);
        print("Kamus Kompetensi", await syncKamusKompetensi({ force: forceFlag }));
        break;
      case "hav":
        console.log("🔄 Syncing HAV assessments from Excel...");
        print("HAV", await syncHav());
        break;
      case "mcu":
        console.log("🔄 Syncing MCU assessments from Excel...");
        print("MCU", await syncMcu());
        break;
      case "grades":
        console.log("🔄 Syncing grade levels from MPMHRGA...");
        print("Grade Levels", await syncGradeLevels());
        break;
      case "behavior-competencies":
        console.log("🔄 Syncing behavior competencies from MPMHRGA...");
        print("Behavior Competencies", await syncBehaviorCompetencies());
        break;
      // talent-mapping / rtc / assessment-center / talent-staging used to be
      // handled here. Removed with the /talent prototype (branch
      // `parked/talent-5box`), so they now fall through to `default` and exit 1
      // as unknown commands — which is right: an operator running
      // `cli -- talent-staging` must be told the job is gone, not handed a
      // silent success.
      default:
        console.error(`❌ Unknown command: ${cmd}`);
        process.exit(1);
    }
  } catch (err) {
    console.error("❌ Error:", err);
    process.exit(1);
  } finally {
    await closePools();
    await closePool();
  }
}

main();
