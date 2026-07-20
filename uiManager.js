/**
 * uiManager.js — Docked Properties panel (inside Explorer, Babylon)
 */

window.UIManager = class UIManager {
    constructor(scene, assetManager, selectionManager, dragDropManager) {
        this.scene = scene;
        this.assetManager = assetManager;
        this.selectionManager = selectionManager;
        this.dragDropManager = dragDropManager;
        this._createSidebar();
        this._bindSelectionCallback();
    }

    _createSidebar() {
        const sidebar = document.createElement('div');
        sidebar.id = 'properties-sidebar';
        sidebar.className = 'properties-docked hidden';
        sidebar.innerHTML = `
            <div class="sidebar-body properties-docked-body">
                <div class="prop-group"><label data-i18n="name">Name:</label><span id="prop-name">-</span></div>
                <div class="prop-group"><label data-i18n="positionX">Position X:</label><input type="number" id="prop-x" step="1"></div>
                <div class="prop-group"><label data-i18n="positionY">Position Y:</label><input type="number" id="prop-y" step="1"></div>
                <div class="prop-group"><label data-i18n="positionZ">Position Z:</label><input type="number" id="prop-z" step="1"></div>
                <div class="prop-group"><label data-i18n="rotation">Rotation Y:</label>
                    <select id="prop-rot">
                        <option value="0">0°</option>
                        <option value="90">90°</option>
                        <option value="180">180°</option>
                        <option value="270">270°</option>
                    </select>
                </div>
                <div class="prop-actions">
                    <button id="btn-duplicate" class="ui-btn" data-i18n="duplicate">📋 Duplicate</button>
                    <button id="btn-delete" class="ui-btn danger" data-i18n="delete">🗑️ Delete</button>
                </div>
            </div>
        `;

        const dockSlot = document.getElementById('explorer-properties-content');
        const overlay = document.getElementById('ui-overlay') || document.body;
        (dockSlot || overlay).appendChild(sidebar);

        this.updateTexts();
        this._bindSidebarEvents();
    }

    updateTexts() {
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            el.textContent = window.I18N.t(key);
        });
        document.querySelectorAll('[data-i18n-title]').forEach(el => {
            const key = el.getAttribute('data-i18n-title');
            el.title = window.I18N.t(key);
            el.setAttribute('aria-label', window.I18N.t(key));
        });
        document.documentElement.lang = window.I18N.lang;
    }

    _bindSelectionCallback() {
        this.selectionManager.onSelectionChanged = (instance) => {
            const sidebar = document.getElementById('properties-sidebar');
            if (instance) {
                sidebar.classList.remove('hidden');
                this.updatePropertiesValues(instance);
            } else {
                sidebar.classList.add('hidden');
            }
        };
    }

    updatePropertiesValues(instance) {
        if (!instance) return;
        document.getElementById('prop-name').textContent = instance.displayName || instance.name;
        document.getElementById('prop-x').value = Math.round(instance.position.x);
        document.getElementById('prop-y').value = Math.round(instance.position.y);
        document.getElementById('prop-z').value = Math.round(instance.position.z);
        document.getElementById('prop-rot').value = instance.rotationY;

        const isTerrain = !!instance.isTerrainSelection;
        document.getElementById('prop-rot').disabled = isTerrain;
        document.getElementById('btn-duplicate').disabled = isTerrain;
        document.getElementById('btn-delete').disabled = isTerrain;
    }

    _bindSidebarEvents() {
        const inputX = document.getElementById('prop-x');
        const inputY = document.getElementById('prop-y');
        const inputZ = document.getElementById('prop-z');
        const selectRot = document.getElementById('prop-rot');

        const updateFromInputs = () => {
            const inst = this.selectionManager.selectedInstance;
            if (!inst) return;
            const x = parseFloat(inputX.value) || 0;
            const y = parseFloat(inputY.value) || 0;
            const z = parseFloat(inputZ.value) || 0;
            const rot = parseInt(selectRot.value) || 0;
            inst.setPosition(x, y, z);
            inst.setRotation(rot);
            if (this.selectionManager.gizmoManager) this.selectionManager.gizmoManager.attachToMesh(inst.mesh);
        };

        inputX.addEventListener('input', updateFromInputs);
        inputY.addEventListener('input', updateFromInputs);
        inputZ.addEventListener('input', updateFromInputs);
        selectRot.addEventListener('change', updateFromInputs);

        document.getElementById('btn-delete').addEventListener('click', () => {
            const inst = this.selectionManager.selectedInstance;
            if (inst && !inst.isTerrainSelection) {
                this.assetManager.removeInstance(inst.id);
                this.selectionManager.deselect();
            }
        });

        document.getElementById('btn-duplicate').addEventListener('click', () => {
            const inst = this.selectionManager.selectedInstance;
            if (inst && !inst.isTerrainSelection) {
                const newPos = inst.position.clone().add(new BABYLON.Vector3(2, 0, 2));
                const newInst = this.assetManager.addInstance(inst.name, newPos, inst.rotationY);
                if (newInst) this.selectionManager.selectInstance(newInst);
            }
        });
    }
};
