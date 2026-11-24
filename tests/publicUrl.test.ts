import { publicApiUrl } from '../src/utils/publicUrl';
import { env } from '../src/config/env';

describe('the public API address used for email images', () => {
  const keep = { api: env.PUBLIC_API_URL, front: env.FRONTEND_URL, render: process.env.RENDER_EXTERNAL_URL, envApi: process.env.PUBLIC_API_URL, envFront: process.env.FRONTEND_URL };
  afterEach(() => {
    (env as any).PUBLIC_API_URL = keep.api; (env as any).FRONTEND_URL = keep.front;
    if (keep.render === undefined) delete process.env.RENDER_EXTERNAL_URL; else process.env.RENDER_EXTERNAL_URL = keep.render;
    if (keep.envApi === undefined) delete process.env.PUBLIC_API_URL; else process.env.PUBLIC_API_URL = keep.envApi;
    if (keep.envFront === undefined) delete process.env.FRONTEND_URL; else process.env.FRONTEND_URL = keep.envFront;
  });
  const set = (api: string | undefined, front: string) => { (env as any).PUBLIC_API_URL = api; (env as any).FRONTEND_URL = front; delete process.env.PUBLIC_API_URL; delete process.env.RENDER_EXTERNAL_URL; process.env.FRONTEND_URL = front; };
  it('uses the explicit setting first, then api. in front of the website domain, never for local addresses', () => {
    set('https://api.example.org/', 'https://eventqrapp.com');
    expect(publicApiUrl()).toBe('https://api.example.org');
    set(undefined, 'https://www.eventqrapp.com');
    expect(publicApiUrl()).toBe('https://api.eventqrapp.com');
    set(undefined, 'http://localhost:3000');
    expect(publicApiUrl()).toBeNull();
    set(undefined, 'http://eventqrapp.com');
    expect(publicApiUrl()).toBeNull();
  });
});
