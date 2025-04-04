#This is an ai to always win/tie at regular tic tac toe
#I'm gonna code it directly

class TTTai:
    def __init__(self):
        self.turn = 0
        self.first_move = None

    def make_move(self, board: list, marker: str, opp_marker: str) -> tuple[int, int]:
        # all_types = tuple(sum(board, []))
        
        if self.turn == 0:
            return self.first_move(board, marker, opp_marker)
        
        if self.turn == 1:
            if self.first_move:
                pass
        

    def first_move(self, board: list, marker: str, opp_marker: str) -> tuple[int, int]:
        #Checks to see if the board is empty
        if set(sum(board, [])) == {" "}:
            self.turn = 1
            self.first_move == True
            return (0, 0)
        #This is if the oponenet has made the last move
        elif board.count(marker) == 0 and board.count(opp_marker) == 1:
            self.turn = 1
            self.first_move = False

            #If the center is open, play the center, else play the top left
            if board[1][1] == " ":
                return (1, 1)
            else:
                return (0,0)
        else:
            raise ValueError("Unexpected Error")