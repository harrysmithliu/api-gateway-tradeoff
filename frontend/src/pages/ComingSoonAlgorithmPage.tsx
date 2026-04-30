type ComingSoonAlgorithmPageProps = {
  title: string;
};

export function ComingSoonAlgorithmPage({ title }: ComingSoonAlgorithmPageProps) {
  return (
    <main className="dashboard-shell">
      <section className="dashboard-header card">
        <p className="eyebrow">Reserved Tab</p>
        <h2>{title}</h2>
        <p className="meta">This algorithm tab is reserved for a future milestone and is not available in M2.</p>
      </section>
    </main>
  );
}
