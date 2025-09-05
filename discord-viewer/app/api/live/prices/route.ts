import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const symbols = searchParams.get('symbols') || '';

    if (!symbols) {
      return NextResponse.json({ error: 'Missing symbols query param' }, { status: 400 });
    }

    // Forward as-is (already encoded by client). Double-encoding breaks comma separation.
    const upstreamUrl = `http://localhost:7878/api/live/prices?symbols=${symbols}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const res = await fetch(upstreamUrl, {
      method: 'GET',
      signal: controller.signal,
      // Prevent Next from caching
      cache: 'no-store',
      headers: {
        'Accept': 'application/json'
      }
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return NextResponse.json({ error: 'Upstream error', status: res.status, body: text }, { status: 502 });
    }

    const data = await res.json();

    // Transform upstream map to array, and include requested-but-missing symbols with nulls
    const requested = symbols.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
    const upstreamEntries: Array<{symbol: string, price: number | null, ts_event_ns: number | null}> = Object
      .entries(data)
      .map(([symbol, priceData]: [string, any]) => ({
        symbol,
        price: priceData?.price ?? null,
        ts_event_ns: priceData?.ts_event_ns ?? null
      }));
    const presentSet = new Set(upstreamEntries.map(e => e.symbol.toUpperCase()));
    const missingEntries = requested
      .filter(sym => !presentSet.has(sym))
      .map(sym => ({ symbol: sym, price: null as number | null, ts_event_ns: null as number | null }));
    const transformed = [...upstreamEntries, ...missingEntries];

    return NextResponse.json(transformed, {
      status: 200,
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate'
      }
    });
  } catch (err: any) {
    const isAbort = err?.name === 'AbortError';
    return NextResponse.json({ error: isAbort ? 'Upstream timeout' : 'Proxy failure' }, { status: 504 });
  }
}
