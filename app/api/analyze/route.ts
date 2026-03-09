import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { jsonrepair } from "jsonrepair";
import sharp from "sharp";
import { traceable } from "langsmith/traceable";
import { anthropicClient } from "@/lib/anthropic";
import { cleanJson } from "@/lib/clean-json";

const client = anthropicClient;

const EXTRACTION_SYSTEM_PROMPT = `You are a medical billing data extraction specialist. Extract structured data from the medical bill or EOB provided. Return ONLY valid JSON, no markdown, no preamble.

Schema:
{
  document_type: EOB|itemised_bill|provider_bill|unknown,
  document_status: bill|informational_only|unknown,
  patient_name: string|null,
  date_range: { from: string|null, to: string|null },
  plan_type: PPO|HMO|HDHP|EPO|self_funded|unknown,
  insurer_name: string|null,
  summary: {
    total_billed: number|null,
    total_allowed: number|null,
    plan_paid: number|null,
    deductible_applied: number|null,
    coinsurance_applied: number|null,
    copay_applied: number|null,
    member_responsibility: number|null,
    oop_max: number|null,
    oop_accumulated: number|null
  },
  line_items: [{
    line_number: number,
    cpt_code: string|null,
    cpt_modifiers: string[],
    description: string|null,
    date_of_service: string|null,
    place_of_service_code: string|null,
    billing_provider: string|null,
    billing_provider_specialty: string|null,
    in_network: boolean|null,
    amount_billed: number|null,
    amount_allowed: number|null,
    plan_paid: number|null,
    patient_responsibility: number|null,
    adjustment_reason_code: string|null,
    adjustment_reason_description: string|null,
    zero_payment_flag: boolean
  }],
  extraction_notes: string[],
  extraction_confidence: high|medium|low
}

Rules: all monetary values as numbers without symbols. Null if not present, never guess. document_status = informational_only if document contains 'this is not a bill'. zero_payment_flag = true if plan_paid=0 AND amount_allowed>0. If oop_accumulated >= 0.9 x oop_max add to extraction_notes: OOP PROXIMITY WARNING.`;

const TRIAGE_SYSTEM_PROMPT = `You are BillClarity's billing triage engine. Receive extraction JSON and identify potential billing errors. Return ONLY valid JSON, no markdown, no preamble. Frame everything as may be worth asking about, never as definitive error.

EXECUTION RULE: You must run ALL checks 1 through 8 on every call without exception. Running fewer than 8 checks is an incomplete and incorrect response. FLAG ORDER (below) controls output sequence only — it does not control which checks to run. All 8 checks always run.

---

CHECK 1 — OOP PROXIMITY AND MAXIMUM:
Requires oop_accumulated and oop_max to both be non-null.

If oop_accumulated >= oop_max AND member_responsibility > 0 → generate oop_max_violation flag, confidence 'high'. plain_english: "You've exceeded your $[oop_max] out-of-pocket maximum — you may not owe the $[member_responsibility] shown on this EOB."

Else if oop_accumulated >= 0.9 × oop_max → generate oop_proximity flag, confidence 'medium'. plain_english_short must use exactly: "You're $[oop_max minus oop_accumulated] away from your $[oop_max] out-of-pocket maximum — future care may be fully covered."

If neither condition is met → no flag. Do not skip this check.

---

CHECK 2 — DUPLICATE CHARGES:
Same cpt_code + date_of_service + billing_provider on two or more lines → duplicate_charge flag, confidence 'high'.

Skip if: adjustment_reason_code contains corrected/MA130/N522, or if modifiers differ between the two lines.

potential_savings = patient_responsibility of the second occurrence only, formatted as "up to $X.XX". Never sum both lines. Never use amount_allowed. line_references = second occurrence line_number only.

---

CHECK 3 — NSA EMERGENCY VIOLATION:
For every line where place_of_service_code = '23' AND in_network = false AND billing_provider_specialty contains emergency medicine/urgent care OR description contains emergency department visit/emergency care → generate one nsa_emergency_violation flag per unique billing_provider, confidence 'high'.

Do NOT apply to anesthesia, radiology, pathology, or laboratory lines at POS 23 — those are handled in CHECK 4.

---

CHECK 4 — NSA ANCILLARY VIOLATION:
First confirm an in-network anchor exists: at least one line with in_network = true at POS 21, 22, or 23.

Then for each OON line where billing_provider_specialty contains anesthesia/radiology/pathology/laboratory/lab → generate one nsa_ancillary_violation flag per unique billing_provider, confidence 'high'.

This includes anesthesia/radiology/pathology/lab lines at POS 23 (ER setting).

CRITICAL: one billing_provider = one flag. Never group multiple providers. Never combine radiology and lab. Three OON ancillary providers = three flags.

---

CHECK 5 — NSA AIR AMBULANCE:
cpt_code in A0430/A0431/A0435/A0436 AND in_network = false → nsa_air_ambulance flag, confidence 'high'. Never flag ground ambulance.

---

CHECK 6 — WRONG PLACE OF SERVICE:
Flag as possible_wrong_pos, confidence 'medium', in either case:

(A) place_of_service_code = 21 or 22 AND description contains any of: office visit, consultation, follow-up, routine exam, preventive care, telehealth, established patient. plain_english: "This [service type] was billed as an inpatient hospital service — if it was outpatient, the billing code may be wrong and could affect your cost."

(B) place_of_service_code = 11 AND other lines on the same claim have POS 21/22/23.

potential_savings = patient_responsibility of the flagged line formatted as "up to $X.XX". Never use "Unknown" or any non-numeric value.

Do NOT flag if any of these apply:
- THIS SPECIFIC LINE already has a coverage_denial flag — check line_number match, not claim-level. A coverage_denial on Line 8 does not prevent possible_wrong_pos on Line 10. Each line is evaluated independently for this exception.
- Description contains: x-ray, radiology, imaging, CT, MRI, scan, diagnostic imaging, contrast study, ultrasound
- billing_provider_specialty contains: radiology, anesthesia, pathology

---

CHECK 7 — ZERO PAYMENT AND COVERAGE DENIAL:
For any line where zero_payment_flag = true:

If adjustment contains prior-auth/CO-197 → coverage_denial flag, confidence 'high'. potential_savings = patient_responsibility of the denied line formatted as "up to $X.XX". appeals_deadline = denial date + 180 days.

If adjustment contains deductible/copay → clean_item. If adjustment contains not covered → triage_note only. Otherwise → possible_processing_error flag, confidence 'medium'.

---

CHECK 8 — MATH VERIFICATION:
THIS CHECK IS MANDATORY. Run after checks 1-7. Always execute regardless of how many flags have already been generated. Never skip.

Step 1: Add every patient_responsibility value from every line item in the extraction JSON. Compute the exact arithmetic sum.

Step 2: Compare to summary.member_responsibility.

Step 3: If the absolute difference is strictly greater than $1.00 → create math_error flag, confidence 'high'. potential_savings = difference formatted as "up to $X.XX". plain_english: "Your EOB states you owe $[member_responsibility] but the line items add up to $[computed_sum] — a difference of $[difference] that is worth questioning."

Step 4: If sum matches within $1.00 → no flag. Add to triage_notes: "Math check passed — patient responsibility total matches line item sum."

This is arithmetic only. Always complete it.

---

FLAG OUTPUT ORDER — this controls sequence in the output array only. It does not affect which checks run. All 8 checks always run first, then output flags in this order:

1. coverage_denial
2. nsa_emergency_violation
3. nsa_ancillary_violation
4. nsa_air_ambulance
5. duplicate_charge
6. math_error
7. oop_max_violation or oop_proximity
8. possible_wrong_pos
9. possible_processing_error

---

CONFIDENCE RULES — never deviate:
nsa_emergency_violation → high
nsa_ancillary_violation → high
nsa_air_ambulance → high
coverage_denial → high
duplicate_charge → high
math_error → high
oop_max_violation → high
oop_proximity → medium
possible_wrong_pos → medium
possible_processing_error → medium

---

OUTPUT FORMAT — return exactly this JSON structure:

{
  results_page_banner: string,
  results_summary: {
    headline: string,
    total_flags: number,
    total_potential_savings: string,
    high_confidence_flags: number,
    medium_confidence_flags: number,
    recommended_first_action: string,
    recommend_human_review: boolean
  },
  flags: [{
    flag_id: string,
    flag_type: string,
    confidence: string,
    line_references: string[],
    plain_english_short: string,
    plain_english: string,
    potential_savings: string,
    next_steps_summary: string
  }],
  bill_context: {
    insurer_name: string,
    patient_name: string,
    primary_date_of_service: string
  },
  clean_items: [{
    line_number: string,
    reason: string
  }],
  clean_bill: {
    headline: string,
    line_reviews: string[],
    what_we_checked: string[],
    caveat: string
  } | null,
  triage_notes: string[],
  summary: {
    total_flags: number,
    high_confidence_flags: number,
    medium_confidence_flags: number,
    total_potential_savings: string,
    recommend_human_review: boolean,
    result: string
  }
}

---

RULES — always apply:

plain_english_short: one sentence, max 25 words total. Must state what happened and the dollar amount. No jargon.

plain_english: 2-3 sentences max.

next_steps_summary: 1-2 sentences only.

Provider names: always use the full provider name from the extraction JSON. Never truncate or abbreviate.

NSA savings: always "up to $X" never exact amount.

Never use: fraud, illegal, criminal, lawsuit, sue.

Include in every triage_notes: balance billing protection note and dispute payment guidance.

bill_context: populated from extraction JSON values.

OOP flag potential_savings: always exactly "Informational — no immediate savings, but important for future claims". Never deviate.`;

type PipelineSuccess = { ok: true; data: Record<string, unknown> };
type PipelineError = { ok: false; error: string; status: number };
type PipelineResult = PipelineSuccess | PipelineError;

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file uploaded." }, { status: 400 });
    }

    const allowedTypes = ["application/pdf", "image/jpeg", "image/png"];
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json(
        { error: "Only PDF, JPG, and PNG files are supported." },
        { status: 400 }
      );
    }

    const maxSize = 20 * 1024 * 1024; // 20 MB
    if (file.size > maxSize) {
      return NextResponse.json(
        { error: "File too large. Maximum size is 20 MB." },
        { status: 400 }
      );
    }

    const buffer = await file.arrayBuffer();

    // Compress images before sending to Claude (5 MB API limit)
    type ImageMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";
    type DocumentMediaType = "application/pdf";

    const isPdf = file.type === "application/pdf";
    let base64: string;
    const imageMediaType: ImageMediaType = "image/jpeg";

    if (!isPdf) {
      const compressed = await sharp(Buffer.from(buffer))
        .resize({ width: 1800, withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toBuffer();
      base64 = compressed.toString("base64");
    } else {
      base64 = Buffer.from(buffer).toString("base64");
    }

    // Build extraction content outside the trace to keep base64 out of LangSmith inputs
    let extractionContent: Anthropic.MessageParam["content"];

    if (isPdf) {
      extractionContent = [
        {
          type: "document",
          source: {
            type: "base64",
            media_type: "application/pdf" as DocumentMediaType,
            data: base64,
          },
        },
        {
          type: "text",
          text: "Extract all billing data from this document according to the schema.",
        },
      ];
    } else {
      extractionContent = [
        {
          type: "image",
          source: {
            type: "base64",
            media_type: imageMediaType,
            data: base64,
          },
        },
        {
          type: "text",
          text: "Extract all billing data from this document according to the schema.",
        },
      ];
    }

    // Wrap both LLM calls in a single parent trace. file_type and file_size_kb are
    // safe metadata — no base64 or patient data is passed as traceable inputs.
    const runAnalysisPipeline = traceable(
      async (): Promise<PipelineResult> => {
        // CALL 1 — EXTRACTION
        const extractionResponse = await client.messages.create({
          model: "claude-sonnet-4-5",
          max_tokens: 4000,
          temperature: 0,
          system: EXTRACTION_SYSTEM_PROMPT,
          messages: [{ role: "user", content: extractionContent }],
        });

        const extractionText =
          extractionResponse.content[0].type === "text"
            ? extractionResponse.content[0].text
            : "";

        let extractionJson: unknown;
        try {
          extractionJson = JSON.parse(jsonrepair(cleanJson(extractionText)));
        } catch {
          return {
            ok: false,
            error: "We couldn't read your bill's data. Please try again.",
            status: 500,
          };
        }

        // MODEL SELECTION — evaluate bill complexity from extraction output
        type ExtractionLineItem = {
          in_network: boolean | null;
          adjustment_reason_code: string | null;
        };
        type ExtractionResult = {
          extraction_confidence: string;
          line_items: ExtractionLineItem[];
        };
        const extraction = extractionJson as ExtractionResult;
        const lineItems: ExtractionLineItem[] = extraction.line_items ?? [];

        const isHighConfidence = extraction.extraction_confidence === "high";
        const hasOON = lineItems.some((item) => item.in_network === false);
        const hasPriorAuth = lineItems.some((item) => {
          const code = (item.adjustment_reason_code ?? "").toLowerCase();
          return (
            code.includes("co-197") ||
            code.includes("prior-auth") ||
            code.includes("prior auth")
          );
        });
        const isLargeBill = lineItems.length >= 8;

        let triageModel: string;
        let triageReason: string;

        if (hasOON) {
          triageModel = "claude-sonnet-4-5";
          triageReason = "OON providers detected";
        } else if (!isHighConfidence) {
          triageModel = "claude-sonnet-4-5";
          triageReason = "low/medium extraction confidence";
        } else if (hasPriorAuth) {
          triageModel = "claude-sonnet-4-5";
          triageReason = "prior auth denial detected";
        } else if (isLargeBill) {
          triageModel = "claude-sonnet-4-5";
          triageReason = "complex bill (8+ line items)";
        } else {
          triageModel = "claude-haiku-4-5-20251001";
          triageReason = "clean bill, high confidence, ≤7 lines";
        }

        console.log(
          `[BillClarity] Triage model selected: ${triageModel} — Reason: ${triageReason}`
        );

        // CALL 2 — TRIAGE
        const requestId = crypto.randomUUID();
        const triageResponse = await client.messages.create({
          model: triageModel,
          max_tokens: 4000, // slim schema — sufficient for any bill complexity
          temperature: 0,
          system: TRIAGE_SYSTEM_PROMPT,
          messages: [
            {
              role: "user",
              content: `Request ID: ${requestId}\n\nHere is the extracted billing data:\n\n${JSON.stringify(extractionJson, null, 2)}`,
            },
          ],
        });

        const triageText =
          triageResponse.content[0].type === "text"
            ? triageResponse.content[0].text
            : "";

        let triageJson: Record<string, unknown>;
        try {
          triageJson = JSON.parse(jsonrepair(cleanJson(triageText)));
        } catch {
          return {
            ok: false,
            error: "We couldn't complete the analysis. Please try again.",
            status: 500,
          };
        }

        // Fallback: construct summary if missing from triage response
        if (!triageJson.summary) {
          const flags = Array.isArray(triageJson.flags)
            ? (triageJson.flags as Record<string, unknown>[])
            : [];
          triageJson.summary = {
            result: flags.length > 0 ? "flags_found" : "clean",
            total_flags: flags.length,
            high_confidence_flags: flags.filter(
              (f) => String(f.confidence).toLowerCase() === "high"
            ).length,
            medium_confidence_flags: flags.filter(
              (f) => String(f.confidence).toLowerCase() === "medium"
            ).length,
            total_potential_savings: "unknown",
            recommend_human_review: false,
          };
          console.warn(
            "[BillClarity] summary field missing from triage response — fallback applied"
          );
        }

        // Deterministic post-processing — override model-generated counts and savings totals
        {
          type FlagRecord = Record<string, unknown>;
          const OOP_TYPES = new Set(["oop_proximity", "oop_max_violation"]);
          const flags = Array.isArray(triageJson.flags)
            ? (triageJson.flags as FlagRecord[])
            : [];
          const flagCount = flags.length;
          const nonOopFlags = flags.filter(
            (f) => !OOP_TYPES.has(String(f.flag_type))
          );

          // Parse "up to $1,260.00" → 1260.00; skip OOP flags and unparseable values
          const totalSavings = nonOopFlags.reduce((sum, f) => {
            const raw = String(f.potential_savings ?? "");
            const match = raw.replace(/,/g, "").match(/[\d]+(?:\.\d+)?/);
            if (!match) {
              console.warn(
                `[BillClarity] Could not parse potential_savings for flag ${f.flag_id ?? f.flag_type}: "${raw}" — treating as $0`
              );
              return sum;
            }
            return sum + parseFloat(match[0]);
          }, 0);

          const formattedSavings =
            totalSavings > 0
              ? `up to $${totalSavings.toLocaleString("en-US", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}`
              : "$0.00";

          // Overwrite both locations where these values appear
          const rs = triageJson.results_summary as
            | Record<string, unknown>
            | undefined;
          if (rs) {
            rs.total_flags = flagCount;
            rs.total_potential_savings = formattedSavings;
          }
          const sm = triageJson.summary as Record<string, unknown>;
          sm.total_flags = flagCount;
          sm.total_potential_savings = formattedSavings;

          console.log(
            `[BillClarity] Post-processed totals — flags: ${flagCount}, savings: ${formattedSavings}`
          );
        }

        // Inject debug metadata for results page
        triageJson._debug = { triage_model: triageModel, triage_reason: triageReason };

        return { ok: true, data: triageJson };
      },
      {
        name: "bill-analysis",
        run_type: "chain",
        metadata: {
          file_type: file.type,
          file_size_kb: Math.round(file.size / 1024),
        },
      }
    );

    const result = await runAnalysisPipeline();
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result.data);
  } catch (err: unknown) {
    console.error("BillClarity API error:", err);
    const message =
      err instanceof Error ? err.message : "An unexpected error occurred.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
