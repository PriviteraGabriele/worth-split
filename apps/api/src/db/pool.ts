import pg from 'pg';
import { loadConfig } from '../config.js';

const { Pool } = pg;

// Every request shares these connections, so none of them may be held or
// awaited without a deadline: a slow query, a stalled transaction or a full
// pool fails the single request instead of queueing everybody else forever.
export const pool = new Pool({
  connectionString: loadConfig().DATABASE_URL,
  max: 10,
  connectionTimeoutMillis: 10_000,
  statement_timeout: 30_000,
  idle_in_transaction_session_timeout: 30_000,
});
