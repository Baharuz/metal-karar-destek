<script setup>
import { onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { get, patch, post, query, remove } from '../api.js';
import { createMutationGate, createRequestGate } from '../asyncState.js';
import { collection, fieldMessages, machineStatus, totalPages } from '../format.js';
import PageState from './PageState.vue';
import PaginationBar from './PaginationBar.vue';
import MachineDetail from './MachineDetail.vue';

const emit = defineEmits(['notify']);
const items = ref([]);
const pagination = ref({ page: 1, total: 0, totalPages: 1 });
const loaded = ref(false);
const loading = ref(false);
const listError = ref('');
const formError = ref('');
const errors = ref({});
const operation = ref('');
const editingId = ref(null);
const selectedId = ref(null);
const search = ref('');
const status = ref('');
const includeArchived = ref(false);
const page = ref(1);
const form = reactive({ code: '', name: '', status: 'idle' });
const requestGate = createRequestGate();
const mutationGate = createMutationGate(value => { operation.value = value || ''; });
let debounce;

async function load() {
  const id = requestGate.issue();
  loading.value = true;
  listError.value = '';
  try {
    const data = await get(`/api/machines${query({ search: search.value.trim(), status: status.value, includeArchived: includeArchived.value, page: page.value, pageSize: 10 })}`);
    if (!requestGate.isCurrent(id)) return false;
    items.value = collection(data);
    pagination.value = data.pagination || { page: page.value, total: items.value.length, totalPages: 1 };
    loaded.value = true;
    return true;
  } catch (error) {
    if (requestGate.isCurrent(id)) listError.value = error.message;
    return false;
  } finally { if (requestGate.isCurrent(id)) loading.value = false; }
}
function resetForm() {
  if (mutationGate.isBusy()) return;
  editingId.value = null;
  Object.assign(form, { code: '', name: '', status: 'idle' });
  errors.value = {};
  formError.value = '';
}
function edit(machine) {
  if (mutationGate.isBusy()) return;
  editingId.value = machine.id;
  Object.assign(form, { code: machine.code, name: machine.name, status: machine.status });
  errors.value = {};
  formError.value = '';
  document.getElementById('machine-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  document.getElementById('machine-code')?.focus();
}
function validate() {
  const next = {};
  if (!form.code.trim()) next.code = 'Makine kodu gerekli.';
  else if (form.code.trim().length > 30) next.code = 'Kod en fazla 30 karakter olmalı.';
  if (!form.name.trim()) next.name = 'Makine adı gerekli.';
  else if (form.name.trim().length > 100) next.name = 'Ad en fazla 100 karakter olmalı.';
  if (!machineStatus[form.status]) next.status = 'Geçerli bir durum seçin.';
  errors.value = next;
  return !Object.keys(next).length;
}
async function save() {
  if (mutationGate.isBusy() || !validate()) return;
  await mutationGate.run('save', async () => {
    formError.value = '';
    requestGate.invalidate();
    loading.value = false;
    const wasEditing = editingId.value !== null;
    try {
      const payload = { code: form.code.trim(), name: form.name.trim(), status: form.status };
      const result = wasEditing ? await patch(`/api/machines/${editingId.value}`, payload) : await post('/api/machines', payload);
      const message = `${result.code} ${wasEditing ? 'güncellendi' : 'kaydedildi'}.`;
      editingId.value = null;
      Object.assign(form, { code: '', name: '', status: 'idle' });
      errors.value = {};
      if (page.value !== 1 && !wasEditing) page.value = 1;
      const refreshed = await load();
      emit('notify', refreshed ? message : `${message} Liste yenilenemedi; yeniden deneyin.`, refreshed ? 'success' : 'warning');
    } catch (error) {
      formError.value = error.message;
      errors.value = fieldMessages(error);
    }
  });
}
async function archive(machine) {
  if (mutationGate.isBusy() || !window.confirm(`${machine.code} makinesini arşivlemek istiyor musunuz? Geçmiş kayıtlar korunur.`)) return;
  await mutationGate.run(`archive:${machine.id}`, async () => {
    listError.value = '';
    requestGate.invalidate();
    loading.value = false;
    try {
      await remove(`/api/machines/${machine.id}`);
      if (editingId.value === machine.id) { editingId.value = null; Object.assign(form, { code: '', name: '', status: 'idle' }); errors.value = {}; formError.value = ''; }
      items.value = items.value.filter(item => item.id !== machine.id);
      if (!items.value.length && page.value > 1) page.value--;
      const refreshed = await load();
      emit('notify', refreshed ? `${machine.code} arşivlendi.` : `${machine.code} arşivlendi. Liste yenilenemedi.`, refreshed ? 'success' : 'warning');
    } catch (error) { listError.value = error.message; }
  });
}
function setPage(next) { page.value = next; load(); }
watch([status, includeArchived], () => { page.value = 1; load(); });
watch(search, () => { clearTimeout(debounce); debounce = setTimeout(() => { page.value = 1; load(); }, 300); });
onMounted(load);
onUnmounted(() => { requestGate.invalidate(); clearTimeout(debounce); });
</script>

<template>
  <MachineDetail v-if="selectedId" :id="selectedId" @back="selectedId = null; load()" @notify="(...args) => emit('notify', ...args)" />
  <template v-else>
    <div class="page-head"><div><p class="eyebrow">MAKİNE PARKI</p><h1>Makineler</h1><p>Durumları yönetin, ölçüm ve bakım geçmişini inceleyin.</p></div><button type="button" class="button secondary" :disabled="loading || !!operation" @click="load">Listeyi yenile</button></div>
    <section id="machine-form" class="card" aria-labelledby="machine-form-title">
      <div class="section-head"><h2 id="machine-form-title">{{ editingId ? 'Makineyi düzenle' : 'Yeni makine' }}</h2><button v-if="editingId" type="button" class="button ghost" :disabled="!!operation" @click="resetForm">Vazgeç</button></div>
      <form @submit.prevent="save" novalidate><fieldset :disabled="!!operation" class="form-grid">
        <label for="machine-code">Makine kodu<input id="machine-code" v-model="form.code" maxlength="30" autocomplete="off" placeholder="CNC-002" :aria-invalid="!!errors.code" :aria-describedby="errors.code ? 'code-error' : undefined" /><small v-if="errors.code" id="code-error" class="field-error">{{ errors.code }}</small></label>
        <label for="machine-name">Makine adı<input id="machine-name" v-model="form.name" maxlength="100" placeholder="CNC Freze 1" :aria-invalid="!!errors.name" :aria-describedby="errors.name ? 'name-error' : undefined" /><small v-if="errors.name" id="name-error" class="field-error">{{ errors.name }}</small></label>
        <label for="machine-status">Durum<select id="machine-status" v-model="form.status" :aria-invalid="!!errors.status"><option v-for="(label, key) in machineStatus" :key="key" :value="key">{{ label }}</option></select><small v-if="errors.status" class="field-error">{{ errors.status }}</small></label>
        <button type="submit" class="button primary">{{ operation === 'save' ? 'Kaydediliyor…' : editingId ? 'Değişiklikleri kaydet' : 'Makine ekle' }}</button>
      </fieldset></form>
      <p v-if="formError" class="inline-error" role="alert">{{ formError }}</p>
    </section>
    <section class="card" aria-labelledby="machine-list-title">
      <div class="section-head"><h2 id="machine-list-title">Makine listesi</h2><span v-if="loaded">{{ pagination.total }} kayıt</span></div>
      <div class="filters"><label>Kod veya ad ara<input v-model="search" type="search" placeholder="Makine kodu veya adı" /></label><label>Durum<select v-model="status"><option value="">Tüm durumlar</option><option v-for="(label, key) in machineStatus" :key="key" :value="key">{{ label }}</option></select></label><label class="checkbox-label"><input v-model="includeArchived" type="checkbox" />Arşivlenenleri göster</label></div>
      <p v-if="listError && loaded" class="inline-error" role="alert">{{ listError }} <button type="button" class="link-button" @click="load">Yeniden dene</button></p>
      <PageState :loading="loading && !loaded" :error="!loaded ? listError : ''" :empty="loaded && !loading && !items.length && !listError" :empty-text="search || status ? 'Filtrelerle eşleşen makine yok.' : 'Henüz makine kaydı yok.'" @retry="load" />
      <div v-if="items.length" class="table-scroll"><table><thead><tr><th>Kod</th><th>Makine adı</th><th>Durum</th><th>İşlemler</th></tr></thead><tbody><tr v-for="machine in items" :key="machine.id"><td><strong>{{ machine.code }}</strong></td><td>{{ machine.name }}</td><td><span class="badge" :class="machine.archived_at ? 'muted' : machine.status">{{ machine.archived_at ? 'Arşivli' : machineStatus[machine.status] || machine.status }}</span></td><td class="row-actions"><button type="button" class="link-button" :disabled="!!operation" @click="selectedId = machine.id">Detay</button><button v-if="!machine.archived_at" type="button" class="link-button" :disabled="!!operation" @click="edit(machine)">Düzenle</button><button v-if="!machine.archived_at" type="button" class="link-button danger" :disabled="!!operation" @click="archive(machine)">{{ operation === `archive:${machine.id}` ? 'Arşivleniyor…' : 'Arşivle' }}</button></td></tr></tbody></table></div>
      <PaginationBar v-if="loaded && pagination.total > 0" :page="Number(pagination.page) || page" :total-pages="totalPages({ pagination })" :total="Number(pagination.total)" :disabled="loading || !!operation" @change="setPage" />
    </section>
  </template>
</template>
