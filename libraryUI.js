/**
 * libraryUI.js — Left asset library sidebar with collapse/reopen controls and tag filtering.
 */

window.LibraryUI = class LibraryUI {
    constructor(assetManager, dragDropManager, terrainManager) {
        this.assetManager = assetManager;
        this.dragDropManager = dragDropManager;
        this.terrainManager = terrainManager;
        this.selectedTagKeys = new Set();
        this.tagSearchTerm = '';
        this._createUI();
    }

    _createUI() {
        const overlay = document.getElementById('ui-overlay') || document.body;

        // 1. Top toolbar
        const uiContainer = document.createElement('div');
        uiContainer.id = 'editor-ui';
        uiContainer.innerHTML = `
            <div id="top-toolbar">
                <div class="toolbar-left">
                    <button id="btn-import-terrain" class="ui-btn"><span data-i18n="importTerrain">🌄 Import (Terrain)</span></button>
                    <input id="input-import-terrain" type="file" accept=".bloxdschem,.json,.schem" style="display:none">
                    <button id="btn-export-single" class="ui-btn primary"><span data-i18n="export">📤 Export (Schematic)</span></button>
                </div>
                <div class="toolbar-right">
                    <button id="btn-settings" class="ui-btn"><span data-i18n="settings">⚙ Settings</span></button>
                </div>
            </div>

            <div id="settings-modal" class="modal hidden">
                <div class="modal-content" style="width: 400px;">
                    <div class="modal-header">
                        <h3 data-i18n="settingsTitle">Editor Settings</h3>
                        <button id="close-settings" class="close-btn" data-i18n-title="close" title="Close">&times;</button>
                    </div>
                    <div class="sidebar-body" style="gap: 15px;">
                        <div class="prop-group">
                            <label data-i18n="language">Language:</label>
                            <select id="select-lang">
                                <option value="en" selected>English (EN)</option>
                                <option value="fr">Français (FR)</option>
                            </select>
                        </div>
                        <div class="prop-group">
                            <label data-i18n="keyboardLayout">Keyboard:</label>
                            <select id="select-keyboard">
                                <option value="azerty">AZERTY</option>
                                <option value="qwerty">QWERTY</option>
                            </select>
                        </div>
                    </div>
                </div>
            </div>
        `;
        overlay.appendChild(uiContainer);

        // 2. Left asset library sidebar
        const leftSidebar = document.createElement('div');
        leftSidebar.id = 'library-sidebar';
        leftSidebar.className = 'left-sidebar';
        leftSidebar.innerHTML = `
            <div class="sidebar-header" style="display:flex; justify-content:space-between; align-items:center;">
                <h3 data-i18n="library">📚 Asset Library</h3>
                <button id="toggle-sidebar" class="collapse-btn" data-i18n-title="toggleLibrary" title="Collapse / Expand">◀</button>
            </div>
            <div class="asset-filter-panel">
                <div class="asset-filter-title-row">
                    <span class="asset-filter-title">Tag search</span>
                    <button id="asset-filter-clear" class="asset-filter-clear" type="button">Clear</button>
                </div>
                <input id="asset-tag-search" class="asset-tag-search" type="search" placeholder="Search or select tags..." autocomplete="off" list="asset-tag-suggestions">
                <datalist id="asset-tag-suggestions"></datalist>
                <div id="asset-selected-tags" class="asset-selected-tags"></div>
                <div id="asset-tag-filter-list" class="asset-tag-filter-list"></div>
                <div id="asset-filter-count" class="asset-filter-count"></div>
            </div>
            <div class="asset-grid-sidebar" id="asset-grid-sidebar">
                <!-- Filled dynamically -->
            </div>
        `;
        overlay.appendChild(leftSidebar);

        // Separate reopen tab: it stays visible when the sidebar is collapsed.
        const reopenTab = document.createElement('button');
        reopenTab.id = 'library-reopen-tab';
        reopenTab.setAttribute('data-i18n-title', 'reopenLibrary');
        reopenTab.title = 'Open asset library';
        reopenTab.textContent = '▶';
        overlay.appendChild(reopenTab);

        this._bindEvents();
        this.updateTexts();
    }

    _bindEvents() {
        const settingsModal = document.getElementById('settings-modal');
        const toggleBtn = document.getElementById('toggle-sidebar');
        const reopenTab = document.getElementById('library-reopen-tab');
        const sidebar = document.getElementById('library-sidebar');
        const canvasContainer = document.getElementById('canvas-container');
        const uiOverlay = document.getElementById('ui-overlay');

        const setCollapsed = (collapsed) => {
            sidebar.classList.toggle('collapsed', collapsed);
            if (canvasContainer) canvasContainer.classList.toggle('expanded', collapsed);
            if (uiOverlay) uiOverlay.classList.toggle('expanded', collapsed);
            toggleBtn.textContent = collapsed ? '▶' : '◀';
            reopenTab.classList.toggle('visible', collapsed);

            const resize = window.appResize || (() => { if (window.appEngine) window.appEngine.resize(); });
            resize();
            const start = performance.now();
            const tick = (t) => {
                resize();
                if (t - start < 250) requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
        };

        toggleBtn.addEventListener('click', () => {
            setCollapsed(!sidebar.classList.contains('collapsed'));
        });

        reopenTab.addEventListener('click', () => setCollapsed(false));

        const tagSearch = document.getElementById('asset-tag-search');
        const clearFilters = document.getElementById('asset-filter-clear');
        tagSearch.addEventListener('input', (e) => {
            this.tagSearchTerm = e.target.value.trim().toLowerCase();
            this.populateLibrary();
        });
        tagSearch.addEventListener('change', (e) => {
            if (this._trySelectTagFromSearch(e.target.value)) {
                e.target.value = '';
                this.tagSearchTerm = '';
                this.populateLibrary();
            }
        });
        tagSearch.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && this._trySelectTagFromSearch(e.target.value)) {
                e.preventDefault();
                e.target.value = '';
                this.tagSearchTerm = '';
                this.populateLibrary();
            }
        });
        clearFilters.addEventListener('click', () => {
            this.selectedTagKeys.clear();
            this.tagSearchTerm = '';
            tagSearch.value = '';
            this.populateLibrary();
        });

        document.getElementById('btn-settings').addEventListener('click', () => {
            settingsModal.classList.toggle('hidden');
            document.getElementById('select-lang').value = window.I18N.lang;
            document.getElementById('select-keyboard').value = window.I18N.keyboard;
        });
        document.getElementById('close-settings').addEventListener('click', () => { settingsModal.classList.add('hidden'); });

        const importTerrainBtn = document.getElementById('btn-import-terrain');
        const importTerrainInput = document.getElementById('input-import-terrain');

        importTerrainBtn.addEventListener('click', () => {
            importTerrainInput.value = '';
            importTerrainInput.click();
        });

        importTerrainInput.addEventListener('change', async (e) => {
            const file = e.target.files && e.target.files[0];
            if (!file || !this.terrainManager) return;

            importTerrainBtn.disabled = true;
            try {
                const info = await this.terrainManager.importTerrainFile(file);
                if (window.appResize) window.appResize();
                console.log(`${window.I18N.t('terrainImportSuccess')} ${file.name}`, info);
            } catch (err) {
                console.error(window.I18N.t('terrainImportError'), err);
                alert(`${window.I18N.t('terrainImportError')} ${err.message || err}`);
            } finally {
                importTerrainBtn.disabled = false;
            }
        });

        document.getElementById('btn-export-single').addEventListener('click', () => {
            if (window.appExporter) window.appExporter.exportSingleSchem();
        });

        document.getElementById('select-lang').addEventListener('change', (e) => {
            window.I18N.lang = e.target.value;
            this.updateTexts();
        });

        document.getElementById('select-keyboard').addEventListener('change', (e) => {
            window.I18N.keyboard = e.target.value;
        });
    }

    updateTexts() {
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            el.textContent = window.I18N.t(key);
        });

        document.querySelectorAll('[data-i18n-title]').forEach(el => {
            const key = el.getAttribute('data-i18n-title');
            const value = window.I18N.t(key);
            el.title = value;
            el.setAttribute('aria-label', value);
        });

        const canvasContainer = document.getElementById('canvas-container');
        const uiOverlay = document.getElementById('ui-overlay');
        if (canvasContainer) canvasContainer.setAttribute('aria-label', window.I18N.t('canvasLabel'));
        if (uiOverlay) uiOverlay.setAttribute('aria-label', window.I18N.t('overlayLabel'));
        document.documentElement.lang = window.I18N.lang;
    }

    _slug(value) {
        return String(value || '').trim().toLowerCase();
    }

    _asArray(value) {
        if (value === undefined || value === null || value === '') return [];
        return Array.isArray(value) ? value.map(String).filter(Boolean) : [String(value)];
    }

    _tagObject(kind, value) {
        const clean = String(value || '').trim();
        if (!clean) return null;
        const key = kind ? `${kind}:${this._slug(clean)}` : this._slug(clean);
        const label = kind ? `${kind}: ${clean}` : clean;
        return { key, label, kind, value: clean };
    }

    _getAssetTags(name) {
        const meta = this.assetManager.getTemplateMeta ? this.assetManager.getTemplateMeta(name) : {};
        const tags = [];
        const add = (tag) => {
            if (!tag) return;
            if (!tags.some(t => t.key === tag.key)) tags.push(tag);
        };

        this._asArray(meta.type || meta.types).forEach(v => add(this._tagObject('type', v)));
        this._asArray(meta.biome || meta.biomes).forEach(v => add(this._tagObject('biome', v)));
        this._asArray(meta.tags).forEach(v => add(this._tagObject('tag', v)));
        this._asArray(meta.category || meta.categories).forEach(v => {
            const text = String(v).trim();
            if (!text) return;
            const colon = text.indexOf(':');
            if (colon > 0) {
                const kind = text.slice(0, colon).trim();
                const value = text.slice(colon + 1).trim();
                add(this._tagObject(kind, value));
            } else {
                add(this._tagObject('category', text));
            }
        });

        return tags;
    }

    _collectAllTags() {
        const map = new Map();
        for (const name in this.assetManager.templates) {
            for (const tag of this._getAssetTags(name)) {
                if (!map.has(tag.key)) map.set(tag.key, tag);
            }
        }
        return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label));
    }

    _trySelectTagFromSearch(rawValue) {
        const value = String(rawValue || '').trim().toLowerCase();
        if (!value) return false;

        const allTags = this._collectAllTags();
        let match = allTags.find(tag => tag.label.toLowerCase() === value || tag.value.toLowerCase() === value || tag.key.toLowerCase() === value);

        if (!match) {
            const fuzzy = allTags.filter(tag => tag.label.toLowerCase().includes(value) || tag.value.toLowerCase().includes(value));
            if (fuzzy.length === 1) match = fuzzy[0];
        }

        if (!match) return false;
        this.selectedTagKeys.add(match.key);
        return true;
    }

    _assetMatchesSelectedTags(name) {
        if (this.selectedTagKeys.size === 0) return true;
        const keys = new Set(this._getAssetTags(name).map(t => t.key));
        for (const selected of this.selectedTagKeys) {
            if (!keys.has(selected)) return false;
        }
        return true;
    }

    _assetMatchesSearchTerm(name) {
        const term = this.tagSearchTerm;
        if (!term) return true;
        const haystack = [name, ...this._getAssetTags(name).flatMap(tag => [tag.label, tag.value, tag.key])]
            .join(' ')
            .toLowerCase();
        return haystack.includes(term);
    }

    _renderTagFilters(allTags) {
        const list = document.getElementById('asset-tag-filter-list');
        const selectedList = document.getElementById('asset-selected-tags');
        const dataList = document.getElementById('asset-tag-suggestions');
        if (!list || !selectedList) return;

        const existingKeys = new Set(allTags.map(t => t.key));
        for (const key of Array.from(this.selectedTagKeys)) {
            if (!existingKeys.has(key)) this.selectedTagKeys.delete(key);
        }

        selectedList.innerHTML = '';
        const selectedTags = allTags.filter(tag => this.selectedTagKeys.has(tag.key));
        selectedList.classList.toggle('empty', selectedTags.length === 0);
        selectedList.innerHTML = selectedTags.length
            ? selectedTags.map(tag => `<button type="button" class="selected-tag-chip" data-tag-key="${tag.key}">${tag.label} ×</button>`).join('')
            : `<span class="selected-tags-placeholder">No tag selected</span>`;

        selectedList.querySelectorAll('[data-tag-key]').forEach(btn => {
            btn.addEventListener('click', () => {
                this.selectedTagKeys.delete(btn.dataset.tagKey);
                this.populateLibrary();
            });
        });

        if (dataList) {
            dataList.innerHTML = allTags
                .map(tag => `<option value="${tag.value}" label="${tag.label}"></option><option value="${tag.label}"></option>`)
                .join('');
        }

        const term = this.tagSearchTerm;
        const visibleTags = allTags.filter(tag => !term || tag.label.toLowerCase().includes(term) || tag.value.toLowerCase().includes(term) || tag.key.toLowerCase().includes(term));
        list.innerHTML = visibleTags.length
            ? visibleTags.map(tag => `
                <button type="button" class="tag-filter-chip ${this.selectedTagKeys.has(tag.key) ? 'active' : ''}" data-tag-key="${tag.key}">
                    ${tag.label}
                </button>
            `).join('')
            : `<div class="asset-filter-empty">No matching tags</div>`;

        list.querySelectorAll('[data-tag-key]').forEach(btn => {
            btn.addEventListener('click', () => {
                const key = btn.dataset.tagKey;
                if (this.selectedTagKeys.has(key)) this.selectedTagKeys.delete(key);
                else this.selectedTagKeys.add(key);
                this.populateLibrary();
            });
        });
    }

    populateLibrary() {
        const grid = document.getElementById('asset-grid-sidebar');
        const countEl = document.getElementById('asset-filter-count');
        if (!grid) return;

        const allTags = this._collectAllTags();
        this._renderTagFilters(allTags);

        grid.innerHTML = '';
        let visibleCount = 0;
        let totalCount = 0;

        for (const name in this.assetManager.templates) {
            totalCount++;
            if (!this._assetMatchesSelectedTags(name)) continue;
            if (!this._assetMatchesSearchTerm(name)) continue;
            visibleCount++;

            const sourceMesh = this.assetManager.templates[name];
            const tags = this._getAssetTags(name);
            const tagsHtml = tags
                .slice(0, 4)
                .map(t => `<span class="asset-tag">${t.label}</span>`)
                .join('');

            const card = document.createElement('div');
            card.className = 'asset-card-small';
            card.dataset.assetName = name;
            card.dataset.tags = tags.map(t => t.key).join(',');
            card.innerHTML = `
                <div class="asset-icon">🏠</div>
                <div class="asset-name">${name}</div>
                ${tagsHtml ? `<div class="asset-tags">${tagsHtml}</div>` : ''}
            `;
            card.addEventListener('click', () => {
                const schemData = sourceMesh.schemData || { size: { x: 4, y: 5, z: 4 }, blocks: [] };
                this.dragDropManager.startPlacement(name, schemData);
            });
            grid.appendChild(card);
        }

        if (visibleCount === 0) {
            const empty = document.createElement('div');
            empty.className = 'asset-grid-empty';
            empty.textContent = (this.selectedTagKeys.size > 0 || this.tagSearchTerm)
                ? 'No asset matches selected tags/search'
                : 'No assets available';
            grid.appendChild(empty);
        }

        if (countEl) {
            countEl.textContent = this.selectedTagKeys.size > 0
                ? `${visibleCount}/${totalCount} assets`
                : `${totalCount} assets`;
        }
    }
};
