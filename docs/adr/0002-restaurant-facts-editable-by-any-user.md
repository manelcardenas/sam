# Restaurant facts are editable by any authenticated user, not just the creator

Restaurants and their reviews are a shared community resource — anyone can review a restaurant someone else added, so "creator" is essentially arbitrary (whoever's search-before-create flow didn't find an existing match first). Locking edits (name, address, price level, cuisine tags) to that arbitrary creator, the way recipes lock edits to their owner, would mean genuine corrections (wrong address, missing cuisine tag) can only be made by whoever happened to add the place — often not who's actually eating there. We chose to make Restaurant facts freely editable by any authenticated user instead, with no ownership check and no audit trail on that data.

Restaurant *deletion* is deliberately **not exposed at all in v1** (rather than restricted to the creator), specifically because deleting a Restaurant cascades to every other user's Reviews of it — see `docs/knowledge/improvement-plan.md`, Phase 2.
