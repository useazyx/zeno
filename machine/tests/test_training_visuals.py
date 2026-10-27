import math

import torch

from api.training import TrainingJob, TrainingManager
from src.neural.path_network import PathNetwork
from src.pathfinding.pathfinder import apply_neural_weights


def test_learning_rate_is_preserved_without_inventing_legacy_values():
    job = TrainingJob(800)
    TrainingManager._parse_progress(job, "50/800 0.2 0.3 0.3 0.000300")
    TrainingManager._parse_progress(job, "100/800 0.1 0.2 0.2 0.000150")
    TrainingManager._parse_progress(job, "150/800 0.1 0.2 0.2")
    assert [point.get("learning_rate") for point in job.history] == [0.0003, 0.00015, None]


def test_attention_capture_preserves_prediction():
    torch.manual_seed(3)
    model = PathNetwork().eval()
    x = torch.rand(4, 9)
    indices = torch.tensor([[0, 1, 2, 3], [1, 2, 3, 0]])
    features = torch.rand(4, 9)
    with torch.no_grad():
        expected = model(x, indices, features)
        actual, rounds = model(x, indices, features, return_attention=True)
    assert torch.allclose(expected, actual, atol=1e-7)
    assert len(rounds) == 2
    for edge_index, weights in rounds:
        assert edge_index.shape[1] == weights.shape[0]
        assert torch.isfinite(weights).all()
        assert ((weights >= 0) & (weights <= 1)).all()


def test_real_attention_is_exported_for_both_layers(city_engine):
    model = PathNetwork().eval()
    graph = city_engine._graph
    apply_neural_weights(graph, model, torch.zeros(9), torch.ones(9), torch.zeros(9), torch.ones(9), torch.tensor(1.0), torch.tensor(1.0))
    city_engine.use_graph(graph, "attention-test")
    features = city_engine.edge_costs()["features"]
    assert features
    for feature in features:
        for key in ("attention_1", "attention_2"):
            value = feature["properties"][key]
            assert math.isfinite(value) and 0 <= value <= 1
