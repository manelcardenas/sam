# TODO — Better ingredient capture

> **Status: Moved** — 2026-11-17: now slice 6 of the plan redesign's Phase 1,
> [`../plans/meal-plan-phase-1.md`](../plans/meal-plan-phase-1.md). Track it there; this file
> stays for the links that point here.

Today: text pasted into the recipe form is parsed by `deepseek-chat` through an
OpenAI-compatible adapter (`backend/src/infra/adapters/parsing/`), with a fallback slot never
filled. It was called 4 times in the 30 days before 2026-11-13. The result feels weak, and the
worst failure is **losing an ingredient** between the pasted text and the structured rows.

What was decided:

- Three ways in: a link (`schema.org/Recipe`, no AI), a photo (a vision model, image discarded),
  pasted text (a better model with structured output).
- Pick the model on a comparison of ~20 real recipes (rows out vs lines in, errors, cost,
  latency), not on reputation.
- Guarantees: one row per original line, a line counter, the original text alongside, a warning
  for ingredients named only in the steps, no vocabulary writes until save.
- The model also proposes servings, times and tags.

Voice input stays out. Revisit **when the Expo app is in daily use**, where dictation is a
native keyboard feature and may need nothing from us.
