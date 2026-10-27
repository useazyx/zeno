/** Lets any button open the command palette without owning its state. */

export const OPEN_PALETTE_EVENT = "zeno:open-palette"

export function openCommandPalette() {
  window.dispatchEvent(new Event(OPEN_PALETTE_EVENT))
}
