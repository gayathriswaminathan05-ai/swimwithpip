import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { shared } from '../gfx/materials.js';

// "Coral Reef Kit" by MiniPoly (Poly Pizza): Set 1 is CC0; Sets 2–5 are CC BY 3.0.
// Their colours live in per-vertex colour data (the texture is a soft shading gradient).
// See public/models/minipoly/CREDITS.md. Each file holds several colour variants of one coral
// type. We bake each variant's node transform, stand it on its base, normalise its height and
// reuse it as instanced reef decoration.

const BASE = `${import.meta.env.BASE_URL || '/'}models/minipoly/`;

export const KIT_SETS = [
  { key: 'tube', file: 'set1-tube-corals.glb', height: 1.75 },
  { key: 'sprig', file: 'set2-coral-sprigs.glb', height: 1.35 },
  { key: 'stag', file: 'set3-staghorn.glb', height: 2.4 },
  { key: 'egg', file: 'set4-egg-sponges.glb', height: 1.2 },
  { key: 'barrel', file: 'set5-barrel-sponges.glb', height: 1.45 },
];

const _m = new THREE.Matrix4();

/** Loads all coral sets. Resolves to { texture, sets: { key: BufferGeometry[] } }. */
export async function loadCoralKit(onProgress) {
  const loader = new GLTFLoader();
  const kit = { texture: null, sets: {} };
  let done = 0;
  await Promise.all(
    KIT_SETS.map(async (set) => {
      const gltf = await loader.loadAsync(BASE + set.file);
      gltf.scene.updateMatrixWorld(true);
      const variants = [];
      gltf.scene.traverse((o) => {
        if (!o.isMesh) return;
        if (!kit.texture && o.material && o.material.map) kit.texture = o.material.map;
        const g = o.geometry.clone();
        // Bake rotation + scale (but not the row layout translation) into the geometry.
        _m.copy(o.matrixWorld);
        _m.setPosition(0, 0, 0);
        g.applyMatrix4(_m);
        g.computeBoundingBox();
        const bb = g.boundingBox;
        const h = Math.max(1e-4, bb.max.y - bb.min.y);
        g.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
        const s = set.height / h;
        g.scale(s, s, s);
        g.computeBoundingSphere();
        variants.push(shared(g));
      });
      // Free the per-file materials/textures we don't keep (the shared texture is kept).
      gltf.scene.traverse((o) => {
        if (o.isMesh && o.material) {
          for (const key of ['emissiveMap', 'roughnessMap', 'metalnessMap', 'aoMap']) {
            if (o.material[key] && o.material[key] !== kit.texture) o.material[key].dispose();
          }
          if (o.material.map && o.material.map !== kit.texture) o.material.map.dispose();
          o.material.dispose();
        }
      });
      kit.sets[set.key] = variants;
      done++;
      if (onProgress) onProgress(done / KIT_SETS.length);
    }),
  );
  if (kit.texture) shared(kit.texture);
  return kit;
}
