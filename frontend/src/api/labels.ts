/**
 * Human labels and colours for the domain enums.
 *
 * The enum values keep the corporation's official nomenclature, which is not
 * translatable and not readable in an interface either, so every screen goes
 * through this module instead of printing the raw value.
 *
 * Two kinds of colour live here, and they are not interchangeable. A `*_TONE`
 * is a quiet chip — a tinted ground, a hairline and coloured text — worn by a
 * status the operator reads. `PRIORITY_TONE` is a solid fill, worn only by the
 * severity block on an incident, because severity is the one thing on these
 * screens allowed to shout.
 */

import type {
  CrewRole, DispatchStatus, FirefighterStatus, OccurrenceNature, OccurrencePriority,
  OccurrenceStatus, Rank, ShiftType, TrainingStatus, UnitType,
  VehicleStatus, VehicleType, WaterSourceStatus, WaterSourceType,
} from "./types"

/** Every status chip in the system is one of these. */
export const TONE = {
  alert: "border-alert/25 bg-alert-soft text-alert",
  warn: "border-warn/25 bg-warn-soft text-warn",
  accent: "border-accent/25 bg-accent-soft text-accent",
  info: "border-info/25 bg-info-soft text-info",
  ok: "border-ok/25 bg-ok-soft text-ok",
  mute: "border-line-strong bg-mute-soft text-ink-muted",
  /* Outline only, no ground: a record that was called off never happened. */
  off: "border-line-strong bg-transparent text-ink-soft",
} as const

export const UNIT_TYPE_LABEL: Record<UnitType, string> = {
  COMANDO_GERAL: "Comando Geral",
  COMANDO_REGIONAL: "Comando Regional",
  GRUPAMENTO: "Grupamento",
  SUBGRUPAMENTO: "Subgrupamento",
  POSTO: "Posto",
}

export const RANK_LABEL: Record<Rank, string> = {
  CORONEL: "Coronel",
  TENENTE_CORONEL: "Tenente-Coronel",
  MAJOR: "Major",
  CAPITAO: "Capitão",
  PRIMEIRO_TENENTE: "1º Tenente",
  SEGUNDO_TENENTE: "2º Tenente",
  ASPIRANTE_OFICIAL: "Aspirante a Oficial",
  SUBTENENTE: "Subtenente",
  PRIMEIRO_SARGENTO: "1º Sargento",
  SEGUNDO_SARGENTO: "2º Sargento",
  TERCEIRO_SARGENTO: "3º Sargento",
  CABO: "Cabo",
  SOLDADO_PRIMEIRA_CLASSE: "Soldado 1ª Classe",
  SOLDADO_SEGUNDA_CLASSE: "Soldado 2ª Classe",
}

export const FIREFIGHTER_STATUS_LABEL: Record<FirefighterStatus, string> = {
  ATIVO: "Ativo",
  FERIAS: "Férias",
  AFASTADO: "Afastado",
  INATIVO: "Inativo",
}

export const FIREFIGHTER_STATUS_TONE: Record<FirefighterStatus, string> = {
  ATIVO: TONE.ok,
  FERIAS: TONE.accent,
  AFASTADO: TONE.warn,
  INATIVO: TONE.mute,
}

export const VEHICLE_TYPE_LABEL: Record<VehicleType, string> = {
  ABT: "Auto Bomba Tanque",
  ABTF: "Auto Bomba Tanque Florestal",
  ABTR: "Auto Bomba Tanque Resgate",
  AT: "Auto Tanque",
  ASE: "Auto Salvamento Específico",
  AEM: "Auto Escada Mecânica",
  APM: "Auto Plataforma Mecânica",
  UR: "Unidade de Resgate",
  MOB: "Moto Operacional Bombeiro",
  ABRESC: "Auto Busca, Resgate e Salvamento com Cães",
  AV: "Auto Viatura administrativa",
}

export const VEHICLE_STATUS_LABEL: Record<VehicleStatus, string> = {
  DISPONIVEL: "Disponível",
  EMPENHADA: "Empenhada",
  MANUTENCAO: "Manutenção",
  INDISPONIVEL: "Indisponível",
}

export const VEHICLE_STATUS_TONE: Record<VehicleStatus, string> = {
  DISPONIVEL: TONE.ok,
  EMPENHADA: TONE.alert,
  MANUTENCAO: TONE.warn,
  INDISPONIVEL: TONE.mute,
}

export const CREW_ROLE_LABEL: Record<CrewRole, string> = {
  COMANDANTE: "Comandante",
  MOTORISTA: "Motorista",
  COMBATENTE: "Combatente",
  SOCORRISTA: "Socorrista",
}

export const SHIFT_TYPE_LABEL: Record<ShiftType, string> = {
  PLANTAO_24X72: "Plantão 24x72",
  PLANTAO_12X36: "Plantão 12x36",
  EXPEDIENTE: "Expediente",
}

export const NATURE_LABEL: Record<OccurrenceNature, string> = {
  INCENDIO_EDIFICACAO: "Incêndio em edificação",
  INCENDIO_VEGETACAO: "Incêndio em vegetação",
  INCENDIO_VEICULO: "Incêndio em veículo",
  SALVAMENTO: "Salvamento",
  ATENDIMENTO_PRE_HOSPITALAR: "Atendimento pré-hospitalar",
  PRODUTOS_PERIGOSOS: "Produtos perigosos",
  AFOGAMENTO: "Afogamento",
  CAPTURA_ANIMAL: "Captura de animal",
  VISTORIA: "Vistoria",
  OUTROS: "Outros",
}

export const PRIORITY_LABEL: Record<OccurrencePriority, string> = {
  BAIXA: "Baixa",
  MEDIA: "Média",
  ALTA: "Alta",
  CRITICA: "Crítica",
}

/**
 * The solid severity block, and the only saturated fill in the interface.
 *
 * It is a ramp, not a set of categories: the same hue family darkens as the
 * call gets worse, so the four steps can be ordered at a glance and a reader
 * who cannot separate the reds still sees the block get heavier.
 */
export const PRIORITY_TONE: Record<OccurrencePriority, string> = {
  BAIXA: "bg-ok",
  MEDIA: "bg-warn",
  ALTA: "bg-alert",
  CRITICA: "bg-alert-strong",
}

export const PRIORITY_TEXT_TONE: Record<OccurrencePriority, string> = {
  BAIXA: "text-ok",
  MEDIA: "text-warn",
  ALTA: "text-alert",
  CRITICA: "text-alert-strong",
}

export const OCCURRENCE_STATUS_LABEL: Record<OccurrenceStatus, string> = {
  ABERTA: "Aberta",
  DESPACHADA: "Despachada",
  EM_ATENDIMENTO: "Em atendimento",
  ENCERRADA: "Encerrada",
  CANCELADA: "Cancelada",
}

export const OCCURRENCE_STATUS_TONE: Record<OccurrenceStatus, string> = {
  ABERTA: TONE.alert,
  DESPACHADA: TONE.warn,
  EM_ATENDIMENTO: TONE.accent,
  ENCERRADA: TONE.ok,
  CANCELADA: TONE.off,
}

/**
 * Allowed status transitions, mirroring `UpdateOccurrenceService`. An incident
 * only moves forward, and the interface offers exactly what the backend takes.
 */
export const OCCURRENCE_NEXT_STATUSES: Record<OccurrenceStatus, OccurrenceStatus[]> = {
  ABERTA: ["CANCELADA"],
  DESPACHADA: ["ENCERRADA", "CANCELADA"],
  EM_ATENDIMENTO: ["ENCERRADA"],
  ENCERRADA: [],
  CANCELADA: [],
}

export const DISPATCH_STATUS_LABEL: Record<DispatchStatus, string> = {
  DESPACHADO: "Despachado",
  A_CAMINHO: "A caminho",
  NO_LOCAL: "No local",
  RETORNANDO: "Retornando",
  FINALIZADO: "Finalizado",
  CANCELADO: "Cancelado",
}

export const DISPATCH_STATUS_TONE: Record<DispatchStatus, string> = {
  DESPACHADO: TONE.warn,
  A_CAMINHO: TONE.accent,
  NO_LOCAL: TONE.info,
  RETORNANDO: TONE.mute,
  FINALIZADO: TONE.ok,
  CANCELADO: TONE.off,
}

/**
 * The backend refuses a jump that skips a step, so the interface only offers
 * the transitions it will accept. Terminal states offer nothing.
 */
export const DISPATCH_NEXT_STATUSES: Record<DispatchStatus, DispatchStatus[]> = {
  DESPACHADO: ["A_CAMINHO", "CANCELADO"],
  A_CAMINHO: ["NO_LOCAL", "CANCELADO"],
  NO_LOCAL: ["RETORNANDO", "FINALIZADO"],
  RETORNANDO: ["FINALIZADO"],
  FINALIZADO: [],
  CANCELADO: [],
}

export const TRAINING_STATUS_LABEL: Record<TrainingStatus, string> = {
  PENDENTE: "Pendente",
  EXECUTANDO: "Executando",
  CONCLUIDO: "Concluído",
  FALHOU: "Falhou",
}

export const TRAINING_STATUS_TONE: Record<TrainingStatus, string> = {
  PENDENTE: TONE.mute,
  EXECUTANDO: TONE.accent,
  CONCLUIDO: TONE.ok,
  FALHOU: TONE.alert,
}

/** Turns a `Record<K, string>` into the option list a <select> expects. */
export function optionsOf<K extends string>(labels: Record<K, string>): { value: K, label: string }[] {
  return (Object.keys(labels) as K[]).map((value) => ({ value, label: labels[value] }))
}

export const WATER_TYPE_LABEL: Record<WaterSourceType, string> = {
  HIDRANTE_COLUNA: "Hidrante de coluna",
  HIDRANTE_SUBTERRANEO: "Hidrante subterrâneo",
  CISTERNA: "Cisterna",
  RESERVATORIO: "Reservatório",
  PONTO_CAPTACAO: "Ponto de captação",
}

export const WATER_STATUS_LABEL: Record<WaterSourceStatus, string> = {
  OPERANTE: "Operante",
  INOPERANTE: "Inoperante",
  NAO_VERIFICADO: "Não verificado",
}

export const WATER_STATUS_TONE: Record<WaterSourceStatus, string> = {
  OPERANTE: TONE.ok,
  INOPERANTE: TONE.alert,
  NAO_VERIFICADO: TONE.warn,
}
