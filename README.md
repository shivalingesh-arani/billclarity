# BillClarity

AI-powered medical bill analysis. Upload a bill or EOB and get plain-English explanations of potential billing errors, NSA violations, duplicate charges, and more — with actionable call scripts to dispute them.

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Environment Variables

Create a `.env.local` file in the project root:

```
ANTHROPIC_API_KEY=...

# LangSmith tracing (optional — tracing is disabled when LANGSMITH_TRACING is unset or false)
LANGSMITH_TRACING=true
LANGSMITH_API_KEY=...
LANGSMITH_PROJECT=billclarity
```

Get a LangSmith API key at [smith.langchain.com](https://smith.langchain.com).

## How It Works

1. **Upload** — Patient uploads a PDF, JPG, or PNG of their medical bill or EOB
2. **Extraction** — Claude Sonnet reads the document and returns structured JSON (line items, amounts, codes)
3. **Model routing** — Bill complexity determines whether Sonnet or Haiku runs triage
4. **Triage** — 8 mandatory checks run (OOP proximity, duplicates, NSA violations, wrong POS, math verification, and more)
5. **Results** — Flags displayed with plain-English explanations and potential savings
6. **Action plan** — On click, Haiku generates a phone script, pushback script, and next steps for each flag

## Observability

LangSmith tracing is integrated across both API routes. When `LANGSMITH_TRACING=true`, every bill analysis produces a trace in LangSmith:

```
bill-analysis  (chain)
├── claude-sonnet-4-5       extraction    ~4-6s   input/output tokens tracked
└── claude-sonnet or haiku  triage        ~4-6s   input/output tokens tracked

flag-detail  (chain)
└── claude-haiku            action plan   ~2-3s
```

Traces capture `file_type`, `file_size_kb`, and `flag_type` as metadata. Base64 image data is excluded from traces. Tracing is a no-op when the env var is off — no performance impact in production.

## Commands

```bash
npm run dev       # Start dev server (localhost:3000)
npm run build     # Production build
npm run lint      # ESLint
npm run typecheck # TypeScript check
```

## Stack

- Next.js 14 (App Router) / React 18 / TypeScript
- Tailwind CSS
- `@anthropic-ai/sdk` — Claude API
- `langsmith` — LLM tracing and eval
- `sharp` — image compression
- `jsonrepair` — resilient JSON parsing
