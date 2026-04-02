import { createSignal } from 'solid-js';

const [toastMsg, setToastMsg] = createSignal('');
const [toastVisible, setToastVisible] = createSignal(false);
let toastTimer: ReturnType<typeof setTimeout>;

export function showToast(msg: string, duration = 2500) {
  clearTimeout(toastTimer);
  setToastMsg(msg);
  setToastVisible(true);
  toastTimer = setTimeout(() => setToastVisible(false), duration);
}

export default function Toast() {
  return (
    <div class="toast" classList={{ show: toastVisible() }}>
      {toastMsg()}
    </div>
  );
}
