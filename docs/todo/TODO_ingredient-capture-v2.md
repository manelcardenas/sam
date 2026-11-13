# TODO — Better ingredient capture

> **Status: Proposed — not started.**

Today: text pasted into the recipe form is parsed by `deepseek-chat` through an
OpenAI-compatible adapter (`backend/src/infra/adapters/parsing/`), with a fallback slot never
filled. It was called 4 times in the last 30 days. The result feels weak.

- [ ] Decide what "better" means: accuracy on Spanish recipes, photo of a recipe or cookbook page,
      voice, a link to a recipe site? (see [`../plans/future-roadmap.md`](../plans/future-roadmap.md) §9)
- [ ] Compare models on ~20 real recipes from production (cost per recipe, accuracy, latency):
      DeepSeek today vs a vision-capable model (e.g. Claude Haiku 4.5, Gemini Flash)
- [ ] Structured output (JSON schema) instead of prompt-and-parse
- [ ] Do it inside the [plan redesign](./TODO_weekly-plan-redesign.md) if recipe entry is part of
      the new flow
