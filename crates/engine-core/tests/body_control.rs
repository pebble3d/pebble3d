//! Body control API: velocity readback, impulses and kinematic poses.

use engine_core::{EntityDesc, SimWorld};

fn desc(json: &str) -> EntityDesc {
    EntityDesc::from_json(json).expect("valid desc json")
}

fn ball(w: &mut SimWorld, y: f32) -> u32 {
    w.spawn(desc(&format!(
        r#"{{ "position": [0,{y},0], "body": {{ "type": "dynamic", "mass": 2,
              "collider": {{ "shape": "sphere", "radius": 0.5 }} }} }}"#
    )))
    .unwrap()
}

#[test]
fn velocity_readback_matches_gravity() {
    let mut w = SimWorld::new(1, -10.0);
    let id = ball(&mut w, 10.0);
    w.step(60);
    let v = w.linear_velocity(id).unwrap();
    assert!(
        (v[1] + 10.0).abs() < 0.05,
        "vy after 1 s of -10 gravity: {}",
        v[1]
    );
    assert_eq!(w.angular_velocity(id).unwrap(), [0.0, 0.0, 0.0]);
}

#[test]
fn velocity_is_zero_for_static_and_none_for_unknown() {
    let mut w = SimWorld::new(1, -9.81);
    let s = w
        .spawn(desc(
            r#"{ "body": { "type": "static", "collider": { "shape": "plane" } } }"#,
        ))
        .unwrap();
    assert_eq!(w.linear_velocity(s), Some([0.0, 0.0, 0.0]));
    assert_eq!(w.angular_velocity(s), Some([0.0, 0.0, 0.0]));
    assert!(w.linear_velocity(999).is_none());
    assert!(w.angular_velocity(999).is_none());
}

#[test]
fn impulse_changes_linear_and_angular_velocity() {
    let mut w = SimWorld::new(1, 0.0);
    let id = ball(&mut w, 0.0);
    assert!(w.apply_impulse(id, [4.0, 0.0, 0.0]));
    assert!(w.apply_torque_impulse(id, [0.0, 0.0, 1.0]));
    w.step(1);
    let v = w.linear_velocity(id).unwrap();
    // mass 2: dv = 4 / 2
    assert!((v[0] - 2.0).abs() < 1e-4, "vx {}", v[0]);
    // solid sphere inertia 2/5 m r^2 = 0.2: dw = 1 / 0.2
    let a = w.angular_velocity(id).unwrap();
    assert!((a[2] - 5.0).abs() < 1e-3, "wz {}", a[2]);
}

#[test]
fn impulse_is_rejected_for_non_dynamic() {
    let mut w = SimWorld::new(1, 0.0);
    let k = w
        .spawn(desc(
            r#"{ "body": { "type": "kinematic", "collider": { "shape": "box", "halfExtents": [1,1,1] } } }"#,
        ))
        .unwrap();
    assert!(!w.apply_impulse(k, [1.0, 0.0, 0.0]));
    assert!(!w.apply_impulse(999, [1.0, 0.0, 0.0]));
    assert!(!w.apply_torque_impulse(k, [0.0, 1.0, 0.0]));
    assert!(!w.apply_torque_impulse(999, [0.0, 1.0, 0.0]));
}

#[test]
fn kinematic_pose_moves_and_rotates_on_next_step() {
    let mut w = SimWorld::new(1, -9.81);
    let k = w
        .spawn(desc(
            r#"{ "body": { "type": "kinematic", "collider": { "shape": "box", "halfExtents": [1,0.1,1] } } }"#,
        ))
        .unwrap();
    let s = std::f32::consts::FRAC_1_SQRT_2;
    assert!(w.set_kinematic_pose(k, [1.0, 2.0, 3.0], [0.0, s, 0.0, s]));
    w.step(1);
    let t = w.transform(k).unwrap();
    assert!((t[0] - 1.0).abs() < 1e-5 && (t[1] - 2.0).abs() < 1e-5 && (t[2] - 3.0).abs() < 1e-5);
    assert!((t[4] - s).abs() < 1e-5 && (t[6] - s).abs() < 1e-5);
    let dynamic = ball(&mut w, 5.0);
    assert!(!w.set_kinematic_pose(dynamic, [0.0; 3], [0.0, 0.0, 0.0, 1.0]));
}

#[test]
fn kinematic_pose_rejects_non_finite_and_zero_quaternions() {
    let mut w = SimWorld::new(1, -9.81);
    let k = w
        .spawn(desc(
            r#"{ "position": [0,1,0], "body": { "type": "kinematic", "collider": { "shape": "box", "halfExtents": [1,0.1,1] } } }"#,
        ))
        .unwrap();
    assert!(!w.set_kinematic_pose(k, [0.0; 3], [0.0, 0.0, 0.0, 0.0]));
    assert!(!w.set_kinematic_pose(k, [0.0; 3], [f32::NAN, 0.0, 0.0, 1.0]));
    assert!(!w.set_kinematic_pose(k, [f32::INFINITY, 0.0, 0.0], [0.0, 0.0, 0.0, 1.0]));
    w.step(1);
    let t = w.transform(k).unwrap();
    assert!(t.iter().all(|v| v.is_finite()));
    assert!(
        (t[1] - 1.0).abs() < 1e-6,
        "rejected poses must not move the body"
    );
}
