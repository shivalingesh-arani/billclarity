# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev        # Start dev server (localhost:3000)
npm run build      # Production build
npm run lint       # ESLint
npm run typecheck  # TypeScript compiler check (tsc --noEmit)
```

**Pre-commit hook** (Husky): runs `lint` and `typecheck` automatically before every commit. Do not skip with `--no-verify`.

Requires `ANTHROPIC_API_KEY` in a `.env.local` file.

## Architecture

BillClarity is a Next.js 14 (App Router) application that analyzes medical bills/EOBs for billing errors using the Claude API. It has two pages and two API routes — no database, no auth.

### User Flow

1. **Upload** ([app/page.tsx](app/page.tsx)) — Patient uploads a PDF/JPG/PNG of their medical bill or EOB
2. **POST `/api/analyze`** ([app/api/analyze/route.ts](app/api/analyze/route.ts)) — Two-call Claude pipeline:
   - **Call 1 (Extraction):** Claude Sonnet reads the document image/PDF and returns structured JSON (line items, amounts, codes, etc.)
   - **Model selection:** Routes to Sonnet or Haiku for triage based on bill complexity (OON providers, prior auth denials, extraction confidence, line count)
   - **Call 2 (Triage):** Runs 8 mandatory checks (OOP proximity, duplicates, NSA violations, wrong POS, zero payment, math verification) and returns flags with plain-English explanations
   - **Post-processing:** Deterministic override of model-generated totals — recalculates flag counts and savings sums server-side
3. **Results** ([app/results/page.tsx](app/results/page.tsx)) — Displays flags, clean items, and triage notes. Results are passed via `sessionStorage`, not URL params.
4. **POST `/api/flag-detail`** ([app/api/flag-detail/route.ts](app/api/flag-detail/route.ts)) — Lazy-loaded on user click ("Get my action plan"). Uses Haiku to generate call scripts, pushback scripts, and next steps for a specific flag.

### Key Patterns

- **JSON resilience:** All Claude responses are cleaned (strip markdown fences, trim to first `{`/last `}`) then repaired with `jsonrepair` before parsing.
- **Image compression:** Non-PDF uploads are resized/compressed with `sharp` before sending to Claude (5 MB API limit).
- **Error boundaries:** Each flag card is wrapped in `FlagErrorBoundary` so one malformed flag doesn't crash the results page.
- **Prompt engineering:** The triage system prompt is highly prescriptive — it specifies exact check logic, confidence levels, flag ordering, and output schema. Changes to triage behavior should be made in `TRIAGE_SYSTEM_PROMPT` in the analyze route.
- **No external state:** No database, no user accounts. Everything is ephemeral per session.

### Tech Stack

- Next.js 14 / React 18 / TypeScript
- Tailwind CSS (teal/emerald/slate palette, `#F8F7F5` page background)
- `@anthropic-ai/sdk` for Claude API calls
- `sharp` for image compression
- `jsonrepair` for resilient JSON parsing

## Development Standards

### Code Quality

- **Strict TypeScript:** No `any` types. Define explicit interfaces/types for all data structures (API payloads, component props, Claude response schemas). Use discriminated unions over loose string types where possible.
- **No local/relative hacks:** Use proper module imports. No inline `require()`, no dynamic path manipulation, no monkey-patching. If something needs a workaround, fix the root cause or raise it.
- **Single responsibility:** Each file/function does one thing. Extract shared logic into well-named utilities under `lib/` rather than duplicating across routes (e.g., `lib/clean-json.ts`, `lib/anthropic.ts`).
- **No magic values:** Extract constants (max file size, API limits, model names, color tokens) into named constants or config.

### Testing

- **Test-driven development:** Write tests before or alongside implementation, not as an afterthought. For new utility functions, API route logic, or data transformations, write the test first.
- **Test structure:** Place tests in `__tests__/` directories co-located with the code they test (e.g., `app/api/analyze/__tests__/route.test.ts`).
- **What to test:**
  - Pure functions (JSON cleaning, savings calculation, model routing logic) — unit tests
  - API routes — test request validation, error handling, and response shape (mock the Anthropic SDK)
  - Components — test conditional rendering and user interactions, not implementation details
- **What not to test:** Don't test Tailwind classes, static markup, or third-party library internals.

### React / Next.js

- **Server Components by default.** Only add `"use client"` when the component genuinely needs browser APIs, state, or event handlers.
- **Minimize client-side state.** Prefer server-side data fetching and passing props over `useState` + `useEffect` patterns where Next.js supports it.
- **Extract reusable components** when a UI pattern appears more than once (e.g., collapsible sections, loading spinners, error states). Place them in `components/`.
- **Validate at the boundary:** Validate/parse all external input (file uploads, API request bodies, Claude responses) at the point of entry. Internal code can trust validated types.

### API Routes

- **Return consistent error shapes:** Always `{ error: string }` with an appropriate HTTP status code.
- **Log meaningfully:** Use `[BillClarity]` prefix. Log decisions (model selection, fallback paths) not raw data. Never log patient data or file contents.
- **Fail gracefully:** If one part of the pipeline fails (e.g., JSON parse), return a user-friendly message. Don't expose stack traces or internal errors to the client.
