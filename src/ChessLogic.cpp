#include "ChessLogic.hpp"
#include <algorithm>

namespace Chess {

ChessLogic::ChessLogic(Board& board)
    : m_board(board)
    , m_currentTurn(Color::White) {
}

std::vector<Move> ChessLogic::getLegalMoves(const Position& pos) const {
    const Piece& piece = m_board.getPiece(pos);
    if (piece.isEmpty() || piece.getColor() != m_currentTurn) {
        return {};
    }
    
    std::vector<Move> pseudoMoves = getPseudoLegalMoves(pos);
    std::vector<Move> legalMoves;
    
    for (const Move& move : pseudoMoves) {
        if (!wouldBeInCheck(move)) {
            legalMoves.push_back(move);
        }
    }
    
    return legalMoves;
}

bool ChessLogic::isLegalMove(const Move& move) const {
    std::vector<Move> legalMoves = getLegalMoves(move.from);
    return std::any_of(legalMoves.begin(), legalMoves.end(), 
        [&move](const Move& m) {
            return m.to == move.to && m.promotion == move.promotion;
        });
}

bool ChessLogic::makeMove(const Move& move) {
    if (!isLegalMove(move)) {
        return false;
    }
    
    Piece capturedPiece;
    // Save the moving piece info BEFORE moving
    Piece movingPiece = m_board.getPiece(move.from);
    Color pieceColor = movingPiece.getColor();
    
    // Handle en passant capture
    if (move.isEnPassant) {
        Position capturePos = {move.from.row, move.to.col};
        capturedPiece = m_board.getPiece(capturePos);
        m_board.removePiece(capturePos);
    } else {
        capturedPiece = m_board.getPiece(move.to);
    }
    
    // Store move for undo
    m_moveHistory.push_back({move, capturedPiece});
    
    // Handle castling
    if (move.isCastling) {
        m_board.movePiece(move.from, move.to);
        
        // Move the rook
        int rookFromCol = (move.to.col > move.from.col) ? 7 : 0;
        int rookToCol = (move.to.col > move.from.col) ? 5 : 3;
        m_board.movePiece({move.from.row, rookFromCol}, {move.from.row, rookToCol});
        
        // Disable castling rights
        m_board.disableCastling(movingPiece.getColor(), true);
        m_board.disableCastling(movingPiece.getColor(), false);
    } else {
        // Regular move
        m_board.movePiece(move.from, move.to);
        
        // Handle promotion - use saved color
        if (move.promotion != PieceType::None) {
            Piece promotedPiece(move.promotion, pieceColor);
            promotedPiece.setMoved(true);
            m_board.setPiece(move.to, promotedPiece);
        }
    }
    
    // Update en passant target
    m_board.clearEnPassantTarget();
    if (movingPiece.getType() == PieceType::Pawn) {
        int rowDiff = move.to.row - move.from.row;
        if (std::abs(rowDiff) == 2) {
            m_board.setEnPassantTarget({(move.from.row + move.to.row) / 2, move.from.col});
        }
    }
    
    // Update castling rights if rook or king moved
    if (movingPiece.getType() == PieceType::King) {
        m_board.disableCastling(pieceColor, true);
        m_board.disableCastling(pieceColor, false);
    }
    if (movingPiece.getType() == PieceType::Rook) {
        if (move.from.col == 0) {
            m_board.disableCastling(pieceColor, false);
        } else if (move.from.col == 7) {
            m_board.disableCastling(pieceColor, true);
        }
    }
    
    // Switch turn
    m_currentTurn = (m_currentTurn == Color::White) ? Color::Black : Color::White;
    
    return true;
}

bool ChessLogic::undoMove() {
    if (m_moveHistory.empty()) {
        return false;
    }
    
    // TODO: Implement full undo with castling rights restoration
    m_moveHistory.pop_back();
    m_currentTurn = (m_currentTurn == Color::White) ? Color::Black : Color::White;
    
    return true;
}

bool ChessLogic::isInCheck(Color color) const {
    Position kingPos = m_board.findKing(color);
    if (!kingPos.isValid()) {
        return false;
    }
    
    Color opponent = (color == Color::White) ? Color::Black : Color::White;
    return isAttacked(kingPos, opponent);
}

bool ChessLogic::isCheckmate(Color color) const {
    if (!isInCheck(color)) {
        return false;
    }
    
    // Check if any piece has legal moves
    std::vector<Position> pieces = m_board.findPieces(color);
    for (const Position& pos : pieces) {
        // Temporarily switch turn to check moves
        Color savedTurn = m_currentTurn;
        const_cast<Color&>(m_currentTurn) = color;
        
        std::vector<Move> moves = getLegalMoves(pos);
        
        const_cast<Color&>(m_currentTurn) = savedTurn;
        
        if (!moves.empty()) {
            return false;
        }
    }
    
    return true;
}

bool ChessLogic::isStalemate(Color color) const {
    if (isInCheck(color)) {
        return false;
    }
    
    // Check if any piece has legal moves
    std::vector<Position> pieces = m_board.findPieces(color);
    for (const Position& pos : pieces) {
        Color savedTurn = m_currentTurn;
        const_cast<Color&>(m_currentTurn) = color;
        
        std::vector<Move> moves = getLegalMoves(pos);
        
        const_cast<Color&>(m_currentTurn) = savedTurn;
        
        if (!moves.empty()) {
            return false;
        }
    }
    
    return true;
}

GameState ChessLogic::getGameState() const {
    if (isCheckmate(m_currentTurn)) {
        return GameState::Checkmate;
    }
    if (isStalemate(m_currentTurn)) {
        return GameState::Stalemate;
    }
    if (isInCheck(m_currentTurn)) {
        return GameState::Check;
    }
    return GameState::Playing;
}

bool ChessLogic::isAttacked(const Position& pos, Color byColor) const {
    std::vector<Position> attackers = m_board.findPieces(byColor);
    
    for (const Position& attackerPos : attackers) {
        const Piece& attacker = m_board.getPiece(attackerPos);
        
        int rowDiff = pos.row - attackerPos.row;
        int colDiff = pos.col - attackerPos.col;
        int absRowDiff = std::abs(rowDiff);
        int absColDiff = std::abs(colDiff);
        
        switch (attacker.getType()) {
            case PieceType::Pawn: {
                int direction = (byColor == Color::White) ? -1 : 1;
                if (rowDiff == direction && absColDiff == 1) {
                    return true;
                }
                break;
            }
            case PieceType::Knight: {
                if ((absRowDiff == 2 && absColDiff == 1) || 
                    (absRowDiff == 1 && absColDiff == 2)) {
                    return true;
                }
                break;
            }
            case PieceType::Bishop: {
                if (absRowDiff == absColDiff && absRowDiff > 0) {
                    // Check path is clear
                    int rowStep = (rowDiff > 0) ? 1 : -1;
                    int colStep = (colDiff > 0) ? 1 : -1;
                    bool pathClear = true;
                    for (int i = 1; i < absRowDiff; ++i) {
                        if (!m_board.getPiece(attackerPos.row + i * rowStep, 
                                              attackerPos.col + i * colStep).isEmpty()) {
                            pathClear = false;
                            break;
                        }
                    }
                    if (pathClear) return true;
                }
                break;
            }
            case PieceType::Rook: {
                if ((rowDiff == 0 || colDiff == 0) && (absRowDiff + absColDiff > 0)) {
                    int rowStep = (rowDiff == 0) ? 0 : (rowDiff > 0 ? 1 : -1);
                    int colStep = (colDiff == 0) ? 0 : (colDiff > 0 ? 1 : -1);
                    int steps = std::max(absRowDiff, absColDiff);
                    bool pathClear = true;
                    for (int i = 1; i < steps; ++i) {
                        if (!m_board.getPiece(attackerPos.row + i * rowStep, 
                                              attackerPos.col + i * colStep).isEmpty()) {
                            pathClear = false;
                            break;
                        }
                    }
                    if (pathClear) return true;
                }
                break;
            }
            case PieceType::Queen: {
                bool isDiagonal = (absRowDiff == absColDiff && absRowDiff > 0);
                bool isStraight = ((rowDiff == 0 || colDiff == 0) && (absRowDiff + absColDiff > 0));
                if (isDiagonal || isStraight) {
                    int rowStep = (rowDiff == 0) ? 0 : (rowDiff > 0 ? 1 : -1);
                    int colStep = (colDiff == 0) ? 0 : (colDiff > 0 ? 1 : -1);
                    int steps = std::max(absRowDiff, absColDiff);
                    bool pathClear = true;
                    for (int i = 1; i < steps; ++i) {
                        if (!m_board.getPiece(attackerPos.row + i * rowStep, 
                                              attackerPos.col + i * colStep).isEmpty()) {
                            pathClear = false;
                            break;
                        }
                    }
                    if (pathClear) return true;
                }
                break;
            }
            case PieceType::King: {
                if (absRowDiff <= 1 && absColDiff <= 1 && (absRowDiff + absColDiff > 0)) {
                    return true;
                }
                break;
            }
            default:
                break;
        }
    }
    
    return false;
}

std::vector<Move> ChessLogic::getPseudoLegalMoves(const Position& pos) const {
    const Piece& piece = m_board.getPiece(pos);
    
    switch (piece.getType()) {
        case PieceType::Pawn:   return getPawnMoves(pos);
        case PieceType::Knight: return getKnightMoves(pos);
        case PieceType::Bishop: return getBishopMoves(pos);
        case PieceType::Rook:   return getRookMoves(pos);
        case PieceType::Queen:  return getQueenMoves(pos);
        case PieceType::King:   return getKingMoves(pos);
        default: return {};
    }
}

std::vector<Move> ChessLogic::getPawnMoves(const Position& pos) const {
    std::vector<Move> moves;
    const Piece& pawn = m_board.getPiece(pos);
    Color color = pawn.getColor();
    int direction = (color == Color::White) ? -1 : 1;
    int startRow = (color == Color::White) ? 6 : 1;
    int promotionRow = (color == Color::White) ? 0 : 7;
    
    // Forward move
    Position forward = {pos.row + direction, pos.col};
    if (forward.isValid() && m_board.getPiece(forward).isEmpty()) {
        if (forward.row == promotionRow) {
            // Add promotion moves
            for (PieceType promo : {PieceType::Queen, PieceType::Rook, 
                                    PieceType::Bishop, PieceType::Knight}) {
                Move move = {pos, forward, promo};
                moves.push_back(move);
            }
        } else {
            moves.push_back({pos, forward});
        }
        
        // Double move from starting position
        if (pos.row == startRow) {
            Position doubleForward = {pos.row + 2 * direction, pos.col};
            if (m_board.getPiece(doubleForward).isEmpty()) {
                moves.push_back({pos, doubleForward});
            }
        }
    }
    
    // Captures
    for (int colOffset : {-1, 1}) {
        Position capturePos = {pos.row + direction, pos.col + colOffset};
        if (!capturePos.isValid()) continue;
        
        const Piece& target = m_board.getPiece(capturePos);
        bool isCapture = !target.isEmpty() && target.getColor() != color;
        bool isEnPassant = capturePos == m_board.getEnPassantTarget();
        
        if (isCapture || isEnPassant) {
            if (capturePos.row == promotionRow) {
                for (PieceType promo : {PieceType::Queen, PieceType::Rook, 
                                        PieceType::Bishop, PieceType::Knight}) {
                    Move move = {pos, capturePos, promo, true};
                    moves.push_back(move);
                }
            } else {
                Move move = {pos, capturePos, PieceType::None, isCapture, false, isEnPassant};
                moves.push_back(move);
            }
        }
    }
    
    return moves;
}

std::vector<Move> ChessLogic::getKnightMoves(const Position& pos) const {
    std::vector<Move> moves;
    const Piece& knight = m_board.getPiece(pos);
    Color color = knight.getColor();
    
    int offsets[][2] = {{-2, -1}, {-2, 1}, {-1, -2}, {-1, 2},
                        {1, -2}, {1, 2}, {2, -1}, {2, 1}};
    
    for (auto& offset : offsets) {
        Position target = {pos.row + offset[0], pos.col + offset[1]};
        if (!target.isValid()) continue;
        
        const Piece& targetPiece = m_board.getPiece(target);
        if (targetPiece.isEmpty() || targetPiece.getColor() != color) {
            Move move = {pos, target, PieceType::None, !targetPiece.isEmpty()};
            moves.push_back(move);
        }
    }
    
    return moves;
}

std::vector<Move> ChessLogic::getBishopMoves(const Position& pos) const {
    return getSlidingMoves(pos, {{-1, -1}, {-1, 1}, {1, -1}, {1, 1}});
}

std::vector<Move> ChessLogic::getRookMoves(const Position& pos) const {
    return getSlidingMoves(pos, {{-1, 0}, {1, 0}, {0, -1}, {0, 1}});
}

std::vector<Move> ChessLogic::getQueenMoves(const Position& pos) const {
    return getSlidingMoves(pos, {{-1, -1}, {-1, 0}, {-1, 1}, {0, -1}, 
                                  {0, 1}, {1, -1}, {1, 0}, {1, 1}});
}

std::vector<Move> ChessLogic::getKingMoves(const Position& pos) const {
    std::vector<Move> moves;
    const Piece& king = m_board.getPiece(pos);
    Color color = king.getColor();
    
    // Normal moves
    for (int dr = -1; dr <= 1; ++dr) {
        for (int dc = -1; dc <= 1; ++dc) {
            if (dr == 0 && dc == 0) continue;
            
            Position target = {pos.row + dr, pos.col + dc};
            if (!target.isValid()) continue;
            
            const Piece& targetPiece = m_board.getPiece(target);
            if (targetPiece.isEmpty() || targetPiece.getColor() != color) {
                Move move = {pos, target, PieceType::None, !targetPiece.isEmpty()};
                moves.push_back(move);
            }
        }
    }
    
    // Castling
    if (!king.hasMoved() && !isInCheck(color)) {
        // Kingside castling
        if (m_board.canCastleKingside(color)) {
            const Piece& rook = m_board.getPiece(pos.row, 7);
            if (rook.getType() == PieceType::Rook && !rook.hasMoved()) {
                bool pathClear = m_board.getPiece(pos.row, 5).isEmpty() &&
                                 m_board.getPiece(pos.row, 6).isEmpty();
                bool pathSafe = !isAttacked({pos.row, 5}, 
                                color == Color::White ? Color::Black : Color::White) &&
                               !isAttacked({pos.row, 6}, 
                                color == Color::White ? Color::Black : Color::White);
                if (pathClear && pathSafe) {
                    Move move = {pos, {pos.row, 6}, PieceType::None, false, true};
                    moves.push_back(move);
                }
            }
        }
        
        // Queenside castling
        if (m_board.canCastleQueenside(color)) {
            const Piece& rook = m_board.getPiece(pos.row, 0);
            if (rook.getType() == PieceType::Rook && !rook.hasMoved()) {
                bool pathClear = m_board.getPiece(pos.row, 1).isEmpty() &&
                                 m_board.getPiece(pos.row, 2).isEmpty() &&
                                 m_board.getPiece(pos.row, 3).isEmpty();
                bool pathSafe = !isAttacked({pos.row, 2}, 
                                color == Color::White ? Color::Black : Color::White) &&
                               !isAttacked({pos.row, 3}, 
                                color == Color::White ? Color::Black : Color::White);
                if (pathClear && pathSafe) {
                    Move move = {pos, {pos.row, 2}, PieceType::None, false, true};
                    moves.push_back(move);
                }
            }
        }
    }
    
    return moves;
}

std::vector<Move> ChessLogic::getSlidingMoves(const Position& pos, 
                                              const std::vector<std::pair<int, int>>& directions) const {
    std::vector<Move> moves;
    const Piece& piece = m_board.getPiece(pos);
    Color color = piece.getColor();
    
    for (const auto& dir : directions) {
        Position target = pos;
        while (true) {
            target.row += dir.first;
            target.col += dir.second;
            
            if (!target.isValid()) break;
            
            const Piece& targetPiece = m_board.getPiece(target);
            if (targetPiece.isEmpty()) {
                moves.push_back({pos, target});
            } else {
                if (targetPiece.getColor() != color) {
                    Move move = {pos, target, PieceType::None, true};
                    moves.push_back(move);
                }
                break;
            }
        }
    }
    
    return moves;
}

bool ChessLogic::wouldBeInCheck(const Move& move) const {
    // Make a copy of the board state and simulate the move
    Board& board = const_cast<Board&>(m_board);
    const Piece& movingPiece = board.getPiece(move.from);
    Color color = movingPiece.getColor();
    
    // Save state
    Piece capturedPiece = board.getPiece(move.to);
    Piece enPassantCaptured;
    Position enPassantPos = {-1, -1};
    
    if (move.isEnPassant) {
        enPassantPos = {move.from.row, move.to.col};
        enPassantCaptured = board.getPiece(enPassantPos);
        board.removePiece(enPassantPos);
    }
    
    // Make move
    board.movePiece(move.from, move.to);
    
    // Check if king is in check
    Position kingPos = board.findKing(color);
    Color opponent = (color == Color::White) ? Color::Black : Color::White;
    bool inCheck = isAttacked(kingPos, opponent);
    
    // Undo move
    board.movePiece(move.to, move.from);
    board.getPiece(move.from).setMoved(movingPiece.hasMoved());
    board.setPiece(move.to, capturedPiece);
    
    if (move.isEnPassant) {
        board.setPiece(enPassantPos, enPassantCaptured);
    }
    
    return inCheck;
}

} // namespace Chess
