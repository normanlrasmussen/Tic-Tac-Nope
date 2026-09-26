"""Canonical rule specifications for all Tic-Tac-Nope variants."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Tuple

FULL_BOARD_MASK = (1 << 9) - 1
CENTER_MASK = 1 << 4
RING = (3, 0, 1, 2, 5, 8, 7, 6)  # display cells 4,1,2,3,6,9,8,7
STANDARD_LINES = (0x007, 0x038, 0x1C0, 0x049, 0x092, 0x124, 0x111, 0x054)


def _pattern(cells) -> int:
    result = 0
    for cell in cells:
        result |= 1 << cell
    return result


RING_TRIPLES = tuple(_pattern(RING[(i + j) % len(RING)] for j in range(3)) for i in range(8))
RING_PAIRS = tuple(_pattern((RING[i], RING[(i + 1) % len(RING)])) for i in range(8))


@dataclass(frozen=True)
class VariantSpec:
    variant_id: str
    display_name: str
    playable_mask: int
    allow_hidden_opening: bool
    topology: str
    terminal_objective: str
    winning_patterns: Tuple[int, ...] = ()
    losing_patterns: Tuple[int, ...] = ()
    rules_version: int = 1


VARIANTS = {
    "standard": VariantSpec(
        "standard", "Hidden Tiles", FULL_BOARD_MASK, True, "grid",
        "three-in-row", STANDARD_LINES,
    ),
    "no-hidden-opening": VariantSpec(
        "no-hidden-opening", "No Hidden Opening Move", FULL_BOARD_MASK, False, "grid",
        "three-in-row", STANDARD_LINES,
    ),
    "no-center-ring": VariantSpec(
        "no-center-ring", "No Center", FULL_BOARD_MASK ^ CENTER_MASK, True, "ring",
        "three-in-ring", RING_TRIPLES,
    ),
    "no-center-ring-pair-loss": VariantSpec(
        "no-center-ring-pair-loss", "No Center · Pairs Lose", FULL_BOARD_MASK ^ CENTER_MASK, True, "ring",
        "adjacent-pair-loss", (), RING_PAIRS,
    ),
}


def variant_spec(variant_id: str) -> VariantSpec:
    try:
        return VARIANTS[variant_id]
    except KeyError as error:
        raise ValueError(f"Unknown Tic-Tac-Nope variant: {variant_id}") from error


def valid_hidden_mask(hidden_mask: int, spec: VariantSpec) -> bool:
    return (
        hidden_mask.bit_count() >= 2
        and hidden_mask & ~spec.playable_mask == 0
        and (spec.allow_hidden_opening or hidden_mask != spec.playable_mask)
    )
