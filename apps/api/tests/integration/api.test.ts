import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestRuntime, type TestRuntime } from '../helpers/test-runtime.js';

let runtime: TestRuntime | undefined;
afterEach(async () => {
  await runtime?.close();
  runtime = undefined;
});

describe('memory and chat API', () => {
  it('serves a safe readiness and settings response without exposing credentials', async () => {
    runtime = await createTestRuntime();
    await request(runtime.app)
      .get('/api/health')
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual({ status: 'ok', memoryReady: true, providerConfigured: true });
        expect(JSON.stringify(body)).not.toContain(runtime?.config.apiKey);
      });
    await request(runtime.app)
      .get('/api/settings')
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          provider: 'openai-compatible',
          model: 'fixture-model',
          configured: true,
        });
        expect(JSON.stringify(body)).not.toContain(runtime?.config.apiKey);
        expect(JSON.stringify(body)).not.toContain('example.invalid');
      });
  });

  it('creates, lists, reads and updates a memory using a server-controlled ETag', async () => {
    runtime = await createTestRuntime();
    const created = await request(runtime.app)
      .post('/api/memories')
      .send({ category: 'Hiking', content: 'I take a headlamp.' })
      .expect(201);
    expect(created.body.memory.category).toBe('Hiking');
    expect(created.headers.etag).toBe(created.body.etag);
    const id = created.body.memory.id as string;
    const listed = await request(runtime.app).get('/api/memories').expect(200);
    expect(listed.body.items).toHaveLength(1);
    expect(listed.body.items[0].memory.id).toBe(id);
    await request(runtime.app)
      .get(`/api/memories/${id}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.memory.content).toBe('I take a headlamp.');
      });
    const updated = await request(runtime.app)
      .put(`/api/memories/${id}`)
      .set('If-Match', created.headers.etag as string)
      .send({ category: 'Hiking', content: 'I take a headlamp on cold hikes.' })
      .expect(200);
    expect(updated.body.memory.createdAt).toBe(created.body.memory.createdAt);
    expect(updated.headers.etag).not.toBe(created.headers.etag);
  });

  it('rejects duplicates, stale edits, malformed input, and cross-origin writes', async () => {
    runtime = await createTestRuntime();
    const first = await request(runtime.app)
      .post('/api/memories')
      .send({ category: 'Food', content: 'Tea' })
      .expect(201);
    await request(runtime.app)
      .post('/api/memories')
      .send({ category: ' food ', content: '  TEA  ' })
      .expect(409)
      .expect(({ body }) => expect(body.error.code).toBe('MEMORY_ALREADY_EXISTS'));
    await request(runtime.app)
      .put(`/api/memories/${first.body.memory.id}`)
      .set('If-Match', `"sha256-${'A'.repeat(43)}"`)
      .send({ category: 'Food', content: 'Coffee' })
      .expect(412);
    await request(runtime.app)
      .post('/api/memories')
      .send({ category: '', content: ' ' })
      .expect(400);
    await request(runtime.app)
      .post('/api/memories')
      .set('origin', 'https://attacker.invalid')
      .send({ category: 'Travel', content: 'Private' })
      .expect(403);
    await request(runtime.app)
      .get('/api/memories')
      .expect(200)
      .expect(({ body }) => expect(body.total).toBe(1));
  });

  it('persists priority and rejects high-confidence paraphrase duplicates', async () => {
    runtime = await createTestRuntime();
    const first = await request(runtime.app)
      .post('/api/memories')
      .send({
        category: 'Utazás',
        content: 'I prefer quiet nature-oriented accommodation when travelling.',
        priority: 'high',
      })
      .expect(201);
    expect(first.body.memory.priority).toBe('high');
    await request(runtime.app)
      .post('/api/memories')
      .send({
        category: 'Utazás',
        content: 'I prefer calm accommodation close to nature when travelling.',
      })
      .expect(409)
      .expect(({ body }) => {
        expect(body.error.code).toBe('MEMORY_ALREADY_EXISTS');
        expect(body.error.details.existingId).toBe(first.body.memory.id);
      });
    await request(runtime.app)
      .post('/api/memories')
      .send({
        category: 'Utazás',
        content: 'I do not prefer quiet nature-oriented accommodation when travelling.',
      })
      .expect(201);
    await request(runtime.app)
      .post('/api/memories')
      .send({ category: 'Hiking', content: 'I carry a headlamp on hiking trips.' })
      .expect(201);
    await request(runtime.app)
      .post('/api/memories')
      .send({ category: 'Hiking', content: 'I carry water on hiking trips.' })
      .expect(201);
    await request(runtime.app)
      .post('/api/memories')
      .send({ category: 'Hiking', content: 'I usually carry 1 litre of water on long hikes.' })
      .expect(201);
    await request(runtime.app)
      .post('/api/memories')
      .send({
        category: 'Hiking',
        content: 'I usually carry 2 litres of water on long hikes.',
      })
      .expect(201);
    await request(runtime.app)
      .put(`/api/memories/${first.body.memory.id}`)
      .set('If-Match', first.body.etag)
      .send({
        category: 'Utazás',
        content: 'I prefer peaceful nature-oriented places to stay while travelling.',
      })
      .expect(200)
      .expect(({ body }) => expect(body.memory.priority).toBe('high'));
  });

  it('suggests a durable habit automatically but leaves it pending until approval', async () => {
    runtime = await createTestRuntime();
    runtime.provider.responses.push(
      JSON.stringify({
        kind: 'answer',
        message: 'Rendben, ezt figyelembe veszem a túrázással kapcsolatos válaszaimnál.',
        memorySuggestion: {
          category: 'Túrázás',
          content: 'A felhasználó általában fejlámpát visz túrázáskor.',
          priority: 'normal',
        },
      }),
    );
    const response = await request(runtime.app)
      .post('/api/chat')
      .send({ message: 'I usually bring a headlamp when hiking.' })
      .expect(200);
    expect(response.body.proposal).toMatchObject({
      source: 'automatic',
      action: {
        action: 'CREATE_MEMORY',
        memory: { category: 'Túrázás', priority: 'normal' },
      },
    });
    await request(runtime.app)
      .get('/api/memories')
      .expect(200)
      .expect(({ body }) => expect(body.total).toBe(0));
  });

  it('does not auto-save sensitive details even when the model suggests them', async () => {
    runtime = await createTestRuntime();
    runtime.provider.responses.push(
      JSON.stringify({
        kind: 'answer',
        message: 'Rendben.',
        memorySuggestion: {
          category: 'Private',
          content: 'A felhasználó a jelszavát megosztja a házastársával.',
        },
      }),
    );
    const response = await request(runtime.app)
      .post('/api/chat')
      .send({ message: 'I usually share my password with my spouse.' })
      .expect(200);
    expect(response.body.proposal).toBeNull();
    await request(runtime.app)
      .get('/api/memories')
      .expect(200)
      .expect(({ body }) => expect(body.total).toBe(0));
  });

  it('proposes a natural-language correction only for a retrieved memory candidate', async () => {
    runtime = await createTestRuntime();
    const saved = await request(runtime.app)
      .post('/api/memories')
      .send({ category: 'Hiking', content: 'I bring a headlamp on every hike.' })
      .expect(201);
    runtime.provider.responses.push(
      JSON.stringify({
        kind: 'proposal',
        action: {
          action: 'UPDATE_MEMORY',
          id: saved.body.memory.id,
          memory: {
            category: 'Hiking',
            content: 'I no longer bring a headlamp on hikes.',
            priority: 'normal',
          },
        },
      }),
    );
    const response = await request(runtime.app)
      .post('/api/chat')
      .send({ message: 'I no longer bring a headlamp on hikes.' })
      .expect(200);
    expect(response.body.proposal).toMatchObject({
      source: 'explicit',
      currentMemory: { id: saved.body.memory.id },
      action: { action: 'UPDATE_MEMORY', id: saved.body.memory.id },
    });
    await request(runtime.app)
      .get(`/api/memories/${saved.body.memory.id}`)
      .expect(200)
      .expect(({ body }) =>
        expect(body.memory.content).toBe('I bring a headlamp on every hike.'),
      );
  });

  it('can propose deleting an obsolete memory from a natural-language update', async () => {
    runtime = await createTestRuntime();
    const saved = await request(runtime.app)
      .post('/api/memories')
      .send({ category: 'Hiking', content: 'I keep a paper map for hiking trips.' })
      .expect(201);
    runtime.provider.responses.push(
      JSON.stringify({
        kind: 'proposal',
        action: { action: 'DELETE_MEMORY', id: saved.body.memory.id },
      }),
    );
    const response = await request(runtime.app)
      .post('/api/chat')
      .send({ message: 'I no longer keep a paper map for hiking trips.' })
      .expect(200);
    expect(response.body.proposal).toMatchObject({
      action: { action: 'DELETE_MEMORY', id: saved.body.memory.id },
      currentMemory: { content: 'I keep a paper map for hiking trips.' },
    });
    await request(runtime.app).get(`/api/memories/${saved.body.memory.id}`).expect(200);
  });

  it('deletes a memory only with the current ETag and persists the deletion', async () => {
    runtime = await createTestRuntime();
    const created = await request(runtime.app)
      .post('/api/memories')
      .send({ category: 'Home', content: 'A private detail.' })
      .expect(201);
    const id = created.body.memory.id as string;
    await request(runtime.app).delete(`/api/memories/${id}`).expect(428);
    await request(runtime.app)
      .delete(`/api/memories/${id}`)
      .set('If-Match', created.body.etag)
      .expect(204);
    await request(runtime.app)
      .get('/api/memories')
      .expect(200)
      .expect(({ body }) => expect(body.total).toBe(0));
  });

  it('uses only relevant local context and starts a new conversation after a write', async () => {
    runtime = await createTestRuntime();
    const hiking = await request(runtime.app)
      .post('/api/memories')
      .send({ category: 'Hiking', content: 'Bring a headlamp for night walks.' })
      .expect(201);
    await request(runtime.app)
      .post('/api/memories')
      .send({ category: 'Home', content: 'The old heater is noisy.' })
      .expect(201);
    runtime.provider.responses.push(
      JSON.stringify({ kind: 'answer', message: 'Pack a headlamp.' }),
    );
    const answer = await request(runtime.app)
      .post('/api/chat')
      .send({ message: 'What should I bring for a hiking trip?' })
      .expect(200);
    expect(answer.body.usedMemoryIds).toEqual([hiking.body.memory.id]);
    expect(
      runtime.provider.requests[0]?.messages.some((message) =>
        message.content.includes('old heater is noisy'),
      ),
    ).toBe(false);
    await request(runtime.app)
      .post('/api/memories')
      .send({ category: 'Hiking', content: 'Water bottles are useful.' })
      .expect(201);
    await request(runtime.app)
      .post('/api/chat')
      .send({ message: 'And this?', conversationId: answer.body.conversationId })
      .expect(410)
      .expect(({ body }) => expect(body.error.code).toBe('CHAT_EXPIRED'));
  });

  it('requires explicit user intent and a memory candidate before a model action is presented', async () => {
    runtime = await createTestRuntime();
    const saved = await request(runtime.app)
      .post('/api/memories')
      .send({ category: 'Hiking', content: 'A test memory.' })
      .expect(201);
    runtime.provider.responses.push(
      JSON.stringify({
        kind: 'proposal',
        action: { action: 'DELETE_MEMORY', id: saved.body.memory.id },
      }),
    );
    const ordinaryQuestion = await request(runtime.app)
      .post('/api/chat')
      .send({ message: 'Tell me about hiking.' })
      .expect(200);
    expect(ordinaryQuestion.body.proposal).toBeNull();
    await request(runtime.app)
      .get('/api/memories')
      .expect(200)
      .expect(({ body }) => expect(body.total).toBe(1));

    runtime.provider.responses.push(
      JSON.stringify({
        kind: 'proposal',
        action: { action: 'DELETE_MEMORY', id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
      }),
    );
    const fabricatedTarget = await request(runtime.app)
      .post('/api/chat')
      .send({ message: 'Forget my hiking memory.' })
      .expect(200);
    expect(fabricatedTarget.body.proposal).toBeNull();
    await request(runtime.app)
      .get('/api/memories')
      .expect(200)
      .expect(({ body }) => expect(body.total).toBe(1));
  });

  it('keeps CRUD available when no LLM provider is configured', async () => {
    runtime = await createTestRuntime({ provider: false });
    await request(runtime.app)
      .get('/api/settings')
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({ provider: 'none', configured: false });
      });
    await request(runtime.app)
      .post('/api/memories')
      .send({ category: 'Home', content: 'I have a garden.' })
      .expect(201);
    await request(runtime.app)
      .post('/api/chat')
      .send({ message: 'How is my garden?' })
      .expect(503)
      .expect(({ body }) => expect(body.error.code).toBe('CHAT_UNAVAILABLE'));
  });

  it('does not accept a slow chat result after a memory update', async () => {
    runtime = await createTestRuntime();
    let release!: (value: string) => void;
    const pending = new Promise<string>((resolve) => {
      release = resolve;
    });
    runtime.provider.responder = async () => pending;
    const chatRequest = request(runtime.app)
      .post('/api/chat')
      .send({ message: 'What do you remember?' })
      .then((response) => response);
    while (runtime.provider.requests.length === 0)
      await new Promise((resolve) => setTimeout(resolve, 1));
    await request(runtime.app)
      .post('/api/memories')
      .send({ category: 'Home', content: 'Changed while the chat waited.' })
      .expect(201);
    release(JSON.stringify({ kind: 'answer', message: 'This answer must be discarded.' }));
    const chatResponse = await chatRequest;
    expect(chatResponse.status).toBe(409);
    expect(chatResponse.body.error.code).toBe('CHAT_CONTEXT_CHANGED');
  });
});
