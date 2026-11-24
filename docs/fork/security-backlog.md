# Security backlog (self-hosted fork)

Pending hardening for the local `docker-compose.yml` stack. Items stay here until done; do not file them upstream.

**Status: recorded, deferred.** The owner decided (2026-11-24) to keep these as a record and not act on them yet. Do not apply any fix below without an explicit go-ahead.

## SEC-1: services published on every network interface

**Found:** 2026-11-24, while building the agent graph page.

**Risk:** high on a shared or untrusted network (office, café, VPN with other peers), low on a machine that is only on a trusted home network.

`docker-compose.yml` publishes these ports as `"<port>:<port>"`. Docker binds that to `0.0.0.0` and `[::]` and adds its own firewall rules, so the macOS firewall does not cover them.

| Port | Service | What someone on the network gets |
|---|---|---|
| 8000 | app-server HTTP | `POST /api/v1/projects/<projectId>/sql/query` answers with **no authentication**. Verified with a plain `curl` from the host, which read every span of a project. It reads any project whose id is known or guessed, including the traces' prompts, tool inputs and outputs. Other `/api/v1/projects/*` internal routes are probably open too; not audited. |
| 8001 | app-server gRPC | OTLP ingest. Needs a project API key. |
| 8002 | app-server realtime SSE | Not audited. |
| 5433 | Postgres | A password login. The password is in `.env`. |
| 7280, 7281 | Quickwit REST/UI and gRPC | Quickwit has **no authentication**: full-text search over indexed spans. |
| 5667 | frontend | Login required. |

The frontend reaches app-server through `BACKEND_URL` on the compose network, so app-server never needed to be reachable from outside.

**Fix (planned):**
1. In `docker-compose.override.yml`, rebind to loopback: `127.0.0.1:8000-8002`, `127.0.0.1:5433`, `127.0.0.1:7280-7281`, and `127.0.0.1:5667` unless the UI must be reachable from other devices. The Claude Code plugin and the `claude-code-live` daemon post to `localhost:8000`, so they keep working.
2. Check from another device on the LAN that the ports are closed: `nc -vz <mac-ip> 8000`.
3. Audit which app-server `/api/v1` routes are internal (meant for the frontend only) and unauthenticated. Decide whether to gate them with `SHARED_SECRET_TOKEN` in the fork, or rely on the loopback binding.

## SEC-2: weak frontend session secret

The compose frontend uses `NEXTAUTH_SECRET: some_secret`, hardcoded in `docker-compose.yml`. Better Auth warns that it is short and low-entropy, so anyone who knows it can forge session cookies. `frontend/.env.local` reuses it so that one login works on both frontends.

**Fix (planned):**
1. Generate `openssl rand -base64 32` into `.env` as `BETTER_AUTH_SECRET`.
2. Reference it from the compose frontend and from `.env.local`.
3. Every user has to sign in again after the change.

## SEC-3: rotate the `claude-live` project API key

The key was pasted into a Claude Code chat on 2026-11-24. That chat transcript is local, and so is the `dev` project the plugin exports it to.

**Fix:**
1. Create a new key in the `claude-live` project.
2. Run `bash tools/claude-code-live/save-key.sh` and then copy the key.
3. Delete the old key.

## SEC-4: passwordless local login reachable from the LAN

**Found:** 2026-11-24, while opening the dev frontend to other devices on the network.

The local stack signs in through Better Auth's `local-email` endpoint (`lib/auth-local-email.ts`): it asks for an email only, no password. With `frontend/.env.local` setting `ALLOWED_DEV_ORIGINS=<lan-ip>` and `BETTER_AUTH_TRUSTED_ORIGINS=http://<lan-ip>:3000`, anyone on the same network can sign in as any user, the owner included, and read every trace.

**Risk:** acceptable on a trusted home network; high anywhere else.

**Fix (planned):**
1. To close it now: remove both lines from `frontend/.env.local` and restart `pnpm run dev`.
2. For LAN use that stays open: put a real IdP (GitHub/Google OAuth) in front, or a reverse proxy with basic auth, and turn local-email off.
