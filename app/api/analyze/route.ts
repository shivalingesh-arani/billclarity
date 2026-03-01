import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { jsonrepair } from "jsonrepair";
import sharp from "sharp";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

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

Run these checks:
CHECK 1 MATH: member_responsibility should equal sum of line_item patient_responsibility values. If the absolute difference is strictly greater than $1.00 → math_error flag. Rounding differences of $1.00 or less are normal due to insurance calculation methods and must never be flagged — $0.40, $0.50, $0.99 differences are all normal, do not flag these. If math checks out → do NOT create a flag; instead add to triage_notes: "Math check: patient responsibility total matches line item sum — no discrepancy found."
CHECK 2 OOP PROXIMITY: If oop_accumulated is not null AND oop_max is not null AND oop_accumulated >= 0.9 x oop_max → generate exactly one oop_proximity flag, confidence always 'medium'. This check is binary — either the threshold is met or it is not. Do not skip this check. If oop_accumulated >= oop_max AND member_responsibility > 0 → generate oop_max_violation flag instead, confidence always 'high'.
CHECK 3 DUPLICATES: same cpt_code + date_of_service + billing_provider on two lines → duplicate_charge flag. Skip if adjustment_reason_code contains corrected/MA130/N522 or if modifiers differ. For duplicate_charge flags, potential_savings = the patient_responsibility value of the duplicate line item (the second occurrence), formatted as "up to $X.XX". Never use amount_allowed for this calculation.
CHECK 4 NSA EMERGENCY: For every line where place_of_service_code = '23' AND in_network = false AND (billing_provider_specialty contains emergency/urgent care OR description contains emergency department visit/emergency care) → generate exactly one nsa_emergency_violation flag per unique billing_provider. Confidence is always 'high'. Do not group lines from different providers into one flag. Do NOT apply this check to radiology, pathology, laboratory, or anesthesia lines at POS 23 — those go to Check 5.
CHECK 5 NSA ANCILLARY: confirm in-network anchor exists (any line with in_network=true at POS 21/22/23). Then each OON line where specialty contains anesthesia/radiology/pathology/laboratory/lab → one nsa_ancillary_violation flag per provider. This includes radiology/pathology/lab/anesthesia lines at POS 23 (ER setting) — do not send those to Check 4. CRITICAL: Generate exactly one nsa_ancillary_violation flag per unique billing_provider value. Never group multiple providers into a single flag. Never combine radiology and lab into one flag. If three providers are OON ancillary, generate exactly three flags. Count: one billing_provider = one flag. Always.
CHECK 6 NSA AIR AMBULANCE: cpt_code in A0430/A0431/A0435/A0436 AND in_network=false → nsa_air_ambulance flag. Never flag ground ambulance.
CHECK 7 WRONG POS: place_of_service_code in 21/22 AND description contains office visit or follow-up AND specialty is not radiology/pathology/anesthesia → possible_wrong_pos flag, medium confidence. Exceptions — do NOT flag as wrong_pos if: (A) the same line already has a coverage_denial flag (adjustment_reason_code contains CO-197 or prior-auth), coverage denial takes priority; or (B) description contains x-ray/radiology/imaging/CT/MRI/scan or billing_provider_specialty contains radiology, imaging at outpatient hospital settings is legitimate.
CHECK 8 ZERO PAYMENT: zero_payment_flag=true. If adjustment contains prior-auth/CO-197 → coverage_denial flag with appeals deadline = denial date + 180 days. If adjustment contains deductible/copay → clean_item. If contains not covered → triage_note only. Otherwise → possible_processing_error flag.

After all checks: if 2+ flags share line_item_references → add triage_note ordering by priority. If 3+ flags share same date and POS → add triage_note recommending insurer-first strategy.

FLAG ORDER — always output flags in exactly this priority order, regardless of dollar amount: 1. coverage_denial 2. nsa_emergency_violation 3. nsa_ancillary_violation 4. nsa_air_ambulance 5. oop_max_violation or oop_proximity 6. duplicate_charge 7. math_error 8. possible_wrong_pos 9. possible_processing_error.

CONFIDENCE RULES — always apply exactly: nsa_emergency_violation → 'high'. nsa_ancillary_violation → 'high'. nsa_air_ambulance → 'high'. coverage_denial → 'high'. duplicate_charge → 'high'. math_error → 'high'. oop_max_violation → 'high'. oop_proximity → 'medium'. possible_wrong_pos → 'medium'. possible_processing_error → 'medium'. Never deviate from these assignments.

Output format:
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
    confidence: high|medium,
    line_references: string[],
    plain_english_short: string,
    plain_english: string,
    potential_savings: string,
    next_steps_summary: string
  }],
  bill_context: {
    insurer_name: string|null,
    patient_name: string|null,
    primary_date_of_service: string|null
  },
  clean_items: [{ line_number: number, reason: string }],
  clean_bill: { headline: string, line_reviews: array, what_we_checked: string[], caveat: string } | null,
  triage_notes: string[],
  summary: {
    total_flags: number,
    high_confidence_flags: number,
    medium_confidence_flags: number,
    total_potential_savings: string,
    recommend_human_review: boolean,
    result: flags_found|clean|informational_only
  }
}

Mandatory: results_summary before flags. Emotional opener on every output: Medical bills are confusing by design. State balance billing note in every triage_notes. Dispute payment guidance in every triage_notes. NSA savings always up to $X never exact. Never use: fraud, illegal, criminal, lawsuit, sue. Provider names: always use the full provider name from the extraction JSON — never truncate, abbreviate, or cut off mid-word. plain_english_short: one sentence, max 20 words before the dash and 10 words after, must state what happened and the dollar amount, no jargon. plain_english: 2-3 sentences max describing what happened and why it may be a problem. next_steps_summary: 1-2 sentences only — who to call first and what legal basis applies. bill_context: populate from the extraction JSON (insurer_name, patient_name, earliest date_of_service).

CRITICAL — OOP PROXIMITY PLAIN ENGLISH SHORT: For oop_proximity flags, plain_english_short must always use this exact template with values substituted from the extraction JSON: "You're $[oop_max minus oop_accumulated] away from your $[oop_max] out-of-pocket maximum — future care may be fully covered." Calculate the remaining amount as oop_max minus oop_accumulated. Never use a percentage. Never say "you've reached X%". Always use the dollar amount remaining. Example: if oop_max=$6,000 and oop_accumulated=$5,840, write: "You're $160 away from your $6,000 out-of-pocket maximum — future care may be fully covered."

CRITICAL — OOP FLAG SAVINGS: For oop_proximity and oop_max_violation flags, potential_savings must always be exactly this string with no deviation: "Informational — no immediate savings, but important for future claims". Never calculate a dollar amount for OOP flags. Never use any other wording. Copy this string exactly.

CRITICAL — TOTAL POTENTIAL SAVINGS: Calculate total_potential_savings in results_summary by summing the patient_responsibility values from the extraction JSON line_items for every line referenced by a non-OOP flag. Exclude all lines referenced only by oop_proximity or oop_max_violation flags. Do not use the potential_savings field of each flag — go back to the raw patient_responsibility value in the line_items array. Sum every referenced line once. Format as "up to $X,XXX.XX". If no non-OOP flags exist, use "$0.00". This calculation must be deterministic — the same bill must always produce the same total.`;

function cleanJson(raw: string): string {
  // Strip markdown code fences (```json ... ``` or ``` ... ```)
  let cleaned = raw.replace(/```(?:json)?\s*/gi, "").replace(/```/g, "");
  // Strip anything before the first {
  const start = cleaned.indexOf("{");
  if (start > 0) cleaned = cleaned.slice(start);
  // Strip anything after the last }
  const end = cleaned.lastIndexOf("}");
  if (end !== -1 && end < cleaned.length - 1) cleaned = cleaned.slice(0, end + 1);
  return cleaned.trim();
}

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

    // CALL 1 — EXTRACTION
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

    const extractionResponse = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 4000,
      temperature: 0,
      system: EXTRACTION_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: extractionContent,
        },
      ],
    });

    const extractionText =
      extractionResponse.content[0].type === "text"
        ? extractionResponse.content[0].text
        : "";

    // Parse extraction JSON
    let extractionJson: unknown;
    try {
      extractionJson = JSON.parse(jsonrepair(cleanJson(extractionText)));
    } catch {
      return NextResponse.json(
        { error: "We couldn't read your bill's data. Please try again." },
        { status: 500 }
      );
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
    const isSimpleSize = lineItems.length <= 4;
    const hasOON = lineItems.some((item) => item.in_network === false);
    const hasPriorAuth = lineItems.some((item) => {
      const code = (item.adjustment_reason_code ?? "").toLowerCase();
      return code.includes("co-197") || code.includes("prior-auth") || code.includes("prior auth");
    });

    let triageModel: string;
    let triageReason: string;

    if (isHighConfidence && isSimpleSize && !hasOON && !hasPriorAuth) {
      triageModel = "claude-haiku-4-5-20251001";
      triageReason = "simple bill, high confidence";
    } else if (hasOON) {
      triageModel = "claude-sonnet-4-5";
      triageReason = "OON providers detected";
    } else if (!isHighConfidence) {
      triageModel = "claude-sonnet-4-5";
      triageReason = "low/medium extraction confidence";
    } else if (hasPriorAuth) {
      triageModel = "claude-sonnet-4-5";
      triageReason = "prior auth denial detected";
    } else {
      triageModel = "claude-sonnet-4-5";
      triageReason = "complex bill (5+ line items)";
    }

    console.log(`[BillClarity] Triage model selected: ${triageModel} — Reason: ${triageReason}`);

    // CALL 2 — TRIAGE
    const triageMaxTokens = 4000; // slim schema — sufficient for any bill complexity
    const requestId = crypto.randomUUID();
    const triageResponse = await client.messages.create({
      model: triageModel,
      max_tokens: triageMaxTokens,
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
      triageResponse.content[0].type === "text" ? triageResponse.content[0].text : "";

    let triageJson: Record<string, unknown>;
    try {
      triageJson = JSON.parse(jsonrepair(cleanJson(triageText)));
    } catch {
      return NextResponse.json(
        { error: "We couldn't complete the analysis. Please try again." },
        { status: 500 }
      );
    }

    // Fallback: construct summary if missing from triage response
    if (!triageJson.summary) {
      const flags = Array.isArray(triageJson.flags) ? triageJson.flags as Record<string, unknown>[] : [];
      triageJson.summary = {
        result: flags.length > 0 ? "flags_found" : "clean",
        total_flags: flags.length,
        high_confidence_flags: flags.filter(f => String(f.confidence).toLowerCase() === "high").length,
        medium_confidence_flags: flags.filter(f => String(f.confidence).toLowerCase() === "medium").length,
        total_potential_savings: "unknown",
        recommend_human_review: false,
      };
      console.warn("[BillClarity] summary field missing from triage response — fallback applied");
    }

    // Inject debug metadata for results page
    triageJson._debug = { triage_model: triageModel, triage_reason: triageReason };

    return NextResponse.json(triageJson);
  } catch (err: unknown) {
    console.error("BillClarity API error:", err);
    const message =
      err instanceof Error ? err.message : "An unexpected error occurred.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
