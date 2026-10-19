import os
import re
from pathlib import Path

TEST_DB = Path(__file__).resolve().parent / "test.db"
os.environ["DATABASE_URL"] = f"sqlite:///{TEST_DB}"
os.environ["COOKIE_SECURE"] = "false"

from fastapi.testclient import TestClient
from app.main import app
from app.db import Base, engine


def csrf_from(html: str) -> str:
    match = re.search(r'name="csrf_token" value="([^"]+)"', html)
    assert match
    return match.group(1)


def test_health():
    with TestClient(app) as client:
        response = client.get("/health")
        assert response.status_code == 200
        assert response.json()["ok"] is True


def test_owner_setup_login_and_dashboard():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    with TestClient(app) as client:
        root = client.get("/", follow_redirects=False)
        assert root.status_code == 303
        assert root.headers["location"] == "/login"

        login = client.get("/login", follow_redirects=False)
        assert login.status_code == 303
        assert login.headers["location"] == "/setup"

        setup = client.get("/setup")
        token = csrf_from(setup.text)
        created = client.post("/setup", data={
            "display_name": "Owner",
            "email": "owner@example.test",
            "password": "LongSecurePassword123",
            "password_confirm": "LongSecurePassword123",
            "setup_code": "",
            "csrf_token": token,
        }, follow_redirects=False)
        assert created.status_code == 303
        assert created.headers["location"] == "/"

        dashboard = client.get("/")
        assert dashboard.status_code == 200
        assert "AVONENT OS" in dashboard.text
        assert "Owner" in dashboard.text

        setup_again = client.get("/setup", follow_redirects=False)
        assert setup_again.status_code == 303
        assert setup_again.headers["location"] == "/login"
