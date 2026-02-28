"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

// ── Types ─────────────────────────────────────────────────────────────────────

interface NextSteps {
  if_explanation_is_correct: string;
  if_call_works: string;
  if_provider_pushes_back: string;
  if_no_response_30_days: string;
  nsa_complaint_path: string | null;
}

interface Flag {
  flag_id: string;
  flag_type: string;
  confidence: "high" | "medium";
  line_item_references: number[];
  plain_english_short: string;
  plain_english: string;
  educational_note: string;
  potential_savings: string;
  call_script: string;
  pushback_script: string;
  collections_script: string | null;
  retaliation_note: string;
  next_steps: NextSteps;
  requires_human_review: boolean;
}

interface CleanItem {
  line_number: number;
  reason: string;
}

interface ResultsSummary {
  headline: string;
  total_flags: number;
  total_potential_savings: string;
  high_confidence_flags: number;
  medium_confidence_flags: number;
  recommended_first_action: string;
  recommend_human_review: boolean;
}

interface Summary {
  total_flags: number;
  high_confidence_flags: number;
  medium_confidence_flags: number;
  total_potential_savings: string;
  recommend_human_review: boolean;
  result: "flags_found" | "clean" | "informational_only";
}

interface CleanBill {
  headline: string;
  line_reviews: unknown[];
  what_we_checked: string[];
  caveat: string;
}

interface TriageResult {
  results_page_banner: string;
  results_summary: ResultsSummary;
  flags: Flag[];
  clean_items: CleanItem[];
  clean_bill: CleanBill | null;
  triage_notes: string[];
  summary: Summary;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function humanizeFlagType(flagType: string): string {
  return flagType
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}


function isNsaFlag(flagType: string): boolean {
  return flagType.startsWith("nsa_");
}

// ── Inner collapsible (call scripts / next steps) ──────────────────────────

function InlineCollapsible({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t border-slate-100 first:border-t-0">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between py-3 text-left text-sm text-slate-600 hover:text-slate-800 transition-colors"
      >
        <span className={open ? "font-medium text-slate-800" : ""}>{label}</span>
        <svg
          className={`h-3.5 w-3.5 text-slate-400 transition-transform duration-200 shrink-0 ml-2 ${open ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="pb-4 border-l-4 border-teal-100 pl-3">
          {children}
        </div>
      )}
    </div>
  );
}

// ── Outer collapsible (clean items / triage notes) ─────────────────────────

function SectionCollapsible({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-6 py-4 text-left hover:bg-slate-50 transition-colors"
      >
        <span className="font-semibold text-slate-800">{title}</span>
        <svg
          className={`h-4 w-4 text-slate-400 transition-transform duration-200 shrink-0 ${open ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="px-6 pb-5 border-t border-slate-100">{children}</div>
      )}
    </div>
  );
}

// ── Flag card ─────────────────────────────────────────────────────────────────

function FlagCard({ flag }: { flag: Flag }) {
  const [expanded, setExpanded] = useState(false);
  const isNsa = isNsaFlag(flag.flag_type);
  const isHigh = flag.confidence?.toLowerCase() === "high";

  return (
    <div className="bg-white rounded-2xl shadow-sm overflow-hidden border border-slate-200">
      {/* Always-visible header */}
      <div className="px-6 pt-5 pb-5">
        {/* Confidence badge */}
        <div className="flex items-center gap-2 mb-3">
          <span
            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wide border ${
              isHigh
                ? "bg-amber-50 text-amber-700 border-amber-200"
                : "bg-slate-50 text-slate-500 border-slate-200"
            }`}
          >
            {isHigh ? "Worth checking" : "May be worth checking"}
          </span>
        </div>

        {/* Flag type label */}
        <p className="text-xs uppercase tracking-wider text-slate-400 mb-1.5">
          {humanizeFlagType(flag.flag_type)}
        </p>

        {/* Summary text */}
        <p className="text-slate-800 text-base leading-relaxed font-normal">
          {flag.plain_english_short || flag.plain_english}
        </p>

        {/* Potential savings */}
        <p className="mt-3 text-sm text-slate-500">
          Potential savings:{" "}
          <span className="font-bold text-emerald-600 text-lg">{flag.potential_savings}</span>
        </p>

        {/* Primary CTA */}
        <div className="mt-4">
          <button
            onClick={() => setExpanded((e) => !e)}
            className={`w-full py-3 rounded-full font-medium text-sm transition-colors ${
              expanded
                ? "border border-teal-600 text-teal-600 bg-white hover:bg-teal-50"
                : "text-white hover:bg-teal-700"
            }`}
            style={!expanded ? { backgroundColor: "#0D9488" } : undefined}
          >
            {expanded ? "Show less" : "What should I do about this?"}
          </button>
        </div>
      </div>

      {/* Expanded content */}
      {expanded && (
        <>
          <div className="border-t border-slate-100 mx-6" />

          <div className="px-6 pt-4 pb-1">
            {/* Full plain english */}
            <p className="text-slate-800 text-base leading-relaxed font-normal mb-4">
              {flag.plain_english}
            </p>

            {/* Educational note */}
            <p className="text-sm text-slate-600 leading-relaxed font-normal mb-4">
              {flag.educational_note}
            </p>

            <InlineCollapsible label="See call script">
              <div className="font-mono text-sm text-slate-700 bg-slate-50 rounded-lg p-4 whitespace-pre-line">
                {flag.call_script}
              </div>
            </InlineCollapsible>

            <InlineCollapsible label="If they push back">
              <div className="font-mono text-sm text-slate-700 bg-slate-50 rounded-lg p-4 whitespace-pre-line">
                {flag.pushback_script}
              </div>
            </InlineCollapsible>

            <InlineCollapsible label="Next steps">
              <div className="space-y-4 text-sm leading-relaxed">
                {flag.next_steps.if_explanation_is_correct && (
                  <div>
                    <p className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-1">
                      If the explanation is correct
                    </p>
                    <p className="text-slate-700">{flag.next_steps.if_explanation_is_correct}</p>
                  </div>
                )}
                {flag.next_steps.if_call_works && (
                  <div>
                    <p className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-1">
                      If the call works
                    </p>
                    <p className="text-slate-700">{flag.next_steps.if_call_works}</p>
                  </div>
                )}
                {flag.next_steps.if_provider_pushes_back && (
                  <div>
                    <p className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-1">
                      If the provider pushes back
                    </p>
                    <p className="text-slate-700">{flag.next_steps.if_provider_pushes_back}</p>
                  </div>
                )}
                {flag.next_steps.if_no_response_30_days && (
                  <div>
                    <p className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-1">
                      If no response in 30 days
                    </p>
                    <p className="text-slate-700">{flag.next_steps.if_no_response_30_days}</p>
                  </div>
                )}
                {flag.next_steps.nsa_complaint_path && (
                  <div>
                    <p className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-1">
                      Filing a complaint
                    </p>
                    <p className="text-slate-700">{flag.next_steps.nsa_complaint_path}</p>
                  </div>
                )}
                {isNsa && flag.collections_script && (
                  <div className="pt-2 border-t border-slate-100">
                    <p className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-1">
                      If this goes to collections (NSA disputes only)
                    </p>
                    <p className="text-slate-700">{flag.collections_script}</p>
                  </div>
                )}
              </div>
            </InlineCollapsible>
          </div>

          {/* Human review + retaliation note */}
          <div className="px-6 pt-2 pb-5">
            <div className="border-t border-slate-100 pt-3 space-y-2">
              {flag.requires_human_review && (
                <p className="text-xs text-slate-400 leading-relaxed">
                  Complex cases like this may benefit from a billing advocate.
                </p>
              )}
              <p className="text-xs text-slate-400 italic leading-relaxed">
                {flag.retaliation_note}
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ResultsPage() {
  const [data, setData] = useState<TriageResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    const raw = sessionStorage.getItem("billclarity_results");
    if (!raw) {
      setError("No results found. Please upload a bill first.");
      return;
    }
    try {
      setData(JSON.parse(raw));
    } catch {
      setError("Failed to load results. Please try again.");
    }
  }, []);

  if (error) {
    return (
      <main
        className="min-h-screen flex flex-col items-center justify-center px-4"
        style={{ backgroundColor: "#F8F7F5" }}
      >
        <div className="bg-white rounded-2xl shadow-md p-8 max-w-md w-full text-center space-y-4">
          <p className="text-slate-600">{error}</p>
          <button
            onClick={() => router.push("/")}
            className="px-6 py-2.5 text-white font-semibold rounded-full transition-colors text-sm hover:bg-teal-700"
            style={{ backgroundColor: "#0D9488" }}
          >
            Upload a bill
          </button>
        </div>
      </main>
    );
  }

  if (!data) {
    return (
      <main
        className="min-h-screen flex items-center justify-center"
        style={{ backgroundColor: "#F8F7F5" }}
      >
        <svg
          className="animate-spin h-8 w-8"
          style={{ color: "#0D9488" }}
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      </main>
    );
  }

  const isClean = data.summary.result === "clean";
  const isInfoOnly = data.summary.result === "informational_only";
  const hasFlags = data.flags && data.flags.length > 0;
  const highCount = data.flags?.filter(f => f.confidence?.toLowerCase() === "high").length ?? 0;
  const mediumCount = data.flags?.filter(f => f.confidence?.toLowerCase() === "medium").length ?? 0;

  return (
    <main
      className="min-h-screen px-4 py-10 sm:py-14"
      style={{ backgroundColor: "#F8F7F5" }}
    >
      <div className="max-w-lg mx-auto space-y-6">

        {/* 1. Banner */}
        <div className="bg-white rounded-2xl border-t-4 border-emerald-500 px-6 py-4 text-center shadow-sm">
          <p className="text-slate-600 text-base leading-relaxed italic">
            Medical bills are confusing — that&apos;s not your fault. Here&apos;s what we found.
          </p>
        </div>

        {/* 2. Summary card */}
        <div
          className={`bg-white rounded-2xl shadow-md px-6 py-6 border-t-4 ${
            isClean
              ? "border-emerald-400"
              : isInfoOnly
              ? "border-slate-200"
              : "border-amber-400"
          }`}
        >
          <h2 className="text-xl font-semibold text-slate-800 mb-5 leading-snug">
            {data.results_summary.headline}
          </h2>

          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="bg-slate-50 rounded-xl p-4">
              <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">Items to check</p>
              <p className="text-2xl font-bold text-slate-800">
                {data.results_summary.total_flags}
              </p>
              {data.results_summary.total_flags > 0 && (
                <p className="text-xs text-slate-400 mt-1">
                  {highCount} high ·{" "}
                  {mediumCount} medium
                </p>
              )}
            </div>

            <div className="bg-slate-50 rounded-xl p-4">
              <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">Potential savings</p>
              <p className="text-3xl font-bold text-emerald-600">
                {data.results_summary.total_potential_savings}
              </p>
            </div>
          </div>

          <div className="bg-slate-50 rounded-xl p-4">
            <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">Where to start</p>
            <p className="text-sm text-slate-700 leading-relaxed font-normal">
              {data.results_summary.recommended_first_action}
            </p>
          </div>

          {data.results_summary.recommend_human_review && (
            <p className="mt-3 text-xs text-slate-400 italic">
              This bill may benefit from a professional billing advocate. We&apos;ve noted where below.
            </p>
          )}
        </div>

        {/* 3. Flag cards */}
        {hasFlags && (
          <section className="space-y-6 pt-2">
            <p className="text-sm font-medium text-slate-500 px-1">
              {data.flags.length === 1
                ? "1 item worth asking about"
                : `${data.flags.length} items worth asking about`}
            </p>
            {data.flags.map((flag) => (
              <FlagCard key={flag.flag_id} flag={flag} />
            ))}
          </section>
        )}

        {/* Clean bill */}
        {isClean && data.clean_bill && (
          <div className="bg-white rounded-2xl shadow-sm px-6 py-5 border-l-4 border-emerald-400">
            <p className="font-semibold text-slate-800 mb-3">{data.clean_bill.headline}</p>
            {data.clean_bill.what_we_checked.length > 0 && (
              <ul className="space-y-2 mb-3">
                {data.clean_bill.what_we_checked.map((item, i) => (
                  <li key={i} className="flex items-start gap-3 text-sm text-slate-600 leading-relaxed">
                    <span className="shrink-0 mt-1.5 h-2 w-2 rounded-full bg-emerald-400" />
                    {item}
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-slate-400 italic">{data.clean_bill.caveat}</p>
          </div>
        )}

        {/* 4. What looked correct */}
        {data.clean_items && data.clean_items.length > 0 && (
          <SectionCollapsible
            title={`What looked correct on your bill (${data.clean_items.length})`}
          >
            <ul className="space-y-3 pt-4">
              {data.clean_items.map((item, i) => (
                <li key={i} className="flex items-start gap-3 text-sm text-slate-600 leading-relaxed">
                  <span className="shrink-0 mt-1.5 h-2 w-2 rounded-full bg-emerald-300" />
                  {item.reason}
                </li>
              ))}
            </ul>
          </SectionCollapsible>
        )}

        {/* 5. Additional notes */}
        {data.triage_notes && data.triage_notes.length > 0 && (
          <SectionCollapsible title="Additional notes">
            <ul className="space-y-3 pt-4">
              {data.triage_notes.map((note, i) => (
                <li key={i} className="flex items-start gap-3 text-sm text-slate-600 leading-relaxed">
                  <span className="shrink-0 mt-2 h-1.5 w-1.5 rounded-full bg-slate-300" />
                  {note}
                </li>
              ))}
            </ul>
          </SectionCollapsible>
        )}

        {/* 6. Footer */}
        <div className="pt-8 pb-4 flex flex-col items-center gap-6">
          <button
            onClick={() => {
              sessionStorage.removeItem("billclarity_results");
              router.push("/");
            }}
            className="px-8 py-3 bg-white hover:bg-slate-50 text-slate-600 font-medium rounded-full border border-slate-300 transition-colors text-sm"
          >
            Check another bill
          </button>

          <p className="text-center text-xs text-slate-400 leading-relaxed max-w-sm">
            BillClarity is an educational tool only. We are not lawyers, medical professionals, or
            financial advisors. Nothing here constitutes legal, medical, or financial advice.
          </p>
        </div>

      </div>
    </main>
  );
}
