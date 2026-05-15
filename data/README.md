# data/

Local cache and raw downloads. **Everything in this directory except this
README is gitignored.** Never commit datasets, API responses, or generated
GeoJSON.

```
data/
├── cache/    # backend on-disk response cache, keyed by (source, bbox, t)
└── raw/     # one-off downloads (e.g. Digiroad GeoPackage, OpenCelliD CSV)
```

Recreate by re-running the backend or re-downloading from the original
providers (see `../AGENTS.md` §6 for source URLs).
