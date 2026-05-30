from src.domain.entities import User
from src.domain.ports.user_repository import UserRepository


class GetCurrentUser:
    def __init__(self, user_repository: UserRepository) -> None:
        self.user_repository = user_repository

    def execute(self, user_id: str) -> User | None:
        return self.user_repository.get_by_id(user_id)
