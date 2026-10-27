-- Persist the exact route adopted by each dispatch.
ALTER TABLE "dispatch" ADD COLUMN "used_route_id" TEXT;

-- Existing dispatches already store both route variants. Backfill the most
-- recent AI route so historical occurrences can be replayed immediately.
UPDATE "dispatch" AS d
SET "used_route_id" = (
  SELECT r."id"
  FROM "route" AS r
  WHERE r."dispatch_id" = d."id"
    AND r."algorithm" = 'NEURAL'
  ORDER BY r."created_at" DESC
  LIMIT 1
)
WHERE EXISTS (
  SELECT 1
  FROM "route" AS r
  WHERE r."dispatch_id" = d."id"
    AND r."algorithm" = 'NEURAL'
);

CREATE UNIQUE INDEX "dispatch_used_route_id_key" ON "dispatch"("used_route_id");

ALTER TABLE "dispatch"
ADD CONSTRAINT "dispatch_used_route_id_fkey"
FOREIGN KEY ("used_route_id") REFERENCES "route"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
