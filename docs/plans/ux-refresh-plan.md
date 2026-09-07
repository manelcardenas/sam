# UI/UX refresh — profile, dashboard navigation, and interaction patterns

> **Status (2026-09-07): §1–§6 SHIPPED.** All that remains is §7, which is deliberately a research
> task rather than a design. §4 grew from bilingual to trilingual on the way in, and from "add a
> switch" to "get all copy out of the code".
>
> This is the **second** UX pass. The first —
> [`./frontend-ux-plan.md`](./frontend-ux-plan.md), implemented 2026-09-01 — covered install/PWA,
> the dine scrapbook and the profile's first version. This one exists because the profile grew
> past its layout, the dashboard's navigation is now inconsistent with the page next door, and
> [`./meal-planner-plan.md`](./meal-planner-plan.md) needs somewhere to live. Four further items
> were added on 2026-09-06 from a pass over how the app actually reads: the brand voice (§3), a
> Spanish/English switch (§4), the dine ordering control (§5), and a visual handle for cuisine
> (§6).
>
> **It comes before the meal planner on purpose.** The planner needs a home, an archive surface
> and a dish picker; building those into a layout that is already known to be wrong means
> building them twice.

## 1. The profile page has outgrown one scroll — ✅ DONE (2026-09-07)

> **Shipped as four URL-encoded tabs.** `?tab=recipes|reviews|account`, with the hub at bare
> `/profile`; `lib/profile-url.ts` + 16 round-trip tests, mutation-checked. Both lists gained
> search, the recipes list gained category chips, and `/recipes` was **deleted** — the profile was
> its only inbound link, so §1c resolved by removal rather than by porting it to `UserProvider`.
> Two link bugs fixed on the way: recipe rows now open `/dashboard?category=…&recipe=…` (built
> with that page's own encoder), and review cards open `/dine?place=…` instead of dumping you at
> the top of the archive.
>
> **Not built, deliberately:** the `?tab=plans` archive. `PROFILE_TABS` is a const array, so
> adding it is one entry — but a tab rendering an empty state for a feature that does not exist
> yet is worse than no tab. It goes in with the planner.
>
> **Visual pass, since it came up with the rework:** accent tokens `leaf` and `berry` promoted
> into the theme (both were already in `FOOD_TYPES.accent`, just unreachable), a gradient-wash
> hero with a monogram, per-figure accents on the stats, count-up numerals
> (`lib/useCountUp.ts`), and a transform-only sliding tab indicator. `FOOD_TYPES` gained an
> `icon` field and the profile uses it — the §6 emoji migration is started, with
> `/dashboard` and `RecipeForm` still to go.
>
> One honest note on the reference material: the Mela reviews praise it for *restraint* —
> "functional elegance rather than visual flourishes", in the Reeder lineage. So the effects here
> are deliberately structural (colour carrying meaning, motion marking arrival) rather than
> decorative.

### The problem, as it was


`frontend/app/profile/page.tsx` is 294 lines rendering a single vertical scroll:

```
header + StatsStrip        3 numbers and a top cuisine
Account                    email (disabled) + display name + Save
Your recipes               unbounded list
Your reviews               unbounded list
```

Measured in production: **Nel has 14 recipes and 21 reviews — 35 rows** in two unbounded lists,
growing forever, with no filter, no search and no pagination. Martina has 19. It only gets worse.

Three concrete problems, in order of how much they bite:

**1a. The thing you never touch sits on top of the things you look at.** The Account form —
one editable field, changed roughly never — is between your stats and your content. Every visit
scrolls past a settings form.

**1b. Two unbounded lists with no way to narrow them.** This is the same problem `/dine` and
`/dashboard` already solved with chips and search, unsolved here.

**1c. Recipe rows link to `/recipes?id=…`**, a *different* page from `/dashboard` — which still
does its own `configureAmplify()` + `getCurrentUser()` rather than using `UserProvider`, so it
missed the latency work. Tapping your own recipe from your profile takes you somewhere with
different navigation and a slower cold path.

### The shape: subpages, not one scroll

Split into a small hub with subpages, encoded in the URL the same way `/dine` and `/dashboard`
already are (`lib/dine-url.ts`, `lib/dashboard-url.ts` — the pattern and its tests exist, reuse
them):

```
/profile                   hub: stats, and a way into each section
/profile?tab=recipes       your recipes, with the same chip/search affordances as /dashboard
/profile?tab=reviews       your reviews
/profile?tab=plans         the meal-planner archive  ← §5.3 of the planner plan
/profile?tab=account       email + display name + sign out
```

Two things this buys beyond tidiness: the back gesture works between sections (the reason the URL
work happened at all), and **the planner archive gets an obvious home** rather than needing a
navigation decision later.

While here: recipe rows should open the same surface `/dashboard` uses, and `/recipes` should
either adopt `UserProvider` or be deleted if the dashboard's URL state has superseded it.

## 2. `/dashboard` should navigate like `/dine` — ✅ DONE (2026-09-07)

> **The category grid is gone.** One list, with search and chips built from the categories that
> actually have recipes — so Bebida needs no decision, it simply has no chip. `category` became a
> filter in `lib/dashboard-url.ts`, which lost the `categories` view and gained `q`; the spec was
> rewritten to 19 tests. The page went from 473 to ~440 lines and the route from 8.16 kB to
> 6.87 kB, i.e. this deleted code as predicted.
>
> **Rows are now shared.** `components/recipes/RecipeRow.tsx` is used by both this page and the
> profile, which had two different designs for the same thing — the row-level version of exactly
> the inconsistency this section fixes at page level. `NarrowRow` moved to `components/ui/` as its
> third caller.
>
> **Deferred with a reason: the Recipes / Dishes chip.** This section proposed the
> [ADR 0007](../adr/0007-a-dish-is-a-recipe-without-instructions.md) lens as one more chip. It
> cannot ship yet — `RecipeModel.instructions` is `NOT NULL` and `RecipeForm` requires the field,
> so **all 19 recipes in production have instructions and zero are dishes** (checked 2026-09-07).
> The chip would be permanently empty, which is the same dead end this section removed for Bebida.
> It goes in with the planner, when dishes can actually exist.

### The problem, as it was

Decided during the meal-planner interview; it belongs here because it is UX, not planner.

Today `/dashboard` opens on a **four-tile category grid** — comida, bebida, postre, aperitivo —
that you tap through to reach a list. Production:

| Category | Recipes |
| --- | --- |
| Postre | 10 |
| Comida | 6 |
| Aperitivo | 3 |
| **Bebida** | **0** |

**A full screen of navigation in front of 19 items, one tile of which has never contained
anything.**

`/dine` already answered this exact question and answered it differently.
[ADR 0005](../adr/0005-restaurant-list-is-a-scrapbook.md) concluded that at 24 restaurants the
right tool was **filter chips, not navigation**, and shipped a search box with a scrolling chip
row. Two list pages, two philosophies, one app.

**Change:** drop the landing grid. One list, with search and chips — the three real categories
become chips, and the **Recipes / Dishes** lens from
[ADR 0007](../adr/0007-a-dish-is-a-recipe-without-instructions.md) becomes one more chip rather
than a new navigation concept. The empty category stops needing a decision; it simply has no
chip.

This *deletes* code rather than adding it, and reuses components that exist.

**Consequence:** `lib/dashboard-url.ts` currently treats `category` as view-defining. Under this
change it becomes a filter, as on `/dine` — the module gets simpler, and the 18 round-trip tests
already cover it.

**Considered and deferred: collections / cookbooks** (mise's model — user-made groupings). It is
the right answer at 100+ items and the wrong one at 19, where you would be organising an empty
room. Revisit if the collection grows past the point where chips stop narrowing usefully.

## 3. The dog is the identity, not the interface — ✅ DONE (2026-09-07)

> **Applied as written: SAM speaks where you arrive and where something is at stake, never in
> transit.** `Loader`'s `label` is now optional and defaults to nothing — the bobbing mascot and
> the three dots already say who is talking and that you should wait, so deleting the word says
> less and reads better than substituting "Loading your recipes…". Kept: the landing hero, "One
> more sniff!" at signup, the delete confirmation, the first-run empty state, and both page
> headings ("What shall we fetch?", "Where shall we eat?") — a heading is where you arrive.
>
> **The inventory in this section was incomplete.** Three more in-character strings turned up that
> it did not list: `RecentVisitsRail`'s "Where the pack has been eating." (on screen every dine
> visit) and two "Fetching the map…" labels in `RestaurantsMap` / `MapLoading`. Those two keep a
> word, because unlike `Loader` they have no mascot beside them — they just stopped using the
> dog's word. Thirteen strings, not ten.
>
> **"The pack" is gone** from both places it appeared. It meant "everyone using SAM" and no reader
> got that from the word — the only string here that was unclear rather than merely twee.

### The problem, as it was

Raised 2026-09-06: *"some are super cute and it is nice as a brand but some are too much."*
Agreed, and the inventory shows a pattern worth naming rather than trimming by taste.

Every string that speaks in character, and how often you meet it:

| String | Where | How often you see it |
| --- | --- | --- |
| "Sniffing around…" | `app/page.tsx:67` | loader — every cold start, before sign-in |
| "Sniffing out your recipes…" | `app/dashboard/page.tsx:198` | loader — every dashboard visit |
| "Digging up your history…" | `app/profile/page.tsx:106` | loader — every profile visit |
| "Fetching the record…" | `app/dine/page.tsx:379` | loader — every dine visit |
| "Sniffing out matches…" | `components/RestaurantForm.tsx:437` | every place search |
| "Every place the pack has reviewed." | `app/dine/page.tsx:434` | dine subheading — every visit |
| "SAM can't fetch this one back." | `components/DeleteConfirmModal.tsx:48` | before a delete |
| "One more sniff!" | `app/profile/complete/page.tsx:64` | once, at signup |
| "…your border collie fetches both" | `app/page.tsx:79` | landing hero — once a session |
| "…SAM will start keeping the record." | `app/dine/page.tsx:500` | empty state — once, ever |

**Five of the ten are loaders or in-flight labels.** The strings carrying the most character are
the ones you meet most often, which is exactly backwards: a joke's cost is paid per viewing, and
nobody has ever been charmed by the fourth "Sniffing…" of the morning. The two that genuinely
land — the hero and the signup line — are the two you see once.

**The rule to apply: SAM speaks where you arrive and where something is at stake. Never in
transit.**

- **Cut the four loaders.** Not rewrite — *delete the labels*. `Loader` already shows the bobbing
  SamLogo and three brand-coloured dots; the identity is fully present without a word, and "wait"
  is already said by the animation. Removing the label says less and reads better than
  substituting "Loading your recipes…".
- **Keep** the hero, the signup line, the delete confirmation (a warm voice where you are about to
  lose something is doing real work) and the first-run empty state.
- **Fix, don't trim, "the pack".** It means "everyone using SAM" and no reader gets that from the
  word — it is the only string here that is genuinely unclear rather than merely twee.

**Every visual mark stays.** The logo, the paw pins on the map, `bg-paws`, `shadow-paw`, the
bobbing mascot, the `animate-fetch-in` naming. Those cost nothing per viewing because they are not
asking to be read. That is the distinction to hold onto: **identity in the pixels, plain language
in the words.**

This section is also the cheapest thing on the list and it makes §4 smaller — every string cut is
a string not translated twice.

## 4. Three languages, chosen the way the theme is — ✅ DONE (2026-09-07)

> **Scope grew twice on the way in, and both changes were right.**
>
> **English, Spanish *and Catalan*** — three languages, not two, with English as the default and
> the source of truth. That invalidated the caveat this section originally carried ("hand-rolled
> i18n turns unpleasant at a third language"), so it got re-examined rather than assumed: es and
> ca add no complexity here because `Intl.PluralRules` knows them both. They do have a `many`
> category English lacks — it applies from 1,000,000 up, so it never fires in this app, and the
> resolver falls back to `other` for any category a file doesn't author. A language with real
> `few`/`many` forms would still work; only the authoring would grow.
>
> **All copy out of the code.** The requirement was that the codebase be entirely English with the
> translations in JSON, which is more than "add a switch": `FOOD_TYPES` shipped Spanish labels and
> descriptions, and several placeholders were Spanish examples inside an English UI. Those are now
> `food-types.<value>.label` etc. in the copy files. `FOOD_TYPES.value` stays Spanish (`comida`)
> because it is the API's stored `food_type` — an identifier, not copy.
>
> **What shipped:** `messages/{en,es,ca}.json` (one nested namespace per page/component, the shape
> of the reference repo's `base.json`), `lib/i18n/` with a typed dictionary, provider and hook, and
> `components/ui/LanguageToggle.tsx` beside the theme toggle.
>
> **The switcher is a 44px trigger showing the two-letter code, opening a menu of full names.**
> It started as a native `<select>` — the same argument §5 makes for the sort control — but a
> `<select>` wide enough to read "Español" spends the entire ~100px of slack the mobile header
> has, which is the crowding risk flagged when §4 first shipped. A code-only trigger matches
> `ThemeToggle`'s footprint exactly, so the two read as a pair, and stays 44px when a fourth
> language arrives. The trade is real and paid for in code: giving up the native control means
> Escape, outside-press, arrow/Home/End navigation and focus return are implemented rather than
> inherited, and each is covered by a test. A globe icon would be smaller still and was rejected —
> it cannot say *which* language is active, which is the one question the control exists to
> answer. The trigger's accessible name carries both ("Language: Español"), since two capitals are
> not obviously a language to a screen reader.
>
> **The types are the tooling.** `es` and `ca` are declared as `typeof en`, so a key missing from a
> translation is a *type error*. On top of that, tests assert the three files have identical key
> sets, no blank values, the same `{{placeholders}}` (a translator dropping `{{count}}` is the
> failure nothing else would notice), and matching plural shapes — all mutation-checked. Seven more
> cover the provider end to end: browser-language detection, persistence, `<html lang>`, and
> `localStorage` being unavailable.
>
> **Two integration points this section had not spotted:**
> - **`lib/format.ts` passed `undefined` as its locale**, i.e. dates followed the *browser*. Picking
>   Catalan would have produced English dates. Every function now takes an explicit locale.
> - **`/dine` prerendered its `<h1>`**, so a Spanish reader saw it flash English before hydration.
>   The heading moved into `DineSkeleton` as a shape, which is what `/dashboard` and `/profile`
>   already did. Verified against the built export: **no translated copy in any prerendered page.**
>
> **The one string the switch cannot reach** is the document `<title>` and `<meta description>`.
> `metadata` is evaluated at build time and this is a static export, so there is no per-locale HTML
> to put a translated title in. They read from `en.json` rather than being written twice.
>
> **Deliberately not a library.** `next-intl` and `next-i18next` are built around the server
> rendering and locale routing `output: 'export'` disallows; what would be left is ~40 kB of
> runtime against a 102 kB shared bundle to do interpolation (a regex) and plural selection
> (`Intl.PluralRules`). What a library would genuinely add is tooling for non-technical
> translators — nobody is doing that here. Revisit if that changes.
>
> **Known gap:** nothing detects an *unused* key. knip sees exports, not JSON paths, and keys are
> often built dynamically (`food-types.${value}.label`), so a static check would produce false
> positives. `worlds.*.blurb` was found and deleted by hand during this work; the next one will
> need the same.

### The problem, as it was

Raised 2026-09-06: English and Spanish, user-selectable, "same way as with the dark mode". Four
findings shape how this should be built.

**a. The app is already bilingual, badly.** `lib/constants.ts` ships Spanish category labels and
descriptions — `"Comida"`, `"Platos principales y guisos"` — inside an otherwise English UI, and
form placeholders are Spanish examples (`"e.g. Lasaña de verduras"`, `"…or a city / address, e.g.
Zaragoza"`) beside English labels. This is not adding a second language so much as resolving a
split that is already in the codebase.

**b. `output: 'export'` rules out Next's i18n routing.** Locale sub-paths and middleware need a
server. So the switch has to be client-side and persisted in `localStorage` — the exact shape of
`ThemeToggle` plus the pre-paint script in `layout.tsx`. The instinct in the request was right.

**c. The flash-of-wrong-language problem is far smaller than it looks.** Checked against the built
export: `out/dine.html` contains **none** of the page's copy — every page renders client-side
behind the auth gate. The only prerendered English is the landing page's loader label and the
`<title>` / `description` metadata. So a client-side dictionary covers essentially the whole app
with nothing visibly flipping after hydration, and the metadata is the entire compromise. (The
landing loader label is one of the four §3 deletes, which removes it from this list too.)

**d. Data is not copy.** Recipe titles, review comments, restaurant names and addresses are
whatever the user typed and must never be translated. Two things sit on the boundary:

- **Cuisines** arrive from the API in English. They are a *curated vocabulary* — 12 rows seeded in
  migration `874c491875f4`, no create endpoint, unknown tags rejected server-side — so a frontend
  label map keyed on the English name is complete by construction and cannot go stale without a
  migration. Translate in the frontend; the API keeps speaking English.
- **`FOOD_TYPES`** is the mirror image: Spanish in the code, and its `value` is the API's stored
  `food_type`. Same treatment, opposite direction — `comida` stays the stored value, the label
  becomes translatable.

**Size:** roughly 110–150 user-facing strings across ~6,400 lines of frontend. Not large, but it
touches nearly every file.

**Recommendation on tooling — a typed dictionary, not a library.** `next-intl` and `next-i18next`
are both built around App Router *server* rendering and locale routing, which is precisely what
`output: 'export'` disallows; adopting one means fighting its main feature. What is actually
needed is `messages/en.ts` + `messages/es.ts`, a `useT()` hook over React context mirroring
`ThemeToggle`, and the two browser built-ins that cover the genuinely hard parts —
`Intl.PluralRules` for "1 restaurant / 2 restaurants" and `Intl.DateTimeFormat` for dates. Around
100 lines, zero dependencies, and typed keys mean a missing translation is a build error rather
than a blank label. Honest caveat: hand-rolled i18n turns unpleasant at a third language, or when
translations are handed to someone who does not edit TypeScript. Neither is on the horizon;
revisit if either becomes true.

**Recommendation on sequencing — after §1, §2 and §3, not before.** The profile rework rewrites
most of the profile's copy, the dashboard change deletes the category grid, and the voice trim
deletes strings outright. Translating copy that is about to be deleted is the one obvious way to
waste this work.

## 5. `/dine`: one control row, and ordering that says what it does — ✅ DONE (2026-09-07)

> **One row, and four named orderings.** The sort control now sits inline at the end of the filter
> row — as a *sibling* of the horizontal scroller, since inside it, it would scroll away with the
> chips. It keeps the current ordering visible rather than hiding it behind a bare icon. The
> `{n} of {m}` count moved up beside the heading and now only prints while something is narrowing;
> "24 of 24" beside "Everywhere" was noise.
>
> **The asc/desc request shipped as four named options**, not a direction toggle: "Recently
> visited / Longest ago / Top rated / Lowest rated". The backend grew `OLDEST` and `RATING_LOW`
> with their own `order_by` clauses, because **direction is a decision per ordering, not a
> modifier** — every ordering is NULLS LAST in *both* directions, so an unreviewed restaurant does
> not lead "Lowest rated" and a never-visited one does not lead "Longest ago". Five new backend
> tests cover exactly that, and both fail under the naive flag implementation (mutation-checked).
>
> **Still a native `<select>`.** Whether a bottom sheet beats it is a real question and it belongs
> to §7 rather than being guessed at here — the existing argument for native (iOS's wheel picker,
> free keyboard and screen-reader behaviour) is worth testing on a phone before overriding.

### The problem, as it was

Raised 2026-09-06, and the layout complaint is right. Ordering currently gets a full-width row of
its own below a divider (`app/dine/page.tsx:484`), holding one `<select>` and a result count —
a lot of vertical space on a 390px screen for a control most people set once and forget.

Two parts of the request need pushing back on before they get built.

**Ascending/descending as a generic toggle multiplies options without adding much.** Two keys ×
two directions is four orderings, of which two are daily ("most recent", "best") and two are
curiosities ("oldest visit", "worst rated"). They are also not symmetric to implement:
`postgres_restaurant_repo.py:134` orders rating with `.desc().nullslast()` under a comment
explaining that unreviewed restaurants must sit at the bottom because *"no score is not a bad
score"*. Reversing that is **not** flipping to `.asc()` — unreviewed must *still* be last, so the
ascending case needs `.asc().nullslast()`. Direction is a decision per ordering, not a flag.

If the reverse orderings are wanted, the cheaper and clearer shape is **four named options in one
menu** — "Recently visited / Oldest first / Top rated / Lowest rated". One control instead of two,
plain language instead of an abstract direction, and four explicit `RestaurantSort` values the
repo orders deliberately. The enum already carries a member the UI never shows (`name`, used by
the create-form dedup lookup), so this pattern is established.

**An icon-only trigger hides the current ordering.** Today "Top rated" is readable without
touching anything; behind a bare icon, "what order is this list in?" costs a tap. Apps that do use
an icon trigger almost always keep the value beside it, or mark non-default state with a dot.

**What to build instead** — this gets the single line without either regression:

- Move the control onto the **filter row's line**, pinned *outside* the horizontal scroller at its
  right-hand end. It must not sit inside the `rail-scroll` container or it scrolls away with the
  chips. That is the one real layout trap here.
- The trigger shows **icon + current value** ("↓ Top rated"), `rounded-2xl` against the chips'
  `rounded-full`. `SortControl`'s existing comment already establishes shape as the signal that
  separates "holds a value" from "toggles a filter" — this keeps that argument and drops the
  separate row.
- Tapping opens the orderings. **Whether that stays a native `<select>` or becomes a bottom sheet
  is §7's question, not this one.** The current comment makes a real case for native — iOS's wheel
  picker, free keyboard and screen-reader behaviour, and it stays correct when a "Closest" sort is
  added — and that is worth testing on a phone before overriding.
- The `{n} of {m}` count moves up beside the heading. It describes the result, not the control.

Net: one row deleted, current state still visible, and the genuinely open question left to the
section meant to answer it.

## 6. Cuisine needs a visual handle — colour before icons — ✅ DONE (2026-09-07)

> **`lib/cuisines.ts`: a colour per cuisine, one icon.** Eleven hand-picked hues plus a neutral
> fallback that "Other" deliberately takes — a catch-all should look like a catch-all. `Leaf` for
> Vegan/Vegetarian is the only glyph, because it is the only one that means anything. Applied to
> the filter chips (where the accent flips to the chip's own colour when active, since it would
> otherwise sit on tomato at poor contrast), the cards (capped at three dots so a many-tagged
> restaurant doesn't push the names out) and the recent-visits rail. Every dot is `aria-hidden`
> with the label right beside it — colour is never the only signal.
>
> **The `emoji` field is gone.** All eight call sites now use `FOOD_TYPES.icon`: three deleted with
> §2's grid, the rest swapped in the list rows, the detail badge, the profile and `RecipeForm`'s
> type picker (where the glyph takes the category's colour once selected).

### The problem, as it was

Raised 2026-09-06: some marker for Mediterranean / Chinese / Japanese and the rest, given there
are no photographs. The vocabulary makes this cheap and bounded:

**It is a closed set of twelve.** Seeded in migration `874c491875f4`, exposed read-only through
`GET /cuisines`, and unknown tags are rejected by `_validate_cuisines`. A lookup map is complete
by construction and cannot go stale without a migration. In production:

| | |
| --- | --- |
| Chinese | 10 |
| Mediterranean, Spanish | 6 each |
| Italian | 2 |
| American, Japanese, Mexican, Thai, Vegan/Vegetarian, Other | 1 each |
| French, Indian | 0 |

Two problems with going straight to icons:

1. **Two of the twelve have no honest glyph.** "Other" is a category of last resort and
   "Vegan/Vegetarian" is a diet, not a place. A set that covers ten and shrugs at two looks
   unfinished — and "Other" is on a real restaurant today, so the gap is visible immediately.
2. **Food glyphs fail hardest where the data is densest.** Lucide has no cuisine set, so icons get
   mapped by association — and the three biggest tags are Chinese (10), Mediterranean (6) and
   Spanish (6), of which the latter two share essentially every available food glyph. The icon
   would do the least work on the tags carrying the most restaurants. National-cuisine
   iconography is also a well-trodden cliché trap (a torii for Japanese, a sombrero for Mexican)
   worth avoiding on its own merits.

**Recommendation: colour first, icons only where a glyph is honest.** The codebase already has
this exact device — `FOOD_TYPES` gives each category an `accent` hex that tints the recipe UI. The
same on cuisines scales to all twelve, needs no glyph for "Other", and reads at chip size where a
14px icon does not. Add an icon only where one genuinely means something; a leaf for
Vegan/Vegetarian is the clear case. Accessibility constraint that comes with it: colour must not
be the only signal, so chips keep their text labels — which they need anyway, since a colour alone
cannot tell you a cuisine's name.

**A real defect worth fixing in the same pass:** `FOOD_TYPES` uses **emoji** as its icons
(🍽️ 🥤 🍰 🥗) at eight call sites. Emoji render differently on every platform, do not inherit
colour, and are the one thing the project's own design guidance names outright (`no-emoji-icons`).
§2 deletes three of those sites for free when the category grid goes; the remaining five —
`app/dashboard/page.tsx:364`, `app/profile/page.tsx:207`, `app/recipes/page.tsx:81`,
`components/RecipeForm.tsx:180` — want Lucide glyphs. Here the mapping *is* honest: a bowl, a cup,
a cake slice and a leaf are the actual things.

## 7. Interaction patterns — a research task, not a design

The honest state of this section: *"mise.cooking feels better than our app"* is a real signal and
not yet a specification. Writing a design here would be inventing requirements.

**What [mise.cooking](https://mise.cooking/) actually does**, from its own material: swipe
navigation in a distraction-free cooking mode, drag-and-drop meal planning, cookbooks as
collections, real-time shared list ticking, no screen timeout while cooking, and import from
photos / websites / TikTok.

Three of those are already decided elsewhere and are not in scope here: collections (§2, deferred),
shared list ticking ([planner plan](./meal-planner-plan.md) §4.3), and import
([roadmap](./future-roadmap.md) item 9).

**The task**: use the app for a week on a phone, and each time something feels worse than mise,
write down *the specific moment* — not "navigation feels clunky" but "getting from a recipe back
to the filtered list takes three taps". Then compare against two or three other cooking apps.
Only then design.

Candidates worth evaluating, listed so they are not forgotten rather than because they are agreed:

| Pattern | Where it might apply | Note |
| --- | --- | --- |
| Bottom navigation | Top-level: dine / recipes / planner / profile | Four destinations is exactly the count a bottom bar suits. Also the natural home for the planner |
| Bottom sheets instead of full-page views | Recipe detail, the planner's ingredient popup | Keeps context visible. Fits the planner's per-dish tick flow well |
| Swipe between sections | Dashboard categories, planner days | Cheap on mobile, invisible on desktop |
| Drag and drop | Assigning dishes to slots | mise uses it for exactly this. Fiddly on touch; a tap-to-assign fallback is mandatory |
| Screen-wake during cooking | Recipe detail | Small, self-contained, and genuinely useful |

**Constraint that rules some things out:** the app is `output: 'export'` (static, no server), and
the design language is the established warm cream/tomato border-collie theme with
`ADR 0005`'s scrapbook framing. Patterns are adopted; the visual identity is not.

## 8. Order

| | Status |
| --- | --- |
| **1. Profile subpages (§1)** | ✅ 2026-09-07 |
| **2. Dashboard chips (§2) + the emoji→icon swap (§6)** | ✅ 2026-09-07 |
| **3. Voice trim (§3)** | ✅ 2026-09-07 |
| **4. Dine control row (§5)** | ✅ 2026-09-07 |
| **5. Cuisine colour (§6)** | ✅ 2026-09-07 |
| **6. Three languages (§4)** | ✅ 2026-09-07 |
| **7. Pattern research (§7)** | Open. Needs a week of real use before it can produce a design |
| then | [`./meal-planner-plan.md`](./meal-planner-plan.md) |

**§4's sequencing argument paid off exactly as stated.** §1–§3 and §5 rewrote or deleted a large
share of the app's user-facing strings — four loader labels deleted, two "pack" lines rewritten, a
category grid and its four descriptions deleted, four sort labels added. Translating those first
would have meant doing each of them three times and then throwing the work away.

**What §4 changed for §7:** every string is now addressable by key, so a copy change is a JSON edit
rather than a hunt through 25 files. That makes the research phase cheaper than it would have been,
because "this wording is confusing on a phone" becomes a one-line fix in three files.

## Cross-links

- [`./frontend-ux-plan.md`](./frontend-ux-plan.md) — the first UX pass (implemented 2026-09-01)
- [ADR 0005](../adr/0005-restaurant-list-is-a-scrapbook.md) — filters over search, the precedent §2 follows
- [ADR 0007](../adr/0007-a-dish-is-a-recipe-without-instructions.md) — the Recipes/Dishes lens §2 needs a chip for
- [`./meal-planner-plan.md`](./meal-planner-plan.md) — what this clears the way for
- [`./future-roadmap.md`](./future-roadmap.md) — the queue this sits in; §4's tooling note is the
  only place the app takes on a dependency it could have avoided, so it is worth revisiting there
  if a third language ever appears
