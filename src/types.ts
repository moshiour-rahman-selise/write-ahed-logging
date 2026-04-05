export type Side = 'BID' | 'ASK';

export type Order = {
  id:     number;
  side:   Side;
  price:  number;
  qty:    number;
  trader: string;
};

export type Orderbook = {
  bids: Order[];
  asks: Order[];
};

export type PlaceEntry      = { op: 'PLACE';      order: Order };
export type FillEntry       = { op: 'FILL';       bidId: number; askId: number; price: number; qty: number };
export type CancelEntry     = { op: 'CANCEL';     orderId: number; side: Side };
export type CheckpointEntry = { op: 'CHECKPOINT' };

export type LogEntry     = PlaceEntry | FillEntry | CancelEntry | CheckpointEntry;
export type StampedEntry = LogEntry & { lsn: number };