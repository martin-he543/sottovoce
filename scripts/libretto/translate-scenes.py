"""Offline translation of the scene settings (and headings the reader cannot normalise) of every full libretto.

Writes public/libretti/translations/scenes/<id>.json: {"d": [...], "t": [...], "a": [...]} with the English for each
scene's description, each scene's title and each act's heading, in act → scene order ("" where there is nothing to
translate). English texts are skipped and existing files are kept, so a re-run only does what is missing:
python3 scripts/libretto/translate-scenes.py <shard> <shards>
"""
import glob, json, os, re, sys, time
import torch
from transformers import MarianMTModel, MarianTokenizer

shard, shards = int(sys.argv[1]), int(sys.argv[2])
ROOT = os.path.join(os.path.dirname(__file__), '..', '..', 'public', 'libretti')
OUT = os.path.join(ROOT, 'translations', 'scenes')
os.makedirs(OUT, exist_ok=True)

dev = f'cuda:{shard % torch.cuda.device_count()}'
MODELS = {'Italian': 'it', 'German': 'de', 'French': 'fr'}
loaded = {}


def model_for(lang):
    if lang not in loaded:
        name = f'Helsinki-NLP/opus-mt-{MODELS[lang]}-en'
        loaded[lang] = (MarianTokenizer.from_pretrained(name), MarianMTModel.from_pretrained(name).half().to(dev).eval())
    return loaded[lang]


def tidy(s):
    """Scraped notes run sentences together ("Valle.A destra"): put the space back."""
    return re.sub(r'([a-zà-ÿ]{2,}[.;:!?])([A-ZÀ-Ý])', r'\1 \2', s.strip())


files = sorted(f for f in glob.glob(os.path.join(ROOT, 'texts', '*.json')) if not f.endswith('index.json'))[shard::shards]
files = [f for f in files if not os.path.exists(os.path.join(OUT, os.path.basename(f)))]
docs = {}
for f in files:
    d = json.load(open(f))
    if d.get('language') in MODELS:
        docs[f] = d
need = {}
for d in docs.values():
    s = need.setdefault(d['language'], set())
    for a in d['acts']:
        s.add(tidy(a['heading']))
        for sc in a['scenes']:
            s.add(tidy(sc['title']))
            s.add(tidy(sc['description'] or ''))
done, t0 = {}, time.time()
for lang, texts in need.items():
    tok, model = model_for(lang)
    unique = sorted((t for t in texts if t), key=len)
    print(f'shard {shard}: {lang}, {len(unique)} distinct on {dev}', flush=True)
    out = {}
    for i in range(0, len(unique), 128):
        batch = unique[i:i + 128]
        enc = tok(batch, return_tensors='pt', padding=True, truncation=True, max_length=256).to(dev)
        with torch.no_grad():
            gen = model.generate(**enc, num_beams=3, max_new_tokens=256)
        out.update(zip(batch, tok.batch_decode(gen, skip_special_tokens=True)))
        if (i // 128) % 20 == 0:
            print(f'shard {shard}: {lang} {i}/{len(unique)} {time.time() - t0:.0f}s', flush=True)
    out[''] = ''
    done[lang] = out
for f, d in docs.items():
    m = done[d['language']]
    res = {
        'a': [m[tidy(a['heading'])] for a in d['acts']],
        't': [m[tidy(s['title'])] for a in d['acts'] for s in a['scenes']],
        'd': [m[tidy(s['description'] or '')] for a in d['acts'] for s in a['scenes']],
    }
    with open(os.path.join(OUT, os.path.basename(f)), 'w') as fh:
        json.dump(res, fh, ensure_ascii=False, separators=(',', ':'))
print(f'shard {shard}: finished in {time.time() - t0:.0f}s', flush=True)
