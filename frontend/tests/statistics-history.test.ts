import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { runInNewContext } from "node:vm"
import ts from "typescript"

const source = ts.createSourceFile("estatisticas.tsx", readFileSync(new URL("../src/pages/estatisticas.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const bucketize = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "bucketize")!
const compiled = ts.transpileModule(`${bucketize.getText(source)}\nexports.bucketize = bucketize;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
const exports: { bucketize?: (items: { opened_at: string }[], days: number, end: number) => { value: number }[] } = {}
runInNewContext(compiled, { exports, DAY_MS: 86_400_000 })

test("the full-history chart counts large histories without exceeding the function argument limit", () => {
  const items = Array.from({ length: 200_000 }, () => ({ opened_at: "2026-09-15T12:00:00Z" }))
  items.push({ opened_at: "2020-09-15T12:00:00Z" }, { opened_at: "invalid" })
  const series = exports.bucketize!(items, 0, Date.parse("2026-10-01T12:00:00Z"))
  assert.equal(series.reduce((sum, point) => sum + point.value, 0), 200_001)
  assert.equal(series.at(-1)?.value, 200_000)
})
