# Architecture

Home Memory Agent v0.2.5 is a single-user modular monolith. One Node.js
process serves the static React application, REST API, and JSON memory
store. The language model is an outbound provider; it never receives a
repository handle or performs a storage write.

```text
apps/web ── same-origin JSON API ── apps/api
                                         ├── MemoryService ── JsonMemoryRepository
                                         └── ChatService ── MemoryRetriever
                                                            ├── OpenAI-compatible adapter
                                                            └── Ollama adapter
```

## Packages

- `packages/shared` defines runtime-validated request and response
  schemas and the `Memory`, chat, and settings types. It contains no
  credentials or server configuration.
- `apps/api/src/domain` declares memory, repository, retrieval, and
  provider contracts.
- `apps/api/src/application` applies business rules and coordinates
  services. It does not know about Express or HTTP requests.
- `apps/api/src/infrastructure` implements JSON persistence and the LLM
  adapters.
- `apps/api/src/http` maps validated REST requests to the application and
  hides provider errors and secrets.
- `apps/web` renders the chat, memory list, and a read-only settings page.
  It defaults to English, offers Hungarian translations, and saves the
  language choice in browser storage. Its build has no provider credentials.
- `features/` holds API-facing Cucumber acceptance scenarios.

## Memory storage

`MemoryRepository` accepts whole transactions. JSON writes serialize the
read, validation, duplicate check, and write under one asynchronous
mutex. At process startup, `proper-lockfile` reserves the data directory
to stop another app instance from using the same store. A write creates
and syncs a mode-0600 temporary file in that directory, atomically
renames it into place, syncs the directory where supported, and updates
the in-memory read snapshot only after a successful commit. If a commit
has an uncertain result, the API stops serving data until it recovers.

A malformed existing `memories.json` is preserved and prevents startup;
it is never replaced by an empty list. A missing store is initialized as
an empty JSON array. JSON contains only the memory fields in the
specification. Chat histories and model proposals live in process memory
only.

The supported storage arrangement is one process, one local writable
data directory, and no shared-network folder or second replica. The
repository contract can later be implemented by SQLite without changing
the HTTP or chat domain.

## Chat and write approval

Each chat request searches memories locally using normalized category
and content tokens. The request sent to a configured provider contains a
bounded conversation history and no more than five matching memories,
with a 6,000-character memory-context limit. The user may see which
memory IDs the assistant request included.

The provider returns a JSON `answer`, `clarification`, or one
`CREATE_MEMORY`, `UPDATE_MEMORY`, or `DELETE_MEMORY` proposal. The API
validates the shape, checks that update and deletion IDs were among the
shortlisted memories, and rejects actions that do not match an explicit
request. The browser previews the proposal. Only approval invokes the
existing memory CRUD API. Strong ETags prevent an old update or
deletion from acting on a memory that changed after the proposal.

The repository write happens only after user approval. Chat text and
memory content are always treated as data, never as instructions to
execute. A memory change clears active server-side chat history and
invalidates responses still in flight under an earlier memory-context
generation.

## Provider details

`LlmProvider.chat` accepts common internal messages and returns message
content. Provider-specific URLs, HTTP bodies, authorization, response
parsing, and timeouts stay inside their adapters. Test suites inject a
deterministic fake. They never send fixtures to a real or paid provider.

The OpenAI-compatible adapter posts non-streaming chat-completion
requests. Set `OPENAI_STRUCTURED_OUTPUT=true` only when the endpoint
supports JSON response mode. The Ollama adapter uses its `/api/chat`
endpoint and JSON format. Both validate the response envelope and limit
response size before parsing it.

## Network and privacy model

The app has no account system. The production API rejects cross-origin
browser writes, limits JSON request size and chat rates, validates every
input, redacts log content, and binds to `127.0.0.1` by default. Compose
exposes the app only on host localhost. The operator must add
authentication and TLS before enabling remote access.
