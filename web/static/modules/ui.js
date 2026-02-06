/**
 * =========================================================================
 * UI MODULE — Board rendering and user interface
 * =========================================================================
 */

import { $, PIECE_VALUES, PIECE_ORDER, formatTime } from './core.js';

export class UIManager {
  constructor() {
    // DOM References
    this.boardEl = $('board');
    this.gameStatus = $('game-status');
    this.movesList = $('moves-list');
    this.promotionDialog = $('promotion-dialog');
    this.promotionChoices = $('promotion-choices');
    this.gameOverModal = $('game-over');
    this.gameOverTitle = $('game-over-title');
    this.gameOverMessage = $('game-over-message');
    this.gameOverIcon = $('game-over-icon');
    
    // Player UI
    this.selfIndicator = $('self-indicator');
    this.opponentIndicator = $('opponent-indicator');
    this.selfLabel = $('self-label');
    this.opponentLabel = $('opponent-label');
    this.selfTimer = $('self-timer');
    this.opponentTimer = $('opponent-timer');
    this.selfCapturedList = $('self-captured-list');
    this.opponentCapturedList = $('opponent-captured-list');
    this.selfAdvantage = $('self-advantage');
    this.opponentAdvantage = $('opponent-advantage');
    
    // State
    this.selectedSquare = null;
    this.legalMoves = [];
    this.boardFlipped = false;
    this.myColor = null;
    this.capturedByWhite = [];
    this.capturedByBlack = [];
  }

  /**
   * Build the chess board grid
   */
  buildBoard(engine, onSquareClick) {
    this.boardEl.innerHTML = '';
    const files = 'abcdefgh';
    
    // Build file labels (a-h)
    ['labels-top', 'labels-bottom'].forEach(id => {
      const el = $(id);
      el.innerHTML = '';
      for (let i = 0; i < 8; i++) {
        const span = document.createElement('span');
        span.textContent = files[this.boardFlipped ? 7 - i : i];
        el.appendChild(span);
      }
    });
    
    // Build rank labels (1-8)
    ['labels-left', 'labels-right'].forEach(id => {
      const el = $(id);
      el.innerHTML = '';
      for (let i = 0; i < 8; i++) {
        const span = document.createElement('span');
        span.textContent = 8 - (this.boardFlipped ? 7 - i : i);
        el.appendChild(span);
      }
    });
    
    // Build squares
    for (let displayRow = 0; displayRow < 8; displayRow++) {
      for (let displayCol = 0; displayCol < 8; displayCol++) {
        const row = this.boardFlipped ? 7 - displayRow : displayRow;
        const col = this.boardFlipped ? 7 - displayCol : displayCol;
        
        const square = document.createElement('div');
        square.className = 'square ' + ((row + col) % 2 === 0 ? 'light' : 'dark');
        square.dataset.row = row;
        square.dataset.col = col;
        square.addEventListener('click', () => onSquareClick(row, col));
        
        this.boardEl.appendChild(square);
      }
    }
  }

  /**
   * Render current board state
   */
  renderBoard(engine) {
    const squares = this.boardEl.querySelectorAll('.square');
    const kingPos = engine.isInCheck(engine.turn) 
      ? engine.getKingPosition(engine.turn) 
      : null;
    const attackers = kingPos ? engine.getCheckAttackers(engine.turn) : [];
    const attackerSet = new Set(attackers.map(a => `${a.row},${a.col}`));
    
    squares.forEach(sq => {
      const row = +sq.dataset.row;
      const col = +sq.dataset.col;
      const piece = engine.getPiece(row, col);
      
      // Reset classes
      sq.className = 'square ' + ((row + col) % 2 === 0 ? 'light' : 'dark');
      sq.innerHTML = '';
      
      // Render piece
      if (piece) {
        sq.classList.add('has-piece');
        const span = document.createElement('span');
        span.className = 'piece ' + piece.color + '-piece';
        span.textContent = PIECE_SYMBOLS[piece.type][piece.color];
        sq.appendChild(span);
      }
      
      // Highlight selected square
      if (this.selectedSquare && 
          row === this.selectedSquare.row && 
          col === this.selectedSquare.col) {
        sq.classList.add('selected');
      }
      
      // Highlight last move
      if (engine.lastMove) {
        const { from, to } = engine.lastMove;
        if ((row === from.row && col === from.col) || 
            (row === to.row && col === to.col)) {
          sq.classList.add('last-move');
        }
      }
      
      // Show legal moves
      const isLegalMove = this.legalMoves.some(m => 
        m.to.row === row && m.to.col === col
      );
      
      if (isLegalMove) {
        sq.classList.add(piece ? 'legal-capture' : 'legal-move');
      }
      
      // Special case for en passant
      if (this.selectedSquare) {
        const selectedPiece = engine.getPiece(
          this.selectedSquare.row, 
          this.selectedSquare.col
        );
        
        if (selectedPiece?.type === 'P') {
          const enPassantMove = this.legalMoves.find(m => 
            m.to.row === row && 
            m.to.col === col && 
            m.isEnPassant
          );
          
          if (enPassantMove) {
            sq.classList.add('legal-capture');
            sq.classList.remove('legal-move');
          }
        }
      }
      
      // Highlight king in check
      if (kingPos && row === kingPos.row && col === kingPos.col) {
        sq.classList.add('check-square');
      }

      // Highlight attacking pieces
      if (attackerSet.has(`${row},${col}`)) {
        sq.classList.add('check-attacker');
      }
    });
  }

  /**
   * Update player labels and indicators
   */
  updatePlayerInfo(myColor, gameMode, aiDifficulty = null) {
    this.myColor = myColor;
    const opponentColor = myColor === 'white' ? 'black' : 'white';
    
    this.selfIndicator.className = `indicator ${myColor}-piece`;
    this.opponentIndicator.className = `indicator ${opponentColor}-piece`;
    
    const colorName = myColor === 'white' ? 'Blancs' : 'Noirs';
    this.selfLabel.textContent = `Vous (${colorName})`;
    
    if (gameMode === 'ai') {
      const diffNames = { 1: 'Facile', 2: 'Moyen', 3: 'Difficile', 4: 'Expert' };
      this.opponentLabel.textContent = 'IA ' + (diffNames[aiDifficulty] || '');
    } else {
      this.opponentLabel.textContent = 'Adversaire';
    }
  }

  /**
   * Update game status text
   */
  updateStatus(engine, gameMode, aiThinking = false) {
    const rows = document.querySelectorAll('.player-row');
    const [opponentRow, selfRow] = rows;
    
    if (engine.turn === this.myColor) {
      selfRow.classList.add('active-turn');
      opponentRow.classList.remove('active-turn');
      this.gameStatus.textContent = 'À vous de jouer';
      this.gameStatus.className = 'status-text';
    } else {
      selfRow.classList.remove('active-turn');
      opponentRow.classList.add('active-turn');
      
      if (gameMode === 'ai' && aiThinking) {
        this.gameStatus.textContent = "L'IA réfléchit…";
      } else {
        this.gameStatus.textContent = gameMode === 'ai' ? "Tour de l'IA" : "Tour adverse";
      }
      this.gameStatus.className = 'status-text';
    }
    
    if (engine.isInCheck(engine.turn)) {
      this.gameStatus.className = 'status-text';
    }
  }

  /**
   * Update move history display
   */
  updateMoveHistory(engine) {
    this.movesList.innerHTML = '';
    
    for (let i = 0; i < engine.moveHistory.length; i += 2) {
      const entry = document.createElement('div');
      entry.className = 'move-entry';
      
      const number = document.createElement('span');
      number.className = 'move-number';
      number.textContent = (Math.floor(i / 2) + 1) + '.';
      entry.appendChild(number);
      
      const whiteMove = document.createElement('span');
      whiteMove.textContent = engine.moveHistory[i].notation;
      entry.appendChild(whiteMove);
      
      if (i + 1 < engine.moveHistory.length) {
        const blackMove = document.createElement('span');
        blackMove.textContent = engine.moveHistory[i + 1].notation;
        entry.appendChild(blackMove);
      }
      
      this.movesList.appendChild(entry);
    }
    
    this.movesList.scrollTop = this.movesList.scrollHeight;
  }

  /**
   * Update captured pieces display
   */
  updateCapturedPieces(engine) {
    // Collect captured pieces
    this.capturedByWhite = [];
    this.capturedByBlack = [];
    
    for (const move of engine.moveHistory) {
      if (move.captured) {
        if (move.color === 'white') {
          this.capturedByWhite.push(move.captured);
        } else {
          this.capturedByBlack.push(move.captured);
        }
      }
    }
    
    // Render captured pieces
    const myCaptured = this.myColor === 'white' 
      ? this.capturedByWhite 
      : this.capturedByBlack;
    const opponentCaptured = this.myColor === 'white' 
      ? this.capturedByBlack 
      : this.capturedByWhite;
    const opponentColor = this.myColor === 'white' ? 'black' : 'white';
    
    const renderPieces = (pieces, color) => {
      return [...pieces]
        .sort((a, b) => PIECE_ORDER.indexOf(a) - PIECE_ORDER.indexOf(b))
        .map(type => `<span>${PIECE_SYMBOLS[type][color]}</span>`)
        .join('');
    };
    
    this.selfCapturedList.innerHTML = renderPieces(myCaptured, opponentColor);
    this.opponentCapturedList.innerHTML = renderPieces(opponentCaptured, this.myColor);
    
    // Calculate and display material advantage
    const myMaterial = myCaptured.reduce((sum, type) => sum + PIECE_VALUES[type], 0);
    const opponentMaterial = opponentCaptured.reduce((sum, type) => sum + PIECE_VALUES[type], 0);
    const advantage = myMaterial - opponentMaterial;
    
    this.selfAdvantage.textContent = advantage > 0 ? '+' + advantage : '';
    this.opponentAdvantage.textContent = advantage < 0 ? '+' + Math.abs(advantage) : '';
  }

  /**
   * Update timer display
   */
  updateTimerDisplay(whiteTime, blackTime, timerEnabled) {
    if (!timerEnabled) {
      this.selfTimer.classList.add('hidden');
      this.opponentTimer.classList.add('hidden');
      return;
    }
    
    this.selfTimer.classList.remove('hidden');
    this.opponentTimer.classList.remove('hidden');
    
    const myTime = this.myColor === 'white' ? whiteTime : blackTime;
    const opponentTime = this.myColor === 'white' ? blackTime : whiteTime;
    
    this.selfTimer.textContent = formatTime(myTime);
    this.opponentTimer.textContent = formatTime(opponentTime);
    
    this.selfTimer.classList.toggle('low-time', myTime < 30 && myTime > 0);
    this.opponentTimer.classList.toggle('low-time', opponentTime < 30 && opponentTime > 0);
  }

  /**
   * Show promotion dialog
   */
  showPromotionDialog(onSelect) {
    this.promotionDialog.classList.remove('hidden');
    this.promotionChoices.innerHTML = '';
    
    for (const type of ['Q', 'R', 'B', 'N']) {
      const button = document.createElement('div');
      button.className = 'promotion-choice';
      button.textContent = PIECE_SYMBOLS[type][this.myColor];
      button.addEventListener('click', () => {
        this.promotionDialog.classList.add('hidden');
        onSelect(type);
      });
      this.promotionChoices.appendChild(button);
    }
  }

  /**
   * Show game over modal
   */
  showGameOver(engine, gameMode) {
    this.gameOverModal.classList.remove('hidden');
    
    const isWinner = engine.winner === this.myColor;
    
    switch (engine.result) {
      case 'checkmate':
        this.gameOverIcon.textContent = isWinner ? '🏆' : '💀';
        this.gameOverTitle.textContent = isWinner ? 'Victoire !' : 'Défaite';
        this.gameOverMessage.textContent = isWinner
          ? (gameMode === 'ai' ? "Échec et mat contre l'IA !" : 'Échec et mat !')
          : (gameMode === 'ai' ? "L'IA vous a maté." : 'Vous êtes maté.');
        break;
        
      case 'stalemate':
        this.gameOverIcon.textContent = '🤝';
        this.gameOverTitle.textContent = 'Pat';
        this.gameOverMessage.textContent = 'Match nul.';
        break;
        
      case 'draw':
        this.gameOverIcon.textContent = '🤝';
        this.gameOverTitle.textContent = 'Nulle';
        this.gameOverMessage.textContent = 'Matériel insuffisant.';
        break;
        
      case 'resign':
        this.gameOverIcon.textContent = '🏆';
        this.gameOverTitle.textContent = 'Victoire !';
        this.gameOverMessage.textContent = "L'adversaire a abandonné.";
        break;
        
      case 'disconnect':
        this.gameOverIcon.textContent = '🔌';
        this.gameOverTitle.textContent = 'Victoire';
        this.gameOverMessage.textContent = 'Déconnexion adverse.';
        break;
        
      case 'timeout':
        this.gameOverIcon.textContent = isWinner ? '🏆' : '⏱';
        this.gameOverTitle.textContent = isWinner ? 'Victoire !' : 'Temps écoulé';
        this.gameOverMessage.textContent = isWinner 
          ? 'Temps adverse écoulé !' 
          : 'Votre temps est écoulé.';
        break;
    }
  }

  /**
   * Select a square
   */
  selectSquare(row, col, engine) {
    this.selectedSquare = { row, col };
    this.legalMoves = engine.getLegalMoves(row, col);
  }

  /**
   * Deselect current square
   */
  deselectSquare() {
    this.selectedSquare = null;
    this.legalMoves = [];
  }

  /**
   * Reset UI state
   */
  reset() {
    this.selectedSquare = null;
    this.legalMoves = [];
    this.capturedByWhite = [];
    this.capturedByBlack = [];
  }
}
