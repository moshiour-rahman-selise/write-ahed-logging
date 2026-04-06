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

// ── Core ─────────────────────────────────────────────────────────────────────

export function appendLog(entry: LogEntry): number {
    const lsn = ++currentLSN;
    const fd = fs.openSync(LOG_FILE, 'a');
    fs.writeSync(fd, JSON.stringify({ lsn, ...entry }) + '\n');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    return lsn;
}

export function logAndApply(entry: PlaceEntry | FillEntry | CancelEntry, applyFn: (ob: OrderBook) => void): void {
    appendLog(entry);
    const ob = readOrderBook();
    applyFn(ob);
    fs.writeFileSync(DATA_FILE, JSON.stringify(ob, null, 2));
    opsSinceCheckpoint++;
    if (opsSinceCheckpoint >= CHECKPOINT_INTERVAL) checkpoint(ob);
}

// ── Checkpoint (internal) ─────────────────────────────────────────────────────

function checkpoint(_ob: OrderBook): void {
    const lsn = appendLog({ op: 'CHECKPOINT' });
    fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify({ lsn }));
    opsSinceCheckpoint = 0;
    console.log(`  [checkpoint] LSN=${lsn}`);
}
