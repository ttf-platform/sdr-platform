#!/usr/bin/env python3
"""
Replace <Screenshot placeholder ... /> with <Screenshot src="..." ... /> in MDX files.
Run: python3 scripts/help-screenshots/replace.py

Operates only on screenshots that exist in public/help/screenshots/.
Leaves placeholder components untouched if the file is missing.
"""
import os
import re
import json

CONTENT_DIR = os.path.join(os.getcwd(), "content", "help")
SCREENSHOTS_DIR = os.path.join(os.getcwd(), "public", "help", "screenshots")
MANIFEST_FILE = os.path.join(os.getcwd(), "scripts", "help-screenshots", "manifest.json")

with open(MANIFEST_FILE) as f:
    manifest = json.load(f)

# Build lookup: (slug, index) -> filename
lookup = {(e["article_slug"], e["index"]): e["file"] for e in manifest}

# Track counters
replaced = 0
skipped_no_file = 0
files_touched = set()

for slug, mdx_file in (
    (os.path.splitext(f)[0], os.path.join(CONTENT_DIR, f))
    for f in os.listdir(CONTENT_DIR)
    if f.endswith(".mdx")
):
    text = open(mdx_file).read()
    original = text

    # Find all Screenshot placeholder usages in order
    # Pattern: <Screenshot placeholder alt='...' caption='...' />
    pattern = re.compile(
        r"<Screenshot\s+placeholder\s+alt='([^']+)'\s+caption='([^']*)'\s*/>"
    )

    # Count occurrences per slug to track index
    counters: dict[str, int] = {}

    def replacer(m: re.Match) -> str:
        global replaced, skipped_no_file
        alt = m.group(1)
        caption = m.group(2)

        counters[slug] = counters.get(slug, 0) + 1
        idx = counters[slug]

        filename = lookup.get((slug, idx))
        if not filename:
            return m.group(0)  # no manifest entry, leave as-is

        png_path = os.path.join(SCREENSHOTS_DIR, filename)
        if not os.path.isfile(png_path):
            skipped_no_file += 1
            return m.group(0)  # screenshot not captured yet, leave placeholder

        src = f"/help/screenshots/{filename}"
        replaced += 1
        files_touched.add(mdx_file)
        return f"<Screenshot src='{src}' alt='{alt}' caption='{caption}' />"

    text = pattern.sub(replacer, text)

    if text != original:
        with open(mdx_file, "w") as f:
            f.write(text)

print(f"✅ {replaced} screenshots replaced across {len(files_touched)} files")
if skipped_no_file:
    print(f"⏭️  {skipped_no_file} placeholders left (PNG not captured yet)")
