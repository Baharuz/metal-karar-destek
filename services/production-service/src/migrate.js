import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export async function runMigrations(database) {
  if (!database) throw new Error('Migration için veritabanı havuzu gerekli.');
  const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../migrations');
  const files = (await readdir(directory)).filter((name) => /^\d+_[\w-]+\.sql$/.test(name)).sort();
  const client = await database.connect();
  try {
    // A session lock serializes concurrent API containers during deployment.
    await client.query('SELECT pg_advisory_lock($1)', [793104]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    for (const name of files) {
      const version = Number(name.split('_')[0]);
      const existing = await client.query('SELECT name FROM schema_migrations WHERE version = $1', [version]);
      if (existing.rows.length) {
        if (existing.rows[0].name !== name) throw new Error(`Migration sürümü değişmiş: ${version}`);
        continue;
      }
      const sql = await readFile(path.join(directory, name), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version, name) VALUES ($1, $2)', [version, name]);
        await client.query('COMMIT');
        console.log(`Migration uygulandı: ${name}`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [793104]).catch(() => {});
    client.release();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { pool } = await import('./db.js');
  runMigrations(pool).then(() => pool.end()).catch(async (error) => {
    console.error('Migration başarısız:', error.message);
    await pool.end();
    process.exitCode = 1;
  });
}
