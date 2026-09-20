import { createApp } from 'vue'
import { createPinia } from 'pinia'
import FloatApp from './FloatApp.vue'
import '../styles/tokens.css'
import '../styles/base.css'
import './float.css'

createApp(FloatApp).use(createPinia()).mount('#app')
