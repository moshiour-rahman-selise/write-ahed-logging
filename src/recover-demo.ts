import { initWalState } from './wal';
import { recover } from './orderbook';

initWalState();

console.log('Recovering from existing storage...\n');
const ob = recover();

console.log('\nopen bids:', ob.bids);
console.log('open asks:', ob.asks);

const fullyMatched = ob.bids.length === 0 && ob.asks.length === 0;
console.log(`\nConsistent? ${fullyMatched ? 'YES — both sides empty, fill replayed correctly' : 'NO — unexpected state'}`);
