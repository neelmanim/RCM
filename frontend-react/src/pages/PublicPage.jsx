export default function PublicPage() {
  return (
    <main>
      <h1>You are offline</h1>
      <p>Reconnect to the internet to open your workspace.</p>
      <button type="button" onClick={() => window.location.reload()}>Try again</button>
    </main>
  );
}
