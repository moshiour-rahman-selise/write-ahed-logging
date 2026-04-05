import fs from 'fs';
import { Database, Row } from './types';

const DATA_FILE = './storage/data.json';

export function readData(): Database {
  if (!fs.existsSync(DATA_FILE)) return {};
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) as Database;
}

export function findRow(table: string, id: number): Row {
  const row = readData()[table]?.find(r => r.id === id);
  if (!row) throw new Error(`Row not found: ${table}#${id}`);
  return row;
}

export function reset(storageDir: string, resetState: () => void): void {
  if (fs.existsSync(storageDir)) fs.rmSync(storageDir, { recursive: true });
  fs.mkdirSync(storageDir);
  resetState();
}