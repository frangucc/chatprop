import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || !Array.isArray(body.symbols)) {
      return NextResponse.json({ error: 'Body must be { symbols: string[] }' }, { status: 400 });
    }

    const upstreamUrl = 'http://localhost:7878/subscribe';

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const res = await fetch(upstreamUrl, {
      method: 'POST',
      signal: controller.signal,
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ symbols: body.symbols })
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return NextResponse.json({ error: 'Upstream error', status: res.status, body: text }, { status: 502 });
    }

    const data = await res.json();
    return NextResponse.json(data, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  } catch (err: any) {
    const isAbort = err?.name === 'AbortError';
    return NextResponse.json({ error: isAbort ? 'Upstream timeout' : 'Proxy failure' }, { status: 504 });
  }
}
