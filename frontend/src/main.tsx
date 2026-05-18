import 'highlight.js/styles/github-dark.css';
import './style.css';
import { render } from 'solid-js/web';
import App from './App';

// Embedded mode: when LGTM is iframed by another tool (e.g. periscope),
// the host already provides project navigation and connection chrome.
// `?embedded=1` flags the body so style.css can hide the duplicated bits
// (.header-top, the in-app tab bar, the project palette). Set before
// render so there's no flash of full chrome on first paint.
const isEmbedded = new URLSearchParams(window.location.search).get('embedded') === '1';
if (isEmbedded) {
  document.body.classList.add('embedded');
  // Forward Escape to the parent window. When the iframe has focus the
  // host can't observe keystrokes directly — without this, ESC inside
  // the iframe never closes the modal that contains us.
  //
  // Skip forwarding when focus is on a text editor (textarea/input):
  // LGTM uses ESC there to cancel comments / clear searches, and the
  // user shouldn't lose their typing because the modal also closed.
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const tag = (document.activeElement?.tagName || '').toUpperCase();
    if (tag === 'TEXTAREA' || tag === 'INPUT') return;
    window.parent?.postMessage({ type: 'lgtm-embedded-escape' }, '*');
  });
}

// Track Cmd key for peek-definition underline hint
document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey) document.body.classList.add('cmd-held');
});
document.addEventListener('keyup', (e) => {
  if (!e.metaKey && !e.ctrlKey) document.body.classList.remove('cmd-held');
});
window.addEventListener('blur', () => {
  document.body.classList.remove('cmd-held');
});

render(() => <App />, document.getElementById('root')!);
