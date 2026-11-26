//! Flat prev/curr state buffers shared with JS.
//!
//! Each slot is `STRIDE` f32s: `px,py,pz,qx,qy,qz,qw,flags`.

pub const STRIDE: usize = 8;
pub const INITIAL_CAPACITY: usize = 64;

pub const ACTIVE: u32 = 1;
pub const SLEEPING: u32 = 2;
pub const NO_INTERP: u32 = 4;

const FLAGS: usize = 7;

pub struct SlotTable {
    /// Free slot indices; popped from the back, so the lowest index is handed out first.
    pub free: Vec<u32>,
    pub prev: Vec<f32>,
    pub curr: Vec<f32>,
}

impl Default for SlotTable {
    fn default() -> Self {
        Self::new()
    }
}

impl SlotTable {
    pub fn new() -> Self {
        let mut t = SlotTable {
            free: Vec::new(),
            prev: Vec::new(),
            curr: Vec::new(),
        };
        t.grow_to(INITIAL_CAPACITY);
        t
    }

    pub fn capacity(&self) -> usize {
        self.curr.len() / STRIDE
    }

    fn grow_to(&mut self, new_cap: usize) {
        let old_cap = self.capacity();
        self.prev.resize(new_cap * STRIDE, 0.0);
        self.curr.resize(new_cap * STRIDE, 0.0);
        // Reverse order so `pop()` returns the lowest new index first.
        self.free.extend((old_cap as u32..new_cap as u32).rev());
    }

    /// Allocates a slot, doubling capacity if needed. The slot is marked
    /// `ACTIVE | NO_INTERP` in both buffers (pose zeroed until `write_pose`).
    pub fn alloc(&mut self) -> u32 {
        if self.free.is_empty() {
            let cap = self.capacity().max(1);
            self.grow_to(cap * 2);
        }
        let slot = self.free.pop().expect("free list refilled by growth");
        let base = slot as usize * STRIDE;
        for buf in [&mut self.prev, &mut self.curr] {
            buf[base..base + STRIDE].fill(0.0);
            buf[base + 6] = 1.0; // identity quaternion w
            buf[base + FLAGS] = (ACTIVE | NO_INTERP) as f32;
        }
        slot
    }

    /// Zeroes the slot in both buffers (flags = 0, i.e. inactive) and returns it to the free list.
    pub fn free(&mut self, slot: u32) {
        let base = slot as usize * STRIDE;
        self.prev[base..base + STRIDE].fill(0.0);
        self.curr[base..base + STRIDE].fill(0.0);
        self.free.push(slot);
    }

    pub fn flags(&self, slot: u32) -> u32 {
        self.curr[slot as usize * STRIDE + FLAGS] as u32
    }

    pub fn set_flags(&mut self, slot: u32, flags: u32) {
        self.curr[slot as usize * STRIDE + FLAGS] = flags as f32;
    }

    /// Writes a pose into `curr` (and into `prev` too when `both` is set).
    pub fn write_pose(&mut self, slot: u32, pose: [f32; 7], both: bool) {
        let base = slot as usize * STRIDE;
        self.curr[base..base + 7].copy_from_slice(&pose);
        if both {
            self.prev[base..base + 7].copy_from_slice(&pose);
        }
    }

    pub fn pose(&self, slot: u32) -> [f32; 7] {
        let base = slot as usize * STRIDE;
        let mut out = [0.0; 7];
        out.copy_from_slice(&self.curr[base..base + 7]);
        out
    }

    /// prev <- curr.
    pub fn copy_curr_to_prev(&mut self) {
        self.prev.copy_from_slice(&self.curr);
    }
}
