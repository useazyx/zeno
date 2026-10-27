/**
 * Histórico sintético de demonstração: 01/01/2001 a 24/09/2026.
 * Não representa registros oficiais de Taubaté. Preserva cadastro e treinamentos.
 * Faz backup antes da substituição e grava ocorrências/despachos em uma transação.
 * npm run seed:occurrences -- --preview valida o conjunto sem alterar o banco.
 */

import { randomUUID } from "node:crypto"
import { sampleStreet } from "./demo-geography.js"
import assert from "node:assert/strict"
import { mkdirSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"

import { Prisma } from "../src/generated/prisma/client.js"
import type {
  OccurrenceNature, OccurrencePriority, OccurrenceStatus,
} from "../src/generated/prisma/client.js"
import { prisma } from "../src/config/prisma.js"

const START = Date.parse("2001-01-01T00:00:00-03:00")
const END = Date.parse("2026-09-24T18:00:00-03:00")
const DAYS = 365
const SEED = 20260924
process.env.TZ = "America/Sao_Paulo"

// -- deterministic randomness ------------------------------------------------

/// Mulberry32: small, fast, and good enough to scatter incidents over a city.
function makeRandom(seed: number) {
  let state = seed >>> 0

  return () => {
    state = (state + 0x6D2B79F5) >>> 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const random = makeRandom(SEED)

const between = (min: number, max: number) => min + random() * (max - min)
const intBetween = (min: number, max: number) => Math.floor(between(min, max + 1))
const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]

/// Picks from a weighted list. Weights are relative, not probabilities.
function weightedPick<T>(entries: readonly { item: T, weight: number }[]): T {
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0)
  let roll = random() * total

  for (const entry of entries) {
    roll -= entry.weight
    if (roll <= 0) return entry.item
  }

  return entries[entries.length - 1].item
}

// -- the city ----------------------------------------------------------------

interface District {
  name: string
  latitude: number
  longitude: number
  /// Relative share of the city's calls. Dense central neighbourhoods call an
  /// order of magnitude more often than the rural edges, and a ranking with no
  /// spread between top and bottom would be a ranking of noise.
  weight: number
  streets: string[]
}

const DISTRICTS: District[] = [
  {
    name: "Centro", latitude: -23.0264, longitude: -45.5551, weight: 100,
    streets: [
      "Rua Jacques Félix", "Avenida Tiradentes", "Rua Duque de Caxias",
      "Rua Visconde do Rio Branco", "Praça Dom Epaminondas", "Rua Emílio Winther",
    ],
  },
  {
    name: "Jardim das Nações", latitude: -23.0186, longitude: -45.5487, weight: 62,
    streets: ["Avenida Charles Schneider", "Rua Nagib Chede", "Rua das Nações"],
  },
  {
    name: "Vila São Geraldo", latitude: -23.0348, longitude: -45.5486, weight: 58,
    streets: ["Avenida Bandeirantes", "Rua Coronel Marcondes de Mattos", "Rua São Geraldo"],
  },
  {
    name: "Independência", latitude: -23.0327, longitude: -45.5678, weight: 54,
    streets: ["Avenida Independência", "Rua Barão da Pedra Negra", "Rua Sete de Setembro"],
  },
  {
    name: "Parque Aeroporto", latitude: -23.0405, longitude: -45.5162, weight: 44,
    streets: ["Avenida Juscelino Kubitschek", "Rua do Aeroporto", "Avenida do Povo"],
  },
  {
    name: "Vila Costa", latitude: -23.0231, longitude: -45.5624, weight: 41,
    streets: ["Rua Coronel Gomes Nogueira", "Avenida Granadeiro Guimarães", "Rua Vigário Simões"],
  },
  {
    name: "Estiva", latitude: -23.0104, longitude: -45.5352, weight: 38,
    streets: ["Avenida Prefeito Luiz Gonzaga Cid Boaventura", "Rua da Estiva", "Rua Antônio Saad"],
  },
  {
    name: "Jardim Ana Emília", latitude: -23.0107, longitude: -45.5603, weight: 33,
    streets: ["Rua Ana Emília", "Avenida Itália", "Rua Portugal"],
  },
  {
    name: "Bosque da Saúde", latitude: -23.0452, longitude: -45.5746, weight: 31,
    streets: ["Avenida Bosque da Saúde", "Rua das Palmeiras", "Rua dos Ipês"],
  },
  {
    name: "Vila Edmundo", latitude: -23.0209, longitude: -45.5702, weight: 29,
    streets: ["Rua Edmundo Pereira", "Avenida Marechal Deodoro da Fonseca", "Rua Souza Alves"],
  },
  {
    name: "Jardim Continental", latitude: -23.0381, longitude: -45.5598, weight: 27,
    streets: ["Avenida Continental", "Rua Guaratinguetá", "Rua Pindamonhangaba"],
  },
  {
    name: "Cidade Jardim", latitude: -23.0343, longitude: -45.5357, weight: 24,
    streets: ["Avenida Cidade Jardim", "Rua das Acácias", "Rua dos Manacás"],
  },
  {
    name: "Jardim Maria Augusta", latitude: -23.0496, longitude: -45.5451, weight: 22,
    streets: ["Rua Maria Augusta", "Avenida Dom Pedro I", "Rua Santa Terezinha"],
  },
  {
    name: "Piracangaguá", latitude: -22.9915, longitude: -45.5031, weight: 20,
    streets: ["Rodovia Presidente Dutra", "Estrada de Piracangaguá", "Rua do Cruzeiro"],
  },
  {
    name: "Barranco Alto", latitude: -23.0081, longitude: -45.5259, weight: 16,
    streets: ["Rua Barranco Alto", "Estrada Municipal do Barranco Alto"],
  },
  {
    name: "Chácara Silvestre", latitude: -23.0177, longitude: -45.5748, weight: 13,
    streets: ["Rua Silvestre", "Estrada das Chácaras"],
  },
  {
    name: "Quiririm", latitude: -23.0470, longitude: -45.6338, weight: 11,
    streets: ["Avenida Domingos Sérgio Falcão", "Rua Emílio Belletti", "Praça Rio Branco"],
  },
  {
    name: "São Gonçalo", latitude: -23.0662, longitude: -45.5307, weight: 6,
    streets: ["Estrada Municipal de São Gonçalo", "Rua da Capela"],
  },
]

/**
 * Addresses the fire department keeps returning to.
 *
 * Every record has them — the bend on the highway that collects crashes, the
 * empty lot that burns every dry season, the building whose alarm panel is
 * broken. A record without them looks uniformly random, which no real record
 * is, and the recurrence panel would have nothing true to find.
 */
const HOTSPOTS = [
  {
    address: "Rodovia Presidente Dutra, km 118, Piracangaguá, Taubaté",
    latitude: -22.9942, longitude: -45.5074,
    nature: "INCENDIO_VEICULO" as OccurrenceNature,
    district: "Piracangaguá",
    times: 11,
  },
  {
    address: "Avenida Charles Schneider, 1500, Jardim das Nações, Taubaté",
    latitude: -23.0198, longitude: -45.5462,
    nature: "ATENDIMENTO_PRE_HOSPITALAR" as OccurrenceNature,
    district: "Jardim das Nações",
    times: 9,
  },
  {
    address: "Estrada Municipal do Barranco Alto, s/n, Barranco Alto, Taubaté",
    latitude: -23.0067, longitude: -45.5241,
    nature: "INCENDIO_VEGETACAO" as OccurrenceNature,
    district: "Barranco Alto",
    times: 8,
  },
  {
    address: "Avenida Tiradentes, 640, Centro, Taubaté",
    latitude: -23.0272, longitude: -45.5563,
    nature: "ATENDIMENTO_PRE_HOSPITALAR" as OccurrenceNature,
    district: "Centro",
    times: 7,
  },
  {
    address: "Rua Barão da Pedra Negra, 220, Independência, Taubaté",
    latitude: -23.0331, longitude: -45.5669,
    nature: "VISTORIA" as OccurrenceNature,
    district: "Independência",
    times: 6,
  },
]

// -- what gets called in ------------------------------------------------------

interface NatureProfile {
  nature: OccurrenceNature
  weight: number
  priorities: { item: OccurrencePriority, weight: number }[]
  /// Minutes from the call to closing the incident.
  minutes: [number, number]
  /// Multiplier per month index (0 = January), for what the seasons change.
  season?: number[]
  /// Multiplier for the hours of the day, 24 entries.
  hours?: number[]
  descriptions: string[]
}

const EVENING = [
  0.3, 0.2, 0.2, 0.15, 0.15, 0.3, 0.6, 1.0, 1.2, 1.2, 1.1, 1.2,
  1.3, 1.3, 1.4, 1.5, 1.6, 1.8, 1.7, 1.4, 1.1, 0.9, 0.7, 0.5,
]

const AFTERNOON = [
  0.1, 0.1, 0.1, 0.1, 0.1, 0.2, 0.3, 0.5, 0.8, 1.0, 1.3, 1.6,
  1.9, 2.2, 2.4, 2.3, 1.9, 1.4, 0.9, 0.6, 0.4, 0.3, 0.2, 0.15,
]

const OFFICE = [
  0.02, 0.02, 0.02, 0.02, 0.02, 0.05, 0.2, 0.6, 1.4, 1.8, 1.9, 1.6,
  0.8, 1.4, 1.8, 1.8, 1.5, 0.9, 0.3, 0.1, 0.05, 0.03, 0.02, 0.02,
]

/// Dry season in the Paraíba valley: vegetation burns from June to September.
const DRY_SEASON = [0.3, 0.3, 0.4, 0.6, 1.2, 2.2, 3.0, 3.4, 2.6, 1.0, 0.5, 0.3]
/// Rivers and reservoirs only take swimmers in the summer.
const SUMMER = [2.4, 2.0, 1.2, 0.6, 0.3, 0.2, 0.2, 0.2, 0.4, 0.8, 1.4, 2.2]

const NATURES: NatureProfile[] = [
  {
    nature: "ATENDIMENTO_PRE_HOSPITALAR",
    weight: 100,
    priorities: [
      { item: "ALTA", weight: 45 }, { item: "MEDIA", weight: 40 },
      { item: "CRITICA", weight: 10 }, { item: "BAIXA", weight: 5 },
    ],
    minutes: [25, 90],
    hours: EVENING,
    descriptions: [
      "Colisão entre dois veículos com uma vítima presa às ferragens.",
      "Motociclista caído na via, consciente, com suspeita de fratura exposta.",
      "Queda de idoso em residência, vítima consciente e sem conseguir se levantar.",
      "Mal súbito em via pública, vítima inconsciente e respirando.",
      "Atropelamento de pedestre na faixa, vítima consciente.",
      "Vítima de queda de altura em obra, cerca de quatro metros.",
      "Crise convulsiva em local público, vítima já sem convulsionar.",
    ],
  },
  {
    nature: "INCENDIO_VEGETACAO",
    weight: 58,
    priorities: [
      { item: "MEDIA", weight: 50 }, { item: "ALTA", weight: 38 },
      { item: "BAIXA", weight: 8 }, { item: "CRITICA", weight: 4 },
    ],
    minutes: [45, 240],
    season: DRY_SEASON,
    hours: AFTERNOON,
    descriptions: [
      "Incêndio em vegetação rasteira avançando na direção de residências.",
      "Foco de incêndio em terreno baldio com acúmulo de lixo.",
      "Queimada em área de pasto, com fumaça atingindo a rodovia.",
      "Incêndio em capoeira próximo a rede de distribuição de energia.",
      "Fogo em vegetação às margens da linha férrea.",
    ],
  },
  {
    nature: "INCENDIO_EDIFICACAO",
    weight: 26,
    priorities: [
      { item: "ALTA", weight: 48 }, { item: "CRITICA", weight: 40 },
      { item: "MEDIA", weight: 12 },
    ],
    minutes: [70, 320],
    hours: EVENING,
    descriptions: [
      "Fogo em residência de dois andares, com informação de vítimas no interior.",
      "Princípio de incêndio em cozinha de estabelecimento comercial.",
      "Incêndio em depósito de materiais recicláveis, muita fumaça.",
      "Curto-circuito em quadro de energia com fogo em apartamento.",
      "Incêndio em galpão industrial desativado.",
    ],
  },
  {
    nature: "INCENDIO_VEICULO",
    weight: 22,
    priorities: [
      { item: "ALTA", weight: 45 }, { item: "MEDIA", weight: 45 },
      { item: "CRITICA", weight: 10 },
    ],
    minutes: [30, 110],
    hours: EVENING,
    descriptions: [
      "Veículo de passeio em chamas no acostamento.",
      "Caminhão com princípio de incêndio no compartimento do motor.",
      "Motocicleta incendiada após colisão.",
      "Ônibus urbano com fumaça saindo do motor, passageiros já desembarcados.",
    ],
  },
  {
    nature: "SALVAMENTO",
    weight: 20,
    priorities: [
      { item: "ALTA", weight: 50 }, { item: "CRITICA", weight: 30 },
      { item: "MEDIA", weight: 20 },
    ],
    minutes: [40, 180],
    hours: EVENING,
    descriptions: [
      "Vítima presa em elevador entre andares.",
      "Pessoa em situação de risco no alto de uma laje.",
      "Trabalhador preso em vala de obra após desabamento parcial.",
      "Resgate de vítima em veículo capotado fora da pista.",
      "Criança com o braço preso em grade de portão.",
    ],
  },
  {
    nature: "CAPTURA_ANIMAL",
    weight: 30,
    priorities: [
      { item: "BAIXA", weight: 70 }, { item: "MEDIA", weight: 28 },
      { item: "ALTA", weight: 2 },
    ],
    minutes: [20, 75],
    hours: OFFICE,
    descriptions: [
      "Enxame de abelhas alojado em muro de escola.",
      "Serpente encontrada no quintal de residência.",
      "Cão preso em galeria de águas pluviais.",
      "Gato em telhado alto há dois dias, sem descer.",
      "Capivara ferida às margens do rio.",
    ],
  },
  {
    nature: "VISTORIA",
    weight: 26,
    priorities: [
      { item: "BAIXA", weight: 82 }, { item: "MEDIA", weight: 18 },
    ],
    minutes: [30, 90],
    hours: OFFICE,
    descriptions: [
      "Vistoria técnica para renovação do auto de vistoria do estabelecimento.",
      "Verificação de denúncia sobre saída de emergência obstruída.",
      "Vistoria em escola municipal a pedido da secretaria de educação.",
      "Conferência de extintores e hidrantes em edifício residencial.",
    ],
  },
  {
    nature: "PRODUTOS_PERIGOSOS",
    weight: 8,
    priorities: [
      { item: "ALTA", weight: 55 }, { item: "CRITICA", weight: 35 },
      { item: "MEDIA", weight: 10 },
    ],
    minutes: [90, 300],
    descriptions: [
      "Vazamento de combustível após tombamento de carreta na rodovia.",
      "Cilindro de gás com vazamento em estabelecimento comercial.",
      "Produto químico não identificado derramado em pátio de transportadora.",
    ],
  },
  {
    nature: "AFOGAMENTO",
    weight: 6,
    priorities: [
      { item: "CRITICA", weight: 70 }, { item: "ALTA", weight: 30 },
    ],
    minutes: [50, 200],
    season: SUMMER,
    hours: AFTERNOON,
    descriptions: [
      "Banhista desaparecido no rio, buscas em andamento.",
      "Criança resgatada de piscina residencial, consciente.",
      "Vítima levada pela correnteza após chuva forte.",
    ],
  },
  {
    nature: "OUTROS",
    weight: 14,
    priorities: [
      { item: "BAIXA", weight: 55 }, { item: "MEDIA", weight: 40 },
      { item: "ALTA", weight: 5 },
    ],
    minutes: [25, 100],
    hours: OFFICE,
    descriptions: [
      "Árvore de grande porte caída sobre a via após vendaval.",
      "Poste de energia inclinado com risco de queda.",
      "Alagamento em residência após chuva forte.",
      "Apoio a outro órgão em ocorrência de trânsito.",
      "Placa de sinalização solta e prestes a cair sobre a calçada.",
    ],
  },
]

const CALLER_NAMES = [
  "Marcos Antunes", "Rita de Cássia Moraes", "João Batista Silveira",
  "Fernanda Prado", "Sebastião Ribeiro", "Luciana Toledo", "Anderson Camargo",
  "Vera Lúcia Nogueira", "Paulo Henrique Vieira", "Cláudia Marins",
  "Edson Ferraz", "Tereza Aparecida Lopes", "Rogério Damasceno",
  "Silvana Queiroz", "Wagner Bastos", "Marlene Figueiredo",
]

// -- the year ----------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000

interface Draft {
  openedAt: Date
  nature: OccurrenceNature
  priority: OccurrencePriority
  description: string
  address: string
  district: string
  latitude: number
  longitude: number
}

/**
 * A moment inside `day`, weighted by the hour profile of this kind of call.
 *
 * Rejection sampling: draw an hour, keep it with a probability proportional to
 * its weight. Twenty tries is far more than enough for profiles whose peak is
 * only a few times their floor, and falling through to a uniform hour is a
 * harmless outcome rather than a hang.
 */
function hourFor(profile: NatureProfile): number {
  const hours = profile.hours
  if (!hours) return intBetween(0, 23)

  const peak = Math.max(...hours)

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const hour = intBetween(0, 23)
    if (random() < hours[hour] / peak) return hour
  }

  return intBetween(0, 23)
}

function makeDraft(now: number, days = DAYS): Draft {
  const profile = weightedPick(NATURES.map((entry) => ({ item: entry, weight: entry.weight })))

  // The date is drawn first and then kept or rejected against the season, so a
  // vegetation fire lands in August far more often than in February.
  let day = 0
  for (let attempt = 0; attempt < 30; attempt += 1) {
    day = intBetween(0, days - 1)
    if (!profile.season) break

    const month = new Date(now - day * DAY_MS).getMonth()
    if (random() < profile.season[month] / Math.max(...profile.season)) break
  }

  const date = new Date(now - day * DAY_MS)
  date.setHours(hourFor(profile), intBetween(0, 59), intBetween(0, 59), 0)

  const district = weightedPick(
    DISTRICTS.map((entry) => ({ item: entry, weight: entry.weight })),
  )

  const location = sampleStreet(district.latitude, district.longitude, random)

  return {
    openedAt: date,
    nature: profile.nature,
    priority: weightedPick(profile.priorities),
    description: pick(profile.descriptions),
    address: `${location.street}, ${intBetween(20, 2400)}, ${district.name}, Taubaté`,
    district: district.name,
    // Sample a real road segment, with a smooth neighbourhood density.
    latitude: location.latitude,
    longitude: location.longitude,
  }
}

function makeHotspotDraft(now: number): Draft[] {
  const drafts: Draft[] = []

  for (const spot of HOTSPOTS) {
    const profile = NATURES.find((entry) => entry.nature === spot.nature)!

    for (let index = 0; index < spot.times; index += 1) {
      const date = new Date(now - intBetween(0, DAYS - 1) * DAY_MS)
      date.setHours(hourFor(profile), intBetween(0, 59), intBetween(0, 59), 0)

      drafts.push({
        openedAt: date,
        nature: spot.nature,
        priority: weightedPick(profile.priorities),
        description: pick(profile.descriptions),
        address: spot.address,
        district: spot.district,
        // Barely scattered: it is the *same* place coming back, and a
        // recurrence that drifts 300 metres each time is not a recurrence.
        latitude: spot.latitude + between(-0.0004, 0.0004),
        longitude: spot.longitude + between(-0.0004, 0.0004),
      })
    }
  }

  return drafts
}

/**
 * A handful of calls from the last few hours.
 *
 * One incident a day over a year leaves essentially zero chance that any of
 * them is still running when the seed finishes, so the dispatch board, the
 * operational panel and the live feed would all open empty — which says
 * nothing about whether they work. These are drawn inside the last ten hours
 * so the shift in progress has a shift in progress.
 */
function makeLiveDrafts(now: number, count: number): Draft[] {
  return Array.from({ length: count }, () => {
    const draft = makeDraft(now)
    draft.openedAt = new Date(now - between(4, 10 * 60) * 60 * 1000)
    return draft
  })
}

/** How an incident that old is likely to have ended. */
function statusFor(ageHours: number): OccurrenceStatus {
  if (ageHours < 2) {
    return weightedPick([
      { item: "ABERTA" as OccurrenceStatus, weight: 40 },
      { item: "DESPACHADA" as OccurrenceStatus, weight: 35 },
      { item: "EM_ATENDIMENTO" as OccurrenceStatus, weight: 25 },
    ])
  }

  if (ageHours < 12) {
    return weightedPick([
      { item: "EM_ATENDIMENTO" as OccurrenceStatus, weight: 35 },
      { item: "ENCERRADA" as OccurrenceStatus, weight: 60 },
      { item: "CANCELADA" as OccurrenceStatus, weight: 5 },
    ])
  }

  return weightedPick([
    { item: "ENCERRADA" as OccurrenceStatus, weight: 93 },
    { item: "CANCELADA" as OccurrenceStatus, weight: 7 },
  ])
}

interface Responder {
  id: string
  acronym: string
  latitude: number
  longitude: number
}

function responderFor(draft: Draft, responders: Responder[]): Responder {
  if (random() > 0.85) return pick(responders)

  return responders.reduce((best, candidate) => {
    const distance = (post: Responder) =>
      (post.latitude - draft.latitude) ** 2 + (post.longitude - draft.longitude) ** 2

    return distance(candidate) < distance(best) ? candidate : best
  })
}

// -- the run ------------------------------------------------------------------

async function main() {
  const posts = await prisma.unit.findMany({
    where: { active: true, type: { in: ["POSTO", "SUBGRUPAMENTO"] } },
    select: { id: true, acronym: true, latitude: true, longitude: true },
  })
  const responders: Responder[] = posts.map((post) => ({
    ...post, latitude: Number(post.latitude), longitude: Number(post.longitude),
  }))
  const vehicles = await prisma.vehicle.findMany({ orderBy: { prefix: "asc" } })
  const fleet = vehicles.filter((vehicle) => vehicle.status !== "MANUTENCAO" && vehicle.status !== "INDISPONIVEL")
  assert(responders.length > 0 && fleet.length > 0, "É necessário ter unidades e viaturas disponíveis.")

  const drafts: Draft[] = []
  for (let year = 2001; year <= 2026; year += 1) {
    const from = Date.parse(`${year}-01-01T00:00:00-03:00`)
    const until = Math.min(END, Date.parse(`${year + 1}-01-01T00:00:00-03:00`) - 1)
    const days = Math.ceil((until - from) / DAY_MS)
    // Crescimento demonstrativo, não uma série demográfica oficial.
    const count = Math.round((1800 + (year - 2001) * 85) * days / 365.25)
    for (let index = 0; index < count; index += 1) {
      let draft: Draft
      do { draft = makeDraft(until, days) }
      while (draft.openedAt.getTime() < from || draft.openedAt.getTime() > until)
      drafts.push(draft)
    }
  }
  drafts.push(...makeHotspotDraft(END).filter((draft) => draft.openedAt.getTime() <= END), ...makeLiveDrafts(END, 9))
  drafts.sort((a, b) => a.openedAt.getTime() - b.openedAt.getTime())
  // Inclui explicitamente o primeiro dia, sem depender do sorteio.
  drafts[0].openedAt.setDate(1)

  const occurrences: Prisma.OccurrenceCreateManyInput[] = []
  const dispatches: Prisma.DispatchCreateManyInput[] = []
  const perYear = new Map<number, number>()
  const availableAt = new Map(fleet.map((vehicle) => [vehicle.id, START]))
  const busyIds = new Set<string>()

  for (const draft of drafts) {
    const opened = draft.openedAt.getTime()
    const year = draft.openedAt.getFullYear()
    const sequence = (perYear.get(year) ?? 0) + 1
    perYear.set(year, sequence)
    const profile = NATURES.find((entry) => entry.nature === draft.nature)!
    const candidateStatus = statusFor((END - opened) / 3600000)
    const cancelled = candidateStatus === "CANCELADA"
    const preferred = responderFor(draft, responders)
    const ordered = [...fleet].sort((a, b) => {
      const freeA = Math.max(opened, availableAt.get(a.id)!)
      const freeB = Math.max(opened, availableAt.get(b.id)!)
      return freeA - freeB || Number(b.unit_id === preferred.id) - Number(a.unit_id === preferred.id)
    })
    const vehicle = ordered[0]
    const dispatchedAt = Math.max(opened + intBetween(40, 180) * 1000, availableAt.get(vehicle.id)!)
    const arrivedAt = dispatchedAt + intBetween(3, 18) * 60000
    const finishedAt = Math.max(opened + intBetween(...profile.minutes) * 60000, arrivedAt + intBetween(10, 35) * 60000)
    const status: OccurrenceStatus = cancelled ? "CANCELADA"
      : dispatchedAt > END ? "ABERTA" : arrivedAt > END ? "DESPACHADA"
      : finishedAt > END ? "EM_ATENDIMENTO" : "ENCERRADA"
    const closedAt = cancelled ? new Date(Math.min(END, opened + intBetween(2, 12) * 60000))
      : status === "ENCERRADA" ? new Date(finishedAt) : null
    const id = randomUUID()
    occurrences.push({
      id, protocol: `${year}-${String(sequence).padStart(6, "0")}`,
      nature: draft.nature, priority: draft.priority, status,
      description: `${draft.description} [Cenário sintético de demonstração]`,
      address: draft.address, latitude: new Prisma.Decimal(draft.latitude.toFixed(6)),
      longitude: new Prisma.Decimal(draft.longitude.toFixed(6)),
      caller_name: random() < 0.66 ? pick(CALLER_NAMES) : null,
      caller_phone: null,
      unit_id: cancelled || status === "ABERTA" ? preferred.id : vehicle.unit_id,
      opened_at: draft.openedAt, closed_at: closedAt,
      created_at: draft.openedAt, updated_at: closedAt ?? draft.openedAt,
    })
    if (!cancelled && status !== "ABERTA") {
      dispatches.push({
        id: randomUUID(), occurrence_id: id, vehicle_id: vehicle.id,
        status: status === "ENCERRADA" ? "FINALIZADO" : status === "DESPACHADA" ? "DESPACHADO" : "NO_LOCAL",
        dispatched_at: new Date(dispatchedAt),
        arrived_at: arrivedAt <= END ? new Date(arrivedAt) : null,
        finished_at: closedAt, created_at: new Date(dispatchedAt),
        updated_at: closedAt ?? new Date(Math.min(arrivedAt, END)),
      })
      availableAt.set(vehicle.id, finishedAt + 15 * 60000)
      if (!closedAt) busyIds.add(vehicle.id)
    }
  }

  assert(perYear.size === 26, "Todos os anos precisam estar representados.")
  for (const row of occurrences) {
    const opened = new Date(row.opened_at!).getTime()
    assert(opened >= START && opened <= END)
    if (row.closed_at) assert(new Date(row.closed_at).getTime() >= opened && new Date(row.closed_at).getTime() <= END)
  }
  const lastFinish = new Map<string, number>()
  for (const row of dispatches) {
    const dispatched = new Date(row.dispatched_at!).getTime()
    assert(dispatched >= (lastFinish.get(row.vehicle_id) ?? START), "Viatura com atendimentos sobrepostos")
    if (row.arrived_at) assert(new Date(row.arrived_at).getTime() >= dispatched)
    if (row.finished_at) {
      assert(row.arrived_at && new Date(row.finished_at).getTime() >= new Date(row.arrived_at).getTime())
      lastFinish.set(row.vehicle_id, new Date(row.finished_at).getTime())
    } else lastFinish.set(row.vehicle_id, Infinity)
  }
  console.log(JSON.stringify({ synthetic: true, seed: SEED, occurrences: occurrences.length, dispatches: dispatches.length, years: Object.fromEntries(perYear) }, null, 2))
  if (process.argv.includes("--preview")) {
    console.log("Prévia validada. Nenhum dado alterado.")
    await prisma.$disconnect()
    return
  }

  const backupDir = resolve(process.cwd(), ".backups")
  mkdirSync(backupDir, { recursive: true })
  const backupPath = resolve(backupDir, `occurrences-${new Date().toISOString().replace(/[:.]/g, "-")}.json`)
  await prisma.$transaction(async (tx) => {
    // Bloqueia escritas concorrentes durante a fotografia e a substituição.
    await tx.$executeRawUnsafe('LOCK TABLE occurrence, dispatch, route, vehicle IN SHARE ROW EXCLUSIVE MODE')
    const existing = await tx.occurrence.findMany({ include: { dispatches: { include: { routes: true } } } })
    const originalVehicles = await tx.vehicle.findMany()
    writeFileSync(backupPath, JSON.stringify({ version: 1, occurrences: existing, vehicles: originalVehicles }, jsonSafe, 2), "utf8")
    console.log(`Backup de ${existing.length} ocorrências: ${backupPath}`)
    await tx.occurrence.deleteMany({})
    for (let offset = 0; offset < occurrences.length; offset += 500) {
      await tx.occurrence.createMany({ data: occurrences.slice(offset, offset + 500) })
    }
    for (let offset = 0; offset < dispatches.length; offset += 500) {
      await tx.dispatch.createMany({ data: dispatches.slice(offset, offset + 500) })
    }
    await tx.vehicle.updateMany({ where: { status: "EMPENHADA", id: { notIn: [...busyIds] } }, data: { status: "DISPONIVEL" } })
    await tx.vehicle.updateMany({ where: { id: { in: [...busyIds] } }, data: { status: "EMPENHADA" } })
    assert.equal(await tx.occurrence.count(), occurrences.length)
    assert.equal(await tx.dispatch.count(), dispatches.length)
  }, { timeout: 180000, maxWait: 10000 })
  console.log("Histórico substituído e contagens conferidas. Cadastros e treinamentos preservados.")
  await prisma.$disconnect()
}

/** Decimal and BigInt do not survive `JSON.stringify` on their own. */
function jsonSafe(_key: string, value: unknown) {
  if (typeof value === "bigint") return value.toString()
  if (value instanceof Prisma.Decimal) return value.toString()
  return value
}

void main().catch(async (error) => {
  console.error(error)
  await prisma.$disconnect()
  process.exit(1)
})
