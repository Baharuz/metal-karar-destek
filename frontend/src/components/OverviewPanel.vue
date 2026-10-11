<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { get, query } from '../api.js';
import { date, localDate, metric, number, percent, utcOffsetMinutes } from '../format.js';
import PageState from './PageState.vue';

const props = defineProps({ refreshKey: { type: Number, default: 0 } });
const today = new Date();
const fromDate = new Date(today); fromDate.setDate(today.getDate() - 29);
const filters = reactive({ from: localDate(fromDate), to: localDate(today) });
const data = ref(null);
const loading = ref(false);
const error = ref('');
const selectedMetric = ref('temperature_c');
let requestId = 0;

async function load() {
  const id = ++requestId;
  loading.value = true;
  error.value = '';
  try {
    const result = await get(`/api/dashboard${query({ ...filters, utcOffsetMinutes: utcOffsetMinutes() })}`);
    if (id === requestId) data.value = result;
  } catch (err) {
    if (id === requestId) error.value = err.message;
  } finally {
    if (id === requestId) loading.value = false;
  }
}
const metricRows = computed(() => (data.value?.trend?.measurements || [])
  .filter(row => row.kind === selectedMetric.value && Number.isFinite(Number(row.average_value)))
  .map(row => ({ day: row.day, value: Number(row.average_value) })));
const qualityRows = computed(() => (data.value?.trend?.quality || [])
  .filter(row => row.defect_rate !== null && Number.isFinite(Number(row.defect_rate)))
  .map(row => ({ day: row.day, value: Number(row.defect_rate) })));
const metricMaximum = computed(() => Math.max(1, ...metricRows.value.map(row => row.value)));
const qualityMaximum = computed(() => Math.max(1, ...qualityRows.value.map(row => row.value)));
watch(() => props.refreshKey, load);
onMounted(load);
</script>

<template>
  <div class="page-head"><div><p class="eyebrow">ÜRETİM GÖRÜNÜMÜ</p><h1>Genel bakış</h1><p>Seçilen dönemdeki durum ve üretim sonuçları.</p></div><button class="button secondary" type="button" :disabled="loading" @click="load">Yenile</button></div>
  <form class="card compact filters" @submit.prevent="load">
    <label>Başlangıç tarihi<input v-model="filters.from" type="date" :max="filters.to" required /></label>
    <label>Bitiş tarihi<input v-model="filters.to" type="date" :min="filters.from" required /></label>
    <button class="button primary" type="submit" :disabled="loading || filters.from > filters.to">Dönemi göster</button>
  </form>
  <PageState :loading="loading && !data" :error="error && !data ? error : ''" @retry="load" />
  <p v-if="error && data" class="inline-error" role="alert">Veriler yenilenemedi: {{ error }}. Önceki sonuçlar gösteriliyor.</p>
  <template v-if="data">
    <section aria-label="Genel özet" class="stats-grid">
      <div class="stat"><span>Toplam makine</span><strong>{{ number(data.machines?.total) }}</strong><small>Çalışıyor {{ number(data.machines?.running) }} · Beklemede {{ number(data.machines?.idle) }} · Bakımda {{ number(data.machines?.maintenance) }}</small></div>
      <div class="stat"><span>Açık uyarı</span><strong>{{ number(data.alerts?.open) }}</strong><small>İnceleniyor {{ number(data.alerts?.reviewing) }}</small></div>
      <div class="stat"><span>Bakım</span><strong>{{ number(data.maintenance?.overdue) }}</strong><small>Geciken · yaklaşan {{ number(data.maintenance?.upcoming) }}</small></div>
      <div class="stat"><span>Üretim adedi</span><strong>{{ number(data.production?.total_count) }}</strong><small>Hatalı parça {{ number(data.production?.defective_count) }} · hata oranı {{ percent(data.production?.defect_rate) }}</small></div>
    </section>

    <div class="two-col">
      <section class="card" aria-labelledby="measurement-trend-title">
        <div class="section-head"><div><h2 id="measurement-trend-title">Ölçüm değişimi</h2><p>Günlük ortalama, manuel veya demo ölçümleri</p></div></div>
        <label>Ölçüm türü<select v-model="selectedMetric"><option v-for="(item, key) in metric" :key="key" :value="key">{{ item.label }} ({{ item.unit }})</option></select></label>
        <p v-if="!metricRows.length" class="state state-empty">Bu dönemde seçilen tür için ölçüm yok.</p>
        <div v-else class="chart" role="img" :aria-label="`${metric[selectedMetric].label} günlük ortalama grafiği`">
          <div v-for="row in metricRows" :key="row.day" class="chart-row">
            <span class="chart-label">{{ row.day }}</span><span class="chart-track"><span class="chart-bar" :style="{ width: `${Math.max(0, row.value / metricMaximum * 100)}%` }"></span></span>
            <strong>{{ number(row.value) }} {{ metric[selectedMetric].unit }}</strong>
          </div>
        </div>
      </section>
      <section class="card" aria-labelledby="quality-trend-title">
        <div class="section-head"><div><h2 id="quality-trend-title">Hata oranı değişimi</h2><p>Günlük hatalı parça / toplam üretim</p></div></div>
        <p v-if="!qualityRows.length" class="state state-empty">Bu dönemde üretim yok; hata oranı hesaplanamaz.</p>
        <div v-else class="chart quality-chart" role="img" aria-label="Günlük hata oranı grafiği">
          <div v-for="row in qualityRows" :key="row.day" class="chart-row">
            <span class="chart-label">{{ row.day }}</span><span class="chart-track"><span class="chart-bar" :style="{ width: `${Math.max(0, row.value / qualityMaximum * 100)}%` }"></span></span>
            <strong>{{ percent(row.value) }}</strong>
          </div>
        </div>
      </section>
    </div>
    <p class="footnote">Özet sayıları tüm filtrelenmiş kayıtlardan hesaplanır. Grafikler yalnızca kayıtlı veriyi gösterir.</p>
  </template>
</template>
