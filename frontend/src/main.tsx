import 'highlight.js/styles/github-dark.css';
import './style.css';
import { render } from 'solid-js/web';
import App from './App';

// Embedded mode: when LGTM is iframed by another tool (e.g. periscope),
// the host already provides project navigation and connection chrome.
// `?embedded=1` flags the body so style.css can hide the duplicated bits
// (.header-top, the in-app tab bar, the project palette). Set before
// render so there's no flash of full chrome on first paint.
if (new URLSearchParams(window.location.search).get('embedded') === '1') {
  document.body.classList.add('embedded');
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
