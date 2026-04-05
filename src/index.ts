import fs from 'fs';
import { CancelEntry, FillEntry, LogEntry, Order, Orderbook, PlaceEntry, Side, StampedEntry } from './types';
import { readOrderbook, reset } from './helpers';

// ── Config ───────────────────────────────────────────────────────────────────

const STORAGE_DIR = './storage';
const LOG_FILE = `${STORAGE_DIR}/wal.log`;
const DATA_FILE = `${STORAGE_DIR}/data.json`;
const CHECKPOINT_FILE = `${STORAGE_DIR}/checkpoint.json`;
const CHECKPOINT_INTERVAL = 5;

// ── State ────────────────────────────────────────────────────────────────────

let currentLSN = 0;
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

function logAndApply(entry: PlaceEntry | FillEntry | CancelEntry, applyFn: (ob: Orderbook) => void): void {
    appendLog(entry);
    const ob = readOrderbook();
    applyFn(ob);
    fs.writeFileSync(DATA_FILE, JSON.stringify(ob, null, 2));
    opsSinceCheckpoint++;
    if (opsSinceCheckpoint >= CHECKPOINT_INTERVAL) checkpoint(ob);
}

// ── Checkpoint ───────────────────────────────────────────────────────────────

function checkpoint(_ob: Orderbook): void {
    const lsn = appendLog({ op: 'CHECKPOINT' });
    fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify({ lsn }));
    opsSinceCheckpoint = 0;
    console.log(`  [checkpoint] LSN=${lsn}`);
}

// ── Apply helpers (shared between operations and recovery) ────────────────────

function applyPlace(ob: Orderbook, order: Order): void {
    if (order.side === 'BID') ob.bids.push(order);
    else ob.asks.push(order);
}

function applyCancel(ob: Orderbook, orderId: number, side: Side): void {
    if (side === 'BID') ob.bids = ob.bids.filter(o => o.id !== orderId);
    else ob.asks = ob.asks.filter(o => o.id !== orderId);
}

function removeQty(orders: Order[], id: number, qty: number): void {
    const idx = orders.findIndex(o => o.id === id);
    if (idx === -1) return;
    orders[idx].qty -= qty;
    if (orders[idx].qty === 0) orders.splice(idx, 1);
}

function applyFill(ob: Orderbook, bidId: number, askId: number, qty: number): void {
    removeQty(ob.bids, bidId, qty);
    removeQty(ob.asks, askId, qty);
}

// ── Operations ───────────────────────────────────────────────────────────────

function place(order: Order): void {
    logAndApply({ op: 'PLACE', order }, (ob) => applyPlace(ob, order));
    match();
}

function fill(bidId: number, askId: number, price: number, qty: number): void {
    logAndApply({ op: 'FILL', bidId, askId, price, qty }, (ob) => applyFill(ob, bidId, askId, qty));
}

function cancel(orderId: number, side: Side): void {
    logAndApply({ op: 'CANCEL', orderId, side }, (ob) => applyCancel(ob, orderId, side));
}

// ── Matching Engine ───────────────────────────────────────────────────────────

function best(orders: Order[], isBetter: (a: Order, b: Order) => boolean): Order | undefined {
    return orders.reduce<Order | undefined>((top, o) => !top || isBetter(o, top) ? o : top, undefined);
}

function match(): void {
    while (true) {
        const ob = readOrderbook();
        const bestBid = best(ob.bids, (a, b) => a.price > b.price);
        const bestAsk = best(ob.asks, (a, b) => a.price < b.price);

        if (!bestBid || !bestAsk || bestAsk.price > bestBid.price) break;

        const qty = Math.min(bestBid.qty, bestAsk.qty);
        console.log(`  [match] BID#${bestBid.id}(${bestBid.trader}) x ASK#${bestAsk.id}(${bestAsk.trader}) @ ${bestAsk.price} qty=${qty}`);
        fill(bestBid.id, bestAsk.id, bestAsk.price, qty);
    }
}

// ── Recovery ─────────────────────────────────────────────────────────────────

function recover(): Orderbook {
    if (!fs.existsSync(LOG_FILE)) return { bids: [], asks: [] };

    let checkpointLSN = 0;
    let ob: Orderbook = { bids: [], asks: [] };

    if (fs.existsSync(CHECKPOINT_FILE)) {
        ({ lsn: checkpointLSN } = JSON.parse(fs.readFileSync(CHECKPOINT_FILE, 'utf8')));
        ob = readOrderbook();
        console.log(`  [recover] checkpoint at LSN=${checkpointLSN}, loading snapshot`);
    } else {
        console.log(`  [recover] no checkpoint, replaying full log`);
    }

    const lines = fs.readFileSync(LOG_FILE, 'utf8').split('\n').filter(Boolean);

    for (const line of lines) {
        const entry = JSON.parse(line) as StampedEntry;

        if (entry.lsn <= checkpointLSN) continue;
        if (entry.op === 'CHECKPOINT') continue;

        switch (entry.op) {
            case 'PLACE':
                applyPlace(ob, entry.order);
                break;
            case 'FILL':
                applyFill(ob, entry.bidId, entry.askId, entry.qty);
                break;
            case 'CANCEL':
                applyCancel(ob, entry.orderId, entry.side);
                break;
        }

        console.log(`  replayed: LSN=${entry.lsn} ${entry.op}`);
    }

    return ob;
}

// ── Demo ─────────────────────────────────────────────────────────────────────

reset(STORAGE_DIR, () => {
    currentLSN = 0;
    opsSinceCheckpoint = 0;
});

console.log('=== 1. Place orders ===');
place({ id: 1, side: 'BID', price: 100, qty: 5, trader: 'Alice' });
place({ id: 2, side: 'BID', price: 99, qty: 3, trader: 'Bob' });
place({ id: 3, side: 'ASK', price: 101, qty: 2, trader: 'Carol' }); // no match (ask > all bids)
place({ id: 4, side: 'ASK', price: 100, qty: 4, trader: 'Dave' }); // matches BID#1 @ 100

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