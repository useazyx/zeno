/**
 * How a route is said to the people who use it.
 *
 * The AI returns manoeuvres as structure (`turn` + `left` + street), never as
 * prose, so the wording lives here, in the interface's language. Kept free of
 * React and of the `@` alias so the node test runner can import it directly.
 */

export interface StepLike {
  type: "depart" | "turn" | "continue" | "roundabout" | "arrive"
  modifier: string | null
  street: string | null
  bearing?: number
}

export interface SegmentLike {
  speed_kmh: number
  limit_kmh: number
}

const SIDE: Record<string, string> = { left: "à esquerda", right: "à direita" }

const CARDINAL = ["norte", "nordeste", "leste", "sudeste", "sul", "sudoeste", "oeste", "noroeste"]

/** "nordeste" for 45°: the eight-point compass, as a driver would say it. */
export function cardinal(bearing: number): string {
  const normalized = ((bearing % 360) + 360) % 360
  return CARDINAL[Math.round(normalized / 45) % 8]
}

function onto(street: string | null, preposition: "na" | "pela"): string {
  return street ? ` ${preposition} ${street}` : ""
}

/** The instruction for one step, e.g. "Vire à direita na Rua Jacques Félix". */
export function phraseStep(step: StepLike): string {
  const street = step.street

  switch (step.type) {
    case "depart":
      if (street) return `Saia pela ${street}`
      return step.bearing === undefined ? "Inicie o deslocamento" : `Saia em direção ${cardinalPreposition(step.bearing)}`

    case "arrive":
      return street ? `Chegada ao destino, na ${street}` : "Chegada ao destino"

    case "roundabout":
      return street ? `Na rotatória, saia pela ${street}` : "Na rotatória, siga em frente"

    case "continue":
      return street ? `Continue pela ${street}` : "Continue em frente"

    case "turn": {
      const modifier = step.modifier ?? "straight"
      if (modifier === "straight") return street ? `Siga em frente pela ${street}` : "Siga em frente"
      if (modifier === "uturn") return `Faça o retorno${onto(street, "na")}`

      const [kind, side] = modifier.includes("_") ? modifier.split("_") : ["", modifier]
      const direction = SIDE[side] ?? ""
      if (kind === "slight") return `Mantenha-se ${direction}${onto(street, "na")}`
      if (kind === "sharp") return `Vire acentuadamente ${direction}${onto(street, "na")}`
      return `Vire ${direction}${onto(street, "na")}`
    }
  }
}

function cardinalPreposition(bearing: number): string {
  const name = cardinal(bearing)
  // "ao norte", "à oeste" is wrong: every point of the compass is masculine.
  return `ao ${name}`
}

/** Which arrow to draw beside the instruction. */
export function stepGlyph(step: StepLike): "depart" | "arrive" | "roundabout" | "straight" | "left" | "right" | "slight-left" | "slight-right" | "uturn" {
  if (step.type === "depart" || step.type === "arrive" || step.type === "roundabout") return step.type
  const modifier = step.modifier ?? "straight"
  if (modifier === "uturn") return "uturn"
  if (modifier.endsWith("left")) return modifier.startsWith("slight") ? "slight-left" : "left"
  if (modifier.endsWith("right")) return modifier.startsWith("slight") ? "slight-right" : "right"
  return "straight"
}

export type SpeedBand = "fluid" | "moderate" | "slow"

/**
 * How freely the model expects traffic to flow on an edge, from its predicted
 * speed against the posted limit. These are the colours of the explanation
 * layer: where the route turns red is where the network expects to lose time.
 */
export function speedBand(segment: SegmentLike): SpeedBand {
  if (segment.limit_kmh <= 0) return "moderate"
  const ratio = segment.speed_kmh / segment.limit_kmh
  if (ratio >= 0.8) return "fluid"
  if (ratio >= 0.55) return "moderate"
  return "slow"
}

export const SPEED_BAND_LABEL: Record<SpeedBand, string> = {
  fluid: "Fluxo próximo ao limite",
  moderate: "Fluxo moderado",
  slow: "Trecho lento",
}

/** The semantic tokens of the console: ok, warn, alert. */
export const SPEED_BAND_COLOR: Record<SpeedBand, string> = {
  fluid: "#7DC4A1",
  moderate: "#E6BD70",
  slow: "#EF8C87",
}

export const ROAD_CLASS_LABEL = {
  highway: "Rodovias e vias expressas",
  primary: "Vias primárias",
  secondary: "Vias secundárias",
  tertiary: "Vias terciárias",
  local: "Vias locais",
} as const

export type RoadClassKey = keyof typeof ROAD_CLASS_LABEL

/**
 * One sentence on why the neural route differs from the shortest one, from the
 * share of each route driven on main roads. Honest when there is no story to
 * tell: the same streets get "same streets".
 */
export function explainChoice(
  neural: Record<RoadClassKey, number>,
  shortest: Record<RoadClassKey, number>,
  sharedRatio: number | undefined,
): string {
  if (sharedRatio !== undefined && sharedRatio >= 0.97) {
    return "A IA escolheu praticamente as mesmas ruas da rota mais curta."
  }

  const mainShare = (composition: Record<RoadClassKey, number>) => {
    const total = Object.values(composition).reduce((sum, value) => sum + value, 0)
    if (total <= 0) return 0
    return (composition.highway + composition.primary + composition.secondary) / total
  }

  const neuralMain = Math.round(mainShare(neural) * 100)
  const shortestMain = Math.round(mainShare(shortest) * 100)

  if (neuralMain - shortestMain >= 10) {
    return `A IA troca metros por velocidade: ${neuralMain}% do percurso em vias principais, contra ${shortestMain}% da rota mais curta.`
  }
  if (shortestMain - neuralMain >= 10) {
    return `A IA evitou vias principais neste trajeto (${neuralMain}% contra ${shortestMain}% da rota mais curta), prevendo menos tempo por ruas menores.`
  }
  return `As duas rotas usam vias principais em proporção parecida (${neuralMain}% e ${shortestMain}%); a diferença está na escolha das ruas.`
}
