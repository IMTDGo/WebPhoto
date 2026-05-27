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
    containerEl.innerHTML = '<p class="text-xs text-center text-base-content/40 p-4">No material data for this BOM</p>';
    return;
  }

  // Group by category
  const groups = {};
  textures.forEach(t => {
    const cat = t.category || 'Other';
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

/**
 * Render a two-level accordion for mobile upload.
 *   Level 1 — Category sections (Upper, Lining, …)
 *   Level 2 — Individual material rows with status dot + expand-on-tap
 *
 * @param {HTMLElement} containerEl   - Element to render into (cleared first)
 * @param {Array}       textures      - Array of { _id, category, material, material_origin, … }
 * @param {Function}    onSelect      - Called with the individual item object
 * @param {Set}         [uploadedSet] - Set of item._id values already uploaded this session
 */
export function renderMaterialGroupList(containerEl, textures, onSelect, uploadedSet = new Set()) {
  containerEl.innerHTML = '';

  if (!textures?.length) {
    containerEl.innerHTML = '<p class="text-xs text-center text-base-content/40 p-4">No material data for this BOM</p>';
    return;
  }

  // ── Group by category ───────────────────────────────────────────────────────
  const catGroups = new Map();
  textures.forEach(item => {
    const cat = item.category || 'Other';
    if (!catGroups.has(cat)) catGroups.set(cat, []);
    catGroups.get(cat).push(item);
  });

  const singleCat = catGroups.size === 1;

  catGroups.forEach((items, cat) => {
    // ── Category section wrapper ──────────────────────────────────────────────
    const section = document.createElement('div');
    section.className = 'cat-section rounded-2xl bg-base-100/80 border border-base-content/10 overflow-hidden mb-3';

    // Category header button
    const catHeader = document.createElement('button');
    catHeader.className = 'cat-header w-full flex items-center gap-3 px-4 py-3 font-semibold text-sm transition-colors duration-150';
    catHeader.innerHTML = `
      <span class="flex-1 text-left">${escapeHtml(cat)}</span>
      <span class="text-xs font-normal text-base-content/40 tabular-nums">${items.length}</span>
      <svg class="cat-chevron h-4 w-4 text-base-content/30 transition-transform duration-200 shrink-0"
           xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/>
      </svg>`;

    // Material rows container
    const catBody = document.createElement('div');
    catBody.className = `cat-body flex flex-col border-t border-base-content/10${singleCat ? '' : ' hidden'}`;

    // ── Material rows ─────────────────────────────────────────────────────────
    items.forEach(item => {
      const isDone  = uploadedSet.has(item._id);
      const matName = item.material || item.material_origin || '—';
      const searchText = (cat + ' ' + matName).toLowerCase();

      const matRow = document.createElement('div');
      matRow.className = 'mat-group-row border-b border-base-content/5 last:border-b-0';
      matRow.dataset.searchtext = searchText;

      const dotClass = isDone ? 'bg-success' : 'bg-error/70';

      const bodyContent = isDone
        ? `<div class="flex items-center gap-2 text-success">
             <span class="h-2.5 w-2.5 rounded-full bg-success shrink-0"></span>
             <span class="text-sm font-semibold">Captured &amp; Uploaded</span>
           </div>`
        : `<button class="mat-group-upload-btn btn btn-primary btn-sm w-full gap-2">
             <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
               <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                 d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0118.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"/>
               <circle cx="12" cy="13" r="3"/>
             </svg>Capture &amp; Upload
           </button>`;

      matRow.innerHTML = `
        <button class="mat-row-header w-full flex items-center gap-2.5 px-4 py-3 text-left">
          <span class="shrink-0 h-2.5 w-2.5 rounded-full ${dotClass}"></span>
          <span class="flex-1 text-sm font-medium truncate min-w-0">${escapeHtml(matName)}</span>
          <svg class="mat-row-chevron h-4 w-4 text-base-content/30 transition-transform duration-200 shrink-0"
               xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/>
          </svg>
        </button>
        <div class="mat-row-body hidden flex flex-col gap-2.5 px-4 pb-3 border-t border-base-content/10">
          <p class="text-xs text-base-content/50 pt-2.5 break-all leading-relaxed">${escapeHtml(matName)}</p>
          ${bodyContent}
        </div>`;

      // Expand / collapse material row (one open per category)
      const rowHeader  = matRow.querySelector('.mat-row-header');
      const rowBody    = matRow.querySelector('.mat-row-body');
      const rowChevron = matRow.querySelector('.mat-row-chevron');

      rowHeader.addEventListener('click', () => {
        const isOpen = !rowBody.classList.contains('hidden');
        catBody.querySelectorAll('.mat-row-body').forEach(b => b.classList.add('hidden'));
        catBody.querySelectorAll('.mat-row-chevron').forEach(c => { c.style.transform = ''; });
        if (!isOpen) {
          rowBody.classList.remove('hidden');
          if (rowChevron) rowChevron.style.transform = 'rotate(180deg)';
        }
      });

      if (!isDone) {
        matRow.querySelector('.mat-group-upload-btn')?.addEventListener('click', () => onSelect(item));
      }

      catBody.appendChild(matRow);
    });

    // ── Category expand / collapse ────────────────────────────────────────────
    catHeader.addEventListener('click', () => {
      const isOpen = !catBody.classList.contains('hidden');
      containerEl.querySelectorAll('.cat-body').forEach(b => b.classList.add('hidden'));
      containerEl.querySelectorAll('.cat-chevron').forEach(c => { c.style.transform = ''; });
      containerEl.querySelectorAll('.cat-header').forEach(h => h.classList.remove('bg-primary/15', 'text-primary'));
      if (!isOpen) {
        catBody.classList.remove('hidden');
        catHeader.querySelector('.cat-chevron').style.transform = 'rotate(180deg)';
        catHeader.classList.add('bg-primary/15', 'text-primary');
      }
    });

    if (singleCat) {
      catHeader.querySelector('.cat-chevron').style.transform = 'rotate(180deg)';
      catHeader.classList.add('bg-primary/15', 'text-primary');
    }

    section.appendChild(catHeader);
    section.appendChild(catBody);
    containerEl.appendChild(section);
  });
}
