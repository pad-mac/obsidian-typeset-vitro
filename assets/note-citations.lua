-- Typeset Vitro: inside footnotes, render bracketed citations without the
-- parentheses citeproc adds when a citation is not the whole note
-- Each citation of a group becomes its own in-text citation, joined by "; ".
local function in_text(cite)
  local out = pandoc.List()
  for i, ci in ipairs(cite.citations) do
    if i > 1 then out:insert(pandoc.Str(";")); out:insert(pandoc.Space()) end
    -- a prefix inside an in-text citation confuses citeproc: put it in front
    if #ci.prefix > 0 then
      out:extend(ci.prefix)
      out:insert(pandoc.Space())
      ci.prefix = pandoc.Inlines({})
    end
    if ci.mode == "NormalCitation" then ci.mode = "AuthorInText" end
    out:insert(pandoc.Cite({}, { ci }))
  end
  return out
end

function Note(note)
  return note:walk({
    Cite = function(c)
      for _, ci in ipairs(c.citations) do
        if ci.mode ~= "NormalCitation" then return nil end
      end
      return in_text(c)
    end,
  })
end
