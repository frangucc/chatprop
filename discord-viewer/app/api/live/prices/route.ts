import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const symbols = searchParams.get('symbols') || '';

    if (!symbols) {
      return NextResponse.json({ error: 'Missing symbols query param' }, { status: 400 });
    }

    const upstreamUrl = `http://localhost:7878/api/live/prices?symbols=${encodeURIComponent(symbols)}`;

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

    // Transform the response from map format to array format
    // Input: { "SYMBOL": { "price": 1.23, "ts_event_ns": 123456 }, ... }
    // Output: [ { "symbol": "SYMBOL", "price": 1.23, "ts_event_ns": 123456 }, ... ]
    const transformed = Object.entries(data).map(([symbol, priceData]: [string, any]) => ({
      symbol,
      price: priceData?.price ?? null,
      ts_event_ns: priceData?.ts_event_ns ?? null
    }));

    // Finnhub fallback for missing symbols (same-day real-time)
    const requested = symbols.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
    const presentSet = new Set(transformed.map(t => t.symbol.toUpperCase()));
    const missing = requested.filter(s => !presentSet.has(s));

    const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY;
    if (missing.length > 0 && FINNHUB_API_KEY) {
      // Fetch quotes sequentially with short delay to avoid rate limits
      const delay = (ms: number) => new Promise(res => setTimeout(res, ms));
      for (let i = 0; i < missing.length; i++) {
        const sym = missing[i];
        try {
          const q = await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(sym)}&token=${FINNHUB_API_KEY}`, {
            cache: 'no-store',
            headers: { 'Accept': 'application/json' }
          });
          if (q.ok) {
            const jq = await q.json();
            const price = typeof jq.c === 'number' && jq.c > 0 ? jq.c : null;
            const tSec = typeof jq.t === 'number' ? jq.t : null;
            transformed.push({
              symbol: sym,
              price,
              ts_event_ns: tSec ? tSec * 1_000_000_000 : null
            });
          }
        } catch (_) {
          // ignore failures, keep missing as absent
        }
        // small pause between requests
        await delay(80);
      }
    }

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

