import uuid


def parse_uuid(value: str) -> uuid.UUID | None:
    """Parse a path-parameter id, returning None for malformed input.

    Ids arrive as raw strings from the URL; without this, uuid.UUID() raises
    ValueError on typos/stale links and the request 500s instead of 404ing.
    """
    try:
        return uuid.UUID(value)
    except ValueError:
        return None
