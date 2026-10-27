import { BadRequestError, ConflictError, NotFoundError, ServiceUnavailableError } from "../../../../src/errors/index.js"
import { AiClient } from "../../../../src/services/ai/ai-client.js"

function jsonResponse(status: number, body: unknown) {
  return { status, ok: status >= 200 && status < 300, text: async () => JSON.stringify(body) } as Response
}

describe("AiClient", () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
  })

  it("forwards trace only when requested and keeps it in the live response", async () => {
    const payload = { neural: { exploration: [[-23, -45]] } }
    const fetchMock = jest.fn().mockResolvedValue(jsonResponse(200, payload))
    global.fetch = fetchMock as unknown as typeof fetch
    const client = new AiClient()
    const origin = { latitude: -23, longitude: -45 }
    expect(await client.calculateRoute(origin, origin, { trace: true })).toEqual(payload)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).trace).toBe(true)
    await client.calculateRoute(origin, origin, { trace: false })
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).not.toHaveProperty("trace")
  })

  it("encodes bbox and refuses oversized map layers", async () => {
    const fetchMock = jest.fn().mockResolvedValue(jsonResponse(200, { type: "FeatureCollection", features: [] }))
    global.fetch = fetchMock as unknown as typeof fetch
    await new AiClient().edgeCosts("-46,-24,-45,-23")
    expect(fetchMock.mock.calls[0][0]).toContain("bbox=-46%2C-24%2C-45%2C-23")
    fetchMock.mockResolvedValue(jsonResponse(200, { padding: "x".repeat(17 * 1024 * 1024) }))
    await expect(new AiClient().edgeCosts()).rejects.toThrow("limite de resposta")
  })

  it("posts the origin and destination and returns the parsed route response", async () => {
    const routePayload = {
      neural: { distance_meters: 1000, estimated_time_seconds: 120, node_count: 5, geometry: [] },
      shortest: { distance_meters: 900, estimated_time_seconds: 150, node_count: 4, geometry: [] },
      model_version: "v1"
    }
    const fetchMock = jest.fn().mockResolvedValue(jsonResponse(200, routePayload))
    global.fetch = fetchMock as unknown as typeof fetch

    const result = await new AiClient().calculateRoute(
      { latitude: -23.02, longitude: -45.55 },
      { latitude: -23.03, longitude: -45.56 }
    )

    expect(result).toEqual(routePayload)
    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toContain("/routes")
    expect(JSON.parse(options.body)).toEqual({
      origin_latitude: -23.02,
      origin_longitude: -45.55,
      destination_latitude: -23.03,
      destination_longitude: -45.56
    })
  })

  it("throws BadRequestError with the AI service's detail message on a 4xx response", async () => {
    global.fetch = jest.fn().mockResolvedValue(
      jsonResponse(400, { detail: "Coordinates are too far from the mapped road network" })
    ) as unknown as typeof fetch

    await expect(new AiClient().calculateRoute(
      { latitude: 0, longitude: 0 }, { latitude: 0, longitude: 0 }
    )).rejects.toThrow("Coordinates are too far from the mapped road network")
  })

  it("throws NotFoundError when the AI service does not know the job", async () => {
    global.fetch = jest.fn().mockResolvedValue(
      jsonResponse(404, { detail: "Training job not found" })
    ) as unknown as typeof fetch

    await expect(new AiClient().getTraining("job1")).rejects.toThrow(NotFoundError)
  })

  it("throws ConflictError when the AI service is already training", async () => {
    global.fetch = jest.fn().mockResolvedValue(
      jsonResponse(409, { detail: "A training run is already in progress" })
    ) as unknown as typeof fetch

    await expect(new AiClient().startTraining(800)).rejects.toThrow(ConflictError)
  })

  it("keeps a validation detail readable when the AI service answers with a list", async () => {
    global.fetch = jest.fn().mockResolvedValue(
      jsonResponse(422, { detail: [{ loc: ["body", "origin_latitude"], msg: "Input should be greater than or equal to -90" }] })
    ) as unknown as typeof fetch

    await expect(new AiClient().calculateRoute(
      { latitude: -999, longitude: 0 }, { latitude: 0, longitude: 0 }
    )).rejects.toThrow(BadRequestError)
  })

  it("throws ServiceUnavailableError on a 5xx response", async () => {
    global.fetch = jest.fn().mockResolvedValue(jsonResponse(503, { detail: "engine not loaded" })) as unknown as typeof fetch

    await expect(new AiClient().calculateRoute(
      { latitude: 0, longitude: 0 }, { latitude: 0, longitude: 0 }
    )).rejects.toThrow(ServiceUnavailableError)
  })

  it("throws ServiceUnavailableError when the network request fails outright", async () => {
    global.fetch = jest.fn().mockRejectedValue(new TypeError("fetch failed")) as unknown as typeof fetch

    await expect(new AiClient().getModelInfo()).rejects.toThrow("is unreachable")
  })

  it("throws ServiceUnavailableError with a timeout message when the request aborts", async () => {
    const abortError = new Error("The operation was aborted")
    abortError.name = "AbortError"
    global.fetch = jest.fn().mockRejectedValue(abortError) as unknown as typeof fetch

    await expect(new AiClient().getModelInfo()).rejects.toThrow(/did not answer within/)
  })

  it("parses a training job response from startTraining", async () => {
    const job = {
      job_id: "job1", status: "PENDENTE", epochs: 500,
      train_loss: null, validation_loss: null, best_validation_loss: null,
      started_at: null, finished_at: null, error_message: null, model_path: null
    }
    global.fetch = jest.fn().mockResolvedValue(jsonResponse(200, job)) as unknown as typeof fetch

    await expect(new AiClient().startTraining(500)).resolves.toEqual(job)
  })
})
