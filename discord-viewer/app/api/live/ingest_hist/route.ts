import { NextRequest, NextResponse } from 'next/server';

// Proxies a batch of ingest_hist requests to the Rust server (port 7878)
// Body: { symbols: string[]; timestamp?: string }
export async function POST(req: NextRequest) {
  try {
    const { symbols, timestamp } = await req.json();
    if (!Array.isArray(symbols) || symbols.length === 0) {
      return NextResponse.json({ error: 'symbols (array) required' }, { status: 400 });
    }

    const ts = timestamp || new Date().toISOString();

    const results = await Promise.allSettled(
      symbols.map(async (sym: string) => {
        // Upstream Rust route is /api/live/ingest_hist
        const res = await fetch('http://localhost:7878/api/live/ingest_hist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ symbol: sym, timestamp: ts })
        });
        const json = await res.json().catch(() => ({ error: 'invalid json' }));
        return { symbol: sym, status: res.status, ok: res.ok, data: json };
      })
    );

    const ok = results.filter(r => r.status === 'fulfilled' && (r as any).value.ok).length;
    return NextResponse.json({ ok, results });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'failed' }, { status: 500 });
  }
}
