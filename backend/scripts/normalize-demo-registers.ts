import type { Prisma } from "../src/generated/prisma/client.js"

/** Normaliza os cadastros repetidos do cenário original, sem mudar credenciais. */
export async function normalizeDemoRegisters(tx: Prisma.TransactionClient) {
  const names = [
    ["Carlos Eduardo Ramos", "RAMOS"], ["Ana Paula Moreira", "MOREIRA"],
    ["Marcos Antônio Farias", "FARIAS"], ["Beatriz Helena Souza", "SOUZA"],
    ["Paulo Henrique Queiroz", "QUEIROZ"], ["Gabriela Cristina Lopes", "LOPES"],
    ["Roberto Luís Freitas", "FREITAS"], ["Sílvia Regina Pinheiro", "PINHEIRO"],
    ["Alexandre José Cunha", "CUNHA"], ["Débora Maria Xavier", "XAVIER"],
    ["Leandro César Borges", "BORGES"], ["Priscila Alves Monteiro", "MONTEIRO"],
    ["Sérgio Augusto Pacheco", "PACHECO"], ["Tatiana Aparecida Sales", "SALES"],
  ]
  const original = await tx.firefighter.findMany({
    where: { NOT: { military_id: { startsWith: "DEMO-" } } }, orderBy: { id: "asc" },
  })
  for (const [index, person] of original.entries()) {
    if (index >= names.length) break
    await tx.firefighter.update({ where: { id: person.id }, data: {
      name: names[index][0], war_name: names[index][1],
      status: index === 12 ? "FERIAS" : index === 13 ? "AFASTADO" : "ATIVO",
    } })
  }
  const reserve = await tx.vehicle.findMany({ where: { NOT: { plate: { startsWith: "ZND" } } }, orderBy: { id: "asc" } })
  for (const [index, vehicle] of reserve.entries()) {
    await tx.vehicle.update({ where: { id: vehicle.id }, data: {
      prefix: `${vehicle.type}-${11901 + index}`,
      status: index === 0 ? "MANUTENCAO" : "INDISPONIVEL",
    } })
  }
  await tx.unit.updateMany({ where: { type: { in: ["COMANDO_GERAL", "COMANDO_REGIONAL", "GRUPAMENTO"] } },
    data: { created_at: new Date("1990-01-01T03:00:00Z") } })
  await tx.unit.updateMany({ where: { type: { in: ["POSTO", "SUBGRUPAMENTO"] } },
    data: { created_at: new Date("2000-01-01T03:00:00Z") } })
}
