from pydantic import BaseModel, EmailStr

# UUID1 COULD BE USED IF THE ID


class User(BaseModel):
    id: str
    username: str
    email: EmailStr
