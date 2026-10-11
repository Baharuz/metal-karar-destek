export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const bad = (message, details) => new ApiError(400, 'VALIDATION_ERROR', message, details);
export const missing = (message = 'Kayıt bulunamadı.') => new ApiError(404, 'NOT_FOUND', message);
export const conflict = (message) => new ApiError(409, 'CONFLICT', message);

export const metricUnits = Object.freeze({ temperature_c: '°C', vibration_mm_s: 'mm/s', runtime_hours: 'h' });
export const machineStatuses = ['idle', 'running', 'maintenance'];
export const maintenanceKinds = ['preventive', 'corrective', 'inspection'];
export const qualityKinds = ['burr', 'surface_defect', 'dimension_out_of_tolerance'];
export const alertStatuses = ['open', 'reviewing', 'resolved'];

export function objectBody(body, allowed, required = []) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw bad('JSON gövdesi bir nesne olmalı.');
  const unknown = Object.keys(body).filter((key) => !allowed.includes(key));
  if (unknown.length) throw bad('Bilinmeyen alanlar var.', { fields: unknown });
  if (!Object.keys(body).length) throw bad('En az bir alan gönderilmeli.');
  const absent = required.filter((key) => !Object.hasOwn(body, key));
  if (absent.length) throw bad('Zorunlu alanlar eksik.', { fields: absent });
  return body;
}

export function idParam(input, label = 'kimlik') {
  // JSON numbers above 2^53 can already be rounded before validation.
  if (typeof input !== 'string' || !/^[1-9]\d*$/.test(input) || BigInt(input) > 9223372036854775807n) {
    throw bad(`Geçersiz ${label}.`);
  }
  return input;
}

export function plainText(value, label, max = 5000, required = true) {
  if (typeof value !== 'string') throw bad(`${label} metin olmalı.`);
  const result = value.trim();
  if (required && !result) throw bad(`${label} boş olamaz.`);
  if (result.length > max) throw bad(`${label} en fazla ${max} karakter olabilir.`);
  return result;
}

export function codeValue(value, label = 'Kod') {
  return plainText(value, label, 30).toUpperCase();
}

export function oneOf(value, options, label) {
  if (!options.includes(value)) throw bad(`${label} geçersiz.`, { allowed: options });
  return value;
}

export function decimal(value, label) {
  if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '') throw bad(`${label} sayı olmalı.`);
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 99999999999.999 || Math.round(number * 1000) / 1000 !== number) {
    throw bad(`${label} sıfır veya pozitif, en fazla üç ondalıklı sayı olmalı.`);
  }
  return number;
}

export function countValue(value, label) {
  if (!Number.isInteger(value) || value < 0 || value > 2147483647) throw bad(`${label} sıfır veya pozitif tam sayı olmalı.`);
  return value;
}

export function timestamp(value, label, required = true) {
  if ((value === undefined || value === null) && !required) return null;
  const match = typeof value === 'string' && /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!match) {
    throw bad(`${label} saat dilimi içeren ISO tarih olmalı.`);
  }
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , offsetHourText, offsetMinuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1] ||
      Number(hourText) > 23 || Number(minuteText) > 59 || Number(secondText || 0) > 59 ||
      (offsetHourText && (Number(offsetHourText) > 23 || Number(offsetMinuteText) > 59))) {
    throw bad(`${label} geçerli bir takvim tarihi olmalı.`);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw bad(`${label} geçerli bir tarih olmalı.`);
  return date.toISOString();
}

export function utcOffsetMinutes(value) {
  const offset = value === undefined ? 0 : Number(value);
  if (!Number.isInteger(offset) || offset < -720 || offset > 840) {
    throw bad('UTC saat farkı dakika cinsinden -720 ile 840 arasında olmalı.');
  }
  return offset;
}

export function dateFilterBound(value, label, end = false, offsetMinutes = 0) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
    const [year, month, day] = value.split('-').map(Number);
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (month < 1 || month > 12 || day < 1 || day > days[month - 1]) {
      throw bad(`${label} geçerli bir takvim tarihi olmalı.`);
    }
    const civilMidnight = new Date(0);
    civilMidnight.setUTCFullYear(year, month - 1, day + (end ? 1 : 0));
    civilMidnight.setUTCHours(0, 0, 0, 0);
    const instant = civilMidnight.getTime() - offsetMinutes * 60_000;
    return new Date(instant).toISOString();
  }
  return timestamp(value, label);
}

export function pagination(query) {
  const page = Number(query.page ?? 1);
  const limit = Number(query.limit ?? query.pageSize ?? 20);
  if (!Number.isInteger(page) || page < 1 || page > 100000 || !Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw bad('Sayfa ve limit geçerli aralıkta olmalı (limit 1-100).');
  }
  return { page, limit, offset: (page - 1) * limit };
}

export function collection(rows, total, page, limit) {
  const count = Number(total);
  return { items: rows, pagination: { page, limit, pageSize: limit, total: count, totalPages: Math.ceil(count / limit) } };
}

export async function withTransaction(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function activeMachine(client, id, lock = false) {
  const result = await client.query(`SELECT * FROM machines WHERE id = $1 ${lock ? 'FOR UPDATE' : ''}`, [id]);
  const machine = result.rows[0];
  if (!machine) throw missing('Makine bulunamadı.');
  if (machine.archived_at) throw conflict('Arşivli makineye yeni kayıt eklenemez.');
  return machine;
}

export function sqlError(error) {
  if (error instanceof ApiError) return error;
  if (error?.code === '23505') return conflict('Bu kod veya açık uyarı zaten kayıtlı.');
  if (error?.code === '23503') return conflict('İlişkili kayıt bulunamadı veya kayıt kullanılıyor.');
  if (['23502', '23514', '22P02', '22003', '22007', '22008'].includes(error?.code)) return bad('Veriler geçersiz veya kısıtlarla çelişiyor.');
  if (String(error?.code || '').startsWith('08') || ['57P01', '57P02', '57P03', 'ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT'].includes(error?.code)) {
    return new ApiError(503, 'DATABASE_UNAVAILABLE', 'Veritabanına şu anda erişilemiyor.');
  }
  console.error('Beklenmeyen sunucu hatası:', error);
  return new ApiError(500, 'INTERNAL_ERROR', 'Beklenmeyen bir sunucu hatası oluştu.');
}
