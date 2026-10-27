import assert from 'node:assert/strict'
import { test } from 'node:test'

import { eventTone, phraseEvent } from '../src/lib/timeline-language.ts'
import { looksLikeProtocol, normalize, rankCommands } from '../src/lib/command-search.ts'
import { pointClass } from '../src/components/mapa/coverage-palette.ts'
import { streetViewUrl, weatherLabel } from '../src/lib/scene.ts'

const event = (type: string, values: { message?: string, from_value?: string, to_value?: string, vehicle_prefix?: string } = {}) => ({
  type: type as never,
  message: values.message ?? null,
  from_value: values.from_value ?? null,
  to_value: values.to_value ?? null,
  vehicle_prefix: values.vehicle_prefix ?? null,
})

test('timeline lines are written in the console language', () => {
  assert.equal(phraseEvent(event('ABERTURA', { to_value: 'CRITICA' })), 'Ocorrência aberta com prioridade crítica')
  assert.equal(phraseEvent(event('STATUS', { from_value: 'ABERTA', to_value: 'DESPACHADA' })), 'Situação: Aberta → Despachada')
  assert.equal(phraseEvent(event('PRIORIDADE', { from_value: 'MEDIA', to_value: 'ALTA' })), 'Prioridade alterada de média para alta')
  assert.equal(phraseEvent(event('DESPACHO', { message: 'ABT-11201' })), 'ABT-11201 despachada')
  assert.equal(phraseEvent(event('DESPACHO_STATUS', { to_value: 'NO_LOCAL', vehicle_prefix: 'UR-11212' })), 'UR-11212: no local')
  assert.equal(phraseEvent(event('ROTA', { to_value: 'CRITICAL', vehicle_prefix: 'ABT-1', message: 'closures:2' })),
    'Rota em modo crítico calculada para ABT-1, contornando 2 interdição(ões)')
  assert.equal(phraseEvent(event('NOTA', { message: 'Vítima consciente' })), 'Vítima consciente')
})

test('timeline dots carry the meaning of the change', () => {
  assert.equal(eventTone(event('ABERTURA')), 'alert')
  assert.equal(eventTone(event('DESPACHO_STATUS', { to_value: 'FINALIZADO' })), 'ok')
  assert.equal(eventTone(event('NOTA')), 'mute')
})

test('the palette forgives accents and ranks prefixes first', () => {
  const commands = [
    { id: 'a', label: 'Ocorrências', group: 'x' },
    { id: 'b', label: 'Pontos de água', keywords: ['hidrante'], group: 'x' },
    { id: 'c', label: 'Nova ocorrência', group: 'x' },
  ]
  assert.equal(normalize('  Ocorrências '), 'ocorrencias')
  assert.deepEqual(rankCommands(commands, 'ocorr').map((item) => item.id), ['a', 'c'])
  assert.deepEqual(rankCommands(commands, 'hidr').map((item) => item.id), ['b'])
  assert.deepEqual(rankCommands(commands, 'nova ocor').map((item) => item.id), ['c'])
  assert.deepEqual(rankCommands(commands, 'xyz'), [])
  assert.equal(rankCommands(commands, '').length, 3)
})

test('a protocol is recognised in the shapes dispatchers type', () => {
  assert.ok(looksLikeProtocol('2026-002910'))
  assert.ok(looksLikeProtocol('2910'))
  assert.ok(!looksLikeProtocol('rua'))
  assert.ok(!looksLikeProtocol('2026-'))
})

test('demand points are classed against target and outer band', () => {
  assert.equal(pointClass({ time_seconds: 200 }, 4, 12), 'covered')
  assert.equal(pointClass({ time_seconds: 600 }, 4, 12), 'late')
  assert.equal(pointClass({ time_seconds: 900 }, 4, 12), 'outside')
  assert.equal(pointClass({ time_seconds: null }, 4, 12), 'unknown')
})

test('scene helpers', () => {
  assert.equal(weatherLabel(63), 'Chuva')
  assert.equal(weatherLabel(3), 'Nublado')
  assert.equal(weatherLabel(1234), 'Condição desconhecida')
  assert.equal(streetViewUrl(-23.02, -45.55), 'https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=-23.02,-45.55')
})
