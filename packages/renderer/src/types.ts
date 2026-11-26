// biome-ignore-all format: Shared Contracts block, kept verbatim from the M1 plan.
// Shared Contracts (render side). Do not change these shapes.
export type MeshSpec =
  | { kind: 'primitive'; primitive: 'box'|'sphere'|'capsule'|'plane'|'cylinder'; size: [number,number,number] }
  | { kind: 'gltf'; url: string; animations?: Partial<Record<AnimState, AnimClipSpec>>; look?: LookSpec };
export interface AnimClipSpec { clip: string; speed?: number }   // speed: authored ground speed, m/s
export interface LookSpec { envIntensity?: number; saturation?: number }
export type AnimState = 'idle'|'walk'|'run'|'jump'|'fall';
export interface MaterialSpec { color: string; roughness: number; metalness: number; emissive?: string }
export interface RenderEntity {
  sceneId: string; simId?: number;           // undefined for spawner templates and pure-static decor
  mesh?: MeshSpec; material: MaterialSpec; scale: [number,number,number];
  dynamic: boolean; character: boolean; castShadow: boolean;
  templateKey?: string;                      // set on spawner templates (= spawner entity's sceneId)
  visualOffset: [number,number,number];      // model-space offset; character = [0,-(halfHeight+radius),0]
  position?: [number,number,number];         // world placement of sim-less (body-less) decor
  rotation?: [number,number,number,number];  // quaternion xyzw, same
}
export interface RenderSettings { preset: 'outdoor'|'studio'; hdri?: string; exposure: number;
  toneMapping: 'agx'|'aces'|'none'; bloom: { enabled: boolean; strength: number; threshold: number };
  ao: { enabled: boolean; radius: number }; sun: { direction: [number,number,number]; intensity: number; color: string };
  splat?: { url: string; position: [number,number,number]; rotation: [number,number,number,number]; scale: number; envFromSplat: boolean; floorY: number; exposure?: number; saturation?: number };  // exposure/saturation: Task 8 per-splat colour (default 1)
  cameraPresets: Record<string, { position: [number,number,number]; target: [number,number,number]; fov: number }>;
  controller: 'thirdPerson'|'orbit'|'fly';
  fog?: false | { near: number; far: number; color?: string };  // absent = renderer per-preset default; false = off
  backdrop?: { horizon: string; zenith: string };               // studio backdrop gradient
  toon?: ToonSettings }                                          // set = toon style (post.style "toon"); absent = default PBR look
export interface ToonSettings { bands: number; shadowTone: number; terminator: number; rim: number; rimWidth: number; specular: number;
  outline: { enabled: boolean; width: number; color: string; opacity: number; depthThreshold: number; normalThreshold: number };
  splat: { levels: number; saturation: number; strength: number; shadowTint: string; highlightTint: string } }
export interface RenderStats { fps: number; frameMs: number; drawCalls: number; triangles: number; splats: number; textureMB?: number; backend: 'webgpu'|'webgl' }
export interface CharacterFrame { grounded: boolean; vx: number; vz: number; vy: number; sprintSpeed: number }
