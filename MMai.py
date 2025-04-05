#This will be a mi max AI to simulate all the possible situations of Tic-Tac-Toe

import os
import pandas as pd

class MMai:
    def __init__(self):
        filename="tictactoe_outputs"
        if os.path.isfile(filename):
            print("Existing Data Found, Loading model")
            self.load_file()
            print("Load Complete")
        else:
            self.calculate_all_senarios()
    
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
        #NOTE, recursion could be optimized by just adding everything directly to a df, instead of a list, or making it compatible for df
        outputs = []

        if_win, winner = self.check_win(game)
        if if_win == True and winner == "X":
            return [[moves, 1]] #Win
        elif if_win == True and winner == "O":
            return [[moves, -1]] #Lose
        elif not combinations:
            return [[moves, 0]] #Stalemate

        for i in range(len(combinations)):
            x, y = combinations[i]
            game[y][x] = marker[0]
            
            #Update moves
            next_combinations = combinations[:i] + combinations[i + 1:]
            new_moves = moves + [[x, y]]

            # Recursive step
            results = self.calculate_recursion_helper(new_moves, next_combinations, game, marker[::-1])
            outputs.extend(results)

            # Backtrack
            game[y][x] = " "

        return outputs

    def check_win(self, game) -> tuple[bool, str]:
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
