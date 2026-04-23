// frontend/src/components/walkthrough/EmptyState.tsx
export function EmptyState() {
  return (
    <div class="wt-empty">
      <p>No walkthrough generated yet.</p>
      <p class="wt-empty-hint">
        Run <code>/lgtm walkthrough</code> (or <code>/lgtm prepare</code> to also analyze) to build one.
      </p>
    </div>
  );
}
