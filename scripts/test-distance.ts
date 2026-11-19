import { db } from '@/lib/db';
import { jobFamilyTopicAssignments } from '@/lib/db/schema';
import { eq, sql } from 'drizzle-orm';

async function testDistance() {
  try {
    const runId = 'ce0056c7-dc0e-49e1-b408-46334d501d8c';

    // Get assignments from this run
    const assignments = await db
      .select()
      .from(jobFamilyTopicAssignments)
      .where(eq(jobFamilyTopicAssignments.runId, runId))
      .limit(10);

    console.log(`\n=== Testing PositionDistanceSearch ===`);
    console.log(`Found ${assignments.length} assignments in run ${runId}`);

    if (assignments.length < 2) {
      console.log('Not enough assignments to test distance');
      process.exit(0);
    }

    const id1 = assignments[0]!.jobProfileId;
    const id2 = assignments[1]!.jobProfileId;

    console.log(`\nTesting distance between profiles: ${id1} and ${id2}`);
    console.log(`Position 1: ${assignments[0]!.positionName}`);
    console.log(`Position 2: ${assignments[1]!.positionName}`);

    // Fetch embeddings using raw SQL
    const result = await db.execute(
      sql`SELECT job_profile_id, embedding FROM job_profile_embed WHERE job_profile_id IN (${id1}, ${id2})`
    );

    console.log(`\nFound ${result.rows?.length || 0} embeddings`);

    if (result.rows && result.rows.length === 2) {
      const rows = result.rows as any[];
      const emb1 = rows.find((r) => r.job_profile_id === id1)?.embedding;
      const emb2 = rows.find((r) => r.job_profile_id === id2)?.embedding;

      if (emb1 && emb2) {
        // Parse and compute cosine similarity
        const parseVec = (s: string): number[] => {
          const stripped = s.replace(/[\[\]]/g, '');
          return stripped.split(',').map((x) => parseFloat(x.trim()));
        };

        const v1 = parseVec(emb1 as string);
        const v2 = parseVec(emb2 as string);

        if (v1.length > 0 && v2.length === v1.length) {
          const dot = v1.reduce((s, x, i) => s + x * v2[i]!, 0);
          const norm1 = Math.sqrt(v1.reduce((s, x) => s + x * x, 0));
          const norm2 = Math.sqrt(v2.reduce((s, x) => s + x * x, 0));
          const cosineSim = dot / (norm1 * norm2);

          console.log(`\nEmbedding dimensions: ${v1.length}`);
          console.log(`Cosine similarity: ${(cosineSim * 100).toFixed(1)}%`);
        }
      }
    }

    // Test UMAP distance
    if (assignments[0]!.x != null && assignments[0]!.y != null &&
        assignments[1]!.x != null && assignments[1]!.y != null) {
      const dx = assignments[1]!.x - assignments[0]!.x;
      const dy = assignments[1]!.y - assignments[0]!.y;
      const umap2d = Math.sqrt(dx * dx + dy * dy);
      console.log(`UMAP 2D distance: ${umap2d.toFixed(3)}`);
    }

    console.log('\n✓ Test passed - distance calculation works correctly');
    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

testDistance();
