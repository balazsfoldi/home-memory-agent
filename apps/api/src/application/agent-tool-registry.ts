import type { z } from 'zod';
import type { AgentToolName } from '@home-memory/shared';

export interface AgentToolDefinition {
  name: AgentToolName;
  description: string;
  inputExample: Record<string, unknown>;
  inputSchema: z.ZodType;
  execute(input: unknown): Promise<unknown>;
}

export interface AgentToolDescriptor {
  name: AgentToolName;
  description: string;
  inputExample: Record<string, unknown>;
}

export interface AgentToolResult {
  name: AgentToolName;
  enabled: boolean;
  ok: boolean;
  result?: unknown;
  error?: string;
}

export function defineAgentTool<T>(definition: {
  name: AgentToolName;
  description: string;
  inputExample: Record<string, unknown>;
  inputSchema: z.ZodType<T>;
  execute(input: T): Promise<unknown>;
}): AgentToolDefinition {
  return {
    name: definition.name,
    description: definition.description,
    inputExample: definition.inputExample,
    inputSchema: definition.inputSchema,
    execute: (input) => definition.execute(definition.inputSchema.parse(input)),
  };
}

export class AgentToolRegistry {
  private readonly definitions: Map<AgentToolName, AgentToolDefinition>;
  private readonly enabled: Set<AgentToolName>;

  constructor(definitions: AgentToolDefinition[], enabledNames: AgentToolName[]) {
    this.definitions = new Map(definitions.map((definition) => [definition.name, definition]));
    this.enabled = new Set(enabledNames.filter((name) => this.definitions.has(name)));
  }

  listEnabled(): AgentToolDescriptor[] {
    return [...this.enabled].flatMap((name) => {
      const definition = this.definitions.get(name);
      return definition
        ? [
            {
              name,
              description: definition.description,
              inputExample: definition.inputExample,
            },
          ]
        : [];
    });
  }

  async execute(name: AgentToolName, input: unknown): Promise<AgentToolResult> {
    const definition = this.definitions.get(name);
    if (!definition || !this.enabled.has(name))
      return { name, enabled: false, ok: false, error: 'This operation is not enabled.' };

    const parsed = definition.inputSchema.safeParse(input);
    if (!parsed.success)
      return { name, enabled: true, ok: false, error: 'The tool input is invalid.' };

    try {
      const result = await definition.execute(parsed.data);
      const serialized = JSON.stringify(result);
      if (!serialized || serialized.length > 12_000)
        return { name, enabled: true, ok: false, error: 'The tool result is too large.' };
      return { name, enabled: true, ok: true, result };
    } catch {
      return { name, enabled: true, ok: false, error: 'The tool is temporarily unavailable.' };
    }
  }
}
