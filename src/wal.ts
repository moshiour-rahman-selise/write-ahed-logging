import fs from 'fs';
import { LogEntry, OrderBook, PlaceEntry, FillEntry, CancelEntry } from './types';
import { LOG_FILE, DATA_FILE, CHECKPOINT_FILE, CHECKPOINT_INTERVAL, GROUP_COMMIT_SIZE } from './config';
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

// ── Group Commit ──────────────────────────────────────────────────────────────

let logFd:        number | null = null;
let pendingWrites = 0;

function openLog(): void {
    if (logFd === null) logFd = fs.openSync(LOG_FILE, 'a');
}

export function flushLog(): void {
    if (logFd !== null && pendingWrites > 0) {
        fs.fsyncSync(logFd);
        pendingWrites = 0;
    }
}

export function closeLog(): void {
    flushLog();
    if (logFd !== null) {
        fs.closeSync(logFd);
        logFd = null;
    }
}

// ── Core ─────────────────────────────────────────────────────────────────────

export function appendLog(entry: LogEntry): number {
    const lsn = ++currentLSN;
    openLog();
    fs.writeSync(logFd!, JSON.stringify({ lsn, ...entry }) + '\n');
    pendingWrites++;
    if (pendingWrites >= GROUP_COMMIT_SIZE) flushLog();
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
    flushLog();  // ensure all pending writes are durable before compacting
    closeLog();  // close fd so we can safely truncate the file

    const lsn  = ++currentLSN;
    const line = JSON.stringify({ lsn, op: 'CHECKPOINT' }) + '\n';

    fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify({ lsn }));

    // Compact: truncate wal.log to just the CHECKPOINT entry.
    // data.json already holds the full snapshot, so nothing before this needs replaying.
    fs.writeFileSync(LOG_FILE, line);

    opsSinceCheckpoint = 0;
    console.log(`  [checkpoint+compact] LSN=${lsn} — log truncated`);
}
