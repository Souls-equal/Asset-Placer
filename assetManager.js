/**
 * assetManager.js — Asset manager (Babylon)
 */

window.AssetManager = class AssetManager {
    constructor(scene) {
        this.scene = scene;
        this.templates = {};
        this.templateMeta = {};
        this.instances = [];
        this._nextId = 1;
        this.onChanged = null;
    }

    _notifyChanged() {
        if (typeof this.onChanged === 'function') {
            this.onChanged(this.instances);
        }
    }

    registerTemplate(name, sourceMesh, schemData = null, metadata = {}) {
        this.templates[name] = sourceMesh;
        this.templateMeta[name] = metadata || {};
        if (schemData) sourceMesh.schemData = schemData;

        // The template mesh is only used as a clone source.
        sourceMesh.name = `template_${name}`;
        sourceMesh.id = `template_${name}`;
        sourceMesh.isVisible = false;
        sourceMesh.visibility = 0;
        sourceMesh.isPickable = false;
        sourceMesh.metadata = Object.assign({}, sourceMesh.metadata, {
            isAssetTemplate: true,
            assetName: name,
            assetLibraryMeta: metadata || {}
        });
    }

    getTemplateMeta(name) {
        return this.templateMeta[name] || {};
    }

    addInstance(name, position = new BABYLON.Vector3(0, 0, 0), rotationY = 0) {
        const sourceMesh = this.templates[name];
        if (!sourceMesh) {
            console.error(`Template not found: ${name}`);
            return null;
        }

        const instance = new window.AssetInstance(this._nextId++, name, sourceMesh, this.scene);
        instance.position = position;
        instance.setRotation(rotationY);

        this.instances.push(instance);
        this._notifyChanged();
        return instance;
    }

    removeInstance(instanceId) {
        const index = this.instances.findIndex(inst => inst.id === instanceId);
        if (index !== -1) {
            this.instances[index].dispose();
            this.instances.splice(index, 1);
            this._notifyChanged();
            return true;
        }
        return false;
    }

    getInstanceByMesh(mesh) {
        if (!mesh) return null;

        const direct = this.instances.find(inst => inst.mesh === mesh);
        if (direct) return direct;

        const id = mesh.metadata && mesh.metadata.assetInstanceId;
        if (id !== undefined && id !== null) {
            return this.instances.find(inst => inst.id === id) || null;
        }

        return null;
    }
};
