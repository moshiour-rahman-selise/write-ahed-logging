export type Row = Record<string, unknown>;

export type InsertEntry     = { op: 'INSERT';     table: string; data: Row };
export type UpdateEntry     = { op: 'UPDATE';     table: string; id: number; before: Row; after: Row };
export type DeleteEntry     = { op: 'DELETE';     table: string; id: number; before: Row };
export type CheckpointEntry = { op: 'CHECKPOINT' };

export type LogEntry     = InsertEntry | UpdateEntry | DeleteEntry | CheckpointEntry;
export type StampedEntry = LogEntry & { lsn: number };

export type Database = Record<string, Row[]>;