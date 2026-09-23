#!/bin/bash
# Generate llms.txt and llms-full.txt for AI agent consumption.
# llms.txt = a grouped index with titles, URLs, and descriptions
# llms-full.txt = full content of every page concatenated, in the same order
#
# Runs as part of prebuild (`wiki check llms`). Output goes to static/ so Docusaurus serves them
# at root. Lifted from getfreedom-wiki's own generator in 1.13.0, which had outgrown this one.
#
# WHO READS THESE. Not a crawler building a search index: an agent that has been asked to
# operate this wiki's subject and is briefing itself before it starts. That reader wants to know
# what it is looking at before the list starts, and it wants the list in the order the tree is
# meant to be read rather than the order `find` walks the disk. A flat alphabetical dump is
# technically the same information and much harder to act on.
#
# ONLY DOCS_DIR IS READ. A second docs instance (a plain-language mirror) says the same things
# in different words; including it would double the corpus to say nothing new, and the
# duplication would read to a model as emphasis.
#
# Parameterized by the environment (llms-txt.mjs sets these from wiki.config.json):
#   WIKI_TITLE, WIKI_DESCRIPTION, BASE_URL, DOCS_DIR, STATIC_DIR
#   LLMS_PREAMBLE   `llms_preamble`: a paragraph for the agent, before the index. Optional.
#   SECTION_ORDER   `llms_sections`: top-level folders of DOCS_DIR in reading order. Anything not
#                   named still appears, after them, alphabetically; never silently dropped.

set -euo pipefail

# --- Configuration -----------------------------------------------------------

WIKI_TITLE="${WIKI_TITLE:-Wiki Documentation}"
WIKI_DESCRIPTION="${WIKI_DESCRIPTION:-Documentation for this wiki, served as llms.txt for AI agent consumption.}"
BASE_URL="${BASE_URL:-https://example.com}"
DOCS_DIR="${DOCS_DIR:-docs}"
STATIC_DIR="${STATIC_DIR:-static}"
# A paragraph aimed at the agent reading this file, before the index starts. Optional.
LLMS_PREAMBLE="${LLMS_PREAMBLE:-}"
# Top-level folders of DOCS_DIR, in the order a reader should meet them. Anything not named
# here still appears, after these, alphabetically: a new section is never silently dropped.
SECTION_ORDER="${SECTION_ORDER:-}"

LLMS_TXT="$STATIC_DIR/llms.txt"
LLMS_FULL="$STATIC_DIR/llms-full.txt"

# --- Helpers -----------------------------------------------------------------

# The frontmatter block only, so the word "draft" in prose cannot suppress a live page.
frontmatter_of() { awk 'NR==1&&$0!="---"{exit}NR>1{if($0=="---")exit;print}' "$1"; }

field_of() {
  grep -m1 "^$2:" "$1" 2>/dev/null | sed "s/^$2:[[:space:]]*//" | sed 's/^"//' | sed 's/"$//' || true
}

# `how-it-works` -> `How it works`. Used when a section has no index page to name itself.
title_from_slug() {
  echo "$1" | tr '-' ' ' | awk '{ $1 = toupper(substr($1,1,1)) substr($1,2); print }'
}

# What a section calls itself: its index page's title if it has one, else its folder name.
section_title() {
  local dir="$1" t=""
  for idx in "$DOCS_DIR/$dir/index.md" "$DOCS_DIR/$dir/index.mdx"; do
    if [ -f "$idx" ]; then t=$(field_of "$idx" title); fi
    [ -n "$t" ] && break
  done
  [ -z "$t" ] && t=$(title_from_slug "$dir")
  echo "$t"
}

# --- Pass 1: collect every publishable page ----------------------------------
# One record per line: section<TAB>url<TAB>title<TAB>description. Written to a temp file so
# the index can be grouped and the full text can be emitted in the same order.

INDEX_ROWS=$(mktemp)
trap 'rm -f "$INDEX_ROWS"' EXIT

find "$DOCS_DIR" -name "*.md" -o -name "*.mdx" | sort | while read -r file; do
  # Skip pages Docusaurus itself does not publish. `draft: true` is excluded from the
  # production build entirely and `unlisted: true` is kept out of search and the sitemap, so
  # neither belongs in an UNGATED machine corpus that other agents read. Without this, hiding a
  # page from the site still published its full body here, so a page pulled from the site kept
  # shipping to every agent that reads llms-full.txt.
  if frontmatter_of "$file" | grep -qE '^(draft|unlisted):[[:space:]]*true[[:space:]]*$'; then
    continue
  fi

  title=$(field_of "$file" title)
  [ -z "$title" ] && title=$(grep -m1 '^# ' "$file" 2>/dev/null | sed 's/^# //' || echo "")
  [ -z "$title" ] && continue

  # docs/concepts/foo.md -> concepts/foo ; docs/start-here/index.md -> start-here
  url_path=$(echo "$file" | sed 's|^'"$DOCS_DIR"'/||' | sed 's|\.mdx$||' | sed 's|\.md$||' | sed 's|/index$||')
  if [ -z "$url_path" ] || [ "$url_path" = "index" ]; then
    url="$BASE_URL"
    section="_root"
  else
    url="$BASE_URL/$url_path"
    case "$url_path" in
      */*) section="${url_path%%/*}" ;;
      *)   section="_root" ;;
    esac
  fi

  description=$(field_of "$file" description)

  printf '%s\t%s\t%s\t%s\t%s\n' "$section" "$url" "$title" "$description" "$file" >> "$INDEX_ROWS"
done

# --- Pass 2: llms.txt, grouped -----------------------------------------------

{
  echo "# $WIKI_TITLE"
  echo ""
  echo "> $WIKI_DESCRIPTION"
  if [ -n "$LLMS_PREAMBLE" ]; then
    echo ""
    echo "$LLMS_PREAMBLE"
  fi
  echo ""
  echo "Every page below, in full, in one file: $BASE_URL/llms-full.txt"
} > "$LLMS_TXT"

# Sections in the declared order first, then anything else alphabetically, then root pages.
present=$(cut -f1 "$INDEX_ROWS" | sort -u)
ordered=""
for s in $SECTION_ORDER; do
  if echo "$present" | grep -qx "$s"; then ordered="$ordered $s"; fi
done
for s in $present; do
  [ "$s" = "_root" ] && continue
  case " $SECTION_ORDER " in *" $s "*) continue ;; esac
  ordered="$ordered $s"
done
if echo "$present" | grep -qx "_root"; then ordered="$ordered _root"; fi

for s in $ordered; do
  if [ "$s" = "_root" ]; then heading="Elsewhere"; else heading=$(section_title "$s"); fi
  {
    echo ""
    echo "## $heading"
    echo ""
  } >> "$LLMS_TXT"
  awk -F'\t' -v s="$s" '$1 == s {
    if ($4 != "") printf "- [%s](%s): %s\n", $3, $2, $4
    else          printf "- [%s](%s)\n", $3, $2
  }' "$INDEX_ROWS" >> "$LLMS_TXT"
done

# --- Pass 3: llms-full.txt ---------------------------------------------------

{
  echo "# $WIKI_TITLE: Full Content"
  echo ""
  echo "> The full text of every page in this wiki, in reading order."
  echo "> Generated automatically at build time. The index is at $BASE_URL/llms.txt"
  if [ -n "$LLMS_PREAMBLE" ]; then
    echo ""
    echo "$LLMS_PREAMBLE"
  fi
  echo ""
} > "$LLMS_FULL"

for s in $ordered; do
  if [ "$s" = "_root" ]; then heading="Elsewhere"; else heading=$(section_title "$s"); fi
  {
    echo "==============================================================================="
    echo "# SECTION: $heading"
    echo "==============================================================================="
    echo ""
  } >> "$LLMS_FULL"

  awk -F'\t' -v s="$s" '$1 == s { print $5 "\t" $3 "\t" $2 }' "$INDEX_ROWS" |
  while IFS=$'\t' read -r file title url; do
    {
      echo "---"
      echo "# $title"
      echo "URL: $url"
      echo ""
    } >> "$LLMS_FULL"
    # Strip frontmatter, then the MDX-only syntax that never renders as prose on the page.
    # Whatever a reader cannot see does not belong in the corpus, and whatever they see as a
    # DRAWING cannot be carried here at all: a bare `<Figure />` in a text corpus is a token of
    # noise standing where a figure was, which is worse than the figure's absence.
    #   {/* ... */}   authoring comments (often internal notes, must not ship)
    #   import ...    module wiring
    #   <Component/>  a rendered figure or a <video> element, on a line of its own
    awk '/^---$/{if(++c==2)next}c>=2' "$file" \
      | perl -0777 -pe 's/\{\/\*.*?\*\/\}\n?//gs' \
      | grep -v '^import .* from ' \
      | perl -pe 's/^\s*<(?:[A-Z][A-Za-z0-9]*|video)\b[^>]*(?:\/>|>(?:.*?<\/(?:[A-Z][A-Za-z0-9]*|video)>)?)\s*$\n?//' \
      >> "$LLMS_FULL"
    {
      echo ""
      echo ""
    } >> "$LLMS_FULL"
  done
done

# --- Footer + summary --------------------------------------------------------

page_count=$(grep -c '^\- \[' "$LLMS_TXT" || echo 0)
{
  echo ""
  echo "---"
  echo "Generated at build time. $page_count pages indexed."
} >> "$LLMS_TXT"

echo "Generated llms.txt ($page_count pages) and llms-full.txt"

echo "Generated llms.txt ($page_count pages) and llms-full.txt"
