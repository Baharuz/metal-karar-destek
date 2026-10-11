import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeBatch, evaluateMachineRisk } from '../src/rules.js';
import { idParam, timestamp } from '../src/lib.js';

const NOW = '2026-10-10T12:00:00.000Z';
const limits = [
  { metric: 'temperature_c', warning_value: 70, critical_value: 90, machine_id: '1' },
  { metric: 'vibration_mm_s', warning_value: 5, critical_value: 8, machine_id: '1' },
  { metric: 'runtime_hours', warning_value: 100, critical_value: 150, machine_id: '1' }
];

function risk(metric, value, measuredAt = NOW, additional = []) {
  return evaluateMachineRisk({
    now: NOW,
    staleHours: 24,
    thresholds: limits,
    measurements: [{ metric, value, measured_at: measuredAt }, ...additional]
  }).find(item => item.kind === metric);
}

test('eşik sınırında uyarı ve kritik durum tetiklenir; eşik altı normaldir', () => {
  assert.equal(risk('temperature_c', 69.9).state, 'normal');
  assert.equal(risk('temperature_c', 70).state, 'warning');
  assert.equal(risk('temperature_c', 90).state, 'critical');
  assert.equal(risk('temperature_c', 90).unit, '°C');
});

test('eksik, eski ve eşiği tanımlanmamış ölçüm sağlıklı gösterilmez', () => {
  const missing = evaluateMachineRisk({ now: NOW, thresholds: limits });
  assert.ok(missing.every(item => item.state === 'missing'));
  assert.equal(risk('vibration_mm_s', 2, '2026-10-09T11:59:59.000Z').state, 'stale');
  const unconfigured = evaluateMachineRisk({ now: NOW,
    measurements: [{ metric: 'vibration_mm_s', value: 2, measured_at: NOW }] });
  assert.equal(unconfigured.find(item => item.kind === 'vibration_mm_s').state, 'unconfigured');
});

test('geçmiş tarihli ölçüm son güncel ölçümü değiştirmez', () => {
  const current = risk('temperature_c', 70, NOW,
    [{ metric: 'temperature_c', value: 100, measured_at: '2026-10-01T00:00:00.000Z' }]);
  assert.equal(current.value, 70);
  assert.equal(current.state, 'warning');
});

const baseBatch = {
  id: '100', machine_id: '1', product_id: '3',
  started_at: '2026-10-10T08:00:00.000Z',
  ended_at: '2026-10-10T10:00:00.000Z',
  total_count: 100, defective_count: 20
};
const priorBatch = {
  id: '99', machine_id: '1', product_id: '3',
  started_at: '2026-10-09T08:00:00.000Z',
  ended_at: '2026-10-09T10:00:00.000Z',
  total_count: 100, defective_count: 5
};
const dimension = { id: '500', batch_id: '100', kind: 'dimension_out_of_tolerance', count: 30 };
const hotVibration = { id: '600', machine_id: '1', metric: 'vibration_mm_s', value: 8,
  measured_at: '2026-10-10T09:00:00.000Z' };

test('kural yalnızca parti tarih aralığındaki ölçümü kullanır', () => {
  const outside = { ...hotVibration, measured_at: '2026-10-10T07:59:59.000Z' };
  const noMatch = analyzeBatch({ batch: baseBatch, previousBatches: [priorBatch],
    qualityRecords: [dimension], measurements: [outside], thresholds: limits });
  assert.equal(noMatch.status, 'insufficient');
  assert.ok(!noMatch.findings.some(item => item.rule.includes('Titreşim')));
  const match = analyzeBatch({ batch: baseBatch, previousBatches: [priorBatch],
    qualityRecords: [dimension], measurements: [hotVibration], thresholds: limits });
  const finding = match.findings.find(item => item.rule.includes('Titreşim'));
  assert.ok(finding);
  assert.equal(finding.evidence.measurements[0].id, '600');
  assert.equal(finding.evidence.quality.occurrences, 30);
});

test('yeterli önceki üretim yoksa artış veya olası neden iddia edilmez', () => {
  const result = analyzeBatch({ batch: baseBatch, previousBatches: [],
    qualityRecords: [dimension], measurements: [hotVibration], thresholds: limits });
  assert.equal(result.status, 'insufficient');
  assert.equal(result.findings.length, 0);
  assert.ok(result.limitations.some(item => item.includes('en az 20')));
});

test('hata oranı kusur sayısından değil hatalı parça sayısından hesaplanır; önceki oran ağırlıklıdır', () => {
  const first = { ...priorBatch, id: '97', total_count: 20, defective_count: 4 };
  const second = { ...priorBatch, id: '98', total_count: 80, defective_count: 0 };
  const result = analyzeBatch({ batch: baseBatch, previousBatches: [first, second],
    qualityRecords: [dimension], measurements: [hotVibration], thresholds: limits });
  assert.equal(result.currentRate, 0.2);
  assert.equal(result.baselineRate, 0.04);
  assert.equal(result.findings[0].evidence.quality.occurrences, 30);
  assert.equal(result.findings[0].evidence.current.defective, 20);
});

test('gecikmiş bakım ile artan oran ayrı kural olarak raporlanır', () => {
  const result = analyzeBatch({ batch: baseBatch, previousBatches: [priorBatch],
    maintenance: [{ id: '700', machine_id: '1', status: 'planned', planned_at: '2026-10-08T00:00:00.000Z' }] });
  assert.ok(result.findings.some(item => item.rule === 'Gecikmiş bakım ve artan hata oranı'));
});

test('tam 5 yüzde puanlık artış sınırda da olası nedeni tetikler', () => {
  const current = { ...baseBatch, defective_count: 15 };
  const previous = { ...priorBatch, defective_count: 10 };
  const result = analyzeBatch({ batch: current, previousBatches: [previous],
    qualityRecords: [dimension], measurements: [hotVibration], thresholds: limits });
  assert.equal(result.currentRate, 0.15);
  assert.equal(result.baselineRate, 0.1);
  assert.ok(result.findings.some(item => item.rule === 'Titreşim ve ölçü kusuru'));
});

test('geçersiz takvim günü ISO zaman damgası olarak kabul edilmez', () => {
  assert.throws(() => timestamp('2026-02-30T10:00:00+03:00', 'Tarih'),
    error => error.status === 400);
  assert.equal(timestamp('2026-02-28T10:00:00+03:00', 'Tarih'), '2026-02-28T07:00:00.000Z');
});

test('API kimliği güvenli olmayan sayısal JS değerinden kabul edilmez', () => {
  assert.throws(() => idParam(9007199254740993, 'makine kimliği'),
    error => error.status === 400);
  assert.throws(() => idParam(1, 'makine kimliği'),
    error => error.status === 400);
  assert.equal(idParam('9007199254740993', 'makine kimliği'), '9007199254740993');
});

test('sıfır üretimli veya geçersiz adetli parti analiz edilmez', () => {
  for (const invalid of [
    { total_count: 0 }, { defective_count: 101 }, { total_count: 1.5 },
    { started_at: '2026-10-11T00:00:00.000Z' }
  ]) {
    const result = analyzeBatch({ batch: { ...baseBatch, ...invalid } });
    assert.equal(result.status, 'insufficient');
    assert.equal(result.currentRate, null);
  }
});
