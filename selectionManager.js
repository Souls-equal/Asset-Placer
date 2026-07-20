/**
 * selectionManager.js — Sélection + déplacements snapés façon éditeur 3D
 *
 * v3.8 :
 *  - les flèches/planes du gizmo snapent pendant le déplacement, pas seulement au relâchement ;
 *  - cliquer pour sélectionner ne déplace plus l'asset ;
 *  - le drag direct démarre seulement après un seuil de mouvement ;
 *  - suppression de l'inertie/lissage : l'asset suit directement la position snapée ;
 *  - conservation du point d'ancrage : l'endroit attrapé sur l'asset reste sous le curseur.
 */

window.SelectionManager = class SelectionManager {
    constructor(scene, assetManager) {
        this.scene = scene;
        this.assetManager = assetManager;
        this.selectedInstance = null;
        this.onSelectionChanged = null;

        this.gridSize = 1;
        this.dragStartThresholdPx = 5;

        this.gizmoManager = new BABYLON.GizmoManager(scene);
        this.gizmoManager.usePointerToAttachGizmos = false;
        this.gizmoManager.clearGizmoOnEmptyPointerEvent = false;
        this.gizmoManager.positionGizmoEnabled = false;
        this.gizmoManager.rotationGizmoEnabled = false;
        this.gizmoManager.scaleGizmoEnabled = false;
        this.gizmoManager.boundingBoxGizmoEnabled = false;

        // Babylon v9 a provoqué `thinHighlightLayer.ts:491` dans ce projet.
        // On garde donc un contour simple et robuste via edgesRendering.
        this.highlightLayer = null;
        this._highlightLayerUsable = false;

        // --- États de déplacement ---
        this._pendingDrag = null;      // clic sur asset, pas encore transformé en drag
        this._isDragging = false;      // drag custom sur le mesh avec la souris
        this._isUsingGizmo = false;    // drag avec flèches/planes du gizmo Babylon
        this._dragFootOffset = 0;
        this._dragAnchorOffset = new BABYLON.Vector3(0, 0, 0);
        this._dragTargetPos = null;
        this._dragCurrentPos = null;
        this._observedPositionGizmo = null;
        this._nativeGizmoSnappingEnabled = false;

        this._setupPointerEvents();
        this._setupRenderLoop();
        this._setupGlobalReleaseGuards();
    }

    _roundToGrid(value) {
        return Math.round(value / this.gridSize) * this.gridSize;
    }

    _snapVectorToGrid(vec) {
        vec.x = this._roundToGrid(vec.x);
        vec.y = this._roundToGrid(vec.y);
        vec.z = this._roundToGrid(vec.z);
        return vec;
    }

    // Empêche de sélectionner "à travers" les panneaux HTML.
    _isOverUI(evt) {
        return !!(evt.target && (
            evt.target.closest('#editor-ui') ||
            evt.target.closest('#properties-sidebar') ||
            evt.target.closest('#explorer-sidebar') ||
            evt.target.closest('#explorer-reopen-tab') ||
            evt.target.closest('.modal') ||
            evt.target.closest('#library-sidebar') ||
            evt.target.closest('#library-reopen-tab')
        ));
    }

    _isPointerOnGizmo() {
        const utilityLayer = BABYLON.UtilityLayerRenderer.DefaultUtilityLayer;
        if (!utilityLayer || !utilityLayer.utilityLayerScene) return false;

        try {
            const pickGizmo = utilityLayer.utilityLayerScene.pick(this.scene.pointerX, this.scene.pointerY);
            return !!(pickGizmo && pickGizmo.hit && pickGizmo.pickedMesh);
        } catch (err) {
            return false;
        }
    }

    _isRealAssetMesh(mesh) {
        if (!mesh) return false;
        if (!mesh.isEnabled() || !mesh.isVisible || mesh.isPickable === false) return false;
        return !!this.assetManager.getInstanceByMesh(mesh);
    }

    _pickAssetUnderPointerDetails() {
        const pick = this.scene.pick(this.scene.pointerX, this.scene.pointerY, (mesh) => this._isRealAssetMesh(mesh));
        if (!pick || !pick.hit || !pick.pickedMesh) return null;

        const instance = this.assetManager.getInstanceByMesh(pick.pickedMesh);
        if (!instance) return null;

        return { instance, pick };
    }

    _isGroundUnderPointer() {
        const pick = this.scene.pick(this.scene.pointerX, this.scene.pointerY, (mesh) => {
            return !!(mesh && (mesh.name === 'ground' || (mesh.metadata && mesh.metadata.isTerrain)));
        });
        return !!(pick && pick.hit);
    }

    _highlightMesh(mesh) {
        if (!mesh) return;

        try {
            if (typeof mesh.enableEdgesRendering === 'function') {
                mesh.enableEdgesRendering();
                mesh.edgesWidth = 4.0;
                mesh.edgesColor = new BABYLON.Color4(0.3, 1.0, 0.3, 1.0);
            }
        } catch (err) {
            console.warn("Impossible d'activer le contour de sélection.", err);
        }
    }

    _clearHighlight(mesh) {
        if (!mesh) return;

        try {
            if (typeof mesh.disableEdgesRendering === 'function') {
                mesh.disableEdgesRendering();
            }
        } catch (err) {
            // silencieux : ne jamais bloquer l'éditeur à cause du contour
        }
    }

    _syncSelectedInstanceFromMesh(notify = false) {
        if (!this.selectedInstance || !this.selectedInstance.mesh) return;

        const mesh = this.selectedInstance.mesh;
        mesh.computeWorldMatrix(true);

        if (typeof this.selectedInstance.syncFromMesh === 'function') {
            this.selectedInstance.syncFromMesh();
        } else {
            this.selectedInstance._position.copyFrom(mesh.position);
            this.selectedInstance._rotationY = (Math.round(BABYLON.Tools.ToDegrees(mesh.rotation.y)) % 360 + 360) % 360;
        }

        if (notify && this.onSelectionChanged) {
            this.onSelectionChanged(this.selectedInstance);
        }
    }

    _snapSelectedToGrid(notify = true) {
        if (!this.selectedInstance || !this.selectedInstance.mesh) return;

        const mesh = this.selectedInstance.mesh;
        const x = this._roundToGrid(mesh.position.x);
        const y = this._roundToGrid(mesh.position.y);
        const z = this._roundToGrid(mesh.position.z);

        this.selectedInstance.setPosition(x, y, z);
        if (this.gizmoManager) this.gizmoManager.attachToMesh(this.selectedInstance.mesh);

        if (notify && this.onSelectionChanged) {
            this.onSelectionChanged(this.selectedInstance);
        }
    }

    _snapSelectedDuringGizmo(notify = false) {
        if (!this.selectedInstance || !this.selectedInstance.mesh) return;

        const mesh = this.selectedInstance.mesh;

        if (this._nativeGizmoSnappingEnabled) {
            // Avec snapDistance natif, Babylon ne déplace déjà le mesh que par pas de grille.
            // On synchronise simplement l'AssetInstance sans réécrire la position à chaque frame,
            // pour éviter de freiner/bloquer le drag interne du gizmo.
            this._syncSelectedInstanceFromMesh(notify);
            return;
        }

        // Fallback si snapDistance n'est pas disponible : affichage snapé en direct.
        const snapped = new BABYLON.Vector3(
            this._roundToGrid(mesh.position.x),
            this._roundToGrid(mesh.position.y),
            this._roundToGrid(mesh.position.z)
        );

        mesh.position.copyFrom(snapped);
        if (typeof this.selectedInstance.syncFromMesh === 'function') {
            this.selectedInstance.syncFromMesh();
        } else {
            this.selectedInstance._position.copyFrom(snapped);
        }

        if (notify && this.onSelectionChanged) {
            this.onSelectionChanged(this.selectedInstance);
        }
    }

    _configureGizmoSnapping(positionGizmo) {
        if (!positionGizmo) return;

        // Babylon PositionGizmo expose snapDistance sur les AxisDragGizmo/PlaneDragGizmo.
        // Si une future version change l'API, les try/catch évitent de casser l'éditeur.
        const gizmoParts = [
            positionGizmo.xGizmo,
            positionGizmo.yGizmo,
            positionGizmo.zGizmo,
            positionGizmo.xPlaneGizmo,
            positionGizmo.yPlaneGizmo,
            positionGizmo.zPlaneGizmo
        ].filter(Boolean);

        this._nativeGizmoSnappingEnabled = false;

        gizmoParts.forEach((part) => {
            try {
                part.snapDistance = this.gridSize;
                this._nativeGizmoSnappingEnabled = true;
            } catch (err) {
                // API non disponible : fallback assuré par _snapSelectedDuringGizmo().
            }
        });
    }

    _bindPositionGizmoObservers() {
        const positionGizmo = this.gizmoManager && this.gizmoManager.gizmos
            ? this.gizmoManager.gizmos.positionGizmo
            : null;

        if (!positionGizmo) return;
        this._configureGizmoSnapping(positionGizmo);

        if (this._observedPositionGizmo === positionGizmo) return;
        this._observedPositionGizmo = positionGizmo;

        const gizmoParts = [
            positionGizmo.xGizmo,
            positionGizmo.yGizmo,
            positionGizmo.zGizmo,
            positionGizmo.xPlaneGizmo,
            positionGizmo.yPlaneGizmo,
            positionGizmo.zPlaneGizmo
        ].filter(Boolean);

        gizmoParts.forEach((part) => {
            const dragBehavior = part.dragBehavior;
            if (!dragBehavior) return;

            dragBehavior.onDragStartObservable.add(() => {
                this._pendingDrag = null;
                this._isUsingGizmo = true;
                this._isDragging = false;
                window.isDraggingGizmo = true; // bloque la caméra pendant manipulation gizmo
                this._syncSelectedInstanceFromMesh(false);
                this._snapSelectedDuringGizmo(false);
            });

            dragBehavior.onDragObservable.add(() => {
                if (!this.selectedInstance) return;
                this._snapSelectedDuringGizmo(false);
            });

            dragBehavior.onDragEndObservable.add(() => {
                if (!this.selectedInstance) return;
                this._isUsingGizmo = false;
                window.isDraggingGizmo = false;
                this._snapSelectedToGrid(true);
            });
        });
    }

    /**
     * Calcule le point de surface sous la souris.
     * Exclut l'objet sélectionné pour éviter l'auto-pick pendant un drag custom.
     */
    _pickSurfaceUnderPointer() {
        const excludeMesh = this.selectedInstance ? this.selectedInstance.mesh : null;

        const surfacePredicate = (m) => {
            if (!m || m === excludeMesh) return false;
            if (!m.isEnabled() || !m.isVisible) return false;
            if (m.metadata && (m.metadata.isAssetTemplate || m.metadata.isGhost)) return false;
            if (m.name === 'grid') return false;
            return true;
        };

        const camPick = this.scene.pick(this.scene.pointerX, this.scene.pointerY, surfacePredicate);
        if (!camPick.hit || !camPick.pickedPoint) return null;

        const origin = new BABYLON.Vector3(camPick.pickedPoint.x, 500, camPick.pickedPoint.z);
        const downRay = new BABYLON.Ray(origin, new BABYLON.Vector3(0, -1, 0), 1000);
        const downPick = this.scene.pickWithRay(downRay, surfacePredicate);

        if (downPick && downPick.hit && downPick.pickedPoint) {
            return downPick.pickedPoint;
        }

        return camPick.pickedPoint;
    }

    _preparePendingDrag(evt, instance, pick) {
        const pickedPoint = pick && pick.pickedPoint
            ? pick.pickedPoint.clone()
            : instance.mesh.position.clone();

        // L'offset conserve le point d'ancrage : l'endroit exact attrapé reste sous la souris.
        this._dragAnchorOffset.set(
            instance.position.x - pickedPoint.x,
            0,
            instance.position.z - pickedPoint.z
        );

        instance.mesh.computeWorldMatrix(true);
        const bb = instance.mesh.getBoundingInfo().boundingBox;
        this._dragFootOffset = instance.mesh.position.y - bb.minimumWorld.y;

        this._pendingDrag = {
            instance,
            startClientX: evt.clientX,
            startClientY: evt.clientY
        };
    }

    _maybeStartPendingDrag(evt) {
        if (!this._pendingDrag || this._isDragging || this._isUsingGizmo) return false;

        const dx = evt.clientX - this._pendingDrag.startClientX;
        const dy = evt.clientY - this._pendingDrag.startClientY;
        const distance = Math.hypot(dx, dy);

        if (distance < this.dragStartThresholdPx) {
            return false;
        }

        this._startSceneDrag(this._pendingDrag.instance);
        this._pendingDrag = null;
        return true;
    }

    _startSceneDrag(instance) {
        if (!instance || !instance.mesh) return;

        this._isDragging = true;
        this._isUsingGizmo = false;
        window.isDraggingGizmo = true;
        this._dragTargetPos = instance.position.clone();
        this._dragCurrentPos = instance.position.clone();
    }

    _finishSceneDrag() {
        this._pendingDrag = null;

        if (!this._isDragging) return;

        this._isDragging = false;
        window.isDraggingGizmo = false;

        if (this.selectedInstance && this._dragCurrentPos) {
            const p = this._dragCurrentPos;
            this.selectedInstance.setPosition(
                this._roundToGrid(p.x),
                this._roundToGrid(p.y),
                this._roundToGrid(p.z)
            );
            if (this.gizmoManager) this.gizmoManager.attachToMesh(this.selectedInstance.mesh);
            if (this.onSelectionChanged) this.onSelectionChanged(this.selectedInstance);
        }
    }

    _setupPointerEvents() {
        this.scene.onPointerDown = (evt) => {
            if (evt.button !== 0) return;
            if (this._isOverUI(evt)) return;

            // Si on clique une flèche/plane du gizmo, on laisse Babylon gérer entièrement.
            if (this._isPointerOnGizmo()) {
                this._pendingDrag = null;
                this._isDragging = false;
                this._isUsingGizmo = true;
                window.isDraggingGizmo = true;
                return;
            }

            const details = this._pickAssetUnderPointerDetails();
            if (details && details.instance) {
                this.selectInstance(details.instance);

                // Important : sélectionner ne doit PAS déplacer. On prépare seulement un drag éventuel.
                this._preparePendingDrag(evt, details.instance, details.pick);
                return;
            }

            if (this._isGroundUnderPointer()) {
                this._pendingDrag = null;
                this.deselect();
            }
        };

        this.scene.onPointerMove = (evt) => {
            if (this._isUsingGizmo) {
                this._snapSelectedDuringGizmo(false);
                return;
            }

            this._maybeStartPendingDrag(evt);

            if (!this._isDragging || !this.selectedInstance) return;
            window.isDraggingGizmo = true;

            const surfacePoint = this._pickSurfaceUnderPointer();
            if (!surfacePoint) return;

            const targetX = this._roundToGrid(surfacePoint.x + this._dragAnchorOffset.x);
            const targetZ = this._roundToGrid(surfacePoint.z + this._dragAnchorOffset.z);
            const targetY = this._roundToGrid(surfacePoint.y + this._dragFootOffset);

            this._dragTargetPos.set(targetX, targetY, targetZ);
            this._dragCurrentPos.copyFrom(this._dragTargetPos);
        };

        this.scene.onPointerUp = () => {
            if (this._isUsingGizmo) {
                this._snapSelectedDuringGizmo(false);
            }
            this._finishSceneDrag();
        };
    }

    _setupGlobalReleaseGuards() {
        const finish = () => {
            if (this._isUsingGizmo) {
                this._isUsingGizmo = false;
                window.isDraggingGizmo = false;
                this._snapSelectedToGrid(true);
            }
            this._finishSceneDrag();
            this._pendingDrag = null;
        };

        window.addEventListener('pointerup', finish);
        window.addEventListener('mouseup', finish);
        window.addEventListener('blur', finish);
    }

    _setupRenderLoop() {
        this.scene.onBeforeRenderObservable.add(() => {
            if (this._isUsingGizmo) {
                this._snapSelectedDuringGizmo(false);
                return;
            }

            if (this._isDragging && this.selectedInstance && this._dragTargetPos && this._dragCurrentPos) {
                // Pas de smoothing/inertie : déplacement direct sur la position snapée.
                this.selectedInstance.mesh.position.copyFrom(this._dragCurrentPos);
                this.selectedInstance._position.copyFrom(this._dragCurrentPos);
                if (this.gizmoManager) this.gizmoManager.attachToMesh(this.selectedInstance.mesh);
                return;
            }

            if (this.selectedInstance) {
                this._syncSelectedInstanceFromMesh(false);
            }
        });
    }

    selectInstance(instance) {
        if (!instance || !instance.mesh) return;

        if (this.selectedInstance === instance) {
            this.gizmoManager.attachToMesh(instance.mesh);
            this.gizmoManager.positionGizmoEnabled = true;
            this._bindPositionGizmoObservers();
            return;
        }

        if (this.selectedInstance) {
            this._clearHighlight(this.selectedInstance.mesh);
        }

        this.selectedInstance = instance;

        this.gizmoManager.attachToMesh(instance.mesh);
        this.gizmoManager.positionGizmoEnabled = true;
        this.gizmoManager.rotationGizmoEnabled = false;
        this._bindPositionGizmoObservers();

        this._highlightMesh(instance.mesh);

        if (this.onSelectionChanged) this.onSelectionChanged(instance);
    }

    deselect() {
        if (!this.selectedInstance) return;

        this._clearHighlight(this.selectedInstance.mesh);
        this._pendingDrag = null;
        this._isDragging = false;
        this._isUsingGizmo = false;
        window.isDraggingGizmo = false;

        this.selectedInstance = null;
        this.gizmoManager.attachToMesh(null);
        this.gizmoManager.positionGizmoEnabled = false;
        this.gizmoManager.rotationGizmoEnabled = false;

        if (this.onSelectionChanged) this.onSelectionChanged(null);
    }
};
