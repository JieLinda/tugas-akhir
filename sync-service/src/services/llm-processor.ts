/**
 * LLM-powered PDF processor — extracts structured job-profile data
 * from raw PDF text via a vLLM / OpenAI-compatible endpoint using LangChain.
 */
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { config } from "../config.js";
import type { ExtractedJobProfile } from "../types.js";

// ── LLM singletons, one per temperature ──────────────────────
//
// Keyed by temperature rather than a single instance, because a RETRY has to be
// able to differ from the attempt that failed. At temperature 0 the same images
// produce the same tokens, so re-sending a document whose JSON came back
// malformed reproduces the identical malformed JSON — the retry would cost
// another full vision call and buy nothing. Attempt 1 still runs at 0, which is
// what keeps a successful extraction reproducible.

const models = new Map<number, ChatOpenAI>();

function getModel(temperature = 0): ChatOpenAI {
  const existing = models.get(temperature);
  if (existing) return existing;
  const created = new ChatOpenAI({
    model: config.llm.model,
    configuration: {
      baseURL: config.llm.baseUrl,
      apiKey: config.llm.apiKey || "not-needed",
    },
    temperature
  });
  models.set(temperature, created);
  return created;
}

// ── System prompt ────────────────────────────────────────────

const SYSTEM_PROMPT = `Kamu adalah AI yang mengekstrak data terstruktur secara mendalam dan sangat akurat dari gambar dokumen Job Profile PT. Mitra Pinasthika Mulia.

Analisis gambar halaman-halaman dari dokumen Job Profile yang dilampirkan dan ekstrak seluruh datanya menjadi objek JSON yang valid dengan struktur yang dituntut secara tepat berikut:

{
  "documentInfo": {
    "documentNumber": "Nomor dokumen/nomor job profile (misalnya JD/MCD/022 atau sejenisnya)",
    "effectiveDate": "Tanggal efektif, format YYYY-MM-DD atau null jika tidak ada",
    "revision": "Nomor revisi jika ada (misal '0' atau '1' atau null)",
    "pageCount": "Jumlah total halaman atau null"
  },
  "jobIdentity": {
    "positionName": "Nama Jabatan (misalnya Marketing Communication Dept. Head)",
    "divisionDepartment": "Division / Department (misalnya Marketing Division / Marketing Communication)",
    "directSupervisor": "Atasan Langsung (misalnya Marketing Division Head)",
    "subordinates": ["Nama jabatan bawahan langsung 1", "Nama jabatan bawahan langsung 2"]
  },
  "organizationStructure": {
    "organizationChartSummary": "Deskripsi terperinci mengenai struktur/bagan organisasi berdasarkan dokumen"
  },
  "jobSpecification": {
    "education": "Minimal pendidikan (misalnya S1 / D3 Semua Jurusan)",
    "experience": "Syarat pengalaman kerja",
    "gender": "Persyaratan gender atau null jika tidak dibatasi",
    "skills": ["Keahlian/Sertifikasi 1", "Keahlian/Sertifikasi 2"]
  },
  "behavioralCompetencies": ["Nama kompetensi perilaku 1", "Nama kompetensi perilaku 2"],
  "technicalCompetencies": [{
    "competency": "Nama kompetensi teknis",
    "level": 1
  }],
  "authorities": [],
  "jobPurpose": "",
  "responsibilities": [
    {
      "responsibility": "Tanggung jawab utama / aktivitas penting jabatan",
      "successIndicator": "Indikator keberhasilan (KPI/indikator terkait tanggung jawab tersebut)"
    }
  ],
  "workingRelationships": {
    "internal": [],
    "external": []
  },
  "problemSolving": {
    "references": [],
    "approvalRequired": [],
    "challenges": []
  },
  "approvals": {
    "preparedBy": "Nama/Jabatan Pembuat dokumen",
    "checkedBy": "Nama/Jabatan Pemeriksa dokumen",
    "approvedBy": "Nama/Jabatan Penyetuju dokumen"
  }
}

Aturan Penting:
1. Gunakan teks asli dari dokumen — jangan menerjemahkannya atau mengubah bahasa istilah teknis.
2. Jangan melakukan asumsi atau menambahkan data di luar yang tercantum di gambar dokumen.
3. Kembalikan HANYA JSON yang valid, tanpa teks penjelasan tambahan, tanpa tanda kutip markdown di luar JSON (kembalikan raw JSON text atau di dalam standar markdown code block \`\`\`json).
4. Jika suatu field tidak tercantum, isi dengan null atau string kosong "" untuk string, atau array kosong [] untuk list/array.
5. Pastikan semua wewenang (authorities), kompetensi teknis (technicalCompetencies), kompetensi perilaku (behavioralCompetencies), tanggung jawab (responsibilities), hubungan kerja, dan pemecahan masalah diekstrak selengkap-lengkapnya.

ATURAN KHUSUS TABEL KOMPETENSI (bagian ini paling sering salah dibaca — baca dengan sangat teliti):

A. ADA DUA TABEL YANG TERPISAH, dan tata letaknya BERBEDA-BEDA antar dokumen:
   - Kadang kotak "BEHAVIORAL COMPETENCY" dan "TECHNICAL COMPETENCY" tersusun ATAS-BAWAH.
   - Kadang keduanya BERDAMPINGAN KIRI-KANAN dalam satu baris halaman.
   Apa pun tata letaknya, keduanya adalah tabel yang BERBEDA. JANGAN pernah membaca
   satu baris lurus melintasi halaman lalu menganggap isinya satu kelompok.
   Tentukan dulu batas setiap kotak dari JUDUL kotaknya ("BEHAVIORAL COMPETENCY" /
   "TECHNICAL COMPETENCY"), lalu baca isi tiap kotak secara terpisah.

B. CARA MEMBEDAKAN KEDUANYA — gunakan kolom angka:
   - Tabel TECHNICAL COMPETENCY punya kolom ANGKA LEVEL (1-4) di sebelah kanan
     setiap nama kompetensi.
   - Tabel BEHAVIORAL COMPETENCY TIDAK PERNAH punya kolom angka sama sekali.
   Jadi: ada angka level -> technicalCompetencies. Tidak ada kolom angka ->
   behavioralCompetencies.
   Yang menentukan adalah JUDUL KOTAK dan ada/tidaknya KOLOM angka pada tabel itu,
   bukan ada/tidaknya angka pada satu baris tertentu: sebuah sel level bisa saja
   tidak terbaca (lihat aturan D), dan itu tidak mengubah tabel asalnya.

C. JUMLAH KOLOM PER BARIS BERBEDA-BEDA ANTAR DOKUMEN. HITUNG DULU, JANGAN BERASUMSI.
   Ada dokumen yang menyusun tabelnya SATU pasangan per baris, ada yang DUA
   pasangan per baris. Keduanya normal dan keduanya harus dibaca apa adanya.

   Lihat dulu beberapa baris yang terisi penuh untuk menentukan polanya, lalu
   ikuti pola itu:
   - Satu pasangan per baris, behavioral: "Passion for Excellence" -> SATU entri.
   - Dua pasangan per baris, behavioral: "Passion for Excellence | Leadership"
     -> DUA entri terpisah: "Passion for Excellence" dan "Leadership".
   - Satu pasangan per baris, technical: "Budgeting | 1" -> SATU entri
     {"competency": "Budgeting", "level": 1}.
   - Dua pasangan per baris, technical: "Budgeting | 1 | Performance Management | 1"
     -> DUA entri terpisah: {"competency": "Budgeting", "level": 1} dan
     {"competency": "Performance Management", "level": 1}.

   Berlaku untuk semua pola: setiap angka level dipasangkan dengan nama kompetensi
   TEPAT DI SEBELAH KIRINYA dan di dalam kotak yang sama.

   JANGAN MEMAKSAKAN JUMLAH KOLOM. Bila sebuah baris hanya memuat satu nama —
   hal biasa pada dokumen satu kolom, dan pada baris terakhir dokumen dua kolom
   ketika jumlah kompetensinya ganjil — catat SATU entri saja. Jangan mengarang
   entri kedua, jangan menyalin nilai dari baris lain untuk mengisinya, dan
   jangan menggabungkan dua baris menjadi satu entri. Sel yang memang kosong
   diabaikan, bukan ditebak.

D. LEVEL WAJIB DIBACA. Angka level dicetak kecil dan mudah terlewat, tetapi ia
   menentukan hasil penilaian. Periksa ulang setiap baris technical dan pastikan
   setiap entri punya angkanya. Tulis level sebagai ANGKA (1, 2, 3, atau 4),
   bukan teks.
   Bila sebuah angka level benar-benar tidak terbaca, tulis null — JANGAN MENEBAK
   dan jangan mengisi angka default. null berarti "tidak terbaca" dan akan
   ditindaklanjuti; angka tebakan tidak bisa dibedakan dari angka asli.

E. JANGAN mencampur isi kedua tabel. Nama seperti "Leadership", "Communication",
   "Problem Solving", "Coaching", "Team Work", "Customer Focus", "Adaptability",
   "Target Setting & Monitoring" adalah kompetensi PERILAKU dan tidak boleh muncul
   di technicalCompetencies. Sebaliknya nama yang punya angka level — misalnya
   "Budgeting", "Vendor Management", "Software Application Operation" — adalah
   kompetensi TEKNIS dan tidak boleh muncul di behavioralCompetencies.

F. behavioralCompetencies adalah array STRING biasa (hanya nama), bukan objek.
   technicalCompetencies adalah array OBJEK {"competency": ..., "level": ...}.`;

// ── Public API ───────────────────────────────────────────────

/**
 * Send PDF pages as base64 images to the LLM and get back a structured job profile.
 */
export async function extractJobProfile(
  images: string[],
  opts: { temperature?: number } = {},
): Promise<ExtractedJobProfile> {
  const llm = getModel(opts.temperature ?? 0);

  const contentParts: any[] = [
    {
      type: "text",
      text: "Berikut adalah semua gambar halaman dari dokumen PDF Job Profile. Ekstrak data terstruktur darinya ke dalam format JSON yang tepat sesuai aturan sistem di atas.",
    },
  ];

  for (const imgBase64 of images) {
    contentParts.push({
      type: "image_url",
      image_url: {
        url: `data:image/png;base64,${imgBase64}`,
      },
    });
  }

  const response = await llm.invoke([
    new SystemMessage(SYSTEM_PROMPT),
    new HumanMessage({
      content: contentParts,
    }),
  ]);

  const content =
    typeof response.content === "string"
      ? response.content
      : JSON.stringify(response.content);

  // Extract JSON from the response (handle markdown fences, etc.)
  const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/) ||
                    content.match(/(\{[\s\S]*\})/);
  if (!jsonMatch) {
    throw new Error("LLM did not return valid JSON. Response content: " + content.substring(0, 500));
  }

  const raw = jsonMatch[1] ?? jsonMatch[0];
  try {
    return JSON.parse(raw) as ExtractedJobProfile;
  } catch (err) {
    // A bare "SyntaxError ... at position 2517" is not diagnosable: the raw
    // response is discarded here, so nobody can tell afterwards whether the
    // model truncated, dropped a closing bracket, or emitted a stray character.
    // Carry a window around the break point into the message that lands in
    // sync_job_profiles.error_message, plus the total length — a break AT the
    // end means the output stopped early, a break in the middle means it is
    // malformed, and those have different fixes.
    const at = Number(/position (\d+)/.exec(String(err))?.[1] ?? -1);
    const window =
      at >= 0
        ? raw.slice(Math.max(0, at - 120), Math.min(raw.length, at + 120))
        : raw.slice(-240);
    const atEnd = at >= 0 && raw.length - at <= 5;
    throw new Error(
      `${(err as Error).message} | panjang=${raw.length} ` +
        `${atEnd ? "(putus di UJUNG — keluaran model berhenti lebih awal)" : "(putus di TENGAH)"} ` +
        `| sekitar: …${window.replace(/\s+/g, " ")}…`,
    );
  }
}
