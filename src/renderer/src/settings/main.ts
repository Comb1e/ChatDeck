import { createApp } from 'vue'
import { createPinia } from 'pinia'
import SettingsApp from './SettingsApp.vue'
import '../styles/tokens.css'
import '../styles/base.css'

createApp(SettingsApp).use(createPinia()).mount('#app')
