import { db } from '@/lib/db';
import { jobFamilyTopicRuns, jobFamilyTopics, jobFamilyTopicAssignments } from '@/lib/db/schema';
import { eq, desc } from 'drizzle-orm';

async function checkRuns() {
  try {
    // Get the latest completed run
    const runs = await db
      .select()
      .from(jobFamilyTopicRuns)
      .orderBy(desc(jobFamilyTopicRuns.createdAt))
      .limit(5);

    console.log('\n=== Latest Runs ===');
    for (const run of runs) {
      console.log(`Run ${run.id}: status=${run.status}, created=${run.createdAt}`);

      if (run.status === 'completed') {
        // Get topics from this run
        const topics = await db
          .select()
          .from(jobFamilyTopics)
          .where(eq(jobFamilyTopics.runId, run.id))
          .limit(3);

        console.log(`  Topics in this run: ${topics.length}`);
        if (topics.length > 0) {
          // Get assignments from first topic
          const assignments = await db
            .select()
            .from(jobFamilyTopicAssignments)
            .where(eq(jobFamilyTopicAssignments.runId, run.id))
            .limit(5);

          console.log(`  Total assignments: ${assignments.length}`);
          if (assignments.length >= 2) {
            console.log(`  ✓ This run has enough data to test PositionDistanceSearch`);
            console.log(`    Run ID: ${run.id}`);
          }
        }
      }
    }

    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

checkRuns();
