// functions/utils/compress-pdf.js — ESM port from Katy's Netlify util.
// Compresses PDFs >2MB via iLoveAPI before sending to Claude.
// Pass ilovepdfKey explicitly (env.ILOVEPDF_PUBLIC_KEY from the calling Worker).

const COMPRESS_THRESHOLD = 2 * 1024 * 1024; // 2MB

async function getToken(ilovepdfKey) {
  const res = await fetch('https://api.ilovepdf.com/v1/auth', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ public_key: ilovepdfKey }),
  });
  if (!res.ok) throw new Error(`iLoveAPI auth failed: ${res.status}`);
  const { token } = await res.json();
  return token;
}

async function startTask(token) {
  const res = await fetch('https://api.ilovepdf.com/v1/start/compress', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`iLoveAPI start failed: ${res.status}`);
  const { server, task } = await res.json();
  return { server, task };
}

async function uploadFile(server, token, task, buffer) {
  const form = new FormData();
  form.append('task', task);
  form.append('file', new Blob([buffer], { type: 'application/pdf' }), 'document.pdf');
  const res = await fetch(`https://${server}/v1/upload`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}` },
    body:    form,
  });
  if (!res.ok) throw new Error(`iLoveAPI upload failed: ${res.status}`);
  const { server_filename } = await res.json();
  return server_filename;
}

async function processTask(server, token, task, serverFilename) {
  const res = await fetch(`https://${server}/v1/process`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      task,
      tool:  'compress',
      files: [{ server_filename: serverFilename, filename: 'document.pdf' }],
    }),
  });
  if (!res.ok) throw new Error(`iLoveAPI process failed: ${res.status}`);
}

async function downloadResult(server, token, task) {
  const res = await fetch(`https://${server}/v1/download/${task}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`iLoveAPI download failed: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

export async function compressPdf(buffer, ilovepdfKey) {
  if (buffer.length <= COMPRESS_THRESHOLD) return buffer;

  const token          = await getToken(ilovepdfKey);
  const { server, task } = await startTask(token);
  const serverFilename = await uploadFile(server, token, task, buffer);
  await processTask(server, token, task, serverFilename);
  const compressed     = await downloadResult(server, token, task);

  return compressed.length < buffer.length ? compressed : buffer;
}
