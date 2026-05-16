import { useRef, useState } from 'react';
import type { LayerKey } from '../api/types';
import {
  useLayerSlotsStore,
  useLayerStore,
  useToastStore,
  type LayerSlot,
} from '../store';

const LONG_PRESS_MS = 600;

function activeLayerKeys(active: Partial<Record<LayerKey, boolean>>): LayerKey[] {
  return (Object.keys(active) as LayerKey[]).filter((k) => active[k] === true);
}

function loadSlot(layers: LayerKey[]) {
  // Replace the active-layers map outright so toggles match the saved config.
  const next: Partial<Record<LayerKey, boolean>> = {};
  for (const k of layers) next[k] = true;
  useLayerStore.setState({ active: next });
}

interface SlotButtonProps {
  index: number;
}

function SlotButton({ index }: SlotButtonProps) {
  const slot = useLayerSlotsStore((s) => s.slots[index]);
  const save = useLayerSlotsStore((s) => s.save);
  const active = useLayerStore((s) => s.active);
  const push = useToastStore((s) => s.push);

  const longPressTimer = useRef<number | null>(null);
  const longPressFired = useRef(false);
  const [flash, setFlash] = useState<'save' | 'load' | null>(null);

  const flashFor = (kind: 'save' | 'load') => {
    setFlash(kind);
    window.setTimeout(() => setFlash(null), 350);
  };

  const doSave = (kind: 'created' | 'updated') => {
    const layers = activeLayerKeys(active);
    const payload: LayerSlot = { layers, savedAt: Date.now() };
    save(index, payload);
    flashFor('save');
    push(
      'success',
      kind === 'created'
        ? `Saved ${layers.length} layer${layers.length === 1 ? '' : 's'} to slot ${index + 1}`
        : `Updated slot ${index + 1} (${layers.length} layer${layers.length === 1 ? '' : 's'})`,
    );
  };

  const doLoad = () => {
    if (!slot) return;
    loadSlot(slot.layers);
    flashFor('load');
    push('info', `Loaded slot ${index + 1} (${slot.layers.length} layer${slot.layers.length === 1 ? '' : 's'})`);
  };

  const onPointerDown = () => {
    longPressFired.current = false;
    longPressTimer.current = window.setTimeout(() => {
      longPressFired.current = true;
      doSave(slot ? 'updated' : 'created');
    }, LONG_PRESS_MS);
  };

  const cancelTimer = () => {
    if (longPressTimer.current != null) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const onPointerUp = () => {
    cancelTimer();
    if (longPressFired.current) return;
    if (slot) doLoad();
    else doSave('created');
  };

  const onPointerLeave = () => {
    cancelTimer();
    longPressFired.current = false;
  };

  const filled = !!slot;
  const base =
    'relative flex h-9 w-9 select-none items-center justify-center rounded border text-sm font-semibold transition active:scale-95';
  const skin = filled
    ? 'border-white/35 bg-black/80 text-white hover:bg-black/95'
    : 'border-white/20 bg-black/90 text-white/65 hover:border-white/35 hover:bg-black hover:text-white';
  const flashCls =
    flash === 'save'
      ? 'ring-2 ring-emerald-300/80'
      : flash === 'load'
        ? 'ring-2 ring-white/70'
        : '';

  return (
    <button
      type="button"
      className={`${base} ${skin} ${flashCls}`}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerLeave}
      onPointerCancel={onPointerLeave}
      onContextMenu={(e) => e.preventDefault()}
      title={
        filled
          ? `Slot ${index + 1}: ${slot!.layers.length} layers — click to load, hold to overwrite`
          : `Slot ${index + 1}: empty — click to save current layers, hold to confirm`
      }
    >
      {index + 1}
      {filled && (
        <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-emerald-300 ring-2 ring-black" />
      )}
    </button>
  );
}

export default function LayerSlots() {
  return (
    <div className="pointer-events-auto absolute bottom-3 right-3 z-[1000] flex items-center gap-2 rounded border border-white/15 bg-black/95 p-2 text-white shadow-[0_10px_28px_rgba(0,0,0,0.45)]">
      <span className="font-mono text-[10px] uppercase leading-tight tracking-[0.06em] text-white/55">
        click: load/save
        <br />
        hold: overwrite
      </span>
      <div className="flex gap-1.5">
        {[0, 1, 2, 3, 4].map((i) => (
          <SlotButton key={i} index={i} />
        ))}
      </div>
      <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-white/85">Presets</span>
    </div>
  );
}
