"""
Arquitetura híbrida GAT + MLP para estimativa de custo de arestas.

Fluxo:
  1. Constrói node features a partir das arestas do grafo (média das features
     das arestas incidentes em cada nó).
  2. GAT (2 camadas, 4 cabeças) propaga contexto entre vizinhos, produzindo
     embeddings de nó de dimensão `gat_out_dim`.
  3. Para cada aresta u→v, concatena:
       [embedding_u (gat_out_dim) || embedding_v (gat_out_dim) || edge_features (9)]
     e passa por uma MLP que regride o custo em segundos.

Por que isso corrige o NaN da tentativa anterior:
  - IDs OSMnx são remapeados para 0..N-1 antes de qualquer operação.
  - Features são normalizadas ANTES de entrar no GAT.
  - Self-loops são adicionados explicitamente (add_self_loops=True, padrão).
  - Gradient clipping é aplicado no loop de treino.
"""

import torch
import torch.nn as nn
from torch_geometric.nn import GATConv

class PathNetwork(nn.Module):
    """
    Modelo híbrido GAT + MLP para regressão de custo de arestas.

    Parâmetros
    ----------
    edge_feat_size : int
        Número de features base da aresta (sem vizinhança). Padrão: 9.
    node_feat_size : int
        Número de features de nó construídas pelo builder. Padrão: 9
        (mesmas features base, agregadas por nó).
    gat_hidden : int
        Dimensão interna de cada cabeça GAT. Padrão: 32.
    gat_heads : int
        Número de cabeças de atenção. Padrão: 4.
    gat_out_dim : int
        Dimensão do embedding de nó após as 2 camadas GAT. Padrão: 32.
    mlp_hidden : int
        Dimensão das camadas ocultas da MLP regressora. Padrão: 128.
    """

    # Features base da aresta (sem vizinhança): as 9 originais
    EDGE_FEAT_SIZE = 9
    # Features de nó = mesmas 9 features base, agregadas (média) por nó
    NODE_FEAT_SIZE = 9

    DEFAULT_SPEED: dict[str, float] = {
        "motorway":      80.0, "motorway_link": 60.0,
        "trunk":         70.0, "trunk_link":    50.0,
        "primary":       60.0, "primary_link":  50.0,
        "secondary":     50.0, "secondary_link":40.0,
        "tertiary":      40.0, "tertiary_link": 35.0,
        "residential":   30.0, "living_street": 20.0,
        "service":       25.0, "unclassified":  35.0,
        "road":          35.0,
    }
    DEFAULT_SPEED_FALLBACK = 30.0

    HIGHWAY_GROUP: dict[str, int] = {
        "motorway": 0, "motorway_link": 0,
        "trunk":    0, "trunk_link":    0,
        "primary":  1, "primary_link":  1,
        "secondary":2, "secondary_link":2,
        "tertiary": 3, "tertiary_link": 3,
    }
    FAST_HIGHWAY_TYPES = {
        "motorway", "motorway_link", "trunk", "trunk_link",
        "primary",  "primary_link",
    }
    NUM_HIGHWAY_GROUPS = 5

    # Tamanho do vetor de entrada da MLP:
    # embedding_u + embedding_v + features_aresta
    # (calculado dinamicamente no __init__)

    def __init__(
        self,
        edge_feat_size: int = EDGE_FEAT_SIZE,
        node_feat_size: int = NODE_FEAT_SIZE,
        gat_hidden:     int = 32,
        gat_heads:      int = 4,
        gat_out_dim:    int = 32,
        mlp_hidden:     int = 128,
    ):
        super().__init__()

        self.edge_feat_size = edge_feat_size
        self.gat_out_dim    = gat_out_dim

        # --- Encoder GAT (2 camadas) ---
        # Camada 1: node_feat_size → gat_hidden * gat_heads  (concat=True)
        self.gat1 = GATConv(
            node_feat_size, gat_hidden,
            heads=gat_heads, concat=True, dropout=0.1,
        )
        # Camada 2: gat_hidden * gat_heads → gat_out_dim  (concat=False → média)
        self.gat2 = GATConv(
            gat_hidden * gat_heads, gat_out_dim,
            heads=1, concat=False, dropout=0.1,
        )

        # --- MLP regressora ---
        mlp_input = gat_out_dim * 2 + edge_feat_size
        self.mlp = nn.Sequential(
            nn.Linear(mlp_input, mlp_hidden),
            nn.ReLU(),
            nn.Dropout(0.1),
            nn.Linear(mlp_hidden, mlp_hidden),
            nn.ReLU(),
            nn.Linear(mlp_hidden, mlp_hidden // 2),
            nn.ReLU(),
            nn.Linear(mlp_hidden // 2, 1),
            nn.Softplus(),   # garante saída positiva
        )

    def forward(
        self,
        x:          torch.Tensor,   # [N, node_feat_size] — features dos nós
        edge_index: torch.Tensor,   # [2, E] — índices das arestas (já 0-based)
        edge_feats: torch.Tensor,   # [E, edge_feat_size] — features das arestas
        return_attention: bool = False,
    ):
        """
        Retorna tensor [E, 1] com o custo estimado de cada aresta.
        """
        # Embeddings de nó via GAT
        if return_attention:
            first, attention_1 = self.gat1(x, edge_index, return_attention_weights=True)
            second, attention_2 = self.gat2(torch.relu(first), edge_index, return_attention_weights=True)
            h = torch.relu(second)
        else:
            h = torch.relu(self.gat1(x, edge_index))
            h = torch.relu(self.gat2(h, edge_index))

        # Para cada aresta u→v, pega embeddings dos dois extremos
        src, dst = edge_index[0], edge_index[1]
        h_src = h[src]   # [E, gat_out_dim]
        h_dst = h[dst]   # [E, gat_out_dim]

        # Concatena embeddings + features da aresta e regride
        combined = torch.cat([h_src, h_dst, edge_feats], dim=1)  # [E, mlp_input]
        prediction = self.mlp(combined)
        return (prediction, (attention_1, attention_2)) if return_attention else prediction

    # ------------------------------------------------------------------
    # Métodos estáticos de extração de features (mantidos compatíveis)
    # ------------------------------------------------------------------

    @staticmethod
    def _parse_speed(speed_raw, highway_type: str) -> float:
        if speed_raw is not None:
            if isinstance(speed_raw, list):
                speed_raw = speed_raw[0]
            try:
                return float(str(speed_raw).split()[0])
            except (ValueError, AttributeError):
                pass
        return PathNetwork.DEFAULT_SPEED.get(
            highway_type, PathNetwork.DEFAULT_SPEED_FALLBACK
        )

    @staticmethod
    def _highway_onehot(highway_type: str) -> list[float]:
        group = PathNetwork.HIGHWAY_GROUP.get(highway_type, 4)
        onehot = [0.0] * PathNetwork.NUM_HIGHWAY_GROUPS
        onehot[group] = 1.0
        return onehot

    @staticmethod
    def _get_highway_str(data: dict) -> str:
        highway = data.get("highway", "unclassified")
        if isinstance(highway, list):
            highway = highway[0]
        return str(highway).strip()

    @staticmethod
    def extract_edge_features(edge_data: dict) -> list[float]:
        """
        Extrai as 9 features base de uma aresta (sem vizinhança).
        Usado tanto no treino quanto na inferência.

        [0] length     — metros
        [1] speed_kmh  — km/h inferida por tipo de via
        [2] lanes      — número de faixas
        [3] oneway     — 1.0 / 0.0
        [4-8]          — one-hot do grupo de tipo de via (5 grupos)
        """
        length  = float(edge_data.get("length", 100.0))
        highway = PathNetwork._get_highway_str(edge_data)
        speed_kmh = PathNetwork._parse_speed(edge_data.get("maxspeed"), highway)

        lanes_raw = edge_data.get("lanes", 1)
        if isinstance(lanes_raw, list):
            lanes_raw = lanes_raw[0]
        try:
            lanes = max(1.0, float(str(lanes_raw)))
        except (ValueError, AttributeError):
            lanes = 1.0

        oneway_raw = edge_data.get("oneway", False)
        oneway = 1.0 if oneway_raw is True or str(oneway_raw).lower() == "yes" else 0.0

        hw_onehot = PathNetwork._highway_onehot(highway)
        return [length, speed_kmh, lanes, oneway] + hw_onehot