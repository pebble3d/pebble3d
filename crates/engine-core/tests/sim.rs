use engine_core::{ACTIVE, EntityDesc, NO_INTERP, RayFilter, STRIDE, SimWorld};

fn desc(json: &str) -> EntityDesc {
    EntityDesc::from_json(json).expect("valid desc json")
}

fn plane() -> EntityDesc {
    desc(
        r#"{ "name": "ground", "position": [0,0,0],
              "body": { "type": "static", "collider": { "shape": "plane" } } }"#,
    )
}

fn unit_box(name: &str, x: f32, y: f32, z: f32, ty: &str) -> EntityDesc {
    desc(&format!(
        r#"{{ "name": "{name}", "position": [{x},{y},{z}], "rotation": [0,0,0,1],
              "body": {{ "type": "{ty}", "mass": 1, "friction": 0.7, "restitution": 0.1,
                         "linearDamping": 0, "angularDamping": 0.05, "ccd": false,
                         "collider": {{ "shape": "box", "halfExtents": [0.5,0.5,0.5] }} }} }}"#
    ))
}

fn sphere(name: &str, x: f32, y: f32, z: f32) -> EntityDesc {
    desc(&format!(
        r#"{{ "name": "{name}", "position": [{x},{y},{z}],
              "body": {{ "type": "dynamic", "collider": {{ "shape": "sphere", "radius": 0.3 }} }} }}"#
    ))
}

/// Static plane, a 3x3x3 box stack and 20 spheres.
fn world_with_stack() -> SimWorld {
    let mut w = SimWorld::new(42, -9.81);
    w.spawn(plane()).unwrap();
    for layer in 0..3 {
        for ix in 0..3 {
            for iz in 0..3 {
                let (x, z) = ((ix as f32 - 1.0) * 1.01, (iz as f32 - 1.0) * 1.01);
                let y = 0.5 + layer as f32 * 1.0;
                w.spawn(unit_box(
                    &format!("box-{layer}-{ix}-{iz}"),
                    x,
                    y,
                    z,
                    "dynamic",
                ))
                .unwrap();
            }
        }
    }
    for i in 0..20 {
        let x = (i % 5) as f32 * 0.7 - 1.4;
        let z = (i / 5) as f32 * 0.7 - 1.05;
        w.spawn(sphere(&format!("ball-{i}"), x, 5.0 + i as f32 * 0.4, z))
            .unwrap();
    }
    w
}

fn flags(w: &SimWorld, id: u32) -> u32 {
    let slot = w.slot_of(id).unwrap() as usize;
    w.curr()[slot * STRIDE + 7] as u32
}

#[cfg(not(feature = "fast"))]
#[test]
fn deterministic_hash_matches_across_runs() {
    let mut a = world_with_stack();
    let mut b = world_with_stack();
    a.step(1000);
    b.step(1000);
    assert_eq!(a.tick(), 1000);
    assert_eq!(a.state_hash(), b.state_hash());
}

#[test]
fn resting_box_stays_put() {
    let mut w = SimWorld::new(1, -9.81);
    w.spawn(plane()).unwrap();
    let id = w
        .spawn(unit_box("crate", 0.0, 0.5, 0.0, "dynamic"))
        .unwrap();
    w.step(120);
    let y120 = w.transform(id).unwrap()[1];
    w.step(480);
    assert_eq!(w.tick(), 600);
    let y600 = w.transform(id).unwrap()[1];
    assert!((y120 - y600).abs() < 0.001, "y120={y120} y600={y600}");
    assert!((y600 - 0.5).abs() < 0.005, "y600={y600}");
}

#[test]
fn prev_holds_previous_tick() {
    let mut a = world_with_stack();
    let mut b = world_with_stack();
    a.step(2);
    let snapshot = a.curr().to_vec();
    b.step(3);
    assert_eq!(b.prev(), &snapshot[..]);
    assert_ne!(b.curr(), &snapshot[..], "tick 3 must differ from tick 2");
}

#[test]
fn spawn_sets_no_interp_then_clears() {
    let mut w = SimWorld::new(1, -9.81);
    w.spawn(plane()).unwrap();
    let id = w
        .spawn(unit_box("crate", 0.0, 3.0, 0.0, "dynamic"))
        .unwrap();
    assert_ne!(flags(&w, id) & NO_INTERP, 0);
    w.step(1);
    assert_eq!(flags(&w, id) & NO_INTERP, 0);
    assert_ne!(flags(&w, id) & ACTIVE, 0);
}

#[test]
fn despawn_frees_and_reuses_slot() {
    let mut w = SimWorld::new(1, -9.81);
    w.spawn(plane()).unwrap();
    let a = w.spawn(unit_box("a", 0.0, 3.0, 0.0, "dynamic")).unwrap();
    w.step(5);
    let slot_a = w.slot_of(a).unwrap();
    assert!(w.despawn(a));
    assert!(!w.despawn(a), "double despawn must return false");
    assert_eq!(w.slot_of(a), None);
    let b = w.spawn(unit_box("b", 2.0, 3.0, 0.0, "dynamic")).unwrap();
    assert_ne!(a, b, "ids are never reused");
    assert_eq!(w.slot_of(b), Some(slot_a));
    assert_ne!(flags(&w, b) & NO_INTERP, 0);
}

#[test]
fn buffers_grow_past_initial_capacity() {
    let mut w = SimWorld::new(1, -9.81);
    assert_eq!(w.slot_capacity(), 64);
    let mut ids = Vec::new();
    for i in 0..200 {
        let (x, z) = ((i % 20) as f32 * 1.5, (i / 20) as f32 * 1.5);
        ids.push(
            w.spawn(unit_box(&format!("b{i}"), x, 0.5, z, "dynamic"))
                .unwrap(),
        );
    }
    assert!(w.curr().len() >= 200 * STRIDE);
    assert_eq!(w.prev().len(), w.curr().len());
    w.step(2);
    for id in ids {
        let slot = w.slot_of(id).unwrap() as usize;
        let t = w.transform(id).unwrap();
        assert_eq!(&w.curr()[slot * STRIDE..slot * STRIDE + 7], &t[..]);
    }
}

#[test]
fn raycast_hits_ground() {
    let mut w = SimWorld::new(1, -9.81);
    let ground = w.spawn(plane()).unwrap();
    w.step(1);
    let hit = w
        .raycast([0.0, 10.0, 0.0], [0.0, -1.0, 0.0], 100.0, RayFilter::All)
        .expect("hit ground");
    assert!((hit.toi - 10.0).abs() < 1e-3, "toi={}", hit.toi);
    assert!((hit.normal[0]).abs() < 1e-3);
    assert!((hit.normal[1] - 1.0).abs() < 1e-3);
    assert!((hit.normal[2]).abs() < 1e-3);
    assert_eq!(hit.id, ground);
}

#[test]
fn raycast_static_only_ignores_dynamic() {
    let mut w = SimWorld::new(1, -9.81);
    let ground = w.spawn(plane()).unwrap();
    let crate_id = w
        .spawn(unit_box("crate", 0.0, 5.0, 0.0, "dynamic"))
        .unwrap();
    w.step(1);
    let st = w
        .raycast(
            [0.0, 10.0, 0.0],
            [0.0, -1.0, 0.0],
            100.0,
            RayFilter::StaticOnly,
        )
        .expect("hit ground");
    assert!((st.toi - 10.0).abs() < 1e-3, "toi={}", st.toi);
    assert_eq!(st.id, ground);
    let all = w
        .raycast([0.0, 10.0, 0.0], [0.0, -1.0, 0.0], 100.0, RayFilter::All)
        .expect("hit crate");
    assert_eq!(all.id, crate_id);
    assert!(all.toi < 5.0, "toi={}", all.toi);
    let ex = w
        .raycast(
            [0.0, 10.0, 0.0],
            [0.0, -1.0, 0.0],
            100.0,
            RayFilter::Exclude(crate_id),
        )
        .expect("hit ground");
    assert_eq!(ex.id, ground);
}

#[test]
fn invalid_desc_errors() {
    let mut w = SimWorld::new(1, -9.81);
    let bad = desc(
        r#"{ "body": { "type": "dynamic", "collider": { "shape": "box", "halfExtents": [0,1,1] } } }"#,
    );
    let err = w.spawn(bad).unwrap_err();
    assert!(err.contains("halfExtents"), "err={err}");
    let err = w.spawn(desc("{}")).unwrap_err();
    assert!(err.contains("body"), "err={err}");
}

// ---------------------------------------------------------------- spawners

fn spawner(seed: u32, rate: f32, count: u32) -> EntityDesc {
    desc(&format!(
        r#"{{ "name": "rain", "spawner": {{
              "template": {{ "body": {{ "type": "dynamic",
                  "collider": {{ "shape": "sphere", "radius": 0.25 }} }} }},
              "rate": {rate}, "count": {count},
              "areaMin": [-3, 4, -3], "areaMax": [3, 8, 3], "seed": {seed} }} }}"#
    ))
}

fn rain_world(seed: u32) -> (SimWorld, u32) {
    let mut w = SimWorld::new(7, -9.81);
    w.spawn(plane()).unwrap();
    let s = w.spawn(spawner(seed, 10.0, 40)).unwrap();
    (w, s)
}

#[test]
fn spawner_is_reproducible() {
    let (mut a, sa) = rain_world(11);
    let (mut b, _) = rain_world(11);
    a.step(300);
    b.step(300);
    assert_eq!(a.state_hash(), b.state_hash());
    let da = a.drain_spawned();
    let db = b.drain_spawned();
    assert_eq!(
        da.len(),
        40,
        "rate 10/s for 5 s spawns the full count of 40"
    );
    assert_eq!(da, db);
    for &(id, slot, spawner_id) in &da {
        assert_eq!(spawner_id, sa);
        assert_eq!(a.slot_of(id), Some(slot));
    }
    assert_eq!(a.spawned_pending(), 0, "drain empties the queue");

    // A different seed scatters the spawns differently.
    let (mut c, _) = rain_world(12);
    c.step(300);
    assert_ne!(a.state_hash(), c.state_hash());
}

#[test]
fn spawner_places_inside_area_with_no_interp() {
    let (mut w, _) = rain_world(3);
    // 10/s: the accumulator reaches 1 on tick 6.
    w.step(5);
    assert_eq!(w.spawned_pending(), 0);
    w.step(1);
    let spawned = w.drain_spawned();
    assert_eq!(spawned.len(), 1);
    let (id, slot, _) = spawned[0];
    let t = w.transform(id).unwrap();
    assert!(
        (-3.0..=3.0).contains(&t[0]) && (-3.0..=3.0).contains(&t[2]),
        "t={t:?}"
    );
    assert!(t[1] > 3.5 && t[1] <= 8.0, "t={t:?}");
    let f = w.curr()[slot as usize * STRIDE + 7] as u32;
    assert_ne!(
        f & NO_INTERP,
        0,
        "spawned this tick: must snap, not interpolate"
    );
    w.step(1);
    let f = w.curr()[slot as usize * STRIDE + 7] as u32;
    assert_eq!(f & NO_INTERP, 0);
}

#[test]
fn spawner_respects_count() {
    let mut w = SimWorld::new(1, -9.81);
    w.spawn(plane()).unwrap();
    w.spawn(spawner(5, 1000.0, 50)).unwrap();
    w.step(600);
    assert_eq!(w.drain_spawned().len(), 50);
}

#[test]
fn reused_slot_spawned_same_tick_keeps_no_interp() {
    let mut w = SimWorld::new(1, -9.81);
    w.spawn(plane()).unwrap();
    let a = w.spawn(unit_box("a", 5.0, 3.0, 0.0, "dynamic")).unwrap();
    let slot_a = w.slot_of(a).unwrap();
    // Teleport marks `a` NO_INTERP, then despawn frees its slot before the tick.
    w.teleport(a, [5.0, 4.0, 0.0]);
    w.despawn(a);
    // The spawner's first spawn (rate 60/s = 1 per tick) reuses that slot.
    w.spawn(spawner(9, 60.0, 1)).unwrap();
    w.step(1);
    let (id, slot, _) = w.drain_spawned()[0];
    assert_eq!(slot, slot_a);
    let f = w.curr()[slot as usize * STRIDE + 7] as u32;
    assert_ne!(f & NO_INTERP, 0, "id={id}");
}

#[test]
fn spawner_rejects_bad_desc() {
    let mut w = SimWorld::new(1, -9.81);
    let bad = desc(
        r#"{ "spawner": { "template": { "position": [0,0,0] }, "rate": 1, "count": 1,
              "areaMin": [0,0,0], "areaMax": [1,1,1] } }"#,
    );
    let err = w.spawn(bad).unwrap_err();
    assert!(err.contains("spawner.template"), "err={err}");
    let bad = desc(
        r#"{ "spawner": { "template": { "body": { "type": "dynamic",
              "collider": { "shape": "sphere", "radius": 0.2 } } }, "rate": 1, "count": 1,
              "areaMin": [2,0,0], "areaMax": [1,1,1] } }"#,
    );
    let err = w.spawn(bad).unwrap_err();
    assert!(err.contains("spawner.area"), "err={err}");
}

// --------------------------------------------------------------- character

fn character(x: f32, y: f32, z: f32) -> EntityDesc {
    desc(&format!(
        r#"{{ "name": "hero", "position": [{x},{y},{z}], "character": {{}},
              "body": {{ "type": "kinematic",
                         "collider": {{ "shape": "capsule", "halfHeight": 0.5, "radius": 0.3 }} }} }}"#
    ))
}

/// `[grounded, vx, vz, vy]`.
fn cstate(w: &SimWorld, id: u32) -> [f32; 4] {
    w.character_state(id).expect("character state")
}

fn grounded_character() -> (SimWorld, u32) {
    let mut w = SimWorld::new(1, -9.81);
    w.spawn(plane()).unwrap();
    let c = w.spawn(character(0.0, 0.9, 0.0)).unwrap();
    w.step(30);
    assert_eq!(cstate(&w, c)[0], 1.0, "character must settle on the ground");
    (w, c)
}

#[test]
fn character_falls_then_grounds() {
    let mut w = SimWorld::new(1, -9.81);
    w.spawn(plane()).unwrap();
    let c = w.spawn(character(0.0, 3.0, 0.0)).unwrap();
    w.step(10);
    let s = cstate(&w, c);
    assert_eq!(s[0], 0.0, "airborne after 10 ticks");
    assert!(s[3] < 0.0, "falling: vy={}", s[3]);
    w.step(110);
    let s = cstate(&w, c);
    assert_eq!(s[0], 1.0);
    assert_eq!(s[3], 0.0);
    let y = w.transform(c).unwrap()[1];
    // Capsule centre rests at halfHeight + radius (0.8) above the plane.
    assert!((y - 0.8).abs() < 0.05, "y={y}");
}

#[test]
fn character_moves_with_input() {
    let (mut w, c) = grounded_character();
    let x0 = w.transform(c).unwrap()[0];
    w.set_character_input(c, 1.0, 0.0, false, false);
    w.step(60);
    let x1 = w.transform(c).unwrap()[0];
    assert!((x1 - x0 - 4.0).abs() < 0.3, "moved {}", x1 - x0);
    let s = cstate(&w, c);
    assert!((s[1] - 4.0).abs() < 0.1, "vx={}", s[1]);
    assert!(s[2].abs() < 0.05, "vz={}", s[2]);
    assert_eq!(s[0], 1.0);

    // Sprint uses sprintSpeed (7).
    w.set_character_input(c, 0.0, 1.0, false, true);
    w.step(10);
    let s = cstate(&w, c);
    assert!((s[2] - 7.0).abs() < 0.1, "vz={}", s[2]);
}

#[test]
fn character_accel_ramps_velocity() {
    let mut w = SimWorld::new(1, -9.81);
    w.spawn(plane()).unwrap();
    let c = w
        .spawn(desc(
            r#"{ "name": "hero", "position": [0,0.9,0], "character": { "accel": 12 },
                 "body": { "type": "kinematic",
                           "collider": { "shape": "capsule", "halfHeight": 0.5, "radius": 0.3 } } }"#,
        ))
        .unwrap();
    w.step(30);
    // Speed 4 at 12 m/s^2: one tick reaches 0.2 m/s, 20 ticks reach 4.
    w.set_character_input(c, 1.0, 0.0, false, false);
    w.step(1);
    let vx = cstate(&w, c)[1];
    assert!((vx - 0.2).abs() < 0.02, "after 1 tick vx={vx}");
    w.step(19);
    let vx = cstate(&w, c)[1];
    assert!((vx - 4.0).abs() < 0.05, "after 20 ticks vx={vx}");
    w.step(10);
    assert!((cstate(&w, c)[1] - 4.0).abs() < 0.05, "holds top speed");
    // Reversing passes through zero over the ramp instead of flipping in one tick.
    w.set_character_input(c, -1.0, 0.0, false, false);
    w.step(1);
    let vx = cstate(&w, c)[1];
    assert!((vx - 3.8).abs() < 0.02, "reverse 1 tick vx={vx}");
    // Release: decelerates to rest (8 m/s from 4 takes 20 ticks at 12 m/s^2).
    w.set_character_input(c, 0.0, 0.0, false, false);
    w.step(1);
    assert!(cstate(&w, c)[1] > 3.5, "no instant stop");
    w.step(30);
    assert!(cstate(&w, c)[1].abs() < 1.0e-4, "comes to rest");
}

#[test]
fn character_accel_rejects_negative() {
    let mut w = SimWorld::new(1, -9.81);
    let e = w.spawn(desc(
        r#"{ "character": { "accel": -1 }, "body": { "type": "kinematic",
             "collider": { "shape": "capsule", "halfHeight": 0.5, "radius": 0.3 } } }"#,
    ));
    assert!(e.is_err());
}

#[test]
fn character_jump_leaves_ground() {
    let (mut w, c) = grounded_character();
    let y0 = w.transform(c).unwrap()[1];
    w.set_character_input(c, 0.0, 0.0, true, false);
    w.step(1);
    let s = cstate(&w, c);
    assert!(s[3] > 0.0, "vy={}", s[3]);
    w.set_character_input(c, 0.0, 0.0, false, false);
    w.step(10);
    assert!(w.transform(c).unwrap()[1] > y0 + 0.3);
    assert_eq!(cstate(&w, c)[0], 0.0);
}

#[test]
fn character_pushes_dynamic_box() {
    let (mut w, c) = grounded_character();
    let b = w
        .spawn(unit_box("crate", 1.5, 0.5, 0.0, "dynamic"))
        .unwrap();
    w.step(5);
    let bx0 = w.transform(b).unwrap()[0];
    w.set_character_input(c, 1.0, 0.0, false, false);
    w.step(60);
    let bx1 = w.transform(b).unwrap()[0];
    assert!(bx1 > bx0 + 0.1, "box x {bx0} -> {bx1}");
}

#[test]
fn character_requires_kinematic_capsule() {
    let mut w = SimWorld::new(1, -9.81);
    let on_box = desc(
        r#"{ "character": {}, "body": { "type": "kinematic",
              "collider": { "shape": "box", "halfExtents": [0.5,0.5,0.5] } } }"#,
    );
    let err = w.spawn(on_box).unwrap_err();
    assert!(err.contains("character"), "err={err}");
    let dynamic = desc(
        r#"{ "character": {}, "body": { "type": "dynamic",
              "collider": { "shape": "capsule", "halfHeight": 0.5, "radius": 0.3 } } }"#,
    );
    let err = w.spawn(dynamic).unwrap_err();
    assert!(err.contains("character"), "err={err}");
    assert_eq!(w.character_state(999), None);
}

#[test]
fn set_velocity_moves_dynamic_bodies_only() {
    let mut w = SimWorld::new(1, 0.0);
    let a = w.spawn(unit_box("a", 0.0, 3.0, 0.0, "dynamic")).unwrap();
    let k = w.spawn(unit_box("k", 50.0, 3.0, 0.0, "kinematic")).unwrap();
    assert!(w.set_velocity(a, [6.0, 0.0, 0.0], [0.0, 0.0, 4.0]));
    assert!(!w.set_velocity(k, [6.0, 0.0, 0.0], [0.0, 0.0, 0.0]));
    assert!(!w.set_velocity(9999, [1.0, 0.0, 0.0], [0.0, 0.0, 0.0]));
    w.step(60);
    let ta = w.transform(a).unwrap();
    assert!((ta[0] - 6.0).abs() < 0.05, "x={}", ta[0]);
    // Spinning about Z: the rotation left identity.
    assert!(ta[6].abs() < 0.999, "qw={}", ta[6]);
    let tk = w.transform(k).unwrap();
    assert!((tk[0] - 50.0).abs() < 1e-6);
}

#[test]
fn apply_impulse_and_linear_velocity() {
    let mut w = SimWorld::new(1, 0.0);
    let a = w.spawn(unit_box("a", 0.0, 3.0, 0.0, "dynamic")).unwrap();
    let s = w.spawn(unit_box("s", 50.0, 3.0, 0.0, "static")).unwrap();
    // mass 1: an impulse of 2 N·s is a 2 m/s change.
    assert!(w.apply_impulse(a, [2.0, 0.0, -1.0]));
    assert!(!w.apply_impulse(s, [2.0, 0.0, 0.0]));
    assert!(!w.apply_impulse(9999, [2.0, 0.0, 0.0]));
    w.step(1);
    let v = w.linear_velocity(a).unwrap();
    assert!(
        (v[0] - 2.0).abs() < 1e-4 && v[1].abs() < 1e-4 && (v[2] + 1.0).abs() < 1e-4,
        "v={v:?}"
    );
    assert_eq!(w.linear_velocity(s), Some([0.0, 0.0, 0.0]));
    assert_eq!(w.linear_velocity(9999), None);
    w.step(59);
    let t = w.transform(a).unwrap();
    assert!((t[0] - 2.0).abs() < 0.05, "x={}", t[0]);
}

#[test]
fn character_with_accel_climbs_stairs() {
    // Regression: the blocked-ramp clamp used to zero the ramp at every step face, so an
    // `accel` character could never build the speed autostep needs and stood at the first
    // step forever.
    let mut w = SimWorld::new(1, -18.0);
    w.spawn(plane()).unwrap();
    for i in 0..6 {
        let h = 0.3 * (i as f32 + 1.0);
        w.spawn(desc(&format!(
            r#"{{ "position": [0,{},{}], "body": {{ "type": "static",
                 "collider": {{ "shape": "box", "halfExtents": [1.5,{},0.35] }} }} }}"#,
            h / 2.0,
            -2.0 - 0.7 * i as f32,
            h / 2.0
        )))
        .unwrap();
    }
    let c = w
        .spawn(desc(
            r#"{ "position": [0,0.85,1], "character": { "speed": 5, "accel": 32, "stepHeight": 0.4 },
                 "body": { "type": "kinematic",
                           "collider": { "shape": "capsule", "halfHeight": 0.5, "radius": 0.3 } } }"#,
        ))
        .unwrap();
    w.step(30);
    w.set_character_input(c, 0.0, -1.0, false, false);
    let mut top = 0.0f32;
    for _ in 0..120 {
        w.step(1);
        top = top.max(w.transform(c).unwrap()[1]);
    }
    // Reached the 1.8 m top step (capsule centre 0.8 above it).
    assert!(top > 2.5, "highest centre y={top}");
}
