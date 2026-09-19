//! Kingu Intelligence core engine.
//!
//! Phase 3 target: progressively replaces the native/ modules and the kingud
//! daemon with a Rust engine (agent orchestration, PTY, worktree isolation).

pub const ENGINE_NAME: &str = "kingu-core";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn engine_name_is_branded() {
        assert_eq!(ENGINE_NAME, "kingu-core");
    }
}
