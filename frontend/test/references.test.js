import test from 'node:test';
import assert from 'node:assert/strict';
import { loadAllPages } from '../src/references.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
}

async function withFetch(stub, task) {
  const original = globalThis.fetch;
  globalThis.fetch = stub;
  try { await task(); }
  finally { globalThis.fetch = original; }
}

test('100 kaydı aşan seçim listesinin tüm sayfaları yüklenir ve ID metin kalır', async () => {
  const pages = [];
  await withFetch(async url => {
    const search = new URL(url, 'http://localhost').searchParams;
    const page = Number(search.get('page'));
    pages.push(page);
    assert.equal(search.get('pageSize'), '100');
    return json({ items: [{ id: `900719925474099${page}`, code: `M${page}` }], pagination: { totalPages: 3 } });
  }, async () => {
    const result = await loadAllPages('/api/machines');
    assert.deepEqual(result.map(row => row.id), ['9007199254740991', '9007199254740992', '9007199254740993']);
  });
  assert.deepEqual(pages.sort(), [1, 2, 3]);
});

test('bir ara sayfa başarısızsa kısmi seçim listesi dönmez', async () => {
  await withFetch(async url => {
    const page = Number(new URL(url, 'http://localhost').searchParams.get('page'));
    if (page === 2) return json({ message: 'İkinci sayfa alınamadı.' }, 500);
    return json({ items: [{ id: String(page) }], pagination: { totalPages: 2 } });
  }, async () => {
    await assert.rejects(loadAllPages('/api/products'), /İkinci sayfa alınamadı/);
  });
});
