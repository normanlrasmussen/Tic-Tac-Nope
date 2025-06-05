from importlib import reload
import TTT
reload(TTT)

# Runs a tic tac toe game with humans
TTT.TTT().begin_game(humans=True)
