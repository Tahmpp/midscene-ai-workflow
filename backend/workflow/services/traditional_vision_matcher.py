import base64
import io
from pathlib import Path
from typing import Dict, List, Optional

import numpy as np
from PIL import Image
from django.conf import settings


class TraditionalVisionMatcher:
    """
    传统视觉匹配器（无大模型 token 消耗）。

    当前实现使用 dHash（感知哈希）+ 汉明距离进行近似匹配：
    - 优点：轻量、快、可离线运行。
    - 适合：封面图、海报图、卡片图等“整体外观可区分”的场景。
    - 不适合：大幅裁剪、强透视变形、极低清晰度等复杂场景。
    """

    def __init__(self, reference_root: Optional[Path] = None):
        try:
            base = Path(settings.BASE_DIR)
        except Exception:
            # 允许在非 Django 上下文下被独立调用（如本地脚本调试）
            base = Path(__file__).resolve().parents[2]
        default_root = base / "vision_models" / "references"
        self.reference_root = Path(reference_root or default_root)

    def match_base64(
        self,
        screenshot_base64: str,
        target: str,
        category: Optional[str] = "tv_series",
        min_score: float = 0.78,
        top_k: int = 3,
    ) -> Dict:
        if not screenshot_base64:
            return {
                "matched": False,
                "reason": "empty screenshot",
                "best_label": None,
                "best_score": 0.0,
                "top_matches": [],
            }

        screenshot_img = self._decode_base64_image(screenshot_base64)
        screenshot_hash = self._compute_dhash(screenshot_img)

        references = self._load_reference_hashes(category=category)
        if not references:
            return {
                "matched": False,
                "reason": "no reference images",
                "best_label": None,
                "best_score": 0.0,
                "top_matches": [],
            }

        candidates: List[Dict] = []
        for item in references:
            dist = self._hamming_distance(screenshot_hash, item["hash"])
            score = 1.0 - (dist / len(screenshot_hash))
            candidates.append(
                {
                    "label": item["label"],
                    "score": float(score),
                    "path": str(item["path"]),
                }
            )

        candidates.sort(key=lambda x: x["score"], reverse=True)
        best = candidates[0]
        target_normalized = self._norm(target)
        best_is_target = self._norm(best["label"]) == target_normalized
        matched = best_is_target and best["score"] >= min_score

        return {
            "matched": matched,
            "target": target,
            "category": category,
            "min_score": min_score,
            "best_label": best["label"],
            "best_score": best["score"],
            "top_matches": candidates[: max(1, top_k)],
        }

    def _load_reference_hashes(self, category: Optional[str] = None) -> List[Dict]:
        root = self.reference_root
        if category:
            root = root / category

        if not root.exists():
            return []

        records: List[Dict] = []
        for label_dir in root.iterdir():
            if not label_dir.is_dir():
                continue
            label = label_dir.name
            for image_path in label_dir.glob("*"):
                if image_path.suffix.lower() not in {".jpg", ".jpeg", ".png", ".webp", ".bmp"}:
                    continue
                try:
                    with Image.open(image_path) as img:
                        records.append(
                            {
                                "label": label,
                                "path": image_path,
                                "hash": self._compute_dhash(img),
                            }
                        )
                except Exception:
                    continue
        return records

    @staticmethod
    def _decode_base64_image(data: str) -> Image.Image:
        raw = data
        if "," in data and data.strip().startswith("data:image"):
            raw = data.split(",", 1)[1]
        image_bytes = base64.b64decode(raw)
        return Image.open(io.BytesIO(image_bytes)).convert("RGB")

    @staticmethod
    def _compute_dhash(image: Image.Image, hash_size: int = 16) -> np.ndarray:
        # dHash: 比较相邻像素亮度差，生成 hash_size * hash_size 位向量
        gray = image.convert("L").resize((hash_size + 1, hash_size), Image.Resampling.LANCZOS)
        arr = np.asarray(gray, dtype=np.int16)
        diff = arr[:, 1:] > arr[:, :-1]
        return diff.flatten()

    @staticmethod
    def _hamming_distance(h1: np.ndarray, h2: np.ndarray) -> int:
        return int(np.count_nonzero(h1 != h2))

    @staticmethod
    def _norm(text: str) -> str:
        return "".join((text or "").strip().lower().split())
