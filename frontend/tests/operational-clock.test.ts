import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const compiled = ts.transpileModule(readFileSync(new URL('../src/components/operational/use-replay-clock.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText

function replayHarness() {
  const state: unknown[] = [], refs: { current: unknown }[] = []
  const effects: { deps: unknown[]; cleanup?: () => void }[] = []
  const timers = new Map<number, () => void>()
  const events = new Map<string, () => void>()
  let cursor = 0, refCursor = 0, effectCursor = 0, timerId = 0, now = 0
  const document = { hidden: false, addEventListener: (name: string, cb: () => void) => events.set(name, cb), removeEventListener: (name: string) => events.delete(name) }
  const exports: { useReplayClock?: (start: number, end: number) => { at: number; playing: boolean; toggle: () => void; seek: (at: number) => void } } = {}
  runInNewContext(compiled, { exports, document, performance: { now: () => now },
    setInterval: (cb: () => void) => { const id = ++timerId; timers.set(id, cb); return id }, clearInterval: (id: number) => timers.delete(id),
    require: (name: string) => name === 'react' ? {
      useState: (initial: unknown) => { const id = cursor++; if (!(id in state)) state[id] = initial; return [state[id], (value: unknown) => { state[id] = typeof value === 'function' ? value(state[id]) : value }] },
      useRef: (initial: unknown) => { const id = refCursor++; return refs[id] ?? (refs[id] = { current: initial }) },
      useEffect: (effect: () => (() => void) | undefined, deps: unknown[]) => { const id = effectCursor++, previous = effects[id]; if (!previous || deps.some((dep, i) => dep !== previous.deps[i])) { previous?.cleanup?.(); effects[id] = { deps, cleanup: effect() } } },
    } : { useReducedOperationMotion: () => false },
  })
  const render = () => { cursor = 0; refCursor = 0; effectCursor = 0; return exports.useReplayClock!(0, 120000) }
  return { render, tick: (ms: number) => { now += ms; [...timers.values()].forEach((cb) => cb()) }, visibility: (hidden: boolean) => { document.hidden = hidden; events.get('visibilitychange')?.() }, timers }
}

test('a completed historical replay starts again when Rever is pressed', () => {
  const run = replayHarness()
  run.render().toggle(); run.render(); run.tick(60000)
  const finished = run.render()
  assert.equal(finished.at, 120000)
  assert.equal(finished.playing, false)
  finished.toggle(); run.render(); run.tick(1000)
  assert.equal(run.render().at, 2000)
})

test('historical playback pauses while hidden and manual seek stays paused', () => {
  const run = replayHarness()
  run.render().toggle(); run.render(); run.tick(1000)
  run.visibility(true); run.tick(60000); run.visibility(false); run.tick(1000)
  assert.equal(run.render().at, 4000)
  run.render().seek(100000); run.render(); run.tick(1000)
  assert.equal(run.render().at, 100000)
  assert.equal(run.timers.size, 0)
})
