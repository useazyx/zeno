import { eventHub } from '../../../src/realtime/event-hub.js'

const payload = { vehicle_id: 'v-snapshot', prefix: 'ABT-TEST', dispatch_id: 'd-snapshot', kind: 'sem_sinal' as const, since: '2026-10-08T12:00:00.000Z' }

describe('alertas na reconexão', () => {
  afterEach(() => eventHub.publish({ type: 'vehicle.alert_cleared', payload }))

  it('envia os alertas ativos para quem conecta depois da detecção', () => {
    eventHub.publish({ type: 'vehicle.alert', payload })
    const socket = { readyState: 1, send: jest.fn() }
    const subscriber = { socket } as unknown as Parameters<typeof eventHub.add>[0]
    eventHub.add(subscriber)
    expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: 'vehicle.alert_snapshot', payload: { alerts: [payload] } }))
    eventHub.remove(subscriber)
  })

  it('envia snapshot vazio após resolução para limpar o estado antigo do navegador', () => {
    eventHub.publish({ type: 'vehicle.alert', payload })
    eventHub.publish({ type: 'vehicle.alert_cleared', payload })
    const socket = { readyState: 1, send: jest.fn() }
    const subscriber = { socket } as unknown as Parameters<typeof eventHub.add>[0]
    eventHub.add(subscriber)
    expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: 'vehicle.alert_snapshot', payload: { alerts: [] } }))
    eventHub.remove(subscriber)
  })
})
