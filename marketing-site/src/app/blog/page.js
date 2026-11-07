import Link from "next/link";
import { posts } from "./posts";

export const metadata = {
  title: "Engineering & Product Insights",
  description:
    "Architectural breakdowns, WebRTC media concepts, and engineering blueprints from building the Alternate CRM platform.",
  alternates: { canonical: "/blog" },
  openGraph: {
    title: "Engineering & Product Insights | Alternate CRM",
    description:
      "Architectural breakdowns, WebRTC media concepts, and engineering blueprints from building the Alternate CRM platform.",
    url: "/blog",
  },
};

export default function Blog() {
  return (
    <main id="main-content" tabIndex={-1} className="wrap content-page py-16">
      <div className="section-head text-center max-w-3xl mx-auto mb-16">
        <div className="hero-pill inline-flex mb-4">
          <span className="live-pulse" />
          <span>ENGINEERING & PRODUCT INSIGHTS</span>
        </div>
        <h1 style={{ fontSize: "clamp(36px, 5vw, 56px)", fontWeight: 900, letterSpacing: "-0.04em", margin: "0 0 16px" }}>
          The Conversation OS <span className="gradient-text">Chronicles</span>
        </h1>
        <p style={{ fontSize: "16px", color: "var(--text-secondary)", lineHeight: 1.6 }}>
          Architectural breakdowns, WebRTC media concepts, and engineering blueprints from building the Alternate CRM platform.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-16">
        {posts.map((post) => (
          <article
            className="bento-card group hover:border-indigo-500/50 transition-all duration-300 flex flex-col justify-between"
            key={post.slug}
            style={{ minHeight: "340px" }}
          >
            <div>
              <div className="flex items-center justify-between mb-4">
                <span className="card-badge" style={{ margin: 0 }}>
                  {post.category}
                </span>
                <span className="text-xs text-slate-500 font-mono">
                  {post.readTime}
                </span>
              </div>
              <h2 style={{ fontSize: "20px", fontWeight: 800, letterSpacing: "-0.02em", color: "#fff", marginBottom: "12px", lineHeight: 1.3 }}>
                <Link href={`/blog/${post.slug}`} className="hover:text-indigo-400 transition-colors">
                  {post.title}
                </Link>
              </h2>
              <p style={{ fontSize: "14px", color: "var(--text-secondary)", lineHeight: 1.6, margin: 0 }}>
                {post.excerpt}
              </p>
            </div>

            <div className="pt-4 border-t border-white/5 flex items-center justify-between text-xs font-bold text-lime-400 mt-6 group-hover:text-lime-300">
              <span className="text-slate-500 font-normal">{post.date}</span>
              <Link
                className="group-hover:translate-x-1 transition-transform flex items-center gap-1"
                href={`/blog/${post.slug}`}
                aria-label={`Read: ${post.title}`}
              >
                Read Technical Breakdown →
              </Link>
            </div>
          </article>
        ))}
      </div>
    </main>
  );
}
