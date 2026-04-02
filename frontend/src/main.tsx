import 'highlight.js/styles/github-dark.css';
import './style.css';
import { render } from 'solid-js/web';
import App from './App';

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
