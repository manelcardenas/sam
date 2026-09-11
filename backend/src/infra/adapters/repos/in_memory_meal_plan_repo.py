import uuid
from datetime import UTC, date, datetime

from src.domain.entities import MealPlan, PlanEntry, PlanGuest, PlanStatus, PlanSummary, ShoppingListItem, merge_key, sort_entries, sort_items
from src.domain.ports import MealPlanRepository


class InMemoryMealPlanRepository(MealPlanRepository):
    def __init__(self, names: dict[str, str] | None = None) -> None:
        self.plans: dict[str, MealPlan] = {}
        # The SQL adapter reads guest names off a joined `users` row. This fake
        # has no users table, so tests hand it the mapping — without it every
        # guest would render nameless and a test asserting on names would pass
        # against a repository that never resolves one.
        self._names: dict[str, str] = names or {}

    # ── helpers ──────────────────────────────────────────────────────────────

    def _plan_of_entry(self, entry_id: str) -> MealPlan | None:
        return next((p for p in self.plans.values() if any(e.id == entry_id for e in p.entries)), None)

    def _plan_of_item(self, item_id: str) -> MealPlan | None:
        return next((p for p in self.plans.values() if any(i.id == item_id for i in p.items)), None)

    def _touch(self, plan: MealPlan) -> None:
        plan.updated_at = datetime.now(UTC).isoformat()

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
        copy.shared_with = sorted(copy.shared_with, key=lambda g: (g.display_name or "").lower())
        return copy

    # ── reads ────────────────────────────────────────────────────────────────

    def get_plan(self, plan_id: str) -> MealPlan | None:
        plan = self.plans.get(plan_id)
        return self._copy(plan) if plan else None

    def get_plan_for_week(self, owner_id: str, week_start: date) -> MealPlan | None:
        plan = next((p for p in self.plans.values() if p.owner_id == owner_id and p.week_start == week_start), None)
        return self._copy(plan) if plan else None

    # ── writes ───────────────────────────────────────────────────────────────

    def create_plan(self, owner_id: str, week_start: date) -> MealPlan:
        plan = MealPlan(owner_id=owner_id, week_start=week_start)
        self.plans[plan.id] = plan
        return self._copy(plan)

    def upsert_entry(self, plan_id: str, entry: PlanEntry) -> PlanEntry:
        plan = self.plans[plan_id]
        existing = next((e for e in plan.entries if e.date == entry.date and e.meal == entry.meal), None)
        if existing is None:
            stored = entry.model_copy(deep=True, update={"id": str(uuid.uuid4())})
            plan.entries.append(stored)
        else:
            # The slot is the identity: reassigning it changes the dish, it does
            # not create a second Wednesday dinner.
            existing.recipe_id = entry.recipe_id
            existing.dish_name = entry.dish_name
            existing.servings = entry.servings
            stored = existing
        self._touch(plan)
        return stored.model_copy(deep=True)

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
            key = merge_key(incoming.display_name, incoming.unit)
            existing = next((i for i in plan.items if merge_key(i.display_name, i.unit) == key), None)

            if existing is None:
                existing = ShoppingListItem(
                    id=str(uuid.uuid4()),
                    display_name=incoming.display_name.strip(),
                    normalised_name=key[0],
                    unit=incoming.unit,
                    total_amount=incoming.total_amount,
                    is_manual=incoming.is_manual,
                    sources=[],
                )
                plan.items.append(existing)
            elif incoming.total_amount is not None:
                # None is not zero: an amount-less line adopts the first real
                # measurement rather than summing against a fictional 0.
                existing.total_amount = (existing.total_amount or 0.0) + incoming.total_amount

            existing.sources.extend(s.model_copy(deep=True) for s in incoming.sources)
            touched[existing.id] = existing

        self._touch(plan)
        return [i.model_copy(deep=True) for i in touched.values()]

    def set_item_checked(self, item_id: str, is_checked: bool) -> ShoppingListItem | None:
        plan = self._plan_of_item(item_id)
        if plan is None:
            return None
        item = next(i for i in plan.items if i.id == item_id)
        item.is_checked = is_checked
        self._touch(plan)
        return item.model_copy(deep=True)

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

    def set_status(self, plan_id: str, status: PlanStatus) -> MealPlan | None:
        plan = self.plans.get(plan_id)
        if plan is None:
            return None
        plan.status = status
        self._touch(plan)
        return self._copy(plan)

    # ── sharing (§4.3) ───────────────────────────────────────────────────────

    def share_plan(self, plan_id: str, user_id: str) -> None:
        plan = self.plans[plan_id]
        # Idempotent, like the SQL adapter's ON CONFLICT DO NOTHING: sharing
        # twice with the same person is a double tap, not an error.
        if not any(guest.user_id == user_id for guest in plan.shared_with):
            plan.shared_with.append(PlanGuest(user_id=user_id, display_name=self._names.get(user_id)))
            self._touch(plan)

    def unshare_plan(self, plan_id: str, user_id: str) -> None:
        plan = self.plans[plan_id]
        plan.shared_with = [guest for guest in plan.shared_with if guest.user_id != user_id]
        self._touch(plan)

    def list_shared_with(self, user_id: str, week_start: date) -> list[MealPlan]:
        return [self._copy(plan) for plan in self.plans.values() if plan.week_start == week_start and any(guest.user_id == user_id for guest in plan.shared_with)]

    def list_year(self, user_id: str, year: int) -> list[PlanSummary]:
        visible = [
            plan
            for plan in self.plans.values()
            if plan.week_start.year == year and (plan.owner_id == user_id or any(guest.user_id == user_id for guest in plan.shared_with))
        ]
        return [
            PlanSummary(
                id=plan.id,
                week_start=plan.week_start,
                status=plan.status,
                owner_id=plan.owner_id,
                owner_name=self._names.get(plan.owner_id),
                is_mine=plan.owner_id == user_id,
                entry_count=len(plan.entries),
                item_count=len(plan.items),
                checked_count=sum(1 for item in plan.items if item.is_checked),
            )
            # Newest first, matching the SQL adapter — the archive is read
            # backwards from now, not forwards from January.
            for plan in sorted(visible, key=lambda p: p.week_start, reverse=True)
        ]
