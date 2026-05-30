class DisplayNameTakenError(Exception):
    """Raised when a chosen display_name collides with the UNIQUE constraint."""
