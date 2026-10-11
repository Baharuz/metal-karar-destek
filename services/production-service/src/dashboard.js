import { Router } from 'express';
import { bad, dateFilterBound, utcOffsetMinutes } from './lib.js';

function dateBound(value, label, end = false, offsetMinutes = 0) {
  if (!value) return null;
  return dateFilterBound(value, label, end, offsetMinutes);
}

export function dashboardRoutes(pool) {
  const router = Router();
  router.get('/', async (req, res) => {
    const localOffset = utcOffsetMinutes(req.query.utcOffsetMinutes);
    const from = dateBound(req.query.from, 'Başlangıç tarihi', false, localOffset) || new Date(Date.now() - 30 * 86400_000).toISOString();
    const to = dateBound(req.query.to, 'Bitiş tarihi', true, localOffset) || new Date().toISOString();
    if (new Date(to) < new Date(from)) throw bad('Bitiş tarihi başlangıçtan önce olamaz.');
    const [machines, alerts, maintenance, production, measurements, quality] = await Promise.all([
      pool.query(`SELECT COUNT(*) FILTER (WHERE archived_at IS NULL) AS total,
        COUNT(*) FILTER (WHERE archived_at IS NULL AND status = 'running') AS running,
        COUNT(*) FILTER (WHERE archived_at IS NULL AND status = 'idle') AS idle,
        COUNT(*) FILTER (WHERE archived_at IS NULL AND status = 'maintenance') AS maintenance,
        COUNT(*) FILTER (WHERE archived_at IS NOT NULL) AS archived FROM machines`),
      pool.query(`SELECT COUNT(*) FILTER (WHERE a.status = 'open') AS open,
        COUNT(*) FILTER (WHERE a.status = 'reviewing') AS reviewing
        FROM alerts a JOIN machines m ON m.id = a.machine_id WHERE m.archived_at IS NULL`),
      pool.query(`SELECT COUNT(*) FILTER (WHERE r.scheduled_at < NOW()) AS overdue,
        COUNT(*) FILTER (WHERE r.scheduled_at >= NOW() AND r.scheduled_at < NOW() + INTERVAL '7 days') AS upcoming
        FROM maintenance_records r JOIN machines m ON m.id = r.machine_id
        WHERE r.status = 'planned' AND m.archived_at IS NULL`),
      pool.query(`SELECT COALESCE(SUM(total_count),0) AS total_count,
        COALESCE(SUM(defective_count),0) AS defective_count
        FROM production_batches WHERE started_at >= $1 AND started_at < $2`, [from, to]),
      pool.query(`SELECT TO_CHAR((measured_at AT TIME ZONE 'UTC') + ($3::integer * INTERVAL '1 minute'), 'YYYY-MM-DD') AS day,
        kind, AVG(value)::double precision AS average_value, MIN(unit) AS unit
        FROM machine_measurements WHERE measured_at >= $1 AND measured_at < $2
        GROUP BY day, kind ORDER BY day, kind`, [from, to, localOffset]),
      pool.query(`SELECT TO_CHAR((started_at AT TIME ZONE 'UTC') + ($3::integer * INTERVAL '1 minute'), 'YYYY-MM-DD') AS day,
        SUM(total_count)::bigint AS total_count, SUM(defective_count)::bigint AS defective_count
        FROM production_batches WHERE started_at >= $1 AND started_at < $2
        GROUP BY day ORDER BY day`, [from, to, localOffset])
    ]);
    const productionTotal = Number(production.rows[0].total_count);
    const productionDefective = Number(production.rows[0].defective_count);
    res.json({
      period: { from, to },
      machines: Object.fromEntries(Object.entries(machines.rows[0]).map(([key, value]) => [key, Number(value)])),
      alerts: Object.fromEntries(Object.entries(alerts.rows[0]).map(([key, value]) => [key, Number(value)])),
      maintenance: Object.fromEntries(Object.entries(maintenance.rows[0]).map(([key, value]) => [key, Number(value)])),
      production: { total_count: productionTotal, defective_count: productionDefective,
        defect_rate: productionTotal ? productionDefective / productionTotal : null },
      trend: { measurements: measurements.rows, quality: quality.rows.map((row) => ({
        day: row.day, total_count: Number(row.total_count), defective_count: Number(row.defective_count),
        defect_rate: Number(row.total_count) ? Number(row.defective_count) / Number(row.total_count) : null
      })) }
    });
  });
  return router;
}
