/**
 * bom-ui.js — Shared BOM category/material accordion renderer
 * Used by both app-mobile.js and app-desktop.js
 */

export function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Render a category accordion into containerEl.
 * @param {HTMLElement} containerEl  - Element to render into (cleared first)
 * @param {Array}       textures     - Array of { _id, category, material, material_origin, … }
 * @param {Function}    onSelect     - Called with the selected item object
 */
export function renderCategoryAccordion(containerEl, textures, onSelect) {
  containerEl.innerHTML = '';

  if (!textures?.length) {
    containerEl.innerHTML = '<p class="text-xs text-center text-base-content/40 p-4">此 BOM 無材質資料</p>';
    return;
  }

  // Group by category
  const groups = {};
  textures.forEach(t => {
    const cat = t.category || '其他';
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(t);
  });

  const singleGroup = Object.keys(groups).length === 1;

  Object.entries(groups).forEach(([cat, items]) => {
    const section = document.createElement('div');
    section.className = 'rounded-2xl bg-base-100/80 border border-base-content/10 overflow-hidden mb-3';

    // Category header
    const header = document.createElement('button');
    header.className = 'cat-header w-full flex items-center justify-between px-4 py-3 font-semibold text-sm transition-colors duration-150';
    header.innerHTML = `
      <span>${escapeHtml(cat)}</span>
      <svg class="h-4 w-4 text-base-content/30 transition-transform duration-200 cat-chevron"
           xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/>
      </svg>`;

    // Material list
    const matList = document.createElement('div');
    matList.className = `mat-list border-t border-base-content/10 flex flex-col${singleGroup ? '' : ' hidden'}`;

    items.forEach(item => {
      const matBtn = document.createElement('button');
      matBtn.className = 'w-full text-left px-4 py-2.5 text-sm flex items-center gap-3 hover:bg-base-content/5 active:bg-base-content/10 transition-colors mat-btn';
      matBtn.dataset.id = item._id;
      matBtn.innerHTML = `
        <span class="flex-1 truncate">${escapeHtml(item.material || item.material_origin || '—')}</span>
        ${item.material_origin && item.material_origin !== item.material
          ? `<span class="text-xs text-base-content/30 shrink-0 truncate max-w-[6rem]">${escapeHtml(item.material_origin)}</span>`
          : ''}`;
      matBtn.addEventListener('click', () => onSelect(item));
      matList.appendChild(matBtn);
    });

    // Toggle — one category open at a time
    header.addEventListener('click', () => {
      const isOpen = !matList.classList.contains('hidden');
      containerEl.querySelectorAll('.mat-list').forEach(el => el.classList.add('hidden'));
      containerEl.querySelectorAll('.cat-chevron').forEach(el => el.style.transform = '');
      containerEl.querySelectorAll('.cat-header').forEach(el => el.classList.remove('bg-primary/15', 'text-primary'));
      if (!isOpen) {
        matList.classList.remove('hidden');
        header.querySelector('.cat-chevron').style.transform = 'rotate(180deg)';
        header.classList.add('bg-primary/15', 'text-primary');
      }
    });

    if (singleGroup) {
      header.querySelector('.cat-chevron').style.transform = 'rotate(180deg)';
      header.classList.add('bg-primary/15', 'text-primary');
    }

    section.appendChild(header);
    section.appendChild(matList);
    containerEl.appendChild(section);
  });
}

/**
 * Highlight the selected mat-btn within a container (or the whole document).
 * @param {string}      itemId      - item._id to highlight
 * @param {HTMLElement} [scope]     - limit querySelectorAll scope (defaults to document)
 */
export function highlightMaterial(itemId, scope = document) {
  scope.querySelectorAll('.mat-btn').forEach(b => {
    b.classList.toggle('bg-primary/20', b.dataset.id === itemId);
    b.classList.toggle('text-primary',  b.dataset.id === itemId);
  });
}

/**
 * Clear all accordion highlight state within a container.
 * @param {HTMLElement} [scope]
 */
export function clearAccordionHighlight(scope = document) {
  scope.querySelectorAll('.mat-btn').forEach(b => b.classList.remove('bg-primary/20', 'text-primary'));
  scope.querySelectorAll('.cat-header').forEach(b => b.classList.remove('bg-primary/15', 'text-primary'));
  scope.querySelectorAll('.mat-list').forEach(el => el.classList.add('hidden'));
  scope.querySelectorAll('.cat-chevron').forEach(el => el.style.transform = '');
}
