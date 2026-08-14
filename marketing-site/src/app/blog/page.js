export default function Blog() {
  const posts = [
    {
      title: "10 Strategies to Close More Real Estate Deals in 2024",
      category: "Real Estate",
      date: "Oct 12, 2024",
      excerpt: "Discover the top strategies top-producing agents are using to maximize their pipelines and close deals faster.",
    },
    {
      title: "Automating Insurance Follow-ups with RCM",
      category: "Insurance",
      date: "Oct 05, 2024",
      excerpt: "Learn how setting up automated workflows can save you 10+ hours a week while improving client retention.",
    },
    {
      title: "Why Modern Brokerages Need a Dedicated CRM",
      category: "Industry",
      date: "Sep 28, 2024",
      excerpt: "Generic CRMs are holding back specialized brokerages. Here's why a tailored solution is critical for growth.",
    }
  ];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50 relative overflow-hidden font-sans">
      <div className="absolute top-[-10%] right-[-10%] w-[500px] h-[500px] bg-emerald-600/20 rounded-full blur-[120px]" />
      
      <nav className="relative z-10 flex items-center justify-between px-8 py-6 max-w-7xl mx-auto border-b border-white/10">
        <a href="/" className="text-2xl font-bold tracking-tighter bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
          RCM
        </a>
        <div className="hidden md:flex gap-8 text-sm font-medium text-slate-300">
          <a href="/" className="hover:text-white transition-colors">Home</a>
          <a href="/blog" className="text-white">Blog</a>
          <a href="/status" className="hover:text-white transition-colors">Status</a>
        </div>
      </nav>

      <main className="relative z-10 max-w-5xl mx-auto px-6 pt-20 pb-24">
        <div className="text-center mb-16">
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight mb-6">
            RCM <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-blue-400">Insights</span>
          </h1>
          <p className="text-lg text-slate-400 max-w-2xl mx-auto">
            The latest news, tips, and strategies for Real Estate and Insurance professionals.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {posts.map((post, i) => (
            <article key={i} className="group relative rounded-2xl bg-white/5 border border-white/10 backdrop-blur-md p-6 hover:bg-white/10 transition-all cursor-pointer overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-b from-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
              <div className="relative z-10">
                <div className="flex items-center justify-between mb-4">
                  <span className="text-xs font-semibold text-blue-400 bg-blue-400/10 px-2.5 py-1 rounded-full">
                    {post.category}
                  </span>
                  <span className="text-xs text-slate-500">{post.date}</span>
                </div>
                <h2 className="text-xl font-bold mb-3 text-slate-200 group-hover:text-white transition-colors leading-tight">
                  {post.title}
                </h2>
                <p className="text-sm text-slate-400 leading-relaxed">
                  {post.excerpt}
                </p>
                <div className="mt-6 flex items-center text-sm font-medium text-blue-400 group-hover:text-blue-300 transition-colors">
                  Read Article &rarr;
                </div>
              </div>
            </article>
          ))}
        </div>
      </main>
    </div>
  );
}
