/**
 * The smoke harness's half of the app: a development aid, inert unless
 * `DMSCREEN_SMOKE_SHOT` is set.
 *
 * Split out of `index.ts` because it is not the app. It is most of what that
 * file used to weigh, and every line of it exists to drive a build rather than
 * to run one — so the window handling, the document and the IPC now sit in a
 * file you can read end to end without stepping over a test driver.
 *
 * `scripts/smoke.mjs` is the other half: it seeds a userData directory, spawns
 * the built app with the step list in the environment, and decides what the
 * output means. This side executes the steps and reports.
 */
import { app, type BrowserWindow } from 'electron'
import { writeFile } from 'node:fs/promises'

const wait = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms))

/**
 * One thing a smoke shot does before its screenshot. Exactly one field is set —
 * `scripts/smoke.mjs` rejects a step with none or several before the spawn, so
 * this side dispatches on whichever it finds and needs no fallback.
 */
interface SmokeStep {
  menu?: string
  click?: string
  press?: Record<string, unknown>
  type?: { selector: string; text: string }
  select?: { selector: string; start: number; end: number }
  wheel?: { selector: string; deltaY: number; offsetX?: number; offsetY?: number }
  drag?: { from: string; to: string; hold?: boolean }
  hover?: string
  wait?: number
}

/**
 * The steps as the driver compiled them.
 *
 * Ordered, and repeatable per kind, because the interesting states are the ones
 * two inputs apart: a reason shown for a greyed palette row and then a fresh
 * query typed over it is a transition no single input reaches. Five separate
 * environment variables fired in a fixed order could not express it — `type`
 * always ran after `press`, so "narrow the list, then walk it" was unreachable.
 */
function readSteps(): SmokeStep[] {
  const raw = (process.env['DMSCREEN_SMOKE_STEPS'] ?? '').trim()
  return raw ? (JSON.parse(raw) as SmokeStep[]) : []
}

async function runStep(window: BrowserWindow, step: SmokeStep): Promise<void> {
  // A menu command, for UI that has no other way in. The About and Keyboard
  // Shortcuts dialogs open from the native menu only, and a native menu is not
  // something a CSS selector can reach — without this they had no coverage.
  if (step.menu !== undefined) {
    window.webContents.send('menu:action', step.menu)
    return wait(400)
  }

  if (step.click !== undefined) {
    // Focus as well as click, so hover/focus-revealed UI (the condition
    // cross-reference popovers) can be captured too.
    // executeJavaScript resolves as `any`; the script below returns a boolean
    // and nothing else can change that, so name the type here.
    const found = (await window.webContents.executeJavaScript(
      `(() => {
        const el = document.querySelector(${JSON.stringify(step.click)})
        el?.focus?.()
        el?.click?.()
        return !!el
      })()`
    )) as boolean
    if (!found) console.log(`[renderer:error] no element matched ${step.click}`)
    return wait(500)
  }

  // A synthetic keypress. The only way to photograph a half-typed two-stroke
  // sequence: its prefix is a key, not a control, so there is nothing for
  // `click` to select.
  //
  // Dispatched at the focused element rather than at `window`. A real keydown
  // starts there and bubbles, so a window listener — the chord dispatcher, the
  // Escape chain — hears it either way, while a React `onKeyDown` on the
  // focused control only hears it this way: React listens at the root, which is
  // below `window` and never on an event's path when `window` is the target.
  // Dispatching at `window` therefore reached the app-wide listeners and
  // nothing else, which put the action palette's own arrow keys out of reach.
  if (step.press !== undefined) {
    await window.webContents.executeJavaScript(
      `(() => {
        const init = ${JSON.stringify(step.press)}
        const target = document.activeElement ?? window
        target.dispatchEvent(
          new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
        )
        return true
      })()`
    )
    return wait(400)
  }

  // Type into one field. Needed for anything whose interesting state is a
  // *query* — the action palette filtering itself, say — where clicking gets
  // you to the box and no further.
  //
  // The write goes through the native value setter rather than `el.value`
  // because React tracks the last value it wrote on the node itself: a plain
  // assignment updates the DOM but leaves the tracker agreeing with it, so the
  // change event that follows is discarded as a no-op.
  if (step.type !== undefined) {
    const typed = (await window.webContents.executeJavaScript(
      `(() => {
        const { selector, text } = ${JSON.stringify(step.type)}
        const el = document.querySelector(selector)
        if (!el) return false
        // The prototype is taken from the element, not assumed to be
        // HTMLInputElement: calling an input's setter on a textarea throws
        // "Illegal invocation", which put every textarea beyond this step.
        const proto =
          el instanceof window.HTMLTextAreaElement
            ? window.HTMLTextAreaElement.prototype
            : window.HTMLInputElement.prototype
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, text)
        el.dispatchEvent(new Event('input', { bubbles: true }))
        return true
      })()`
    )) as boolean
    if (!typed) console.log(`[renderer:error] nothing to type into: ${step.type.selector}`)
    return wait(400)
  }

  // Put a selection range on a field. `type` leaves the caret at the end and a
  // synthetic Ctrl+A performs no default action, so without this there was no
  // way to reach any behaviour that acts on selected text — Ctrl+B and Ctrl+I
  // over a word being the ones that need it.
  if (step.select !== undefined) {
    const selected = (await window.webContents.executeJavaScript(
      `(() => {
        const { selector, start, end } = ${JSON.stringify(step.select)}
        const el = document.querySelector(selector)
        if (!el) return false
        el.focus()
        el.setSelectionRange(start, end)
        return true
      })()`
    )) as boolean
    if (!selected) console.log(`[renderer:error] nothing to select in: ${step.select.selector}`)
    return wait(400)
  }

  // A wheel notch over one element, for behaviour a click cannot express. Zoom
  // is the case: it has buttons too, but the wheel is the path with the
  // interesting parts on it — the listener has to be the element's own and
  // non-passive to refuse the scroll, and the zoom is aimed at the pointer
  // rather than at the centre, neither of which a button press exercises.
  //
  // `offsetX`/`offsetY` move the pointer off centre, which is the only way to
  // tell an aimed zoom from a centred one: from the middle the two agree.
  if (step.wheel !== undefined) {
    const found = (await window.webContents.executeJavaScript(
      `(() => {
        const { selector, deltaY, offsetX, offsetY } = ${JSON.stringify(step.wheel)}
        const el = document.querySelector(selector)
        if (!el) return false
        const box = el.getBoundingClientRect()
        el.dispatchEvent(
          new WheelEvent('wheel', {
            bubbles: true,
            cancelable: true,
            deltaY,
            clientX: box.left + box.width / 2 + (offsetX ?? 0),
            clientY: box.top + box.height / 2 + (offsetY ?? 0)
          })
        )
        return true
      })()`
    )) as boolean
    if (!found) console.log(`[renderer:error] no element matched ${step.wheel.selector}`)
    return wait(400)
  }

  // Drag one element onto another. Nothing else reaches a drop: `click` cannot
  // express a gesture with two ends, and a real drag is the OS's, not the page's.
  //
  // One DataTransfer is carried through the whole sequence, which is what makes
  // this exercise the handlers rather than mime them — the source's `dragstart`
  // writes the panel id into it and the target's `drop` reads it back out. A
  // constructed DataTransfer stays in read/write mode, unlike the protected one
  // a live drag hands to `dragover`.
  //
  // `hold` stops after the dragover, because the drop indicator only exists
  // between those two events: run the drop and the highlight is already gone by
  // the time anything is photographed.
  if (step.drag !== undefined) {
    const found = (await window.webContents.executeJavaScript(
      `(() => {
        const { from, to, hold } = ${JSON.stringify(step.drag)}
        const source = document.querySelector(from)
        const target = document.querySelector(to)
        if (!source || !target) return false
        const dataTransfer = new DataTransfer()
        const fire = (el, type) => {
          const box = el.getBoundingClientRect()
          el.dispatchEvent(
            new DragEvent(type, {
              bubbles: true,
              cancelable: true,
              dataTransfer,
              clientX: box.left + box.width / 2,
              clientY: box.top + box.height / 2
            })
          )
        }
        fire(source, 'dragstart')
        fire(target, 'dragenter')
        fire(target, 'dragover')
        if (!hold) {
          fire(target, 'drop')
          fire(source, 'dragend')
        }
        return true
      })()`
    )) as boolean
    if (!found) {
      console.log(`[renderer:error] no element matched ${step.drag.from} or ${step.drag.to}`)
    }
    return wait(400)
  }

  // Park the pointer on one control, for UI that only a hover reveals.
  // Dispatched as `pointerover`, not `pointerenter`: React listens at the root
  // and synthesises enter from the bubbling event, so an enter event sent
  // straight to the element goes unheard.
  if (step.hover !== undefined) {
    const found = (await window.webContents.executeJavaScript(
      `(() => {
        const el = document.querySelector(${JSON.stringify(step.hover)})
        if (!el) return false
        const box = el.getBoundingClientRect()
        const init = {
          bubbles: true,
          clientX: box.left + box.width / 2,
          clientY: box.top + box.height / 2,
          pointerType: 'mouse'
        }
        el.dispatchEvent(new PointerEvent('pointerover', init))
        el.dispatchEvent(new MouseEvent('mouseover', init))
        return true
      })()`
    )) as boolean
    if (!found) console.log(`[renderer:error] no element matched ${step.hover}`)
    return
  }

  // A dwell mid-sequence, for a step whose effect is on a timer. The shot-level
  // `settle` is the same thing at the end, where most shots want it.
  if (step.wait !== undefined) return wait(step.wait)
}

/** Backstop for an app that never booted, not a dwell anyone is meant to pay. */
const READY_TIMEOUT_MS = 20_000
const READY_POLL_MS = 50

/**
 * Block until the renderer has restored its session and painted it.
 *
 * This replaced a flat 1800 ms dwell, and the reason is not only that the dwell
 * was usually longer than the wait it stood in for. It was *fixed*, and a fixed
 * wait has no way to be right on two machines: too short and the shot drives an
 * app still showing its pre-restore state, too long and every shot in the suite
 * pays for the slowest. Under the parallel driver the short end stopped being
 * theoretical
 * — several Electrons starting at once on a 4-core runner is exactly the load
 * that stretches a restore past a constant.
 *
 * The failure that avoids matters more than the seconds it saves. A dwell that
 * expires early does not time out; it photographs the wrong screen and fails an
 * expectation, which reads as a broken feature rather than a slow one. A poll
 * gets slower under load instead of getting wrong.
 *
 * `data-ready` comes from an effect in `App.tsx`, so it cannot appear before the
 * commit that rendered the restored layout. Fonts are awaited because the emoji
 * font is scoped and load-bearing, and two frames because the DOM being right is
 * not yet the window being painted — the expectations would not notice, but the
 * screenshot is the half of this harness that only an eye checks.
 */
async function waitForReady(window: BrowserWindow): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS
  while (Date.now() < deadline) {
    const ready = (await window.webContents.executeJavaScript(
      `document.documentElement.dataset.ready === 'true'`
    )) as boolean
    if (ready) {
      await window.webContents.executeJavaScript(
        `(async () => {
          await document.fonts.ready
          // Self-limiting: a window that never gets a frame would otherwise hang
          // here until the driver's own timeout, turning a slow shot into a
          // mystery one.
          await new Promise((done) => {
            const bail = setTimeout(() => done(true), 500)
            requestAnimationFrame(() =>
              requestAnimationFrame(() => {
                clearTimeout(bail)
                done(true)
              })
            )
          })
          return true
        })()`
      )
      return
    }
    await wait(READY_POLL_MS)
  }
  // Reported the way a renderer crash is, so the driver fails the shot and the
  // screenshot still lands: an app that never restored is worth looking at.
  console.log('[renderer:error] the app never finished restoring its session')
}

/** How long an expectation is given to come true before the shot is failed. */
const EXPECT_TIMEOUT_MS = 3000
const EXPECT_POLL_MS = 150

/**
 * Check what the shot claims to show, retrying until it holds or time runs out.
 *
 * The steps before this each dwell a fixed 400-500 ms, which is generous for a
 * React state update and stops being generous when four shots share four cores.
 * Retrying is what keeps that from being a flake: a UI that is merely late
 * arrives on a later poll, and one that is actually broken still fails, having
 * cost the run three seconds it only spends on red.
 *
 * The whole spec has to pass in a *single* evaluation. Accumulating passes
 * across polls would let `found` and `missing` be satisfied at different
 * instants, which is a state the app may never actually have been in.
 */
async function checkExpectations(window: BrowserWindow, spec: string): Promise<string[]> {
  const deadline = Date.now() + EXPECT_TIMEOUT_MS
  for (;;) {
    const failures = (await window.webContents.executeJavaScript(
      `(() => {
        const spec = ${spec}
        const failed = []
        // Present *and* laid out. A display:none match would otherwise
        // pass, which is the same false green as photographing an
        // absent feature.
        for (const selector of spec.found ?? []) {
          const el = document.querySelector(selector)
          if (!el) failed.push('nothing matched ' + selector)
          else if (!el.getClientRects().length) failed.push('not visible: ' + selector)
        }
        for (const selector of spec.missing ?? []) {
          if (document.querySelector(selector)) failed.push('expected no match for ' + selector)
        }
        const text = document.body.innerText
        for (const needle of spec.text ?? []) {
          if (!text.includes(needle)) failed.push('text not present: ' + needle)
        }
        return failed
      })()`
    )) as string[]

    if (!failures.length || Date.now() >= deadline) return failures
    await wait(EXPECT_POLL_MS)
  }
}

/**
 * Development aid, inert unless DMSCREEN_SMOKE_SHOT is set: forwards renderer
 * console messages to stdout, checks what the shot claims to show, then
 * screenshots the window and exits. Used by `scripts/smoke.mjs` to check the UI
 * actually renders in a headless container.
 */
export function installSmokeHook(window: BrowserWindow, index: number): void {
  const shotPath = process.env['DMSCREEN_SMOKE_SHOT']
  if (!shotPath) return
  // A shot drives and photographs one window. Which one is the shot's business —
  // `window: 2` reaches a second screen — but only that one runs the steps, or
  // several windows would each fire the step list and race to exit the app.
  if (index !== Number(process.env['DMSCREEN_SMOKE_WINDOW'] ?? 0)) return

  const levels = ['verbose', 'info', 'warning', 'error'] as const
  window.webContents.on('console-message', (_event, level, message, line, source) => {
    console.log(`[renderer:${levels[level] ?? level}] ${message} (${source}:${line})`)
  })
  window.webContents.on('render-process-gone', (_event, details) => {
    console.log(`[renderer:error] render process gone: ${details.reason}`)
    app.exit(1)
  })

  /**
   * The screenshot, retried.
   *
   * `capturePage()` rejects with `UnknownVizError` when Chromium's compositor
   * has no frame sink ready yet. It is a cold-start problem — it has taken out
   * the *first* shot of a CI run twice, while the other 45 passed — so the fix
   * is to ask again rather than to lengthen the fixed wait every shot already
   * pays.
   *
   * An empty image counts as a failure too. Nothing downstream would catch one:
   * the expectations are checked in the renderer and pass regardless of what the
   * capture returned, so a blank PNG is the exact false green this harness
   * exists to prevent.
   *
   * Logged as `[smoke:retry]`, which the driver prints but does not fail on — a
   * shot that needed two goes is worth seeing without being worth failing.
   */
  const capturePng = async (): Promise<Buffer> => {
    let last: Error | null = null
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      try {
        const image = await window.webContents.capturePage()
        if (image.isEmpty()) throw new Error('capturePage returned an empty image')
        return image.toPNG()
      } catch (error) {
        last = error as Error
        console.log(`[smoke:retry] capture attempt ${attempt} failed: ${last.message}`)
        await wait(600)
      }
    }
    throw last ?? new Error('capturePage never returned an image')
  }

  window.webContents.once('did-finish-load', () => {
    void (async () => {
      try {
        await waitForReady(window)

        // Everything the shot does before the capture, in the order it declared.
        // The driver has already validated the list and desugared the shorthand
        // fields into it, so each step here has exactly one action set.
        for (const step of readSteps()) {
          await runStep(window, step)
        }

        // Extra dwell for shots of something that changes over time — and for a
        // hover the reveal delay has to run out inside.
        const settle = Number(process.env['DMSCREEN_SMOKE_SETTLE'] ?? 0)
        if (Number.isFinite(settle) && settle > 0) await wait(settle)

        // What the shot claims to show. Checked before the capture but reported
        // after it, so a failure still leaves the screenshot on disk to look at
        // — the image is the diagnostic, not the verdict.
        const expectations = (process.env['DMSCREEN_SMOKE_EXPECT'] ?? '').trim()
        const failures = expectations ? await checkExpectations(window, expectations) : []

        await writeFile(shotPath, await capturePng())

        // Reported, not judged: `scripts/smoke.mjs` decides what a failed
        // expectation means, exactly as it already does for console errors.
        for (const failure of failures) console.log(`[smoke:expect] ${failure}`)
        app.exit(0)
      } catch (error) {
        console.log(`[renderer:error] smoke run failed: ${(error as Error).message}`)
        app.exit(1)
      }
    })()
  })
}
