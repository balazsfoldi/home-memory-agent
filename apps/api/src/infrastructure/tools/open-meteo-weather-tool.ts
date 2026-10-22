import { z } from 'zod';
import {
  defineAgentTool,
  type AgentToolDefinition,
} from '../../application/agent-tool-registry.js';

const weatherInputSchema = z
  .object({
    location: z.string().trim().min(2).max(100),
    days: z.number().int().min(1).max(7).default(1),
  })
  .strict();

const geocodingResponseSchema = z
  .object({
    results: z
      .array(
        z.object({
          name: z.string(),
          latitude: z.number().finite(),
          longitude: z.number().finite(),
          country: z.string().optional(),
          timezone: z.string().optional(),
        }),
      )
      .optional(),
  })
  .passthrough();

const forecastResponseSchema = z
  .object({
    timezone: z.string().optional(),
    daily: z.object({
      time: z.array(z.string()),
      weather_code: z.array(z.number().finite().nullable()).optional(),
      temperature_2m_min: z.array(z.number().finite().nullable()).optional(),
      temperature_2m_max: z.array(z.number().finite().nullable()).optional(),
      precipitation_probability_max: z.array(z.number().finite().nullable()).optional(),
    }),
  })
  .passthrough();

function describeWeatherCode(code: number | null | undefined): string {
  if (code === null || code === undefined) return 'unknown conditions';
  if (code === 0) return 'clear sky';
  if ([1, 2, 3].includes(code)) return 'partly cloudy or overcast';
  if ([45, 48].includes(code)) return 'fog';
  if ([51, 53, 55, 56, 57].includes(code)) return 'drizzle';
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return 'rain or showers';
  if ([71, 73, 75, 77, 85, 86].includes(code)) return 'snow';
  if ([95, 96, 99].includes(code)) return 'thunderstorm';
  return 'variable conditions';
}

async function getJson(url: URL, fetcher: typeof fetch): Promise<unknown> {
  const response = await fetcher(url, { signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new Error('Weather service returned an error.');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Weather response body is missing.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 100_000) {
        await reader.cancel();
        throw new Error('Weather response is too large.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}

export function createOpenMeteoWeatherTool(
  fetcher: typeof fetch = fetch,
): AgentToolDefinition {
  return defineAgentTool({
    name: 'weather.getForecast',
    description:
      'Get a short weather forecast for a named place. The place name is sent to Open-Meteo.',
    inputExample: { location: 'Budapest, Hungary', days: 2 },
    inputSchema: weatherInputSchema,
    async execute(input) {
      const geocodingUrl = new URL('https://geocoding-api.open-meteo.com/v1/search');
      geocodingUrl.searchParams.set('name', input.location);
      geocodingUrl.searchParams.set('count', '1');
      geocodingUrl.searchParams.set('language', 'en');
      geocodingUrl.searchParams.set('format', 'json');
      const geocoding = geocodingResponseSchema.parse(await getJson(geocodingUrl, fetcher));
      const location = geocoding.results?.[0];
      if (!location) return { location: input.location, found: false };

      const forecastUrl = new URL('https://api.open-meteo.com/v1/forecast');
      forecastUrl.searchParams.set('latitude', String(location.latitude));
      forecastUrl.searchParams.set('longitude', String(location.longitude));
      forecastUrl.searchParams.set(
        'daily',
        'weather_code,temperature_2m_min,temperature_2m_max,precipitation_probability_max',
      );
      forecastUrl.searchParams.set('forecast_days', String(input.days));
      forecastUrl.searchParams.set('timezone', 'auto');
      forecastUrl.searchParams.set('temperature_unit', 'celsius');
      const forecast = forecastResponseSchema.parse(await getJson(forecastUrl, fetcher));
      const daily = forecast.daily;
      return {
        location: location.name,
        country: location.country ?? null,
        timezone: forecast.timezone ?? location.timezone ?? null,
        source: 'Open-Meteo',
        forecast: daily.time.map((date, index) => ({
          date,
          conditions: describeWeatherCode(daily.weather_code?.[index]),
          minimumC: daily.temperature_2m_min?.[index] ?? null,
          maximumC: daily.temperature_2m_max?.[index] ?? null,
          precipitationProbabilityPercent:
            daily.precipitation_probability_max?.[index] ?? null,
        })),
      };
    },
  });
}
