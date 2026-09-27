import uuid
from datetime import date

from sqlalchemy import Select, and_, func, select
from sqlalchemy.orm import Session, sessionmaker

from src.domain.entities import (
    ListItemSource,
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
from src.infra.db import ListItemSourceModel, MealPlanModel, PlanEntryModel, ShoppingListItemModel

# The stored `unit`, with its absence spelled as '' so NULLs compare equal.
#
# This has to match `uq_shopping_list_items_merge_key` exactly. Index the bare
# column instead and the unique constraint stops merging the *common* case —
# most household ingredients have no unit, and Postgres treats NULLs as distinct
# (docs/plans/meal-planner-plan.md §8.3b).
_UNIT_KEY = func.coalesce(ShoppingListItemModel.unit, "")
# The identity half of the merge key, mirroring `merge_key()` and the SQL index.
# All three have to agree; see the index comment in models.py.
_NAME_KEY = func.coalesce(ShoppingListItemModel.grocery_key, ShoppingListItemModel.normalised_name)


class PostgresMealPlanRepository(MealPlanRepository):
    def __init__(self, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    # ── mapping ──────────────────────────────────────────────────────────────

    def _entry_to_entity(self, model: PlanEntryModel) -> PlanEntry:
        return PlanEntry(
            id=str(model.id),
            date=model.date,
            meal=model.meal,
            recipe_id=str(model.recipe_id) if model.recipe_id else None,
            dish_name=model.dish_name,
            servings=model.servings,
            created_by=model.created_by,
            created_by_name=model.author.display_name if model.author else None,
        )

    def _item_to_entity(self, model: ShoppingListItemModel) -> ShoppingListItem:
        return ShoppingListItem(
            id=str(model.id),
            display_name=model.display_name,
            normalised_name=model.normalised_name,
            grocery_key=model.grocery_key,
            unit=model.unit,
            total_amount=float(model.total_amount) if model.total_amount is not None else None,
            is_checked=model.is_checked,
            is_manual=model.is_manual,
            pending_since=model.pending_since,
            created_by=model.created_by,
            created_by_name=model.author.display_name if model.author else None,
            sources=[
                ListItemSource(
                    entry_id=str(source.entry_id) if source.entry_id else None,
                    dish_name=source.dish_name,
                    amount=float(source.amount) if source.amount is not None else None,
                )
                for source in model.sources
            ],
        )

    def _to_entity(self, model: MealPlanModel) -> MealPlan:
        return MealPlan(
            id=str(model.id),
            kitchen_id=str(model.kitchen_id),
            created_by=model.created_by,
            week_start=model.week_start,
            status=model.status,
            # Ordered by the domain's own comparators, which both adapters
            # share — see sort_entries for why this is not `meal.value`.
            entries=sort_entries([self._entry_to_entity(e) for e in model.entries]),
            items=sort_items([self._item_to_entity(i) for i in model.items]),
            created_at=model.created_at.isoformat(),
            updated_at=model.updated_at.isoformat(),
        )

    # ── reads ────────────────────────────────────────────────────────────────

    def get_plan(self, plan_id: str) -> MealPlan | None:
        with self._session_factory() as session:
            model = session.get(MealPlanModel, uuid.UUID(plan_id))
            return self._to_entity(model) if model else None

    def get_plan_for_week(self, kitchen_id: str, week_start: date) -> MealPlan | None:
        with self._session_factory() as session:
            model = session.scalars(select(MealPlanModel).where(MealPlanModel.kitchen_id == uuid.UUID(kitchen_id), MealPlanModel.week_start == week_start)).one_or_none()
            return self._to_entity(model) if model else None

    # ── writes ───────────────────────────────────────────────────────────────

    def create_plan(self, kitchen_id: str, week_start: date, created_by: str) -> MealPlan:
        with self._session_factory() as session:
            model = MealPlanModel(kitchen_id=uuid.UUID(kitchen_id), week_start=week_start, created_by=created_by, status=PlanStatus.PLANNING)
            session.add(model)
            session.commit()
            session.refresh(model)
            return self._to_entity(model)

    def upsert_entry(self, plan_id: str, entry: PlanEntry) -> PlanEntry:
        with self._session_factory() as session:
            # The *dish in the slot* is the identity, not the slot: a slot holds
            # a flat list, so a different dish joins Wednesday dinner rather than
            # replacing what is there.
            #
            # The fallback to `dish_name` matters. `uq_plan_entries_slot_dish` is
            # partial on `recipe_id IS NOT NULL`, so the database cannot stop two
            # identical one-off text entries — matching on the name here is what
            # keeps typing "Sobras" twice from leaving two of them. The in-memory
            # adapter's `_same_dish` says the same thing; the two have to agree
            # or a suite passes while production duplicates rows.
            slot = (
                PlanEntryModel.plan_id == uuid.UUID(plan_id),
                PlanEntryModel.date == entry.date,
                PlanEntryModel.meal == entry.meal,
            )
            identity = (
                PlanEntryModel.recipe_id == uuid.UUID(entry.recipe_id)
                if entry.recipe_id
                else and_(PlanEntryModel.recipe_id.is_(None), PlanEntryModel.dish_name == entry.dish_name)
            )
            existing = session.scalars(select(PlanEntryModel).where(*slot, identity)).one_or_none()

            if existing is None:
                existing = PlanEntryModel(plan_id=uuid.UUID(plan_id), date=entry.date, meal=entry.meal)
                session.add(existing)

            existing.recipe_id = uuid.UUID(entry.recipe_id) if entry.recipe_id else None
            # Snapshotted on every write, so renaming a recipe updates future
            # plans without rewriting past ones (§8.3a).
            existing.dish_name = entry.dish_name
            existing.servings = entry.servings
            # Whoever set what is in the slot now is who it is attributed to.
            existing.created_by = entry.created_by
            session.commit()
            session.refresh(existing)
            return self._entry_to_entity(existing)

    def delete_entry(self, entry_id: str) -> None:
        with self._session_factory() as session:
            model = session.get(PlanEntryModel, uuid.UUID(entry_id))
            if model is None:
                raise KeyError(f"Plan entry {entry_id} not found")
            session.delete(model)
            session.commit()

    def add_items(self, plan_id: str, items: list[ShoppingListItem]) -> list[ShoppingListItem]:
        """Merge lines in, one per `(normalised name, unit)`, keeping provenance.

        Two details that are easy to get wrong:

        - **`None` and `0` are different totals.** A line with no amount ("sal")
          stays amount-less; adding a measured line to an amount-less one adopts
          the measurement rather than treating the absence as zero.
        - **Sources are appended, never replaced.** Two dishes needing onions
          leave two sources on one line, which is what makes the breakdown
          answer "why is there fennel on this list?".
        """
        with self._session_factory() as session:
            plan_uuid = uuid.UUID(plan_id)
            touched: dict[str, ShoppingListItemModel] = {}

            for incoming in items:
                # `normalised_name` is still derived from what was typed — it is
                # the fallback identity and the thing a legacy row matches on.
                # The grocery key, when the caller resolved one, is what actually
                # merges.
                name_key, unit_key = merge_key(incoming.display_name, incoming.unit, incoming.grocery_key)
                existing = session.scalars(
                    select(ShoppingListItemModel).where(
                        ShoppingListItemModel.plan_id == plan_uuid,
                        _NAME_KEY == name_key,
                        _UNIT_KEY == unit_key,
                    )
                ).one_or_none()

                if existing is None:
                    existing = ShoppingListItemModel(
                        plan_id=plan_uuid,
                        # The first spelling wins, so the list reads in the
                        # user's own words rather than in normalised form.
                        display_name=incoming.display_name.strip(),
                        normalised_name=normalise_ingredient_name(incoming.display_name),
                        grocery_key=incoming.grocery_key,
                        unit=incoming.unit,
                        total_amount=incoming.total_amount,
                        is_manual=incoming.is_manual,
                        created_by=incoming.created_by,
                    )
                    session.add(existing)
                elif incoming.total_amount is not None:
                    current = float(existing.total_amount) if existing.total_amount is not None else 0.0
                    existing.total_amount = current + incoming.total_amount
                # `created_by` is deliberately not touched on the merge branch:
                # the line was put on the list once, by whoever got there first.

                for source in incoming.sources:
                    existing.sources.append(
                        ListItemSourceModel(
                            entry_id=uuid.UUID(source.entry_id) if source.entry_id else None,
                            dish_name=source.dish_name,
                            amount=source.amount,
                        )
                    )
                session.flush()
                touched[str(existing.id)] = existing

            session.commit()
            for model in touched.values():
                session.refresh(model)
            return [self._item_to_entity(m) for m in touched.values()]

    def set_item_checked(self, item_id: str, is_checked: bool) -> ShoppingListItem | None:
        with self._session_factory() as session:
            model = session.get(ShoppingListItemModel, uuid.UUID(item_id))
            if model is None:
                return None
            model.is_checked = is_checked
            session.commit()
            session.refresh(model)
            return self._item_to_entity(model)

    def set_item_amount(self, item_id: str, amount: float) -> ShoppingListItem | None:
        with self._session_factory() as session:
            model = session.get(ShoppingListItemModel, uuid.UUID(item_id))
            if model is None:
                return None
            model.total_amount = amount
            session.commit()
            session.refresh(model)
            return self._item_to_entity(model)

    def set_item_grocery_key(self, item_id: str, grocery_key: str, amount: float | None = None, unit: str | None = None) -> ShoppingListItem | None:
        with self._session_factory() as session:
            model = session.get(ShoppingListItemModel, uuid.UUID(item_id))
            if model is None:
                return None
            if model.total_amount is None and amount is not None:
                model.total_amount = amount
                model.unit = unit

            name_key, unit_key = merge_key(model.display_name, model.unit, grocery_key)
            other = session.scalars(
                select(ShoppingListItemModel).where(
                    ShoppingListItemModel.plan_id == model.plan_id,
                    ShoppingListItemModel.id != model.id,
                    _NAME_KEY == name_key,
                    _UNIT_KEY == unit_key,
                )
            ).one_or_none()

            if other is None:
                model.grocery_key = grocery_key
                survivor = model
            else:
                # Folded rather than re-keyed: two rows on one merge key is what
                # `uq_shopping_list_items_merge_key` exists to refuse.
                if model.total_amount is not None:
                    current = float(other.total_amount) if other.total_amount is not None else 0.0
                    other.total_amount = current + float(model.total_amount)
                for source in model.sources:
                    other.sources.append(ListItemSourceModel(entry_id=source.entry_id, dish_name=source.dish_name, amount=source.amount))
                other.is_checked = other.is_checked and model.is_checked
                session.delete(model)
                survivor = other

            session.commit()
            session.refresh(survivor)
            return self._item_to_entity(survivor)

    def delete_item(self, item_id: str) -> None:
        with self._session_factory() as session:
            model = session.get(ShoppingListItemModel, uuid.UUID(item_id))
            if model is None:
                raise KeyError(f"List item {item_id} not found")
            session.delete(model)
            session.commit()

    def drop_sources_for_entry(self, entry_id: str) -> int:
        with self._session_factory() as session:
            sources = list(session.scalars(select(ListItemSourceModel).where(ListItemSourceModel.entry_id == uuid.UUID(entry_id))))
            removed = 0

            for source in sources:
                item = source.item
                if source.amount is not None and item.total_amount is not None:
                    # max(0) rather than letting it go negative: the arithmetic
                    # can drift if a line was edited by hand, and a negative
                    # quantity on a shopping list is nonsense rather than
                    # information.
                    item.total_amount = max(0.0, float(item.total_amount) - float(source.amount))
                session.delete(source)
                session.flush()

                # A line nobody asked for any more goes. A hand-added extra
                # stays: you put it there, not the dish.
                if not item.is_manual and not item.sources:
                    session.delete(item)
                    removed += 1

            session.commit()
            return removed

    def _pending_lines(self, kitchen_id: str, before: date) -> Select[tuple[ShoppingListItemModel, date]]:
        """Unticked lines on the kitchen's open weeks before `before`, oldest week first."""
        return (
            select(ShoppingListItemModel, MealPlanModel.week_start)
            .join(MealPlanModel, ShoppingListItemModel.plan_id == MealPlanModel.id)
            .where(
                MealPlanModel.kitchen_id == uuid.UUID(kitchen_id),
                MealPlanModel.week_start < before,
                MealPlanModel.status != PlanStatus.LIST_CLOSED,
                ShoppingListItemModel.is_checked.is_(False),
            )
            .order_by(MealPlanModel.week_start, ShoppingListItemModel.created_at)
        )

    def count_pending_before(self, kitchen_id: str, before: date) -> int:
        with self._session_factory() as session:
            return session.scalar(select(func.count()).select_from(self._pending_lines(kitchen_id, before).subquery())) or 0

    def carry_forward(self, kitchen_id: str, into_plan_id: str, before: date) -> int:
        with self._session_factory() as session:
            target = uuid.UUID(into_plan_id)
            # FOR UPDATE OF the lines only: two people opening the planner on the
            # same Saturday both try this, and the second must wait and then find
            # nothing left rather than fold the same line in twice.
            rows = session.execute(self._pending_lines(kitchen_id, before).with_for_update(of=ShoppingListItemModel)).all()

            for line, week_start in rows:
                name_key, unit_key = merge_key(line.display_name, line.unit, line.grocery_key)
                already = session.scalars(
                    select(ShoppingListItemModel).where(
                        ShoppingListItemModel.plan_id == target,
                        _NAME_KEY == name_key,
                        _UNIT_KEY == unit_key,
                    )
                ).one_or_none()

                if already is None:
                    line.plan_id = target
                    # The earliest week wins: a line carried twice is still the
                    # sugar you meant to buy three weeks ago.
                    line.pending_since = line.pending_since or week_start
                else:
                    # Folded, the way `set_item_grocery_key` folds: two rows on one
                    # merge key is what the unique index exists to refuse.
                    if line.total_amount is not None:
                        current = float(already.total_amount) if already.total_amount is not None else 0.0
                        already.total_amount = current + float(line.total_amount)
                    for source in line.sources:
                        already.sources.append(ListItemSourceModel(entry_id=source.entry_id, dish_name=source.dish_name, amount=source.amount))
                    # Part of it is still to buy, whatever the target said.
                    already.is_checked = False
                    session.delete(line)
                # Flushed per line so a second week's line with the same key finds
                # the first one where it now lives.
                session.flush()

            session.commit()
            return len(rows)

    def list_year(self, kitchen_ids: list[str], year: int) -> list[PlanSummary]:
        if not kitchen_ids:
            # A caller with no kitchen has no archive. Short-circuited rather than
            # sent to the database, where `IN ()` is a syntax error in some
            # dialects and a full scan in others.
            return []

        with self._session_factory() as session:
            # Correlated scalar subqueries rather than joins with GROUP BY:
            # counting entries and list lines in one joined query multiplies the
            # two together (5 entries x 20 lines = 100 rows, both counts wrong).
            entries = select(func.count()).select_from(PlanEntryModel).where(PlanEntryModel.plan_id == MealPlanModel.id).scalar_subquery()
            items = select(func.count()).select_from(ShoppingListItemModel).where(ShoppingListItemModel.plan_id == MealPlanModel.id).scalar_subquery()
            checked = (
                select(func.count())
                .select_from(ShoppingListItemModel)
                .where(ShoppingListItemModel.plan_id == MealPlanModel.id, ShoppingListItemModel.is_checked.is_(True))
                .scalar_subquery()
            )

            rows = session.execute(
                select(MealPlanModel, entries, items, checked)
                .where(
                    func.extract("year", MealPlanModel.week_start) == year,
                    # Every kitchen the caller has ever been in, not only the
                    # current one: moving house does not take your old weeks with
                    # you (§8.12).
                    MealPlanModel.kitchen_id.in_([uuid.UUID(k) for k in kitchen_ids]),
                )
                .order_by(MealPlanModel.week_start.desc())
            ).all()

            return [
                PlanSummary(
                    id=str(plan.id),
                    week_start=plan.week_start,
                    status=plan.status,
                    entry_count=entry_count,
                    item_count=item_count,
                    checked_count=checked_count,
                )
                for plan, entry_count, item_count, checked_count in rows
            ]
