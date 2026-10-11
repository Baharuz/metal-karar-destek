import test from 'node:test';
import assert from 'node:assert/strict';
import { createMutationGate, createRequestGate } from '../src/asyncState.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

test('kayıt sürerken düzenleme, iptal ve arşivleme başlayamaz; kilit sonunda açılır', async () => {
  const changes = [];
  const gate = createMutationGate(value => changes.push(value));
  const pending = deferred();
  const save = gate.run('save', () => pending.promise);
  assert.equal(gate.getActive(), 'save');
  assert.equal(gate.isBusy(), true); // Düzenleme ve iptal aynı denetimle engellenir.
  let archiveCalled = false;
  const archive = await gate.run('archive:12', () => { archiveCalled = true; });
  assert.deepEqual(archive, { started: false });
  assert.equal(archiveCalled, false);
  pending.resolve('kaydedildi');
  assert.deepEqual(await save, { started: true, value: 'kaydedildi' });
  assert.equal(gate.isBusy(), false);
  assert.deepEqual(changes, ['save', null]);
  assert.equal((await gate.run('archive:12', () => 'arşivlendi')).started, true);
});

test('hata veren kayıt da kilidi kaldırır', async () => {
  const gate = createMutationGate();
  await assert.rejects(gate.run('save', () => Promise.reject(new Error('kayıt hatası'))), /kayıt hatası/);
  assert.equal(gate.isBusy(), false);
});

test('eski liste yanıtı yeni arama ve yenileme sonucunu ezemez', () => {
  const gate = createRequestGate();
  const first = gate.issue();
  const second = gate.issue();
  assert.equal(gate.isCurrent(first), false);
  assert.equal(gate.isCurrent(second), true);
  gate.invalidate(); // Kaydetme veya arşivleme başlarken mevcut istek geçersizleşir.
  assert.equal(gate.isCurrent(second), false);
  const afterMutation = gate.issue();
  assert.equal(gate.isCurrent(afterMutation), true);
});
