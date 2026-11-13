# TODO — Quick wins on the web app

> **Status: Proposed — not started.**

Three small problems on the current web app. Worth fixing now, whatever is decided in
[web or mobile](./TODO_web-or-mobile-decision.md), because the app is in daily use.

## 1. Back button in `/dine` goes to the wrong place

The detail is `/dine?place=<id>`; views push history, filters replace (AGENTS.md).

- **Bug 1 — the first restaurant opened after landing on `/dine` adds no history entry.**
  `applyUrl` (`app/dine/page.tsx:345-387`) sets `applyingHistory.current = true`, then sets
  state the page already has, so the writer effect never runs and the flag stays set. The first
  `openRestaurant` is then swallowed by the guard at `:397-401`. Back leaves `/dine` and goes to
  wherever you were before (Plan, Cook…). Only the second restaurant gets a proper entry.
  `/dashboard` avoids this because its `applyUrl` always sets a new filters object.
- **Bug 2 — deep links** (`/profile` → `/dine?place=X`): back returns to `/profile`, and the
  in-app Back pushes `/dine`, so the next back gesture loops into the detail again.

- [ ] Clear the flag when `applyUrl` changes nothing (or drop the flag and rely on
      `writeUrl`'s same-URL no-op, special-casing `edit-review`)
- [ ] On a deep link with no history depth: `replaceState('/dine?<filters>')`, then
      `pushState(current)` — both back paths land on the list
- [ ] Optional: `view=map` as a replace-only param, and restore `scrollY` from history state
- [ ] A test for each bug (none exists today)

## 2. Long Spanish/Catalan strings deform the page on phones

Main culprit: the `/plan` header row (`app/plan/page.tsx:564`) — `KitchenBar` is
`shrink-0 whitespace-nowrap` (`KitchenBar.tsx:207`) next to the calendar/list toggle whose label
"Lista de la compra" (18 chars, 13 in English) wraps inside a pill. Total ≈ 390 px against 328 px
of content on a 360 px phone. Nothing in `AppShell` stops one wide child from widening the page.

- [ ] `overflow-x-clip` on the `AppShell` root (not `overflow-x-hidden`: it breaks the sticky header)
- [ ] Plan toggle: icon only below `sm` (`CalendarDays` / `ListChecks`), count badge kept — as
      `/dine` already does for cards/map
- [ ] KitchenBar: drop `shrink-0`, label hidden below `sm`
- [ ] "Volver a esta semana": icon button with the text as `aria-label`
- [ ] Sort `<select>` in `/dine` (`SortControl.tsx:57`): icon-only on mobile
- [ ] Header tagline `shell.cook-and-dine`: hidden below `sm`
- [ ] Restaurant `h1`: `break-words`
- [ ] Check every screen at 360 px in es and ca

## 3. Adding a list line can return a 500

On 16 Oct three requests failed with `UniqueViolation` on `uq_shopping_list_items_merge_key`
(`jamon cocido`, unit `Lonchas`): an insert collided with a line that already existed under the
same merge key instead of merging into it.

- [ ] Reproduce (probably: unit casing, or a key resolved after the existence check)
- [ ] Fix the merge so it can never insert a duplicate key, plus a regression test
