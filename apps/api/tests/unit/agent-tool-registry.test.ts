import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  AgentToolRegistry,
  defineAgentTool,
} from '../../src/application/agent-tool-registry.js';

describe('agent tool registry', () => {
  it('exposes and runs only explicitly enabled operations', async () => {
    const execute = vi.fn(async (input: { value: string }) => ({ value: input.value }));
    const registry = new AgentToolRegistry(
      [
        defineAgentTool({
          name: 'notes.search',
          description: 'Search local notes.',
          inputExample: { query: 'hiking' },
          inputSchema: z.object({ value: z.string() }).strict(),
          execute,
        }),
      ],
      [],
    );

    expect(registry.listEnabled()).toEqual([]);
    await expect(
      registry.execute('notes.search', { value: 'private' }),
    ).resolves.toMatchObject({
      enabled: false,
      ok: false,
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('validates tool input and bounds output size', async () => {
    const registry = new AgentToolRegistry(
      [
        defineAgentTool({
          name: 'notes.search',
          description: 'Search local notes.',
          inputExample: { query: 'hiking' },
          inputSchema: z.object({ value: z.string() }).strict(),
          execute: async (input) => ({ value: input.value, padding: 'x'.repeat(13_000) }),
        }),
      ],
      ['notes.search'],
    );

    await expect(registry.execute('notes.search', { value: 1 })).resolves.toMatchObject({
      enabled: true,
      ok: false,
      error: 'The tool input is invalid.',
    });
    await expect(registry.execute('notes.search', { value: 'ok' })).resolves.toMatchObject({
      enabled: true,
      ok: false,
      error: 'The tool result is too large.',
    });
  });
});
