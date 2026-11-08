import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

// Rolldown emits "use strict" only where the source states it, and TypeScript
// modules never do, so main and preload would quietly run in sloppy mode.
const strict = { rolldownOptions: { output: { strict: true } } }

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: strict
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: strict
  },
  renderer: {
    plugins: [react()]
  }
})
