/**
 * camera.js — Configuration FreeCamera (ZQSD/WASD uniquement, flèches clavier retirées de la caméra)
 */

window.setupCamera = function(scene, canvas) {
    const camera = new BABYLON.FreeCamera("camera", new BABYLON.Vector3(0, 15, -20), scene);
    camera.setTarget(BABYLON.Vector3.Zero());

    window.updateCameraKeys = function() {
        if (window.I18N && window.I18N.keyboard === 'qwerty') {
            camera.keysUp = [87];     // W
            camera.keysDown = [83];   // S
            camera.keysLeft = [65];   // A
            camera.keysRight = [68];  // D
        } else {
            // AZERTY : Z=90, Q=81, S=83, D=68 (Flèches retirées pour être réservées au déplacement d'assets)
            camera.keysUp = [90, 87]; 
            camera.keysDown = [83];   
            camera.keysLeft = [81];   
            camera.keysRight = [68];  
        }
    };
    window.updateCameraKeys();

    camera.inputs.removeByType("FreeCameraKeyboardInput");

    const inputMap = {};

    const focusSelected = () => {
        const selectionManager = window.appSelectionManager;
        const selected = selectionManager && selectionManager.selectedInstance;
        if (!selected || !selected.mesh) return;

        selected.mesh.computeWorldMatrix(true);
        let center = selected.mesh.getAbsolutePosition ? selected.mesh.getAbsolutePosition().clone() : selected.mesh.position.clone();
        let radius = 8;

        try {
            const bb = selected.mesh.getBoundingInfo().boundingBox;
            center = bb.centerWorld.clone();
            radius = Math.max(4, bb.extendSizeWorld.length());
        } catch (err) {
            // Fallback below.
        }

        if (selected.isTerrainSelection && window.appTerrainManager && typeof window.appTerrainManager.getTerrainFocusInfo === 'function') {
            const info = window.appTerrainManager.getTerrainFocusInfo();
            const size = info.size || { x: 300, y: 1, z: 300 };
            const maxXZ = Math.max(size.x || 300, size.z || 300);
            const height = Math.max(1, size.y || 1);

            // Special terrain framing: go to the middle of the terrain and a bit above it,
            // instead of framing the tiny invisible selection proxy.
            const target = info.topCenter.clone();
            target.y = info.maxY - Math.min(height * 0.35, 40);

            const distance = Math.min(900, Math.max(90, maxXZ * 0.18));
            const above = Math.min(650, Math.max(55, height * 1.8 + maxXZ * 0.04));
            camera.position.set(info.topCenter.x, info.maxY + above, info.topCenter.z - distance);
            camera.setTarget(target);
            return;
        }

        const forward = camera.getDirection(BABYLON.Axis.Z).normalize();
        const distance = Math.max(12, radius * 2.2);
        const targetPosition = center.subtract(forward.scale(distance));
        targetPosition.y = center.y + Math.max(8, radius * 0.55);

        camera.position.copyFrom(targetPosition);
        camera.setTarget(center);
    };

    window.addEventListener('keydown', (evt) => {
        if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;

        // On stocke à la fois evt.key et evt.code :
        // - evt.key varie selon le clavier/langue ;
        // - evt.code est stable pour Space / ControlLeft / ControlRight.
        inputMap[evt.key.toLowerCase()] = true;
        inputMap[evt.code] = true;

        // F frames the currently selected object, like Roblox Studio / common 3D editors.
        if (evt.key.toLowerCase() === 'f') {
            evt.preventDefault();
            focusSelected();
        }

        // Empêche Space de scroller la page / déclencher un bouton focus.
        if (evt.code === 'Space') {
            evt.preventDefault();
        }
    });

    window.addEventListener('keyup', (evt) => {
        inputMap[evt.key.toLowerCase()] = false;
        inputMap[evt.code] = false;
    });

    window.addEventListener('blur', () => {
        for (let key in inputMap) {
            inputMap[key] = false;
        }
    });

    scene.onBeforeRenderObservable.add(() => {
        const speed = 0.5;
        const forward = camera.getDirection(BABYLON.Axis.Z);
        const right = camera.getDirection(BABYLON.Axis.X);

        forward.normalize();
        right.normalize();

        const isQwerty = window.I18N && window.I18N.keyboard === 'qwerty';

        if (inputMap['z'] || inputMap['w']) {
            camera.position.addInPlace(forward.scale(speed));
        }
        if (inputMap['s']) {
            camera.position.addInPlace(forward.scale(-speed));
        }
        if ((!isQwerty && inputMap['q']) || (isQwerty && inputMap['a'])) {
            camera.position.addInPlace(right.scale(-speed));
        }
        if (inputMap['d']) {
            camera.position.addInPlace(right.scale(speed));
        }

        // Déplacement vertical monde :
        // - Space monte simplement la caméra.
        // - Ctrl descend simplement la caméra.
        // Contrairement au zoom, ce mouvement ne dépend pas de l'orientation de la caméra.
        if (inputMap['Space'] || inputMap[' ']) {
            camera.position.y += speed;
        }
        if (inputMap['ControlLeft'] || inputMap['ControlRight'] || inputMap['control']) {
            camera.position.y -= speed;
        }
    });

    camera.speed = 0.5;
    camera.angularSensibility = 500;

    // Inertie native de Babylon (TargetCamera) : à chaque frame le moteur fait
    // rotation += cameraRotation, puis cameraRotation *= inertia.
    // Plus la valeur est proche de 1, plus la caméra "glisse" après le relâchement.
    // 0.6 donne un léger amorti naturel sans sensation de flottement excessif.
    camera.inertia = 0.6;

    let isLeftMouseDown = false;
    let isRightMouseDown = false;
    let previousMousePosition = { x: 0, y: 0 };

    canvas.addEventListener("pointerdown", (evt) => {
        if (window.isDraggingGizmo) return;

        const utilityLayer = BABYLON.UtilityLayerRenderer.DefaultUtilityLayer;
        if (utilityLayer && utilityLayer.utilityLayerScene) {
            const pickGizmo = utilityLayer.utilityLayerScene.pick(scene.pointerX, scene.pointerY);
            if (pickGizmo.hit && pickGizmo.pickedMesh) {
                return;
            }
        }

        if (evt.button === 0) isLeftMouseDown = true;
        if (evt.button === 2) isRightMouseDown = true;
        previousMousePosition = { x: evt.clientX, y: evt.clientY };
    });

    canvas.addEventListener("pointerup", (evt) => {
        if (evt.button === 0) isLeftMouseDown = false;
        if (evt.button === 2) isRightMouseDown = false;
    });

    canvas.addEventListener("contextmenu", (evt) => evt.preventDefault());

    canvas.addEventListener("pointermove", (evt) => {
        if (window.isDraggingGizmo) return;

        const utilityLayer = BABYLON.UtilityLayerRenderer.DefaultUtilityLayer;
        if (utilityLayer && utilityLayer.utilityLayerScene) {
            const pickGizmo = utilityLayer.utilityLayerScene.pick(scene.pointerX, scene.pointerY);
            if (pickGizmo.hit && pickGizmo.pickedMesh && isLeftMouseDown) {
                isLeftMouseDown = false;
                return;
            }
        }

        const deltaX = evt.clientX - previousMousePosition.x;
        const deltaY = evt.clientY - previousMousePosition.y;

        if (isLeftMouseDown) {
            // Sensibilité de rotation : réduite (était 0.0014) pour un contrôle plus précis type Roblox Studio.
            const ROTATE_SENSITIVITY = 0.0009;
            camera.cameraRotation.y += deltaX * ROTATE_SENSITIVITY;
            camera.cameraRotation.x += deltaY * ROTATE_SENSITIVITY;
        } else if (isRightMouseDown) {
            const panSpeed = 0.05 * 0.75;
            const camRight = camera.getDirection(BABYLON.Axis.X);
            const camUp = camera.getDirection(BABYLON.Axis.Y);
            
            camera.position.addInPlace(camRight.scale(-deltaX * panSpeed));
            camera.position.addInPlace(camUp.scale(deltaY * panSpeed));
        }

        previousMousePosition = { x: evt.clientX, y: evt.clientY };
    });

    canvas.addEventListener("wheel", (evt) => {
        evt.preventDefault();
        const zoomSpeed = 2.5;
        const fwd = camera.getDirection(BABYLON.Axis.Z);
        camera.position.addInPlace(fwd.scale(Math.sign(evt.deltaY) * -zoomSpeed));
    }, { passive: false });

    return camera;
};
