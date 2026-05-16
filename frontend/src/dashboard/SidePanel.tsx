import { useState } from 'react';
import { ClipboardList, Layers } from 'lucide-react';
import LayerToggles from './LayerToggles';
import DrawnList from './DrawnList';

type Tab = 'layers' | 'drawn';

export default function SidePanel() {
  const [tab, setTab] = useState<Tab>('layers');

  return (
    <div className="flex h-full flex-col border-l border-white/10 bg-[#111111]/92 text-white">
      <header className="border-b border-white/10 px-4 py-3">
        <h1 className="text-sm font-black uppercase tracking-[0.14em] text-white">61N IPB Tool</h1>
        <p className="mt-1 text-[10px] uppercase tracking-[0.16em] text-white/55">DefenceHack — Junction</p>
      </header>

      <nav className="grid grid-cols-2 border-b border-white/10 text-[10px] uppercase tracking-[0.16em]">
        <TabBtn
          active={tab === 'layers'}
          onClick={() => setTab('layers')}
          icon={<Layers size={14} />}
          label="Layers"
        />
        <TabBtn
          active={tab === 'drawn'}
          onClick={() => setTab('drawn')}
          icon={<ClipboardList size={14} />}
          label="Drawn"
        />
      </nav>

      <main className="flex-1 overflow-y-auto p-3 text-sm text-white/90">
        {tab === 'layers' && <LayerToggles />}
        {tab === 'drawn' && <DrawnList />}
      </main>
    </div>
  );
}

interface TabProps {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}

function TabBtn({ active, onClick, icon, label }: TabProps) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center justify-center gap-1 px-2 py-2 transition ${
        active
          ? 'border-b border-white bg-white text-black shadow-[inset_0_-1px_0_rgba(255,255,255,0.9)]'
          : 'text-white/60 hover:bg-white/[0.06] hover:text-white'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
