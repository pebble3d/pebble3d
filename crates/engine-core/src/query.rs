//! Scene queries (raycast) against the last stepped broad-phase state.

use rapier3d::prelude::*;

use crate::world::SimWorld;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RayFilter {
    All,
    /// Only colliders attached to static (fixed) bodies.
    StaticOnly,
    /// Everything except the given entity's body.
    Exclude(u32),
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RayHit {
    /// Distance along the normalized direction.
    pub toi: f32,
    pub normal: [f32; 3],
    pub id: u32,
}

impl SimWorld {
    /// Casts a ray. `dir` is normalized, so `toi` is a distance in metres.
    /// Queries see the broad-phase as of the last `step`; bodies spawned since
    /// then become visible after the next tick.
    pub fn raycast(
        &self,
        origin: [f32; 3],
        dir: [f32; 3],
        max_toi: f32,
        filter: RayFilter,
    ) -> Option<RayHit> {
        let d = Vector::new(dir[0], dir[1], dir[2]);
        let len = d.length();
        if !len.is_finite() || len < 1e-12 || max_toi.is_nan() || max_toi <= 0.0 {
            return None;
        }
        let ray = Ray::new(Vector::new(origin[0], origin[1], origin[2]), d / len);
        let qf = match filter {
            RayFilter::All => QueryFilter::default(),
            RayFilter::StaticOnly => QueryFilter::only_fixed(),
            RayFilter::Exclude(id) => match self.body_handle(id) {
                Some(h) => QueryFilter::default().exclude_rigid_body(h),
                None => QueryFilter::default(),
            },
        };
        let phys = self.physics();
        let (handle, hit) = phys.cast_ray_and_get_normal(&ray, max_toi, true, qf)?;
        let id = phys.colliders.get(handle).map(|c| c.user_data as u32)?;
        Some(RayHit {
            toi: hit.time_of_impact,
            normal: [hit.normal.x, hit.normal.y, hit.normal.z],
            id,
        })
    }
}
