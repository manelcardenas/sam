from fastapi import APIRouter, Depends, HTTPException, status

from src.app.use_cases import GetCurrentUser, UpdateDisplayName
from src.domain.entities import User
from src.domain.errors import DisplayNameTakenError
from src.domain.ports import UserRepository
from src.infra.controllers.schemas import UpdateMeRequest
from src.infra.security import TokenPayload, get_current_user


class UserController:
    def __init__(self, user_repository: UserRepository, router: APIRouter) -> None:
        self.user_repository = user_repository
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
