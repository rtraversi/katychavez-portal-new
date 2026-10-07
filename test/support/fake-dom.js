// A minimal DOM stand-in for driving production renderers inside workerd.
//
// The suite runs in the real Workers runtime, which has no document. Rather than
// asserting on source strings, the proof-scan renderers take their `doc` as an
// argument, so this shim can stand in for one and the tests can click things.
//
// It implements only what those renderers touch, and it is deliberately literal:
// `textContent` really is text, so a test that finds markup in the tree has found
// a real bug rather than a shim artefact. Not a general-purpose DOM — it is not
// a test helper's job to be one.

function createNode(tagName) {
  const listeners = new Map();
  let open = false;

  const node = {
    nodeType: 1,
    tagName: String(tagName).toLowerCase(),
    className: '',
    textContent: '',
    childNodes: [],
    parentNode: null,
    attributes: new Map(),
    dataset: {},
    hidden: false,
    disabled: false,
    type: '',
    focused: false,
    // Renderers set inline sizes while animating a disclosure; the values are
    // presentational, so the shim just holds them.
    style: {},
    scrollHeight: 0,

    appendChild(child) {
      child.parentNode = node;
      node.childNodes.push(child);
      return child;
    },
    setAttribute(name, value) { node.attributes.set(name, String(value)); },
    getAttribute(name) { return node.attributes.has(name) ? node.attributes.get(name) : null; },
    removeAttribute(name) { node.attributes.delete(name); },
    hasAttribute(name) { return node.attributes.has(name); },

    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    // Returns a promise so a test can await an async handler chain.
    dispatchEvent(event) {
      const handlers = listeners.get(event.type) || [];
      return Promise.all(handlers.map((fn) => fn(event)));
    },

    // Tag or .class only — enough for `details.querySelector('summary')`.
    querySelector(selector) { return node.querySelectorAll(selector)[0] || null; },
    querySelectorAll(selector) {
      const wanted = String(selector).trim();
      const matches = wanted.startsWith('.')
        ? (candidate) => candidate.className.split(/\s+/).includes(wanted.slice(1))
        : (candidate) => candidate.tagName === wanted.toLowerCase();
      const found = [];
      const visit = (current) => {
        for (const child of current.childNodes || []) {
          if (child.nodeType === 1) { if (matches(child)) found.push(child); visit(child); }
        }
      };
      visit(node);
      return found;
    },

    contains(other) {
      if (!other) return false;
      if (other === node) return true;
      return node.childNodes.some((child) => child.contains?.(other));
    },
    focus() { node.focused = true; },

    get classList() {
      const parts = () => node.className.split(/\s+/).filter(Boolean);
      return {
        add(...names) { node.className = [...new Set([...parts(), ...names])].join(' '); },
        remove(...names) {
          node.className = parts().filter((name) => !names.includes(name)).join(' ');
        },
        contains(name) { return parts().includes(name); },
      };
    },
  };

  // <details>: assigning `open` fires a toggle event, the way a browser does, so
  // the renderers' aria-expanded wiring is exercised rather than assumed.
  Object.defineProperty(node, 'open', {
    get() { return open; },
    set(value) {
      const next = Boolean(value);
      if (next === open) return;
      open = next;
      node.dispatchEvent({ type: 'toggle', target: node });
    },
  });

  return node;
}

export function fakeDocument() {
  return {
    createElement: (tag) => createNode(tag),
    createTextNode: (data) => ({ nodeType: 3, data, childNodes: [] }),
    createDocumentFragment: () => createNode('#fragment'),
  };
}

// ── Traversal helpers ────────────────────────────────────────────────────────

export function walk(node, visit) {
  if (!node) return;
  visit(node);
  for (const child of node.childNodes || []) walk(child, visit);
}

export function findAll(root, predicate) {
  const found = [];
  walk(root, (node) => { if (node.nodeType === 1 && predicate(node)) found.push(node); });
  return found;
}

const hasClass = (node, name) => node.className.split(/\s+/).includes(name);

export const byClass = (root, name) => findAll(root, (node) => hasClass(node, name));
export const oneByClass = (root, name) => byClass(root, name)[0] || null;
export const byTag = (root, tag) => findAll(root, (node) => node.tagName === tag);

// Every visible string in the tree, for "is this text or is it markup" checks.
export function textOf(root) {
  const parts = [];
  walk(root, (node) => { if (node.nodeType === 1 && node.textContent) parts.push(node.textContent); });
  return parts.join('\n');
}

// Clicking returns the handler's promise, so a test can await the decision.
export const click = (node) => node.dispatchEvent({ type: 'click', target: node });
