/**
 * Peek occupancy + optional earliest due/retry ISO (PERF-5).
 * Legacy Workers may still return a boolean from peek RPCs.
 */
export type ShardOccupancyHint = {
  occupied: boolean;
  /** Earliest due / available ISO on this shard when known. */
  earliest?: string;
};
