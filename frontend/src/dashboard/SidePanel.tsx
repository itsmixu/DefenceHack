import { useState } from 'react';
import { BookOpen, ClipboardList, FolderOpen, Layers, Radar } from 'lucide-react';
import LayerToggles from './LayerToggles';
import DrawnList from './DrawnList';
import BriefingPanel from './briefing/BriefingPanel';
import PlansPanel from './PlansPanel';
import FileSystemPanel from './FileSystemPanel';

type Tab = 'layers' | 'briefing' | 'files' | 'drawn' | 'plans';

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'layers', label: 'Layers', icon: <Layers size={12} /> },
  { id: 'briefing', label: 'Brief', icon: <Radar size={12} /> },
  { id: 'files', label: 'Files', icon: <FolderOpen size={12} /> },
  { id: 'drawn', label: 'Drawn', icon: <ClipboardList size={12} /> },
  { id: 'plans', label: 'Plans', icon: <BookOpen size={12} /> },
];

export default function SidePanel() {
  const [tab, setTab] = useState<Tab>('layers');

  return (
    <div className="flex h-full flex-col border-l text-white" style={{ background: '#131313', borderColor: '#393939' }}>
      <header className="border-b px-4 py-3" style={{ borderColor: '#393939' }}>
        <h1 className="font-mono text-[13px] font-black uppercase tracking-[0.18em] text-white">61N IPB Tool</h1>
        <p className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.18em] text-white/40">DefenceHack — Junction</p>
      </header>

      <nav className="grid grid-cols-5 border-b text-[9px] uppercase tracking-[0.12em]" style={{ borderColor: '#393939' }}>
        {TABS.map((t) => (
          <TabBtn
            key={t.id}
            active={tab === t.id}
            onClick={() => setTab(t.id)}
            icon={t.icon}
            label={t.label}
          />
        ))}
      </nav>

      <main className="flex-1 overflow-y-auto p-3 text-sm text-white/90">
        {tab === 'layers' && <LayerToggles />}
        {tab === 'briefing' && <BriefingPanel />}
        {tab === 'files' && <FileSystemPanel />}
        {tab === 'drawn' && <DrawnList />}
        {tab === 'plans' && <PlansPanel />}
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
      className="flex flex-col items-center justify-center gap-0.5 px-1 py-2 font-mono transition"
      style={{
        background: active ? '#ffffff' : 'transparent',
        color: active ? '#131313' : 'rgba(255,255,255,0.50)',
        borderBottom: active ? '2px solid #ffffff' : '2px solid transparent',
      }}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
