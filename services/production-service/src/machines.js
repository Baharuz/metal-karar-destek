import { Router } from 'express';
import { evaluateMachineRisk } from './rules.js';
import { analysisForBatch } from './production.js';
import { reconcileQualityAlertsForMeasurement } from './qualityAlerts.js';
import {
  activeMachine, bad, codeValue, collection, conflict, decimal, idParam,
  machineStatuses, metricUnits, missing, objectBody, oneOf, pagination,
  plainText, timestamp, withTransaction
} from './lib.js';

const demoThresholds = [
  ['temperature_c', 75, 90],
  ['vibration_mm_s', 4.5, 7.1],
  ['runtime_hours', 500, 1000]
];

export async function riskForMachine(db, id) {
  const [measurements, thresholds] = await Promise.all([
    db.query(`SELECT DISTINCT ON (kind) * FROM machine_measurements
      WHERE machine_id = $1 ORDER BY kind, measured_at DESC, id DESC`, [id]),
    db.query('SELECT * FROM machine_thresholds WHERE machine_id = $1 ORDER BY kind', [id])
  ]);
  return {
    risk: evaluateMachineRisk({ measurements: measurements.rows, thresholds: thresholds.rows }),
    latestMeasurements: measurements.rows
  };
}

async function updateMeasurementAlert(client, machineId, metric, reading, risk) {
  const dedupKey = `measurement:${metric}`;
  if (risk.state === 'warning' || risk.state === 'critical') {
    const title = `${metricUnits[metric] ? { temperature_c: 'Sıcaklık', vibration_mm_s: 'Titreşim', runtime_hours: 'Çalışma saati' }[metric] : metric} eşiği aşıldı`;
    await client.query(`INSERT INTO alerts
      (machine_id, kind, metric, dedup_key, severity, title, explanation, evidence)
      VALUES ($1, 'measurement', $2, $3, $4, $5, $6, $7)
      ON CONFLICT (machine_id, dedup_key) WHERE status IN ('open','reviewing')
      DO UPDATE SET severity = EXCLUDED.severity, explanation = EXCLUDED.explanation,
        evidence = EXCLUDED.evidence`,
    [machineId, metric, dedupKey, risk.state, title, risk.explanation,
      JSON.stringify({ measurement_id: reading.id, value: reading.value, unit: reading.unit,
        measured_at: reading.measured_at, warning: risk.warning, critical: risk.critical,
        recommendation: risk.recommendation, demo_threshold: risk.demoThreshold })]);
  } else {
    const resolutionReason = risk.state === 'normal'
      ? 'Güncel ölçüm tanımlı eşiğin altında.'
      : 'Güncel makine riski artık bu uyarıyı desteklemiyor: ' + risk.explanation;
    await client.query(`UPDATE alerts SET status = 'resolved', resolved_at = NOW(),
      resolution_reason = $3, resolved_by_maintenance_id = NULL
      WHERE machine_id = $1 AND dedup_key = $2 AND status IN ('open','reviewing')`,
    [machineId, dedupKey, resolutionReason]);
  }
}

async function reconcileMeasurementAlert(client, machineId, kind) {
  const latest = await client.query(`SELECT * FROM machine_measurements WHERE machine_id = $1 AND kind = $2
    ORDER BY measured_at DESC, id DESC LIMIT 1`, [machineId, kind]);
  const threshold = await client.query('SELECT * FROM machine_thresholds WHERE machine_id = $1 AND kind = $2', [machineId, kind]);
  const risk = evaluateMachineRisk({ measurements: latest.rows, thresholds: threshold.rows })
    .find((row) => row.kind === kind);
  await updateMeasurementAlert(client, machineId, kind, latest.rows[0], risk);
}

export function machineRoutes(pool) {
  const router = Router();

  router.get('/', async (req, res) => {
    const { page, limit, offset } = pagination(req.query);
    const where = ['($1::boolean OR archived_at IS NULL)'];
    const args = [req.query.includeArchived === 'true'];
    if (req.query.search) {
      args.push(`%${plainText(req.query.search, 'Arama', 100)}%`);
      where.push(`(code ILIKE $${args.length} OR name ILIKE $${args.length})`);
    }
    if (req.query.status) {
      args.push(oneOf(req.query.status, machineStatuses, 'Durum'));
      where.push(`status = $${args.length}`);
    }
    const clause = where.join(' AND ');
    const count = await pool.query(`SELECT COUNT(*) AS total FROM machines WHERE ${clause}`, args);
    const rows = await pool.query(`SELECT * FROM machines WHERE ${clause}
      ORDER BY created_at DESC, id DESC LIMIT $${args.length + 1} OFFSET $${args.length + 2}`,
    [...args, limit, offset]);
    res.json(collection(rows.rows, count.rows[0].total, page, limit));
  });

  router.post('/', async (req, res) => {
    const body = objectBody(req.body, ['code', 'name', 'status'], ['code', 'name']);
    const code = codeValue(body.code);
    const name = plainText(body.name, 'Makine adı', 100);
    const status = body.status === undefined ? 'idle' : oneOf(body.status, machineStatuses, 'Durum');
    const machine = await withTransaction(pool, async (client) => {
      const result = await client.query(`INSERT INTO machines (code, name, status) VALUES ($1,$2,$3) RETURNING *`, [code, name, status]);
      const created = result.rows[0];
      await client.query(`INSERT INTO machine_status_history (machine_id, previous_status, new_status, note)
        VALUES ($1, NULL, $2, 'İlk kayıt')`, [created.id, status]);
      for (const [kind, warning, critical] of demoThresholds) {
        await client.query(`INSERT INTO machine_thresholds
          (machine_id, kind, unit, warning_value, critical_value, is_demo)
          VALUES ($1,$2,$3,$4,$5,TRUE)`, [created.id, kind, metricUnits[kind], warning, critical]);
      }
      return created;
    });
    res.status(201).json(machine);
  });

  router.get('/:id', async (req, res) => {
    const id = idParam(req.params.id, 'makine kimliği');
    const result = await pool.query('SELECT * FROM machines WHERE id = $1', [id]);
    const machine = result.rows[0];
    if (!machine) throw missing('Makine bulunamadı.');
    const [riskInfo, alerts, maintenance, history] = await Promise.all([
      riskForMachine(pool, id),
      pool.query(`SELECT * FROM alerts WHERE machine_id = $1 AND status IN ('open','reviewing') ORDER BY created_at DESC LIMIT 20`, [id]),
      pool.query('SELECT * FROM maintenance_records WHERE machine_id = $1 ORDER BY scheduled_at DESC, id DESC LIMIT 20', [id]),
      pool.query('SELECT * FROM machine_status_history WHERE machine_id = $1 ORDER BY changed_at DESC, id DESC LIMIT 50', [id])
    ]);
    res.json({ machine, risk: riskInfo.risk, latestMeasurements: riskInfo.latestMeasurements,
      openAlerts: alerts.rows, recentMaintenance: maintenance.rows, statusHistory: history.rows });
  });

  router.patch('/:id', async (req, res) => {
    const id = idParam(req.params.id, 'makine kimliği');
    const body = objectBody(req.body, ['code', 'name', 'status']);
    const fields = {};
    if (Object.hasOwn(body, 'code')) fields.code = codeValue(body.code);
    if (Object.hasOwn(body, 'name')) fields.name = plainText(body.name, 'Makine adı', 100);
    if (Object.hasOwn(body, 'status')) fields.status = oneOf(body.status, machineStatuses, 'Durum');
    const machine = await withTransaction(pool, async (client) => {
      const old = await activeMachine(client, id, true);
      const updated = await client.query(`UPDATE machines SET
        code = COALESCE($2, code), name = COALESCE($3, name), status = COALESCE($4, status)
        WHERE id = $1 RETURNING *`, [id, fields.code ?? null, fields.name ?? null, fields.status ?? null]);
      if (fields.status && fields.status !== old.status) {
        await client.query(`INSERT INTO machine_status_history
          (machine_id, previous_status, new_status, note) VALUES ($1,$2,$3,'Kullanıcı güncellemesi')`,
        [id, old.status, fields.status]);
      }
      return updated.rows[0];
    });
    res.json(machine);
  });

  router.delete('/:id', async (req, res) => {
    const id = idParam(req.params.id, 'makine kimliği');
    await withTransaction(pool, async (client) => {
      const result = await client.query('SELECT * FROM machines WHERE id = $1 FOR UPDATE', [id]);
      if (!result.rows.length) throw missing('Makine bulunamadı.');
      if (result.rows[0].archived_at) throw conflict('Makine zaten arşivlenmiş.');
      await client.query('UPDATE machines SET archived_at = NOW() WHERE id = $1', [id]);
    });
    res.status(204).end();
  });

  router.get('/:id/risk', async (req, res) => {
    const id = idParam(req.params.id, 'makine kimliği');
    const exists = await pool.query('SELECT 1 FROM machines WHERE id = $1', [id]);
    if (!exists.rows.length) throw missing('Makine bulunamadı.');
    res.json(await riskForMachine(pool, id));
  });

  router.get('/:id/measurements', async (req, res) => {
    const id = idParam(req.params.id, 'makine kimliği');
    const { page, limit, offset } = pagination(req.query);
    const exists = await pool.query('SELECT 1 FROM machines WHERE id = $1', [id]);
    if (!exists.rows.length) throw missing('Makine bulunamadı.');
    const args = [id];
    let where = 'machine_id = $1';
    if (req.query.kind) { args.push(oneOf(req.query.kind, Object.keys(metricUnits), 'Ölçüm türü')); where += ` AND kind = $${args.length}`; }
    const count = await pool.query(`SELECT COUNT(*) AS total FROM machine_measurements WHERE ${where}`, args);
    const result = await pool.query(`SELECT * FROM machine_measurements WHERE ${where} ORDER BY measured_at DESC, id DESC
      LIMIT $${args.length + 1} OFFSET $${args.length + 2}`, [...args, limit, offset]);
    res.json(collection(result.rows, count.rows[0].total, page, limit));
  });

  router.post('/:id/measurements', async (req, res) => {
    const id = idParam(req.params.id, 'makine kimliği');
    const body = objectBody(req.body, ['kind', 'value', 'unit', 'measured_at', 'source'], ['kind', 'value']);
    const kind = oneOf(body.kind, Object.keys(metricUnits), 'Ölçüm türü');
    const value = decimal(body.value, 'Ölçüm değeri');
    if (body.unit !== undefined && body.unit !== metricUnits[kind]) throw bad(`Bu ölçümün birimi ${metricUnits[kind]} olmalı.`);
    const measuredAt = body.measured_at === undefined ? new Date().toISOString() : timestamp(body.measured_at, 'Ölçüm zamanı');
    if (new Date(measuredAt).getTime() > Date.now() + 60_000) throw bad('Ölçüm zamanı gelecekte olamaz.');
    const source = body.source === undefined ? 'manual' : oneOf(body.source, ['manual', 'demo'], 'Veri kaynağı');
    const created = await withTransaction(pool, async (client) => {
      await activeMachine(client, id, true);
      const inserted = await client.query(`INSERT INTO machine_measurements
        (machine_id,kind,value,unit,measured_at,source) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [id, kind, value, metricUnits[kind], measuredAt, source]);
      const newest = await client.query(`SELECT * FROM machine_measurements WHERE machine_id = $1 AND kind = $2
        ORDER BY measured_at DESC, id DESC LIMIT 1`, [id, kind]);
      if (newest.rows[0].id === inserted.rows[0].id) {
        await reconcileMeasurementAlert(client, id, kind);
      }
      await reconcileQualityAlertsForMeasurement(client, id, measuredAt, analysisForBatch);
      return inserted.rows[0];
    });
    res.status(201).json(created);
  });

  router.get('/:id/thresholds', async (req, res) => {
    const id = idParam(req.params.id, 'makine kimliği');
    const exists = await pool.query('SELECT 1 FROM machines WHERE id = $1', [id]);
    if (!exists.rows.length) throw missing('Makine bulunamadı.');
    const result = await pool.query('SELECT * FROM machine_thresholds WHERE machine_id = $1 ORDER BY kind', [id]);
    res.json(result.rows);
  });

  router.put('/:id/thresholds/:kind', async (req, res) => {
    const id = idParam(req.params.id, 'makine kimliği');
    const kind = oneOf(req.params.kind, Object.keys(metricUnits), 'Ölçüm türü');
    const body = objectBody(req.body, ['warning_value', 'critical_value', 'is_demo', 'unit'], ['warning_value', 'critical_value']);
    const warning = decimal(body.warning_value, 'Uyarı eşiği');
    const critical = decimal(body.critical_value, 'Kritik eşik');
    if (critical <= warning) throw bad('Kritik eşik uyarı eşiğinden büyük olmalı.');
    if (body.unit !== undefined && body.unit !== metricUnits[kind]) throw bad(`Bu ölçümün birimi ${metricUnits[kind]} olmalı.`);
    if (body.is_demo !== undefined && typeof body.is_demo !== 'boolean') throw bad('Demo işareti doğru/yanlış olmalı.');
    const saved = await withTransaction(pool, async (client) => {
      await activeMachine(client, id, true);
      const result = await client.query(`INSERT INTO machine_thresholds
        (machine_id,kind,unit,warning_value,critical_value,is_demo) VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (machine_id,kind) DO UPDATE SET warning_value = EXCLUDED.warning_value,
          critical_value = EXCLUDED.critical_value, is_demo = EXCLUDED.is_demo RETURNING *`,
      [id, kind, metricUnits[kind], warning, critical, body.is_demo ?? false]);
      await reconcileMeasurementAlert(client, id, kind);
      return result.rows[0];
    });
    res.json(saved);
  });

  router.get('/:id/status-history', async (req, res) => {
    const id = idParam(req.params.id, 'makine kimliği');
    const { page, limit, offset } = pagination(req.query);
    const exists = await pool.query('SELECT 1 FROM machines WHERE id = $1', [id]);
    if (!exists.rows.length) throw missing('Makine bulunamadı.');
    const count = await pool.query('SELECT COUNT(*) AS total FROM machine_status_history WHERE machine_id = $1', [id]);
    const result = await pool.query(`SELECT * FROM machine_status_history WHERE machine_id = $1
      ORDER BY changed_at DESC, id DESC LIMIT $2 OFFSET $3`, [id, limit, offset]);
    res.json(collection(result.rows, count.rows[0].total, page, limit));
  });

  return router;
}
