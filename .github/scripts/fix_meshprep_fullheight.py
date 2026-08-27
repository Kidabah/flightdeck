from pathlib import Path

css = Path('app/static/style.css')
s = css.read_text(encoding='utf-8')
s = s.replace("#view-makerdeck,\n#view-painter,\n#view-chop {", "#view-makerdeck,\n#view-meshprep,\n#view-painter,\n#view-chop {")
s = s.replace("#view-makerdeck[hidden],\n#view-painter[hidden],\n#view-chop[hidden] {", "#view-makerdeck[hidden],\n#view-meshprep[hidden],\n#view-painter[hidden],\n#view-chop[hidden] {")
s = s.replace(".makerdeck-page,\n.painter-page,\n.chop-page {", ".makerdeck-page,\n.meshprep-page,\n.painter-page,\n.chop-page {")
s = s.replace("#makerdeck-frame,\n#painter-frame,\n#chop-frame {", "#makerdeck-frame,\n#meshprep-frame,\n#painter-frame,\n#chop-frame {")
css.write_text(s, encoding='utf-8')

idx = Path('app/static/index.html')
s = idx.read_text(encoding='utf-8')
s = s.replace('/static/style.css?v=510', '/static/style.css?v=511')
idx.write_text(s, encoding='utf-8')
