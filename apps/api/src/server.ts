import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { pool } from './db/pool.js';

const config = loadConfig();
const app = await buildApp(config);
const shutdown = async () => { await app.close(); await pool.end(); process.exit(0); };
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
await app.listen({ host: '0.0.0.0', port: config.API_PORT });
