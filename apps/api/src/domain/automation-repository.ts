import type {
  Automation,
  AutomationNotification,
  AutomationRun,
  AutomationTrigger,
  CreateAutomationInput,
} from '@home-memory/shared';

export interface AutomationRepository {
  initialize(): Promise<void>;
  close(): Promise<void>;
  list(): Promise<Automation[]>;
  findById(id: string): Promise<Automation | null>;
  create(input: CreateAutomationInput): Promise<Automation>;
  setStatus(id: string, status: 'active' | 'paused'): Promise<Automation>;
  delete(id: string): Promise<void>;
  listRuns(automationId: string): Promise<AutomationRun[]>;
  listNotifications(): Promise<{ items: AutomationNotification[]; unread: number }>;
  markNotificationRead(id: string): Promise<AutomationNotification>;
  queueManual(automationId: string): Promise<AutomationRun>;
  enqueueEvent(type: 'memory.created' | 'memory.updated', eventKey: string): Promise<void>;
  enqueueDue(now: Date): Promise<void>;
  claimNextRun(now: Date): Promise<AutomationRun | null>;
  completeRun(runId: string, result: string, finishedAt: Date): Promise<void>;
  failRun(runId: string, finishedAt: Date): Promise<{ retryAt: Date | null }>;
  hasActiveRun(automationId: string): Promise<boolean>;
}

export type AutomationEvent = {
  type: 'memory.created' | 'memory.updated';
  memoryId: string;
  occurredAt: string;
};

export type AutomationExecutionContext = {
  automation: Automation;
  run: AutomationRun;
};

export type AutomationExecutor = (context: AutomationExecutionContext) => Promise<string>;

export type AutomationTriggerType = AutomationTrigger['type'] | 'manual';
