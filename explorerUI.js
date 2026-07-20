/**
 * explorerUI.js — Roblox Studio-like Explorer dock.
 *
 * Right-side dock containing:
 * - Explorer tree/list;
 * - collapsible Properties panel at the bottom.
 *
 * Ground/Terrain selection is only possible from this Explorer panel.
 */

window.ExplorerUI = class ExplorerUI {
    constructor(assetManager, terrainManager, selectionManager) {
        this.assetManager = assetManager;
        this.terrainManager = terrainManager;
        this.selectionManager = selectionManager;
        this.root = null;
        this.list = null;
        this.propertiesDock = null;
        this.propertiesToggle = null;
        this.propertiesArrow = null;
        this.reopenTab = null;
        this._renderQueued = false;
        this._createUI();
        this._bindEvents();
        this.render();
    }

    _createUI() {
        const overlay = document.getElementById('ui-overlay') || document.body;
        const panel = document.createElement('div');
        panel.id = 'explorer-sidebar';
        panel.className = 'explorer-sidebar';
        panel.innerHTML = `
            <div class="explorer-header">
                <h3>Explorer</h3>
                <button id="toggle-explorer" class="collapse-btn" title="Collapse Explorer" aria-label="Collapse Explorer">▶</button>
            </div>
            <div id="explorer-list" class="explorer-list"></div>
            <div id="explorer-properties-dock" class="explorer-properties-dock collapsed">
                <button id="explorer-properties-toggle" class="explorer-properties-toggle" type="button" title="Toggle Properties" aria-label="Toggle Properties">
                    <span class="explorer-properties-title">Properties</span>
                    <span id="explorer-properties-arrow" class="explorer-properties-arrow">▲</span>
                </button>
                <div id="explorer-properties-content" class="explorer-properties-content"></div>
            </div>
        `;
        overlay.appendChild(panel);

        const reopenTab = document.createElement('button');
        reopenTab.id = 'explorer-reopen-tab';
        reopenTab.type = 'button';
        reopenTab.title = 'Open Explorer';
        reopenTab.setAttribute('aria-label', 'Open Explorer');
        reopenTab.textContent = '◀';
        overlay.appendChild(reopenTab);

        this.root = panel;
        this.list = panel.querySelector('#explorer-list');
        this.propertiesDock = panel.querySelector('#explorer-properties-dock');
        this.propertiesToggle = panel.querySelector('#explorer-properties-toggle');
        this.propertiesArrow = panel.querySelector('#explorer-properties-arrow');
        this.reopenTab = reopenTab;
    }

    _bindEvents() {
        const rerender = () => this.requestRender();

        if (this.assetManager) {
            const previous = this.assetManager.onChanged;
            this.assetManager.onChanged = (...args) => {
                if (typeof previous === 'function') previous(...args);
                rerender();
            };
        }

        if (this.terrainManager) {
            const previous = this.terrainManager.onChanged;
            this.terrainManager.onChanged = (...args) => {
                if (typeof previous === 'function') previous(...args);
                rerender();
            };
        }

        const collapseBtn = document.getElementById('toggle-explorer');
        collapseBtn.addEventListener('click', () => this.setExplorerCollapsed(true));
        this.reopenTab.addEventListener('click', () => this.setExplorerCollapsed(false));

        this.propertiesToggle.addEventListener('click', () => {
            const collapsed = this.propertiesDock.classList.contains('collapsed');
            this.setPropertiesCollapsed(!collapsed);
        });

        // SelectionManager currently exposes a single callback used by UIManager.
        // Polling keeps Explorer selection highlighting in sync without stealing that callback.
        window.setInterval(rerender, 350);
    }

    setExplorerCollapsed(collapsed) {
        this.root.classList.toggle('collapsed', collapsed);
        this.reopenTab.classList.toggle('visible', collapsed);
        if (window.appResize) window.appResize();
    }

    setPropertiesCollapsed(collapsed) {
        this.propertiesDock.classList.toggle('collapsed', collapsed);
        this.propertiesArrow.textContent = collapsed ? '▲' : '▼';
        if (window.appResize) window.appResize();
    }

    requestRender() {
        if (this._renderQueued) return;
        this._renderQueued = true;
        requestAnimationFrame(() => {
            this._renderQueued = false;
            this.render();
        });
    }

    _selectedKey() {
        const selected = this.selectionManager && this.selectionManager.selectedInstance;
        if (!selected) return '';
        if (selected.isTerrainSelection) return selected.id === 'ground' ? 'ground' : 'terrain';
        return `asset:${selected.id}`;
    }

    render() {
        if (!this.list) return;
        const selectedKey = this._selectedKey();
        this.list.innerHTML = '';

        const terrainData = this.terrainManager && this.terrainManager.terrainData;
        const groundLabel = terrainData ? 'Terrain' : 'Ground';
        const groundMeta = terrainData
            ? `${terrainData.mode || 'terrain'} · ${terrainData.size ? `${terrainData.size.x}×${terrainData.size.y}×${terrainData.size.z}` : ''}`
            : 'Default flat ground';

        const groundRow = this._createRow({
            key: terrainData ? 'terrain' : 'ground',
            icon: terrainData ? '🌄' : '🟩',
            title: groundLabel,
            meta: groundMeta,
            selected: selectedKey === (terrainData ? 'terrain' : 'ground')
        });
        groundRow.addEventListener('click', () => {
            const selection = this.terrainManager && this.terrainManager.getSelectionObject();
            if (selection) this.selectionManager.selectInstance(selection);
        });
        this.list.appendChild(groundRow);

        const separator = document.createElement('div');
        separator.className = 'explorer-separator';
        this.list.appendChild(separator);

        const instances = this.assetManager ? this.assetManager.instances : [];
        if (instances.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'explorer-empty';
            empty.textContent = 'No assets placed';
            this.list.appendChild(empty);
            return;
        }

        instances.forEach((inst, index) => {
            const displayNumber = index + 1;
            const row = this._createRow({
                key: `asset:${inst.id}`,
                icon: '📦',
                title: inst.name,
                meta: `#${displayNumber} · (${Math.round(inst.position.x)}, ${Math.round(inst.position.y)}, ${Math.round(inst.position.z)})`,
                selected: selectedKey === `asset:${inst.id}`
            });
            row.addEventListener('click', () => {
                this.selectionManager.selectInstance(inst);
            });
            this.list.appendChild(row);
        });
    }

    _createRow({ key, icon, title, meta, selected }) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'explorer-row';
        if (selected) row.classList.add('selected');
        row.dataset.explorerKey = key;
        row.innerHTML = `
            <span class="explorer-icon">${icon}</span>
            <span class="explorer-text">
                <span class="explorer-title"></span>
                <span class="explorer-meta"></span>
            </span>
        `;
        row.querySelector('.explorer-title').textContent = title;
        row.querySelector('.explorer-meta').textContent = meta || '';
        return row;
    }
};
