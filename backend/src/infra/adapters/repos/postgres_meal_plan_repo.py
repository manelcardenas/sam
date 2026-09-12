import uuid
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from src.domain.entities import ListItemSource, MealPlan, PlanEntry, PlanStatus, PlanSummary, ShoppingListItem, merge_key, sort_entries, sort_items
from src.domain.ports import MealPlanRepository
from src.infra.db import ListItemSourceModel, MealPlanModel, PlanEntryModel, ShoppingListItemModel

# The stored `unit`, with its absence spelled as '' so NULLs compare equal.
#
# This has to match `uq_shopping_list_items_merge_key` exactly. Index the bare
# column instead and the unique constraint stops merging the *common* case —
# most household ingredients have no unit, and Postgres treats NULLs as distinct
# (docs/plans/meal-planner-plan.md §8.3b).
_UNIT_KEY = func.coalesce(ShoppingListItemModel.unit, "")


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
            unit=model.unit,
            total_amount=float(model.total_amount) if model.total_amount is not None else None,
            is_checked=model.is_checked,
            is_manual=model.is_manual,
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
            existing = session.scalars(
                select(PlanEntryModel).where(
                    PlanEntryModel.plan_id == uuid.UUID(plan_id),
                    PlanEntryModel.date == entry.date,
                    PlanEntryModel.meal == entry.meal,
                )
            ).one_or_none()

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
                name_key, unit_key = merge_key(incoming.display_name, incoming.unit)
                existing = session.scalars(
                    select(ShoppingListItemModel).where(
                        ShoppingListItemModel.plan_id == plan_uuid,
                        ShoppingListItemModel.normalised_name == name_key,
                        _UNIT_KEY == unit_key,
                    )
                ).one_or_none()

                if existing is None:
                    existing = ShoppingListItemModel(
                        plan_id=plan_uuid,
                        # The first spelling wins, so the list reads in the
                        # user's own words rather than in normalised form.
                        display_name=incoming.display_name.strip(),
                        normalised_name=name_key,
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

    def set_status(self, plan_id: str, status: PlanStatus) -> MealPlan | None:
        with self._session_factory() as session:
            model = session.get(MealPlanModel, uuid.UUID(plan_id))
            if model is None:
                return None
            model.status = status
            session.commit()
            session.refresh(model)
            return self._to_entity(model)

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
