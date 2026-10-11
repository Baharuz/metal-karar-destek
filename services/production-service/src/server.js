import { createApp } from './app.js';
import { pool } from './db.js';
import { syncOverdueMaintenanceAlerts } from './maintenance.js';

const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 3001);
if (!host.trim() || !Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('HOST boş olamaz; PORT 1-65535 arasında olmalı.');
}

const app = createApp({ pool });
const server = app.listen(port, host, () => {
  console.log(`Üretim servisi: http://${host}:${port}`);
});
syncOverdueMaintenanceAlerts(pool).catch((error) => console.error('Bakım uyarıları yenilenemedi:', error.message));
const overdueTimer = setInterval(() => {
  syncOverdueMaintenanceAlerts(pool).catch((error) => console.error('Bakım uyarıları yenilenemedi:', error.message));
}, 60_000);
overdueTimer.unref();

let closing = false;
async function shutdown(signal) {
  if (closing) return;
  closing = true;
  clearInterval(overdueTimer);
  console.log(`${signal} alındı, bağlantılar kapatılıyor.`);
  const timer = setTimeout(() => server.closeAllConnections(), 10_000);
  timer.unref();
  try {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await pool.end();
    process.exitCode = 0;
  } catch (error) {
    console.error('Kapatma hatası:', error);
    process.exitCode = 1;
  } finally {
    clearTimeout(timer);
  }
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
