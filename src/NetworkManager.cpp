#include "NetworkManager.hpp"
#include <iostream>
#include <random>

namespace Chess {

NetworkManager::NetworkManager()
    : m_state(NetworkState::Disconnected)
    , m_isHost(false)
    , m_localColor(Color::White)
    , m_port(55001)
    , m_opponentResigned(false)
    , m_opponentDisconnected(false) {
}

NetworkManager::~NetworkManager() {
    disconnect();
}

bool NetworkManager::hostGame(unsigned short port) {
    disconnect();
    
    m_port = port;
    m_isHost = true;
    
    m_listener = std::make_unique<sf::TcpListener>();
    m_listener->setBlocking(false);
    
    if (m_listener->listen(port) != sf::Socket::Status::Done) {
        std::cerr << "Erreur: impossible d'ecouter sur le port " << port << std::endl;
        m_listener.reset();
        return false;
    }
    
    m_socket = std::make_unique<sf::TcpSocket>();
    m_state = NetworkState::Hosting;
    
    std::cout << "En attente d'un joueur sur le port " << port << "..." << std::endl;
    return true;
}

bool NetworkManager::joinGame(const std::string& address, unsigned short port) {
    disconnect();
    
    m_port = port;
    m_isHost = false;
    
    m_socket = std::make_unique<sf::TcpSocket>();
    m_state = NetworkState::Connecting;
    
    auto ip = sf::IpAddress::resolve(address);
    if (!ip.has_value()) {
        std::cerr << "Erreur: adresse IP invalide: " << address << std::endl;
        m_state = NetworkState::Disconnected;
        return false;
    }
    
    // Tentative de connexion avec timeout de 5 secondes
    sf::Socket::Status status = m_socket->connect(ip.value(), port, sf::seconds(5));
    
    if (status != sf::Socket::Status::Done) {
        std::cerr << "Erreur: impossible de se connecter a " << address << ":" << port << std::endl;
        m_socket.reset();
        m_state = NetworkState::Disconnected;
        return false;
    }
    
    m_socket->setBlocking(false);
    m_state = NetworkState::Connected;
    
    std::cout << "Connecte au serveur " << address << ":" << port << std::endl;
    return true;
}

void NetworkManager::update() {
    if (m_state == NetworkState::Hosting) {
        // Vérifier si un client se connecte
        sf::Socket::Status status = m_listener->accept(*m_socket);
        if (status == sf::Socket::Status::Done) {
            std::cout << "Joueur connecte: " 
                      << m_socket->getRemoteAddress().value().toString() << std::endl;
            
            m_socket->setBlocking(false);
            m_state = NetworkState::Connected;
            
            // Le serveur choisit aléatoirement les couleurs
            std::random_device rd;
            std::mt19937 rng(rd());
            std::uniform_int_distribution<int> dist(0, 1);
            m_localColor = (dist(rng) == 0) ? Color::White : Color::Black;
            Color remoteColor = (m_localColor == Color::White) ? Color::Black : Color::White;
            
            // Envoyer la couleur au client
            sf::Packet packet;
            packet << static_cast<std::int32_t>(NetMessageType::ColorAssign)
                   << static_cast<std::int32_t>(remoteColor);
            sendPacket(packet);
            
            // Fermer le listener, on n'accepte qu'un seul joueur
            m_listener->close();
        }
    }
    
    if (m_state == NetworkState::Connected && m_socket) {
        // Lire les paquets entrants
        sf::Packet packet;
        sf::Socket::Status status = m_socket->receive(packet);
        
        while (status == sf::Socket::Status::Done) {
            handlePacket(packet);
            packet.clear();
            status = m_socket->receive(packet);
        }
        
        if (status == sf::Socket::Status::Disconnected ||
            status == sf::Socket::Status::Error) {
            std::cout << "Adversaire deconnecte." << std::endl;
            m_opponentDisconnected = true;
            m_state = NetworkState::Disconnected;
        }
    }
}

void NetworkManager::handlePacket(sf::Packet& packet) {
    std::int32_t typeInt;
    if (!(packet >> typeInt)) return;
    
    NetMessageType type = static_cast<NetMessageType>(typeInt);
    
    switch (type) {
        case NetMessageType::Move: {
            std::int32_t fromRow, fromCol, toRow, toCol;
            std::int32_t promotionInt;
            bool isCapture, isCastling, isEnPassant;
            
            if (packet >> fromRow >> fromCol >> toRow >> toCol
                >> promotionInt >> isCapture >> isCastling >> isEnPassant) {
                Move move;
                move.from = {fromRow, fromCol};
                move.to = {toRow, toCol};
                move.promotion = static_cast<PieceType>(promotionInt);
                move.isCapture = isCapture;
                move.isCastling = isCastling;
                move.isEnPassant = isEnPassant;
                m_receivedMove = move;
            }
            break;
        }
        case NetMessageType::ColorAssign: {
            std::int32_t colorInt;
            if (packet >> colorInt) {
                m_localColor = static_cast<Color>(colorInt);
                std::cout << "Couleur assignee: " 
                          << (m_localColor == Color::White ? "Blancs" : "Noirs") << std::endl;
            }
            break;
        }
        case NetMessageType::Resign: {
            m_opponentResigned = true;
            break;
        }
        case NetMessageType::Disconnect: {
            m_opponentDisconnected = true;
            m_state = NetworkState::Disconnected;
            break;
        }
        default:
            break;
    }
}

bool NetworkManager::sendMove(const Move& move) {
    if (m_state != NetworkState::Connected || !m_socket) return false;
    
    sf::Packet packet;
    packet << static_cast<std::int32_t>(NetMessageType::Move)
           << static_cast<std::int32_t>(move.from.row)
           << static_cast<std::int32_t>(move.from.col)
           << static_cast<std::int32_t>(move.to.row)
           << static_cast<std::int32_t>(move.to.col)
           << static_cast<std::int32_t>(move.promotion)
           << move.isCapture
           << move.isCastling
           << move.isEnPassant;
    
    return sendPacket(packet);
}

bool NetworkManager::sendResign() {
    if (m_state != NetworkState::Connected || !m_socket) return false;
    
    sf::Packet packet;
    packet << static_cast<std::int32_t>(NetMessageType::Resign);
    return sendPacket(packet);
}

void NetworkManager::disconnect() {
    if (m_socket && m_state == NetworkState::Connected) {
        sf::Packet packet;
        packet << static_cast<std::int32_t>(NetMessageType::Disconnect);
        m_socket->setBlocking(true);
        (void)sendPacket(packet);
    }
    
    if (m_socket) {
        m_socket->disconnect();
        m_socket.reset();
    }
    
    if (m_listener) {
        m_listener->close();
        m_listener.reset();
    }
    
    m_state = NetworkState::Disconnected;
    m_receivedMove.reset();
    m_opponentResigned = false;
    m_opponentDisconnected = false;
}

bool NetworkManager::sendPacket(sf::Packet& packet) {
    if (!m_socket) return false;
    
    // Passer en bloquant pour l'envoi pour garantir la livraison
    bool wasBlocking = m_socket->isBlocking();
    m_socket->setBlocking(true);
    
    sf::Socket::Status status = m_socket->send(packet);
    
    m_socket->setBlocking(wasBlocking);
    
    if (status != sf::Socket::Status::Done) {
        std::cerr << "Erreur d'envoi de paquet reseau." << std::endl;
        return false;
    }
    return true;
}

std::optional<Move> NetworkManager::getReceivedMove() {
    auto move = m_receivedMove;
    m_receivedMove.reset();
    return move;
}

std::string NetworkManager::getLocalAddress() const {
    auto addr = sf::IpAddress::getLocalAddress();
    if (addr.has_value()) {
        return addr.value().toString();
    }
    return "127.0.0.1";
}

void NetworkManager::resetFlags() {
    m_opponentResigned = false;
    m_opponentDisconnected = false;
    m_receivedMove.reset();
}

} // namespace Chess
