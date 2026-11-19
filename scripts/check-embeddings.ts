// `job_profile_embed` lives in the VECTOR database (lib/db/vector-db.ts,
// VECTOR_DATABASE_URL, falling back to DATABASE_URL), not in the Drizzle
// schema — so it is queried through vectorDb, or this would count the main
// database whenever the two are separate instances.
import { vectorDb } from '@/lib/db/vector-db';
import { sql } from 'drizzle-orm';

async function checkEmbeddings() {
  try {
    const result = await vectorDb.execute(sql`SELECT COUNT(*) as count FROM job_profile_embed`);
    const count = (result.rows?.[0] as any)?.count || 0;
    console.log(`Total embeddings in database: ${count}`);

    if (count > 0) {
      const sample = await vectorDb.execute(sql`SELECT job_profile_id, embedding FROM job_profile_embed LIMIT 3`);
      console.log(`\nSample embeddings:`);
      for (const row of sample.rows || []) {
        const r = row as any;
        console.log(`- Profile ${r.job_profile_id}: ${typeof r.embedding} (${(r.embedding as string)?.length || 0} chars)`);
      }
    }

    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

checkEmbeddings();
