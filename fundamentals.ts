import fs from 'fs';

// ── Types ────────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;

type InsertEntry = { op: 'INSERT'; table: string; data: Row };
type UpdateEntry = { op: 'UPDATE'; table: string; id: number; before: Row; after: Row };
type DeleteEntry = { op: 'DELETE'; table: string; id: number; before: Row };

type LogEntry = InsertEntry | UpdateEntry | DeleteEntry;

type Database = Record<string, Row[]>;

// ── Config ───────────────────────────────────────────────────────────────────

const STORAGE_DIR = './storage';
const LOG_FILE    = `${STORAGE_DIR}/wal.log`;
const DATA_FILE   = `${STORAGE_DIR}/data.json`;

// ── WAL core ─────────────────────────────────────────────────────────────────

function logAndApply(entry: LogEntry, applyFn: (db: Database) => void): void {
  // 1. Write intention to log — fsync guarantees it's durable before we touch data
  const fd = fs.openSync(LOG_FILE, 'a');
  fs.writeSync(fd, JSON.stringify(entry) + '\n');
  fs.fsyncSync(fd);
  fs.closeSync(fd);

  // 2. Apply to data
  const db = readData();
  applyFn(db);
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

// ── Operations ───────────────────────────────────────────────────────────────

function insert(table: string, data: Row): void {
  logAndApply(
    { op: 'INSERT', table, data },
    (db) => {
      db[table] ??= [];
      db[table].push(data);
    }
  );
}

function update(table: string, id: number, after: Row): void {
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

  const lines = fs.readFileSync(LOG_FILE, 'utf8').split('\n').filter(Boolean);
  const db: Database = {};

  for (const line of lines) {
    const entry: LogEntry = JSON.parse(line);
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

    console.log(`  replayed: ${entry.op.padEnd(7)} ${entry.table} ${entry.op !== 'INSERT' ? `id=${entry.id}` : ''}`);
  }

  return db;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function readData(): Database {
  if (!fs.existsSync(DATA_FILE)) return {};
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) as Database;
}

function findRow(table: string, id: number): Row {
  const row = readData()[table]?.find(r => r.id === id);
  if (!row) throw new Error(`Row not found: ${table}#${id}`);
  return row;
}

function reset(): void {
  if (fs.existsSync(STORAGE_DIR)) fs.rmSync(STORAGE_DIR, { recursive: true });
  fs.mkdirSync(STORAGE_DIR);
}

// ── Demo ─────────────────────────────────────────────────────────────────────

reset();

console.log('=== 1. Different operations ===');
insert('users',  { id: 1, name: 'Alice', role: 'admin' });
insert('users',  { id: 2, name: 'Bob',   role: 'viewer' });
insert('orders', { id: 101, userId: 1, item: 'book', qty: 2 });
update('users',  1, { id: 1, name: 'Alice', role: 'superadmin' });
remove('orders', 101);

console.log('\ndata file:', JSON.stringify(readData(), null, 2));

console.log('\n=== 2. Raw log entries ===');
const lines = fs.readFileSync(LOG_FILE, 'utf8').split('\n').filter(Boolean);
for (const line of lines) {
  const e: LogEntry = JSON.parse(line);
  console.log(`  ${e.op.padEnd(7)} ${e.table}`, e.op !== 'INSERT' ? `id=${e.id}` : '');
  if ('before' in e) console.log('          before:', e.before);
  if ('after'  in e) console.log('          after: ', e.after);
  if ('data'   in e) console.log('          data:  ', e.data);
}

console.log('\n=== 3. Recovery ===');
const recovered = recover();
console.log('\nrecovered db:', JSON.stringify(recovered, null, 2));