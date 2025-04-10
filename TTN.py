#This is where I want to start building the tic-tac-nope class

from copy import deepcopy
class TTN:
    def __init__(self, empty_token_list = None):
        self.board = [[" ", " ", " "] for _ in range(3)]
        self.empty_token = "■"
        if empty_token_list:
            self.define_empty_tokens(empty_token_list)
            

    def define_empty_tokens(self, empty_token_list:list) -> None:
        for x, y in empty_token_list:
            self.board[y][x] = "N"
        
    def __str__(self):
        hidden_board = deepcopy(self.board)
        for x in range(3):
            for y in range(3):
                if hidden_board[y][x][0] == "N":
                    hidden_board[y][x] = self.empty_token
        board_str = "\n".join([" | ".join(row) for row in hidden_board])
        return board_str.replace("\n", "\n" + "-" * 9 + "\n") 
    
    def print_board(self) -> None:
        hidden_board = deepcopy(self.board)
        for x in range(3):
            for y in range(3):
                if hidden_board[y][x][0] == "N":
                    hidden_board[y][x] = self.empty_token
        board_str = "\n".join([" | ".join(row) for row in hidden_board])
        print(board_str.replace("\n", "\n" + "-" * 9 + "\n"))
        print("\n")
        return    
    
    def can_move(self, x:int, y:int, marker:str) -> bool:
        if self.board[y][x] == " ":
            return True
        elif "N" in self.board[y][x]:
            if marker == "X" and "X" not in self.board[y][x]:
                return True
            elif marker == "O" and "O" not in self.board[y][x]:
                return True
        else:
            return False
        
    def make_move(self, x:int, y:int, marker:str) -> bool:
        if self.board[y][x] == " ":
            self.board[y][x] = marker
            return True
        elif "N" in self.board[y][x]:
            if marker  not in self.board[y][x]:
                self.board[y][x] += marker
                return True
        else:
            return False
        
    def check_stalemate(self) -> bool:
        if all(cell != " " for row in self.board for cell in row):
            return True
        else: 
            return False
    
    def check_win(self) -> tuple:
        #filter the board
        filtered_board = deepcopy(self.board)
        for x in range(3):
            for y in range(3):
                if "N" in filtered_board[y][x] and len(filtered_board[y][x]) != 1:
                    filtered_board[y][x] = filtered_board[y][x][1]
        
        #Check rows
        for row in filtered_board:
            if row[0] == row[1] == row[2] and row[0] != " ":
                return True, row[1]

        #Check columns
        for i in range(3):
            if filtered_board[0][i] == filtered_board[1][i] == filtered_board[2][i] and filtered_board[1][i] != " ":
                return True, filtered_board[1][i]
        
        #Check Diagonals
        if filtered_board[0][0] == filtered_board[1][1] == filtered_board[2][2] and filtered_board[1][1] != " ":
            return True, filtered_board[1][1] 
        if filtered_board[2][0] == filtered_board[1][1] == filtered_board[0][2] and filtered_board[1][1] != " ":
            return True, filtered_board[1][1]
        
        #If no conditions are met return false
        return False, None
    
    def begin_game(self, humans=False):
        #Give cordinate instructions
        instructions = [[str((x, y)) for x in range(3)] for y in range(3)]
        instructions = "\n".join([" | ".join(row) for row in instructions])
        print("These are the cordinates for the game: \n")
        print(instructions.replace("\n", "\n" + "-" * 24 + "\n") )
        
        #Begin the Game
        print("\n So let the game begin! \n")
        self.print_board()

        #Begin the game with the person
        if humans:
            self.human_game()
        else: 
            self.ai_game()
    
    def human_game(self) -> None:
        """
        This function will run a game between 2 people
        """
        while True:
            print("Player 'X' will go...")
            self.human_move('X')
            self.print_board()
            
            if self.check_stalemate() == True:
                print("Stalemate, No one wins :(")
                return
            if self.check_win() == True:
                print("Player 'X' wins :)")
                return
            
            print("Player 'O' will go...")
            self.human_move('O')
            self.print_board()
            
            if self.check_stalemate() == True:
                print("Stalemate, No one wins :(")
                return
            if self.check_win() == True:
                print("Player 'O' wins :)")
                return

    def human_move(self, marker:str, return_move = False):
        """
        Asks for an input and makes a move
        """
        while True:
            possible_inputs = ("0", "1", "2")
            x = input("Choose a Column (0-2): ")
            y = input("Choose a Row (0-2): ")
            if x in possible_inputs and y in possible_inputs:
                x = int(x)
                y = int(y)
            else:
                print("Invalid input. Row and Column must be between 0 and 2.")
                continue  
            
            if not (0 <= x < 3 and 0 <= y < 3):  
                print("Invalid input. Row and Column must be between 0 and 2.")
                continue  

            if not self.can_move(x, y, marker):  
                print("That spot is already taken. Try again.")
                continue  

            self.make_move(x, y, marker)
            break
        
        if return_move == True:
            return x,y
        else:
            return  


#----------------Past this line is code I havn't look at yest----------------
    
    
    

    
        
    def ai_game(self) -> None:
        ai = None
        moves_so_far = []
        incoming = None
        while incoming not in ("y", "n"):
            incoming = input("Will the player go first: (y/n)? \n")
        
        if incoming == "y":
            player_marker = "X"
            ai_marker = "O"
            print("Player 'X' will go...")
            x,y = self.human_move(player_marker, return_move = True)
            moves_so_far.append([x,y])
            self.print_board()
        else:
            player_marker = "O"
            ai_marker = "X"

        while True:
            x, y = ai.ai_move(moves_so_far, self.board)
            print(f"AI will go ({x},{y})...")
            self.board[y][x] = ai_marker
            moves_so_far.append([x,y])
            self.print_board()
            
            if self.check_stalemate() == True:
                print("Stalemate, No one wins :(")
                return
            if self.check_win() == True:
                print("AI wins :)")
                return
            
            print("Player will go...")
            x,y = self.human_move(player_marker, return_move = True)
            moves_so_far.append([x,y])
            self.print_board()
            
            if self.check_stalemate() == True:
                print("Stalemate, No one wins :(")
                return
            if self.check_win() == True:
                print("Player wins :)")
                return




    
            
    

    
    
    