from app import db


def test_box_stock_round_trip_uses_isolated_database(monkeypatch, tmp_path):
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "flightdeck.db")
    db.init()

    created = db.create_box_stock(
        material="PLA",
        brand="Bambu Lab",
        subtype="Basic",
        color_hex="#112233",
        color_name="Test Blue",
        unit_weight_g=1000,
        quantity=2,
        location="Test shelf",
        qr_value="test-qr",
        notes="isolated test",
    )
    assert created["quantity"] == 2
    assert created["total_weight_g"] == 2000
    assert db.get_box_stock()[0]["qr_value"] == "test-qr"

    updated = db.update_box_stock(created["id"], {"quantity": 3, "location": "Other shelf"})
    assert updated["quantity"] == 3
    assert updated["total_weight_g"] == 3000
    assert updated["location"] == "Other shelf"

    assert db.delete_box_stock(created["id"]) is True
    assert db.get_box_stock() == []
    assert db.delete_box_stock(created["id"]) is False
