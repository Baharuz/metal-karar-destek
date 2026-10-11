<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { get, post, put, query } from '../api.js';
import { alertStatus, collection, date, isoFromLocal, localDateTime, machineStatus, maintenanceKind, metric, number, totalPages } from '../format.js';
import PageState from './PageState.vue';
import PaginationBar from './PaginationBar.vue';

const props = defineProps({ id: { type: String, required: true } });
const emit = defineEmits(['back', 'notify']);
const detail = ref(null);
const measurements = ref([]);
const measurementLoaded = ref(false);
const measurementPagination = ref({ page: 1, total: 0, totalPages: 1 });
const measurementPage = ref(1);
const measurementKindFilter = ref('');
const thresholds = ref([]);
const thresholdLoaded = ref(false);
const drafts = reactive({});
for (const kind of Object.keys(metric)) drafts[kind] = { warning_value: '', critical_value: '', is_demo: true };
const loaded = ref(false);
const loading = ref(false);
const error = ref('');
const sectionError = ref('');
const mutationError = ref('');
const busy = ref('');
const measurementForm = reactive({ kind: 'temperature_c', value: '', measured_at: localDateTime(), source: 'manual' });
let requestId = 0;

const machine = computed(() => detail.value?.machine || null);
const riskRows = computed(() => {
  const risk = detail.value?.risk;
  return Array.isArray(risk) ? risk : risk?.risk || [];
});
const stateLabel = { missing: 'Veri yok', stale: 'Eski veri', normal: 'Normal', warning: 'Uyarı', critical: 'Kritik', unconfigured: 'Eşik tanımsız' };
const stateClass = { missing: 'muted', stale: 'warning', normal: 'running', warning: 'warning', critical: 'critical', unconfigured: 'muted' };

async function load() {
  const id = ++requestId;
  loading.value = true;
  error.value = '';
  sectionError.value = '';
  const results = await Promise.allSettled([
    get(`/api/machines/${props.id}`),
    get(`/api/machines/${props.id}/measurements${query({ page: measurementPage.value, pageSize: 10, kind: measurementKindFilter.value })}`),
    get(`/api/machines/${props.id}/thresholds`)
  ]);
  if (id !== requestId) return false;
  const [detailResult, measurementResult, thresholdResult] = results;
  if (detailResult.status === 'fulfilled') { detail.value = detailResult.value; loaded.value = true; }
  else error.value = detailResult.reason.message;
  if (measurementResult.status === 'fulfilled') {
    measurements.value = collection(measurementResult.value);
    measurementPagination.value = measurementResult.value?.pagination || { page: 1, total: measurements.value.length, totalPages: 1 };
    measurementLoaded.value = true;
  }
  if (thresholdResult.status === 'fulfilled') {
    thresholds.value = collection(thresholdResult.value);
    thresholdLoaded.value = true;
    for (const kind of Object.keys(metric)) {
      const item = thresholds.value.find(row => row.kind === kind);
      drafts[kind] = { warning_value: item?.warning_value ?? '', critical_value: item?.critical_value ?? '', is_demo: item?.is_demo ?? true };
    }
  }
  const secondary = [measurementResult, thresholdResult].filter(result => result.status === 'rejected');
  if (secondary.length) sectionError.value = `Bazı detaylar yüklenemedi: ${secondary.map(result => result.reason.message).join(' ' )}`;
  loading.value = false;
  return detailResult.status === 'fulfilled' && !secondary.length;
}
async function addMeasurement() {
  if (busy.value || machine.value?.archived_at) return;
  mutationError.value = '';
  if (measurementForm.value === '' || !Number.isFinite(Number(measurementForm.value))) { mutationError.value = 'Geçerli bir ölçüm değeri girin.'; return; }
  if (!measurementForm.measured_at || Number.isNaN(new Date(measurementForm.measured_at).getTime())) { mutationError.value = 'Geçerli bir ölçüm zamanı girin.'; return; }
  busy.value = 'measurement';
  requestId++;
  try {
    await post(`/api/machines/${props.id}/measurements`, {
      kind: measurementForm.kind, value: Number(measurementForm.value),
      measured_at: isoFromLocal(measurementForm.measured_at), source: measurementForm.source.trim() || 'manual'
    });
    measurementForm.value = '';
    measurementForm.measured_at = localDateTime();
    const refreshed = await load();
    emit('notify', refreshed ? 'Ölçüm kaydedildi; risk durumu güncellendi.' : 'Ölçüm kaydedildi. Detaylar yenilenemedi.', refreshed ? 'success' : 'warning');
  } catch (err) { mutationError.value = err.message; }
  finally { busy.value = ''; }
}
async function saveThreshold(kind) {
  if (busy.value || machine.value?.archived_at) return;
  mutationError.value = '';
  const item = drafts[kind];
  const warning = Number(item?.warning_value);
  const critical = Number(item?.critical_value);
  if (item?.warning_value === '' || item?.critical_value === '' || !Number.isFinite(warning) || !Number.isFinite(critical) || warning >= critical) {
    mutationError.value = 'Uyarı ve kritik eşik sayısal olmalı; kritik eşik uyarıdan büyük olmalı.';
    return;
  }
  busy.value = kind;
  requestId++;
  try {
    await put(`/api/machines/${props.id}/thresholds/${kind}`, { warning_value: warning, critical_value: critical, is_demo: Boolean(item.is_demo) });
    const refreshed = await load();
    emit('notify', refreshed ? `${metric[kind].label} eşikleri kaydedildi.` : 'Eşik kaydedildi. Detaylar yenilenemedi.', refreshed ? 'success' : 'warning');
  } catch (err) { mutationError.value = err.message; }
  finally { busy.value = ''; }
}
onMounted(load);
watch(measurementKindFilter, () => { measurementPage.value = 1; load(); });
</script>

<template>
  <div class="page-head"><div><button type="button" class="link-button back-link" @click="emit('back')">← Makine listesine dön</button><h1>{{ machine?.name || 'Makine detayı' }}</h1><p v-if="machine"><strong>{{ machine.code }}</strong> · <span class="badge" :class="machine.archived_at ? 'muted' : machine.status">{{ machine.archived_at ? 'Arşivli' : machineStatus[machine.status] || machine.status }}</span></p></div><button type="button" class="button secondary" :disabled="loading || !!busy" @click="load">Yenile</button></div>
  <PageState :loading="loading && !loaded" :error="error && !loaded ? error : ''" @retry="load" />
  <p v-if="error && loaded" class="inline-error" role="alert">Detay yenilenemedi: {{ error }}</p>
  <p v-if="sectionError" class="inline-error" role="alert">{{ sectionError }} <button type="button" class="link-button" @click="load">Yeniden dene</button></p>
  <p v-if="machine?.archived_at" class="callout">Bu makine arşivlendi. Geçmiş kayıtlar okunabilir; yeni ölçüm ve eşik değişikliği yapılamaz.</p>
  <template v-if="detail">
    <section class="card" aria-labelledby="risk-title"><div class="section-head"><div><h2 id="risk-title">Ölçüm riski</h2><p>Kurallar ölçüm ve eşik verilerine dayanır; kesin arıza teşhisi değildir.</p></div></div>
      <p v-if="!riskRows.length" class="state state-empty">Risk değerlendirmesi için veri yok.</p>
      <div v-else class="risk-grid"><article v-for="row in riskRows" :key="row.kind" class="risk-card"><div class="section-head"><h3>{{ metric[row.kind]?.label || row.kind }}</h3><span class="badge" :class="stateClass[row.state]">{{ stateLabel[row.state] || row.state }}</span></div><p class="risk-value">{{ number(row.value) }} <small>{{ row.unit || metric[row.kind]?.unit }}</small></p><p>{{ row.explanation }}</p><p v-if="row.recommendation"><strong>Önerilen kontrol:</strong> {{ row.recommendation }}</p><small>Ölçüm: {{ date(row.measuredAt) }} · Uyarı {{ number(row.warning) }} · Kritik {{ number(row.critical) }}</small></article></div>
    </section>

    <div class="two-col">
      <section class="card" aria-labelledby="measurement-title"><div class="section-head"><h2 id="measurement-title">Manuel ölçüm</h2></div>
        <form @submit.prevent="addMeasurement"><fieldset :disabled="!!busy || !!machine?.archived_at" class="stack-form"><label>Ölçüm türü<select v-model="measurementForm.kind"><option v-for="(item, kind) in metric" :key="kind" :value="kind">{{ item.label }} ({{ item.unit }})</option></select></label><label>Değer ({{ metric[measurementForm.kind].unit }})<input v-model="measurementForm.value" type="number" step="any" required /></label><label>Ölçüm zamanı<input v-model="measurementForm.measured_at" type="datetime-local" required /></label><label>Veri kaynağı<select v-model="measurementForm.source"><option value="manual">Manuel giriş</option><option value="demo">Sentetik demo verisi</option></select></label><button class="button primary" type="submit">{{ busy === 'measurement' ? 'Kaydediliyor…' : 'Ölçümü kaydet' }}</button></fieldset></form>
        <p class="footnote">Geçmiş tarihli ölçüm güncel ölçümü değiştirmez.</p>
      </section>
      <section class="card" aria-labelledby="threshold-title"><div class="section-head"><h2 id="threshold-title">Makine eşikleri</h2></div><p class="callout">Demo amaçlıdır, üretici limitleriyle doğrulanmalıdır.</p>
        <p v-if="!thresholdLoaded" class="inline-error" role="alert">Eşikler yüklenemedi; düzenleme için yeniden deneyin.</p>
        <div v-for="(item, kind) in metric" :key="kind" class="threshold-row"><h3>{{ item.label }} ({{ item.unit }})</h3><form @submit.prevent="saveThreshold(kind)"><fieldset :disabled="!!busy || !!machine?.archived_at || !thresholdLoaded" class="threshold-fields"><label>Uyarı<input v-model="drafts[kind].warning_value" type="number" step="any" required /></label><label>Kritik<input v-model="drafts[kind].critical_value" type="number" step="any" required /></label><label class="checkbox-label"><input v-model="drafts[kind].is_demo" type="checkbox" />Demo eşiği</label><button class="button secondary" type="submit">Kaydet</button></fieldset></form></div>
      </section>
    </div>
    <p v-if="mutationError" class="inline-error" role="alert">{{ mutationError }}</p>
    <section class="card" aria-labelledby="measurement-history-title"><div class="section-head"><h2 id="measurement-history-title">Ölçüm geçmişi</h2><span>{{ measurementPagination.total }} kayıt</span></div><div class="filters"><label>Ölçüm türü<select v-model="measurementKindFilter"><option value="">Tüm türler</option><option v-for="(item, kind) in metric" :key="kind" :value="kind">{{ item.label }}</option></select></label></div><p v-if="!measurements.length" class="state state-empty">Bu türde henüz ölçüm yok.</p><div v-else class="table-scroll"><table><thead><tr><th>Zaman</th><th>Tür</th><th>Değer</th><th>Kaynak</th></tr></thead><tbody><tr v-for="item in measurements" :key="item.id"><td>{{ date(item.measured_at) }}</td><td>{{ metric[item.kind]?.label || item.kind }}</td><td>{{ number(item.value) }} {{ item.unit || metric[item.kind]?.unit }}</td><td>{{ item.source === 'demo' ? 'Sentetik demo' : 'Manuel' }}</td></tr></tbody></table></div><PaginationBar v-if="measurementPagination.total > 0" :page="Number(measurementPagination.page) || measurementPage" :total-pages="totalPages({ pagination: measurementPagination })" :total="Number(measurementPagination.total)" :disabled="loading || !!busy" @change="next => { measurementPage = next; load(); }" /></section>
    <div class="two-col">
      <section class="card" aria-labelledby="status-history-title"><h2 id="status-history-title">Durum geçmişi</h2><p v-if="!detail.statusHistory?.length" class="state state-empty">Durum değişikliği yok.</p><div v-else class="table-scroll"><table><thead><tr><th>Zaman</th><th>Önceki</th><th>Yeni</th></tr></thead><tbody><tr v-for="item in detail.statusHistory" :key="item.id"><td>{{ date(item.changed_at) }}</td><td>{{ machineStatus[item.previous_status] || item.previous_status || '—' }}</td><td>{{ machineStatus[item.new_status] || item.new_status }}</td></tr></tbody></table></div></section>
      <section class="card" aria-labelledby="maintenance-history-title"><h2 id="maintenance-history-title">Son bakım kayıtları</h2><p v-if="!detail.recentMaintenance?.length" class="state state-empty">Bakım kaydı yok.</p><ul v-else class="record-list"><li v-for="item in detail.recentMaintenance" :key="item.id"><strong>{{ maintenanceKind[item.kind] || item.kind }} · {{ item.status === 'completed' ? 'Tamamlandı' : 'Planlandı' }}</strong><span>{{ date(item.scheduled_at) }}</span><p>{{ item.description || 'Açıklama yok' }}</p><p v-if="item.action_taken">Yapılan işlem: {{ item.action_taken }}</p></li></ul></section>
    </div>
    <section class="card" aria-labelledby="open-alerts-title"><h2 id="open-alerts-title">Açık uyarılar</h2><p v-if="!detail.openAlerts?.length" class="state state-empty">Açık uyarı yok.</p><ul v-else class="record-list"><li v-for="item in detail.openAlerts" :key="item.id"><strong>{{ item.title || item.message || 'Makine uyarısı' }}</strong><span class="badge warning">{{ alertStatus[item.status] || item.status }}</span><p>{{ item.description || item.explanation }}</p><small>{{ date(item.created_at) }}</small></li></ul></section>
  </template>
</template>
