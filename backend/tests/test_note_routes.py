"""Tests for routes/note_routes.py — Notes CRUD."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from conftest import create_test_lead, create_test_note


class TestAddNote:

    def test_add_note_to_lead(self, client, db):
        lead = create_test_lead(db, email="note@t.com")
        resp = client.post(f"/api/leads/{lead.id}/notes", json={
            "content": "This is a test note",
            "author": "Tester"
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["content"] == "This is a test note"
        assert data["author"] == "Tester"

    def test_add_note_lead_not_found(self, client):
        resp = client.post("/api/leads/nonexistent/notes", json={"content": "Oops"})
        assert resp.status_code == 404

    def test_add_note_default_author(self, client, db):
        lead = create_test_lead(db, email="defauth@t.com")
        resp = client.post(f"/api/leads/{lead.id}/notes", json={"content": "No author"})
        assert resp.status_code == 200
        assert resp.json()["author"] == "You"


class TestGetNotes:

    def test_get_notes_for_lead(self, client, db):
        lead = create_test_lead(db, email="getnote@t.com")
        create_test_note(db, lead.id, "Note 1")
        create_test_note(db, lead.id, "Note 2")

        resp = client.get(f"/api/leads/{lead.id}/notes")
        assert resp.status_code == 200
        assert len(resp.json()) == 2

    def test_get_notes_empty(self, client, db):
        lead = create_test_lead(db, email="emptynote@t.com")
        resp = client.get(f"/api/leads/{lead.id}/notes")
        assert resp.status_code == 200
        assert len(resp.json()) == 0


class TestDeleteNote:

    def test_delete_note(self, client, db):
        lead = create_test_lead(db, email="delnote@t.com")
        note = create_test_note(db, lead.id, "Delete me")

        resp = client.delete(f"/api/leads/{lead.id}/notes/{note.id}")
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

    def test_delete_nonexistent_note_404(self, client, db):
        lead = create_test_lead(db, email="delno2@t.com")
        resp = client.delete(f"/api/leads/{lead.id}/notes/fake-note-id")
        assert resp.status_code == 404
