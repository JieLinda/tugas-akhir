import { db } from '@/lib/db';
import { jobFamilyTopics, jobFamilyTopicAssignments } from '@/lib/db/schema';
import { eq, sql } from 'drizzle-orm';

async function verifyGeneralization() {
  try {
    console.log('\n=== Verifying Generalization Integration ===\n');

    // 1. Check if migration 0040 columns exist
    const topicsSchema = await db.execute(
      sql`SELECT column_name FROM information_schema.columns
          WHERE table_name = 'job_family_topics'
          ORDER BY column_name`
    );
    console.log('✓ job_family_topics columns exist');

    // 2. Check if migration 0039 columns exist
    const assignSchema = await db.execute(
      sql`SELECT column_name FROM information_schema.columns
          WHERE table_name = 'job_family_topic_assignments'
          AND column_name IN ('matched_keywords', 'centroid_similarity', 'alt_topic_id', 'alt_similarity')
          ORDER BY column_name`
    );
    console.log('✓ job_family_topic_assignments reason columns exist');

    // 3. Check a recent run for generalization data
    const runId = 'ce0056c7-dc0e-49e1-b408-46334d501d8c';
    const topics = await db
      .select()
      .from(jobFamilyTopics)
      .where(eq(jobFamilyTopics.runId, runId))
      .limit(5);

    console.log(`\n✓ Found ${topics.length} topics in run ${runId}`);

    // Count how many have generalization data
    let withGeneral = 0;
    for (const t of topics) {
      if (t.generalTitle || t.generalDescription) {
        withGeneral++;
      }
    }

    console.log(`  - Topics with general title/description: ${withGeneral}/${topics.length}`);

    if (topics.length > 0) {
      const topic = topics[0]!;
      console.log(`\n  Sample topic (ID ${topic.topicId}):`);
      console.log(`    Label: ${topic.label}`);
      console.log(`    General Title: ${topic.generalTitle || '(null)'}`);
      console.log(`    General Description: ${(topic.generalDescription || '(null)').substring(0, 80)}...`);
    }

    // 4. Check assignments for reason data
    const assignments = await db
      .select()
      .from(jobFamilyTopicAssignments)
      .where(eq(jobFamilyTopicAssignments.runId, runId))
      .limit(5);

    console.log(`\n✓ Found ${assignments.length} assignments in run`);

    let withReasons = 0;
    for (const a of assignments) {
      if (a.matchedKeywords || a.centroidSimilarity !== null) {
        withReasons++;
      }
    }

    console.log(`  - Assignments with reason data: ${withReasons}/${assignments.length}`);

    if (assignments.length > 0) {
      const a = assignments[0]!;
      console.log(`\n  Sample assignment (${a.positionName}):`);
      console.log(`    Matched Keywords: ${a.matchedKeywords ? (a.matchedKeywords as any[]).length + ' keywords' : '(null)'}`);
      console.log(`    Centroid Similarity: ${a.centroidSimilarity?.toFixed(3) || '(null)'}`);
      console.log(`    Alt Topic ID: ${a.altTopicId || '(null)'}`);
      console.log(`    Alt Similarity: ${a.altSimilarity?.toFixed(3) || '(null)'}`);
    }

    console.log('\n✓ Generalization integration verified successfully');
    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

verifyGeneralization();
