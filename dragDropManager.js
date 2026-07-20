/**
 * dragDropManager.js — Drag & Drop et ghost preview (Babylon)
 */

window.DragDropManager = class DragDropManager {
    constructor(scene, assetManager, selectionManager, canvas) {
        this.scene = scene;
        this.assetManager = assetManager;
        this.selectionManager = selectionManager;
        this.canvas = canvas;

        this.ghostMesh = null;
        this.activeSchemData = null;
        this.activeAssetName = null;
        this.isPlacing = false;

        this._setupDragAndDrop();
        this._setupPlacement();
    }

    _setupDragAndDrop() {
        this.canvas.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
        });

        this.canvas.addEventListener('drop', (e) => {
            e.preventDefault();
            if (e.dataTransfer.files.length === 0) return;

            const file = e.dataTransfer.files[0];
            const reader = new FileReader();
            reader.onload = (evt) => {
                try {
                    const parsed = window.parseSchem(evt.target.result);
                    const name = file.name.replace(/\.[^/.]+$/, "");
                    this.startPlacement(name, parsed);
                } catch (err) {
                    console.error("Erreur lecture schematic :", err);
                }
            };
            reader.readAsText(file);
        });
    }

    _createGhostMesh(sourceMesh) {
        let ghost = null;

        // Babylon v9 : on clone au lieu d'utiliser createInstance, sinon `visibility = 0.5`
        // déclenche le warning "Setting visibility on an instanced mesh has no effect".
        if (sourceMesh && typeof sourceMesh.clone === 'function') {
            ghost = sourceMesh.clone("ghost_mesh");
        }

        if (!ghost) return null;

        ghost.setEnabled(true);
        ghost.isVisible = true;
        ghost.visibility = 1;
        ghost.isPickable = false;
        // clone() hérite des metadata du template : on corrige explicitement les flags.
        ghost.metadata = Object.assign({}, ghost.metadata, {
            isAssetTemplate: false,
            isGhost: true
        });

        // Matériau transparent dédié au ghost, sans modifier le matériau des vrais assets.
        if (sourceMesh.material && typeof sourceMesh.material.clone === 'function') {
            const ghostMat = sourceMesh.material.clone("ghost_material");
            ghostMat.alpha = 0.45;
            ghostMat.needDepthPrePass = true;
            ghostMat.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND;
            ghost.material = ghostMat;
        } else if (ghost.material) {
            ghost.material.alpha = 0.45;
            ghost.material.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND;
        }

        return ghost;
    }

    startPlacement(name, schemData) {
        this.cancelPlacement();
        this.activeSchemData = schemData;
        this.activeAssetName = name;
        this.isPlacing = true;

        let sourceMesh = this.assetManager.templates[name];
        if (!sourceMesh) {
            sourceMesh = window.createMeshFromSchem(this.scene, schemData);
            if (sourceMesh) this.assetManager.registerTemplate(name, sourceMesh, schemData);
        }
        if (!sourceMesh) return;

        this.ghostMesh = this._createGhostMesh(sourceMesh);
        if (!this.ghostMesh) {
            this.cancelPlacement();
            return;
        }
    }

    _setupPlacement() {
        const origMove = this.scene.onPointerMove;
        this.scene.onPointerMove = (evt, pickResult) => {
            if (origMove) origMove(evt, pickResult);
            if (!this.isPlacing || !this.ghostMesh) return;

            const groundPick = this.scene.pick(this.scene.pointerX, this.scene.pointerY, (m) => m.name === "ground" || m.name === "grid" || (m.metadata && m.metadata.isTerrain));
            if (groundPick.hit && groundPick.pickedPoint) {
                this.ghostMesh.position.set(
                    Math.round(groundPick.pickedPoint.x),
                    Math.round(groundPick.pickedPoint.y),
                    Math.round(groundPick.pickedPoint.z)
                );
            }
        };

        const origDown = this.scene.onPointerDown;
        this.scene.onPointerDown = (evt, pickResult) => {
            if (this.isPlacing) {
                if (evt.button !== 0) return;

                const groundPick = this.scene.pick(this.scene.pointerX, this.scene.pointerY, (m) => m.name === "ground" || m.name === "grid" || (m.metadata && m.metadata.isTerrain));
                if (groundPick.hit && groundPick.pickedPoint) {
                    const x = Math.round(this.ghostMesh.position.x);
                    const y = Math.round(this.ghostMesh.position.y);
                    const z = Math.round(this.ghostMesh.position.z);
                    const rotY = Math.round(this.ghostMesh.rotation.y * (180 / Math.PI));

                    const inst = this.assetManager.addInstance(this.activeAssetName, new BABYLON.Vector3(x, y, z), rotY);
                    if (inst) this.selectionManager.selectInstance(inst);
                    this.cancelPlacement();
                }
                return;
            }

            if (origDown) origDown(evt, pickResult);
        };

        window.addEventListener('keydown', (e) => {
            if (e.code === 'Escape' && this.isPlacing) this.cancelPlacement();
        });
    }

    cancelPlacement() {
        if (this.ghostMesh) {
            if (this.ghostMesh.material && this.ghostMesh.material.name === "ghost_material") {
                this.ghostMesh.material.dispose();
            }
            this.ghostMesh.dispose();
            this.ghostMesh = null;
        }
        this.isPlacing = false;
        this.activeSchemData = null;
        this.activeAssetName = null;
    }
};
