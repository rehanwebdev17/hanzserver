let items = [];
let nextId = 1;
let currentFolderId = null; 
let selectedIds = new Set();
let clipboard = { mode: null, ids: [] };
let contextTargetId = null;
let history = [];
let historyIndex = -1;
let activeRename = null;
let justFinishedDrag = false;
let lastClickedId = null;
let isSyncing = false;

const CUSTOM_ICONS = {
    folder: `<svg viewBox="0 0 24 24" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" stroke="var(--text)"/><path d="M4 8h16" stroke="var(--accent)"/></svg>`,
    file: `<svg viewBox="0 0 24 24" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke="var(--text)"/><path d="M14 2v6h6" stroke="var(--accent)"/></svg>`,
    image: `<svg viewBox="0 0 24 24" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" stroke="var(--text)"/><circle cx="8.5" cy="8.5" r="1.5" stroke="var(--accent)"/><path d="m21 15-5-5L5 21" stroke="var(--accent)"/></svg>`
};

const navMenu = document.getElementById('navMenu');
const fileInput = document.getElementById('fileInput');
const folderInput = document.getElementById('folderInput');
const gridView = document.getElementById('gridView');
const emptyState = document.getElementById('emptyState');
const contentArea = document.getElementById('contentArea');
const breadcrumb = document.getElementById('breadcrumb');
const contextMenu = document.getElementById('contextMenu');
const emptyContextMenu = document.getElementById('emptyContextMenu');
const ctxPaste = document.getElementById('ctxPaste');
const bsRect = document.getElementById('bsRect');
const searchInput = document.getElementById('searchInput');
const searchPopup = document.getElementById('searchPopup');
const saveBtn = document.getElementById('saveBtn');
const pinnedSection = document.getElementById('pinnedSection');
const pinnedDivider = document.getElementById('pinnedDivider');
const pinnedList = document.getElementById('pinnedList');

document.addEventListener('keydown', (e) => {
    if (e.key === 'F12') {
        e.preventDefault();
        return false;
    }
    if (e.ctrlKey && e.shiftKey && ['I', 'J', 'C'].includes(e.key.toUpperCase())) {
        e.preventDefault();
        return false;
    }
    if (e.ctrlKey && ['U', 'S'].includes(e.key.toUpperCase())) {
        e.preventDefault();
        return false;
    }
});

function isImageFile(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'].includes(ext);
}

async function loadFromAPI() {
    if (!isAPIConfigured()) {
        items = JSON.parse(JSON.stringify(SYS_FOLDERS));
        nextId = 1;
        return false;
    }
    
    try {
        const res = await fetch(API_URL + '?action=getAll');
        const json = await res.json();
        
        if (json.success && Array.isArray(json.data)) {
            const sysIds = ['sys_pictures', 'sys_documents'];
            items = json.data.map(x => ({
                ...x,
                isSystem: sysIds.includes(String(x.id)),
                fileObj: null,
                isUploading: false
            }));
            
            sysIds.forEach(id => {
                if (!items.find(f => String(f.id) === id)) {
                    const def = SYS_FOLDERS.find(f => f.id === id);
                    if (def) items.push({ ...def, isPinned: false });
                }
            });
            
            const numericIds = items.filter(x => /^\d+$/.test(String(x.id))).map(x => parseInt(x.id));
            nextId = numericIds.length ? Math.max(...numericIds) + 1 : 1;
            
            return true;
        }
    } catch (err) {
        console.error(err);
    }
    
    items = JSON.parse(JSON.stringify(SYS_FOLDERS));
    return false;
}

async function saveAllToAPI() {
    if (!isAPIConfigured()) return false;
    
    const payload = items.map(it => ({
        id: String(it.id),
        name: it.name,
        parentId: it.parentId ? String(it.parentId) : null,
        isFile: it.isFile === true,
        isPinned: it.isPinned === true,
        fileUrl: it.fileUrl || null,
        createdAt: it.createdAt || new Date().toISOString()
    }));
    
    try {
        const res = await fetch(API_URL, {
            method: 'POST',
            body: JSON.stringify({ action: 'saveAll', items: payload })
        });
        const json = await res.json();
        return json.success === true;
    } catch (err) {
        console.error(err);
        return false;
    }
}

async function uploadFileToAPI(file) {
    if (!isAPIConfigured()) return null;
    
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = async () => {
            const base64 = reader.result.split(',')[1];
            try {
                const res = await fetch(API_URL, {
                    method: 'POST',
                    body: JSON.stringify({
                        action: 'uploadFile',
                        name: file.name,
                        mimeType: file.type || 'application/octet-stream',
                        base64: base64
                    })
                });
                const json = await res.json();
                resolve(json.success ? json.url : null);
            } catch (err) {
                console.warn(err);
                resolve(null);
            }
        };
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(file);
    });
}

function getUniqueName(baseName, parentId) {
    const siblings = getChildren(parentId);
    if (!siblings.some(f => f.name === baseName)) return baseName;
    let counter = 1;
    const lastDot = baseName.lastIndexOf('.');
    const ext = lastDot > 0 ? baseName.slice(lastDot) : '';
    const base = lastDot > 0 ? baseName.slice(0, lastDot) : baseName;
    let newName = `${base} (${counter})${ext}`;
    while (siblings.some(f => f.name === newName)) {
        counter++;
        newName = `${base} (${counter})${ext}`;
    }
    return newName;
}

function makeItem(name, parentId, isFile = false, fileObj = null) {
    const f = { id: nextId++, name, parentId, isFile, fileObj, isPinned: false, fileUrl: null, createdAt: new Date().toISOString(), isUploading: false };
    items.push(f);
    return f;
}

function getItem(id) {
    if (id === null || id === undefined) return null;
    return items.find(f => String(f.id) === String(id));
}

function getChildren(parentId) { return items.filter(f => f.parentId === parentId); }

function getPath(id) {
    const path = [];
    let cur = getItem(id);
    while (cur) {
        path.unshift(cur);
        cur = cur.parentId ? getItem(cur.parentId) : null;
    }
    return path;
}

function isDescendant(ancestorId, descendantId) {
    let p = descendantId;
    while (p !== null) {
        if (String(p) === String(ancestorId)) return true;
        p = getItem(p)?.parentId ?? null;
    }
    return false;
}

function openFile(f) {
    if (f.isUploading) return;
    if (f.fileUrl) { window.open(f.fileUrl, '_blank'); return; }
    if (f.fileObj) {
        const url = URL.createObjectURL(f.fileObj);
        window.open(url, '_blank');
        setTimeout(() => URL.revokeObjectURL(url), 60000);
        return;
    }
}

function updatePasteState() {
    ctxPaste.hidden = !(clipboard.mode && clipboard.ids.length > 0);
}

function clearClipboard() {
    clipboard = { mode: null, ids: [] };
    document.querySelectorAll('.grid-item.cut').forEach(el => el.classList.remove('cut'));
    updatePasteState();
}

function setClipboard(mode, ids) {
    clipboard = { mode, ids: [...ids] };
    document.querySelectorAll('.grid-item.cut').forEach(el => el.classList.remove('cut'));
    if (mode === 'cut') {
        clipboard.ids.forEach(id => {
            document.querySelectorAll(`.grid-item[data-id="${id}"]`).forEach(el => el.classList.add('cut'));
        });
    }
    updatePasteState();
}

function flashItem(item) {
    item.classList.remove('flash'); void item.offsetWidth;
    item.classList.add('flash'); setTimeout(() => item.classList.remove('flash'), 500);
}

function snapshot() {
    return {
        items: items.map(f => ({ ...f, fileObj: f.fileObj })),
        nextId, currentFolderId, selectedIds: new Set(selectedIds)
    };
}
function restore(s) {
    items = s.items.map(f => ({ ...f }));
    nextId = s.nextId; currentFolderId = s.currentFolderId;
    selectedIds = new Set(s.selectedIds);
}
function recordHistory() {
    history = history.slice(0, historyIndex + 1);
    history.push(snapshot());
    historyIndex = history.length - 1;
}
function undo() { if (historyIndex <= 0) return; historyIndex--; restore(history[historyIndex]); afterRestore(); }
function redo() { if (historyIndex >= history.length - 1) return; historyIndex++; restore(history[historyIndex]); afterRestore(); }

function afterRestore() {
    hideContextMenus();
    clipboard.ids = clipboard.ids.filter(id => getItem(id));
    if (!clipboard.ids.length) clipboard = { mode: null, ids: [] };
    updatePasteState();
    renderAll();
    refreshSearchPopup();
}

function renderAll() {
    updateNavActive();
    renderPinnedSidebar();
    renderContent();
    renderBreadcrumb();
    renderSelection();
}

function updateNavActive() {
    let activeNav = 'home';
    if (currentFolderId !== null) {
        const path = getPath(currentFolderId);
        if (path.length > 0) {
            if (path[0].id === 'sys_pictures') activeNav = 'sys_pictures';
            else if (path[0].id === 'sys_documents') activeNav = 'sys_documents';
        }
    }
    document.querySelectorAll('.nav-item').forEach(el => {
        el.classList.toggle('active', el.dataset.nav === activeNav);
    });
}

function renderPinnedSidebar() {
    const pinnedItems = items.filter(f => f.isPinned);
    pinnedList.innerHTML = '';
    
    if (pinnedItems.length === 0) {
        pinnedSection.classList.remove('active');
        pinnedDivider.style.display = 'none';
    } else {
        pinnedSection.classList.add('active');
        pinnedDivider.style.display = 'block';
        pinnedItems.forEach(f => {
            const el = document.createElement('div');
            el.className = 'nav-item';
            el.dataset.id = f.id;
            const iconName = f.isFile ? 'file' : 'folder';
            el.innerHTML = `<i data-lucide="${iconName}"></i> <span></span>`;
            el.querySelector('span').textContent = f.name;
            pinnedList.appendChild(el);
        });
    }
    lucide.createIcons();
}

function renderContent() {
    gridView.innerHTML = '';
    let children = getChildren(currentFolderId);
    if (currentFolderId === null) {
        children = children.filter(f => !f.isSystem);
    }

    if (children.length === 0) {
        emptyState.hidden = false;
    } else {
        emptyState.hidden = true;
        children.forEach(f => {
            const item = document.createElement('div');
            item.className = 'grid-item';
            if (f.isUploading) item.classList.add('uploading');
            item.dataset.id = f.id;
            
            let iconHTML = '';
            if (!f.isFile) {
                iconHTML = CUSTOM_ICONS.folder;
            } else if (isImageFile(f.name)) {
                iconHTML = CUSTOM_ICONS.image;
            } else {
                iconHTML = CUSTOM_ICONS.file;
            }
            
            item.innerHTML = `${iconHTML}<span class="folder-name"></span>`;
            item.querySelector('.folder-name').textContent = f.name;
            
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                if (justFinishedDrag || f.isUploading) return;
                if (e.ctrlKey || e.metaKey) toggleSelect(f.id);
                else if (e.shiftKey && lastClickedId !== null) selectRange(lastClickedId, f.id);
                else selectOnly(f.id);
                lastClickedId = f.id;
            });

            item.addEventListener('dblclick', (e) => {
                e.stopPropagation();
                if (justFinishedDrag || f.isUploading) return;
                if (f.isFile) openFile(f);
                else enterFolder(f.id);
            });

            item.addEventListener('contextmenu', (e) => {
                e.preventDefault(); e.stopPropagation();
                if (f.isUploading) return;
                if (!selectedIds.has(f.id)) selectOnly(f.id);
                showContextMenu(e.clientX, e.clientY, f.id);
            });

            gridView.appendChild(item);
        });
    }
    lucide.createIcons();
}

function renderSelection() {
    document.querySelectorAll('.grid-item').forEach(el => {
        el.classList.toggle('selected', selectedIds.has(Number(el.dataset.id)));
    });
}

function renderBreadcrumb() {
    breadcrumb.innerHTML = '';
    const path = currentFolderId !== null ? getPath(currentFolderId) : [];
    const isSystemRoot = path.length > 0 && path[0].isSystem;

    if (!isSystemRoot) {
        const home = document.createElement('span');
        home.className = 'crumb' + (currentFolderId === null ? ' current' : '');
        home.innerHTML = `<i data-lucide="home"></i><span>Home</span>`;
        home.addEventListener('click', () => { if (currentFolderId !== null) goHome(); });
        breadcrumb.appendChild(home);
    }

    path.forEach((f, i) => {
        if (breadcrumb.childNodes.length > 0) {
            const sep = document.createElement('span'); 
            sep.className = 'crumb-sep'; sep.textContent = '>';
            breadcrumb.appendChild(sep);
        }
        const isLast = i === path.length - 1;
        const el = document.createElement('span');
        el.className = 'crumb' + (isLast ? ' current' : '');
        let iconHtml = '';
        if (f.id === 'sys_pictures') iconHtml = `<i data-lucide="image"></i>`;
        else if (f.id === 'sys_documents') iconHtml = `<i data-lucide="file-text"></i>`;
        else iconHtml = `<i data-lucide="folder"></i>`;
        el.innerHTML = `${iconHtml}<span></span>`;
        el.querySelector('span').textContent = f.name;
        el.addEventListener('click', () => { if (!isLast) enterFolder(f.id); });
        breadcrumb.appendChild(el);
    });
    lucide.createIcons();
}

function selectOnly(id) { selectedIds = new Set([id]); renderSelection(); }
function toggleSelect(id) { if (selectedIds.has(id)) selectedIds.delete(id); else selectedIds.add(id); renderSelection(); }
function selectRange(fromId, toId) {
    const ids = getChildren(currentFolderId).map(f => f.id);
    const a = ids.indexOf(fromId), b = ids.indexOf(toId);
    if (a === -1 || b === -1) { selectOnly(toId); return; }
    const lo = Math.min(a, b), hi = Math.max(a, b);
    const range = ids.slice(lo, hi + 1);
    if (selectedIds.has(fromId)) range.forEach(id => selectedIds.add(id));
    else selectedIds = new Set(range);
    renderSelection();
}
function selectAll() { selectedIds = new Set(getChildren(currentFolderId).map(f => f.id)); renderSelection(); }
function selectNone() { selectedIds = new Set(); renderSelection(); }

function enterFolder(id) {
    const item = getItem(id);
    if (item && item.isFile) return;
    currentFolderId = id; selectedIds = new Set(); lastClickedId = null;
    hideContextMenus(); hideSearchPopup(); renderAll();
}
function goHome() {
    currentFolderId = null; selectedIds = new Set(); lastClickedId = null;
    hideContextMenus(); hideSearchPopup(); renderAll();
}

saveBtn.addEventListener('click', async () => {
    if (isSyncing) return;
    isSyncing = true;
    
    const originalHTML = saveBtn.innerHTML;
    saveBtn.disabled = true;
    saveBtn.innerHTML = `<div class="spinner"></div>`;
    
    await saveAllToAPI();
    
    saveBtn.innerHTML = originalHTML;
    lucide.createIcons();
    saveBtn.disabled = false;
    isSyncing = false;
});

navMenu.addEventListener('click', (e) => {
    const navItem = e.target.closest('.nav-item');
    if (!navItem) return;
    const nav = navItem.dataset.nav;
    if (nav === 'home') goHome();
    else enterFolder(nav);
});

let pinnedClickTimer = null;
pinnedList.addEventListener('click', (e) => {
    const pinnedItem = e.target.closest('.nav-item');
    if (!pinnedItem) return;
    if (pinnedClickTimer) clearTimeout(pinnedClickTimer);
    pinnedClickTimer = setTimeout(() => {
        const id = pinnedItem.dataset.id;
        const f = getItem(id);
        if (f && !f.isFile) enterFolder(f.id);
        else if (f && f.isFile) { enterFolder(f.parentId); selectOnly(f.id); }
    }, 200);
});

pinnedList.addEventListener('dblclick', (e) => {
    const pinnedItem = e.target.closest('.nav-item');
    if (!pinnedItem) return;
    if (pinnedClickTimer) clearTimeout(pinnedClickTimer);
    const id = pinnedItem.dataset.id;
    const f = getItem(id);
    if (f) {
        if (f.isFile) openFile(f);
        else enterFolder(f.id);
    }
});

pinnedList.addEventListener('contextmenu', (e) => {
    const pinnedItem = e.target.closest('.nav-item');
    if (!pinnedItem) return;
    e.preventDefault(); e.stopPropagation();
    const id = pinnedItem.dataset.id;
    const f = getItem(id);
    if (f) { selectOnly(f.id); showContextMenu(e.clientX, e.clientY, f.id); }
});

contentArea.addEventListener('contextmenu', (e) => {
    if (e.target.closest('.grid-item')) return;
    e.preventDefault(); e.stopPropagation();
    hideContextMenus();
    updatePasteState();

    const x = e.clientX, y = e.clientY;
    emptyContextMenu.hidden = false;
    const rect = emptyContextMenu.getBoundingClientRect();
    let px = x, py = y;
    if (px + rect.width  > window.innerWidth  - 4) px = window.innerWidth  - rect.width  - 4;
    if (py + rect.height > window.innerHeight - 4) py = window.innerHeight - rect.height - 4;
    emptyContextMenu.style.left = px + 'px';
    emptyContextMenu.style.top  = py + 'px';
});

document.getElementById('ctxNewFolder').addEventListener('mousedown', (e) => {
    e.preventDefault(); e.stopPropagation();
    const uniqueName = getUniqueName('New folder', currentFolderId);
    const f = makeItem(uniqueName, currentFolderId, false);
    selectedIds = new Set([f.id]);
    recordHistory(); renderAll();
    hideContextMenus();
});

document.getElementById('ctxUploadFolder').addEventListener('mousedown', (e) => {
    e.preventDefault(); e.stopPropagation();
    folderInput.click();
    hideContextMenus();
});

document.getElementById('ctxUploadDocument').addEventListener('mousedown', (e) => {
    e.preventDefault(); e.stopPropagation();
    fileInput.click();
    hideContextMenus();
});

ctxPaste.addEventListener('mousedown', (e) => {
    e.preventDefault(); e.stopPropagation();
    hideContextMenus();
    if (!clipboard.mode || !clipboard.ids.length) return;
    const newSelected = new Set();
    if (clipboard.mode === 'copy') {
        clipboard.ids.forEach(id => {
            if (!getItem(id)) return;
            const copy = duplicateItem(id, currentFolderId);
            if (copy) newSelected.add(copy.id);
        });
    } else if (clipboard.mode === 'cut') {
        clipboard.ids.forEach(id => {
            const src = getItem(id);
            if (!src) return;
            if (src.id === currentFolderId || isDescendant(src.id, currentFolderId)) return;
            src.parentId = currentFolderId;
            newSelected.add(src.id);
        });
    }
    selectedIds = newSelected; clearClipboard(); recordHistory(); renderAll();
});

function showContextMenu(x, y, id) {
    emptyContextMenu.hidden = true;
    contextMenu.hidden = true;
    contextTargetId = id;

    const targets = getActionTargets();
    if (targets.length === 0 && !getItem(id)?.isSystem) return;

    const f = getItem(id);
    const pinBtn = contextMenu.querySelector('[data-action="pin"]');
    if (f && pinBtn) {
        if (f.isPinned) pinBtn.innerHTML = `<i data-lucide="pin-off"></i><span>Unpin from Sidebar</span>`;
        else pinBtn.innerHTML = `<i data-lucide="pin"></i><span>Pin to Sidebar</span>`;
        lucide.createIcons();
    }

    contextMenu.hidden = false;
    const rect = contextMenu.getBoundingClientRect();
    let px = x, py = y;
    if (px + rect.width  > window.innerWidth  - 4) px = window.innerWidth  - rect.width  - 4;
    if (py + rect.height > window.innerHeight - 4) py = window.innerHeight - rect.height - 4;
    contextMenu.style.left = px + 'px'; contextMenu.style.top  = py + 'px';
}

function hideContextMenus() {
    contextMenu.hidden = true;
    emptyContextMenu.hidden = true;
    contextTargetId = null;
}

function getActionTargets() {
    if (contextTargetId !== null && selectedIds.has(contextTargetId)) return Array.from(selectedIds).filter(id => !getItem(id)?.isSystem);
    return contextTargetId !== null && !getItem(contextTargetId)?.isSystem ? [contextTargetId] : [];
}

contextMenu.addEventListener('mousedown', (e) => {
    const btn = e.target.closest('.context-item');
    if (!btn || contextTargetId === null) return;
    e.preventDefault(); e.stopPropagation();

    const action = btn.dataset.action;
    const targets = getActionTargets();
    if (targets.length === 0) { hideContextMenus(); return; }

    if (action === 'pin') {
        const mainTarget = getItem(contextTargetId);
        if (mainTarget) {
            mainTarget.isPinned = !mainTarget.isPinned;
            targets.forEach(tid => {
                const t = getItem(tid);
                if (t) t.isPinned = mainTarget.isPinned;
            });
            recordHistory(); renderAll();
        }
    } else if (action === 'download') downloadSelected(targets);
    else if (action === 'rename') startRename(contextTargetId);
    else if (action === 'copy') {
        setClipboard('copy', targets);
        targets.forEach(id => document.querySelectorAll(`.grid-item[data-id="${id}"]`).forEach(el => flashItem(el)));
    } else if (action === 'cut') {
        setClipboard('cut', targets);
    } else if (action === 'delete') {
        targets.forEach(id => deleteItemRec(id));
        clipboard.ids = clipboard.ids.filter(id => getItem(id));
        if (!clipboard.ids.length) clipboard = { mode: null, ids: [] };
        updatePasteState(); selectedIds = new Set(); recordHistory(); renderAll(); refreshSearchPopup();
    }
    hideContextMenus();
});

function startRename(id) {
    const f = getItem(id);
    if (!f || f.isSystem) return;
    const el = document.querySelector(`.grid-item[data-id="${id}"]`);
    if (!el) return;
    const span = el.querySelector('.folder-name');
    if (!span) return;
    if (activeRename) activeRename.finish(true);

    const oldName = f.name;
    const input = document.createElement('input');
    input.type = 'text'; input.className = 'rename-input'; input.value = oldName;
    input.setAttribute('autocomplete', 'off'); input.setAttribute('spellcheck', 'false');

    span.replaceWith(input); input.focus(); input.select();
    let done = false;

    const finish = (save) => {
        if (done) return; done = true;
        if (activeRename && activeRename.input === input) activeRename = null;

        let newName = save ? (input.value.trim() || oldName) : oldName;
        if (save && newName !== oldName) {
            const siblings = getChildren(f.parentId).filter(s => s.id !== f.id);
            if (siblings.some(s => s.name === newName)) newName = getUniqueName(newName, f.parentId);
        }
        const changed = newName !== oldName;
        if (changed) f.name = newName;

        const newSpan = document.createElement('span');
        newSpan.className = 'folder-name'; newSpan.textContent = newName;
        if (input.parentNode) input.replaceWith(newSpan);

        if (changed) { recordHistory(); renderAll(); refreshSearchPopup(); }
    };

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); finish(true); }
        if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('click', (e) => e.stopPropagation());
    input.addEventListener('mousedown', (e) => e.stopPropagation());
    input.addEventListener('contextmenu', (e) => e.stopPropagation());

    activeRename = { input, finish };
}

document.addEventListener('mousedown', (e) => {
    if (!activeRename) return;
    if (e.target === activeRename.input || activeRename.input.contains(e.target)) return;
    activeRename.finish(true);
}, true);

fileInput.addEventListener('change', (e) => { processFiles(e.target.files); fileInput.value = ''; });
folderInput.addEventListener('change', (e) => { processDirectoryInput(e.target.files); folderInput.value = ''; });

async function processFiles(files) {
    if (!files.length) return;
    let uploadedItems = [];
    const useDrive = isAPIConfigured();

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const uniqueName = getUniqueName(file.name, currentFolderId);
        const newItem = makeItem(uniqueName, currentFolderId, true, file);
        newItem.isUploading = true;
        uploadedItems.push(newItem);
    }
    
    renderAll();

    for (const item of uploadedItems) {
        if (useDrive) {
            const fileUrl = await uploadFileToAPI(item.fileObj);
            item.fileUrl = fileUrl;
        }
        item.isUploading = false;
    }
    
    if (uploadedItems.length > 0) {
        selectedIds = new Set([uploadedItems[uploadedItems.length - 1].id]);
        recordHistory(); renderAll();
    }
}

async function processDirectoryInput(fileList) {
    if (!fileList.length) return;
    
    const firstPath = fileList[0].webkitRelativePath;
    const rootFolderName = firstPath.split('/')[0];
    const uniqueRootName = getUniqueName(rootFolderName, currentFolderId);
    const rootFolder = makeItem(uniqueRootName, currentFolderId, false);
    const useDrive = isAPIConfigured();
    let uploadedItems = [];

    for (let i = 0; i < fileList.length; i++) {
        const file = fileList[i];
        const pathParts = file.webkitRelativePath.split('/');
        let currentParentId = rootFolder.id;
        
        for (let j = 1; j < pathParts.length - 1; j++) {
            const folderName = pathParts[j];
            let existing = getChildren(currentParentId).find(f => f.name === folderName && !f.isFile);
            if (!existing) existing = makeItem(folderName, currentParentId, false);
            currentParentId = existing.id;
        }
        
        const fileName = pathParts[pathParts.length - 1];
        const uniqueFileName = getUniqueName(fileName, currentParentId);
        const newItem = makeItem(uniqueFileName, currentParentId, true, file);
        newItem.isUploading = true;
        uploadedItems.push(newItem);
    }
    
    renderAll();

    for (const item of uploadedItems) {
        if (useDrive) {
            const fileUrl = await uploadFileToAPI(item.fileObj);
            item.fileUrl = fileUrl;
        }
        item.isUploading = false;
    }
    
    selectedIds = new Set([rootFolder.id]); recordHistory(); renderAll();
}

async function downloadSelected(targets) {
    if (!targets.length) return;
    if (targets.length === 1) {
        const item = getItem(targets[0]);
        if (item && item.isFile) { triggerFileDownload(item); return; }
    }
    const zip = new JSZip();
    let hasContent = false;
    async function addToZip(itemId, currentPath) {
        const item = getItem(itemId);
        if (!item) return;
        if (item.isFile) {
            hasContent = true;
            if (item.fileObj) zip.file(currentPath + item.name, item.fileObj);
            else if (item.fileUrl) {
                try {
                    const res = await fetch(item.fileUrl);
                    const blob = await res.blob();
                    zip.file(currentPath + item.name, blob);
                } catch (err) {
                    zip.file(currentPath + item.name, `[File: ${item.name}]`);
                }
            } else zip.file(currentPath + item.name, `[File: ${item.name}]`);
        } else {
            zip.folder(currentPath + item.name);
            for (const child of getChildren(item.id)) await addToZip(child.id, currentPath + item.name + "/");
        }
    }
    for (const id of targets) await addToZip(id, "");
    if (!hasContent) return;
    try {
        const blob = await zip.generateAsync({ type: "blob" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = "Downloads_HanzServer.zip";
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) { console.error(err); }
}

function triggerFileDownload(item) {
    if (item.fileUrl) { window.open(item.fileUrl, '_blank'); return; }
    if (item.fileObj) {
        const url = URL.createObjectURL(item.fileObj);
        const a = document.createElement('a');
        a.href = url; a.download = item.name;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        return;
    }
    const blob = new Blob([`File "${item.name}"`], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = item.name;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function duplicateItem(srcId, newParentId) {
    const src = getItem(srcId);
    if (!src) return null;
    const uniqueName = getUniqueName(src.name, newParentId);
    const copy = makeItem(uniqueName, newParentId, src.isFile, src.fileObj);
    copy.fileUrl = src.fileUrl;
    if (!src.isFile) getChildren(srcId).forEach(child => duplicateItem(child.id, copy.id));
    return copy;
}

function deleteItemRec(id) {
    const f = getItem(id);
    if (f && f.isSystem) return;
    getChildren(id).forEach(child => deleteItemRec(child.id));
    items = items.filter(f => String(f.id) !== String(id));
}

function hideSearchPopup() { searchPopup.hidden = true; searchPopup.innerHTML = ''; }

function positionSearchPopup() {
    const rect = searchInput.closest('.search-container').getBoundingClientRect();
    searchPopup.style.left = rect.left + 'px'; searchPopup.style.top = (rect.bottom + 4) + 'px';
    searchPopup.style.width = rect.width + 'px';
}

function getFolderPathText(f) {
    const path = getPath(f.id);
    return path.map(p => p.name).join(' / ');
}

function renderSearchResults() {
    const q = searchInput.value.trim().toLowerCase();
    if (!q) { hideSearchPopup(); return; }
    const matches = items.filter(f => f.name.toLowerCase().includes(q));
    if (matches.length === 0) { hideSearchPopup(); return; }
    searchPopup.innerHTML = '';
    matches.forEach(f => {
        const item = document.createElement('div');
        item.className = 'search-result';
        item.innerHTML = `<span class="search-result-name">${f.name}</span><span class="search-result-path">${getFolderPathText(f)}</span>`;
        item.addEventListener('mousedown', (e) => e.preventDefault());
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            const targetId = f.id;
            searchInput.value = ''; hideSearchPopup(); searchInput.blur();
            if (f.isFile) { enterFolder(f.parentId); selectOnly(targetId); }
            else { enterFolder(targetId); }
        });
        searchPopup.appendChild(item);
    });
    searchPopup.hidden = false; positionSearchPopup();
}

function refreshSearchPopup() { if (!searchPopup.hidden) renderSearchResults(); }
searchInput.addEventListener('input', renderSearchResults);
searchInput.addEventListener('focus', () => { if (searchInput.value.trim()) renderSearchResults(); });
searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !searchPopup.hidden) {
        const first = searchPopup.querySelector('.search-result');
        if (first) { first.click(); e.preventDefault(); }
    } else if (e.key === 'Escape') {
        searchInput.value = ''; hideSearchPopup(); searchInput.blur(); e.stopPropagation();
    }
});

document.addEventListener('mousedown', (e) => {
    if (e.target.closest('.search-popup') || e.target.closest('.search-container')) return;
    hideSearchPopup();
});

window.addEventListener('resize', () => { if (!searchPopup.hidden) positionSearchPopup(); });

let bs = null;

contentArea.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if (e.target.closest('.grid-item') || e.target.closest('.rename-input')) return;
    e.preventDefault();
    bs = {
        startX: e.clientX, startY: e.clientY, moved: false,
        additive: e.ctrlKey || e.metaKey || e.shiftKey,
        baseSelected: new Set(selectedIds),
    };
    if (!bs.additive) { selectedIds = new Set(); renderSelection(); }
});

document.addEventListener('mousemove', (e) => {
    if (!bs) return;
    const dx = Math.abs(e.clientX - bs.startX);
    const dy = Math.abs(e.clientY - bs.startY);
    if (dx > 3 || dy > 3) { bs.moved = true; bsRect.style.display = 'block'; }
    if (!bs.moved) return;
    const x = Math.min(bs.startX, e.clientX);
    const y = Math.min(bs.startY, e.clientY);
    const w = Math.abs(e.clientX - bs.startX);
    const h = Math.abs(e.clientY - bs.startY);
    bsRect.style.left = x + 'px'; bsRect.style.top = y + 'px';
    bsRect.style.width = w + 'px'; bsRect.style.height = h + 'px';
    const rect = { left: x, top: y, right: x + w, bottom: y + h };
    if (!bs.additive) selectedIds = new Set();
    else selectedIds = new Set(bs.baseSelected);
    contentArea.querySelectorAll('.grid-item').forEach(el => {
        if (el.classList.contains('uploading')) return;
        const ir = el.getBoundingClientRect();
        const hit = !(rect.right < ir.left || rect.left > ir.right || rect.bottom < ir.top || rect.top > ir.bottom);
        if (hit) selectedIds.add(Number(el.dataset.id));
    });
    renderSelection();
});

document.addEventListener('mouseup', () => {
    if (!bs) return;
    const wasMoved = bs.moved;
    bs = null; bsRect.style.display = 'none';
    if (wasMoved) { justFinishedDrag = true; setTimeout(() => { justFinishedDrag = false; }, 0); }
});

document.addEventListener('mousedown', (e) => {
    if (!e.target.closest('.context-menu')) hideContextMenus();
});

document.addEventListener('keydown', (e) => {
    const inInput = e.target.matches('input, textarea');
    if (e.key === 'Escape') {
        hideContextMenus();
        if (inInput && activeRename) return;
        if (!inInput) selectNone();
        return;
    }
    if (inInput) return;
    const ctrl = e.ctrlKey || e.metaKey;

    if (ctrl && !e.shiftKey && e.key.toLowerCase() === 'a') { e.preventDefault(); selectAll(); return; }
    if (ctrl && !e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
    if (ctrl && ((e.shiftKey && e.key.toLowerCase() === 'z') || (!e.shiftKey && e.key.toLowerCase() === 'y'))) {
        e.preventDefault(); redo(); return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedIds.size === 0) return;
        e.preventDefault();
        const targets = Array.from(selectedIds).filter(id => !getItem(id)?.isSystem);
        targets.forEach(id => deleteItemRec(id));
        clipboard.ids = clipboard.ids.filter(id => getItem(id));
        if (!clipboard.ids.length) clipboard = { mode: null, ids: [] };
        updatePasteState(); selectedIds = new Set(); recordHistory(); renderAll(); refreshSearchPopup();
    }
});

document.addEventListener('click', (e) => {
    if (justFinishedDrag) return;
    if (e.target.closest('.grid-item') || e.target.closest('.context-menu') || e.target.closest('.search-popup') || e.target.closest('.content-area') || e.target.closest('.nav-menu') || e.target.closest('.top-bar')) return;
    selectNone();
});

(async () => {
    lucide.createIcons();
    await loadFromAPI();
    renderAll();
    recordHistory();
    updatePasteState();
})();

// =========================================
// FITUR RAHASIA: KUNCI LAYAR
// =========================================
let isLocked = true;
const lockOverlay = document.getElementById('lockOverlay');

// Mencegah klik kanan pada overlay
lockOverlay.addEventListener('contextmenu', (e) => e.preventDefault());

// Mendeteksi input rahasia di search bar
searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && searchInput.value === ";'") {
        isLocked = false;
        lockOverlay.classList.add('hidden');
        searchInput.value = '';
        searchInput.blur();
        e.preventDefault();
        e.stopPropagation();
    }
});