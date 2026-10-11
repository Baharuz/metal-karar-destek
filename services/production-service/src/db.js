import pg from 'pg';

const { Pool } = pg;

export function databaseConfig(env = process.env) {
  if (env.DATABASE_URL) {
    let parsed;
    try { parsed = new URL(env.DATABASE_URL); } catch { throw new Error('DATABASE_URL geçerli bir PostgreSQL adresi olmalı.'); }
    if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !parsed.hostname || !parsed.pathname.slice(1)) {
      throw new Error('DATABASE_URL geçerli bir PostgreSQL adresi olmalı.');
    }
    return { connectionString: env.DATABASE_URL, connectionTimeoutMillis: 5000 };
  }
  for (const key of ['PGHOST', 'PGDATABASE', 'PGUSER']) {
    if (!env[key]?.trim()) throw new Error(`${key} ortam değişkeni gerekli.`);
  }
  const port = Number(env.PGPORT || 5432);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PGPORT 1-65535 arasında olmalı.');
  return {
    host: env.PGHOST,
    port,
    database: env.PGDATABASE,
    user: env.PGUSER,
    password: env.PGPASSWORD,
    connectionTimeoutMillis: 5000
  };
}

export function createPool(env = process.env) {
  const result = new Pool(databaseConfig(env));
  result.on('error', (error) => console.error('Boştaki veritabanı bağlantısı kapandı:', error.message));
  return result;
}

export const pool = createPool();
