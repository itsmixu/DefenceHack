import { useState } from 'react';
import { Activity, BookOpen, ClipboardList, Layers, Radar } from 'lucide-react';
import { ClipboardList, Layers } from 'lucide-react';
import LayerToggles from './LayerToggles';
import SourceStatusList from './SourceStatusList';
import DrawnList from './DrawnList';
import BriefingPanel from './briefing/BriefingPanel';
import PlansList from './PlansList';

type Tab = 'layers' | 'briefing' | 'sources' | 'drawn' | 'plans';

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'layers', label: 'Layers', icon: <Layers size={14} /> },
  { id: 'briefing', label: 'Brief', icon: <Radar size={14} /> },
  { id: 'sources', label: 'Sources', icon: <Activity size={14} /> },
  { id: 'drawn', label: 'Drawn', icon: <ClipboardList size={14} /> },
  { id: 'plans', label: 'Plans', icon: <BookOpen size={14} /> },
];
import PlansPanel from './PlansPanel';
import TacticalTools from './TacticalTools';

type Tab = 'layers' | 'sources' | 'drawn' | 'plans' | 'tools';

export default function SidePanel() {
  const [tab, setTab] = useState<Tab>('layers');

  return (
    <div className="flex h-full flex-col border-l border-white/10 bg-[#111111]/92 text-white">
      <header className="border-b border-white/10 px-4 py-3">
        <h1 className="text-sm font-black uppercase tracking-[0.14em] text-white">61N IPB Tool</h1>
        <p className="mt-1 text-[10px] uppercase tracking-[0.16em] text-white/55">DefenceHack — Junction</p>
      </header>

      <nav className="grid grid-cols-5 border-b border-white/10 text-[10px] uppercase tracking-[0.14em]">
        <TabBtn active={tab === 'layers'}  onClick={() => setTab('layers')}  icon={<Layers size={12} />}        label="Layers"  />
        <TabBtn active={tab === 'sources'} onClick={() => setTab('sources')} icon={<Activity size={12} />}      label="Sources" />
        <TabBtn active={tab === 'drawn'}   onClick={() => setTab('drawn')}   icon={<ClipboardList size={12} />} label="Drawn"   />
        <TabBtn active={tab === 'plans'}   onClick={() => setTab('plans')}   icon={<BookOpen size={12} />}      label="Plans"   />
        <TabBtn active={tab === 'tools'}   onClick={() => setTab('tools')}   icon={<Crosshair size={12} />}     label="Tools"   />
      </nav>

      <main className="flex-1 overflow-y-auto p-3 text-sm text-white/90">
        {tab === 'layers' && <LayerToggles />}
        {tab === 'briefing' && <BriefingPanel />}
        {tab === 'sources' && <SourceStatusList />}
        {tab === 'drawn' && <DrawnList />}
        {tab === 'plans' && <PlansList />}
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
      className={`flex flex-col items-center justify-center gap-0.5 px-1 py-2 transition ${
        active
          ? 'border-b border-white bg-white text-black shadow-[inset_0_-1px_0_rgba(255,255,255,0.9)]'
          : 'text-white/60 hover:bg-white/[0.06] hover:text-white'
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
