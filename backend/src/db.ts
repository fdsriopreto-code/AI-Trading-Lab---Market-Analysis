import pg from 'pg';
const { Pool } = pg;
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required');
export const pool = new Pool({ connectionString, max: 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000, ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: true } : undefined });
