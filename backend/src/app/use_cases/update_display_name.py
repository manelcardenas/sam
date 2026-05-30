from src.domain.entities import User
from src.domain.ports.user_repository import UserRepository


class UpdateDisplayName:
    def __init__(self, user_repository: UserRepository) -> None:
        self.user_repository = user_repository

    def execute(self, user_id: str, new_name: str) -> User:
        return self.user_repository.update_display_name(user_id, new_name)
