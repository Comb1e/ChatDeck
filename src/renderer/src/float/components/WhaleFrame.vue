<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { floatPanelRect, FLOAT_WINDOW } from '@shared/floatLayout'
import { panelSkin } from '@shared/whaleSkin'
import { SkinRenderer } from '../../whale/skinRenderer'
const stage = ref<SVGSVGElement>()
onMounted(() => {
  if (stage.value) new SkinRenderer(stage.value).draw(panelSkin(floatPanelRect()))
})
</script>

<template>
  <svg ref="stage" class="whale-frame" :width="FLOAT_WINDOW.width" :height="FLOAT_WINDOW.height" aria-hidden="true" />
</template>

<style scoped>
.whale-frame { position: absolute; inset: 0; pointer-events: none; }
</style>
