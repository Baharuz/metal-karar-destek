<script setup>
defineProps({ page: { type: Number, default: 1 }, totalPages: { type: Number, default: 1 }, total: { type: Number, default: 0 }, disabled: Boolean });
defineEmits(['change']);
</script>

<template>
  <div class="pagination" aria-label="Sayfalama">
    <span>Toplam {{ total }} kayıt · Sayfa {{ page }} / {{ totalPages }}</span>
    <div class="button-row">
      <button type="button" class="button secondary" :disabled="disabled || page <= 1" @click="$emit('change', page - 1)">Önceki</button>
      <button type="button" class="button secondary" :disabled="disabled || page >= totalPages" @click="$emit('change', page + 1)">Sonraki</button>
    </div>
  </div>
</template>
