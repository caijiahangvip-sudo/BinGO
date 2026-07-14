import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  if (process.env.BINGO_DESKTOP !== '1') {
    return NextResponse.json({ ok: true, desktop: false });
  }

  const expected = process.env.BINGO_DESKTOP_TOKEN;
  const authorization = request.headers.get('authorization');
  if (!expected || authorization !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true, desktop: true });
  response.cookies.set('bingo_desktop_session', expected, {
    httpOnly: true,
    sameSite: 'strict',
    secure: false,
    path: '/',
  });
  return response;
}
