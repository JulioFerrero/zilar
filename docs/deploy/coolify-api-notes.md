# Coolify API: what the installer uses (2026-10-15)

These notes come from Coolify's published OpenAPI (`coollabsio/coolify`, branch `v4.x`, `openapi.json`), read by the lead on 2026-10-15. Our instance runs **Coolify 4.4.6** (`GET /api/v1/version`). Every path below sits under `/api/v1`.

## Auth
- **Header:** `Authorization: Bearer <token>`.
- **Where to make the token:** in Coolify under "Keys & Tokens" → "API tokens".
- **Don't put the token in a command line:** pass the header from a root-only file (`curl -H @file`), so it never shows in `ps`.

## Endpoints

| Call | What for | Body fields used |
|---|---|---|
| `GET /version` | Coolify's version (plain text) | — |
| `GET /servers` | the servers; one entry named `localhost` with ip `host.docker.internal` when Coolify runs on this host | — |
| `GET /servers/{server_uuid}/destinations` | only when the server has several destinations | — |
| `GET /projects`, `POST /projects` | find or create the "Zilar" project | `name`, `description` |
| `POST /services` | create `zilar-core` from a raw compose file | `name`, `project_uuid`, `server_uuid`, `environment_name`, `docker_compose_raw`, `urls`, `instant_deploy`, `destination_uuid` |
| `PATCH /services/{uuid}` | change compose, URLs or the shared network | `connect_to_docker_network`, `urls`, `docker_compose_raw` |
| `PATCH /services/{uuid}/envs/bulk` | set the core's variables | `data: [{ key, value, is_literal }]` |
| `POST /applications/dockerimage` | create `zilar-server` and `zilar-web` from published images | required: `project_uuid`, `server_uuid`, `environment_name`, `docker_registry_image_name`; also `docker_registry_image_tag`, `domains`, `ports_exposes`, `is_stripprefix_enabled`, `connect_to_docker_network`, `health_check_enabled`, `health_check_path`, `health_check_port`, `instant_deploy` |
| `PATCH /applications/{uuid}/envs/bulk` | set an app's variables | as for services |
| `POST /applications/{uuid}/storages` | mount a named volume in an app | `type: "persistent"`, `name`, `mount_path` |
| `POST /deploy` | deploy a resource | query `uuid` (or `tag`), `force` |
| `GET /deployments/{uuid}` | follow one deploy | — |

- **Service URLs:** `urls` is `[{ name: "<compose service>", url: "https://a/x,https://a/y" }]`, comma-separated. One component can therefore carry both `/xmpp-ws` and `/upload` (`deploy/coolify/LAYOUT.md`, rehearsal point 1).
- **Not in the API:** a service's own status (`GET /services/{uuid}` returns config). Check health from outside instead: `https://<domain>/health` and the XMPP WebSocket.

## Not verified yet
Everything here is read from the spec, not called. The rehearsal (`docs/deploy/one-line-install-plan.md` step 7) runs it against our 4.4.6 in a scratch project.
