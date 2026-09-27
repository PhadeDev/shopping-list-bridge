from app import create_app


def make_client(tmp_path):
    app = create_app({"TESTING": True, "DATABASE": str(tmp_path / "test.sqlite3")})
    return app.test_client()


def test_healthcheck(tmp_path):
    response = make_client(tmp_path).get("/healthz")
    assert response.status_code == 200
    assert response.get_json() == {"status": "ok"}


def test_add_and_list_item(tmp_path):
    client = make_client(tmp_path)
    response = client.post("/api/items", json={"name": "Tin foil", "quantity": 1})
    assert response.status_code == 201
    assert response.get_json()["item"]["name"] == "Tin foil"

    items = client.get("/api/items?status=active").get_json()["items"]
    assert [(item["name"], item["quantity"]) for item in items] == [("Tin foil", 1)]


def test_duplicate_active_item_increases_quantity(tmp_path):
    client = make_client(tmp_path)
    client.post("/api/items", json={"name": "Milk", "quantity": 1})
    response = client.post("/api/items", json={"name": "milk", "quantity": 2})
    assert response.status_code == 200
    assert response.get_json()["merged"] is True
    assert response.get_json()["item"]["quantity"] == 3


def test_complete_and_restore_item(tmp_path):
    client = make_client(tmp_path)
    item_id = client.post("/api/items", json={"name": "Bread"}).get_json()["item"]["id"]
    completed = client.patch(f"/api/items/{item_id}", json={"completed": True}).get_json()["item"]
    assert completed["completed"] is True
    assert completed["completed_at"] is not None
    assert client.get("/api/items?status=active").get_json()["items"] == []

    restored = client.patch(f"/api/items/{item_id}", json={"completed": False}).get_json()["item"]
    assert restored["completed"] is False
    assert restored["completed_at"] is None


def test_update_quantity_and_delete(tmp_path):
    client = make_client(tmp_path)
    item_id = client.post("/api/items", json={"name": "Coffee"}).get_json()["item"]["id"]
    response = client.patch(f"/api/items/{item_id}", json={"quantity": 4})
    assert response.get_json()["item"]["quantity"] == 4
    assert client.delete(f"/api/items/{item_id}").status_code == 204
    assert client.get("/api/items?status=all").get_json()["items"] == []


def test_rejects_invalid_input(tmp_path):
    client = make_client(tmp_path)
    assert client.post("/api/items", json={"name": "", "quantity": 1}).status_code == 400
    assert client.post("/api/items", json={"name": "Milk", "quantity": 0}).status_code == 400
