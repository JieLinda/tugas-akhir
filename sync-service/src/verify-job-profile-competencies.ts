/**
 * Verify the behavioral/technical competency reconciliation.
 *
 *   cd sync-service && npx tsx src/verify-job-profile-competencies.ts
 *
 * The cases are the two real layouts these PDFs use, and the failure modes a
 * vision model actually produces on them:
 *
 *   - STACKED  (General Affair Coordinator): the two boxes sit one above the
 *     other, so a row-wise read keeps them apart and the usual damage is a
 *     dropped level.
 *   - SIDE BY SIDE (Sales/Marketing profiles): one visual row spans BOTH boxes,
 *     so a row-wise read interleaves them and technical names land among the
 *     behavioural ones.
 *
 * Needs no database and no model: `reconcileCompetencies` is pure, and the kamus
 * is passed in as a set.
 */
import {
  reconcileCompetencies,
  parseCompetencyLevel,
  isKnownBehavioral,
  normalizeCompetencyName,
} from "./services/job-profile-competencies.js";

let pass = 0;
let fail = 0;
function ok(name: string, condition: boolean, extra = "") {
  if (condition) {
    pass++;
    console.log("  ok   " + name);
  } else {
    fail++;
    console.log("  FAIL " + name + (extra ? "  — " + extra : ""));
  }
}

// The technical dictionary, as it would come back from sync_kamus_kompetensi.
const KAMUS = new Set(
  [
    "Budgeting",
    "Document Administration",
    "Facility Management",
    "Product and Service Knowledge",
    "Performance Management",
    "Procurement Management",
    "Software Application Operation",
    "Vendor Management",
    "Consumer Engagement Techniques",
    "Sales Management (Account & Dealer)",
    "Workshop Management",
    "Marketing Communication",
    "Risk Management",
    "Project Management",
  ].map(normalizeCompetencyName),
);

console.log("\nLevel parsing");
{
  ok("integer passes through", parseCompetencyLevel(3) === 3);
  ok("numeric string", parseCompetencyLevel("2") === 2);
  ok('"Level 4"', parseCompetencyLevel("Level 4") === 4);
  ok('"2 = Intermediate"', parseCompetencyLevel("2 = Intermediate") === 2);
  ok("word form Basic -> 1", parseCompetencyLevel("Basic") === 1);
  ok("word form Expert -> 4", parseCompetencyLevel("Expert") === 4);
  ok("word wins over a stray digit", parseCompetencyLevel("Intermediate (level 2)") === 2);
  ok("null stays null", parseCompetencyLevel(null) === null);
  ok("empty string -> null", parseCompetencyLevel("") === null);
  ok("out of range -> null", parseCompetencyLevel(7) === null);
  ok("multi-digit is not harvested", parseCompetencyLevel("halaman 10") === null);
  // The prompt's own placeholder text used to be echoed back as a level.
  ok(
    "prompt placeholder is not a level",
    parseCompetencyLevel("Level kompetensi (1 = Basic / 2 = Intermediate)") === 1,
    "documents the known-lossy case: first legible token wins",
  );
}

console.log("\nBehavioural vocabulary");
{
  ok("Leadership is behavioural", isKnownBehavioral("Leadership"));
  ok("ampersand normalises", isKnownBehavioral("Target Setting & Monitoring"));
  ok("case-insensitive", isKnownBehavioral("team work"));
  ok("Performance Management is NOT behavioural", !isKnownBehavioral("Performance Management"));
  ok("Risk Management is NOT behavioural", !isKnownBehavioral("Risk Management"));
  ok("Project Management is NOT behavioural", !isKnownBehavioral("Project Management"));
}

console.log("\nLayout 1 — STACKED, clean read");
{
  const r = reconcileCompetencies(
    ["Passion for Excellence", "Leadership", "Customer Focus", "Target Setting & Monitoring"],
    [
      { competency: "Budgeting", level: 1 },
      { competency: "Performance Management", level: 1 },
      { competency: "Document Administration", level: 1 },
    ],
    KAMUS,
  );
  ok("behavioural kept", r.behavioral.length === 4);
  ok("technical kept", r.technical.length === 3);
  ok("levels preserved", r.technical.every((t) => t.level === 1));
  ok("a clean read produces no warnings", r.warnings.length === 0, JSON.stringify(r.warnings));
}

console.log("\nLayout 2 — SIDE BY SIDE, row-wise read interleaved the boxes");
{
  // What the model returns when it follows a visual row straight across:
  // technical names (with their levels) end up in the behavioural list.
  const r = reconcileCompetencies(
    [
      "Passion for Excellence",
      "Leadership",
      { competency: "Consumer Engagement Techniques", level: 1 },
      { competency: "Workshop Management", level: 1 },
    ],
    [{ competency: "Sales Management (Account & Dealer)", level: 3 }],
    KAMUS,
  );
  const techNames = r.technical.map((t) => t.competency);
  ok("technical rescued from the behavioural list", techNames.includes("Consumer Engagement Techniques"));
  ok("both rescued", techNames.includes("Workshop Management"));
  ok("their levels survive the move", r.technical.find((t) => t.competency === "Workshop Management")?.level === 1);
  ok("genuine behavioural untouched", r.behavioral.length === 2 && r.behavioral.includes("Leadership"));
  ok(
    "the move is reported, not silent",
    r.warnings.filter((w) => w.kind === "moved-to-technical").length === 2,
  );
  ok("behavioural list holds only strings", r.behavioral.every((b) => typeof b === "string"));
}

console.log("\nBehavioural name that leaked INTO the technical list");
{
  const r = reconcileCompetencies(
    ["Customer Focus"],
    [
      { competency: "Leadership", level: 2 },
      { competency: "Budgeting", level: 1 },
    ],
    KAMUS,
  );
  ok("moved back to behavioural", r.behavioral.includes("Leadership"));
  ok("not left among technical", !r.technical.some((t) => t.competency === "Leadership"));
  ok(
    "the spurious level is dropped with it",
    r.behavioral.every((b) => typeof b === "string"),
  );
  ok("real technical untouched", r.technical.some((t) => t.competency === "Budgeting" && t.level === 1));
  ok("reported", r.warnings.some((w) => w.kind === "moved-to-behavioral"));
}

console.log("\nMissing levels are surfaced, never guessed");
{
  const r = reconcileCompetencies(
    [],
    [
      { competency: "Budgeting", level: 1 },
      { competency: "Vendor Management", level: null },
      { competency: "Facility Management" },
    ],
    KAMUS,
  );
  ok("null level stays null", r.technical.find((t) => t.competency === "Vendor Management")?.level === null);
  ok("absent level stays null", r.technical.find((t) => t.competency === "Facility Management")?.level === null);
  ok("never defaulted to 2", !r.technical.some((t) => t.level === 2));
  ok("both reported", r.warnings.filter((w) => w.kind === "missing-level").length === 2);
}

console.log("\nSingle-column documents (one pair per row)");
{
  // Not every JD prints two pairs per row. The reconciliation is column-count
  // agnostic by construction — it sees a flat list, not a table — so this is
  // here to keep it that way, and to pin the failure a one-column document
  // provokes in the MODEL: inventing a second entry to fill the row.
  const r = reconcileCompetencies(
    ["Passion for Excellence", "Customer Focus", "Leadership"],
    [
      { competency: "Budgeting", level: 1 },
      { competency: "Vendor Management", level: 2 },
      { competency: "Facility Management", level: 3 },
    ],
    KAMUS,
  );
  ok("one-per-row behavioural read intact", r.behavioral.length === 3);
  ok("one-per-row technical read intact", r.technical.length === 3);
  ok(
    "each keeps its own level",
    r.technical.find((t) => t.competency === "Vendor Management")?.level === 2 &&
      r.technical.find((t) => t.competency === "Facility Management")?.level === 3,
  );
  ok("no warnings on a clean one-column read", r.warnings.length === 0, JSON.stringify(r.warnings));
}

console.log("\nOdd count: the last row is half empty");
{
  // A two-column table with an odd number of competencies ends on a row whose
  // right half is blank. The model must not pad it; if it does, the blank comes
  // through as an empty entry and is dropped rather than stored as "".
  const r = reconcileCompetencies(
    [],
    [
      { competency: "Budgeting", level: 1 },
      { competency: "Performance Management", level: 1 },
      { competency: "Project Management", level: 2 },
      { competency: "", level: null },
    ],
    KAMUS,
  );
  ok("three real entries kept", r.technical.length === 3);
  ok("the blank half-row is not stored", !r.technical.some((t) => t.competency === ""));
  ok("and is reported", r.warnings.some((w) => w.kind === "dropped-empty"));
}

console.log("\nModel padded a one-column row by repeating the name");
{
  // The failure the old prompt invited: told every row has two pairs, a model
  // reading a one-column table duplicates to fill the second slot.
  const r = reconcileCompetencies(
    [],
    [
      { competency: "Budgeting", level: 1 },
      { competency: "Budgeting", level: 1 },
      { competency: "Vendor Management", level: 2 },
    ],
    KAMUS,
  );
  ok("the padded duplicate is collapsed", r.technical.length === 2);
  ok("the surviving entry keeps its level", r.technical.find((t) => t.competency === "Budgeting")?.level === 1);
  ok("and the duplication is reported", r.warnings.some((w) => w.kind === "duplicate"));
}

console.log("\nUnknown names are left where the model put them");
{
  const r = reconcileCompetencies(
    ["Some Unlisted Behaviour"],
    [{ competency: "Some Unlisted Technical Skill", level: null }],
    KAMUS,
  );
  ok("unknown behavioural stays behavioural", r.behavioral.includes("Some Unlisted Behaviour"));
  ok(
    "unknown technical stays technical",
    r.technical.some((t) => t.competency === "Some Unlisted Technical Skill"),
  );
  ok("nothing invented", r.behavioral.length === 1 && r.technical.length === 1);
}

console.log("\nDuplicates from a half-read row are merged, keeping the level");
{
  const r = reconcileCompetencies(
    [],
    [
      { competency: "Budgeting", level: null },
      { competency: "Budgeting", level: 3 },
    ],
    KAMUS,
  );
  ok("one entry only", r.technical.length === 1);
  ok("the entry that carried the level wins", r.technical[0]!.level === 3);
}

console.log("\nDegraded inputs never throw");
{
  ok("null inputs", reconcileCompetencies(null, null, KAMUS).technical.length === 0);
  ok("string instead of array", reconcileCompetencies("x" as unknown, undefined, KAMUS).behavioral.length === 0);
  const empty = reconcileCompetencies([""], [{ competency: "  ", level: 1 }], KAMUS);
  ok("blank entries dropped", empty.behavioral.length === 0 && empty.technical.length === 0);
  ok("and reported", empty.warnings.filter((w) => w.kind === "dropped-empty").length === 2);
  // An empty kamus must still work — the level rule alone carries it.
  const noKamus = reconcileCompetencies(
    [{ competency: "Workshop Management", level: 1 }],
    [],
    new Set(),
  );
  ok(
    "empty kamus still rescues via the level rule",
    noKamus.technical.some((t) => t.competency === "Workshop Management"),
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
