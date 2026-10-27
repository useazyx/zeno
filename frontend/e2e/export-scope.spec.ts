import { expect, test } from "@playwright/test"
import ExcelJS from "exceljs"
import { readFile } from "node:fs/promises"

test("all filtered fleet rows export and oversized incident sets stay disabled", async ({ page, request }) => {
  await page.goto("/viaturas")
  await page.getByRole("combobox").first().selectOption("DISPONIVEL")
  const open = page.getByRole("button", { name: "Exportar", exact: true })
  await expect(open).toBeEnabled()
  const response = await request.get("http://127.0.0.1:3333/api/v1/vehicles?per_page=100&status=DISPONIVEL")
  const expected = await response.json()
  await open.click()
  await page.getByRole("radio", { name: /Todos os resultados filtrados/ }).check()
  const waiting = page.waitForEvent("download")
  await page.getByRole("button", { name: "Gerar Excel" }).click()
  const download = await waiting
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(await readFile((await download.path())!))
  const sheet = workbook.worksheets[0]
  expect(sheet.rowCount - 6).toBe(expected.total)
  expect(sheet.getCell("A2").text).toContain("Disponível")
  for (let row = 7; row <= sheet.rowCount; row++) expect(sheet.getCell(row, 8).text).toBe("Disponível")
  await page.goto("/ocorrencias")
  await expect(open).toBeEnabled()
  await open.click()
  await expect(page.getByRole("radio", { name: /Página atual/ })).toBeChecked()
  await expect(page.getByRole("radio", { name: /Todos os resultados filtrados/ })).toBeDisabled()
})

test("cancelling an export prevents the pending request from downloading a file", async ({ page }) => {
  await page.goto("/viaturas")
  const open = page.getByRole("button", { name: "Exportar", exact: true })
  await expect(open).toBeEnabled()
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  await page.route("**/vehicles?*", async (route) => {
    if (new URL(route.request().url()).searchParams.get("per_page") === "100") await gate
    await route.continue()
  })
  const downloads: string[] = []
  page.on("download", (file) => downloads.push(file.suggestedFilename()))
  await open.click()
  await page.getByRole("radio", { name: /Todos os resultados filtrados/ }).check()
  const fetching = page.waitForRequest((r) => r.url().includes("vehicles?") && r.url().includes("per_page=100"))
  await page.getByRole("button", { name: "Gerar PDF" }).click()
  await fetching
  await page.getByRole("button", { name: "Cancelar exportação" }).click()
  release()
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await page.waitForTimeout(700)
  expect(downloads).toEqual([])
  await expect(open).toBeFocused()
})
