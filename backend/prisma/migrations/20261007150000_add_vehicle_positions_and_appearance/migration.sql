ALTER TABLE "vehicle" ADD COLUMN "last_position_at" TIMESTAMP(3), ADD COLUMN "appearance" JSONB;

CREATE TABLE "vehicle_position" (
  "id" TEXT NOT NULL,
  "vehicle_id" TEXT NOT NULL,
  "latitude" DECIMAL(15,12) NOT NULL,
  "longitude" DECIMAL(15,12) NOT NULL,
  "heading" DOUBLE PRECISION,
  "dispatch_id" TEXT,
  "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "vehicle_position_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "vehicle_position_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "vehicle_position_dispatch_id_fkey" FOREIGN KEY ("dispatch_id") REFERENCES "dispatch"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "vehicle_position_vehicle_id_recorded_at_idx" ON "vehicle_position"("vehicle_id", "recorded_at");
CREATE INDEX "vehicle_position_recorded_at_idx" ON "vehicle_position"("recorded_at");
CREATE INDEX "vehicle_position_dispatch_id_idx" ON "vehicle_position"("dispatch_id");
