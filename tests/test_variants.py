import unittest
from unittest.mock import patch

import precompute_all as batch
import sequence_form_lp as lp
from variant_rules import RING_PAIRS, RING_TRIPLES, variant_spec


class VariantRuleTests(unittest.TestCase):
    def rules(self, variant, hidden=(0, 1)):
        return lp.Rules(sum(1 << move for move in hidden), lp.O, variant)

    def test_no_hidden_opening(self):
        rules = self.rules("no-hidden-opening", (1, 3))
        self.assertNotIn(1, lp.legal_actions(lp.make_root(rules), rules))
        self.assertIn(0, lp.legal_actions(lp.make_root(rules), rules))

    def test_center_is_not_playable(self):
        for variant in ("no-center-ring", "no-center-ring-pair-loss"):
            rules = self.rules(variant)
            self.assertNotIn(4, lp.legal_actions(lp.make_root(rules), rules))
            with self.assertRaises(ValueError):
                lp.Rules(1 << 4 | 1 << 0, lp.O, variant)

    def test_ring_triple_wraps(self):
        rules = self.rules("no-center-ring")
        state = lp.State(o_mask=(1 << 3) | (1 << 0) | (1 << 1))
        self.assertEqual(lp.terminal_winner(state, rules), lp.O)
        self.assertIn((1 << 3) | (1 << 0) | (1 << 1), RING_TRIPLES)

    def test_pair_loss_reverses_winner(self):
        rules = self.rules("no-center-ring-pair-loss")
        state = lp.State(o_mask=(1 << 3) | (1 << 0))
        self.assertEqual(lp.terminal_winner(state, rules), lp.X)
        self.assertIn((1 << 3) | (1 << 0), RING_PAIRS)

    def test_d4_symmetry_preserves_grid_variant_rules(self):
        for variant in ("standard", "no-hidden-opening"):
            spec = variant_spec(variant)
            winning = set(spec.winning_patterns)
            losing = set(spec.losing_patterns)
            for transform in batch.TRANSFORMS.values():
                self.assertEqual(batch.transform_mask(spec.playable_mask, transform), spec.playable_mask)
                self.assertEqual({batch.transform_mask(pattern, transform) for pattern in winning}, winning)
                self.assertEqual({batch.transform_mask(pattern, transform) for pattern in losing}, losing)

    def test_d8_symmetry_preserves_ring_variant_rules(self):
        for variant in ("no-center-ring", "no-center-ring-pair-loss"):
            spec = variant_spec(variant)
            winning = set(spec.winning_patterns)
            losing = set(spec.losing_patterns)
            for transform in batch.RING_TRANSFORMS.values():
                self.assertEqual(batch.transform_mask(spec.playable_mask, transform), spec.playable_mask)
                self.assertEqual({batch.transform_mask(pattern, transform) for pattern in winning}, winning)
                self.assertEqual({batch.transform_mask(pattern, transform) for pattern in losing}, losing)

    def test_ring_symmetry_collapses_to_28_canonical_hidden_masks(self):
        for variant in ("no-center-ring", "no-center-ring-pair-loss"):
            spec = variant_spec(variant)
            canonical_masks = {
                batch.canonicalize(mask, batch.RING_TRANSFORMS)[0]
                for mask in batch.raw_masks("all", spec.playable_mask, spec.allow_hidden_opening)
            }
            self.assertEqual(len(canonical_masks), 28)

    def test_python_native_counts_match_on_small_games_for_all_variants(self):
        root = lp.State(
            o_mask=(1 << 0) | (1 << 5),
            x_mask=(1 << 2) | (1 << 6),
            turn=lp.O,
            obs_o="V20;V12;V25;V16;",
            obs_x="V20;V12;V25;V16;",
            move_no=4,
        )
        for variant in ("standard", "no-hidden-opening", "no-center-ring", "no-center-ring-pair-loss"):
            rules = self.rules(variant, (1, 3))
            self.assertIsNone(lp.terminal_winner(root, rules))
            with patch.object(lp, "make_root", return_value=root):
                reference = lp.build_sequence_game(rules, backend="python")
            with patch.object(lp, "make_root", return_value=root):
                native = lp.build_sequence_game(rules, backend="native")
            self.assertEqual((reference.histories, reference.terminals), (native.histories, native.terminals), variant)
            self.assertEqual(reference.o.n_sequences, native.o.n_sequences, variant)
            self.assertEqual(reference.x.n_sequences, native.x.n_sequences, variant)
            self.assertEqual((reference.payoff - native.payoff).nnz, 0, variant)


if __name__ == "__main__":
    unittest.main()
