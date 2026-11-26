//! Deterministic spawners: each owns a seeded `Pcg32`, so the same seed gives
//! the same spawn ticks and positions on every run and every build.

use rand_core::{Rng, SeedableRng};
use rand_pcg::Pcg32;
use rapier3d::prelude::*;

use crate::desc::SpawnerDesc;

/// Per-tick spawn budget is `rate / 60`. The accumulator is kept scaled by 60
/// (`acc += rate`, one spawn per 60 units) so integer rates are exact in f32:
/// rate 10 spawns on tick 6, 12, 18, ... with no rounding drift.
const TICKS_PER_SECOND: f32 = 60.0;

#[derive(Debug, Clone)]
pub struct SpawnerState {
    pub desc: SpawnerDesc,
    rng: Pcg32,
    /// Spawn credit scaled by `TICKS_PER_SECOND`.
    acc: f32,
    spawned: u32,
    /// Built once from the template, cloned per spawn (shapes are `Arc`-shared,
    /// so a convex hull is computed once, not per spawn).
    pub(crate) rigid_body: RigidBodyBuilder,
    pub(crate) collider: ColliderBuilder,
}

impl SpawnerState {
    pub(crate) fn new(
        desc: SpawnerDesc,
        rigid_body: RigidBodyBuilder,
        collider: ColliderBuilder,
    ) -> SpawnerState {
        SpawnerState {
            rng: Pcg32::seed_from_u64(desc.seed as u64),
            desc,
            acc: 0.0,
            spawned: 0,
            rigid_body,
            collider,
        }
    }

    /// Advances one tick and returns how many entities to spawn now (never past `count`).
    pub(crate) fn due(&mut self) -> u32 {
        let left = self.desc.count.saturating_sub(self.spawned);
        if left == 0 {
            return 0;
        }
        self.acc += self.desc.rate;
        let whole = (self.acc / TICKS_PER_SECOND).floor();
        self.acc -= whole * TICKS_PER_SECOND;
        let n = (whole as u32).min(left);
        self.spawned += n;
        n
    }

    /// A uniform point in `[areaMin, areaMax]`.
    pub(crate) fn sample(&mut self) -> [f32; 3] {
        let (lo, hi) = (self.desc.area_min, self.desc.area_max);
        let mut p = [0.0; 3];
        for i in 0..3 {
            p[i] = lo[i] + (hi[i] - lo[i]) * unit_f32(&mut self.rng);
        }
        p
    }

    pub fn spawned(&self) -> u32 {
        self.spawned
    }
}

/// Uniform in `[0, 1)` from the top 24 bits (exactly representable in f32).
fn unit_f32(rng: &mut Pcg32) -> f32 {
    (rng.next_u32() >> 8) as f32 * (1.0 / (1u32 << 24) as f32)
}
