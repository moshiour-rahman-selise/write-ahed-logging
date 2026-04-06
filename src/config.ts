export const STORAGE_DIR         = './storage';
export const LOG_FILE            = `${STORAGE_DIR}/wal.log`;
export const DATA_FILE           = `${STORAGE_DIR}/data.json`;
export const CHECKPOINT_FILE     = `${STORAGE_DIR}/checkpoint.json`;
export const CHECKPOINT_INTERVAL = 2;
export const GROUP_COMMIT_SIZE   = 3;  // fsync every N log entries
