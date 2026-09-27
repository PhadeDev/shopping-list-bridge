# Shopping List Bridge

A tiny LAN-only shopping list hosted on the NAS, with a separate Violentmonkey/Tampermonkey userscript that shows active items on Tesco grocery pages.

## Features

- Phone-first list UI with quantity, completion, undo, and deletion
- Case-insensitive duplicate items increase the existing quantity
- SQLite storage persisted outside the Docker container
- Tesco overlay refreshes every 15 seconds, survives Tesco navigation, minimises, and can be dragged
- Tesco overlay uses Shadow DOM so site styles do not leak into it

## Local development

```powershell
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements-dev.txt
.venv\Scripts\python -m pytest
.venv\Scripts\python app.py
```

The app listens on port 5060. Set `SHOPPING_LIST_DATA_DIR` to override the database directory.

## NAS deployment

The live deployment belongs at `/volume1/docker/shopping-list-bridge` on the Synology NAS. Transfer the full source tree, then run:

```sh
cd /volume1/docker/shopping-list-bridge
/var/packages/ContainerManager/target/usr/bin/docker compose build
/var/packages/ContainerManager/target/usr/bin/docker compose up -d
```

The Compose file binds only to the NAS LAN address at `192.168.0.200:5060`. It is not intended for internet exposure.

## Userscript

Install `userscript/tesco-shopping-list.user.js` in Violentmonkey or Tampermonkey. Its API endpoint is deliberately set to the NAS LAN address. The published script uses the GitHub raw URL for automatic updates.
