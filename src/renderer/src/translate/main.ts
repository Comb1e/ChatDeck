import { createApp } from 'vue'
import TranslatePopup from './TranslatePopup.vue'
import '../styles/tokens.css'
import '../styles/base.css'
import './translate.css'

// 弹窗无共享状态,不需要 pinia
createApp(TranslatePopup).mount('#app')
