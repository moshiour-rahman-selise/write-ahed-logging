import fs from 'fs';
import { Database, InsertEntry, UpdateEntry, DeleteEntry, LogEntry, StampedEntry } from './types';
import { readData, findRow, reset } from './helpers';

// ── Config ───────────────────────────────────────────────────────────────────

const STORAGE_DIR         = './storage';
const LOG_FILE            = `${STORAGE_DIR}/wal.log`;
const DATA_FILE           = `${STORAGE_DIR}/data.json`;
const CHECKPOINT_FILE     = `${STORAGE_DIR}/checkpoint.json`;
const CHECKPOINT_INTERVAL = 3;

// ── State ────────────────────────────────────────────────────────────────────

let currentLSN         = 0;
let opsSinceCheckpoint = 0;

// ── WAL core ─────────────────────────────────────────────────────────────────

function appendLog(entry: LogEntry): number {
  const lsn = ++currentLSN;
  const fd = fs.openSync(LOG_FILE, 'a');
  fs.writeSync(fd, JSON.stringify({ lsn, ...entry }) + '\n');
  fs.fsyncSync(fd);
  fs.closeSync(fd);
  return lsn;
}

function logAndApply(entry: InsertEntry | UpdateEntry | DeleteEntry, applyFn: (db: Database) => void): void {
  appendLog(entry);

  const db = readData();
  applyFn(db);
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));

  opsSinceCheckpoint++;
  if (opsSinceCheckpoint >= CHECKPOINT_INTERVAL) {
    checkpoint(db);
  }
}

// ── Checkpoint ───────────────────────────────────────────────────────────────

function checkpoint(db: Database): void {
  const lsn = appendLog({ op: 'CHECKPOINT' });
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
  fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify({ lsn }));
  opsSinceCheckpoint = 0;
  console.log(`  [checkpoint] LSN=${lsn} — log entries up to here no longer needed`);
}

// ── Operations ───────────────────────────────────────────────────────────────

function insert(table: string, data: Record<string, unknown>): void {
  logAndApply(
    { op: 'INSERT', table, data },
    (db) => {
      db[table] ??= [];
      db[table].push(data);
    }
  );
}

function update(table: string, id: number, after: Record<string, unknown>): void {
  const before = findRow(table, id);
  logAndApply(
    { op: 'UPDATE', table, id, before, after },
    (db) => {
      const idx = db[table].findIndex(r => r.id === id);
      db[table][idx] = after;
    }
  );
}

function remove(table: string, id: number): void {
  const before = findRow(table, id);
  logAndApply(
    { op: 'DELETE', table, id, before },
    (db) => {
      db[table] = db[table].filter(r => r.id !== id);
    }
  );
}

// ── Recovery ─────────────────────────────────────────────────────────────────

function recover(): Database {
  if (!fs.existsSync(LOG_FILE)) return {};

  let checkpointLSN = 0;
  let db: Database  = {};

  if (fs.existsSync(CHECKPOINT_FILE)) {
    ({ lsn: checkpointLSN } = JSON.parse(fs.readFileSync(CHECKPOINT_FILE, 'utf8')));
    db = readData();
    console.log(`  [recover] checkpoint found at LSN=${checkpointLSN}, loading data.json as base`);
  } else {
    console.log(`  [recover] no checkpoint, replaying full log from scratch`);
  }

  const lines = fs.readFileSync(LOG_FILE, 'utf8').split('\n').filter(Boolean);

  for (const line of lines) {
    const entry = JSON.parse(line) as StampedEntry;

    if (entry.lsn <= checkpointLSN) continue;
    if (entry.op === 'CHECKPOINT')  continue;

    db[entry.table] ??= [];

    switch (entry.op) {
      case 'INSERT':
        db[entry.table].push(entry.data);
        break;

      case 'UPDATE': {
        const idx = db[entry.table].findIndex(r => r.id === entry.id);
        db[entry.table][idx] = entry.after;
        break;
      }

      case 'DELETE':
        db[entry.table] = db[entry.table].filter(r => r.id !== entry.id);
        break;
    }

    console.log(`  replayed: LSN=${entry.lsn} ${entry.op.padEnd(7)} ${entry.table} ${'id' in entry ? `id=${entry.id}` : ''}`);
  }

  return db;
}

// ── Demo ─────────────────────────────────────────────────────────────────────

reset(STORAGE_DIR, () => { currentLSN = 0; opsSinceCheckpoint = 0; });

console.log('=== 1. Operations (checkpoint every 3) ===');
insert('users',  { id: 1, name: 'Alice', role: 'admin' });         // LSN 1
insert('users',  { id: 2, name: 'Bob',   role: 'viewer' });        // LSN 2
insert('orders', { id: 101, userId: 1, item: 'book', qty: 2 });    // LSN 3 → checkpoint at LSN 4
update('users',  1, { id: 1, name: 'Alice', role: 'superadmin' }); // LSN 5
remove('orders', 101);                                              // LSN 6

console.log('\n=== 2. Raw log entries ===');
const lines = fs.readFileSync(LOG_FILE, 'utf8').split('\n').filter(Boolean);
for (const line of lines) {
  const e = JSON.parse(line) as StampedEntry;
  console.log(`  LSN=${e.lsn} ${e.op.padEnd(10)} ${'table' in e ? e.table : ''}  ${'id' in e ? `id=${e.id}` : ''}`);
}

console.log('\n=== 3. Recovery (skips pre-checkpoint entries) ===');
const recovered = recover();
console.log('\nrecovered db:', JSON.stringify(recovered, null, 2));