"""Tests for the k-means cluster pipeline.

We don't exercise the SQLite path here — only the pure-numpy primitives
(`kmeans`, `_kmeans_pp_init`, `top_terms`). The module's `main()` is covered
indirectly because it composes those.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pytest

# Make the repo root importable for "pipeline.cluster.run".
ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from pipeline.cluster.run import (  # noqa: E402
    _kmeans_pp_init,
    kmeans,
    top_terms,
)


def _normalize_rows(mat: np.ndarray) -> np.ndarray:
    n = np.linalg.norm(mat, axis=1, keepdims=True)
    n[n == 0] = 1.0
    return mat / n


def _three_blob_corpus(seed: int = 0) -> np.ndarray:
    """Return 60 L2-normalized points clustered around 3 well-separated directions."""
    rng = np.random.default_rng(seed)
    centers = np.array([[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]], dtype=np.float32)
    points = []
    for c in centers:
        for _ in range(20):
            jitter = rng.normal(scale=0.05, size=3).astype(np.float32)
            points.append(c + jitter)
    mat = np.stack(points)
    return _normalize_rows(mat)


class TestKMeansPPInit:
    def test_returns_k_distinct_centroids(self):
        mat = _three_blob_corpus(seed=1)
        rng = np.random.default_rng(1)
        centers = _kmeans_pp_init(mat, k=3, rng=rng)
        assert centers.shape == (3, mat.shape[1])
        # No two centers should be exactly identical.
        for i in range(3):
            for j in range(i + 1, 3):
                assert not np.allclose(centers[i], centers[j])

    def test_robust_to_floating_point_noise(self):
        # Edge case that originally caused "Probabilities are not non-negative":
        # an all-identical matrix produces tiny negative values from float noise.
        mat = np.tile(np.array([[1.0, 0.0]], dtype=np.float32), (30, 1))
        rng = np.random.default_rng(0)
        centers = _kmeans_pp_init(mat, k=4, rng=rng)
        assert centers.shape == (4, 2)


class TestKMeans:
    def test_recovers_three_well_separated_clusters(self):
        mat = _three_blob_corpus(seed=42)
        labels, centers = kmeans(mat, k=3, iters=30, seed=42)
        # Each of the three blobs (rows 0..19, 20..39, 40..59) should land
        # in a single cluster.
        for start in (0, 20, 40):
            blob_labels = labels[start : start + 20]
            assert len(set(blob_labels.tolist())) == 1, (
                f"blob starting at {start} got mixed labels: {blob_labels}"
            )
        # The three blob-labels should themselves be distinct.
        assert len({labels[0], labels[20], labels[40]}) == 3

    def test_centers_are_l2_normalized(self):
        mat = _three_blob_corpus(seed=7)
        _labels, centers = kmeans(mat, k=3, iters=20, seed=7)
        norms = np.linalg.norm(centers, axis=1)
        np.testing.assert_allclose(norms, 1.0, atol=1e-5)

    def test_label_count_matches_input_rows(self):
        mat = _three_blob_corpus(seed=2)
        labels, _ = kmeans(mat, k=4, iters=10, seed=2)
        assert labels.shape == (mat.shape[0],)

    def test_deterministic_with_same_seed(self):
        mat = _three_blob_corpus(seed=11)
        l1, _ = kmeans(mat, k=3, iters=20, seed=99)
        l2, _ = kmeans(mat, k=3, iters=20, seed=99)
        np.testing.assert_array_equal(l1, l2)

    def test_handles_empty_clusters_via_reinit(self):
        # k > unique points: at least one cluster will start empty.
        # Just confirm we don't crash and we still return labels.
        mat = _three_blob_corpus(seed=0)
        labels, centers = kmeans(mat, k=10, iters=5, seed=0)
        assert labels.shape == (mat.shape[0],)
        assert centers.shape == (10, mat.shape[1])
        # All centers should still be normalized
        norms = np.linalg.norm(centers, axis=1)
        np.testing.assert_allclose(norms, 1.0, atol=1e-5)


class TestTopTerms:
    def _texts(self):
        # 6 docs across 3 thematic clusters
        return {
            1: "buddhist meditation suffering enlightenment",
            2: "buddhist enlightenment compassion practice",
            3: "stoic virtue wisdom logos",
            4: "stoic logos virtue duty",
            5: "japanese aesthetic beauty fleeting",
            6: "japanese beauty impermanence aesthetic",
        }

    def test_surfaces_terms_distinctive_to_a_cluster(self):
        text_by_id = self._texts()
        all_ids = list(text_by_id.keys())
        terms = top_terms(text_by_id, member_ids=[1, 2], all_ids=all_ids, top_n=3)
        # Buddhist-cluster reps should surface "buddhist" or "enlightenment"
        # ahead of generic words. Both appear only in cluster 1's docs.
        assert "buddhist" in terms or "enlightenment" in terms

    def test_returns_at_most_top_n(self):
        text_by_id = self._texts()
        terms = top_terms(text_by_id, member_ids=[1, 2, 3, 4], all_ids=list(text_by_id.keys()), top_n=2)
        assert len(terms) <= 2

    def test_empty_member_list_returns_no_terms(self):
        text_by_id = self._texts()
        terms = top_terms(text_by_id, member_ids=[], all_ids=list(text_by_id.keys()), top_n=5)
        assert terms == []

    def test_filters_out_stopwords_and_short_words(self):
        text_by_id = {
            1: "the and is a of for example big idea",
            2: "the and is a of for example big idea",
        }
        terms = top_terms(text_by_id, member_ids=[1], all_ids=[1, 2], top_n=10)
        # No stopword should leak through.
        for stop in ["the", "and", "is", "of", "for"]:
            assert stop not in terms

    def test_skips_terms_appearing_only_once_in_cluster(self):
        # `cf < 2` floor: a term appearing only once is not distinctive enough.
        text_by_id = {1: "rare special", 2: "another text"}
        terms = top_terms(text_by_id, member_ids=[1], all_ids=[1, 2], top_n=5)
        assert "rare" not in terms
        assert "special" not in terms


class TestOutputShape:
    """Cover the JSON contract exposed to the frontend without hitting SQLite."""

    def test_clusters_json_round_trip(self, tmp_path):
        # Simulate what `main()` writes: small in-memory data → cluster JSON.
        mat = _three_blob_corpus(seed=3)
        labels, centers = kmeans(mat, k=3, iters=20, seed=3)
        ids = list(range(1, mat.shape[0] + 1))

        clusters: list[dict] = []
        for ci in range(3):
            members_idx = np.where(labels == ci)[0]
            sims = mat[members_idx] @ centers[ci]
            order = np.argsort(-sims)
            reps = [int(ids[members_idx[i]]) for i in order[:3]]
            clusters.append(
                {
                    "id": ci,
                    "size": int(len(members_idx)),
                    "representatives": reps,
                    "topTerms": [],
                }
            )
        assignments = {str(cid): int(label) for cid, label in zip(ids, labels.tolist())}
        payload = {"k": 3, "clusters": clusters, "assignments": assignments}

        out = tmp_path / "clusters.json"
        out.write_text(json.dumps(payload))
        loaded = json.loads(out.read_text())

        assert loaded["k"] == 3
        assert {c["id"] for c in loaded["clusters"]} == {0, 1, 2}
        # Every id appears in assignments exactly once
        assert len(loaded["assignments"]) == len(ids)
        # Sizes sum to N
        assert sum(c["size"] for c in loaded["clusters"]) == len(ids)


@pytest.mark.skipif(
    not (ROOT / "web" / "public" / "data" / "clusters.json").exists(),
    reason="clusters.json hasn't been generated yet (run `make cluster`)",
)
class TestExportedClustersJson:
    """Validate the actual exported clusters.json against its contract."""

    @pytest.fixture(scope="class")
    def payload(self):
        path = ROOT / "web" / "public" / "data" / "clusters.json"
        return json.loads(path.read_text())

    def test_top_level_shape(self, payload):
        assert isinstance(payload["k"], int)
        assert payload["k"] > 0
        assert isinstance(payload["clusters"], list)
        assert isinstance(payload["assignments"], dict)

    def test_every_concept_assigned_to_a_cluster_that_exists(self, payload):
        cluster_ids = {c["id"] for c in payload["clusters"]}
        for cid_str, label in payload["assignments"].items():
            int(cid_str)  # parses
            assert label in cluster_ids

    def test_cluster_sizes_match_assignment_counts(self, payload):
        from collections import Counter
        counts = Counter(payload["assignments"].values())
        for c in payload["clusters"]:
            assert c["size"] == counts[c["id"]], (
                f"cluster {c['id']}: declared size {c['size']} ≠ "
                f"observed {counts[c['id']]}"
            )

    def test_representatives_belong_to_their_cluster(self, payload):
        for c in payload["clusters"]:
            for rep_id in c["representatives"]:
                assert payload["assignments"][str(rep_id)] == c["id"]
