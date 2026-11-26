//! Smooth trimeshes (`fixInternalEdges`).

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

/// A flat grid trimesh (n x n quads of size `cell`), flat xyz + indices JSON.
fn grid_json(n: usize, cell: f32, fix: bool) -> String {
    let mut v = Vec::new();
    let mut idx = Vec::new();
    let half = n as f32 * cell / 2.0;
    for i in 0..n {
        for j in 0..n {
            // Unshared vertices per quad: seams are where internal-edge bumps appear.
            let (x0, z0) = (i as f32 * cell - half, j as f32 * cell - half);
            let base = v.len() / 3;
            for (x, z) in [
                (x0, z0),
                (x0 + cell, z0),
                (x0 + cell, z0 + cell),
                (x0, z0 + cell),
            ] {
                v.extend_from_slice(&[x, 0.0, z]);
            }
            idx.extend_from_slice(&[base, base + 2, base + 1, base, base + 3, base + 2]);
        }
    }
    let vs: Vec<String> = v.iter().map(|f| format!("{f}")).collect();
    let is: Vec<String> = idx.iter().map(|i| i.to_string()).collect();
    format!(
        r#"{{ "body": {{ "type": "static", "collider": {{ "shape": "trimesh", "fixInternalEdges": {fix},
              "vertices": [{}], "indices": [{}] }} }} }}"#,
        vs.join(","),
        is.join(",")
    )
}

/// Rolls a ball across a seamed grid; returns the highest it hopped off the floor.
fn max_bounce(fix: bool) -> f32 {
    let mut w = SimWorld::new(1, -9.81);
    w.spawn(desc(&grid_json(24, 1.0, fix))).unwrap();
    let id = ball(&mut w, 0.5);
    w.step(30);
    w.set_velocity(id, [12.0, 0.0, 3.0], [3.0 / 0.5, 0.0, -12.0 / 0.5]);
    let mut max_y: f32 = 0.0;
    for _ in 0..50 {
        w.step(1);
        max_y = max_y.max(w.transform(id).unwrap()[1] - 0.5);
    }
    max_y
}

#[test]
fn fix_internal_edges_parses_and_rolls_smoothly() {
    let fixed = max_bounce(true);
    let raw = max_bounce(false);
    // the flag must matter: the same grid without it kicks the ball off the seams
    assert!(
        raw > 0.05 && raw > fixed * 10.0,
        "unflagged rise {raw}, flagged {fixed}"
    );
    assert!(
        fixed < 0.01,
        "ball bounced at a seam with fixInternalEdges: rise {fixed}"
    );
}

#[test]
fn trimesh_without_flag_still_parses() {
    let d = desc(&grid_json(2, 1.0, false));
    let mut w = SimWorld::new(1, -9.81);
    assert!(w.spawn(d).is_ok());
}
