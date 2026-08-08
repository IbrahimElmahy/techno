"""«شغّال» لوحدها مش إجابة — الصحة لازم تقول من أنهي نسخة.

`{"status": "ok"}` answers whether the process is up, which was never the question anybody had. A
whole day went into «is this deployed?» while the API answered ok from a build four commits old:
the site was healthy and stale at the same time, and nothing served from outside could tell the two
apart. The only way to find it was to fetch the entire OpenAPI schema and diff the route list by
hand against a local copy.

So health reports the build. Both fields exist to answer that one question, and each covers a case
the other cannot.
"""
from __future__ import annotations


def test_health_says_which_commit_is_running(client, monkeypatch):
    """The platform's own environment is the source, not a string committed to the repo.

    A hand-maintained version constant is wrong exactly when it matters: somebody forgets to bump
    it, and the endpoint then reports a build that never shipped — worse than reporting nothing,
    because it is believed.
    """
    monkeypatch.setenv("VERCEL_GIT_COMMIT_SHA", "abcdef1234567890")
    body = client.get("/health").json()
    assert body["status"] == "ok"
    assert body["commit"] == "abcdef1", "الأول من الهاش يكفي، والباقي ضوضاء"


def test_it_says_unknown_rather_than_guessing(client, monkeypatch):
    """Off a platform that sets nothing, «unknown» is the honest answer. Inventing one — the time
    of boot, a constant — would make a stale build look identified."""
    for var in ("VERCEL_GIT_COMMIT_SHA", "RENDER_GIT_COMMIT", "GIT_COMMIT"):
        monkeypatch.delenv(var, raising=False)
    assert client.get("/health").json()["commit"] == "unknown"


def test_it_counts_the_routes(client):
    """The cheap second opinion.

    A commit hash is only useful once somebody knows which commit they expected. The route count is
    comparable against a local checkout with no context at all: a number that has not moved after a
    deploy says the backend did not rebuild. That is the exact fact that took a day to establish,
    and it is one number.
    """
    body = client.get("/health").json()
    assert isinstance(body["routes"], int)
    # A real app, not an empty router — a count of zero would "work" and mean nothing.
    assert body["routes"] > 100


def test_health_needs_no_login(client):
    """It is what a deploy check calls, and a deploy check has no credentials."""
    assert client.get("/health").status_code == 200
