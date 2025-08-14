Perfect—limiting to US equities on NASDAQ/NYSE/AMEX only (no OTC) tightens everything. Below is a crisp, implementation-ready rule set (no code) you can feed to your engine + AI assist. I’ve normalized terminology, added a scoring rubric, ambiguity handling (e.g., “can”), and a clean Anthropic prompt spec. I also corrected the one-letter ticker note at the end.

0) Data prerequisites

Primary dictionary (authoritative): your NEON listed_securities table, refreshed daily, with at least
ticker, exchange ∈ {NASDAQ, NYSE, AMEX}, security_type (common/ADR/ETF/share class), is_active.

Aliases table (optional): maps variants (e.g., BRK.B ↔ BRK-B ↔ BRK B).

Stopwords table: common English words that look like tickers (e.g., CAN, ALL, ONE, IT, FOR, WAS, YOU, MAY, ANY).

1) Candidate extraction (single message)

Run these extractors in parallel; merge unique candidates:

Cashtags (highest-priority): \$[A-Za-z]{1,5}([.-][A-Za-z0-9]{1,3})?

Examples captured: $XPON, $MNTS, $BRK.B, $BF-B.

Normalize: strip $, uppercase, convert separators to your canonical form (see §3).

All-caps token pass: \b[A-Z]{2,5}([.-][A-Za-z0-9]{1,3})?\b

Include single-letter only if token is standalone (surrounded by spaces/punct) or cashtag.

Title/mixed case pass (len 3–5): \b[A-Za-z]{3,5}([.-][A-Za-z0-9]{1,3})?\b

Promote only if: (a) immediately preceded by $, or (b) matches NEON exactly after normalization (see §3).

Patterns around trader verbs: capture lower/mixed tokens after verbs like “in”, “out”, “over”, “above”, “below”, “break”, “hold”, “starter”, “added”, “halt”, “pop”, “runner”, “WW”, “day 2” if they are 2–5 chars and not in stopwords. These become weak candidates pending validation.

2) Hard filters (because you’re US major exchanges only)

Reject if candidate not in NEON or exchange ∉ {NASDAQ, NYSE, AMEX} or is_active = false.

Reject if security_type ∉ {Common, ADR, ETF, Share Class}. (Default: exclude units/warrants/rights unless you explicitly decide to include them later.)

Reject if candidate ∈ stopwords AND not cashtagged AND not all-caps AND lacks trader context.

3) Normalization rules (before DB lookup)

Uppercase everything.

Map share-class separators to a single canonical form used by your DB (pick one and stick to it):

Accept variants {BRK.B, BRK-B, BRK B} → BRK.B (example).

Accept {BF-B, BF.B} → BF.B (or BF-B if you prefer).

Trim trailing punctuation/emojis.

Keep numerals in suffix where valid (e.g., HEI.A).

4) Confidence scoring (per mention)

Give each detected candidate a score ∈ [0, 1]. Suggested weights:

+0.95 cashtag exact DB match ($XPON → XPON in NEON).

+0.85 ALL-CAPS exact DB match (XPON) in trader context line (contains price/action slang).

+0.70 mixed/lowercase exact DB match with trader context (“xpon over 5”, “back in mnts”).

+0.60 all-caps standalone DB match without context.

−0.40 if token in stopwords and not cashtagged.

−0.20 if preceded by stop-phrases that signal grammar not ticker (e.g., “I can …” for CAN).

+0.10 if message contains clear price/level tokens near candidate ($, digits, 2.20, 6, EMA, “pt”, “SL”, “target”).

Cap at [0,1]. Minimum accept threshold = 0.80 (single message). Anything 0.60–0.79 → low-confidence bucket.

5) Cross-message consolidation (session/day window)

Aggregate by candidate ticker over a rolling window (e.g., the active market session or a calendar day):

Consensus boost: if ≥3 unique authors mention same candidate with any ≥0.7 evidence → +0.10 to that ticker’s day score.

Price-context boost: if ≥2 messages include price/level terms around the same candidate → +0.05.

Cashtag dominance: if ≥50% of mentions use cashtag → floor consolidated score at 0.85.

After aggregation, accept if consolidated score ≥ 0.80.

6) Ambiguity handling (words like “CAN”)

Default stop for ambiguous English words unless:

cashtagged ($CAN) or

all-caps AND surrounded by trader context and passes NEON check.

Maintain a dynamic watchlist of ambiguous hits that fell into 0.60–0.79.

If mentions ≥5 across the window and at least one cashtag/price-context occurs nearby (±3 messages), promote to Anthropic review (see §8) with the window slice.

7) Exchange-only validation workflow (no OTC)

Validation steps per candidate (short-circuit on fail):

NEON exact match after normalization. If not found → reject (no OTC fallback).

If found, ensure exchange ∈ {NASDAQ, NYSE, AMEX} and is_active = true. Else reject.

Optionally filter security_type as noted in §2.

8) AI assist (Anthropic) — when to call & what to ask

Call only if:

Single message score is 0.60–0.79, or

Consolidated score after aggregation is 0.60–0.79, or

You’re running a periodic sweep for ambiguous/stopword collisions with ≥5 mentions and weak signals.

Prompt spec (deterministic, JSON-only, no prose):

Single-message variant

SYSTEM: You are a strict market data validator for US equities on NASDAQ, NYSE, or AMEX. No OTC. Output JSON only.
TASK: From the chat message below, extract any tickers strictly listed on NASDAQ/NYSE/AMEX. 
- Normalize to uppercase; map share-class separators to dot form (e.g., BRK.B).
- If none meet the criteria, return an empty array.
RETURN FORMAT:
{"tickers": ["..."], "confidence": 0.0 to 1.0}
MESSAGE:
"<raw chat line here>"


Window/context variant

SYSTEM: You are a strict market data validator for US equities on NASDAQ, NYSE, or AMEX. No OTC. Output JSON only.
TASK: Given an ordered JSON array of recent chat messages (with author, timestamp, text), decide which tokens are US-listed exchange tickers being discussed.
- Normalize uppercase; use dot for share classes.
- Consider trader context (prices, “halt”, “over/under”, “WW”, “starter”, etc.).
- Return each inferred ticker with message_ids where it appears, and a final consolidated confidence.
RETURN FORMAT:
{"results":[{"ticker":"XPON","message_ids":[...],"confidence":0.0-1.0}, ...]}
MESSAGES_JSON:
<your window slice JSON>

9) API hard validation (post-AI, pre-persist)

Before persisting/triggering downstream:

NEON recheck (authoritative).

Optional secondary reference API (e.g., Polygon/IEX/Finnhub/Tradier—configured to reject OTC):

Minimal fields required: ticker, exchange, name, is_active.

If secondary disagrees with NEON on exchange or active status → quarantine with reason.

10) Handling special forms & edge cases

Share classes: Allow .A, .B, etc. (BRK.B, HEI.A). Treat hyphen and dot as equivalent on input; store canonical with dot.

Warrants/units/rights: Default exclude (not “equities” in your sense). Optionally add a feature flag to include only when security_type is “Common” or “ADR” or “ETF”.

Numbers near tickers: Don’t treat a bare number as a ticker; only use numbers to boost a nearby ticker’s confidence.

Emoji/markup: Ignore except where $ precedes candidate.

Halt language: “halt”, “T1”, “T2”, “resume” near a candidate → small boost (+0.05).

Collapsed duplicates: $MNTS and mnts in same message → single candidate.

11) Decision thresholds

Immediate accept (single message): score ≥ 0.80 (often cashtag or ALL-CAPS+DB+context).

Low-confidence bucket: 0.60–0.79 → wait for aggregation or call Anthropic as per §8.

Reject: <0.60 after extraction or fails NEON/exchange filters.

12) Periodic sweeps (to catch tricky cases without spamming AI)

Every N minutes (e.g., 5–10), sweep low-confidence candidates meeting:

≥5 mentions, ≥3 unique authors, and at least one message with price/level/”WW/halt” context.

Send the compact window JSON to Anthropic (context variant). If AI ≥0.85 confidence and NEON validates → promote; else keep quarantined.

13) Output contract to downstream systems

For each accepted detection emit:

{
  "ticker": "XPON",
  "exchange": "NASDAQ",
  "source_message_id": "…",
  "message_text": "XPON needs 6",
  "detection_confidence": 0.91,
  "detection_method": "cashtag|all_caps_db|ai_assist_window|…",
  "observed_at": "ISO8601",
  "session_id": "…"
}


(Include consolidated rollups separately if you’re counting mentions per session.)

14) Quick annotations on your sample (how rules would behave)

$GV back on the radar… → accept (cashtag + DB).

Xpon 4.20 → normalized XPON, DB match, trader context → likely accept (≥0.80).

TRAW nice recovery → TRAW all-caps, check DB; if listed on NASDAQ/NYSE/AMEX → accept; else reject.

Back in MNTS → mixed case, DB match, trader verb → 0.70 single; more mentions will promote.

can (as a word) → reject unless cashtag $CAN, or all-caps with context and DB validates.

BRK.B / BF-B if they ever appear → normalize to dot, NEON validate → accept.

15) Important correction on one-letter tickers

There are multiple one-letter tickers on US exchanges (e.g., F, T, C, K, L, Z, etc.). Zillow’s Z is one of them, but not the only one.
Rule: treat single-letter tokens as candidates only when cashtagged ($Z) or all-caps and surrounded by trader context, and they must pass NEON (exchange) validation.


see extracto-logic.yaml for additional instructions. 

