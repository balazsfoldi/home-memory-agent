# Architecture

Home Memory Agent v0.3.0 is a single-user modular monolith. One Node.js
process serves the static React application, REST API, and local SQLite
memory store. Configured language and embedding models are outbound
providers; neither receives a repository handle or performs a storage write.

```text
apps/web ── same-origin JSON API ── apps/api
                                         ├── MemoryService ── SqliteMemoryRepository
                                         └── ChatService ── MemoryRetriever
                                                            ├── OpenAI-compatible adapter
                                                            └── Ollama adapter
                                         └── MemorySearchService
                                             ├── local lexical ranking
                                             └── configured embedding adapter
```

## Packages

- `packages/shared` defines runtime-validated request and response
  schemas and the `Memory`, chat, and settings types. It contains no
  credentials or server configuration.
- `apps/api/src/domain` declares memory, repository, retrieval, and
  provider contracts.
- `apps/api/src/application` applies business rules and coordinates
  services. It does not know about Express or HTTP requests.
- `apps/api/src/infrastructure` implements SQLite and JSON persistence,
  LLM adapters, and embedding adapters.
- `apps/api/src/http` maps validated REST requests to the application and
  hides provider errors and secrets.
- `apps/web` renders the chat, memory list, and a read-only settings page.
  It defaults to English, offers Hungarian translations, and saves the
  language choice in browser storage. Its build has no provider credentials.
- `features/` holds API-facing Cucumber acceptance scenarios.

## Memory storage

`MemoryRepository` accepts whole transactions. SQLite is the default and
stores memories, expiry/archive timestamps, schema metadata, and float32
embedding vectors in `memories.sqlite`. Transactions use
`BEGIN IMMEDIATE`, foreign keys, WAL journaling, and full synchronous
commits. Updating a memory's category or text invalidates its vector.
At process startup, `proper-lockfile` reserves the data directory so a
second app instance cannot open the same store.

On first startup, the SQLite adapter validates and imports an existing
`memories.json` in one transaction. It keeps the original file unchanged
as a recovery copy and records that the import completed. Invalid JSON is
preserved and prevents startup; it is never replaced with an empty store.
The optional JSON adapter remains available with `MEMORY_STORE=json`.
The supported storage arrangement is one process, one local writable
data directory, and no shared-network folder or second replica.

Memories may have an expiry timestamp and may be archived or restored.
The default list and chat context include only non-archived, unexpired
memories. Archived and expired items remain available in their filtered
views until explicitly deleted. Chat histories and model proposals stay
in process memory only.

## Chat and write approval

Each chat request searches locally using normalized category and content
tokens. When an embedding provider is configured, the search also ranks
indexed memories by cosine similarity and uses lexical ranking as a
fallback. Missing vectors are generated in bounded batches and saved
locally. The chat provider receives a bounded conversation history and
no more than five matching, active memories, with a 6,000-character
memory-context limit. The user may see which memory IDs the request
included.

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

`EmbeddingProvider.embed` accepts bounded batches of text and returns
finite vectors. The OpenAI-compatible adapter uses `/embeddings`; the
Ollama adapter uses `/api/embed`. Embedding configuration is separate
from chat configuration. If it is absent or unavailable, memory search
continues with the local lexical retriever.

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

The chat provider receives selected memories, short temporary chat
history, and the current message. If semantic search is enabled, the
embedding endpoint receives search queries and saved memory text to build
the local index; the settings page discloses this. With
`LLM_PROVIDER=none`, the API and memory UI still work. An Ollama instance
in another container should be addressed by its Docker network name;
`localhost` inside Home Memory Agent refers to that container itself.
