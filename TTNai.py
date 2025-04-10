import os
import pandas as pd
from copy import deepcopy

class TTNai:
    def __init__(self, board:list, empty_token:str, ai_type:int=1, hidden_move:bool=False):
        self.type = ai_type
        self.empty_token = empty_token
        #TODO ADD way to account for hidden move
        self.list_of_boards = [Board(board, empty_token)]
    
    def ai_move(self, game:list, marker:str):
        if self.ai_type == 1:
            return self.minimax_move(game, marker)
        
    
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
        
    def minimax_move(self, game:list, marker:str) -> tuple:

        current_marker = marker

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

    
class Board():
    def __init__(self, board:list, empty_token:str, first_move:bool):
        board = deepcopy(board)
        for i in range(3):
            for j in range(3):
                if board[i][j] == empty_token:
                    board[i][j] = "N"
        self.board = board

    def __eq__(self, other):
        if isinstance(other, Board):
            for i in range(3):
                for j in range(3):
                    if self.board[i][j] != Board.board[i][j]:
                        return False
        return True

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
