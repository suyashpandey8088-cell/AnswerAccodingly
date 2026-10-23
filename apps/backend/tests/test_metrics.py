import pytest

from app.metrics.calculations import median, percentile


def test_percentile_linear_interpolation_and_empty_values():
    assert percentile([1, 2, 3, 4], 0.95) == pytest.approx(3.85)
    assert percentile([1, 2, 3, 4], 0.5) == pytest.approx(2.5)
    assert percentile([10], 0.95) == 10
    assert percentile([], 0.95) is None
    assert percentile([None, float("nan"), -1], 0.95) is None
    assert median([1, None, 3, 2]) == 2


def test_percentile_rejects_invalid_input():
    with pytest.raises(ValueError):
        percentile([1, 2], 1.1)
