import express from 'express';
import { machineRoutes } from './machines.js';
import { machineAuxiliaryRoutes, maintenanceRoutes, alertRoutes } from './maintenance.js';
import { productRoutes, batchRoutes } from './production.js';
import { dashboardRoutes } from './dashboard.js';
import { missing, sqlError } from './lib.js';

export function createApp({ pool }) {
  if (!pool?.query) throw new Error('Veritabanı havuzu gerekli.');
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));
  app.get('/api/health', (_req, res) => res.json({ service: 'production-service', status: 'ok' }));
  app.get('/api/ready', async (_req, res) => {
    await pool.query('SELECT 1');
    res.json({ service: 'production-service', status: 'ready' });
  });
  app.use('/api/dashboard', dashboardRoutes(pool));
  app.use('/api/machines', machineRoutes(pool));
  app.use('/api/machines', machineAuxiliaryRoutes(pool));
  app.use('/api/maintenance', maintenanceRoutes(pool));
  app.use('/api/alerts', alertRoutes(pool));
  app.use('/api/products', productRoutes(pool));
  app.use('/api/batches', batchRoutes(pool));
  app.use((_req, _res, next) => next(missing('Endpoint bulunamadı.')));
  app.use((error, _req, res, _next) => {
    const converted = error instanceof SyntaxError && error.status === 400 && 'body' in error
      ? { status: 400, code: 'INVALID_JSON', message: 'JSON gövdesi bozuk.' }
      : sqlError(error);
    res.status(converted.status).json({ code: converted.code, message: converted.message,
      ...(converted.details ? { details: converted.details } : {}) });
  });
  return app;
}
