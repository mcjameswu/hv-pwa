/**
 * DOM helpers. Text always goes through textContent so imported or
 * user strings cannot become executable markup.
 */

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, val] of Object.entries(attrs || {})) {
    if (val === undefined || val === null || val === false) continue;
    if (key === "class" || key === "className") node.className = String(val);
    else if (key === "text") node.textContent = String(val);
    else if (key === "checked") node.checked = !!val;
    else if (key === "disabled") node.disabled = !!val;
    else if (key === "selected") node.selected = !!val;
    else if (key === "value") node.value = String(val);
    else if (key === "htmlFor" || key === "for") node.htmlFor = String(val);
    else if (key.startsWith("on")) {
      if (typeof val === "function") node.addEventListener(key.slice(2).toLowerCase(), val);
      continue;
    } else if (val === true) node.setAttribute(key, "");
    else node.setAttribute(key, String(val));
  }
  appendChildren(node, children);
  return node;
}

function appendChildren(node, children) {
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    if (child === null || child === undefined || typeof child === "boolean") continue;
    if (Array.isArray(child)) {
      appendChildren(node, child);
    } else if (typeof child === "string" || typeof child === "number") {
      node.appendChild(document.createTextNode(String(child)));
    } else {
      node.appendChild(child);
    }
  }
}

export function clear(node) {
  if (!node) return;
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function text(value) {
  return document.createTextNode(String(value ?? ""));
}

export function mount(root, children) {
  if (!root) return;
  clear(root);
  appendChildren(root, children);
}
