"""Package the public site so it can be opened directly from an extracted ZIP."""
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo


ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"
DATA = PUBLIC / "ui" / "data"
PREFIX = "document.currentScript.rate90Data = "


def published_day_files():
    selected = set()
    for name in ("process-ratings", "collected-index"):
        text = (DATA / f"{name}.js").read_text(encoding="utf-8").strip()
        if not text.startswith(PREFIX) or not text.endswith(";"):
            raise ValueError(f"无效的公开索引 {name}")
        index = json.loads(text[len(PREFIX):-1])
        if "prematchFile" in index:
            path = DATA / (index["prematchFile"] + ".js")
            if not path.is_file():
                raise FileNotFoundError(path)
            selected.add(path)
        for entry in index["days"].values():
            for key in ("file", "previewFile"):
                if entry.get(key):
                    path = DATA / (entry[key] + ".js")
                    if not path.is_file():
                        raise FileNotFoundError(path)
                    selected.add(path)
    return selected


def package():
    days = published_day_files()
    out = ROOT / "dist" / "Rate90-static.zip"
    out.parent.mkdir(exist_ok=True)
    with TemporaryDirectory(dir=out.parent) as tmp:
        packed = Path(tmp) / out.name
        with ZipFile(packed, "w") as archive:
            for source in sorted(PUBLIC.rglob("*")):
                rel = source.relative_to(PUBLIC)
                if not source.is_file() or any(p.startswith(".") for p in rel.parts):
                    continue
                if source.name.startswith("prematch-") and source.parent == DATA and source not in days:
                    continue
                if rel.parts[:3] in (("ui", "data", "rounds"), ("ui", "data", "collected")) and source not in days:
                    continue
                # Normalize timestamps and modes across developers' machines.
                entry = ZipInfo(rel.as_posix())
                entry.create_system = 3
                entry.external_attr = 0o100644 << 16
                archive.writestr(entry, source.read_bytes(), compress_type=ZIP_DEFLATED)
        packed.replace(out)
    print(out)


if __name__ == "__main__":
    package()
