import { useState } from 'react';
import { Activity, ClipboardList, Layers } from 'lucide-react';
import LayerToggles from './LayerToggles';
import SourceStatusList from './SourceStatusList';
import DrawnList from './DrawnList';

type Tab = 'layers' | 'sources' | 'drawn';

export default function SidePanel() {
  const [tab, setTab] = useState<Tab>('layers');

  return (
    <div className="flex h-full flex-col border-l border-slate-200 bg-white">
      <header className="border-b border-slate-200 px-4 py-3">
        <h1 className="text-base font-bold text-slate-800">61N IPB Tool</h1>
        <p className="text-xs text-slate-500">DefenceHack — Junction</p>
      </header>

      <nav className="flex border-b border-slate-200 text-xs">
        <TabBtn
          active={tab === 'layers'}
          onClick={() => setTab('layers')}
          icon={<Layers size={14} />}
          label="Layers"
        />
        <TabBtn
          active={tab === 'sources'}
          onClick={() => setTab('sources')}
          icon={<Activity size={14} />}
          label="Sources"
        />
        <TabBtn
          active={tab === 'drawn'}
          onClick={() => setTab('drawn')}
          icon={<ClipboardList size={14} />}
          label="Drawn"
        />
      </nav>

      <main className="flex-1 overflow-y-auto p-3 text-sm">
        {tab === 'layers' && <LayerToggles />}
        {tab === 'sources' && <SourceStatusList />}
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
      className={`flex flex-1 items-center justify-center gap-1 px-2 py-2 transition-colors ${
        active
          ? 'border-b-2 border-blue-500 font-semibold text-blue-600'
          : 'text-slate-500 hover:bg-slate-50'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
