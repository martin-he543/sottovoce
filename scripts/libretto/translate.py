"""Offline Italian→English translation of every full libretto in public/libretti/texts.

Writes public/libretti/translations/<id>.json: one English string per sung line, in act → scene → sung-line order, so
the reader can pair them with the original without loading anything else. Runs Helsinki-NLP opus-mt (it, de or fr → en)
locally (no API), one process per GPU; English texts are left alone. Existing translations are kept, so a re-run only
does what is missing:  python3 scripts/libretto/translate.py <shard> <shards>
"""
import glob, json, os, sys, time
import torch
from transformers import MarianMTModel, MarianTokenizer

shard, shards = int(sys.argv[1]), int(sys.argv[2])
ROOT = os.path.join(os.path.dirname(__file__), '..', '..', 'public', 'libretti')
OUT = os.path.join(ROOT, 'translations')
os.makedirs(OUT, exist_ok=True)

dev = f'cuda:{shard % torch.cuda.device_count()}'
MODELS = {'Italian': 'it', 'German': 'de', 'French': 'fr'}
loaded = {}


def model_for(lang):
    if lang not in loaded:
        name = f'Helsinki-NLP/opus-mt-{MODELS[lang]}-en'
        loaded[lang] = (MarianTokenizer.from_pretrained(name), MarianMTModel.from_pretrained(name).half().to(dev).eval())
    return loaded[lang]


files = sorted(f for f in glob.glob(os.path.join(ROOT, 'texts', '*.json')) if not f.endswith('index.json'))[shard::shards]
files = [f for f in files if not os.path.exists(os.path.join(OUT, os.path.basename(f)))]


def sung(doc):
    return [l[1] for a in doc['acts'] for s in a['scenes'] for l in s['lines'] if l[2] == 'sung']


docs = {}
for f in files:
    d = json.load(open(f))
    if d.get('language') in MODELS:
        docs[f] = (d['language'], sung(d))
by_lang = {}
for lang, ls in docs.values():
    by_lang.setdefault(lang, set()).update(ls)
done, t0 = {}, time.time()
for lang, lines in by_lang.items():
    tok, model = model_for(lang)
    unique = sorted(lines, key=len)
    print(f'shard {shard}: {lang}, {len(unique)} distinct lines on {dev}', flush=True)
    out_map = {}
    for i in range(0, len(unique), 192):
        batch = unique[i:i + 192]
        enc = tok(batch, return_tensors='pt', padding=True, truncation=True, max_length=160).to(dev)
        with torch.no_grad():
            out = model.generate(**enc, num_beams=3, max_new_tokens=160)
        out_map.update(zip(batch, tok.batch_decode(out, skip_special_tokens=True)))
        if (i // 192) % 40 == 0:
            print(f'shard {shard}: {lang} {i}/{len(unique)} {time.time() - t0:.0f}s', flush=True)
    done[lang] = out_map
for f, (lang, ls) in docs.items():
    with open(os.path.join(OUT, os.path.basename(f)), 'w') as fh:
        json.dump([done[lang][t] for t in ls], fh, ensure_ascii=False, separators=(',', ':'))
print(f'shard {shard}: finished in {time.time() - t0:.0f}s', flush=True)
