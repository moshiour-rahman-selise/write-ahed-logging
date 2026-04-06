# Write-Ahead Logging (WAL) — Learning Project

A hands-on study of the Write-Ahead Log pattern in TypeScript, motivated by building a crash-safe **in-memory orderbook service**.

---

## Why WAL for an Orderbook?

An orderbook is stateful and sequence-sensitive. If the service crashes mid-match, a partial fill is worse than no fill — you need to recover to an **exact, consistent state**.

WAL solves this by ensuring every operation is durably written to a log *before* it touches in-memory state. On restart, the log is replayed to rebuild the orderbook exactly as it was.

| Orderbook event       | WAL operation |
|-----------------------|---------------|
| Place order (bid/ask) | `PLACE`       |
| Partial fill          | `FILL`        |
| Cancel / fully filled | `CANCEL`      |
| Periodic snapshot     | `CHECKPOINT`  |
| Service restart       | `RECOVER`     |

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

### Checkpointing + Log Compaction
Every N operations (`CHECKPOINT_INTERVAL` in `config.ts`), the current state is flushed to disk and the log is **truncated** to just the CHECKPOINT entry. Since `data.json` already holds the full snapshot, nothing before the checkpoint needs replaying.

```
checkpoint.json  →  { "lsn": 4 }       (bookmark into the log)
data.json        →  full state at LSN 4 (the snapshot)
wal.log          →  only the CHECKPOINT entry + any ops since
```

`CHECKPOINT_INTERVAL` is a balance between write overhead (lower = more frequent compaction) and recovery time (higher = more entries to replay on crash).

### Recovery
```
1. Load checkpoint.json  → find the LSN bookmark
2. Load data.json        → start from the snapshot
3. Replay wal.log        → only entries after the checkpoint LSN
4. Flush rebuilt state   → write data.json so the next restart starts clean
```

If no checkpoint exists, the full log is replayed from scratch.

### Group Commit
Instead of fsyncing on every single log write, entries are batched and flushed every `GROUP_COMMIT_SIZE` writes. This keeps the log fd open across calls and trades a small durability window for significantly higher write throughput.

```
write entry 1  → in OS buffer
write entry 2  → in OS buffer
write entry 3  → fsync (batch of 3 flushed to disk at once)
```

`flushLog()` forces an immediate fsync — called before every checkpoint to ensure nothing is lost during log compaction. `closeLog()` flushes and closes the fd on clean shutdown.

### Crash Safety
`data.json` is written atomically (write to `.tmp` then rename) so a crash mid-write can never corrupt the snapshot. If the process dies after a log entry is fsynced but before `data.json` is updated, recovery replays that entry from the log and produces a consistent state.

---

## Project Structure

```
src/
  index.ts        — full demo (place, match, cancel, compaction, crash simulation)
  crash-demo.ts   — resets storage, places crossing orders, exits mid-fill
  recover-demo.ts — reads existing storage and runs recovery
  orderbook.ts    — place, fill, cancel, match engine, recover
  wal.ts          — appendLog, logAndApply, checkpoint+compaction, group commit, initWalState
  helpers.ts      — readOrderBook, reset
  types.ts        — Order, OrderBook, Side, log entry types
  config.ts       — file paths, CHECKPOINT_INTERVAL, GROUP_COMMIT_SIZE constants

storage/          — runtime files (gitignored)
  wal.log
  data.json
  checkpoint.json
```

---

## Run

```bash
# Full demo (compaction + in-process crash simulation)
npm start

# Manual crash test — exits mid-fill, leaving storage in intermediate state
npm run crash

# Recovery — reads existing storage and replays to consistent state
npm run recover
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
- [x] **Log compaction** — checkpoint truncates wal.log so recovery never replays stale entries
- [x] **Crash simulation** — `process.exit()` mid-fill, recovery produces consistent state
- [x] **Partial-write guard** — detect and skip truncated JSON lines in wal.log on recovery

- [x] **Group commit** — batch multiple log entries and fsync once for higher write throughput
