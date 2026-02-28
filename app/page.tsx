"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";

const LOADING_STEPS = [
  "Reading your bill...",
  "Checking for duplicate charges...",
  "Verifying the math...",
  "Checking No Surprises Act compliance...",
  "Preparing your results...",
];

export default function UploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0] ?? null;
    setFile(selected);
    setError(null);
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const dropped = e.dataTransfer.files?.[0] ?? null;
    if (dropped) {
      const allowed = ["application/pdf", "image/jpeg", "image/png"];
      if (!allowed.includes(dropped.type)) {
        setError("Please upload a PDF, JPG, or PNG file.");
        return;
      }
      setFile(dropped);
      setError(null);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      setError("Please select a file to upload.");
      return;
    }

    setLoading(true);
    setStepIndex(0);
    setError(null);

    const interval = setInterval(() => {
      setStepIndex((prev) => {
        if (prev < LOADING_STEPS.length - 1) return prev + 1;
        return prev;
      });
    }, 4000);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/analyze", {
        method: "POST",
        body: formData,
      });

      clearInterval(interval);

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Server error ${res.status}`);
      }

      const data = await res.json();
      sessionStorage.setItem("billclarity_results", JSON.stringify(data));
      router.push("/results");
    } catch (err: unknown) {
      clearInterval(interval);
      setLoading(false);
      setStepIndex(0);
      setError(
        err instanceof Error ? err.message : "Something went wrong. Please try again."
      );
    }
  }

  return (
    <main
      className="min-h-screen flex flex-col items-center justify-center px-4 py-16"
      style={{ backgroundColor: "#F8F7F5" }}
    >
      <div className="w-full max-w-lg">

        {/* Header */}
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-semibold text-slate-800 tracking-tight mb-3">
            Upload your medical bill or EOB
          </h1>
          <p className="text-slate-600 text-base leading-relaxed font-normal">
            We&apos;ll check it for common billing errors in about 30 seconds.
          </p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-md p-8">
          {loading ? (
            <div className="flex flex-col items-center py-8 gap-6">
              {/* Spinner */}
              <svg
                className="animate-spin h-10 w-10"
                style={{ color: "#0D9488" }}
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>

              {/* Step text */}
              <div className="text-center">
                <p className="text-slate-700 font-medium text-lg">
                  {LOADING_STEPS[stepIndex]}
                </p>
                <p className="text-slate-400 text-sm mt-1">
                  Step {stepIndex + 1} of {LOADING_STEPS.length}
                </p>
              </div>

              {/* Progress dots */}
              <div className="flex gap-2">
                {LOADING_STEPS.map((_, i) => (
                  <span
                    key={i}
                    className={`block h-2 w-2 rounded-full transition-all duration-300 ${
                      i <= stepIndex ? "bg-teal-600" : "bg-slate-200"
                    }`}
                  />
                ))}
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Drop zone */}
              <div
                className={`relative border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
                  dragOver
                    ? "border-teal-400 bg-teal-50"
                    : file
                    ? "border-emerald-400 bg-emerald-50"
                    : "border-slate-200 bg-slate-50 hover:border-teal-400 hover:bg-teal-50"
                }`}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                  onChange={handleFileChange}
                  className="sr-only"
                />

                {file ? (
                  <div className="space-y-1">
                    <div className="flex items-center justify-center gap-2 text-emerald-700">
                      <svg
                        className="h-5 w-5"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                      <span className="font-medium">File selected</span>
                    </div>
                    <p className="text-slate-600 text-sm">{file.name}</p>
                    <p className="text-slate-400 text-xs">
                      {(file.size / 1024 / 1024).toFixed(2)} MB — click to change
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <svg
                      className="mx-auto h-10 w-10 text-slate-400"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={1.5}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
                      />
                    </svg>
                    <p className="text-slate-600 font-medium">
                      Drop your file here or click to browse
                    </p>
                    <p className="text-slate-400 text-sm">PDF, JPG, or PNG accepted</p>
                  </div>
                )}
              </div>

              {/* Error */}
              {error && (
                <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-red-700 text-sm">
                  {error}
                </div>
              )}

              {/* Submit */}
              <button
                type="submit"
                disabled={!file}
                className="w-full py-3 px-6 disabled:bg-slate-200 disabled:cursor-not-allowed text-white font-medium rounded-full transition-colors text-base hover:bg-teal-700"
                style={file ? { backgroundColor: "#0D9488" } : undefined}
              >
                Check my bill
              </button>
            </form>
          )}
        </div>

        {/* Disclaimer */}
        <p className="mt-8 text-center text-xs text-slate-400 leading-relaxed max-w-md mx-auto">
          BillClarity is an educational tool only. We are not lawyers, medical professionals, or
          financial advisors. Nothing here constitutes legal, medical, or financial advice.
        </p>
      </div>
    </main>
  );
}
