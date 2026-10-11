<script setup>
defineProps({ loading: Boolean, error: String, empty: Boolean, emptyText: { type: String, default: 'Kayıt bulunamadı.' } });
defineEmits(['retry']);
</script>

<template>
  <p v-if="loading" class="state state-loading" role="status">Veriler yükleniyor…</p>
  <div v-else-if="error" class="state state-error" role="alert">
    <p>{{ error }}</p><button type="button" class="button secondary" @click="$emit('retry')">Yeniden dene</button>
  </div>
  <p v-else-if="empty" class="state state-empty">{{ emptyText }}</p>
</template>
