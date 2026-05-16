import MapView from './map/MapView';
import SidePanel from './dashboard/SidePanel';
import Toaster from './dashboard/Toaster';

export default function App() {
  return (
    <div className="relative z-10 flex h-full w-full bg-[#131313] text-white">
      <main className="relative flex-1 border-r border-white/10">
        <MapView />
      </main>
      <aside className="w-[360px] shrink-0 bg-black/55 backdrop-blur-md">
        <SidePanel />
      </aside>
      <Toaster />
    </div>
  );
}
