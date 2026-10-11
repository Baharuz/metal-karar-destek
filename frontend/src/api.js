const API_BASE = (import.meta.env?.VITE_API_BASE_URL || '').replace(/\/$/, '');
const DEFAULT_TIMEOUT = 12000;

export class ApiError extends Error {
  constructor(message, { status = 0, code = 'NETWORK_ERROR', details = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function query(params = {}) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  });
  return search.size ? `?${search}` : '';
}

export async function api(path, { method = 'GET', body, signal, timeout = DEFAULT_TIMEOUT } = {}) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeout);
  const abort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener('abort', abort, { once: true });

  try {
    const response = await fetch(`${API_BASE}${path}`, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal
    });
    if (response.status === 204) return null;
    const contentType = response.headers.get('content-type') || '';
    const raw = await response.text();
    let data = null;
    if (raw) {
      if (!contentType.includes('application/json')) {
        throw new ApiError('Sunucu beklenmeyen bir yanıt verdi. Lütfen yeniden deneyin.', { status: response.status, code: 'INVALID_RESPONSE' });
      }
      try { data = JSON.parse(raw); }
      catch { throw new ApiError('Sunucunun yanıtı okunamadı. Lütfen yeniden deneyin.', { status: response.status, code: 'INVALID_RESPONSE' }); }
    }
    if (!response.ok) {
      throw new ApiError(data?.message || `İşlem tamamlanamadı (HTTP ${response.status}).`, {
        status: response.status, code: data?.code || 'HTTP_ERROR', details: data?.details
      });
    }
    return data;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error?.name === 'AbortError') {
      throw new ApiError(timedOut ? 'İstek zaman aşımına uğradı. Yeniden deneyin.' : 'İstek iptal edildi.', {
        code: timedOut ? 'TIMEOUT' : 'ABORTED'
      });
    }
    throw new ApiError('Sunucuya bağlanılamadı. Bağlantınızı ve API ayarını kontrol edin.');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

export const get = (path, options) => api(path, options);
export const post = (path, body, options) => api(path, { ...options, method: 'POST', body });
export const patch = (path, body, options) => api(path, { ...options, method: 'PATCH', body });
export const put = (path, body, options) => api(path, { ...options, method: 'PUT', body });
export const remove = (path, options) => api(path, { ...options, method: 'DELETE' });
