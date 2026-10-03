---
title: POST /catch/publish — ajout RAL
status: not_started
scope: [API]
type: [enhancement]
notion_url: https://www.notion.so/3223324cc3d7807a90c6e41a15fba804
---

## Tasks

- [ ] Ajouter le champ `ralCode` (string) au body de POST /catch/publish
- [ ] Ajouter le champ `ralProximity` (int 0–100) au body
- [ ] Modifier la validation de `colors.length` pour accepter === 1 (plus fixé à 3 ou 4)

## Notes

Exemple de request attendue :
```json
{
  "photoBlob": "UklGRg...base64...==",
  "timestamp": "2026-03-20T12:44:14.913Z",
  "colors": [{ "r": 49, "g": 111, "b": 75 }],
  "captureAspectRatio": "4:3",
  "captureCropRect": { "x": 0.1, "y": 0.2, "width": 0.8, "height": 0.6 },
  "ralCode": "RAL 6001",
  "ralProximity": 100
}
```
