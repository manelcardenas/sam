from abc import ABC, abstractmethod

from src.domain.entities import Kitchen, KitchenInvite


class KitchenRepository(ABC):
    """Who shares a planner with whom.

    Four contract facts the signatures cannot carry:

    - **Everyone is in exactly one kitchen, and always in one.** `create_kitchen`
      is called lazily on first use rather than at sign-up, so `active_kitchen_for`
      returning None means "has never opened the planner", not "has no household".
    - **`kitchen_ids_for` includes kitchens the caller has left.** It answers the
      archive's question — which weeks may this person still read — and the whole
      point of §8.12's move rule is that leaving does not take your old weeks with
      you.
    - **`invite` is idempotent**, like every other double-tap in this app. Inviting
      someone who is already invited changes nothing.
    - **`accept_invitation` is a move, not an addition.** It leaves the caller's
      current kitchen in the same breath, because the partial unique index permits
      exactly one active membership per person and a two-call version would have a
      window where the constraint decides the outcome.
    """

    @abstractmethod
    def get_kitchen(self, kitchen_id: str) -> Kitchen | None:
        pass

    @abstractmethod
    def active_kitchen_for(self, user_id: str) -> Kitchen | None:
        pass

    @abstractmethod
    def create_kitchen(self, user_id: str) -> Kitchen:
        pass

    @abstractmethod
    def kitchen_ids_for(self, user_id: str) -> list[str]:
        pass

    @abstractmethod
    def invitations_for(self, user_id: str) -> list[KitchenInvite]:
        pass

    @abstractmethod
    def invite(self, kitchen_id: str, user_id: str, invited_by: str) -> None:
        pass

    @abstractmethod
    def accept_invitation(self, kitchen_id: str, user_id: str) -> Kitchen:
        pass

    @abstractmethod
    def discard_invitation(self, kitchen_id: str, user_id: str) -> None:
        pass

    @abstractmethod
    def leave(self, kitchen_id: str, user_id: str) -> None:
        pass
