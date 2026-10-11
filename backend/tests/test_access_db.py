"""Tests for access_db.py — Access control CRUD + CSV processing."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from conftest import create_test_user
import access_db


# ── is_user_allowed ──────────────────────────────────────────────────────────

class TestIsUserAllowed:

    def test_returns_false_when_not_in_list(self, db):
        assert access_db.is_user_allowed(db, "nobody@test.com") is False

    def test_returns_true_after_adding(self, db):
        access_db.add_allowed_user(db, "allowed@test.com", "User", "SDR", "admin")
        assert access_db.is_user_allowed(db, "allowed@test.com") is True

    def test_case_insensitive_and_strips_whitespace(self, db):
        access_db.add_allowed_user(db, "user@test.com", "User", "SDR", "admin")
        assert access_db.is_user_allowed(db, "  USER@TEST.COM  ") is True


# ── add_allowed_user ─────────────────────────────────────────────────────────

class TestAddAllowedUser:

    def test_add_new_user(self, db):
        result = access_db.add_allowed_user(db, "new@test.com", "New", "SDR", "admin")
        assert result is True

    def test_add_duplicate_returns_false(self, db):
        access_db.add_allowed_user(db, "dup@test.com", "Dup", "SDR", "admin")
        result = access_db.add_allowed_user(db, "dup@test.com", "Dup", "SDR", "admin")
        assert result is False

    def test_add_clears_a_matching_pending_access_request(self, db):
        """Granting access is the resolution for a pending AccessRequest (see
        models.AccessRequest's docstring) — no separate dismiss action."""
        import models
        db.add(models.AccessRequest(email="newhire@test.com", name="New Hire"))
        db.commit()

        access_db.add_allowed_user(db, "newhire@test.com", "New Hire", "SDR", "admin")

        assert db.query(models.AccessRequest).filter(models.AccessRequest.email == "newhire@test.com").first() is None

    def test_add_with_no_pending_request_is_a_no_op(self, db):
        import models
        access_db.add_allowed_user(db, "nopending@test.com", "Nobody Asked", "SDR", "admin")
        assert db.query(models.AccessRequest).count() == 0


# ── remove_allowed_user ──────────────────────────────────────────────────────

class TestRemoveAllowedUser:

    def test_remove_existing_user(self, db):
        access_db.add_allowed_user(db, "rm@test.com", "Remove", "SDR", "admin")
        result = access_db.remove_allowed_user(db, "rm@test.com")
        assert result is True
        assert access_db.is_user_allowed(db, "rm@test.com") is False

    def test_remove_nonexistent_returns_false(self, db):
        result = access_db.remove_allowed_user(db, "ghost@test.com")
        assert result is False


# ── get_allowed_user ─────────────────────────────────────────────────────────

class TestGetAllowedUser:

    def test_returns_record(self, db):
        access_db.add_allowed_user(db, "get@test.com", "Get", "Pod Admin", "admin")
        record = access_db.get_allowed_user(db, "get@test.com")
        assert record is not None
        assert record.role == "Pod Admin"

    def test_returns_none_when_not_found(self, db):
        assert access_db.get_allowed_user(db, "nope@test.com") is None


# ── list_allowed_users ───────────────────────────────────────────────────────

class TestListAllowedUsers:

    def test_returns_all_entries(self, db):
        access_db.add_allowed_user(db, "a@test.com")
        access_db.add_allowed_user(db, "b@test.com")
        result = access_db.list_allowed_users(db)
        assert len(result) == 2


# ── process_csv ──────────────────────────────────────────────────────────────

class TestProcessCsv:

    def test_add_action(self, db):
        csv = "email,name,action\ncsv@test.com,CSV User,add"
        result = access_db.process_csv(db, csv, "admin@test.com")
        assert "csv@test.com" in result["added"]
        assert access_db.is_user_allowed(db, "csv@test.com")

    def test_remove_action(self, db):
        access_db.add_allowed_user(db, "toremove@test.com")
        csv = "email,name,action\ntoremove@test.com,,remove"
        result = access_db.process_csv(db, csv, "admin@test.com")
        assert "toremove@test.com" in result["removed"]

    def test_invalid_action_skipped(self, db):
        csv = "email,name,action\nbad@test.com,Bad,dance"
        result = access_db.process_csv(db, csv, "admin@test.com")
        assert len(result["skipped"]) == 1

    def test_empty_email_skipped(self, db):
        csv = "email,name,action\n,,add"
        result = access_db.process_csv(db, csv, "admin@test.com")
        assert len(result["skipped"]) == 1

    def test_admin_role_blocked(self, db):
        csv = "email,name,action,role\nadmin-try@test.com,Admin,add,admin"
        result = access_db.process_csv(db, csv, "admin@test.com")
        assert len(result["skipped"]) == 1
        assert "admin" in result["skipped"][0].lower() or "Admin" in result["skipped"][0]

    def test_duplicate_add_skipped(self, db):
        access_db.add_allowed_user(db, "exists@test.com")
        csv = "email,name,action\nexists@test.com,Existing,add"
        result = access_db.process_csv(db, csv, "admin@test.com")
        assert "exists@test.com" in result["skipped"][0]
