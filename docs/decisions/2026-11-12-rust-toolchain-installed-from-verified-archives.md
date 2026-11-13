# The Rust and NEAR tools were installed from verified archives, not from the installer scripts

Date: 2026-11-12. Author: integrator. Status: accepted.

## Context

The plan (Task P0.1) said "rustup with Rust 1.95.0 … installers from the official release pages". On the night of 2026-11-12 the path from the development machine to `static.rust-lang.org` delivered about 5–20 KB/s and rustup failed with `operation timed out`. The one-line installers of `cargo-near` and `near-cli-rs` pipe a remote script into a shell, which this project's sessions are not allowed to run unattended.

## Decision

- Rust 1.95.0 came from the official Docker image `rust:1.95.0-slim-bookworm` (Docker Hub, "Docker Official Image"): its toolchain directory was copied into `~/.rustup/toolchains` in WSL and set as default. `rustfmt`, `clippy` and the `wasm32-unknown-unknown` standard library were added by rustup from the release manifest, which checks each archive's SHA-256.
- `cargo-near` 0.23.0 and `near-cli-rs` 0.31.1 are the prebuilt binaries from their GitHub releases, checked against the `.sha256` file published with each release before extraction.
- CI installs `cargo-near` the same way, with the checksum written in the workflow.

## Alternatives considered

- Wait for the download: at the measured speed, hours, with the hackathon clock running.
- `cargo install cargo-near`: a 20-minute build that needs system packages this WSL does not have.

## Consequences

The versions are the ones the plan pinned (`rustc 1.95.0 (59807616e)`), obtained from the publishers' own channels. A new machine with a healthy connection can simply use rustup: `rust-toolchain.toml` pins the same version.
