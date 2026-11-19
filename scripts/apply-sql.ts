// Apply a hand-written SQL migration file directly against DATABASE_URL.
// Usage: tsx scripts/apply-sql.ts drizzle/0031_job_family_embeddings.sql
//
// This repo hand-writes idempotent numbered SQL migrations (see drizzle/*.sql)
// rather than relying on `drizzle-kit generate`, whose interactive rename
// prompts can't run in non-TTY shells. Statements are split on the
// `--> statement-breakpoint` marker drizzle emits.
import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: tsx scripts/apply-sql.ts <path-to-sql>');
    process.exit(1);
  }
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) throw new Error('DATABASE_URL or POSTGRES_URL is not set');

  const sql = await readFile(file, 'utf-8');
  const statements = sql
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const pool = new Pool({ connectionString: url });
  try {
    for (const [i, stmt] of statements.entries()) {
      process.stdout.write(`Applying statement ${i + 1}/${statements.length}... `);
      await pool.query(stmt);
      console.log('ok');
    }
    console.log(`\nApplied ${statements.length} statement(s) from ${file}`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('\nMigration failed:', err.message);
  process.exit(1);
});
