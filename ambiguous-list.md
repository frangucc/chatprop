# Ambiguous Ticker List

## Problem
Some terms are both legitimate stock tickers AND common trading abbreviations/words.

## Example: WW
- **As abbreviation**: "worth watching" (very common in trading discussions)
- **As stock**: $WW - WW International (formerly Weight Watchers)

## Challenge
When someone writes "XPON WW", it could mean:
1. "XPON worth watching" (abbreviation)
2. "XPON and WW stocks" (two tickers)

## Current Issue
If WW is on our blacklist, the legitimate $WW stock will never be tracked.

## Proposed Solution: Hybrid Approach
1. Check if ticker exists in Databento/Finnhub
2. If exists AND is on "ambiguous" list
3. Apply stricter AI context analysis with higher confidence threshold
4. Look for explicit stock indicators:
   - Dollar sign ($WW)
   - "WW stock"
   - Price mentions
   - Trading action words (bought, sold, holding)

## Other Known Ambiguous Cases
- UP - "up" movement vs $UP stock
- HOLD - action vs potential ticker
- ALL - "all in" vs $ALL (Allstate)
- CAN - "can" verb vs Canadian stocks
- ARE - verb vs potential ticker
- MORE - common word vs potential ticker
- RUN - verb vs $RUN stock

## Implementation Notes
- Maintain separate "ambiguous_tickers" table
- Don't blacklist these outright
- Apply special handling with higher scrutiny
- Context is key for disambiguation
