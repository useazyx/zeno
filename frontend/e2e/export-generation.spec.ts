import { expect, test } from "@playwright/test"

for (const format of ["PDF", "Excel"]) {
  test(`large ${format} generation keeps the interface responsive and cancellable`, async ({ page, request }) => {
    const response = await request.get("http://127.0.0.1:3333/api/v1/vehicles?per_page=1")
    const sample = (await response.json()).vehicles[0]
    // Browser-only fixture: stress the maximum export without writing records.
    await page.route("**/api/v1/vehicles?*", async (route) => {
      const params = new URL(route.request().url()).searchParams
      const perPage = Number(params.get("per_page") ?? 15)
      const current = Number(params.get("page") ?? 1)
      const start = (current - 1) * perPage
      await route.fulfill({ json: { total: 5000, page: current, per_page: perPage,
        vehicles: Array.from({ length: Math.min(perPage, 5000 - start) }, (_, i) => ({ ...sample, id: `export-${start + i}`, prefix: `EXPORT-${start + i}` })),
      } })
    })
    await page.goto("/viaturas")
    const trigger = page.getByRole("button", { name: "Exportar", exact: true })
    await expect(trigger).toBeEnabled()
    await trigger.click()
    await page.getByRole("radio", { name: /Todos os resultados filtrados/ }).check()
    const downloads: string[] = []
    page.on("download", (file) => downloads.push(file.suggestedFilename()))
    await page.evaluate(() => {
      const probe = { last: performance.now(), longest: 0, ticks: 0, timer: 0 }
      probe.timer = window.setInterval(() => {
        const now = performance.now()
        probe.longest = Math.max(probe.longest, now - probe.last)
        probe.last = now
        probe.ticks++
      }, 20)
      Object.assign(window, { exportResponsiveness: probe })
    })
    await page.getByRole("button", { name: `Gerar ${format}` }).click()
    await expect(page.getByRole("status").filter({ hasText: /Gerando/ })).toBeVisible()
    await page.waitForTimeout(400)
    await page.getByRole("button", { name: "Cancelar exportação" }).click()
    await expect(page.getByRole("dialog")).toHaveCount(0)
    const responsiveness = await page.evaluate(() => {
      const probe = (window as unknown as { exportResponsiveness: { timer: number, longest: number, ticks: number } }).exportResponsiveness
      clearInterval(probe.timer)
      return { longest: probe.longest, ticks: probe.ticks }
    })
    expect(responsiveness.longest).toBeLessThan(1000)
    expect(responsiveness.ticks).toBeGreaterThan(5)
    await page.waitForTimeout(500)
    expect(downloads).toEqual([])
    await expect(trigger).toBeFocused()
  })
}
