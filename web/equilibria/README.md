# Exact equilibrium artifacts

Generated sequence-form LP policies belong here.

The LP solver is a **local-only research tool**. GitHub Pages deployment and browser play must never invoke the exact solver; they may only serve and query JSON artifacts that were generated locally and intentionally committed.

An artifact is eligible to be labeled **Exact Nash (Sequence-Form LP)** only when it was produced from the complete unabstracted game, contains successful solves for both players plus a numerical value interval / duality gap, and declares the same `informationModel` as the live game engine.

The current information model is `hidden-attempt-location-no-result-v2`: a player remembers which mystery cell they personally attempted but receives no direct success/failure signal. Opponent mystery actions reveal only that a fog action occurred.

**Artifacts generated before this information model are mathematically stale and must be regenerated.** In particular, any policy whose information-set keys contain private `S...;` or `F...;` mystery-result tokens was solved for a different game and must not be reused.

Exact batch generation stores one policy per geometric D4 board-symmetry class and starting player. The website uses `symmetry-map.json` to map a selected board to its canonical representative, transform the observation/information key into canonical coordinates, query the locally generated policy, and map action probabilities back to the displayed board. Rotations/reflections are exact game isomorphisms, so this reuse does not introduce an approximation or require additional LP solves.

The live website does not silently substitute MCCFR when an LP artifact is missing or stale. Until a current-model certified artifact is bundled for a configuration, Exact Nash remains unavailable for that configuration.