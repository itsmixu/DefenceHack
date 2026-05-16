import MapView from './map/MapView';
import SidePanel from './dashboard/SidePanel';
import Toaster from './dashboard/Toaster';

export default function App() {
  return (
    <div className="flex h-full w-full">
      <main className="relative flex-1">
        <MapView />
      </main>
      <aside className="w-[340px] shrink-0">
        <SidePanel />
      </aside>
      <Toaster />
    </div>
  );
}
