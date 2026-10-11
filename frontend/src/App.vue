<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import OverviewPanel from './components/OverviewPanel.vue';
import MachinesPanel from './components/MachinesPanel.vue';
import ProductionPanel from './components/ProductionPanel.vue';
import MaintenancePanel from './components/MaintenancePanel.vue';

const views = ['overview', 'machines', 'production', 'maintenance'];
const currentView = ref('overview');
const notice = ref(null);
const viewVersion = ref(0);
let noticeTimer;

function syncHash() {
  const target = location.hash.slice(1);
  currentView.value = views.includes(target) ? target : 'overview';
}
function navigate(view) {
  if (view === currentView.value) return;
  location.hash = view;
  syncHash();
}
function notify(message, type = 'success') {
  notice.value = { message, type };
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { notice.value = null; }, 7000);
  viewVersion.value += 1;
}
onMounted(() => { syncHash(); window.addEventListener('hashchange', syncHash); });
onUnmounted(() => { window.removeEventListener('hashchange', syncHash); clearTimeout(noticeTimer); });
</script>

<template>
  <div class="app-shell">
    <a class="skip-link" href="#main-content">İçeriğe geç</a>
    <header class="site-header">
      <div class="header-inner">
        <div class="brand"><span class="brand-mark" aria-hidden="true">M</span><div><strong>Metal Karar Destek</strong><small>Yerel üretim demosu</small></div></div>
        <nav aria-label="Ana gezinme" class="main-nav">
          <button type="button" :aria-current="currentView === 'overview' ? 'page' : undefined" @click="navigate('overview')">Genel bakış</button>
          <button type="button" :aria-current="currentView === 'machines' ? 'page' : undefined" @click="navigate('machines')">Makineler</button>
          <button type="button" :aria-current="currentView === 'production' ? 'page' : undefined" @click="navigate('production')">Üretim ve kalite</button>
          <button type="button" :aria-current="currentView === 'maintenance' ? 'page' : undefined" @click="navigate('maintenance')">Bakım ve uyarılar</button>
        </nav>
      </div>
    </header>
    <main id="main-content" class="container" tabindex="-1">
      <div v-if="notice" class="notice" :class="notice.type" :role="notice.type === 'error' ? 'alert' : 'status'">
        <span>{{ notice.message }}</span><button type="button" aria-label="Bildirimi kapat" @click="notice = null">×</button>
      </div>
      <OverviewPanel v-if="currentView === 'overview'" :refresh-key="viewVersion" @notify="notify" />
      <MachinesPanel v-else-if="currentView === 'machines'" @notify="notify" />
      <ProductionPanel v-else-if="currentView === 'production'" @notify="notify" />
      <MaintenancePanel v-else @notify="notify" />
    </main>
    <footer class="site-footer">Açıklanabilir karar destek · Ölçümler ve eşikler üretici limitleriyle doğrulanmalıdır.</footer>
  </div>
</template>
