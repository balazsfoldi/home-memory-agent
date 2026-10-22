import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createIcsCalendarTool,
  parseCalendarEvents,
} from '../../src/infrastructure/tools/ics-calendar-tool.js';
import { createOpenMeteoWeatherTool } from '../../src/infrastructure/tools/open-meteo-weather-tool.js';

let temporaryDirectory: string | undefined;
afterEach(async () => {
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
  temporaryDirectory = undefined;
});

describe('agent tool adapters', () => {
  it('gets a bounded forecast from fixed Open-Meteo endpoints', async () => {
    const fetcher = vi.fn<typeof fetch>();
    fetcher
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            results: [
              {
                name: 'Budapest',
                country: 'Hungary',
                latitude: 47.5,
                longitude: 19.0,
                timezone: 'Europe/Budapest',
              },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            timezone: 'Europe/Budapest',
            daily: {
              time: ['2026-10-22'],
              weather_code: [61],
              temperature_2m_min: [8],
              temperature_2m_max: [14],
              precipitation_probability_max: [70],
            },
          }),
          { status: 200 },
        ),
      );
    const tool = createOpenMeteoWeatherTool(fetcher);

    await expect(tool.execute({ location: 'Budapest', days: 1 })).resolves.toMatchObject({
      location: 'Budapest',
      country: 'Hungary',
      source: 'Open-Meteo',
      forecast: [
        {
          conditions: 'rain or showers',
          minimumC: 8,
          maximumC: 14,
          precipitationProbabilityPercent: 70,
        },
      ],
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(String(fetcher.mock.calls[0]?.[0])).toContain('geocoding-api.open-meteo.com');
    expect(String(fetcher.mock.calls[1]?.[0])).toContain('api.open-meteo.com/v1/forecast');
  });

  it('parses folded calendar text and filters local events by date range', async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'home-memory-calendar-'));
    await writeFile(
      path.join(temporaryDirectory, 'calendar.ics'),
      [
        'BEGIN:VCALENDAR',
        'BEGIN:VEVENT',
        'UID:event-1',
        'DTSTART;TZID=Europe/Budapest:20261024T090000',
        'DTEND;TZID=Europe/Budapest:20261024T100000',
        'SUMMARY:Weekend hike',
        'DESCRIPTION:Bring water\\nand a jacket',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'UID:event-2',
        'DTSTART;VALUE=DATE:20261101',
        'SUMMARY:Family lunch',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n'),
    );

    const tool = createIcsCalendarTool(temporaryDirectory);
    await expect(
      tool.execute({ from: '2026-10-24', to: '2026-10-24' }),
    ).resolves.toMatchObject({
      events: [
        {
          summary: 'Weekend hike',
          startsAt: '2026-10-24T09:00:00',
          timeZone: 'Europe/Budapest',
          description: 'Bring water\nand a jacket',
        },
      ],
      source: 'local calendar.ics',
    });
  });

  it('decodes escaped values, keeps timezone metadata, and marks recurrence rules', () => {
    const events = parseCalendarEvents(
      [
        'BEGIN:VEVENT',
        'DTSTART;TZID=Europe/Budapest:20261024T090000',
        'RRULE:FREQ=WEEKLY',
        'SUMMARY:Trip\\, with friends',
        'END:VEVENT',
      ].join('\n'),
    );
    expect(events).toEqual([
      expect.objectContaining({
        summary: 'Trip, with friends',
        timeZone: 'Europe/Budapest',
        recurring: true,
      }),
    ]);
  });
});
