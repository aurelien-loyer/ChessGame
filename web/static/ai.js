/**
 * ai.js - IA d'échecs avec Minimax + Alpha-Beta Pruning
 * Port du moteur C++ (AIPlayer) vers JavaScript.
 * Utilise le ChessEngine de chess.js pour la génération de coups et le plateau.
 */

const AI_DIFFICULTY = {
    EASY: 1,
    MEDIUM: 2,
    HARD: 3,
    EXPERT: 4
};

// ---- Tables de bonus de position (du point de vue des blancs, row 0 = rang 8) ----

const PAWN_TABLE = [
    [  0,  0,  0,  0,  0,  0,  0,  0 ],
    [ 50, 50, 50, 50, 50, 50, 50, 50 ],
    [ 10, 10, 20, 30, 30, 20, 10, 10 ],
    [  5,  5, 10, 25, 25, 10,  5,  5 ],
    [  0,  0,  0, 20, 20,  0,  0,  0 ],
    [  5, -5,-10,  0,  0,-10, -5,  5 ],
    [  5, 10, 10,-20,-20, 10, 10,  5 ],
    [  0,  0,  0,  0,  0,  0,  0,  0 ]
];

const KNIGHT_TABLE = [
    [-50,-40,-30,-30,-30,-30,-40,-50 ],
    [-40,-20,  0,  0,  0,  0,-20,-40 ],
    [-30,  0, 10, 15, 15, 10,  0,-30 ],
    [-30,  5, 15, 20, 20, 15,  5,-30 ],
    [-30,  0, 15, 20, 20, 15,  0,-30 ],
    [-30,  5, 10, 15, 15, 10,  5,-30 ],
    [-40,-20,  0,  5,  5,  0,-20,-40 ],
    [-50,-40,-30,-30,-30,-30,-40,-50 ]
];

const BISHOP_TABLE = [
    [-20,-10,-10,-10,-10,-10,-10,-20 ],
    [-10,  0,  0,  0,  0,  0,  0,-10 ],
    [-10,  0,  5, 10, 10,  5,  0,-10 ],
    [-10,  5,  5, 10, 10,  5,  5,-10 ],
    [-10,  0, 10, 10, 10, 10,  0,-10 ],
    [-10, 10, 10, 10, 10, 10, 10,-10 ],
    [-10,  5,  0,  0,  0,  0,  5,-10 ],
    [-20,-10,-10,-10,-10,-10,-10,-20 ]
];

const ROOK_TABLE = [
    [  0,  0,  0,  0,  0,  0,  0,  0 ],
    [  5, 10, 10, 10, 10, 10, 10,  5 ],
    [ -5,  0,  0,  0,  0,  0,  0, -5 ],
    [ -5,  0,  0,  0,  0,  0,  0, -5 ],
    [ -5,  0,  0,  0,  0,  0,  0, -5 ],
    [ -5,  0,  0,  0,  0,  0,  0, -5 ],
    [ -5,  0,  0,  0,  0,  0,  0, -5 ],
    [  0,  0,  0,  5,  5,  0,  0,  0 ]
];

const QUEEN_TABLE = [
    [-20,-10,-10, -5, -5,-10,-10,-20 ],
    [-10,  0,  0,  0,  0,  0,  0,-10 ],
    [-10,  0,  5,  5,  5,  5,  0,-10 ],
    [ -5,  0,  5,  5,  5,  5,  0, -5 ],
    [  0,  0,  5,  5,  5,  5,  0, -5 ],
    [-10,  5,  5,  5,  5,  5,  0,-10 ],
    [-10,  0,  5,  0,  0,  0,  0,-10 ],
    [-20,-10,-10, -5, -5,-10,-10,-20 ]
];

const KING_TABLE = [
    [-30,-40,-40,-50,-50,-40,-40,-30 ],
    [-30,-40,-40,-50,-50,-40,-40,-30 ],
    [-30,-40,-40,-50,-50,-40,-40,-30 ],
    [-30,-40,-40,-50,-50,-40,-40,-30 ],
    [-20,-30,-30,-40,-40,-30,-30,-20 ],
    [-10,-20,-20,-20,-20,-20,-20,-10 ],
    [ 20, 20,  0,  0,  0,  0, 20, 20 ],
    [ 20, 30, 10,  0,  0, 10, 30, 20 ]
];

const PST = {
    'P': PAWN_TABLE,
    'N': KNIGHT_TABLE,
    'B': BISHOP_TABLE,
    'R': ROOK_TABLE,
    'Q': QUEEN_TABLE,
    'K': KING_TABLE
};

const PIECE_VALUES = {
    'P': 100,
    'N': 320,
    'B': 330,
    'R': 500,
    'Q': 900,
    'K': 20000
};

class ChessAI {
    constructor(difficulty = AI_DIFFICULTY.MEDIUM) {
        this.difficulty = difficulty;
    }

    setDifficulty(level) {
        this.difficulty = level;
    }

    /**
     * Retourne le bonus positionnel d'une pièce.
     */
    getPositionBonus(row, col, type, color) {
        const table = PST[type];
        if (!table) return 0;
        // Les tables sont du point de vue des blancs
        const r = (color === 'white') ? row : (7 - row);
        return table[r][col];
    }

    /**
     * Évaluation statique du plateau du point de vue de aiColor.
     */
    evaluateBoard(board, aiColor) {
        let score = 0;
        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                const piece = board[row][col];
                if (!piece) continue;

                const value = PIECE_VALUES[piece.type] || 0;
                const bonus = this.getPositionBonus(row, col, piece.type, piece.color);

                if (piece.color === aiColor) {
                    score += value + bonus;
                } else {
                    score -= value + bonus;
                }
            }
        }
        return score;
    }

    /**
     * Profondeur de recherche selon la difficulté.
     */
    getMaxDepth() {
        return this.difficulty; // Easy=1, Medium=2, Hard=3, Expert=4
    }

    /**
     * Clone l'état complet d'un engine pour la simulation.
     */
    cloneEngine(engine) {
        const clone = new ChessEngine();
        clone.board = engine.board.map(row => row.map(cell => cell ? { ...cell } : null));
        clone.turn = engine.turn;
        clone.castlingRights = {
            white: { ...engine.castlingRights.white },
            black: { ...engine.castlingRights.black }
        };
        clone.enPassantTarget = engine.enPassantTarget ? { ...engine.enPassantTarget } : null;
        clone.halfMoveClock = engine.halfMoveClock;
        clone.fullMoveNumber = engine.fullMoveNumber;
        clone.moveHistory = []; // Pas besoin pour le minimax
        clone.lastMove = engine.lastMove ? { ...engine.lastMove } : null;
        clone.gameOver = engine.gameOver;
        clone.result = engine.result;
        clone.winner = engine.winner;
        return clone;
    }

    /**
     * Minimax avec alpha-beta pruning.
     * Travaille sur des copies du engine (aucune mutation de l'original).
     */
    minimax(engine, depth, alpha, beta, maximizing, aiColor) {
        const allMoves = engine.getAllLegalMoves();

        // Pas de coups légaux
        if (allMoves.length === 0) {
            if (engine.isInCheck(engine.turn)) {
                // Mat — pénaliser/récompenser selon qui est maté
                const maxDepth = this.getMaxDepth();
                return maximizing
                    ? (-100000 + (maxDepth - depth))
                    : (100000 - (maxDepth - depth));
            }
            return 0; // Pat
        }

        // Profondeur 0 : évaluation statique
        if (depth === 0) {
            return this.evaluateBoard(engine.board, aiColor);
        }

        // Tri des coups : captures d'abord (MVV heuristique)
        allMoves.sort((a, b) => {
            let scoreA = 0, scoreB = 0;
            const targetA = engine.board[a.to.row][a.to.col];
            const targetB = engine.board[b.to.row][b.to.col];
            if (targetA) scoreA += 10 * (PIECE_VALUES[targetA.type] || 0);
            if (a.isEnPassant) scoreA += 10 * PIECE_VALUES['P'];
            if (a.promotion) scoreA += 900;
            if (targetB) scoreB += 10 * (PIECE_VALUES[targetB.type] || 0);
            if (b.isEnPassant) scoreB += 10 * PIECE_VALUES['P'];
            if (b.promotion) scoreB += 900;
            return scoreB - scoreA;
        });

        if (maximizing) {
            let maxEval = -Infinity;
            for (const move of allMoves) {
                const copy = this.cloneEngine(engine);
                copy.makeMove(move.from, move.to, move.promotion || undefined);
                const eval_ = this.minimax(copy, depth - 1, alpha, beta, false, aiColor);
                maxEval = Math.max(maxEval, eval_);
                alpha = Math.max(alpha, eval_);
                if (beta <= alpha) break;
            }
            return maxEval;
        } else {
            let minEval = Infinity;
            for (const move of allMoves) {
                const copy = this.cloneEngine(engine);
                copy.makeMove(move.from, move.to, move.promotion || undefined);
                const eval_ = this.minimax(copy, depth - 1, alpha, beta, true, aiColor);
                minEval = Math.min(minEval, eval_);
                beta = Math.min(beta, eval_);
                if (beta <= alpha) break;
            }
            return minEval;
        }
    }

    /**
     * Trouve le meilleur coup pour la couleur de l'IA.
     * @param {ChessEngine} engine - Le moteur d'échecs actuel
     * @param {string} aiColor - 'white' ou 'black'
     * @returns {object|null} Le meilleur coup { from, to, promotion }
     */
    findBestMove(engine, aiColor) {
        const allMoves = engine.getAllLegalMoves();
        if (allMoves.length === 0) return null;

        const depth = this.getMaxDepth();
        let bestScore = -Infinity;
        let bestMoves = [];

        let alpha = -Infinity;
        let beta = Infinity;

        for (const move of allMoves) {
            // Toujours promouvoir en dame
            const promotion = move.promotion ? 'Q' : undefined;

            const copy = this.cloneEngine(engine);
            if (!copy.makeMove(move.from, move.to, promotion)) {
                continue;
            }

            let score;
            if (depth <= 1) {
                score = this.evaluateBoard(copy.board, aiColor);
            } else {
                score = this.minimax(copy, depth - 1, alpha, beta, false, aiColor);
            }

            if (score > bestScore) {
                bestScore = score;
                bestMoves = [{ from: move.from, to: move.to, promotion }];
            } else if (score === bestScore) {
                bestMoves.push({ from: move.from, to: move.to, promotion });
            }

            alpha = Math.max(alpha, score);
        }

        if (bestMoves.length === 0) {
            const m = allMoves[0];
            return { from: m.from, to: m.to, promotion: m.promotion ? 'Q' : undefined };
        }

        // Choisir aléatoirement parmi les meilleurs coups
        return bestMoves[Math.floor(Math.random() * bestMoves.length)];
    }
}
