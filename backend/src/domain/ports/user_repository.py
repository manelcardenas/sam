from abc import ABC, abstractmethod

from src.domain.entities import User


class UserRepository(ABC):
    @abstractmethod
    def ensure_user(self, user_id: str, email: str) -> None: ...

    @abstractmethod
    def get_by_id(self, user_id: str) -> User | None: ...

    @abstractmethod
    def update_display_name(self, user_id: str, new_name: str) -> User: ...
