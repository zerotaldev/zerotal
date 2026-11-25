/**
 * The menus components/Dropdown.tsx writes: `[data-dropdown]`, holding a button, an empty
 * `role="menu"`, and the items in a `<template>` that fills the menu while it is open.
 *
 * Usable from the keyboard: Enter, Space or Arrow Down opens a menu on its first item,
 * Arrow Up on its last, the arrows and Home/End move between items, Escape closes it and
 * returns focus to the button, and Tab leaves it. A click anywhere else closes it.
 */
function parts(root: Element) {
  const button = root.querySelector<HTMLButtonElement>("[data-dropdown-trigger]");
  const menu = root.querySelector<HTMLElement>('[role="menu"]');
  return { button, menu };
}

function items(menu: HTMLElement): HTMLElement[] {
  return Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]'));
}

function focusItem(menu: HTMLElement, index: number): void {
  const all = items(menu);
  if (all.length === 0) return;
  all[(index + all.length) % all.length]?.focus();
}

function open(root: Element, index: number | null): void {
  closeAll(root);
  const { button, menu } = parts(root);
  const items = root.querySelector<HTMLTemplateElement>("template[data-dropdown-items]");
  if (!button || !menu) return;
  if (items) menu.replaceChildren(items.content.cloneNode(true));
  menu.hidden = false;
  button.setAttribute("aria-expanded", "true");
  if (index !== null) requestAnimationFrame(() => focusItem(menu, index));
}

function close(root: Element, returnFocus: boolean): void {
  const { button, menu } = parts(root);
  if (!button || !menu || menu.hidden) return;
  menu.hidden = true;
  menu.replaceChildren();
  button.setAttribute("aria-expanded", "false");
  if (returnFocus) button.focus();
}

function closeAll(except?: Element): void {
  for (const root of document.querySelectorAll("[data-dropdown]")) {
    if (root !== except) close(root, false);
  }
}

export function installDropdowns(): void {
  document.addEventListener("click", (event) => {
    const target = event.target as Element;
    const trigger = target.closest("[data-dropdown-trigger]");
    const root = target.closest("[data-dropdown]");

    if (trigger && root) {
      const { menu } = parts(root);
      if (menu?.hidden) open(root, null);
      else close(root, false);
      return;
    }
    // Choosing an item closes the menu — after the click has done its job, since taking
    // the item out of the page first would cancel a form it submits. A click anywhere
    // else closes them all.
    if (root && target.closest('[role="menuitem"]')) setTimeout(() => close(root, true));
    else if (!root) closeAll();
  });

  document.addEventListener("keydown", (event) => {
    const target = event.target as Element;
    const root = target.closest("[data-dropdown]");
    if (!root) return;
    const { menu } = parts(root);
    if (!menu) return;

    if (target.matches("[data-dropdown-trigger]")) {
      if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        open(root, 0);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        open(root, -1);
      }
      return;
    }

    if (menu.hidden || !menu.contains(target)) return;
    const all = items(menu);
    const current = all.indexOf(document.activeElement as HTMLElement);
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        focusItem(menu, current + 1);
        break;
      case "ArrowUp":
        event.preventDefault();
        focusItem(menu, current - 1);
        break;
      case "Home":
        event.preventDefault();
        focusItem(menu, 0);
        break;
      case "End":
        event.preventDefault();
        focusItem(menu, -1);
        break;
      case "Escape":
        event.preventDefault();
        close(root, true);
        break;
      case "Tab":
        close(root, false);
        break;
    }
  });
}
