import { expect, test } from "@playwright/test"

test("coverage map fills its frame and exposes navigation controls", async ({ page }, info) => {
  await page.goto("/cobertura")
  const map = page.locator(".coverage-map > .maplibregl-map")
  await expect(map).toBeVisible()
  expect(await map.evaluate((el) => el.clientHeight)).toBeGreaterThanOrEqual(360)
  await expect(map.getByRole("button", { name: "Zoom in" })).toBeVisible()
  await expect(map.locator(".maplibregl-marker").first()).toBeVisible({ timeout: 45_000 })
  await page.screenshot({ path: info.outputPath("coverage-fixed.png"), fullPage: true })
})

test("dark tablet screens fit and mobile navigation is keyboard accessible", async ({ page }, info) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 768, height: 1024 })
  const errors: string[] = []
  page.on("pageerror", (e) => errors.push(String(e)))
  for (const path of ["/", "/ocorrencias", "/estatisticas", "/cobertura", "/terminal", "/telao"]) {
    await page.goto(path)
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible()
    await expect(page.getByRole("status").filter({ hasText: /Carregando|Consultando|Calculando/ })).toHaveCount(0, { timeout: 45_000 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), path).toBeLessThanOrEqual(1)
    await page.screenshot({ path: info.outputPath(`tablet-${path.replaceAll("/", "") || "painel"}.png`), fullPage: true })
  }
  await page.goto("/viaturas")
  const menu = page.getByRole("button", { name: "Abrir menu" })
  await menu.click()
  await expect(page.getByRole("dialog", { name: "Navegação do ZENO" })).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(menu).toBeFocused()
  await expect(page.getByRole("dialog")).toHaveCount(0)
  expect(errors).toEqual([])
})
