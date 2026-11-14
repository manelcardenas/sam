"""Token validation with real RSA signatures, against a fake Cognito JWKS.

The cache tests next door never verify a signature; these do. Each rejection
test changes one thing about an otherwise valid ID token.
"""

import hashlib
import hmac
import json
import time
from typing import Any

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from jwt.algorithms import RSAAlgorithm
from jwt.utils import base64url_encode

from src.infra.security.jwt_handler import JWTHandler

POOL_ID = "eu-west-3_aBcDeFgHi"
CLIENT_ID = "client-123"
ISSUER = f"https://cognito-idp.eu-west-3.amazonaws.com/{POOL_ID}"
KID = "key-1"

_private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
_public_jwk: dict[str, Any] = {**RSAAlgorithm.to_jwk(_private_key.public_key(), as_dict=True), "kid": KID, "alg": "RS256", "use": "sig"}


def _claims(**overrides: object) -> dict[str, Any]:
    now = int(time.time())
    claims = {
        "sub": "user-1",
        "email": "user@example.com",
        "aud": CLIENT_ID,
        "iss": ISSUER,
        "token_use": "id",
        "iat": now,
        "exp": now + 3600,
    }
    claims.update(overrides)
    return {k: v for k, v in claims.items() if v is not None}


def _sign(claims: dict[str, Any], kid: str = KID) -> str:
    return jwt.encode(claims, _private_key, algorithm="RS256", headers={"kid": kid})


@pytest.fixture
def handler(monkeypatch: pytest.MonkeyPatch) -> JWTHandler:
    monkeypatch.setenv("COGNITO_USER_POOL_ID", POOL_ID)
    monkeypatch.setenv("COGNITO_CLIENT_ID", CLIENT_ID)
    h = JWTHandler()
    h._fetch_keys = lambda: {KID: _public_jwk}  # type: ignore[method-assign]
    return h


def test_a_valid_id_token_is_accepted(handler: JWTHandler) -> None:
    payload = handler.decode_token(_sign(_claims(**{"cognito:groups": ["admins"]})))

    assert payload.sub == "user-1"
    assert payload.email == "user@example.com"
    assert payload.is_admin


def test_an_expired_token_raises_the_expired_error(handler: JWTHandler) -> None:
    """Its own type, so the API answers "Token has expired" rather than a generic 401."""
    with pytest.raises(jwt.ExpiredSignatureError):
        handler.decode_token(_sign(_claims(exp=int(time.time()) - 60)))


@pytest.mark.parametrize(
    "claims",
    [
        pytest.param(_claims(aud="someone-elses-client"), id="another app client"),
        pytest.param(_claims(aud=None, token_use="access"), id="access token, no aud: python-jose let these through"),
        pytest.param(_claims(iss="https://cognito-idp.eu-west-3.amazonaws.com/eu-west-3_Other"), id="another user pool"),
        pytest.param(_claims(exp=None), id="no expiry"),
    ],
)
def test_claims_that_are_not_ours_are_rejected(handler: JWTHandler, claims: dict[str, Any]) -> None:
    with pytest.raises(jwt.InvalidTokenError):
        handler.decode_token(_sign(claims))


def test_a_token_signed_by_another_key_is_rejected(handler: JWTHandler) -> None:
    impostor = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    token = jwt.encode(_claims(), impostor, algorithm="RS256", headers={"kid": KID})

    with pytest.raises(jwt.InvalidTokenError):
        handler.decode_token(token)


def test_algorithm_confusion_is_rejected(handler: JWTHandler) -> None:
    """GHSA-3qf3-8w2g-rqmx, the reason python-jose went: an attacker signs with
    HS256 using the *public* key (which anyone can download) as the HMAC secret.
    A verifier that lets the token choose its algorithm accepts it."""
    # Built by hand: PyJWT itself refuses to HMAC-sign with something that looks
    # like a public key, which is the same protection seen from the other side.
    public_pem = _private_key.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)
    header = base64url_encode(json.dumps({"alg": "HS256", "typ": "JWT", "kid": KID}).encode())
    body = base64url_encode(json.dumps(_claims()).encode())
    signing_input = header + b"." + body
    signature = base64url_encode(hmac.new(public_pem, signing_input, hashlib.sha256).digest())
    forged = (signing_input + b"." + signature).decode()

    with pytest.raises(jwt.InvalidTokenError):
        handler.decode_token(forged)


def test_an_unsigned_token_is_rejected(handler: JWTHandler) -> None:
    token = jwt.encode(_claims(), key=None, algorithm="none", headers={"kid": KID})

    with pytest.raises(jwt.InvalidTokenError):
        handler.decode_token(token)


@pytest.mark.parametrize("token", ["", "not-a-jwt", "a.b.c"])
def test_garbage_is_an_invalid_token_not_a_crash(handler: JWTHandler, token: str) -> None:
    with pytest.raises(jwt.InvalidTokenError):
        handler.decode_token(token)


def test_a_header_without_kid_is_rejected(handler: JWTHandler) -> None:
    token = jwt.encode(_claims(), _private_key, algorithm="RS256")

    with pytest.raises(jwt.InvalidTokenError, match="no kid"):
        handler.decode_token(token)
