import test from "node:test"
import assert from "node:assert/strict"
import * as THREE from "three"
import type { OccurrenceNature } from "../src/api/types.ts"
import { ARRIVAL_DURATION_SECONDS, createArrivalScene, disposeArrivalScene, updateArrivalScene } from "../src/components/mapa/map/arrival-scenes.ts"

const natures: OccurrenceNature[] = ["INCENDIO_EDIFICACAO", "INCENDIO_VEICULO", "INCENDIO_VEGETACAO", "CAPTURA_ANIMAL", "SALVAMENTO", "AFOGAMENTO", "ATENDIMENTO_PRE_HOSPITALAR", "PRODUTOS_PERIGOSOS", "VISTORIA", "OUTROS"]
test("each arrival scene reaches a finite static endpoint, and seeking is deterministic", () => {
  for (const nature of natures) {
    const scene = createArrivalScene(nature)
    const final = updateArrivalScene(scene, ARRIVAL_DURATION_SECONDS)
    assert.equal(final.complete, true)
    assert.ok(final.label.length > 0)
    const poses = scene.children.map((child) => child.position.toArray())
    updateArrivalScene(scene, 2)
    updateArrivalScene(scene, ARRIVAL_DURATION_SECONDS +10)
    assert.deepEqual(scene.children.map((child) => child.position.toArray()), poses)
    assert.ok(Number.isFinite(new THREE.Box3().setFromObject(scene).max.z))
    disposeArrivalScene(scene)
  }
})
test("reduced motion skips movement and the effects-only variant has no characters", () => {
  const scene = createArrivalScene("INCENDIO_EDIFICACAO", { characters: false })
  assert.equal(scene.children.filter((child) => child.name === "Bombeiro").length, 0)
  assert.deepEqual(updateArrivalScene(scene, .1, { reducedMotion: true }), { complete: true, progress: 1, label: "No local" })
  disposeArrivalScene(scene)
})
test("water stays bounded and scene resources are released only after their last owner", () => {
  const first = createArrivalScene("INCENDIO_EDIFICACAO"), second = createArrivalScene("INCENDIO_EDIFICACAO")
  const water = first.getObjectByName("Jato de água") as THREE.Points
  assert.ok(water.geometry.getAttribute("position").count <=200)
  const geometry = (first.getObjectByName("Anel de chegada") as THREE.Mesh).geometry
  assert.equal(geometry, (second.getObjectByName("Anel de chegada") as THREE.Mesh).geometry)
  let geometryDisposals = 0, waterDisposals = 0
  geometry.addEventListener("dispose", () => geometryDisposals++)
  water.geometry.addEventListener("dispose", () => waterDisposals++)
  disposeArrivalScene(first); assert.equal(geometryDisposals, 0); assert.equal(waterDisposals, 1)
  disposeArrivalScene(second); assert.equal(geometryDisposals, 1)
  disposeArrivalScene(second); assert.equal(geometryDisposals, 1)
})

test("the animal rescue starts at the cab before the firefighter reaches the ladder", () => {
  const scene = createArrivalScene("CAPTURA_ANIMAL")
  const actor = scene.getObjectByName("Bombeiro")!
  updateArrivalScene(scene, .6)
  assert.ok(actor.position.y < 1, "the firefighter should leave the cab instead of appearing by the tree")
  updateArrivalScene(scene, 2.8)
  assert.ok(actor.position.y > 3 && actor.position.z > 2)
  updateArrivalScene(scene, ARRIVAL_DURATION_SECONDS)
  const cat = scene.getObjectByName("Gato resgatado")!
  assert.ok(actor.position.z === 0 && cat.position.z < 2)
  disposeArrivalScene(scene)
})
