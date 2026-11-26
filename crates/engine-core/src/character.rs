//! Kinematic character: Rapier's `KinematicCharacterController` for collide-and-slide,
//! autostep, slope limits and ground snapping, plus our own vertical velocity,
//! gravity, grounded state and coyote-time jump.

use rapier3d::control::{
    CharacterAutostep, CharacterCollision, CharacterLength, KinematicCharacterController,
};
use rapier3d::parry::query::ShapeCastOptions;
use rapier3d::parry::shape::Capsule;
use rapier3d::prelude::*;

use crate::desc::CharacterDesc;
use crate::world::DT;

/// Jump is still allowed this long after walking off a ledge.
pub const COYOTE_TIME: f32 = 0.1;
/// `ride_platforms`: the largest per-tick platform displacement carried (60 m/s at 60 Hz);
/// anything bigger is treated as the platform teleporting.
pub const MAX_CARRY_PER_TICK: f32 = 1.0;
/// `ride_platforms`: gap kept between a riding character and its platform, metres.
const RIDE_GAP: f32 = 0.01;
/// Mass used for pushing dynamic bodies when the body desc gives no `mass`.
pub const DEFAULT_CHARACTER_MASS: f32 = 80.0;

#[derive(Debug, Clone)]
pub struct CharacterState {
    pub desc: CharacterDesc,
    kcc: KinematicCharacterController,
    shape: Capsule,
    mass: f32,
    /// World-space XZ direction; clamped to length 1.
    input: [f32; 2],
    jump: bool,
    sprint: bool,
    vy: f32,
    grounded: bool,
    coyote: f32,
    /// Effective horizontal velocity of the last tick.
    vel: [f32; 2],
    /// Commanded horizontal velocity, ramped toward the input at `desc.accel`.
    cmd: [f32; 2],
    /// Reused every tick.
    collisions: Vec<CharacterCollision>,
    /// `ride_platforms`: the kinematic body found under the character at the end of the
    /// last grounded tick.
    platform: Option<RigidBodyHandle>,
    /// `ride_platforms`: horizontal platform velocity kept as momentum while airborne, m/s.
    air: [f32; 2],
}

impl CharacterState {
    pub(crate) fn new(
        desc: CharacterDesc,
        half_height: f32,
        radius: f32,
        mass: Option<f32>,
    ) -> CharacterState {
        let slope = desc.max_slope_deg.to_radians();
        let kcc = KinematicCharacterController {
            autostep: Some(CharacterAutostep {
                max_height: CharacterLength::Absolute(desc.step_height),
                min_width: CharacterLength::Absolute(radius),
                include_dynamic_bodies: false,
            }),
            snap_to_ground: Some(CharacterLength::Absolute(desc.snap)),
            max_slope_climb_angle: slope,
            min_slope_slide_angle: slope,
            ..KinematicCharacterController::default()
        };
        CharacterState {
            desc,
            kcc,
            shape: Capsule::new_y(half_height, radius),
            mass: mass.unwrap_or(DEFAULT_CHARACTER_MASS),
            input: [0.0; 2],
            jump: false,
            sprint: false,
            vy: 0.0,
            grounded: false,
            coyote: 0.0,
            vel: [0.0; 2],
            cmd: [0.0; 2],
            collisions: Vec::new(),
            platform: None,
            air: [0.0; 2],
        }
    }

    pub(crate) fn set_input(&mut self, wx: f32, wz: f32, jump: bool, sprint: bool) {
        let (mut x, mut z) = (finite_or_zero(wx), finite_or_zero(wz));
        let len2 = x * x + z * z;
        if len2 > 1.0 {
            let inv = 1.0 / len2.sqrt();
            x *= inv;
            z *= inv;
        }
        self.input = [x, z];
        self.jump = jump;
        self.sprint = sprint;
    }

    /// `[grounded 0/1, vx, vz, vy]`.
    pub fn state(&self) -> [f32; 4] {
        let g = if self.grounded { 1.0 } else { 0.0 };
        [g, self.vel[0], self.vel[1], self.vy]
    }

    /// Teleport: drop vertical velocity and any ramped horizontal velocity.
    pub(crate) fn reset_vertical(&mut self) {
        self.vy = 0.0;
        self.cmd = [0.0; 2];
        self.air = [0.0; 2];
        self.platform = None;
    }

    /// One fixed tick, before the physics step.
    ///
    /// Ordering note: this runs before `PhysicsWorld::step`, so the KCC's shape
    /// casts see the broad-phase as of the previous step. Bodies a spawner adds
    /// earlier in the same tick do not block the character until the next tick.
    /// The resulting pose is applied with `set_next_kinematic_translation`, which
    /// the physics step then integrates (giving the body a velocity for contacts).
    pub(crate) fn tick(&mut self, phys: &mut PhysicsWorld, handle: RigidBodyHandle) {
        let Some(rb) = phys.bodies.get(handle) else {
            return;
        };
        let pose = *rb.position();
        let gravity = phys.gravity.y;
        let ride = self.desc.ride_platforms;
        let was_grounded = self.grounded;
        // ride_platforms: the motion the supporting kinematic body makes during this step
        // (its next pose relative to its current one). Both poses are known here because
        // kinematic targets are set before `World::step`.
        let carry_pose = if ride && was_grounded {
            self.platform
                .and_then(|ph| phys.bodies.get(ph))
                .filter(|p| p.is_kinematic())
                .map(|p| *p.next_position() * p.position().inverse())
                // A pose jump bigger than any plausible step (a platform looped back to its
                // start with `setKinematicPose`) is a teleport, not motion: the rider is left
                // behind instead of being dragged through the world and launched at
                // hundreds of m/s.
                .filter(|d| {
                    (d.transform_point(pose.translation) - pose.translation).length()
                        <= MAX_CARRY_PER_TICK
                })
        } else {
            None
        };

        let jumped = self.jump && (self.grounded || self.coyote > 0.0);
        if jumped {
            self.vy = self.desc.jump_speed;
            self.coyote = 0.0;
        } else if self.grounded {
            self.vy = 0.0;
        }
        self.vy += gravity * DT;

        let speed = if self.sprint {
            self.desc.sprint_speed
        } else {
            self.desc.speed
        };
        let target = [self.input[0] * speed, self.input[1] * speed];
        self.cmd = ramp_toward(self.cmd, target, self.desc.accel * DT);
        let mut desired = Vector::new(self.cmd[0] * DT, self.vy * DT, self.cmd[1] * DT);
        if ride && !was_grounded {
            desired.x += self.air[0] * DT;
            desired.z += self.air[1] * DT;
        }
        // ride_platforms, standing on a kinematic body: the character is lifted by up to
        // `step_height` (less under a low ceiling), moved horizontally by the KCC from there,
        // then set back down on whatever is below with one shape cast. Lifted clear of the
        // platform, the KCC never touches it, which avoids Rapier's kinematic-platform
        // friction (one tick late, and it pins a character resting exactly at the contact
        // offset so it cannot walk); the platform's exact motion is added as `carry` below.
        // The set-down also climbs steps up to `step_height`, like autostep.
        let riding = carry_pose.is_some() && !jumped;
        let filter = QueryFilter::default()
            .exclude_rigid_body(handle)
            .exclude_sensors();
        let mut start = pose;
        let mut lift = 0.0;
        if riding {
            desired.y = 0.0;
            lift = self.headroom(phys, filter, &pose, self.desc.step_height.max(0.05));
            start.translation.y += lift;
        }
        self.collisions.clear();
        let mv = {
            let queries = phys.broad_phase.as_query_pipeline(
                phys.narrow_phase.query_dispatcher(),
                &phys.bodies,
                &phys.colliders,
                filter,
            );
            let collisions = &mut self.collisions;
            self.kcc
                .move_shape(DT, &queries, &self.shape, &start, desired, |c| {
                    collisions.push(c)
                })
        };

        let mut moved = start.translation + mv.translation;
        let mut supported = false;
        let mut support_body = None;
        if riding {
            match self.set_down(
                phys,
                filter,
                moved,
                pose.rotation,
                lift + self.desc.snap.max(0.05),
            ) {
                Some((toi, body)) => {
                    moved.y -= toi;
                    supported = true;
                    support_body = body;
                }
                // Walked off the edge: drop the lift and fall from the original height.
                None => moved.y -= lift,
            }
        }
        // Platform displacement at the character's new position (zero when not riding).
        let carry = match carry_pose {
            Some(d) => d.transform_point(moved) - moved,
            None => Vector::ZERO,
        };
        if let Some(rb) = phys.bodies.get_mut(handle) {
            // Branch rather than `moved + ZERO`: adding +0.0 would flip -0.0 components and
            // change default (non-riding) runs bit-for-bit.
            if ride {
                rb.set_next_kinematic_translation(moved + carry);
            } else {
                rb.set_next_kinematic_translation(moved);
            }
        }
        if ride {
            // The kinematic body under the character, seen in this step's (pre-physics)
            // broad-phase, i.e. at the same pose the move above was solved against.
            self.platform = if supported {
                support_body
            } else if mv.grounded {
                self.kinematic_below(phys, handle, moved, pose.rotation)
            } else {
                None
            };
        }

        if !self.collisions.is_empty() {
            let mut queries = phys.broad_phase.as_query_pipeline_mut(
                phys.narrow_phase.query_dispatcher(),
                &mut phys.bodies,
                &mut phys.colliders,
                filter,
            );
            self.kcc.solve_character_collision_impulses(
                DT,
                &mut queries,
                &self.shape,
                self.mass,
                &self.collisions,
            );
        }

        let rising = self.vy > 0.0;
        // While rising (jump), ground contact within snap/prediction range is ignored.
        self.grounded = (mv.grounded || supported) && !rising;
        if self.grounded {
            self.vy = 0.0;
        } else if rising && mv.translation.y + 1.0e-4 < desired.y {
            // Head hit a ceiling: stop rising.
            self.vy = 0.0;
        }
        if ride {
            if self.grounded {
                self.air = [0.0; 2];
            } else if was_grounded {
                // Left the ground (jumped or walked off): keep the platform's velocity.
                self.air = [carry.x / DT, carry.z / DT];
                self.vy += carry.y / DT;
            }
        }
        self.coyote = if self.grounded {
            COYOTE_TIME
        } else {
            (self.coyote - DT).max(0.0)
        };
        self.vel = [mv.translation.x / DT, mv.translation.z / DT];
        // Blocked (wall, slide): carry only what actually moved into the next ramp, so turning
        // away from a wall does not release a burst of stored speed. Only when the input
        // turns away (or stops): while it keeps pushing the same way the ramp continues, so a
        // character walking into a step from a standstill builds enough speed for autostep
        // (clamping every tick there pinned it at the step face forever).
        if self.desc.accel > 0.0 {
            let c2 = self.cmd[0] * self.cmd[0] + self.cmd[1] * self.cmd[1];
            let v2 = self.vel[0] * self.vel[0] + self.vel[1] * self.vel[1];
            let t2 = target[0] * target[0] + target[1] * target[1];
            let dot = self.cmd[0] * target[0] + self.cmd[1] * target[1];
            let same_way = t2 > 0.0 && dot > 0.0 && dot * dot >= 0.75 * c2 * t2;
            if v2 < c2 && !same_way {
                self.cmd = self.vel;
            }
        }
    }
}

impl CharacterState {
    /// `ride_platforms`: how far (up to `want`) the character can rise before its head
    /// would come within `RIDE_GAP` of something.
    fn headroom(&self, phys: &PhysicsWorld, filter: QueryFilter, pose: &Pose, want: f32) -> f32 {
        let queries = phys.broad_phase.as_query_pipeline(
            phys.narrow_phase.query_dispatcher(),
            &phys.bodies,
            &phys.colliders,
            filter,
        );
        let opts = ShapeCastOptions {
            max_time_of_impact: want,
            target_distance: RIDE_GAP,
            stop_at_penetration: false,
            compute_impact_geometry_on_penetration: false,
        };
        match queries.cast_shape(pose, Vector::new(0.0, 1.0, 0.0), &self.shape, opts) {
            Some((_, hit)) => hit.time_of_impact.clamp(0.0, want),
            None => want,
        }
    }

    /// `ride_platforms`: casts the character down from `at` by at most `reach` and returns
    /// the drop and the body it lands on (`None` for a parentless collider). Misses, and
    /// surfaces steeper than `maxSlopeDeg`, return `None`.
    fn set_down(
        &self,
        phys: &PhysicsWorld,
        filter: QueryFilter,
        at: Vector,
        rot: Rotation,
        reach: f32,
    ) -> Option<(f32, Option<RigidBodyHandle>)> {
        let queries = phys.broad_phase.as_query_pipeline(
            phys.narrow_phase.query_dispatcher(),
            &phys.bodies,
            &phys.colliders,
            filter,
        );
        let opts = ShapeCastOptions {
            max_time_of_impact: reach,
            target_distance: RIDE_GAP,
            stop_at_penetration: false,
            compute_impact_geometry_on_penetration: true,
        };
        let (ch, hit) = queries.cast_shape(
            &Pose::from_parts(at, rot),
            Vector::new(0.0, -1.0, 0.0),
            &self.shape,
            opts,
        )?;
        let min_y = self.desc.max_slope_deg.to_radians().cos() - 1.0e-4;
        if hit.normal1.y < min_y {
            // A steep normal is either a too-steep slope or the capsule resting on an edge
            // (a step's lip). Accept the edge when the surface straight below the centre
            // is walkable.
            let down = Ray::new(at, Vector::new(0.0, -1.0, 0.0));
            let below = self.shape.half_height() + self.shape.radius + reach + 0.05;
            let (_, ri) = queries.cast_ray_and_get_normal(&down, below, true)?;
            if ri.normal.y < min_y {
                return None;
            }
        }
        Some((
            hit.time_of_impact,
            phys.colliders.get(ch).and_then(|c| c.parent()),
        ))
    }

    /// `ride_platforms`: the kinematic body just below a grounded character, if any.
    fn kinematic_below(
        &self,
        phys: &PhysicsWorld,
        handle: RigidBodyHandle,
        at: Vector,
        rot: Rotation,
    ) -> Option<RigidBodyHandle> {
        let filter = QueryFilter::default()
            .exclude_rigid_body(handle)
            .exclude_sensors();
        let queries = phys.broad_phase.as_query_pipeline(
            phys.narrow_phase.query_dispatcher(),
            &phys.bodies,
            &phys.colliders,
            filter,
        );
        let mut opts = ShapeCastOptions::with_max_time_of_impact(self.desc.snap.max(0.1) + 0.05);
        opts.stop_at_penetration = true;
        queries
            .cast_shape(
                &Pose::from_parts(at, rot),
                Vector::new(0.0, -1.0, 0.0),
                &self.shape,
                opts,
            )
            .and_then(|(ch, _)| phys.colliders.get(ch))
            .and_then(|c| c.parent())
            .filter(|&ph| phys.bodies.get(ph).is_some_and(|b| b.is_kinematic()))
    }
}

fn finite_or_zero(v: f32) -> f32 {
    if v.is_finite() { v } else { 0.0 }
}

/// Moves `cur` toward `target` by at most `step` (vector length). `step <= 0` jumps straight
/// to `target` (no acceleration limit).
fn ramp_toward(cur: [f32; 2], target: [f32; 2], step: f32) -> [f32; 2] {
    let (dx, dz) = (target[0] - cur[0], target[1] - cur[1]);
    let d = (dx * dx + dz * dz).sqrt();
    if step <= 0.0 || d <= step {
        return target;
    }
    let k = step / d;
    [cur[0] + dx * k, cur[1] + dz * k]
}
