# TODO — Shared UI components and the copy-fits check

> **Status: DONE — 2026-11-14 (A only).** *Outcome:* PR A shipped the components, the
> overflowing screens and the check; B and C were cancelled by
> [ADR 0008](../adr/0008-expo-app-replaces-the-web-frontend.md) (Expo replaces this frontend).

**Why.** On 2026-11-14 the frontend had 131 hand-written `<button>`s in 37 files and no `Button`
component, so every button decided on its own what to do when its label did not fit. Catalan
runs ~19 % longer than English for short labels (Spanish ~15 %), and the app was designed in
English, so at 360 px labels broke mid-word ("Guarni / ció"), were cut ("Recept…"), wrapped
inside pills, or pushed `/plan` sideways off the screen. Three form footers were the same
300 characters of classes copied by hand, one with "Cancel" hardcoded in English.

mywally-app avoids this with atoms (`Button`, `IconButton`), designing in the longest language
(German, from Figma) and an explicit `numberOfLines` wherever text may be cut — but it has no
automated check. This adds one.

## The rules (`components/ui/Button.tsx`)

- A label never breaks inside a word and is never cut. Where a word does not fit, the action
  is an icon with an accessible name (`IconButton`, or a label that is `sr-only` below `sm`).
- `SegmentedControl`: on a phone only the selected segment spells its label.
- Only user data may be cut (an address on a card), and only where marked `data-may-truncate`.

## A — Components and the overflowing screens ✅

- [x] `Button`, `IconButton`, `FormActions`, `SegmentedControl` in `components/ui/`
- [x] `e2e/copy-fits.e2e.ts` (Playwright): signs in, visits 16 screens at 360 px, fails on any
      label cut, spilling, off-screen or wrapped inside a control, and on sideways page scroll.
      Inventory on 2026-11-14 in Catalan: 42 problems. After: 0 in ca, es and en.
- [x] Plan view switch, profile tabs, the three form footers, account save, food-type picker
      (3 + 2 on a phone), header tagline, Plan's week pager and "back to this week"

## B — Migrate the remaining buttons

112 hand-written `<button>`s left. Most are in `components/plan/SlotSheet.tsx` (21),
`AddRestaurantFlow.tsx` (11), `plan/ShoppingList.tsx` (11) and `app/dine/page.tsx` (10).
Also: `AppShell`'s desktop world switch onto `SegmentedControl` (it is links, so it needs a
link variant).

- [x] Dine's filter row (2026-11-14): at 360 px the sort select ("Visitados hace poco", 200 px)
      cut the filters beside it mid-word. On a phone the sort is now its icon (tomato when the
      order is not the default) and the filter strip fades at its right edge. `copy-fits` does
      not see this kind of cut — a `<select>`'s text and a scroller's clipped child are not
      measured — so it was found by eye.
- [ ] Migrate file by file, adding variants only when a real button needs one
- [ ] Extend `copy-fits` to the screens it does not reach yet: the slot sheet, the add-restaurant
      flow, the admin panel, open dialogs
- [ ] Optional: an ESLint rule (`no-restricted-syntax` on JSX `button` outside `components/ui/`)
      so a new hand-written button fails lint

**Cancelled 2026-11-14** by [ADR 0008](../adr/0008-expo-app-replaces-the-web-frontend.md): Expo
replaces this frontend, so B would be ~1 day on code that is thrown away. The rules carry over to
Expo; the migration does not. **Revisit if** the Expo move is abandoned and the web app stays.

## C — Run the check in CI

**Cancelled 2026-11-14** with B, same reason and same revisit trigger. The Expo app needs its
own version of the check (labels fit at 360 px in Catalan); that belongs to the Expo setup.

- [ ] The test needs the whole stack: Postgres (a service container), the API, the web app and a
      Cognito test user (secrets `E2E_EMAIL`/`E2E_PASSWORD`). About +1 min a run and ~150 MB of
      Chromium on a cold cache.
- [ ] Cheaper alternative: run it only on PRs that touch `frontend/messages/` or
      `frontend/components/`.

Until then it is a local check: `npm run e2e -w frontend` with `npm run dev` running.
