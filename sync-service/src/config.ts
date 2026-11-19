import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Load THIS service's own .env regardless of the launch cwd (src/config.ts →
// ../.env = sync-service/.env). `import "dotenv/config"` resolves against
// process.cwd(), so launching from anywhere but sync-service/ found no env.
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../.env") });

export const config = {
  // DB MPMDS – Employee / Division / Department
  dbMPMDS: {
    server: process.env.DB_MPMDS_SERVER || "localhost",
    port: parseInt(process.env.DB_MPMDS_PORT || "1433"),
    user: process.env.DB_MPMDS_USER || "sa",
    password: process.env.DB_MPMDS_PASSWORD || "",
    database: process.env.DB_MPMDS_DATABASE || "",
  },
  // DB MPMHRGA – Performance Appraisal
  dbMPMHRGA: {
    server: process.env.DB_MPMHRGA_SERVER || "localhost",
    port: parseInt(process.env.DB_MPMHRGA_PORT || "1433"),
    user: process.env.DB_MPMHRGA_USER || "sa",
    password: process.env.DB_MPMHRGA_PASSWORD || "",
    database: process.env.DB_MPMHRGA_DATABASE || "",
  },
  // Target PostgreSQL
  postgresUrl: process.env.POSTGRES_URL || "postgresql://postgres:postgres@localhost:5432/pulse",
  // External API
  api: {
    baseUrl: process.env.API_BASE_URL || "https://dev-apigw.mpm-motor.com",
    clientId: process.env.API_CLIENT_ID || "",
    clientSecret: process.env.API_CLIENT_SECRET || "",
    grantType: process.env.API_GRANT_TYPE || "client_credentials",
    tokenPath: process.env.API_TOKEN_PATH || "/mpm/token/api/1.0/login/trainingedp",
  },
  // Candidate population
  syncSystemUserId: process.env.SYNC_SYSTEM_USER_ID || "",
  // Scheduler
  syncCronExpression: process.env.SYNC_CRON_EXPRESSION || "0 1 * * 1",
  port: parseInt(process.env.PORT || "8000"),
  /**
   * Pick an interrupted job-profile queue back up at startup.
   *
   * On by default: the work was explicitly requested and the process died
   * holding it, so continuing is what an operator expects from a restart. Set
   * to 0 when a deploy must never trigger extraction on its own.
   */
  jobProfileResumeOnBoot: (process.env.JOB_PROFILE_RESUME_ON_BOOT ?? "1") !== "0",
  // ── Job profile extraction retries ──
  //
  // Everything `extractJobProfile` throws is worth one more attempt: a transport
  // error (timeout, 429, 5xx from the model gateway) obviously, but also the
  // format errors ("LLM did not return valid JSON", a JSON.parse throw), because
  // a vision model failing to close its fences is stochastic and usually
  // succeeds on the next pass. PDF→PNG conversion sits OUTSIDE the retry: a file
  // that yields no pages is corrupt, and three attempts at a corrupt file is
  // just three times the wait for the same answer.
  //
  // Bounded low on purpose — each attempt is a multi-page vision call, so this
  // multiplies the cost of a genuinely broken document by the attempt count.
  jobProfileExtractAttempts: Math.max(
    1,
    parseInt(process.env.JOB_PROFILE_EXTRACT_ATTEMPTS || "3", 10) || 3,
  ),
  /** First backoff, doubled per attempt, with jitter so a batch cannot lock-step. */
  jobProfileExtractBackoffMs: Math.max(
    0,
    parseInt(process.env.JOB_PROFILE_EXTRACT_BACKOFF_MS || "4000", 10) || 4000,
  ),
  // Local PDF storage (shared folder)
  localPdfFolder: process.env.LOCAL_PDF_FOLDER || "",
  localPdfUsername: process.env.LOCAL_PDF_USERNAME || "",
  localPdfPassword: process.env.LOCAL_PDF_PASSWORD || "",
  localPdfDomain: process.env.LOCAL_PDF_DOMAIN || "",
  // Excel files for HAV and MCU
  localHavFolder: process.env.LOCAL_HAV_FOLDER || "",
  localMcuFolder: process.env.LOCAL_MCU_FOLDER || "",
  // Master encryption key. Read from this file (written and rotated by the web
  // app's Keamanan page), or from PULSE_MASTER_KEY when secrets arrive as env
  // vars. Reading it here is what lets the Monday cron write encrypted columns
  // without a human unlocking anything first.
  masterKeyFile: process.env.PULSE_MASTER_KEY_FILE || "secrets/master.key",
  masterKeyInline: process.env.PULSE_MASTER_KEY || "",
  // Local store for files uploaded through the UI. Deliberately a plain local
  // directory, NOT a network share: uploading is the escape hatch for when the
  // shared folder is unreachable or unconfigured, so it must never depend on it.
  // Files here take precedence over the shared folder when both have a copy.
  uploadFolder: process.env.LOCAL_UPLOAD_FOLDER || "uploads",

  // LLM
  llm: {
    baseUrl: process.env.LLM_BASE_URL || "http://localhost:8001/v1",
    apiKey: process.env.LLM_API_KEY || "not-needed",
    model: process.env.LLM_MODEL || "default",
  },
} as const;
