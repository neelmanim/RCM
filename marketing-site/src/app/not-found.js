import Link from "next/link";
export default function NotFound() {
  return <main id="main-content" tabIndex={-1} className="wrap content-page article-page"><div className="bento-card"><span className="eyebrow">PAGE NOT FOUND</span><h1>We could not find that page.</h1><p>The address may have changed. Return to the homepage or browse the product guides.</p><div className="hero-actions"><Link className="btn btn-primary" href="/">Return home</Link><Link className="btn btn-secondary" href="/blog">Browse guides</Link></div></div></main>;
}
