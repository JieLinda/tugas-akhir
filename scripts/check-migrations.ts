import { db } from '@/lib/db';
import { sql } from 'drizzle-orm';

async function checkMigrations() {
  try {
    // Check if migration 0039 columns exist
    const assign_result = await db.execute(
      sql`SELECT column_name FROM information_schema.columns
          WHERE table_name = 'job_family_topic_assignments'
          AND column_name IN ('matched_keywords', 'centroid_similarity', 'alt_topic_id', 'alt_similarity')`
    );
    console.log('Migration 0039 columns:', assign_result.rows?.length || 0);

    // Check if migration 0040 columns exist
    const topics_result = await db.execute(
      sql`SELECT column_name FROM information_schema.columns
          WHERE table_name = 'job_family_topics'
          AND column_name IN ('general_title', 'general_description')`
    );
    console.log('Migration 0040 columns:', topics_result.rows?.length || 0);

    process.exit(0);
  } catch (err) {
    console.error('Error checking migrations:', err);
    process.exit(1);
  }
}

checkMigrations();
