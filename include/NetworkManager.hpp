#pragma once

#include "Types.hpp"
#include <SFML/Network.hpp>
#include <string>
#include <optional>
#include <functional>
#include <memory>

namespace Chess {

// Messages réseau
enum class NetMessageType : std::int32_t {
    Move = 1,        // Un coup joué
    ColorAssign = 2, // Attribution de couleur (serveur -> client)
    Ready = 3,       // Joueur prêt
    Resign = 4,      // Abandon
    Disconnect = 5   // Déconnexion
};

// État de la connexion réseau
enum class NetworkState {
    Disconnected,
    Hosting,       // En attente d'un joueur
    Connecting,    // Tentative de connexion
    Connected      // Partie en cours
};

class NetworkManager {
public:
    NetworkManager();
    ~NetworkManager();
    
    // Héberger une partie (serveur)
    bool hostGame(unsigned short port = 55001);
    
    // Rejoindre une partie (client)
    bool joinGame(const std::string& address, unsigned short port = 55001);
    
    // Vérifier les messages entrants (non-bloquant)
    void update();
    
    // Envoyer un coup
    bool sendMove(const Move& move);
    
    // Envoyer un abandon
    bool sendResign();
    
    // Déconnexion propre
    void disconnect();
    
    // État
    NetworkState getState() const { return m_state; }
    bool isConnected() const { return m_state == NetworkState::Connected; }
    bool isHost() const { return m_isHost; }
    
    // Couleur locale assignée par le serveur
    Color getLocalColor() const { return m_localColor; }
    
    // Récupérer le dernier coup reçu (std::nullopt si aucun)
    std::optional<Move> getReceivedMove();
    
    // Vérifier si l'adversaire a abandonné
    bool hasOpponentResigned() const { return m_opponentResigned; }
    
    // Vérifier si l'adversaire s'est déconnecté
    bool hasOpponentDisconnected() const { return m_opponentDisconnected; }
    
    // Obtenir l'adresse IP locale pour l'afficher
    std::string getLocalAddress() const;
    
    // Obtenir le port
    unsigned short getPort() const { return m_port; }
    
    // Réinitialiser les flags
    void resetFlags();

private:
    bool sendPacket(sf::Packet& packet);
    void handlePacket(sf::Packet& packet);
    
    NetworkState m_state;
    bool m_isHost;
    Color m_localColor;
    unsigned short m_port;
    
    // Sockets
    std::unique_ptr<sf::TcpListener> m_listener;
    std::unique_ptr<sf::TcpSocket> m_socket;
    
    // Données reçues
    std::optional<Move> m_receivedMove;
    bool m_opponentResigned;
    bool m_opponentDisconnected;
};

} // namespace Chess
