/** Visual filament colour picker — swatch grid + hex label. */

export const FILAMENT_SWATCHES = [
  { id: "sky", hex: "#38bdf8", label: "Sky blue" },
  { id: "white", hex: "#f8fafc", label: "White" },
  { id: "black", hex: "#1e293b", label: "Black" },
  { id: "red", hex: "#dc2626", label: "Red" },
  { id: "orange", hex: "#f97316", label: "Orange" },
  { id: "yellow", hex: "#eab308", label: "Yellow" },
  { id: "green", hex: "#22c55e", label: "Green" },
  { id: "blue", hex: "#2563eb", label: "Blue" },
  { id: "purple", hex: "#a855f7", label: "Purple" },
  { id: "pink", hex: "#ec4899", label: "Pink" },
  { id: "grey", hex: "#94a3b8", label: "Grey" },
  { id: "cream", hex: "#fde68a", label: "Cream" },
];

export function normalizeHex(hex, fallback = "#ffffff") {
  const raw = String(hex || fallback).trim();
  if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(raw)) {
    const h = raw.slice(1);
    return `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`.toLowerCase();
  }
  return fallback.toLowerCase();
}

function swatchButton(s, selectedHex) {
  const on = normalizeHex(selectedHex) === normalizeHex(s.hex);
  return `<button type="button" class="color-swatch${on ? " is-active" : ""}" data-color="${s.hex}" style="--swatch:${s.hex}" title="${s.label}" aria-label="${s.label}"></button>`;
}

/** Replace a host element's contents with a colour picker UI. */
export function mountColorPicker(host, { value, onChange }) {
  if (!host) return;
  const current = normalizeHex(value);
  host.classList.add("color-picker-host");
  host.innerHTML = `
    <div class="color-picker">
      <button type="button" class="color-picker-current" aria-haspopup="listbox" aria-expanded="false">
        <span class="color-picker-chip" style="--chip:${current}"></span>
        <span class="color-picker-label">${current.toUpperCase()}</span>
        <span class="color-picker-caret" aria-hidden="true">▾</span>
      </button>
      <div class="color-picker-panel hidden" role="listbox">
        <div class="color-picker-grid">${FILAMENT_SWATCHES.map((s) => swatchButton(s, current)).join("")}</div>
        <label class="color-picker-custom">
          <span>Custom</span>
          <input type="color" class="color-picker-native" value="${current}">
        </label>
      </div>
    </div>`;

  const root = host.querySelector(".color-picker");
  const panel = host.querySelector(".color-picker-panel");
  const currentBtn = host.querySelector(".color-picker-current");
  const chip = host.querySelector(".color-picker-chip");
  const label = host.querySelector(".color-picker-label");
  const native = host.querySelector(".color-picker-native");

  function setUi(hex) {
    const next = normalizeHex(hex);
    chip.style.setProperty("--chip", next);
    label.textContent = next.toUpperCase();
    native.value = next;
    host.querySelectorAll(".color-swatch").forEach((btn) => {
      btn.classList.toggle("is-active", normalizeHex(btn.dataset.color) === next);
    });
  }

  function pick(hex) {
    const next = normalizeHex(hex);
    setUi(next);
    onChange?.(next);
  }

  function closePanel() {
    panel.classList.add("hidden");
    currentBtn.setAttribute("aria-expanded", "false");
  }

  function togglePanel() {
    const open = panel.classList.toggle("hidden");
    currentBtn.setAttribute("aria-expanded", open ? "false" : "true");
  }

  currentBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    togglePanel();
  });

  panel.addEventListener("click", (e) => {
    const sw = e.target.closest(".color-swatch");
    if (sw?.dataset.color) {
      pick(sw.dataset.color);
      closePanel();
    }
  });

  native.addEventListener("input", (e) => pick(e.target.value));

  document.addEventListener("click", (e) => {
    if (!host.contains(e.target)) closePanel();
  });

  host._setColorPickerValue = setUi;
  setUi(current);
}

export function setColorPickerValue(host, hex) {
  host?._setColorPickerValue?.(normalizeHex(hex));
}
