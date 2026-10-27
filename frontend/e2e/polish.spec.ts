import { expect, test } from "@playwright/test"
import { readFile } from "node:fs/promises"
import ExcelJS from "exceljs"

test("theme persists and dialogs trap and restore keyboard focus", async ({ page }) => {
  await page.goto("/viaturas")
  await page.getByRole("button", { name: "Ativar modo claro" }).click()
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light")
  await page.reload()
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light")
  const trigger = page.getByRole("button", { name: "Nova viatura" })
  await trigger.click()
  const dialog = page.getByRole("dialog", { name: "Cadastrar viatura" })
  await expect(dialog).toBeVisible()
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press("Tab")
    expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true)
  }
  await page.keyboard.press("Control+k")
  await expect(page.getByRole("dialog")).toHaveCount(1)
  await page.keyboard.press("Escape")
  await expect(trigger).toBeFocused()
  const search = page.getByRole("button", { name: "Buscar tela ou ocorrência (Ctrl+K)" })
  await search.click()
  await expect(page.getByRole("combobox", { name: "Buscar comando ou ocorrência" })).toBeFocused()
  await page.keyboard.press("Tab")
  await expect(page.getByRole("combobox", { name: "Buscar comando ou ocorrência" })).toBeFocused()
  await page.keyboard.press("Escape")
  await expect(search).toBeFocused()
})

for (const path of ["/ocorrencias", "/viaturas", "/turnos", "/hidrantes", "/estatisticas"]) {
  test(`PDF and Excel download with real data on ${path}`, async ({ page }, info) => {
    await page.goto(path)
    const open = page.getByRole("button", { name: "Exportar", exact: true })
    await expect(open).toBeEnabled({ timeout: 45_000 })
    for (const format of ["PDF", "Excel"] as const) {
      await open.click()
      const dialog = page.getByRole("dialog")
      await expect(dialog).toBeVisible()
      const download = page.waitForEvent("download")
      await dialog.getByRole("button", { name: `Gerar ${format}` }).click()
      const file = await download
      const output = info.outputPath(file.suggestedFilename())
      await file.saveAs(output)
      const bytes = await readFile(output)
      if (format === "PDF") expect(bytes.subarray(0, 5).toString()).toBe("%PDF-")
      else {
        const workbook = new ExcelJS.Workbook()
        await workbook.xlsx.load(bytes)
        expect(workbook.worksheets[0].rowCount).toBeGreaterThan(6)
        expect(workbook.worksheets[0].getCell("A2").text).not.toBe("")
      }
      await expect(page.getByRole("status").filter({ hasText: "Download iniciado" })).toBeVisible()
    }
  })
}

test("all screens fit their viewport in light mode", async ({ page, request }, info) => {
  test.setTimeout(180_000)
  await page.addInitScript(() => localStorage.setItem("zeno.theme", "light"))
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(String(error)))
  page.on("response", (response) => {
    if (response.url().startsWith("http://127.0.0.1:3333/") && response.status() >= 400) errors.push(`${response.status()} ${response.url()}`)
  })
  const response = await request.get("http://127.0.0.1:3333/api/v1/occurrences?per_page=1")
  const data = await response.json()
  const paths = ["/", "/ocorrencias", `/ocorrencias/${data.occurrences[0].id}`, "/despachos", "/rotas", "/cobertura", "/estatisticas", "/rede-neural", "/efetivo", "/viaturas", "/guarnicoes", "/turnos", "/unidades", "/hidrantes", "/terminal", "/telao"]
  for (let i = 0; i < paths.length; i++) {
    await page.goto(paths[i])
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible()
    await expect(page.getByRole("status").filter({ hasText: /Carregando|Consultando|Calculando/ })).toHaveCount(0, { timeout: 45_000 })
    await page.waitForTimeout(1200)
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), paths[i]).toBeLessThanOrEqual(1)
    await page.screenshot({ path: info.outputPath(`light-${i}.png`), fullPage: true })
  }
  expect(errors).toEqual([])
})
