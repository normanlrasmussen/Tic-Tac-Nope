# Exact equilibrium artifacts

Generated sequence-form LP policies belong here.

The LP solver is a **local-only research tool**. GitHub Pages deployment and browser play must never invoke the exact solver; they may only serve and query JSON artifacts that were generated locally and intentionally committed.

An artifact is eligible to be labeled **Exact Nash (Sequence-Form LP)** only when it was produced from the complete unabstracted game, contains successful solves for both players plus a numerical value interval / duality gap, and declares the same `informationModel` as the live game engine.

The current information model is `hidden-attempt-location-no-result-v2`: a player remembers which mystery cell they personally attempted but receives no direct success/failure signal. Opponent mystery actions reveal only that a fog action occurred.

The live website does not silently substitute MCCFR when an LP artifact is missing or stale. Until a current-model certified artifact is bundled for a configuration, Exact Nash remains unavailable for that configuration.
