import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from flask import Flask, g, jsonify, render_template, request


def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def create_app(test_config=None):
    app = Flask(__name__)
    data_dir = Path(os.environ.get("SHOPPING_LIST_DATA_DIR", Path(__file__).parent / "data"))
    app.config.from_mapping(DATABASE=str(data_dir / "shopping-list.sqlite3"))
    if test_config:
        app.config.update(test_config)

    Path(app.config["DATABASE"]).parent.mkdir(parents=True, exist_ok=True)

    def get_db():
        if "db" not in g:
            g.db = sqlite3.connect(app.config["DATABASE"], timeout=10)
            g.db.row_factory = sqlite3.Row
            g.db.execute("PRAGMA foreign_keys = ON")
            g.db.execute("PRAGMA journal_mode = WAL")
        return g.db

    @app.teardown_appcontext
    def close_db(_error=None):
        db = g.pop("db", None)
        if db is not None:
            db.close()

    def init_db():
        db = get_db()
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 1),
                completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                completed_at TEXT
            )
            """
        )
        db.execute(
            "CREATE INDEX IF NOT EXISTS idx_items_completed_updated "
            "ON items (completed, updated_at DESC)"
        )
        db.commit()

    def serialize(row):
        return {
            "id": row["id"],
            "name": row["name"],
            "quantity": row["quantity"],
            "completed": bool(row["completed"]),
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
            "completed_at": row["completed_at"],
        }

    def clean_name(value):
        if not isinstance(value, str):
            return None
        cleaned = " ".join(value.split()).strip()
        return cleaned if 1 <= len(cleaned) <= 120 else None

    def clean_quantity(value):
        try:
            quantity = int(value)
        except (TypeError, ValueError):
            return None
        return quantity if 1 <= quantity <= 999 else None

    with app.app_context():
        init_db()

    @app.after_request
    def add_api_headers(response):
        if request.path.startswith("/api/"):
            response.headers["Access-Control-Allow-Origin"] = "*"
            response.headers["Access-Control-Allow-Headers"] = "Content-Type"
            response.headers["Access-Control-Allow-Methods"] = "GET, POST, PATCH, DELETE, OPTIONS"
            response.headers["Cache-Control"] = "no-store"
        return response

    @app.get("/")
    def index():
        return render_template("index.html")

    @app.get("/healthz")
    def healthz():
        get_db().execute("SELECT 1").fetchone()
        return jsonify({"status": "ok"})

    @app.get("/api/items")
    def list_items():
        status = request.args.get("status", "all")
        if status not in {"all", "active", "completed"}:
            return jsonify({"error": "status must be all, active, or completed"}), 400

        db = get_db()
        if status == "active":
            rows = db.execute(
                "SELECT * FROM items WHERE completed = 0 ORDER BY created_at ASC, id ASC"
            ).fetchall()
        elif status == "completed":
            rows = db.execute(
                "SELECT * FROM items WHERE completed = 1 ORDER BY completed_at DESC, id DESC LIMIT 100"
            ).fetchall()
        else:
            rows = db.execute(
                "SELECT * FROM items ORDER BY completed ASC, "
                "CASE WHEN completed = 0 THEN created_at END ASC, updated_at DESC"
            ).fetchall()
        return jsonify({"items": [serialize(row) for row in rows]})

    @app.post("/api/items")
    def add_item():
        payload = request.get_json(silent=True) or {}
        name = clean_name(payload.get("name"))
        quantity = clean_quantity(payload.get("quantity", 1))
        if not name:
            return jsonify({"error": "Enter an item name between 1 and 120 characters"}), 400
        if quantity is None:
            return jsonify({"error": "Quantity must be a whole number between 1 and 999"}), 400

        db = get_db()
        existing = db.execute(
            "SELECT * FROM items WHERE completed = 0 AND lower(name) = lower(?) LIMIT 1",
            (name,),
        ).fetchone()
        now = utc_now()
        if existing:
            db.execute(
                "UPDATE items SET quantity = quantity + ?, updated_at = ? WHERE id = ?",
                (quantity, now, existing["id"]),
            )
            db.commit()
            row = db.execute("SELECT * FROM items WHERE id = ?", (existing["id"],)).fetchone()
            return jsonify({"item": serialize(row), "merged": True}), 200

        cursor = db.execute(
            "INSERT INTO items (name, quantity, completed, created_at, updated_at) "
            "VALUES (?, ?, 0, ?, ?)",
            (name, quantity, now, now),
        )
        db.commit()
        row = db.execute("SELECT * FROM items WHERE id = ?", (cursor.lastrowid,)).fetchone()
        return jsonify({"item": serialize(row), "merged": False}), 201

    @app.patch("/api/items/<int:item_id>")
    def update_item(item_id):
        payload = request.get_json(silent=True)
        if not isinstance(payload, dict) or not payload:
            return jsonify({"error": "Supply at least one field to update"}), 400

        db = get_db()
        existing = db.execute("SELECT * FROM items WHERE id = ?", (item_id,)).fetchone()
        if not existing:
            return jsonify({"error": "Item not found"}), 404

        allowed = {"name", "quantity", "completed"}
        if set(payload) - allowed:
            return jsonify({"error": "Only name, quantity, and completed can be updated"}), 400

        updates = []
        values = []
        if "name" in payload:
            name = clean_name(payload["name"])
            if not name:
                return jsonify({"error": "Enter an item name between 1 and 120 characters"}), 400
            updates.append("name = ?")
            values.append(name)
        if "quantity" in payload:
            quantity = clean_quantity(payload["quantity"])
            if quantity is None:
                return jsonify({"error": "Quantity must be a whole number between 1 and 999"}), 400
            updates.append("quantity = ?")
            values.append(quantity)
        if "completed" in payload:
            if not isinstance(payload["completed"], bool):
                return jsonify({"error": "completed must be true or false"}), 400
            updates.extend(["completed = ?", "completed_at = ?"])
            values.extend([int(payload["completed"]), utc_now() if payload["completed"] else None])

        updates.append("updated_at = ?")
        values.append(utc_now())
        values.append(item_id)
        db.execute(f"UPDATE items SET {', '.join(updates)} WHERE id = ?", values)
        db.commit()
        row = db.execute("SELECT * FROM items WHERE id = ?", (item_id,)).fetchone()
        return jsonify({"item": serialize(row)})

    @app.delete("/api/items/<int:item_id>")
    def delete_item(item_id):
        db = get_db()
        cursor = db.execute("DELETE FROM items WHERE id = ?", (item_id,))
        db.commit()
        if cursor.rowcount == 0:
            return jsonify({"error": "Item not found"}), 404
        return "", 204

    return app


app = create_app()


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "5060")), debug=False)
