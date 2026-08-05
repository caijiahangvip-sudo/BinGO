import { NextRequest, NextResponse } from 'next/server';

function getAllowedOrigins(): string[] {
  return (process.env.BINGO_CORS_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function applyApiCors(response: NextResponse, origin: string | null): NextResponse {
  const allowedOrigins = getAllowedOrigins();
  if (origin && (allowedOrigins.includes('*') || allowedOrigins.includes(origin))) {
    response.headers.set('Access-Control-Allow-Origin', origin);
    response.headers.set('Vary', 'Origin');
  }
  response.headers.set('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  response.headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  response.headers.set('Access-Control-Max-Age', '600');
  return response;
}

export function proxy(request: NextRequest) {
  if (!request.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  const origin = request.headers.get('origin');
  if (request.method === 'OPTIONS') {
    return applyApiCors(new NextResponse(null, { status: 204 }), origin);
  }

  if (process.env.BINGO_API_MODE === 'cloud') {
    const expected = process.env.BINGO_API_TOKEN;
    const bearer = request.headers.get('authorization');
    if (expected && bearer !== `Bearer ${expected}`) {
      return applyApiCors(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), origin);
    }
    return applyApiCors(NextResponse.next(), origin);
  }

  if (process.env.BINGO_DESKTOP !== '1') {
    return NextResponse.next();
  }
  if (request.nextUrl.pathname === '/api/desktop/session') return NextResponse.next();

  const expected = process.env.BINGO_DESKTOP_TOKEN;
  const bearer = request.headers.get('authorization');
  const session = request.cookies.get('bingo_desktop_session')?.value;
  if (expected && (bearer === `Bearer ${expected}` || session === expected)) {
    return applyApiCors(NextResponse.next(), origin);
  }
  return applyApiCors(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), origin);
}

export const config = {
  matcher: '/api/:path*',
};
