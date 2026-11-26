//! Entity description JSON (serde camelCase) and validation.

use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntityDesc {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub position: [f32; 3],
    #[serde(default = "identity_quat")]
    pub rotation: [f32; 4],
    #[serde(default)]
    pub body: Option<BodyDesc>,
    #[serde(default)]
    pub character: Option<CharacterDesc>,
    #[serde(default)]
    pub spawner: Option<SpawnerDesc>,
}

fn identity_quat() -> [f32; 4] {
    [0.0, 0.0, 0.0, 1.0]
}

/// Kinematic character controller settings. Requires a `kinematic` body with a
/// `capsule` collider. Every field has a default, so `"character": {}` is valid.
#[derive(Debug, Clone, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct CharacterDesc {
    /// Walk speed in m/s.
    pub speed: f32,
    /// Speed in m/s while the sprint input is held.
    pub sprint_speed: f32,
    /// Initial upward velocity of a jump, m/s.
    pub jump_speed: f32,
    /// Steepest slope the character can walk up, degrees.
    pub max_slope_deg: f32,
    /// Highest step `autostep` climbs, metres.
    pub step_height: f32,
    /// `snap_to_ground` distance, metres.
    pub snap: f32,
    /// Horizontal acceleration toward the input velocity, m/s². 0 = instant (no ramp).
    pub accel: f32,
    /// Opt-in: while grounded on a kinematic body, move with it (its translation and its
    /// rotation about its own origin), and keep its velocity as momentum when leaving it.
    pub ride_platforms: bool,
}

impl Default for CharacterDesc {
    fn default() -> Self {
        CharacterDesc {
            speed: 4.0,
            sprint_speed: 7.0,
            jump_speed: 5.5,
            max_slope_deg: 45.0,
            step_height: 0.35,
            snap: 0.3,
            accel: 0.0,
            ride_platforms: false,
        }
    }
}

/// Spawns copies of `template` at uniform random positions in the world-space
/// box `[areaMin, areaMax]`, `rate` per second, until `count` have been spawned.
/// The template's own `position` is ignored; its rotation is kept.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpawnerDesc {
    pub template: Box<EntityDesc>,
    /// Spawns per second.
    pub rate: f32,
    pub count: u32,
    pub area_min: [f32; 3],
    pub area_max: [f32; 3],
    /// Seeds this spawner's own `Pcg32`.
    #[serde(default)]
    pub seed: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BodyType {
    Dynamic,
    Static,
    Kinematic,
}

/// Defaults follow Rapier's own defaults (density 1 when `mass` is absent).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BodyDesc {
    #[serde(rename = "type")]
    pub body_type: BodyType,
    #[serde(default)]
    pub mass: Option<f32>,
    #[serde(default = "default_friction")]
    pub friction: f32,
    #[serde(default)]
    pub restitution: f32,
    #[serde(default)]
    pub linear_damping: f32,
    #[serde(default)]
    pub angular_damping: f32,
    #[serde(default)]
    pub ccd: bool,
    pub collider: ColliderDesc,
}

fn default_friction() -> f32 {
    0.5
}

#[derive(Debug, Clone, Deserialize)]
#[serde(
    tag = "shape",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ColliderDesc {
    Box {
        half_extents: [f32; 3],
    },
    Sphere {
        radius: f32,
    },
    Capsule {
        half_height: f32,
        radius: f32,
    },
    ConvexHull {
        points: Vec<f32>,
    },
    Trimesh {
        vertices: Vec<f32>,
        indices: Vec<u32>,
        /// Merges duplicate vertices and fixes internal-edge contacts, so a ball rolls
        /// smoothly across triangle seams (Rapier `TriMeshFlags::FIX_INTERNAL_EDGES`).
        #[serde(default)]
        fix_internal_edges: bool,
    },
    Plane {},
}

impl EntityDesc {
    pub fn from_json(json: &str) -> Result<EntityDesc, String> {
        serde_json::from_str(json).map_err(|e| format!("invalid entity desc: {e}"))
    }

    /// Structural validation that does not need Rapier. Shape construction
    /// (hull/trimesh) can still fail later in `SimWorld::spawn`.
    pub fn validate(&self) -> Result<(), String> {
        if self.body.is_none() && self.spawner.is_none() {
            return Err("entity requires a `body` or a `spawner`".into());
        }
        if !self.position.iter().all(|v| v.is_finite()) {
            return Err("position must be finite".into());
        }
        let q = self.rotation;
        let len2: f32 = q.iter().map(|v| v * v).sum();
        if !len2.is_finite() || len2 < 1e-12 {
            return Err("rotation must be a finite, non-zero quaternion".into());
        }
        if let Some(b) = &self.body {
            b.validate()?;
        }
        if let Some(c) = &self.character {
            c.validate(self.body.as_ref())?;
        }
        if let Some(sp) = &self.spawner {
            sp.validate()?;
        }
        Ok(())
    }
}

impl CharacterDesc {
    fn validate(&self, body: Option<&BodyDesc>) -> Result<(), String> {
        match body {
            Some(BodyDesc {
                body_type: BodyType::Kinematic,
                collider: ColliderDesc::Capsule { .. },
                ..
            }) => {}
            _ => {
                return Err(
                    "character requires a `kinematic` body with a `capsule` collider".into(),
                );
            }
        }
        positive("character.speed", self.speed)?;
        positive("character.sprintSpeed", self.sprint_speed)?;
        non_negative("character.jumpSpeed", self.jump_speed)?;
        non_negative("character.accel", self.accel)?;
        if !(self.max_slope_deg.is_finite()
            && self.max_slope_deg > 0.0
            && self.max_slope_deg < 90.0)
        {
            return Err(format!(
                "character.maxSlopeDeg must be in (0, 90) (got {})",
                self.max_slope_deg
            ));
        }
        non_negative("character.stepHeight", self.step_height)?;
        non_negative("character.snap", self.snap)?;
        Ok(())
    }
}

impl SpawnerDesc {
    fn validate(&self) -> Result<(), String> {
        let t = &self.template;
        if t.body.is_none() {
            return Err("spawner.template requires a `body`".into());
        }
        if t.spawner.is_some() || t.character.is_some() {
            return Err("spawner.template must not have a `spawner` or `character`".into());
        }
        t.validate().map_err(|e| format!("spawner.template: {e}"))?;
        non_negative("spawner.rate", self.rate)?;
        let finite = self
            .area_min
            .iter()
            .chain(&self.area_max)
            .all(|v| v.is_finite());
        let ordered = (0..3).all(|i| self.area_min[i] <= self.area_max[i]);
        if !finite || !ordered {
            return Err(format!(
                "spawner.area: areaMin must be <= areaMax on every axis (got {:?}..{:?})",
                self.area_min, self.area_max
            ));
        }
        Ok(())
    }
}

fn positive(name: &str, v: f32) -> Result<(), String> {
    if v.is_finite() && v > 0.0 {
        Ok(())
    } else {
        Err(format!("{name} must be > 0 (got {v})"))
    }
}

fn non_negative(name: &str, v: f32) -> Result<(), String> {
    if v.is_finite() && v >= 0.0 {
        Ok(())
    } else {
        Err(format!("{name} must be >= 0 (got {v})"))
    }
}

impl BodyDesc {
    fn validate(&self) -> Result<(), String> {
        if let Some(m) = self.mass {
            positive("body.mass", m)?;
        }
        non_negative("body.friction", self.friction)?;
        non_negative("body.restitution", self.restitution)?;
        non_negative("body.linearDamping", self.linear_damping)?;
        non_negative("body.angularDamping", self.angular_damping)?;
        match &self.collider {
            ColliderDesc::Box { half_extents } => {
                if !half_extents.iter().all(|v| v.is_finite() && *v > 0.0) {
                    return Err(format!(
                        "body.collider.halfExtents must all be > 0 (got {half_extents:?})"
                    ));
                }
            }
            ColliderDesc::Sphere { radius } => positive("body.collider.radius", *radius)?,
            ColliderDesc::Capsule {
                half_height,
                radius,
            } => {
                positive("body.collider.halfHeight", *half_height)?;
                positive("body.collider.radius", *radius)?;
            }
            ColliderDesc::ConvexHull { points } => {
                if points.len() % 3 != 0 || points.len() < 12 {
                    return Err(format!(
                        "body.collider.points must be flat xyz triples with >= 4 points (got {} floats)",
                        points.len()
                    ));
                }
                if !points.iter().all(|v| v.is_finite()) {
                    return Err("body.collider.points must be finite".into());
                }
            }
            ColliderDesc::Trimesh {
                vertices, indices, ..
            } => {
                if vertices.len() % 3 != 0 || vertices.len() < 9 {
                    return Err(format!(
                        "body.collider.vertices must be flat xyz triples with >= 3 vertices (got {} floats)",
                        vertices.len()
                    ));
                }
                if !vertices.iter().all(|v| v.is_finite()) {
                    return Err("body.collider.vertices must be finite".into());
                }
                if indices.is_empty() || indices.len() % 3 != 0 {
                    return Err(format!(
                        "body.collider.indices must be a non-empty multiple of 3 (got {})",
                        indices.len()
                    ));
                }
                let n = (vertices.len() / 3) as u32;
                if let Some(bad) = indices.iter().find(|&&i| i >= n) {
                    return Err(format!(
                        "body.collider.indices: index {bad} out of range (vertex count {n})"
                    ));
                }
                if self.body_type == BodyType::Dynamic {
                    return Err(
                        "body.collider: trimesh is only allowed on static or kinematic bodies"
                            .into(),
                    );
                }
            }
            ColliderDesc::Plane {} => {
                if self.body_type != BodyType::Static {
                    return Err("body.collider: plane is only allowed on static bodies".into());
                }
            }
        }
        Ok(())
    }
}
