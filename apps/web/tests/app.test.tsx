import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from '../src/App.js';

const memory = {
  id: '11111111-1111-4111-8111-111111111111',
  category: 'Utazás',
  content: 'Csendes, természetközeli szállásokat keresek.',
  priority: 'normal' as const,
  createdAt: '2026-10-21T18:00:00.000Z',
  updatedAt: '2026-10-21T18:00:00.000Z',
};

describe('Home Memory web interface', () => {
  let memories: (typeof memory)[];
  let configured: boolean;
  const fetcher = vi.fn<typeof fetch>();

  beforeEach(() => {
    memories = [];
    configured = false;
    fetcher.mockReset().mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === '/api/settings') {
        return new Response(
          JSON.stringify({
            provider: configured ? 'openai-compatible' : 'none',
            model: configured ? 'fixture-model' : '',
            configured,
            structuredProposals: false,
            externalDataNotice: 'A memóriákat helyben kezeled.',
          }),
          { status: 200 },
        );
      }
      if (url.startsWith('/api/memories') && (!init?.method || init.method === 'GET')) {
        const query = new URL(url, 'http://local').searchParams.get('q')?.toLowerCase();
        const items = query
          ? memories.filter((item) =>
              `${item.category} ${item.content}`.toLowerCase().includes(query),
            )
          : memories;
        return new Response(
          JSON.stringify({
            items: items.map((item) => ({
              memory: item,
              etag: '"sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"',
            })),
            total: items.length,
          }),
          { status: 200 },
        );
      }
      if (url === '/api/memories' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as {
          category: string;
          content: string;
          priority: 'low' | 'normal' | 'high';
        };
        const created = {
          ...memory,
          category: body.category,
          content: body.content,
          priority: body.priority,
          id: '11111111-1111-4111-8111-111111111111',
        };
        memories = [created];
        return new Response(
          JSON.stringify({
            memory: created,
            etag: '"sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"',
          }),
          { status: 201 },
        );
      }
      if (url === '/api/chat' && init?.method === 'POST') {
        return new Response(
          JSON.stringify({
            message: 'Ezt szívesen megjegyzem.',
            conversationId: 'conversation-123456',
            usedMemoryIds: [],
            proposal: {
              action: {
                action: 'CREATE_MEMORY',
                memory: {
                  category: 'Utazás',
                  content: 'Csendes helyeket szeretek.',
                  priority: 'normal',
                },
              },
              currentMemory: null,
              etag: null,
              source: 'automatic',
            },
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          error: {
            code: 'REQUEST_FAILED',
            message: 'Unexpected test request.',
            requestId: 'test',
          },
        }),
        { status: 404 },
      );
    });
    vi.stubGlobal('fetch', fetcher);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('creates and lists a memory through the accessible memory form', async () => {
    render(<App />);
    expect(
      await screen.findByRole('heading', { name: 'Emlékszem, ami fontos.' }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Emlékeim/u }));
    expect(await screen.findByRole('heading', { name: /Memóriák/u })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Új emlék' }));

    fireEvent.change(screen.getByLabelText('Kategória'), { target: { value: 'Utazás' } });
    fireEvent.change(screen.getByLabelText('Mi legyen az emlék?'), {
      target: { value: memory.content },
    });
    fireEvent.click(screen.getByRole('button', { name: /Emlék mentése/u }));

    await waitFor(() => expect(screen.getByRole('article')).toHaveTextContent(memory.content));
    expect(await screen.findByRole('status')).toHaveTextContent('elmentettük az emléket');
    expect(
      fetcher.mock.calls.some(
        ([input, init]) => String(input) === '/api/memories' && init?.method === 'POST',
      ),
    ).toBe(true);
  });

  it('explains that the memory list works while the assistant awaits a provider', async () => {
    render(<App />);
    expect(await screen.findByText('Az asszisztens beállításra vár')).toBeInTheDocument();
    const send = screen.getByRole('button', { name: 'Üzenet küldése' });
    expect(send).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /Beállítások/u }));
    expect(
      await screen.findByRole('heading', { name: 'A saját tárhelyeden.' }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText('API-kulcs nem kerül a böngészőbe.', { exact: false }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/API.kulcs|API key/u)).not.toBeInTheDocument();
  });

  it('displays stored content as text and supports search', async () => {
    memories = [memory];
    render(<App />);
    await screen.findByRole('heading', { name: 'Emlékszem, ami fontos.' });
    fireEvent.click(screen.getByRole('button', { name: /Emlékeim/u }));
    expect(await screen.findByText(memory.content)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Keresés az emlékek között'), {
      target: { value: 'tengerpart' },
    });
    await waitFor(() =>
      expect(screen.getByText('Nem találtam egyező emléket.')).toBeInTheDocument(),
    );
  });

  it('lets the user edit an automatic memory suggestion before approving it', async () => {
    configured = true;
    render(<App />);
    fireEvent.change(await screen.findByLabelText('Üzenet az asszisztensnek'), {
      target: { value: 'I usually like quiet places when travelling.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Üzenet küldése' }));
    expect(
      await screen.findByText('Automatikus emlékötlet', { exact: false }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Javaslat szerkesztése' }));
    fireEvent.change(screen.getByLabelText('Javasolt emlék'), {
      target: { value: 'Utazáskor csendes, természetközeli helyeket keresek.' },
    });
    fireEvent.change(screen.getByLabelText('Prioritás'), { target: { value: 'high' } });
    fireEvent.click(screen.getByRole('button', { name: 'Módosítás alkalmazása' }));
    fireEvent.click(screen.getByRole('button', { name: 'Jóváhagyom' }));
    await screen.findByText(/A régi beszélgetési előzményt töröltük/u);
    const createRequest = fetcher.mock.calls.find(
      ([input, init]) => String(input) === '/api/memories' && init?.method === 'POST',
    );
    expect(JSON.parse(String(createRequest?.[1]?.body))).toMatchObject({
      category: 'Utazás',
      content: 'Utazáskor csendes, természetközeli helyeket keresek.',
      priority: 'high',
    });
  });
});
