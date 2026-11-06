import Link from "next/link";
import { notFound } from "next/navigation";
import { posts } from "../posts";
import { SANDBOX_URL } from "../../../components/siteLinks";

export function generateStaticParams() {
  return posts.map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const post = posts.find((item) => item.slug === slug);
  return post
    ? {
        title: post.title,
        description: post.excerpt,
        alternates: { canonical: `/blog/${post.slug}` },
        openGraph: {
          title: `${post.title} | Alternate CRM`,
          description: post.excerpt,
          url: `/blog/${post.slug}`,
          type: "article",
        },
      }
    : { title: "Article Not Found" };
}

export default async function Article({ params }) {
  const { slug } = await params;
  const post = posts.find((item) => item.slug === slug);
  if (!post) notFound();

  return (
    <main id="main-content" tabIndex={-1} className="wrap content-page article-page py-16" style={{ maxWidth: "820px" }}>
      <Link className="text-link inline-flex items-center gap-1.5 mb-8 text-xs font-bold text-slate-400 hover:text-white transition-colors" href="/blog">
        ← Back to all insights
      </Link>

      <article className="space-y-8">
        <header className="space-y-4">
          <div className="flex items-center gap-3">
            <span className="card-badge" style={{ margin: 0 }}>
              {post.category}
            </span>
            <span style={{ fontSize: "12px", color: "var(--text-muted)", fontFamily: "monospace" }}>
              {post.date} • {post.readTime}
            </span>
          </div>

          <h1
            style={{
              fontSize: "clamp(28px, 4.5vw, 44px)",
              fontWeight: 900,
              letterSpacing: "-0.03em",
              color: "#fff",
              lineHeight: 1.2,
              margin: 0,
            }}
          >
            {post.title}
          </h1>

          <p
            style={{
              fontSize: "17px",
              color: "var(--lime)",
              lineHeight: 1.6,
              fontWeight: 600,
              borderLeft: "3px solid var(--lime)",
              paddingLeft: "16px",
              margin: "24px 0 0",
            }}
          >
            {post.excerpt}
          </p>
        </header>

        <div className="space-y-8 pt-4">
          {post.sections.map(([heading, body]) => (
            <section key={heading} className="space-y-3">
              <h2
                style={{
                  fontSize: "20px",
                  fontWeight: 800,
                  color: "#fff",
                  letterSpacing: "-0.02em",
                  margin: "0 0 10px",
                }}
              >
                {heading}
              </h2>
              <p
                style={{
                  fontSize: "15px",
                  color: "var(--text-secondary)",
                  lineHeight: 1.75,
                  margin: 0,
                }}
              >
                {body}
              </p>
            </section>
          ))}
        </div>
      </article>

      {/* CTA Box */}
      <div
        style={{
          marginTop: "48px",
          padding: "28px",
          borderRadius: "16px",
          background: "rgba(99, 102, 241, 0.08)",
          border: "1px solid rgba(99, 102, 241, 0.25)",
          display: "flex",
          flexDirection: "column",
          gap: "16px",
        }}
      >
        <div>
          <h3 style={{ fontSize: "17px", fontWeight: 800, color: "#fff", margin: "0 0 6px" }}>
            Experience Conversation OS in action
          </h3>
          <p style={{ fontSize: "14px", color: "var(--text-secondary)", margin: 0 }}>
            Browse sample leads, move deals through the pipeline, and explore the interactive sales workspace with zero login required.
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <a
            className="btn btn-secondary"
            href={SANDBOX_URL}
            style={{ fontSize: "14px", padding: "10px 20px" }}
          >
            ⚡ Launch Live Demo
          </a>
          <Link
            className="btn btn-primary"
            href="/?request-access=1"
            scroll={false}
            style={{ fontSize: "14px", padding: "10px 20px" }}
          >
            Request Early Access ↗
          </Link>
        </div>
      </div>
    </main>
  );
}
