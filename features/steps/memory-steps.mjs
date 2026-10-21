import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import {
  After,
  Before,
  Given,
  Then,
  When,
  setWorldConstructor,
  World,
} from '@cucumber/cucumber';
import request from 'supertest';
import { createMemoryApplicationServices } from '../../apps/api/dist/application/repository-memory-service.js';
import { loadConfig } from '../../apps/api/dist/config.js';
import { JsonMemoryRepository } from '../../apps/api/dist/infrastructure/persistence/json-memory-repository.js';
import { createApplication } from '../../apps/api/dist/http/application.js';

class ScenarioWorld extends World {
  constructor(options) {
    super(options);
    this.responseContent = null;
    this.lastChat = null;
    this.memoryId = null;
  }
}

setWorldConstructor(ScenarioWorld);

Before(async function () {
  this.directory = await mkdtemp(path.join(process.cwd(), 'data', 'hmem-bdd-'));
  this.config = loadConfig({
    NODE_ENV: 'test',
    DATA_PATH: this.directory,
    LLM_PROVIDER: 'openai-compatible',
    LLM_BASE_URL: 'https://fixture.invalid/v1',
    LLM_API_KEY: 'fixture-secret',
    LLM_MODEL: 'fake-model',
  });
  this.repository = new JsonMemoryRepository(this.directory);
  await this.repository.initialize();
  this.fake = {
    name: 'openai-compatible',
    requests: [],
    async chat(input) {
      this.requests.push(input);
      return {
        content:
          this.owner.responseContent ?? JSON.stringify({ kind: 'answer', message: 'Szia!' }),
      };
    },
  };
  this.fake.owner = this;
  const services = createMemoryApplicationServices({
    repository: this.repository,
    provider: this.fake,
    providerConfigured: true,
    model: 'fake-model',
  });
  this.app = createApplication(this.config, services);
});

After(async function () {
  await this.repository?.close();
  if (this.directory) await rm(this.directory, { recursive: true, force: true });
});

Given('the user has no stored memories', function () {});

Given(
  'the assistant remembers {string} in category {string}',
  async function (content, category) {
    const response = await request(this.app)
      .post('/api/memories')
      .send({ category, content })
      .expect(201);
    this.memoryId = response.body.memory.id;
  },
);

Given(
  'the assistant already remembers {string} in category {string}',
  async function (content, category) {
    const response = await request(this.app)
      .post('/api/memories')
      .send({ category, content })
      .expect(201);
    this.memoryId = response.body.memory.id;
  },
);

Given(
  'the assistant proposes to create {string} in category {string}',
  function (content, category) {
    this.responseContent = JSON.stringify({
      kind: 'proposal',
      action: { action: 'CREATE_MEMORY', memory: { category, content } },
    });
  },
);

Given('the assistant proposes to update a memory that is not on the shortlist', function () {
  this.responseContent = JSON.stringify({
    kind: 'proposal',
    action: {
      action: 'UPDATE_MEMORY',
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      memory: { category: 'hiking', content: 'Never approved.' },
    },
  });
});

Given('the assistant proposes to delete a memory that is not on the shortlist', function () {
  this.responseContent = JSON.stringify({
    kind: 'proposal',
    action: { action: 'DELETE_MEMORY', id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
  });
});

Given('the assistant is configured with an OpenAI-compatible provider', function () {});
Given('no language model provider is configured', function () {
  this.config = loadConfig({
    NODE_ENV: 'test',
    DATA_PATH: this.directory,
    LLM_PROVIDER: 'none',
  });
  const services = createMemoryApplicationServices({
    repository: this.repository,
    providerConfigured: false,
    model: '',
  });
  this.app = createApplication(this.config, services);
});

When('the user says {string}', async function (message) {
  if (/^remember/iu.test(message)) {
    this.responseContent = JSON.stringify({
      kind: 'proposal',
      action: {
        action: 'CREATE_MEMORY',
        memory: { category: 'hiking', content: 'User takes a headlamp when hiking.' },
      },
    });
  } else if (/^forget/iu.test(message) && !this.responseContent) {
    const memories = await this.repository.list();
    this.responseContent = JSON.stringify({
      kind: 'proposal',
      action: { action: 'DELETE_MEMORY', id: memories[0]?.id },
    });
  } else if (
    /^change/iu.test(message) &&
    !this.responseContent &&
    this.fake.requests.length === 0
  ) {
    this.responseContent = JSON.stringify({
      kind: 'proposal',
      action: {
        action: 'UPDATE_MEMORY',
        id: this.memoryId,
        memory: { category: 'hiking', content: 'I pack 2 litres only on long hikes.' },
      },
    });
  } else if (/^change/iu.test(message) && !this.responseContent) {
    const memories = await this.repository.list();
    this.responseContent = JSON.stringify({
      kind: 'proposal',
      action: {
        action: 'UPDATE_MEMORY',
        id: memories[0]?.id,
        memory: { category: 'hiking', content: 'I pack 2 litres only on long hikes.' },
      },
    });
  }
  this.lastChat = await request(this.app).post('/api/chat').send({ message }).expect(200);
});

When('the user asks {string}', async function (message) {
  this.lastChat = await request(this.app).post('/api/chat').send({ message }).expect(200);
});

When(
  'a memory with category {string} and content {string} is created',
  async function (category, content) {
    this.lastMemoryResponse = await request(this.app)
      .post('/api/memories')
      .send({ category, content })
      .expect(201);
  },
);

When('the user proposes the same memory with different spacing', async function () {
  this.lastMemoryResponse = await request(this.app)
    .post('/api/memories')
    .send({ category: ' hiking ', content: ' User   carries a headlamp when hiking ' })
    .expect(409);
});

When('the user approves the proposed memory', async function () {
  const action = this.lastChat.body.proposal.action;
  this.lastMemoryResponse = await request(this.app)
    .post('/api/memories')
    .send(action.memory)
    .expect(201);
});

When('the user approves the proposed update', async function () {
  const { action } = this.lastChat.body.proposal;
  this.lastMemoryResponse = await request(this.app)
    .put(`/api/memories/${action.id}`)
    .set('If-Match', this.lastChat.body.proposal.etag)
    .send(action.memory)
    .expect(200);
});

When('the user approves the proposed deletion', async function () {
  const { action } = this.lastChat.body.proposal;
  this.lastMemoryResponse = await request(this.app)
    .delete(`/api/memories/${action.id}`)
    .set('If-Match', this.lastChat.body.proposal.etag)
    .expect(204);
});

Then('the assistant should propose a new memory', function () {
  if (this.lastChat.body.proposal?.action.action !== 'CREATE_MEMORY')
    throw new Error('The assistant did not propose a memory.');
});

Then('the assistant should propose an update', function () {
  if (this.lastChat.body.proposal?.action.action !== 'UPDATE_MEMORY')
    throw new Error('The assistant did not propose an update.');
});

Then('the assistant should propose a deletion', function () {
  if (this.lastChat.body.proposal?.action.action !== 'DELETE_MEMORY')
    throw new Error('The assistant did not propose a deletion.');
});

Then('the assistant should not claim the memory was updated', function () {
  if (/updated|changed|módosítottam|frissítettem/iu.test(this.lastChat.body.message))
    throw new Error('The chat response claimed an update before approval.');
});

Then('the memory store should still be empty', async function () {
  const response = await request(this.app).get('/api/memories').expect(200);
  if (response.body.total !== 0)
    throw new Error(`Expected an empty store but found ${response.body.total} memories.`);
});

Then('the stored memory should remain unchanged', async function () {
  const memories = await this.repository.list();
  if (!memories.some((memory) => memory.content.includes('2 litres of water on every hike')))
    throw new Error('The memory changed before approval.');
});

Then('the memory store should still contain {string}', async function (content) {
  const memories = await this.repository.list();
  if (!memories.some((memory) => memory.content.includes(content)))
    throw new Error(`Expected the memory containing "${content}" to remain stored.`);
});

Then('the memory store should not contain {string}', async function (content) {
  const memories = await this.repository.list();
  if (memories.some((memory) => memory.content.includes(content)))
    throw new Error(`Expected the memory containing "${content}" to be deleted.`);
});

Then('the {string} memory should be included in the relevant context', function (content) {
  const messages = this.fake.requests.at(-1)?.messages ?? [];
  if (
    !messages.some((message) => message.content.toLowerCase().includes(content.toLowerCase()))
  )
    throw new Error(`Expected a context memory containing "${content}".`);
});

Then('the {string} memory should not be included in the relevant context', function (content) {
  const messages = this.fake.requests.at(-1)?.messages ?? [];
  if (
    messages.some((message) => message.content.toLowerCase().includes(content.toLowerCase()))
  )
    throw new Error(`The context unexpectedly included "${content}".`);
});

Then('exactly {word} memor{word} should be stored', async function (countWord, suffix) {
  const counts = { zero: 0, one: 1, two: 2, three: 3 };
  const count = counts[countWord];
  if (count === undefined) throw new Error(`Unsupported memory count: ${countWord}.`);
  if (!['y', 'ies'].includes(suffix)) throw new Error('Expected a memory count assertion.');
  const response = await request(this.app).get('/api/memories').expect(200);
  if (response.body.total !== count)
    throw new Error(`Expected ${count} memory, found ${response.body.total}.`);
});

Then('no duplicate memory should be stored', function () {
  if (this.lastMemoryResponse.status !== 409)
    throw new Error('Expected the duplicate write to be rejected.');
});

Then('the {word} memory should contain {string}', async function (category, content) {
  const memories = await this.repository.list();
  if (
    !memories.some(
      (memory) =>
        memory.category.toLowerCase() === category.toLowerCase() &&
        memory.content.toLowerCase().includes(content.toLowerCase()),
    )
  )
    throw new Error(`No ${category} memory contains "${content}".`);
});

Then('no memory action should be proposed', function () {
  if (this.lastChat.body.proposal !== null)
    throw new Error('An unrequested or unsafe memory action was proposed.');
});

Then('the provider name should be {string}', async function (provider) {
  const settings = await request(this.app).get('/api/settings').expect(200);
  if (settings.body.provider !== provider)
    throw new Error(`Expected ${provider}, found ${settings.body.provider}.`);
});

Then('the settings response should not include an API key', async function () {
  const settings = await request(this.app).get('/api/settings').expect(200);
  if (JSON.stringify(settings.body).includes('fixture-secret'))
    throw new Error('The settings endpoint disclosed its API key.');
});
