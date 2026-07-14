import { afterEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';

import { POST } from '@/app/api/desktop/session/route';
import { proxy } from '@/proxy';

const originalDesktop = process.env.BINGO_DESKTOP;
const originalToken = process.env.BINGO_DESKTOP_TOKEN;

afterEach(() => {
  process.env.BINGO_DESKTOP = originalDesktop;
  process.env.BINGO_DESKTOP_TOKEN = originalToken;
});

describe('desktop API session authentication', () => {
  it('allows browser development mode without desktop authentication', async () => {
    delete process.env.BINGO_DESKTOP;
    delete process.env.BINGO_DESKTOP_TOKEN;

    const response = proxy(new NextRequest('http://127.0.0.1:4000/api/health'));
    expect(response.status).toBe(200);

    const sessionResponse = await POST(new Request('http://127.0.0.1/api/desktop/session'));
    expect(await sessionResponse.json()).toEqual({ ok: true, desktop: false });
  });

  it('rejects unauthenticated desktop API requests', () => {
    process.env.BINGO_DESKTOP = '1';
    process.env.BINGO_DESKTOP_TOKEN = 'desktop-token';

    const response = proxy(new NextRequest('http://127.0.0.1:4000/api/health'));
    expect(response.status).toBe(401);
  });

  it('accepts the runtime bearer token and session cookie', () => {
    process.env.BINGO_DESKTOP = '1';
    process.env.BINGO_DESKTOP_TOKEN = 'desktop-token';

    const bearerResponse = proxy(
      new NextRequest('http://127.0.0.1:4000/api/health', {
        headers: { Authorization: 'Bearer desktop-token' },
      }),
    );
    const cookieResponse = proxy(
      new NextRequest('http://127.0.0.1:4000/api/health', {
        headers: { Cookie: 'bingo_desktop_session=desktop-token' },
      }),
    );

    expect(bearerResponse.status).toBe(200);
    expect(cookieResponse.status).toBe(200);
  });

  it('exchanges the bearer token for a strict HttpOnly cookie', async () => {
    process.env.BINGO_DESKTOP = '1';
    process.env.BINGO_DESKTOP_TOKEN = 'desktop-token';

    const unauthorized = await POST(new Request('http://127.0.0.1/api/desktop/session'));
    expect(unauthorized.status).toBe(401);

    const response = await POST(
      new Request('http://127.0.0.1/api/desktop/session', {
        method: 'POST',
        headers: { Authorization: 'Bearer desktop-token' },
      }),
    );
    const cookie = response.headers.get('set-cookie') || '';

    expect(response.status).toBe(200);
    expect(cookie).toContain('bingo_desktop_session=desktop-token');
    expect(cookie.toLowerCase()).toContain('httponly');
    expect(cookie.toLowerCase()).toContain('samesite=strict');
  });
});
