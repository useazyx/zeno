// Stand-in for `src/generated/prisma/client.ts` used only inside Jest.
//
// The real generated client calls `import.meta.url` at module top level to
// locate the query engine binary, which is valid ESM but cannot run under
// the CommonJS transform ts-jest uses for tests (see jest.config.cjs). None
// of the services under unit test touch the database directly — `prisma`
// itself is always mocked via `jest.mock(".../config/prisma.js", ...)` — so
// this stub only needs to provide what services import as a runtime value:
// `Prisma.Decimal`, used to store latitude/longitude/etc. Every other named
// import from the real module (`Unit`, `UnitType`, `Dispatch`, ...) is used
// purely as a TypeScript type in service files and is erased at compile
// time, so it never needs a runtime counterpart here.
class Decimal {
  private readonly value: number

  constructor(value: number | string) {
    this.value = typeof value === "string" ? Number(value) : value
  }

  toString() {
    return String(this.value)
  }

  toNumber() {
    return this.value
  }

  valueOf() {
    return this.value
  }
}

export const Prisma = { Decimal, DbNull: { __databaseNull: true } }
