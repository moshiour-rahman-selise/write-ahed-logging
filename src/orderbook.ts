import fs from 'fs';
import { Order, OrderBook, Side, StampedEntry } from './types';
import { LOG_FILE, DATA_FILE, CHECKPOINT_FILE } from './config';
import { readOrderBook } from './helpers';
import { logAndApply } from './wal';

// ── Crash injection (demo/test only) ─────────────────────────────────────────

let _crashNextFill: 'throw' | 'exit' | false = false;
export function setCrashNextFill(mode: 'throw' | 'exit' = 'throw'): void { _crashNextFill = mode; }

// ── Apply helpers ─────────────────────────────────────────────────────────────

function applyPlace(ob: OrderBook, order: Order): void {
    if (order.side === 'BID') ob.bids.push(order);
    else                      ob.asks.push(order);
}

function applyCancel(ob: OrderBook, orderId: number, side: Side): void {
    if (side === 'BID') ob.bids = ob.bids.filter(o => o.id !== orderId);
    else                ob.asks = ob.asks.filter(o => o.id !== orderId);
}

function removeQty(orders: Order[], id: number, qty: number): void {
    const idx = orders.findIndex(o => o.id === id);
    if (idx === -1) return;
    orders[idx].qty -= qty;
    if (orders[idx].qty === 0) orders.splice(idx, 1);
}

function applyFill(ob: OrderBook, bidId: number, askId: number, qty: number): void {
    removeQty(ob.bids, bidId, qty);
    removeQty(ob.asks, askId, qty);
}

// ── Operations ───────────────────────────────────────────────────────────────

export function place(order: Order): void {
    logAndApply({ op: 'PLACE', order }, (ob) => applyPlace(ob, order));
    match();
}

export function fill(bidId: number, askId: number, price: number, qty: number): void {
    const crash = _crashNextFill;
    _crashNextFill = false;
    logAndApply({ op: 'FILL', bidId, askId, price, qty }, (ob) => applyFill(ob, bidId, askId, qty), crash !== false && crash);
}

export function cancel(orderId: number, side: Side): void {
    logAndApply({ op: 'CANCEL', orderId, side }, (ob) => applyCancel(ob, orderId, side));
}

// ── Matching Engine ───────────────────────────────────────────────────────────

function best(orders: Order[], isBetter: (a: Order, b: Order) => boolean): Order | undefined {
    return orders.reduce<Order | undefined>((top, o) => !top || isBetter(o, top) ? o : top, undefined);
}

export function match(): void {
    while (true) {
        const ob      = readOrderBook();
        const bestBid = best(ob.bids, (a, b) => a.price > b.price);
        const bestAsk = best(ob.asks, (a, b) => a.price < b.price);

        if (!bestBid || !bestAsk || bestAsk.price > bestBid.price) break;

        const qty = Math.min(bestBid.qty, bestAsk.qty);
        console.log(`  [match] BID#${bestBid.id}(${bestBid.trader}) x ASK#${bestAsk.id}(${bestAsk.trader}) @ ${bestAsk.price} qty=${qty}`);
        fill(bestBid.id, bestAsk.id, bestAsk.price, qty);
    }
}

// ── Recovery ─────────────────────────────────────────────────────────────────

export function recover(): OrderBook {
    if (!fs.existsSync(LOG_FILE)) return { bids: [], asks: [] };

    let checkpointLSN = 0;
    let ob: OrderBook = { bids: [], asks: [] };

    if (fs.existsSync(CHECKPOINT_FILE)) {
        ({ lsn: checkpointLSN } = JSON.parse(fs.readFileSync(CHECKPOINT_FILE, 'utf8')));
        ob = readOrderBook();
        console.log(`  [recover] checkpoint at LSN=${checkpointLSN}, loading snapshot`);
    } else {
        console.log(`  [recover] no checkpoint, replaying full log`);
    }

    const lines = fs.readFileSync(LOG_FILE, 'utf8').split('\n').filter(Boolean);

    for (const line of lines) {
        const entry = JSON.parse(line) as StampedEntry;

        if (entry.lsn <= checkpointLSN) continue;
        if (entry.op === 'CHECKPOINT')  continue;

        switch (entry.op) {
            case 'PLACE':  applyPlace(ob, entry.order);                        break;
            case 'FILL':   applyFill(ob, entry.bidId, entry.askId, entry.qty); break;
            case 'CANCEL': applyCancel(ob, entry.orderId, entry.side);          break;
        }

        console.log(`  replayed: LSN=${entry.lsn} ${entry.op}`);
    }

    // Flush recovered state so the next restart doesn't need to replay the log again
    fs.writeFileSync(DATA_FILE + '.tmp', JSON.stringify(ob, null, 2));
    fs.renameSync(DATA_FILE + '.tmp', DATA_FILE);

    return ob;
}
