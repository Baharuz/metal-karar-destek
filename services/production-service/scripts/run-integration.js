import { spawnSync } from 'node:child_process';

if (!process.env.TEST_DATABASE_URL &&
    !(process.env.TEST_PGHOST && process.env.TEST_PGDATABASE && process.env.TEST_PGUSER)) {
  console.error('TEST_DATABASE_URL veya TEST_PGHOST/TEST_PGDATABASE/TEST_PGUSER gereklidir. Yalnızca ayrı bir test veritabanı kullanın.');
  process.exit(1);
}

const result = spawnSync(process.execPath,
  ['--test', 'tests/api.integration.test.js'],
  { stdio: 'inherit', env: process.env });
process.exit(result.status ?? 1);
