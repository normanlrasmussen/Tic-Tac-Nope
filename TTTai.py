import os
import pandas as pd

class TTTai:
    def __init__(self, ai_type):
        self.type = ai_type
    
    def calculate_all_senarios(self):
        combinations = [[x, y] for x in range(3) for y in range(3)]
        outputs = []
        
        print("Calculating all senarios of Tic-Tac-Toe")
        for i in range(len(combinations)):
            game = [[" " for _ in range(3)] for _ in range(3)]
            x, y = combinations[i]
            game[y][x] = "X"
            
            remaining_moves = combinations[:i] + combinations[i + 1:]
            outputs += self.calculate_recursion_helper([[x, y]], remaining_moves, game, ["O", "X"])

        print(f"Finshed Calculating all {len(outputs)} senarios :)")
        self.combinations = outputs
        self.generate_file()
        print("Finished saving File for quick recall ;)")

    def calculate_recursion_helper(self, moves:list, combinations:list, game:list, marker:list) -> list:        
        outputs = []

        terminal, winner = self.check_win(game)
        if terminal and winner == "X":
            return [[moves, 1]]  # X wins.
        elif terminal and winner == "O":
            return [[moves, -1]]  # O wins.
        elif not combinations:
            return [[moves, 0]] #Stalemate

        for i in range(len(combinations)):
            x, y = combinations[i]
            game[y][x] = marker[0]
            
            next_combinations = combinations[:i] + combinations[i + 1:]
            new_moves = moves + [[x, y]]

            results = self.calculate_recursion_helper(new_moves, next_combinations, game, marker[::-1])
            outputs.extend(results)

            game[y][x] = " "

        return outputs

    def check_win(self, game) -> tuple:
        # Check rows
        for row in game:
            if row[0] == row[1] == row[2] and row[0] != " ":
                return True, row[0]

        # Check columns
        for i in range(3):
            if game[0][i] == game[1][i] == game[2][i] and game[0][i] != " ":
                return True, game[0][i]

        # Check diagonals
        if game[0][0] == game[1][1] == game[2][2] and game[0][0] != " ":
            return True, game[0][0]
        if game[0][2] == game[1][1] == game[2][0] and game[0][2] != " ":
            return True, game[0][2]

        return False, None
    
    def generate_file(self, filename="tictactoe_outputs") -> None:
        outputs = []

        for moves, result in self.combinations:
            row = [f"({x},{y})" for x, y in moves]
            while len(row) < 9:
                row.append(None)
            row.append(result)
            outputs.append(row)
            
        columns = [f"Move {i+1}" for i in range(9)] + ["Result"]
        df = pd.DataFrame(outputs, columns=columns)
        df.to_csv(filename, index=False) 
        self.df = df
        return
    
    def load_file(self, filename="tictactoe_outputs") -> None:
        self.df = pd.read_csv(filename)
        return
    
    def ai_move(self, completed_moves:list, board=None):
        if self.type == 1:
            return self.average_win(completed_moves)
        elif self.type == 2:
            return self.minimax_move(board)
        elif self.type == 3:
            return self.cases_move(board)

    def average_win(self, completed_moves:list) -> tuple:
        #NOTE this is not a full proof model
        #Will automatically go to 1,1 if not told
        if len(completed_moves) == 0:
            return 0,0

        df = self.df.copy()

        #Filiters the data set according to the list of completed moves
        for i in range(len(completed_moves)):
            x, y = completed_moves[i]
            df = df[df[df.columns[i]] == f"({x},{y})"]

        best_avg = -10
        best_move = None
        move_col = df.columns[len(completed_moves)]
        #Calculates the average of all the possible outcomes for each move
        for move in df[move_col].dropna().unique().tolist():
            move_df = df[df[move_col] == move]
            
            if len(completed_moves) % 2 == 0:
                avg_result = move_df["Result"].mean()
            else:
                avg_result = -move_df["Result"].mean()

            if avg_result > best_avg:
                best_move = move
                best_avg = avg_result

        x, y = int(best_move[1]), int(best_move[3])
        return x, y
    
    def minimax(self, game:list, is_maximizing:bool) -> int:
        #returns if there is a winner
        terminal, winner = self.check_win(game)
        if terminal:
            return 1 if winner == "X" else -1
        
        #returns if there is a stalemate
        if all(cell != " " for row in game for cell in row):
            return 0
        
        #If this is maximizing, it wants to find the move with the highest possible score
        if is_maximizing:
            best_score = -10
            for i in range(3):
                for j in range(3):
                    if game[i][j] == " ":
                        game[i][j] = "X"
                        score = self.minimax(game, False)
                        best_score = max(best_score, score)
                        game[i][j] = " "
            return best_score
        #if this is minizmizing, it wants to find the move with the lowest score
        else:
            best_score = float("inf")
            for i in range(3):
                for j in range(3):
                    if game[i][j] == " ":
                        game[i][j] = "O"
                        score = self.minimax(game, True)
                        best_score = min(best_score, score)
                        game[i][j] = " " 
            return best_score
        
    def minimax_move(self, game:list) -> tuple:
        #This assumes that both "X" and "O" plays optimally and finds the highest or lowest score given that

        count_X = sum(cell == "X" for row in game for cell in row)
        count_O = sum(cell == "O" for row in game for cell in row)
        current_marker = "X" if count_X == count_O else "O"

        best_move = None
        if current_marker == "X":
            best_score = -10
            for i in range(3): 
                for j in range(3):  
                    if game[i][j] == " ":
                        game[i][j] = current_marker
                        score = self.minimax(game,False)
                        game[i][j] = " "  
                        if score > best_score:
                            best_score = score
                            best_move = (j, i)
        else:
            best_score = 10
            for i in range(3):
                for j in range(3):
                    if game[i][j] == " ":
                        game[i][j] = current_marker
                        score = self.minimax(game,True)
                        game[i][j] = " " 
                        if score < best_score:
                            best_score = score
                            best_move = (j, i) 
        
        return best_move
    
    def cases_move(self, game:str) -> tuple:
        
        game = game.copy()
        count_X = sum(cell == "X" for row in game for cell in row)
        count_O = sum(cell == "O" for row in game for cell in row)
        current_marker = "X" if count_X == count_O else "O"
        opponent_marker = "O" if count_X == count_O else "X"

        #Step 1: Win
        for x in range(3):
            for y in range(3):
                if game[y][x] == " ":
                    
                    game[y][x] = current_marker
                    terminal, _ = self.check_win(game)
                    if terminal == True:
                        return x, y
                    
                    game[y][x] == " " #Back Track

        #Step 2: Block
        for x in range(3):
            for y in range(3):
                if game[y][x] == " ":
                    
                    game[y][x] = opponent_marker
                    terminal, _ = self.check_win(game)
                    if terminal == True:
                        return x, y
                    
                    game[y][x] == " " #Back Track

        #Step 3: Play Corner with only piece in it
        if game[0][0]:
            pass

        #Step 4: Play 2 in a line
        for y in range(3):
            if sum(cell == current_marker for cell in game[y]) == 1 and sum(cell == " " for cell in game[y]) == 1:
                pass

        #Step 5: If first move play corner
        if count_X == 0:
            return 0, 0

        #Step 6: If second move play center
        if count_O == 0:
            return 0, 0

        #Step 7: Play any space
        for x in range(3):
            for y in range(3):
                if game[y][x] == " ":
                    return x, y

    
    #TODO try hardcoding a TTT ai, shouldn't be that hard, 
    # 3 intial cases, and the rest is winning, blocking, 
    # then placing where is just 1 of yours, 
    # or just playing in a random place