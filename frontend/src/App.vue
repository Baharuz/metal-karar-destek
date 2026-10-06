<script setup>
import { ref, reactive, onMounted } from 'vue';

const machines = ref([]);
const loading = ref(false);
const saving = ref(false);
const listError = ref('');
const formError = ref('');
const success = ref('');

const form = reactive({ code: '', name: '', status: 'idle' });

const statusLabels = {
  idle: 'Beklemede',
  running: 'Çalışıyor',
  maintenance: 'Bakımda'
};

async function loadMachines() {
  loading.value = true;
  listError.value = '';

  try {
    const response = await fetch('/api/machines');
    if (!response.ok) throw new Error('Makine listesi alınamadı.');
    machines.value = await response.json();
  } catch (err) {
    listError.value = err.message;
  } finally {
    loading.value = false;
  }
}

async function addMachine() {
  if (saving.value) return;

  saving.value = true;
  formError.value = '';
  success.value = '';

  try {
    const response = await fetch('/api/machines', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form)
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.message ?? 'Makine kaydedilemedi.');
    }

    success.value = `${data.code} kaydedildi.`;
    form.code = '';
    form.name = '';
    form.status = 'idle';

    await loadMachines();
  } catch (err) {
    formError.value = err.message;
  } finally {
    saving.value = false;
  }
}

onMounted(loadMachines);
</script>

<template>
  <main>
    <header>
      <div>
        <p class="subtitle">Metal Parça Üretimi</p>
        <h1>Makine Takibi</h1>
      </div>
      <button :disabled="loading || saving" @click="loadMachines">
        Yenile
      </button>
    </header>

    <section>
      <h2>Yeni makine</h2>

      <form @submit.prevent="addMachine">
        <fieldset :disabled="saving">
          <label>
            Makine kodu
            <input v-model="form.code" required maxlength="30"
                   placeholder="CNC-002" />
          </label>

          <label>
            Makine adı
            <input v-model="form.name" required maxlength="100"
                   placeholder="CNC Freze 1" />
          </label>

          <label>
            Durum
            <select v-model="form.status">
              <option value="idle">Beklemede</option>
              <option value="running">Çalışıyor</option>
              <option value="maintenance">Bakımda</option>
            </select>
          </label>

          <button type="submit">
            {{ saving ? 'Kaydediliyor...' : 'Makine ekle' }}
          </button>
        </fieldset>
      </form>

      <p v-if="formError" class="error" role="alert">{{ formError }}</p>
      <p v-if="success" class="success" role="status">{{ success }}</p>
    </section>

    <h2>Makine listesi</h2>
    <p v-if="loading" role="status">Makineler yükleniyor...</p>
    <p v-else-if="listError" class="error" role="alert">{{ listError }}</p>
    <p v-else-if="machines.length === 0">Henüz makine kaydı yok.</p>

    <table v-else>
      <thead>
        <tr>
          <th>Kod</th>
          <th>Makine adı</th>
          <th>Durum</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="machine in machines" :key="machine.id">
          <td>{{ machine.code }}</td>
          <td>{{ machine.name }}</td>
          <td>{{ statusLabels[machine.status] ?? machine.status }}</td>
        </tr>
      </tbody>
    </table>
  </main>
</template>

<style scoped>
section { margin-bottom: 36px; }
fieldset {
  border: 0;
  padding: 0;
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  gap: 16px;
}
label { display: flex; flex-direction: column; gap: 8px; }
input, select {
  padding: 12px;
  border: 1px solid #aabcc7;
  border-radius: 6px;
  font: inherit;
  background: white;
}
.success { color: #087443; }
</style>
