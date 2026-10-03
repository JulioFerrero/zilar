# Releasing and deploying to a live install

How a release goes from `main` to a running Coolify install. Written from the releases v0.1.4 to v0.1.11. Replace the placeholders with your own values (`<service-uuid>` is the Coolify service, `<server-ip>` the server, `<domain>` the public host); never put real addresses or secrets in this file.

## 1. Before tagging

1. `main` is pushed and CI is green. Look at the last runs: `gh run list --workflow CI --branch main --limit 6`. A red run needs a reason before a release (we had a flaky runner test and a test with a fixed date that expired).
2. Know what the release contains: `git log vPREV..HEAD --oneline`.
3. Migrations: `git diff vPREV..HEAD --stat -- apps/server/drizzle`. A release with a migration changes the live database on restart. Say so in the tag message and take a backup first (`./deploy/zilar backup` on the host, or the scheduled one).

## 2. Tag

```bash
git tag -a vX.Y.Z -m "vX.Y.Z: short list of what changed"
git push origin vX.Y.Z
```

A tag `v*` starts the GitHub Actions workflow "Production images": four images (postgres, ejabberd, server, web); `latest` follows the release. Watch it with `gh run list --limit 3`. It normally takes 3 to 10 minutes. If one job hangs (it once ran 53 minutes), `gh run cancel <id>` and `gh run rerun <id>`.

## 3. Restart the live service

Note the server container's hostname first (it appears as `hostname` in every server log line). Then restart with `pull_latest` so Coolify pulls the new images:

- Coolify MCP: `control` with resource `service`, action `restart`, `pull_latest: true`, uuid `<service-uuid>`; logs via `logs` with container `server`.

## 4. Verify the swap really happened

The old container keeps answering while the new one starts, so a 200 from `/health` proves nothing.

- Wait for the `hostname` in the server logs to change. That is the proof of a new container.
- Probe from outside, without DNS: `curl --resolve <domain>:443:<server-ip> https://<domain>/health` should be 200.
- Probe a route that only exists in the new version: an unauthenticated call that answers 401 (route exists) instead of 404 (old image). Examples: `/api/handles/check`, `/api/directory`.
- A migration shows in the server's startup log.

## 5. Coolify facts that cost time

- Coolify stores the compose variables as environment variables, and `env_file: .env` injects ALL stored variables into every container. Removing a variable from the compose file does not remove it from the containers: delete the stored variable too (we hit this with the old ejabberd admin password variable).
- Magic variables are `SERVICE_PASSWORD_<ID>`, `SERVICE_FQDN_WEB`, `SERVICE_URL_WEB`, with no underscore inside the id.
- Named volumes hold state: Postgres, ejabberd database and uploads, stickers, avatars. The scheduled backup covers the database; the file volumes (stickers, avatars, uploads) do not have a scheduled backup yet.
- Do not rotate or print secrets while debugging; read logs through a masking filter.

## 6. If it goes wrong

Set `IMAGE_TAG` to the previous tag and restart again. A migration is not undone by that: restore the backup if the migration was destructive.
