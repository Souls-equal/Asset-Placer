/**
 * inputManager.js — Keyboard controls for selected objects.
 *
 * - A/E or Q/E depending on keyboard layout: rotate selected asset.
 * - Arrow keys: move selected asset on the X/Z grid.
 * - Delete / Backspace: delete selected asset.
 */

window.InputManager = class InputManager {
    constructor(scene, selectionManager) {
        this.scene = scene;
        this.selectionManager = selectionManager;
        this.gridSize = 1;

        window.addEventListener('keydown', (evt) => {
            const inst = this.selectionManager.selectedInstance;
            if (!inst) return;
            if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;

            const code = evt.code;
            const key = evt.key.toLowerCase();

            // Delete / Suppr removes the selected asset.
            // Backspace is also supported for convenience, but terrain/ground is protected.
            if (code === 'Delete' || code === 'Backspace' || key === 'delete') {
                evt.preventDefault();
                if (inst.isTerrainSelection) return;

                const id = inst.id;
                this.selectionManager.deselect();
                if (this.selectionManager.assetManager) {
                    this.selectionManager.assetManager.removeInstance(id);
                }
                return;
            }

            const isQwerty = window.I18N && window.I18N.keyboard === 'qwerty';
            const rotateLeftKey = isQwerty ? 'q' : 'a';

            if (key === rotateLeftKey) {
                evt.preventDefault();
                inst.setRotation(inst.rotationY - 90);
                if (this.selectionManager.onSelectionChanged) this.selectionManager.onSelectionChanged(inst);
            } else if (key === 'e') {
                evt.preventDefault();
                inst.setRotation(inst.rotationY + 90);
                if (this.selectionManager.onSelectionChanged) this.selectionManager.onSelectionChanged(inst);
            }

            let dx = 0, dz = 0;
            if (code === 'ArrowUp') dz = this.gridSize;
            else if (code === 'ArrowDown') dz = -this.gridSize;
            else if (code === 'ArrowLeft') dx = -this.gridSize;
            else if (code === 'ArrowRight') dx = this.gridSize;

            if (dx !== 0 || dz !== 0) {
                const pos = inst.position;
                const newX = Math.round((pos.x + dx) / this.gridSize) * this.gridSize;
                const newZ = Math.round((pos.z + dz) / this.gridSize) * this.gridSize;
                inst.setPosition(newX, pos.y, newZ);
                if (this.selectionManager.gizmoManager) {
                    this.selectionManager.gizmoManager.attachToMesh(inst.mesh);
                }
                if (this.selectionManager.onSelectionChanged) this.selectionManager.onSelectionChanged(inst);
            }
        });
    }
};
