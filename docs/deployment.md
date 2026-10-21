# Deployment and recovery

## Docker Compose

Use Node.js 22 only for local development; Docker supplies its runtime.
From the project root:

```sh
cp .env.example .env
docker compose up -d --build
```

The app is available at `http://127.0.0.1:3000`. Compose binds only to
host loopback. The container listens internally on port 3000, runs as
the unprivileged `node` user, drops Linux capabilities, and stores
`memories.json` in the named `home-memory-data` volume. `/api/health`
checks readiness without calling the provider.

To restart after changing `.env`, run `docker compose up -d --build`.
`docker compose down` stops the app while keeping its volume. Deleting
the Compose volume also deletes the active memory store.

## LLM configuration

Set these values in the server-side `.env` file, then recreate the
service:

| Variable | Purpose |
| --- | --- |
| `LLM_PROVIDER` | `none`, `openai-compatible`, or `ollama`. |
| `LLM_BASE_URL` | Configured HTTP or HTTPS endpoint; credentials must not be embedded in the URL. |
| `LLM_API_KEY` | Optional for Ollama; required for the OpenAI-compatible adapter. |
| `LLM_MODEL` | Model identifier used by the selected endpoint. |
| `OPENAI_STRUCTURED_OUTPUT` | Enable JSON response mode for compatible providers that support it. |
| `LLM_TIMEOUT_MS` | Request timeout in milliseconds (1,000–300,000). |
| `DATA_PATH` | Server data directory; by default relative to the project root. |
| `HOST` / `PORT` | API bind address and port. Compose sets `HOST=0.0.0.0` inside the container and publishes only to host loopback. |

The app sends the selected memories, a short temporary chat history, and
the current message to the configured provider. It does not send the
entire memory file for search. With `LLM_PROVIDER=none`, the API and
memory UI still work. An Ollama instance in another container should be
addressed by its Docker network name; `localhost` inside Home Memory
Agent refers to that container itself.

## Back up the memory file

Create a local, Git-ignored backup directory and copy the live file from
the container:

```sh
mkdir -p data/backups
docker compose cp home-memory-agent:/app/data/memories.json ./data/backups/memories.json
```

Keep the backup somewhere private. It contains personal information.
Backups are outside the app's deletion behavior: deleting an active
memory does not erase earlier backups or information already sent to an
external provider.

To restore a backup, stop the service first, copy the desired file back
to the volume, and start the service again:

```sh
docker compose stop home-memory-agent
docker compose cp ./data/backups/memories.json home-memory-agent:/app/data/memories.json
docker compose start home-memory-agent
```

Confirm that `/api/health` is ready and inspect the memory count in the
web app. The app validates a restored JSON file during startup; invalid
files are preserved for recovery and do not get silently overwritten.

## Access from another device

The app binds to host `127.0.0.1` by default and does not implement
accounts. Keep it on loopback, use an SSH tunnel, or put it behind a
trusted reverse proxy configured with authentication and TLS. Changing
the Compose port to `0.0.0.0` on an untrusted network is not a secure
remote-access setup.
