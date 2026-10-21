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

The project is currently under active development and is not yet
recommended for production use.

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
the memory file before moving or resetting the deployment.

## What is included

- A Hungarian web interface for chat, browsing memories, editing, and deletion.
- A REST API with input validation, duplicate detection, and protection
  against edits based on stale data. It also detects high-confidence lexical
  paraphrases within the same category and asks the user to review them.
- Memory priorities (low, normal, high) that influence which relevant memories
  are sent to the assistant first.
- A local JSON store, with atomic writes and one app instance per data
  directory.
- Relevant local memory search. The app sends the selected memories and
  current chat context to the configured LLM; it never sends the full
  memory store for search.
- OpenAI-compatible and native Ollama provider adapters. The assistant can
  suggest a memory for a clearly stated lasting preference or habit, and can
  propose natural-language updates or deletion. Every suggested write still
  requires user approval and can be edited before saving.
- No persistent chat transcript or telemetry.
- Docker images for `linux/amd64` and `linux/arm64`.

## Local development

Use Node.js 22 and npm:

```sh
npm ci
npm run dev
```

Vite serves the web app on `http://127.0.0.1:5173` and sends `/api`
requests to the API on port 3000. The application stores its JSON file
under the project `data/` directory unless `DATA_PATH` is set.

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

## Privacy and network access

Personal memories stay on the machine or server hosting this app. When an
external LLM provider is configured, the provider receives the current
message, a short temporary chat history, and only the locally selected
memories. The provider's own data handling then applies to that request.
With Ollama, data goes to the Ollama endpoint configured by the operator.

The Compose port binds to localhost. For access from another device, use
a secured SSH tunnel or place the app behind a trusted reverse proxy with
authentication and TLS. The app does not provide user accounts or
internet-facing authentication.
