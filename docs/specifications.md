# Home Memory Agent

> A lightweight, self-hosted personal memory layer for AI assistants.
>
> **Your AI model can change. Your memory stays yours.**

## 1. Project Overview

Home Memory Agent is an open-source, self-hosted personal AI assistant
that stores useful long-term information about its user, retrieves
relevant memories during conversations, and enables personalized
responses based on previous preferences and experiences.

The primary goal is not to build a general-purpose ChatGPT replacement.
Instead, the project provides an easy-to-operate **personal memory and
context layer** for large language models (LLMs).

Example:

User:

> I am going on a 15 km autumn hike tomorrow. What should I bring?

The system may take previously stored information into account, for
example:

-   the user usually carries 2 litres of water;
-   the user carries a headlamp;
-   the user carries a power bank;
-   the user has previously needed an outer layer;
-   the user typically brings bananas and cereal bars on hikes.

The LLM generates its response using the current request together with
the relevant stored memories.

------------------------------------------------------------------------

# 2. Design Principles

## Self-hosted

The complete application must be deployable on a private server,
Raspberry Pi, or another Docker-compatible environment.

## Privacy-first

Memories are stored locally by default.

The application must not send user data to third parties except for
context explicitly required by a configured external LLM provider.

The documentation must clearly state that when an external LLM API is
used, any context included in the request leaves the local system.

## Provider-independent

The application must not depend on a single AI provider.

The LLM integration must be hidden behind an abstraction so multiple
providers can be supported, including:

-   OpenAI-compatible APIs;
-   other cloud LLM providers;
-   Ollama;
-   other local models.

## Simple deployment

The MVP must not require a vector database, Kubernetes, or other complex
infrastructure.

The project should be runnable with:

``` bash
docker compose up -d
```

------------------------------------------------------------------------

# 3. Core Use Cases

## UC-01 -- Conversation

The user communicates with the agent using natural language.

Example:

> What should I bring on a weekend hike?

The system:

1.  receives the user's request;
2.  selects relevant memories;
3.  builds the LLM context;
4.  invokes the configured LLM;
5.  returns the generated response.

------------------------------------------------------------------------

## UC-02 -- Create a Memory

The user can explicitly ask the agent to remember information.

Example:

> Remember that I always take a headlamp when hiking.

The system creates a persistent memory.

Example:

``` json
{
  "category": "hiking",
  "content": "The user normally carries a headlamp when hiking."
}
```

------------------------------------------------------------------------

## UC-03 -- Update a Memory

The user can correct or refine previously stored information.

Example:

> I no longer take two litres of water on short hikes.

The system must update or invalidate the corresponding memory.

------------------------------------------------------------------------

## UC-04 -- Delete a Memory

The user can ask the agent to forget stored information.

Example:

> Forget that I always take cereal bars.

Deletion must actually remove the information from the memory store.

------------------------------------------------------------------------

## UC-05 -- Browse Memories

The user can browse stored memories through the web interface.

Example categories:

-   Travel
-   Hiking
-   Food
-   Equipment
-   Home
-   Vehicles
-   Preferences
-   Other

Categories must not be hard-coded into business logic; the system should
remain general-purpose and extensible.

------------------------------------------------------------------------

# 4. MVP Scope

The first release should provide a **minimal but genuinely useful
system**.

### Backend

Recommended stack:

-   Node.js
-   TypeScript
-   REST API

### Frontend

A simple web application providing:

-   a chat interface;
-   a memory list;
-   memory creation;
-   memory editing;
-   memory deletion;
-   a settings page.

### Storage

For the MVP, file-based storage is sufficient:

``` text
data/
└── memories.json
```

Example:

``` json
[
  {
    "id": "mem-001",
    "category": "hiking",
    "content": "Usually carries approximately 2 litres of water.",
    "createdAt": "2026-10-21T18:00:00Z",
    "updatedAt": "2026-10-21T18:00:00Z"
  },
  {
    "id": "mem-002",
    "category": "travel",
    "content": "Usually carries a power bank when travelling.",
    "createdAt": "2026-10-21T18:05:00Z",
    "updatedAt": "2026-10-21T18:05:00Z"
  }
]
```

The storage layer must be hidden behind an interface so JSON storage can
later be replaced by a database without changing domain logic.

------------------------------------------------------------------------

# 5. Proposed Architecture

``` text
┌─────────────────────┐
│       Browser       │
└──────────┬──────────┘
           │
           │ HTTP
           ▼
┌─────────────────────┐
│      Web / API      │
│ Node.js + TypeScript│
└──────────┬──────────┘
           │
     ┌─────┴──────┐
     │            │
     ▼            ▼
┌─────────┐   ┌─────────────┐
│ Memory  │   │ LLM Provider│
│ Service │   │   Adapter   │
└────┬────┘   └──────┬──────┘
     │               │
     ▼               ▼
memories.json     Cloud API
                  or Ollama
```

The backend consists of the following primary components:

### ChatService

Responsibilities:

-   process user messages;
-   retrieve relevant memories;
-   build the prompt and context;
-   invoke the configured LLM.

### MemoryService

Responsibilities:

-   memory creation;
-   retrieve memories;
-   update memories;
-   delete memories;
-   select relevant memories.

### MemoryRepository

Abstracts persistence from the rest of the application.

``` typescript
interface MemoryRepository {
    findAll(): Promise<Memory[]>;
    findById(id: string): Promise<Memory | null>;
    create(memory: Memory): Promise<Memory>;
    update(memory: Memory): Promise<Memory>;
    delete(id: string): Promise<void>;
}
```

MVP implementation:

``` text
JsonMemoryRepository
```

Possible future implementations:

``` text
SqliteMemoryRepository
PostgresMemoryRepository
VectorMemoryRepository
```

### LlmProvider

Abstracts the configured LLM provider.

``` typescript
interface LlmProvider {
    chat(request: ChatRequest): Promise<ChatResponse>;
}
```

Possible implementations:

``` text
OpenAICompatibleProvider
OllamaProvider
```

------------------------------------------------------------------------

# 6. Memory Retrieval

The MVP does not require embeddings or vector search.

Relevance can initially be determined using:

-   categories;
-   keywords;
-   simple text matching;
-   optional LLM-assisted selection.

Example:

``` text
User:
"What should I bring hiking tomorrow?"

Detected category:
hiking

Relevant memories:
- Carries a headlamp.
- Usually carries 2 litres of water.
- Carries a power bank.
```

A later version may replace or extend this approach with embedding-based
semantic search.

------------------------------------------------------------------------

# 7. Memory Writes

A critical requirement is that the LLM **must never modify the
persistence layer directly**.

Instead, the LLM may request a structured operation:

``` json
{
  "action": "CREATE_MEMORY",
  "memory": {
    "category": "hiking",
    "content": "The user wants to carry gloves on cold-weather hikes."
  }
}
```

The backend validates the requested operation, and `MemoryService`
performs the actual change.

This design enables future support for:

-   user confirmation;
-   audit logging;
-   authorization and permissions;
-   rejecting invalid or unsafe AI-generated operations.

------------------------------------------------------------------------

# 8. Security

Because the application may store personal information, security is a
core project requirement.

Minimum requirements:

-   API keys must only be provided through environment variables;
-   `.env` must be included in `.gitignore`;
-   personal memories must never be committed to the repository;
-   example configuration must contain fictional data only;
-   input validation;
-   API errors must not leak secrets;
-   Docker containers should run as a non-root user whenever possible.

The public repository must include:

``` text
.env.example
```

For example:

``` text
LLM_PROVIDER=openai-compatible
LLM_BASE_URL=
LLM_API_KEY=
LLM_MODEL=
DATA_PATH=/app/data
```

------------------------------------------------------------------------

# 9. Public Repository Structure

Recommended structure:

``` text
home-memory-agent/
├── apps/
│   ├── api/
│   └── web/
│
├── packages/
│   └── shared/
│
├── data/
│   └── .gitkeep
│
├── docs/
│   ├── architecture.md
│   └── development.md
│
├── docker/
│
├── .env.example
├── .gitignore
├── docker-compose.yml
├── LICENSE
├── CONTRIBUTING.md
└── README.md
```

The real memory file:

``` text
data/memories.json
```

must always be excluded from Git.

------------------------------------------------------------------------

# 10. README Goals

The repository landing page should communicate the following:

> **Home Memory Agent**
>
> A lightweight, self-hosted personal memory layer for AI assistants.
>
> Store information about yourself locally and let your preferred LLM
> use only the memories relevant to the current conversation.
>
> Designed to run on anything from a Raspberry Pi to a home server.

Key features:

-   🧠 persistent personal memory
-   🏠 self-hosted
-   🔒 privacy-first
-   🤖 multiple LLM providers
-   🐳 Docker deployment
-   🍓 Raspberry Pi compatible
-   🔌 extensible storage and provider architecture

------------------------------------------------------------------------

# 11. Docker Deployment

ARM64 compatibility is required so the project can run natively on
devices such as the Raspberry Pi 5.

Deployment:

``` bash
git clone <repository>
cd home-memory-agent

cp .env.example .env

docker compose up -d
```

Persistent data must be stored in a dedicated Docker volume or host
directory.

Restarting, replacing, or updating containers must not delete stored
memories.

------------------------------------------------------------------------

# 12. MVP API

Proposed endpoints:

``` text
POST   /api/chat

GET    /api/memories
POST   /api/memories
GET    /api/memories/:id
PUT    /api/memories/:id
DELETE /api/memories/:id

GET    /api/health
```

Example:

``` http
POST /api/chat
```

Request:

``` json
{
  "message": "What should I bring hiking tomorrow?"
}
```

Response:

``` json
{
  "message": "Based on your usual hiking setup..."
}
```

------------------------------------------------------------------------

# 13. Out of Scope for the MVP

The first version intentionally excludes:

-   vector database;
-   a complex RAG pipeline;
-   multi-agent systems;
-   automatic web browsing;
-   calendar or email integrations;
-   a mobile application;
-   voice control;
-   complex user management;
-   Kubernetes deployment.

These may be introduced in later releases.

------------------------------------------------------------------------

# 14. Roadmap

## v0.1 -- Minimal Memory

-   TypeScript backend
-   JSON storage
-   memory CRUD
-   LLM integration
-   simple chat UI
-   Docker
-   ARM64 support

## v0.2 -- Smart Memory

-   automatic memory extraction;
-   natural-language memory updates and deletion;
-   memory priority;
-   duplicate detection;
-   memory confirmation.

## v0.3 -- Semantic Memory

-   SQLite/PostgreSQL;
-   embeddings;
-   semantic search;
-   relevance scoring;
-   memory expiration and archival.

## v0.4 -- Agent Tools

Example tool interface:

``` text
weather.getForecast()
calendar.getEvents()
packing.createList()
notes.search()
```

The agent may invoke these tools based on the current request.

## v0.5 -- Automation

Example:

> I am going hiking tomorrow.

The system may:

1.  retrieve the weather forecast;
2.  retrieve relevant hiking memories;
3.  generate a packing list;
4.  highlight special conditions or risks.

------------------------------------------------------------------------

# 15. Long-Term Vision

The long-term goal is to provide **user-owned personal AI memory** that
is not tied to any single LLM provider.

``` text
                 Personal Memory
                       │
          ┌────────────┼────────────┐
          ▼            ▼            ▼
       OpenAI        Ollama       Future LLM
          │            │            │
          └────────────┼────────────┘
                       ▼
                Personal Agent
                       │
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
      Weather       Calendar        Travel
        │              │              │
        └──────────────┼──────────────┘
                       ▼
                     User
```

The LLM is replaceable.

**The memory belongs to the user.**

# 16. Development Methodology -- TDD + BDD

The project should be developed using **Test-Driven Development (TDD)**
and **Behavior-Driven Development (BDD)** principles.

This has two goals:

1.  define system behavior clearly before implementation;
2.  maintain strong automated test coverage and regression protection.

BDD and TDD are complementary rather than competing approaches and are
applied at different levels of the project.

------------------------------------------------------------------------

## 16.1 BDD -- Behavioral Specification

User-facing behavior is specified using BDD scenarios.

Recommended format:

**Gherkin / Cucumber**

``` gherkin
Feature: Personal memory

  Scenario: User explicitly asks the assistant to remember something
    Given the user has no stored hiking preferences
    When the user says "Remember that I always take a headlamp when hiking"
    Then a new memory should be created
    And the memory category should be "hiking"
    And the memory should contain the headlamp preference
```

BDD scenarios describe expected **behavior**, not implementation
details.

Avoid:

``` gherkin
Then memories.json should contain a new JSON object
```

Prefer:

``` gherkin
Then a new memory should be stored
```

This keeps the scenario valid even if the JSON repository is later
replaced by PostgreSQL.

------------------------------------------------------------------------

## 16.2 Core BDD Features

Initial feature suite:

``` text
features/
├── chat.feature
├── memory-creation.feature
├── memory-retrieval.feature
├── memory-update.feature
├── memory-deletion.feature
└── llm-provider.feature
```

### Memory creation

``` gherkin
Feature: Memory creation

  Scenario: Remember an explicit preference
    Given the user has no memory about hiking lights
    When the user asks the assistant to remember that they take a headlamp hiking
    Then the preference should be stored

  Scenario: Do not create duplicate memories
    Given the assistant already remembers that the user takes a headlamp hiking
    When the user asks the assistant to remember the same preference
    Then another equivalent memory should not be created
```

### Memory retrieval

``` gherkin
Feature: Relevant memory retrieval

  Scenario: Hiking memories are used for a hiking question
    Given the assistant remembers that the user takes a headlamp hiking
    And the assistant remembers that the user takes a power bank when travelling
    When the user asks what they should bring on a hike
    Then the headlamp memory should be included in the relevant context
```

### Memory deletion

``` gherkin
Feature: Memory deletion

  Scenario: Forget stored information
    Given the assistant remembers that the user takes a headlamp hiking
    When the user asks the assistant to forget that information
    Then the headlamp memory should no longer be stored
```

### Memory update

``` gherkin
Feature: Memory update

  Scenario: User changes an existing preference
    Given the assistant remembers that the user takes 2 litres of water on every hike
    When the user says they only take 2 litres on long hikes
    Then the existing memory should be updated
    And the obsolete preference should not remain active
```

------------------------------------------------------------------------

## 16.3 TDD -- Implementation

Individual components should be developed using the standard TDD cycle:

``` text
RED
 ↓
Write failing test

GREEN
 ↓
Implement minimum code required

REFACTOR
 ↓
Improve implementation while tests remain green
```

Example:

Example initial test:

``` typescript
describe("MemoryService", () => {
  it("stores a new memory", async () => {
    const repository = new InMemoryMemoryRepository();
    const service = new MemoryService(repository);

    await service.create({
      category: "hiking",
      content: "User carries a headlamp."
    });

    const memories = await repository.findAll();

    expect(memories).toHaveLength(1);
  });
});
```

At this point:

``` text
MemoryService does not exist
→ RED
```

Then implement the smallest amount of production code required to make
the test pass.

------------------------------------------------------------------------

## 16.4 Test Pyramid

Automated tests should operate at multiple levels.

``` text
             ┌──────────────┐
             │     E2E      │
             │     BDD      │
             └──────┬───────┘
                    │
           ┌────────┴────────┐
           │   Integration   │
           │      Tests      │
           └────────┬────────┘
                    │
        ┌───────────┴───────────┐
        │       Unit Tests      │
        │         TDD           │
        └───────────────────────┘
```

### Unit tests

Fast, isolated tests should cover areas such as:

-   MemoryService
-   relevance scoring
-   validation
-   prompt/context builder
-   duplicate detection
-   provider-independent business logic

These should primarily be developed using TDD.

### Integration tests

Integration tests verify collaboration between components, for example:

``` text
MemoryService
      ↓
MemoryRepository
      ↓
JSON storage
```

and:

``` text
ChatService
      ↓
FakeLlmProvider
```

Automated tests must **not call real paid LLM APIs by default**.

### BDD / Acceptance Tests

These verify complete user-visible behavior:

``` text
Given → When → Then
```

Where practical, scenarios should exercise the system through its public
interfaces.

------------------------------------------------------------------------

## 16.5 Deterministic AI Tests

Because LLM behavior is non-deterministic, business tests must not
depend on responses from a real model.

Provide a test implementation such as:

``` typescript
class FakeLlmProvider implements LlmProvider
```

Például:

``` typescript
const llm = new FakeLlmProvider({
  response: {
    action: "CREATE_MEMORY",
    memory: {
      category: "hiking",
      content: "User carries a headlamp."
    }
  }
});
```

This allows the following flow to be tested deterministically:

``` text
user input
   ↓
ChatService
   ↓
LLM structured action
   ↓
validation
   ↓
MemoryService
   ↓
MemoryRepository
```

without making test results dependent on an external AI model.

------------------------------------------------------------------------

## 16.6 Recommended TypeScript Testing Stack

### Unit / Integration

**Vitest**

### BDD

**Cucumber.js**

### API

**Supertest**

### Frontend

**Testing Library**

### E2E UI

Possible future implementations:

**Playwright**

Playwright should not be required for the earliest MVP features.

------------------------------------------------------------------------

## 16.7 Definition of Done

A feature is considered complete when:

-   its corresponding BDD scenario exists and passes;
-   its business logic has appropriate unit-test coverage;
-   all existing regression tests pass;
-   linting and type checking pass;
-   the application can be built as a Docker image;
-   relevant documentation has been updated when necessary.

------------------------------------------------------------------------

## 16.8 CI Pipeline

Every pull request should automatically run:

``` text
Install
   ↓
Lint
   ↓
Typecheck
   ↓
Unit Tests
   ↓
Integration Tests
   ↓
BDD Tests
   ↓
Build
```

Changes should only be merged into `main` after the pipeline succeeds.

------------------------------------------------------------------------

## 16.9 First Feature

The first production feature should be:

``` gherkin
Feature: Store personal memories

  Scenario: Store a memory
    Given the memory store is empty
    When a memory with category "hiking" and content "User carries a headlamp" is created
    Then exactly one memory should be stored
    And its category should be "hiking"
```

Development sequence:

``` text
1. Gherkin scenario
        ↓
2. Scenario RED
        ↓
3. Unit test RED
        ↓
4. Minimal implementation
        ↓
5. Unit test GREEN
        ↓
6. BDD scenario GREEN
        ↓
7. Refactor
```

Continue with the same workflow for:

``` text
Create memory
      ↓
Read memory
      ↓
Update memory
      ↓
Delete memory
      ↓
Relevant memory selection
      ↓
Chat
      ↓
LLM integration
```

This sequence gradually builds the MVP while keeping behavior executable
and implementation test-driven.
