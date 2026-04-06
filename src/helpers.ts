import fs from 'fs';
import { OrderBook } from './types';

const DATA_FILE = './storage/data.json';

export function readOrderBook(): OrderBook {
  if (!fs.existsSync(DATA_FILE)) return { bids: [], asks: [] };
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) as OrderBook;
}

export function reset(storageDir: string, resetState: () => void): void {
  if (fs.existsSync(storageDir)) fs.rmSync(storageDir, { recursive: true });
  fs.mkdirSync(storageDir);
  resetState();
}