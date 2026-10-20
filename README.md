# The List

Mobile-first checklist for media to read, watch, and listen to: books, comics, movies, shows, albums.

- Add items with the field at the top.
- Tap the circle to check an item off; completed items move to a collapsible **Completed** section (tap the circle again to restore).
- Drag the ≡ handle to reorder (arrow keys also work when the handle is focused).
- Tap an item's text to rename it. While editing, the handle becomes a delete button; clearing the text also deletes.
- Lists sync across devices and browsers. A passcode is required on each new device.
- Changes apply instantly and are cached locally, so the app works offline; queued changes sync on reconnect.

## Architecture

- **Frontend:** static HTML/CSS/JS, no build step.
- **Backend:** `api/lists.js`, a Vercel Function.
  - `GET /api/lists` returns `{ data, etag }`.
  - `PUT /api/lists` takes `If-Match: <etag>` (or `none` for the first write) and body `{ data }`. On a version mismatch it returns `409` with the current document.
- **Storage:** a private Vercel Blob store (`the-list-data`) holding a single `lists.json`. Writes use ETag conditional puts (optimistic concurrency).
- **Sync model:** every change is a small id-based op (`add`, `toggle`, `edit`, `delete`, `move`). Ops are applied locally, persisted, and pushed. On `409` the client rebases pending ops onto the newer server copy and retries. The client pulls on focus, on reconnect, and every 30s.

## Environment variables (Vercel)

| Key | Purpose |
| --- | --- |
| `BLOB_READ_WRITE_TOKEN` | Set automatically when the Blob store is connected. |
| `APP_PASSCODE` | Passcode clients must send as `Authorization: Bearer <passcode>`. Change it in Vercel → Settings → Environment Variables, then redeploy. |
