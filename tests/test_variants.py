import unittest

import sequence_form_lp as lp
from variant_rules import RING_PAIRS, RING_TRIPLES


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

    def test_python_native_counts_match_on_small_ring_games(self):
        rules = self.rules("no-center-ring-pair-loss")
        reference = lp.build_sequence_game(rules, backend="python")
        native = lp.build_sequence_game(rules, backend="native")
        self.assertEqual((reference.histories, reference.terminals), (native.histories, native.terminals))
        self.assertEqual(reference.o.n_sequences, native.o.n_sequences)
        self.assertEqual(reference.x.n_sequences, native.x.n_sequences)
        self.assertEqual((reference.payoff - native.payoff).nnz, 0)


if __name__ == "__main__":
    unittest.main()
