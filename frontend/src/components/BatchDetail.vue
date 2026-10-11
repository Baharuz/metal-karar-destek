<script setup>
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue';
import { get, patch, post, remove } from '../api.js';
import { date, defect, fieldMessages, isoFromLocal, localDateTime, number, percent } from '../format.js';
import PageState from './PageState.vue';

const props = defineProps({ id: { type: String, required: true } });
const emit = defineEmits(['back', 'notify']);
const detail = ref(null);
const loading = ref(false);
const loaded = ref(false);
const error = ref('');
const formError = ref('');
const saving = ref(false);
const form = reactive({ kind: 'burr', count: 1, description: '' });
const batchEditing = ref(false);
const batchEdit = reactive({ started_at: '', ended_at: '', total_count: 0, defective_count: 0 });
const batchEditError = ref('');
const batchEditFields = ref({});
const qualityEditingId = ref(null);
const qualityEdit = reactive({ kind: 'burr', count: 1, description: '' });
const qualityEditError = ref('');
const qualityDeleteError = ref('');
let requestId = 0;
const batch = computed(() => detail.value?.batch || null);
const qualityRecords = computed(() => detail.value?.qualityRecords || []);
const analysis = computed(() => detail.value?.analysis || null);

function ratioPercent(value) { return percent(value); }
function startBatchEdit() {
  if (!batch.value || saving.value) return;
  Object.assign(batchEdit, {
    started_at: localDateTime(batch.value.started_at), ended_at: batch.value.ended_at ? localDateTime(batch.value.ended_at) : '',
    total_count: Number(batch.value.total_count), defective_count: Number(batch.value.defective_count)
  });
  batchEditFields.value = {};
  batchEditError.value = '';
  batchEditing.value = true;
}
function validateBatchEdit() {
  const errors = {};
  if (!batchEdit.started_at) errors.started_at = 'Başlangıç zamanı gerekli.';
  if (batchEdit.ended_at && new Date(batchEdit.ended_at) < new Date(batchEdit.started_at)) errors.ended_at = 'Bitiş başlangıçtan önce olamaz.';
  for (const key of ['total_count', 'defective_count']) {
    if (!Number.isInteger(Number(batchEdit[key])) || Number(batchEdit[key]) < 0) errors[key] = 'Sıfır veya pozitif tam sayı girin.';
  }
  if (!errors.defective_count && Number(batchEdit.defective_count) > Number(batchEdit.total_count)) errors.defective_count = 'Hatalı adet toplamı aşamaz.';
  batchEditFields.value = errors;
  return !Object.keys(errors).length;
}
async function saveBatchEdit() {
  if (saving.value || !validateBatchEdit()) return;
  saving.value = true;
  batchEditError.value = '';
  requestId++;
  try {
    await patch(`/api/batches/${props.id}`, {
      started_at: isoFromLocal(batchEdit.started_at), ended_at: batchEdit.ended_at ? isoFromLocal(batchEdit.ended_at) : null,
      total_count: Number(batchEdit.total_count), defective_count: Number(batchEdit.defective_count)
    });
    batchEditing.value = false;
    const refreshed = await load();
    emit('notify', refreshed ? 'Parti güncellendi; analiz yenilendi.' : 'Parti güncellendi. Analiz yenilenemedi.', refreshed ? 'success' : 'warning');
  } catch (err) { batchEditError.value = err.message; batchEditFields.value = { ...batchEditFields.value, ...fieldMessages(err) }; }
  finally { saving.value = false; }
}
function startQualityEdit(item) {
  if (saving.value) return;
  qualityEditingId.value = item.id;
  Object.assign(qualityEdit, { kind: item.kind, count: Number(item.count), description: item.description || '' });
  qualityEditError.value = '';
}
async function saveQualityEdit() {
  if (saving.value || !qualityEditingId.value) return;
  qualityEditError.value = '';
  if (!Number.isInteger(Number(qualityEdit.count)) || Number(qualityEdit.count) < 1) { qualityEditError.value = 'Kusur adedi pozitif tam sayı olmalı.'; return; }
  saving.value = true;
  requestId++;
  try {
    await patch(`/api/batches/${props.id}/quality/${qualityEditingId.value}`, {
      kind: qualityEdit.kind, count: Number(qualityEdit.count), description: qualityEdit.description.trim()
    });
    qualityEditingId.value = null;
    const refreshed = await load();
    emit('notify', refreshed ? 'Kalite kaydı güncellendi; analiz yenilendi.' : 'Kalite kaydı güncellendi. Analiz yenilenemedi.', refreshed ? 'success' : 'warning');
  } catch (err) { qualityEditError.value = err.message; }
  finally { saving.value = false; }
}
async function deleteQuality(item) {
  if (saving.value || !item) return;
  const label = defect[item.kind] || item.kind;
  if (!window.confirm(`${label} türündeki ${number(item.count)} kusurluk kalite kaydı silinsin mi? Parti analizi ve ilgili uyarı yeniden değerlendirilecek.`)) return;
  qualityDeleteError.value = '';
  saving.value = true;
  requestId++;
  try {
    await remove(`/api/batches/${props.id}/quality/${item.id}`);
    if (qualityEditingId.value === item.id) qualityEditingId.value = null;
    const refreshed = await load();
    emit('notify', refreshed ? 'Kalite kaydı silindi; analiz yenilendi.' : 'Kalite kaydı silindi. Analiz yenilenemedi.', refreshed ? 'success' : 'warning');
  } catch (err) { qualityDeleteError.value = err.message; }
  finally { saving.value = false; }
}
async function load() {
  const id = ++requestId;
  loading.value = true;
  error.value = '';
  try {
    const result = await get(`/api/batches/${props.id}`);
    if (id !== requestId) return false;
    detail.value = result;
    loaded.value = true;
    return true;
  } catch (err) { if (id === requestId) error.value = err.message; return false; }
  finally { if (id === requestId) loading.value = false; }
}
async function refreshAnalysis() {
  if (saving.value || loading.value) return;
  saving.value = true;
  error.value = '';
  requestId++;
  try {
    await post(`/api/batches/${props.id}/analysis/refresh`, {});
    const refreshed = await load();
    emit('notify', refreshed ? 'Analiz ve ilgili uyarı yenilendi.' : 'Analiz yenilendi. Görünüm yüklenemedi.', refreshed ? 'success' : 'warning');
  } catch (err) { error.value = err.message; }
  finally { saving.value = false; }
}
async function addQuality() {
  if (saving.value) return;
  formError.value = '';
  if (!Number.isInteger(Number(form.count)) || Number(form.count) < 1) { formError.value = 'Kusur adedi pozitif tam sayı olmalı.'; return; }
  saving.value = true;
  requestId++;
  try {
    await post(`/api/batches/${props.id}/quality`, { kind: form.kind, count: Number(form.count), description: form.description.trim() });
    Object.assign(form, { kind: 'burr', count: 1, description: '' });
    const refreshed = await load();
    emit('notify', refreshed ? 'Kalite kaydı eklendi; olası neden analizi yenilendi.' : 'Kalite kaydı eklendi. Analiz yenilenemedi.', refreshed ? 'success' : 'warning');
  } catch (err) { formError.value = err.message; }
  finally { saving.value = false; }
}
onMounted(load);
onUnmounted(() => { requestId++; });
</script>

<template>
  <div class="page-head"><div><button type="button" class="link-button back-link" @click="emit('back')">← Üretim listesine dön</button><h1>Üretim partisi</h1><p v-if="batch">{{ date(batch.started_at) }} – {{ date(batch.ended_at) }}</p></div><button type="button" class="button secondary" :disabled="loading || saving" @click="refreshAnalysis">{{ saving ? 'Yenileniyor…' : 'Analizi yenile' }}</button></div>
  <PageState :loading="loading && !loaded" :error="error && !loaded ? error : ''" @retry="load" />
  <p v-if="error && loaded" class="inline-error" role="alert">Parti yenilenemedi: {{ error }}</p>
  <template v-if="batch">
    <section aria-label="Parti özeti" class="stats-grid three"><div class="stat"><span>Üretilen parça</span><strong>{{ number(batch.total_count) }}</strong></div><div class="stat"><span>Hatalı parça</span><strong>{{ number(batch.defective_count) }}</strong></div><div class="stat"><span>Hata oranı</span><strong>{{ percent(batch.defect_rate ?? (Number(batch.total_count) ? Number(batch.defective_count) / Number(batch.total_count) : null)) }}</strong></div></section>
    <section class="card" aria-labelledby="batch-edit-title"><div class="section-head"><div><h2 id="batch-edit-title">Parti bilgileri</h2><p>{{ batch.machine_code }} · {{ batch.product_code }} · {{ date(batch.started_at) }} – {{ date(batch.ended_at) }}</p></div><button v-if="!batchEditing" type="button" class="button secondary" :disabled="saving" @click="startBatchEdit">Partiyi düzenle{{ !batch.ended_at ? ' ve tamamla' : '' }}</button></div>
      <p v-if="!batch.ended_at" class="callout">Bitiş tarihi girilene kadar olası neden analizi tamamlanamaz. Partiyi düzenleyerek bitiş tarihini kaydedin.</p>
      <form v-if="batchEditing" @submit.prevent="saveBatchEdit" novalidate><fieldset :disabled="saving" class="form-grid two-fields"><label>Başlangıç<input v-model="batchEdit.started_at" type="datetime-local" :aria-invalid="!!batchEditFields.started_at" /><small v-if="batchEditFields.started_at" class="field-error">{{ batchEditFields.started_at }}</small></label><label>Bitiş<input v-model="batchEdit.ended_at" type="datetime-local" :min="batchEdit.started_at" :aria-invalid="!!batchEditFields.ended_at" /><small v-if="batchEditFields.ended_at" class="field-error">{{ batchEditFields.ended_at }}</small></label><label>Toplam parça<input v-model="batchEdit.total_count" type="number" min="0" step="1" :aria-invalid="!!batchEditFields.total_count" /><small v-if="batchEditFields.total_count" class="field-error">{{ batchEditFields.total_count }}</small></label><label>Hatalı parça<input v-model="batchEdit.defective_count" type="number" min="0" step="1" :max="batchEdit.total_count" :aria-invalid="!!batchEditFields.defective_count" /><small v-if="batchEditFields.defective_count" class="field-error">{{ batchEditFields.defective_count }}</small></label><div class="button-row"><button type="submit" class="button primary">{{ saving ? 'Kaydediliyor…' : 'Değişiklikleri kaydet' }}</button><button type="button" class="button secondary" @click="batchEditing = false; batchEditError = ''">Vazgeç</button></div></fieldset></form><p v-if="batchEditError" class="inline-error" role="alert">{{ batchEditError }}</p>
    </section>
    <div class="two-col">
      <section class="card" aria-labelledby="quality-create-title"><h2 id="quality-create-title">Kalite kaydı ekle</h2><p>Bir parçada birden fazla kusur olabilir. Kusur adedi, hatalı parça sayısına eklenmez.</p><form @submit.prevent="addQuality"><fieldset :disabled="saving" class="stack-form"><label>Kusur türü<select v-model="form.kind"><option v-for="(label, key) in defect" :key="key" :value="key">{{ label }}</option></select></label><label>Kusur adedi<input v-model="form.count" type="number" min="1" step="1" required /></label><label>Açıklama<textarea v-model="form.description" rows="3" maxlength="500"></textarea></label><button type="submit" class="button primary">{{ saving ? 'Kaydediliyor…' : 'Kalite kaydı ekle' }}</button></fieldset></form><p v-if="formError" class="inline-error" role="alert">{{ formError }}</p></section>
      <section class="card" aria-labelledby="quality-records-title"><h2 id="quality-records-title">Kusur kayıtları</h2><p v-if="!qualityRecords.length" class="state state-empty">Bu parti için kalite kaydı yok.</p><ul v-else class="record-list"><li v-for="item in qualityRecords" :key="item.id"><strong>{{ defect[item.kind] || item.kind }} · {{ number(item.count) }} kusur</strong><p>{{ item.description || 'Açıklama yok' }}</p><small>{{ date(item.created_at) }}</small><button type="button" class="link-button" :disabled="saving" @click="startQualityEdit(item)">Düzenle</button><button type="button" class="link-button danger" :disabled="saving" @click="deleteQuality(item)">Sil</button></li></ul><p v-if="qualityDeleteError" class="inline-error" role="alert">{{ qualityDeleteError }}</p>
        <form v-if="qualityEditingId" class="inline-form" @submit.prevent="saveQualityEdit"><h3>Kalite kaydını düzenle</h3><fieldset :disabled="saving" class="stack-form"><label>Kusur türü<select v-model="qualityEdit.kind"><option v-for="(label, key) in defect" :key="key" :value="key">{{ label }}</option></select></label><label>Kusur adedi<input v-model="qualityEdit.count" type="number" min="1" step="1" required /></label><label>Açıklama<textarea v-model="qualityEdit.description" rows="3" maxlength="5000"></textarea></label><div class="button-row"><button type="submit" class="button primary">{{ saving ? 'Kaydediliyor…' : 'Değişiklikleri kaydet' }}</button><button type="button" class="button secondary" @click="qualityEditingId = null; qualityEditError = ''">Vazgeç</button></div></fieldset><p v-if="qualityEditError" class="inline-error" role="alert">{{ qualityEditError }}</p></form>
      </section>
    </div>
    <section class="card" aria-labelledby="analysis-title"><div class="section-head"><div><h2 id="analysis-title">Olası neden analizi</h2><p>Kalite verisiyle aynı zaman aralığındaki ölçümleri kullanan örnek karar destek kuralları.</p></div><span class="badge" :class="analysis?.status === 'evaluated' ? 'idle' : 'warning'">{{ analysis?.status === 'evaluated' ? 'Değerlendirildi' : 'Yetersiz veri' }}</span></div>
      <p class="callout">Bu değerlendirme kesin neden veya arıza teşhisi değildir. Makine ölçüm riski ayrı gösterilir.</p>
      <template v-if="analysis">
        <div class="summary-strip"><span>Parti dönemi <strong>{{ date(analysis.window?.start) }} – {{ date(analysis.window?.end) }}</strong></span><span>Bu partinin hata oranı <strong>{{ ratioPercent(analysis.currentRate) }}</strong></span><span>Önceki dönem hata oranı <strong>{{ ratioPercent(analysis.baselineRate) }}</strong></span></div>
        <p v-if="analysis.status === 'insufficient'" class="state state-empty">Analiz için yeterli veri yok. Karşılaştırma için aynı makine ve üründe önceki üretim ile yeterli parça adedi gerekli.</p>
        <p v-else-if="!analysis.findings?.length" class="state state-empty">Örnek olası neden kurallarını tetikleyen bir bulgu yok.</p>
        <div v-else class="finding-list"><article v-for="(finding, index) in analysis.findings" :key="index" class="finding"><h3>{{ finding.rule }}</h3><p><strong>Olası neden:</strong> {{ finding.possibleCause }}</p><p><strong>Önerilen kontrol:</strong> {{ finding.recommendedCheck }}</p><div class="evidence"><h4>Kullanılan kanıt</h4><p>Bu parti: {{ date(finding.evidence?.current?.start) }} – {{ date(finding.evidence?.current?.end) }}, {{ number(finding.evidence?.current?.defective) }} / {{ number(finding.evidence?.current?.total) }} hatalı parça ({{ ratioPercent(finding.evidence?.current?.rate) }}).</p><p>Önceki dönem: {{ date(finding.evidence?.previous?.start) }} – {{ date(finding.evidence?.previous?.end) }}, {{ number(finding.evidence?.previous?.defective) }} / {{ number(finding.evidence?.previous?.total) }} hatalı parça ({{ ratioPercent(finding.evidence?.previous?.rate) }}).</p><p v-if="finding.evidence?.quality">{{ defect[finding.evidence.quality.defectType] || finding.evidence.quality.defectType }}: {{ number(finding.evidence.quality.occurrences) }} kusur, kalite kaydı {{ finding.evidence.quality.records?.join(', ') }}.</p><p v-if="finding.evidence?.measurements?.length">Eşik aşan ölçümler: <span v-for="(m, i) in finding.evidence.measurements" :key="i">{{ i ? '; ' : '' }}{{ number(m.value) }} {{ m.unit }} ({{ date(m.measuredAt) }}, uyarı eşiği {{ number(m.warning) }})</span>.</p><p v-if="finding.evidence?.maintenance?.length">Geciken bakımlar: <span v-for="(m, i) in finding.evidence.maintenance" :key="i">{{ i ? '; ' : '' }}{{ date(m.plannedAt) }}</span>.</p></div><ul v-if="finding.limitations?.length" class="plain-list"><li v-for="(item, i) in finding.limitations" :key="i">{{ item }}</li></ul></article></div>
        <div v-if="analysis.limitations?.length" class="limitations"><h3>Veri sınırları</h3><ul><li v-for="(item, i) in analysis.limitations" :key="i">{{ item }}</li></ul></div>
      </template>
      <p v-else class="state state-empty">Analiz henüz mevcut değil.</p>
    </section>
  </template>
</template>
