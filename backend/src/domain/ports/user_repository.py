from abc import ABC, abstractmethod

from src.domain.entities import Person, User


class UserRepository(ABC):
    @abstractmethod
    def ensure_user(self, user_id: str, email: str) -> None: ...

    @abstractmethod
    def get_by_id(self, user_id: str) -> User | None: ...

    @abstractmethod
    def list_people(self) -> list[Person]:
        """Everybody who has chosen a display name, in name order.

        Users without one are left out: NULL means "has not finished signing
        up", and a nameless row in a list of people is unpickable. The order is
        the repository's job rather than the caller's, so both adapters answer
        the same question the same way.
        """
        ...

    @abstractmethod
    def update_display_name(self, user_id: str, new_name: str) -> User: ...
