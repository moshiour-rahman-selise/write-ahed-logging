import { STORAGE_DIR } from './config';
import { reset } from './helpers';
import { resetWalState } from './wal';
import { place, setCrashNextFill } from './orderbook';

reset(STORAGE_DIR, resetWalState);

console.log('Placing BID #1 (Alice, 100 @ 50)...');
place({ id: 1, side: 'BID', price: 50, qty: 2, trader: 'Alice' });

console.log('Placing ASK #2 (Bob, 50 @ 50) — will match and crash mid-fill...');
setCrashNextFill('exit');
place({ id: 2, side: 'ASK', price: 50, qty: 2, trader: 'Bob' });
