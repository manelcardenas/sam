from fastapi import APIRouter, Depends, HTTPException, status

from src.app.use_cases import GetCurrentUser, GetUserStats, ListUserReviews, UpdateDisplayName
from src.domain.entities import User, UserReview, UserStats
from src.domain.errors import DisplayNameTakenError
from src.domain.ports import ReviewRepository, UserRepository
from src.infra.controllers.schemas import UpdateMeRequest
from src.infra.security import TokenPayload, get_current_user


class UserController:
    def __init__(self, user_repository: UserRepository, review_repository: ReviewRepository, router: APIRouter) -> None:
        self.user_repository = user_repository
        self.review_repository = review_repository
        self.router = router
        self._register_routes()

    def _register_routes(self) -> None:
        self.router.add_api_route(
            "/users/me",
            self.get_me,
            methods=["GET"],
            response_model=User,
            dependencies=[Depends(get_current_user)],
            summary="Get the current user",
            description="Returns the authenticated user's profile",
            tags=["Users"],
        )
        self.router.add_api_route(
            "/users/me",
            self.update_me,
            methods=["PATCH"],
            response_model=User,
            dependencies=[Depends(get_current_user)],
            summary="Update the current user's display name",
            description="Sets a user-chosen display name (must be unique)",
            tags=["Users"],
        )
        self.router.add_api_route(
            "/users/me/reviews",
            self.list_my_reviews,
            methods=["GET"],
            response_model=list[UserReview],
            dependencies=[Depends(get_current_user)],
            summary="List the current user's reviews",
            description="Every review the caller has written, newest visit first, each carrying its restaurant's name",
            tags=["Users"],
        )
        self.router.add_api_route(
            "/users/me/stats",
            self.get_my_stats,
            methods=["GET"],
            response_model=UserStats,
            dependencies=[Depends(get_current_user)],
            summary="Get the current user's stats",
            description="Headline figures for the profile: reviews written, places reviewed, average score given, most-reviewed cuisine",
            tags=["Users"],
        )

    def get_me(self, current_user: TokenPayload = Depends(get_current_user)) -> User:
        """Return the current user's profile. The auth dependency JIT-provisions
        the row, so it should always exist; 404 is a safety net."""
        use_case = GetCurrentUser(self.user_repository)
        user = use_case.execute(current_user.sub)
        if user is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
        return user

    def update_me(self, request: UpdateMeRequest, current_user: TokenPayload = Depends(get_current_user)) -> User:
        """Set the current user's display name."""
        use_case = UpdateDisplayName(self.user_repository)
        try:
            return use_case.execute(current_user.sub, request.display_name)
        except DisplayNameTakenError as e:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Display name already taken") from e

    def list_my_reviews(self, current_user: TokenPayload = Depends(get_current_user)) -> list[UserReview]:
        """Return the caller's own reviews. Scoped to the JWT sub — there is no
        route for reading someone else's."""
        use_case = ListUserReviews(self.review_repository)
        return use_case.execute(current_user.sub)

    def get_my_stats(self, current_user: TokenPayload = Depends(get_current_user)) -> UserStats:
        """Return the caller's headline figures. Zeroed, not 404, when they have
        written nothing yet — the profile strip still renders."""
        use_case = GetUserStats(self.review_repository)
        return use_case.execute(current_user.sub)
