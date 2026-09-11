from datetime import date

# The week runs Saturday → Friday: you plan on Saturday and shop on Sunday, so
# the planning day has to be the *first* day of the week you are planning, not
# the last day of the one ending. `date.weekday()` counts Monday as 0, so
# Saturday is 5.
#
# Seven days rather than "Saturday to Saturday" inclusive: consecutive weeks have
# to tile without overlapping, or one real dinner belongs to two plans at once
# and `uq_plan_entries_slot` cannot stop it being assigned twice.
WEEK_STARTS_ON = 5  # Saturday
DAYS_IN_WEEK = 7


def week_start_for(day: date) -> date:
    """The Saturday on or before `day`.

    Entries are keyed to real dates (§4.4) — the grid is how a week renders, not
    what it is. Normalising the plan's own key is what stops the same week
    existing twice because two clients disagreed about which day to send.
    """
    return day.fromordinal(day.toordinal() - (day.weekday() - WEEK_STARTS_ON) % DAYS_IN_WEEK)
