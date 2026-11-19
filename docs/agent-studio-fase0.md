# Fase 0 — hasil uji kelayakan planner

> **⚠️ Modul yang diuji di sini dihapus dari `main`** dan tersimpan di branch
> `parked/agent-studio` — lihat
> [`docs/agent-studio-parked.md`](agent-studio-parked.md). Angka di bawah tetap
> berlaku sebagai hasil pengukuran, dan harness-nya (`scripts/agent-eval/`) utuh
> di branch itu; jalankan ulang sebelum mempercayainya kembali.

Probe untuk menjawab satu pertanyaan sebelum modul apa pun dibangun: **apakah model
yang tersedia mampu mengubah permintaan bahasa alami menjadi rencana kerja yang sah
dan benar?** Ambang yang ditetapkan di [`agent-studio.md`](agent-studio.md) §5 adalah
≥70% rencana sah. Jika di bawah itu, masalahnya model, dan 14 modul di atasnya
percuma dibangun dulu.

**Jawaban: layak.** 100% rencana sah, 93–95% benar, dengan model in-house yang sudah
dipakai aplikasi. Rincian, batasan, dan hal yang belum terjawab ada di bawah.

---

## 1. Yang diuji

| | |
|---|---|
| Orkestrasi | LangChain `ChatOpenAI` (`@langchain/openai`, sudah ada di repo) |
| Endpoint | `https://dev-apigw.mpm-motor.com/models/v1` — proxy LiteLLM, protokol OpenAI |
| Kosakata | 10 manifest tulis-tangan — [`lib/agent/registry/fase0-tools.ts`](../lib/agent/registry/fase0-tools.ts) |
| Kasus uji | 20 query Indonesia — [`scripts/agent-eval/golden.ts`](../scripts/agent-eval/golden.ts) |
| Kondisi dunia | fixture tetap — [`lib/agent/state/fase0-fixture.ts`](../lib/agent/state/fase0-fixture.ts) |
| Penilai | [`lib/agent/plan/validate.ts`](../lib/agent/plan/validate.ts) + pemeriksaan per-kasus |

Dua angka dilaporkan terpisah karena maknanya berbeda:

- **SAH** — rencana lolos validator: id tool ada, rujukan antar-langkah menunjuk field
  yang nyata, tanpa siklus, prasyarat terpenuhi. Artinya **aman dijalankan**.
- **BENAR** — sah *dan* mengerjakan hal yang tepat: tool yang seharusnya ada muncul,
  yang terlarang tidak, urutannya benar, parameternya tepat.

Rencana yang sah tapi salah tetap merusak — misalnya menjalankan scoring baru padahal
user hanya bertanya siapa tiga teratas.

### Apa yang sengaja **tidak** diuji

Batas ini penting saat membaca angkanya:

- **Skala registry.** 10 tool, bukan ~130. Seluruh registry masuk prompt; retrieval
  top-K yang dibutuhkan pada skala penuh belum teruji sama sekali.
- **Resolusi entitas.** Nama → id diberikan sebagai tabel jadi. Modul M3 tidak diuji.
- **Eksekusi.** Tidak ada satu pun tool yang benar-benar dijalankan; `handler`
  memang kosong. Probe ini murni tentang perencanaan.
- **Data nyata.** Kondisi dunia adalah fixture, supaya tiap kegagalan pasti berasal
  dari model dan hasilnya dapat diulang.

---

## 2. Kapabilitas endpoint

Diperiksa lebih dulu, dan menghasilkan dua kejutan yang mengubah rencana:

| Uji | Hasil |
|---|---|
| `GET /models` | **12 model**, bukan hanya `vllm/aira` — termasuk `vllm/aira-lite`, `hosted_vllm/openai/gpt-oss-20b`, `hosted_vllm/Qwen/Qwen3-VL-8B-Instruct-FP8`, dan beberapa `gemini/*` |
| Tool calling | **Didukung** `vllm/aira` (`finish_reason: tool_calls`) |
| `response_format: json_schema` | Diterima, tetapi tidak benar-benar dipaksakan |
| `response_format: json_object` | Diterima |
| `gemini/*` | **Rusak di gateway** — `SSLCertVerificationError` saat proxy menghubungi `generativelanguage.googleapis.com` |

Konsekuensi: kekhawatiran di [`agent-studio.md`](agent-studio.md) §M6 — "perlu endpoint
terpisah untuk model yang lebih kuat" — **tidak terbukti perlu**. Gateway yang sama sudah
menyediakan pilihan model, dan yang in-house pun sudah cukup.

---

## 3. Hasil

### 3.1 Baseline (aturan v1, mode tool, 1 ulangan)

| Model | Terurai | Sah | Benar | Rata-rata |
|---|---|---|---|---|
| `vllm/aira` | 100% | 100% | 80% | 1.531 ms |
| `hosted_vllm/openai/gpt-oss-20b` | 100% | 100% | 80% | 1.450 ms |
| `vllm/aira-lite` | 100% | 100% | 80% | **34.493 ms** |
| `gemini/gemini-3.5-flash` | 60% | 20% | 15% | 8.387 ms |

Angka Gemini **bukan** penilaian atas modelnya — mayoritas panggilan gagal di gateway
(SSL), dan yang lolos pun kehilangan seluruh argumen tool (`params: {}`). Model itu
tidak dapat dievaluasi lewat jalur ini.

### 3.2 Kestabilan (aturan v1, `vllm/aira`, 3 ulangan)

```
selalu benar 16/20 · selalu salah 4/20 · goyah 0
```

Kegagalan bersifat **sistematis, bukan keberuntungan**. Itulah yang membuatnya layak
diperbaiki — dan bisa dibuktikan bahwa perbaikannya berhasil.

### 3.3 Setelah aturan prompt diperbaiki (aturan v2, mode tool, 3 ulangan)

| Model | Sah | Benar | Kestabilan | Rata-rata |
|---|---|---|---|---|
| `vllm/aira` | 100% | **93%** | 18 selalu benar · 1 salah · 1 goyah | 1.838 ms |
| `hosted_vllm/openai/gpt-oss-20b` | 100% | **95%** | 19 selalu benar · 1 salah · 0 goyah | 1.852 ms |

Naik dari 80% **tanpa mengganti model**. Yang berubah hanya tiga aturan di
[`planner.ts`](../lib/agent/plan/planner.ts) (`SYSTEM_RULES_V2`), masing-masing lahir dari
kegagalan nyata di §3.2:

| Aturan | Menutup kegagalan |
|---|---|
| 10 — permintaan majemuk (ubah **dan** jalankan) harus dikerjakan keduanya | "scoring dengan menonjolkan aspek kinerja" hanya dikerjakan separuh |
| 11 — `patch` pada usulan konfigurasi tidak boleh kosong | usulan terbit dengan `patch: {}` — tidak berguna bagi peninjau |
| 12 — bertanya hanya bila tidak ada tindakan yang aman; parameter opsional pakai default + catat di `assumptions` | ambang bertanya tidak konsisten: dua query sama-sama tanpa program, satu dijalankan satu ditanyakan |

### 3.4 Per kemampuan (aturan v2, 3 ulangan)

| Kemampuan | `vllm/aira` | `gpt-oss-20b` |
|---|---|---|
| Pemetaan dasar | 100% | 100% |
| Rantai multilangkah (rujukan `$s1.runId`) | 100% | 100% |
| Penemuan entitas turunan (cari run dulu) | 100% | 100% |
| Ambiguitas (menolak menebak) | 100% | 100% |
| Prasyarat (sisipkan rebuild sebelum clustering) | 100% | 100% |
| Batas kosakata (menolak hal di luar tool) | 100% | 100% |
| Ketepatan parameter | 100% | 100% |
| **Kebijakan konfigurasi** | **67%** | **75%** |

### 3.5 Mode keluaran terstruktur (`vllm/aira`, aturan v2)

| Mode | Terurai | Sah | Benar | Putaran perbaikan |
|---|---|---|---|---|
| **`tool`** (function calling) | 100% | **100%** | **93%**¹ | **0** |
| `json_object` | 100% | 95% | 90% | 5 |
| `prompt` (tanpa batasan) | 100% | 95% | 90% | 5 |
| `json_schema` | 100% | 90% | 85% | 7 |

¹ `tool` diukur pada 3 ulangan; tiga mode lain pada 1 ulangan. Peringkatnya konsisten,
selisih tepatnya tidak sebanding persis.

Mode `tool` unggul di semua sisi sekaligus: paling sah, paling benar, dan satu-satunya
yang **tidak pernah** butuh putaran perbaikan — sehingga juga paling murah dan paling
cepat. Mode lain tetap berguna sebagai cadangan bila kelak dipakai backend yang tidak
mendukung function calling; jalur itu sudah ada di planner.

---

## 4. Temuan

**1. Kelayakan terjawab: bangun Fase 1.** Ambang ≥70% sah terlampaui jauh (100%), dan
93–95% rencana benar-benar mengerjakan hal yang tepat.

**2. Model in-house sudah cukup.** `vllm/aira` mencapai 93% dengan latensi ~1,8 detik.
Tidak perlu model eksternal, tidak perlu anggaran baru. Tetap sediakan
`AGENT_LLM_BASE_URL`/`AGENT_LLM_MODEL` supaya planner bisa dipindah tanpa menyentuh
chatbot analisis, tetapi biarkan kosong.

**3. Prompt jauh lebih menentukan daripada model.** 80% → 93% hanya dari tiga aturan.
`gpt-oss-20b` yang berbeda arsitektur pun bergerak 80% → 95% dari perubahan yang sama.
Ini mengonfirmasi klaim di [`agent-studio.md`](agent-studio.md) §M1: **anggaran terbesar
modul registry adalah menulis deskripsi dan aturan, bukan menulis kode.**

**4. Function calling wajib dipakai.** Selisihnya bukan sekadar akurasi: 0 putaran
perbaikan lawan 5–7. Pada eksekusi nyata itu berarti sepertiga lebih sedikit panggilan
LLM per rencana.

**5. `vllm/aira-lite` tidak boleh dipakai sebagai planner.** Akurasinya setara, tetapi
34 detik lawan 1,8 detik — 19× lebih lambat untuk hasil yang sama.

**6. `gemini/*` tidak dapat dipakai lewat gateway ini.** Sertifikat SSL pada sisi proxy
gagal diverifikasi saat menghubungi Google. Ini pekerjaan tim platform, dan tidak
menghalangi Fase 1 karena model in-house sudah memadai.

**7. Satu-satunya kegagalan tersisa persis berada di wilayah modul optimizer.** Kasus
yang selalu gagal adalah *"outlier job family 31%, terlalu banyak, tolong perbaiki"*:
model menjalankan ulang clustering **dengan parameter yang sama persis**, alih-alih
mengusulkan perubahan parameter BERTopic.

> Ini temuan paling berguna dari seluruh probe. Planner umum **tidak** menalar sendiri
> "outlier tinggi → naikkan `minClusterSize` / aktifkan `reduceOutliers`". Kemampuan itu
> harus datang dari M10 — objective terukur dan ruang parameter yang dideklarasikan —
> bukan diharapkan muncul dari perencanaan biasa. Menaruh optimasi di Fase 3, setelah
> sandbox konfigurasi, terbukti urutan yang benar.

**8. Keluaran cukup stabil, tetapi peninjauan rencana tetap perlu.** Nyaris tidak ada
kasus yang berubah-ubah hasilnya (0 dari 20 pada v1, 1 dari 20 pada v2). Panel review
rencana di M13 tetap wajib — bukan karena keacakan, melainkan karena 5–7% sisanya
konsisten salah dan hanya manusia yang akan menangkapnya.

**9. Validator terbukti bekerja sebagai umpan balik, bukan sekadar penjaga.** Pada mode
non-tool, putaran perbaikan mengangkat rencana yang semula tidak sah menjadi sah. Pada
mode tool ia tidak pernah terpakai — artinya ia murni jaring pengaman di sana.

**10. Risiko terbesar yang tersisa adalah skala kosakata.** Semua angka di atas berlaku
pada 10 tool yang seluruhnya muat di prompt. Pada ~130 tool, pemilihan tool menjadi
masalah retrieval, dan **tidak ada satu pun data di sini yang menjamin angkanya bertahan.**
Uji ulang harness ini begitu registry menembus ~30 tool.

---

## 5. Jawaban atas keputusan terbuka

Menjawab [`agent-studio.md`](agent-studio.md) §6:

| # | Keputusan | Status |
|---|---|---|
| 1 | Konteks eksekusi (tick-loop vs runner headless) | **Belum terjawab** — tidak diuji di Fase 0. Rekomendasi tetap tick-loop untuk v1 |
| 2 | Model planner | **Terjawab** — `vllm/aira` lewat gateway yang ada, mode function calling, aturan v2 |
| 3 | Aksi `destructive` masuk kosakata v1? | **Tidak perlu.** Model menolak permintaan di luar kosakata dengan benar 100%; tidak ada alasan menambah risiko |
| 4 | Siapa boleh memakai Studio | **Belum terjawab** — keputusan kebijakan, bukan teknis |
| 5 | Kepemilikan usulan konfigurasi | Data mendukung **memisahkan** usul dan terap: kepatuhan pada kebijakan konfigurasi hanya 67–75%, satu-satunya kemampuan di bawah 100%. Gate manusia di sini bukan formalitas |

---

## 6. Menjalankan ulang

```bash
# Baseline yang direkomendasikan
pnpm exec tsx scripts/agent-eval/run.ts --rules=v2 --mode=tool --repeat=3

# Bandingkan beberapa model
pnpm exec tsx scripts/agent-eval/run.ts --models=vllm/aira,hosted_vllm/openai/gpt-oss-20b --rules=v2

# Bandingkan mode keluaran
pnpm exec tsx scripts/agent-eval/run.ts --mode=json_object --rules=v2

# Bandingkan aturan prompt (v1 = sebelum perbaikan)
pnpm exec tsx scripts/agent-eval/run.ts --rules=v1 --repeat=3

# Laporan markdown
pnpm exec tsx scripts/agent-eval/run.ts --rules=v2 --out=hasil.md

# Cetak rencana mentah sebuah kasus untuk diagnosa
pnpm exec tsx scripts/agent-eval/inspect.ts g05
```

Kredensial diambil dari `.env` (`LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY`; ditimpa
`AGENT_LLM_*` bila diisi). Tidak menyentuh basis data — aman dijalankan kapan pun.

---

## 7. Kode yang lahir dari Fase 0

Bukan kode buangan; ini benih modul yang direncanakan.

| Berkas | Modul |
|---|---|
| [`lib/agent/registry/types.ts`](../lib/agent/registry/types.ts) | M1 — bentuk manifest, gabungan registry, render prompt |
| [`lib/agent/registry/fase0-tools.ts`](../lib/agent/registry/fase0-tools.ts) | M1 — 10 manifest pertama |
| [`lib/agent/plan/schema.ts`](../lib/agent/plan/schema.ts) | M5 — Workflow DSL |
| [`lib/agent/plan/planner.ts`](../lib/agent/plan/planner.ts) | M6 — planner + putaran perbaikan |
| [`lib/agent/plan/validate.ts`](../lib/agent/plan/validate.ts) | M7 — validator waktu-rencana, penurunan gate |
| [`lib/agent/state/fase0-fixture.ts`](../lib/agent/state/fase0-fixture.ts) | M2/M3 — pengganti sementara, diganti pada Fase 1 |
| [`scripts/agent-eval/`](../scripts/agent-eval/) | M14 — harness eval |

Belum ada `handler` yang terisi, belum ada tabel basis data, belum ada UI. Tidak ada
kode aplikasi yang berubah.

## 8. Langkah berikutnya untuk Fase 1

1. Ganti fixture dengan M2 (snapshot nyata) dan M3 (resolver nyata) — inilah bagian
   yang belum punya bukti apa pun.
2. Isi `handler` untuk sepuluh tool ini, memanggil server action yang sudah ada.
3. Bangun M8 (executor tick-loop) + M13 (panel review rencana) — tanpa itu, rencana
   hanya bisa dilihat, belum bisa dijalankan.
4. Jalankan ulang harness setelah registry menembus ~30 tool, sebelum melanjutkan.
