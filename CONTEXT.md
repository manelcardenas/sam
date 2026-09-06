# Sam

An app for managing recipes and reviewing restaurants: users create and browse recipes with ingredients, and log reviews of restaurants they've visited.

## Language

### Recipes

**Servings**:
The number of people the stated ingredient quantities in a recipe are sized for. Editing this (and scaling ingredient quantities to a new headcount) is the mechanism for adapting a recipe to feed a different number of people.
_Avoid_: Portions, people, yield

### Restaurant Reviews

**Restaurant**:
A shared, community-maintained record of a place to eat. Any authenticated user can edit its facts (name, address, price level, cuisine tags) — it is never owned by whoever created it.
_Avoid_: Venue, Place

**Review**:
One user's rated account of a single visit to a Restaurant: four Category Scores, an optional comment, and the date visited. A user may post multiple Reviews of the same Restaurant over time (revisits). Only its author may edit or delete a Review — unlike Restaurant facts, a Review is owned.
_Avoid_: Rating

**Category Score**:
One of the four scores (0–10, in steps of 0.5) a reviewer gives on a Review: Location/Decoration, Food, Service, and Value.
_Avoid_: Rating

**Value**:
The Category Score for perceived value-for-money on a Review. Distinct from Price Level.
_Avoid_: Price

**Price Level**:
A 1–4 (€ to €€€€) fact about a Restaurant's typical cost, set on the Restaurant itself — not a per-review score.
_Avoid_: Price, Value

**Overall**:
The average of a Review's four Category Scores. Never entered directly and never stored — always computed. A Restaurant's overall rating is the average of Overall across all its Reviews.
_Avoid_: Rating, Average

**Place**:
The external map provider's record of a physical venue, shown as a search result when adding a Restaurant. A Place is never stored by SAM — picking one creates (or links to) a Mapped Restaurant by copying its facts and keeping a reference to its external identity.
_Avoid_: Restaurant, Result, Suggestion

**Area**:
A city, neighbourhood, or address used to anchor a Place search somewhere other than where the user currently is. Like a Place, an Area is never stored — it only biases the search that finds a Place.
_Avoid_: Location, City, Region

**Mapped**:
A Restaurant that is linked to the external map provider's record of the physical place: it carries that external identity and coordinates. An Unmapped Restaurant has no such link. Mapping happens by picking a search result at creation time; manual entry remains allowed because the map provider does not know every restaurant.
_Avoid_: Verified, Geocoded

**Pinned**:
A Restaurant whose coordinates were set by hand — dropping a pin on a map — rather than copied from a Place. Pinned Restaurants appear on the map but stay Unmapped: coordinates without an external identity, so they can't deduplicate against other users' picks. Coordinates are editable facts like any other; the mapping link is not.
_Avoid_: Located, Geotagged

**Cuisine**:
One tag from a curated, extensible vocabulary describing a Restaurant's style of food (e.g. Italian, Japanese). A Restaurant can have more than one.
_Avoid_: Category, Type

**Visited At**:
The date a reviewer says they went to a Restaurant, distinct from when the Review was posted. Defaults to the day the Review is created but can be backdated at creation time.
_Avoid_: Date, Created At

### Latency

These four are constantly conflated, and every conclusion in
[`docs/plans/routing-and-latency-plan.md`](docs/plans/routing-and-latency-plan.md) depends on
keeping them apart.

**Init**:
The one-time work a Lambda container does before it can serve anything: importing the
libraries, reading secrets from SSM, building the app. Reported by CloudWatch as
`Init Duration`, which the `Duration` metric **excludes**. ~3.3 s measured.
_Avoid_: Cold start (that's the whole first request, init included), Startup, Boot

**Warm Path**:
The time to serve a request in a container that already exists — CloudWatch `Duration` on a
non-cold invocation. The number that matches "slow even after the cold start", and the target
of the plan. ~540 ms measured.
_Avoid_: Response time, Latency (both too vague to argue with)

**Wake**:
Neon bringing a scaled-to-zero compute back after 5 minutes of inactivity. Server-side, fixed
and undisableable on the free plan, and charged in metered compute hours if avoided by
polling. Neon documents it as a few hundred milliseconds — **not** the seconds-long stall it
was originally blamed for.
_Avoid_: Cold start, Spin-up

**Handshake**:
Establishing one Postgres connection: TCP, TLS and auth, ~5–7 round trips. Cross-region
(`eu-west-3` Lambda → `eu-central-1` Neon) that is 60–90 ms. Distinct from a Wake, and from
the per-query RTT that remains once connections are pooled — see
[`docs/adr/0006-pooled-connections-on-lambda.md`](docs/adr/0006-pooled-connections-on-lambda.md).
_Avoid_: Connection time, Connect
