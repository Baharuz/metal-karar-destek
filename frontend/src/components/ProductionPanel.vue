<script setup>
import { onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { get, patch, post, query } from '../api.js';
import { collection, date, fieldMessages, isoFromLocal, localDateTime, number, percent, totalPages, utcOffsetMinutes } from '../format.js';
import { loadAllPages } from '../references.js';
import PageState from './PageState.vue';
import PaginationBar from './PaginationBar.vue';
import BatchDetail from './BatchDetail.vue';

const emit = defineEmits(['notify']);
const products = ref([]);
const productItems = ref([]);
const productPagination = ref({ page: 1, total: 0, totalPages: 1 });
const productLoaded = ref(false);
const productLoading = ref(false);
const productListError = ref('');
const productSearch = ref('');
const productPage = ref(1);
const productDetail = ref(null);
const productDetailError = ref('');
const productDetailLoading = ref(false);
const productEdit = reactive({ code: '', name: '', description: '' });
const productEditError = ref('');
const productEditing = ref(false);
const machines = ref([]);
const referenceError = ref('');
const items = ref([]);
const pagination = ref({ page: 1, total: 0, totalPages: 1 });
const summary = ref(null);
const loaded = ref(false);
const loading = ref(false);
const listError = ref('');
const productError = ref('');
const batchError = ref('');
const batchFields = ref({});
const busy = ref('');
const selectedId = ref(null);
const page = ref(1);
const filters = reactive({ machineId: '', productId: '', from: '', to: '' });
const productForm = reactive({ code: '', name: '', description: '' });
const batchForm = reactive({ machine_id: '', product_id: '', started_at: localDateTime(), ended_at: '', total_count: 0, defective_count: 0 });
let requestId = 0;
let productRequest = 0;
let productDetailRequest = 0;
let productDebounce;

function machineName(id) { const item = machines.value.find(row => row.id === id); return item ? `${item.code} · ${item.name}` : id; }
function productName(id) { const item = products.value.find(row => row.id === id); return item ? `${item.code} · ${item.name}` : id; }
async function loadReferences() {
  referenceError.value = '';
  const results = await Promise.allSettled([
    loadAllPages('/api/machines'),
    loadAllPages('/api/products')
  ]);
  if (results[0].status === 'fulfilled') machines.value = results[0].value;
  if (results[1].status === 'fulfilled') products.value = results[1].value;
  const failed = results.filter(result => result.status === 'rejected');
  if (failed.length) referenceError.value = `Makine veya ürün seçenekleri alınamadı: ${failed.map(result => result.reason.message).join(' ')}`;
  return !failed.length;
}
async function loadProductList() {
  const id = ++productRequest;
  productLoading.value = true;
  productListError.value = '';
  try {
    const data = await get(`/api/products${query({ search: productSearch.value.trim(), page: productPage.value, pageSize: 10 })}`);
    if (id !== productRequest) return false;
    productItems.value = collection(data);
    productPagination.value = data.pagination || { page: productPage.value, total: productItems.value.length, totalPages: 1 };
    productLoaded.value = true;
    return true;
  } catch (error) { if (id === productRequest) productListError.value = error.message; return false; }
  finally { if (id === productRequest) productLoading.value = false; }
}
async function showProduct(id) {
  if (busy.value) return;
  const token = ++productDetailRequest;
  productDetail.value = null;
  productDetailError.value = '';
  productEditError.value = '';
  productEditing.value = false;
  productDetailLoading.value = true;
  try { const result = await get(`/api/products/${id}`); if (token === productDetailRequest) productDetail.value = result; }
  catch (error) { if (token === productDetailRequest) productDetailError.value = error.message; }
  finally { if (token === productDetailRequest) productDetailLoading.value = false; }
}
function startProductEdit() {
  if (!productDetail.value || busy.value) return;
  Object.assign(productEdit, { code: productDetail.value.code, name: productDetail.value.name, description: productDetail.value.description || '' });
  productEditError.value = '';
  productEditing.value = true;
}
async function saveProduct() {
  if (!productDetail.value || busy.value) return;
  productEditError.value = '';
  if (!productEdit.code.trim() || !productEdit.name.trim()) { productEditError.value = 'Ürün kodu ve adı gerekli.'; return; }
  const id = productDetail.value.id;
  busy.value = 'product-edit';
  productDetailRequest++;
  try {
    const updated = await patch(`/api/products/${id}`, { code: productEdit.code.trim(), name: productEdit.name.trim(), description: productEdit.description.trim() });
    productDetail.value = updated;
    productEditing.value = false;
    const results = await Promise.all([loadReferences(), loadProductList(), load()]);
    const refreshed = !referenceError.value && results.every(Boolean);
    emit('notify', refreshed ? 'Ürün güncellendi.' : 'Ürün güncellendi. Listeler yenilenemedi.', refreshed ? 'success' : 'warning');
  } catch (error) { productEditError.value = error.message; }
  finally { busy.value = ''; }
}
async function load() {
  const id = ++requestId;
  loading.value = true;
  listError.value = '';
  try {
    const data = await get(`/api/batches${query({ ...filters, utcOffsetMinutes: utcOffsetMinutes(), page: page.value, pageSize: 10 })}`);
    if (id !== requestId) return false;
    items.value = collection(data);
    pagination.value = data.pagination || { page: page.value, total: items.value.length, totalPages: 1 };
    summary.value = data.summary || null;
    loaded.value = true;
    return true;
  } catch (error) { if (id === requestId) listError.value = error.message; return false; }
  finally { if (id === requestId) loading.value = false; }
}
async function addProduct() {
  if (busy.value) return;
  productError.value = '';
  if (!productForm.code.trim() || !productForm.name.trim()) { productError.value = 'Ürün kodu ve adı gerekli.'; return; }
  busy.value = 'product';
  try {
    await post('/api/products', { code: productForm.code.trim(), name: productForm.name.trim(), description: productForm.description.trim() });
    Object.assign(productForm, { code: '', name: '', description: '' });
    await Promise.all([loadReferences(), loadProductList()]);
    const refreshed = !referenceError.value && !productListError.value;
    emit('notify', refreshed ? 'Ürün kaydedildi.' : 'Ürün kaydedildi. Listeler yenilenemedi.', refreshed ? 'success' : 'warning');
  } catch (error) { productError.value = error.message; }
  finally { busy.value = ''; }
}
function validateBatch() {
  const next = {};
  if (!batchForm.machine_id) next.machine_id = 'Makine seçin.';
  if (!batchForm.product_id) next.product_id = 'Ürün seçin.';
  if (!batchForm.started_at) next.started_at = 'Başlangıç zamanı gerekli.';
  if (batchForm.ended_at && new Date(batchForm.ended_at) < new Date(batchForm.started_at)) next.ended_at = 'Bitiş başlangıçtan önce olamaz.';
  for (const key of ['total_count', 'defective_count']) {
    if (!Number.isInteger(Number(batchForm[key])) || Number(batchForm[key]) < 0) next[key] = 'Sıfır veya pozitif tam sayı girin.';
  }
  if (!next.defective_count && Number(batchForm.defective_count) > Number(batchForm.total_count)) next.defective_count = 'Hatalı adet toplamı aşamaz.';
  batchFields.value = next;
  return !Object.keys(next).length;
}
async function addBatch() {
  if (busy.value || !validateBatch()) return;
  busy.value = 'batch';
  batchError.value = '';
  requestId++;
  try {
    const result = await post('/api/batches', {
      machine_id: batchForm.machine_id, product_id: batchForm.product_id,
      started_at: isoFromLocal(batchForm.started_at), ended_at: isoFromLocal(batchForm.ended_at),
      total_count: Number(batchForm.total_count), defective_count: Number(batchForm.defective_count)
    });
    Object.assign(batchForm, { machine_id: '', product_id: '', started_at: localDateTime(), ended_at: '', total_count: 0, defective_count: 0 });
    const refreshed = await load();
    emit('notify', refreshed ? 'Üretim partisi kaydedildi.' : 'Parti kaydedildi. Liste yenilenemedi.', refreshed ? 'success' : 'warning');
    selectedId.value = result.id;
  } catch (error) { batchError.value = error.message; batchFields.value = { ...batchFields.value, ...fieldMessages(error) }; }
  finally { busy.value = ''; }
}
function setPage(next) { page.value = next; load(); }
watch(filters, () => { page.value = 1; load(); });
watch(productSearch, () => { clearTimeout(productDebounce); productDebounce = setTimeout(() => { productPage.value = 1; loadProductList(); }, 300); });
onMounted(() => { loadReferences(); loadProductList(); load(); });
onUnmounted(() => { requestId++; productRequest++; productDetailRequest++; clearTimeout(productDebounce); });
</script>

<template>
  <BatchDetail v-if="selectedId" :id="selectedId" @back="selectedId = null; load()" @notify="(...args) => emit('notify', ...args)" />
  <template v-else>
    <div class="page-head"><div><p class="eyebrow">ÜRETİM SONUÇLARI</p><h1>Üretim ve kalite</h1><p>Ürünleri, partileri ve kusur kayıtlarını ilişkilendirin.</p></div><button type="button" class="button secondary" :disabled="loading || !!busy" @click="loadReferences(); load()">Yenile</button></div>
    <p v-if="referenceError" class="inline-error" role="alert">{{ referenceError }} <button type="button" class="link-button" @click="loadReferences">Yeniden dene</button></p>
    <div class="two-col">
      <section class="card" aria-labelledby="product-title"><h2 id="product-title">Yeni ürün</h2><form @submit.prevent="addProduct"><fieldset :disabled="!!busy" class="stack-form"><label>Ürün kodu<input v-model="productForm.code" maxlength="30" placeholder="PARCA-01" required /></label><label>Ürün adı<input v-model="productForm.name" maxlength="100" required /></label><label>Açıklama<input v-model="productForm.description" maxlength="500" /></label><button type="submit" class="button primary">{{ busy === 'product' ? 'Kaydediliyor…' : 'Ürün ekle' }}</button></fieldset></form><p v-if="productError" class="inline-error" role="alert">{{ productError }}</p></section>
      <section class="card" aria-labelledby="batch-create-title"><h2 id="batch-create-title">Yeni üretim partisi</h2><form @submit.prevent="addBatch" novalidate><fieldset :disabled="!!busy" class="form-grid two-fields"><label>Makine<select v-model="batchForm.machine_id" :aria-invalid="!!batchFields.machine_id"><option value="">Seçin</option><option v-for="item in machines" :key="item.id" :value="item.id">{{ item.code }} · {{ item.name }}</option></select><small v-if="batchFields.machine_id" class="field-error">{{ batchFields.machine_id }}</small></label><label>Ürün<select v-model="batchForm.product_id" :aria-invalid="!!batchFields.product_id"><option value="">Seçin</option><option v-for="item in products" :key="item.id" :value="item.id">{{ item.code }} · {{ item.name }}</option></select><small v-if="batchFields.product_id" class="field-error">{{ batchFields.product_id }}</small></label><label>Başlangıç<input v-model="batchForm.started_at" type="datetime-local" :aria-invalid="!!batchFields.started_at" /><small v-if="batchFields.started_at" class="field-error">{{ batchFields.started_at }}</small></label><label>Bitiş (isteğe bağlı)<input v-model="batchForm.ended_at" type="datetime-local" :min="batchForm.started_at" :aria-invalid="!!batchFields.ended_at" /><small v-if="batchFields.ended_at" class="field-error">{{ batchFields.ended_at }}</small></label><label>Toplam parça<input v-model="batchForm.total_count" type="number" min="0" step="1" :aria-invalid="!!batchFields.total_count" /><small v-if="batchFields.total_count" class="field-error">{{ batchFields.total_count }}</small></label><label>Hatalı parça<input v-model="batchForm.defective_count" type="number" min="0" step="1" :max="batchForm.total_count" :aria-invalid="!!batchFields.defective_count" /><small v-if="batchFields.defective_count" class="field-error">{{ batchFields.defective_count }}</small></label><button type="submit" class="button primary">{{ busy === 'batch' ? 'Kaydediliyor…' : 'Parti oluştur' }}</button></fieldset></form><p v-if="batchError" class="inline-error" role="alert">{{ batchError }}</p></section>
    </div>
    <section class="card" aria-labelledby="product-list-title"><div class="section-head"><h2 id="product-list-title">Ürünler</h2><span v-if="productLoaded">{{ productPagination.total }} kayıt</span></div><div class="filters"><label>Ürün kodu veya adı ara<input v-model="productSearch" type="search" placeholder="Ürün ara" /></label></div><p v-if="productListError && productLoaded" class="inline-error" role="alert">{{ productListError }} <button type="button" class="link-button" @click="loadProductList">Yeniden dene</button></p><PageState :loading="productLoading && !productLoaded" :error="!productLoaded ? productListError : ''" :empty="productLoaded && !productLoading && !productItems.length && !productListError" empty-text="Ürün bulunamadı." @retry="loadProductList" /><div v-if="productItems.length" class="table-scroll"><table><thead><tr><th>Kod</th><th>Ürün</th><th>Açıklama</th><th>İşlem</th></tr></thead><tbody><tr v-for="item in productItems" :key="item.id"><td><strong>{{ item.code }}</strong></td><td>{{ item.name }}</td><td>{{ item.description || '—' }}</td><td><button type="button" class="link-button" :disabled="!!busy" @click="showProduct(item.id)">Detay</button></td></tr></tbody></table></div><PaginationBar v-if="productLoaded && productPagination.total > 0" :page="Number(productPagination.page) || productPage" :total-pages="totalPages({ pagination: productPagination })" :total="Number(productPagination.total)" :disabled="productLoading || !!busy" @change="next => { productPage = next; loadProductList(); }" />
      <div v-if="productDetailLoading" class="state state-loading" role="status">Ürün yükleniyor…</div>
      <div v-if="productDetail || productDetailError" class="inline-form"><div class="section-head"><h3>Ürün detayı</h3><button type="button" class="button ghost" :disabled="!!busy" @click="productDetailRequest++; productDetail = null; productDetailError = ''; productEditing = false">Kapat</button></div><p v-if="productDetailError" class="inline-error" role="alert">{{ productDetailError }}</p><template v-if="productDetail"><template v-if="!productEditing"><p><strong>{{ productDetail.code }} · {{ productDetail.name }}</strong></p><p>{{ productDetail.description || 'Açıklama girilmemiş.' }}</p><small>Oluşturulma: {{ date(productDetail.created_at) }}</small><div class="button-row"><button type="button" class="button secondary" :disabled="!!busy" @click="startProductEdit">Düzenle</button></div></template>
        <form v-else @submit.prevent="saveProduct"><fieldset :disabled="!!busy" class="stack-form"><label>Ürün kodu<input v-model="productEdit.code" maxlength="30" required /></label><label>Ürün adı<input v-model="productEdit.name" maxlength="100" required /></label><label>Açıklama<textarea v-model="productEdit.description" maxlength="5000" rows="3"></textarea></label><div class="button-row"><button type="submit" class="button primary">{{ busy === 'product-edit' ? 'Kaydediliyor…' : 'Değişiklikleri kaydet' }}</button><button type="button" class="button secondary" @click="productEditing = false; productEditError = ''">Vazgeç</button></div></fieldset></form><p v-if="productEditError" class="inline-error" role="alert">{{ productEditError }}</p>
      </template></div>
    </section>
    <section class="card" aria-labelledby="batch-list-title"><div class="section-head"><h2 id="batch-list-title">Üretim partileri</h2><span v-if="loaded">{{ pagination.total }} kayıt</span></div>
      <div class="filters"><label>Makine<select v-model="filters.machineId"><option value="">Tümü</option><option v-for="item in machines" :key="item.id" :value="item.id">{{ item.code }}</option></select></label><label>Ürün<select v-model="filters.productId"><option value="">Tümü</option><option v-for="item in products" :key="item.id" :value="item.id">{{ item.code }}</option></select></label><label>Başlangıç tarihi<input v-model="filters.from" type="date" :max="filters.to || undefined" /></label><label>Bitiş tarihi<input v-model="filters.to" type="date" :min="filters.from || undefined" /></label></div>
      <div v-if="summary" class="summary-strip"><span>Filtrelenen toplam üretim <strong>{{ number(summary.total_count) }}</strong></span><span>Hatalı parça <strong>{{ number(summary.defective_count) }}</strong></span><span>Ağırlıklı hata oranı <strong>{{ percent(summary.defect_rate) }}</strong></span></div>
      <p v-if="listError && loaded" class="inline-error" role="alert">{{ listError }} <button type="button" class="link-button" @click="load">Yeniden dene</button></p>
      <PageState :loading="loading && !loaded" :error="!loaded ? listError : ''" :empty="loaded && !loading && !items.length && !listError" empty-text="Seçilen filtrelerde üretim partisi yok." @retry="load" />
      <div v-if="items.length" class="table-scroll"><table><thead><tr><th>Başlangıç</th><th>Makine</th><th>Ürün</th><th>Toplam</th><th>Hatalı</th><th>Hata oranı</th><th>İşlem</th></tr></thead><tbody><tr v-for="item in items" :key="item.id"><td>{{ date(item.started_at) }}</td><td>{{ item.machine_code || machineName(item.machine_id) }}</td><td>{{ item.product_code || productName(item.product_id) }}</td><td>{{ number(item.total_count) }}</td><td>{{ number(item.defective_count) }}</td><td>{{ percent(item.defect_rate ?? (Number(item.total_count) ? Number(item.defective_count) / Number(item.total_count) : null)) }}</td><td><button type="button" class="link-button" @click="selectedId = item.id">Detay ve analiz</button></td></tr></tbody></table></div>
      <PaginationBar v-if="loaded && pagination.total > 0" :page="Number(pagination.page) || page" :total-pages="totalPages({ pagination })" :total="Number(pagination.total)" :disabled="loading || !!busy" @change="setPage" />
      <p class="footnote">Hata oranı = hatalı parça / toplam parça. Bir parçada birden fazla kusur olabilir; kusur sayıları ayrıca tutulur.</p>
    </section>
  </template>
</template>
