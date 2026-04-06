# Write-Ahead Logging (WAL) — Learning Project

A hands-on study of the Write-Ahead Log pattern in TypeScript, motivated by building a crash-safe **in-memory orderbook service**.

---

## Why WAL for an Orderbook?

An orderbook is stateful and sequence-sensitive. If the service crashes mid-match, a partial fill is worse than no fill — you need to recover to an **exact, consistent state**.

WAL solves this by ensuring every operation is durably written to a log *before* it touches in-memory state. On restart, the log is replayed to rebuild the orderbook exactly as it was.

| Orderbook event | WAL operation |
|---|---|
| Place order (bid/ask) | `INSERT` |
| Partial fill | `UPDATE` |
| Cancel / fully filled | `DELETE` |
| Periodic snapshot | `CHECKPOINT` |
| Service restart | `RECOVER` |

---

## What We Built

### Core WAL Rule
```
Write to log first → apply to state → never the other way around
```

### LSN (Log Sequence Number)
Every log entry gets a unique, incrementing LSN. In an orderbook, LSN = **event sequence** — order of operations is everything.

```
{"lsn":1,"op":"PLACE",...}      ← place order
{"lsn":2,"op":"PLACE",...}      ← place order
{"lsn":3,"op":"FILL",...}       ← partial fill
{"lsn":4,"op":"CHECKPOINT"}     ← snapshot marker
{"lsn":5,"op":"CANCEL",...}     ← cancel order
```

### Checkpointing
Every N operations, the current state is flushed to disk and a checkpoint LSN is recorded. On recovery, only entries **after** the checkpoint LSN are replayed — avoiding a full log scan on every restart.

```
checkpoint.json  →  { "lsn": 4 }          (bookmark into the log)
data.json        →  full state at LSN 4    (the snapshot)
wal.log          →  replay LSN 5+ only
```

### Recovery
```
1. Load checkpoint.json  → find the LSN bookmark
2. Load data.json        → start from the snapshot
3. Replay wal.log        → only entries after the checkpoint LSN
```

---

## Project Structure

```
src/
  index.ts      — demo script (place, cancel, recover)
  orderbook.ts  — place, fill, cancel, match engine, recover
  wal.ts        — appendLog, logAndApply, checkpoint
  helpers.ts    — readOrderBook, reset
  types.ts      — Order, OrderBook, Side, log entry types
  config.ts     — file paths and CHECKPOINT_INTERVAL constant

storage/        — runtime files (gitignored)
  wal.log
  data.json
  checkpoint.json
```

---

## Run

```bash
npm start
```

---

## Learning Roadmap

### Completed
- [x] Append-only WAL log
- [x] LSN stamping on every entry
- [x] Checkpointing + checkpoint.json bookmark
- [x] Recovery that skips pre-checkpoint entries

- [x] **Pivot to orderbook model** — `PLACE/FILL/CANCEL` events on `bids` and `asks`
- [x] **Matching engine** — logs a `FILL` event when a bid and ask cross, recovers partial fills correctly

### Next
- [ ] **Log compaction** — instead of replaying all events, periodically compact to only the current open orders
- [ ] **Crash simulation** — kill the process mid-match and verify recovery produces a consistent orderbook