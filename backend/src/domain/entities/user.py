from pydantic import BaseModel, EmailStr


# UUID1 COULD BE USED IF THE ID
class User(BaseModel):
    id: str
    display_name: str
    email: EmailStr
    created_at: str
    updated_at: str
