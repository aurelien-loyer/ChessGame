# Makefile pour Chess Game SFML
CXX = c++

CXXFLAGS = -std=c++17 -O2 -Wall -Wextra -I/opt/homebrew/include -Iinclude

LDFLAGS = -L/opt/homebrew/lib -lsfml-graphics -lsfml-window -lsfml-system -lsfml-audio -lsfml-network

SRCDIR = src

SOURCES = $(wildcard $(SRCDIR)/*.cpp)

TARGET = chess

all: $(TARGET)

$(TARGET): $(SOURCES)
	$(CXX) $(CXXFLAGS) $(SOURCES) -o $(TARGET) $(LDFLAGS)

clean:
	rm -f $(TARGET)

run: $(TARGET)
	./$(TARGET)

fclean: clean
	rm -f $(TARGET)
	rm -f **/*.o

re: fclean all

.PHONY: all clean run
