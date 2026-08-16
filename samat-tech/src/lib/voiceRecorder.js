import { el } from './dom.js';

// یادداشت صوتی: وقتی دست‌کش دستشونه یا عجله دارن، ضبط صدا سریع‌تر از تایپه. عمداً به‌جای
// تبدیل زنده‌ی گفتار به متن (Web Speech API) از ضبط خام صدا استفاده شده — چون پشتیبانی
// SpeechRecognition خصوصاً در سافاری iOS ناپایدار و ناقص است؛ ضبط صدا با MediaRecorder در همه‌ی
// مرورگرهای امروزی (از جمله iOS 14.3+) به‌طور یکسان کار می‌کند.

export function voiceRecordingSupported() {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
}

function pickMimeType() {
  const candidates = ['audio/webm', 'audio/mp4', 'audio/ogg'];
  return candidates.find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';
}

/**
 * یک ویجت ضبط صدا داخل container می‌سازد. با onChange(blob|null) هر بار که یادداشت صوتی عوض شود
 * (ضبط جدید، یا حذف) خبر می‌دهد.
 */
export function mountVoiceRecorder(container, onChange) {
  if (!voiceRecordingSupported()) return;
  let mediaRecorder = null;
  let chunks = [];
  let recordedBlob = null;
  let stream = null;
  let startedAt = 0;
  let timerInterval = null;

  const recordBtn = el('button', { class: 'btn-sm', style: 'background:#e3f2fd;color:#1565c0' }, '🎙️ ضبط یادداشت صوتی');
  const stopBtn = el('button', { class: 'btn-sm', style: 'background:var(--rust-100);color:var(--rust-700);display:none' }, '⏹ توقف');
  const timerLabel = el('span', { style: 'font-size:var(--text-xs);color:var(--stone-600);margin-right:8px' });
  const playbackBox = el('div', { style: 'margin-top:8px;display:none' });

  function reset() {
    recordedBlob = null;
    playbackBox.innerHTML = '';
    playbackBox.style.display = 'none';
    recordBtn.style.display = '';
    onChange(null);
  }

  recordBtn.addEventListener('click', async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      // eslint-disable-next-line no-alert
      window.alert(`دسترسی به میکروفون ممکن نشد: ${err.message}`);
      return;
    }
    chunks = [];
    const mimeType = pickMimeType();
    mediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    mediaRecorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    mediaRecorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      clearInterval(timerInterval);
      recordedBlob = new Blob(chunks, { type: mediaRecorder.mimeType || 'audio/webm' });
      playbackBox.innerHTML = '';
      playbackBox.style.display = 'block';
      const audioEl = el('audio', { controls: true, src: URL.createObjectURL(recordedBlob), style: 'width:100%;height:36px' });
      const discardBtn = el('button', { class: 'btn-sm', style: 'background:var(--stone-100);color:var(--ink-700);margin-top:6px', onclick: reset }, '🗑 حذف و ضبط دوباره');
      playbackBox.append(audioEl, el('div', {}, discardBtn));
      recordBtn.style.display = 'none';
      stopBtn.style.display = 'none';
      timerLabel.textContent = '';
      onChange(recordedBlob);
    };
    mediaRecorder.start();
    startedAt = Date.now();
    recordBtn.style.display = 'none';
    stopBtn.style.display = '';
    timerInterval = setInterval(() => {
      const s = Math.floor((Date.now() - startedAt) / 1000);
      timerLabel.textContent = `⏺ ${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    }, 500);
  });

  stopBtn.addEventListener('click', () => { if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop(); });

  container.append(el('div', { style: 'display:flex;align-items:center;gap:8px' }, [recordBtn, stopBtn, timerLabel]), playbackBox);
}
