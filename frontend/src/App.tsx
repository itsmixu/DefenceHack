import { useEffect } from 'react';
import MapView from './map/MapView';
import SidePanel from './dashboard/SidePanel';
import FileManagerOverlay from './dashboard/FileManagerOverlay';
import TopBar from './dashboard/TopBar';
import Toaster from './dashboard/Toaster';
import WelcomeModal from './dashboard/WelcomeModal';
import DebugPanel from './dashboard/DebugPanel';
import DemoBanner from './demo/DemoBanner';
import { installFetchInterceptor } from './lib/fetchInterceptor';

export default function App() {
  useEffect(() => {
    installFetchInterceptor();
  }, []);

  return (
    <div className="relative z-10 flex h-full w-full flex-col bg-[#131313] text-white">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <main className="relative flex-1 border-r" style={{ borderColor: '#393939' }}>
          <MapView />
          <FileManagerOverlay />
        </main>
        <aside className="w-[360px] shrink-0" style={{ background: '#131313', borderLeft: '1px solid #393939' }}>
          <SidePanel />
        </aside>
      </div>
      <Toaster />
      <DebugPanel />
      <DemoBanner />
      <WelcomeModal />
    </div>
  );
}
