export default function Home() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-50 relative overflow-hidden font-sans">
      {/* Background gradients */}
      <div className="absolute top-[-20%] left-[-10%] w-[500px] h-[500px] bg-blue-600/30 rounded-full blur-[120px]" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[600px] h-[600px] bg-purple-600/30 rounded-full blur-[120px]" />
      
      {/* Navbar */}
      <nav className="relative z-10 flex items-center justify-between px-8 py-6 max-w-7xl mx-auto">
        <div className="text-2xl font-bold tracking-tighter bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
          RCM
        </div>
        <div className="hidden md:flex gap-8 text-sm font-medium text-slate-300">
          <a href="#features" className="hover:text-white transition-colors">Features</a>
          <a href="/blog" className="hover:text-white transition-colors">Blog</a>
          <a href="/status" className="hover:text-white transition-colors">Status</a>
        </div>
        <button className="px-5 py-2.5 text-sm font-medium rounded-full bg-white/10 border border-white/20 backdrop-blur-md hover:bg-white/20 transition-all">
          Get Started
        </button>
      </nav>

      {/* Hero Section */}
      <main className="relative z-10 flex flex-col items-center justify-center pt-32 pb-24 px-6 text-center max-w-5xl mx-auto">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10 backdrop-blur-sm text-xs font-medium text-slate-300 mb-8">
          <span className="flex h-2 w-2 rounded-full bg-blue-500"></span>
          Now available for Real Estate & Insurance
        </div>
        
        <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight mb-8 leading-tight">
          The ultimate CRM for <br/>
          <span className="bg-gradient-to-r from-blue-400 via-indigo-400 to-purple-400 bg-clip-text text-transparent">
            top-producing agents
          </span>
        </h1>
        
        <p className="text-lg md:text-xl text-slate-400 max-w-2xl mb-12 leading-relaxed">
          Close more deals, manage your pipeline, and automate your follow-ups with a stunning platform built exclusively for Real Estate and Insurance brokerages.
        </p>

        <div className="flex flex-col sm:flex-row gap-4">
          <button className="px-8 py-4 rounded-full bg-blue-600 hover:bg-blue-700 text-white font-semibold transition-all shadow-[0_0_40px_-10px_rgba(37,99,235,0.5)]">
            Start Free Trial
          </button>
          <button className="px-8 py-4 rounded-full bg-white/5 border border-white/10 backdrop-blur-md hover:bg-white/10 text-white font-semibold transition-all">
            Book a Demo
          </button>
        </div>

        {/* Dashboard Preview (Glassmorphism) */}
        <div className="w-full max-w-4xl mt-24 p-2 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-2xl shadow-2xl relative">
          <div className="absolute inset-0 bg-gradient-to-b from-white/10 to-transparent rounded-2xl pointer-events-none" />
          <div className="w-full h-8 flex items-center px-4 border-b border-white/10">
            <div className="flex gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full bg-red-400/80"></div>
              <div className="w-2.5 h-2.5 rounded-full bg-amber-400/80"></div>
              <div className="w-2.5 h-2.5 rounded-full bg-green-400/80"></div>
            </div>
          </div>
          <div className="h-[400px] w-full rounded-b-xl bg-slate-900/50 p-8 flex flex-col gap-6">
            <div className="flex justify-between items-center">
              <div className="h-6 w-32 bg-white/10 rounded-md"></div>
              <div className="h-8 w-24 bg-blue-500/20 text-blue-400 text-xs font-semibold flex items-center justify-center rounded-lg border border-blue-500/30">
                +14% this week
              </div>
            </div>
            <div className="grid grid-cols-3 gap-6">
              {[1,2,3].map(i => (
                <div key={i} className="h-32 bg-white/5 rounded-xl border border-white/5 p-4 flex flex-col justify-end">
                  <div className="h-4 w-1/2 bg-white/10 rounded mb-2"></div>
                  <div className="h-8 w-3/4 bg-white/20 rounded"></div>
                </div>
              ))}
            </div>
            <div className="flex-1 bg-white/5 rounded-xl border border-white/5 mt-2"></div>
          </div>
        </div>
      </main>
    </div>
  );
}
