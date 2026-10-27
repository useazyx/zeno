/** Completa o cenário sintético de 2001–2026; --preview não grava no banco. */
import assert from "node:assert/strict"
import { createHash, randomBytes } from "node:crypto"
import { mkdirSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { gzipSync } from "node:zlib"
import { prisma } from "../src/config/prisma.js"
import { AiClient } from "../src/services/ai/ai-client.js"
import { normalizeDemoRegisters } from "./normalize-demo-registers.js"

const DAY = 86400000
const REFERENCE = Date.parse("2026-09-24T18:00:00-03:00")
const BEGIN = Date.parse("2001-01-01T00:00:00-03:00")
const TABLES = ["unit", "firefighter", "user", "vehicle", "crew", "crew_member", "shift", "occurrence", "dispatch", "route", "training_run"] as const
type Table = typeof TABLES[number]
type Row = Record<string, unknown> & { id: string }
const iso = (time: number) => new Date(time).toISOString()
const id = (key: string) => {
  const hex = createHash("sha256").update(`zeno-demo-v2:${key}`).digest("hex")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}
const FIRST = ["André", "Mariana", "Rafael", "Camila", "Bruno", "Juliana", "Ricardo", "Fernanda", "Eduardo", "Patrícia", "Felipe", "Luciana", "Gustavo", "Renata", "Daniel", "Carolina"]
const LAST = ["Almeida", "Ribeiro", "Costa", "Martins", "Oliveira", "Barbosa", "Lima", "Ferreira", "Nogueira", "Teixeira", "Mendes", "Rocha", "Azevedo", "Pereira", "Siqueira", "Castro", "Cardoso", "Duarte", "Vieira", "Moraes", "Campos", "Tavares", "Batista"]
function cpf(index: number) {
  const digits = String(870000000 + index).split("").map(Number)
  for (const size of [9, 10]) {
    const remainder = digits.reduce((sum, digit, i) => sum + digit * (size + 1 - i), 0) % 11
    digits.push(remainder < 2 ? 0 : 11 - remainder)
  }
  return digits.join("")
}

type DemoVehicle = Row & { unit_id: string; prefix: string; type: string; era: number; year: number; crew_capacity: number; latitude: number; longitude: number }
type CrewDraft = Row & { name: string; vehicle_id: string; unit_id: string; started_at: string; ended_at: string; active: boolean; commander_id: string; memberIds: string[] }

async function main() {
  const preview = process.argv.includes("--preview")
  const posts = await prisma.unit.findMany({ where: { type: "POSTO", active: true }, orderBy: { acronym: "asc" } })
  assert(posts.length >= 4, "O cenário requer os quatro postos do município")
  const originals = await prisma.occurrence.findMany({ orderBy: [{ opened_at: "asc" }, { id: "asc" }] })
  const oldDispatches = await prisma.dispatch.findMany({ orderBy: [{ dispatched_at: "asc" }, { id: "asc" }] })
  assert(originals.length >= 70000, "Execute primeiro o histórico de ocorrências")
  assert(originals.every(o => o.description.includes("Cenário sintético")), "Há ocorrências fora do cenário demonstrativo")
  const byOccurrence = new Map(originals.map(o => [o.id, o]))
  const vehicles: DemoVehicle[] = []
  const firefighters: Row[] = []
  const users: Row[] = []
  const teams = new Map<string, string[]>()
  let personIndex = 0
  const specs = [
    { type: "ABT", capacity: 4, water: 5000, models: ["Mercedes-Benz 1418", "Mercedes-Benz Atego 1725", "Mercedes-Benz Atego 1726"] },
    { type: "UR", capacity: 3, water: null, models: ["Mercedes-Benz Sprinter 312D", "Mercedes-Benz Sprinter 415", "Mercedes-Benz Sprinter 416"] },
    { type: "ABTR", capacity: 4, water: 4000, models: ["Volkswagen 16.180", "Volkswagen Constellation 17.250", "Volkswagen Constellation 17.280"] },
  ]
  for (const [postIndex, post] of posts.entries()) {
    for (let era = 0; era < 3; era++) {
      const year = 1999 + era * 10
      for (const [typeIndex, spec] of specs.entries()) {
        const vehicleId = id(`vehicle:${post.acronym}:${era}:${spec.type}`)
        const prefix = `${spec.type}-${11000 + era * 100 + postIndex * 10 + typeIndex + 1}`
        vehicles.push({ id: vehicleId, prefix, type: spec.type, era, year,
          plate: `ZND${era}${postIndex}${typeIndex}0`, model: spec.models[era],
          water_capacity_liters: spec.water, crew_capacity: spec.capacity,
          status: era === 2 ? "DISPONIVEL" : "INDISPONIVEL", unit_id: post.id,
          current_latitude: era === 2 ? Number(post.latitude) : null,
          current_longitude: era === 2 ? Number(post.longitude) : null,
          latitude: Number(post.latitude), longitude: Number(post.longitude),
          created_at: `${year}-06-01T10:00:00.000Z`, updated_at: iso(REFERENCE),
        })
        for (let rotation = 0; rotation < 4; rotation++) {
          const members: string[] = []
          for (let member = 0; member < spec.capacity; member++) {
            const n = ++personIndex
            const firefighterId = id(`firefighter:${vehicleId}:${rotation}:${member}`)
            const surname = LAST[Math.floor(n / FIRST.length) % LAST.length]
            const given = FIRST[n % FIRST.length]
            const admission = `${year - 3 - member}-03-01T10:00:00.000Z`
            members.push(firefighterId)
            firefighters.push({ id: firefighterId,
              name: `${given} ${LAST[(n * 7) % LAST.length]} ${surname}`,
              war_name: `${surname.toLocaleUpperCase("pt-BR")} ${String(n).padStart(3, "0")}`,
              military_id: `DEMO-${String(n).padStart(6, "0")}`, cpf: cpf(n),
              rank: member === 0 ? "SEGUNDO_SARGENTO" : member === 1 ? "CABO" : "SOLDADO_PRIMEIRA_CLASSE",
              status: era === 2 ? "ATIVO" : "INATIVO", phone: "12000000000",
              email: `militar.${n}@demo.zeno.example`, admission_date: admission, unit_id: post.id,
              created_at: admission, updated_at: iso(REFERENCE),
            })
            if (era === 2 && member === 0) users.push({
              id: id(`user:${firefighterId}`), email: `operador.${n}@demo.zeno.example`,
              password_hash: `!disabled-demo:${randomBytes(32).toString("hex")}`,
              role: rotation === 0 ? "COMANDANTE" : "OPERADOR", active: false,
              last_login_at: null, firefighter_id: firefighterId,
              created_at: `${year + 1}-01-01T10:00:00.000Z`, updated_at: iso(REFERENCE),
            })
          }
          teams.set(`${vehicleId}:${rotation}`, members)
        }
      }
    }
  }

  const available = new Map(vehicles.map(v => [v.id, BEGIN]))
  const crews = new Map<string, CrewDraft>()
  const dispatched: Row[] = []
  const occurrenceUpdates: Row[] = []
  const busy = new Map<string, { latitude: number; longitude: number }>()
  const crewFor = (vehicle: DemoVehicle, time: number, finish: number): CrewDraft => {
    // Turnos de 24h às 07h locais, quatro equipes em rotação de 24x72.
    const day = Math.floor((time - 10 * 3600000) / DAY)
    const start = day * DAY + 10 * 3600000
    const key = `${vehicle.id}:${day}`
    const members = teams.get(`${vehicle.id}:${((day % 4) + 4) % 4}`)!
    let crew = crews.get(key)
    if (!crew) {
      crew = { id: id(`crew:${key}`), name: `${vehicle.prefix} · Equipe ${["Alfa", "Bravo", "Charlie", "Delta"][((day % 4) + 4) % 4]} · ${iso(start).slice(0, 10)}`,
        started_at: iso(start), ended_at: iso(Math.max(start + DAY, finish)),
        active: start <= REFERENCE && start + DAY > REFERENCE && vehicle.era === 2,
        unit_id: vehicle.unit_id, vehicle_id: vehicle.id, commander_id: members[0], memberIds: members,
        created_at: iso(start), updated_at: iso(Math.min(REFERENCE, Math.max(start + DAY, finish))),
      }
      crews.set(key, crew)
    } else if (finish > Date.parse(crew.ended_at)) crew.ended_at = iso(finish)
    return crew
  }

  for (const old of oldDispatches) {
    const o = byOccurrence.get(old.occurrence_id)!
    const year = o.opened_at.getUTCFullYear()
    const era = year < 2010 ? 0 : year < 2020 ? 1 : 2
    const type = o.nature === "ATENDIMENTO_PRE_HOSPITALAR" || o.nature === "AFOGAMENTO" ? "UR"
      : o.nature.startsWith("INCENDIO") ? "ABT" : "ABTR"
    const latitude = Number(o.latitude), longitude = Number(o.longitude)
    const requestTime = old.dispatched_at.getTime()
    const candidates = vehicles.filter(v => v.era === era && v.type === type)
    const travel = (v: DemoVehicle) => Math.hypot((v.latitude - latitude) * 111, (v.longitude - longitude) * 102)
    candidates.sort((a, b) => (Math.max(available.get(a.id)!, requestTime) + travel(a) * 120000)
      - (Math.max(available.get(b.id)!, requestTime) + travel(b) * 120000))
    const vehicle = candidates[0]
    const start = Math.max(requestTime, available.get(vehicle.id)!)
    const arrival = start + Math.max(180000, Math.round((travel(vehicle) * 1.35 / 35 * 3600000) + 90000))
    const sceneTime = old.finished_at && old.arrived_at ? Math.max(600000, old.finished_at.getTime() - old.arrived_at.getTime()) : 3600000
    const finish = arrival + sceneTime
    const finished = finish <= REFERENCE
    const crew = crewFor(vehicle, start, finish)
    const status = finished ? "FINALIZADO" : arrival <= REFERENCE ? "NO_LOCAL" : "DESPACHADO"
    assert(start <= REFERENCE, "A frota não consegue atender a demanda até a referência")
    available.set(vehicle.id, finish + 900000)
    if (!finished) busy.set(vehicle.id, { latitude, longitude })
    dispatched.push({ ...old, vehicle_id: vehicle.id, crew_id: crew.id, status,
      dispatched_at: iso(start), arrived_at: arrival <= REFERENCE ? iso(arrival) : null,
      finished_at: finished ? iso(finish) : null, critical_mode: false, used_route_id: null,
      created_at: iso(start), updated_at: iso(Math.min(finish, REFERENCE)),
    })
    occurrenceUpdates.push({ id: o.id, unit_id: vehicle.unit_id,
      status: finished ? "ENCERRADA" : arrival <= REFERENCE ? "EM_ATENDIMENTO" : "DESPACHADA",
      closed_at: finished ? iso(finish) : null, updated_at: iso(Math.min(finish, REFERENCE)),
    })
  }

  // A escala atual inclui também equipes disponíveis, sem ocorrência em andamento.
  for (const vehicle of vehicles.filter(v => v.era === 2)) crewFor(vehicle, REFERENCE, REFERENCE)
  const crewMembers: Row[] = [], shifts: Row[] = []
  for (const crew of crews.values()) {
    for (const [index, firefighterId] of crew.memberIds.entries()) {
      crewMembers.push({ id: id(`member:${crew.id}:${firefighterId}`), crew_id: crew.id,
        firefighter_id: firefighterId,
        role: index === 0 ? "COMANDANTE" : index === 1 ? "MOTORISTA" : crew.name.startsWith("UR-") ? "SOCORRISTA" : "COMBATENTE",
        created_at: crew.created_at,
      })
      shifts.push({ id: id(`shift:${crew.id}:${firefighterId}`), type: "PLANTAO_24X72",
        start_at: crew.started_at, end_at: crew.ended_at, firefighter_id: firefighterId,
        unit_id: crew.unit_id, created_at: crew.created_at, updated_at: crew.updated_at,
      })
    }
  }
  for (const vehicle of vehicles) if (busy.has(vehicle.id)) {
    vehicle.status = "EMPENHADA"
    vehicle.current_latitude = busy.get(vehicle.id)!.latitude
    vehicle.current_longitude = busy.get(vehicle.id)!.longitude
  }

  // Execuções simuladas são identificadas na interface e não substituem o modelo.
  const trainingRuns: Row[] = []
  for (let n = 0; n < 18; n++) {
    const epochs = [400, 600, 800, 1000, 1200, 1600][n % 6]
    const points = []
    let best = Infinity
    for (let epoch = 50; epoch <= epochs; epoch += 50) {
      const base = 0.25 * Math.exp(-epoch / (100 + (n % 4) * 35))
      const train = base + 0.035 + (n % 3) * 0.006
      const validation = train + 0.008 + (n % 5 === 0 ? Math.max(0, epoch - 500) * 0.000025 : 0)
      best = Math.min(best, validation)
      points.push({ epoch, train_loss: Number(train.toFixed(5)), validation_loss: Number(validation.toFixed(5)), best_validation_loss: Number(best.toFixed(5)) })
    }
    const start = Date.UTC(2025 + Math.floor(n / 12), n % 12, 12, 10)
    const last = points.at(-1)!
    trainingRuns.push({ id: id(`training:${n}`), status: "CONCLUIDO", epochs, current_epoch: epochs,
      history: points, train_loss: last.train_loss, validation_loss: last.validation_loss,
      best_validation_loss: last.best_validation_loss, started_at: iso(start), finished_at: iso(start + epochs * 700),
      error_message: null, model_path: `demo://simulated-training/${n}`, external_job_id: null,
      created_at: iso(start), updated_at: iso(start + epochs * 700),
    })
  }

  const summary = { synthetic: true, vehicles: vehicles.length, firefighters: firefighters.length,
    users: users.length, crews: crews.size, crewMembers: crewMembers.length, shifts: shifts.length,
    linkedDispatches: dispatched.length, simulatedTrainings: trainingRuns.length }
  console.log(JSON.stringify(summary, null, 2))
  if (preview) return

  // Rotas calculadas no grafo real; amostra recente e distribuída por mês desde 2020.
  const selected = new Map<string, Row>()
  dispatched.slice(-120).forEach(d => selected.set(d.id, d))
  const monthCounts = new Map<string, number>()
  for (const d of dispatched) {
    const month = String(d.dispatched_at).slice(0, 7)
    if (month < "2020-01" || (monthCounts.get(month) ?? 0) >= 4) continue
    selected.set(d.id, d)
    monthCounts.set(month, (monthCounts.get(month) ?? 0) + 1)
  }
  const routes: Row[] = []
  const ai = new AiClient()
  let completed = 0, unavailable = 0
  for (const d of selected.values()) {
    const vehicle = vehicles.find(v => v.id === d.vehicle_id)!
    const o = byOccurrence.get(String(d.occurrence_id))!
    try {
      const result = await ai.calculateRoute({ latitude: vehicle.latitude, longitude: vehicle.longitude },
        { latitude: Number(o.latitude), longitude: Number(o.longitude) }, { critical_mode: false })
      // Endereços muito próximos podem cair no mesmo nó: não há trajeto a desenhar.
      if (result.neural.geometry.length < 2 || result.shortest.geometry.length < 2) continue
      for (const algorithm of ["NEURAL", "DIJKSTRA"] as const) {
        const variant = algorithm === "NEURAL" ? result.neural : result.shortest
        assert(variant.distance_meters >= 0, "Distância de rota inválida")
        const routeId = id(`route:${d.id}:${algorithm}`)
        routes.push({ id: routeId, algorithm, dispatch_id: d.id,
          origin_latitude: vehicle.latitude, origin_longitude: vehicle.longitude,
          destination_latitude: Number(o.latitude), destination_longitude: Number(o.longitude),
          distance_meters: variant.distance_meters, estimated_time_seconds: variant.estimated_time_seconds,
          node_count: variant.node_count, geometry: variant.geometry,
          model_version: `demo-reconstruction:${result.model_version ?? "unknown"}`, created_at: d.dispatched_at,
        })
        if (algorithm === "NEURAL") d.used_route_id = routeId
      }
    } catch (error) {
      unavailable++
      console.log(`Rota ${o.protocol} indisponível: ${error instanceof Error ? error.message : "erro"}`)
      if (unavailable > 10) throw new Error("Serviço de rotas indisponível; banco não foi alterado")
    }
    if (++completed % 50 === 0) console.log(`Rotas calculadas: ${completed}/${selected.size}`)
  }
  assert(routes.length >= 200, "Amostra de rotas insuficiente")

  const backup = resolve(".backups", `complete-demo-${new Date().toISOString().replace(/[:.]/g, "-")}`)
  mkdirSync(backup, { recursive: true })
  console.log(`Backup completo em ${backup}`)
  await prisma.$transaction(async tx => {
    await tx.$executeRawUnsafe(`LOCK TABLE ${TABLES.map(t => `"${t}"`).join(",")} IN SHARE ROW EXCLUSIVE MODE`)
    for (const table of TABLES) {
      const rows = await tx.$queryRawUnsafe<Row[]>(`SELECT * FROM "${table}"`)
      writeFileSync(resolve(backup, `${table}.json.gz`), gzipSync(JSON.stringify(rows)))
    }
    async function insert(table: Table, rows: Row[], excluded: string[] = []) {
      if (!rows.length) return
      const clean = rows.map(row => Object.fromEntries(Object.entries(row).filter(([key]) => !excluded.includes(key))))
      const columns = Object.keys(clean[0])
      const fields = columns.map(c => `"${c}"`).join(",")
      const updates = columns.filter(c => c !== "id").map(c => `"${c}" = EXCLUDED."${c}"`).join(",")
      for (let offset = 0; offset < clean.length; offset += 1000) {
        await tx.$executeRawUnsafe(`INSERT INTO "${table}" (${fields}) SELECT ${fields} FROM json_populate_recordset(NULL::"${table}", $1::json) ON CONFLICT (id) DO UPDATE SET ${updates}`, JSON.stringify(clean.slice(offset, offset + 1000)))
      }
      console.log(`${table}: ${rows.length} registros gravados`)
    }
    const group = await tx.unit.findFirstOrThrow({ where: { type: "GRUPAMENTO" } })
    const subId = id("unit:subgroup")
    await tx.unit.upsert({ where: { id: subId }, create: {
      id: subId, name: "Subgrupamento de Taubaté — cenário demonstrativo", acronym: "SGB-TAUBATE",
      type: "SUBGRUPAMENTO", address: "Taubaté, São Paulo", latitude: -23.026, longitude: -45.555,
      phone: "12000000000", parent_id: group.id, created_at: new Date("2000-01-01T03:00:00Z"),
    }, update: {} })
    await tx.unit.updateMany({ where: { id: { in: posts.map(p => p.id) } }, data: { parent_id: subId } })
    await tx.crew.updateMany({ where: { active: true }, data: { active: false, ended_at: new Date(REFERENCE) } })
    await tx.vehicle.updateMany({ data: { status: "INDISPONIVEL", current_latitude: null, current_longitude: null } })
    await insert("vehicle", vehicles, ["era", "latitude", "longitude"])
    await insert("firefighter", firefighters)
    await insert("user", users)
    await insert("crew", [...crews.values()], ["memberIds"])
    await insert("crew_member", crewMembers)
    await insert("shift", shifts)
    // As rotas existentes não correspondem às novas unidades de saída.
    await tx.dispatch.updateMany({ data: { used_route_id: null } })
    await tx.route.deleteMany({ where: { dispatch_id: { not: null } } })
    for (let offset = 0; offset < occurrenceUpdates.length; offset += 1000) {
      await tx.$executeRawUnsafe(`UPDATE occurrence o SET unit_id = r.unit_id, status = r.status, closed_at = r.closed_at, updated_at = r.updated_at FROM json_populate_recordset(NULL::occurrence, $1::json) r WHERE o.id = r.id`, JSON.stringify(occurrenceUpdates.slice(offset, offset + 1000)))
    }
    await insert("dispatch", dispatched.map(d => ({ ...d, used_route_id: null })))
    await insert("route", routes)
    for (const d of selected.values()) if (d.used_route_id) await tx.dispatch.update({ where: { id: d.id }, data: { used_route_id: String(d.used_route_id), updated_at: new Date(String(d.updated_at)) } })
    await insert("training_run", trainingRuns)
    await normalizeDemoRegisters(tx)
    writeFileSync(resolve(backup, "manifest.json"), JSON.stringify({ reference: iso(REFERENCE), ...summary, routes: routes.length }, null, 2))
  }, { timeout: 600000, maxWait: 15000 })
  console.log(`Cenário completo gravado. ${routes.length} rotas reais reconstruídas para a demonstração.`)
}

main().catch(error => { console.error(error); process.exitCode = 1 }).finally(() => prisma.$disconnect())
