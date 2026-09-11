"""Equivalence checks for exact enumeration and LP bounds."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
from scipy.optimize import linprog
from scipy.sparse import csr_matrix, hstack

import precompute
import sequence_form_lp as lp
from sequence_form_lp_compact import compact_behavioral_policy, write_artifact


def split_variable_solve(player, opponent, payoff):
    """Original p+ - p- formulation, retained as an independent LP reference."""
    E, e = player.realization_matrix()
    F, f = opponent.realization_matrix()
    n, m = player.n_sequences, opponent.n_constraints
    result = linprog(np.concatenate((np.zeros(n), -f, f)),
                     A_eq=hstack((E, csr_matrix((len(e), 2*m)))), b_eq=e,
                     A_ub=hstack((-payoff.T, F.T, -F.T)),
                     b_ub=np.zeros(opponent.n_sequences), bounds=(0, None),
                     method='highs', options={'presolve': True})
    assert result.success, result.message
    return -result.fun


def late_game(hidden, start):
    # No existing win; three open cells, with prior hidden attempts recorded.
    root = lp.State(o_mask=0b010001001, x_mask=0b001010010,
                    tried_o=0b010001001 & hidden, tried_x=0b001010010 & hidden,
                    turn=start)
    with patch.object(lp, 'make_root', return_value=root):
        return lp.build_sequence_game(lp.Rules(hidden, start))


def artifact_for(game):
    ro, lo, _ = lp.solve_max_player(game.o, game.x, game.payoff)
    rx, lx, _ = lp.solve_max_player(game.x, game.o, -game.payoff.T.tocsr())
    po, px = compact_behavioral_policy(game.o, ro), compact_behavioral_policy(game.x, rx)
    return dict(schema=2, numericallySolved=True, informationModel=lp.INFORMATION_MODEL,
                hiddenMask=game.rules.hidden_mask,
                hidden=precompute.batch.mask_cells(game.rules.hidden_mask),
                startPlayer='O' if game.rules.start_player == lp.O else 'X',
                valueO=(lo-lx)/2, lowerBoundO=lo, upperBoundO=-lx, dualityGap=max(0, -lx-lo),
                counts=dict(histories=game.histories, terminals=game.terminals,
                            informationSetsO=len(game.o.infos), informationSetsX=len(game.x.infos),
                            sequencesO=game.o.n_sequences, sequencesX=game.x.n_sequences,
                            storedInformationSetsO=len(po), storedInformationSetsX=len(px)),
                policy={'O':po, 'X':px})


class ExactOptimizationTests(unittest.TestCase):
    def test_win_table(self):
        for mask in range(512):
            self.assertEqual(lp.has_win(mask), any(mask & win == win for win in lp.WIN_MASKS))

    def test_action_masks(self):
        for hidden in range(512):
            for occupied, tried in ((0,0), (273,17), (170,34), (511,511)):
                state = lp.State(o_mask=occupied, tried_o=tried)
                expected = tuple(i for i in range(9) if
                                 (not tried & (1 << i) if hidden & (1 << i)
                                  else not occupied & (1 << i)))
                self.assertEqual(lp._nonterminal_actions(state, lp.Rules(hidden, lp.O)), expected)
        with self.assertRaises(ValueError):
            lp.apply_action(lp.State(o_mask=1), lp.Rules(3,lp.O), 9)
        self.assertEqual(lp.legal_actions(lp.State(o_mask=7), lp.Rules(3,lp.O)), ())

    def test_complete_subtrees_match_checked_transitions(self):
        for hidden in (3, 10, 85, 511):
            for start in (lp.O, lp.X):
                game = late_game(hidden, start)
                # Reference traversal uses the validating public transition API.
                checked = lp.apply_action
                unchecked = lp._apply_legal_action
                def transition(state, rules, move):
                    with patch.object(lp, '_apply_legal_action', unchecked):
                        return checked(state, rules, move)
                with patch.object(lp, '_apply_legal_action', transition):
                    reference = late_game(hidden, start)
                self.assertEqual((game.histories, game.terminals), (reference.histories, reference.terminals))
                self.assertEqual(game.o.infos, reference.o.infos)
                self.assertEqual(game.x.infos, reference.x.infos)
                self.assertEqual((game.payoff != reference.payoff).nnz, 0)
                for player, opponent, payoff in ((game.o,game.x,game.payoff),
                                                (game.x,game.o,-game.payoff.T.tocsr())):
                    realization, value, result = lp.solve_max_player(player, opponent, payoff)
                    self.assertTrue(result.success)
                    self.assertAlmostEqual(value, split_variable_solve(player, opponent, payoff), places=7)
                    E,e = player.realization_matrix()
                    np.testing.assert_allclose(E @ realization, e, atol=1e-7)
                    self.assertGreaterEqual(realization.min(), -1e-7)
                    # Independent best response verifies the returned strategy itself.
                    F,f = opponent.realization_matrix()
                    response = linprog(np.asarray(payoff.T @ realization).ravel(),
                                       A_eq=F, b_eq=f, bounds=(0,None), method='highs')
                    self.assertTrue(response.success)
                    self.assertAlmostEqual(response.fun, value, places=7)

    def test_node_guard(self):
        with self.assertRaisesRegex(RuntimeError, 'Node limit 10 exceeded'):
            lp.build_sequence_game(lp.Rules(511,lp.O), node_limit=10)

    def test_atomic_write_and_independent_batch_solve(self):
        artifact = artifact_for(late_game(3,lp.O))
        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            source = directory/'mask-3-O.json'
            write_artifact(source, artifact)
            with self.assertRaises(ValueError):
                write_artifact(source, {'bad':float('nan')})
            self.assertEqual(json.loads(source.read_text()), artifact)
            self.assertEqual(list(directory.glob('*.tmp')), [])
            with patch.object(precompute.batch,'EXACT_DIR',directory), patch.object(precompute.batch,'run_command') as run:
                target = precompute.solve_exact_compact(3,'X',0,False)
                self.assertEqual(target, directory/'mask-3-X.json')
                run.assert_called_once()
                command = run.call_args.args[0]
                self.assertEqual(command[command.index('--start') + 1], 'X')

    def test_manifest_cache_invalidation(self):
        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            path = directory/'mask-3-O.json'
            artifact = artifact_for(late_game(3,lp.O))
            write_artifact(path, artifact)
            with patch.object(precompute.batch,'WEB_EQ',directory):
                first = precompute.batch.artifact_metadata(path)
                with patch.object(Path,'read_text',side_effect=AssertionError('unnecessary reread')):
                    self.assertEqual(precompute.batch.artifact_metadata(path), first)
                artifact['valueO'] = 0.125
                write_artifact(path, artifact)
                self.assertEqual(precompute.batch.artifact_metadata(path)['valueO'],0.125)

    def test_node_limit_is_forwarded_to_independent_solve(self):
        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            source = directory/'mask-3-O.json'
            write_artifact(source,artifact_for(late_game(3,lp.O)))
            with patch.object(precompute.batch,'EXACT_DIR',directory), patch.object(precompute.batch,'run_command') as run:
                precompute.solve_exact_compact(3,'X',1,False)
                run.assert_called_once()
                self.assertEqual(run.call_args.args[0][-2:], ['--node-limit','1'])


if __name__ == '__main__':
    unittest.main()
