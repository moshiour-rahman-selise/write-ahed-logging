import fs from 'fs';
import { LogEntry, OrderBook, PlaceEntry, FillEntry, CancelEntry } from './types';
import { LOG_FILE, DATA_FILE, CHECKPOINT_FILE, CHECKPOINT_INTERVAL } from './config';
import { readOrderBook } from './helpers';

// ── State ────────────────────────────────────────────────────────────────────

let currentLSN         = 0;
let opsSinceCheckpoint = 0;

export function resetWalState(): void {
    currentLSN         = 0;
    opsSinceCheckpoint = 0;
}

/** Call on normal (non-demo) startup to resume LSN from the last checkpoint. */
export function initWalState(): void {
    if (fs.existsSync(CHECKPOINT_FILE)) {
        const { lsn } = JSON.parse(fs.readFileSync(CHECKPOINT_FILE, 'utf8'));
        currentLSN = lsn;
    }
    opsSinceCheckpoint = 0;
}

// ── Core ─────────────────────────────────────────────────────────────────────

export function appendLog(entry: LogEntry): number {
    const lsn = ++currentLSN;
    const fd = fs.openSync(LOG_FILE, 'a');
    fs.writeSync(fd, JSON.stringify({ lsn, ...entry }) + '\n');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    return lsn;
}

export function logAndApply(
    entry: PlaceEntry | FillEntry | CancelEntry,
    applyFn: (ob: OrderBook) => void,
    crashAfterLog: 'throw' | 'exit' | false = false,
): void {
    appendLog(entry);
    if (crashAfterLog === 'exit')  { console.log('[CRASH] process.exit(1) — FILL is in log, data.json is stale'); process.exit(1); }
    if (crashAfterLog === 'throw') throw new Error('[SIMULATED CRASH] process killed after log write');
    const ob = readOrderBook();
    applyFn(ob);
    // Atomic write: write to tmp then rename so a crash mid-write can't corrupt data.json
    fs.writeFileSync(DATA_FILE + '.tmp', JSON.stringify(ob, null, 2));
    fs.renameSync(DATA_FILE + '.tmp', DATA_FILE);
    opsSinceCheckpoint++;
    if (opsSinceCheckpoint >= CHECKPOINT_INTERVAL) checkpoint();
}

// ── Checkpoint ────────────────────────────────────────────────────────────────

function checkpoint(): void {
    const lsn = ++currentLSN;
    const line = JSON.stringify({ lsn, op: 'CHECKPOINT' }) + '\n';

    // Write checkpoint.json bookmark
    fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify({ lsn }));

    // Compact: truncate wal.log to just the CHECKPOINT entry.
    // data.json already holds the full snapshot, so nothing before this needs replaying.
    fs.writeFileSync(LOG_FILE, line);

    opsSinceCheckpoint = 0;
    console.log(`  [checkpoint+compact] LSN=${lsn} — log truncated`);
}
