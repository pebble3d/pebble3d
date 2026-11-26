//! Opt-in `character.ridePlatforms`: a grounded character moves with the kinematic body
//! under it and keeps that body's velocity as momentum when it leaves.

use engine_core::{EntityDesc, SimWorld};

fn desc(json: &str) -> EntityDesc {
    EntityDesc::from_json(json).expect("valid desc json")
}

/// A 6 x 0.5 x 6 kinematic slab centred at (0, 0.25, 0): top face at y = 0.5.
fn platform(w: &mut SimWorld) -> u32 {
    w.spawn(desc(
        r#"{ "name": "platform", "position": [0,0.25,0],
             "body": { "type": "kinematic", "collider": { "shape": "box", "halfExtents": [3,0.25,3] } } }"#,
    ))
    .unwrap()
}

fn hero(w: &mut SimWorld, x: f32, z: f32, ride: bool) -> u32 {
    w.spawn(desc(&format!(
        r#"{{ "name": "hero", "position": [{x},1.4,{z}], "character": {{ "ridePlatforms": {ride} }},
              "body": {{ "type": "kinematic",
                         "collider": {{ "shape": "capsule", "halfHeight": 0.5, "radius": 0.3 }} }} }}"#
    )))
    .unwrap()
}

fn pos(w: &SimWorld, id: u32) -> [f32; 3] {
    let t = w.transform(id).unwrap();
    [t[0], t[1], t[2]]
}

fn grounded(w: &SimWorld, id: u32) -> bool {
    w.character_state(id).unwrap()[0] > 0.5
}

/// Settles the hero on the slab, then slides the slab +X at `speed` m/s for `ticks`.
fn slide(ride: bool, speed: f32, ticks: u32) -> (SimWorld, u32, u32) {
    let mut w = SimWorld::new(1, -9.81);
    let p = platform(&mut w);
    let c = hero(&mut w, 0.0, 0.0, ride);
    w.step(30);
    assert!(grounded(&w, c), "hero settles on the slab");
    for t in 1..=ticks {
        let x = speed * t as f32 / 60.0;
        assert!(w.set_kinematic_pose(p, [x, 0.25, 0.0], [0.0, 0.0, 0.0, 1.0]));
        w.step(1);
    }
    (w, p, c)
}

#[test]
fn rider_follows_a_sliding_platform() {
    let (w, p, c) = slide(true, 2.0, 60);
    let px = pos(&w, p)[0];
    let cx = pos(&w, c)[0];
    assert!((px - 2.0).abs() < 1e-4, "platform x={px}");
    assert!((cx - px).abs() < 0.05, "rider x={cx} vs platform x={px}");
    assert!(grounded(&w, c), "still grounded while riding");
    // The reported velocity is the character's own (relative) motion: idle here.
    let s = w.character_state(c).unwrap();
    assert!(s[1].abs() < 1e-3, "own vx={}", s[1]);
}

#[test]
fn without_the_flag_only_rapier_friction_drags_the_character() {
    // Default behaviour (unchanged): Rapier's kinematic friction drags the character
    // along one tick late, so it falls behind the platform.
    let (w, p, c) = slide(false, 2.0, 60);
    let lag = pos(&w, p)[0] - pos(&w, c)[0];
    assert!(lag > 0.1, "non-rider lags: {lag}");
}

#[test]
fn rider_walking_on_a_moving_platform_adds_both_motions() {
    let mut w = SimWorld::new(1, -9.81);
    let p = platform(&mut w);
    let c = hero(&mut w, -2.0, 0.0, true);
    w.step(30);
    let x0 = pos(&w, c)[0];
    w.set_character_input(c, 0.0, 0.0, false, false);
    w.set_character_input(c, 1.0, 0.0, false, false);
    for t in 1..=45 {
        // Platform slides +Z at 2 m/s while the hero walks +X at 4 m/s.
        w.set_kinematic_pose(p, [0.0, 0.25, 2.0 * t as f32 / 60.0], [0.0, 0.0, 0.0, 1.0]);
        w.step(1);
    }
    let [x, _, z] = pos(&w, c);
    assert!((x - x0 - 3.0).abs() < 0.1, "walked {}", x - x0);
    assert!((z - 1.5).abs() < 0.05, "carried z={z}");
}

#[test]
fn rider_is_carried_around_a_spinning_platform() {
    let mut w = SimWorld::new(1, -9.81);
    let p = platform(&mut w);
    let c = hero(&mut w, 2.0, 0.0, true);
    w.step(30);
    assert!(grounded(&w, c));
    // A quarter turn about +Y over 90 ticks: +X rotates toward -Z.
    for t in 1..=90 {
        let a = std::f32::consts::FRAC_PI_2 * t as f32 / 90.0;
        let (s, co) = (a * 0.5).sin_cos();
        w.set_kinematic_pose(p, [0.0, 0.25, 0.0], [0.0, s, 0.0, co]);
        w.step(1);
    }
    let [x, _, z] = pos(&w, c);
    assert!(
        x.abs() < 0.08 && (z + 2.0).abs() < 0.08,
        "rider at ({x}, {z})"
    );
    assert!(grounded(&w, c));
}

#[test]
fn rider_goes_up_and_down_with_a_lift() {
    let mut w = SimWorld::new(1, -9.81);
    let p = platform(&mut w);
    let c = hero(&mut w, 0.0, 0.0, true);
    w.step(30);
    let rest = pos(&w, c)[1] - pos(&w, p)[1];
    for t in 1..=120 {
        // Up 3 m over 1 s, then back down over 1 s.
        let y = 0.25
            + if t <= 60 {
                3.0 * t as f32 / 60.0
            } else {
                3.0 * (120 - t) as f32 / 60.0
            };
        w.set_kinematic_pose(p, [0.0, y, 0.0], [0.0, 0.0, 0.0, 1.0]);
        w.step(1);
        assert!(grounded(&w, c), "grounded at tick {t}");
        let gap = pos(&w, c)[1] - pos(&w, p)[1];
        assert!((gap - rest).abs() < 0.06, "tick {t}: gap {gap} vs {rest}");
    }
}

#[test]
fn jumping_off_keeps_the_platform_momentum() {
    let (mut w, p, c) = slide(true, 3.0, 30);
    let x0 = pos(&w, c)[0];
    w.set_character_input(c, 0.0, 0.0, true, false);
    let mut px = pos(&w, p)[0];
    for t in 31..=50 {
        px = 3.0 * t as f32 / 60.0;
        w.set_kinematic_pose(p, [px, 0.25, 0.0], [0.0, 0.0, 0.0, 1.0]);
        w.step(1);
        w.set_character_input(c, 0.0, 0.0, false, false);
    }
    assert!(!grounded(&w, c), "airborne");
    let x1 = pos(&w, c)[0];
    // 20 ticks at 3 m/s = 1 m of drift, matching the slab under it.
    assert!((x1 - x0 - 1.0).abs() < 0.08, "drifted {}", x1 - x0);
    assert!((x1 - px).abs() < 0.1);
    // Lands back on the slab and rides again.
    for t in 51..=110 {
        px = 3.0 * t as f32 / 60.0;
        w.set_kinematic_pose(p, [px, 0.25, 0.0], [0.0, 0.0, 0.0, 1.0]);
        w.step(1);
    }
    assert!(grounded(&w, c));
    assert!((pos(&w, c)[0] - px).abs() < 0.15);
}

#[test]
fn static_ground_is_never_ridden() {
    let mut w = SimWorld::new(1, -9.81);
    w.spawn(desc(
        r#"{ "position": [0,0,0], "body": { "type": "static", "collider": { "shape": "plane" } } }"#,
    ))
    .unwrap();
    let c = hero(&mut w, 0.0, 0.0, true);
    w.step(30);
    let a = pos(&w, c);
    w.step(60);
    let b = pos(&w, c);
    assert!(grounded(&w, c));
    assert_eq!(a, b, "a rider on static ground does not drift");
}

#[test]
fn rider_on_a_still_platform_stays_still() {
    let mut w = SimWorld::new(3, -9.81);
    platform(&mut w);
    let c = hero(&mut w, 0.5, -0.5, true);
    w.step(30);
    let a = pos(&w, c);
    w.step(120);
    assert_eq!(a, pos(&w, c));
}

#[test]
fn rider_walks_off_the_edge_and_falls() {
    let mut w = SimWorld::new(1, -9.81);
    platform(&mut w);
    let c = hero(&mut w, 2.0, 0.0, true);
    w.step(30);
    w.set_character_input(c, 1.0, 0.0, false, false);
    w.step(30); // 2 m at 4 m/s: past the slab's edge at x = 3
    w.set_character_input(c, 0.0, 0.0, false, false);
    w.step(20);
    assert!(!grounded(&w, c), "airborne past the edge");
    assert!(pos(&w, c)[1] < 0.5, "falling: y={}", pos(&w, c)[1]);
}

#[test]
fn rider_steps_from_a_platform_onto_a_static_ledge() {
    let mut w = SimWorld::new(1, -9.81);
    platform(&mut w);
    // Static ledge 0.3 m higher than the slab top, beyond its +X edge.
    w.spawn(desc(
        r#"{ "position": [5,0.4,0], "body": { "type": "static", "collider": { "shape": "box", "halfExtents": [2,0.4,3] } } }"#,
    ))
    .unwrap();
    let c = hero(&mut w, 1.5, 0.0, true);
    w.step(30);
    w.set_character_input(c, 1.0, 0.0, false, false);
    w.step(45);
    let [x, y, _] = pos(&w, c);
    assert!(x > 4.0, "x={x}");
    assert!((y - 1.6).abs() < 0.05, "on the ledge: y={y}");
    assert!(grounded(&w, c));
}

#[test]
fn a_platform_teleport_is_not_carried() {
    let mut w = SimWorld::new(1, -9.81);
    let p = platform(&mut w);
    let c = hero(&mut w, 0.0, 0.0, true);
    w.step(30);
    let before = pos(&w, c);
    // A 40 m jump in one tick (a looping platform reset via setKinematicPose).
    w.set_kinematic_pose(p, [40.0, 0.25, 0.0], [0.0, 0.0, 0.0, 1.0]);
    w.step(1);
    let after = pos(&w, c);
    assert!(
        (after[0] - before[0]).abs() < 0.01,
        "rider stayed: x {}",
        after[0]
    );
    // Left unsupported, it falls; no launch velocity.
    w.step(30);
    let s = w.character_state(c).unwrap();
    assert!(
        s[1].abs() < 0.01 && s[2].abs() < 0.01,
        "no horizontal launch: {s:?}"
    );
    assert!(pos(&w, c)[1] < before[1] - 0.5, "falls");
}

/// Two sliding movers, two riders (one per mover, one walking): the same run twice gives the
/// same hash, and each rider ends on its own mover.
#[test]
fn two_movers_two_riders_are_deterministic() {
    let run = || {
        let mut w = SimWorld::new(9, -18.0);
        let a = platform(&mut w);
        let b = w
            .spawn(desc(
                r#"{ "position": [0,0.25,10],
                     "body": { "type": "kinematic", "collider": { "shape": "box", "halfExtents": [3,0.25,3] } } }"#,
            ))
            .unwrap();
        let r1 = hero(&mut w, 1.0, 0.0, true);
        let r2 = hero(&mut w, -1.0, 10.0, true);
        w.step(30);
        for t in 1..=240u32 {
            let s = t as f32 / 60.0;
            w.set_kinematic_pose(
                a,
                [2.0 * (s * 1.3).sin(), 0.25 + 0.5 * s.min(2.0), 0.0],
                [0.0, 0.0, 0.0, 1.0],
            );
            let (sy, cy) = (s * 0.4).sin_cos();
            w.set_kinematic_pose(b, [-1.5 * s.min(2.0), 0.25, 10.0], [0.0, sy, 0.0, cy]);
            w.set_character_input(r2, if t < 60 { 0.5 } else { 0.0 }, 0.0, t == 120, false);
            w.step(1);
        }
        let (pa, pb) = (pos(&w, a), pos(&w, b));
        let (p1, p2) = (pos(&w, r1), pos(&w, r2));
        assert!(
            (p1[0] - pa[0]).abs() < 3.0 && (p1[2] - pa[2]).abs() < 3.0,
            "r1 on mover a"
        );
        assert!(
            (p2[0] - pb[0]).abs() < 3.0 && (p2[2] - pb[2]).abs() < 3.0,
            "r2 on mover b"
        );
        w.state_hash()
    };
    assert_eq!(run(), run());
}
