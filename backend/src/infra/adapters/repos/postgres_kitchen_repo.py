import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from src.domain.entities import Kitchen, KitchenInvite, KitchenMember
from src.domain.ports import KitchenRepository
from src.infra.db import KitchenMemberModel, KitchenModel


class PostgresKitchenRepository(KitchenRepository):
    def __init__(self, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    # ── mapping ──────────────────────────────────────────────────────────────

    def _to_member(self, model: KitchenMemberModel) -> KitchenMember:
        return KitchenMember(
            user_id=model.user_id,
            display_name=model.member.display_name if model.member else None,
            joined_at=model.accepted_at.isoformat() if model.accepted_at else None,
            invited_by=model.invited_by,
        )

    def _assemble(self, session: Session, kitchen: KitchenModel) -> Kitchen:
        rows = session.scalars(select(KitchenMemberModel).where(KitchenMemberModel.kitchen_id == kitchen.id)).unique().all()

        # Alphabetical, so the member list does not reorder itself between reads —
        # insertion order is invisible and looks like a bug.
        def by_name(members: list[KitchenMember]) -> list[KitchenMember]:
            return sorted(members, key=lambda m: (m.display_name or "").lower())

        return Kitchen(
            id=str(kitchen.id),
            members=by_name([self._to_member(r) for r in rows if r.accepted_at is not None and r.left_at is None]),
            pending=by_name([self._to_member(r) for r in rows if r.accepted_at is None and r.left_at is None]),
            created_at=kitchen.created_at.isoformat(),
        )

    # ── reads ────────────────────────────────────────────────────────────────

    def get_kitchen(self, kitchen_id: str) -> Kitchen | None:
        with self._session_factory() as session:
            model = session.get(KitchenModel, uuid.UUID(kitchen_id))
            return self._assemble(session, model) if model else None

    def active_kitchen_for(self, user_id: str) -> Kitchen | None:
        with self._session_factory() as session:
            membership = session.scalars(
                select(KitchenMemberModel).where(
                    KitchenMemberModel.user_id == user_id,
                    KitchenMemberModel.accepted_at.is_not(None),
                    KitchenMemberModel.left_at.is_(None),
                )
            ).one_or_none()
            if membership is None:
                return None
            kitchen = session.get(KitchenModel, membership.kitchen_id)
            return self._assemble(session, kitchen) if kitchen else None

    def kitchen_ids_for(self, user_id: str) -> list[str]:
        with self._session_factory() as session:
            # Accepted ever, including left — the archive's question. An invitation
            # never answered grants nothing, so pending rows are excluded.
            rows = session.scalars(
                select(KitchenMemberModel.kitchen_id).where(
                    KitchenMemberModel.user_id == user_id,
                    KitchenMemberModel.accepted_at.is_not(None),
                )
            ).all()
            return [str(kitchen_id) for kitchen_id in rows]

    def invitations_for(self, user_id: str) -> list[KitchenInvite]:
        with self._session_factory() as session:
            rows = (
                session.scalars(
                    select(KitchenMemberModel)
                    .where(
                        KitchenMemberModel.user_id == user_id,
                        KitchenMemberModel.accepted_at.is_(None),
                        KitchenMemberModel.left_at.is_(None),
                    )
                    .order_by(KitchenMemberModel.created_at)
                )
                .unique()
                .all()
            )
            invitations = []
            for row in rows:
                kitchen = session.get(KitchenModel, row.kitchen_id)
                if kitchen is None:  # pragma: no cover — the FK cascades
                    continue
                invitations.append(
                    KitchenInvite(
                        kitchen_id=str(row.kitchen_id),
                        invited_by=row.invited_by or "",
                        invited_by_name=row.inviter.display_name if row.inviter else None,
                        members=self._assemble(session, kitchen).members,
                    )
                )
            return invitations

    # ── writes ───────────────────────────────────────────────────────────────

    def create_kitchen(self, user_id: str) -> Kitchen:
        with self._session_factory() as session:
            kitchen = KitchenModel()
            session.add(kitchen)
            session.flush()
            session.add(KitchenMemberModel(kitchen_id=kitchen.id, user_id=user_id, accepted_at=datetime.now(UTC)))
            session.commit()
            session.refresh(kitchen)
            return self._assemble(session, kitchen)

    def invite(self, kitchen_id: str, user_id: str, invited_by: str) -> None:
        with self._session_factory() as session:
            existing = self._membership(session, kitchen_id, user_id)
            if existing is None:
                session.add(KitchenMemberModel(kitchen_id=uuid.UUID(kitchen_id), user_id=user_id, invited_by=invited_by))
            elif existing.accepted_at is not None and existing.left_at is None:
                return  # already here; inviting again is a double tap
            else:
                # A row left behind by leaving, or an invitation already
                # outstanding. Revived rather than duplicated, which is what
                # `uq_kitchen_members_pair` requires and what keeps "was this
                # person ever here?" a single-row question.
                existing.invited_by = invited_by
                existing.accepted_at = None
                existing.left_at = None
            session.commit()

    def accept_invitation(self, kitchen_id: str, user_id: str) -> Kitchen:
        with self._session_factory() as session:
            invitation = self._membership(session, kitchen_id, user_id)
            if invitation is None or invitation.accepted_at is not None or invitation.left_at is not None:
                raise KeyError(f"No invitation to kitchen {kitchen_id}")

            # The move, in one transaction: leaving the old kitchen and joining
            # the new one are the same act, and splitting them would leave a
            # window in which `uq_kitchen_members_active_user` decides the
            # outcome by rejecting the second half.
            for row in session.scalars(
                select(KitchenMemberModel).where(
                    KitchenMemberModel.user_id == user_id,
                    KitchenMemberModel.accepted_at.is_not(None),
                    KitchenMemberModel.left_at.is_(None),
                )
            ).unique():
                row.left_at = datetime.now(UTC)
            session.flush()

            invitation.accepted_at = datetime.now(UTC)
            session.commit()

            kitchen = session.get(KitchenModel, uuid.UUID(kitchen_id))
            if kitchen is None:  # pragma: no cover — read a line ago
                raise KeyError(f"Kitchen {kitchen_id} not found")
            return self._assemble(session, kitchen)

    def discard_invitation(self, kitchen_id: str, user_id: str) -> None:
        with self._session_factory() as session:
            row = self._membership(session, kitchen_id, user_id)
            if row is not None and row.accepted_at is None and row.left_at is None:
                session.delete(row)
                session.commit()

    def leave(self, kitchen_id: str, user_id: str) -> None:
        with self._session_factory() as session:
            row = self._membership(session, kitchen_id, user_id)
            if row is not None and row.accepted_at is not None and row.left_at is None:
                # The row stays, with a date on it. Deleting it would take the
                # weeks this person planned out of their own archive.
                row.left_at = datetime.now(UTC)
                session.commit()

    @staticmethod
    def _membership(session: Session, kitchen_id: str, user_id: str) -> KitchenMemberModel | None:
        return session.scalars(
            select(KitchenMemberModel).where(
                KitchenMemberModel.kitchen_id == uuid.UUID(kitchen_id),
                KitchenMemberModel.user_id == user_id,
            )
        ).one_or_none()
