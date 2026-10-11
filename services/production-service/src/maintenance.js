import { Router } from 'express';
import { analysisForBatch } from './production.js';
import { reconcileQualityAlert } from './qualityAlerts.js';
import {
  activeMachine, alertStatuses, bad, collection, conflict, idParam, maintenanceKinds,
  missing, objectBody, oneOf, pagination, plainText, timestamp, withTransaction
} from './lib.js';

export async function syncOverdueMaintenanceAlerts(pool) {
  await pool.query(`UPDATE alerts a SET status = 'resolved', resolved_at = NOW(),
    resolution_reason = 'Bakım tarihi yeniden planlandı.'
    FROM maintenance_records r
    WHERE a.dedup_key = 'maintenance:' || r.id::text AND a.machine_id = r.machine_id
      AND a.status IN ('open','reviewing')
      AND (r.status <> 'planned' OR r.scheduled_at >= NOW())`);
  await pool.query(`INSERT INTO alerts
    (machine_id, kind, metric, dedup_key, severity, title, explanation, evidence)
    SELECT r.machine_id, 'maintenance', NULL, 'maintenance:' || r.id::text, 'warning',
      'Gecikmiş bakım', 'Planlanan bakım tarihi geçti; bakım kaydını inceleyin.',
      jsonb_build_object('maintenance_id', r.id, 'scheduled_at', r.scheduled_at)
    FROM maintenance_records r JOIN machines m ON m.id = r.machine_id
    WHERE r.status = 'planned' AND r.scheduled_at < NOW() AND m.archived_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM alerts a WHERE a.machine_id = r.machine_id
         AND a.dedup_key = 'maintenance:' || r.id::text AND a.status = 'resolved'
         AND a.resolution_reason <> 'Bakım tarihi yeniden planlandı.'
         AND (a.evidence->>'scheduled_at')::timestamptz = r.scheduled_at)
    ON CONFLICT (machine_id, dedup_key) WHERE status IN ('open','reviewing')
    DO UPDATE SET evidence = EXCLUDED.evidence, explanation = EXCLUDED.explanation`);
}

async function reconcileQualityAlertsForMaintenance(client, machineId, scheduledAt) {
  const batches = await client.query(`SELECT * FROM production_batches
    WHERE machine_id = $1 AND ended_at IS NOT NULL AND ended_at > $2
    ORDER BY started_at, id`, [machineId, scheduledAt]);
  for (const batch of batches.rows) {
    await reconcileQualityAlert(client, batch, analysisForBatch);
  }
}

async function maintenanceList(pool, req, res, forcedMachineId = null) {
  const { page, limit, offset } = pagination(req.query);
  const where = [];
  const args = [];
  const machineId = forcedMachineId || req.query.machineId;
  if (machineId) {
    args.push(idParam(machineId, 'makine kimliği'));
    where.push(`r.machine_id = $${args.length}`);
  }
  if (req.query.status) {
    args.push(oneOf(req.query.status, ['planned', 'completed'], 'Bakım durumu'));
    where.push(`r.status = $${args.length}`);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const count = await pool.query(`SELECT COUNT(*) AS total FROM maintenance_records r ${clause}`, args);
  const result = await pool.query(`SELECT r.*, m.code AS machine_code, m.name AS machine_name
    FROM maintenance_records r JOIN machines m ON m.id = r.machine_id ${clause}
    ORDER BY r.scheduled_at DESC, r.id DESC LIMIT $${args.length + 1} OFFSET $${args.length + 2}`,
  [...args, limit, offset]);
  res.json(collection(result.rows, count.rows[0].total, page, limit));
}

async function alertList(pool, req, res, forcedMachineId = null) {
  const { page, limit, offset } = pagination(req.query);
  const where = [];
  const args = [];
  const machineId = forcedMachineId || req.query.machineId;
  if (machineId) {
    args.push(idParam(machineId, 'makine kimliği'));
    where.push(`a.machine_id = $${args.length}`);
  }
  if (req.query.status) {
    args.push(oneOf(req.query.status, alertStatuses, 'Uyarı durumu'));
    where.push(`a.status = $${args.length}`);
  }
  if (req.query.kind) {
    args.push(oneOf(req.query.kind, ['measurement', 'maintenance', 'quality'], 'Uyarı türü'));
    where.push(`a.kind = $${args.length}`);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const count = await pool.query(`SELECT COUNT(*) AS total FROM alerts a ${clause}`, args);
  const result = await pool.query(`SELECT a.*, m.code AS machine_code, m.name AS machine_name
    FROM alerts a JOIN machines m ON m.id = a.machine_id ${clause}
    ORDER BY a.created_at DESC, a.id DESC LIMIT $${args.length + 1} OFFSET $${args.length + 2}`,
  [...args, limit, offset]);
  res.json(collection(result.rows, count.rows[0].total, page, limit));
}

export function machineAuxiliaryRoutes(pool) {
  const router = Router();
  router.get('/:id/maintenance', async (req, res) => {
    const id = idParam(req.params.id, 'makine kimliği');
    const exists = await pool.query('SELECT 1 FROM machines WHERE id = $1', [id]);
    if (!exists.rows.length) throw missing('Makine bulunamadı.');
    await maintenanceList(pool, req, res, id);
  });
  router.get('/:id/alerts', async (req, res) => {
    const id = idParam(req.params.id, 'makine kimliği');
    const exists = await pool.query('SELECT 1 FROM machines WHERE id = $1', [id]);
    if (!exists.rows.length) throw missing('Makine bulunamadı.');
    await alertList(pool, req, res, id);
  });
  return router;
}

export function maintenanceRoutes(pool) {
  const router = Router();
  router.get('/', (req, res) => maintenanceList(pool, req, res));
  router.post('/', async (req, res) => {
    const body = objectBody(req.body,
      ['machine_id', 'kind', 'status', 'scheduled_at', 'completed_at', 'description', 'action_taken'],
      ['machine_id', 'kind', 'scheduled_at', 'description']);
    const machineId = idParam(body.machine_id, 'makine kimliği');
    const kind = oneOf(body.kind, maintenanceKinds, 'Bakım türü');
    const status = body.status === undefined ? 'planned' : oneOf(body.status, ['planned', 'completed'], 'Bakım durumu');
    const scheduled = timestamp(body.scheduled_at, 'Bakım tarihi');
    const description = plainText(body.description, 'Bakım açıklaması', 5000);
    let completed = null;
    let action = null;
    if (status === 'completed') {
      completed = body.completed_at ? timestamp(body.completed_at, 'Tamamlanma zamanı') : new Date().toISOString();
      action = plainText(body.action_taken, 'Yapılan işlem', 5000);
      if (new Date(completed).getTime() > Date.now() + 60_000) throw bad('Tamamlanma zamanı gelecekte olamaz.');
    } else if (body.completed_at !== undefined || body.action_taken !== undefined) {
      throw bad('Planlı bakım için tamamlanma alanları gönderilemez.');
    }
    const record = await withTransaction(pool, async (client) => {
      await activeMachine(client, machineId, true);
      const result = await client.query(`INSERT INTO maintenance_records
        (machine_id, kind, status, scheduled_at, completed_at, description, action_taken)
        VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [machineId, kind, status, scheduled, completed, description, action]);
      if (status === 'planned' && new Date(scheduled) < new Date()) await syncOverdueMaintenanceAlerts(client);
      await reconcileQualityAlertsForMaintenance(client, machineId, scheduled);
      return result.rows[0];
    });
    res.status(201).json(record);
  });
  router.get('/:id', async (req, res) => {
    const id = idParam(req.params.id, 'bakım kimliği');
    const result = await pool.query('SELECT * FROM maintenance_records WHERE id = $1', [id]);
    if (!result.rows.length) throw missing('Bakım kaydı bulunamadı.');
    res.json(result.rows[0]);
  });
  router.patch('/:id', async (req, res) => {
    const id = idParam(req.params.id, 'bakım kimliği');
    const body = objectBody(req.body, ['kind', 'scheduled_at', 'description']);
    const kind = Object.hasOwn(body, 'kind') ? oneOf(body.kind, maintenanceKinds, 'Bakım türü') : null;
    const scheduled = Object.hasOwn(body, 'scheduled_at') ? timestamp(body.scheduled_at, 'Bakım tarihi') : null;
    const description = Object.hasOwn(body, 'description') ? plainText(body.description, 'Bakım açıklaması', 5000) : null;
    const record = await withTransaction(pool, async (client) => {
      const old = await client.query('SELECT * FROM maintenance_records WHERE id = $1 FOR UPDATE', [id]);
      if (!old.rows.length) throw missing('Bakım kaydı bulunamadı.');
      if (old.rows[0].status === 'completed') throw conflict('Tamamlanan bakım değiştirilemez.');
      await activeMachine(client, old.rows[0].machine_id, true);
      const result = await client.query(`UPDATE maintenance_records SET kind = COALESCE($2,kind),
        scheduled_at = COALESCE($3,scheduled_at), description = COALESCE($4,description)
        WHERE id = $1 RETURNING *`, [id, kind, scheduled, description]);
      if (scheduled !== null) {
        await syncOverdueMaintenanceAlerts(client);
        const earliest = new Date(Math.min(new Date(old.rows[0].scheduled_at), new Date(scheduled)));
        await reconcileQualityAlertsForMaintenance(client, old.rows[0].machine_id, earliest);
      }
      return result.rows[0];
    });
    res.json(record);
  });
  router.post('/:id/complete', async (req, res) => {
    const id = idParam(req.params.id, 'bakım kimliği');
    const body = objectBody(req.body,
      ['completed_at', 'action_taken', 'resolved_alert_ids', 'resolution_reason'], ['action_taken']);
    const completed = body.completed_at === undefined ? new Date().toISOString() : timestamp(body.completed_at, 'Tamamlanma zamanı');
    if (new Date(completed).getTime() > Date.now() + 60_000) throw bad('Tamamlanma zamanı gelecekte olamaz.');
    const action = plainText(body.action_taken, 'Yapılan işlem', 5000);
    const alertIds = body.resolved_alert_ids ?? [];
    if (!Array.isArray(alertIds) || alertIds.length > 50) throw bad('Kapatılacak uyarılar dizi olmalı (en fazla 50).');
    const uniqueIds = [...new Set(alertIds.map((value) => idParam(value, 'uyarı kimliği')))];
    const reason = uniqueIds.length ? plainText(body.resolution_reason, 'Uyarı kapanma nedeni', 5000) : null;
    if (!uniqueIds.length && body.resolution_reason !== undefined) throw bad('Kapanma nedeni için uyarı seçilmeli.');
    const record = await withTransaction(pool, async (client) => {
      const old = await client.query('SELECT * FROM maintenance_records WHERE id = $1 FOR UPDATE', [id]);
      if (!old.rows.length) throw missing('Bakım kaydı bulunamadı.');
      if (old.rows[0].status === 'completed') throw conflict('Bakım zaten tamamlanmış.');
      await activeMachine(client, old.rows[0].machine_id, true);
      const result = await client.query(`UPDATE maintenance_records SET status = 'completed',
        completed_at = $2, action_taken = $3 WHERE id = $1 RETURNING *`, [id, completed, action]);
      if (uniqueIds.length) {
        const alerts = await client.query(`SELECT id FROM alerts WHERE id = ANY($1::bigint[])
          AND machine_id = $2 AND status IN ('open','reviewing') FOR UPDATE`, [uniqueIds, old.rows[0].machine_id]);
        if (alerts.rows.length !== uniqueIds.length) throw bad('Seçilen uyarılar bu makineye ait açık uyarılar olmalı.');
        await client.query(`UPDATE alerts SET status = 'resolved', resolved_at = $2,
          resolution_reason = $3, resolved_by_maintenance_id = $4::bigint
          WHERE id = ANY($1::bigint[])`, [uniqueIds, completed, reason, id]);
      }
      await client.query(`UPDATE alerts SET status = 'resolved', resolved_at = $2,
        resolution_reason = 'İlgili bakım tamamlandı: ' || $3,
        resolved_by_maintenance_id = $1::bigint
        WHERE dedup_key = 'maintenance:' || $1::text AND machine_id = $4
          AND status IN ('open','reviewing')`, [id, completed, action, old.rows[0].machine_id]);
      await reconcileQualityAlertsForMaintenance(client, old.rows[0].machine_id, old.rows[0].scheduled_at);
      return result.rows[0];
    });
    res.json(record);
  });
  return router;
}

export function alertRoutes(pool) {
  const router = Router();
  router.get('/', (req, res) => alertList(pool, req, res));
  router.patch('/:id', async (req, res) => {
    const id = idParam(req.params.id, 'uyarı kimliği');
    const body = objectBody(req.body, ['status', 'resolution_reason'], ['status']);
    const status = oneOf(body.status, alertStatuses, 'Uyarı durumu');
    const reason = status === 'resolved' ? plainText(body.resolution_reason, 'Kapanma nedeni', 5000) : null;
    if (status !== 'resolved' && body.resolution_reason !== undefined) throw bad('Kapanma nedeni yalnızca çözülen uyarıda kullanılabilir.');
    const result = await withTransaction(pool, async (client) => {
      const old = await client.query('SELECT * FROM alerts WHERE id = $1 FOR UPDATE', [id]);
      if (!old.rows.length) throw missing('Uyarı bulunamadı.');
      if (old.rows[0].status === 'resolved') throw conflict('Çözülmüş uyarı tekrar düzenlenemez.');
      const updated = await client.query(`UPDATE alerts SET status = $2, resolved_at = $3,
        resolution_reason = $4 WHERE id = $1 RETURNING *`,
      [id, status, status === 'resolved' ? new Date().toISOString() : null, reason]);
      return updated.rows[0];
    });
    res.json(result);
  });
  return router;
}
