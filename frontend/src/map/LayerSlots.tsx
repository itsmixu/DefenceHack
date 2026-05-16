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
    'relative flex h-9 w-9 select-none items-center justify-center rounded-md border text-sm font-semibold shadow-sm transition active:scale-95';
  const skin = filled
    ? 'border-sky-400 bg-sky-500 text-white hover:bg-sky-600'
    : 'border-slate-300 bg-white text-slate-500 hover:border-slate-400 hover:text-slate-700';
  const flashCls =
    flash === 'save'
      ? 'ring-4 ring-emerald-300'
      : flash === 'load'
        ? 'ring-4 ring-sky-300'
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
        <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-emerald-400 ring-2 ring-white" />
      )}
    </button>
  );
}

export default function LayerSlots() {
  return (
    <div className="pointer-events-auto absolute bottom-3 right-3 z-[1000] flex items-center gap-2 rounded-md border border-slate-200 bg-white/95 p-2 shadow-md">
      <span className="text-[10px] leading-tight text-slate-400">
        click: load/save
        <br />
        hold: overwrite
      </span>
      <div className="flex gap-1.5">
        {[0, 1, 2, 3, 4].map((i) => (
          <SlotButton key={i} index={i} />
        ))}
      </div>
      <span className="text-xs font-semibold text-slate-700">Presets</span>
    </div>
  );
}
