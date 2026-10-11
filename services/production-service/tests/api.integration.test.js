import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { createApp } from '../src/app.js';

function testDatabaseUrl(env) {
  if (env.TEST_DATABASE_URL) return env.TEST_DATABASE_URL;
  if (!env.TEST_PGHOST || !env.TEST_PGDATABASE || !env.TEST_PGUSER) return null;
  const url = new URL('postgresql://localhost/');
  url.hostname = env.TEST_PGHOST;
  url.port = env.TEST_PGPORT || '5432';
  url.username = env.TEST_PGUSER;
  url.password = env.TEST_PGPASSWORD || '';
  url.pathname = `/${env.TEST_PGDATABASE}`;
  return url.toString();
}

const databaseUrl = testDatabaseUrl(process.env);

if (!databaseUrl) {
  test('API integration testleri ayrı test DB ayarı olmadan atlanır', { skip: true }, () => {});
} else {
  const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
  if (!/_test$/.test(databaseName)) {
    throw new Error('TEST_DATABASE_URL yalnızca adı _test ile biten ayrı bir veritabanı olmalı.');
  }

  // migrate.js imports the application's default pool; ensure even that pool
  // points at the isolated test database before loading the module.
  process.env.DATABASE_URL = databaseUrl;
  const { runMigrations } = await import('../src/migrate.js');

  const pool = new pg.Pool({ connectionString: databaseUrl });
  const machineIds = [];
  const productIds = [];
  const prefix = `IT${randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase()}`;
  let server;
  let baseUrl;

  before(async () => {
    await runMigrations(pool);
    const app = createApp({ pool });
    server = await new Promise((resolve) => {
      const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    await new Promise((resolve) => server?.close(resolve) ?? resolve());
    try {
      if (machineIds.length) {
        await pool.query(`DELETE FROM quality_records WHERE batch_id IN
          (SELECT id FROM production_batches WHERE machine_id = ANY($1::bigint[]))`, [machineIds]);
        await pool.query(`DELETE FROM batch_threshold_snapshots WHERE batch_id IN
          (SELECT id FROM production_batches WHERE machine_id = ANY($1::bigint[]))`, [machineIds]);
        await pool.query('DELETE FROM production_batches WHERE machine_id = ANY($1::bigint[])', [machineIds]);
        await pool.query('DELETE FROM alerts WHERE machine_id = ANY($1::bigint[])', [machineIds]);
        await pool.query('DELETE FROM maintenance_records WHERE machine_id = ANY($1::bigint[])', [machineIds]);
        await pool.query('DELETE FROM machine_measurements WHERE machine_id = ANY($1::bigint[])', [machineIds]);
        await pool.query('DELETE FROM machine_thresholds WHERE machine_id = ANY($1::bigint[])', [machineIds]);
        await pool.query('DELETE FROM machine_status_history WHERE machine_id = ANY($1::bigint[])', [machineIds]);
        await pool.query('DELETE FROM machines WHERE id = ANY($1::bigint[])', [machineIds]);
      }
      if (productIds.length) {
        await pool.query('DELETE FROM products WHERE id = ANY($1::bigint[])', [productIds]);
      }
    } finally {
      await pool.end();
    }
  });

  async function api(method, path, body, raw = false) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : raw ? body : JSON.stringify(body)
    });
    const text = await response.text();
    let data;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: response.status, data, text };
  }

  async function machine(suffix, status = 'idle') {
    const created = await api('POST', '/api/machines', {
      code: `${prefix}-${suffix}`.toLowerCase(), name: `Test makinesi ${suffix}`, status
    });
    assert.equal(created.status, 201, created.text);
    machineIds.push(created.data.id);
    assert.equal(created.data.code, `${prefix}-${suffix}`);
    return created.data;
  }

  async function product(suffix) {
    const created = await api('POST', '/api/products', {
      code: `${prefix}-${suffix}`.toLowerCase(), name: `Test ürünü ${suffix}`
    });
    assert.equal(created.status, 201, created.text);
    productIds.push(created.data.id);
    return created.data;
  }

  test('makine CRUD, kısmi PATCH, mükerrer kod, bulunamayan kayıt ve arşivleme', async () => {
    const created = await machine('A');
    const duplicate = await api('POST', '/api/machines', {
      code: created.code, name: 'Tekrar', status: 'idle'
    });
    assert.equal(duplicate.status, 409);
    const patched = await api('PATCH', `/api/machines/${created.id}`, { name: 'Yeni ad' });
    assert.equal(patched.status, 200, patched.text);
    assert.equal(patched.data.name, 'Yeni ad');
    assert.equal(patched.data.code, created.code);
    const invalid = await api('PATCH', `/api/machines/${created.id}`, {});
    assert.equal(invalid.status, 400);
    assert.equal((await api('GET', '/api/machines/9223372036854775807')).status, 404);
    assert.equal((await api('GET', '/api/machines/9223372036854775808')).status, 400);
    const linked = await api('POST', `/api/machines/${created.id}/measurements`,
      { kind: 'temperature_c', value: 40 });
    assert.equal(linked.status, 201, linked.text);
    const archived = await api('DELETE', `/api/machines/${created.id}`);
    assert.equal(archived.status, 204);
    assert.equal(archived.data, null);
    assert.equal((await api('POST', `/api/machines/${created.id}/measurements`,
      { kind: 'temperature_c', value: 50 })).status, 409);
    const detail = await api('GET', `/api/machines/${created.id}`);
    assert.ok(detail.data.machine.archived_at);
  });

  test('bozuk JSON, geçersiz gövde ve bilinmeyen yol standart JSON hata döndürür', async () => {
    for (const result of [
      await api('POST', '/api/machines', '{', true),
      await api('POST', '/api/machines', []),
      await api('GET', '/api/bilinmeyen')
    ]) {
      assert.ok([400, 404].includes(result.status));
      assert.equal(typeof result.data, 'object');
      assert.ok(result.data.message || result.data.error?.message);
    }
  });

  test('ölçüm sınırı ve tekrarlı uyarı kontrolü', async () => {
    const created = await machine('B', 'running');
    const time = new Date().toISOString();
    const first = await api('POST', `/api/machines/${created.id}/measurements`,
      { kind: 'vibration_mm_s', value: 4.5, unit: 'mm/s', measured_at: time });
    assert.equal(first.status, 201, first.text);
    const second = await api('POST', `/api/machines/${created.id}/measurements`,
      { kind: 'vibration_mm_s', value: 5, measured_at: new Date(Date.now() + 1000).toISOString() });
    assert.equal(second.status, 201, second.text);
    const alerts = await api('GET', `/api/machines/${created.id}/alerts?status=open`);
    assert.equal(alerts.data.pagination.total, 1);
    const history = await api('POST', `/api/machines/${created.id}/measurements`,
      { kind: 'vibration_mm_s', value: 2, measured_at: '2020-01-01T00:00:00.000Z' });
    assert.equal(history.status, 201, history.text);
    const risk = await api('GET', `/api/machines/${created.id}/risk`);
    assert.equal(risk.data.risk.find(item => item.kind === 'vibration_mm_s').state, 'warning');
    assert.equal((await api('GET', `/api/machines/${created.id}/alerts?status=open`)).data.pagination.total, 1);
  });

  test('baştan sona üretim, kalite, olası neden, bakım ve seçili uyarı çözümü', async () => {
    const m = await machine('C', 'running');
    const p = await product('P');
    const priorStart = new Date(Date.now() - 50 * 3600_000).toISOString();
    const priorEnd = new Date(Date.now() - 48 * 3600_000).toISOString();
    const currentStart = new Date(Date.now() - 3 * 3600_000).toISOString();
    const currentEnd = new Date(Date.now() - 1 * 3600_000).toISOString();
    const readingTime = new Date(Date.now() - 2 * 3600_000).toISOString();
    const prior = await api('POST', '/api/batches', { machine_id: m.id, product_id: p.id,
      started_at: priorStart, ended_at: priorEnd, total_count: 100, defective_count: 3 });
    assert.equal(prior.status, 201, prior.text);
    const current = await api('POST', '/api/batches', { machine_id: m.id, product_id: p.id,
      started_at: currentStart, ended_at: currentEnd, total_count: 100, defective_count: 20 });
    assert.equal(current.status, 201, current.text);
    const invalidBatch = await api('POST', '/api/batches', { machine_id: m.id, product_id: p.id,
      started_at: currentStart, ended_at: currentEnd, total_count: 10, defective_count: 11 });
    assert.equal(invalidBatch.status, 400);
    assert.equal((await api('POST', `/api/machines/${m.id}/measurements`, {
      kind: 'vibration_mm_s', value: 7.1, measured_at: readingTime })).status, 201);
    assert.equal((await api('POST', `/api/machines/${m.id}/measurements`, {
      kind: 'temperature_c', value: 75, measured_at: readingTime })).status, 201);
    const dimension = await api('POST', `/api/batches/${current.data.id}/quality`, {
      kind: 'dimension_out_of_tolerance', count: 18, description: 'Test ölçü kusuru' });
    assert.equal(dimension.status, 201, dimension.text);
    const surface = await api('POST', `/api/batches/${current.data.id}/quality`, {
      kind: 'surface_defect', count: 10, description: 'Test yüzey kusuru' });
    assert.equal(surface.status, 201, surface.text);
    const listed = await api('GET', `/api/batches?machineId=${m.id}&productId=${p.id}&limit=1`);
    assert.equal(listed.data.summary.total_count, 200);
    assert.equal(listed.data.summary.defective_count, 23);
    assert.equal(listed.data.summary.defect_rate, 23 / 200);
    assert.equal(listed.data.pagination.total, 2);
    const noProduction = await api('GET', '/api/batches?from=1900-01-01&to=1900-01-31');
    assert.equal(noProduction.data.summary.total_count, 0);
    assert.equal(noProduction.data.summary.defect_rate, null);
    const analysis = await api('GET', `/api/batches/${current.data.id}/analysis`);
    assert.equal(analysis.status, 200, analysis.text);
    assert.ok(analysis.data.findings.some(item => item.rule.includes('Titreşim')));
    assert.ok(analysis.data.findings.some(item => item.rule.includes('Sıcaklık')));
    const open = await api('GET', `/api/machines/${m.id}/alerts?status=open`);
    assert.equal(open.data.pagination.total, 3);
    assert.deepEqual(new Set(open.data.items.map(item => item.kind)), new Set(['measurement', 'quality']));
    assert.ok(open.data.items.some(item => item.metric === 'temperature_c'));
    assert.ok(open.data.items.some(item => item.metric === 'defect_rate'));
    const selected = open.data.items.find(item => item.metric === 'vibration_mm_s');
    const scheduled = await api('POST', '/api/maintenance', { machine_id: m.id,
      kind: 'corrective', scheduled_at: new Date().toISOString(), description: 'Test bakım işi' });
    assert.equal(scheduled.status, 201, scheduled.text);
    const finished = await api('POST', `/api/maintenance/${scheduled.data.id}/complete`, {
      action_taken: 'Bağlama kontrol edildi', resolved_alert_ids: [selected.id],
      resolution_reason: 'Titreşim yeniden ölçüldü ve kontrol edildi.'
    });
    assert.equal(finished.status, 200, finished.text);
    const remaining = await api('GET', `/api/machines/${m.id}/alerts?status=open`);
    assert.equal(remaining.data.pagination.total, 2);
    assert.deepEqual(new Set(remaining.data.items.map(item => item.metric)),
      new Set(['temperature_c', 'defect_rate']));
  });

  test('gövde ID değerleri metin olmalı; geçersiz takvim günü reddedilir', async () => {
    const m = await machine('VALIDATION');
    const p = await product('VALIDATION');
    const time = new Date().toISOString();
    for (const body of [
      { machine_id: 9007199254740993, product_id: p.id, started_at: time,
        total_count: 20, defective_count: 1 },
      { machine_id: m.id, product_id: 1, started_at: time,
        total_count: 20, defective_count: 1 },
      { machine_id: m.id, product_id: p.id, started_at: '2026-02-30T10:00:00+03:00',
        total_count: 20, defective_count: 1 }
    ]) {
      const result = await api('POST', '/api/batches', body);
      assert.equal(result.status, 400, result.text);
    }
    assert.equal((await api('GET', '/api/batches?from=2026-02-30')).status, 400);
    assert.equal((await api('GET', '/api/dashboard?from=2026-02-30')).status, 400);
    const planned = await api('POST', '/api/maintenance', { machine_id: m.id,
      kind: 'inspection', scheduled_at: time, description: 'Kimlik doğrulama testi' });
    assert.equal(planned.status, 201, planned.text);
    const invalidAlertId = await api('POST', `/api/maintenance/${planned.data.id}/complete`, {
      action_taken: 'Kontrol tamamlandı', resolved_alert_ids: [9007199254740993],
      resolution_reason: 'Kontrol edildi'
    });
    assert.equal(invalidAlertId.status, 400, invalidAlertId.text);
  });

  test('eşik değişikliği mevcut ölçüm uyarısını çözer veya yeniden açar ve demo kanıtını korur', async () => {
    const m = await machine('THRESHOLD', 'running');
    const measure = await api('POST', `/api/machines/${m.id}/measurements`,
      { kind: 'temperature_c', value: 95 });
    assert.equal(measure.status, 201, measure.text);
    const initial = await api('GET', `/api/machines/${m.id}/alerts?status=open&kind=measurement`);
    assert.equal(initial.data.pagination.total, 1);
    assert.equal(initial.data.items[0].severity, 'critical');

    const raised = await api('PUT', `/api/machines/${m.id}/thresholds/temperature_c`,
      { warning_value: 100, critical_value: 120, is_demo: false });
    assert.equal(raised.status, 200, raised.text);
    const normal = await api('GET', `/api/machines/${m.id}/risk`);
    assert.equal(normal.data.risk.find(item => item.kind === 'temperature_c').state, 'normal');
    assert.equal((await api('GET', `/api/machines/${m.id}/alerts?status=open&kind=measurement`)).data.pagination.total, 0);

    const lowered = await api('PUT', `/api/machines/${m.id}/thresholds/temperature_c`,
      { warning_value: 50, critical_value: 80, is_demo: false });
    assert.equal(lowered.status, 200, lowered.text);
    const reopened = await api('GET', `/api/machines/${m.id}/alerts?status=open&kind=measurement`);
    assert.equal(reopened.data.pagination.total, 1);
    assert.equal(reopened.data.items[0].severity, 'critical');
    assert.equal(reopened.data.items[0].evidence.demo_threshold, false);
    assert.equal(Number(reopened.data.items[0].evidence.warning), 50);
  });

  test('kalite kaydı önce, ilgili ölçüm sonra girilince uyarı oluşur; düzeltmeler kanıtı yeniler', async () => {
    const m = await machine('QUALITY-ORDER', 'running');
    const p = await product('QUALITY-ORDER');
    const prior = await api('POST', '/api/batches', { machine_id: m.id, product_id: p.id,
      started_at: new Date(Date.now() - 3_600_000).toISOString(),
      ended_at: new Date(Date.now() - 1_800_000).toISOString(),
      total_count: 100, defective_count: 10 });
    assert.equal(prior.status, 201, prior.text);
    const startedAt = new Date().toISOString();
    const endedAt = new Date(Date.now() + 10).toISOString();
    const current = await api('POST', '/api/batches', { machine_id: m.id, product_id: p.id,
      started_at: startedAt, ended_at: endedAt, total_count: 100, defective_count: 15 });
    assert.equal(current.status, 201, current.text);
    const defect = await api('POST', `/api/batches/${current.data.id}/quality`,
      { kind: 'dimension_out_of_tolerance', count: 8 });
    assert.equal(defect.status, 201, defect.text);
    assert.equal((await api('GET', `/api/machines/${m.id}/alerts?status=open&kind=quality`)).data.pagination.total, 0);
    const measure = await api('POST', `/api/machines/${m.id}/measurements`,
      { kind: 'vibration_mm_s', value: 5, measured_at: endedAt });
    assert.equal(measure.status, 201, measure.text);
    let alerts = await api('GET', `/api/machines/${m.id}/alerts?status=open&kind=quality`);
    assert.equal(alerts.data.pagination.total, 1, alerts.text);
    assert.equal(alerts.data.items[0].evidence.findings[0].evidence.quality.occurrences, 8);

    const changedBaseline = await api('PATCH', `/api/batches/${prior.data.id}`, { defective_count: 20 });
    assert.equal(changedBaseline.status, 200, changedBaseline.text);
    assert.equal((await api('GET', `/api/machines/${m.id}/alerts?status=open&kind=quality`)).data.pagination.total, 0);
    const restoredBaseline = await api('PATCH', `/api/batches/${prior.data.id}`, { defective_count: 10 });
    assert.equal(restoredBaseline.status, 200, restoredBaseline.text);
    assert.equal((await api('GET', `/api/machines/${m.id}/alerts?status=open&kind=quality`)).data.pagination.total, 1);

    const changed = await api('PATCH', `/api/batches/${current.data.id}/quality/${defect.data.id}`,
      { count: 12, description: 'Düzeltilen kusur adedi' });
    assert.equal(changed.status, 200, changed.text);
    alerts = await api('GET', `/api/machines/${m.id}/alerts?status=open&kind=quality`);
    assert.equal(alerts.data.pagination.total, 1);
    assert.equal(alerts.data.items[0].evidence.findings[0].evidence.quality.occurrences, 12);

    const renamed = await api('PATCH', `/api/products/${p.id}`,
      { name: 'Düzeltilen ürün adı' });
    assert.equal(renamed.status, 200, renamed.text);
    assert.equal(renamed.data.name, 'Düzeltilen ürün adı');
    assert.equal((await api('PATCH', `/api/batches/${current.data.id}`,
      { defective_count: 10 })).status, 400);
    const fixedDefect = await api('PATCH', `/api/batches/${current.data.id}/quality/${defect.data.id}`,
      { count: 5 });
    assert.equal(fixedDefect.status, 200, fixedDefect.text);
    const fixedBatch = await api('PATCH', `/api/batches/${current.data.id}`,
      { defective_count: 10 });
    assert.equal(fixedBatch.status, 200, fixedBatch.text);
    assert.equal((await api('GET', `/api/machines/${m.id}/alerts?status=open&kind=quality`)).data.pagination.total, 0);
    const analysis = await api('GET', `/api/batches/${current.data.id}/analysis`);
    assert.equal(analysis.data.findings.length, 0);
    const removed = await api('DELETE', `/api/batches/${current.data.id}/quality/${defect.data.id}`);
    assert.equal(removed.status, 204, removed.text);
    assert.equal((await api('GET', `/api/batches/${current.data.id}/quality`)).data.pagination.total, 0);
    const zeroed = await api('PATCH', `/api/batches/${current.data.id}`, { defective_count: 0 });
    assert.equal(zeroed.status, 200, zeroed.text);
  });

  test('bitişi eksik parti tamamlanınca analiz oluşur; sonraki eşik değişimi geçmiş sonucu değiştirmez', async () => {
    const m = await machine('HISTORY', 'running');
    const p = await product('HISTORY');
    const prior = await api('POST', '/api/batches', { machine_id: m.id, product_id: p.id,
      started_at: new Date(Date.now() - 3_600_000).toISOString(),
      ended_at: new Date(Date.now() - 1_800_000).toISOString(),
      total_count: 100, defective_count: 10 });
    assert.equal(prior.status, 201, prior.text);
    const current = await api('POST', '/api/batches', { machine_id: m.id, product_id: p.id,
      started_at: new Date().toISOString(), total_count: 100, defective_count: 15 });
    assert.equal(current.status, 201, current.text);
    const defect = await api('POST', `/api/batches/${current.data.id}/quality`,
      { kind: 'dimension_out_of_tolerance', count: 8 });
    assert.equal(defect.status, 201, defect.text);
    const measure = await api('POST', `/api/machines/${m.id}/measurements`,
      { kind: 'vibration_mm_s', value: 5 });
    assert.equal(measure.status, 201, measure.text);
    const unfinished = await api('GET', `/api/batches/${current.data.id}/analysis`);
    assert.equal(unfinished.data.status, 'insufficient');
    const completed = await api('PATCH', `/api/batches/${current.data.id}`,
      { ended_at: new Date().toISOString() });
    assert.equal(completed.status, 200, completed.text);
    const before = await api('GET', `/api/batches/${current.data.id}/analysis`);
    assert.ok(before.data.findings.some(item => item.rule === 'Titreşim ve ölçü kusuru'));
    const changed = await api('PUT', `/api/machines/${m.id}/thresholds/vibration_mm_s`,
      { warning_value: 6, critical_value: 9, is_demo: false });
    assert.equal(changed.status, 200, changed.text);
    const after = await api('GET', `/api/batches/${current.data.id}/analysis`);
    assert.ok(after.data.findings.some(item => item.rule === 'Titreşim ve ölçü kusuru'));
    assert.equal(after.data.findings[0].evidence.measurements[0].warning, 4.5);
  });

  test('bakım ertelenince gecikme uyarısı kapanır; tarih filtresi UTC ofsetini kullanır', async () => {
    const m = await machine('MAINTENANCE-TIME');
    const p = await product('MAINTENANCE-TIME');
    const overdue = await api('POST', '/api/maintenance', { machine_id: m.id,
      kind: 'preventive', scheduled_at: new Date(Date.now() - 3_600_000).toISOString(),
      description: 'Ertelenecek bakım' });
    assert.equal(overdue.status, 201, overdue.text);
    assert.equal((await api('GET', `/api/machines/${m.id}/alerts?status=open&kind=maintenance`)).data.pagination.total, 1);
    const postponed = await api('PATCH', `/api/maintenance/${overdue.data.id}`,
      { scheduled_at: new Date(Date.now() + 86_400_000).toISOString() });
    assert.equal(postponed.status, 200, postponed.text);
    assert.equal((await api('GET', `/api/machines/${m.id}/alerts?status=open&kind=maintenance`)).data.pagination.total, 0);

    const lateNight = await api('POST', '/api/batches', { machine_id: m.id, product_id: p.id,
      started_at: '2026-01-01T22:30:00.000Z', total_count: 25, defective_count: 2 });
    assert.equal(lateNight.status, 201, lateNight.text);
    const localDay = await api('GET', `/api/batches?machineId=${m.id}&from=2026-01-02&to=2026-01-02&utcOffsetMinutes=180`);
    assert.equal(localDay.status, 200, localDay.text);
    assert.ok(localDay.data.items.some(item => item.id === lateNight.data.id));
    const utcDay = await api('GET', `/api/batches?machineId=${m.id}&from=2026-01-02&to=2026-01-02&utcOffsetMinutes=0`);
    assert.equal(utcDay.status, 200, utcDay.text);
    assert.ok(!utcDay.data.items.some(item => item.id === lateNight.data.id));
    const dashboard = await api('GET', '/api/dashboard?from=2026-01-02&to=2026-01-02&utcOffsetMinutes=180');
    assert.equal(dashboard.status, 200, dashboard.text);
    assert.ok(dashboard.data.trend.quality.some(item => item.day === '2026-01-02' && item.total_count >= 25));
  });
}
