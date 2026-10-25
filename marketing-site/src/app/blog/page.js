export default function Blog() {
  const posts = [
    {
      title: "Why We Killed the Traditional CRM: Introducing Conversation OS",
      category: "Architecture",
      date: "Oct 24, 2026",
      readTime: "5 min read",
      excerpt: "Traditional CRMs are static databases where deals go to die. Here is why we built an active Conversation OS with real-time speech intelligence and autonomous pipeline sync.",
      tag: "Product Vision"
    },
    {
      title: "Under the Hood: Sub-200ms WebRTC Power Dialer & Audio Cadences",
      category: "Engineering",
      date: "Oct 18, 2026",
      readTime: "8 min read",
      excerpt: "How our distributed edge nodes eliminate jitter, power multi-line parallel dialing, and stream audio directly to the Whisper conversation transcription pipeline.",
      tag: "Deep Dive"
    },
    {
      title: "Replacing 7 Fragmented Sales Point Solutions with One Extensible Engine",
      category: "RevOps",
      date: "Oct 10, 2026",
      readTime: "6 min read",
      excerpt: "Sales reps spend 68% of their time clicking between dialers, email sequencers, Salesforce tabs, and meeting notetakers. Here is how dogfooding cut rep overhead in half.",
      tag: "Case Study"
    }
  ];

  return (
    <div className="min-h-screen bg-[#080b0d] text-[#f4f5f0] relative overflow-hidden font-sans selection:bg-[#d3fa76] selection:text-[#080b0d]">
      {/* Background Ambient Glows */}
      <div className="absolute top-[-100px] left-1/2 -translate-x-1/2 w-[700px] h-[400px] bg-[#d3fa76]/10 rounded-full blur-[140px] pointer-events-none" />
      <div className="absolute top-[400px] right-[-100px] w-[500px] h-[500px] bg-[#4ade80]/5 rounded-full blur-[160px] pointer-events-none" />

      {/* Navigation */}
      <header className="relative z-10 border-b border-white/10 bg-[#080b0d]/80 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <a href="/" className="flex items-center gap-2.5 text-xl font-bold tracking-tight text-white hover:opacity-90 transition-opacity">
            <span className="text-[#d3fa76] text-xl font-black">✳</span>
            <span>
              alternate<span className="text-[#8899a6] font-normal">crm</span>
            </span>
          </a>

          <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-[#9ba9a5]">
            <a href="/#platform" className="hover:text-white transition-colors">The OS</a>
            <a href="/#outcomes" className="hover:text-white transition-colors">Why AlternateCRM</a>
            <a href="/#how" className="hover:text-white transition-colors">How it works</a>
            <a href="/blog" className="text-white font-semibold">Blog</a>
            <a href="/status" className="hover:text-white transition-colors">Status</a>
          </nav>

          <div className="flex items-center gap-3">
            <a
              href="/sandbox.html"
              target="_blank"
              rel="noreferrer"
              className="px-4 py-2 rounded-xl text-xs font-semibold bg-white/5 border border-white/10 text-white hover:bg-white/10 transition-all flex items-center gap-1.5"
            >
              Try Sandbox <span>⚡</span>
            </a>
            <a
              href="/#top"
              className="px-4 py-2 rounded-xl text-xs font-bold bg-[#d3fa76] text-[#080b0d] hover:bg-[#bfe660] transition-all shadow-[0_0_20px_rgba(211,250,118,0.25)]"
            >
              Get early access ↗
            </a>
          </div>
        </div>
      </header>

      {/* Hero Header */}
      <main className="relative z-10 max-w-6xl mx-auto px-6 pt-16 pb-24">
        <div className="text-center max-w-3xl mx-auto mb-16">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold bg-[#d3fa76]/10 border border-[#d3fa76]/20 text-[#d3fa76] mb-6">
            <span>Engineering & Product Insights</span>
          </div>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black tracking-tight mb-6 leading-tight">
            The Conversation OS <span className="text-[#d3fa76]">Chronicles</span>
          </h1>
          <p className="text-lg text-[#9ba9a5] leading-relaxed">
            Architectural breakdowns, engineering retrospectives, and dogfooding lessons from building the high-velocity revenue platform for modern sales teams.
          </p>
        </div>

        {/* Featured Post Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {posts.map((post, i) => (
            <article
              key={i}
              className="group relative rounded-3xl bg-[#111619] border border-white/10 p-7 hover:border-[#d3fa76]/40 transition-all duration-300 flex flex-col justify-between hover:shadow-[0_10px_30px_rgba(0,0,0,0.5)]"
            >
              <div>
                <div className="flex items-center justify-between mb-5">
                  <span className="text-xs font-bold text-[#d3fa76] bg-[#d3fa76]/10 border border-[#d3fa76]/20 px-3 py-1 rounded-full">
                    {post.category}
                  </span>
                  <div className="flex items-center gap-2 text-xs text-[#7a8a84]">
                    <span>{post.date}</span>
                    <span>•</span>
                    <span>{post.readTime}</span>
                  </div>
                </div>

                <h2 className="text-xl font-bold mb-3 text-white group-hover:text-[#d3fa76] transition-colors leading-snug">
                  {post.title}
                </h2>

                <p className="text-sm text-[#9ba9a5] leading-relaxed mb-6">
                  {post.excerpt}
                </p>
              </div>

              <div className="pt-4 border-t border-white/5 flex items-center justify-between text-xs font-semibold text-[#d3fa76]">
                <span className="text-[#7a8a84] font-normal">{post.tag}</span>
                <span className="group-hover:translate-x-1 transition-transform inline-flex items-center gap-1">
                  Read Analysis &rarr;
                </span>
              </div>
            </article>
          ))}
        </div>

        {/* Dogfooding Inbound CTA Box */}
        <div className="mt-20 p-10 rounded-3xl bg-gradient-to-br from-[#111619] to-[#151c20] border border-white/10 text-center relative overflow-hidden">
          <div className="relative z-10 max-w-xl mx-auto">
            <h3 className="text-2xl sm:text-3xl font-extrabold mb-3 text-white">
              Experience Conversation OS in action
            </h3>
            <p className="text-sm text-[#9ba9a5] mb-6">
              Join leading B2B revenue organizations scaling pipeline velocity without tool sprawl.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <a
                href="/sandbox.html"
                target="_blank"
                rel="noreferrer"
                className="w-full sm:w-auto px-6 py-3 rounded-xl text-sm font-semibold bg-white/5 border border-white/15 text-white hover:bg-white/10 transition-all text-center"
              >
                Launch Live Sandbox ⚡
              </a>
              <a
                href="/#top"
                className="w-full sm:w-auto px-6 py-3 rounded-xl text-sm font-bold bg-[#d3fa76] text-[#080b0d] hover:bg-[#bfe660] transition-all text-center shadow-[0_0_25px_rgba(211,250,118,0.3)]"
              >
                Get Priority Access ↗
              </a>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
