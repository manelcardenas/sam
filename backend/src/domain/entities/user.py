from pydantic import BaseModel, EmailStr


# UUID1 COULD BE USED IF THE ID
class User(BaseModel):
    id: str
    display_name: str | None  # NULL until the user chooses one
    email: EmailStr
    created_at: str
    updated_at: str


class Person(BaseModel):
    """A user as everybody else sees them: a name and an id, nothing more.

    Deliberately not `User`. The one place the app hands out somebody *else's*
    account is the kitchen's invite picker, and an email address has no business
    travelling with it. `display_name` is non-optional here because a person who
    has not chosen one yet cannot be shown in a list of names — the directory
    leaves them out rather than rendering a blank row.
    """

    id: str
    display_name: str
