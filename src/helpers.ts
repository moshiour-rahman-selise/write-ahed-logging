import fs from 'fs';
import { Orderbook } from './types';

const DATA_FILE = './storage/data.json';

export function readOrderbook(): Orderbook {
  if (!fs.existsSync(DATA_FILE)) return { bids: [], asks: [] };
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) as Orderbook;
}

export function reset(storageDir: string, resetState: () => void): void {
  if (fs.existsSync(storageDir)) fs.rmSync(storageDir, { recursive: true });
  fs.mkdirSync(storageDir);
  resetState();
}