import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { jsonrepair } from "jsonrepair";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const FLAG_DETAIL_SYSTEM_PROMPT = `You are a medical billing advocate. Generate detailed action guidance for a specific billing flag.

Given the flag type, plain English description, and bill context, generate:

1. call_script: A complete phone script the patient reads verbatim to call their insurer or provider.
   Structure:
   - Opening: identify yourself and the claim
   - State the issue clearly in one sentence
   - Legal basis if applicable (NSA / appeal rights)
   - Specific request (reprocess / appeal / remove the charge)
   - Closing: "Can you please confirm that in writing?"

2. pushback_script: What to say if they push back or deny the issue. 2-3 firm but polite responses.

3. next_steps: Ordered list of 3-5 concrete actions:
   - Who to call first and what number to use
   - What to say or reference on the call
   - What to do if no response within 30 days
   - Escalation path if needed
   - Collections protection note if relevant

4. educational_note: 2-3 paragraph plain English explanation of why this is a billing issue and what the law says. No jargon.

5. retaliation_note: One sentence reminding the patient that disputing a billing error is not the same as filing a claim — insurers cannot raise premiums or drop coverage for disputing a bill.

Output ONLY valid JSON, no markdown, no preamble:
{
  "call_script": string,
  "pushback_script": string,
  "next_steps": string[],
  "educational_note": string,
  "retaliation_note": string
}

Never use: fraud, illegal, criminal, lawsuit, sue.
Always end call_script with: "Can you please confirm that in writing?"
Use the patient's name and insurer name from context where provided.`;

function cleanJson(raw: string): string {
  let cleaned = raw.replace(/```(?:json)?\s*/gi, "").replace(/```/g, "");
  const start = cleaned.indexOf("{");
  if (start > 0) cleaned = cleaned.slice(start);
  const end = cleaned.lastIndexOf("}");
  if (end !== -1 && end < cleaned.length - 1) cleaned = cleaned.slice(0, end + 1);
  return cleaned.trim();
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { flag, bill_context } = body;

    if (!flag || !flag.flag_type) {
      return NextResponse.json({ error: "Invalid flag data." }, { status: 400 });
    }

    console.log(`[BillClarity] Flag detail requested: ${flag.flag_type}`);

    const userContent = `Flag type: ${flag.flag_type}
Confidence: ${flag.confidence}
Plain English: ${flag.plain_english}
Potential Savings: ${flag.potential_savings}
Line References: ${JSON.stringify(flag.line_references ?? [])}
Next Steps Summary: ${flag.next_steps_summary ?? ""}

Bill Context:
- Insurer: ${bill_context?.insurer_name ?? "Not available"}
- Patient: ${bill_context?.patient_name ?? "Not available"}
- Date of Service: ${bill_context?.primary_date_of_service ?? "Not available"}

Generate detailed action guidance for this billing flag.`;

    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1500,
      temperature: 0.3,
      system: FLAG_DETAIL_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userContent }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";

    let detail: unknown;
    try {
      detail = JSON.parse(jsonrepair(cleanJson(text)));
    } catch {
      return NextResponse.json(
        { error: "We couldn't generate the action plan. Please try again." },
        { status: 500 }
      );
    }

    console.log(`[BillClarity] Flag detail complete: ${flag.flag_type}`);
    return NextResponse.json(detail);
  } catch (err: unknown) {
    console.error("[BillClarity] Flag detail error:", err);
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }
}
