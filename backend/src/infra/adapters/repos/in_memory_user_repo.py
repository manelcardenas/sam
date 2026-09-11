from datetime import UTC, datetime

from src.domain.entities import User
from src.domain.errors import DisplayNameTakenError
from src.domain.ports import UserRepository


class InMemoryUserRepository(UserRepository):
    def __init__(self) -> None:
        self.users: dict[str, User] = {}

    def add(self, user_id: str, email: str, display_name: str | None = None) -> User:
        """Test-only helper: create a user outright. Not on the port, because
        production creates users from a JWT and never from arbitrary input."""
        now = datetime.now(UTC).isoformat()
        user = User(id=user_id, display_name=display_name, email=email, created_at=now, updated_at=now)
        self.users[user_id] = user
        return user

    def ensure_user(self, user_id: str, email: str) -> None:
        if user_id not in self.users:
            self.add(user_id, email)

    def get_by_id(self, user_id: str) -> User | None:
        return self.users.get(user_id)

    def get_by_display_name(self, display_name: str) -> User | None:
        # Case- and whitespace-insensitive, mirroring the SQL adapter's
        # `lower(display_name) = lower(:name)`. A fake that matched exactly
        # would let a test pass on input production rejects.
        wanted = display_name.strip().lower()
        return next((u for u in self.users.values() if (u.display_name or "").lower() == wanted), None)

    def update_display_name(self, user_id: str, new_name: str) -> User:
        if any(u.id != user_id and (u.display_name or "").lower() == new_name.lower() for u in self.users.values()):
            raise DisplayNameTakenError(new_name)
        user = self.users[user_id]
        self.users[user_id] = user.model_copy(update={"display_name": new_name, "updated_at": datetime.now(UTC).isoformat()})
        return self.users[user_id]
