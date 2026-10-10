"""
Build the upload for the department's LAMP server (CGV brief, sections 5-6).

The game needs no bundler - it is plain ES modules with an import map - so a
"build" is a clean copy of only what the browser loads:

    index.html, main.js, styles.css, src/, lib/, assets/

(no tests, docs, tools, node_modules, .git), checked for the things the brief
says break a hosted game: absolute paths, filenames that only work on a
case-insensitive disk, spaces in names. Then zipped with index.html at the
top level of the archive, ready for the Moodle submission.

    python tools/build-deploy.py            -> dist/fracture-run/ and dist/fracture-run.zip
    python tools/serve.py 4173 dist         -> play the build (http://localhost:4173/fracture-run/)
"""

import os
import re
import shutil
import sys
import time
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, "dist")
OUT = os.path.join(DIST, "fracture-run")
ZIP = os.path.join(DIST, "fracture-run.zip")

FILES = ["index.html", "main.js", "styles.css"]
FOLDERS = ["src", "lib", "assets"]
# In the repository for reference (see docs/credits.md), never loaded by the game.
UNUSED = {
    "assets/meltdown/dead_end_weapons.glb",
    "assets/meltdown/weapon_set.glb",
    "assets/meltdown/dragon_flail.glb",
}
SKIP_NAMES = {".DS_Store", "Thumbs.db", "desktop.ini"}

TEXT = (".html", ".js", ".css", ".json")
ABSOLUTE = re.compile(
    r"""(?:src|href)\s*=\s*["']/(?!/)"""            # <script src="/...">
    r"""|\bfrom\s+["']/(?!/)"""                       # import ... from "/..."
    r"""|\bimport\(\s*["']/(?!/)"""                   # import("/...")
    r"""|\b(?:fetch|load|loadAsync)\(\s*["'`]/(?!/)"""  # fetch("/..."), loader.load("/...")
    r"""|url\(\s*["']?/(?!/)"""                       # CSS url(/...)
)
RELATIVE_REF = re.compile(r"""["'`](\.{1,2}/[^"'`\s${}]+?\.(?:js|css|glb|gltf|png|jpe?g|webp|mp3|wav|ogg|json|hdr))["'`]""")


def remove_tree(path):
    """rmtree, patient with Windows: OneDrive or the indexer can hold a folder for a moment."""
    for attempt in range(20):
        try:
            shutil.rmtree(path)
            return
        except FileNotFoundError:
            return
        except PermissionError:
            time.sleep(0.5)
    shutil.rmtree(path)


def copy():
    if os.path.isdir(DIST):
        remove_tree(DIST)
    os.makedirs(OUT)
    for name in FILES:
        shutil.copy2(os.path.join(ROOT, name), os.path.join(OUT, name))
    for folder in FOLDERS:
        for base, dirs, files in os.walk(os.path.join(ROOT, folder)):
            dirs[:] = [d for d in dirs if not d.startswith(".")]
            for name in files:
                src = os.path.join(base, name)
                rel = os.path.relpath(src, ROOT).replace(os.sep, "/")
                if name in SKIP_NAMES or rel in UNUSED:
                    continue
                dst = os.path.join(OUT, rel)
                os.makedirs(os.path.dirname(dst), exist_ok=True)
                shutil.copy2(src, dst)


def exact_case_exists(path):
    """True only if every segment of `path` (relative to OUT) exists with exactly that case - as on Linux."""
    here = OUT
    for part in path.split("/"):
        if part in ("", "."):
            continue
        if part == "..":
            here = os.path.dirname(here)
            continue
        try:
            names = os.listdir(here)
        except (NotADirectoryError, FileNotFoundError):
            return False
        if part not in names:
            return False
        here = os.path.join(here, part)
    return True


def check():
    problems = []
    for base, _, files in os.walk(OUT):
        for name in files:
            full = os.path.join(base, name)
            rel = os.path.relpath(full, OUT).replace(os.sep, "/")
            if " " in rel:
                problems.append(f"space in a filename: {rel}")
            if not name.endswith(TEXT) or rel.startswith("lib/"):
                continue
            text = open(full, encoding="utf-8", errors="replace").read()
            for n, line in enumerate(text.splitlines(), 1):
                if line.lstrip().startswith(("//", "*", "/*", "<!--")):
                    continue  # comments describe paths; they don't load them
                if ABSOLUTE.search(line):
                    problems.append(f"absolute path: {rel}:{n}: {line.strip()[:100]}")
                # A literal relative reference must resolve with exact case.
                for ref in RELATIVE_REF.findall(line):
                    target = os.path.normpath(os.path.join(os.path.dirname(rel), ref)).replace(os.sep, "/")
                    if target.startswith(".."):
                        continue
                    if not exact_case_exists(target):
                        problems.append(f"missing or wrong case: {rel}:{n}: {ref}")
    return problems


def zip_up():
    with zipfile.ZipFile(ZIP, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for base, _, files in os.walk(OUT):
            for name in sorted(files):
                full = os.path.join(base, name)
                # index.html at the top level of the archive, not in a folder.
                z.write(full, os.path.relpath(full, OUT).replace(os.sep, "/"))


def size_mb(path):
    if os.path.isfile(path):
        return os.path.getsize(path) / 1048576
    return sum(os.path.getsize(os.path.join(b, f)) for b, _, fs in os.walk(path) for f in fs) / 1048576


def main():
    copy()
    problems = check()
    for p in problems:
        print("  x", p)
    if problems:
        print(f"{len(problems)} problem(s): fix them before uploading.")
        sys.exit(1)
    zip_up()
    count = sum(len(fs) for _, _, fs in os.walk(OUT))
    print(f"dist/fracture-run/  {count} files, {size_mb(OUT):.1f} MB")
    print(f"dist/fracture-run.zip  {size_mb(ZIP):.1f} MB  (index.html at the top level)")
    print("Test it: python tools/serve.py 4173 dist   then open http://localhost:4173/fracture-run/")


if __name__ == "__main__":
    main()
