"""Session length: web tokens are long-lived and renewable; mobile gets its own long TTL."""
from __future__ import annotations

from src.core.config import settings


def test_web_login_gets_a_long_lived_token(client, world):
    """Office staff used to be logged out mid-work by a 30-minute token."""
    r = client.post("/api/v1/auth/login", json={"username": "rep_a", "password": "pw"})
    assert r.status_code == 200
    assert r.json()["expires_in"] == settings.access_token_ttl
    assert settings.access_token_ttl >= 7 * 24 * 3600


def test_refresh_slides_the_session_forward(client, world):
    r = client.post("/api/v1/auth/login", json={"username": "rep_a", "password": "pw"})
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}

    fresh = client.post("/api/v1/auth/refresh", headers=h)
    assert fresh.status_code == 200, fresh.text
    assert fresh.json()["expires_in"] == settings.access_token_ttl
    # The re-issued token is itself usable — that is what keeps an active user signed in.
    h2 = {"Authorization": f"Bearer {fresh.json()['access_token']}"}
    assert client.get("/api/v1/auth/me", headers=h2).status_code == 200


def test_refresh_requires_a_valid_token(client, world):
    assert client.post("/api/v1/auth/refresh").status_code == 401
    assert client.post("/api/v1/auth/refresh",
                       headers={"Authorization": "Bearer nonsense"}).status_code == 401


def test_mobile_login_gets_long_ttl_and_token_works(client, world):
    r = client.post("/api/v1/auth/login",
                    json={"username": "rep_a", "password": "pw", "client": "mobile"})
    assert r.status_code == 200
    assert r.json()["expires_in"] == settings.mobile_token_ttl
    assert settings.mobile_token_ttl >= 30 * 24 * 3600
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    assert client.get("/api/v1/auth/me", headers=h).status_code == 200
