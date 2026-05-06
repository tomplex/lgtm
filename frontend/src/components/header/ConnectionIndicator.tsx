import { connectionState } from '../../state';

export default function ConnectionIndicator() {
  return (
    <span
      class="conn-dot"
      classList={{ alive: connectionState().alive, down: !connectionState().alive }}
      title={connectionState().alive ? 'Claude session connected' : 'No Claude session connected'}
      aria-label={connectionState().alive ? 'Claude connected' : 'Claude disconnected'}
    />
  );
}
