/**
 * Cadastro demonstrativo de hidrantes para o cenário de Taubaté.
 *
 * O OpenStreetMap não tem nenhum hidrante mapeado em Taubaté, então não há de
 * onde importar dados reais. Os pontos de data/demo-water-sources.json foram
 * gerados em cruzamentos reais de vias principais do OSM, mais densos no centro,
 * e cada registro leva nas observações que é demonstrativo.
 *
 * Idempotente: roda de novo e só atualiza os mesmos códigos.
 * npm run seed:water-sources
 */

import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { Prisma } from "../src/generated/prisma/client.js"
import type { WaterSourceStatus, WaterSourceType } from "../src/generated/prisma/client.js"
import { prisma } from "../src/config/prisma.js"
import { haversineMeters } from "../src/utils/geo.js"

interface DemoSource {
  code: string,
  type: WaterSourceType,
  status: WaterSourceStatus,
  address: string,
  latitude: number,
  longitude: number,
  flow_lpm: number | null,
  inspection_days_ago: number | null
}

// Same reference date as the demonstration history, so the seed is reproducible.
const REFERENCE = Date.parse("2026-09-24T12:00:00-03:00")
const NOTE = "Cenário demonstrativo: posição gerada em cruzamento do OpenStreetMap, não é hidrante cadastrado."

async function main() {
  const sources: DemoSource[] = JSON.parse(
    readFileSync(resolve(import.meta.dirname, "data/demo-water-sources.json"), "utf-8")
  )

  const posts = await prisma.unit.findMany({
    where: { type: "POSTO", active: true },
    select: { id: true, acronym: true, latitude: true, longitude: true }
  })

  if (posts.length === 0) {
    throw new Error("No active POSTO to own the water sources. Run the main seed first.")
  }

  let written = 0
  for (const source of sources) {
    // Each hydrant belongs to the post whose area it sits in, approximated by
    // the nearest one.
    const owner = posts.reduce((best, post) => {
      const distance = haversineMeters(source, { latitude: Number(post.latitude), longitude: Number(post.longitude) })
      return distance < best.distance ? { post, distance } : best
    }, { post: posts[0], distance: Infinity }).post

    const data = {
      type: source.type,
      status: source.status,
      address: source.address,
      latitude: new Prisma.Decimal(source.latitude),
      longitude: new Prisma.Decimal(source.longitude),
      flow_lpm: source.flow_lpm,
      notes: NOTE,
      last_inspection_at: source.inspection_days_ago === null
        ? null
        : new Date(REFERENCE - source.inspection_days_ago * 86_400_000),
      unit_id: owner.id
    }

    await prisma.waterSource.upsert({
      where: { code: source.code },
      create: { code: source.code, ...data },
      update: data
    })
    written += 1
  }

  console.log(`${written} demonstration water sources written`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
