// The fake DOM from fake-dom.js, with the few extra node methods the Proof Scan
// v2 page uses (append, remove, insertBefore, before, classList.toggle,
// createElementNS) and a textContent that really replaces the children, the
// way a browser does. Test-only. Same rule as fake-dom.js: literal, so text is
// text and a test that finds markup has found a real bug.

import { fakeDocument } from './fake-dom.js';

function extend(node) {
  let text = '';
  Object.defineProperty(node, 'textContent', {
    get() { return text; },
    set(v) { text = v == null ? '' : String(v); node.childNodes.length = 0; },
  });
  // Node-level innerHTML is never used by the page; if it ever is, the test sees it.
  Object.defineProperty(node, 'innerHTML', {
    get() { return undefined; },
    set(v) { node.__innerHTML = String(v); },
  });
  const cl = Object.getOwnPropertyDescriptor(node, 'classList').get;
  Object.defineProperty(node, 'classList', {
    get() {
      const base = cl();
      return {
        ...base,
        toggle(name, force) {
          const on = force === undefined ? !base.contains(name) : Boolean(force);
          if (on) base.add(name); else base.remove(name);
          return on;
        },
      };
    },
  });
  node.append = (...kids) => { kids.forEach((k) => node.appendChild(k)); };
  node.remove = () => {
    const p = node.parentNode;
    if (!p) return;
    const i = p.childNodes.indexOf(node);
    if (i >= 0) p.childNodes.splice(i, 1);
    node.parentNode = null;
  };
  node.insertBefore = (child, ref) => {
    child.remove?.();
    child.parentNode = node;
    const i = node.childNodes.indexOf(ref);
    if (i < 0) node.childNodes.push(child); else node.childNodes.splice(i, 0, child);
    return child;
  };
  node.before = (other) => node.parentNode?.insertBefore(other, node);
  const appendChild = node.appendChild;
  node.appendChild = (child) => { child.remove?.(); return appendChild(child); };
  return node;
}

export function fakeV2Document() {
  const base = fakeDocument();
  return {
    ...base,
    createElement: (tag) => extend(base.createElement(tag)),
    createElementNS: (_ns, tag) => extend(base.createElement(tag)),
  };
}

export { walk, findAll, byClass, oneByClass, byTag, textOf, click } from './fake-dom.js';

// Lets the page's promise chains settle.
export async function flush(times = 30) {
  for (let i = 0; i < times; i++) await new Promise((r) => setTimeout(r, 0));
}

// Fires a change after setting a control's value, as a browser would.
export async function change(node, value) {
  if (value !== undefined) {
    if (node.type === 'checkbox' || node.type === 'radio') node.checked = value;
    else node.value = value;
  }
  await node.dispatchEvent({ type: 'change', target: node });
}

// A File stand-in: the page only reads name, type, size and arrayBuffer().
export function fakeFile(name, { size, type = 'application/pdf', body } = {}) {
  const bytes = new TextEncoder().encode(body ?? `%PDF-1.4\n% ${name}\n%%EOF\n`);
  return { name, type, size: size ?? bytes.length, arrayBuffer: async () => bytes.buffer };
}
