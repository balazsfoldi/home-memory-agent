import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import {
  defineAgentTool,
  type AgentToolDefinition,
} from '../../application/agent-tool-registry.js';

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const calendarInputSchema = z
  .object({ from: dateSchema.optional(), to: dateSchema.optional() })
  .strict();

interface IcsProperty {
  value: string;
  parameters: Map<string, string>;
}

interface CalendarEvent {
  id: string;
  summary: string;
  startsAt: string;
  endsAt: string | null;
  timeZone: string | null;
  allDay: boolean;
  location: string | null;
  description: string | null;
  recurring: boolean;
}

function unfold(content: string): string[] {
  const lines: string[] = [];
  for (const line of content.replace(/\r\n?/gu, '\n').split('\n')) {
    if (/^[ \t]/u.test(line) && lines.length) {
      lines[lines.length - 1] = `${lines.at(-1) ?? ''}${line.slice(1)}`;
    } else if (line) {
      lines.push(line);
    }
  }
  return lines;
}

function property(line: string): { name: string; property: IcsProperty } | null {
  const colon = line.indexOf(':');
  if (colon < 1) return null;
  const [name = '', ...parameterParts] = line.slice(0, colon).split(';');
  const parameters = new Map<string, string>();
  for (const part of parameterParts) {
    const equals = part.indexOf('=');
    if (equals > 0)
      parameters.set(
        part.slice(0, equals).toUpperCase(),
        part.slice(equals + 1).replace(/^"|"$/gu, ''),
      );
  }
  return { name: name.toUpperCase(), property: { value: line.slice(colon + 1), parameters } };
}

function textValue(value: string): string {
  return value
    .replace(/\\[nN]/gu, '\n')
    .replace(/\\([\\,;])/gu, '$1')
    .trim();
}

function formatIcsDate(value: string): string | null {
  if (/^\d{8}$/u.test(value)) {
    const date = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
    return validDate(date) ? date : null;
  }
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/u.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute, second, utc] = match;
  const date = `${year}-${month}-${day}`;
  if (!validDate(date) || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59)
    return null;
  return `${year}-${month}-${day}T${hour}:${minute}:${second}${utc ? 'Z' : ''}`;
}

function parseEvent(lines: string[]): CalendarEvent | null {
  const values = new Map<string, IcsProperty>();
  for (const line of lines) {
    const entry = property(line);
    if (entry) values.set(entry.name, entry.property);
  }
  if (values.get('STATUS')?.value.toUpperCase() === 'CANCELLED') return null;
  const start = values.get('DTSTART');
  if (!start) return null;
  const startsAt = formatIcsDate(start.value);
  if (!startsAt) return null;
  const end = values.get('DTEND');
  const endsAt = end ? formatIcsDate(end.value) : null;
  const uid = values.get('UID')?.value;
  const summary = textValue(values.get('SUMMARY')?.value ?? 'Untitled event').slice(0, 160);
  return {
    id: uid?.slice(0, 200) ?? createHash('sha256').update(lines.join('\n')).digest('hex'),
    summary,
    startsAt,
    endsAt,
    timeZone: start.parameters.get('TZID') ?? null,
    allDay: start.parameters.get('VALUE') === 'DATE' || /^\d{8}$/u.test(start.value),
    location: values.has('LOCATION')
      ? textValue(values.get('LOCATION')?.value ?? '').slice(0, 120)
      : null,
    description: values.has('DESCRIPTION')
      ? textValue(values.get('DESCRIPTION')?.value ?? '').slice(0, 240)
      : null,
    recurring: values.has('RRULE'),
  };
}

export function parseCalendarEvents(content: string): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  let current: string[] | undefined;
  for (const line of unfold(content)) {
    if (line.toUpperCase() === 'BEGIN:VEVENT') {
      current = [];
    } else if (line.toUpperCase() === 'END:VEVENT' && current) {
      const event = parseEvent(current);
      if (event) events.push(event);
      current = undefined;
    } else if (current) {
      current.push(line);
    }
    if (events.length >= 2_000) break;
  }
  return events;
}

function shiftDate(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function validDate(date: string): boolean {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().startsWith(date);
}

export function createIcsCalendarTool(dataDirectory: string): AgentToolDefinition {
  return defineAgentTool({
    name: 'calendar.getEvents',
    description:
      'Read events from the local data/calendar.ics iCalendar file for a date range. Recurring rules are reported but not expanded.',
    inputExample: { from: '2026-10-22', to: '2026-10-29' },
    inputSchema: calendarInputSchema,
    async execute(input) {
      const today = new Date().toISOString().slice(0, 10);
      const from = input.from ?? today;
      if (!validDate(from)) throw new Error('Invalid calendar range.');
      const to = input.to ?? shiftDate(from, 7);
      if (!validDate(to) || to < from || to > shiftDate(from, 30))
        throw new Error('Invalid calendar range.');

      const filePath = path.resolve(dataDirectory, 'calendar.ics');
      let content: string;
      try {
        const fileStat = await lstat(filePath);
        if (!fileStat.isFile() || fileStat.isSymbolicLink() || fileStat.size > 1_000_000)
          throw new Error('Calendar file is not a supported local file.');
        content = await readFile(filePath, 'utf8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT')
          return {
            events: [],
            source: 'local calendar.ics',
            message: 'No local calendar file was found.',
          };
        throw error;
      }

      const events = parseCalendarEvents(content)
        .filter((event) => {
          const eventStart = event.startsAt.slice(0, 10);
          const eventEnd = (event.endsAt ?? event.startsAt).slice(0, 10);
          return (
            eventStart <= to &&
            (event.allDay
              ? event.endsAt
                ? eventEnd > from
                : eventStart >= from
              : eventEnd >= from)
          );
        })
        .sort((left, right) => left.startsAt.localeCompare(right.startsAt))
        .slice(0, 15);
      return {
        events: events.map(
          ({
            summary,
            startsAt,
            endsAt,
            timeZone,
            allDay,
            location,
            description,
            recurring,
          }) => ({
            summary,
            startsAt,
            endsAt,
            timeZone,
            allDay,
            location,
            description,
            recurring,
          }),
        ),
        source: 'local calendar.ics',
        range: { from, to },
      };
    },
  });
}
