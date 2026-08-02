// .mjs, not .js: package.json has no "type": "module", so a .js flat config would
// be parsed as CommonJS and the imports below would fail. Matches scripts/*.mjs.
import js from '@eslint/js'
import prettier from 'eslint-config-prettier'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  // Build output and the caches CI writes. Everything else is ours.
  { ignores: ['out/**', 'release/**', '.cache/**'] },

  js.configs.recommended,

  // recommendedTypeChecked, not strictTypeChecked: strict adds
  // no-non-null-assertion, which fires on every `mainWindow!` in src/main —
  // all of them guarded by the window's own lifecycle, none of them worth
  // rewriting to satisfy a linter.
  //
  // Type-aware linting earns its cost through no-floating-promises alone. The
  // `void somePromise()` idiom appears throughout src/ and is deliberate; without
  // this rule nothing stops a future missing `void` from silently swallowing a
  // rejection.
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ['eslint.config.mjs'] },
        tsconfigRootDir: import.meta.dirname
      }
    }
  },

  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    // Named one by one rather than taken from a preset, deliberately. This plugin
    // also ships the React Compiler rules — `refs`, `purity`, `set-state-in-render`
    // and ~25 more — and which preset carries them has moved between releases.
    // `react-hooks/refs` forbids writing a ref during render, which is exactly what
    // PanelFrame does on purpose: see the comment there about why a useMemo would
    // reintroduce the stale-defaults bug. A preset must not be able to switch that
    // on behind our backs during a routine upgrade.
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error'
    }
  },

  // The build scripts sit outside both tsconfigs, so there is no program for the
  // type-aware rules to consult, and they need Node globals that the browser and
  // Electron configs above do not provide.
  {
    files: ['scripts/**/*.mjs', 'eslint.config.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node }
  },

  // Last, so it wins: turns off every rule Prettier already decides.
  prettier
)
