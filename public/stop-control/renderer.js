const { ipcRenderer } = require('electron');

const timeEl = document.getElementById('time');
const stopBtn = document.getElementById('stop');

// Count up from when this control appears (which is the moment recording starts).
const startedAt = Date.now();

function formatElapsed(totalSeconds) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function tick() {
    const elapsed = Math.floor((Date.now() - startedAt) / 1000);
    timeEl.textContent = formatElapsed(elapsed);
}

tick();
setInterval(tick, 500);

stopBtn.addEventListener('click', () => {
    // Same channel the (hidden) recorder window uses; main runs stopRecording().
    ipcRenderer.send('recording:stop');
});
