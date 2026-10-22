# Deployment and recovery

## Docker Compose

Use Node.js 22.13 or newer for local development; Docker supplies its
own runtime. From the project root:

```sh
cp .env.example .env
docker compose up -d --build
```

The app is available at `http://127.0.0.1:3000`. Compose binds only to
host loopback. The container listens internally on port 3000, runs as
the unprivileged `node` user, drops Linux capabilities, and stores the
SQLite database in the named `home-memory-data` volume. `/api/health`
checks readiness without calling a model provider.

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

## JSON migration

The default SQLite store imports a valid `memories.json` once when no
SQLite import has completed. The import is transactional, applies
defaults for newly introduced fields, and leaves the JSON file unchanged
as a recovery snapshot. A malformed JSON file is preserved and prevents
the first import from starting; the app does not replace it with an empty
store. After import, `memories.sqlite` is the active source of truth.
The optional `MEMORY_STORE=json` mode continues to read and write the
legacy JSON file; it does not synchronize with an existing SQLite store.

## Back up and restore

Stop the service before copying the database so SQLite can checkpoint
its journal. Keep the backup somewhere private; it contains personal
information.

```sh
mkdir -p data/backups
docker compose stop home-memory-agent
docker compose cp home-memory-agent:/app/data/memories.sqlite ./data/backups/memories.sqlite
docker compose start home-memory-agent
```

To restore, stop the service, copy the backup into the data volume, and
start it again:

```sh
docker compose stop home-memory-agent
docker compose cp ./data/backups/memories.sqlite home-memory-agent:/app/data/memories.sqlite
docker compose start home-memory-agent
```

Confirm that `/api/health` is ready and inspect the memory count in the
web app. Retain the unmodified `memories.json` migration snapshot until
the SQLite backup has been checked. Backups are outside the app's
deletion behavior, as is information already sent to an external model
endpoint.

## Access from another device

The app binds to host `127.0.0.1` by default and does not implement
accounts. Keep it on loopback, use an SSH tunnel, or put it behind a
trusted reverse proxy configured with authentication and TLS. Changing
the Compose port to `0.0.0.0` on an untrusted network is not a secure
remote-access setup.
