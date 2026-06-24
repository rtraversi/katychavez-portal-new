'use strict';

(async function SignatureSettingsPage() {

  // ── DOM refs ─────────────────────────────────────────────────────────────────

  const sigCurrentImg     = document.getElementById('sig-current-img');
  const sigNoneText       = document.getElementById('sig-none-text');
  const sigReadOnlyMsg    = document.getElementById('sig-read-only-msg');
  const sigUploadSection  = document.getElementById('sig-upload-section');
  const sigFileInput      = document.getElementById('sig-file-input');
  const sigThresholdWrap  = document.getElementById('sig-threshold-wrap');
  const sigThresholdSlider = document.getElementById('sig-threshold-slider');
  const sigThresholdLabel = document.getElementById('sig-threshold-label');
  const sigCanvasWrap     = document.getElementById('sig-canvas-wrap');
  const sigPreviewCanvas  = document.getElementById('sig-preview-canvas');
  const sigOffscreen      = document.getElementById('sig-offscreen-canvas');
  const sigUploadBtn      = document.getElementById('sig-upload-btn');
  const sigStatus         = document.getElementById('sig-status');

  let currentImageBitmap = null;

  // ── Load current signature ───────────────────────────────────────────────────

  async function loadCurrentSignature() {
    try {
      const session = await Auth.getSession();
      const res = await fetch('/api/get-attorney-signature', {
        headers: { 'Authorization': `Bearer ${session.access_token}` },
      });

      if (res.status === 404) {
        sigNoneText.textContent = 'No signature uploaded yet';
        return;
      }

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      sigCurrentImg.src = url;
      sigCurrentImg.style.display = 'block';
      sigNoneText.style.display   = 'none';
    } catch (err) {
      sigNoneText.textContent = 'Could not load signature';
      console.error('[signature-settings] load error:', err);
    }
  }

  // ── Role check ───────────────────────────────────────────────────────────────

  async function checkRole() {
    const profile = await Auth.getProfile();
    const roleName = profile?.role?.name || profile?.roles?.name;
    const isOwner  = roleName === 'Owner';

    if (isOwner) {
      sigUploadSection.classList.remove('hidden');
    } else {
      sigReadOnlyMsg.classList.remove('hidden');
    }
  }

  // ── Background removal ───────────────────────────────────────────────────────

  function applyThreshold(threshold) {
    if (!currentImageBitmap) return;

    const offCtx = sigOffscreen.getContext('2d');
    sigOffscreen.width  = currentImageBitmap.width;
    sigOffscreen.height = currentImageBitmap.height;
    offCtx.drawImage(currentImageBitmap, 0, 0);

    const imgData = offCtx.getImageData(0, 0, sigOffscreen.width, sigOffscreen.height);
    const d = imgData.data;

    for (let i = 0; i < d.length; i += 4) {
      const avg = (d[i] + d[i + 1] + d[i + 2]) / 3;
      if (avg > threshold) {
        // Background pixel → transparent
        d[i + 3] = 0;
      } else {
        // Ink pixel → solid black
        d[i]     = 0;
        d[i + 1] = 0;
        d[i + 2] = 0;
        d[i + 3] = 255;
      }
    }

    // Render to preview canvas (scaled to fit)
    const maxW = 320;
    const maxH = 120;
    const scale = Math.min(maxW / sigOffscreen.width, maxH / sigOffscreen.height, 1);
    sigPreviewCanvas.width  = Math.round(sigOffscreen.width  * scale);
    sigPreviewCanvas.height = Math.round(sigOffscreen.height * scale);

    const previewCtx = sigPreviewCanvas.getContext('2d');
    previewCtx.clearRect(0, 0, sigPreviewCanvas.width, sigPreviewCanvas.height);

    // Put processed image to offscreen and draw scaled
    offCtx.putImageData(imgData, 0, 0);
    previewCtx.drawImage(sigOffscreen, 0, 0, sigPreviewCanvas.width, sigPreviewCanvas.height);
  }

  // ── File input handler ───────────────────────────────────────────────────────

  sigFileInput.addEventListener('change', async () => {
    const file = sigFileInput.files[0];
    if (!file) return;

    try {
      currentImageBitmap = await createImageBitmap(file);
    } catch {
      Utils.toast('Could not read image. Please choose a PNG or JPEG.', 'error');
      return;
    }

    const threshold = parseInt(sigThresholdSlider.value, 10);
    applyThreshold(threshold);

    sigThresholdWrap.classList.remove('hidden');
    sigCanvasWrap.classList.remove('hidden');
    sigUploadBtn.disabled = false;
    setStatus('');
  });

  // ── Threshold slider ─────────────────────────────────────────────────────────

  sigThresholdSlider.addEventListener('input', () => {
    const threshold = parseInt(sigThresholdSlider.value, 10);
    sigThresholdLabel.textContent = threshold;
    applyThreshold(threshold);
  });

  // ── Status helper ────────────────────────────────────────────────────────────

  function setStatus(msg, isError = false) {
    sigStatus.textContent = msg;
    sigStatus.style.color = isError ? 'var(--color-danger)' : 'var(--color-success,#15803d)';
  }

  // ── Upload handler ───────────────────────────────────────────────────────────

  sigUploadBtn.addEventListener('click', async () => {
    if (!currentImageBitmap) return;

    sigUploadBtn.disabled    = true;
    sigUploadBtn.textContent = 'Uploading…';
    setStatus('');

    try {
      // Read processed canvas as PNG blob → base64
      const blob = await new Promise(resolve =>
        sigPreviewCanvas.toBlob(resolve, 'image/png')
      );
      // Actually use the full-resolution processed offscreen canvas
      const fullBlob = await new Promise(resolve =>
        sigOffscreen.toBlob(resolve, 'image/png')
      );

      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload  = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(fullBlob);
      });

      const session = await Auth.getSession();
      const res = await fetch('/api/save-attorney-signature', {
        method:  'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({ image_base64: base64 }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');

      setStatus('Signature saved successfully.');
      Utils.toast('Attorney signature updated.', 'success');

      // Refresh the preview
      await loadCurrentSignature();

    } catch (err) {
      setStatus(err.message || 'Upload failed.', true);
      Utils.toast(err.message || 'Upload failed.', 'error');
    } finally {
      sigUploadBtn.disabled    = false;
      sigUploadBtn.textContent = 'Upload Signature';
    }
  });

  // ── Init ─────────────────────────────────────────────────────────────────────

  await Promise.all([loadCurrentSignature(), checkRole()]);

})();
