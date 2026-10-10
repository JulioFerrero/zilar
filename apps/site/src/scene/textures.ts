import { CanvasTexture, RepeatWrapping, SRGBColorSpace, type Texture, TextureLoader } from 'three';

// A soft radial glow, drawn once: the moon's warm halo, so no bloom pass has to find it.
export function glowTexture(): CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (context) {
    const gradient = context.createRadialGradient(
      size / 2,
      size / 2,
      0,
      size / 2,
      size / 2,
      size / 2,
    );
    // an exponential-looking falloff, so the halo has no visible edge
    gradient.addColorStop(0, 'rgba(255, 196, 96, 0.9)');
    gradient.addColorStop(0.2, 'rgba(255, 180, 80, 0.42)');
    gradient.addColorStop(0.45, 'rgba(255, 165, 60, 0.12)');
    gradient.addColorStop(0.75, 'rgba(255, 150, 40, 0.03)');
    gradient.addColorStop(1, 'rgba(255, 150, 40, 0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

export type Maps = { map: Texture; roughnessMap: Texture; normalMap: Texture };

export function withRepeat(maps: Maps, x: number, y: number): Maps {
  const copy = (texture: Texture) => {
    const clone = texture.clone();
    clone.wrapS = RepeatWrapping;
    clone.wrapT = RepeatWrapping;
    clone.repeat.set(x, y);
    clone.needsUpdate = true;
    return clone;
  };
  return {
    map: copy(maps.map),
    roughnessMap: copy(maps.roughnessMap),
    normalMap: copy(maps.normalMap),
  };
}

export async function loadSilver(loader: TextureLoader): Promise<Maps> {
  const [map, roughnessMap, normalMap] = await Promise.all([
    loader.loadAsync('/textures/silver-color.jpg'),
    loader.loadAsync('/textures/silver-roughness.jpg'),
    loader.loadAsync('/textures/silver-normal.jpg'),
  ]);
  map.colorSpace = SRGBColorSpace;
  return { map, roughnessMap, normalMap };
}

export function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}
