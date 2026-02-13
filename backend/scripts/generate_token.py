import sys
from datetime import timedelta
from pathlib import Path

from dotenv import load_dotenv

# Add backend/src to path
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from src.infra.security.jwt_handler import JWTHandler

load_dotenv()


def main() -> None:
    jwt_handler = JWTHandler()

    # Create a token that expires in 1 hour
    token = jwt_handler.create_token(
        user_id="test-user-123",
        email="test@example.com",
        expires_delta=timedelta(hours=1),
    )

    print("🔑 Test JWT Token (valid for 1 hour):")
    print(token)
    print("\n📋 Usage:")
    print(f'curl http://localhost:9000/recipes -H "Authorization: Bearer {token}"')


if __name__ == "__main__":
    main()
