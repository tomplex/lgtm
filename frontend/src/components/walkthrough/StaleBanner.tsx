// frontend/src/components/walkthrough/StaleBanner.tsx
export function StaleBanner() {
  return (
    <div class="wt-stale-banner" role="status">
      Walkthrough out of date — diff has changed since generation. Run <code>/lgtm walkthrough</code> to refresh.
    </div>
  );
}
