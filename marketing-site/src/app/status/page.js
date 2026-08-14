export default function Status() {
  const systems = [
    { name: "API & Webhooks", status: "operational" },
    { name: "Dashboard Application", status: "operational" },
    { name: "Email Automations", status: "degraded" },
    { name: "Data Sync (MLS/Carriers)", status: "operational" }
  ];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50 relative overflow-hidden font-sans">
      <div className="absolute top-[-10%] left-[-20%] w-[600px] h-[600px] bg-indigo-600/20 rounded-full blur-[150px]" />
      
      <nav className="relative z-10 flex items-center justify-between px-8 py-6 max-w-7xl mx-auto border-b border-white/10">
        <a href="/" className="text-2xl font-bold tracking-tighter bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
          RCM
        </a>
        <div className="hidden md:flex gap-8 text-sm font-medium text-slate-300">
          <a href="/" className="hover:text-white transition-colors">Home</a>
          <a href="/blog" className="hover:text-white transition-colors">Blog</a>
          <a href="/status" className="text-white">Status</a>
        </div>
      </nav>

      <main className="relative z-10 max-w-3xl mx-auto px-6 pt-20 pb-24">
        <div className="mb-12">
          <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight mb-4">
            System Status
          </h1>
          <p className="text-slate-400">
            Current status of RCM platform services and integrations.
          </p>
        </div>

        {/* Global Status Banner */}
        <div className="w-full rounded-xl bg-amber-500/10 border border-amber-500/20 p-6 mb-12 backdrop-blur-sm flex items-start gap-4">
          <div className="mt-1 flex-shrink-0 w-3 h-3 rounded-full bg-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.6)]"></div>
          <div>
            <h2 className="text-amber-400 font-semibold mb-1">Partially Degraded Service</h2>
            <p className="text-sm text-slate-300">
              We are currently experiencing delays with Email Automations. All other systems are 100% operational. Our engineering team is investigating.
            </p>
          </div>
        </div>

        {/* Systems List */}
        <div className="rounded-2xl bg-white/5 border border-white/10 backdrop-blur-md overflow-hidden">
          <div className="p-4 border-b border-white/10 bg-white/5">
            <h3 className="text-sm font-semibold text-slate-200">System Metrics</h3>
          </div>
          <div className="divide-y divide-white/10">
            {systems.map((sys, i) => (
              <div key={i} className="p-4 flex items-center justify-between">
                <span className="text-sm font-medium text-slate-200">{sys.name}</span>
                {sys.status === 'operational' ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-emerald-400 font-medium">Operational</span>
                    <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]"></div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-amber-400 font-medium">Degraded</span>
                    <div className="w-2 h-2 rounded-full bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]"></div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Past Incidents (Mock) */}
        <div className="mt-16">
          <h3 className="text-xl font-bold mb-6">Past Incidents</h3>
          <div className="border-l-2 border-white/10 pl-6 pb-6 relative">
            <div className="absolute w-3 h-3 bg-slate-400 rounded-full left-[-7px] top-1"></div>
            <h4 className="text-sm text-slate-400 mb-2">Oct 10, 2024</h4>
            <p className="text-slate-200 font-medium mb-1">MLS Data Sync Delay</p>
            <p className="text-sm text-slate-400">Resolved. Data sync providers experienced a 20 minute outage which delayed listing updates.</p>
          </div>
        </div>
      </main>
    </div>
  );
}
