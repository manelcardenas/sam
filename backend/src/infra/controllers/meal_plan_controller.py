from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status

from src.app.use_cases import (
    AddToList,
    AddToWeekList,
    AdvancePlan,
    AssignDish,
    DropEntryFromList,
    GetPlanArchive,
    GetPlanForWeek,
    GetSharedPlans,
    RemoveDish,
    RemoveListItem,
    SharePlan,
    TickItem,
    UnsharePlan,
)
from src.domain.entities import (
    ListItemSource,
    Meal,
    MealPlan,
    PlanEntry,
    PlanStateError,
    PlanStatus,
    PlanSummary,
    ShoppingListItem,
)
from src.domain.ports import MealPlanRepository, UserRepository
from src.infra.controllers.schemas import (
    AddToListRequest,
    AddToWeekListRequest,
    AdvancePlanRequest,
    AssignDishRequest,
    SharePlanRequest,
    TickItemRequest,
)
from src.infra.security import TokenPayload, get_current_user


class MealPlanController:
    def __init__(self, meal_plan_repository: MealPlanRepository, user_repository: UserRepository, router: APIRouter) -> None:
        self.meal_plan_repository = meal_plan_repository
        # Sharing resolves a display name to a user, which is the only reason
        # this controller needs the user repository at all.
        self.user_repository = user_repository
        self.router = router
        self._register_routes()

    def _register_routes(self) -> None:
        common = {"dependencies": [Depends(get_current_user)], "tags": ["Meal planner"]}

        self.router.add_api_route(
            "/plans",
            self.get_week,
            methods=["GET"],
            response_model=MealPlan | None,
            summary="Get the plan for a week",
            description="Returns the caller's plan for the week containing `day`, or null if they haven't planned it. Null is a normal answer — most weeks have no plan.",
            **common,
        )
        self.router.add_api_route(
            "/plans/entries",
            self.assign_dish,
            methods=["PUT"],
            response_model=MealPlan,
            summary="Assign a dish to a slot",
            description="Upserts one slot, creating the week's plan on first use. The slot is the identity: assigning twice changes the dish.",
            **common,
        )
        self.router.add_api_route(
            "/plans/{plan_id}/entries/{entry_id}",
            self.remove_dish,
            methods=["DELETE"],
            response_model=MealPlan,
            summary="Clear a slot",
            description="Removes the dish. Its shopping-list lines are left alone unless `drop_from_list=true` — see the drift rule in §4.5.",
            **common,
        )
        self.router.add_api_route(
            "/plans/{plan_id}/items",
            self.add_to_list,
            methods=["POST"],
            response_model=MealPlan,
            status_code=status.HTTP_201_CREATED,
            summary="Add lines to the shopping list",
            description="Merges on (normalised name, unit) and keeps the per-dish breakdown. Amounts arrive already scaled and already reflect what the user left ticked.",
            **common,
        )
        self.router.add_api_route(
            "/plans/items",
            self.add_extras,
            methods=["POST"],
            response_model=MealPlan,
            status_code=status.HTTP_201_CREATED,
            summary="Add lines to a week's list, planned or not",
            description="Keyed by a day rather than a plan id, and creates the week on first use — the path that puts sugar on next week's list mid-week. Two segments, so it cannot collide with /plans/{plan_id}/items.",
            **common,
        )
        self.router.add_api_route(
            "/plans/{plan_id}/items/{item_id}",
            self.tick_item,
            methods=["PATCH"],
            response_model=ShoppingListItem,
            summary="Tick a list line",
            description="Allowed while the plan is planning or calendar_closed — the latter is the state you are actually shopping in.",
            **common,
        )
        self.router.add_api_route(
            "/plans/{plan_id}/items/{item_id}",
            self.remove_item,
            methods=["DELETE"],
            status_code=status.HTTP_204_NO_CONTENT,
            summary="Remove a list line",
            **common,
        )
        self.router.add_api_route(
            "/plans/shared",
            self.get_shared,
            methods=["GET"],
            response_model=list[MealPlan],
            summary="Weeks other people have shared with you",
            description="A list, not one plan: you can have your own week and be a guest on someone else's, and picking between them would be a guess.",
            **common,
        )
        self.router.add_api_route(
            "/plans/archive",
            self.get_archive,
            methods=["GET"],
            response_model=list[PlanSummary],
            summary="Weeks planned in a year",
            description="Summaries, newest first — enough to list a week, not enough to render it. Includes weeks shared with the caller, flagged by `is_mine`.",
            **common,
        )
        self.router.add_api_route(
            "/plans/{plan_id}/shares",
            self.share,
            methods=["POST"],
            response_model=MealPlan,
            status_code=status.HTTP_201_CREATED,
            summary="Share a week with someone",
            description="Read and tick only (§4.3). Idempotent — sharing twice with the same person is a double tap, not an error.",
            **common,
        )
        self.router.add_api_route(
            "/plans/{plan_id}/shares/{guest_id}",
            self.unshare,
            methods=["DELETE"],
            response_model=MealPlan,
            summary="Stop sharing a week",
            **common,
        )
        self.router.add_api_route(
            "/plans/{plan_id}/status",
            self.advance,
            methods=["POST"],
            response_model=MealPlan,
            summary="Close the calendar, then close the list",
            description="Takes the one transition available. One-way in v1: planning → calendar_closed → list_closed.",
            **common,
        )

    # ── error mapping ────────────────────────────────────────────────────────

    @staticmethod
    def _raise(error: Exception) -> None:
        """Translate domain failures into the codes the client distinguishes."""
        if isinstance(error, PermissionError):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(error)) from error
        if isinstance(error, PlanStateError):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(error)) from error
        if isinstance(error, KeyError):
            # KeyError's str() is repr-quoted, which leaks as `"'Plan not found'"`.
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error).strip("'")) from error
        if isinstance(error, ValueError):
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(error)) from error
        raise error

    def _reload(self, plan_id: str) -> MealPlan:
        """Re-read the whole plan after a write.

        Every mutation returns the plan rather than the thing it changed, because
        one write can move several parts — removing a dish can delete list lines,
        and adding one can merge into an existing line. A client patching its own
        copy from a partial response would drift; re-reading is one round trip
        and cannot.
        """
        plan = self.meal_plan_repository.get_plan(plan_id)
        if plan is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Plan {plan_id} not found")
        return plan

    # ── routes ───────────────────────────────────────────────────────────────

    def get_week(
        self,
        day: date = Query(description="Any day in the week you want; the plan is keyed to that week's Saturday (weeks run Sat→Fri)"),
        current_user: TokenPayload = Depends(get_current_user),
    ) -> MealPlan | None:
        return GetPlanForWeek(self.meal_plan_repository).execute(current_user.sub, day)

    def get_shared(
        self,
        day: date = Query(description="Any day in the week you want"),
        current_user: TokenPayload = Depends(get_current_user),
    ) -> list[MealPlan]:
        return GetSharedPlans(self.meal_plan_repository).execute(current_user.sub, day)

    def get_archive(
        self,
        year: int = Query(ge=2000, le=2200, description="A week belongs to the year its Saturday falls in"),
        current_user: TokenPayload = Depends(get_current_user),
    ) -> list[PlanSummary]:
        return GetPlanArchive(self.meal_plan_repository).execute(current_user.sub, year)

    def share(self, plan_id: str, request: SharePlanRequest, current_user: TokenPayload = Depends(get_current_user)) -> MealPlan:
        try:
            return SharePlan(self.meal_plan_repository, self.user_repository).execute(current_user.sub, plan_id, request.display_name)
        except LookupError as e:
            # 404 on the *person*, distinct from a 404 on the plan. The message
            # is the whole value here: "nobody here is called X" is actionable,
            # "not found" sends someone looking at the wrong thing.
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e)) from e
        except (PermissionError, PlanStateError, KeyError, ValueError) as e:
            self._raise(e)
            raise  # pragma: no cover — _raise always raises

    def unshare(self, plan_id: str, guest_id: str, current_user: TokenPayload = Depends(get_current_user)) -> MealPlan:
        try:
            return UnsharePlan(self.meal_plan_repository).execute(current_user.sub, plan_id, guest_id)
        except (PermissionError, PlanStateError, KeyError, ValueError) as e:
            self._raise(e)
            raise  # pragma: no cover — _raise always raises

    def assign_dish(self, request: AssignDishRequest, current_user: TokenPayload = Depends(get_current_user)) -> MealPlan:
        entry = PlanEntry(
            date=request.date,
            meal=Meal(request.meal),
            recipe_id=request.recipe_id,
            dish_name=request.dish_name,
            servings=request.servings,
        )
        try:
            plan, _ = AssignDish(self.meal_plan_repository).execute(current_user.sub, entry)
        except (PermissionError, PlanStateError, KeyError, ValueError) as e:
            self._raise(e)
        return self._reload(plan.id)

    def remove_dish(
        self,
        plan_id: str,
        entry_id: str,
        drop_from_list: bool = Query(
            default=False,
            description="Also unpick this dish's shopping-list lines. False by default: the list never rewrites itself, the user is asked first (§4.5).",
        ),
        current_user: TokenPayload = Depends(get_current_user),
    ) -> MealPlan:
        try:
            # Order matters: the sources have to be unpicked while the entry
            # still exists, because deleting it sets their entry_id to NULL and
            # they become indistinguishable from manual extras.
            if drop_from_list:
                DropEntryFromList(self.meal_plan_repository).execute(current_user.sub, plan_id, entry_id)
            RemoveDish(self.meal_plan_repository).execute(current_user.sub, plan_id, entry_id)
        except (PermissionError, PlanStateError, KeyError, ValueError) as e:
            self._raise(e)
        return self._reload(plan_id)

    def add_to_list(self, plan_id: str, request: AddToListRequest, current_user: TokenPayload = Depends(get_current_user)) -> MealPlan:
        source_name = request.dish_name
        items = [
            ShoppingListItem(
                display_name=line.name,
                normalised_name="",  # the repository derives this; see merge_key
                unit=line.unit,
                total_amount=line.amount,
                is_manual=request.entry_id is None,
                sources=[ListItemSource(entry_id=request.entry_id, dish_name=source_name, amount=line.amount)] if source_name else [],
            )
            for line in request.items
        ]
        try:
            AddToList(self.meal_plan_repository).execute(current_user.sub, plan_id, items)
        except (PermissionError, PlanStateError, KeyError, ValueError) as e:
            self._raise(e)
        return self._reload(plan_id)

    def add_extras(self, request: AddToWeekListRequest, current_user: TokenPayload = Depends(get_current_user)) -> MealPlan:
        items = [
            ShoppingListItem(
                display_name=line.name,
                normalised_name="",  # the repository derives this; see merge_key
                unit=line.unit,
                total_amount=line.amount,
                # Always manual: there is no dish here by construction, which is
                # the whole reason this route exists separately from the one that
                # takes a plan id.
                is_manual=True,
            )
            for line in request.items
        ]
        try:
            plan = AddToWeekList(self.meal_plan_repository).execute(current_user.sub, request.day, items)
        except (PermissionError, PlanStateError, KeyError, ValueError) as e:
            self._raise(e)
        return self._reload(plan.id)

    def tick_item(self, plan_id: str, item_id: str, request: TickItemRequest, current_user: TokenPayload = Depends(get_current_user)) -> ShoppingListItem:
        try:
            return TickItem(self.meal_plan_repository).execute(current_user.sub, plan_id, item_id, request.is_checked)
        except (PermissionError, PlanStateError, KeyError, ValueError) as e:
            self._raise(e)
            raise  # pragma: no cover — _raise always raises

    def remove_item(self, plan_id: str, item_id: str, current_user: TokenPayload = Depends(get_current_user)) -> Response:
        try:
            RemoveListItem(self.meal_plan_repository).execute(current_user.sub, plan_id, item_id)
        except (PermissionError, PlanStateError, KeyError, ValueError) as e:
            self._raise(e)
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    def advance(self, plan_id: str, request: AdvancePlanRequest, current_user: TokenPayload = Depends(get_current_user)) -> MealPlan:
        try:
            return AdvancePlan(self.meal_plan_repository).execute(current_user.sub, plan_id, PlanStatus(request.from_status), request.carry_over)
        except (PermissionError, PlanStateError, KeyError, ValueError) as e:
            self._raise(e)
            raise  # pragma: no cover — _raise always raises
