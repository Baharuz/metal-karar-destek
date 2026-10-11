<script setup>
import { onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { get, patch, post, query } from '../api.js';
import { alertStatus, collection, date, isoFromLocal, localDateTime, maintenanceKind, number, totalPages } from '../format.js';
import { loadAllPages } from '../references.js';
import PageState from './PageState.vue';
import PaginationBar from './PaginationBar.vue';

const emit = defineEmits(['notify']);
const machines = ref([]);
const machineError = ref('');
const maintenance = ref([]);
const alerts = ref([]);
const maintenancePagination = ref({ page: 1, total: 0, totalPages: 1 });
const alertPagination = ref({ page: 1, total: 0, totalPages: 1 });
const maintenanceLoaded = ref(false);
const alertLoaded = ref(false);
const maintenanceLoading = ref(false);
const alertLoading = ref(false);
const maintenanceError = ref('');
const alertError = ref('');
const formError = ref('');
const actionError = ref('');
const busy = ref('');
const maintenancePage = ref(1);
const alertPage = ref(1);
const filters = reactive({ machineId: '', maintenanceStatus: '', alertStatus: '' });
const form = reactive({ machine_id: '', kind: 'preventive', scheduled_at: localDateTime(), description: '', action_taken: '' });
const editingId = ref(null);
const editForm = reactive({ kind: 'preventive', scheduled_at: '', description: '' });
const editError = ref('');
const completionId = ref(null);
const completionMachineId = ref(null);
const completion = reactive({ completed_at: localDateTime(), action_taken: '', resolved_alert_ids: [], resolution_reason: '' });
const relatedAlerts = ref([]);
const relatedAlertsLoading = ref(false);
const relatedAlertsError = ref('');
const alertResolveId = ref(null);
const alertReason = ref('');
let maintenanceRequest = 0;
let alertRequest = 0;
let completionRequest = 0;

function machineName(id) { const row = machines.value.find(item => item.id === id); return row ? `${row.code} · ${row.name}` : id; }
async function loadMachines() {
  machineError.value = '';
  try { machines.value = await loadAllPages('/api/machines'); }
  catch (error) { machineError.value = error.message; }
}
function openEdit(item) {
  if (busy.value || item.status !== 'planned') return;
  completionRequest++;
  completionId.value = null;
  editingId.value = item.id;
  Object.assign(editForm, { kind: item.kind, scheduled_at: localDateTime(item.scheduled_at), description: item.description || '' });
  editError.value = '';
}
async function saveEdit() {
  if (busy.value || !editingId.value) return;
  editError.value = '';
  if (!editForm.scheduled_at || !editForm.description.trim()) { editError.value = 'Planlanan tarih ve açıklama gerekli.'; return; }
  const id = editingId.value;
  busy.value = `edit:${id}`;
  maintenanceRequest++; alertRequest++;
  try {
    await patch(`/api/maintenance/${id}`, { kind: editForm.kind, scheduled_at: isoFromLocal(editForm.scheduled_at), description: editForm.description.trim() });
    editingId.value = null;
    const results = await Promise.all([loadMaintenance(), loadAlerts()]);
    emit('notify', results.every(Boolean) ? 'Bakım planı güncellendi.' : 'Bakım güncellendi. Listeler yenilenemedi.', results.every(Boolean) ? 'success' : 'warning');
  } catch (error) { editError.value = error.message; }
  finally { busy.value = ''; }
}
async function loadMaintenance() {
  const id = ++maintenanceRequest;
  maintenanceLoading.value = true;
  maintenanceError.value = '';
  try {
    const data = await get(`/api/maintenance${query({ machineId: filters.machineId, status: filters.maintenanceStatus, page: maintenancePage.value, pageSize: 10 })}`);
    if (id !== maintenanceRequest) return false;
    maintenance.value = collection(data);
    maintenancePagination.value = data.pagination || { page: maintenancePage.value, total: maintenance.value.length, totalPages: 1 };
    maintenanceLoaded.value = true;
    return true;
  } catch (error) { if (id === maintenanceRequest) maintenanceError.value = error.message; return false; }
  finally { if (id === maintenanceRequest) maintenanceLoading.value = false; }
}
async function loadAlerts() {
  const id = ++alertRequest;
  alertLoading.value = true;
  alertError.value = '';
  try {
    const data = await get(`/api/alerts${query({ machineId: filters.machineId, status: filters.alertStatus, page: alertPage.value, pageSize: 10 })}`);
    if (id !== alertRequest) return false;
    alerts.value = collection(data);
    alertPagination.value = data.pagination || { page: alertPage.value, total: alerts.value.length, totalPages: 1 };
    alertLoaded.value = true;
    return true;
  } catch (error) { if (id === alertRequest) alertError.value = error.message; return false; }
  finally { if (id === alertRequest) alertLoading.value = false; }
}
async function addMaintenance() {
  if (busy.value) return;
  formError.value = '';
  if (!form.machine_id || !form.scheduled_at || !form.description.trim()) { formError.value = 'Makine, planlanan tarih ve açıklama gerekli.'; return; }
  busy.value = 'create'; maintenanceRequest++;
  try {
    await post('/api/maintenance', { machine_id: form.machine_id, kind: form.kind, scheduled_at: isoFromLocal(form.scheduled_at), description: form.description.trim(), action_taken: form.action_taken.trim() || undefined });
    Object.assign(form, { machine_id: '', kind: 'preventive', scheduled_at: localDateTime(), description: '', action_taken: '' });
    const refreshed = await loadMaintenance();
    emit('notify', refreshed ? 'Bakım planlandı.' : 'Bakım planlandı. Liste yenilenemedi.', refreshed ? 'success' : 'warning');
  } catch (error) { formError.value = error.message; }
  finally { busy.value = ''; }
}
async function openCompletion(item) {
  if (busy.value || !item) return;
  editingId.value = null;
  completionId.value = item.id;
  completionMachineId.value = item.machine_id;
  Object.assign(completion, { completed_at: localDateTime(), action_taken: '', resolved_alert_ids: [], resolution_reason: '' });
  actionError.value = '';
  await loadRelatedAlerts(item.machine_id);
}
async function loadRelatedAlerts(machineId) {
  if (!machineId) return;
  const token = ++completionRequest;
  relatedAlerts.value = [];
  relatedAlertsLoading.value = true;
  relatedAlertsError.value = '';
  try {
    const results = await Promise.all(['open', 'reviewing'].map(status => loadAllPages('/api/alerts', { machineId, status })));
    if (token === completionRequest) relatedAlerts.value = results.flat();
  } catch (error) { if (token === completionRequest) relatedAlertsError.value = `İlgili uyarılar yüklenemedi: ${error.message}`; }
  finally { if (token === completionRequest) relatedAlertsLoading.value = false; }
}
async function completeMaintenance() {
  if (busy.value || !completionId.value) return;
  actionError.value = '';
  if (relatedAlertsLoading.value || relatedAlertsError.value) { actionError.value = 'Uyarı seçenekleri yüklenmeden bakım tamamlanamaz.'; return; }
  if (!completion.action_taken.trim()) { actionError.value = 'Yapılan işlem açıklaması gerekli.'; return; }
  if (completion.resolved_alert_ids.length > 50) { actionError.value = 'Bir işlemde en fazla 50 uyarı kapatılabilir.'; return; }
  if (completion.resolved_alert_ids.length && !completion.resolution_reason.trim()) { actionError.value = 'Kapatılan uyarıların nedenini yazın.'; return; }
  busy.value = `complete:${completionId.value}`;
  maintenanceRequest++; alertRequest++;
  try {
    await post(`/api/maintenance/${completionId.value}/complete`, {
      completed_at: isoFromLocal(completion.completed_at), action_taken: completion.action_taken.trim(),
      resolved_alert_ids: completion.resolved_alert_ids, resolution_reason: completion.resolution_reason.trim() || undefined
    });
    completionId.value = null;
    const results = await Promise.all([loadMaintenance(), loadAlerts()]);
    emit('notify', results.every(Boolean) ? 'Bakım tamamlandı. Seçilen uyarılar gerekçeleriyle kapatıldı.' : 'Bakım tamamlandı. Listeler yenilenemedi.', results.every(Boolean) ? 'success' : 'warning');
  } catch (error) { actionError.value = error.message; }
  finally { busy.value = ''; }
}
async function changeAlert(item, status) {
  if (busy.value) return;
  const alertId = typeof item === 'object' ? item?.id : item;
  if (!alertId) { actionError.value = 'Uyarı seçimi kayboldu. Yeniden seçin.'; return; }
  actionError.value = '';
  if (status === 'resolved' && !alertReason.value.trim()) { actionError.value = 'Uyarıyı çözmek için gerekçe girin.'; return; }
  busy.value = `alert:${alertId}`;
  alertRequest++;
  try {
    await patch(`/api/alerts/${alertId}`, { status, resolution_reason: status === 'resolved' ? alertReason.value.trim() : undefined });
    alertResolveId.value = null;
    alertReason.value = '';
    const refreshed = await loadAlerts();
    emit('notify', refreshed ? 'Uyarı durumu güncellendi.' : 'Uyarı güncellendi. Liste yenilenemedi.', refreshed ? 'success' : 'warning');
  } catch (error) { actionError.value = error.message; }
  finally { busy.value = ''; }
}
watch(() => [filters.machineId, filters.maintenanceStatus], () => { maintenancePage.value = 1; loadMaintenance(); });
watch(() => [filters.machineId, filters.alertStatus], () => { alertPage.value = 1; loadAlerts(); });
onMounted(() => { loadMachines(); loadMaintenance(); loadAlerts(); });
onUnmounted(() => { maintenanceRequest++; alertRequest++; completionRequest++; });
</script>

<template>
  <div class="page-head"><div><p class="eyebrow">PLAN VE MÜDAHALE</p><h1>Bakım ve uyarılar</h1><p>Bakımları planlayın, tamamlayın ve uyarıların yaşam döngüsünü izleyin.</p></div><button type="button" class="button secondary" :disabled="!!busy" @click="loadMachines(); loadMaintenance(); loadAlerts()">Yenile</button></div>
  <p v-if="machineError" class="inline-error" role="alert">Makine seçenekleri yüklenemedi: {{ machineError }}</p>
  <section class="card" aria-labelledby="create-maintenance-title"><h2 id="create-maintenance-title">Bakım planla</h2><form @submit.prevent="addMaintenance"><fieldset :disabled="!!busy" class="form-grid"><label>Makine<select v-model="form.machine_id" required><option value="">Seçin</option><option v-for="item in machines" :key="item.id" :value="item.id">{{ item.code }} · {{ item.name }}</option></select></label><label>Bakım türü<select v-model="form.kind"><option v-for="(label, key) in maintenanceKind" :key="key" :value="key">{{ label }}</option></select></label><label>Planlanan tarih<input v-model="form.scheduled_at" type="datetime-local" required /></label><label>Açıklama<input v-model="form.description" maxlength="500" required /></label><button class="button primary" type="submit">{{ busy === 'create' ? 'Kaydediliyor…' : 'Bakım planla' }}</button></fieldset></form><p v-if="formError" class="inline-error" role="alert">{{ formError }}</p></section>
  <div class="filters card compact"><label>Makine filtresi<select v-model="filters.machineId"><option value="">Tüm makineler</option><option v-for="item in machines" :key="item.id" :value="item.id">{{ item.code }} · {{ item.name }}</option></select></label><label>Bakım durumu<select v-model="filters.maintenanceStatus"><option value="">Tümü</option><option value="planned">Planlandı</option><option value="completed">Tamamlandı</option></select></label><label>Uyarı durumu<select v-model="filters.alertStatus"><option value="">Tümü</option><option v-for="(label, key) in alertStatus" :key="key" :value="key">{{ label }}</option></select></label></div>
  <section class="card" aria-labelledby="maintenance-list-title"><div class="section-head"><h2 id="maintenance-list-title">Bakım kayıtları</h2><span v-if="maintenanceLoaded">{{ maintenancePagination.total }} kayıt</span></div><p v-if="maintenanceError && maintenanceLoaded" class="inline-error" role="alert">{{ maintenanceError }} <button type="button" class="link-button" @click="loadMaintenance">Yeniden dene</button></p><PageState :loading="maintenanceLoading && !maintenanceLoaded" :error="!maintenanceLoaded ? maintenanceError : ''" :empty="maintenanceLoaded && !maintenanceLoading && !maintenance.length && !maintenanceError" empty-text="Bakım kaydı yok." @retry="loadMaintenance" />
    <div v-if="maintenance.length" class="table-scroll"><table><thead><tr><th>Makine</th><th>Tür</th><th>Planlanan</th><th>Durum</th><th>Açıklama / işlem</th><th>İşlem</th></tr></thead><tbody><tr v-for="item in maintenance" :key="item.id"><td>{{ item.machine_code || machineName(item.machine_id) }}</td><td>{{ maintenanceKind[item.kind] || item.kind }}</td><td>{{ date(item.scheduled_at) }}</td><td><span class="badge" :class="item.status === 'completed' ? 'running' : 'idle'">{{ item.status === 'completed' ? 'Tamamlandı' : 'Planlandı' }}</span><small v-if="item.completed_at" class="block">{{ date(item.completed_at) }}</small></td><td>{{ item.description }}<p v-if="item.action_taken" class="muted-text">Yapılan: {{ item.action_taken }}</p></td><td class="row-actions"><button v-if="item.status === 'planned'" type="button" class="link-button" :disabled="!!busy" @click="openEdit(item)">Düzenle</button><button v-if="item.status === 'planned'" type="button" class="link-button" :disabled="!!busy" @click="openCompletion(item)">Tamamla</button></td></tr></tbody></table></div><PaginationBar v-if="maintenanceLoaded && maintenancePagination.total > 0" :page="Number(maintenancePagination.page) || maintenancePage" :total-pages="totalPages({ pagination: maintenancePagination })" :total="Number(maintenancePagination.total)" :disabled="maintenanceLoading || !!busy" @change="next => { maintenancePage = next; loadMaintenance(); }" />
    <form v-if="editingId" class="inline-form" @submit.prevent="saveEdit"><h3>Bakım planını düzenle</h3><fieldset :disabled="!!busy" class="stack-form"><label>Bakım türü<select v-model="editForm.kind"><option v-for="(label, key) in maintenanceKind" :key="key" :value="key">{{ label }}</option></select></label><label>Planlanan tarih<input v-model="editForm.scheduled_at" type="datetime-local" required /></label><label>Açıklama<textarea v-model="editForm.description" rows="3" maxlength="5000" required></textarea></label><div class="button-row"><button class="button primary" type="submit">{{ busy.startsWith('edit:') ? 'Kaydediliyor…' : 'Değişiklikleri kaydet' }}</button><button class="button secondary" type="button" :disabled="!!busy" @click="editingId = null; editError = ''">Vazgeç</button></div></fieldset><p v-if="editError" class="inline-error" role="alert">{{ editError }}</p></form>
    <form v-if="completionId" class="inline-form" @submit.prevent="completeMaintenance"><h3>Bakımı tamamla</h3><fieldset :disabled="!!busy" class="stack-form"><label>Tamamlanma zamanı<input v-model="completion.completed_at" type="datetime-local" required /></label><label>Yapılan işlem<textarea v-model="completion.action_taken" rows="3" required></textarea></label><fieldset class="nested-fieldset"><legend>Bu bakımla çözülen uyarılar</legend><p v-if="relatedAlertsLoading" role="status">Uyarılar yükleniyor…</p><p v-if="relatedAlertsError" class="inline-error" role="alert">{{ relatedAlertsError }} <button class="link-button" type="button" @click="loadRelatedAlerts(completionMachineId)">Yeniden dene</button></p><p v-if="!relatedAlertsLoading && !relatedAlertsError && !relatedAlerts.length">Seçilebilir açık uyarı yok; diğer uyarılar açık kalır.</p><label v-for="item in relatedAlerts" :key="item.id" class="checkbox-label"><input v-model="completion.resolved_alert_ids" type="checkbox" :value="item.id" />{{ item.title || item.message || `Uyarı ${item.id}` }}</label></fieldset><label v-if="completion.resolved_alert_ids.length">Kapatma gerekçesi<textarea v-model="completion.resolution_reason" rows="2" required></textarea></label><div class="button-row"><button class="button primary" type="submit" :disabled="relatedAlertsLoading || !!relatedAlertsError">{{ busy.startsWith('complete:') ? 'Tamamlanıyor…' : 'Bakımı tamamla' }}</button><button class="button secondary" type="button" :disabled="!!busy" @click="completionRequest++; completionId = null; actionError = ''">Vazgeç</button></div></fieldset></form>
  </section>
  <section class="card" aria-labelledby="alerts-list-title"><div class="section-head"><h2 id="alerts-list-title">Uyarılar</h2><span v-if="alertLoaded">{{ alertPagination.total }} kayıt</span></div><p v-if="alertError && alertLoaded" class="inline-error" role="alert">{{ alertError }} <button type="button" class="link-button" @click="loadAlerts">Yeniden dene</button></p><PageState :loading="alertLoading && !alertLoaded" :error="!alertLoaded ? alertError : ''" :empty="alertLoaded && !alertLoading && !alerts.length && !alertError" empty-text="Bu filtrelerde uyarı yok." @retry="loadAlerts" />
    <div v-if="alerts.length" class="table-scroll"><table><thead><tr><th>Makine</th><th>Uyarı</th><th>Durum</th><th>Oluşturulma</th><th>İşlem</th></tr></thead><tbody><tr v-for="item in alerts" :key="item.id"><td>{{ item.machine_code || machineName(item.machine_id) }}</td><td><strong>{{ item.title || item.message || 'Ölçüm uyarısı' }}</strong><p class="muted-text">{{ item.description || item.explanation }}</p><small v-if="item.resolution_reason">Çözüm: {{ item.resolution_reason }}</small></td><td><span class="badge" :class="item.status === 'resolved' ? 'running' : item.status === 'reviewing' ? 'idle' : 'warning'">{{ alertStatus[item.status] || item.status }}</span></td><td>{{ date(item.created_at) }}</td><td class="row-actions"><button v-if="item.status === 'open'" type="button" class="link-button" :disabled="!!busy" @click="changeAlert(item, 'reviewing')">İncele</button><button v-if="item.status !== 'resolved'" type="button" class="link-button" :disabled="!!busy" @click="alertResolveId = item.id; alertReason = ''">Çöz</button></td></tr></tbody></table></div><PaginationBar v-if="alertLoaded && alertPagination.total > 0" :page="Number(alertPagination.page) || alertPage" :total-pages="totalPages({ pagination: alertPagination })" :total="Number(alertPagination.total)" :disabled="alertLoading || !!busy" @change="next => { alertPage = next; loadAlerts(); }" />
    <form v-if="alertResolveId" class="inline-form" @submit.prevent="changeAlert(alertResolveId, 'resolved')"><h3>Uyarıyı çöz</h3><label>Çözüm gerekçesi<textarea v-model="alertReason" rows="2" required></textarea></label><div class="button-row"><button class="button primary" type="submit" :disabled="!!busy">Çözüldü olarak işaretle</button><button class="button secondary" type="button" :disabled="!!busy" @click="alertResolveId = null; actionError = ''">Vazgeç</button></div></form>
  </section>
  <p v-if="actionError" class="inline-error" role="alert">{{ actionError }}</p>
</template>
