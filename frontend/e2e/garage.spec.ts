import { expect, test } from "@playwright/test"
import { readFile } from "node:fs/promises"

test("garage supports inspection, comparison and a full resolution PNG", async ({ page }, info) => {
  const errors: string[] = []
  page.on("pageerror", error => errors.push(error.message))
  page.on("response", response => {
    if (response.url().includes(":3333/api/") && response.status() >= 400) errors.push(`${response.status()} ${response.url()}`)
  })
  await page.goto("/garagem")
  await expect(page.getByRole("heading", { name: "Garagem 3D" })).toBeVisible()
  await expect(page.locator(".garage-canvas canvas")).toBeVisible()
  await expect(page.locator(".garage-type")).toHaveCount(11)
  await page.getByRole("button", { name: "Frente", exact: true }).click()
  await expect(page.getByRole("button", { name: "Frente", exact: true })).toHaveAttribute("aria-pressed", "true")
  await page.getByLabel("Portas da cabine", { exact: true }).check()
  await page.getByLabel("Medidas", { exact: true }).check()
  await expect(page.locator(".garage-measures")).toBeVisible()
  await page.getByLabel("Segundo modelo").selectOption("MOB")
  await expect(page.locator(".garage-compare")).toContainText("MOB")
  const downloadPromise = page.waitForEvent("download")
  await page.getByRole("button", { name: "Baixar PNG" }).click()
  const download = await downloadPromise
  const path = info.outputPath("garage.png")
  await download.saveAs(path)
  const png = await readFile(path)
  expect(png.subarray(1, 4).toString()).toBe("PNG")
  expect(png.readUInt32BE(16)).toBe(2400)
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1)
  await page.screenshot({ path: info.outputPath("garage-screen.png"), fullPage: true })
  expect(errors).toEqual([])
})
