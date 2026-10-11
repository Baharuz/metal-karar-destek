// Açıklanabilir demo karar kuralları. Klinik/teknik arıza teşhisi değildir.
export const METRICS = Object.freeze({
  temperature_c: { label: 'Sıcaklık', unit: '°C', check: 'Soğutma ve işlem parametrelerini kontrol edin.' },
  vibration_mm_s: { label: 'Titreşim', unit: 'mm/s', check: 'Takım aşınmasını ve bağlamayı kontrol edin.' },
  runtime_hours: { label: 'Çalışma saati', unit: 'h', check: 'Planlı bakım zamanını ve kullanım kaydını kontrol edin.' }
});

const get = (row, ...keys) => keys.map(key => row?.[key]).find(value => value !== undefined && value !== null);
const date = value => {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};
const metricOf = row => get(row, 'metric', 'kind', 'measurement_type', 'type');
const measuredAt = row => get(row, 'measured_at', 'measuredAt');
const number = value => Number(value);

/** Latest reading per metric determines current risk; stale data never counts as normal. */
export function evaluateMachineRisk({ measurements = [], thresholds = [], now = new Date(), staleHours = 24 } = {}) {
  const currentTime = date(now);
  if (!currentTime || !Number.isFinite(staleHours) || staleHours <= 0) throw new Error('Geçersiz risk değerlendirme zamanı.');
  return Object.entries(METRICS).map(([kind, definition]) => {
    const readings = measurements.filter(row => metricOf(row) === kind && date(measuredAt(row)));
    readings.sort((a, b) => date(measuredAt(b)) - date(measuredAt(a)));
    const latest = readings[0];
    const setting = thresholds.find(row => metricOf(row) === kind);
    const warning = setting ? number(get(setting, 'warning_value', 'warningValue', 'warning')) : null;
    const critical = setting ? number(get(setting, 'critical_value', 'criticalValue', 'critical')) : null;
    const base = { kind, unit: definition.unit, value: latest ? number(get(latest, 'value')) : null,
      measuredAt: latest ? measuredAt(latest) : null, warning, critical,
      demoThreshold: setting ? Boolean(get(setting, 'is_demo', 'isDemo')) : null,
      recommendation: definition.check };
    if (!latest) return { ...base, state: 'missing', explanation: 'Ölçüm yok; durum değerlendirilemedi.' };
    const ageHours = (currentTime - date(measuredAt(latest))) / 3_600_000;
    if (ageHours > staleHours || ageHours < -1 / 60) {
      return { ...base, state: 'stale', explanation: `En son ölçüm güncel değil (${staleHours} saat sınırı).` };
    }
    if (!setting || !Number.isFinite(warning) || !Number.isFinite(critical) || warning >= critical) {
      return { ...base, state: 'unconfigured', explanation: 'Bu ölçüm için geçerli eşik tanımlanmamış.' };
    }
    if (!Number.isFinite(base.value)) return { ...base, state: 'missing', explanation: 'Ölçüm değeri geçersiz.' };
    const state = base.value >= critical ? 'critical' : base.value >= warning ? 'warning' : 'normal';
    const explanation = state === 'normal'
      ? `${definition.label} tanımlı ${base.demoThreshold ? 'demo ' : ''}uyarı eşiğinin altında.`
      : `${definition.label} ${base.value} ${definition.unit}; ${state === 'critical' ? 'kritik' : 'uyarı'} eşiğine (${state === 'critical' ? critical : warning} ${definition.unit}) ulaştı veya eşiği aştı.`;
    return { ...base, state, explanation };
  });
}

/**
 * Compare a batch with earlier batches of the same machine and product.
 * Defect records count defect occurrences, whereas error rate uses defective pieces.
 */
export function analyzeBatch({ batch, qualityRecords = [], measurements = [], previousBatches = [], maintenance = [], thresholds = [] } = {}) {
  const start = date(get(batch, 'started_at', 'startedAt', 'start_at'));
  const end = date(get(batch, 'ended_at', 'endedAt', 'end_at'));
  const total = number(get(batch, 'total_count', 'totalCount', 'total_quantity'));
  const defective = number(get(batch, 'defective_count', 'defectiveCount', 'defective_quantity'));
  const limitations = ['Bu sonuçlar örnek karar destek kurallarıdır; kesin neden veya arıza teşhisi değildir.'];
  if (!thresholds.length) limitations.push('Bu parti için eşik anlık görüntüsü yok; ölçüm eşiğine dayalı olası nedenler değerlendirilemedi.');
  const empty = { status: 'insufficient', currentRate: null, baselineRate: null,
    window: { start: start?.toISOString() ?? null, end: end?.toISOString() ?? null }, findings: [], limitations };
  if (!start || !end || end < start || !Number.isInteger(total) || total < 1 ||
      !Number.isInteger(defective) || defective < 0 || defective > total) {
    limitations.push('Analiz için geçerli tarih aralığı ve üretim adedi gerekli.');
    return empty;
  }
  const currentRate = defective / total;
  const peers = previousBatches.filter(row => {
    const priorEnd = date(get(row, 'ended_at', 'endedAt', 'end_at'));
    return priorEnd && priorEnd < start &&
      String(get(row, 'machine_id', 'machineId')) === String(get(batch, 'machine_id', 'machineId')) &&
      String(get(row, 'product_id', 'productId')) === String(get(batch, 'product_id', 'productId')) &&
      Number.isInteger(number(get(row, 'total_count', 'totalCount', 'total_quantity'))) &&
      number(get(row, 'total_count', 'totalCount', 'total_quantity')) > 0 &&
      Number.isInteger(number(get(row, 'defective_count', 'defectiveCount', 'defective_quantity'))) &&
      number(get(row, 'defective_count', 'defectiveCount', 'defective_quantity')) >= 0 &&
      number(get(row, 'defective_count', 'defectiveCount', 'defective_quantity')) <= number(get(row, 'total_count', 'totalCount', 'total_quantity'));
  });
  const baselineTotal = peers.reduce((sum, row) => sum + number(get(row, 'total_count', 'totalCount', 'total_quantity')), 0);
  const baselineDefective = peers.reduce((sum, row) => sum + number(get(row, 'defective_count', 'defectiveCount', 'defective_quantity')), 0);
  if (total < 20 || baselineTotal < 20 || !Number.isFinite(baselineDefective)) {
    limitations.push('Artış karşılaştırması için mevcut partide ve aynı makine/ürünün önceki partilerinde ayrı ayrı en az 20 üretilmiş parça gerekli.');
    return { ...empty, currentRate, baselineRate: baselineTotal ? baselineDefective / baselineTotal : null };
  }
  const baselineRate = baselineDefective / baselineTotal;
  // Compare the rational rates exactly: current - baseline >= 1/20.
  // Floating point subtraction can turn an exact 5-point rise into 0.049999...
  const rise = 20n * (BigInt(defective) * BigInt(baselineTotal) -
    BigInt(baselineDefective) * BigInt(total)) >= BigInt(total) * BigInt(baselineTotal);
  if (!rise) limitations.push('Hata oranında önceki döneme göre en az 5 yüzde puanlık artış gözlenmedi.');
  const within = value => { const time = date(value); return time && time >= start && time <= end; };
  const findings = [];
  const records = qualityRecords.filter(row =>
    String(get(row, 'batch_id', 'batchId')) === String(get(batch, 'id')));
  const observations = measurements.filter(row => within(measuredAt(row)) &&
    String(get(row, 'machine_id', 'machineId')) === String(get(batch, 'machine_id', 'machineId')));
  const priorStart = peers.reduce((min, row) => {
    const value = date(get(row, 'started_at', 'startedAt', 'start_at'));
    return value && (!min || value < min) ? value : min;
  }, null);
  const commonEvidence = { current: { total, defective, rate: currentRate, start: start.toISOString(), end: end.toISOString() },
    previous: { total: baselineTotal, defective: baselineDefective, rate: baselineRate,
      start: priorStart?.toISOString() ?? null,
      end: peers.reduce((max, row) => { const value = date(get(row, 'ended_at', 'endedAt', 'end_at')); return value && (!max || value > max) ? value : max; }, null)?.toISOString() ?? null } };

  for (const [kind, defectType, rule, cause, recommendation] of [
    ['vibration_mm_s', 'dimension_out_of_tolerance', 'Titreşim ve ölçü kusuru', 'Takım aşınması veya bağlama problemi olabilir.', 'Takımı, bağlamayı ve ölçüm sistemini kontrol edin.'],
    ['temperature_c', 'surface_defect', 'Sıcaklık ve yüzey kusuru', 'Soğutma veya işlem parametresi etkili olabilir.', 'Soğutmayı, kesme hızını ve yüzey kontrolünü gözden geçirin.']
  ]) {
    const defectRows = records.filter(row => get(row, 'kind', 'defect_type', 'defectType', 'type') === defectType);
    const defectOccurrences = defectRows.reduce((sum, row) => sum + number(get(row, 'count', 'quantity', 'defect_count') ?? 0), 0);
    const setting = thresholds.find(row => metricOf(row) === kind &&
      (get(row, 'batch_id', 'batchId') != null
        ? String(get(row, 'batch_id', 'batchId')) === String(get(batch, 'id'))
        : String(get(row, 'machine_id', 'machineId')) === String(get(batch, 'machine_id', 'machineId'))));
    const warning = number(get(setting, 'warning_value', 'warningValue', 'warning'));
    const thresholdCapturedAt = get(setting, 'captured_at', 'capturedAt');
    const elevated = observations.filter(row => metricOf(row) === kind && Number.isFinite(warning) && number(get(row, 'value')) >= warning);
    if (rise && defectOccurrences > 0 && elevated.length) {
      findings.push({ rule, possibleCause: cause, recommendedCheck: recommendation,
        evidence: { ...commonEvidence, quality: { defectType, occurrences: defectOccurrences, records: defectRows.map(row => get(row, 'id')) },
          measurements: elevated.map(row => ({ id: get(row, 'id'), value: number(get(row, 'value')), unit: METRICS[kind].unit,
            measuredAt: measuredAt(row), warning,
            threshold: { warning, captured_at: thresholdCapturedAt ? date(thresholdCapturedAt)?.toISOString() ?? null : null,
              is_demo: Boolean(get(setting, 'is_demo', 'isDemo')) } })) },
        limitations: ['Zaman çakışması tek başına nedensellik kanıtı değildir.', 'Kusur sayısı hatalı parça sayısından farklı olabilir.'] });
    }
  }

  const overdue = maintenance.filter(row => {
    const planned = date(get(row, 'planned_at', 'plannedAt', 'scheduled_at', 'scheduledAt'));
    return String(get(row, 'machine_id', 'machineId')) === String(get(batch, 'machine_id', 'machineId')) &&
      get(row, 'status') === 'planned' && planned && planned < end;
  });
  if (rise && overdue.length) {
    findings.push({ rule: 'Gecikmiş bakım ve artan hata oranı',
      possibleCause: 'Geciken bakım kalite değişimiyle ilişkili olabilir.',
      recommendedCheck: 'Gecikmiş bakım işlerini önceliklendirin ve kalite trendini yeniden ölçün.',
      evidence: { ...commonEvidence, maintenance: overdue.map(row => ({ id: get(row, 'id'), plannedAt: get(row, 'planned_at', 'plannedAt', 'scheduled_at', 'scheduledAt') })) },
      limitations: ['Birliktelik nedensellik kanıtı değildir.'] });
  }
  if (!observations.length) limitations.push('Parti tarih aralığında makine ölçümü yok.');
  if (!records.length) limitations.push('Bu partiye ait kalite kaydı yok.');
  if (!findings.length) limitations.push('Mevcut veriler örnek olası neden kurallarından hiçbirini tetiklemedi.');
  return { status: findings.length || (records.length && observations.length) ? 'evaluated' : 'insufficient', currentRate, baselineRate,
    window: { start: start.toISOString(), end: end.toISOString() }, findings, limitations };
}
