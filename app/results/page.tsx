"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

// ── Types ─────────────────────────────────────────────────────────────────────

interface BillContext {
  insurer_name: string | null;
  patient_name: string | null;
  primary_date_of_service: string | null;
}

interface Flag {
  flag_id: string;
  flag_type: string;
  confidence: "high" | "medium";
  line_references: string[];
  plain_english_short: string;
  plain_english: string;
  potential_savings: string;
  next_steps_summary: string;
}

interface FlagDetail {
  call_script: string;
  pushback_script: string;
  next_steps: string[];
  educational_note: string;
  retaliation_note: string;
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
  bill_context: BillContext | null;
  clean_items: CleanItem[];
  clean_bill: CleanBill | null;
  triage_notes: string[];
  summary: Summary;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function humanizeFlagType(flagType: string): string {
  return (flagType ?? "")
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
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

function FlagCard({ flag, billContext }: { flag: Flag; billContext: BillContext | null }) {
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState<FlagDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const isHigh = flag.confidence?.toLowerCase() === "high";

  const handleExpand = async () => {
    const nowExpanded = !expanded;
    setExpanded(nowExpanded);
    if (nowExpanded && !detail && !detailLoading) {
      setDetailLoading(true);
      setDetailError(null);
      try {
        const res = await fetch("/api/flag-detail", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ flag, bill_context: billContext }),
        });
        if (!res.ok) throw new Error("Failed to load action plan.");
        const json = await res.json();
        if (json.error) throw new Error(json.error);
        setDetail(json as FlagDetail);
      } catch (err) {
        setDetailError(err instanceof Error ? err.message : "Could not load action plan.");
      } finally {
        setDetailLoading(false);
      }
    }
  };

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
            onClick={handleExpand}
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

            {/* Next steps summary — shown immediately */}
            {flag.next_steps_summary && (
              <p className="text-sm text-slate-600 leading-relaxed font-normal mb-4">
                {flag.next_steps_summary}
              </p>
            )}

            {/* Loading skeleton */}
            {detailLoading && (
              <div className="animate-pulse space-y-3 py-2 pb-4">
                <p className="text-xs text-slate-400 uppercase tracking-wide mb-3">
                  Preparing your action plan...
                </p>
                <div className="h-3 bg-slate-100 rounded w-3/4" />
                <div className="h-3 bg-slate-100 rounded w-full" />
                <div className="h-3 bg-slate-100 rounded w-5/6" />
                <div className="h-3 bg-slate-100 rounded w-2/3" />
              </div>
            )}

            {/* Error state */}
            {detailError && (
              <p className="text-sm text-slate-400 italic py-2 mb-2">{detailError}</p>
            )}

            {/* Detail content — shown after load */}
            {detail && (
              <>
                <InlineCollapsible label="See call script">
                  <div className="font-mono text-sm text-slate-700 bg-slate-50 rounded-lg p-4 whitespace-pre-line">
                    {detail.call_script}
                  </div>
                </InlineCollapsible>

                <InlineCollapsible label="If they push back">
                  <div className="font-mono text-sm text-slate-700 bg-slate-50 rounded-lg p-4 whitespace-pre-line">
                    {detail.pushback_script}
                  </div>
                </InlineCollapsible>

                {detail.next_steps && detail.next_steps.length > 0 && (
                  <InlineCollapsible label="Next steps">
                    <ol className="space-y-2 text-sm text-slate-700 leading-relaxed list-decimal list-inside">
                      {detail.next_steps.map((step, i) => (
                        <li key={i}>{step}</li>
                      ))}
                    </ol>
                  </InlineCollapsible>
                )}

                {detail.educational_note && (
                  <InlineCollapsible label="Why this matters">
                    <p className="text-sm text-slate-600 leading-relaxed">
                      {detail.educational_note}
                    </p>
                  </InlineCollapsible>
                )}
              </>
            )}
          </div>

          {/* Retaliation note */}
          {detail?.retaliation_note && (
            <div className="px-6 pt-2 pb-5">
              <div className="border-t border-slate-100 pt-3">
                <p className="text-xs text-slate-400 italic leading-relaxed">
                  {detail.retaliation_note}
                </p>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Flag error boundary ────────────────────────────────────────────────────────

class FlagErrorBoundary extends React.Component<
  { flagId: string; flagType: string; children: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: { flagId: string; flagType: string; children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(err: Error) {
    console.error(`[BillClarity] FlagCard render error — flag_id: ${this.props.flagId}, flag_type: ${this.props.flagType}`, err);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 px-6 py-4">
          <p className="text-sm text-slate-400 italic">
            This item could not be displayed — please review your bill manually.
          </p>
        </div>
      );
    }
    return this.props.children;
  }
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
      const parsed = JSON.parse(raw);
      console.log(`[BillClarity] Results loaded — flags: ${parsed.flags?.length ?? 0}`, parsed.flags?.map((f: Flag) => f.flag_type));
      setData(parsed);
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

  const isClean = data?.summary?.result === "clean";
  const isInfoOnly = data?.summary?.result === "informational_only";
  const hasFlags = (data?.flags?.length ?? 0) > 0;
  const highCount = data?.flags?.filter(f => f.confidence?.toLowerCase() === "high").length ?? 0;
  const mediumCount = data?.flags?.filter(f => f.confidence?.toLowerCase() === "medium").length ?? 0;
  const billContext = data.bill_context ?? null;

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
            {data.results_summary?.headline}
          </h2>

          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="bg-slate-50 rounded-xl p-4">
              <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">Items to check</p>
              <p className="text-2xl font-bold text-slate-800">
                {data.results_summary?.total_flags ?? 0}
              </p>
              {(data.results_summary?.total_flags ?? 0) > 0 && (
                <p className="text-xs text-slate-400 mt-1">
                  {highCount} high ·{" "}
                  {mediumCount} medium
                </p>
              )}
            </div>

            <div className="bg-slate-50 rounded-xl p-4">
              <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">Potential savings</p>
              <p className="text-3xl font-bold text-emerald-600">
                {data.results_summary?.total_potential_savings ?? "—"}
              </p>
            </div>
          </div>

          <div className="bg-slate-50 rounded-xl p-4">
            <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">Where to start</p>
            <p className="text-sm text-slate-700 leading-relaxed font-normal">
              {data.results_summary?.recommended_first_action}
            </p>
          </div>

          {data.results_summary?.recommend_human_review && (
            <p className="mt-3 text-xs text-slate-400 italic">
              This bill may benefit from a professional billing advocate. We&apos;ve noted where below.
            </p>
          )}
        </div>

        {/* 3. Flag cards */}
        {hasFlags && (
          <section className="space-y-6 pt-2">
            <p className="text-sm font-medium text-slate-500 px-1">
              {data.flags?.length === 1
                ? "1 item worth asking about"
                : `${data.flags?.length} items worth asking about`}
            </p>
            {data.flags?.map((flag, i) => (
              <FlagErrorBoundary key={flag.flag_id ?? i} flagId={flag.flag_id ?? String(i)} flagType={flag.flag_type ?? "unknown"}>
                <FlagCard flag={flag} billContext={billContext} />
              </FlagErrorBoundary>
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
