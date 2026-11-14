# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

An installable PWA (`app/manifest.ts`, `appleWebApp` in `app/layout.tsx`), used almost only on
phones. It is being replaced by an Expo app
([ADR 0008](../docs/adr/0008-expo-app-replaces-the-web-frontend.md)); this web app stays live,
frozen to fixes, until the Expo app reaches parity. The two people using it today have one iPhone
and one Android phone, so both must be covered.

## Users

Today: two people who cook, plan their week and eat out together. They use the app on their
phones, at the stove, in the supermarket and at a restaurant table, in a mix of Catalan and
Spanish (each in their own language).

Next: it is meant to open to more people — friends, other couples, other households — but not to
become a mass-market product. Design must not assume exactly two names, and a stranger's first
visit (sign-up, empty states) starts to matter.

## Product Purpose

SAM keeps one household's food world in one place, in three parts:

- **Cook** — the household's recipes, with ingredients that scale by servings.
- **Plan** — the week's meals and the shopping list that falls out of them, shared by everyone
  in the same kitchen.
- **Dine** — a scrapbook of the restaurants you have been to, ordered by your most recent visit,
  with each person's review.

Success is that it is the place you reach for at the moment of need — deciding what to cook,
shopping, picking a restaurant, remembering how a place was — and that it is quicker than the
notes app or the group chat it replaces.

## Positioning

A personal record, not a directory. Dine is about reliving where *you* have eaten, with your
own and your people's words, not discovering venues (ADR 0005). Plan is shared within a kitchen
by invitation, so the week and the list belong to the household, not to one account.

## Operating Context

- One-handed on a phone, often in a hurry: the shopping list in a supermarket aisle, a recipe
  propped up while cooking, a review typed at the table.
- The phone's back gesture must move back one view, not leave the app (state lives in the URL).
- Data model: recipes belong to their owner; restaurants and reviews are shared by every signed-in
  user and restaurant facts are editable by anyone (ADR 0002); a meal plan belongs to a kitchen
  that people join by invitation.

## Capabilities and Constraints

- Next.js with `output: 'export'`: static files only, no SSR, no API routes, no dynamic segments.
- FastAPI backend behind API Gateway on Lambda, Postgres, Cognito sign-in.
- Three languages, English as the source and Catalan/Spanish as translations; all copy lives in
  `messages/`. Catalan runs ~19 % longer than English, so every label must fit at 360 px in
  Catalan (`e2e/copy-fits.e2e.ts`).
- One admin account.
- Undecided: how strangers will be grouped once the app opens up (today every account sees every
  restaurant and review).

## Brand Commitments

- Name: **SAM**. Binding.
- The border-collie mascot is **likely to go** (stated 2026-11-14): SAM stays as a name, the dog
  as identity does not. Until a redesign replaces it, the current rule holds — the dog speaks
  where you arrive and where something is at stake, never in transit
  (`docs/plans/ux-refresh-plan.md` §3). Mascot assets today: `components/ui/SamMascot`,
  `public/sam.json` (Lottie), the icons in `public/` and `app/icon.svg`.
- Direction stated for a future redesign (not yet a chosen visual world): modern and minimal, a
  pastel palette, in the spirit of Apple's apps. Never a generic SaaS look (grey, corporate blue,
  identical card grids) and never twee (paws, bones and dog puns everywhere).

## Evidence on Hand

Real data from the two current users (restaurants, reviews, recipes, plans). No testimonials,
press, user counts or public launch exist; do not invent any.

## Product Principles

1. **At the moment of need, one hand, a few seconds.** Every flow is judged on a phone in a
   supermarket, a kitchen or a restaurant.
2. **A record of your life, not a catalogue.** Show what people wrote and when they went before
   facts about venues.
3. **Shared by default inside a household.** A plan or a list is the kitchen's, not one person's.
4. **Every language is first-class.** A label that only fits in English is a bug.

## Accessibility & Inclusion

Touch targets at least 44 px; labels never cut or broken mid-word, with icons carrying an
accessible name where a word does not fit; reduced motion and reduced transparency respected.
