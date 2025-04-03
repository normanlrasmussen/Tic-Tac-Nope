#This will be the base class for playing Tic-Tac-Toe

class TTT:
    def __init__(self):
        self.board = [[" ", " ", " "] for _ in range(3)]

    def __str__(self):
        board_str = "\n".join([" | ".join(row) for row in self.board])
        return board_str.replace("\n", "\n" + "-" * 9 + "\n") 
    
    #NOTE When you want to add bot, create the branch here
    def begin_game(self):
        #Give cordinate instructions
        instructions = [[str((x, y)) for x in range(3)] for y in range(3)]
        instructions = "\n".join([" | ".join(row) for row in instructions])
        print("These are the cordinates for the game: \n")
        print(instructions.replace("\n", "\n" + "-" * 24 + "\n") )
        
        #Begin the Game
        print("\n So let the game begin! \n")
        self.board = [[" ", " ", " "] for _ in range(3)]
        self.print_board()

        #Begin the game with the person
        self.human_game()

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



    def human_move(self, marker:str) -> None:
        """
        Asks for an input and makes a move
        """
        while True:
            x = int(input("Choose a Column (0-2): "))
            y = int(input("Choose a Row (0-2): "))
            
            if not (0 <= x < 3 and 0 <= y < 3):  
                print("Invalid input. Row and Column must be between 0 and 2.")
                continue  

            if not self.can_move(x, y):  
                print("That spot is already taken. Try again.")
                continue  

            self.board[y][x] = marker
            break

        return
            
    def print_board(self) -> None:
        """
        Prints the board on the IDE
        """
        board_str = "\n".join([" | ".join(row) for row in self.board])
        print(board_str.replace("\n", "\n" + "-" * 9 + "\n"))
        print("\n")
        return

    def can_move(self, x:int, y:int) -> bool:
        """
        returns True if a tile is empty, false if it is already filled
        """
        return self.board[y][x] == " "

    def check_win(self) -> bool:
        """
        Returns True if there is 3 in a row, or False if there is no 3 in a row
        """
        
        #Check rows
        for row in self.board:
            if row[0] == row[1] == row[2] and row[0] != " ":
                return True

        #Check columns
        for i in range(3):
            if self.board[0][i] == self.board[1][i] == self.board[2][i] and self.board[1][i] != " ":
                return True
        
        #Check Diagonals
        if self.board[0][0] == self.board[1][1] == self.board[2][2] and self.board[1][1] != " ":
            return True 
        if self.board[2][0] == self.board[1][1] == self.board[0][2] and self.board[1][1] != " ":
            return True 
        
        #If no conditions are met return false
        return False
    
    def check_stalemate(self) -> bool:
        """
        Returns True if there is a stalemate, False if not
        """
        #Gets a tuple of all the pieces
        all_types = tuple(sum(self.board, []))
        if self.check_win() == False and " " not in all_types:
            return True
        else:
            return False