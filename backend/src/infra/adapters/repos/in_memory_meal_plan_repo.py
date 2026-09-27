import uuid
from datetime import UTC, date, datetime

from src.domain.entities import (
    MealPlan,
    PlanEntry,
    PlanStatus,
    PlanSummary,
    ShoppingListItem,
    merge_key,
    normalise_ingredient_name,
    sort_entries,
    sort_items,
)
from src.domain.ports import MealPlanRepository


def _same_dish(existing: PlanEntry, incoming: PlanEntry) -> bool:
    """Whether these are the same dish in the same slot.

    Mirrors the SQL adapter exactly, and the fallback to `dish_name` is the part
    worth stating: `uq_plan_entries_slot_dish` is partial on
    `recipe_id IS NOT NULL`, so the database cannot stop two identical one-off
    text entries. Matching on the name here is what keeps typing "Sobras" twice
    from leaving two of them — a rule the app enforces because the index
    deliberately does not.
    """
    if existing.date != incoming.date or existing.meal != incoming.meal:
        return False
    if incoming.recipe_id is not None:
        return existing.recipe_id == incoming.recipe_id
    return existing.recipe_id is None and existing.dish_name == incoming.dish_name


class InMemoryMealPlanRepository(MealPlanRepository):
    def __init__(self, names: dict[str, str] | None = None) -> None:
        self.plans: dict[str, MealPlan] = {}
        # The SQL adapter reads an author's name off a joined `users` row. This
        # fake has no users table, so tests hand it the mapping — without it every
        # contributor would render nameless and a test asserting on names would
        # pass against a repository that never resolves one.
        self._names: dict[str, str] = names or {}

    # ── helpers ──────────────────────────────────────────────────────────────

    def _plan_of_entry(self, entry_id: str) -> MealPlan | None:
        return next((p for p in self.plans.values() if any(e.id == entry_id for e in p.entries)), None)

    def _plan_of_item(self, item_id: str) -> MealPlan | None:
        return next((p for p in self.plans.values() if any(i.id == item_id for i in p.items)), None)

    def _touch(self, plan: MealPlan) -> None:
        plan.updated_at = datetime.now(UTC).isoformat()

    def _named(self, plan: MealPlan) -> MealPlan:
        """Resolve `created_by` to a display name, the way the join does."""
        for entry in plan.entries:
            entry.created_by_name = self._names.get(entry.created_by or "")
        for item in plan.items:
            item.created_by_name = self._names.get(item.created_by or "")
        return plan

    def _copy(self, plan: MealPlan) -> MealPlan:
        """Hand back a detached, ordered copy.

        Detached so callers can't mutate stored state by holding on to what a
        read returned — the guarantee a real session gives for free. Ordered
        through the same domain comparators the SQL adapter uses, because a fake
        that returns insertion order is a test suite that passes while
        production renders the week differently.
        """
        copy = plan.model_copy(deep=True)
        copy.entries = sort_entries(copy.entries)
        copy.items = sort_items(copy.items)
        return self._named(copy)

    # ── reads ────────────────────────────────────────────────────────────────

    def get_plan(self, plan_id: str) -> MealPlan | None:
        plan = self.plans.get(plan_id)
        return self._copy(plan) if plan else None

    def get_plan_for_week(self, kitchen_id: str, week_start: date) -> MealPlan | None:
        plan = next((p for p in self.plans.values() if p.kitchen_id == kitchen_id and p.week_start == week_start), None)
        return self._copy(plan) if plan else None

    # ── writes ───────────────────────────────────────────────────────────────

    def create_plan(self, kitchen_id: str, week_start: date, created_by: str) -> MealPlan:
        plan = MealPlan(kitchen_id=kitchen_id, week_start=week_start, created_by=created_by)
        self.plans[plan.id] = plan
        return self._copy(plan)

    def upsert_entry(self, plan_id: str, entry: PlanEntry) -> PlanEntry:
        plan = self.plans[plan_id]
        existing = next((e for e in plan.entries if _same_dish(e, entry)), None)
        if existing is None:
            stored = entry.model_copy(deep=True, update={"id": str(uuid.uuid4())})
            plan.entries.append(stored)
        else:
            # The *dish in the slot* is the identity, not the slot. Assigning the
            # same dish again is changing your mind about the headcount; a
            # different dish joins it. The author changes too — whoever set what
            # is there now is who it is attributed to.
            existing.recipe_id = entry.recipe_id
            existing.dish_name = entry.dish_name
            existing.servings = entry.servings
            existing.created_by = entry.created_by
            stored = existing
        self._touch(plan)
        copy = stored.model_copy(deep=True)
        copy.created_by_name = self._names.get(copy.created_by or "")
        return copy

    def delete_entry(self, entry_id: str) -> None:
        plan = self._plan_of_entry(entry_id)
        if plan is None:
            raise KeyError(f"Plan entry {entry_id} not found")
        plan.entries = [e for e in plan.entries if e.id != entry_id]
        self._touch(plan)

    def add_items(self, plan_id: str, items: list[ShoppingListItem]) -> list[ShoppingListItem]:
        plan = self.plans[plan_id]
        touched: dict[str, ShoppingListItem] = {}

        for incoming in items:
            # Same three-argument key the SQL index uses. This fake exists to
            # stand in for that index, so a divergence here is a suite that
            # passes while production merges wrong.
            key = merge_key(incoming.display_name, incoming.unit, incoming.grocery_key)
            existing = next((i for i in plan.items if merge_key(i.display_name, i.unit, i.grocery_key) == key), None)

            if existing is None:
                existing = ShoppingListItem(
                    id=str(uuid.uuid4()),
                    display_name=incoming.display_name.strip(),
                    normalised_name=normalise_ingredient_name(incoming.display_name),
                    grocery_key=incoming.grocery_key,
                    unit=incoming.unit,
                    total_amount=incoming.total_amount,
                    is_manual=incoming.is_manual,
                    created_by=incoming.created_by,
                    sources=[],
                )
                plan.items.append(existing)
            elif incoming.total_amount is not None:
                # None is not zero: an amount-less line adopts the first real
                # measurement rather than summing against a fictional 0.
                existing.total_amount = (existing.total_amount or 0.0) + incoming.total_amount
            # `created_by` is deliberately not touched on the merge branch: the
            # line was put on the list once, by whoever got there first.

            existing.sources.extend(s.model_copy(deep=True) for s in incoming.sources)
            touched[existing.id] = existing

        self._touch(plan)
        return [self._name_of(i.model_copy(deep=True)) for i in touched.values()]

    def _name_of(self, item: ShoppingListItem) -> ShoppingListItem:
        item.created_by_name = self._names.get(item.created_by or "")
        return item

    def set_item_checked(self, item_id: str, is_checked: bool) -> ShoppingListItem | None:
        plan = self._plan_of_item(item_id)
        if plan is None:
            return None
        item = next(i for i in plan.items if i.id == item_id)
        item.is_checked = is_checked
        self._touch(plan)
        return self._name_of(item.model_copy(deep=True))

    def set_item_amount(self, item_id: str, amount: float) -> ShoppingListItem | None:
        plan = self._plan_of_item(item_id)
        if plan is None:
            return None
        item = next(i for i in plan.items if i.id == item_id)
        item.total_amount = amount
        self._touch(plan)
        return self._name_of(item.model_copy(deep=True))

    def set_item_grocery_key(self, item_id: str, grocery_key: str, amount: float | None = None, unit: str | None = None) -> ShoppingListItem | None:
        plan = self._plan_of_item(item_id)
        if plan is None:
            return None
        item = next(i for i in plan.items if i.id == item_id)
        if item.total_amount is None and amount is not None:
            item.total_amount = amount
            item.unit = unit
        key = merge_key(item.display_name, item.unit, grocery_key)
        # Same key function the SQL index uses — see `add_items`.
        other = next((i for i in plan.items if i.id != item_id and merge_key(i.display_name, i.unit, i.grocery_key) == key), None)

        if other is None:
            item.grocery_key = grocery_key
            survivor = item
        else:
            if item.total_amount is not None:
                other.total_amount = (other.total_amount or 0.0) + item.total_amount
            other.sources.extend(s.model_copy(deep=True) for s in item.sources)
            other.is_checked = other.is_checked and item.is_checked
            plan.items = [i for i in plan.items if i.id != item_id]
            survivor = other

        self._touch(plan)
        return self._name_of(survivor.model_copy(deep=True))

    def delete_item(self, item_id: str) -> None:
        plan = self._plan_of_item(item_id)
        if plan is None:
            raise KeyError(f"List item {item_id} not found")
        plan.items = [i for i in plan.items if i.id != item_id]
        self._touch(plan)

    def drop_sources_for_entry(self, entry_id: str) -> int:
        plan = self._plan_of_entry(entry_id) or next((p for p in self.plans.values() if self._has_source(p, entry_id)), None)
        if plan is None:
            return 0

        removed = 0
        surviving: list[ShoppingListItem] = []
        for item in plan.items:
            gone = [s for s in item.sources if s.entry_id == entry_id]
            if not gone:
                surviving.append(item)
                continue

            subtracted = sum(s.amount for s in gone if s.amount is not None)
            if subtracted and item.total_amount is not None:
                # Never negative: the arithmetic can drift if a line was edited
                # by hand, and a negative quantity is nonsense, not information.
                item.total_amount = max(0.0, item.total_amount - subtracted)
            item.sources = [s for s in item.sources if s.entry_id != entry_id]

            if not item.is_manual and not item.sources:
                removed += 1
                continue
            surviving.append(item)

        plan.items = surviving
        self._touch(plan)
        return removed

    @staticmethod
    def _has_source(plan: MealPlan, entry_id: str) -> bool:
        return any(s.entry_id == entry_id for item in plan.items for s in item.sources)

    def _pending(self, kitchen_id: str, before: date) -> list[tuple[MealPlan, ShoppingListItem]]:
        """Same selection as the SQL adapter's `_pending_lines`, in the same order."""
        weeks = sorted(
            (p for p in self.plans.values() if p.kitchen_id == kitchen_id and p.week_start < before and p.status is not PlanStatus.LIST_CLOSED),
            key=lambda p: p.week_start,
        )
        return [(plan, item) for plan in weeks for item in plan.items if not item.is_checked]

    def count_pending_before(self, kitchen_id: str, before: date) -> int:
        return len(self._pending(kitchen_id, before))

    def carry_forward(self, kitchen_id: str, into_plan_id: str, before: date) -> int:
        target = self.plans[into_plan_id]
        pending = self._pending(kitchen_id, before)

        for source, line in pending:
            source.items = [i for i in source.items if i.id != line.id]
            key = merge_key(line.display_name, line.unit, line.grocery_key)
            already = next((i for i in target.items if merge_key(i.display_name, i.unit, i.grocery_key) == key), None)
            if already is None:
                line.pending_since = line.pending_since or source.week_start
                target.items.append(line)
            else:
                if line.total_amount is not None:
                    already.total_amount = (already.total_amount or 0.0) + line.total_amount
                already.sources.extend(s.model_copy(deep=True) for s in line.sources)
                already.is_checked = False
            self._touch(source)

        self._touch(target)
        return len(pending)

    def list_year(self, kitchen_ids: list[str], year: int) -> list[PlanSummary]:
        visible = [plan for plan in self.plans.values() if plan.week_start.year == year and plan.kitchen_id in kitchen_ids]
        return [
            PlanSummary(
                id=plan.id,
                week_start=plan.week_start,
                status=plan.status,
                entry_count=len(plan.entries),
                item_count=len(plan.items),
                checked_count=sum(1 for item in plan.items if item.is_checked),
            )
            # Newest first, matching the SQL adapter — the archive is read
            # backwards from now, not forwards from January.
            for plan in sorted(visible, key=lambda p: p.week_start, reverse=True)
        ]
