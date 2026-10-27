-- CreateEnum
CREATE TYPE "OccurrenceEventType" AS ENUM ('ABERTURA', 'STATUS', 'PRIORIDADE', 'DESPACHO', 'DESPACHO_STATUS', 'ROTA', 'NOTA');

-- CreateEnum
CREATE TYPE "WaterSourceType" AS ENUM ('HIDRANTE_COLUNA', 'HIDRANTE_SUBTERRANEO', 'CISTERNA', 'RESERVATORIO', 'PONTO_CAPTACAO');

-- CreateEnum
CREATE TYPE "WaterSourceStatus" AS ENUM ('OPERANTE', 'INOPERANTE', 'NAO_VERIFICADO');

-- AlterTable
ALTER TABLE "route" ADD COLUMN     "segments" JSONB,
ADD COLUMN     "steps" JSONB;

-- CreateTable
CREATE TABLE "occurrence_event" (
    "id" TEXT NOT NULL,
    "type" "OccurrenceEventType" NOT NULL,
    "message" TEXT,
    "from_value" TEXT,
    "to_value" TEXT,
    "occurrence_id" TEXT NOT NULL,
    "dispatch_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "occurrence_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "water_source" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" "WaterSourceType" NOT NULL,
    "status" "WaterSourceStatus" NOT NULL DEFAULT 'NAO_VERIFICADO',
    "address" TEXT NOT NULL,
    "latitude" DECIMAL(15,12) NOT NULL,
    "longitude" DECIMAL(15,12) NOT NULL,
    "flow_lpm" INTEGER,
    "notes" TEXT,
    "last_inspection_at" TIMESTAMP(3),
    "unit_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "water_source_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "occurrence_event_occurrence_id_created_at_idx" ON "occurrence_event"("occurrence_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "water_source_code_key" ON "water_source"("code");

-- CreateIndex
CREATE INDEX "water_source_unit_id_idx" ON "water_source"("unit_id");

-- CreateIndex
CREATE INDEX "water_source_status_idx" ON "water_source"("status");

-- AddForeignKey
ALTER TABLE "occurrence_event" ADD CONSTRAINT "occurrence_event_occurrence_id_fkey" FOREIGN KEY ("occurrence_id") REFERENCES "occurrence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "occurrence_event" ADD CONSTRAINT "occurrence_event_dispatch_id_fkey" FOREIGN KEY ("dispatch_id") REFERENCES "dispatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "water_source" ADD CONSTRAINT "water_source_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
