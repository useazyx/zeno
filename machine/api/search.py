"""Busca com rastro real, mantendo inclusive o desempate do NetworkX."""

from heapq import heappop, heappush
from itertools import count

import networkx as nx

MAX_EXPLORATION_POINTS = 4000


def traced_shortest_path(graph, source, target, weight: str) -> tuple[list, list]:
    # O shortest_path atual usa Dijkstra bidirecional. Alternar as frentes e
    # preservar a ordem das adjacências mantém o mesmo caminho em empates.
    if source not in graph or target not in graph:
        raise nx.NodeNotFound("Origem ou destino fora do grafo")
    if source == target:
        return [source], [source]
    settled, seen = [{}, {}], [{source: 0}, {target: 0}]
    parents = [{source: None}, {target: None}]
    serial = count()
    queues = [[(0, next(serial), source)], [(0, next(serial), target)]]
    neighbors = [graph.adj, graph.pred if graph.is_directed() else graph.adj]
    explored, visited = [], set()
    best, meeting, direction = None, None, 1

    while queues[0] and queues[1]:
        direction = 1 - direction
        distance, _, node = heappop(queues[direction])
        if node in settled[direction]:
            continue
        settled[direction][node] = distance
        if node not in visited:
            visited.add(node)
            explored.append(node)
        if node in settled[1 - direction]:
            left, right = [], []
            cursor = meeting
            while cursor is not None:
                left.append(cursor)
                cursor = parents[0][cursor]
            cursor = parents[1][meeting]
            while cursor is not None:
                right.append(cursor)
                cursor = parents[1][cursor]
            return list(reversed(left)) + right, explored
        for neighbor, edges in neighbors[direction][node].items():
            cost = min(edge.get(weight, 1) for edge in edges.values()) if graph.is_multigraph() else edges.get(weight, 1)
            candidate = distance + cost
            if neighbor in settled[direction]:
                if candidate < settled[direction][neighbor]:
                    raise ValueError("O grafo contém custo negativo")
                continue
            if neighbor not in seen[direction] or candidate < seen[direction][neighbor]:
                seen[direction][neighbor] = candidate
                parents[direction][neighbor] = node
                heappush(queues[direction], (candidate, next(serial), neighbor))
                if neighbor in seen[1 - direction]:
                    total = candidate + seen[1 - direction][neighbor]
                    if best is None or total < best:
                        best, meeting = total, neighbor
    raise nx.NetworkXNoPath(f"No path between {source} and {target}.")


def exploration_points(graph, nodes: list) -> list[list[float]]:
    # Amostragem uniforme mantém o primeiro e o último nó efetivamente fechado.
    size = min(len(nodes), MAX_EXPLORATION_POINTS)
    indices = [round(index * (len(nodes) - 1) / max(size - 1, 1)) for index in range(size)]
    return [[graph.nodes[nodes[index]]["y"], graph.nodes[nodes[index]]["x"]] for index in indices]
