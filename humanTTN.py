from importlib import reload
import TTN
reload(TTN)

# Begging a Tic-Tac-Nope Game with humans
game = TTN.TTN()
game.define_empty_tokens([(0,0),(1,1),(2,0)])
game.begin_game(humans=True)
