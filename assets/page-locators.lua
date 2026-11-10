-- Typeset Vitro: accept page labels in any language.
-- citeproc only recognises locator labels of the document's language
-- ("S." in German, "p." in English …); "[@key, pp. 45]" in a German text
-- would print "pp. 45" literally. A bare number means "page" in every
-- locale, so common page labels are dropped and the CSL style adds its own.
local PAGE_LABELS = {
  ["p."] = true, ["pp."] = true, ["pg."] = true, ["pgs."] = true,
  ["page"] = true, ["pages"] = true,
  ["s."] = true, ["seite"] = true, ["seiten"] = true,
}

local NBSP = "\194\160"

-- split "pp.\u{a0}45" (Pandoc joins abbreviations to numbers) or "pp.45"
local function split_label(text)
  local a, b = text:match("^(.-)" .. NBSP .. "(.*)$")
  if a then return a, b end
  for l, _ in pairs(PAGE_LABELS) do
    if l:sub(-1) == "." and text:lower():sub(1, #l) == l and text:sub(#l + 1):match("^%d") then
      return text:sub(1, #l), text:sub(#l + 1)
    end
  end
  return text, nil
end

local function strip_page_label(suffix)
  -- shape: Str "," Space Str "pp.\u{a0}45" …  or  Str "," Space Str "Seite" Space Str "45"
  local i = 1
  if suffix[i] and suffix[i].t == "Str" and suffix[i].text == "," then i = i + 1 end
  if suffix[i] and suffix[i].t == "Space" then i = i + 1 end
  local label = suffix[i]
  if not (label and label.t == "Str") then return suffix end

  local word, rest = split_label(label.text)
  if not PAGE_LABELS[word:lower()] then return suffix end

  local out = pandoc.List()
  for j = 1, i - 1 do out:insert(suffix[j]) end
  if rest and rest ~= "" then
    if not rest:match("^%d") then return suffix end
    out:insert(pandoc.Str(rest))
    for j = i + 1, #suffix do out:insert(suffix[j]) end
  else
    local j = i + 1
    if suffix[j] and suffix[j].t == "Space" then j = j + 1 end
    -- only drop the label when a page number follows
    if not (suffix[j] and suffix[j].t == "Str" and suffix[j].text:match("^%d")) then return suffix end
    for k = j, #suffix do out:insert(suffix[k]) end
  end
  return out
end

function Cite(c)
  for _, ci in ipairs(c.citations) do
    ci.suffix = strip_page_label(ci.suffix)
  end
  return c
end
