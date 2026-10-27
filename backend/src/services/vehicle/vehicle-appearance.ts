import { z } from "zod/v4";

const APPEARANCE_COLORS = ["vermelho_bombeiro", "branco", "amarelo_refletivo", "grafite"] as const
const VEHICLE_VARIANTS = ["default", "ABT", "ABTF", "ABTR", "AT", "ASE", "AEM", "APM", "UR", "MOB", "ABRESC", "AV"] as const

// A paleta fechada mantém a identificação operacional legível em cada modelo.
export const vehicleAppearanceSchema = z.object({
  variant: z.enum(VEHICLE_VARIANTS),
  body_color: z.enum(APPEARANCE_COLORS),
  stripe_color: z.enum(APPEARANCE_COLORS),
  show_prefix: z.boolean(),
  unit_badge: z.boolean()
}).strict()

export type VehicleAppearance = z.infer<typeof vehicleAppearanceSchema>
