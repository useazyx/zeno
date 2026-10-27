import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  cardinal, explainChoice, phraseStep, speedBand, stepGlyph,
} from '../src/lib/route-language.ts'
import { compositionOf, speedProfile } from '../src/lib/route-insight.ts'

const step = (type: 'depart' | 'turn' | 'continue' | 'roundabout' | 'arrive', modifier: string | null, street: string | null, bearing?: number) =>
  ({ type, modifier, street, bearing })

test('every manoeuvre reads as a driver would say it', () => {
  assert.equal(phraseStep(step('depart', null, 'Rua Bispo Rodovalho')), 'Saia pela Rua Bispo Rodovalho')
  assert.equal(phraseStep(step('depart', null, null, 90)), 'Saia em direção ao leste')
  assert.equal(phraseStep(step('turn', 'right', 'Rua Jacques Félix')), 'Vire à direita na Rua Jacques Félix')
  assert.equal(phraseStep(step('turn', 'slight_left', 'Avenida Independência')), 'Mantenha-se à esquerda na Avenida Independência')
  assert.equal(phraseStep(step('turn', 'sharp_right', null)), 'Vire acentuadamente à direita')
  assert.equal(phraseStep(step('turn', 'straight', 'Rodovia Presidente Dutra')), 'Siga em frente pela Rodovia Presidente Dutra')
  assert.equal(phraseStep(step('turn', 'uturn', 'Avenida Saudade')), 'Faça o retorno na Avenida Saudade')
  assert.equal(phraseStep(step('roundabout', null, 'Avenida Saudade')), 'Na rotatória, saia pela Avenida Saudade')
  assert.equal(phraseStep(step('continue', 'straight', null)), 'Continue em frente')
  assert.equal(phraseStep(step('arrive', null, null)), 'Chegada ao destino')
})

test('the arrow follows the manoeuvre', () => {
  assert.equal(stepGlyph(step('turn', 'slight_right', null)), 'slight-right')
  assert.equal(stepGlyph(step('turn', 'sharp_left', null)), 'left')
  assert.equal(stepGlyph(step('turn', 'uturn', null)), 'uturn')
  assert.equal(stepGlyph(step('roundabout', null, null)), 'roundabout')
})

test('compass points wrap and round to the nearest of eight', () => {
  assert.equal(cardinal(0), 'norte')
  assert.equal(cardinal(359), 'norte')
  assert.equal(cardinal(-90), 'oeste')
  assert.equal(cardinal(200), 'sul')
  assert.equal(cardinal(225), 'sudoeste')
})

test('speed bands compare the prediction with the posted limit', () => {
  assert.equal(speedBand({ speed_kmh: 50, limit_kmh: 60 }), 'fluid')
  assert.equal(speedBand({ speed_kmh: 36, limit_kmh: 60 }), 'moderate')
  assert.equal(speedBand({ speed_kmh: 20, limit_kmh: 60 }), 'slow')
  assert.equal(speedBand({ speed_kmh: 20, limit_kmh: 0 }), 'moderate')
})

test('the explanation states the trade-off, or that there is none', () => {
  const empty = { highway: 0, primary: 0, secondary: 0, tertiary: 0, local: 0 }
  assert.match(
    explainChoice({ ...empty, primary: 800, local: 200 }, { ...empty, primary: 200, local: 800 }, 0.3),
    /troca metros por velocidade: 80% .* contra 20%/,
  )
  assert.match(explainChoice({ ...empty, local: 1 }, { ...empty, local: 1 }, 0.99), /mesmas ruas/)
  assert.match(
    explainChoice({ ...empty, local: 900, primary: 100 }, { ...empty, primary: 700, local: 300 }, 0.2),
    /evitou vias principais/,
  )
})

test('a stored route rebuilds its road mix from its segments', () => {
  const segment = (highway: string, length_meters: number, speed_kmh: number) => ({
    start: 0, end: 1, length_meters, time_seconds: 1, speed_kmh, limit_kmh: 60,
    highway, street: null, counterflow: false, shoulder: false,
  })
  const segments = [segment('primary_link', 100, 55), segment('residential', 50, 10), segment('motorway', 30, 40)]

  assert.deepEqual(compositionOf({ segments }), { highway: 30, primary: 100, secondary: 0, tertiary: 0, local: 50 })
  assert.equal(compositionOf({ segments: [] }), null)
  assert.deepEqual(speedProfile(segments), { fluid: 100, moderate: 30, slow: 50 })
})
