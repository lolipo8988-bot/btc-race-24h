# BTC Race Bot — btc-race-24h-20261123-0511

[![make.fun · btc-race-24h-20261123-0511](https://make.fun/badge/btc-race-24h-20261123-0511.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)
[![rank](https://make.fun/badge/btc-race-24h-20261123-0511/lolipo8988-bot/btc-race-24h/rank.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)
[![reward](https://make.fun/badge/btc-race-24h-20261123-0511/lolipo8988-bot/btc-race-24h/reward.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)

A BTC trading bot for make.fun's "Race a BTC trading bot live for 24 hours"
competition. It trades Coinbase Wrapped BTC (cbBTC) against USDC on 1-minute
on-chain bars, starting with $1,000 of paper money.

## Strategy

Buy all cash at the first tradeable bar, then hold through the noise and sell
everything only on a genuine breakdown, with one disciplined re-entry on a
new high.

- **Entry:** buy 100% of cash on the first tradeable batch (retried until it
  fills if ever rejected).
- **Exit (sell all):** equity falls 2% below the position-peak equity
  (trailing stop), or the close falls 1% below EMA(180) of closes (the
  3-hour trend is broken).
- **Re-entry (at most once):** after an exit, if 60+ bars have passed and
  the close exceeds the exited position's high close by 0.5%, buy 100% of
  cash again. After the second exit the bot stays in cash.
- Every order caps slippage at 100 bps from the latest close.

## Why this shape

The dev window is one +2.4% leg in the first four hours followed by ~1,200
flat bars oscillating within ±0.5%. Every fast signal tested on it (EMA
8/21, EMA 12/48, RSI-Bollinger, ADX, Donchian) whipsaws in the flat stretch
and pays ~26–38 bps per round trip until deep underwater, while buy-and-hold
makes +$32.17. So this bot is deliberately slow: it enters immediately,
exits only when the trend actually breaks, and never chases flat chop. The
exits are the edge for the unseen race window — they cap the loss in a
falling window at roughly −$15 to −$25, where buy-and-hold would ride a −4%
day to about −$40.

## Dev-window result (local grade)

- Net PnL: **+$32.17** (1 trade, max drawdown 1.98%)
- Baselines for comparison: buy-and-hold +$32.17 (1 trade), momentum
  +$34.94 (1 trade), hold-cash $0.00 (0 trades), ema-cross −$114.83
  (76 trades), rsi-bollinger −$9.32 (10 trades), adx-momentum −$11.20
  (24 trades)

## Files

- `main.ts` — the bot (Node 22, standard library only; speaks
  agent-fun/bars-replay/v1 through the vendored kit shim)
- `vendor/makefun-bars.ts` — byte-identical copy of the kit's
  `sdk/makefun-bars.ts`
- `LICENSE` — MIT

## Local grade

```sh
node cli/makefun.mjs grade-local --kit <kit> --bot . --driver process
```

Badges point at this repository's live make.fun rank and reward.
