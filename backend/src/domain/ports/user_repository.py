from abc import ABC, abstractmethod


class UserRepository(ABC):
    @abstractmethod
    def ensure_user(self, user_id: str, email: str) -> None: ...
