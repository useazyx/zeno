/**
 * Portuguese wording for the messages the AI service writes in English.
 *
 * The Python side answers in English and the backend forwards its `detail`
 * untouched, which is the right thing for an API and the wrong thing for a
 * dispatcher. Rather than translating on the server — where the message is
 * also a log line — the interface rewrites the handful of failures a user can
 * actually run into, and says what to do about them.
 *
 * Anything unrecognised is shown as it came, because a message nobody can read
 * still beats a message nobody can see.
 */

interface Rule {
  match: RegExp
  rewrite: (groups: RegExpMatchArray) => string
}

const METRES = (value: string) => {
  const metres = Number(value)
  return metres >= 1000
    ? `${(metres / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} km`
    : `${metres} m`
}

const RULES: Rule[] = [
  {
    match: /The (origin|destination) is (\d+) m away from the nearest mapped street, outside the area covered by (.+)/,
    rewrite: ([, side, distance, city]) => {
      const what = side === "origin" ? "A origem" : "O destino"
      return `${what} está a ${METRES(distance)} da rua mapeada mais próxima, fora da malha viária de ${city}. `
        + "A IA opera apenas sobre as ruas dessa malha — confira as coordenadas ou escolha um ponto dentro da área destacada no mapa."
    },
  },
  {
    match: /No route exists between these two points/,
    rewrite: () => "Não existe caminho pela malha viária entre esses dois pontos.",
  },
  {
    match: /The route engine is not loaded/,
    rewrite: () => "O motor de rotas não está carregado. Treine o modelo e reinicie o serviço de IA.",
  },
  {
    match: /The route engine is still loading/,
    rewrite: () => "O motor de rotas ainda está carregando o mapa. Tente novamente em alguns segundos.",
  },
  {
    match: /The AI service did not answer within (\d+)ms/,
    rewrite: ([, ms]) => `O serviço de IA não respondeu em ${Math.round(Number(ms) / 1000)} s.`,
  },
  {
    match: /The AI service is unreachable/,
    rewrite: () => "O serviço de IA está fora do ar.",
  },
  {
    match: /A training run is already in progress/,
    rewrite: () => "Já existe um treinamento em andamento.",
  },
  {
    match: /The AI service no longer knows this job/,
    rewrite: () => "O serviço de IA foi reiniciado durante o treinamento e perdeu a execução, que foi marcada como falha.",
  },
  {
    match: /Training run not found/,
    rewrite: () => "Treinamento não encontrado.",
  },
  // Not a failure: the dispatch itself went through and the backend answers
  // 201, so this wording arrives on the happy path and still has to be read.
  {
    match: /Dispatch created, but the route could not be calculated/,
    rewrite: () => "Viatura despachada, mas a rota não pôde ser calculada. "
      + "O serviço de IA não respondeu — o empenho vale, só o trajeto sugerido ficou de fora.",
  },
]

export function translateMessage(message: string): string {
  for (const rule of RULES) {
    const groups = message.match(rule.match)
    if (groups) return rule.rewrite(groups)
  }

  return message
}
