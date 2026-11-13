# TODO — Quick wins on the web app

> **Status: In progress — 1 done (branch `bugfix/dine-back-navigation`), 2 and 3 next.**

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

- [x] Flag dropped: `applyUrl` records the view it applies in `lastViewKey`, so the writer's
      echo is a same-URL no-op. Popping onto an `edit-review` entry now rewrites it to the
      detail URL, which is what it decodes to anyway.
- [x] On landing in a non-list view: the entry is rewritten as the list and the view pushed on
      top — both back paths land on the list. Known leftover: refreshing a restaurant you
      opened from the list leaves two list entries below it (one extra back press).
- [x] Tests: `app/dine/page.spec.tsx` (both fail on the old code) and
      `app/plan/page.spec.tsx`. /plan never had the bug: its URL is restored on mount, so the
      writer's mount run clears the flag; the test keeps it that way.
- [ ] Optional, not done: `view=map` as a replace-only param, and restore `scrollY` from
      history state

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
