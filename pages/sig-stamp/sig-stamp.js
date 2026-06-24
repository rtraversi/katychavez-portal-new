'use strict';

(async function SigStampPage() {

  // ── State ────────────────────────────────────────────────────────────────────

  let pdfDoc        = null;       // pdf.js PDFDocumentProxy
  let currentPage   = 1;
  let totalPages    = 1;
  let sourceType    = null;       // 'pdf' | 'image'
  let sourceFile    = null;       // original File object
  let sourcePdfBytes = null;      // ArrayBuffer of original PDF
  let sourceImageDataUrl = null;  // for image sources
  let sigDataUrl    = null;       // attorney signature blob URL
  let pdfScale      = 1.5;
  let rotation      = 0;          // 0 | 90 | 180 | 270 (CW degrees applied to source)

  // Overlay state (pixel coords relative to canvas top-left)
  let sigPos  = { x: 0, y: 0, w: 200, h: 80 };
  let datePos = { x: 0, y: 0 };
  let showDate = false;

  // ── DOM refs ─────────────────────────────────────────────────────────────────

  const dropZone         = document.getElementById('sig-drop-zone');
  const fileInput        = document.getElementById('sig-file-input');
  const chooseFileBtn    = document.getElementById('sig-choose-file-btn');
  const toolbar          = document.getElementById('sig-toolbar');
  const viewerWrap       = document.getElementById('sig-viewer-wrap');
  const docCanvas        = document.getElementById('sig-doc-canvas');
  const sigOverlay       = document.getElementById('sig-overlay');
  const sigOverlayImg    = document.getElementById('sig-overlay-img');
  const resizeHandle     = document.getElementById('sig-resize-handle');
  const dateOverlay      = document.getElementById('date-overlay');
  const dateText         = document.getElementById('date-text');
  const btnPrev          = document.getElementById('btn-prev-page');
  const btnNext          = document.getElementById('btn-next-page');
  const pageInfo         = document.getElementById('page-info');
  const btnRotate        = document.getElementById('btn-rotate');
  const btnSnapG28       = document.getElementById('btn-snap-g28');
  const chkDate          = document.getElementById('chk-date');
  const btnReset         = document.getElementById('btn-reset');
  const btnApply         = document.getElementById('btn-apply-download');
  const warningEl        = document.getElementById('sig-stamp-warning');
  const statusEl         = document.getElementById('sig-stamp-status');

  // ── Load attorney signature on mount ────────────────────────────────────────

  async function loadSignature() {
    try {
      const session = await Auth.getSession();
      const res = await fetch('/api/get-attorney-signature', {
        headers: { 'Authorization': `Bearer ${session.access_token}` },
      });
      if (res.status === 404) {
        warningEl.classList.remove('hidden');
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      sigDataUrl = URL.createObjectURL(blob);
      sigOverlayImg.src = sigDataUrl;
    } catch (err) {
      warningEl.classList.remove('hidden');
      console.error('[sig-stamp] signature load:', err);
    }
  }

  await loadSignature();

  // ── Set today's date ─────────────────────────────────────────────────────────

  (function setDate() {
    const now = new Date();
    dateText.textContent = `${now.getMonth() + 1}/${now.getDate()}/${now.getFullYear()}`;
  })();

  // ── Drop zone / file input ───────────────────────────────────────────────────

  chooseFileBtn.addEventListener('click', () => fileInput.click());

  dropZone.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
  });

  dropZone.addEventListener('dragover', e => {
    e.preventDefault();
    dropZone.style.borderColor = 'var(--color-primary)';
    dropZone.style.background  = 'var(--color-primary-bg,#eff6ff)';
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.style.borderColor = '';
    dropZone.style.background  = '';
  });

  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.style.borderColor = '';
    dropZone.style.background  = '';
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) handleFile(fileInput.files[0]);
  });

  // ── File handler ─────────────────────────────────────────────────────────────

  async function handleFile(file) {
    sourceFile = file;
    rotation   = 0;
    const ext  = file.name.split('.').pop().toLowerCase();
    const isPdf = file.type === 'application/pdf' || ext === 'pdf';

    setStatus('Loading…');

    try {
      if (isPdf) {
        sourcePdfBytes = await file.arrayBuffer();
        sourceType = 'pdf';
        const typedArray = new Uint8Array(sourcePdfBytes);
        pdfDoc = await pdfjsLib.getDocument({ data: typedArray }).promise;
        totalPages  = pdfDoc.numPages;
        currentPage = 1;
        await renderPdfPage(currentPage);
      } else {
        sourceType = 'image';
        pdfDoc     = null;
        totalPages = 1;
        currentPage = 1;
        sourceImageDataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload  = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        await renderImage();
      }

      showToolbar();
      setStatus('');
    } catch (err) {
      setStatus('Error loading file: ' + err.message, true);
      console.error('[sig-stamp] handleFile:', err);
    }
  }

  // ── Render PDF page ──────────────────────────────────────────────────────────

  async function renderPdfPage(pageNum) {
    const page    = await pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: pdfScale, rotation: 0 });
    const ctx      = docCanvas.getContext('2d');
    docCanvas.width  = viewport.width;
    docCanvas.height = viewport.height;
    await page.render({ canvasContext: ctx, viewport }).promise;
    pageInfo.textContent = `Page ${pageNum} of ${totalPages}`;
    updateOverlayBounds();
  }

  // ── Render image ─────────────────────────────────────────────────────────────

  async function renderImage() {
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload  = resolve;
      img.onerror = reject;
      img.src     = sourceImageDataUrl;
    });

    const ctx    = docCanvas.getContext('2d');
    const rotRad = (rotation * Math.PI) / 180;

    if (rotation === 0 || rotation === 180) {
      docCanvas.width  = img.naturalWidth;
      docCanvas.height = img.naturalHeight;
    } else {
      docCanvas.width  = img.naturalHeight;
      docCanvas.height = img.naturalWidth;
    }

    ctx.save();
    ctx.translate(docCanvas.width / 2, docCanvas.height / 2);
    ctx.rotate(rotRad);
    ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
    ctx.restore();

    pageInfo.textContent = 'Image (1 of 1)';
    updateOverlayBounds();
  }

  // ── Show toolbar + viewer ────────────────────────────────────────────────────

  function showToolbar() {
    toolbar.classList.remove('hidden');
    viewerWrap.classList.remove('hidden');

    // Position sig overlay at center initially, ~25% of canvas width
    const cw = docCanvas.width;
    const ch = docCanvas.height;
    sigPos.w  = Math.round(cw * 0.25);
    sigPos.h  = Math.round(sigPos.w * 0.4);
    sigPos.x  = Math.round((cw - sigPos.w) / 2);
    sigPos.y  = Math.round((ch - sigPos.h) / 2);
    applyOverlayPosition();

    datePos.x = Math.round(cw * 0.1);
    datePos.y = Math.round(ch * 0.5);
    applyDatePosition();
  }

  // ── Overlay positioning helpers ──────────────────────────────────────────────

  function updateOverlayBounds() {
    // Called after canvas resize — keep overlay clamped
    sigPos.x = clamp(sigPos.x, 0, docCanvas.width  - sigPos.w);
    sigPos.y = clamp(sigPos.y, 0, docCanvas.height - sigPos.h);
    applyOverlayPosition();
  }

  function applyOverlayPosition() {
    sigOverlay.style.left   = sigPos.x + 'px';
    sigOverlay.style.top    = sigPos.y + 'px';
    sigOverlay.style.width  = sigPos.w + 'px';
    sigOverlay.style.height = sigPos.h + 'px';
    sigOverlay.style.transform = 'none';
  }

  function applyDatePosition() {
    dateOverlay.style.left      = datePos.x + 'px';
    dateOverlay.style.top       = datePos.y + 'px';
    dateOverlay.style.transform = 'none';
  }

  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

  // ── Drag: signature overlay ──────────────────────────────────────────────────

  makeDraggable(sigOverlay, resizeHandle,
    () => ({ x: sigPos.x, y: sigPos.y, w: sigPos.w, h: sigPos.h }),
    (pos) => {
      sigPos.x = pos.x; sigPos.y = pos.y;
      sigPos.w = pos.w; sigPos.h = pos.h;
      applyOverlayPosition();
    }
  );

  // ── Drag: date overlay ───────────────────────────────────────────────────────

  makeDraggable(dateOverlay, null,
    () => ({ x: datePos.x, y: datePos.y }),
    (pos) => {
      datePos.x = pos.x; datePos.y = pos.y;
      applyDatePosition();
    }
  );

  // ── Generic draggable (move + optional resize) ───────────────────────────────

  function makeDraggable(el, handleEl, getState, setState) {
    let dragging = false;
    let resizing = false;
    let startX, startY, origState;

    function pointerStart(e, isResize) {
      e.stopPropagation();
      e.preventDefault();
      dragging = !isResize;
      resizing = isResize;
      startX   = e.clientX ?? e.touches[0].clientX;
      startY   = e.clientY ?? e.touches[0].clientY;
      origState = { ...getState() };

      document.addEventListener('mousemove', pointerMove);
      document.addEventListener('mouseup',   pointerEnd);
      document.addEventListener('touchmove', pointerMove, { passive: false });
      document.addEventListener('touchend',  pointerEnd);
    }

    function pointerMove(e) {
      e.preventDefault();
      const cx = e.clientX ?? e.touches[0].clientX;
      const cy = e.clientY ?? e.touches[0].clientY;
      const dx = cx - startX;
      const dy = cy - startY;
      const cw = docCanvas.width;
      const ch = docCanvas.height;

      if (dragging) {
        setState({
          ...origState,
          x: clamp(origState.x + dx, 0, cw  - (origState.w || 50)),
          y: clamp(origState.y + dy, 0, ch - (origState.h || 20)),
        });
      } else if (resizing) {
        const newW = Math.max(40, origState.w + dx);
        const newH = Math.max(20, origState.h + dy);
        setState({ ...origState, w: newW, h: newH });
      }
    }

    function pointerEnd() {
      dragging = resizing = false;
      document.removeEventListener('mousemove', pointerMove);
      document.removeEventListener('mouseup',   pointerEnd);
      document.removeEventListener('touchmove', pointerMove);
      document.removeEventListener('touchend',  pointerEnd);
    }

    el.addEventListener('mousedown',  e => { if (e.target !== handleEl) pointerStart(e, false); });
    el.addEventListener('touchstart', e => { if (e.target !== handleEl) pointerStart(e, false); }, { passive: false });
    if (handleEl) {
      handleEl.addEventListener('mousedown',  e => pointerStart(e, true));
      handleEl.addEventListener('touchstart', e => pointerStart(e, true), { passive: false });
    }
  }

  // ── Page navigation ──────────────────────────────────────────────────────────

  btnPrev.addEventListener('click', async () => {
    if (sourceType !== 'pdf' || currentPage <= 1) return;
    currentPage--;
    await renderPdfPage(currentPage);
  });

  btnNext.addEventListener('click', async () => {
    if (sourceType !== 'pdf' || currentPage >= totalPages) return;
    currentPage++;
    await renderPdfPage(currentPage);
  });

  // ── Rotate ───────────────────────────────────────────────────────────────────

  btnRotate.addEventListener('click', async () => {
    rotation = (rotation + 90) % 360;
    if (sourceType === 'pdf') {
      await renderPdfPage(currentPage);
    } else {
      await renderImage();
    }
  });

  // ── Snap to G-28 ─────────────────────────────────────────────────────────────

  btnSnapG28.addEventListener('click', () => {
    const cw = docCanvas.width;
    const ch = docCanvas.height;
    // G-28 Part 5 attorney signature line: ~72% from left, ~87% from top
    sigPos.w = Math.round(cw * 0.28);
    sigPos.h = Math.round(sigPos.w * 0.35);
    sigPos.x = Math.round(cw * 0.72 - sigPos.w / 2);
    sigPos.y = Math.round(ch * 0.87 - sigPos.h / 2);
    sigPos.x = clamp(sigPos.x, 0, cw - sigPos.w);
    sigPos.y = clamp(sigPos.y, 0, ch - sigPos.h);
    applyOverlayPosition();
  });

  // ── Date toggle ──────────────────────────────────────────────────────────────

  chkDate.addEventListener('change', () => {
    showDate = chkDate.checked;
    dateOverlay.style.display = showDate ? 'block' : 'none';
  });

  // ── Reset ────────────────────────────────────────────────────────────────────

  btnReset.addEventListener('click', () => {
    showToolbar();
  });

  // ── Apply & Download ─────────────────────────────────────────────────────────

  btnApply.addEventListener('click', async () => {
    if (!sigDataUrl) {
      Utils.toast('No attorney signature loaded. Upload one in Settings first.', 'error');
      return;
    }
    if (!sourceFile) return;

    btnApply.disabled    = true;
    btnApply.textContent = 'Processing…';
    setStatus('Building PDF…');

    try {
      await applyAndDownload();
      setStatus('');
    } catch (err) {
      setStatus('Error: ' + err.message, true);
      Utils.toast('Download failed: ' + err.message, 'error');
      console.error('[sig-stamp] apply:', err);
    } finally {
      btnApply.disabled    = false;
      btnApply.textContent = 'Apply & Download';
    }
  });

  async function applyAndDownload() {
    const { PDFDocument, rgb } = PDFLib;

    let pdfLibDoc;

    if (sourceType === 'pdf') {
      // Load original PDF bytes
      pdfLibDoc = await PDFDocument.load(sourcePdfBytes);
    } else {
      // Create new 1-page doc from image
      pdfLibDoc = await PDFDocument.create();
      const imgDataUrl = await getRotatedImageDataUrl();
      let embeddedImg;
      if (imgDataUrl.startsWith('data:image/png')) {
        const pngBytes = base64ToBytes(imgDataUrl.split(',')[1]);
        embeddedImg = await pdfLibDoc.embedPng(pngBytes);
      } else {
        const jpgBytes = base64ToBytes(imgDataUrl.split(',')[1]);
        embeddedImg = await pdfLibDoc.embedJpg(jpgBytes);
      }
      const page = pdfLibDoc.addPage([embeddedImg.width, embeddedImg.height]);
      page.drawImage(embeddedImg, { x: 0, y: 0, width: embeddedImg.width, height: embeddedImg.height });
    }

    // Apply rotation to all pages if it's a PDF
    if (sourceType === 'pdf') {
      const degrees = [0, 90, 180, 270][rotation / 90];
      if (degrees !== 0) {
        pdfLibDoc.getPages().forEach(p => {
          const current = p.getRotation().angle;
          p.setRotation({ type: 'degrees', angle: (current + degrees) % 360 });
        });
      }
    }

    // Get the target page
    const targetPage = pdfLibDoc.getPages()[currentPage - 1];
    const pageW = targetPage.getWidth();
    const pageH = targetPage.getHeight();
    const canW  = docCanvas.width;
    const canH  = docCanvas.height;

    // Embed signature PNG
    const sigResponse = await fetch(sigDataUrl);
    const sigBlob     = await sigResponse.blob();
    const sigBytes    = await sigBlob.arrayBuffer();
    const embeddedSig = await pdfLibDoc.embedPng(sigBytes);

    // Coordinate math: canvas → PDF
    const pdfSigX = (sigPos.x / canW) * pageW;
    const pdfSigW = (sigPos.w / canW) * pageW;
    const pdfSigH = (sigPos.h / canH) * pageH;
    // PDF y=0 is bottom-left; canvas y=0 is top-left
    const pdfSigY = pageH - (sigPos.y / canH) * pageH - pdfSigH;

    targetPage.drawImage(embeddedSig, {
      x:      pdfSigX,
      y:      pdfSigY,
      width:  pdfSigW,
      height: pdfSigH,
    });

    // Draw date if enabled
    if (showDate) {
      const helvetica = await pdfLibDoc.embedFont(PDFLib.StandardFonts.Helvetica);
      const fontSize  = Math.round((16 / canH) * pageH);
      const pdfDateX  = (datePos.x / canW) * pageW;
      const pdfDateY  = pageH - (datePos.y / canH) * pageH - fontSize;
      targetPage.drawText(dateText.textContent, {
        x:    pdfDateX,
        y:    pdfDateY,
        size: Math.max(6, fontSize),
        font: helvetica,
        color: rgb(0, 0, 0),
      });
    }

    // Save and download
    const pdfBytes = await pdfLibDoc.save();
    const blob     = new Blob([pdfBytes], { type: 'application/pdf' });
    const url      = URL.createObjectURL(blob);
    const a        = document.createElement('a');
    a.href         = url;
    a.download     = 'signed-document.pdf';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 2000);

    setStatus('Downloaded.');
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function base64ToBytes(b64) {
    const raw = atob(b64);
    const arr = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    return arr;
  }

  async function getRotatedImageDataUrl() {
    // Return current docCanvas content as a data URL (already rotated)
    return docCanvas.toDataURL('image/png');
  }

  function setStatus(msg, isError = false) {
    statusEl.textContent = msg;
    statusEl.style.color = isError ? 'var(--color-danger)' : 'var(--color-text-muted)';
  }

})();
