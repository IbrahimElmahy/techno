"""Mobile clients get a long-lived token (client="mobile"); web keeps the short TTL."""
from __future__ import annotations

from src.core.config import settings


def test_web_login_keeps_short_ttl(client, world):
    r = client.post("/api/v1/auth/login", json={"username": "rep_a", "password": "pw"})
    assert r.status_code == 200
    assert r.json()["expires_in"] == settings.access_token_ttl


def test_mobile_login_gets_long_ttl_and_token_works(client, world):
    r = client.post("/api/v1/auth/login",
                    json={"username": "rep_a", "password": "pw", "client": "mobile"})
    assert r.status_code == 200
    assert r.json()["expires_in"] == settings.mobile_token_ttl
    assert settings.mobile_token_ttl >= 30 * 24 * 3600
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    assert client.get("/api/v1/auth/me", headers=h).status_code == 200
