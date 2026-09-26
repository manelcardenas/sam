# Place search can be anchored to an Area, not just to where the user is standing

Phase 2b shipped Place search with two ways to find a venue: typed autocomplete biased towards the browser's current coordinates, and a "📍 near me" nearby list (ADR-0003, `docs/plans/geoapify-places-plan.md`). Both assume the user is at, or near, the restaurant they are adding. That assumption breaks for the common case of logging a place from home — a trip last month, a recommendation to save for later — where proximity bias actively hurts: searching "La Mafia" from a sofa in Berlin ranks Berlin results above the Zaragoza restaurant actually meant. We added a third input: an optional **Area** (city / neighbourhood / address) that anchors the search somewhere else entirely.

An `Area` is an ephemeral entity like `Place` — `name`, a disambiguated `label`, and coordinates — never persisted, obtained from `GET /places/areas` (`search_areas`), which hits the same Geoapify geocoding autocomplete endpoint as Place search but keeps only non-`amenity` results. Picking an Area replaces the geolocation bias with the Area's coordinates *and* appends its short name to the query text; typing area text without picking a suggestion still narrows the query string, so the feature degrades rather than fails. The Area field has its own debounce, separate from the name field, so typing a city doesn't thrash Place search.

This deliberately reuses the existing provider rather than adding a second one: `search_areas` is a third method on the `PlacesProvider` port, so the in-memory adapter and the tests stay symmetric with `search`/`nearby`, and no new API key, quota pool, or attribution obligation is introduced. It also keeps the geolocation-denied path from ADR-0003 useful — a user who blocks location access now has a real alternative to unbiased typing instead of just a degraded one.

Consequences: Area search spends the same Geoapify credits as Place search, so a user typing a city name burns quota on results that are never stored — the debounce and the `min_length=2` guard on the route are the only throttle, and `/places/areas` sits behind Cognito like the rest. Areas are never stored, so a Restaurant carries no record of which Area it was found through; if that ever matters (say, browsing restaurants by city), it needs deriving from the Restaurant's own coordinates, not from search history. `search_areas` takes no bias parameter, so ambiguous city names resolve by the provider's own ranking — the `label` field exists precisely so the user disambiguates visually.

## Addendum (2026-09-26) — adding a restaurant is one search box over one map

The name-first form asked six things for one question, *which place is it?*: a name, "where is
it?", "near me", a city, "drop a pin" and an optional address. Almost every restaurant is added
from inside it, so the common case paid for the rare one. `AddRestaurantFlow` replaces all six
with the two controls map apps use:

- **The map, opened on you.** `/places/nearby` results (500 m, nearest first) are tomato paw pins,
  with the same places listed below. Tap one, then "This is it", and name, address and any cuisine
  the OSM tags name unambiguously are filled in.
- **The map is also the pin.** Tap anywhere, or on your own blue dot, and an ink "+" pin drops
  there with its reverse-geocoded address. You can drag it, and the address follows (only the
  latest lookup counts). That covers a place the provider does not know, and replaces both "drop a
  pin" and a fixed, uneditable "use my current location". SAM restaurants within 75 m of the pin
  are offered first.
- **One search box** asks three things in parallel: SAM restaurants by name (dedup), the
  provider's restaurants (biased to the map's centre) and areas. The answers are grouped. An area
  flies the map there and loads its restaurants, which is what the old city field did, without
  being a field. Panning offers "Search this area" instead of refetching on every drag.
- **The address is never asked for.** It comes from the place or the pin, and can be edited on the
  details step, which otherwise asks only price, cuisine and, for a dropped pin, the name.

Location denied or unavailable is not a dead end: the map opens on Spain and the search box does
the work. The area-anchoring idea this ADR introduced survives as "pick an area in the box".

`RestaurantForm` is now edit-only: name, a movable pin, address, price and cuisine.

Consequences and findings:

- **Quota.** A debounced search now spends two Geoapify credits (place and area autocomplete)
  instead of one, and opening the flow spends one nearby call.
- **Geoapify quirks,** from sampling one real `/places/nearby` call (19 places around the Sagrada
  Família):
  - `formatted` repeats the venue name ("Farggi, Carrer de Provença, 433…"). The provider now
    strips it.
  - OSM cuisine tags rarely equal a vocabulary name ("tapas", "tex-mex", "burger"). A short list of
    unambiguous aliases maps them in `restaurant-fields.tsx`.
- **History.** The flow's steps live in component state, not the URL: device back from the
  details step returns to the list, not to the map. Revisit if people lose a half-filled form that
  way.
