import { NextRequest, NextResponse } from 'next/server';

export function proxy(request: NextRequest) {
  if (process.env.BINGO_DESKTOP !== '1' || !request.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.next();
  }
  if (request.nextUrl.pathname === '/api/desktop/session') return NextResponse.next();

  const expected = process.env.BINGO_DESKTOP_TOKEN;
  const bearer = request.headers.get('authorization');
  const session = request.cookies.get('bingo_desktop_session')?.value;
  if (expected && (bearer === `Bearer ${expected}` || session === expected)) {
    return NextResponse.next();
  }
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

export const config = {
  matcher: '/api/:path*',
};
