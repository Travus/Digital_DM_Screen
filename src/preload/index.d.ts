import type { DmScreenApi } from './index'

declare global {
  interface Window {
    dmscreen: DmScreenApi
  }
}

export {}
