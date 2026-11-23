// BTC trend bot for make.fun btc-race-24h-20261123-0511.
//
// Strategy (one sentence): buy all cash at the first tradeable bar, then hold
// through the noise and sell everything only on a genuine breakdown, with one
// disciplined re-entry on a new high.
//
// Why this shape: the dev window is one +2.4% leg in the first four hours and
// then ~1,200 flat bars oscillating within +/-0.5%. Every fast signal tested
// on it (EMA 8/21, EMA 12/48, RSI-Bollinger, ADX, Donchian) whipsaws in the
// flat stretch and pays ~26-38 bps per round trip until it is deep under
// water, while buy-and-hold makes +$32.17. So the bot is deliberately slow:
// it enters immediately, exits only when the trend actually breaks, and never
// chases the flat chop. The exits are the whole edge for the unseen race
// window: a 2% trailing stop and a close 1% below the 3-hour EMA cap the
// loss in a falling window at roughly -$15 to -$25, where buy-and-hold
// would ride a -4% day to about -$40. A single re-entry on a fresh high
// (prev high + 0.5%) recovers the crash-then-rally path without re-buying
// every small bounce.
//
// Rules, exactly:
//   - Entry: on the first tradeable batch, buy 100% of cash (one order).
//     If that buy is ever rejected, keep retrying on later batches until
//     it fills; the entry counter only advances on a fill.
//   - While holding, track the position-peak equity and the position-high
//     close (both since this entry).
//   - Exit, sell the whole position, when either fires on a bar's close:
//       (a) equity < 98% of position-peak equity (2% trailing stop), or
//       (b) close < 99% of EMA(180) of closes on two consecutive bars
//       (3-hour trend broken; one bar under the line is noise, not a break).
//     EMA(180) is seeded as the mean of the first 180 closes, then updated
//     as EMA += (2/181) * (close - EMA), in float64 like the kit baselines.
//   - Re-entry, at most once per run: after an exit, if at least 60 bars
//     have passed and the close exceeds the exited position's high close
//     by 0.5%, buy 100% of cash again. After the second exit the bot
//     stays in cash to the end.
//   - Every order caps slippage at 100 bps (1%) from the latest close.
//   - No order is sent on a warm-up batch or on a batch with no CBBTC bar.
//
// Determinism: no clock, no environment, no files, no randomness. The only
// state is the close history and a few counters, all derived from the
// batches the harness sends, so two runs on the same data send the same
// orders. Only the standard library and the vendored kit shim are used.
//
// Protocol: agent-fun/bars-replay/v1, spoken through the kit's TypeScript
// shim (vendor/makefun-bars.ts, a byte-identical copy of sdk/makefun-bars.ts).

import { runBars, type BarsState, type Batch, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
const SLOW_SPAN = 180; // 3-hour EMA for the trend-break exit
const MAX_SLIPPAGE_BPS = 100; // 1% from the latest close, on every order
const REENTRY_COOLDOWN = 60; // bars to wait after an exit before re-entering

/** The bot's whole state, derived from the batches alone. */
class Bot {
  /** EMA(SLOW_SPAN) of closes, null until seeded. */
  ema: number | null = null;
  /** First SLOW_SPAN closes, for seeding the EMA. */
  emaWarm: number[] = [];
  /** Whether state shows a position this batch. */
  holding = false;
  /** Max equity (quote units) since this entry. */
  posPeakEquity = 0n;
  /** Max close since this entry. */
  posHighClose = 0;
  /** High close of the exited position (0 before any exit). */
  prevHighClose = 0;
  /** Consecutive closes below 99% of EMA(180) while holding. */
  emaBelowStreak = 0;
  /** Buys that filled (0, 1, or 2). */
  entries = 0;
  /** Seq of the batch where the exit was first observed. */
  lastExitSeq = -1_000_000_000;

  onBatch(state: BarsState, batch: Batch): (BuyInput | SellInput)[] {
    // Fold this batch's bar into the indicators. A batch with no CBBTC
    // bar carries no new price, so nothing is decided on it.
    let close: number | null = null;
    for (const b of batch.bars) {
      if (b.symbol === SYMBOL) {
        close = Number(b.c);
        break;
      }
    }
    if (close === null) return [];
    const c = close;
    if (this.ema === null) {
      this.emaWarm.push(c);
      if (this.emaWarm.length === SLOW_SPAN) {
        this.ema = this.emaWarm.reduce((a, x) => a + x, 0) / SLOW_SPAN;
      }
    } else {
      this.ema += (2 / (SLOW_SPAN + 1)) * (c - this.ema);
    }

    if (state.warmingUp) return [];

    const held = state.positions.get(SYMBOL);
    if (held !== undefined) {
      if (!this.holding) {
        // A buy filled since the last batch: start tracking this
        // position from the equity and close we see now.
        this.holding = true;
        this.posPeakEquity = state.equity;
        this.posHighClose = c;
        this.entries += 1;
      }
      if (state.equity > this.posPeakEquity) this.posPeakEquity = state.equity;
      if (c > this.posHighClose) this.posHighClose = c;
      // Exit on a genuine breakdown only: 2% trailing stop (immediate:
      // a 2% equity drop is already a confirmed move), or the close 1%
      // below the 3-hour EMA on two consecutive bars (one bar dipping
      // under the line is noise, not a broken trend).
      const trailHit = state.equity * 100n < this.posPeakEquity * 98n;
      const emaBelow = this.ema !== null && c * 100 < this.ema * 99;
      this.emaBelowStreak = emaBelow ? this.emaBelowStreak + 1 : 0;
      if (trailHit || this.emaBelowStreak >= 2) {
        return [{ side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
      }
      return [];
    }

    // Flat: record an exit the first batch we see it, then decide.
    if (this.holding) {
      this.holding = false;
      this.prevHighClose = this.posHighClose;
      this.lastExitSeq = state.seq;
    }
    if (this.entries === 0) {
      // First entry: buy all cash now (retry on later batches if a
      // fill is ever rejected; entries only counts filled buys).
      if (state.cash <= 0n) return [];
      return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: state.cash, max_slippage_bps: MAX_SLIPPAGE_BPS }];
    }
    if (this.entries >= 2) return [];
    // Single re-entry: a fresh high after the cooldown, i.e. the
    // downtrend that stopped us out has genuinely reversed.
    if (state.seq - this.lastExitSeq < REENTRY_COOLDOWN) return [];
    if (this.prevHighClose > 0 && c * 1000 > this.prevHighClose * 1005) {
      if (state.cash <= 0n) return [];
      return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: state.cash, max_slippage_bps: MAX_SLIPPAGE_BPS }];
    }
    return [];
  }
}

await runBars(new Bot());
