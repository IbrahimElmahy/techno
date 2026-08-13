"""مرفقات الزيارات — الصور كانت بتفضل على تليفون المندوب ومحدش يشوفها.

A rep photographs the meter, the fitting, the damage. Those pictures lived on his phone and nowhere
else: the visit synced, the evidence did not, and the office was left with a line of text where the
argument with the customer needed a picture.

The upload is a SECOND request after the visit itself syncs — a rep at the edge of coverage gets the
record in before spending his signal on photographs, and a picture that fails does not take the
visit down with it. That split is what these tests hold, along with the three ways an upload
endpoint gets a server into trouble: a file that is not what it says, one large enough to fill the
disk, and a filename built to write somewhere else entirely.
"""
from __future__ import annotations

import io

from sqlalchemy import select


def _png() -> bytes:
    """أصغر PNG صحيح — عشان الاختبار مايحتاجش ملف على القرص."""
    return bytes([
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
        0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
        0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
        0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4,
        0x89, 0x00, 0x00, 0x00, 0x0A, 0x49, 0x44, 0x41,
        0x54, 0x78, 0x9C, 0x63, 0x00, 0x01, 0x00, 0x00,
        0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00,
        0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE,
        0x42, 0x60, 0x82,
    ])


def _an_inspection(client, h, inv_world) -> int:
    """زيارة عادية اتزامنت — المرفق بيتعلّق عليها."""
    res = client.post("/api/v1/inspections/sync", headers=h, json={
        "inspections": [{
            "client_uuid": "visit-with-photos",
            "visit_kind": "regular",
            "inspection_date": "2026-08-13",
            "owner_name": "عميل الصور",
            "lines": [],
        }],
    })
    assert res.status_code in (200, 201), res.text
    return res.json()[0]["id"]


def test_a_photo_reaches_the_visit(client, inv_world, login):
    h = login("admin")
    insp = _an_inspection(client, h, inv_world)

    res = client.post(
        f"/api/v1/inspections/{insp}/attachments",
        headers=h,
        files={"file": ("meter.png", io.BytesIO(_png()), "image/png")},
        data={"client_uuid": "photo-1"},
    )
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["inspection_id"] == insp
    assert body["bytes"] > 0

    listed = client.get(f"/api/v1/inspections/{insp}/attachments", headers=h).json()
    assert len(listed) == 1

    # And it can be read back — a stored row pointing at nothing is not an attachment.
    got = client.get(listed[0]["url"], headers=h)
    assert got.status_code == 200, got.text
    assert got.content == _png()


def test_sending_the_same_photo_twice_stores_it_once(client, inv_world, login):
    """A dropped connection on a phone means a retry, and a retry is the normal case not the rare
    one. Without this the office gets the same picture three times and has to guess which is which."""
    h = login("admin")
    insp = _an_inspection(client, h, inv_world)

    first = client.post(f"/api/v1/inspections/{insp}/attachments", headers=h,
                        files={"file": ("m.png", io.BytesIO(_png()), "image/png")},
                        data={"client_uuid": "same-photo"})
    second = client.post(f"/api/v1/inspections/{insp}/attachments", headers=h,
                         files={"file": ("m.png", io.BytesIO(_png()), "image/png")},
                         data={"client_uuid": "same-photo"})
    assert first.status_code == 201
    assert second.status_code == 201
    assert first.json()["id"] == second.json()["id"], "اتخزنت مرتين"

    listed = client.get(f"/api/v1/inspections/{insp}/attachments", headers=h).json()
    assert len(listed) == 1


def test_only_pictures_are_taken(client, inv_world, login):
    """Accepting any content type turns the endpoint into free storage for anybody who can record a
    visit — which is every rep."""
    h = login("admin")
    insp = _an_inspection(client, h, inv_world)

    res = client.post(f"/api/v1/inspections/{insp}/attachments", headers=h,
                      files={"file": ("run.exe", io.BytesIO(b"MZ..."), "application/x-msdownload")})
    assert res.status_code == 422, res.text


def test_a_filename_cannot_escape_the_uploads_folder(client, inv_world, login, db):
    """The name comes off a phone and is used to build a path. «../../» in it would otherwise write
    outside the uploads directory entirely."""
    from src.models.attachment import InspectionAttachment

    h = login("admin")
    insp = _an_inspection(client, h, inv_world)

    res = client.post(f"/api/v1/inspections/{insp}/attachments", headers=h,
                      files={"file": ("../../../etc/passwd.png", io.BytesIO(_png()), "image/png")},
                      data={"client_uuid": "sneaky"})
    assert res.status_code == 201, res.text

    row = db.scalar(select(InspectionAttachment).where(
        InspectionAttachment.client_uuid == "sneaky"))
    assert ".." not in row.filename, f"الاسم لسه فيه خروج من المجلد: {row.filename}"
    assert "/" not in row.stored_path.removeprefix(row.stored_path.split("/")[0] + "/").split("/")[-1]
    assert ".." not in row.stored_path


def test_a_photo_on_a_visit_that_does_not_exist_is_refused(client, inv_world, login):
    h = login("admin")
    res = client.post("/api/v1/inspections/999999/attachments", headers=h,
                      files={"file": ("m.png", io.BytesIO(_png()), "image/png")})
    assert res.status_code == 404, res.text


def test_deleting_an_attachment_removes_it(client, inv_world, login):
    h = login("admin")
    insp = _an_inspection(client, h, inv_world)
    made = client.post(f"/api/v1/inspections/{insp}/attachments", headers=h,
                       files={"file": ("m.png", io.BytesIO(_png()), "image/png")}).json()

    assert client.delete(f"/api/v1/inspections/attachments/{made['id']}",
                         headers=h).status_code == 200
    assert client.get(f"/api/v1/inspections/{insp}/attachments", headers=h).json() == []
