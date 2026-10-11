export const machineStatus = { idle: 'Beklemede', running: 'Çalışıyor', maintenance: 'Bakımda' };
export const metric = {
  temperature_c: { label: 'Sıcaklık', unit: '°C' },
  vibration_mm_s: { label: 'Titreşim', unit: 'mm/s' },
  runtime_hours: { label: 'Çalışma saati', unit: 'h' }
};
export const defect = {
  burr: 'Çapak', surface_defect: 'Yüzey kusuru',
  dimension_out_of_tolerance: 'Ölçü toleransı dışında'
};
export const maintenanceKind = { preventive: 'Önleyici', corrective: 'Düzeltici', inspection: 'Kontrol' };
export const alertStatus = { open: 'Açık', reviewing: 'İnceleniyor', resolved: 'Çözüldü' };

const trNumber = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 2 });
const trDate = new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium', timeStyle: 'short' });
export function number(value) {
  return value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? '—' : trNumber.format(Number(value));
}
export function percent(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return 'Üretim yok';
  return `${trNumber.format(Number(value) * 100)}%`;
}
export function date(value) {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '—' : trDate.format(parsed);
}
export function localDateTime(value = new Date()) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  const local = new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}
export function localDate(value = new Date()) { return localDateTime(value).slice(0, 10); }
export function utcOffsetMinutes() { return -new Date().getTimezoneOffset(); }
export function isoFromLocal(value) { return value ? new Date(value).toISOString() : undefined; }
export function collection(data) { return Array.isArray(data) ? data : data?.items || []; }
export function totalPages(data) { return Math.max(1, Number(data?.pagination?.totalPages) || 1); }
export function fieldMessages(error) {
  const details = error?.details;
  if (!details) return {};
  if (Array.isArray(details)) return Object.fromEntries(details.filter(item => item?.field).map(item => [item.field, item.message || error.message]));
  return typeof details === 'object' ? details : {};
}
