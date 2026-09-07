from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import Field

from src.app.use_cases import (
    CreateRestaurant,
    CreateReview,
    DeleteReview,
    GetRestaurant,
    GetReview,
    ListCuisines,
    ListReviews,
    SearchRestaurants,
    UpdateRestaurant,
    UpdateReview,
)
from src.domain.entities import Cuisine, Restaurant, RestaurantDetail, RestaurantFilters, RestaurantSort, Review
from src.domain.ports import CuisineRepository, RestaurantRepository, ReviewRepository
from src.infra.controllers.schemas import CreateRestaurantRequest, CreateReviewRequest, UpdateRestaurantRequest
from src.infra.security import TokenPayload, get_current_user

# Constraints on a repeated query param belong on the *element* type. Passing
# ge/le to Query() applies them to the list object itself, and Pydantic then
# raises "Unable to apply constraint 'ge' to supplied value []" on every
# request — including the default empty list, so the endpoint 500s outright.
PriceLevelParam = Annotated[int, Field(ge=1, le=4)]


class RestaurantController:
    def __init__(
        self,
        restaurant_repository: RestaurantRepository,
        review_repository: ReviewRepository,
        cuisine_repository: CuisineRepository,
        router: APIRouter,
    ) -> None:
        self.restaurant_repository = restaurant_repository
        self.review_repository = review_repository
        self.cuisine_repository = cuisine_repository
        self.router = router
        self._register_routes()

    def _register_routes(self) -> None:
        self.router.add_api_route(
            "/restaurants",
            self.list_restaurants,
            methods=["GET"],
            response_model=list[RestaurantDetail],
            dependencies=[Depends(get_current_user)],
            summary="Search restaurants",
            description="Lists restaurants with aggregate ratings, most recently visited first. Narrow with ?q=, ?cuisines=, ?price_levels=, ?min_score=, ?mine=; order with ?sort=",
            tags=["Restaurants"],
        )

        self.router.add_api_route(
            "/restaurants",
            self.create_restaurant,
            methods=["POST"],
            response_model=Restaurant,
            dependencies=[Depends(get_current_user)],
            status_code=status.HTTP_201_CREATED,
            summary="Create a restaurant",
            description="Creates a new restaurant and returns it. If the picked Place is already on SAM (same external_place_id), returns the existing restaurant with 200 instead",
            tags=["Restaurants"],
        )

        self.router.add_api_route(
            "/restaurants/{restaurant_id}",
            self.get_restaurant,
            methods=["GET"],
            response_model=RestaurantDetail,
            dependencies=[Depends(get_current_user)],
            summary="Get a restaurant",
            description="Returns a restaurant with its computed aggregate ratings",
            tags=["Restaurants"],
        )

        self.router.add_api_route(
            "/restaurants/{restaurant_id}",
            self.update_restaurant,
            methods=["PUT"],
            response_model=Restaurant,
            dependencies=[Depends(get_current_user)],
            summary="Update a restaurant",
            description="Updates a restaurant's shared facts — any authenticated user may call this",
            tags=["Restaurants"],
        )

        self.router.add_api_route(
            "/cuisines",
            self.list_cuisines,
            methods=["GET"],
            response_model=list[Cuisine],
            dependencies=[Depends(get_current_user)],
            summary="List cuisines",
            description="Returns the curated cuisine vocabulary",
            tags=["Restaurants"],
        )

        self.router.add_api_route(
            "/restaurants/{restaurant_id}/reviews",
            self.list_reviews,
            methods=["GET"],
            response_model=list[Review],
            dependencies=[Depends(get_current_user)],
            summary="List reviews",
            description="Returns all reviews for a restaurant",
            tags=["Reviews"],
        )

        self.router.add_api_route(
            "/restaurants/{restaurant_id}/reviews",
            self.create_review,
            methods=["POST"],
            response_model=Review,
            dependencies=[Depends(get_current_user)],
            status_code=status.HTTP_201_CREATED,
            summary="Submit a review",
            description="Submits a review for a restaurant and returns it",
            tags=["Reviews"],
        )

        self.router.add_api_route(
            "/restaurants/{restaurant_id}/reviews/{review_id}",
            self.update_review,
            methods=["PUT"],
            response_model=Review,
            dependencies=[Depends(get_current_user)],
            summary="Edit a review",
            description="Replaces a review's scores/comment/visit date — only its author may do this",
            tags=["Reviews"],
        )

        self.router.add_api_route(
            "/restaurants/{restaurant_id}/reviews/{review_id}",
            self.delete_review,
            methods=["DELETE"],
            status_code=status.HTTP_204_NO_CONTENT,
            dependencies=[Depends(get_current_user)],
            summary="Delete a review",
            description="Deletes a review by ID — only its author may do this",
            tags=["Reviews"],
        )

    def list_restaurants(
        self,
        q: str | None = Query(default=None, max_length=255, description="Case-insensitive name match"),
        cuisines: list[str] = Query(default_factory=list, description="Any-of cuisine tags"),
        price_levels: list[PriceLevelParam] = Query(default_factory=list, description="Any-of price levels, 1-4"),
        min_score: float | None = Query(default=None, ge=0, le=10, description="Floor on average overall; excludes unreviewed restaurants"),
        mine: bool = Query(default=False, description="Only restaurants the caller has reviewed"),
        sort: RestaurantSort = Query(
            default=RestaurantSort.RECENT,
            description="recent | oldest by last visit; rating | rating_low by average score. Unrated and unvisited restaurants sort last in every ordering",
        ),
        current_user: TokenPayload = Depends(get_current_user),
    ) -> list[RestaurantDetail]:
        """List restaurants with aggregate ratings, narrowed by the filter params.

        Defaults to most-recently-visited order: the list is a record of meals,
        not an inventory of venues. Also used for create-time dedup, which passes only `q`.
        """
        filters = RestaurantFilters(
            query=q,
            cuisines=cuisines,
            price_levels=price_levels,
            min_score=min_score,
            # `mine` is resolved from the JWT rather than accepting a user id from
            # the client — nobody gets to filter by someone else's identity.
            reviewed_by=current_user.sub if mine else None,
            sort=sort,
        )
        use_case = SearchRestaurants(self.restaurant_repository, self.review_repository)
        return use_case.execute(filters)

    def _validate_cuisines(self, names: list[str]) -> None:
        """Reject unknown cuisine tags — the Postgres repo would otherwise drop them silently."""
        if not names:
            return
        known = {c.name for c in self.cuisine_repository.list_cuisines()}
        unknown = [n for n in names if n not in known]
        if unknown:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"Unknown cuisines: {', '.join(unknown)} — pick from the curated vocabulary (GET /cuisines)",
            )

    def create_restaurant(self, request: CreateRestaurantRequest, response: Response, current_user: TokenPayload = Depends(get_current_user)) -> Restaurant:
        """Create a new restaurant. `created_by` is injected from the JWT sub claim, but doesn't gate future edits.

        Idempotent on external_place_id: a Place that's already on SAM comes back
        as the existing restaurant with 200 instead of the declared 201.
        """
        self._validate_cuisines(request.cuisines)
        restaurant = Restaurant(**request.model_dump(), created_by=current_user.sub)
        use_case = CreateRestaurant(self.restaurant_repository)
        result, created = use_case.execute(restaurant)
        if not created:
            response.status_code = status.HTTP_200_OK
        return result

    def get_restaurant(self, restaurant_id: str, _current_user: TokenPayload = Depends(get_current_user)) -> RestaurantDetail:
        """Get a restaurant with its computed aggregate ratings."""
        use_case = GetRestaurant(self.restaurant_repository, self.review_repository)
        restaurant = use_case.execute(restaurant_id)
        if restaurant is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Restaurant with id {restaurant_id} not found")
        return restaurant

    def update_restaurant(self, restaurant_id: str, request: UpdateRestaurantRequest, _current_user: TokenPayload = Depends(get_current_user)) -> Restaurant:
        """Update a restaurant's shared facts. No ownership check — see ADR 0002."""
        self._validate_cuisines(request.cuisines)
        existing = self.restaurant_repository.get_restaurant(restaurant_id)
        if existing is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Restaurant with id {restaurant_id} not found")

        updated = Restaurant(
            id=restaurant_id,
            name=request.name,
            address=request.address,
            price_level=request.price_level,
            # Pin moves send both coords; requests without them leave the stored pin alone.
            latitude=request.latitude if request.latitude is not None and request.longitude is not None else existing.latitude,
            longitude=request.longitude if request.latitude is not None and request.longitude is not None else existing.longitude,
            external_place_id=existing.external_place_id,  # mapping identity is not user-editable
            cuisines=request.cuisines,
            created_by=existing.created_by,
            created_at=existing.created_at,
        )
        use_case = UpdateRestaurant(self.restaurant_repository)
        return use_case.execute(updated)

    def list_cuisines(self, _current_user: TokenPayload = Depends(get_current_user)) -> list[Cuisine]:
        """List the curated cuisine vocabulary."""
        use_case = ListCuisines(self.cuisine_repository)
        return use_case.execute()

    def list_reviews(self, restaurant_id: str, _current_user: TokenPayload = Depends(get_current_user)) -> list[Review]:
        """List all reviews for a restaurant."""
        use_case = ListReviews(self.review_repository)
        return use_case.execute(restaurant_id)

    def create_review(self, restaurant_id: str, request: CreateReviewRequest, current_user: TokenPayload = Depends(get_current_user)) -> Review:
        """Submit a review. `user_id` is injected from the JWT sub claim."""
        restaurant = self.restaurant_repository.get_restaurant(restaurant_id)
        if restaurant is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Restaurant with id {restaurant_id} not found")

        review = Review(restaurant_id=restaurant_id, user_id=current_user.sub, **request.model_dump())
        use_case = CreateReview(self.review_repository)
        return use_case.execute(review)

    def update_review(self, restaurant_id: str, review_id: str, request: CreateReviewRequest, current_user: TokenPayload = Depends(get_current_user)) -> Review:
        """Edit a review. Only its author may edit it; authorship and created_at are preserved."""
        get_use_case = GetReview(self.review_repository)
        existing_review = get_use_case.execute(review_id)
        if existing_review is None or existing_review.restaurant_id != restaurant_id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Review with id {review_id} not found")
        if existing_review.user_id != current_user.sub:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the review's author can edit it")

        updated = existing_review.model_copy(update=request.model_dump())
        use_case = UpdateReview(self.review_repository)
        return use_case.execute(updated)

    def delete_review(self, restaurant_id: str, review_id: str, current_user: TokenPayload = Depends(get_current_user)) -> None:
        """Delete a review. Only its author may delete it."""
        get_use_case = GetReview(self.review_repository)
        existing_review = get_use_case.execute(review_id)
        if existing_review is None or existing_review.restaurant_id != restaurant_id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Review with id {review_id} not found")
        if existing_review.user_id != current_user.sub:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the review's author can delete it")

        use_case = DeleteReview(self.review_repository)
        try:
            use_case.execute(review_id)
        except KeyError as e:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e)) from e
