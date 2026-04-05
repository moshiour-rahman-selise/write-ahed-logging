import fs from 'fs';
import { StampedEntry } from './types';
import { STORAGE_DIR, LOG_FILE } from './config';
import { reset } from './helpers';
import { resetWalState } from './wal';
import { place, cancel, recover } from './orderbook';

// ── Demo ─────────────────────────────────────────────────────────────────────

reset(STORAGE_DIR, resetWalState);

console.log('=== 1. Place orders ===');
place({ id: 1, side: 'BID', price: 100, qty: 5, trader: 'Alice' });
place({ id: 2, side: 'BID', price:  99, qty: 3, trader: 'Bob'   });
place({ id: 3, side: 'ASK', price: 101, qty: 2, trader: 'Carol' }); // no match (ask > all bids)
place({ id: 4, side: 'ASK', price: 100, qty: 4, trader: 'Dave'  }); // matches BID#1 @ 100

console.log('\n=== 2. Cancel an unmatched order ===');
cancel(2, 'BID');

console.log('\n=== 3. Raw log ===');
const lines = fs.readFileSync(LOG_FILE, 'utf8').split('\n').filter(Boolean);
for (const line of lines) {
    const e = JSON.parse(line) as StampedEntry;
    console.log(`  LSN=${e.lsn} ${e.op}`);
}

console.log('\n=== 4. Recovery ===');
const recovered = recover();
console.log('\nopen bids:', recovered.bids);
console.log('open asks:', recovered.asks);
