import { useCallback, useMemo, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { Box, Check, RotateCcw, Save } from "lucide-react"
import { vehicles } from "@/api/endpoints"
import { VEHICLE_STATUS_LABEL, VEHICLE_TYPE_LABEL } from "@/api/labels"
import type { Vehicle, VehicleAppearance, VehicleColor, VehicleType } from "@/api/types"
import { Page, PageHeader } from "@/components/layout/kit"
import { ErrorBox, LoadingBlock } from "@/components/layout/feedback"
import VehicleViewer from "@/components/garagem/vehicle-viewer"
import { DEFAULT_VEHICLE_APPEARANCE, VEHICLE_MODEL_TYPES, VEHICLE_PALETTE, vehicleModelDimensions } from "@/components/mapa/map/vehicle-models"
import { useMutation, useResource } from "@/hooks/use-resource"
import "./garagem.css"

const COLOR_LABEL: Record<VehicleColor, string> = { vermelho_bombeiro: "Vermelho bombeiro", branco: "Branco", amarelo_refletivo: "Amarelo refletivo", grafite: "Grafite" }
async function loadFleet(): Promise<Vehicle[]> {
  const first = await vehicles.list({ page: 1, per_page: 100 })
  const result = [...first.items]
  for (let page = 2; page <= Math.ceil(first.total / first.per_page); page++) {
    const next = await vehicles.list({ page, per_page: first.per_page }); result.push(...next.items)
  }
  return result
}
const number = (value: number | undefined | null, unit: string) => value == null ? "Não informado" : `${value.toLocaleString("pt-BR")} ${unit}`

export default function Garagem() {
  const [params] = useSearchParams()
  const fleet = useResource(loadFleet, [])
  const [selection, setSelection] = useState<{ type?: VehicleType; id?: string }>({ id: params.get("vehicle") ?? undefined })
  const [comparisonType, setComparisonType] = useState<VehicleType | "">("")
  const [thumbnails, setThumbnails] = useState<Partial<Record<VehicleType, string>>>({})
  const onThumbnail = useCallback((type: VehicleType, url: string) => setThumbnails((value) => value[type] === url ? value : { ...value, [type]: url }), [])
  const chosen = fleet.data?.find((vehicle) => vehicle.id === selection.id)
  const type = selection.type ?? chosen?.type ?? "ABT"
  const matching = fleet.data?.filter((vehicle) => vehicle.type === type) ?? []
  const active = chosen?.type === type ? chosen : matching[0]
  const comparison = fleet.data?.find((vehicle) => vehicle.type === comparisonType)
  return <Page>
    <PageHeader title="Garagem 3D" subtitle="Reconheça a frota, inspecione a montagem e configure a identificação das viaturas." />
    {fleet.error && <ErrorBox message={fleet.error} onRetry={fleet.reload} />}
    {fleet.loading && !fleet.data && <LoadingBlock />}
    <div className="garage-layout">
      <aside className="garage-catalogue" aria-label="Catálogo de tipos de viatura">
        <div className="garage-section-title"><h2>Catálogo</h2><span>{VEHICLE_MODEL_TYPES.length} tipos</span></div>
        <div className="garage-type-list">{VEHICLE_MODEL_TYPES.map((item) => {
          const count = fleet.data?.filter((vehicle) => vehicle.type === item).length
          return <button type="button" key={item} aria-pressed={item === type} className="garage-type" onClick={() => setSelection({ type: item })}>
            <span className="garage-thumbnail">{thumbnails[item] ? <img src={thumbnails[item]} alt="" width="170" height="100" /> : <Box size={24} aria-hidden="true" />}</span>
            <span><strong>{item}</strong><small>{VEHICLE_TYPE_LABEL[item]}</small><em>{count === undefined ? "Carregando frota…" : `${count} na frota`}</em></span>
          </button>
        })}</div>
      </aside>
      <GarageSelection key={`${type}:${active?.id ?? "catalogue"}`} type={type} vehicle={active} matching={matching}
        fleetReady={!!fleet.data} count={matching.length} comparisonType={comparisonType} comparison={comparison}
        setComparisonType={setComparisonType} selectVehicle={(id) => setSelection({ type, id })} onThumbnail={onThumbnail}
        onSaved={(updated) => fleet.setData((fleet.data ?? []).map((item) => item.id === updated.id ? updated : item))}
        presentation={params.get("presentation") === "garage"} />
    </div>
  </Page>
}

function GarageSelection({ type, vehicle, matching, fleetReady, count, comparisonType, comparison, setComparisonType, selectVehicle, onThumbnail, onSaved, presentation }: {
  type: VehicleType; vehicle?: Vehicle; matching: Vehicle[]; fleetReady: boolean; count: number
  comparisonType: VehicleType | ""; comparison?: Vehicle; setComparisonType: (value: VehicleType | "") => void
  selectVehicle: (id: string) => void; onThumbnail: (type: VehicleType, url: string) => void; onSaved: (vehicle: Vehicle) => void; presentation: boolean
}) {
  const [appearance, setAppearance] = useState<VehicleAppearance>(() => ({ ...DEFAULT_VEHICLE_APPEARANCE, ...vehicle?.appearance }))
  const [prefix, setPrefix] = useState(vehicle?.prefix ?? type)
  const [restored, setRestored] = useState(false)
  const [saved, setSaved] = useState(false)
  const save = useMutation(() => vehicles.update(vehicle!.id, { appearance: restored ? null : appearance, prefix: prefix.trim() }))
  const model = useMemo(() => ({ type, prefix, unit_acronym: vehicle?.unit?.acronym, appearance }), [type, prefix, vehicle?.unit?.acronym, appearance])
  const comparisonModel = useMemo(() => comparisonType ? ({ type: comparisonType, prefix: comparison?.prefix, unit_acronym: comparison?.unit?.acronym, appearance: comparison?.appearance }) : undefined, [comparisonType, comparison])
  const dirty = prefix.trim() !== (vehicle?.prefix ?? type) || JSON.stringify(appearance) !== JSON.stringify({ ...DEFAULT_VEHICLE_APPEARANCE, ...vehicle?.appearance }) || restored && !!vehicle?.appearance
  function change(next: Partial<VehicleAppearance>) { setAppearance((value) => ({ ...value, ...next })); setSaved(false); setRestored(false) }
  async function persist() { if (!vehicle) return; const updated = await save.run(undefined); if (updated) { onSaved(updated); setSaved(true); setRestored(false) } }
  return <>
    <VehicleViewer model={model} comparison={comparisonModel} onThumbnail={onThumbnail} presentation={presentation} />
    <aside className="garage-details" aria-label="Ficha e aparência da viatura">
      <section>
        <div className="garage-section-title"><h2>Ficha da viatura</h2><span>{type}</span></div>
        {matching.length > 0 && <label className="garage-field">Viatura registrada<select value={vehicle?.id ?? ""} onChange={(event) => selectVehicle(event.target.value)}>{matching.map((item) => <option key={item.id} value={item.id}>{item.prefix} · {item.unit?.acronym ?? item.plate}</option>)}</select></label>}
        <h3 className="garage-vehicle-title">{VEHICLE_TYPE_LABEL[type]}</h3>
        <p className="garage-description">{vehicle ? `${vehicle.model} · ${vehicle.year} · ${vehicle.plate}` : fleetReady ? "Modelo de catálogo. Nenhuma viatura deste tipo está cadastrada." : "Consultando a frota…"}</p>
        <dl className="garage-specs">
          <div><dt>Água</dt><dd>{number(vehicle?.water_capacity_liters, "L")}</dd></div>
          <div><dt>Guarnição</dt><dd>{number(vehicle?.crew_capacity, "lugares")}</dd></div>
          <div><dt>Na frota</dt><dd>{fleetReady ? count : "—"}</dd></div>
          <div><dt>Unidade</dt><dd>{vehicle?.unit?.acronym ?? "—"}</dd></div>
          {vehicle && <div className="garage-spec-wide"><dt>Disponibilidade</dt><dd>{VEHICLE_STATUS_LABEL[vehicle.status]}</dd></div>}
        </dl>
      </section>
      <section>
        <div className="garage-section-title"><h2>Aparência</h2><span>Paleta institucional</span></div>
        <fieldset className="garage-palette"><legend>Carroceria</legend>{(Object.keys(VEHICLE_PALETTE) as VehicleColor[]).map((color) => <button type="button" key={color} title={COLOR_LABEL[color]} aria-label={`Carroceria: ${COLOR_LABEL[color]}`} aria-pressed={appearance.body_color === color} style={{ backgroundColor: VEHICLE_PALETTE[color] }} onClick={() => change({ body_color: color })}>{appearance.body_color === color && <Check size={17} />}</button>)}</fieldset>
        <fieldset className="garage-palette"><legend>Faixa refletiva</legend>{(Object.keys(VEHICLE_PALETTE) as VehicleColor[]).map((color) => <button type="button" key={color} title={COLOR_LABEL[color]} aria-label={`Faixa: ${COLOR_LABEL[color]}`} aria-pressed={appearance.stripe_color === color} style={{ backgroundColor: VEHICLE_PALETTE[color] }} onClick={() => change({ stripe_color: color })}>{appearance.stripe_color === color && <Check size={17} />}</button>)}</fieldset>
        <label className="garage-field">Prefixo no cadastro e no modelo<input value={prefix} maxLength={20} onChange={(event) => { setPrefix(event.target.value); setSaved(false) }} /></label>
        <div className="garage-toggles garage-toggles-stack">
          <label><input type="checkbox" checked={appearance.show_prefix} onChange={(event) => change({ show_prefix: event.target.checked })} />Identificação no teto e lateral</label>
          <label><input type="checkbox" checked={appearance.unit_badge} onChange={(event) => change({ unit_badge: event.target.checked })} />Sigla da unidade {vehicle?.unit?.acronym ?? ""}</label>
        </div>
        <div className="garage-save-actions">
          <button type="button" onClick={() => { setAppearance({ ...DEFAULT_VEHICLE_APPEARANCE }); setPrefix(vehicle?.prefix ?? type); setRestored(true); setSaved(false) }}><RotateCcw size={14} />Restaurar</button>
          <button type="button" className="garage-save" disabled={!vehicle || !prefix.trim() || save.submitting || !dirty} onClick={() => void persist()}><Save size={14} />{save.submitting ? "Salvando…" : "Salvar"}</button>
        </div>
        {save.error && <p role="alert" className="garage-error">{save.error}</p>}
        <p className="garage-description" role="status">{saved ? "Aparência salva. O mapa usará esta identificação." : vehicle ? dirty ? "Prévia com alterações ainda não salvas." : "Aparência salva por viatura." : "Prévia de catálogo. Cadastre uma viatura para salvar a aparência."}</p>
      </section>
      <section>
        <div className="garage-section-title"><h2>Comparar escala</h2></div>
        <label className="garage-field">Segundo modelo<select value={comparisonType} onChange={(event) => setComparisonType(event.target.value as VehicleType | "")}><option value="">Sem comparação</option>{VEHICLE_MODEL_TYPES.map((item) => <option key={item} value={item}>{item} · {VEHICLE_TYPE_LABEL[item]}</option>)}</select></label>
        {comparisonType && <dl className="garage-compare"><div><dt>{type}</dt><dd>{vehicleModelDimensions(type).length.toLocaleString("pt-BR")} m · {number(vehicle?.water_capacity_liters, "L")} · {number(vehicle?.crew_capacity, "lugares")}</dd></div><div><dt>{comparisonType}</dt><dd>{vehicleModelDimensions(comparisonType).length.toLocaleString("pt-BR")} m · {number(comparison?.water_capacity_liters, "L")} · {number(comparison?.crew_capacity, "lugares")}</dd></div></dl>}
        <p className="garage-description">Dimensões 3D ilustrativas, na mesma escala. Capacidade e quantidade vêm do cadastro real da frota.</p>
      </section>
    </aside>
  </>
}
