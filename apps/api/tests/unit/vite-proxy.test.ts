import { describe, expect, it } from 'vitest';
import config from '../../../web/vite.config.js';

describe('Vite API proxy', () => {
  it('preserves the browser host for the API origin check', () => {
    expect(config.server?.proxy?.['/api']).toEqual({
      target: 'http://127.0.0.1:3000',
      changeOrigin: false,
    });
  });
});
