import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime

from src.domain.entities import Kitchen, KitchenInvite, KitchenMember
from src.domain.ports import KitchenRepository


def _now() -> str:
    return datetime.now(UTC).isoformat()


@dataclass
class _Membership:
    """One row of `kitchen_members`, with the same three states the table has.

    A dataclass rather than the `KitchenMember` entity because the entity is what
    *leaves* the repository and carries a resolved display name; this is the
    stored fact, and `left_at` never crosses the boundary.
    """

    kitchen_id: str
    user_id: str
    invited_by: str | None = None
    accepted_at: str | None = None
    left_at: str | None = None
    created_at: str = field(default_factory=_now)

    @property
    def is_active(self) -> bool:
        return self.accepted_at is not None and self.left_at is None

    @property
    def is_pending(self) -> bool:
        return self.accepted_at is None and self.left_at is None


class InMemoryKitchenRepository(KitchenRepository):
    def __init__(self, names: dict[str, str] | None = None) -> None:
        self.kitchens: dict[str, str] = {}  # id -> created_at
        self.memberships: list[_Membership] = []
        # The SQL adapter reads names off a joined `users` row. This fake has no
        # users table, so tests hand it the mapping — without it every member
        # would render nameless and a test asserting on names would pass against
        # a repository that never resolves one.
        self._names: dict[str, str] = names or {}

    # ── helpers ──────────────────────────────────────────────────────────────

    def _member(self, row: _Membership) -> KitchenMember:
        return KitchenMember(
            user_id=row.user_id,
            display_name=self._names.get(row.user_id),
            joined_at=row.accepted_at,
            invited_by=row.invited_by,
        )

    def _find(self, kitchen_id: str, user_id: str) -> _Membership | None:
        return next((m for m in self.memberships if m.kitchen_id == kitchen_id and m.user_id == user_id), None)

    def _assemble(self, kitchen_id: str) -> Kitchen:
        rows = [m for m in self.memberships if m.kitchen_id == kitchen_id]
        # Alphabetical, so the member list does not reorder itself between reads —
        # insertion order is invisible and looks like a bug.
        by_name = sorted((self._member(m) for m in rows if m.is_active), key=lambda m: (m.display_name or "").lower())
        pending = sorted((self._member(m) for m in rows if m.is_pending), key=lambda m: (m.display_name or "").lower())
        return Kitchen(id=kitchen_id, members=by_name, pending=pending, created_at=self.kitchens[kitchen_id])

    # ── reads ────────────────────────────────────────────────────────────────

    def get_kitchen(self, kitchen_id: str) -> Kitchen | None:
        return self._assemble(kitchen_id) if kitchen_id in self.kitchens else None

    def active_kitchen_for(self, user_id: str) -> Kitchen | None:
        row = next((m for m in self.memberships if m.user_id == user_id and m.is_active), None)
        return self._assemble(row.kitchen_id) if row else None

    def kitchen_ids_for(self, user_id: str) -> list[str]:
        # Accepted ever, including left — the archive's question. An invitation
        # never answered grants nothing, so pending rows are excluded.
        return [m.kitchen_id for m in self.memberships if m.user_id == user_id and m.accepted_at is not None]

    def invitations_for(self, user_id: str) -> list[KitchenInvite]:
        return [
            KitchenInvite(
                kitchen_id=row.kitchen_id,
                invited_by=row.invited_by or "",
                invited_by_name=self._names.get(row.invited_by or ""),
                members=self._assemble(row.kitchen_id).members,
            )
            for row in self.memberships
            if row.user_id == user_id and row.is_pending
        ]

    # ── writes ───────────────────────────────────────────────────────────────

    def create_kitchen(self, user_id: str) -> Kitchen:
        kitchen_id = str(uuid.uuid4())
        self.kitchens[kitchen_id] = _now()
        self.memberships.append(_Membership(kitchen_id=kitchen_id, user_id=user_id, accepted_at=_now()))
        return self._assemble(kitchen_id)

    def invite(self, kitchen_id: str, user_id: str, invited_by: str) -> None:
        existing = self._find(kitchen_id, user_id)
        if existing is None:
            self.memberships.append(_Membership(kitchen_id=kitchen_id, user_id=user_id, invited_by=invited_by))
            return
        if existing.is_active:
            return  # already here; inviting again is a double tap
        # A row left behind by leaving, or an invitation already outstanding.
        # Re-inviting revives it rather than stacking a second row, which is what
        # keeps "was this person ever here?" a single-row question.
        existing.invited_by = invited_by
        existing.accepted_at = None
        existing.left_at = None

    def accept_invitation(self, kitchen_id: str, user_id: str) -> Kitchen:
        invitation = self._find(kitchen_id, user_id)
        if invitation is None or not invitation.is_pending:
            raise KeyError(f"No invitation to kitchen {kitchen_id}")
        # The move, in one step: leaving the old kitchen and joining the new one
        # are the same act, and doing them in two would leave a window where the
        # one-active-kitchen rule decides the outcome.
        for row in self.memberships:
            if row.user_id == user_id and row.is_active:
                row.left_at = _now()
        invitation.accepted_at = _now()
        return self._assemble(kitchen_id)

    def discard_invitation(self, kitchen_id: str, user_id: str) -> None:
        row = self._find(kitchen_id, user_id)
        if row is not None and row.is_pending:
            self.memberships.remove(row)

    def leave(self, kitchen_id: str, user_id: str) -> None:
        row = self._find(kitchen_id, user_id)
        if row is not None and row.is_active:
            # The row stays, with a date on it. Deleting it would take the weeks
            # this person planned out of their own archive.
            row.left_at = _now()
