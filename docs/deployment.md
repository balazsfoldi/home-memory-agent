# Deployment and recovery

## Docker Compose

Use Node.js 22.13 or newer for local development; Docker supplies its
own runtime. From the project root, build the source image:

```sh
cp .env.example .env
docker compose up -d --build
```

The app is available at `http://127.0.0.1:3000`. Compose binds only to
host loopback. The container listens internally on port 3000, runs as
the unprivileged `node` user, drops Linux capabilities, and stores memory and
automation SQLite databases in the named `home-memory-data` volume. `/api/health`
checks readiness without calling a model provider.

For a released image on a Raspberry Pi, pull the published multi-platform
image and recreate the app without building source:

```sh
docker compose pull home-memory-agent
docker compose up -d --no-build home-memory-agent
```

The published image is `ghcr.io/balazsfoldi/home-memory-agent:latest`.
The SQLite databases stay in the `home-memory-data` named volume when the
container is replaced. The [release process](release-process.md) documents an
optional host `systemd` timer that checks for updates every 15 minutes.

To restart after changing `.env`, run `docker compose up -d --build`.
`docker compose down` stops the app while keeping its volume. Deleting
the Compose volume also deletes the active memory store.

## LLM and embedding configuration

Set these values in the server-side `.env` file, then recreate the
service:

| Variable                   | Purpose                                                                                                          |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `MEMORY_STORE`             | `sqlite` by default. `json` selects the compatibility adapter for JSON stores.                                   |
| `DATA_PATH`                | Server data directory; by default relative to the project root.                                                  |
| `LLM_PROVIDER`             | `none`, `openai-compatible`, or `ollama`.                                                                        |
| `LLM_BASE_URL`             | Chat endpoint base URL; credentials must not be embedded in it.                                                  |
| `LLM_API_KEY`              | Optional for Ollama; required for the OpenAI-compatible adapter.                                                 |
| `LLM_MODEL`                | Chat model identifier used by the selected endpoint.                                                             |
| `OPENAI_STRUCTURED_OUTPUT` | Enable JSON response mode for compatible providers that support it.                                              |
| `LLM_TIMEOUT_MS`           | Chat request timeout in milliseconds (1,000–300,000).                                                            |
| `EMBEDDING_PROVIDER`       | `none` (default), `ollama`, or `openai-compatible`.                                                              |
| `EMBEDDING_BASE_URL`       | Embedding endpoint base URL. Blank reuses `LLM_BASE_URL`.                                                        |
| `EMBEDDING_API_KEY`        | Embedding API key. Blank reuses `LLM_API_KEY`; Ollama does not use it.                                           |
| `EMBEDDING_MODEL`          | Embedding model name, for example `nomic-embed-text`.                                                            |
| `EMBEDDING_TIMEOUT_MS`     | Embedding request timeout in milliseconds (1,000–300,000).                                                       |
| `AGENT_TOOLS`              | Comma-separated per-operation allowlist. Blank disables every tool. See the operation names below.              |
| `HOST` / `PORT`            | API bind address and port. Compose sets `HOST=0.0.0.0` inside the container and publishes only to host loopback. |

For local Ollama on Windows with Docker, pull an embedding model first,
then use:

```dotenv
EMBEDDING_PROVIDER=ollama
EMBEDDING_BASE_URL=http://host.docker.internal:11434
EMBEDDING_MODEL=nomic-embed-text
```

Set `EMBEDDING_BASE_URL=http://127.0.0.1:11434` when the app itself runs
directly on the host. Without an embedding provider, chat and memory
search continue to work with local lexical ranking.

The chat model receives the current message, short temporary chat
history, and selected active memories. When semantic search is enabled,
the embedding endpoint receives search queries and saved memory text to
build the local vector index. The settings page displays this notice.
Ollama data stays wherever its configured endpoint runs; an Ollama
instance in another container should be addressed by its Docker network
name rather than `localhost`.

## Agent tools

Tools are read-only and disabled by default. Enable only the operations
you want the assistant to use. After editing `.env`, recreate the Compose
service so Docker loads the new environment:

```dotenv
AGENT_TOOLS=weather.getForecast,calendar.getEvents,notes.search
```

```sh
docker compose up -d --build
```

The supported operations are `weather.getForecast` (sends the requested
place to Open-Meteo), `calendar.getEvents` (reads a local iCalendar file),
and `notes.search` (searches active saved memories). The Settings page
shows the permission state for every operation. A chat request can execute
at most three tools, and the server rejects disabled operations even if
the model asks for them.

To use a local calendar, export it as iCalendar and save it as
`data/calendar.ics` in the configured data directory. The file remains
local. Single events are returned with their timezone; recurring rules are
identified but are not expanded into occurrences. Weather uses the
[Open-Meteo geocoding API](https://open-meteo.com/en/docs/geocoding-api)
and [forecast API](https://open-meteo.com/en/docs); its place-name input is
sent to that service. `notes.search` remains local unless semantic
embeddings are configured, in which case the existing embedding privacy
notice applies.

## JSON migration

The default SQLite store imports a valid `memories.json` once when no
SQLite import has completed. The import is transactional, applies
defaults for newly introduced fields, and leaves the JSON file unchanged
as a recovery snapshot. A malformed JSON file is preserved and prevents
the first import from starting; the app does not replace it with an empty
store. After import, `memories.sqlite` is the active source of truth.
The optional `MEMORY_STORE=json` mode continues to read and write the
legacy JSON file; it does not synchronize with an existing SQLite store.
Automation definitions, runs, and notifications continue to use
`automations.sqlite` in either memory-store mode.

## Back up and restore

Stop the service before copying the database so SQLite can checkpoint
its journal. Keep the backup somewhere private; it contains personal
information.

```sh
mkdir -p data/backups
docker compose stop home-memory-agent
docker compose cp home-memory-agent:/app/data/memories.sqlite ./data/backups/memories.sqlite
docker compose cp home-memory-agent:/app/data/automations.sqlite ./data/backups/automations.sqlite
docker compose start home-memory-agent
```

To restore, stop the service, copy the backup into the data volume, and
start it again:

```sh
docker compose stop home-memory-agent
docker compose cp ./data/backups/memories.sqlite home-memory-agent:/app/data/memories.sqlite
docker compose cp ./data/backups/automations.sqlite home-memory-agent:/app/data/automations.sqlite
docker compose start home-memory-agent
```

Confirm that `/api/health` is ready and inspect the memory count in the
web app. Retain the unmodified `memories.json` migration snapshot until
the SQLite backup has been checked. Backups are outside the app's
deletion behavior, as is information already sent to an external model
endpoint.

## Automations

The Automations page supports recurring intervals from 15 minutes to one week,
plus triggers when a memory is created or updated. The API queues work in
`automations.sqlite`; one occurrence has one idempotency key, and failures are
retried up to three times with backoff. Results and terminal failures create
local in-app notifications. The scheduler runs inside the API process, so the
service must stay running for scheduled work to start. When it restarts, queued
and interrupted runs are recovered from the database.

Tasks can use relevant active memories and the same explicitly enabled,
read-only tools as chat. Their prompts, selected memories, and tool results may
be sent to the configured LLM or external tool service. Review `AGENT_TOOLS`
and the provider settings before enabling an automation. A run never writes or
deletes a memory automatically. Back up both SQLite files to preserve the
memory store and automation history.

## Access from another device

The app binds to host `127.0.0.1` by default and does not implement
accounts. Keep it on loopback, use an SSH tunnel, or put it behind a
trusted reverse proxy configured with authentication and TLS. Changing
the Compose port to `0.0.0.0` on an untrusted network is not a secure
remote-access setup.
