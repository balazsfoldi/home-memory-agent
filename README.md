# Home Memory Agent

A lightweight, self-hosted personal memory agent for AI assistants.

Home Memory Agent stores personal context locally and provides relevant
memories to your preferred LLM when needed.

## Goals

- 🧠 Persistent personal memory
- 🏠 Self-hosted
- 🔒 Privacy-first
- 🤖 LLM-agnostic
- 🐳 Docker-first
- 🍓 Raspberry Pi friendly
- 🧪 Built using TDD and BDD

> Your AI model can change. Your memory stays yours.

## Status

🚧 Early development / experimental

The current application version is **v0.5.0**. The project is under active
development and is not yet recommended for production use.

See [GitHub Releases](https://github.com/balazsfoldi/home-memory-agent/releases)
for release notes.

## Quick start

Requirements: Docker Compose v2.24 or newer. Clone the repository, create
your local configuration, and build the app image:

```sh
cp .env.example .env
docker compose up -d --build
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). The memory manager
works without a language model. To enable chat, edit `.env` and choose a
provider before restarting the app.

OpenAI-compatible API:

```dotenv
LLM_PROVIDER=openai-compatible
LLM_BASE_URL=https://api.openai.com/v1
LLM_API_KEY=your-secret-key
LLM_MODEL=gpt-4o-mini
OPENAI_STRUCTURED_OUTPUT=true
```

Ollama, running at the given address from inside the app container:

```dotenv
LLM_PROVIDER=ollama
LLM_BASE_URL=http://host.docker.internal:11434
LLM_MODEL=gemma4
```

Then apply the settings with:

```sh
docker compose up -d --build
```

The application listens on `127.0.0.1` by default. The data is kept in
the `home-memory-data` Docker volume; replacing the container preserves
it. `docker compose down` stops the app and keeps that volume. Back up
the SQLite database before moving or resetting the deployment.

## What is included

- An English web interface by default, with an optional Hungarian translation
  for chat, memory management, and settings. The language choice is saved in
  the browser.
- A REST API with input validation, duplicate detection, and protection
  against edits based on stale data. It also detects high-confidence lexical
  paraphrases within the same category and asks the user to review them.
- Memory priorities (low, normal, high) that influence which relevant memories
  are sent to the assistant first.
- Import and export memories as portable JSON from the memory manager. Imports
  accept a file or pasted text, preserve archive and expiry details, and skip
  existing duplicates.
- A SQLite store with one-time import of existing JSON memories, local
  embedding storage, expiry, and archive/restore controls.
- Local lexical search by default and semantic ranking when an embedding
  provider is configured. The app sends selected active memories and chat
  context to the LLM provider; embedding endpoints also receive search
  queries and saved memory text to build the local index.
- OpenAI-compatible and native Ollama provider adapters. The assistant can
  suggest a memory for a clearly stated lasting preference or habit, and can
  propose natural-language updates or deletion. Every suggested write still
  requires user approval and can be edited before saving.
- No persistent chat transcript or telemetry.
- Scheduled and memory-event automations stored in `automations.sqlite`. Tasks
  can use relevant memories and explicitly enabled read-only tools; results are
  delivered as local in-app notifications and never write memories automatically.
- Docker images for `linux/amd64` and `linux/arm64`.

## Local development

Use Node.js 22.13 or newer and npm:

```sh
npm ci
npm run dev
```

Vite serves the web app on `http://127.0.0.1:5173` and sends `/api`
requests to the API on port 3000. The application stores its SQLite
database under the project `data/` directory unless `DATA_PATH` is set.

Useful checks:

```sh
npm run lint
npm run typecheck
npm test
npm run build
```

The unit, API, UI, and BDD tests use fake LLM responses. They do not call
an LLM service or use an API key. `npm run test:providers:live` is a
separate, explicit smoke test for an LLM already configured in `.env`.
See [docs/development.md](docs/development.md) for the TDD/BDD workflow
and [docs/deployment.md](docs/deployment.md) for backups and recovery.
See [docs/release-process.md](docs/release-process.md) to prepare a release,
protect `main`, and enable automatic Raspberry Pi updates.

## Privacy and network access

Personal memories are stored on the machine or server hosting this app.
When chat is configured, its provider receives the current message, a
short temporary chat history, and selected active memories. When semantic
search is configured, its embedding endpoint receives search queries and
saved memory text to build the local index. The settings page shows the
configured data destinations.
With Ollama, data goes to the Ollama endpoint configured by the operator.

The Compose port binds to localhost. For access from another device, use
a secured SSH tunnel or place the app behind a trusted reverse proxy with
authentication and TLS. The app does not provide user accounts or
internet-facing authentication.
