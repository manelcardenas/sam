from fastapi import APIRouter, Depends, HTTPException, status

from src.app.use_cases import AnswerInvitation, GetKitchen, InviteToKitchen, ListInvitablePeople, RemoveFromKitchen
from src.domain.entities import Kitchen, KitchenView, Person
from src.domain.ports import KitchenRepository, UserRepository
from src.infra.controllers.schemas import AnswerInvitationRequest, InviteRequest
from src.infra.security import TokenPayload, get_current_user


class KitchenController:
    """Five routes for the household that shares a planner (§8.12).

    Four of them replace three sharing routes that had a direction — share,
    unshare, and "weeks shared with me". The count barely moved; what changed is
    that none of these has an owner on one side of it. The fifth is the invite
    picker's list, which exists so that asking somebody in is a choice rather
    than a spelling test.
    """

    def __init__(self, kitchen_repository: KitchenRepository, user_repository: UserRepository, router: APIRouter) -> None:
        self.kitchen_repository = kitchen_repository
        # Inviting reads the person being invited, and the picker reads all of
        # them — the only reason this controller needs the user repository.
        self.user_repository = user_repository
        self.router = router
        self._register_routes()

    def _register_routes(self) -> None:
        common = {"dependencies": [Depends(get_current_user)], "tags": ["Kitchen"]}

        self.router.add_api_route(
            "/kitchen",
            self.get_kitchen,
            methods=["GET"],
            response_model=KitchenView,
            summary="Who you share a planner with",
            description="The caller's kitchen, created on first use, plus any invitations addressed to them. Everybody has exactly one kitchen — living alone is a household too.",
            **common,
        )
        self.router.add_api_route(
            "/kitchen/members",
            self.invite,
            methods=["POST"],
            response_model=Kitchen,
            status_code=status.HTTP_201_CREATED,
            summary="Invite someone into your kitchen",
            description="By the name you know them by. An invitation rather than an addition: joining means leaving their own kitchen, which is not something to do to somebody by typing their name.",
            **common,
        )
        self.router.add_api_route(
            "/kitchen/people",
            self.list_people,
            methods=["GET"],
            response_model=list[Person],
            summary="Who you could invite",
            description="Everybody with a display name who is not already in the caller's kitchen and has not already been asked. Names and ids only — no email leaves this app.",
            **common,
        )
        self.router.add_api_route(
            "/kitchen/members/{user_id}",
            self.remove,
            methods=["DELETE"],
            response_model=Kitchen,
            summary="Leave, or withdraw an invitation you sent",
            description="The only two permitted targets. Nobody can remove anybody else — with no owner and no admin, an eject button would have to invent one.",
            **common,
        )
        self.router.add_api_route(
            "/kitchen/invitations/{kitchen_id}",
            self.answer,
            methods=["PATCH"],
            response_model=KitchenView,
            summary="Accept or decline an invitation",
            description="Accepting is a move: you leave the kitchen you are in and join this one, in one step. The weeks you planned before stay in your archive.",
            **common,
        )

    @staticmethod
    def _raise(error: Exception) -> None:
        if isinstance(error, PermissionError):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(error)) from error
        if isinstance(error, LookupError) and not isinstance(error, KeyError):
            # 404 on the *person*, distinct from a 404 on the kitchen. Reachable
            # only by a stale picker or a hand-made request now that invitations
            # carry an id, but "that person is no longer in SAM" still says more
            # than "not found".
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error)) from error
        if isinstance(error, KeyError):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error).strip("'")) from error
        if isinstance(error, ValueError):
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(error)) from error
        raise error

    def get_kitchen(self, current_user: TokenPayload = Depends(get_current_user)) -> KitchenView:
        return GetKitchen(self.kitchen_repository).execute(current_user.sub)

    def list_people(self, current_user: TokenPayload = Depends(get_current_user)) -> list[Person]:
        return ListInvitablePeople(self.kitchen_repository, self.user_repository).execute(current_user.sub)

    def invite(self, request: InviteRequest, current_user: TokenPayload = Depends(get_current_user)) -> Kitchen:
        try:
            return InviteToKitchen(self.kitchen_repository, self.user_repository).execute(current_user.sub, request.user_id)
        except (PermissionError, LookupError, ValueError) as e:
            self._raise(e)
            raise  # pragma: no cover — _raise always raises

    def remove(self, user_id: str, current_user: TokenPayload = Depends(get_current_user)) -> Kitchen:
        try:
            return RemoveFromKitchen(self.kitchen_repository).execute(current_user.sub, user_id)
        except (PermissionError, LookupError, ValueError) as e:
            self._raise(e)
            raise  # pragma: no cover — _raise always raises

    def answer(self, kitchen_id: str, request: AnswerInvitationRequest, current_user: TokenPayload = Depends(get_current_user)) -> KitchenView:
        try:
            return AnswerInvitation(self.kitchen_repository).execute(current_user.sub, kitchen_id, request.accept)
        except (PermissionError, LookupError, ValueError) as e:
            self._raise(e)
            raise  # pragma: no cover — _raise always raises
