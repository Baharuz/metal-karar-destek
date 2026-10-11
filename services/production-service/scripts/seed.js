import { pool } from '../src/db.js';

const seedName = 'demo_v1';
const hour = 60 * 60 * 1000;
const ago = hours => new Date(Date.now() - hours * hour).toISOString();

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [874513001]);
    const existing = await client.query('SELECT 1 FROM demo_seed_runs WHERE name = $1', [seedName]);
    if (existing.rowCount) {
      await client.query('COMMIT');
      console.log('Sentetik demo verisi zaten yüklü; yeni kayıt eklenmedi.');
      return;
    }

    const machines = [
      ['DEMO-NORMAL', 'Demo · Normal Makine', 'running'],
      ['DEMO-RISK', 'Demo · Eşik Aşımı', 'running'],
      ['DEMO-STALE', 'Demo · Eski Veri', 'idle'],
      ['DEMO-MAINT', 'Demo · Bakımı Tamamlanan', 'maintenance']
    ];
    const ids = new Map();
    for (const [code, name, status] of machines) {
      const { rows } = await client.query(
        'INSERT INTO machines (code, name, status) VALUES ($1,$2,$3) RETURNING id',
        [code, name, status]
      );
      ids.set(code, rows[0].id);
      await client.query(
        'INSERT INTO machine_status_history (machine_id, previous_status, new_status, note) VALUES ($1,NULL,$2,$3)',
        [rows[0].id, status, 'Sentetik demo başlangıç durumu']
      );
    }

    const thresholdRows = [
      ['temperature_c', '°C', 75, 90],
      ['vibration_mm_s', 'mm/s', 4.5, 7.1],
      ['runtime_hours', 'h', 500, 1000]
    ];
    for (const machineId of ids.values()) {
      for (const [kind, unit, warning, critical] of thresholdRows) {
        await client.query(
          `INSERT INTO machine_thresholds
             (machine_id, kind, unit, warning_value, critical_value, is_demo)
           VALUES ($1,$2,$3,$4,$5,TRUE)`,
          [machineId, kind, unit, warning, critical]
        );
      }
    }

    const readings = [
      ['DEMO-NORMAL', 'temperature_c', 58, '°C', ago(2)],
      ['DEMO-NORMAL', 'vibration_mm_s', 2.1, 'mm/s', ago(2)],
      ['DEMO-NORMAL', 'runtime_hours', 62, 'h', ago(2)],
      ['DEMO-RISK', 'temperature_c', 75, '°C', ago(2)],
      ['DEMO-RISK', 'vibration_mm_s', 8.5, 'mm/s', ago(2)],
      ['DEMO-RISK', 'runtime_hours', 120, 'h', ago(2)],
      ['DEMO-STALE', 'temperature_c', 59, '°C', ago(96)],
      ['DEMO-MAINT', 'temperature_c', 62, '°C', ago(3)],
      ['DEMO-MAINT', 'vibration_mm_s', 2.6, 'mm/s', ago(3)]
    ];
    for (const [code, kind, value, unit, measuredAt] of readings) {
      await client.query(
        `INSERT INTO machine_measurements
           (machine_id, kind, value, unit, measured_at, source)
         VALUES ($1,$2,$3,$4,$5,'demo')`,
        [ids.get(code), kind, value, unit, measuredAt]
      );
    }
    await client.query(
      `INSERT INTO alerts
         (machine_id, kind, metric, dedup_key, severity, status, title, explanation, evidence)
       VALUES ($1,'measurement','vibration_mm_s','measurement:vibration_mm_s',
         'critical','open',$2,$3,$4::jsonb)`,
      [ids.get('DEMO-RISK'), 'Demo · Kritik titreşim uyarısı',
        'Sentetik titreşim 8,5 mm/s; demo kritik eşiği 7,1 mm/s.',
        JSON.stringify({ source: 'demo', measurement: 8.5, unit: 'mm/s', critical: 7.1 })]
    );

    const product = await client.query(
      `INSERT INTO products (code, name, description)
       VALUES ('DEMO-PARCA', 'Demo Parça', 'Sentetik kalite örneği') RETURNING id`
    );
    const productId = product.rows[0].id;
    const baseline = await client.query(
      `INSERT INTO production_batches
         (machine_id, product_id, started_at, ended_at, total_count, defective_count)
       VALUES ($1,$2,$3,$4,100,3) RETURNING id`,
      [ids.get('DEMO-RISK'), productId, ago(50), ago(48)]
    );
    const current = await client.query(
      `INSERT INTO production_batches
         (machine_id, product_id, started_at, ended_at, total_count, defective_count)
       VALUES ($1,$2,$3,$4,100,20) RETURNING id`,
      [ids.get('DEMO-RISK'), productId, ago(3), ago(1)]
    );
    await client.query(
      `INSERT INTO quality_records (batch_id, kind, count, description)
       VALUES ($1,'dimension_out_of_tolerance',18,'Sentetik ölçü toleransı bulgusu'),
              ($1,'surface_defect',10,'Sentetik yüzey bulgusu')`,
      [current.rows[0].id]
    );
    await client.query(
      `INSERT INTO alerts
         (machine_id, kind, metric, dedup_key, severity, status, title, explanation, evidence)
       VALUES ($1,'quality','defect_rate',$2,'warning','open',$3,$4,$5::jsonb)`,
      [ids.get('DEMO-RISK'), `quality:batch:${current.rows[0].id}`,
        'Demo · Artan hata oranı', 'Sentetik parti hata oranı önceki %3 düzeyinden %20 düzeyine çıktı.',
        JSON.stringify({ source: 'demo', current_batch_id: current.rows[0].id,
          previous_batch_id: baseline.rows[0].id, current_rate: 0.2, previous_rate: 0.03,
          note: 'Olası nedenler için parti analizine bakın.' })]
    );

    const overdue = await client.query(
      `INSERT INTO maintenance_records
         (machine_id, kind, status, scheduled_at, description)
       VALUES ($1,'preventive','planned',$2,'Sentetik gecikmiş bakım kontrolü') RETURNING id`,
      [ids.get('DEMO-RISK'), ago(26)]
    );
    await client.query(
      `INSERT INTO alerts
         (machine_id, kind, metric, dedup_key, severity, status, title, explanation, evidence)
       VALUES ($1,'maintenance',NULL,$2,'warning','open',$3,$4,$5::jsonb)`,
      [ids.get('DEMO-RISK'), `maintenance:${overdue.rows[0].id}`,
        'Demo · Gecikmiş bakım', 'Sentetik planlı bakım tarihi geçti.',
        JSON.stringify({ source: 'demo', maintenance_id: overdue.rows[0].id })]
    );
    const completed = await client.query(
      `INSERT INTO maintenance_records
         (machine_id, kind, status, scheduled_at, completed_at, description, action_taken)
       VALUES ($1,'corrective','completed',$2,$3,$4,$5) RETURNING id`,
      [ids.get('DEMO-MAINT'), ago(32), ago(8),
        'Sentetik titreşim kontrolü', 'Bağlama kontrol edildi, titreşim yeniden ölçüldü.']
    );
    await client.query(
      `INSERT INTO alerts
         (machine_id, kind, metric, dedup_key, severity, status, title,
          explanation, evidence, resolved_at, resolution_reason, resolved_by_maintenance_id)
       VALUES ($1,'measurement','vibration_mm_s','demo:resolved:vibration',
         'warning','resolved',$2,$3,$4::jsonb,$5,$6,$7)`,
      [ids.get('DEMO-MAINT'), 'Demo · Çözülmüş titreşim uyarısı',
        'Sentetik bakım öncesi titreşim uyarısı.',
        JSON.stringify({ source: 'demo', note: 'Sentetik geçmiş uyarı' }), ago(8),
        'İlgili bakım tamamlandı ve yeni ölçüm gözden geçirildi.', completed.rows[0].id]
    );

    await client.query('INSERT INTO demo_seed_runs (name) VALUES ($1)', [seedName]);
    await client.query('COMMIT');
    console.log('Sentetik demo verisi eklendi: 4 makine, 1 ürün, 2 parti, ölçümler, bakım ve uyarı.');
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') {
      throw new Error('DEMO kodlarından biri zaten kullanılıyor; mevcut kayıtlar değiştirilmedi.', { cause: error });
    }
    throw error;
  } finally {
    client.release();
  }
}

try {
  await main();
} catch (error) {
  console.error('Demo verisi yüklenemedi:', error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
