//! The simulation world: entities ordered by id, Rapier bodies, slot buffers.

use std::collections::BTreeMap;

use rapier3d::prelude::*;

use crate::character::CharacterState;
use crate::desc::{BodyDesc, BodyType, ColliderDesc, EntityDesc};
use crate::slots::{ACTIVE, NO_INTERP, SLEEPING, STRIDE, SlotTable};
use crate::spawner::SpawnerState;

/// Fixed simulation tick.
pub const DT: f32 = 1.0 / 60.0;

#[derive(Debug, Clone)]
pub struct Entity {
    pub name: Option<String>,
    pub slot: Option<u32>,
    pub body: Option<RigidBodyHandle>,
    /// Spawner runtime state (desc, `Pcg32`, accumulator, spawned count).
    pub spawner: Option<SpawnerState>,
    /// Character controller runtime state.
    pub character: Option<CharacterState>,
}

pub struct SimWorld {
    phys: PhysicsWorld,
    /// Ordered by `EntityId`: all sim and hash iteration goes through this map.
    entities: BTreeMap<u32, Entity>,
    next_id: u32,
    tick: u32,
    seed: u32,
    slots: SlotTable,
    /// `(id, slot, spawnerSimId)` triples produced by spawners since the last drain.
    spawned: Vec<(u32, u32, u32)>,
    /// Reused per tick: ids of entities whose slot carried `NO_INTERP` at the start
    /// of the tick. Recorded by id (not slot) so an entity spawned into a reused
    /// slot during the same tick keeps its own `NO_INTERP`.
    no_interp_scratch: Vec<u32>,
    /// Reused per tick: spawner entity ids, collected before spawning.
    spawner_scratch: Vec<u32>,
}

impl SimWorld {
    pub fn new(seed: u32, gravity_y: f32) -> SimWorld {
        let mut phys = PhysicsWorld::new();
        phys.gravity = Vector::new(0.0, gravity_y, 0.0);
        phys.integration_parameters.dt = DT;
        SimWorld {
            phys,
            entities: BTreeMap::new(),
            next_id: 1,
            tick: 0,
            seed,
            slots: SlotTable::new(),
            spawned: Vec::new(),
            no_interp_scratch: Vec::new(),
            spawner_scratch: Vec::new(),
        }
    }

    pub fn seed(&self) -> u32 {
        self.seed
    }

    pub fn tick(&self) -> u32 {
        self.tick
    }

    pub(crate) fn physics(&self) -> &PhysicsWorld {
        &self.phys
    }

    pub(crate) fn body_handle(&self, id: u32) -> Option<RigidBodyHandle> {
        self.entities.get(&id).and_then(|e| e.body)
    }

    pub fn spawn(&mut self, d: EntityDesc) -> Result<u32, String> {
        d.validate()?;
        let EntityDesc {
            name,
            position,
            rotation,
            body,
            character,
            spawner,
        } = d;
        // Build everything fallible before allocating an id or touching Rapier.
        let builders = body.as_ref().map(body_builders).transpose()?;
        let spawner = match spawner {
            Some(sd) => {
                let tb = sd
                    .template
                    .body
                    .as_ref()
                    .ok_or("spawner.template requires a `body`")?;
                let (rb, col) = body_builders(tb).map_err(|e| format!("spawner.template: {e}"))?;
                Some(SpawnerState::new(sd, rb, col))
            }
            None => None,
        };
        let character = match (character, &body) {
            (
                Some(cd),
                Some(BodyDesc {
                    collider:
                        ColliderDesc::Capsule {
                            half_height,
                            radius,
                        },
                    mass,
                    ..
                }),
            ) => Some(CharacterState::new(cd, *half_height, *radius, *mass)),
            (Some(_), _) => {
                return Err(
                    "character requires a `kinematic` body with a `capsule` collider".into(),
                );
            }
            (None, _) => None,
        };

        let id = self.next_id;
        self.next_id += 1;
        let (body, slot) = match builders {
            Some((rb, col)) => {
                let (h, s) = self.insert_body(id, rb, col, position, quat(rotation));
                (Some(h), Some(s))
            }
            None => (None, None),
        };
        self.entities.insert(
            id,
            Entity {
                name,
                slot,
                body,
                spawner,
                character,
            },
        );
        Ok(id)
    }

    /// Inserts a body + collider for entity `id` and allocates its slot
    /// (`NO_INTERP`, pose written to both buffers).
    fn insert_body(
        &mut self,
        id: u32,
        rb: RigidBodyBuilder,
        col: ColliderBuilder,
        [px, py, pz]: [f32; 3],
        rot: Rotation,
    ) -> (RigidBodyHandle, u32) {
        let pose = Pose::from_parts(Vector::new(px, py, pz), rot);
        let (handle, _) = self.phys.insert(
            rb.pose(pose).user_data(id as u128),
            col.user_data(id as u128),
        );
        let slot = self.slots.alloc();
        self.slots
            .write_pose(slot, [px, py, pz, rot.x, rot.y, rot.z, rot.w], true);
        (handle, slot)
    }

    pub fn despawn(&mut self, id: u32) -> bool {
        let Some(e) = self.entities.remove(&id) else {
            return false;
        };
        if let Some(h) = e.body {
            self.phys.remove_body(h);
        }
        if let Some(slot) = e.slot {
            self.slots.free(slot);
        }
        true
    }

    /// Advances `n` fixed ticks.
    pub fn step(&mut self, n: u32) {
        for _ in 0..n {
            self.step_once();
        }
    }

    fn step_once(&mut self) {
        // 1. Record the entities whose slot carries NO_INTERP at the start of this tick.
        self.no_interp_scratch.clear();
        for (&id, e) in &self.entities {
            if let Some(slot) = e.slot
                && self.slots.flags(slot) & NO_INTERP != 0
            {
                self.no_interp_scratch.push(id);
            }
        }
        // 2. prev <- curr.
        self.slots.copy_curr_to_prev();
        // 3. Spawners hook.
        self.run_spawners();
        // 4. Characters hook.
        self.run_characters();
        // 5. Physics.
        self.phys.step();
        // 6. curr <- bodies, in id order. NO_INTERP is preserved here (bodies
        //    spawned during this tick keep it); recorded slots are cleared in 7.
        for e in self.entities.values() {
            let (Some(slot), Some(h)) = (e.slot, e.body) else {
                continue;
            };
            let Some(rb) = self.phys.bodies.get(h) else {
                continue;
            };
            let t = rb.translation();
            let r = rb.rotation();
            self.slots
                .write_pose(slot, [t.x, t.y, t.z, r.x, r.y, r.z, r.w], false);
            let mut flags = ACTIVE | (self.slots.flags(slot) & NO_INTERP);
            if rb.is_sleeping() {
                flags |= SLEEPING;
            }
            self.slots.set_flags(slot, flags);
        }
        // 7. Clear NO_INTERP on the entities recorded in step 1 (looked up by id).
        for &id in &self.no_interp_scratch {
            if let Some(slot) = self.entities.get(&id).and_then(|e| e.slot) {
                let f = self.slots.flags(slot);
                self.slots.set_flags(slot, f & !NO_INTERP);
            }
        }
        self.tick += 1;
    }

    /// Spawners, in id order, before physics. Spawned bodies get `NO_INTERP`
    /// (from `SlotTable::alloc`) and keep it through this tick's step 6.
    fn run_spawners(&mut self) {
        let mut ids = std::mem::take(&mut self.spawner_scratch);
        ids.clear();
        ids.extend(
            self.entities
                .iter()
                .filter(|(_, e)| e.spawner.is_some())
                .map(|(&id, _)| id),
        );
        for &sid in &ids {
            // Take the state out so `insert_body` can borrow `self` mutably.
            let Some(mut st) = self.entities.get_mut(&sid).and_then(|e| e.spawner.take()) else {
                continue;
            };
            for _ in 0..st.due() {
                let p = st.sample();
                let id = self.next_id;
                self.next_id += 1;
                let rot = quat(st.desc.template.rotation);
                let (h, slot) =
                    self.insert_body(id, st.rigid_body.clone(), st.collider.clone(), p, rot);
                self.entities.insert(
                    id,
                    Entity {
                        name: None,
                        slot: Some(slot),
                        body: Some(h),
                        spawner: None,
                        character: None,
                    },
                );
                self.spawned.push((id, slot, sid));
            }
            if let Some(e) = self.entities.get_mut(&sid) {
                e.spawner = Some(st);
            }
        }
        self.spawner_scratch = ids;
    }

    /// Kinematic character controllers, in id order, before physics. Their
    /// collision queries see the previous step's broad-phase (see `CharacterState::tick`).
    fn run_characters(&mut self) {
        let phys = &mut self.phys;
        for e in self.entities.values_mut() {
            if let (Some(c), Some(h)) = (e.character.as_mut(), e.body) {
                c.tick(phys, h);
            }
        }
    }

    /// Sets a character's world-space XZ input direction (clamped to length 1),
    /// jump and sprint. No-op for ids that are not characters.
    pub fn set_character_input(&mut self, id: u32, wx: f32, wz: f32, jump: bool, sprint: bool) {
        if let Some(c) = self
            .entities
            .get_mut(&id)
            .and_then(|e| e.character.as_mut())
        {
            c.set_input(wx, wz, jump, sprint);
        }
    }

    /// `[grounded 0/1, vx, vz, vy]` as of the last tick, or `None` if `id` is not a character.
    pub fn character_state(&self, id: u32) -> Option<[f32; 4]> {
        self.entities
            .get(&id)
            .and_then(|e| e.character.as_ref())
            .map(|c| c.state())
    }

    pub fn slot_of(&self, id: u32) -> Option<u32> {
        self.entities.get(&id).and_then(|e| e.slot)
    }

    pub fn slot_capacity(&self) -> u32 {
        self.slots.capacity() as u32
    }

    /// `[px,py,pz,qx,qy,qz,qw]` from the current state buffer.
    pub fn transform(&self, id: u32) -> Option<[f32; 7]> {
        self.slot_of(id).map(|s| self.slots.pose(s))
    }

    /// FNV-1a 64 over `(id, transform f32 bits)` for every body, sorted by id.
    pub fn state_hash(&self) -> u64 {
        const OFFSET: u64 = 0xcbf2_9ce4_8422_2325;
        const PRIME: u64 = 0x0000_0100_0000_01b3;
        let mut h = OFFSET;
        let mut feed = |bytes: [u8; 4]| {
            for b in bytes {
                h ^= b as u64;
                h = h.wrapping_mul(PRIME);
            }
        };
        for (&id, e) in &self.entities {
            let Some(slot) = e.slot else { continue };
            feed(id.to_le_bytes());
            for v in self.slots.pose(slot) {
                feed(v.to_bits().to_le_bytes());
            }
        }
        h
    }

    /// `(active, sleeping)` counts over non-static bodies.
    pub fn body_counts(&self) -> (u32, u32) {
        let (mut active, mut sleeping) = (0, 0);
        for e in self.entities.values() {
            let Some(rb) = e.body.and_then(|h| self.phys.bodies.get(h)) else {
                continue;
            };
            if rb.is_fixed() {
                continue;
            }
            if rb.is_sleeping() {
                sleeping += 1;
            } else {
                active += 1;
            }
        }
        (active, sleeping)
    }

    /// Moves a body instantly (velocity zeroed, woken) and marks its slot `NO_INTERP`.
    pub fn teleport(&mut self, id: u32, p: [f32; 3]) {
        let Some(e) = self.entities.get_mut(&id) else {
            return;
        };
        if let Some(c) = e.character.as_mut() {
            c.reset_vertical();
        }
        let (Some(h), Some(slot)) = (e.body, e.slot) else {
            return;
        };
        let Some(rb) = self.phys.bodies.get_mut(h) else {
            return;
        };
        let t = Vector::new(p[0], p[1], p[2]);
        rb.set_translation(t, true);
        if rb.is_kinematic() {
            let pose = Pose::from_parts(t, *rb.rotation());
            rb.set_next_kinematic_position(pose);
        }
        if rb.is_dynamic() {
            rb.set_linvel(Vector::ZERO, true);
            rb.set_angvel(Vector::ZERO, true);
        }
        let mut pose = self.slots.pose(slot);
        pose[..3].copy_from_slice(&p);
        self.slots.write_pose(slot, pose, false);
        let f = self.slots.flags(slot);
        self.slots.set_flags(slot, f | NO_INTERP);
    }

    /// Sets a dynamic body's linear (m/s) and angular (rad/s) velocity and wakes it.
    /// No-op for unknown ids and non-dynamic bodies. Returns whether it applied.
    pub fn set_velocity(&mut self, id: u32, lin: [f32; 3], ang: [f32; 3]) -> bool {
        let Some(h) = self.entities.get(&id).and_then(|e| e.body) else {
            return false;
        };
        let Some(rb) = self.phys.bodies.get_mut(h) else {
            return false;
        };
        if !rb.is_dynamic() {
            return false;
        }
        rb.set_linvel(Vector::new(lin[0], lin[1], lin[2]), true);
        rb.set_angvel(Vector::new(ang[0], ang[1], ang[2]), true);
        true
    }

    /// A body's linear velocity (m/s) as of the last tick (zero for static bodies), or
    /// `None` for unknown ids.
    pub fn linear_velocity(&self, id: u32) -> Option<[f32; 3]> {
        let h = self.entities.get(&id).and_then(|e| e.body)?;
        let v = self.phys.bodies.get(h)?.linvel();
        Some([v.x, v.y, v.z])
    }

    /// A body's angular velocity (rad/s) as of the last tick (zero for static bodies), or
    /// `None` for unknown ids.
    pub fn angular_velocity(&self, id: u32) -> Option<[f32; 3]> {
        let h = self.entities.get(&id).and_then(|e| e.body)?;
        let w = self.phys.bodies.get(h)?.angvel();
        Some([w.x, w.y, w.z])
    }

    /// Adds a linear impulse (N*s) to a dynamic body and wakes it. No-op for unknown ids and
    /// non-dynamic bodies. Returns whether it applied.
    pub fn apply_impulse(&mut self, id: u32, impulse: [f32; 3]) -> bool {
        let Some(h) = self.entities.get(&id).and_then(|e| e.body) else {
            return false;
        };
        let Some(rb) = self.phys.bodies.get_mut(h) else {
            return false;
        };
        if !rb.is_dynamic() {
            return false;
        }
        rb.apply_impulse(Vector::new(impulse[0], impulse[1], impulse[2]), true);
        true
    }

    /// Adds a torque impulse (N*m*s) to a dynamic body and wakes it. No-op for unknown ids
    /// and non-dynamic bodies. Returns whether it applied.
    pub fn apply_torque_impulse(&mut self, id: u32, torque: [f32; 3]) -> bool {
        let Some(h) = self.entities.get(&id).and_then(|e| e.body) else {
            return false;
        };
        let Some(rb) = self.phys.bodies.get_mut(h) else {
            return false;
        };
        if !rb.is_dynamic() {
            return false;
        }
        rb.apply_torque_impulse(Vector::new(torque[0], torque[1], torque[2]), true);
        true
    }

    /// Sets the pose a kinematic body moves to during the next step (contacts see its
    /// velocity, unlike `teleport`). Interpolates normally. No-op (false) for non-kinematic
    /// bodies, a non-finite position, or a non-finite or zero-length quaternion.
    pub fn set_kinematic_pose(&mut self, id: u32, p: [f32; 3], q: [f32; 4]) -> bool {
        let len2: f32 = q.iter().map(|v| v * v).sum();
        if !p.iter().chain(&q).all(|v| v.is_finite()) || !len2.is_finite() || len2 < 1e-12 {
            return false;
        }
        let Some(h) = self.entities.get(&id).and_then(|e| e.body) else {
            return false;
        };
        let Some(rb) = self.phys.bodies.get_mut(h) else {
            return false;
        };
        if !rb.is_kinematic() {
            return false;
        }
        rb.set_next_kinematic_position(Pose::from_parts(Vector::new(p[0], p[1], p[2]), quat(q)));
        true
    }

    pub fn prev(&self) -> &[f32] {
        &self.slots.prev
    }

    pub fn curr(&self) -> &[f32] {
        &self.slots.curr
    }

    pub fn spawned_pending(&self) -> u32 {
        self.spawned.len() as u32
    }

    pub fn drain_spawned(&mut self) -> Vec<(u32, u32, u32)> {
        std::mem::take(&mut self.spawned)
    }
}

const _: () = assert!(STRIDE == 8);

fn flat_to_points(v: &[f32]) -> Vec<Vector> {
    v.chunks_exact(3)
        .map(|c| Vector::new(c[0], c[1], c[2]))
        .collect()
}

fn quat([qx, qy, qz, qw]: [f32; 4]) -> Rotation {
    Rotation::from_xyzw(qx, qy, qz, qw).normalize()
}

/// Body + collider builders for a validated `BodyDesc` (no pose or user data yet).
fn body_builders(b: &BodyDesc) -> Result<(RigidBodyBuilder, ColliderBuilder), String> {
    let collider = build_collider(&b.collider)?
        .friction(b.friction)
        .restitution(b.restitution);
    let collider = match b.mass {
        Some(m) => collider.mass(m),
        None => collider,
    };
    let rb = match b.body_type {
        BodyType::Dynamic => RigidBodyBuilder::dynamic(),
        BodyType::Static => RigidBodyBuilder::fixed(),
        BodyType::Kinematic => RigidBodyBuilder::kinematic_position_based(),
    }
    .linear_damping(b.linear_damping)
    .angular_damping(b.angular_damping)
    .ccd_enabled(b.ccd);
    Ok((rb, collider))
}

fn build_collider(c: &ColliderDesc) -> Result<ColliderBuilder, String> {
    Ok(match c {
        ColliderDesc::Box {
            half_extents: [x, y, z],
        } => ColliderBuilder::cuboid(*x, *y, *z),
        ColliderDesc::Sphere { radius } => ColliderBuilder::ball(*radius),
        ColliderDesc::Capsule {
            half_height,
            radius,
        } => ColliderBuilder::capsule_y(*half_height, *radius),
        ColliderDesc::ConvexHull { points } => {
            ColliderBuilder::convex_hull(&flat_to_points(points)).ok_or_else(|| {
                "body.collider.points: convex hull computation failed (degenerate points?)"
                    .to_string()
            })?
        }
        ColliderDesc::Trimesh {
            vertices,
            indices,
            fix_internal_edges,
        } => {
            let tris = indices
                .chunks_exact(3)
                .map(|t| [t[0], t[1], t[2]])
                .collect();
            let flags = if *fix_internal_edges {
                TriMeshFlags::FIX_INTERNAL_EDGES
            } else {
                TriMeshFlags::empty()
            };
            ColliderBuilder::trimesh_with_flags(flat_to_points(vertices), tris, flags)
                .map_err(|e| format!("body.collider: invalid trimesh: {e:?}"))?
        }
        ColliderDesc::Plane {} => ColliderBuilder::new(SharedShape::halfspace(Vector::Y)),
    })
}
