import { NextRequest } from 'next/server';
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { ensureLocalUser } from '@/lib/pulse-data';
import { saveChatMessageAction } from '@/lib/chat-actions';
import { hasPermission } from '@/lib/rbac';
import {
  SCORING_METHODOLOGY_BRIEF,
  buildRunMethodologyContext,
} from '@/lib/scoring-methodology-brief';
import { getRunConfigurationAction } from '@/lib/progress-running-actions';
import { stripAskEnvelope } from '@/lib/ask-ai-envelope';
import { formatHistoryDate } from '@/lib/datetime';
import { isDemoMode } from '@/lib/app-mode';
import { MASKED_NPK } from '@/lib/app-mode-shared';
import { demoScrubText } from '@/lib/demo/names';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  // Guard before touching the LLM: without this an unauthorized caller burns
  // OpenAI tokens and only fails later, when saveChatMessageAction rejects.
  if (!(await hasPermission('analysis.manage'))) {
    return new Response('Forbidden', { status: 403 });
  }

  const { question: rawQuestion, runId, context } = await req.json();
  // A question sent from a derivation panel carries a chip header naming the
  // tab and anchor it came from. That is UI metadata; handing it to the model
  // invites it to comment on tab names. History keeps the original so the chip
  // still renders on reload.
  const question = stripAskEnvelope(String(rawQuestion ?? ''));

  const fmtDate = formatHistoryDate;
  // Demo mode: the model is never told an NPK, whatever the client sent.
  const demo = await isDemoMode();

  const methodLabels: Record<string, string> = {
    AHP_TOPSIS: 'AHP + TOPSIS (deterministik)',
  };

  const run = context.scoringRun;
  const runBlock = run
    ? `=== INFO SCORING RUN ===
Metode: ${methodLabels[run.method] ?? run.method}
Program: ${run.program ?? '-'}${run.label ? ` · Label: ${run.label}` : ''}
Status: ${run.status} · Dibuat: ${fmtDate(run.createdAt)}${run.completedAt ? ` · Selesai: ${fmtDate(run.completedAt)}` : ''}
Jumlah kandidat dinilai: ${run.candidateCount}${run.qualifiedCount != null ? ` · Lolos filter: ${run.qualifiedCount}` : ''}${run.disqualifiedCount != null ? ` · Gugur filter: ${run.disqualifiedCount}` : ''}
${run.gradeRange ? `Rentang grade pool: ${run.gradeRange.min ?? '?'}–${run.gradeRange.max ?? '?'}\n` : ''}${(run.businessUnits ?? []).length ? `Unit bisnis kandidat: ${(run.businessUnits ?? []).join(', ')}\n` : ''}`
    : '';

  const candidateBlock = (context.candidates ?? [])
    .map((c: any) => {
      const tech = (c.technicalCompetencies ?? [])
        .map((tc: any) => `${tc.name} (skor ${tc.currentScore ?? '-'}/${tc.targetScore ?? '-'}, gap ${tc.gap ?? '-'}, level ${tc.currentProficiency ?? '-'})`)
        .join('; ');
      const history = (c.positionHistory ?? [])
        .map((ph: any) => `${fmtDate(ph.from)}→${fmtDate(ph.to)}: ${ph.title ?? '-'}${ph.gradeId ? ` (Grade ${ph.gradeId})` : ''}${ph.primary ? '' : ' [non-primary]'}`)
        .join(' | ');
      const career = c.scoreBreakdown?.career != null ? ` · Career ${c.scoreBreakdown.career}%` : '';
      return `
#${c.rank}. ${c.name} (${demo ? MASKED_NPK : c.employeeId})${c.gradeLevel ? ` · Level: ${c.gradeLevel}` : ''}${c.grade ? ` (Grade ${c.grade})` : ''}
   Jabatan: ${c.currentPosition} · ${c.department} / ${c.division}
   Masa Kerja: ${c.yearsOfService} tahun · Pendidikan: ${c.education} (${c.major})
   Disiplin: ${c.disciplinaryStatus} · MCU: ${c.mcuStatus} · HAV Kuadran: ${c.havQuadrant ?? '—'}${c.riskLevel ? ` · Risiko: ${c.riskLevel}` : ''}
   Behavior: ${c.behaviorRecommendation ?? '-'}${c.behaviorNotes ? ` — ${c.behaviorNotes}` : ''}
   Program: ${(c.programs ?? []).map((p: any) => `${p.code}=${p.status} (${p.note})`).join(', ') || '-'}
   Riwayat Asesmen: ${(c.assessmentHistory ?? []).map((a: any) => `${a.period}: Teknis=${a.technical}, Perilaku=${a.behavior}, Kinerja=${a.performance}`).join(' | ') || '-'}
   Kompetensi Teknis: ${tech || '-'}
   Riwayat Jabatan: ${history || '-'}
   --- Scoring ---
   Score: ${c.score}% · Readiness: ${c.readiness}
   Breakdown: Technical ${c.scoreBreakdown.technical}% · Behavior ${c.scoreBreakdown.behavior}% · HAV ${c.scoreBreakdown.hav}% · PA ${c.scoreBreakdown.performance}% · Edu ${c.scoreBreakdown.education}%${career}
   Insight: ${c.constraint}
   Keunggulan: ${(c.strengths ?? []).join('; ') || '-'}
   Kebutuhan Pengembangan: ${(c.weaknesses ?? []).join('; ') || '-'}
   Rekomendasi: ${(c.recommendation ?? []).join('; ') || '-'}`;
    })
    .join('\n');

  let systemMsg = `Anda adalah asisten analis suksesi yang membantu pengguna memahami hasil scoring kandidat untuk posisi "${context.positionTitle}" (${context.positionDepartment} · ${context.positionDivision}).

Gunakan SELURUH data berikut untuk menjawab pertanyaan pengguna secara akurat dalam Bahasa Indonesia. Data mencakup metadata scoring run dan profil lengkap tiap kandidat (kompetensi teknis, riwayat jabatan, behavior, HAV, PA, skor per aspek).

${runBlock}=== DAFTAR KANDIDAT (DIRANKING) ===
${candidateBlock}

Jawablah berdasarkan data yang tersedia, boleh mendalam jika diminta. Rujuk angka/nama nyata (kompetensi, jabatan, skor). Jangan mengarang data yang tidak ada. Jika ditanya di luar konteks data ini, arahkan kembali ke hasil scoring yang ada.`;

  // ── Methodology knowledge ──
  //
  // Without this the assistant knows every SCORE but nothing about how any of
  // them was computed, so "why is this technical 78?" could only paraphrase the
  // number back. The explanations lived in two places a model never sees: the
  // Konfigurasi tab's formula blocks and the derivation popups on Readiness /
  // Kandidat. Users now paste those popups' Markdown here (see
  // lib/scoring-explainer.ts), and the brief below defines every label that
  // paste can contain — the two files are a vocabulary contract.
  systemMsg += `\n\n${SCORING_METHODOLOGY_BRIEF}`;

  // Then this run's OWN numbers, which outrank the brief's generic examples.
  // Kept separate and read from the run's stored config because anchors and depth
  // targets differ per run — a brief with baked-in values would misdescribe every
  // run made before or after a re-embed.
  try {
    const cfg = await getRunConfigurationAction(runId);
    const ri = cfg?.runInfo;
    if (ri) {
      const block = buildRunMethodologyContext({
        careerScale: ri.career?.scale ?? null,
        careerDepth: ri.career?.depth ?? null,
        careerCalibration: ri.career?.calibration ?? null,
        careerIdf: ri.career?.idf ?? null,
        technicalSimFloor: ri.technical?.simFloor ?? null,
        technicalSimCeil: ri.technical?.simCeil ?? null,
        technicalAnchorSource: ri.technical?.simAnchorSource ?? null,
        requiredSource: ri.technical?.requiredSource ?? null,
        requiredCount: ri.technical?.requiredCount ?? null,
        droppedCriteria:
          ri.ahp?.droppedCriteria?.map((d) => `${d.key} (${d.reason})`) ?? null,
        weights: (cfg?.ahp?.weights as Record<string, number> | undefined) ?? null,
      });
      if (block) systemMsg += `\n\n${block}`;
    }
  } catch {} // run config is a bonus — the generic brief still stands without it

  // Demo mode: the candidate block above was built from what the browser was
  // shown — initials already — so the model never learns a real name and cannot
  // write one back. This catches anything the server added itself.
  systemMsg = await demoScrubText(systemMsg);

  const vllmUrl = process.env.LLM_BASE_URL || 'https://models.mpm-motor.com/v1';
  const vllmModelName = process.env.LLM_MODEL || 'vllm/aira';
  const vllmApiKey = process.env.LLM_API_KEY || 'sk-xxxx';

  const model = new ChatOpenAI({
    model: vllmModelName,
    configuration: { baseURL: vllmUrl, apiKey: vllmApiKey },
    temperature: 0.3,
    streaming: true,
  });

  // Save user message
  try {
    const userId = await ensureLocalUser();
    await saveChatMessageAction(runId, 'user', rawQuestion);
  } catch {}

  const stream = await model.stream([
    new SystemMessage(systemMsg),
    new HumanMessage(question),
  ]);

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      let fullContent = '';
      for await (const chunk of stream) {
        const text = chunk.content as string;
        if (text) {
          fullContent += text;
          controller.enqueue(encoder.encode(text));
        }
      }
      controller.close();

      // Save assistant message after streaming completes
      try {
        await saveChatMessageAction(runId, 'assistant', fullContent);
      } catch {}
    },
  });

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache',
    },
  });
}
