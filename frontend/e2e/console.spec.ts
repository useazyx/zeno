import { expect, test } from "@playwright/test"
import type { Page } from "@playwright/test"

const API = process.env.E2E_API_URL ?? "http://127.0.0.1:3333/api/v1"

/** Errors the page logs while a test runs; a clean console is part of passing. */
function watchErrors(page: Page) {
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(String(error)))
  page.on("console", (message) => {
    // Tile servers occasionally drop a request; that is the network, not us.
    if (message.type() === "error" && !/tiles\.openfreemap|Failed to load resource/.test(message.text())) {
      errors.push(message.text())
    }
  })
  return errors
}

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow, "the page must not scroll sideways").toBeLessThanOrEqual(1)
}

const SCREENS: [string, string][] = [
  ["/", "Painel operacional"],
  ["/ocorrencias", "Ocorrências"],
  ["/despachos", "Despachos"],
  ["/rotas", "Rotas"],
  ["/cobertura", "Cobertura"],
  ["/estatisticas", "Estatísticas"],
  ["/rede-neural", "IA"],
  ["/efetivo", "Efetivo"],
  ["/viaturas", "Viaturas"],
  ["/guarnicoes", "Guarnições"],
  ["/turnos", "Turnos"],
  ["/unidades", "Unidades"],
  ["/hidrantes", "Pontos de água"],
]

for (const [path, heading] of SCREENS) {
  test(`${path} opens cleanly`, async ({ page }) => {
    const errors = watchErrors(page)
    await page.goto(path)
    await expect(page.getByRole("heading", { level: 1 }).first()).toContainText(heading)
    await page.waitForLoadState("networkidle")
    await noHorizontalScroll(page)
    expect(errors).toEqual([])
  })
}

test("the wallboard and the vehicle terminal open without the console chrome", async ({ page }) => {
  const errors = watchErrors(page)
  await page.goto("/telao")
  await expect(page.getByText("Ocorrências em aberto")).toBeVisible()
  await page.goto("/terminal")
  await expect(page.getByRole("heading", { name: "Qual viatura é esta?" })).toBeVisible()
  await expect(page.locator("main button").first()).toBeVisible()
  await noHorizontalScroll(page)
  expect(errors).toEqual([])
})

test("Ctrl+K reaches any screen from the keyboard", async ({ page }) => {
  await page.goto("/")
  await page.keyboard.press("Control+k")
  await page.keyboard.type("cobertura")
  await page.keyboard.press("Enter")
  await expect(page).toHaveURL(/\/cobertura$/)
})

test("Alt+N opens a new occurrence and the address search fills the point", async ({ page }) => {
  await page.goto("/")
  await page.keyboard.press("Alt+n")
  await expect(page.getByRole("dialog", { name: "Registrar ocorrência" })).toBeVisible()

  const dialog = page.getByRole("dialog")
  const address = dialog.getByPlaceholder("Rua Jacques Félix, 451, Centro, Taubaté")
  const latitude = dialog.getByRole("textbox").nth(1)
  const before = await latitude.inputValue()

  await address.fill("Avenida Independência")
  const option = page.getByRole("listbox").getByRole("option").first()
  await expect(option).toBeVisible()
  await option.click()

  await expect(address).toHaveValue(/Avenida Independência/)
  await expect.poll(() => latitude.inputValue()).not.toBe(before)
})

test("the route lab avoids a closed street and lists the manoeuvres", async ({ page }, info) => {
  test.skip(info.project.name === "phone", "map clicking is covered on desktop")
  await page.goto("/rotas")

  const unit = page.locator("select").nth(1)
  await expect(unit.locator("option", { hasText: "PB-TAUBATE" })).toBeAttached()
  await unit.selectOption((await unit.locator("option", { hasText: "PB-TAUBATE" }).getAttribute("value"))!)

  await page.getByRole("button", { name: "Interditar via" }).click()
  const canvas = page.locator(".maplibregl-canvas").first()
  await canvas.scrollIntoViewIfNeeded()
  await expect(canvas).toBeVisible()
  await page.waitForTimeout(1500)
  const box = (await canvas.boundingBox())!
  // Off-centre, away from the station pin the map opens on.
  await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.3)
  await expect(page.getByRole("button", { name: "Remover interdição" })).toHaveCount(1)

  await page.getByRole("button", { name: "Calcular rota" }).click()
  await expect(page.getByText(/interdição\(ões\) respeitada/)).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(/Saia (pela|em direção)/)).toBeVisible()
  await expect(page.getByText("Chegada ao destino", { exact: false })).toBeVisible()
  await page.getByRole("button", { name: "Explicar" }).click()
  await expect(page.getByRole("button", { name: "Explicar" })).toHaveAttribute("aria-pressed", "true")
})

test("an occurrence shows its timeline, scene support and takes a note", async ({ page, request }) => {
  const listing = await request.get(`${API}/occurrences?per_page=1&status=DESPACHADA`)
  const { occurrences } = await listing.json()
  test.skip(occurrences.length === 0, "no dispatched occurrence in the demo data")

  await page.goto(`/ocorrencias/${occurrences[0].id}`)
  await expect(page.getByRole("heading", { name: "Linha do tempo" })).toBeVisible()
  await expect(page.getByRole("heading", { name: "Apoio à cena" })).toBeVisible()
  await expect(page.getByText("Clima no local")).toBeVisible()
  await expect(page.getByRole("link", { name: /Street View/ })).toHaveAttribute("href", /map_action=pano/)

  const note = `Teste automatizado ${Date.now()}`
  await page.getByLabel("Nova anotação").fill(note)
  await page.getByRole("button", { name: "Registrar" }).click()
  await expect(page.getByText(note)).toBeVisible()
})
