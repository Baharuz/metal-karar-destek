import test from 'node:test';
import assert from 'node:assert/strict';
import { api, ApiError } from '../src/api.js';

function withFetch(stub, task) {
  const original = globalThis.fetch;
  globalThis.fetch = stub;
  return Promise.resolve().then(task).finally(() => { globalThis.fetch = original; });
}

test('204 gövdesiz yanıt başarı olarak döner', async () => {
  await withFetch(async () => new Response(null, { status: 204 }), async () => {
    assert.equal(await api('/api/machines/1', { method: 'DELETE' }), null);
  });
});

test('sunucunun JSON hata mesajı ve ayrıntıları korunur', async () => {
  await withFetch(async () => new Response(JSON.stringify({ code: 'VALIDATION_ERROR', message: 'Kod gerekli.', details: { code: 'Boş olamaz.' } }), {
    status: 400, headers: { 'content-type': 'application/json' }
  }), async () => {
    await assert.rejects(api('/api/machines'), error => error instanceof ApiError && error.status === 400 &&
      error.code === 'VALIDATION_ERROR' && error.message === 'Kod gerekli.' && error.details.code === 'Boş olamaz.');
  });
});

test('JSON olmayan veya bozuk JSON yanıtı anlaşılır hata üretir', async () => {
  await withFetch(async () => new Response('<html>hata</html>', { status: 502, headers: { 'content-type': 'text/html' } }), async () => {
    await assert.rejects(api('/api/machines'), error => error.code === 'INVALID_RESPONSE');
  });
  await withFetch(async () => new Response('{', { status: 200, headers: { 'content-type': 'application/json' } }), async () => {
    await assert.rejects(api('/api/machines'), error => error.code === 'INVALID_RESPONSE');
  });
});

test('ağ hatası ile zaman aşımı ayrılır', async () => {
  await withFetch(async () => { throw new TypeError('network'); }, async () => {
    await assert.rejects(api('/api/machines'), error => error.code === 'NETWORK_ERROR');
  });
  await withFetch((_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
  }), async () => {
    await assert.rejects(api('/api/machines', { timeout: 5 }), error => error.code === 'TIMEOUT');
  });
});
