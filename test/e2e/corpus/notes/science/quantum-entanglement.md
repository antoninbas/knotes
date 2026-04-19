---
title: Quantum Entanglement
created: 2024-01-20T09:00:00.000Z
modified: 2024-01-20T09:00:00.000Z
tags: ["physics", "quantum", "entanglement"]
type: note
---

Quantum entanglement is a physical phenomenon where two or more particles become correlated in such a way that the quantum state of each cannot be described independently, even when separated by large distances.

## Bell Pairs

The simplest entangled system is a Bell pair: two qubits in the maximally entangled state. One such state is:

|Φ⁺⟩ = (|00⟩ + |11⟩) / √2

When one qubit is measured in the computational basis and found to be |0⟩, the other qubit collapses to |0⟩ instantaneously — regardless of the spatial separation. The four Bell states (Φ⁺, Φ⁻, Ψ⁺, Ψ⁻) are the four maximally entangled two-qubit states and form an orthonormal basis for the two-qubit Hilbert space.

## Non-Locality

Bell's theorem (1964) proved that no local hidden variable theory can reproduce all predictions of quantum mechanics. The CHSH inequality and subsequent Bell tests (Aspect 1982, Hensen 2015, and others) have demonstrated statistically significant violations of the Bell inequality, confirming that quantum correlations are genuinely non-local.

Non-locality does not permit faster-than-light communication. Measuring one entangled qubit yields a random result; only by comparing both measurements over a classical channel does the correlation become apparent.

## Entanglement and Decoherence

Entanglement is fragile. Interaction with the environment (thermal photons, vibrations, stray fields) entangles the quantum system with uncontrolled degrees of freedom, effectively destroying the coherent superposition — a process called decoherence. This is the central engineering challenge in quantum computing.

## Applications

- **Quantum key distribution (QKD)**: The BB84 and E91 protocols use entanglement properties to distribute cryptographic keys whose security is guaranteed by quantum mechanics.
- **Quantum teleportation**: Entanglement can be used to transmit an unknown quantum state from sender to receiver using only classical communication and a pre-shared Bell pair.
- **Quantum error correction**: Multi-qubit entangled states form the basis of stabilizer codes that detect and correct errors without measuring (and thereby collapsing) the encoded logical qubit.

## EPR Paradox

Einstein, Podolsky, and Rosen argued in 1935 that entanglement implied quantum mechanics was incomplete. Subsequent theoretical and experimental work — notably Bell's inequalities — demonstrated that the correlations cannot be explained by any locally realistic hidden variable theory.
