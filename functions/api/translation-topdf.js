// translation-topdf.js — converts a DOCX (base64) to PDF via iLoveAPI.
// POST { docx_base64, filename? }
// Returns { pdf_base64, filename }
// Requires env var: ILOVEPDF_PUBLIC_KEY

import { verifyAuth, json } from './_helpers.js';

async function getToken(ilovepdfKey) {
  const res = await fetch('https://api.ilovepdf.com/v1/auth', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ public_key: ilovepdfKey }),
  });
  if (!res.ok) throw new Error(`iLoveAPI auth failed: ${res.status} ${await res.text()}`);
  const { token } = await res.json();
  return token;
}

async function startTask(token) {
  const res = await fetch('https://api.ilovepdf.com/v1/start/officepdf', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`iLoveAPI start failed: ${res.status}`);
  const { server, task } = await res.json();
  return { server, task };
}

async function uploadFile(server, token, task, buffer, filename) {
  const form = new FormData();
  form.append('task', task);
  form.append('file',
    new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    }),
    filename
  );
  const res = await fetch(`https://${server}/v1/upload`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}` },
    body:    form,
  });
  if (!res.ok) throw new Error(`iLoveAPI upload failed: ${res.status} ${await res.text()}`);
  const { server_filename } = await res.json();
  return server_filename;
}

async function processTask(server, token, task, serverFilename, filename) {
  const res = await fetch(`https://${server}/v1/process`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      task,
      tool:  'officepdf',
      files: [{ server_filename: serverFilename, filename }],
    }),
  });
  if (!res.ok) throw new Error(`iLoveAPI process failed: ${res.status} ${await res.text()}`);
}

async function downloadPdf(server, token, task) {
  const res = await fetch(`https://${server}/v1/download/${task}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`iLoveAPI download failed: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const auth = await verifyAuth(request, env, 'write', 'translation');
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });

  if (!env.ILOVEPDF_PUBLIC_KEY) return json(503, { error: 'PDF conversion not configured' });

  let body;
  try { body = await request.json(); }
  catch { return json(400, { error: 'Invalid JSON' }); }

  const { docx_base64, filename = 'document.docx' } = body;
  if (!docx_base64) return json(400, { error: 'docx_base64 required' });

  try {
    const raw    = atob(docx_base64);
    const bytes  = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);

    const baseName    = (filename || 'document').replace(/\.[^.]+$/, '');
    const docxFilename = baseName + '.docx';
    const pdfFilename  = baseName + '.pdf';

    const token          = await getToken(env.ILOVEPDF_PUBLIC_KEY);
    const { server, task }  = await startTask(token);
    const serverFilename = await uploadFile(server, token, task, bytes, docxFilename);
    await processTask(server, token, task, serverFilename, docxFilename);
    const pdfBytes       = await downloadPdf(server, token, task);

    // Encode PDF bytes to base64
    let binary = '';
    for (let i = 0; i < pdfBytes.length; i++) binary += String.fromCharCode(pdfBytes[i]);
    const pdf_base64 = btoa(binary);

    return json(200, { pdf_base64, filename: pdfFilename });

  } catch (err) {
    console.error('[translation-topdf] error:', err.message);
    return json(500, { error: err.message });
  }
}
