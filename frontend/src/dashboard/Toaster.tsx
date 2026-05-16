import { CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { useToastStore, type ToastKind } from '../store';

const ICON: Record<ToastKind, typeof Info> = {
  info: Info,
  success: CheckCircle2,
  error: XCircle,
};

const SKIN: Record<ToastKind, string> = {
  info: 'border-sky-200 bg-sky-50 text-sky-800',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  error: 'border-red-200 bg-red-50 text-red-800',
};

export default function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[2000] flex w-80 flex-col gap-2">
      {toasts.map((t) => {
        const Icon = ICON[t.kind];
        return (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-start gap-2 rounded-md border px-3 py-2 text-xs shadow-md animate-in fade-in slide-in-from-right-2 ${SKIN[t.kind]}`}
            role="status"
          >
            <Icon className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="flex-1 leading-snug">{t.text}</span>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              className="rounded p-0.5 hover:bg-black/10"
              title="Dismiss"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
