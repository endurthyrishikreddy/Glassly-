import React, { useState, useEffect } from 'react';
import { GlassOverlay } from './components/GlassOverlay';

// Dummy background component to demonstrate overlay transparency
const BackgroundDashboard = () => {
  const [dataPoints, setDataPoints] = useState<{x: number, y: number, size: number, color: string}[]>([]);

  useEffect(() => {
    // Generate random floating orbs
    const points = Array.from({ length: 20 }).map((_, i) => ({
      x: Math.random() * 100,
      y: Math.random() * 100,
      size: 10 + Math.random() * 100,
      color: ['bg-purple-500', 'bg-blue-500', 'bg-indigo-500', 'bg-pink-500'][Math.floor(Math.random() * 4)]
    }));
    setDataPoints(points);
  }, []);

  return (
    <div className="fixed inset-0 z-0 bg-[#0a0a0a] overflow-hidden">
      {/* Grid Background */}
      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:50px_50px] [mask-image:radial-gradient(ellipse_60%_60%_at_50%_50%,#000_70%,transparent_100%)]" />
      
      {/* Floating Orbs */}
      {dataPoints.map((point, i) => (
        <div
          key={i}
          className={`absolute rounded-full opacity-20 blur-3xl animate-pulse ${point.color}`}
          style={{
            left: `${point.x}%`,
            top: `${point.y}%`,
            width: `${point.size}px`,
            height: `${point.size}px`,
            animationDuration: `${3 + Math.random() * 5}s`,
            animationDelay: `${Math.random() * 2}s`
          }}
        />
      ))}

      {/* Mock App Content */}
      <div className="relative z-10 p-10 w-full h-full pointer-events-none flex flex-col justify-between">
        <header className="flex justify-between items-center border-b border-white/10 pb-6">
          <div>
            <h1 className="text-4xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-purple-400">
              Nebula Dashboard
            </h1>
            <p className="text-white/40 mt-2">Real-time Systems Monitoring</p>
          </div>
          <div className="flex gap-4">
             <div className="w-32 h-10 bg-white/5 rounded-lg animate-pulse" />
             <div className="w-10 h-10 bg-white/5 rounded-full animate-pulse" />
          </div>
        </header>

        <main className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-6 mt-8">
          <div className="col-span-2 h-64 md:h-full bg-white/5 border border-white/5 rounded-3xl p-6 backdrop-blur-sm">
             <div className="h-6 w-48 bg-white/10 rounded mb-4" />
             <div className="flex-1 h-[80%] bg-gradient-to-t from-indigo-500/20 to-transparent rounded-xl border-b border-indigo-500/30" />
          </div>
          <div className="space-y-6">
             <div className="h-48 bg-white/5 border border-white/5 rounded-3xl p-6 backdrop-blur-sm">
                <div className="h-6 w-32 bg-white/10 rounded mb-4" />
                <div className="flex items-center gap-4 mt-8">
                  <div className="w-16 h-16 rounded-full border-4 border-purple-500/30 border-t-purple-500 animate-spin" />
                  <div className="space-y-2">
                     <div className="w-24 h-3 bg-white/10 rounded" />
                     <div className="w-16 h-3 bg-white/10 rounded" />
                  </div>
                </div>
             </div>
             <div className="h-48 bg-white/5 border border-white/5 rounded-3xl p-6 backdrop-blur-sm">
                <div className="h-6 w-32 bg-white/10 rounded mb-4" />
                <div className="grid grid-cols-4 gap-2 mt-4">
                   {[1,2,3,4,5,6,7,8].map(n => (
                     <div key={n} className="aspect-square bg-white/5 rounded-lg animate-pulse" style={{ animationDelay: `${n * 0.1}s` }} />
                   ))}
                </div>
             </div>
          </div>
        </main>
      </div>
    </div>
  );
};

const App: React.FC = () => {
  return (
    <div className="relative w-screen h-screen overflow-hidden bg-black text-white font-sans antialiased selection:bg-emerald-500/30">
      {/* The Background App (Simulated) */}
      <BackgroundDashboard />

      {/* The Overlay Chat App */}
      <GlassOverlay />
    </div>
  );
};

export default App;