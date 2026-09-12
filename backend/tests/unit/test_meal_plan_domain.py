"""The planner's domain rules: the state machine, the merge key, and membership.

All pure functions with no database, which is the point — they are the places a
bug is silent. A wrong state transition locks someone out of their own week with
no way back (v1 transitions are one-way). A wrong merge key produces a shopping
list that looks fine and is wrong, which you discover at the till. And a wrong
membership predicate hands somebody's week to somebody who was only asked.
"""

from datetime import date

import pytest

from src.domain.entities import (
    Kitchen,
    KitchenMember,
    PlanAction,
    PlanStateError,
    PlanStatus,
    is_member,
    merge_key,
    next_status,
    normalise_ingredient_name,
    permits,
    require,
    week_start_for,
)


class TestTheStateMachine:
    def test_planning_permits_everything(self) -> None:
        for action in PlanAction:
            assert permits(PlanStatus.PLANNING, action)

    def test_calendar_closed_still_permits_list_edits_and_ticking(self) -> None:
        """This is the *shopping* state, not a frozen one.

        §2's flow closes the calendar before you leave the house; the fruit and
        yoghurt go on during the walk out, and the ticking happens in the shop.
        Freezing the list here would make the feature useless at the moment it
        is most used.
        """
        assert permits(PlanStatus.CALENDAR_CLOSED, PlanAction.EDIT_LIST)
        assert permits(PlanStatus.CALENDAR_CLOSED, PlanAction.TICK)

    def test_calendar_closed_forbids_changing_the_dishes(self) -> None:
        assert not permits(PlanStatus.CALENDAR_CLOSED, PlanAction.EDIT_CALENDAR)

    def test_list_closed_permits_nothing(self) -> None:
        for action in PlanAction:
            assert not permits(PlanStatus.LIST_CLOSED, action)

    def test_every_status_has_an_entry_in_the_permission_table(self) -> None:
        """A status added later without a row would raise KeyError at runtime,
        on a write, in production — rather than failing here."""
        for status in PlanStatus:
            assert isinstance(permits(status, PlanAction.TICK), bool)

    def test_require_raises_rather_than_returning_false(self) -> None:
        # A bool return is forgettable at the call site; this is not.
        with pytest.raises(PlanStateError):
            require(PlanStatus.LIST_CLOSED, PlanAction.TICK)

    def test_the_transitions_run_one_way_in_order(self) -> None:
        assert next_status(PlanStatus.PLANNING) is PlanStatus.CALENDAR_CLOSED
        assert next_status(PlanStatus.CALENDAR_CLOSED) is PlanStatus.LIST_CLOSED

    def test_the_terminal_state_is_visibly_terminal(self) -> None:
        """Not a silent no-op: v1 cannot reopen, so the caller has to hear about
        it rather than get a success response that changed nothing."""
        with pytest.raises(PlanStateError):
            next_status(PlanStatus.LIST_CLOSED)


class TestNormalisation:
    @pytest.mark.parametrize(
        ("a", "b"),
        [
            ("Cebolla", "cebolla"),
            ("  cebolla  ", "cebolla"),
            ("cebolla   tierna", "cebolla tierna"),
            ("plátano", "platano"),
            ("PLÁTANO", "  platano  "),
        ],
    )
    def test_spellings_of_one_word_merge(self, a: str, b: str) -> None:
        assert normalise_ingredient_name(a) == normalise_ingredient_name(b)

    @pytest.mark.parametrize(("a", "b"), [("cebolla", "cebollas"), ("pimiento", "pimienta"), ("huevo", "huevos")])
    def test_different_words_stay_different(self, a: str, b: str) -> None:
        """No plural stemming, deliberately (§8.3c).

        `cebolla`/`cebollas` merging is pleasant right up until
        `pimiento`/`pimienta` merge too — and a wrong merge means coming home
        without an ingredient. The second pair is why the first is left alone.
        """
        assert normalise_ingredient_name(a) != normalise_ingredient_name(b)


class TestTheMergeKey:
    def test_a_missing_unit_is_the_empty_string_not_none(self) -> None:
        """The whole reason the SQL index uses COALESCE (§8.3b).

        Postgres treats NULLs as distinct in a unique constraint, so a key
        holding None would let two `huevos` rows sit side by side — and most
        household ingredients have no unit, which makes that the *common* case.
        """
        assert merge_key("huevos", None) == ("huevos", "")
        assert merge_key("huevos", None) == merge_key("Huevos", "")

    def test_the_unit_is_part_of_the_key(self) -> None:
        """ "2 cebollas" and "200g cebolla" stay two lines — slightly untidy,
        never wrong. There is no unit conversion, ever (§3)."""
        assert merge_key("aceite", "ml") != merge_key("aceite", "cucharada")

    def test_units_are_compared_case_and_space_insensitively(self) -> None:
        assert merge_key("aceite", " ML ") == merge_key("aceite", "ml")


class TestWeekStart:
    """The week runs Saturday to Friday. Sat 5 Sep 2026 opens the week that Fri
    11 Sep closes; Sat 12 Sep opens the next one."""

    @pytest.mark.parametrize("day", [date(2026, 9, 5), date(2026, 9, 6), date(2026, 9, 9), date(2026, 9, 11)])
    def test_any_day_resolves_to_its_saturday(self, day: date) -> None:
        """Two clients disagreeing about which day identifies a week must not be
        able to create two plans for it (§4.4)."""
        assert week_start_for(day) == date(2026, 9, 5)

    def test_a_saturday_is_its_own_week_start(self) -> None:
        assert week_start_for(date(2026, 9, 5)) == date(2026, 9, 5)

    def test_sunday_opens_the_week_rather_than_closing_it(self) -> None:
        """The change that would be silent if only weekdays were tested.

        Under the old Monday convention Sunday belonged to the week *before* it.
        Now it is the second day of the week that started the day before, so a
        Sunday shop lands on the week you planned on Saturday.
        """
        assert week_start_for(date(2026, 9, 6)) == date(2026, 9, 5)

    def test_friday_closes_the_week_and_saturday_opens_the_next(self) -> None:
        """The boundary. Off by one here and every week is shifted by a day, which
        looks right until you notice the grid starts on Sunday."""
        assert week_start_for(date(2026, 9, 11)) == date(2026, 9, 5)
        assert week_start_for(date(2026, 9, 12)) == date(2026, 9, 12)

    def test_consecutive_weeks_tile_without_a_gap_or_an_overlap(self) -> None:
        """Seven days, not "Saturday to Saturday" inclusive.

        Every day between two week starts has to resolve to exactly one of them,
        or a real dinner belongs to two plans at once.
        """
        first, second = date(2026, 9, 5), date(2026, 9, 12)
        resolved = {date.fromordinal(o) for o in range(first.toordinal(), second.toordinal())}

        assert {week_start_for(day) for day in resolved} == {first}
        assert (second - first).days == 7


class TestMembership:
    """One predicate, and the distinction it has to draw.

    `is_member` is what replaced the owner/guest split, so it is now the only
    thing standing between "we share a planner" and "somebody asked me to". A
    version that counted pending rows would hand over the week at the moment of
    the invitation rather than at the moment of the answer.
    """

    def test_somebody_in_the_kitchen_is_a_member(self) -> None:
        kitchen = Kitchen(members=[KitchenMember(user_id="nel", joined_at="2026-09-11T00:00:00Z")])

        assert is_member(kitchen, "nel")

    def test_somebody_merely_invited_is_not(self) -> None:
        kitchen = Kitchen(members=[KitchenMember(user_id="nel")], pending=[KitchenMember(user_id="martina")])

        assert not is_member(kitchen, "martina")

    def test_a_stranger_is_not(self) -> None:
        assert not is_member(Kitchen(members=[KitchenMember(user_id="nel")]), "someone-else")
