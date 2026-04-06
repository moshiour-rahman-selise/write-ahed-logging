import fs from 'fs';
import { StampedEntry } from './types';
import { STORAGE_DIR, LOG_FILE } from './config';
import { reset } from './helpers';
import { resetWalState } from './wal';
import { place, cancel, recover, setCrashNextFill } from './orderbook';

// ── Demo ─────────────────────────────────────────────────────────────────────

reset(STORAGE_DIR, resetWalState);

console.log('=== 1. Place orders ===');
place({ id: 1, side: 'BID', price: 100, qty: 5, trader: 'Alice' });
place({ id: 2, side: 'BID', price:  99, qty: 3, trader: 'Bob'   });
place({ id: 3, side: 'ASK', price: 101, qty: 2, trader: 'Carol' }); // no match (ask > all bids)
place({ id: 4, side: 'ASK', price: 100, qty: 4, trader: 'Dave'  }); // matches BID#1 @ 100

console.log('\n=== 2. Cancel an unmatched order ===');
cancel(2, 'BID');

console.log('\n=== 3. Raw log (post-compaction) ===');
const lines = fs.readFileSync(LOG_FILE, 'utf8').split('\n').filter(Boolean);
for (const line of lines) {
    const e = JSON.parse(line) as StampedEntry;
    console.log(`  LSN=${e.lsn} ${e.op}`);
}

console.log('\n=== 4. Recovery ===');
const recovered = recover();
console.log('\nopen bids:', recovered.bids);
console.log('open asks:', recovered.asks);

// ── Crash Simulation ──────────────────────────────────────────────────────────

console.log('\n=== 5. Crash simulation ===');
console.log('Placing two crossing orders. Process will "crash" after FILL is logged but before data.json is updated.');

reset(STORAGE_DIR, resetWalState);

place({ id: 10, side: 'BID', price: 50, qty: 2, trader: 'Alice' });

// This place triggers a match → fill(). The crash fires after appendLog(FILL) but before
// data.json is written, leaving the snapshot stale.
setCrashNextFill();
try {
    place({ id: 11, side: 'ASK', price: 50, qty: 2, trader: 'Bob' });
} catch (e: unknown) {
    console.log(`  ${(e as Error).message}`);
}

console.log('\n  Recovering from stale snapshot...');
const afterCrash = recover();
console.log('  open bids:', afterCrash.bids);
console.log('  open asks:', afterCrash.asks);

const fullyMatched = afterCrash.bids.length === 0 && afterCrash.asks.length === 0;
console.log(`\n  Consistent? ${fullyMatched ? 'YES — both sides empty, fill replayed correctly' : 'NO — unexpected state'}`);
