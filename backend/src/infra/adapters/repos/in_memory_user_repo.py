from datetime import UTC, datetime

from src.domain.entities import Person, User
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

    def list_people(self) -> list[Person]:
        # Sorted case-insensitively, like the SQL adapter's `lower(display_name)`.
        # A fake that returned insertion order would let a test pass on an
        # ordering production does not produce.
        named = [u for u in self.users.values() if u.display_name]
        named.sort(key=lambda u: (u.display_name or "").lower())
        return [Person(id=u.id, display_name=u.display_name or "") for u in named]

    def update_display_name(self, user_id: str, new_name: str) -> User:
        if any(u.id != user_id and (u.display_name or "").lower() == new_name.lower() for u in self.users.values()):
            raise DisplayNameTakenError(new_name)
        user = self.users[user_id]
        self.users[user_id] = user.model_copy(update={"display_name": new_name, "updated_at": datetime.now(UTC).isoformat()})
        return self.users[user_id]
