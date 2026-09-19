/// <reference types="vite/client" />

import type { DeckApi } from '@shared/api'

declare global {
  interface Window {
    api: DeckApi
  }
}

export {}
