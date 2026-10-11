const QUALITY_AUTO_RESOLUTION = 'Güncel parti analizinde olası kalite nedeni bulgusu kalmadı.';

// Keep a user's completed review closed until the underlying finding changes.
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function findingEvidence(analysis) {
  return JSON.stringify(canonical(analysis?.findings ?? []));
}

/** Reconcile one batch's alert with the same analysis returned by the API. */
export async function reconcileQualityAlert(client, batch, analysisForBatch) {
  const analysis = await analysisForBatch(client, batch);
  const dedupKey = `quality:batch:${batch.id}`;
  const active = await client.query(`SELECT id FROM alerts
    WHERE machine_id = $1 AND dedup_key = $2 AND status IN ('open','reviewing')
    FOR UPDATE`, [batch.machine_id, dedupKey]);

  if (!analysis.findings.length) {
    if (active.rows.length) {
      await client.query(`UPDATE alerts SET status = 'resolved', resolved_at = NOW(),
        resolution_reason = $3, resolved_by_maintenance_id = NULL
        WHERE machine_id = $1 AND dedup_key = $2 AND status IN ('open','reviewing')`,
      [batch.machine_id, dedupKey, QUALITY_AUTO_RESOLUTION]);
    }
    return analysis;
  }

  const title = 'Partide olası kalite nedenleri';
  const explanation = `Parti analizinde ${analysis.findings.length} olası neden bulgusu incelenmeli.`;
  const evidence = JSON.stringify(analysis);
  if (active.rows.length) {
    await client.query(`UPDATE alerts SET severity = 'warning', title = $3,
      explanation = $4, evidence = $5::jsonb
      WHERE machine_id = $1 AND dedup_key = $2 AND status IN ('open','reviewing')`,
    [batch.machine_id, dedupKey, title, explanation, evidence]);
    return analysis;
  }

  const latest = await client.query(`SELECT evidence, resolution_reason FROM alerts
    WHERE machine_id = $1 AND dedup_key = $2
    ORDER BY created_at DESC, id DESC LIMIT 1 FOR UPDATE`, [batch.machine_id, dedupKey]);
  const previous = latest.rows[0];
  if (previous && previous.resolution_reason !== QUALITY_AUTO_RESOLUTION &&
      findingEvidence(previous.evidence) === findingEvidence(analysis)) {
    return analysis;
  }

  await client.query(`INSERT INTO alerts
    (machine_id, kind, metric, dedup_key, severity, title, explanation, evidence)
    VALUES ($1, 'quality', 'defect_rate', $2, 'warning', $3, $4, $5::jsonb)
    ON CONFLICT (machine_id, dedup_key) WHERE status IN ('open','reviewing')
    DO UPDATE SET severity = EXCLUDED.severity, title = EXCLUDED.title,
      explanation = EXCLUDED.explanation, evidence = EXCLUDED.evidence`,
  [batch.machine_id, dedupKey, title, explanation, evidence]);
  return analysis;
}

/** A historical reading may add or remove evidence for any overlapping completed batch. */
export async function reconcileQualityAlertsForMeasurement(client, machineId, measuredAt, analysisForBatch) {
  const batches = await client.query(`SELECT * FROM production_batches
    WHERE machine_id = $1 AND ended_at IS NOT NULL
      AND started_at <= $2 AND ended_at >= $2
    ORDER BY started_at, id`, [machineId, measuredAt]);
  for (const batch of batches.rows) {
    await reconcileQualityAlert(client, batch, analysisForBatch);
  }
}
