import { Router } from 'express';
import { analyzeBatch } from './rules.js';
import { reconcileQualityAlert } from './qualityAlerts.js';
import {
  activeMachine, bad, codeValue, collection, conflict, countValue, dateFilterBound, idParam,
  missing, objectBody, oneOf, pagination, plainText, qualityKinds, timestamp, utcOffsetMinutes,
  withTransaction
} from './lib.js';

export async function analysisForBatch(pool, batch) {
  const qualityRecords = await pool.query('SELECT * FROM quality_records WHERE batch_id = $1 ORDER BY created_at, id', [batch.id]);
  const thresholds = await pool.query(`SELECT s.*, b.machine_id FROM batch_threshold_snapshots s
    JOIN production_batches b ON b.id = s.batch_id WHERE s.batch_id = $1 ORDER BY s.kind`, [batch.id]);
  if (!batch.ended_at) {
    return analyzeBatch({ batch, qualityRecords: qualityRecords.rows, thresholds: thresholds.rows });
  }
  // This function also receives a transaction client; query it sequentially.
  const measurements = await pool.query(`SELECT * FROM machine_measurements WHERE machine_id = $1 AND measured_at >= $2
      AND measured_at <= $3 ORDER BY measured_at, id`, [batch.machine_id, batch.started_at, batch.ended_at]);
  const previousBatches = await pool.query(`SELECT * FROM production_batches WHERE machine_id = $1 AND product_id = $2
      AND ended_at < $3 AND ended_at >= $3::timestamptz - INTERVAL '30 days'
      ORDER BY ended_at DESC, id DESC LIMIT 100`, [batch.machine_id, batch.product_id, batch.started_at]);
  const maintenance = await pool.query(`SELECT * FROM maintenance_records WHERE machine_id = $1 AND scheduled_at < $2
      AND (status = 'planned' OR completed_at > $2)`, [batch.machine_id, batch.ended_at]);
  const maintenanceAtBatchEnd = maintenance.rows.map((row) => ({ ...row, status: 'planned' }));
  return analyzeBatch({ batch, qualityRecords: qualityRecords.rows, measurements: measurements.rows,
    previousBatches: previousBatches.rows, maintenance: maintenanceAtBatchEnd,
    thresholds: thresholds.rows });
}

// A corrected historical batch can change the 30-day baseline of later batches.
// Reconcile both the old and new windows when its end time moves.
async function reconcileDependentBatchAlerts(client, batch, previousEnd = null) {
  const ends = [...new Set([previousEnd, batch.ended_at].filter(Boolean).map((value) => new Date(value).toISOString()))];
  if (!ends.length) return;
  const affected = await client.query(`SELECT * FROM production_batches
    WHERE machine_id = $1 AND product_id = $2 AND id <> $3 AND ended_at IS NOT NULL
      AND EXISTS (SELECT 1 FROM unnest($4::timestamptz[]) AS candidate(prior_end)
        WHERE started_at > candidate.prior_end
          AND started_at <= candidate.prior_end + INTERVAL '30 days')
    ORDER BY started_at, id FOR UPDATE`,
  [batch.machine_id, batch.product_id, batch.id, ends]);
  for (const later of affected.rows) {
    await reconcileQualityAlert(client, later, analysisForBatch);
  }
}

export function productRoutes(pool) {
  const router = Router();
  router.get('/', async (req, res) => {
    const { page, limit, offset } = pagination(req.query);
    const search = req.query.search ? `%${plainText(req.query.search, 'Arama', 100)}%` : null;
    const count = await pool.query(`SELECT COUNT(*) AS total FROM products
      WHERE $1::text IS NULL OR code ILIKE $1 OR name ILIKE $1`, [search]);
    const result = await pool.query(`SELECT * FROM products
      WHERE $1::text IS NULL OR code ILIKE $1 OR name ILIKE $1
      ORDER BY name, id LIMIT $2 OFFSET $3`, [search, limit, offset]);
    res.json(collection(result.rows, count.rows[0].total, page, limit));
  });
  router.post('/', async (req, res) => {
    const body = objectBody(req.body, ['code', 'name', 'description'], ['code', 'name']);
    const code = codeValue(body.code, 'Ürün kodu');
    const name = plainText(body.name, 'Ürün adı', 100);
    const description = body.description === undefined ? '' : plainText(body.description, 'Açıklama', 5000, false);
    const result = await pool.query(`INSERT INTO products (code, name, description)
      VALUES ($1,$2,$3) RETURNING *`, [code, name, description]);
    res.status(201).json(result.rows[0]);
  });
  router.get('/:id', async (req, res) => {
    const id = idParam(req.params.id, 'ürün kimliği');
    const result = await pool.query('SELECT * FROM products WHERE id = $1', [id]);
    if (!result.rows.length) throw missing('Ürün bulunamadı.');
    res.json(result.rows[0]);
  });
  router.patch('/:id', async (req, res) => {
    const id = idParam(req.params.id, 'ürün kimliği');
    const body = objectBody(req.body, ['code', 'name', 'description']);
    const code = Object.hasOwn(body, 'code') ? codeValue(body.code, 'Ürün kodu') : null;
    const name = Object.hasOwn(body, 'name') ? plainText(body.name, 'Ürün adı', 100) : null;
    const description = Object.hasOwn(body, 'description') ? plainText(body.description, 'Açıklama', 5000, false) : null;
    const result = await pool.query(`UPDATE products SET code = COALESCE($2, code),
      name = COALESCE($3, name), description = COALESCE($4, description)
      WHERE id = $1 RETURNING *`, [id, code, name, description]);
    if (!result.rows.length) throw missing('Ürün bulunamadı.');
    res.json(result.rows[0]);
  });
  return router;
}

export function batchRoutes(pool) {
  const router = Router();
  router.get('/', async (req, res) => {
    const { page, limit, offset } = pagination(req.query);
    const localOffset = utcOffsetMinutes(req.query.utcOffsetMinutes);
    const args = [];
    const where = [];
    if (req.query.machineId) {
      args.push(idParam(req.query.machineId, 'makine kimliği'));
      where.push(`b.machine_id = $${args.length}`);
    }
    if (req.query.productId) {
      args.push(idParam(req.query.productId, 'ürün kimliği'));
      where.push(`b.product_id = $${args.length}`);
    }
    if (req.query.from) {
      args.push(dateFilterBound(req.query.from, 'Başlangıç tarihi', false, localOffset));
      where.push(`b.started_at >= $${args.length}`);
    }
    if (req.query.to) {
      args.push(dateFilterBound(req.query.to, 'Bitiş tarihi', true, localOffset));
      where.push(`b.started_at < $${args.length}`);
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const totals = await pool.query(`SELECT COUNT(*) AS total,
      COALESCE(SUM(b.total_count),0) AS total_count,
      COALESCE(SUM(b.defective_count),0) AS defective_count
      FROM production_batches b ${clause}`, args);
    const rows = await pool.query(`SELECT b.*, m.code AS machine_code, m.name AS machine_name,
      p.code AS product_code, p.name AS product_name,
      CASE WHEN b.total_count = 0 THEN NULL ELSE b.defective_count::double precision / b.total_count END AS defect_rate
      FROM production_batches b JOIN machines m ON m.id = b.machine_id
      JOIN products p ON p.id = b.product_id ${clause}
      ORDER BY b.started_at DESC, b.id DESC LIMIT $${args.length + 1} OFFSET $${args.length + 2}`,
    [...args, limit, offset]);
    const t = totals.rows[0];
    const totalCount = Number(t.total_count);
    const defectiveCount = Number(t.defective_count);
    res.json({ ...collection(rows.rows, t.total, page, limit), summary: {
      total_count: totalCount, defective_count: defectiveCount,
      defect_rate: totalCount ? defectiveCount / totalCount : null
    } });
  });

  router.post('/', async (req, res) => {
    const body = objectBody(req.body,
      ['machine_id', 'product_id', 'started_at', 'ended_at', 'total_count', 'defective_count'],
      ['machine_id', 'product_id', 'started_at', 'total_count', 'defective_count']);
    const machineId = idParam(body.machine_id, 'makine kimliği');
    const productId = idParam(body.product_id, 'ürün kimliği');
    const started = timestamp(body.started_at, 'Parti başlangıcı');
    const ended = body.ended_at === undefined ? null : timestamp(body.ended_at, 'Parti bitişi', false);
    if (ended && new Date(ended) < new Date(started)) throw bad('Parti bitişi başlangıçtan önce olamaz.');
    const total = countValue(body.total_count, 'Toplam adet');
    const defective = countValue(body.defective_count, 'Hatalı adet');
    if (defective > total) throw bad('Hatalı adet toplam adetten fazla olamaz.');
    const batch = await withTransaction(pool, async (client) => {
      await activeMachine(client, machineId, true);
      const product = await client.query('SELECT 1 FROM products WHERE id = $1', [productId]);
      if (!product.rows.length) throw missing('Ürün bulunamadı.');
      const result = await client.query(`INSERT INTO production_batches
        (machine_id,product_id,started_at,ended_at,total_count,defective_count)
        VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [machineId, productId, started, ended, total, defective]);
      await reconcileQualityAlert(client, result.rows[0], analysisForBatch);
      await reconcileDependentBatchAlerts(client, result.rows[0]);
      return result.rows[0];
    });
    res.status(201).json(batch);
  });

  router.get('/:id', async (req, res) => {
    const id = idParam(req.params.id, 'parti kimliği');
    const result = await pool.query(`SELECT b.*, m.code AS machine_code, m.name AS machine_name,
      p.code AS product_code, p.name AS product_name,
      CASE WHEN b.total_count = 0 THEN NULL ELSE b.defective_count::double precision / b.total_count END AS defect_rate
      FROM production_batches b JOIN machines m ON m.id = b.machine_id
      JOIN products p ON p.id = b.product_id WHERE b.id = $1`, [id]);
    const batch = result.rows[0];
    if (!batch) throw missing('Üretim partisi bulunamadı.');
    const quality = await pool.query('SELECT * FROM quality_records WHERE batch_id = $1 ORDER BY created_at DESC, id DESC', [id]);
    const analysis = await analysisForBatch(pool, batch);
    res.json({ batch, qualityRecords: quality.rows, analysis });
  });

  router.patch('/:id', async (req, res) => {
    const id = idParam(req.params.id, 'parti kimliği');
    const body = objectBody(req.body, ['started_at', 'ended_at', 'total_count', 'defective_count']);
    const fields = {
      started: Object.hasOwn(body, 'started_at') ? timestamp(body.started_at, 'Parti başlangıcı') : null,
      ended: Object.hasOwn(body, 'ended_at') ? timestamp(body.ended_at, 'Parti bitişi', false) : null,
      total: Object.hasOwn(body, 'total_count') ? countValue(body.total_count, 'Toplam adet') : null,
      defective: Object.hasOwn(body, 'defective_count') ? countValue(body.defective_count, 'Hatalı adet') : null
    };
    const batch = await withTransaction(pool, async (client) => {
      const old = await client.query('SELECT * FROM production_batches WHERE id = $1 FOR UPDATE', [id]);
      if (!old.rows.length) throw missing('Üretim partisi bulunamadı.');
      await activeMachine(client, old.rows[0].machine_id, true);
      const started = fields.started ?? old.rows[0].started_at;
      const ended = Object.hasOwn(body, 'ended_at') ? fields.ended : old.rows[0].ended_at;
      const total = fields.total ?? old.rows[0].total_count;
      const defective = fields.defective ?? old.rows[0].defective_count;
      if (ended && new Date(ended) < new Date(started)) throw bad('Parti bitişi başlangıçtan önce olamaz.');
      if (defective > total) throw bad('Hatalı adet toplam adetten fazla olamaz.');
      const defectSums = await client.query(`SELECT kind, SUM(count) AS total FROM quality_records
        WHERE batch_id = $1 GROUP BY kind`, [id]);
      if (defectSums.rows.some((row) => Number(row.total) > defective)) {
        throw bad('Mevcut kusur türü sayısı yeni hatalı adet değerini aşıyor.');
      }
      const result = await client.query(`UPDATE production_batches SET started_at=$2, ended_at=$3,
        total_count=$4, defective_count=$5 WHERE id=$1 RETURNING *`,
      [id, started, ended, total, defective]);
      await reconcileQualityAlert(client, result.rows[0], analysisForBatch);
      await reconcileDependentBatchAlerts(client, result.rows[0], old.rows[0].ended_at);
      return result.rows[0];
    });
    res.json(batch);
  });

  router.get('/:id/quality', async (req, res) => {
    const id = idParam(req.params.id, 'parti kimliği');
    const { page, limit, offset } = pagination(req.query);
    const exists = await pool.query('SELECT 1 FROM production_batches WHERE id = $1', [id]);
    if (!exists.rows.length) throw missing('Üretim partisi bulunamadı.');
    const count = await pool.query('SELECT COUNT(*) AS total FROM quality_records WHERE batch_id = $1', [id]);
    const result = await pool.query(`SELECT * FROM quality_records WHERE batch_id = $1
      ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3`, [id, limit, offset]);
    res.json(collection(result.rows, count.rows[0].total, page, limit));
  });

  router.post('/:id/quality', async (req, res) => {
    const id = idParam(req.params.id, 'parti kimliği');
    const body = objectBody(req.body, ['kind', 'count', 'description'], ['kind', 'count']);
    const kind = oneOf(body.kind, qualityKinds, 'Kusur türü');
    const count = countValue(body.count, 'Kusur adedi');
    if (!count) throw bad('Kusur adedi sıfırdan büyük olmalı.');
    const description = body.description === undefined ? '' : plainText(body.description, 'Açıklama', 5000, false);
    const record = await withTransaction(pool, async (client) => {
      const batch = await client.query('SELECT * FROM production_batches WHERE id = $1 FOR UPDATE', [id]);
      if (!batch.rows.length) throw missing('Üretim partisi bulunamadı.');
      await activeMachine(client, batch.rows[0].machine_id, true);
      const current = await client.query('SELECT COALESCE(SUM(count),0) AS total FROM quality_records WHERE batch_id = $1 AND kind = $2', [id, kind]);
      if (Number(current.rows[0].total) + count > batch.rows[0].defective_count) {
        throw bad('Bu kusur türünün sayısı hatalı parça sayısını aşamaz. Bir parça farklı kusur türlerinde sayılabilir.');
      }
      const result = await client.query(`INSERT INTO quality_records (batch_id,kind,count,description)
        VALUES ($1,$2,$3,$4) RETURNING *`, [id, kind, count, description]);
      await reconcileQualityAlert(client, batch.rows[0], analysisForBatch);
      return result.rows[0];
    });
    res.status(201).json(record);
  });

  router.patch('/:id/quality/:qualityId', async (req, res) => {
    const batchId = idParam(req.params.id, 'parti kimliği');
    const qualityId = idParam(req.params.qualityId, 'kalite kaydı kimliği');
    const body = objectBody(req.body, ['kind', 'count', 'description']);
    const kind = Object.hasOwn(body, 'kind') ? oneOf(body.kind, qualityKinds, 'Kusur türü') : null;
    const count = Object.hasOwn(body, 'count') ? countValue(body.count, 'Kusur adedi') : null;
    if (count === 0) throw bad('Kusur adedi sıfırdan büyük olmalı.');
    const description = Object.hasOwn(body, 'description') ? plainText(body.description, 'Açıklama', 5000, false) : null;
    const updated = await withTransaction(pool, async (client) => {
      const batchResult = await client.query('SELECT * FROM production_batches WHERE id = $1 FOR UPDATE', [batchId]);
      const batch = batchResult.rows[0];
      if (!batch) throw missing('Üretim partisi bulunamadı.');
      await activeMachine(client, batch.machine_id, true);
      const oldResult = await client.query('SELECT * FROM quality_records WHERE id = $1 AND batch_id = $2 FOR UPDATE', [qualityId, batchId]);
      const old = oldResult.rows[0];
      if (!old) throw missing('Kalite kaydı bulunamadı.');
      const nextKind = kind ?? old.kind;
      const nextCount = count ?? old.count;
      const sameKind = await client.query(`SELECT COALESCE(SUM(count),0) AS total FROM quality_records
        WHERE batch_id = $1 AND kind = $2 AND id <> $3`, [batchId, nextKind, qualityId]);
      if (Number(sameKind.rows[0].total) + Number(nextCount) > batch.defective_count) {
        throw bad('Bu kusur türünün sayısı hatalı parça sayısını aşamaz.');
      }
      const result = await client.query(`UPDATE quality_records SET kind = $2, count = $3,
        description = COALESCE($4, description) WHERE id = $1 RETURNING *`,
      [qualityId, nextKind, nextCount, description]);
      await reconcileQualityAlert(client, batch, analysisForBatch);
      return result.rows[0];
    });
    res.json(updated);
  });

  router.delete('/:id/quality/:qualityId', async (req, res) => {
    const batchId = idParam(req.params.id, 'parti kimliği');
    const qualityId = idParam(req.params.qualityId, 'kalite kaydı kimliği');
    await withTransaction(pool, async (client) => {
      const batchResult = await client.query('SELECT * FROM production_batches WHERE id = $1 FOR UPDATE', [batchId]);
      const batch = batchResult.rows[0];
      if (!batch) throw missing('Üretim partisi bulunamadı.');
      await activeMachine(client, batch.machine_id, true);
      const removed = await client.query('DELETE FROM quality_records WHERE id = $1 AND batch_id = $2 RETURNING id',
        [qualityId, batchId]);
      if (!removed.rows.length) throw missing('Kalite kaydı bulunamadı.');
      await reconcileQualityAlert(client, batch, analysisForBatch);
    });
    res.status(204).end();
  });

  router.get('/:id/analysis', async (req, res) => {
    const id = idParam(req.params.id, 'parti kimliği');
    const result = await pool.query('SELECT * FROM production_batches WHERE id = $1', [id]);
    if (!result.rows.length) throw missing('Üretim partisi bulunamadı.');
    res.json(await analysisForBatch(pool, result.rows[0]));
  });
  router.post('/:id/analysis/refresh', async (req, res) => {
    const id = idParam(req.params.id, 'parti kimliği');
    const analysis = await withTransaction(pool, async (client) => {
      const result = await client.query('SELECT * FROM production_batches WHERE id = $1 FOR UPDATE', [id]);
      if (!result.rows.length) throw missing('Üretim partisi bulunamadı.');
      return reconcileQualityAlert(client, result.rows[0], analysisForBatch);
    });
    res.json(analysis);
  });
  return router;
}
