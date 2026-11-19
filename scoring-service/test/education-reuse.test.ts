// TC-EDU-REUSE — a grounded education answer is reused across runs of the same
// position when, and only when, the model would be asked the identical question.
//
//   node --import tsx --test test/education-reuse.test.ts
//
// No database and no Gemini: the reuse source is built in memory, and the engine
// path runs with whatever GEMINI_API_KEY the environment has — cases that would
// otherwise call the model are skipped when a key is present.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  buildEducationUserPrompt,
  educationInputKey,
  reusableAnswerFor,
  reusableAnswersFromPoolRows,
  type EducationModelSettings,
  type EducationPromptInput,
  type EducationReuseSource,
} from "../src/education-reuse.js";
import {
  composeEducationScore,
  compareEducationLevel,
  educationSystemPrompt,
  scoreEducationAspect,
} from "../src/ahp-topsis-engine.js";
import { config } from "../src/config.js";
import { geminiConfigured } from "../src/gemini.js";

const settings: EducationModelSettings = {
  model: "gemini-2.5-flash",
  grounding: true,
  groundingTool: "google_search",
  temperature: 0,
  topP: 0,
};
const base: EducationPromptInput = {
  education: "S1",
  major: "Ekonomi Pembangunan",
  requirement: "S1 Teknik Informatika / Sistem Informasi",
  positionTitle: "IT Application Development Department Head",
  jobPurpose: "Memimpin pengembangan aplikasi",
  responsibilityDetails: [
    { responsibility: "Mengelola portofolio aplikasi", successIndicator: "SLA 99%" },
    { responsibility: "Menyusun anggaran TI", successIndicator: null },
  ],
};
const key = (input: EducationPromptInput, s = settings, system = "SYS") => educationInputKey(system, input, s);

describe("TC-EDU-REUSE-KEY  the key is the question the model is asked", () => {
  test("the candidate's name is not part of it", () => {
    assert.notEqual(buildEducationUserPrompt("Budi", base), buildEducationUserPrompt("Sari", base));
    // …but the key ignores it, so two runs with masked/unmasked names still match.
    assert.equal(key(base), key({ ...base }));
  });

  const changes: [string, EducationPromptInput][] = [
    ["jenjang", { ...base, education: "S2" }],
    ["jurusan", { ...base, major: "Teknik Informatika" }],
    ["syarat pendidikan", { ...base, requirement: "S1 Semua Jurusan" }],
    ["judul posisi", { ...base, positionTitle: "IT Head" }],
    ["tujuan jabatan", { ...base, jobPurpose: "Memimpin infrastruktur" }],
    ["tanggung jawab", { ...base, responsibilityDetails: [{ ...base.responsibilityDetails[0]!, responsibility: "Lain" }, base.responsibilityDetails[1]!] }],
    ["indikator keberhasilan", { ...base, responsibilityDetails: [{ ...base.responsibilityDetails[0]!, successIndicator: "SLA 95%" }, base.responsibilityDetails[1]!] }],
  ];
  for (const [what, changed] of changes) {
    test(`a different ${what} is a different question`, () => {
      assert.notEqual(key(changed), key(base));
    });
  }

  test("the system prompt and every model setting are part of it", () => {
    assert.notEqual(key(base, settings, "SYS2"), key(base));
    assert.notEqual(key(base, { ...settings, model: "gemini-2.5-pro" }), key(base));
    assert.notEqual(key(base, { ...settings, grounding: false }), key(base));
    assert.notEqual(key(base, { ...settings, temperature: 0.2 }), key(base));
    assert.notEqual(key(base, { ...settings, topP: 0.5 }), key(base));
  });

  test("it follows the prompt exactly: an 11th responsibility the prompt drops changes nothing", () => {
    const ten = Array.from({ length: 10 }, (_, i) => ({ responsibility: `R${i}`, successIndicator: null }));
    const a = { ...base, responsibilityDetails: ten };
    const b = { ...base, responsibilityDetails: [...ten, { responsibility: "R10", successIndicator: "x" }] };
    assert.equal(buildEducationUserPrompt("X", a), buildEducationUserPrompt("X", b));
    assert.equal(key(a), key(b));
  });
});

describe("TC-EDU-REUSE-SRC  what a previous run offers for reuse", () => {
  const answer = (over: Record<string, unknown> = {}) => ({
    educationEval: {
      source: "llm-grounded",
      score: 70,
      educationLevel: 60,
      majorRelevance: 40,
      reason: "Sumber: ...",
      searchQueries: ["q"],
      sources: [{ title: "t", uri: "https://example.org" }],
      inputKey: "K",
      reusedFrom: null,
      ...over,
    },
  });

  test("only model answers that recorded their key qualify", () => {
    const rows = [
      { candidateId: "ok", details: answer() },
      { candidateId: "structured", details: JSON.stringify(answer({ source: "llm-structured" })) },
      { candidateId: "exact", details: answer({ source: "exact-match" }) },
      { candidateId: "failed", details: answer({ source: "none" }) },
      { candidateId: "nokey", details: answer({ inputKey: null }) },
      { candidateId: "nonumber", details: answer({ educationLevel: null }) },
      { candidateId: "garbage", details: "{not json" },
    ];
    const out = reusableAnswersFromPoolRows("RUN2", "2026-11-01T03:00:00.000Z", rows);
    assert.deepEqual([...out.keys()].sort(), ["ok", "structured"]);
    assert.deepEqual(out.get("ok")!.provenance, {
      runId: "RUN2",
      answeredInRunId: "RUN2",
      answeredAt: "2026-11-01T03:00:00.000Z",
    });
  });

  test("a chain of reuses still names the run in which the model really answered", () => {
    const rows = [
      {
        candidateId: "c",
        details: answer({ reusedFrom: { runId: "RUN1", answeredInRunId: "RUN0", answeredAt: "2026-09-01T00:00:00.000Z" } }),
      },
    ];
    const p = reusableAnswersFromPoolRows("RUN2", "2026-11-01T00:00:00.000Z", rows).get("c")!.provenance;
    assert.deepEqual(p, { runId: "RUN2", answeredInRunId: "RUN0", answeredAt: "2026-09-01T00:00:00.000Z" });
  });

  test("a hit needs the same candidate AND the same key", () => {
    const source: EducationReuseSource = {
      runId: "RUN2",
      completedAt: null,
      answers: reusableAnswersFromPoolRows("RUN2", null, [{ candidateId: "c", details: answer() }]),
    };
    assert.ok(reusableAnswerFor(source, "c", "K"));
    assert.equal(reusableAnswerFor(source, "c", "OTHER"), null);
    assert.equal(reusableAnswerFor(source, "someone-else", "K"), null);
    assert.equal(reusableAnswerFor(null, "c", "K"), null);
  });
});

describe("TC-EDU-REUSE-ENGINE  scoreEducationAspect reuses instead of calling", () => {
  const position = { title: base.positionTitle, education: null } as any;
  const jobProfile = {
    educationRequirement: base.requirement,
    jobPurpose: base.jobPurpose,
    responsibilityDetails: base.responsibilityDetails,
  } as any;
  const candidate = { id: "c1", name: "Kandidat Satu", education: base.education, major: base.major } as any;
  const exact = { id: "c2", name: "Kandidat Dua", education: "S1", major: "Teknik Informatika" } as any;
  const engineSettings: EducationModelSettings = {
    model: config.gemini.model,
    grounding: config.gemini.enableGrounding,
    groundingTool: config.gemini.groundingTool,
    temperature: config.gemini.temperature,
    topP: config.gemini.topP,
  };
  const systemPrompt = educationSystemPrompt();
  // The key the engine will compute for `candidate` — with the prompt it really uses.
  const engineKey = educationInputKey(systemPrompt, base, engineSettings);
  const sourceWith = (inputKey: string): EducationReuseSource => ({
    runId: "PREV",
    completedAt: "2026-11-01T03:00:00.000Z",
    answers: reusableAnswersFromPoolRows("PREV", "2026-11-01T03:00:00.000Z", [
      {
        candidateId: "c1",
        details: {
          educationEval: {
            source: "llm-grounded",
            educationLevel: 60,
            majorRelevance: 40,
            reason: "jawaban run sebelumnya",
            searchQueries: ["q"],
            sources: [],
            inputKey,
          },
        },
      },
    ]),
  });
  const run = (source: EducationReuseSource | null) => {
    const tally = { source, eligible: 0, reused: 0, modelCalls: 0 };
    return scoreEducationAspect(
      [candidate, exact],
      position,
      jobProfile,
      null,
      async () => {},
      undefined,
      { requirement: base.requirement },
      undefined,
      tally
    ).then((m) => ({ m, tally }));
  };

  test("identical inputs: the answer is reused, the model is not called, the score is recomposed", async () => {
    const { m, tally } = await run(sourceWith(engineKey));
    const e = m.get("c1")!;
    assert.equal(tally.eligible, 1, "the exact match never needs the model");
    assert.equal(tally.reused, 1);
    assert.equal(tally.modelCalls, 0);
    assert.equal(e.source, "llm-grounded");
    assert.equal(e.reason, "jawaban run sebelumnya");
    assert.equal(e.inputKey, engineKey);
    assert.deepEqual(e.reusedFrom, { runId: "PREV", answeredInRunId: "PREV", answeredAt: "2026-11-01T03:00:00.000Z" });
    // The level axis is this run's rule, applied to the reused model answer.
    const expected = composeEducationScore(
      { education_level: 60, major_relevance: 40 },
      compareEducationLevel(base.education, base.requirement)
    );
    assert.equal(e.score, expected.score);
    assert.equal(m.get("c2")!.source, "exact-match");
    assert.equal(m.get("c2")!.reusedFrom, null);
  });

  test(
    "changed inputs: nothing is reused",
    { skip: geminiConfigured() ? "GEMINI_API_KEY is set; this case would call the model" : false },
    async () => {
      const { m, tally } = await run(sourceWith("a-key-from-a-different-question"));
      assert.equal(tally.reused, 0);
      assert.equal(m.get("c1")!.reusedFrom, null);
      // Without a key and without a reusable answer: "tidak dinilai", as before.
      assert.equal(m.get("c1")!.source, "none");
    }
  );
});
