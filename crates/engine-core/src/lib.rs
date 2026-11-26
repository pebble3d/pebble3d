//! engine-core: deterministic Rapier simulation with flat prev/curr state
//! buffers, exposed to JS through `World`.
//!
//! Builds: `deterministic` is the default feature (so bare `cargo check` and
//! rust-analyzer get it). The fast build is `--no-default-features --features fast`.

#[cfg(all(feature = "deterministic", feature = "fast"))]
compile_error!(
    "engine-core: enable exactly one of the `deterministic` and `fast` features, not both"
);

pub mod character;
pub mod desc;
pub mod query;
pub mod slots;
pub mod spawner;
pub mod world;

pub use character::{COYOTE_TIME, DEFAULT_CHARACTER_MASS};
pub use desc::{BodyDesc, BodyType, CharacterDesc, ColliderDesc, EntityDesc, SpawnerDesc};
pub use query::{RayFilter, RayHit};
pub use slots::{ACTIVE, INITIAL_CAPACITY, NO_INTERP, SLEEPING, STRIDE};
pub use world::{DT, SimWorld};

/// Which build this is: `"deterministic"` only when Rapier's enhanced determinism
/// is actually compiled in. Without it (the `fast` feature, or neither feature via
/// `--no-default-features`) this is plain Rapier, i.e. `"fast"`.
pub const BUILD_KIND: &str = if cfg!(feature = "deterministic") {
    "deterministic"
} else {
    "fast"
};

use wasm_bindgen::prelude::*;

/// Floats in the query scratch region (`raycast` uses `[0..5)`, `characterState` `[8..12)`,
/// `linearVelocity` `[12..15)`, `angularVelocity` `[16..19)`).
pub const SCRATCH_LEN: usize = 24;

#[wasm_bindgen]
pub struct World {
    inner: SimWorld,
    scratch: Box<[f32; SCRATCH_LEN]>,
}

#[wasm_bindgen]
impl World {
    #[wasm_bindgen(constructor)]
    pub fn new(seed: u32, gravity_y: f32) -> World {
        World {
            inner: SimWorld::new(seed, gravity_y),
            scratch: Box::new([0.0; SCRATCH_LEN]),
        }
    }

    /// Parses an `EntityDesc` JSON string and spawns it. Throws with the Rust message on error.
    pub fn spawn(&mut self, desc_json: &str) -> Result<u32, JsError> {
        let d = EntityDesc::from_json(desc_json).map_err(|e| JsError::new(&e))?;
        self.inner.spawn(d).map_err(|e| JsError::new(&e))
    }

    pub fn despawn(&mut self, id: u32) -> bool {
        self.inner.despawn(id)
    }

    pub fn step(&mut self, n: u32) {
        self.inner.step(n)
    }

    pub fn tick(&self) -> u32 {
        self.inner.tick()
    }

    /// Slot index, or -1 if the entity has no slot.
    #[wasm_bindgen(js_name = slotOf)]
    pub fn slot_of(&self, id: u32) -> i32 {
        self.inner.slot_of(id).map_or(-1, |s| s as i32)
    }

    /// Byte offset of the prev buffer in `memory.buffer`. Changes when buffers grow.
    #[wasm_bindgen(js_name = statePtrPrev)]
    pub fn state_ptr_prev(&self) -> usize {
        self.inner.prev().as_ptr() as usize
    }

    /// Byte offset of the curr buffer in `memory.buffer`. Changes when buffers grow.
    #[wasm_bindgen(js_name = statePtrCurr)]
    pub fn state_ptr_curr(&self) -> usize {
        self.inner.curr().as_ptr() as usize
    }

    /// Number of slots (each `STRIDE` = 8 floats) in each state buffer.
    #[wasm_bindgen(js_name = slotCapacity)]
    pub fn slot_capacity(&self) -> u32 {
        self.inner.slot_capacity()
    }

    /// `SCRATCH_LEN`: floats in the scratch region (the sdk mirrors it and tests the match).
    #[wasm_bindgen(js_name = scratchLen)]
    pub fn scratch_len(&self) -> u32 {
        SCRATCH_LEN as u32
    }

    /// Byte offset of the fixed `SCRATCH_LEN`-float scratch region.
    #[wasm_bindgen(js_name = scratchPtr)]
    pub fn scratch_ptr(&self) -> usize {
        self.scratch.as_ptr() as usize
    }

    /// FNV-1a 64 state hash as 16 lowercase hex characters.
    #[wasm_bindgen(js_name = stateHash)]
    pub fn state_hash(&self) -> String {
        format!("{:016x}", self.inner.state_hash())
    }

    /// `[active, sleeping]`. Allocates; call on stats ticks only.
    #[wasm_bindgen(js_name = bodyCounts)]
    pub fn body_counts(&self) -> Vec<u32> {
        let (a, s) = self.inner.body_counts();
        vec![a, s]
    }

    pub fn teleport(&mut self, id: u32, x: f32, y: f32, z: f32) {
        self.inner.teleport(id, [x, y, z])
    }

    /// Sets a dynamic body's linear and angular velocity (wakes it). Returns false for
    /// unknown ids and non-dynamic bodies.
    #[allow(clippy::too_many_arguments)]
    #[wasm_bindgen(js_name = setVelocity)]
    pub fn set_velocity(
        &mut self,
        id: u32,
        vx: f32,
        vy: f32,
        vz: f32,
        wx: f32,
        wy: f32,
        wz: f32,
    ) -> bool {
        self.inner.set_velocity(id, [vx, vy, vz], [wx, wy, wz])
    }

    /// Writes `[vx, vy, vz]` to scratch `[12..15)` and returns true, or returns false
    /// (scratch untouched) for unknown ids (static bodies read zero).
    #[wasm_bindgen(js_name = linearVelocity)]
    pub fn linear_velocity(&mut self, id: u32) -> bool {
        match self.inner.linear_velocity(id) {
            Some(v) => {
                self.scratch[12..15].copy_from_slice(&v);
                true
            }
            None => false,
        }
    }

    /// Writes `[wx, wy, wz]` to scratch `[16..19)` and returns true, or returns false
    /// (scratch untouched) for unknown ids (static bodies read zero).
    #[wasm_bindgen(js_name = angularVelocity)]
    pub fn angular_velocity(&mut self, id: u32) -> bool {
        match self.inner.angular_velocity(id) {
            Some(w) => {
                self.scratch[16..19].copy_from_slice(&w);
                true
            }
            None => false,
        }
    }

    /// Adds a linear impulse to a dynamic body (wakes it). Returns false for unknown ids and
    /// non-dynamic bodies.
    #[wasm_bindgen(js_name = applyImpulse)]
    pub fn apply_impulse(&mut self, id: u32, ix: f32, iy: f32, iz: f32) -> bool {
        self.inner.apply_impulse(id, [ix, iy, iz])
    }

    /// Adds a torque impulse to a dynamic body (wakes it). Returns false for unknown ids and
    /// non-dynamic bodies.
    #[wasm_bindgen(js_name = applyTorqueImpulse)]
    pub fn apply_torque_impulse(&mut self, id: u32, tx: f32, ty: f32, tz: f32) -> bool {
        self.inner.apply_torque_impulse(id, [tx, ty, tz])
    }

    /// Sets the pose a kinematic body moves to on the next step. Returns false for unknown
    /// ids and non-kinematic bodies.
    #[allow(clippy::too_many_arguments)]
    #[wasm_bindgen(js_name = setKinematicPose)]
    pub fn set_kinematic_pose(
        &mut self,
        id: u32,
        px: f32,
        py: f32,
        pz: f32,
        qx: f32,
        qy: f32,
        qz: f32,
        qw: f32,
    ) -> bool {
        self.inner
            .set_kinematic_pose(id, [px, py, pz], [qx, qy, qz, qw])
    }

    /// filter: 0 = all, 1 = static-only, 2 = exclude `exclude_id`.
    /// On hit writes `[toi, nx, ny, nz, id]` to scratch `[0..5)` and returns true.
    #[allow(clippy::too_many_arguments)]
    pub fn raycast(
        &mut self,
        ox: f32,
        oy: f32,
        oz: f32,
        dx: f32,
        dy: f32,
        dz: f32,
        max_toi: f32,
        filter: u32,
        exclude_id: u32,
    ) -> bool {
        let f = match filter {
            1 => RayFilter::StaticOnly,
            2 => RayFilter::Exclude(exclude_id),
            _ => RayFilter::All,
        };
        match self.inner.raycast([ox, oy, oz], [dx, dy, dz], max_toi, f) {
            Some(hit) => {
                self.scratch[0] = hit.toi;
                self.scratch[1] = hit.normal[0];
                self.scratch[2] = hit.normal[1];
                self.scratch[3] = hit.normal[2];
                self.scratch[4] = hit.id as f32;
                true
            }
            None => false,
        }
    }

    /// `[px,py,pz,qx,qy,qz,qw]`, or undefined. Debug/tests only (allocates).
    #[wasm_bindgen(js_name = transformOf)]
    pub fn transform_of(&self, id: u32) -> Option<Vec<f32>> {
        self.inner.transform(id).map(|t| t.to_vec())
    }

    /// World-space XZ direction (clamped to length 1), jump and sprint. No-op for non-characters.
    #[wasm_bindgen(js_name = setCharacterInput)]
    pub fn set_character_input(&mut self, id: u32, wx: f32, wz: f32, jump: bool, sprint: bool) {
        self.inner.set_character_input(id, wx, wz, jump, sprint)
    }

    /// Writes `[grounded 0/1, vx, vz, vy]` to scratch `[8..12)` and returns true,
    /// or returns false (scratch untouched) if `id` is not a character.
    #[wasm_bindgen(js_name = characterState)]
    pub fn character_state(&mut self, id: u32) -> bool {
        match self.inner.character_state(id) {
            Some(s) => {
                self.scratch[8..12].copy_from_slice(&s);
                true
            }
            None => false,
        }
    }

    #[wasm_bindgen(js_name = spawnedPending)]
    pub fn spawned_pending(&self) -> u32 {
        self.inner.spawned_pending()
    }

    /// Flat `(id, slot, spawnerSimId)` triples. Call only when `spawnedPending() > 0`.
    #[wasm_bindgen(js_name = drainSpawned)]
    pub fn drain_spawned(&mut self) -> Vec<u32> {
        self.inner
            .drain_spawned()
            .into_iter()
            .flat_map(|(a, b, c)| [a, b, c])
            .collect()
    }
}
