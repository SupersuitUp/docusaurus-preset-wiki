#!/usr/bin/env -S uv run --with pillow --quiet python3
"""Converter paired with scripts/check-image-weight.mjs, which is the gate this satisfies.

Converts every illustration under static/ to webp (q80, capped at 1536px wide), renames the
file and its .recipe.json sidecar, and rewrites every reference to it across docs/, src/ and
the config. Idempotent: a second run finds nothing to do.

Run it on a laptop, never in a build:

    npm run optimize:images
    npm run optimize:images -- --dry-run
    wiki optimize-images static/img/illustrations/capture.png   # only the files named

Naming files limits the run to those files, which is how `wiki hero` publishes one hero
without sweeping the rest of static/ in the same breath.

WHY IT IS PYTHON AND THE GATE IS NODE. The gate runs on every Vercel build, so it carries no
dependencies and reads image headers itself. The converter needs a real encoder, and adding
sharp to every wiki would cost more install time on every build than it ever saves. uv
fetches Pillow on demand, on the one machine that actually generates images.

WHY THE REFERENCE REWRITE IS PART OF THIS AND NOT A SEPARATE STEP. Converting foo.png to
foo.webp without rewriting `![](/img/foo.png)` leaves a page with a broken image and a green
build, because a missing static asset is a 404 at read time, not a build error. The
conversion and the rewrite are one operation or they are a bug.
"""
import hashlib, io, json, os, re, sys
from datetime import datetime, timezone
from pathlib import Path
from PIL import Image

# The wiki root is the cwd `wiki optimize-images` runs in; this file ships inside node_modules.
ROOT = Path.cwd()
MAX_W, QUALITY = 1536, 80
SKIP_DIRS = {"node_modules", ".git", "build", ".docusaurus", ".next", ".vercel"}
IMAGE_EXT = {".png", ".jpg", ".jpeg", ".gif", ".webp"}
# Same two exemptions the gate makes, for the same reasons: icons must keep their format,
# and share cards must stay png/jpg because several unfurl consumers do not render webp.
#
# Judged on the whole PATH, and kept in lockstep with check-image-weight.mjs.
# buildonanthropic-wiki keeps its deck card at static/og-deck/share.png, referenced from an
# og:image meta as an absolute external URL, so a filename-only rule converted it and no
# site-absolute reference scan could have caught the break.
ICON_NAME = re.compile(r"^(favicon|apple-touch-icon|android-chrome|mstile|safari-pinned|icon)[-.]", re.I)
CARD_STEM = re.compile(r"^(share|card|og|og-image|social-card|share-card)$"
                       r"|(-social-card|-share-card|-og-image)$", re.I)
CARD_DIR = re.compile(r"^(og|share|social)(-.*)?$", re.I)


def format_exempt(rel: str) -> bool:
    parts = rel.split("/")
    # search, not match: CARD_STEM's second alternative is a SUFFIX (-social-card), and
    # re.match anchors at the start, so match() silently classified
    # docusaurus-social-card.jpg as convertible while the JS gate called it exempt. The
    # self-test below exists because that drift is invisible until it converts something.
    return bool(ICON_NAME.search(parts[-1])) or bool(CARD_STEM.search(parts[-1].rsplit(".", 1)[0])) \
        or any(CARD_DIR.search(d) for d in parts[:-1])


def self_test():
    """Both scripts check themselves against scripts/image-exempt-cases.json first."""
    local = ROOT / "scripts" / "image-exempt-cases.json"
    shipped = Path(__file__).resolve().parent.parent / "image-exempt-cases.default.json"
    cases = json.loads((local if local.exists() else shipped).read_text())
    bad = [p for p in cases["exempt"] if not format_exempt(p)]
    bad += [p for p in cases["convert"] if format_exempt(p)]
    if bad:
        print("[optimize-images] SELF-TEST FAILED, classification disagrees with "
              "scripts/image-exempt-cases.json:", file=sys.stderr)
        for p in bad:
            print(f"  {p}", file=sys.stderr)
        sys.exit(2)


self_test()

# Where a reference to a static asset can live.
TEXT_DIRS = ["docs", "blog", "src", "static/skills"]
TEXT_FILES = ["docusaurus.config.ts", "sidebars.ts", "wiki.config.json",
              # The provenance gate's baseline names pre-gate images by path, so a converted one
              # has to move with its rename or the gate calls the .webp an image with no recipe.
              "scripts/image-provenance-baseline.json"]
# Any other top-level folder holding markdown is a docs tree too (a plain-language mirror, a
# second docs instance). Until 1.13.0 only the list above was scanned, so converting an image
# rewrote docs/ and left plain/ pointing at the deleted .png (getfreedom-wiki, 2026-09-23).
NOT_DOCS = {"node_modules", "build", ".docusaurus", ".git", ".claude", ".vercel", "static", "src",
            "scripts", "plugins", "illustrations", "templates", "review"}


def markdown_trees(root):
    out = []
    for d in sorted(root.iterdir()):
        if not d.is_dir() or d.name in NOT_DOCS or d.name.startswith(".") or d.name in TEXT_DIRS:
            continue
        if any(p.suffix.lower() in {".md", ".mdx"} for p in d.rglob("*") if p.is_file()):
            out.append(d.name)
    return out
TEXT_EXT = {".md", ".mdx", ".ts", ".tsx", ".js", ".jsx", ".json", ".html", ".yml", ".yaml"}

dry = "--dry-run" in sys.argv




def needs_work(path: Path):
    """(reasons, width) — empty reasons means the file already satisfies the contract."""
    try:
        with Image.open(path) as im:
            fmt, w = (im.format or "").lower(), im.width
    except Exception as e:
        return [f"unreadable ({e})"], 0
    exempt = format_exempt(str(path.relative_to(ROOT)))
    reasons = []
    if fmt != "webp" and not exempt:
        reasons.append(f"is {fmt}, not webp")
    if w > MAX_W and not exempt:
        reasons.append(f"is {w}px wide")
    if path.stat().st_size > 1_000_000:
        reasons.append(f"is {path.stat().st_size/1048576:.1f} MB")
    return reasons, w


def convert(path: Path):
    """Re-encode, then swap. Returns the new path, or None.

    An exempt file (icon, share card) is re-encoded IN ITS OWN FORMAT and keeps its
    extension. It can still land here by being oversized, and converting it anyway is what
    turned five wikis' social-card.jpg into a webp that several unfurl consumers do not
    render: the exemption suppressed the format complaint but not the conversion.
    """
    rel = str(path.relative_to(ROOT))
    exempt = format_exempt(rel)
    with Image.open(path) as im:
        if im.width > MAX_W:
            im = im.resize((MAX_W, round(im.height * MAX_W / im.width)), Image.LANCZOS)
        buf = io.BytesIO()
        if exempt:
            # Encode to the format the EXTENSION declares, not the bytes it currently holds.
            # The extension is what the og:image URL promises and what an unfurl consumer
            # sniffs for. appliedai-wiki's card is a PNG named social-card.jpg; honouring the
            # bytes re-saved 3.3 MB of PNG, honouring the extension gives a 0.5 MB JPEG.
            fmt = {"jpg": "JPEG", "jpeg": "JPEG", "png": "PNG"}.get(path.suffix[1:].lower())
            if fmt == "JPEG":
                im.convert("RGB").save(buf, "JPEG", quality=82, optimize=True, progressive=True)
            elif fmt == "PNG":
                im.save(buf, "PNG", optimize=True)
            else:
                return None  # .ico and friends: leave them entirely alone
        else:
            im.convert("RGBA" if im.mode in ("RGBA", "LA", "P") else "RGB").save(
                buf, "WEBP", quality=QUALITY, method=6
            )
    data = buf.getvalue()
    if exempt:
        if len(data) >= path.stat().st_size:
            return None
        tmp = path.with_name(path.name + ".tmp-optimize")
        if not dry:
            tmp.write_bytes(data)
            tmp.replace(path)
        return path   # same name, so no rename and no reference rewrite
    if len(data) >= path.stat().st_size and path.suffix.lower() == ".webp":
        return None  # already optimal; re-encoding would only make it bigger
    new = path.with_suffix(".webp")
    if not dry:
        tmp = new.with_name(new.name + ".tmp-optimize")
        tmp.write_bytes(data)
        tmp.replace(new)          # atomic: an interrupted run never leaves a half image
        if new != path:
            original = path.read_bytes()
            path.unlink()
            sidecar = path.with_name(path.name + ".recipe.json")
            if sidecar.exists():
                moved = new.with_name(new.name + ".recipe.json")
                sidecar.rename(moved)
                carry_provenance(moved, path, new, original)
    return new


def carry_provenance(sidecar: Path, old_path: Path, new_path: Path, original: bytes):
    """Rewrite a moved sidecar so it describes the file it now sits beside.

    RENAMING THE SIDECAR WAS NEVER ENOUGH, and the gap was invisible because the rename looks
    like the whole job. The recipe's own `asset` field kept naming the .png that no longer
    exists, so every converted illustration shipped a provenance record pointing at a deleted
    file. Found across the fleet on 2026-09-08 by check-image-provenance.mjs, in hyperagency
    (three) and multiplayer (one), all of them silent for months.

    ABU SPEC §3.2 (v0.32) settles what to do: a deterministic in-repo TRANSFORM owns its
    provenance exactly as a generator does. The generation fields are kept rather than replaced,
    because the model and the prompt that made the source are still true of this file and are
    the expensive half of the record; what gets ADDED is what happened afterwards, including the
    hash of the bytes that went in, so the chain from the render to the shipped asset is
    unbroken and checkable.
    """
    try:
        recipe = json.loads(sidecar.read_text())
    except (json.JSONDecodeError, OSError):
        return  # a sidecar we cannot parse is the gate's problem to report, not ours to mangle
    if not isinstance(recipe, dict):
        return
    rel = lambda q: str(q.relative_to(ROOT)) if ROOT in q.parents else q.name
    recipe["asset"] = rel(new_path)
    transforms = recipe.get("transforms")
    if not isinstance(transforms, list):
        transforms = []
    transforms.append({
        "tool": "scripts/optimize-images.py",
        "op": "webp",
        "quality": QUALITY,
        "maxWidth": MAX_W,
        "from": rel(old_path),
        "fromSha256": hashlib.sha256(original).hexdigest(),
        "at": datetime.now(timezone.utc).isoformat(),
    })
    recipe["transforms"] = transforms
    sidecar.write_text(json.dumps(recipe, indent=2) + "\n")


def repair_sidecars() -> int:
    """Fix sidecars whose `asset` still names the pre-conversion file.

    For the ones already on disk when the rule landed. It is deliberately narrow: it repairs
    ONLY a disagreement that is purely the extension, because that is the signature of this
    exact bug. A sidecar naming a different STEM is a different problem (a recipe copied onto
    the wrong image), it cannot be fixed mechanically without guessing, and guessing there
    would write a confident lie. Those are left for a human and reported by the gate.
    """
    fixed = 0
    for sidecar in ROOT.rglob("*.recipe.json"):
        if any(part in SKIP_DIRS for part in sidecar.parts):
            continue
        asset = sidecar.with_name(sidecar.name[: -len(".recipe.json")])
        if not asset.exists():
            continue
        try:
            recipe = json.loads(sidecar.read_text())
        except (json.JSONDecodeError, OSError):
            continue
        claimed = recipe.get("asset")
        if not isinstance(claimed, str):
            continue
        if Path(claimed).stem != asset.stem or Path(claimed).suffix == asset.suffix:
            continue
        rel = str(asset.relative_to(ROOT)) if ROOT in asset.parents else asset.name
        print(f"  repaired  {rel}.recipe.json  (asset was {claimed})")
        recipe["asset"] = rel
        transforms = recipe.get("transforms")
        if not isinstance(transforms, list):
            transforms = []
        transforms.append({
            "tool": "scripts/optimize-images.py --repair-sidecars",
            "op": "webp",
            "from": claimed,
            "note": "Recorded after the fact. This conversion predates the transform record, so the "
                    "input bytes were already gone and no fromSha256 could be computed honestly.",
            "at": datetime.now(timezone.utc).isoformat(),
        })
        recipe["transforms"] = transforms
        sidecar.write_text(json.dumps(recipe, indent=2) + "\n")
        fixed += 1
    return fixed


def text_files():
    for d in TEXT_DIRS + markdown_trees(ROOT):
        for p in (ROOT / d).rglob("*"):
            if p.is_file() and p.suffix.lower() in TEXT_EXT:
                yield p
    for f in TEXT_FILES:
        if (ROOT / f).exists():
            yield ROOT / f


# `--repair-sidecars` is the one-off for recipes written before the transform record existed.
# It runs alone and converts nothing, because mixing a repair pass into a conversion run makes
# the diff impossible to read.
if "--repair-sidecars" in sys.argv:
    print("[optimize-images] repairing sidecars whose asset still names the pre-conversion file")
    n = repair_sidecars()
    print(f"[optimize-images] repaired {n} sidecar(s)")
    sys.exit(0)
# (This block sits AFTER repair_sidecars() is defined. It used to sit near the top of the file and
# crashed with NameError on the one flag it existed for; carried over from an uncommitted fix in
# wiki-template, 2026-09-13.)

targets = [
    p for p in (ROOT / "static").rglob("*")
    if p.is_file() and p.suffix.lower() in IMAGE_EXT
]
# Positional paths narrow the run to exactly those files. A path that is not an image under
# static/ is refused rather than ignored, because a filter that matched nothing would print
# "nothing to do" and read as success.
only = [Path(a).resolve() for a in sys.argv[1:] if not a.startswith("--")]
if only:
    known = {p.resolve(): p for p in targets}
    missing = [str(o) for o in only if o not in known]
    if missing:
        print("[optimize-images] not an image under static/: " + ", ".join(missing), file=sys.stderr)
        sys.exit(2)
    targets = [known[o] for o in only]
work = [(p, needs_work(p)[0]) for p in targets]
work = [(p, r) for p, r in work if r]

if not work:
    print(f"[optimize-images] nothing to do: {len(targets)} images already satisfy the contract")
    sys.exit(0)

print(f"[optimize-images] {len(work)} of {len(targets)} images need work"
      f"{' (dry run, nothing will be written)' if dry else ''}")
renames, before, after = {}, 0, 0
for path, reasons in work:
    size = path.stat().st_size
    new = convert(path)
    if new is None:
        continue
    before += size
    after += len(new.read_bytes()) if not dry else 0
    if new != path:
        rel_old = "/" + str(path.relative_to(ROOT / "static")).replace(os.sep, "/")
        rel_new = "/" + str(new.relative_to(ROOT / "static")).replace(os.sep, "/")
        renames[rel_old] = rel_new

# One pass over every text file, applying every rename. Path-anchored so a filename
# mentioned in prose is left alone.
touched = 0
if renames:
    for f in text_files():
        try:
            src = f.read_text(encoding="utf-8")
        except (UnicodeDecodeError, FileNotFoundError):
            continue
        out = src
        for old, new in renames.items():
            out = out.replace(old, new)
        if out != src:
            touched += 1
            if not dry:
                f.write_text(out, encoding="utf-8")

print(f"[optimize-images] converted {len([1 for _, r in work if r])} file(s), "
      f"rewrote references in {touched} file(s)")
if before:
    print(f"  {before/1048576:.1f} MB -> {after/1048576:.1f} MB "
          f"({(1 - after/before)*100:.1f}% smaller)" if after else f"  {before/1048576:.1f} MB (dry run)")
print("  now run: npm run build   (check-links proves no reference was missed)")
